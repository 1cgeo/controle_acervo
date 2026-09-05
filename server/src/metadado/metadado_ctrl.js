'use strict'

// MODULO METADADO: o que a norma exige que acompanhe o dado quando ele sai da
// Divisao, e as duas saidas que leem daqui -- a ficha ET-PCDG (o quadro impresso
// na moldura) e o XML de metadado que viaja com o produto entregue.
//
// VEIO DO SAP 2.3.5 (`server/src/metadados/metadados_ctrl.js`), na travessia de
// 2026-08-09. O QUE MUDOU, e nada disto e cosmetico:
//
//   1. `macrocontrole.produto` virou `acervo.versao`, e a coluna virou
//      `versao_id`. O produto do SAP e a VERSAO do acervo: metadado descreve uma
//      EDICAO especifica, e a mesma folha reeditada em outro ano tem outro
//      resumo, outra data de criacao e outro responsavel. O `:uuid` das rotas de
//      produto passou a ser `acervo.versao.uuid_versao`.
//   2. `macrocontrole.lote` virou `acervo.lote`, e `producao.lote_linha` NAO
//      existe: a producao liga direto no lote do acervo.
//   3. `metadado.usuario.usuario_sap_id` virou `usuario_uuid`.
//   4. `tipo_produto_id` do SAP virou `subtipo_produto_id` (mesmos codes 1 a
//      23; so o 19 difere de ROTULO, e aqui se chama Carta Ortoimagem de SARP).
//   5. `db.sapConn` virou `db.conn`: aqui ha UMA conexao.
//   6. Toda escrita passou a auditar na MESMA transacao, e a origem nao
//      auditava nada. A consequencia e deliberada: falhar ao auditar derruba a
//      escrita.
//   7. Onde a origem gravava o lote inteiro com `pgp.helpers.insert`/`update`
//      em uma sentenca so, aqui cada linha entra com `RETURNING *` e gera o
//      proprio evento. O contrato da rota nao mudou (o corpo continua sendo um
//      array); o que mudou e que o rastro sabe QUAL linha mudou e como.
//
// O FILTRO DE SUBTIPO nas tres consultas que atravessam para `producao` e o
// item mais importante desta adaptacao, e ele NAO existe na origem porque la
// nao precisava existir. Um lote do acervo carrega mais de uma linha de
// producao (61 dos 102 lotes com versao, medido em 2026-08-09: a carta e o CDGV
// no mesmo lote, ocupando o MESMO poligono). Sem comparar
// `linha_producao.subtipo_produto_id` com `versao.subtipo_produto_id`, a
// unidade de trabalho da carta reivindicaria a versao do CDGV, e a linhagem do
// XML sairia com as fases do produto errado sem levantar erro nenhum. E a mesma
// guarda que `docs/decisoes.md` prescreve para o gatilho de
// `producao.relacionamento_versao`, e pela mesma razao.

const fs = require('fs')
const path = require('path')

const { db } = require('../database')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const {
  SUBTIPO_PRODUTO,
  TIPO_ESCALA,
  TIPO_FASE,
  TIPO_DADO_PRODUCAO,
  SITUACAO_ATIVIDADE
} = require('../utils/domain_constants')

const controller = {}

// --- Erros do banco que viram resposta amigavel ------------------------------

const FK_VIOLATION = '23503'
const CHECK_VIOLATION = '23514'
const UNIQUE_VIOLATION = '23505'

// O 500 cru cita o nome da restricao ('informacoes_produto_xor_lote'), que nao
// diz nada a quem acabou de digitar. Os tres codigos abaixo sao os unicos que
// uma requisicao bem formada consegue produzir neste modulo:
//
//   23503 - um `versao_id`, `lote_id`, `fase_id`, `organizacao_id`,
//           `usuario_uuid` ou `creditos_id` que nao existe; na EXCLUSAO, alguem
//           ainda aponta o registro
//   23514 - o CHECK do XOR (versao E lote, ou nenhum dos dois). O Joi ja recusa
//           isso na porta; o CHECK pega quem entrar por outra
//   23505 - chave repetida
const MENSAGENS_ERRO = {
  [FK_VIOLATION]:
    'Referência inexistente: confira a versão, o lote, a fase, a organização, o usuário ou o crédito informado. Na exclusão, algum registro ainda aponta para esta linha',
  [CHECK_VIOLATION]:
    'A declaração vale para uma VERSÃO ou para um LOTE, nunca para os dois e nunca para nenhum',
  [UNIQUE_VIOLATION]: 'Já existe um registro com esta chave'
}

const traduzirErro = err => {
  if (!err || !err.code) return err
  const frase = MENSAGENS_ERRO[err.code]
  if (!frase) return err
  return new AppError(frase, httpCode.BadRequest, err)
}

const comTraducao = async promessa => {
  try {
    return await promessa()
  } catch (err) {
    throw traduzirErro(err)
  }
}

// --- CRUD generico -----------------------------------------------------------
//
// ONZE TABELAS DESTE SCHEMA TEM PORTA DE ESCRITA, e as onze escrevem do mesmo
// jeito: um array de linhas, uma transacao, um evento de auditoria por linha.
// Escrever as onze a mao seria 33 funcoes copiadas, e a copia numero 30 e a que
// esquece o `auditoriaCtrl.registrar`.
//
// O NOME DA TABELA E INTERPOLADO NO SQL, e isso e seguro AQUI e so aqui: ele sai
// de `ENTIDADES`, que e codigo deste arquivo, nunca do corpo da requisicao. Os
// VALORES continuam todos parametrizados por nome (`$<coluna>`). A mesma regra
// vale para a lista de colunas.

// `quadro_fases` e JSON: sem o `:json` o objeto sairia como '[object Object]'.
const MODIFICADOR = { quadro_fases: ':json' }

// AS TRES COLUNAS DE ARRAY PRECISAM DE CAST, e o motivo e a LISTA VAZIA. O
// pg-promise formata `[]` como `array[]`, e o Postgres recusa com "cannot
// determine type of empty array": ele nao tem como saber que aquilo e `text[]`.
// `dados_terceiro: []` e entrada comum (a maioria das folhas nao usa dado de
// terceiro), entao sem o cast a rota falharia justamente no caso normal.
const CAST = {
  dados_terceiro: '::text[]',
  observacoes: '::text[]',
  classes: '::text[]'
}

const referencia = coluna =>
  `$<${coluna}${MODIFICADOR[coluna] || ''}>${CAST[coluna] || ''}`

// O DEFAULT DA COLUNA, aplicado AQUI e nao pelo banco. `dpi` e
// `INTEGER NOT NULL DEFAULT 300`, e o INSERT deste modulo lista TODAS as
// colunas: um corpo que omite o DPI mandaria null explicito, e o default do
// banco so vale para a coluna AUSENTE da lista. O null bateria na restricao de
// nao nulo, e o operador receberia um erro de banco onde ele apenas nao quis
// mexer no DPI.
const PADRAO = { dpi: 300 }

/**
 * O opcional AUSENTE vira null (ou o default da coluna) antes da consulta.
 *
 * Sem isto, um corpo valido que omita `lote_id` (porque mandou `versao_id`)
 * derruba o pg-promise com "Property doesn't exist", que chega como 500 onde
 * nao houve erro nenhum.
 */
const normaliza = (colunas, dados) => {
  const saida = {}
  for (const coluna of colunas) {
    const valor = dados[coluna]
    saida[coluna] = valor === undefined || valor === null
      ? (PADRAO[coluna] !== undefined ? PADRAO[coluna] : null)
      : valor
  }
  return saida
}

const criarLinhas = async (entidade, linhas, usuarioUuid, contexto) => {
  const { tabela, colunas } = entidade

  return comTraducao(() =>
    db.conn.tx(async t => {
      const criados = []

      for (const linha of linhas) {
        const criado = await t.one(
          `INSERT INTO ${tabela} (${colunas.join(', ')})
           VALUES (${colunas.map(referencia).join(', ')})
           RETURNING *`,
          normaliza(colunas, linha)
        )

        await auditoriaCtrl.registrar(t, {
          tabela,
          registroId: criado[entidade.chave || 'id'],
          operacao: 'I',
          depois: criado,
          usuarioUuid,
          contexto
        })

        criados.push({ id: criado[entidade.chave || 'id'] })
      }

      return criados
    })
  )
}

const atualizarLinhas = async (entidade, linhas, usuarioUuid, contexto) => {
  const { tabela, colunas, nome } = entidade
  const chave = entidade.chave || 'id'

  return comTraducao(() =>
    db.conn.tx(async t => {
      for (const linha of linhas) {
        // `lerAntes` faz as DUAS coisas numa consulta: guarda o estado anterior
        // para o rastro e lanca o 404 quando o registro nao existe. E o que
        // substitui o `SELECT id ... WHERE id in (...)` da origem, que existia
        // so para produzir a mensagem de "nao corresponde".
        const antes = await auditoriaCtrl.lerAntes(t, tabela, linha[chave], nome, chave)

        const depois = await t.one(
          `UPDATE ${tabela}
              SET ${colunas.map(c => `${c} = ${referencia(c)}`).join(', ')}
            WHERE ${chave} = $<${chave}>
            RETURNING *`,
          { ...normaliza(colunas, linha), [chave]: linha[chave] }
        )

        await auditoriaCtrl.registrar(t, {
          tabela,
          registroId: linha[chave],
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto
        })
      }
    })
  )
}

