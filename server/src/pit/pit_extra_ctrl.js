'use strict'

// Demanda Extra-PIT: a subseção 3.3 do RPCMTec.
//
// O QUE ELA É, e o que ela não é. O relatório não chama de Extra-PIT todo
// trabalho fora do plano: chama a exceção AUTORIZADA, e o modelo tem uma coluna
// "Documento autorização" para provar. É por isso que `documento_autorizacao` é
// obrigatório aqui, e é exatamente o que faltava quando o SCA tentou derivar a
// 3.3 de `mapoteca.pedido.previsto_pit`: aquele campo é falso por omissão, e a
// conta deu 23 linhas onde a edição real de julho/2026 traz 1.
//
// MORA NO SCHEMA `pit` porque é a exceção AO PIT, e só se lê ao lado dele.
//
// Veio do SAP em 2026-08-02 (`macrocontrole.extra_pit`) sem o `lote_id`: lá ele
// serve para a 2.1 não contar duas vezes o mesmo trabalho, e aqui não há o que
// descontar, porque a 2.1 do SCA soma o que foi lançado em `pit.execucao` e o
// Extra-PIT não é lançado lá.

// A MATERIALIZAÇÃO (2026-08-03). O chefe fechou a definição: "se fosse só
// entrega entraria na mapoteca, o Extra-PIT é a PRODUÇÃO". A demanda de origem
// Produção só fecha quando existe versão no acervo apontando para ela.
//
// O vínculo mora em `acervo.versao.demanda_extra_id`, exclusivo com
// `meta_pit_id`, e não no lote. Foi medido: o lote 2026-1a tem seis cartas
// topográficas, quatro da meta 1.1 e duas (2966-1-NE e 2966-1-SE) das demandas
// do CMS para a Op. Arandu. A produção Extra-PIT mora DENTRO de um lote do PIT.

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { auditoriaCtrl } = require('../auditoria')

const controller = {}

// Situações que AFIRMAM que a demanda saiu: Enviado (3) e Concluído (4).
const SITUACOES_QUE_AFIRMAM_ENTREGA = [3, 4]
const ORIGEM_PRODUCAO = 3

// CALCULADA NA LEITURA, nunca gravada. Mesma doutrina da grade do PIT: número
// derivado que se grava vira segunda verdade no primeiro que editar a cópia à
// mão. Sai zero para a demanda Manual, e é o que se espera dela.
const QUANTIDADE_MATERIALIZADA = `(
    SELECT count(*)::int FROM acervo.versao AS v
    WHERE v.demanda_extra_id = d.id
  ) AS quantidade_materializada`

const colunas = `d.id, d.ano, d.demandante, d.tipo_produto, d.quantidade,
  d.situacao_id, s.nome AS situacao, d.origem_id, o.nome AS origem,
  d.documento_autorizacao, d.descricao,
  d.data_entrega::text AS data_entrega,
  ${QUANTIDADE_MATERIALIZADA},
  d.data_cadastramento, d.usuario_cadastramento_uuid,
  d.data_modificacao, d.usuario_modificacao_uuid`

// A situação sai por JOIN, e não traduzida no cliente: a mesma lista serve à
// tela, ao RPCMTec e ao CLI, e três traduções do mesmo código divergiriam. A
// origem reusa `dominio.origem_meta` pela mesma razão: um domínio próprio
// criaria um segundo código chamado 'Produção'.
const de = `FROM pit.demanda_extra AS d
  INNER JOIN dominio.situacao_extra_pit AS s ON s.code = d.situacao_id
  INNER JOIN dominio.origem_meta AS o ON o.code = d.origem_id`

controller.listar = async ano => {
  if (ano !== undefined && ano !== null) {
    return db.conn.any(
      `SELECT ${colunas} ${de}
       WHERE d.ano = $<ano>
       ORDER BY d.demandante, d.tipo_produto`,
      { ano }
    )
  }

  return db.conn.any(
    `SELECT ${colunas} ${de}
     ORDER BY d.ano DESC, d.demandante, d.tipo_produto`
  )
}

controller.getPorId = async id => {
  return db.conn.oneOrNone(
    `SELECT ${colunas} ${de} WHERE d.id = $<id>`,
    { id }
  )
}

// Os anos com demanda cadastrada, para a tela montar o filtro sem adivinhar um
// intervalo. Mesmo desenho de `pitCtrl.anos`.
controller.anos = async () => {
  const linhas = await db.conn.any(
    'SELECT DISTINCT ano FROM pit.demanda_extra ORDER BY ano DESC'
  )
  return linhas.map(l => l.ano)
}

