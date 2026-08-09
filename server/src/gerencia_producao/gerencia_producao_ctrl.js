'use strict'

// GERENCIA DA PRODUCAO: o que o gerente faz com o trabalho que ja esta em curso.
//
// VEIO DO `server/src/gerencia/` DO SAP 2.3.5, e o prefixo mudou porque
// `/api/gerencia` ja existe aqui, com 14 rotas do ACERVO. Ver o cabecalho de
// `gerencia_producao_route.js` para o que atravessou e o que ficou de fora.
//
// TRES DECISOES DESTE ARQUIVO, e as tres divergem da origem de proposito:
//
// 1. NENHUMA OPERACAO DESLIGA GATILHO. O SAP embrulha pausar, reiniciar, voltar
//    e avancar em `SET LOCAL session_replication_role = 'replica'`, faz o lote
//    inteiro com os gatilhos mudos e depois refaz as views materializadas a mao.
//    Aqui nao: `SET session_replication_role` exige superusuario, e o papel da
//    aplicacao nao e (nem deve ser). Alem do custo de privilegio, aquele modo
//    desliga TAMBEM os gatilhos de chave estrangeira, entao um lote mal formado
//    entraria calado e so apareceria na proxima leitura. Os gatilhos de
//    `er/acompanhamento_producao.sql` atualizam a view a cada linha, o que e
//    mais lento e esta certo; quem precisar do atalho tem `PUT /refresh_views`.
//
// 2. TODA ESCRITA E UMA TRANSACAO COM AUDITORIA DENTRO, e nao um `helpers.insert`
//    em massa. E a regra da casa (`CLAUDE.md`): falhar ao auditar derruba a
//    escrita. O laco por linha custa uma ida a mais ao banco por item e paga a
//    unica coisa que responde "quem furou a fila", que e a pergunta que esta
//    tela produz na pratica. As listas aqui sao de dezenas de linhas, nao de
//    milhares, e `contexto.loteId` agrupa o lote inteiro numa tela so.
//
// 3. O `usuario_id` INTEIRO DO SAP VIROU `usuario_uuid`. Vale para a fila
//    prioritaria, para a habilitacao e para a atividade. Ver `er/producao.sql`.

const { db } = require('../database')

// PELO CAMINHO, E NAO PELO BARRIL. `database/index.js` ainda nao exporta o
// subsistema de permissao do banco de producao; ver o cabecalho de
// `database/conexao_admin.js`.
const permissoesProducao = require('../database/permissoes_producao')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const { SITUACAO_ATIVIDADE, STATUS_EXECUCAO } = require('../utils/domain_constants')

const {
  DB_USER,
  DB_PASSWORD,
  DB_SERVER,
  DB_PORT,
  DB_NAME,
  DB_USER_READONLY,
  DB_PASSWORD_READONLY
} = require('../config')

const controller = {}

// --- Erros do banco que viram resposta amigavel ------------------------------

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'

/**
 * Traduz o erro do PostgreSQL para o 4xx que diz o que fazer.
 *
 * Sem isto o 500 cru cita o nome da restricao (`habilitacao_usuario_uuid_key`),
 * que nao ajuda quem acabou de clicar. Os dois codigos abaixo sao os unicos que
 * um corpo BEM formado consegue produzir neste modulo: o Joi ja cobre forma e
 * tipo, e quem decide se o id existe e a chave estrangeira.
 */
const comTraducao = async (promessa, mensagens) => {
  try {
    return await promessa()
  } catch (err) {
    if (!err || !err.code || !mensagens[err.code]) throw err
    throw new AppError(mensagens[err.code], httpCode.Conflict, err)
  }
}

/**
 * Confere que TODOS os ids pedidos existem, antes de apagar qualquer um.
 *
 * A conferencia e ANTES, e nao um `DELETE ... RETURNING` conferido depois: com o
 * segundo, uma lista de cinco ids em que um esta errado apagaria quatro e ainda
 * responderia erro. Quem chamou nao teria como saber o que sobrou.
 */
const exigirQueExistam = async (t, tabela, ids, nomeAmigavel) => {
  const achados = await t.any(
    `SELECT id FROM ${tabela} WHERE id IN ($<ids:csv>)`,
    { ids }
  )
  if (achados.length < ids.length) {
    const existentes = new Set(achados.map(l => Number(l.id)))
    const faltando = ids.filter(id => !existentes.has(Number(id)))
    throw new AppError(
      `${nomeAmigavel}: id não encontrado (${faltando.join(', ')})`,
      httpCode.BadRequest
    )
  }
}

/**
 * O laco de CRUD em massa que este modulo repete quinze vezes.
 *
 * As telas da gerencia mandam uma LISTA e esperam tudo ou nada: a grade de
 * habilitacoes, a de plugins e a de atalhos sao editaveis celula a celula e
 * salvam de uma vez. Uma transacao por item deixaria metade gravada quando a
 * decima linha reprovasse, e a tela nao tem como dizer qual metade.
 */
const inserirVarios = async (t, { tabela, colunas, linhas, usuarioUuid, contexto, autoria }) => {
  const nomes = autoria ? [...colunas, 'usuario_cadastramento_uuid'] : colunas
  const valores = nomes.map(c => `$<${c}>`).join(', ')
  const criados = []

  for (const linha of linhas) {
    const dados = {}
    for (const coluna of colunas) {
      dados[coluna] = linha[coluna] !== undefined ? linha[coluna] : null
    }
    if (autoria) dados.usuario_cadastramento_uuid = usuarioUuid

    const criado = await t.one(
      `INSERT INTO ${tabela} (${nomes.join(', ')}) VALUES (${valores}) RETURNING *`,
      dados
    )

    await auditoriaCtrl.registrar(t, {
      tabela,
      registroId: criado.id,
      operacao: 'I',
      depois: criado,
      usuarioUuid,
      contexto
    })

    criados.push(criado.id)
  }

  return criados
}

const atualizarVarios = async (
  t,
  { tabela, colunas, linhas, nomeAmigavel, usuarioUuid, contexto, autoria, carimboQgis }
) => {
  for (const linha of linhas) {
    const antes = await auditoriaCtrl.lerAntes(t, tabela, linha.id, nomeAmigavel)

    const atribuicoes = colunas.map(c => `${c} = $<${c}>`)
    const dados = { id: linha.id }
    for (const coluna of colunas) {
      dados[coluna] = linha[coluna] !== undefined ? linha[coluna] : null
    }
    if (autoria) {
      atribuicoes.push('data_modificacao = CURRENT_TIMESTAMP')
      atribuicoes.push('usuario_modificacao_uuid = $<usuario_modificacao_uuid>')
      dados.usuario_modificacao_uuid = usuarioUuid
    }
    // O CARIMBO DO CATALOGO DO QGIS E OUTRO PAR DE COLUNAS, e nao o da casa:
    // `owner` e `update_time` sao LIDAS PELO NOME pelo plugin do QGIS e pelo SAP
    // Gerente, que sao clientes compilados fora deste repositorio. O DEFAULT
    // `now()` so vale no INSERT: sem esta linha, o `update_time` de um atalho
    // editado continuaria dizendo a data em que ele foi criado, e o cliente que
    // decide se precisa rebaixar o catalogo passaria a nao ver a mudanca.
    if (carimboQgis) {
      atribuicoes.push('update_time = now()')
    }

    const depois = await t.one(
      `UPDATE ${tabela} SET ${atribuicoes.join(', ')} WHERE id = $<id> RETURNING *`,
      dados
    )

    await auditoriaCtrl.registrar(t, {
      tabela,
      registroId: linha.id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })
  }
}

