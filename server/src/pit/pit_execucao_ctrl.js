'use strict'

// Execução mensal das metas do PIT: o que alimenta a subseção 2.1 do RPCMTec.
//
// TUDO É LANÇADO À MÃO (chefe, 2026-08-02). No SAP a régua é `lote_id IS NULL`:
// a meta de produção tem o realizado calculado das atividades, e só o resto se
// digita. Aqui não existe essa régua, porque enquanto o SAP não for absorvido
// não há de onde calcular. Quando ele entrar, é este arquivo que ganha o
// caminho automático.
//
// O CUSTO ESTÁ ACEITO e vale repetir onde alguém vai ler: a meta 4 (impressão)
// o SCA JÁ sabe somar, porque `mapoteca.pedido.meta_pit_id` liga o pedido à
// meta, e é disso que sai o META4_DETALHADA do RTM. O número digitado aqui pode
// divergir do calculado lá, e quando divergir a 2.1 e o RTM do mesmo mês vão se
// contradizer.
//
// SÓ A FOLHA RECEBE LANÇAMENTO. Uma meta que se subdivide tem uma linha de
// cabeçalho (`item` nulo) e uma linha por item; quem entrega é o item. Deixar
// lançar no cabeçalho faria o total da meta ser contado duas vezes, uma na
// soma dos itens e outra no cabeçalho, e nada acusaria -- as duas contas
// continuariam "certas" cada uma por si. A meta indivisa (cabeçalho sem itens)
// É folha, e recebe.

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const { auditoriaCtrl } = require('../auditoria')

const controller = {}

// A condição de FOLHA, escrita uma vez. `m` é o apelido da meta na consulta que
// a usa; repeti-la em três consultas é onde a divergência nasceria.
const EH_FOLHA = `(
  m.item IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM pit.meta AS f
    WHERE f.ano = m.ano AND f.numero_meta = m.numero_meta AND f.item IS NOT NULL
  )
)`

/**
 * A grade de lançamento de UM mês: toda meta-folha do ano com o que já foi
 * lançado naquele mês, e nulo no que ainda não foi.
 *
 * Devolve as metas mesmo sem lançamento nenhum, de propósito: a tela é de
 * PREENCHIMENTO, e uma lista que só mostra o que já existe não diz o que falta.
 */
controller.listarDoMes = async (ano, mes) => {
  return db.conn.any(
    `SELECT m.id AS meta_id, m.numero_meta, m.item, m.descricao,
            m.unidade, m.demandante, m.quantidade_prevista,
            m.prazo::text AS prazo,
            e.id AS execucao_id, e.quantidade,
            e.data_conclusao::text AS data_conclusao, e.observacao
     FROM pit.meta AS m
     LEFT JOIN pit.execucao AS e ON e.meta_id = m.id AND e.mes = $<mes>
     WHERE m.ano = $<ano> AND ${EH_FOLHA}
     ORDER BY m.numero_meta, m.item NULLS FIRST`,
    { ano, mes }
  )
}

/**
 * O estado das metas do ano: previsto, realizado e percentual.
 *
 * UMA função para a tela e para o relatório, pelo mesmo motivo que `gerar()` do
 * RPCMTec devolve as células já em texto: com duas contas, a tela e o DOCX
 * divergem no arredondamento e quem confere um contra o outro vê diferença onde
 * não há.
 *
 * O `mes` recorta o ACUMULADO. Sem ele, o realizado é o ano inteiro (é o que a
 * tela mostra) e `realizado_mes` vem nulo. Com ele, `realizado` é a soma de
 * janeiro até aquele mês e `realizado_mes` é só daquele mês, que são exatamente
 * as duas colunas da 2.1 ("Prontos no mês" e "Prontos").
 *
 * O cabeçalho da meta ENTRA no resultado, e sem números próprios: ele é o texto
 * que abre o bloco no documento. Somar os itens nele seria inventar uma linha
 * de total que o modelo não tem.
 */
