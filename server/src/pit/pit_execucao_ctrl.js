'use strict'

// O MÊS de cada meta do PIT: o que ela planejou entregar e o que entregou.
//
// UMA GRADE, e não duas (chefe, 2026-08-02). A planilha que a Divisão preenche
// tem duas abas, PLANEJ_PIT e EXEC_PIT, com as MESMAS linhas, as mesmas doze
// colunas de mês e a mesma quantidade anual. A única diferença entre elas é qual
// dos dois números a célula guarda, e por isso os dois moram na mesma linha:
// separá-los deixaria a comparação, que é a razão de as duas existirem, a um
// JOIN de distância.
//
// TUDO É LANÇADO À MÃO (chefe, 2026-08-02). No SAP a régua é `lote_id IS NULL`:
// a meta de produção tem o realizado calculado das atividades, e só o resto se
// digita. Aqui não existe essa régua, porque enquanto o SAP não for absorvido
// não há de onde calcular. Quando ele entrar, é este arquivo que ganha o
// caminho automático.
//
// O CUSTO ESTÁ ACEITO e vale repetir onde alguém vai ler: a meta 4 (impressão) o
// SCA JÁ sabe somar, porque `mapoteca.pedido.meta_pit_id` liga o pedido à meta,
// e é disso que sai o META4_DETALHADA do RTM. O número digitado aqui pode
// divergir do calculado lá, e quando divergir a 2.1 e o RTM do mesmo mês vão se
// contradizer.
//
// SÓ A FOLHA RECEBE LANÇAMENTO. Uma meta que se subdivide tem uma linha de
// cabeçalho (`item` nulo) e uma linha por item, e quem entrega é o item. Deixar
// lançar no cabeçalho faria o total da meta ser contado duas vezes, uma na soma
// dos itens e outra no cabeçalho, e nada acusaria -- as duas contas continuariam
// "certas" cada uma por si. A meta indivisa (cabeçalho sem itens) É folha.
//
// NULO E ZERO SÃO COISAS DIFERENTES nos dois números: nulo é "ninguém lançou" e
// zero é "conferi e não houve". Enquanto a linha só existia para o realizado, a
// ausência dela dizia isso; agora que ela nasce no começo do ano para guardar o
// plano, quem carrega o recado é o nulo.

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
 * A GRADE do ano: uma linha por meta, com os doze meses e os dois números de
 * cada um.
 *
 * O CABEÇALHO DA META ENTRA no resultado, com `folha = false` e sem meses. Ele é
 * o texto que abre o bloco na tela e no documento, e a tela soma os itens dele.
 * Somá-lo no servidor criaria um total que só existe aqui, e a soma da tela e a
 * do relatório passariam a ser duas.
 *
 * Os meses saem como OBJETO indexado pelo número do mês, e não como doze
 * colunas: doze colunas repetidas para dois números cada dariam vinte e quatro
 * campos na resposta e um `mes_04_planejado` que ninguém consegue percorrer.
 */
controller.grade = async ano => {
  return db.conn.any(
    `SELECT m.id AS meta_id, m.ano, m.numero_meta, m.item, m.descricao,
            m.unidade, m.demandante, m.quantidade_prevista,
            m.prazo::text AS prazo,
            ${EH_FOLHA} AS folha,
            COALESCE(mes.lista, '[]'::json) AS meses,
            COALESCE(tot.realizado, 0) AS realizado,
            COALESCE(tot.planejado, 0) AS planejado
     FROM pit.meta AS m
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
                'id', x.id,
                'mes', x.mes,
                'planejada', x.quantidade_planejada,
                'realizada', x.quantidade,
                'data_conclusao', x.data_conclusao::text,
                'observacao', x.observacao
              ) ORDER BY x.mes) AS lista
       FROM pit.execucao AS x
       WHERE x.meta_id = m.id
     ) AS mes ON TRUE
     -- Os totais saem de um LATERAL, e nao de GROUP BY. Agrupar exigiria a
     -- coluna dos meses na clausula, e o PostgreSQL nao sabe comparar json por
     -- igualdade: o erro chega como "nao pode identificar um operador de
     -- igualdade para tipo json", que nao diz nada sobre a causa.
     -- (Sem crase neste comentario: ele vive dentro de um template literal.)
     LEFT JOIN LATERAL (
       SELECT SUM(t.quantidade)::int AS realizado,
              SUM(t.quantidade_planejada)::int AS planejado
       FROM pit.execucao AS t
       WHERE t.meta_id = m.id
     ) AS tot ON TRUE
     WHERE m.ano = $<ano>
     ORDER BY m.numero_meta, m.item NULLS FIRST`,
    { ano }
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
 * O `mes` recorta o ACUMULADO. Sem ele, o realizado é o ano inteiro; com ele,
 * `realizado` é a soma de janeiro até aquele mês e `realizado_mes` é só daquele
 * mês, que são exatamente as duas colunas da 2.1 ("Prontos no mês" e "Prontos").
 * `planejado_ate` acompanha, e é o que diz se a meta está no ritmo.
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
            END AS realizado_mes,
            -- Quanto o PLANO mandava ter entregue até aqui. É o que separa
            -- "entregou 30 de 252" de "entregou 30 onde o plano pedia 30".
            COALESCE(SUM(e.quantidade_planejada) FILTER (
              WHERE $<mes>::smallint IS NULL OR e.mes <= $<mes>::smallint
            ), 0)::int AS planejado_ate
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
    `SELECT id, meta_id, mes, quantidade_planejada, quantidade,
            data_conclusao::text AS data_conclusao, observacao,
            data_cadastramento, usuario_cadastramento_uuid,
            data_modificacao, usuario_modificacao_uuid
     FROM pit.execucao
     WHERE meta_id = $<metaId>
     ORDER BY mes`,
    { metaId }
  )
}