const apagarVarios = async (t, { tabela, ids, nomeAmigavel, usuarioUuid, contexto }) => {
  // LISTA VAZIA SAI AQUI, e nao e defesa contra o corpo da requisicao: o Joi ja
  // cobra `min(1)` em toda rota de exclusao. Quem chega vazio e o chamador
  // INTERNO -- `deletaHabilitacao` apaga em cascata as etapas da habilitacao, e
  // uma habilitacao sem etapa nenhuma e o caso comum. Sem esta saida, o
  // `$<ids:csv>` de uma lista vazia vira `IN ()`, que e erro de sintaxe do
  // Postgres e chega como 500 numa exclusao que estava certa.
  if (ids.length === 0) return

  await exigirQueExistam(t, tabela, ids, nomeAmigavel)

  for (const id of ids) {
    const antes = await auditoriaCtrl.lerAntes(t, tabela, id, nomeAmigavel)

    await t.none(`DELETE FROM ${tabela} WHERE id = $<id>`, { id })

    await auditoriaCtrl.registrar(t, {
      tabela,
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  }
}

// --- Habilitacao -------------------------------------------------------------
//
// O QUE A DISTRIBUICAO PODE ENTREGAR A QUEM. NAO e autorizacao: quem barra a
// escrita e o perfil do modulo `producao` em `dgeo.usuario_perfil`, lido pelo
// `verifyPerfil` a cada requisicao. Ver `er/producao.sql`.

const ERROS_HABILITACAO = {
  [UNIQUE_VIOLATION]: 'Já existe uma habilitação com este nome'
}

controller.getHabilitacao = async () => {
  return db.conn.any(
    'SELECT id, nome FROM producao.habilitacao ORDER BY nome'
  )
}

controller.criaHabilitacao = async (habilitacao, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(t =>
        inserirVarios(t, {
          tabela: 'producao.habilitacao',
          colunas: ['nome'],
          linhas: habilitacao,
          usuarioUuid,
          contexto,
          autoria: true
        })
      ),
    ERROS_HABILITACAO
  )
}

controller.atualizaHabilitacao = async (habilitacao, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(t =>
        atualizarVarios(t, {
          tabela: 'producao.habilitacao',
          colunas: ['nome'],
          linhas: habilitacao,
          nomeAmigavel: 'Habilitação',
          usuarioUuid,
          contexto,
          autoria: true
        })
      ),
    ERROS_HABILITACAO
  )
}

// AS TRES DEPENDENCIAS SAO CONFERIDAS ANTES, e as duas primeiras nao sao a mesma
// coisa. `habilitacao_etapa` e configuracao e CAI JUNTO, como no SAP; a pessoa
// habilitada e a fila prioritaria de grupo BARRAM, porque apagar em cascata
// tiraria gente de trabalho e desfaria furo de fila que alguem decidiu, sem
// aviso nenhum na tela.
controller.deletaHabilitacao = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    await exigirQueExistam(t, 'producao.habilitacao', ids, 'Habilitação')

    const comUsuario = await t.any(
      'SELECT id FROM producao.habilitacao_usuario WHERE habilitacao_id IN ($<ids:csv>)',
      { ids }
    )
    if (comUsuario.length > 0) {
      throw new AppError(
        'A habilitação possui pessoa vinculada. Remova o vínculo antes de apagá-la',
        httpCode.BadRequest
      )
    }

    const comFila = await t.any(
      'SELECT id FROM producao.fila_prioritaria_grupo WHERE habilitacao_id IN ($<ids:csv>)',
      { ids }
    )
    if (comFila.length > 0) {
      throw new AppError(
        'A habilitação possui fila prioritária de grupo associada. Esvazie a fila antes de apagá-la',
        httpCode.BadRequest
      )
    }

    const etapas = await t.any(
      'SELECT id FROM producao.habilitacao_etapa WHERE habilitacao_id IN ($<ids:csv>)',
      { ids }
    )
    await apagarVarios(t, {
      tabela: 'producao.habilitacao_etapa',
      ids: etapas.map(e => e.id),
      nomeAmigavel: 'Etapa da habilitação',
      usuarioUuid,
      contexto
    })

    await apagarVarios(t, {
      tabela: 'producao.habilitacao',
      ids,
      nomeAmigavel: 'Habilitação',
      usuarioUuid,
      contexto
    })
  })
}

const ERROS_HABILITACAO_ETAPA = {
  [UNIQUE_VIOLATION]:
    'Esta habilitação já recebe este tipo de etapa nesta subfase',
  [FK_VIOLATION]: 'Habilitação, subfase ou tipo de etapa não encontrado'
}

controller.getHabilitacaoEtapa = async () => {
  return db.conn.any(
    `SELECT he.id, he.habilitacao_id, he.subfase_id, he.tipo_etapa_id, he.prioridade,
            h.nome AS habilitacao, s.nome AS subfase, te.nome AS tipo_etapa
       FROM producao.habilitacao_etapa AS he
       INNER JOIN producao.habilitacao AS h ON h.id = he.habilitacao_id
       INNER JOIN producao.subfase AS s ON s.id = he.subfase_id
       INNER JOIN dominio.tipo_etapa AS te ON te.code = he.tipo_etapa_id
      ORDER BY h.nome, he.prioridade`
  )
}

const COLUNAS_HABILITACAO_ETAPA = [
  'habilitacao_id',
  'subfase_id',
  'tipo_etapa_id',
  'prioridade'
]

controller.criaHabilitacaoEtapa = async (linhas, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(t =>
        inserirVarios(t, {
          tabela: 'producao.habilitacao_etapa',
          colunas: COLUNAS_HABILITACAO_ETAPA,
          linhas,
          usuarioUuid,
          contexto,
          autoria: true
        })
      ),
    ERROS_HABILITACAO_ETAPA
  )
}

controller.atualizaHabilitacaoEtapa = async (linhas, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(t =>
        atualizarVarios(t, {
          tabela: 'producao.habilitacao_etapa',
          colunas: COLUNAS_HABILITACAO_ETAPA,
          linhas,
          nomeAmigavel: 'Etapa da habilitação',
          usuarioUuid,
          contexto,
          autoria: true
        })
      ),
    ERROS_HABILITACAO_ETAPA
  )
}

controller.deletaHabilitacaoEtapa = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    apagarVarios(t, {
      tabela: 'producao.habilitacao_etapa',
      ids,
      nomeAmigavel: 'Etapa da habilitação',
      usuarioUuid,
      contexto
    })
  )
}

const ERROS_HABILITACAO_USUARIO = {
  [UNIQUE_VIOLATION]:
    'Esta pessoa já pertence a uma habilitação. Uma pessoa tem UMA, senão a distribuição não teria como desempatar a prioridade',
  [FK_VIOLATION]: 'Pessoa ou habilitação não encontrada'
}

controller.getHabilitacaoUsuario = async () => {
  return db.conn.any(
    `SELECT hu.id, hu.usuario_uuid, hu.habilitacao_id,
            tpg.nome_abrev || ' ' || u.nome_guerra AS usuario,
            h.nome AS habilitacao
       FROM producao.habilitacao_usuario AS hu
       INNER JOIN dgeo.usuario AS u ON u.uuid = hu.usuario_uuid
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
       INNER JOIN producao.habilitacao AS h ON h.id = hu.habilitacao_id
      ORDER BY h.nome, u.nome_guerra`
  )
}

controller.criaHabilitacaoUsuario = async (linhas, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(t =>
        inserirVarios(t, {
          tabela: 'producao.habilitacao_usuario',
          colunas: ['usuario_uuid', 'habilitacao_id'],
          linhas,
          usuarioUuid,
          contexto,
          autoria: true
        })
      ),
    ERROS_HABILITACAO_USUARIO
  )
}

controller.atualizaHabilitacaoUsuario = async (linhas, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(t =>
        atualizarVarios(t, {
          tabela: 'producao.habilitacao_usuario',
          colunas: ['usuario_uuid', 'habilitacao_id'],
          linhas,
          nomeAmigavel: 'Pessoa habilitada',
          usuarioUuid,
          contexto,
          autoria: true
        })
      ),
    ERROS_HABILITACAO_USUARIO
  )
}

controller.deletaHabilitacaoUsuario = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    apagarVarios(t, {
      tabela: 'producao.habilitacao_usuario',
      ids,
      nomeAmigavel: 'Pessoa habilitada',
      usuarioUuid,
      contexto
    })
  )
}

const ERROS_HABILITACAO_BLOCO = {
  [FK_VIOLATION]: 'Pessoa ou bloco não encontrado'
}

controller.getHabilitacaoBloco = async () => {
  return db.conn.any(
    `SELECT hb.id, hb.usuario_uuid, hb.bloco_id,
            tpg.nome_abrev || ' ' || u.nome_guerra AS usuario,
            b.nome AS bloco, b.prioridade, b.lote_id, l.nome AS lote
       FROM producao.habilitacao_bloco AS hb
       INNER JOIN dgeo.usuario AS u ON u.uuid = hb.usuario_uuid
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
       INNER JOIN producao.bloco AS b ON b.id = hb.bloco_id
       INNER JOIN acervo.lote AS l ON l.id = b.lote_id
      ORDER BY l.nome, b.prioridade, u.nome_guerra`
  )
}