controller.resumoDoAno = async (ano, mes) => {
  return db.conn.any(
    `SELECT m.id AS meta_id, m.ano, m.numero_meta, m.item, m.descricao,
            m.unidade, m.demandante, m.quantidade_prevista,
            m.prazo::text AS prazo,
            ${EH_FOLHA} AS folha,
            COALESCE(SUM(e.quantidade) FILTER (
              WHERE $<mes>::smallint IS NULL OR e.mes <= $<mes>::smallint
            ), 0)::int AS realizado,
            CASE WHEN $<mes>::smallint IS NULL THEN NULL
                 ELSE COALESCE(SUM(e.quantidade) FILTER (WHERE e.mes = $<mes>::smallint), 0)::int
            END AS realizado_mes
     FROM pit.meta AS m
     LEFT JOIN pit.execucao AS e ON e.meta_id = m.id
     WHERE m.ano = $<ano>
     GROUP BY m.id
     ORDER BY m.numero_meta, m.item NULLS FIRST`,
    { ano, mes: mes === undefined ? null : mes }
  )
}

/** Os lançamentos de UMA meta, mês a mês. É o que a ficha da meta mostra. */
controller.listarDaMeta = async metaId => {
  return db.conn.any(
    `SELECT id, meta_id, mes, quantidade,
            data_conclusao::text AS data_conclusao, observacao,
            data_cadastramento, usuario_cadastramento_uuid,
            data_modificacao, usuario_modificacao_uuid
     FROM pit.execucao
     WHERE meta_id = $<metaId>
     ORDER BY mes`,
    { metaId }
  )
}

/**
 * Grava o realizado de uma meta num mês: cria a célula ou atualiza a que existe.
 *
 * NÃO É `ON CONFLICT DO UPDATE`, e a razão é o rastro. O upsert do banco grava
 * certo e não sabe dizer se criou ou alterou, e a trilha precisa da diferença:
 * "lançou 12 em março" e "trocou 12 por 30 em março" são fatos distintos, e o
 * segundo só existe se o `dados_antes` for lido. Duas idas ao banco numa
 * transação, contra uma que perde a informação.
 */
controller.salvar = async (dados, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const meta = await t.oneOrNone(
      'SELECT id, ano, numero_meta, item FROM pit.meta WHERE id = $<metaId>',
      { metaId: dados.meta_id }
    )
    if (!meta) {
      throw new AppError('Meta do PIT não encontrada', httpCode.NotFound)
    }

    // Cabeçalho de meta subdividida não recebe lançamento (ver o topo).
    if (meta.item === null) {
      const { tem } = await t.one(
        `SELECT EXISTS (
           SELECT 1 FROM pit.meta
           WHERE ano = $<ano> AND numero_meta = $<numeroMeta> AND item IS NOT NULL
         ) AS tem`,
        { ano: meta.ano, numeroMeta: meta.numero_meta }
      )
      if (tem) {
        throw new AppError(
          `A Meta ${meta.numero_meta} se divide em itens, e o lançamento é feito em cada item. O total da meta é a soma deles.`,
          httpCode.BadRequest
        )
      }
    }

    const antes = await t.oneOrNone(
      'SELECT * FROM pit.execucao WHERE meta_id = $<metaId> AND mes = $<mes>',
      { metaId: dados.meta_id, mes: dados.mes }
    )

    const valores = {
      metaId: dados.meta_id,
      mes: dados.mes,
      quantidade: dados.quantidade,
      dataConclusao: dados.data_conclusao === undefined ? null : dados.data_conclusao,
      observacao: dados.observacao === undefined ? null : dados.observacao,
      usuarioUuid
    }

    if (antes) {
      const depois = await t.one(
        `UPDATE pit.execucao
         SET quantidade = $<quantidade>, data_conclusao = $<dataConclusao>,
             observacao = $<observacao>,
             data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        { ...valores, id: antes.id, dataModificacao: new Date() }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'pit.execucao',
        registroId: antes.id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })

      return { id: antes.id }
    }

    const criada = await t.one(
      `INSERT INTO pit.execucao
         (meta_id, mes, quantidade, data_conclusao, observacao, usuario_cadastramento_uuid)
       VALUES ($<metaId>, $<mes>, $<quantidade>, $<dataConclusao>, $<observacao>, $<usuarioUuid>)
       RETURNING *`,
      valores
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.execucao',
      registroId: criada.id,
      operacao: 'I',
      depois: criada,
      usuarioUuid,
      contexto
    })

    return { id: criada.id }
  })
}

controller.deletar = async (id, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const antes = await auditoriaCtrl.lerAntes(
      t, 'pit.execucao', id, 'Lançamento de execução do PIT'
    )

    await t.none('DELETE FROM pit.execucao WHERE id = $<id>', { id })

    await auditoriaCtrl.registrar(t, {
      tabela: 'pit.execucao',
      registroId: id,
      operacao: 'D',
      antes,
      usuarioUuid,
      contexto
    })
  })
}

module.exports = controller
