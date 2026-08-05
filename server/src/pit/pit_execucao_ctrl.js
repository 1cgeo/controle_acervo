'use strict'

// O MÊS de cada meta do PIT: o que ela planejou entregar e o que entregou.
//
// UMA GRADE, e não duas. A planilha que a Divisão preenche tem duas abas,
// PLANEJ_PIT e EXEC_PIT, com as MESMAS linhas, as mesmas doze colunas de mês e a
// mesma quantidade anual. A única diferença entre elas é qual dos dois números a
// célula guarda, e por isso os dois moram na mesma linha: separá-los deixaria a
// comparação, que é a razão de as duas existirem, a um JOIN de distância.
//
// SÓ A FOLHA RECEBE LANÇAMENTO. Uma meta que se subdivide tem uma linha de
// cabeçalho (`item` nulo) e uma linha por item, e quem entrega é o item. Deixar
// lançar no cabeçalho faria o total da meta ser contado duas vezes, uma na soma
// dos itens e outra no cabeçalho, e nada acusaria -- as duas contas continuariam
// "certas" cada uma por si. A meta indivisa (cabeçalho sem itens) É folha.
//
// NULO E ZERO SÃO COISAS DIFERENTES nos dois números: nulo é "ninguém lançou" e
// zero é "conferi e não houve". A linha nasce no começo do ano para guardar o
// plano, então quem carrega esse recado é o nulo, e não a ausência da linha.

const { db } = require('../database')

const {
  AppError,
  httpCode,
  domainConstants: { TIPO_VERSAO, SITUACAO_CAPACITACAO }
} = require('../utils')

const { auditoriaCtrl } = require('../auditoria')

const controller = {}

// `dominio.origem_meta` (er/dominio.sql). Nao esta em `utils/domain_constants`
// porque so o PIT o le; o valor vem do DDL, e nao do rotulo da tela.
const ORIGEM_META = {
  MANUAL: 1,
  CAPACITACAO: 2,
  PRODUCAO: 3,
  IMPRESSAO: 4
}

// A condição de FOLHA, escrita uma vez. `m` é o apelido da meta na consulta que
// a usa; repeti-la em três consultas é onde a divergência nasceria.
const EH_FOLHA = `(
  m.item IS NOT NULL
  OR NOT EXISTS (
    SELECT 1 FROM pit.meta AS f
    WHERE f.ano = m.ano AND f.numero_meta = m.numero_meta AND f.item IS NOT NULL
  )
)`