controller.criaHabilitacaoBloco = async (linhas, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(t =>
        inserirVarios(t, {
          tabela: 'producao.habilitacao_bloco',
          colunas: ['usuario_uuid', 'bloco_id'],
          linhas,
          usuarioUuid,
          contexto,
          autoria: true
        })
      ),
    ERROS_HABILITACAO_BLOCO
  )
}

controller.atualizaHabilitacaoBloco = async (linhas, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(t =>
        atualizarVarios(t, {
          tabela: 'producao.habilitacao_bloco',
          colunas: ['usuario_uuid', 'bloco_id'],
          linhas,
          nomeAmigavel: 'Habilitação de bloco',
          usuarioUuid,
          contexto,
          autoria: true
        })
      ),
    ERROS_HABILITACAO_BLOCO
  )
}

controller.deletaHabilitacaoBloco = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    apagarVarios(t, {
      tabela: 'producao.habilitacao_bloco',
      ids,
      nomeAmigavel: 'Habilitação de bloco',
      usuarioUuid,
      contexto
    })
  )
}

// --- Atividade: pausar, reiniciar, voltar e avancar --------------------------
//
// AS QUATRO MEXEM NA MAQUINA DE ESTADO DA ATIVIDADE, e as quatro seguem a mesma
// coreografia do SAP: a atividade viva NAO e alterada no lugar, ela e ENCERRADA
// como 'Não finalizada' (code 5) e uma NOVA nasce no estado desejado. E o indice
// unico parcial de `producao.atividade` que obriga a isso -- pode haver muitas
// linhas do code 5 para o mesmo par (etapa, unidade de trabalho), e VIVA so uma.
//
// Sem essa coreografia, o historico de quem trabalhou numa folha viraria uma
// linha so, reescrita a cada pausa.

/**
 * Encerra a atividade EM EXECUCAO das unidades de trabalho e abre uma pausada.
 *
 * Devolve `false` quando nao havia nada em execucao, para o chamador decidir se
 * isso e erro (`POST /atividade/pausar`, que foi pedido explicitamente) ou nao
 * (`POST /unidade_trabalho/disponivel`, onde pausar e efeito colateral).
 */
const pausarAtividades = async (t, unidadeTrabalhoIds, usuarioUuid, contexto) => {
  const encerradas = await t.any(
    `UPDATE producao.atividade SET
       data_fim = CURRENT_TIMESTAMP,
       tipo_situacao_atividade_id = $<naoFinalizada>
     WHERE id IN (
       SELECT a.id
         FROM producao.atividade AS a
        WHERE a.unidade_trabalho_id IN ($<unidadeTrabalhoIds:csv>)
          AND a.tipo_situacao_atividade_id = $<emExecucao>
     )
     RETURNING *`,
    {
      unidadeTrabalhoIds,
      emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO,
      naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA
    }
  )

  if (encerradas.length === 0) return false

  for (const encerrada of encerradas) {
    await auditoriaCtrl.registrar(t, {
      tabela: 'producao.atividade',
      registroId: encerrada.id,
      operacao: 'U',
      depois: encerrada,
      usuarioUuid,
      contexto,
      motivo: 'Atividade pausada pela gerência'
    })

    // A PAUSADA GUARDA O DONO, e e o que distingue pausar de reiniciar: a
    // atividade volta para a MESMA mao. `observacao` acompanha, senao o texto
    // que o operador escreveu se perderia na pausa.
    const pausada = await t.one(
      `INSERT INTO producao.atividade
         (etapa_id, unidade_trabalho_id, usuario_uuid, tipo_situacao_atividade_id, observacao)
       VALUES
         ($<etapaId>, $<unidadeTrabalhoId>, $<usuarioAtividade>, $<pausada>, $<observacao>)
       RETURNING *`,
      {
        etapaId: encerrada.etapa_id,
        unidadeTrabalhoId: encerrada.unidade_trabalho_id,
        usuarioAtividade: encerrada.usuario_uuid,
        pausada: SITUACAO_ATIVIDADE.PAUSADA,
        observacao: encerrada.observacao
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'producao.atividade',
      registroId: pausada.id,
      operacao: 'I',
      depois: pausada,
      usuarioUuid,
      contexto,
      motivo: 'Atividade pausada pela gerência'
    })
  }

  return true
}

controller.pausaAtividade = async (unidadeTrabalhoIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const mudou = await pausarAtividades(t, unidadeTrabalhoIds, usuarioUuid, contexto)
    if (!mudou) {
      throw new AppError(
        'Unidades de trabalho não possuem atividades em execução',
        httpCode.NotFound
      )
    }
  })
}