const apagarLinhas = async (entidade, ids, usuarioUuid, contexto) => {
  const { tabela, nome } = entidade
  const chave = entidade.chave || 'id'

  return comTraducao(() =>
    db.conn.tx(async t => {
      for (const id of ids) {
        const antes = await auditoriaCtrl.lerAntes(t, tabela, id, nome, chave)

        await t.none(`DELETE FROM ${tabela} WHERE ${chave} = $<id>`, { id })

        await auditoriaCtrl.registrar(t, {
          tabela,
          registroId: id,
          operacao: 'D',
          antes,
          usuarioUuid,
          contexto
        })
      }
    })
  )
}

// As onze tabelas com porta de escrita. `nome` e como o 404 chama o registro.
const ENTIDADES = {
  organizacao: {
    tabela: 'metadado.organizacao',
    nome: 'Organização',
    // A UNICA com chave que nao se chama `id`: a organizacao e dominio semeado,
    // e o `code` dela e o valor que `informacoes_produto` aponta.
    chave: 'code',
    colunas: ['nome', 'sigla', 'endereco', 'telefone', 'site']
  },
  usuario: {
    tabela: 'metadado.usuario',
    nome: 'Metadado de usuário',
    colunas: ['usuario_uuid', 'nome', 'funcao', 'organizacao_id']
  },
  informacoesProduto: {
    tabela: 'metadado.informacoes_produto',
    nome: 'Informação do produto',
    colunas: [
      'versao_id', 'lote_id', 'resumo', 'proposito', 'creditos',
      'informacoes_complementares', 'limitacao_acesso_id', 'limitacao_uso_id',
      'restricao_uso_id', 'grau_sigilo_id', 'organizacao_responsavel_id',
      'organizacao_distribuicao_id', 'datum_vertical_id', 'especificacao_id',
      'responsavel_produto_id', 'declaracao_linhagem', 'projeto_bdgex'
    ]
  },
  responsavelFaseProduto: {
    tabela: 'metadado.responsavel_fase_produto',
    nome: 'Responsável por fase',
    colunas: ['usuario_id', 'fase_id', 'versao_id', 'lote_id']
  },
  palavraChaveProduto: {
    tabela: 'metadado.palavra_chave_produto',
    nome: 'Palavra-chave do produto',
    colunas: ['nome', 'tipo_palavra_chave_id', 'versao_id']
  },
  creditosQpt: {
    tabela: 'metadado.creditos_qpt',
    nome: 'Crédito QPT',
    colunas: ['nome', 'qpt']
  },
  informacoesEdicao: {
    tabela: 'metadado.informacoes_edicao',
    nome: 'Informação de edição',
    colunas: [
      'versao_id', 'lote_id', 'pec_planimetrico', 'pec_altimetrico',
      'origem_dados_altimetricos', 'territorio_internacional', 'acesso_restrito',
      'carta_militar', 'data_criacao', 'creditos_id', 'epsg_mde', 'caminho_mde',
      'dados_terceiro', 'quadro_fases', 'tipo_produto', 'versao_produto',
      'licenca_produto', 'observacoes', 'dpi'
    ]
  },
  imagensCartaOrtoimagem: {
    tabela: 'metadado.imagens_carta_ortoimagem',
    nome: 'Imagem da carta ortoimagem',
    colunas: ['versao_id', 'lote_id', 'caminho_imagem', 'caminho_estilo', 'epsg']
  },
  classesComplementaresOrto: {
    tabela: 'metadado.classes_complementares_orto',
    nome: 'Lista de classes complementares',
    colunas: ['nome', 'classes']
  },
  perfilClassesComplementaresOrto: {
    tabela: 'metadado.perfil_classes_complementares_orto',
    nome: 'Perfil de classes complementares',
    colunas: ['versao_id', 'lote_id', 'classes_complementares_orto_id']
  },
  sensorCartaOrtoimagem: {
    tabela: 'metadado.sensor_carta_ortoimagem',
    nome: 'Sensor da carta ortoimagem',
    colunas: [
      'versao_id', 'lote_id', 'tipo', 'plataforma', 'nome', 'resolucao',
      'bandas', 'nivel_produto'
    ]
  }
}

// --- Dominios da norma -------------------------------------------------------
//
// O `nome` destas cinco NAO e texto de interface: ele sai LITERAL para dentro do
// XML, onde a ISO19115 espera 'ultraSecreto', 'intellectualPropertyRights' e
// 'otherRestrictions' exatamente assim. Nada aqui traduz nem acentua.

controller.listarTipoPalavraChave = async () =>
  db.conn.any('SELECT code, nome FROM metadado.tipo_palavra_chave ORDER BY code')

controller.listarEspecificacao = async () =>
  db.conn.any('SELECT code, nome FROM metadado.especificacao ORDER BY code')

controller.listarDatumVertical = async () =>
  db.conn.any('SELECT code, nome FROM metadado.datum_vertical ORDER BY code')

controller.listarCodigoRestricao = async () =>
  db.conn.any('SELECT code, nome FROM metadado.codigo_restricao ORDER BY code')

controller.listarCodigoClassificacao = async () =>
  db.conn.any('SELECT code, nome FROM metadado.codigo_classificacao ORDER BY code')

// --- Organizacao -------------------------------------------------------------

controller.listarOrganizacao = async () =>
  db.conn.any(
    'SELECT code, nome, sigla, endereco, telefone, site FROM metadado.organizacao ORDER BY code'
  )

controller.atualizarOrganizacao = async (organizacoes, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.organizacao, organizacoes, usuarioUuid, contexto)

// --- Usuario do metadado -----------------------------------------------------

controller.listarUsuario = async () =>
  db.conn.any(
    `SELECT u.id, u.usuario_uuid, u.nome, u.funcao, u.organizacao_id,
            o.nome AS organizacao, o.sigla AS organizacao_sigla,
            -- O nome DA CONTA sai junto e nao substitui o nome da assinatura:
            -- aquele e o nome completo que vai impresso, este e quem entra no
            -- sistema. Os dois na mesma linha e o que deixa a tela mostrar a
            -- divergencia. (Sem crase neste comentario: template literal.)
            du.nome AS usuario_nome, du.nome_guerra AS usuario_nome_guerra
       FROM metadado.usuario AS u
      INNER JOIN metadado.organizacao AS o ON o.code = u.organizacao_id
       LEFT JOIN dgeo.usuario AS du ON du.uuid = u.usuario_uuid
      ORDER BY u.nome`
  )

controller.criarUsuario = async (usuario, usuarioUuid, contexto) =>
  criarLinhas(ENTIDADES.usuario, usuario, usuarioUuid, contexto)

controller.atualizarUsuario = async (usuario, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.usuario, usuario, usuarioUuid, contexto)

controller.apagarUsuario = async (ids, usuarioUuid, contexto) =>
  apagarLinhas(ENTIDADES.usuario, ids, usuarioUuid, contexto)

// --- O que identifica a versao e o lote nas listagens ------------------------

// A ESCALA E DA FOLHA, e mora em `acervo.produto.tipo_escala_id`. O SAP tinha um
// `denominador_escala` inteiro na propria tabela de produto; aqui o numero se
// obtem do dominio ('1:25.000' -> 25000), e a escala personalizada (code 5)
// traz o denominador na coluna propria. O `split_part` evita o CASE com quatro
// numeros magicos, e continua valendo se uma escala nova entrar no dominio.
const SQL_DENOMINADOR_ESCALA = `
  CASE WHEN p.tipo_escala_id = ${TIPO_ESCALA.ESCALA_PERSONALIZADA}
       THEN p.denominador_escala_especial
       ELSE NULLIF(replace(split_part(te.nome, ':', 2), '.', ''), '')::integer
  END`

// A identidade da VERSAO para quem le a lista e para quem gera a saida.
// `edicao` e `acervo.versao.versao`: o SAP guardava a edicao numa coluna propria
// do produto, e aqui ela E a versao.
const COLUNAS_VERSAO = `
         v.id, v.uuid_versao, v.versao AS edicao, v.lote_id,
         v.subtipo_produto_id,
         COALESCE(v.nome, p.nome) AS nome,
         p.mi, p.inom,
         ${SQL_DENOMINADOR_ESCALA} AS denominador_escala`

const DE_VERSAO = `
    FROM acervo.versao AS v
   INNER JOIN acervo.produto AS p ON p.id = v.produto_id
   INNER JOIN dominio.tipo_escala AS te ON te.code = p.tipo_escala_id`

const SELECT_VERSAO = `SELECT ${COLUNAS_VERSAO} ${DE_VERSAO}`

// --- Informacoes do produto --------------------------------------------------

controller.listarInformacoesProduto = async () =>
  db.conn.any(
    `SELECT ip.id, ip.versao_id, ip.lote_id, ip.resumo, ip.proposito, ip.creditos,
            ip.informacoes_complementares, ip.declaracao_linhagem, ip.projeto_bdgex,
            ip.limitacao_acesso_id, cr1.nome AS limitacao_acesso,
            ip.limitacao_uso_id, cr2.nome AS limitacao_uso,
            ip.restricao_uso_id, cr3.nome AS restricao_uso,
            ip.grau_sigilo_id, cc.nome AS grau_sigilo,
            ip.organizacao_responsavel_id, o1.nome AS organizacao_responsavel,
            ip.organizacao_distribuicao_id, o2.nome AS organizacao_distribuicao,
            ip.datum_vertical_id, dv.nome AS datum_vertical,
            ip.especificacao_id, e.nome AS especificacao,
            ip.responsavel_produto_id, u.nome AS responsavel_produto,
            ve.uuid_versao, ve.nome AS versao_nome, ve.edicao, ve.mi, ve.inom,
            l.nome AS lote
       FROM metadado.informacoes_produto AS ip
      INNER JOIN metadado.codigo_restricao AS cr1 ON cr1.code = ip.limitacao_acesso_id
      INNER JOIN metadado.codigo_restricao AS cr2 ON cr2.code = ip.limitacao_uso_id
      INNER JOIN metadado.codigo_restricao AS cr3 ON cr3.code = ip.restricao_uso_id
      INNER JOIN metadado.codigo_classificacao AS cc ON cc.code = ip.grau_sigilo_id
      INNER JOIN metadado.organizacao AS o1 ON o1.code = ip.organizacao_responsavel_id
      INNER JOIN metadado.organizacao AS o2 ON o2.code = ip.organizacao_distribuicao_id
      INNER JOIN metadado.datum_vertical AS dv ON dv.code = ip.datum_vertical_id
      INNER JOIN metadado.especificacao AS e ON e.code = ip.especificacao_id
      INNER JOIN metadado.usuario AS u ON u.id = ip.responsavel_produto_id
       LEFT JOIN (${SELECT_VERSAO}) AS ve ON ve.id = ip.versao_id
       LEFT JOIN acervo.lote AS l ON l.id = ip.lote_id
      ORDER BY ip.id`
  )