// ---------------------------------------------------------------------------
// A GRADE CALCULADA
//
// A meta declara em `origem_id` de onde vem o seu numero, e quando a origem nao
// e Manual a celula deixa de ser lida de `pit.execucao` e passa a ser CONTADA na
// hora da leitura. Nada e gravado: dado derivado que se grava vira segunda
// verdade no primeiro que editar a copia a mao.
//
// QUAL COLUNA CADA ORIGEM SABE PROVAR, e esta e a parte que nao se adivinha:
//
//   Capacitacao (2)  as duas. Prevista, Em execucao e Concluida entram no
//                    planejado; so Concluida entra no realizado; Cancelada nao
//                    entra em nenhum. O mes e `data_fim` nos dois casos, e essa
//                    e a imperfeicao conhecida: a capacitacao nao tem data
//                    prevista propria, entao concluir com atraso MOVE o mes que
//                    ela havia planejado.
//
//   Producao (3)     as duas. O realizado conta a versao que ja e Regular, no
//                    mes de `data_edicao`; o planejado conta TODA versao ligada
//                    a meta cujo lote tem `data_fim_prevista`, no mes dela, e
//                    inclui de proposito a que ja virou Regular: plano nao
//                    encolhe quando se cumpre.
//
//   Impressao (4)    so o REALIZADO. A mapoteca nao planeja: a impressao e
//                    puxada por demanda. O PLANEJADO dela vem de `pit.execucao`,
//                    digitado da PLANEJ_PIT, porque nao existe no sistema quem
//                    o prove.
//
// O CALCULO NAO OLHA `origem_id`, de proposito. Ele conta para TODA meta que
// tenha vinculo, e quem escolhe entre o calculado e o digitado e a consulta que
// o consome. E isso que permite ao ensaio comparar os dois lados ANTES de virar
// a meta: filtrar aqui deixaria o ensaio cego justamente na meta que interessa,
// que e a que ainda esta Manual.
const CELULAS_CALCULADAS = `
  SELECT c.meta_id, c.mes,
         SUM(c.planejada)::int AS soma_planejada,
         SUM(c.realizada)::int AS soma_realizada
  FROM (
    -- Producao, realizado: a versao virou Regular, no mes da edicao.
    SELECT v.meta_pit_id AS meta_id,
           EXTRACT(MONTH FROM v.data_edicao)::smallint AS mes,
           NULL::int AS planejada,
           count(*)::int AS realizada
    FROM acervo.versao AS v
    INNER JOIN pit.meta AS mm ON mm.id = v.meta_pit_id
    WHERE v.tipo_versao_id = ${TIPO_VERSAO.REGULAR}
      AND EXTRACT(YEAR FROM v.data_edicao) = mm.ano
    GROUP BY 1, 2

    UNION ALL

    -- Producao, planejado: o mes prometido pelo LOTE da versao.
    SELECT v.meta_pit_id,
           EXTRACT(MONTH FROM l.data_fim_prevista)::smallint,
           count(*)::int,
           NULL::int
    FROM acervo.versao AS v
    INNER JOIN acervo.lote AS l ON l.id = v.lote_id
    INNER JOIN pit.meta AS mm ON mm.id = v.meta_pit_id
    WHERE l.data_fim_prevista IS NOT NULL
      AND EXTRACT(YEAR FROM l.data_fim_prevista) = mm.ano
    GROUP BY 1, 2

    UNION ALL

    -- Capacitacao, realizado: so a Concluida.
    SELECT cap.meta_pit_id,
           EXTRACT(MONTH FROM cap.data_fim)::smallint,
           NULL::int,
           count(*)::int
    FROM rpcmtec.capacitacao AS cap
    INNER JOIN pit.meta AS mm ON mm.id = cap.meta_pit_id
    WHERE cap.data_fim IS NOT NULL AND cap.situacao_id = ${SITUACAO_CAPACITACAO.CONCLUIDA}
      AND cap.ano = mm.ano
    GROUP BY 1, 2

    UNION ALL

    -- Capacitacao, planejado: tudo menos a Cancelada.
    SELECT cap.meta_pit_id,
           EXTRACT(MONTH FROM cap.data_fim)::smallint,
           count(*)::int,
           NULL::int
    FROM rpcmtec.capacitacao AS cap
    INNER JOIN pit.meta AS mm ON mm.id = cap.meta_pit_id
    WHERE cap.data_fim IS NOT NULL AND cap.situacao_id <> ${SITUACAO_CAPACITACAO.CANCELADA}
      AND cap.ano = mm.ano
    GROUP BY 1, 2

    UNION ALL

    -- Impressao, realizado: folha ENTREGUE, pela midia que saiu, somada pelo
    -- de-para do ano. A quantidade FORNECIDA manda sobre a pedida porque o que a
    -- meta conta e o que saiu. (Sem crase aqui: template literal.)
    SELECT dm.meta_pit_id,
           EXTRACT(MONTH FROM p.data_atendimento)::smallint,
           NULL::int,
           SUM(COALESCE(pp.quantidade_fornecida, pp.quantidade))::int
    FROM mapoteca.pedido AS p
    INNER JOIN mapoteca.produto_pedido AS pp ON pp.pedido_id = p.id
    INNER JOIN mapoteca.midia_meta_pit AS dm
            ON dm.tipo_midia_id = COALESCE(pp.tipo_midia_fornecida_id, pp.tipo_midia_id)
           AND dm.ano = EXTRACT(YEAR FROM p.data_atendimento)
    WHERE p.data_atendimento IS NOT NULL
    GROUP BY 1, 2
  ) AS c
  GROUP BY c.meta_id, c.mes
`

// Quais colunas a origem sabe provar. Escrito UMA vez: repetido em cada consulta
// e onde a divergencia nasceria no dia em que uma origem nova entrasse.
//
// AS LISTAS SAO A FONTE, e os fragmentos de SQL saem delas. A guarda de
// `salvar()` le as MESMAS listas: enquanto ela repetia [2, 3] e [2, 3, 4] a mao,
// acrescentar uma origem calculada faria a leitura ignorar o digitado e a
// escrita continuar aceitando-o, sem erro nenhum entre as duas.
const ORIGENS_CALCULAM_PLANEJADA = [ORIGEM_META.CAPACITACAO, ORIGEM_META.PRODUCAO]
const ORIGENS_CALCULAM_REALIZADA = [
  ORIGEM_META.CAPACITACAO, ORIGEM_META.PRODUCAO, ORIGEM_META.IMPRESSAO
]