// `disponivel = false` PAUSA O QUE ESTAVA EM EXECUCAO, e nao poderia ser
// diferente: a unidade indisponivel nao tem como ser trabalhada, e deixar a
// atividade aberta faria a estatistica de producao contar como em curso um
// trabalho que ninguem pode fazer. Aqui a ausencia de atividade viva NAO e erro.
controller.unidadeTrabalhoDisponivel = async (
  unidadeTrabalhoIds,
  disponivel,
  usuarioUuid,
  contexto
) => {
  return db.conn.tx(async t => {
    await exigirQueExistam(
      t,
      'producao.unidade_trabalho',
      unidadeTrabalhoIds,
      'Unidade de trabalho'
    )

    for (const id of unidadeTrabalhoIds) {
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'producao.unidade_trabalho',
        id,
        'Unidade de trabalho'
      )

      const depois = await t.one(
        `UPDATE producao.unidade_trabalho SET
           disponivel = $<disponivel>,
           data_modificacao = CURRENT_TIMESTAMP,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        { id, disponivel, usuarioUuid }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.unidade_trabalho',
        registroId: id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })
    }

    if (!disponivel) {
      await pausarAtividades(t, unidadeTrabalhoIds, usuarioUuid, contexto)
    }
  })
}

// REINICIAR e PAUSAR sao diferentes em duas coisas, e as duas importam: a
// reiniciada tambem alcanca a PAUSADA (code 3), e a nova nasce SEM DONO, no
// estado 'Não iniciada'. E a saida para o trabalho que travou -- ele volta para
// a fila e a distribuicao entrega a quem estiver disponivel.
//
// O `DISTINCT ON (unidade_trabalho_id) ... ORDER BY e.ordem` e do SAP e nao e
// enfeite: uma unidade de trabalho pode ter mais de uma atividade viva em etapas
// diferentes, e o que se reinicia e a MAIS ANTIGA no fluxo. Reiniciar a de tras
// deixaria a da frente rodando sobre um trabalho que voltou a zero.
controller.reiniciaAtividade = async (unidadeTrabalhoIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const encerradas = await t.any(
      `UPDATE producao.atividade SET
         data_inicio = COALESCE(data_inicio, CURRENT_TIMESTAMP),
         data_fim = COALESCE(data_fim, CURRENT_TIMESTAMP),
         tipo_situacao_atividade_id = $<naoFinalizada>
       WHERE id IN (
         SELECT DISTINCT ON (a.unidade_trabalho_id) a.id
           FROM producao.atividade AS a
           INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
          WHERE a.unidade_trabalho_id IN ($<unidadeTrabalhoIds:csv>)
            AND a.tipo_situacao_atividade_id IN ($<emExecucao>, $<pausada>)
          ORDER BY a.unidade_trabalho_id, e.ordem
       )
       RETURNING *`,
      {
        unidadeTrabalhoIds,
        emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO,
        pausada: SITUACAO_ATIVIDADE.PAUSADA,
        naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA
      }
    )

    if (encerradas.length === 0) {
      throw new AppError(
        'Unidades de trabalho não possuem atividades em execução ou pausadas',
        httpCode.NotFound
      )
    }

    for (const encerrada of encerradas) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.atividade',
        registroId: encerrada.id,
        operacao: 'U',
        depois: encerrada,
        usuarioUuid,
        contexto,
        motivo: 'Atividade reiniciada pela gerência'
      })

      const nova = await t.one(
        `INSERT INTO producao.atividade
           (etapa_id, unidade_trabalho_id, tipo_situacao_atividade_id)
         VALUES ($<etapaId>, $<unidadeTrabalhoId>, $<naoIniciada>)
         RETURNING *`,
        {
          etapaId: encerrada.etapa_id,
          unidadeTrabalhoId: encerrada.unidade_trabalho_id,
          naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.atividade',
        registroId: nova.id,
        operacao: 'I',
        depois: nova,
        usuarioUuid,
        contexto,
        motivo: 'Atividade reiniciada pela gerência'
      })
    }
  })
}

/**
 * As atividades da MESMA unidade de trabalho, na etapa pedida e nas seguintes.
 *
 * `voltar` e `avancar` operam sobre uma janela do fluxo, e nao sobre a linha que
 * o id aponta: mandar a atividade de Revisao de volta significa desfazer tudo o
 * que veio dela em diante. `comparador` e '>=' no voltar (a propria e as
 * posteriores) e '<' ou '<=' no avancar, conforme a etapa pedida conte como
 * concluida.
 *
 * O OPERADOR ENTRA COMO IDENTIFICADOR CONFERIDO, e nunca vem do corpo: sao os
 * tres literais abaixo, escolhidos por nome pelo proprio controlador.
 */
const COMPARADORES = { '>=': '>=', '<': '<', '<=': '<=' }

const janelaDoFluxo = (comparador, filtroSituacao) => {
  const operador = COMPARADORES[comparador]
  if (!operador) {
    throw new Error(`Comparador de fluxo desconhecido: "${comparador}"`)
  }
  return `
    SELECT a_alvo.id
      FROM producao.atividade AS a
      INNER JOIN producao.atividade AS a_alvo
        ON a_alvo.unidade_trabalho_id = a.unidade_trabalho_id
      INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
      INNER JOIN producao.etapa AS e_alvo ON e_alvo.id = a_alvo.etapa_id
     WHERE a.id IN ($<atividadeIds:csv>)
       AND e_alvo.ordem ${operador} e.ordem
       ${filtroSituacao}`
}

controller.voltaAtividade = async (
  atividadeIds,
  manterUsuarios,
  usuarioUuid,
  contexto
) => {
  return db.conn.tx(async t => {
    const emCurso = await t.any(
      janelaDoFluxo(
        '>=',
        'AND a_alvo.tipo_situacao_atividade_id IN ($<emExecucao>, $<pausada>)'
      ),
      {
        atividadeIds,
        emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO,
        pausada: SITUACAO_ATIVIDADE.PAUSADA
      }
    )
    if (emCurso.length > 0) {
      throw new AppError(
        'Não se pode voltar atividades em execução ou pausadas. Reinicie a atividade primeiro',
        httpCode.BadRequest
      )
    }

    const encerradas = await t.any(
      `UPDATE producao.atividade SET
         tipo_situacao_atividade_id = $<naoFinalizada>,
         data_inicio = COALESCE(data_inicio, CURRENT_TIMESTAMP),
         data_fim = COALESCE(data_fim, CURRENT_TIMESTAMP)
       WHERE id IN (${janelaDoFluxo(
         '>=',
         'AND a_alvo.tipo_situacao_atividade_id = $<finalizada>'
       )})
       RETURNING *`,
      {
        atividadeIds,
        finalizada: SITUACAO_ATIVIDADE.FINALIZADA,
        naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA
      }
    )

    if (encerradas.length === 0) {
      throw new AppError(
        'Atividades não encontradas ou não podem ser retornadas para etapas anteriores',
        httpCode.NotFound
      )
    }

    for (const encerrada of encerradas) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.atividade',
        registroId: encerrada.id,
        operacao: 'U',
        depois: encerrada,
        usuarioUuid,
        contexto,
        motivo: 'Atividade devolvida para etapa anterior'
      })

      // MANTER O OPERADOR abre a nova como PAUSADA e com dono: ela volta para a
      // mesma mao, e o gerente esta dizendo "refaça isto". Sem manter, ela nasce
      // 'Não iniciada' e sem dono, e a distribuicao a entrega de novo.
      const nova = await t.one(
        `INSERT INTO producao.atividade
           (etapa_id, unidade_trabalho_id, usuario_uuid, tipo_situacao_atividade_id, observacao)
         VALUES
           ($<etapaId>, $<unidadeTrabalhoId>, $<usuarioAtividade>, $<situacao>, $<observacao>)
         RETURNING *`,
        {
          etapaId: encerrada.etapa_id,
          unidadeTrabalhoId: encerrada.unidade_trabalho_id,
          usuarioAtividade: manterUsuarios ? encerrada.usuario_uuid : null,
          situacao: manterUsuarios
            ? SITUACAO_ATIVIDADE.PAUSADA
            : SITUACAO_ATIVIDADE.NAO_INICIADA,
          observacao: encerrada.observacao
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.atividade',
        registroId: nova.id,
        operacao: 'I',
        depois: nova,
        usuarioUuid,
        contexto,
        motivo: 'Atividade devolvida para etapa anterior'
      })
    }
  })
}

// AVANCAR MARCA COMO FINALIZADO O QUE NAO FOI FEITO, e o `usuario_uuid` que
// entra e o DO GERENTE, e nao o de quem deveria ter feito. E deliberado e vem do
// SAP: a atividade pulada nao teve operador, e escrever qualquer outro nome ali
// afirmaria um trabalho que ninguem executou.
controller.avancaAtividade = async (
  atividadeIds,
  concluida,
  usuarioUuid,
  contexto
) => {
  const comparador = concluida ? '<=' : '<'

  return db.conn.tx(async t => {
    const emCurso = await t.any(
      janelaDoFluxo(
        comparador,
        'AND a_alvo.tipo_situacao_atividade_id IN ($<emExecucao>, $<pausada>)'
      ),
      {
        atividadeIds,
        emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO,
        pausada: SITUACAO_ATIVIDADE.PAUSADA
      }
    )
    if (emCurso.length > 0) {
      throw new AppError(
        'Não se pode avançar atividades em execução ou pausadas. Reinicie a atividade primeiro',
        httpCode.BadRequest
      )
    }

    // NA FILA PRIORITARIA TAMBEM NAO PODE, e sao duas consultas porque sao duas
    // tabelas: a fila de UMA pessoa e a de um grupo. Avancar por cima de um furo
    // de fila deixaria a entrada apontando atividade finalizada, e a
    // distribuicao entregaria trabalho que nao existe mais.
    const naFila = await t.any(
      `SELECT fp.id
         FROM producao.fila_prioritaria AS fp
        WHERE fp.atividade_id IN (${janelaDoFluxo(comparador, '')})`,
      { atividadeIds }
    )
    if (naFila.length > 0) {
      throw new AppError(
        'Não se pode avançar atividades em fila prioritária. Remova da fila primeiro',
        httpCode.BadRequest
      )
    }

    const naFilaGrupo = await t.any(
      `SELECT fpg.id
         FROM producao.fila_prioritaria_grupo AS fpg
        WHERE fpg.atividade_id IN (${janelaDoFluxo(comparador, '')})`,
      { atividadeIds }
    )
    if (naFilaGrupo.length > 0) {
      throw new AppError(
        'Não se pode avançar atividades em fila prioritária de grupo. Remova da fila primeiro',
        httpCode.BadRequest
      )
    }

    const avancadas = await t.any(
      `UPDATE producao.atividade SET
         tipo_situacao_atividade_id = $<finalizada>,
         data_inicio = COALESCE(data_inicio, CURRENT_TIMESTAMP),
         data_fim = COALESCE(data_fim, CURRENT_TIMESTAMP),
         usuario_uuid = COALESCE(usuario_uuid, $<usuarioUuid>)
       WHERE id IN (${janelaDoFluxo(
         comparador,
         'AND a_alvo.tipo_situacao_atividade_id = $<naoIniciada>'
       )})
       RETURNING *`,
      {
        atividadeIds,
        usuarioUuid,
        naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA,
        finalizada: SITUACAO_ATIVIDADE.FINALIZADA
      }
    )

    // ZERO LINHAS E ERRO AQUI, E NO SAP NAO ERA. E a unica divergencia de
    // comportamento das quatro operacoes de fluxo, e ela e deliberada: pausar,
    // reiniciar e voltar ja respondiam 404 quando nao achavam o que mexer, e so
    // avancar respondia "sucesso" tendo mudado nada. O gerente seleciona as
    // atividades na tela e clica; "avancei" sobre zero linhas e a resposta que
    // ele nao tem como distinguir da certa, e o efeito e ele achar que o lote
    // andou. Se algum cliente antigo depender do silencio, e aqui que a decisao
    // se desfaz -- e ela se registra em `docs/decisoes.md`.
    if (avancadas.length === 0) {
      throw new AppError(
        'Atividades não encontradas ou não podem ser avançadas',
        httpCode.NotFound
      )
    }

    for (const avancada of avancadas) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.atividade',
        registroId: avancada.id,
        operacao: 'U',
        depois: avancada,
        usuarioUuid,
        contexto,
        motivo: 'Atividade avançada pela gerência'
      })
    }
  })
}

// --- Modo local --------------------------------------------------------------
//
// A ATIVIDADE EXECUTADA FORA DO FLUXO, e lancada depois. O SAP a usa para o
// trabalho feito sem rede: o gerente abre a atividade em nome de quem trabalhou
// e a fecha com as datas de VERDADE, que e a razao de as datas virem no corpo em
// vez de serem marcadas aqui.

controller.iniciaAtividadeModoLocal = async (atividadeId, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'producao.atividade',
      atividadeId,
      'Atividade'
    )

    const depois = await t.one(
      `UPDATE producao.atividade SET
         data_inicio = CURRENT_TIMESTAMP,
         tipo_situacao_atividade_id = $<emExecucao>,
         usuario_uuid = $<usuarioUuid>
       WHERE id = $<atividadeId>
       RETURNING *`,
      { atividadeId, usuarioUuid, emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'producao.atividade',
      registroId: atividadeId,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto,
      motivo: 'Atividade iniciada em modo local'
    })
  })
}

controller.finalizaAtividadeModoLocal = async (
  atividadeId,
  usuarioAtividadeUuid,
  dataInicio,
  dataFim,
  usuarioUuid,
  contexto
) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'producao.atividade',
      atividadeId,
      'Atividade'
    )

    // A PESSOA E CONFERIDA ANTES, para o erro dizer o que houve. Sem isto, o uuid
    // que nao existe morre na chave estrangeira e chega como 500.
    const executor = await t.oneOrNone(
      'SELECT uuid FROM dgeo.usuario WHERE uuid = $<usuarioAtividadeUuid>',
      { usuarioAtividadeUuid }
    )
    if (!executor) {
      throw new AppError(
        'Usuário da atividade não encontrado. Verifique o UUID',
        httpCode.BadRequest
      )
    }

    const depois = await t.one(
      `UPDATE producao.atividade SET
         data_inicio = $<dataInicio>,
         data_fim = $<dataFim>,
         tipo_situacao_atividade_id = $<finalizada>,
         usuario_uuid = $<usuarioAtividadeUuid>
       WHERE id = $<atividadeId>
       RETURNING *`,
      {
        atividadeId,
        usuarioAtividadeUuid,
        dataInicio,
        dataFim,
        finalizada: SITUACAO_ATIVIDADE.FINALIZADA
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'producao.atividade',
      registroId: atividadeId,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto,
      motivo: 'Atividade finalizada em modo local'
    })
  })
}

// --- Observacao --------------------------------------------------------------
//
// GRAVA AS DUAS DE UMA VEZ, e nao e descuido de desenho: a tela mostra as duas
// lado a lado, porque a pergunta "por que esta folha esta assim" as vezes se
// responde no trabalho (a atividade) e as vezes no recorte (a unidade). Mandar
// so uma delas apagaria a outra, e por isso as duas sao obrigatorias no Joi.

controller.criaObservacao = async (
  atividadeIds,
  observacaoAtividade,
  observacaoUnidadeTrabalho,
  usuarioUuid,
  contexto
) => {
  return db.conn.tx(async t => {
    await exigirQueExistam(t, 'producao.atividade', atividadeIds, 'Atividade')

    for (const id of atividadeIds) {
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'producao.atividade',
        id,
        'Atividade'
      )

      const depois = await t.one(
        `UPDATE producao.atividade SET observacao = $<observacaoAtividade>
          WHERE id = $<id> RETURNING *`,
        { id, observacaoAtividade }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.atividade',
        registroId: id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })
    }

    // UMA UNIDADE DE TRABALHO PODE ATENDER VARIAS ATIVIDADES da lista, e por
    // isso o DISTINCT: sem ele, a mesma unidade seria atualizada duas vezes e o
    // rastro teria um evento em que nada mudou.
    const unidades = await t.any(
      `SELECT DISTINCT a.unidade_trabalho_id AS id
         FROM producao.atividade AS a
        WHERE a.id IN ($<atividadeIds:csv>)`,
      { atividadeIds }
    )

    for (const unidade of unidades) {
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'producao.unidade_trabalho',
        unidade.id,
        'Unidade de trabalho'
      )

      const depois = await t.one(
        `UPDATE producao.unidade_trabalho SET
           observacao = $<observacaoUnidadeTrabalho>,
           data_modificacao = CURRENT_TIMESTAMP,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id> RETURNING *`,
        { id: unidade.id, observacaoUnidadeTrabalho, usuarioUuid }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.unidade_trabalho',
        registroId: unidade.id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })
    }
  })
}

controller.getObservacao = async atividadeId => {
  return db.conn.any(
    `SELECT a.observacao AS observacao_atividade,
            ut.observacao AS observacao_unidade_trabalho
       FROM producao.atividade AS a
       INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
      WHERE a.id = $<atividadeId>`,
    { atividadeId }
  )
}

// --- Propriedades da unidade de trabalho -------------------------------------
//
// AS TRES SAO OPCIONAIS, E O QUE NAO VEIO NAO E TOCADO. O `COALESCE` faz isso
// numa consulta so: sem ele, a tela que reprioriza cinquenta unidades teria de
// reenviar a dificuldade e o tempo estimado de cada uma para nao zera-los.

controller.atualizaPropriedadesUT = async (unidades, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    for (const unidade of unidades) {
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'producao.unidade_trabalho',
        unidade.id,
        'Unidade de trabalho'
      )

      const depois = await t.one(
        `UPDATE producao.unidade_trabalho SET
           dificuldade = COALESCE($<dificuldade>, dificuldade),
           tempo_estimado_minutos = COALESCE($<tempoEstimadoMinutos>, tempo_estimado_minutos),
           prioridade = COALESCE($<prioridade>, prioridade),
           data_modificacao = CURRENT_TIMESTAMP,
           usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        {
          id: unidade.id,
          dificuldade: unidade.dificuldade !== undefined ? unidade.dificuldade : null,
          tempoEstimadoMinutos:
            unidade.tempo_estimado_minutos !== undefined
              ? unidade.tempo_estimado_minutos
              : null,
          prioridade: unidade.prioridade !== undefined ? unidade.prioridade : null,
          usuarioUuid
        }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.unidade_trabalho',
        registroId: unidade.id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })
    }
  })
}