controller.criarInformacoesProduto = async (linhas, usuarioUuid, contexto) =>
  criarLinhas(ENTIDADES.informacoesProduto, linhas, usuarioUuid, contexto)

controller.atualizarInformacoesProduto = async (linhas, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.informacoesProduto, linhas, usuarioUuid, contexto)

controller.apagarInformacoesProduto = async (ids, usuarioUuid, contexto) =>
  apagarLinhas(ENTIDADES.informacoesProduto, ids, usuarioUuid, contexto)

// --- Responsavel por fase ----------------------------------------------------

controller.listarResponsavelFaseProduto = async () =>
  db.conn.any(
    `SELECT rfp.id, rfp.usuario_id, rfp.fase_id, rfp.versao_id, rfp.lote_id,
            u.nome, u.funcao,
            f.tipo_fase_id, tf.nome AS tipo_fase,
            f.linha_producao_id, lp.nome AS linha_producao,
            lp.subtipo_produto_id AS linha_subtipo_produto_id,
            ve.uuid_versao, ve.nome AS versao_nome, ve.edicao, ve.mi, ve.inom,
            ve.denominador_escala, ve.subtipo_produto_id,
            sp.nome AS subtipo_produto,
            l.nome AS lote, l.projeto_id, proj.nome AS projeto
       FROM metadado.responsavel_fase_produto AS rfp
      INNER JOIN metadado.usuario AS u ON u.id = rfp.usuario_id
      INNER JOIN producao.fase AS f ON f.id = rfp.fase_id
      INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
      INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
       LEFT JOIN (${SELECT_VERSAO}) AS ve ON ve.id = rfp.versao_id
       LEFT JOIN dominio.subtipo_produto AS sp ON sp.code = ve.subtipo_produto_id
       LEFT JOIN acervo.lote AS l ON l.id = rfp.lote_id
       LEFT JOIN acervo.projeto AS proj ON proj.id = l.projeto_id
      ORDER BY rfp.id`
  )

controller.criarResponsavelFaseProduto = async (linhas, usuarioUuid, contexto) =>
  criarLinhas(ENTIDADES.responsavelFaseProduto, linhas, usuarioUuid, contexto)

controller.atualizarResponsavelFaseProduto = async (linhas, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.responsavelFaseProduto, linhas, usuarioUuid, contexto)

controller.apagarResponsavelFaseProduto = async (ids, usuarioUuid, contexto) =>
  apagarLinhas(ENTIDADES.responsavelFaseProduto, ids, usuarioUuid, contexto)

// --- Palavra-chave -----------------------------------------------------------

controller.listarPalavraChaveProduto = async () =>
  db.conn.any(
    `SELECT pcp.id, pcp.nome, pcp.tipo_palavra_chave_id,
            tpk.nome AS tipo_palavra_chave, pcp.versao_id,
            ve.uuid_versao, ve.nome AS versao_nome, ve.edicao, ve.mi, ve.inom
       FROM metadado.palavra_chave_produto AS pcp
      INNER JOIN metadado.tipo_palavra_chave AS tpk ON tpk.code = pcp.tipo_palavra_chave_id
       LEFT JOIN (${SELECT_VERSAO}) AS ve ON ve.id = pcp.versao_id
      ORDER BY pcp.id`
  )

controller.criarPalavraChaveProduto = async (linhas, usuarioUuid, contexto) =>
  criarLinhas(ENTIDADES.palavraChaveProduto, linhas, usuarioUuid, contexto)

controller.atualizarPalavraChaveProduto = async (linhas, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.palavraChaveProduto, linhas, usuarioUuid, contexto)

controller.apagarPalavraChaveProduto = async (ids, usuarioUuid, contexto) =>
  apagarLinhas(ENTIDADES.palavraChaveProduto, ids, usuarioUuid, contexto)

// --- Creditos QPT ------------------------------------------------------------

controller.listarCreditosQpt = async () =>
  db.conn.any('SELECT id, nome, qpt FROM metadado.creditos_qpt ORDER BY nome')

controller.criarCreditosQpt = async (linhas, usuarioUuid, contexto) =>
  criarLinhas(ENTIDADES.creditosQpt, linhas, usuarioUuid, contexto)

controller.atualizarCreditosQpt = async (linhas, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.creditosQpt, linhas, usuarioUuid, contexto)

controller.apagarCreditosQpt = async (ids, usuarioUuid, contexto) =>
  apagarLinhas(ENTIDADES.creditosQpt, ids, usuarioUuid, contexto)

// --- Informacoes de edicao ---------------------------------------------------

controller.listarInformacoesEdicao = async () =>
  db.conn.any(
    `SELECT ie.id, ie.versao_id, ie.lote_id, ie.pec_planimetrico, ie.pec_altimetrico,
            ie.origem_dados_altimetricos, ie.territorio_internacional,
            ie.acesso_restrito, ie.carta_militar, ie.data_criacao, ie.epsg_mde,
            ie.caminho_mde, ie.dados_terceiro, ie.quadro_fases, ie.tipo_produto,
            ie.versao_produto, ie.licenca_produto, ie.observacoes, ie.dpi,
            ie.creditos_id, cq.nome AS nome_creditos_qpt, cq.qpt AS creditos_qpt,
            ve.uuid_versao, ve.nome AS versao_nome, ve.edicao, ve.mi, ve.inom,
            ve.denominador_escala, l.nome AS lote
       FROM metadado.informacoes_edicao AS ie
       LEFT JOIN metadado.creditos_qpt AS cq ON cq.id = ie.creditos_id
       LEFT JOIN (${SELECT_VERSAO}) AS ve ON ve.id = ie.versao_id
       LEFT JOIN acervo.lote AS l ON l.id = ie.lote_id
      ORDER BY ie.id`
  )

controller.criarInformacoesEdicao = async (linhas, usuarioUuid, contexto) =>
  criarLinhas(ENTIDADES.informacoesEdicao, linhas, usuarioUuid, contexto)

controller.atualizarInformacoesEdicao = async (linhas, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.informacoesEdicao, linhas, usuarioUuid, contexto)

controller.apagarInformacoesEdicao = async (ids, usuarioUuid, contexto) =>
  apagarLinhas(ENTIDADES.informacoesEdicao, ids, usuarioUuid, contexto)

// --- Imagens da carta ortoimagem ---------------------------------------------

controller.listarImagensCartaOrtoimagem = async () =>
  db.conn.any(
    `SELECT ico.id, ico.versao_id, ico.lote_id, ico.caminho_imagem,
            ico.caminho_estilo, ico.epsg,
            ve.uuid_versao, ve.nome AS versao_nome, ve.edicao, ve.mi, ve.inom,
            l.nome AS lote
       FROM metadado.imagens_carta_ortoimagem AS ico
       LEFT JOIN (${SELECT_VERSAO}) AS ve ON ve.id = ico.versao_id
       LEFT JOIN acervo.lote AS l ON l.id = ico.lote_id
      ORDER BY ico.id`
  )

controller.criarImagensCartaOrtoimagem = async (linhas, usuarioUuid, contexto) =>
  criarLinhas(ENTIDADES.imagensCartaOrtoimagem, linhas, usuarioUuid, contexto)

controller.atualizarImagensCartaOrtoimagem = async (linhas, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.imagensCartaOrtoimagem, linhas, usuarioUuid, contexto)

controller.apagarImagensCartaOrtoimagem = async (ids, usuarioUuid, contexto) =>
  apagarLinhas(ENTIDADES.imagensCartaOrtoimagem, ids, usuarioUuid, contexto)

// --- Classes complementares --------------------------------------------------

controller.listarClassesComplementaresOrto = async () =>
  db.conn.any('SELECT id, nome, classes FROM metadado.classes_complementares_orto ORDER BY nome')

controller.criarClassesComplementaresOrto = async (linhas, usuarioUuid, contexto) =>
  criarLinhas(ENTIDADES.classesComplementaresOrto, linhas, usuarioUuid, contexto)

controller.atualizarClassesComplementaresOrto = async (linhas, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.classesComplementaresOrto, linhas, usuarioUuid, contexto)

controller.apagarClassesComplementaresOrto = async (ids, usuarioUuid, contexto) =>
  apagarLinhas(ENTIDADES.classesComplementaresOrto, ids, usuarioUuid, contexto)

// --- Perfil de classes complementares ----------------------------------------