const paraBanco = (dados, usuarioUuid) => ({
  ano: dados.ano,
  demandante: dados.demandante,
  tipoProduto: dados.tipo_produto,
  quantidade: dados.quantidade,
  situacaoId: dados.situacao_id,
  // Ausente vira Manual, que é o DEFAULT da coluna e o comportamento de sempre.
  // Assim o cliente que ainda não conhece o campo não muda nada ao editar.
  origemId: dados.origem_id === undefined ? 1 : dados.origem_id,
  documentoAutorizacao: dados.documento_autorizacao,
  descricao: dados.descricao === undefined ? null : dados.descricao,
  dataEntrega: dados.data_entrega === undefined ? null : dados.data_entrega,
  usuarioUuid
})

// A demanda de PRODUÇÃO não fecha sem materializar. É a regra que o chefe pediu
// em 2026-08-03, e ela vale para Enviado e para Concluído: as duas afirmam que
// alguma coisa saiu daqui.
//
// A régua é "pelo menos uma versão", e NÃO `materializada >= quantidade`. A
// `quantidade` da 3.3 muda de unidade por linha: a demanda 6 de 2026 promete 74
// (as MIs cobertas pelo mosaico) e tem 26 versões, e a exigência de igualdade
// travaria um fechamento legítimo. A tela mostra 26 de 74, e quem lê decide.
//
// LÊ DO BANCO, e não do corpo: o número de versões é a única prova que existe, e
// ela não vem de quem está editando.
const conferirMaterializacao = async (t, dados, id) => {
  if (dados.origemId !== ORIGEM_PRODUCAO) return
  if (!SITUACOES_QUE_AFIRMAM_ENTREGA.includes(dados.situacaoId)) return

  const { materializada } = await t.one(
    `SELECT count(*)::int AS materializada FROM acervo.versao
     WHERE demanda_extra_id = $<id>`,
    { id: id === undefined ? null : id }
  )

  if (materializada > 0) return

  throw new AppError(
    'A demanda tem origem Produção, e nenhuma versão do acervo aponta para ' +
    'ela. O Extra-PIT é produção: cadastre a demanda como Previsto ou Em ' +
    'produção, ligue as versões que a cumprem e só então feche.',
    httpCode.BadRequest
  )
}

controller.criar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const linha = paraBanco(dados, usuarioUuid)

    // Na criação a conta dá zero sempre, porque não há id para as versões
    // apontarem ainda. É deliberado: nascer Concluída em origem Produção seria
    // afirmar entrega sem nenhuma prova. O caminho é criar, ligar, fechar.
    await conferirMaterializacao(t, linha, undefined)

    const criada = await t.one(
      `INSERT INTO pit.demanda_extra
         (ano, demandante, tipo_produto, quantidade, situacao_id, origem_id,
          documento_autorizacao, descricao, data_entrega, usuario_cadastramento_uuid)
       VALUES ($<ano>, $<demandante>, $<tipoProduto>, $<quantidade>, $<situacaoId>,
               $<origemId>, $<documentoAutorizacao>, $<descricao>, $<dataEntrega>,
               $<usuarioUuid>)
       RETURNING *`,
      linha
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.demanda_extra',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    return { id: criada.id }
  })
}

controller.atualizar = async (id, dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'pit.demanda_extra', id, 'Demanda Extra-PIT'
    )

    const linha = paraBanco(dados, usuarioUuid)

    await conferirMaterializacao(t, linha, id)

    const depois = await t.one(
      `UPDATE pit.demanda_extra
       SET ano = $<ano>, demandante = $<demandante>, tipo_produto = $<tipoProduto>,
           quantidade = $<quantidade>, situacao_id = $<situacaoId>,
           origem_id = $<origemId>,
           documento_autorizacao = $<documentoAutorizacao>, descricao = $<descricao>,
           data_entrega = $<dataEntrega>,
           data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
       WHERE id = $<id>
       RETURNING *`,
      { ...linha, id, dataModificacao: new Date() }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.demanda_extra',
      registroId: id,
      operacao: 'U',
      antes,
      depois,
      usuarioUuid,
      contexto
    })

    return { id: depois.id }
  })
}

// Excluível de propósito: a demanda cancelada tem situação própria
// ('Cancelado'), e o DELETE fica para o cadastro errado.
//
// Desde 2026-08-03 `acervo.versao.demanda_extra_id` aponta para cá, e o DELETE
// passa a esbarrar nele. NÃO cascateia: apagar a demanda não pode apagar a
// versão, que é o produto. A mensagem diz quantas folhas seguram.
controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'pit.demanda_extra', id, 'Demanda Extra-PIT'
    )

    const { presas } = await t.one(
      `SELECT count(*)::int AS presas FROM acervo.versao
       WHERE demanda_extra_id = $<id>`,
      { id }
    )
    if (presas > 0) {
      throw new AppError(
        `${presas} versão(ões) do acervo materializam esta demanda e seriam ` +
        'deixadas sem origem. Desligue-as antes, ou cancele a demanda em vez ' +
        'de excluir.',
        httpCode.BadRequest
      )
    }

    await t.none('DELETE FROM pit.demanda_extra WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.demanda_extra',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