// --- Fila prioritaria --------------------------------------------------------
//
// O FURO DE FILA, DECLARADO. `usuario_uuid` aqui e o BENEFICIARIO, e quem furou
// esta em `usuario_cadastramento_uuid` -- ver o comentario da tabela em
// `er/producao.sql`. E a razao de esta tabela ter auditoria e `atividade` nao.
//
// SO ENTRA ATIVIDADE 'Não iniciada', e o filtro esta no proprio INSERT: furar a
// fila para uma atividade que ja esta em execucao nao adianta nada, porque a
// distribuicao ja a entregou.

const ERROS_FILA = {
  [UNIQUE_VIOLATION]:
    'Esta atividade já está na fila prioritária desta pessoa',
  [FK_VIOLATION]: 'Atividade ou pessoa não encontrada'
}

controller.getFilaPrioritaria = async () => {
  return db.conn.any(
    `SELECT fp.id, fp.atividade_id, fp.usuario_uuid, fp.prioridade,
            tpg.nome_abrev || ' ' || u.nome_guerra AS usuario,
            s.nome AS subfase, l.nome AS lote, b.nome AS bloco
       FROM producao.fila_prioritaria AS fp
       INNER JOIN dgeo.usuario AS u ON u.uuid = fp.usuario_uuid
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
       INNER JOIN producao.atividade AS a ON a.id = fp.atividade_id
       INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
       INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
       INNER JOIN acervo.lote AS l ON l.id = ut.lote_id
       INNER JOIN producao.bloco AS b ON b.id = ut.bloco_id
      ORDER BY fp.prioridade`
  )
}