controller.listarPerfilClassesComplementaresOrto = async () =>
  db.conn.any(
    `SELECT pcco.id, pcco.versao_id, pcco.lote_id, pcco.classes_complementares_orto_id,
            cco.nome, cco.classes,
            ve.uuid_versao, ve.nome AS versao_nome, ve.edicao, ve.mi, ve.inom,
            l.nome AS lote
       FROM metadado.perfil_classes_complementares_orto AS pcco
      INNER JOIN metadado.classes_complementares_orto AS cco
         ON cco.id = pcco.classes_complementares_orto_id
       LEFT JOIN (${SELECT_VERSAO}) AS ve ON ve.id = pcco.versao_id
       LEFT JOIN acervo.lote AS l ON l.id = pcco.lote_id
      ORDER BY pcco.id`
  )

controller.criarPerfilClassesComplementaresOrto = async (linhas, usuarioUuid, contexto) =>
  criarLinhas(ENTIDADES.perfilClassesComplementaresOrto, linhas, usuarioUuid, contexto)

controller.atualizarPerfilClassesComplementaresOrto = async (linhas, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.perfilClassesComplementaresOrto, linhas, usuarioUuid, contexto)

controller.apagarPerfilClassesComplementaresOrto = async (ids, usuarioUuid, contexto) =>
  apagarLinhas(ENTIDADES.perfilClassesComplementaresOrto, ids, usuarioUuid, contexto)

// --- Sensores da carta ortoimagem --------------------------------------------

controller.listarSensorCartaOrtoimagem = async () =>
  db.conn.any(
    `SELECT sco.id, sco.versao_id, sco.lote_id, sco.tipo, sco.plataforma, sco.nome,
            sco.resolucao, sco.bandas, sco.nivel_produto,
            ve.uuid_versao, ve.nome AS versao_nome, ve.edicao, ve.mi, ve.inom,
            l.nome AS lote
       FROM metadado.sensor_carta_ortoimagem AS sco
       LEFT JOIN (${SELECT_VERSAO}) AS ve ON ve.id = sco.versao_id
       LEFT JOIN acervo.lote AS l ON l.id = sco.lote_id
      ORDER BY sco.id`
  )

controller.criarSensorCartaOrtoimagem = async (linhas, usuarioUuid, contexto) =>
  criarLinhas(ENTIDADES.sensorCartaOrtoimagem, linhas, usuarioUuid, contexto)

controller.atualizarSensorCartaOrtoimagem = async (linhas, usuarioUuid, contexto) =>
  atualizarLinhas(ENTIDADES.sensorCartaOrtoimagem, linhas, usuarioUuid, contexto)

controller.apagarSensorCartaOrtoimagem = async (ids, usuarioUuid, contexto) =>
  apagarLinhas(ENTIDADES.sensorCartaOrtoimagem, ids, usuarioUuid, contexto)

// =============================================================================
// A SAIDA: o JSON de edicao e o XML de metadado
// =============================================================================

// `dominio.subtipo_produto` -> nome do tipo_produto que o plugin de edicao
// espera. Nao ha default: subtipo fora do mapa fica indefinido de PROPOSITO, e o
// validador acusa, em vez de sair 'Carta Topográfica' silenciosamente errado.
const TIPO_PRODUTO_PLUGIN = {
  [SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_T34_700]: 'Carta Topográfica',
  [SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM]: 'Carta Ortoimagem',
  [SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_ET_RDG]: 'Carta Topográfica',
  [SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM_SARP]: 'Carta Ortoimagem OM'
}

const SUBTIPOS_ORTO = [
  SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM,
  SUBTIPO_PRODUTO.ORTOIMAGEM,
  SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM_SARP,
  SUBTIPO_PRODUTO.CDGV_ORTOIMAGEM_ET_EDGV_30
]

// Template de XML por subtipo. Cada VERSAO gera UM XML, pelo subtipo dela: carta
// topografica -> topo; carta ortoimagem -> orto; CDGV vetorial -> vetor. O CDGV
// e uma versao separada, com uuid proprio, e nao se deriva da carta.
const XML_KIND_POR_SUBTIPO = {
  [SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_T34_700]: 'topo',
  [SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_ET_RDG]: 'topo',
  [SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM]: 'orto',
  [SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM_SARP]: 'orto',
  [SUBTIPO_PRODUTO.CDGV_ET_EDGV_213]: 'vetor',
  [SUBTIPO_PRODUTO.CDGV_ET_EDGV_30]: 'vetor',
  [SUBTIPO_PRODUTO.CDGV_MGCP]: 'vetor',
  [SUBTIPO_PRODUTO.CDGV_MUVD]: 'vetor',
  [SUBTIPO_PRODUTO.CDGV_ORTOIMAGEM_ET_EDGV_30]: 'vetor',
  [SUBTIPO_PRODUTO.CDGV_TRAFEGABILIDADE]: 'vetor'
}

const resolveTipoVersao = (infoEdicao, versao) => {
  const ehOrto = SUBTIPOS_ORTO.includes(versao.subtipo_produto_id)
  const ehSarp = versao.subtipo_produto_id === SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM_SARP

  let tipo = infoEdicao.tipo_produto
  if (!tipo) {
    const base = TIPO_PRODUTO_PLUGIN[versao.subtipo_produto_id]
    if (base) {
      tipo = (infoEdicao.carta_militar && !ehSarp)
        ? (ehOrto ? 'Carta Ortoimagem Militar' : 'Carta Topográfica Militar')
        : base
    }
  }

  let versaoProduto = infoEdicao.versao_produto
  if (!versaoProduto) versaoProduto = ehSarp ? '1.0' : (ehOrto ? '3.0' : '2.0')

  return { tipo, versao: versaoProduto, ehOrto, ehSarp }
}

// REGRA DE CONTAMINACAO DE LICENCA (decisao do chefe, herdada do SAP):
// FABDEM/FathomDEM sao nao comerciais e OBRIGAM CC-BY-NC-SA, mesmo que um valor
// comercial tenha sido gravado por engano em `licenca_produto`.
const resolveLicenca = infoEdicao => {
  const origem = infoEdicao.origem_dados_altimetricos || ''
  if (/FABDEM|FathomDEM/i.test(origem)) return 'CC-BY-NC-SA 4.0'
  return infoEdicao.licenca_produto || 'CC-BY-SA 4.0'
}

const LICENCAS_VALIDAS = ['CC-BY-SA 4.0', 'CC-BY-NC-SA 4.0']
const TIPOS_VALIDOS = [
  'Carta Topográfica', 'Carta Ortoimagem', 'Carta Ortoimagem OM',
  'Carta Topográfica Militar', 'Carta Ortoimagem Militar'
]

// PORTA DE QA: as mesmas obrigatorias que o plugin de edicao confere. Ela NAO
// derruba a resposta: devolve a lista de problemas junto do JSON, para a tela
// mostrar o que falta preencher em vez de um erro sem endereco.
const validarJsonEdicao = json => {
  const erros = []

  if (!json.tipo_produto || !TIPOS_VALIDOS.includes(json.tipo_produto)) {
    erros.push('tipo_produto ausente ou fora dos valores aceitos pelo plugin')
  }
  if (!json.versao_produto) erros.push('versao_produto ausente')
  if (!json.nome) erros.push('nome ausente')
  if (!json.inom && !json.center) erros.push('inom (ou center, na carta não-SCN) ausente')
  if (json.licenca_produto && !LICENCAS_VALIDAS.includes(json.licenca_produto)) {
    erros.push('licenca_produto fora dos valores aceitos (CC-BY-SA 4.0 / CC-BY-NC-SA 4.0)')
  }
  if (!json.banco || !json.banco.servidor || !json.banco.porta || !json.banco.nome) {
    erros.push('banco de edição (servidor/porta/nome) não resolvido a partir das unidades de trabalho da fase de Edição')
  }

  const mde = json.mde_diagrama_elevacao || {}
  if (!mde.caminho_mde || !mde.epsg) erros.push('mde_diagrama_elevacao (caminho_mde/epsg) incompleto')
  if (mde.caminho_mde && /\s/.test(mde.caminho_mde)) {
    erros.push('caminho_mde contém espaço (a exportação falha)')
  }
  if (mde.caminho_mde && mde.caminho_mde[0] === '\\' && mde.caminho_mde[1] !== '\\') {
    erros.push('caminho_mde é caminho de rede quebrado (uma barra invertida inicial em vez de duas; a exportação falha)')
  }

  if (!Array.isArray(json.fases) || json.fases.length === 0) erros.push('fases ausente (quadro_fases)')

  const it = json.info_tecnica || {}
  for (const k of ['data_criacao', 'pec_planimetrico', 'pec_altimetrico', 'datum_vertical', 'origem_dados_altimetricos']) {
    if (!it[k]) erros.push(`info_tecnica.${k} ausente`)
  }
  if (!Array.isArray(it.dados_terceiros)) erros.push('info_tecnica.dados_terceiros ausente')

  const ehOrto = /Ortoimagem/.test(json.tipo_produto || '') && !/OM/.test(json.tipo_produto || '')
  if (ehOrto) {
    if (!Array.isArray(json.imagens) || !json.imagens.length) erros.push('imagens ausente (carta ortoimagem)')
    if (!Array.isArray(json.sensores) || !json.sensores.length) erros.push('sensores ausente (carta ortoimagem)')
  }

  return erros
}

// CONSERTA CAMINHO DE REDE QUEBRADO: o que veio com UMA barra invertida inicial
// em vez de DUAS. O plugin de exportacao le a barra unica como relativa a raiz do
// volume atual (inexistente) e o diagrama de elevacao falha, derrubando a folha
// inteira sem PDF. So mexe NESSE caso: caminho de rede valido, caminho com letra
// de unidade e caminho POSIX ficam intactos; nulo e vazio idem.
const normalizaCaminhoRede = p => {
  if (typeof p !== 'string' || p.length === 0) return p
  if (p[0] === '\\' && p[1] !== '\\') return '\\' + p
  return p
}