// Os quatro campos que fazem a linha existir. Com os quatro nulos ela não diz
// nada, e o banco a recusa pelo CHECK `execucao_diz_alguma_coisa`.
const vazia = linha =>
  linha.quantidade_planejada == null &&
  linha.quantidade == null &&
  linha.data_conclusao == null &&
  (linha.observacao == null || linha.observacao === '')

/**
 * Grava UMA célula da grade: o par (meta, mês).
 *
 * NÃO É `ON CONFLICT DO UPDATE`, e a razão é o rastro. O upsert do banco grava
 * certo e não sabe dizer se criou ou alterou, e a trilha precisa da diferença:
 * "lançou 12 em março" e "trocou 12 por 30 em março" são fatos distintos, e o
 * segundo só existe se o `dados_antes` for lido.
 *
 * OMITIR UM CAMPO É NÃO MEXER NELE, e mandá-lo nulo é APAGÁ-LO. É o que permite
 * a grade lançar o realizado sem carregar o plano junto, e o contrário: os dois
 * modos escrevem na mesma linha e nenhum limpa o do outro.
 *
 * Quando a célula fica sem nenhum dos quatro, a linha é APAGADA em vez de
 * guardada vazia. Sem isso o CHECK do banco recusaria a limpeza com um 500 cru.
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

    // Omitido mantém o que está gravado; presente (mesmo nulo) substitui.
    const campo = (nome, atual) =>
      (nome in dados ? (dados[nome] === '' ? null : dados[nome]) : atual)

    const linha = {
      quantidade_planejada: campo('quantidade_planejada', antes ? antes.quantidade_planejada : null),
      quantidade: campo('quantidade', antes ? antes.quantidade : null),
      data_conclusao: campo('data_conclusao', antes ? antes.data_conclusao : null),
      observacao: campo('observacao', antes ? antes.observacao : null)
    }

    if (vazia(linha)) {
      if (!antes) return { id: null }

      await t.none('DELETE FROM pit.execucao WHERE id = $<id>', { id: antes.id })
      await auditoriaCtrl.registrar(t, {
        tabela: 'pit.execucao',
        registroId: antes.id,
        operacao: 'D',
        antes,
        usuarioUuid,
        contexto
      })
      return { id: null }
    }

    if (antes) {
      const depois = await t.one(
        `UPDATE pit.execucao
         SET quantidade_planejada = $<quantidade_planejada>, quantidade = $<quantidade>,
             data_conclusao = $<data_conclusao>, observacao = $<observacao>,
             data_modificacao = $<dataModificacao>, usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        { ...linha, id: antes.id, dataModificacao: new Date(), usuarioUuid }
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
         (meta_id, mes, quantidade_planejada, quantidade, data_conclusao,
          observacao, usuario_cadastramento_uuid)
       VALUES ($<metaId>, $<mes>, $<quantidade_planejada>, $<quantidade>,
               $<data_conclusao>, $<observacao>, $<usuarioUuid>)
       RETURNING *`,
      { ...linha, metaId: dados.meta_id, mes: dados.mes, usuarioUuid }
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
      t, 'pit.execucao', id, 'Lançamento do mês'
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