/**
 * A fila de UMA pessoa e a de um GRUPO, num controlador so.
 *
 * As duas tabelas diferem em UMA coluna (`usuario_uuid` contra
 * `habilitacao_id`), e o resto -- a conferencia de duplicidade, o filtro por
 * 'Não iniciada', a numeracao sequencial a partir da prioridade pedida -- e
 * identico letra por letra. Duas copias divergiriam no primeiro ajuste, e a que
 * ninguem olhasse seria a que continuaria errada.
 */
const criarFila = async (
  { tabela, coluna, alvo, atividadeIds, prioridade, jaExiste },
  usuarioUuid,
  contexto
) => {
  return db.conn.tx(async t => {
    const existentes = await t.any(
      `SELECT id FROM ${tabela}
        WHERE atividade_id IN ($<atividadeIds:csv>) AND ${coluna} = $<alvo>`,
      { atividadeIds, alvo }
    )
    if (existentes.length > 0) {
      throw new AppError(jaExiste, httpCode.BadRequest)
    }

    // A NUMERACAO E SEQUENCIAL A PARTIR DO QUE FOI PEDIDO, e nao a mesma para
    // todos: mandar cinco atividades com prioridade 1 daria cinco empates, e a
    // fila voltaria a ser a ordem natural que ela existe para furar.
    const criadas = await t.any(
      `INSERT INTO ${tabela}
         (atividade_id, ${coluna}, prioridade, usuario_cadastramento_uuid)
       SELECT a.id, $<alvo>, row_number() OVER (ORDER BY a.id) + $<prioridade> - 1,
              $<usuarioUuid>
         FROM producao.atividade AS a
        WHERE a.id IN ($<atividadeIds:csv>)
          AND a.tipo_situacao_atividade_id = $<naoIniciada>
       RETURNING *`,
      {
        atividadeIds,
        alvo,
        prioridade,
        usuarioUuid,
        naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA
      }
    )

    if (criadas.length === 0) {
      throw new AppError(
        'Atividade não encontrada ou não pode ser adicionada na fila prioritária',
        httpCode.BadRequest
      )
    }

    for (const criada of criadas) {
      await auditoriaCtrl.registrar(t, {
        tabela,
        registroId: criada.id,
        operacao: 'I',
        depois: criada,
        usuarioUuid,
        contexto
      })
    }

    return criadas.map(c => c.id)
  })
}

controller.criaFilaPrioritaria = async (
  atividadeIds,
  usuarioBeneficiadoUuid,
  prioridade,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      criarFila(
        {
          tabela: 'producao.fila_prioritaria',
          coluna: 'usuario_uuid',
          alvo: usuarioBeneficiadoUuid,
          atividadeIds,
          prioridade,
          jaExiste:
            'Esta atividade já está cadastrada como prioritária para esta pessoa'
        },
        usuarioUuid,
        contexto
      ),
    ERROS_FILA
  )
}

controller.atualizaFilaPrioritaria = async (linhas, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(t =>
        atualizarVarios(t, {
          tabela: 'producao.fila_prioritaria',
          colunas: ['atividade_id', 'usuario_uuid', 'prioridade'],
          linhas,
          nomeAmigavel: 'Entrada da fila prioritária',
          usuarioUuid,
          contexto,
          autoria: true
        })
      ),
    ERROS_FILA
  )
}

controller.deletaFilaPrioritaria = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    apagarVarios(t, {
      tabela: 'producao.fila_prioritaria',
      ids,
      nomeAmigavel: 'Entrada da fila prioritária',
      usuarioUuid,
      contexto
    })
  )
}

const ERROS_FILA_GRUPO = {
  [UNIQUE_VIOLATION]:
    'Esta atividade já está na fila prioritária desta habilitação',
  [FK_VIOLATION]: 'Atividade ou habilitação não encontrada'
}

controller.getFilaPrioritariaGrupo = async () => {
  return db.conn.any(
    `SELECT fpg.id, fpg.atividade_id, fpg.habilitacao_id, fpg.prioridade,
            h.nome AS habilitacao,
            s.nome AS subfase, l.nome AS lote, b.nome AS bloco
       FROM producao.fila_prioritaria_grupo AS fpg
       INNER JOIN producao.habilitacao AS h ON h.id = fpg.habilitacao_id
       INNER JOIN producao.atividade AS a ON a.id = fpg.atividade_id
       INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
       INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
       INNER JOIN acervo.lote AS l ON l.id = ut.lote_id
       INNER JOIN producao.bloco AS b ON b.id = ut.bloco_id
      ORDER BY fpg.prioridade`
  )
}

controller.criaFilaPrioritariaGrupo = async (
  atividadeIds,
  habilitacaoId,
  prioridade,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      criarFila(
        {
          tabela: 'producao.fila_prioritaria_grupo',
          coluna: 'habilitacao_id',
          alvo: habilitacaoId,
          atividadeIds,
          prioridade,
          jaExiste:
            'Esta atividade já está cadastrada como prioritária para esta habilitação'
        },
        usuarioUuid,
        contexto
      ),
    ERROS_FILA_GRUPO
  )
}

controller.atualizaFilaPrioritariaGrupo = async (linhas, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(t =>
        atualizarVarios(t, {
          tabela: 'producao.fila_prioritaria_grupo',
          colunas: ['atividade_id', 'habilitacao_id', 'prioridade'],
          linhas,
          nomeAmigavel: 'Entrada da fila prioritária de grupo',
          usuarioUuid,
          contexto,
          autoria: true
        })
      ),
    ERROS_FILA_GRUPO
  )
}

controller.deletaFilaPrioritariaGrupo = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    apagarVarios(t, {
      tabela: 'producao.fila_prioritaria_grupo',
      ids,
      nomeAmigavel: 'Entrada da fila prioritária de grupo',
      usuarioUuid,
      contexto
    })
  )
}

// --- Problema de atividade e alteracao de fluxo ------------------------------

controller.getProblemaAtividade = async () => {
  return db.conn.any(
    `SELECT pa.id, pa.atividade_id, pa.descricao, pa.data, pa.resolvido,
            pa.tipo_problema_atividade_id,
            tp.nome AS tipo_problema,
            tpg.nome_abrev || ' ' || u.nome_guerra AS usuario,
            ST_AsEWKT(pa.geom) AS geom
       FROM producao.problema_atividade AS pa
       INNER JOIN dominio.tipo_problema_atividade AS tp
         ON tp.code = pa.tipo_problema_atividade_id
       INNER JOIN dgeo.usuario AS u ON u.uuid = pa.usuario_uuid
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
      ORDER BY pa.data DESC`
  )
}

// SO O `resolvido` MUDA, e a razao esta no Joi: o apontamento e do OPERADOR, e a
// gerencia responde se o caso foi tratado.
controller.atualizaProblemaAtividade = async (linhas, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    atualizarVarios(t, {
      tabela: 'producao.problema_atividade',
      colunas: ['resolvido'],
      linhas,
      nomeAmigavel: 'Problema de atividade',
      usuarioUuid,
      contexto
    })
  )
}

controller.getAlteracaoFluxo = async () => {
  return db.conn.any(
    `SELECT af.id, af.atividade_id, af.descricao, af.data, af.resolvido,
            tpg.nome_abrev || ' ' || u.nome_guerra AS usuario,
            ST_AsEWKT(af.geom) AS geom
       FROM producao.alteracao_fluxo AS af
       INNER JOIN dgeo.usuario AS u ON u.uuid = af.usuario_uuid
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
      ORDER BY af.data DESC`
  )
}

// A GEOMETRIA ENTRA POR `ST_GeomFromEWKT`, e o SRID e conferido pela coluna: ela
// e `geometry(POLYGON, 4674)`, entao um EWKT em 4326 e recusado pelo banco. E o
// comportamento desejado -- converter em silencio deslocaria o poligono sem que
// nada acusasse.
controller.atualizaAlteracaoFluxo = async (linhas, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    for (const linha of linhas) {
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'producao.alteracao_fluxo',
        linha.id,
        'Alteração de fluxo'
      )

      const depois = await t.one(
        `UPDATE producao.alteracao_fluxo SET
           atividade_id = $<atividade_id>,
           descricao = $<descricao>,
           data = $<data>,
           resolvido = $<resolvido>,
           geom = ST_GeomFromEWKT($<geom>)
         WHERE id = $<id>
         RETURNING *`,
        linha
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.alteracao_fluxo',
        registroId: linha.id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })
    }
  })
}