const escapeXml = s =>
  String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

const fmtEscala = n => String(n).replace(/\B(?=(\d{3})+(?!\d))/g, '.')

// Aceita Date (timestamp do pg) ou DD/MM/AAAA e devolve AAAA-MM-DD (gco:Date).
// Usa os componentes de data LOCAIS, e nao `toISOString`: aquele e UTC e rolaria
// o dia para tras em atividade concluida a noite no fuso de Brasilia.
const pad2 = n => String(n).padStart(2, '0')
const isoData = v => {
  if (!v) return ''
  if (v instanceof Date) return `${v.getFullYear()}-${pad2(v.getMonth() + 1)}-${pad2(v.getDate())}`
  const m = String(v).match(/^(\d{2})\/(\d{2})\/(\d{4})$/)
  if (m) return `${m[3]}-${m[2]}-${m[1]}`
  return String(v).slice(0, 10)
}

// --- A travessia para `producao` ---------------------------------------------
//
// AS TRES CONSULTAS ABAIXO SAO AS UNICAS QUE SAEM DO SCHEMA `metadado`, e as
// tres carregam o MESMO filtro de subtipo, explicado no cabecalho: sem ele a
// unidade de trabalho da carta reivindica a versao do CDGV, porque as duas
// ocupam o mesmo poligono dentro do mesmo lote.
const JUNCAO_UNIDADE_TRABALHO = `
  INNER JOIN acervo.produto AS p ON p.id = v.produto_id
  INNER JOIN producao.unidade_trabalho AS ut
     ON ut.lote_id = v.lote_id
    AND ut.geom && p.geom
    AND ST_Relate(ut.geom, p.geom, '2********')
  INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
  INNER JOIN producao.fase AS f ON f.id = s.fase_id
  INNER JOIN producao.linha_producao AS lp
     ON lp.id = f.linha_producao_id
    AND lp.subtipo_produto_id = v.subtipo_produto_id`

// Resolve servidor/porta/nome do banco de Edicao a partir das unidades de
// trabalho da versao. `configuracao_producao` tem o formato servidor:porta/nome.
//
// Prefere a fase de Edicao; se o lote nao a tiver, cai para a fase mais avancada
// que tenha banco de producao, senao o banco sairia vazio em lote que termina
// antes da Edicao.
const resolveBancoEdicao = async (t, versaoId) => {
  const row = await t.oneOrNone(
    `SELECT dp.configuracao_producao
       FROM acervo.versao AS v
       ${JUNCAO_UNIDADE_TRABALHO}
      INNER JOIN producao.dado_producao AS dp ON dp.id = ut.dado_producao_id
      WHERE v.id = $<versaoId>
        AND dp.tipo_dado_producao_id IN ($<postgisComPermissao>, $<postgis>)
        AND dp.configuracao_producao IS NOT NULL
      ORDER BY (f.tipo_fase_id = $<faseEdicao>) DESC, f.ordem DESC
      LIMIT 1`,
    {
      versaoId,
      postgisComPermissao: TIPO_DADO_PRODUCAO.POSTGIS_COM_PERMISSAO,
      postgis: TIPO_DADO_PRODUCAO.POSTGIS,
      faseEdicao: TIPO_FASE.EDICAO
    }
  )

  if (!row || !row.configuracao_producao) return null

  // Analise defensiva: vindo malformado, devolve null (e o validador acusa
  // "banco nao resolvido") em vez de estourar.
  const m = /^([^:]+):(\d+)\/(.+)$/.exec(row.configuracao_producao)
  if (!m) return null

  // Porta como STRING, como nos JSON de producao.
  return { servidor: m[1], porta: m[2], nome: m[3] }
}

// As fases concluidas da versao, com a data real de cada uma.
const fasesConcluidas = async (t, versaoId) =>
  t.any(
    `SELECT f.tipo_fase_id, MAX(a.data_fim) AS fim
       FROM acervo.versao AS v
       ${JUNCAO_UNIDADE_TRABALHO}
      INNER JOIN producao.atividade AS a
         ON a.unidade_trabalho_id = ut.id
        AND a.tipo_situacao_atividade_id = $<finalizada>
      WHERE v.id = $<versaoId>
      GROUP BY f.tipo_fase_id, f.ordem
      ORDER BY f.ordem`,
    { versaoId, finalizada: SITUACAO_ATIVIDADE.FINALIZADA }
  )

// --- Busca com queda de nivel ------------------------------------------------
//
// Metadado se declara em DOIS niveis. `lote_id` vale para tudo o que aquele lote
// entregar (o caso comum, e o que evita digitar a mesma ficha 60 vezes);
// `versao_id` vale para UMA edicao e SOBRESCREVE o do lote. As duas funcoes
// abaixo sao o que faz a sobrescrita acontecer.

const buscaUmComQueda = async (t, sqlPorColuna, versaoId, loteId) => {
  let row = await t.oneOrNone(sqlPorColuna('versao_id'), { alvo: versaoId })
  if (!row && loteId != null) row = await t.oneOrNone(sqlPorColuna('lote_id'), { alvo: loteId })
  return row
}

// Semantica do override nas LISTAS (sensores, imagens, classes): o nivel versao
// SUBSTITUI o do lote quando tem ao menos uma linha. Lista vazia na versao
// significa "nao configurado" e herda o lote -- NAO ha como dizer
// "explicitamente nenhum" por versao, e e aceitavel: o caso comum e herdar.
const buscaListaComQueda = async (t, sqlPorColuna, versaoId, loteId) => {
  let rows = await t.any(sqlPorColuna('versao_id'), { alvo: versaoId })
  if ((!rows || !rows.length) && loteId != null) {
    rows = await t.any(sqlPorColuna('lote_id'), { alvo: loteId })
  }
  return rows || []
}

// --- O JSON de edicao --------------------------------------------------------

const montaJsonEdicao = async (t, versao) => {
  if (versao.subtipo_produto_id === SUBTIPO_PRODUTO.CARTA_ORTOIMAGEM_SARP) {
    throw new AppError(
      'Carta Ortoimagem de SARP tem esquema próprio e não exporta sem interface: gere pelo plugin, e não pelo servidor',
      httpCode.BadRequest
    )
  }

  const loteId = versao.lote_id

  const infoEdicao = await buscaUmComQueda(
    t,
    col => `SELECT pec_planimetrico, pec_altimetrico, origem_dados_altimetricos,
                   territorio_internacional, acesso_restrito, carta_militar,
                   data_criacao, epsg_mde, caminho_mde, dados_terceiro,
                   quadro_fases, tipo_produto, versao_produto, licenca_produto,
                   observacoes, dpi
              FROM metadado.informacoes_edicao WHERE ${col} = $<alvo>`,
    versao.id, loteId
  )

  if (!infoEdicao) {
    throw new AppError(
      'Versão ou lote sem metadado.informacoes_edicao cadastrado (preencha por lote ou por versão)',
      httpCode.BadRequest
    )
  }

  const infoProduto = await buscaUmComQueda(
    t,
    col => `SELECT dv.nome AS datum_vertical, e.nome AS especificacao
              FROM metadado.informacoes_produto AS ip
              LEFT JOIN metadado.datum_vertical AS dv ON dv.code = ip.datum_vertical_id
              LEFT JOIN metadado.especificacao AS e ON e.code = ip.especificacao_id
             WHERE ip.${col} = $<alvo>`,
    versao.id, loteId
  )

  const banco = await resolveBancoEdicao(t, versao.id)
  const { tipo, versao: versaoProduto, ehOrto, ehSarp } = resolveTipoVersao(infoEdicao, versao)

  // `quadro_fases` e JSON livre: aceita o array direto ou `{fases: [...]}`.
  let fases = infoEdicao.quadro_fases
  if (fases && !Array.isArray(fases) && Array.isArray(fases.fases)) fases = fases.fases

  const json = {
    tipo_produto: tipo,
    versao_produto: versaoProduto,
    nome: versao.nome || versao.mi || versao.inom,
    edicao_produto: versao.edicao || '1-DSG',
    acesso_restrito: !!infoEdicao.acesso_restrito,
    dpi: infoEdicao.dpi || 300,
    mde_diagrama_elevacao: {
      caminho_mde: normalizaCaminhoRede(infoEdicao.caminho_mde),
      epsg: infoEdicao.epsg_mde
    },
    fases: fases || [],
    banco: banco || {},
    info_tecnica: {
      data_criacao: infoEdicao.data_criacao,
      pec_planimetrico: infoEdicao.pec_planimetrico,
      pec_altimetrico: infoEdicao.pec_altimetrico,
      datum_vertical: infoProduto ? infoProduto.datum_vertical : null,
      origem_dados_altimetricos: infoEdicao.origem_dados_altimetricos,
      dados_terceiros: infoEdicao.dados_terceiro || []
    }
  }

  if (versao.inom) {
    json.inom = versao.inom
  } else if (versao.latitude_centro != null && versao.longitude_centro != null) {
    // A folha nao-SCN nao tem INOM, e o plugin precisa do centro. O SAP tinha
    // `latitude_centro`/`longitude_centro` como colunas do produto; aqui os dois
    // saem do CENTROIDE de `acervo.produto.geom`, que e obrigatoria.
    json.center = { latitude: versao.latitude_centro, longitude: versao.longitude_centro }
    json.escala = versao.denominador_escala
  }

  json.territorio_internacional = !!infoEdicao.territorio_internacional

  if (infoProduto && infoProduto.especificacao) {
    json.info_tecnica.especificacao_representacao = infoProduto.especificacao
  }
  if (Array.isArray(infoEdicao.observacoes) && infoEdicao.observacoes.length) {
    json.info_tecnica.observacoes = infoEdicao.observacoes
  }

  // A licenca sempre fica gravada. Em carta militar o rodape de direitos e fixo
  // e nao mostra o selo, mas o valor continua registrado.
  json.licenca_produto = resolveLicenca(infoEdicao)

  if (ehOrto && !ehSarp) {
    const imagens = await buscaListaComQueda(
      t,
      col => `SELECT caminho_imagem, caminho_estilo, epsg
                FROM metadado.imagens_carta_ortoimagem WHERE ${col} = $<alvo>`,
      versao.id, loteId
    )
    json.imagens = imagens.map(i => {
      const img = { caminho_imagem: normalizaCaminhoRede(i.caminho_imagem), epsg: i.epsg }
      if (i.caminho_estilo) img.caminho_estilo = normalizaCaminhoRede(i.caminho_estilo)
      return img
    })

    json.sensores = await buscaListaComQueda(
      t,
      col => `SELECT tipo, plataforma, nome, resolucao, bandas, nivel_produto
                FROM metadado.sensor_carta_ortoimagem WHERE ${col} = $<alvo>`,
      versao.id, loteId
    )

    const classes = await buscaListaComQueda(
      t,
      col => `SELECT cco.classes
                FROM metadado.perfil_classes_complementares_orto AS pcco
               INNER JOIN metadado.classes_complementares_orto AS cco
                  ON cco.id = pcco.classes_complementares_orto_id
               WHERE pcco.${col} = $<alvo>`,
      versao.id, loteId
    )
    const classesComplementares = classes.flatMap(c => c.classes || [])
    if (classesComplementares.length) json.classes_complementares = classesComplementares
  }

  return { json, erros: validarJsonEdicao(json) }
}