const ORIGEM_CALCULA_PLANEJADA = `m.origem_id IN (${ORIGENS_CALCULAM_PLANEJADA.join(', ')})`
const ORIGEM_CALCULA_REALIZADA = `m.origem_id IN (${ORIGENS_CALCULAM_REALIZADA.join(', ')})`

// A celula EFETIVA: para cada (meta, mes) que exista de um lado ou do outro,
// escolhe entre o calculado e o digitado, coluna a coluna.
//
// A uniao dos meses vem dos DOIS lados: a meta automatica tem mes que
// `pit.execucao` nunca viu, e a meta que acabou de virar pode ter mes digitado
// que o calculo nao reproduz -- e ver esse buraco e melhor do que esconde-lo.
const CELULAS = `
  celula AS (
    SELECT ms.meta_id, ms.mes,
           CASE WHEN ${ORIGEM_CALCULA_PLANEJADA} THEN cc.soma_planejada
                ELSE e.quantidade_planejada END AS planejada,
           CASE WHEN ${ORIGEM_CALCULA_REALIZADA} THEN cc.soma_realizada
                ELSE e.quantidade END AS realizada,
           CASE WHEN m.origem_id = ${ORIGEM_META.MANUAL} THEN e.id ELSE NULL END AS id,
           e.data_conclusao, e.observacao
    FROM (
      SELECT meta_id, mes FROM pit.execucao
      UNION
      SELECT meta_id, mes FROM calculada
    ) AS ms
    INNER JOIN pit.meta_vigente AS m ON m.id = ms.meta_id
    LEFT JOIN pit.execucao AS e ON e.meta_id = ms.meta_id AND e.mes = ms.mes
    LEFT JOIN calculada AS cc ON cc.meta_id = ms.meta_id AND cc.mes = ms.mes
  )
`