// --- Relatorio de alteracao --------------------------------------------------
//
// O DIARIO EM TEXTO das mudancas de fluxo. Nao aponta para nada e nada aponta
// para ele: e o que o gerente escreve quando muda a linha de producao no meio do
// caminho, e o que a tela de acompanhamento mostra como historico.

controller.getRelatorioAlteracao = async () => {
  return db.conn.any(
    'SELECT id, data, descricao FROM producao.relatorio_alteracao ORDER BY data DESC'
  )
}

controller.gravaRelatorioAlteracao = async (linhas, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    inserirVarios(t, {
      tabela: 'producao.relatorio_alteracao',
      colunas: ['data', 'descricao'],
      linhas,
      usuarioUuid,
      contexto
    })
  )
}

controller.atualizaRelatorioAlteracao = async (linhas, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    atualizarVarios(t, {
      tabela: 'producao.relatorio_alteracao',
      colunas: ['data', 'descricao'],
      linhas,
      nomeAmigavel: 'Relatório de alteração',
      usuarioUuid,
      contexto
    })
  )
}

controller.deletaRelatorioAlteracao = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    apagarVarios(t, {
      tabela: 'producao.relatorio_alteracao',
      ids,
      nomeAmigavel: 'Relatório de alteração',
      usuarioUuid,
      contexto
    })
  )
}

// --- QGIS: versao minima, plugins, atalhos e caminho -------------------------
//
// AS QUATRO MORAM NO SCHEMA `qgis`, e nao em `dgeo` como no SAP: aqui `dgeo` e
// GENTE. Ver o cabecalho de `er/qgis.sql`.

controller.getVersaoQGIS = async () => {
  return db.conn.one('SELECT versao_minima FROM qgis.versao_qgis WHERE code = 1')
}

// UMA LINHA SO, e o `code = 1` do CHECK e quem garante isso. Por isso e UPDATE e
// nunca INSERT: a pergunta "qual o QGIS mínimo" tem uma resposta.
controller.atualizaVersaoQGIS = async (versaoMinima, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'qgis.versao_qgis',
      1,
      'Versão mínima do QGIS',
      'code'
    )

    const depois = await t.one(
      'UPDATE qgis.versao_qgis SET versao_minima = $<versaoMinima> WHERE code = 1 RETURNING *',
      { versaoMinima }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'qgis.versao_qgis',
      registroId: 1,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })
  })
}

controller.getPlugins = async () => {
  return db.conn.any('SELECT id, nome, versao_minima FROM qgis.plugin ORDER BY nome')
}

controller.gravaPlugins = async (plugins, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    inserirVarios(t, {
      tabela: 'qgis.plugin',
      colunas: ['nome', 'versao_minima'],
      linhas: plugins,
      usuarioUuid,
      contexto
    })
  )
}

controller.atualizaPlugins = async (plugins, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    atualizarVarios(t, {
      tabela: 'qgis.plugin',
      colunas: ['nome', 'versao_minima'],
      linhas: plugins,
      nomeAmigavel: 'Plugin',
      usuarioUuid,
      contexto
    })
  )
}

controller.deletaPlugins = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    apagarVarios(t, {
      tabela: 'qgis.plugin',
      ids,
      nomeAmigavel: 'Plugin',
      usuarioUuid,
      contexto
    })
  )
}

controller.getAtalhos = async () => {
  return db.conn.any(
    'SELECT id, ferramenta, idioma, atalho FROM qgis.qgis_shortcuts ORDER BY idioma, ferramenta'
  )
}

/**
 * O `owner` de `qgis.qgis_shortcuts` e o LOGIN de quem publicou.
 *
 * A coluna nao virou o par `usuario_cadastramento_uuid`/`data_cadastramento` do
 * resto do SCA, e a razao esta em `er/qgis.sql`: `owner` e `update_time` sao
 * LIDAS PELO NOME pelo plugin do QGIS e pelo SAP Gerente, que sao clientes
 * compilados fora deste repositorio. O SAP gravava ali o posto mais o nome de
 * guerra; aqui vai o LOGIN, que e o identificador estavel -- a promocao muda o
 * posto e nao muda quem publicou.
 */
const loginDe = async (t, usuarioUuid) => {
  const usuario = await t.oneOrNone(
    'SELECT login FROM dgeo.usuario WHERE uuid = $<usuarioUuid>',
    { usuarioUuid }
  )
  if (!usuario) {
    throw new AppError('Usuário não encontrado', httpCode.BadRequest)
  }
  return usuario.login
}

controller.gravaAtalhos = async (atalhos, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const owner = await loginDe(t, usuarioUuid)
    return inserirVarios(t, {
      tabela: 'qgis.qgis_shortcuts',
      colunas: ['ferramenta', 'idioma', 'atalho', 'owner'],
      linhas: atalhos.map(a => ({ ...a, owner })),
      usuarioUuid,
      contexto
    })
  })
}

controller.atualizaAtalhos = async (atalhos, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const owner = await loginDe(t, usuarioUuid)
    return atualizarVarios(t, {
      tabela: 'qgis.qgis_shortcuts',
      colunas: ['ferramenta', 'idioma', 'atalho', 'owner'],
      linhas: atalhos.map(a => ({ ...a, owner })),
      nomeAmigavel: 'Atalho',
      usuarioUuid,
      contexto,
      carimboQgis: true
    })
  })
}

controller.deletaAtalhos = async (ids, usuarioUuid, contexto) => {
  return db.conn.tx(t =>
    apagarVarios(t, {
      tabela: 'qgis.qgis_shortcuts',
      ids,
      nomeAmigavel: 'Atalho',
      usuarioUuid,
      contexto
    })
  )
}

controller.getPluginPath = async () => {
  return db.conn.one('SELECT path FROM qgis.plugin_path WHERE code = 1')
}

controller.atualizaPluginPath = async (caminho, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t,
      'qgis.plugin_path',
      1,
      'Caminho do plugin',
      'code'
    )

    const depois = await t.one(
      'UPDATE qgis.plugin_path SET path = $<caminho> WHERE code = 1 RETURNING *',
      { caminho }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'qgis.plugin_path',
      registroId: 1,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })
  })
}

// --- Views de acompanhamento -------------------------------------------------

/**
 * As views materializadas do acompanhamento, com a credencial de LEITURA.
 *
 * A CREDENCIAL SAI NA RESPOSTA, e isso ja e a pratica da casa: e o mesmo que
 * `GET /api/acervo/camadas_produto` faz, porque o QGIS conecta DIRETO no
 * PostgreSQL para desenhar a camada e nao passa por rota nenhuma. Por isso o
 * papel `DB_USER_READONLY` existe. Nada disso e valor de arquivo versionado: sao
 * chaves do `server/config.env`, que e gitignored.
 *
 * O NOME DA VIEW MUDOU, e a leitura tem de mudar junto: o SAP publicava
 * `lote_<N>`, com N um `macrocontrole.lote.id`. Aqui sao
 * `lote_<L>_linha_<P>` e `lote_<L>_subfase_<S>`, com L um `acervo.lote.id` --
 * um lote do acervo atravessa linhas de producao, e o nome antigo colidiria
 * consigo mesmo. Ver `docs/decisoes.md`.
 *
 * `EM ANDAMENTO` E `Em execução` (code 2 de `dominio.tipo_status_execucao`), e
 * nao o code 1 do `dominio.status` do SAP: la o 1 era "Em andamento" e aqui o 1
 * e "Não iniciado". Trocar o numero sem trocar o sentido faria o filtro devolver
 * exatamente os lotes que ele existe para esconder.
 *
 * A CONSULTA USA `[0-9]` E NAO `\d`, e nao e estilo. Duas contrabarras seguidas
 * de letra sao lidas como caminho UNC pelo guard `scripts/check_vazamento.py`,
 * que roda no pre-commit deste repositorio publico: a consulta funcionaria e o
 * commit nao passaria. `[0-9]` diz o mesmo sem contrabarra nenhuma, e de quebra
 * dispensa a dobra que o JavaScript exige antes de o Postgres ver a string.
 */