// O SELECT da versao para a saida, com o que so a saida precisa: o CENTRO (a
// folha nao-SCN nao tem INOM, e o plugin pede o centro no lugar) e o RETANGULO
// ENVOLVENTE do XML.
//
// EM 4326, e o acervo guarda 4674. As duas malhas coincidem na pratica, e a
// transformacao explicita e o que impede alguem de ler 4674 como se fosse 4326
// mais adiante. O SAP guardava `latitude_centro`/`longitude_centro` como colunas
// do produto; aqui os dois saem do centroide de `acervo.produto.geom`, que e
// NOT NULL.
const COLUNAS_GEOMETRIA_SAIDA = `
         ST_Y(ST_Centroid(ST_Transform(p.geom, 4326))) AS latitude_centro,
         ST_X(ST_Centroid(ST_Transform(p.geom, 4326))) AS longitude_centro,
         ST_XMin(ST_Transform(p.geom, 4326)) AS bbox_w,
         ST_XMax(ST_Transform(p.geom, 4326)) AS bbox_e,
         ST_YMin(ST_Transform(p.geom, 4326)) AS bbox_s,
         ST_YMax(ST_Transform(p.geom, 4326)) AS bbox_n`

const SELECT_VERSAO_SAIDA =
  `SELECT ${COLUNAS_VERSAO}, ${COLUNAS_GEOMETRIA_SAIDA} ${DE_VERSAO}`

controller.gerarJsonEdicaoVersao = async uuid => {
  return db.conn.task(async t => {
    const versao = await t.oneOrNone(
      `${SELECT_VERSAO_SAIDA} WHERE v.uuid_versao = $<uuid>`,
      { uuid }
    )
    if (!versao) throw new AppError('Versão não encontrada', httpCode.NotFound)
    return montaJsonEdicao(t, versao)
  })
}

controller.gerarJsonEdicaoLote = async loteId => {
  return db.conn.task(async t => {
    const versoes = await t.any(
      `${SELECT_VERSAO_SAIDA} WHERE v.lote_id = $<loteId> ORDER BY p.inom, p.mi, v.nome`,
      { loteId }
    )

    const resultado = []
    for (const versao of versoes) {
      const item = {
        uuid_versao: versao.uuid_versao,
        inom: versao.inom,
        mi: versao.mi,
        nome: versao.nome
      }
      try {
        const { json, erros } = await montaJsonEdicao(t, versao)
        item.json = json
        item.erros = erros
      } catch (e) {
        // UMA folha que falha nao derruba o lote inteiro: o erro dela fica na
        // linha dela, e as outras 59 continuam saindo.
        item.json = null
        item.erros = [e.message]
      }
      resultado.push(item)
    }
    return resultado
  })
}

// --- O XML de metadado (Perfil MGB / ISO 19115-19139) ------------------------
//
// Monta do banco, com a mesma queda lote -> versao do JSON, e reusa os templates
// MGB validados de `xml_templates/` por SUBSTITUICAO de texto. Nao ha motor de
// template porque nao ha o que ele resolveria: os marcadores sao escalares, e os
// dois fragmentos compostos (linhagem e palavras-chave) sao montados aqui.

const XML_TEMPLATE = {
  topo: 'metadados-topo.xml',
  orto: 'metadados-orto.xml',
  vetor: 'metadados-vetor.xml'
}

// Produto nao-SCN (carta ou CDGV especial, fora da articulacao, sem INOM):
// template proprio, com titulo so o NOME e sem identificador SCN (INOM/MI).
const XML_TEMPLATE_ESPECIAL = {
  topo: 'metadados-topo-especial.xml',
  orto: 'metadados-orto-especial.xml',
  vetor: 'metadados-vetor-especial.xml'
}

// Equidistancia da curva de nivel por escala (ET-RDG). A 1:10.000 esta aqui
// porque ha carta urbana e especial nessa escala. Escala nova exige conferir o
// valor na ET-RDG; sem ela mapeada o XML sai com o campo vazio, E O VALIDADOR
// ACUSA -- que e melhor do que um numero plausivel e errado.
const EQUIDISTANCIA_POR_ESCALA = {
  10000: '5', 25000: '10', 50000: '20', 100000: '50', 250000: '100'
}

const RATIONALE_PREPARO_CDG = 'Preparo Conj Dados Geoespaciais - Consiste em definir o Projeto, o tipo do conjunto de dados geoespaciais, o pessoal e meios a serem utilizados (equipamentos, programas, insumos etc.). Neste processo deve-se cadastrar os metadados relativos as feições a serem produzidas, os quais acompanharão a feição por todo o seu ciclo de vida e que serão utilizados como subsídios para a elaboração dos metadados dos futuros produtos elaborados a partir das feições.'

// Etapa de linhagem por FASE. A descricao e CANONICA da norma, e nao o nome da
// fase; fase sem mapeamento (Disseminacao, por exemplo) NAO entra na linhagem.
//
// CHAVEADO PELO CODE de `dominio.tipo_fase`, e a origem chaveava pelo NOME. O
// nome e ROTULO e muda sem aviso; trocar 'Extração' por 'Extração de feições'
// derrubaria a linhagem inteira sem erro nenhum, e a mudanca pareceria inocente.
const LINHAGEM_FASE = {
  [TIPO_FASE.PREPARO]: {
    desc: 'PreparoCDG',
    rationale: RATIONALE_PREPARO_CDG
  },
  [TIPO_FASE.EXTRACAO]: {
    desc: 'DigitalizaçãoTela',
    rationale: 'Digitalizacao Tela Mono - Processo, também, conhecido como Restituição Monoscópica, que consiste em adquirir a geometria de feições do terreno a partir de um imagens orientadas.'
  },
  [TIPO_FASE.VALIDACAO]: {
    desc: 'ValidaçãoQGIS',
    rationale: 'Controle de qualidade direto interno, que tem por finalidade realizar de forma automatizada uma inspeção completa da consistência lógica de um conjunto de dados geoespaciais vetoriais e realizar a correção dos erros verificados.'
  },
  [TIPO_FASE.EDICAO]: {
    desc: 'Edição',
    rationale: 'Consiste na aplicação das representações cartograficas segundo a ET-RDG'
  }
}

// Os seis templates sao lidos do disco UMA vez e reusados: eles nao mudam em
// tempo de execucao, e sao 94 KB somados.
const XML_TEMPLATE_CACHE = {}
const carregarTemplateXml = nome => {
  if (!XML_TEMPLATE_CACHE[nome]) {
    XML_TEMPLATE_CACHE[nome] = fs.readFileSync(
      path.join(__dirname, 'xml_templates', nome), 'utf8'
    )
  }
  return XML_TEMPLATE_CACHE[nome]
}