// O prefixo comum das consultas que leem a grade.
const COM_CELULAS = `WITH calculada AS (${CELULAS_CALCULADAS}), ${CELULAS}`

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
    `${COM_CELULAS}
     SELECT m.id AS meta_id, m.ano, m.numero_meta, m.item, m.descricao,
            m.unidade, m.demandante, m.quantidade_prevista,
            m.prazo::text AS prazo,
            m.origem_id,
            (SELECT nome FROM dominio.origem_meta WHERE code = m.origem_id) AS origem,
            -- QUAL COLUNA A TELA NAO PODE OFERECER PARA DIGITAR.
            --
            -- A regra de quem calcula o que mora AQUI, e nao no cliente. Sem
            -- estas duas flags a tela abria o campo de digitacao em qualquer
            -- celula: a pessoa escrevia o numero e so entao a gravacao recusava.
            -- Pedir e recusar depois e pior do que nao pedir, porque o trabalho
            -- ja foi feito quando a recusa chega.
            --
            -- Sao os MESMOS fragmentos que a leitura usa para escolher entre o
            -- calculado e o digitado, entao a tela e o calculo nunca divergem.
            ${ORIGEM_CALCULA_PLANEJADA} AS planejada_calculada,
            ${ORIGEM_CALCULA_REALIZADA} AS realizada_calculada,
            m.cancelada, m.revisao, m.revisao_id,
            ${EH_FOLHA} AS folha,
            COALESCE(mes.lista, '[]'::json) AS meses,
            COALESCE(tot.realizado, 0) AS realizado,
            COALESCE(tot.planejado, 0) AS planejado
     FROM pit.meta_vigente AS m
     LEFT JOIN LATERAL (
       SELECT json_agg(json_build_object(
                'id', x.id,
                'mes', x.mes,
                'planejada', x.planejada,
                'realizada', x.realizada,
                'data_conclusao', x.data_conclusao::text,
                'observacao', x.observacao
              ) ORDER BY x.mes) AS lista
       FROM celula AS x
       WHERE x.meta_id = m.id
         AND (x.planejada IS NOT NULL OR x.realizada IS NOT NULL
              OR x.data_conclusao IS NOT NULL OR x.observacao IS NOT NULL)
     ) AS mes ON TRUE
     -- Os totais saem de um LATERAL, e nao de GROUP BY. Agrupar exigiria a
     -- coluna dos meses na clausula, e o PostgreSQL nao sabe comparar json por
     -- igualdade: o erro chega como "nao pode identificar um operador de
     -- igualdade para tipo json", que nao diz nada sobre a causa.
     -- (Sem crase neste comentario: ele vive dentro de um template literal.)
     LEFT JOIN LATERAL (
       SELECT SUM(t.realizada)::int AS realizado,
              SUM(t.planejada)::int AS planejado
       FROM celula AS t
       WHERE t.meta_id = m.id
     ) AS tot ON TRUE
     -- A META CANCELADA SAI DA GRADE.
     --
     -- Cancelar e o UNICO ato de situacao que e da DSG (er/pit.sql, na coluna
     -- cancelada de pit.meta_revisao): o andamento e a conclusao a grade
     -- calcula, mas o cancelamento e decisao declarada numa revisao. A R1 de
     -- 2026 cancelou a 5.2 e a 5.3, e elas seguiam nesta tela pedindo
     -- lancamento mensal, como se ainda fossem trabalho a fazer.
     --
     -- SAI DAQUI, e nao do sistema. Esta e a grade de EXECUCAO, onde se lanca o
     -- mes; a meta cancelada nao se lanca. Ela continua na tela de Metas do PIT,
     -- que e o plano consolidado depois de todas as revisoes, e la aparece
     -- marcada como cancelada: apagar o fato faria o R0 e o R1 parecerem iguais.
     --
     -- IS NOT TRUE, e nao NOT cancelada. A view meta_vigente traz a revisao por
     -- LEFT JOIN LATERAL, entao a meta que revisao nenhuma declarou vem com
     -- cancelada NULA, e NOT NULL nao e verdadeiro: com NOT, essas metas
     -- sumiriam da grade em silencio, que e o oposto do que se quer.
     WHERE m.ano = $<ano> AND m.cancelada IS NOT TRUE
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
    `${COM_CELULAS}
     SELECT m.id AS meta_id, m.ano, m.numero_meta, m.item, m.descricao,
            m.unidade, m.demandante, m.quantidade_prevista,
            m.prazo::text AS prazo,
            m.origem_id,
            m.cancelada, m.revisao, m.revisao_id,
            ${EH_FOLHA} AS folha,
            COALESCE(SUM(e.realizada) FILTER (
              WHERE $<mes>::smallint IS NULL OR e.mes <= $<mes>::smallint
            ), 0)::int AS realizado,
            CASE WHEN $<mes>::smallint IS NULL THEN NULL
                 ELSE COALESCE(SUM(e.realizada) FILTER (WHERE e.mes = $<mes>::smallint), 0)::int
            END AS realizado_mes,
            -- Quanto o PLANO mandava ter entregue até aqui. É o que separa
            -- "entregou 30 de 252" de "entregou 30 onde o plano pedia 30".
            COALESCE(SUM(e.planejada) FILTER (
              WHERE $<mes>::smallint IS NULL OR e.mes <= $<mes>::smallint
            ), 0)::int AS planejado_ate
     -- A REVISAO VIGENTE NAQUELE MES, e nao a de hoje. O RPCMTec
     -- de agosto tem de continuar reportando o que reportava depois de a DSG
     -- publicar uma revisao em setembro. Sem mes, vale a de hoje.
     FROM pit.meta_em(
       CASE WHEN $<mes>::smallint IS NULL THEN CURRENT_DATE
            ELSE (make_date($<ano>::int, $<mes>::int, 1)
                  + INTERVAL '1 month' - INTERVAL '1 day')::date
       END
     ) AS m
     LEFT JOIN celula AS e ON e.meta_id = m.id
     WHERE m.ano = $<ano>
     -- TODAS as colunas, e não só m.id: pit.meta_em é FUNÇÃO, e o PostgreSQL só
     -- dispensa as demais quando o agrupamento é pela chave primária de uma
     -- TABELA. Com pit.meta isso funcionava; aqui não.
     GROUP BY m.id, m.ano, m.numero_meta, m.item, m.descricao, m.unidade,
              m.demandante, m.quantidade_prevista, m.prazo, m.origem_id,
              m.cancelada, m.revisao, m.revisao_id
     ORDER BY m.numero_meta, m.item NULLS FIRST`,
    { ano, mes: mes === undefined ? null : mes }
  )
}

/**
 * Os lançamentos de UMA meta, mês a mês. É o que a ficha da meta mostra.
 *
 * Sai da célula EFETIVA, e não de `pit.execucao`: numa meta automática a ficha
 * tem de mostrar o mesmo número da grade, senão a tela se contradiz consigo
 * mesma. O `id` vem nulo quando a célula é calculada, e é por ele que a tela
 * sabe que ali não há o que editar nem o que apagar.
 */
controller.listarDaMeta = async metaId => {
  return db.conn.any(
    `${COM_CELULAS}
     SELECT c.id, c.meta_id, c.mes,
            c.planejada AS quantidade_planejada, c.realizada AS quantidade,
            c.data_conclusao::text AS data_conclusao, c.observacao,
            e.data_cadastramento, e.usuario_cadastramento_uuid,
            e.data_modificacao, e.usuario_modificacao_uuid
     FROM celula AS c
     LEFT JOIN pit.execucao AS e ON e.meta_id = c.meta_id AND e.mes = c.mes
     WHERE c.meta_id = $<metaId>
       AND (c.planejada IS NOT NULL OR c.realizada IS NOT NULL
            OR c.data_conclusao IS NOT NULL OR c.observacao IS NOT NULL)
     ORDER BY c.mes`,
    { metaId }
  )
}

/**
 * O ENSAIO: o digitado e o calculado lado a lado, sem escrever nada.
 *
 * É o portão para virar uma meta de Manual para automática. A regra é: só vira
 * quando o calculado REPRODUZ o que já está digitado, ou quando o chefe aceita a
 * diferença por escrito. Se divergir, alguém aprende alguma coisa antes de o
 * relatório mudar sozinho.
 *
 * Funciona na meta que AINDA está Manual, e é esse o ponto: por isso o cálculo
 * lá em cima não filtra por `origem_id`. Um ensaio que só respondesse depois da
 * virada não seria ensaio nenhum.
 */
controller.ensaio = async (ano, metaId) => {
  return db.conn.any(
    `WITH calculada AS (${CELULAS_CALCULADAS})
     SELECT m.id AS meta_id, m.ano, m.numero_meta, m.item, m.descricao,
            m.origem_id,
            (SELECT nome FROM dominio.origem_meta WHERE code = m.origem_id) AS origem,
            ms.mes,
            e.quantidade_planejada AS planejada_digitada,
            cc.soma_planejada AS planejada_calculada,
            e.quantidade AS realizada_digitada,
            cc.soma_realizada AS realizada_calculada,
            (e.quantidade IS NOT DISTINCT FROM cc.soma_realizada) AS realizada_bate,
            (e.quantidade_planejada IS NOT DISTINCT FROM cc.soma_planejada) AS planejada_bate
     FROM (
       SELECT meta_id, mes FROM pit.execucao
       UNION
       SELECT meta_id, mes FROM calculada
     ) AS ms
     INNER JOIN pit.meta_vigente AS m ON m.id = ms.meta_id
     LEFT JOIN pit.execucao AS e ON e.meta_id = ms.meta_id AND e.mes = ms.mes
     LEFT JOIN calculada AS cc ON cc.meta_id = ms.meta_id AND cc.mes = ms.mes
     WHERE m.ano = $<ano>
       AND ($<metaId>::bigint IS NULL OR m.id = $<metaId>::bigint)
     ORDER BY m.numero_meta, m.item NULLS FIRST, ms.mes`,
    { ano, metaId: metaId === undefined ? null : metaId }
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
      `SELECT m.id, m.ano, m.numero_meta, m.item, m.origem_id,
              o.nome AS origem
       FROM pit.meta AS m
       INNER JOIN dominio.origem_meta AS o ON o.code = m.origem_id
       WHERE m.id = $<metaId>`,
      { metaId: dados.meta_id }
    )
    if (!meta) {
      throw new AppError('Meta do PIT não encontrada', httpCode.NotFound)
    }

    // A COLUNA QUE A ORIGEM CALCULA NÃO SE DIGITA.
    //
    // Sem esta guarda, a gravação seria aceita, o número ficaria em
    // `pit.execucao` e a leitura o ignoraria: o cliente veria 200 e o valor não
    // mudaria na tela, sem erro nenhum. É pior do que recusar, porque some.
    //
    // A recusa é POR COLUNA, e não pela meta inteira: a meta de Impressão
    // calcula só o realizado, e o planejado dela continua sendo digitado da
    // PLANEJ_PIT, porque a mapoteca não planeja nada.
    const rotuloMeta = `Meta ${meta.numero_meta}${meta.item ? ` (item ${meta.item})` : ''}`
    const calculadas = []
    if (ORIGENS_CALCULAM_PLANEJADA.includes(meta.origem_id) && 'quantidade_planejada' in dados) {
      calculadas.push('quantidade_planejada')
    }
    if (ORIGENS_CALCULAM_REALIZADA.includes(meta.origem_id) && 'quantidade' in dados) {
      calculadas.push('quantidade')
    }
    if (calculadas.length > 0) {
      throw new AppError(
        `${rotuloMeta} tem origem ${meta.origem}, e ${calculadas.join(' e ')} ` +
        'sai do próprio sistema, não do lançamento. Corrija na fonte ' +
        '(a versão do acervo, a capacitação ou o pedido da mapoteca).',
        httpCode.BadRequest
      )
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