/**
 * A credencial de LEITURA do banco, para o SAP Gerente montar URI de camada.
 *
 * FONTE UNICA das duas rotas que a publicam: esta e `GET /view_acompanhamento`,
 * logo abaixo. Duas montagens do mesmo bloco divergiriam no dia em que uma
 * chave nova entrasse, e a que ficasse para tras entregaria conexao quebrada
 * sem erro nenhum aqui.
 *
 * NAO E CONSULTA AO BANCO: sao chaves de `server/config.env`, que e gitignored.
 * A funcao e `async` mesmo assim para as duas chamadas terem a mesma forma e
 * para o dia em que a credencial passar a sair de outro lugar.
 */
controller.getCredencialLeitura = async () => {
  return {
    nome_db: DB_NAME,
    servidor: DB_SERVER,
    porta: DB_PORT,
    login: DB_USER_READONLY || DB_USER,
    senha: DB_PASSWORD_READONLY || DB_PASSWORD,
    schema: 'acompanhamento'
  }
}

controller.getViewsAcompanhamento = async (
  emAndamentoProjeto,
  emAndamentoLote,
  blocoId
) => {
  const filtroBloco = blocoId
    ? `AND EXISTS (
         SELECT 1 FROM producao.unidade_trabalho AS ut
          WHERE ut.lote_id = l.id AND ut.bloco_id = $<blocoId>
       )`
    : ''

  const views = await db.conn.any(
    `SELECT foo.schema, foo.nome, foo.tipo,
            l.id AS lote_id, l.nome AS lote, l.status_execucao_id AS lote_status,
            p.nome AS projeto, p.status_execucao_id AS projeto_status
       FROM (
         SELECT 'acompanhamento' AS schema,
                mat.matviewname AS nome,
                CASE WHEN mat.matviewname ~ '_subfase_' THEN 'subfase'
                     ELSE 'lote' END AS tipo,
                SUBSTRING(mat.matviewname FROM '^lote_([0-9]+)')::bigint AS lote_id
           FROM pg_matviews AS mat
          WHERE mat.schemaname = 'acompanhamento'
            AND mat.matviewname ~ '^lote_[0-9]+_(linha|subfase)_[0-9]+$'
       ) AS foo
       INNER JOIN acervo.lote AS l ON l.id = foo.lote_id
       INNER JOIN acervo.projeto AS p ON p.id = l.projeto_id
      WHERE TRUE ${filtroBloco}
      ORDER BY foo.nome`,
    { blocoId }
  )

  const filtradas = views.filter(
    v =>
      (!emAndamentoProjeto || v.projeto_status === STATUS_EXECUCAO.EM_EXECUCAO) &&
      (!emAndamentoLote || v.lote_status === STATUS_EXECUCAO.EM_EXECUCAO)
  )

  // A VIEW DE BLOCO NAO TEM LOTE, e por isso ela nao entra na consulta acima: ela
  // e uma so no banco inteiro (`acompanhamento.bloco`) e atravessa todos os
  // lotes. Ela e acrescentada aqui, e nao por UNION, para nao ter de inventar um
  // `lote_status` que a faca sobreviver aos dois filtros.
  const bloco = await db.conn.oneOrNone(
    `SELECT 'acompanhamento' AS schema, matviewname AS nome, 'bloco' AS tipo
       FROM pg_matviews
      WHERE schemaname = 'acompanhamento' AND matviewname = 'bloco'`
  )

  return {
    // A MESMA FONTE de `GET /banco_dados`, e nao um segundo bloco escrito aqui.
    banco_dados: await controller.getCredencialLeitura(),
    views: bloco ? [...filtradas, bloco] : filtradas
  }
}

/**
 * Refaz TODAS as views materializadas do acompanhamento, de uma vez.
 *
 * ELA NAO E O CAMINHO NORMAL, e sim a rede: os gatilhos de
 * `er/acompanhamento_producao.sql` ja refazem a view a cada atividade, unidade
 * de trabalho, etapa, subfase, fase e versao que mudam. Esta rota existe para
 * depois de uma carga em massa, para o dia em que alguem escreveu por `psql`, e
 * para o lote que acabou de ganhar a primeira etapa.
 *
 * `CONCURRENTLY` porque a view fica LEGIVEL durante o refresh: sem isso o
 * gerente que estivesse com a camada aberta no QGIS veria a consulta travar. As
 * views nascem com indice unico por `id` dentro das proprias funcoes de criacao,
 * que e o que o CONCURRENTLY exige.
 *
 * SO O SCHEMA `acompanhamento`. As views materializadas do ACERVO
 * (`acervo.mv_produto_*`) tem rota propria e sao de administrador; refaze-las de
 * carona aqui misturaria duas decisoes e daria ao gerente da producao um botao
 * que mexe no acervo.
 */
controller.refreshViews = async (usuarioUuid, contexto) => {
  const alvos = await db.conn.any(
    `SELECT schemaname, matviewname
       FROM pg_matviews
      WHERE schemaname = 'acompanhamento'
      ORDER BY matviewname`
  )

  for (const alvo of alvos) {
    await db.conn.none(
      'REFRESH MATERIALIZED VIEW CONCURRENTLY $<schema:name>.$<view:name>',
      { schema: alvo.schemaname, view: alvo.matviewname }
    )
  }

  const resultado = {
    views_atualizadas: alvos.length,
    views: alvos.map(a => `${a.schemaname}.${a.matviewname}`)
  }

  // O RASTRO E DE OPERACAO, e nao de linha: nao ha antes e depois a comparar, e
  // a pergunta que isto produz na pratica e "quem mandou rodar, e quando". A
  // chave e uma PSEUDO-TABELA, pelo mesmo motivo de `acervo.mv_produto`: sao
  // dezenas de views com nome gerado, e escolher uma para representar a operacao
  // seria arbitrario.
  await db.conn.tx(t =>
    auditoriaCtrl.registrarOperacao(t, {
      tabela: 'acompanhamento.view_producao',
      resultado,
      usuarioUuid,
      contexto
    })
  )

  return resultado
}

// ---------------------------------------------------------------------------
// A PERMISSAO NO BANCO DE PRODUCAO
// ---------------------------------------------------------------------------
//
// AS TRES ROTAS QUE FALTAVAM. Elas eram as unicas do SAP 2.3.5 que mexem em
// OUTRO PostgreSQL, e por isso ficaram para a leva que trouxe
// `producao.login_temporario` inteiro. O subsistema mora em
// `database/permissoes_producao.js`; aqui so entram as tres perguntas que a tela
// da gerencia faz.
//
// O QUE CADA UMA E PARA:
//
//   revogar do BANCO      o banco de edicao vai sair do ar, ou foi restaurado de
//                         backup, ou ninguem deveria ter acesso a ele agora.
//                         Alcanca so os papeis efemeros deste sistema -- ver
//                         `sql/revogar_temporarios.sql`, onde a divergencia em
//                         relacao a origem esta escrita.
//   revogar de UMA PESSOA a pessoa saiu da secao, ou pediu-se a folha de volta.
//                         Nao depende de haver atividade: quem depende disso e a
//                         revogacao automatica da finalizacao.
//   REAPLICAR             o cadastro da subfase mudou no meio do trabalho, e
//                         quem esta em execucao ficou com a permissao velha.
//
// A INDISPONIBILIDADE DO BANCO DE PRODUCAO CHEGA COMO 503, e nao 500: o defeito
// nao e deste servico. E o mesmo desenho do banco da telemetria, e a traducao
// acontece em `conexao_admin.js`, que e tambem onde o endereco morre.

controller.revogarPermissoesBanco = async (dadoProducaoId, usuarioUuid, contexto) =>
  permissoesProducao.revogarTodosDoBanco({
    dadoProducaoId,
    quemPediu: usuarioUuid,
    contexto
  })

controller.revogarPermissoesUsuario = async (
  dadoProducaoId, alvoUuid, usuarioUuid, contexto
) =>
  permissoesProducao.revogarUsuarioDoBanco({
    dadoProducaoId,
    usuarioUuid: alvoUuid,
    quemPediu: usuarioUuid,
    contexto
  })

controller.reaplicarPermissoes = async (usuarioUuid, contexto) =>
  permissoesProducao.reaplicarEmExecucao({ quemPediu: usuarioUuid, contexto })

module.exports = controller