const montaMetadadoXml = async (t, versao) => {
  const kind = XML_KIND_POR_SUBTIPO[versao.subtipo_produto_id]
  if (!kind) {
    throw new AppError(
      `Subtipo de produto ${versao.subtipo_produto_id} sem template de metadado (não é carta nem CDGV vetorial)`,
      httpCode.BadRequest
    )
  }

  // SCN (tem INOM) usa o template base; nao-SCN usa o `-especial`.
  const templateNome = versao.inom ? XML_TEMPLATE[kind] : XML_TEMPLATE_ESPECIAL[kind]

  const loteId = versao.lote_id

  const infoProduto = await buscaUmComQueda(
    t,
    col => `SELECT ip.projeto_bdgex, dv.nome AS datum_vertical, e.nome AS especificacao,
                   u.nome AS responsavel, cc.nome AS classificacao,
                   org.nome AS org_nome, org.site AS org_site,
                   org.endereco AS org_endereco, org.telefone AS org_telefone
              FROM metadado.informacoes_produto AS ip
              LEFT JOIN metadado.datum_vertical AS dv ON dv.code = ip.datum_vertical_id
              LEFT JOIN metadado.especificacao AS e ON e.code = ip.especificacao_id
              LEFT JOIN metadado.usuario AS u ON u.id = ip.responsavel_produto_id
              LEFT JOIN metadado.codigo_classificacao AS cc ON cc.code = ip.grau_sigilo_id
              LEFT JOIN metadado.organizacao AS org ON org.code = ip.organizacao_responsavel_id
             WHERE ip.${col} = $<alvo>`,
    versao.id, loteId
  )

  const infoEdicao = await buscaUmComQueda(
    t,
    col => `SELECT data_criacao FROM metadado.informacoes_edicao WHERE ${col} = $<alvo>`,
    versao.id, loteId
  )

  const fases = await fasesConcluidas(t, versao.id)

  const hoje = new Date()
  const hojeIso = `${hoje.getFullYear()}-${pad2(hoje.getMonth() + 1)}-${pad2(hoje.getDate())}`

  // A data de edicao real e a maior data de fim entre as fases concluidas.
  const dataEdicao = fases.reduce(
    (maior, f) => (f.fim && (!maior || f.fim > maior) ? f.fim : maior),
    null
  )

  // A ESCALA PODE NAO EXISTIR, e o `String(null)` que saia daqui era pior que a
  // ausencia: `dominio.tipo_escala` tem o code 6 ('Sem escala'), e o
  // `SQL_DENOMINADOR_ESCALA` devolve NULL para ele. O `{{ESCALA}}` dos seis
  // templates mora dentro de `<gco:Integer>`, entao a folha saia com
  // `<gco:Integer>null</gco:Integer>` -- invalido contra o XSD do Perfil MGB --
  // e com o titulo terminando em " - null", sem uma linha em `erros`. Vazio mais
  // aviso e o mesmo desenho da equidistancia nao mapeada: campo em branco que o
  // validador ACUSA, em vez de valor plausivel e errado.
  const escala = versao.denominador_escala
  const nome = versao.nome || versao.mi || versao.inom || ''
  const escalaFmt = escala == null ? '' : fmtEscala(escala)

  // Nas folhas SCN o titulo e "NOME - INOM - escala"; nas nao-SCN e so o NOME,
  // sem o " -  - " com INOM vazio no meio. Sem escala, o titulo para no INOM em
  // vez de arrastar um separador solto.
  const titulo = versao.inom
    ? [nome, versao.inom, escalaFmt].filter(Boolean).join(' - ')
    : nome

  const valores = {
    INOM: versao.inom || '',
    MI: versao.mi || '',
    NOME: nome,
    TITULO: titulo,
    // O fileIdentifier e o `uuid_versao`: o que o XML identifica e a EDICAO, e
    // nao a folha. Duas edicoes da mesma folha sao dois metadados.
    UUID: versao.uuid_versao,
    // individualName no formato do BDGEx: nome em maiusculas seguido de " / ;"
    CHEFE_DGEO: infoProduto && infoProduto.responsavel
      ? `${infoProduto.responsavel.toUpperCase()} / ;`
      : '',
    ORGAO_NOME: (infoProduto && infoProduto.org_nome) || '',
    ORGAO_SITE: (infoProduto && infoProduto.org_site) || '',
    ORGAO_ENDERECO: (infoProduto && infoProduto.org_endereco) || '',
    ORGAO_TELEFONE: (infoProduto && infoProduto.org_telefone) || '',
    ESCALA: escala == null ? '' : String(escala),
    ESCALA_FMT: escalaFmt,
    EQUIDISTANCIA: EQUIDISTANCIA_POR_ESCALA[escala] || '',
    PROJETO: (infoProduto && infoProduto.projeto_bdgex) || '',
    DATUM_VERTICAL: (infoProduto && infoProduto.datum_vertical) || '',
    EDICAO: versao.edicao || '1ª Edição',
    DATA_METADADOS: hojeIso,
    DATA_CRIACAO: infoEdicao && infoEdicao.data_criacao ? isoData(infoEdicao.data_criacao) : hojeIso,
    DATA_EDICAO: dataEdicao ? isoData(dataEdicao) : hojeIso,
    CLASSIFICACAO: (infoProduto && infoProduto.classificacao) || 'ostensivo'
  }

  let xml = carregarTemplateXml(templateNome)
  for (const k of Object.keys(valores)) {
    xml = xml.split(`{{${k}}}`).join(escapeXml(valores[k]))
  }

  // Linhagem: um processStep por fase concluida. Fragmento XML injetado CRU (e
  // por isso cada valor que entra nele passa por `escapeXml` antes).
  const chefeXml = escapeXml(valores.CHEFE_DGEO)
  const orgNomeXml = escapeXml(valores.ORGAO_NOME)
  const orgSiteXml = escapeXml(valores.ORGAO_SITE)

  const linhagemProcesso = fases
    .filter(fr => LINHAGEM_FASE[fr.tipo_fase_id])
    .map(fr => {
      const fmap = LINHAGEM_FASE[fr.tipo_fase_id]
      const data = fr.fim ? isoData(fr.fim) : hojeIso
      return [
        '<gmd:processStep>',
        '\t\t\t\t\t\t<gmd:LI_ProcessStep>',
        '\t\t\t\t\t\t\t<gmd:description>',
        `\t\t\t\t\t\t\t\t<gco:CharacterString>${escapeXml(fmap.desc)}</gco:CharacterString>`,
        '\t\t\t\t\t\t\t</gmd:description>',
        '\t\t\t\t\t\t\t<gmd:rationale>',
        `\t\t\t\t\t\t\t\t<gco:CharacterString>${escapeXml(fmap.rationale)}</gco:CharacterString>`,
        '\t\t\t\t\t\t\t</gmd:rationale>',
        '\t\t\t\t\t\t\t<gmd:dateTime>',
        `\t\t\t\t\t\t\t\t<gco:Date>${data}</gco:Date>`,
        '\t\t\t\t\t\t\t</gmd:dateTime>',
        '\t\t\t\t\t\t\t<gmd:processor>',
        '\t\t\t\t\t\t\t\t<gmd:CI_ResponsibleParty>',
        '\t\t\t\t\t\t\t\t\t<gmd:individualName>',
        `\t\t\t\t\t\t\t\t\t\t<gco:CharacterString>${chefeXml}</gco:CharacterString>`,
        '\t\t\t\t\t\t\t\t\t</gmd:individualName>',
        '\t\t\t\t\t\t\t\t\t<gmd:organisationName>',
        `\t\t\t\t\t\t\t\t\t\t<gco:CharacterString>${orgNomeXml}</gco:CharacterString>`,
        '\t\t\t\t\t\t\t\t\t</gmd:organisationName>',
        '\t\t\t\t\t\t\t\t\t<gmd:positionName>',
        '\t\t\t\t\t\t\t\t\t\t<gco:CharacterString>Chefe DGEO</gco:CharacterString>',
        '\t\t\t\t\t\t\t\t\t</gmd:positionName>',
        '\t\t\t\t\t\t\t\t\t<gmd:contactInfo>',
        '\t\t\t\t\t\t\t\t\t\t<gmd:CI_Contact>',
        '\t\t\t\t\t\t\t\t\t\t\t<gmd:onlineResource>',
        '\t\t\t\t\t\t\t\t\t\t\t\t<gmd:CI_OnlineResource>',
        '\t\t\t\t\t\t\t\t\t\t\t\t\t<gmd:linkage>',
        `\t\t\t\t\t\t\t\t\t\t\t\t\t\t<gco:CharacterString>${orgSiteXml}</gco:CharacterString>`,
        '\t\t\t\t\t\t\t\t\t\t\t\t\t</gmd:linkage>',
        '\t\t\t\t\t\t\t\t\t\t\t\t</gmd:CI_OnlineResource>',
        '\t\t\t\t\t\t\t\t\t\t\t</gmd:onlineResource>',
        '\t\t\t\t\t\t\t\t\t\t</gmd:CI_Contact>',
        '\t\t\t\t\t\t\t\t\t</gmd:contactInfo>',
        '\t\t\t\t\t\t\t\t\t<gmd:role>',
        '\t\t\t\t\t\t\t\t\t\t<gco:CharacterString>contatoDoProcesso</gco:CharacterString>',
        '\t\t\t\t\t\t\t\t\t</gmd:role>',
        '\t\t\t\t\t\t\t\t</gmd:CI_ResponsibleParty>',
        '\t\t\t\t\t\t\t</gmd:processor>',
        '\t\t\t\t\t\t</gmd:LI_ProcessStep>',
        '\t\t\t\t\t</gmd:processStep>'
      ].join('\n')
    })
    .join('\n\t\t\t\t\t')

  xml = xml.split('{{LINHAGEM_PROCESSO}}').join(linhagemProcesso)

  // Palavras-chave (MD_Keywords), agrupadas por tipo. E EXCLUSIVAMENTE de nivel
  // versao (nao ha palavra-chave de lote), e a escolha e MANUAL: nao existe
  // toponimia automatica. Versao sem palavra-chave sai sem descriptiveKeywords.
  const palavrasRows = await t.any(
    `SELECT pcp.nome, tpk.nome AS tipo
       FROM metadado.palavra_chave_produto AS pcp
      INNER JOIN metadado.tipo_palavra_chave AS tpk ON tpk.code = pcp.tipo_palavra_chave_id
      WHERE pcp.versao_id = $<versaoId>`,
    { versaoId: versao.id }
  )

  const blocoKeywords = (kws, tipoKw) => [
    '<gmd:descriptiveKeywords>',
    '\t\t\t\t<gmd:MD_Keywords>',
    kws.map(n => [
      '\t\t\t\t\t<gmd:keyword>',
      `\t\t\t\t\t\t<gco:CharacterString>${escapeXml(n)}</gco:CharacterString>`,
      '\t\t\t\t\t</gmd:keyword>'
    ].join('\n')).join('\n'),
    '\t\t\t\t\t<gmd:type>',
    `\t\t\t\t\t\t<gco:CharacterString>${escapeXml(tipoKw)}</gco:CharacterString>`,
    '\t\t\t\t\t</gmd:type>',
    '\t\t\t\t</gmd:MD_Keywords>',
    '\t\t\t</gmd:descriptiveKeywords>'
  ].join('\n')

  const porTipo = {}
  for (const pc of palavrasRows) {
    if (!porTipo[pc.tipo]) porTipo[pc.tipo] = []
    porTipo[pc.tipo].push(pc.nome)
  }
  const palavrasChave = Object.keys(porTipo)
    .map(tipoKw => blocoKeywords(porTipo[tipoKw], tipoKw))
    .join('\n\t\t\t')

  xml = xml.split('{{PALAVRAS_CHAVE}}').join(palavrasChave)

  // O RETANGULO ENVOLVENTE, e SOMENTE na identificationInfo.
  //
  // ELE NUNCA ENTRAVA ATE 2026-08-09. O codigo daqui recortava a
  // `identificationInfo` e preenchia `<gco:Decimal></gco:Decimal>` vazios dentro
  // de `<gmd:westBoundLongitude>` e irmaos -- mas nos SEIS templates o unico
  // `westBoundLongitude` esta na `dataQualityInfo`, que vem ANTES daquele
  // elemento (orto 160/243, topo 219/302, vetor 212/273). A fatia nao continha
  // bbox nenhum, a substituicao nao casava nada, e a folha saia sem extensao
  // geografica e sem nada em `erros` -- com os quatro `ST_Transform` do SELECT
  // calculados a toa.
  //
  // O QUE OS TEMPLATES TRAZEM DE FATO na identificacao e um `geographicElement`
  // VAZIO: nos dois de orto ele contem um `<gmd:EX_GeographicBoundingBox>` sem
  // filhos, e nos de topo e de vetor nem isso. Por isso o conserto MONTA o
  // elemento em vez de preencher lacuna, e os `.xml` ficam como estao: eles sao
  // byte a byte os do SAP 2.3.5, e a fidelidade e deliberada.
  //
  // O `LI_Source/sourceExtent` DA `dataQualityInfo` CONTINUA EM BRANCO, conforme
  // os XML reais do BDGEx, e e por isso que o recorte por `identificationInfo`
  // permanece: sem ele a montagem acertaria os dois.
  const bbox = [
    ['westBoundLongitude', versao.bbox_w],
    ['eastBoundLongitude', versao.bbox_e],
    ['southBoundLatitude', versao.bbox_s],
    ['northBoundLatitude', versao.bbox_n]
  ]
  // OS QUATRO OU NENHUM: meia extensao geografica e pior que extensao nenhuma,
  // porque um `EX_GeographicBoundingBox` com dois cantos passa pelo validador de
  // forma e descreve uma area errada.
  const temBbox = bbox.every(([, val]) => val != null && Number.isFinite(Number(val)))

  // O RECUO SAI DO PROPRIO TEMPLATE, e nao de uma constante: os seis usam
  // tabulacao e profundidades diferentes, e um bloco desalinhado no meio de um
  // XML de 500 linhas e o que atrapalha quem confere o arquivo a mao.
  const RE_ELEMENTO_GEOGRAFICO =
    /([ \t]*)<gmd:geographicElement>[\s\S]*?<\/gmd:geographicElement>/

  const montaBoundingBox = recuo => {
    const linhas = [
      `${recuo}<gmd:geographicElement>`,
      `${recuo}\t<gmd:EX_GeographicBoundingBox>`
    ]
    for (const [tag, val] of bbox) {
      linhas.push(
        `${recuo}\t\t<gmd:${tag}>`,
        `${recuo}\t\t\t<gco:Decimal>${Number(val)}</gco:Decimal>`,
        `${recuo}\t\t</gmd:${tag}>`
      )
    }
    linhas.push(
      `${recuo}\t</gmd:EX_GeographicBoundingBox>`,
      `${recuo}</gmd:geographicElement>`
    )
    return linhas.join('\n')
  }

  const idIni = xml.indexOf('<gmd:identificationInfo>')
  const idFim = xml.indexOf('</gmd:identificationInfo>')
  let bboxEscrito = false
  if (temBbox && idIni >= 0 && idFim > idIni) {
    const idPart = xml.slice(idIni, idFim)
    const idNovo = idPart.replace(RE_ELEMENTO_GEOGRAFICO, (_casou, recuo) =>
      montaBoundingBox(recuo)
    )
    bboxEscrito = idNovo !== idPart
    xml = xml.slice(0, idIni) + idNovo + xml.slice(idFim)
  }

  const erros = []
  // O SILENCIO ERA METADE DO DEFEITO: sem este aviso, o XML sem extensao
  // geografica sai com `erros` vazio e se le como pronto para publicar.
  if (!bboxEscrito) {
    erros.push(
      'retângulo envolvente não entrou no XML: confira a geometria do produto ' +
      '(acervo.produto.geom) e o elemento geographicElement da identificationInfo do template'
    )
  }
  if (!valores.UUID) erros.push('fileIdentifier (uuid_versao) vazio')
  if (escala == null) {
    // SO O CODE 6 CHEGA AQUI, e por isso a frase nomeia UMA causa e nao duas.
    // A escala personalizada (code 5) nao produz escala nula: o CHECK de
    // `acervo.produto` exige `denominador_escala_especial IS NOT NULL` quando
    // `tipo_escala_id = 5`, e o proibe nos demais. Oferecer "ou a personalizada
    // esta vazia" mandava quem le o erro procurar um estado que o banco recusa.
    erros.push(
      'escala não resolvida (acervo.produto.tipo_escala_id é "Sem escala"): ' +
      'a denominação da escala e a equidistância saem em branco no XML'
    )
  }
  if (!infoProduto) {
    erros.push('versão ou lote sem metadado.informacoes_produto (preencha antes de publicar)')
  }
  if (/<gmd:distance>\s*<gco:Decimal>\s*<\/gco:Decimal>\s*<\/gmd:distance>/.test(xml)) {
    // A FOLHA SEM ESCALA SEMPRE CAI AQUI, e dizer "escala null" seria devolver
    // pelo texto o `String(null)` que este bloco existe para tirar do XML.
    erros.push(
      escala == null
        ? 'equidistância não pode ser resolvida sem escala: o campo de distância da curva ficou vazio'
        : `equidistância não mapeada para a escala ${escala}: o campo de distância da curva ficou vazio (preencher à mão)`
    )
  }
  const restantes = xml.match(/\{\{[A-Z_]+\}\}/g)
  if (restantes) {
    erros.push('marcadores não preenchidos: ' + Array.from(new Set(restantes)).join(', '))
  }
  if (!valores.ORGAO_NOME) {
    erros.push('organização responsável não definida (informacoes_produto.organizacao_responsavel_id)')
  }

  return { xml, erros, kind }
}

controller.gerarMetadadoXmlVersao = async uuid => {
  return db.conn.task(async t => {
    const versao = await t.oneOrNone(
      `${SELECT_VERSAO_SAIDA} WHERE v.uuid_versao = $<uuid>`,
      { uuid }
    )
    if (!versao) throw new AppError('Versão não encontrada', httpCode.NotFound)

    const r = await montaMetadadoXml(t, versao)
    return {
      ...r,
      uuid_versao: versao.uuid_versao,
      inom: versao.inom,
      mi: versao.mi,
      nome: versao.nome
    }
  })
}

controller.gerarMetadadoXmlLote = async loteId => {
  return db.conn.task(async t => {
    const versoes = await t.any(
      `${SELECT_VERSAO_SAIDA} WHERE v.lote_id = $<loteId> ORDER BY p.inom, p.mi, v.nome`,
      { loteId }
    )

    const resultado = []
    for (const versao of versoes) {
      // Pula o que nao e carta nem CDGV: ortoimagem crua e ponto de controle nao
      // publicam XML de metadado.
      if (!XML_KIND_POR_SUBTIPO[versao.subtipo_produto_id]) continue

      const item = {
        uuid_versao: versao.uuid_versao,
        inom: versao.inom,
        mi: versao.mi,
        nome: versao.nome
      }
      try {
        const r = await montaMetadadoXml(t, versao)
        item.kind = r.kind
        item.xml = r.xml
        item.erros = r.erros
      } catch (e) {
        item.kind = XML_KIND_POR_SUBTIPO[versao.subtipo_produto_id] || null
        item.xml = null
        item.erros = [e.message]
      }
      resultado.push(item)
    }
    return resultado
  })
}

// Exposto SO para o teste unitario da logica pura (escape XML, formatacao de
// data e de escala, regra de licenca, derivacao de tipo/versao e a porta de QA).
// Nada aqui toca o banco, e e o que torna esses casos executaveis em `rapido`.
controller._helpers = {
  escapeXml,
  fmtEscala,
  isoData,
  normalizaCaminhoRede,
  resolveLicenca,
  resolveTipoVersao,
  validarJsonEdicao,
  SUBTIPO_PRODUTO,
  XML_KIND_POR_SUBTIPO,
  LINHAGEM_FASE,
  EQUIDISTANCIA_POR_ESCALA
}

module.exports = controller
