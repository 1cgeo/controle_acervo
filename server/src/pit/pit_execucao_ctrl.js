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
  domainConstants: { TIPO_VERSAO, SITUACAO_CAPACITACAO, SITUACAO_PEDIDO }
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
// O PLANEJADO SAI DA ENTIDADE PLANEJADA, E O REALIZADO SAI DO FATO. Cada uma
// das tres origens tem DUAS datas, e nunca a mesma para os dois numeros:
//
//   Capacitacao (2)  planejado por `capacitacao.data_prevista`, tudo menos a
//                    Cancelada; realizado por `data_fim`, so a Concluida.
//
//   Producao (3)     planejado por `versao.data_prevista`; realizado por
//                    `versao.data_edicao`, so a que ja e Regular. O planejado
//                    inclui de proposito a versao que ja virou Regular: plano
//                    nao encolhe quando se cumpre, e `data_prevista` nao e
//                    sobrescrita na virada.
//
//   Impressao (4)    planejado pela soma de `produto_pedido.quantidade` dos
//                    pedidos ligados a meta, no mes de `pedido.data_prevista`,
//                    fora o Cancelado; realizado pela MIDIA que saiu, no mes de
//                    `pedido.data_atendimento`.
//
// AS DUAS FONTES DA IMPRESSAO SAO DELIBERADAS, e nao um resto de transicao. O
// prometido esta no ITEM do pedido que aponta a meta, e o entregue esta na midia
// pelo de-para de `mapoteca.midia_meta_pit`. Sao duas perguntas diferentes:
// somar o realizado pelo pedido derrubaria a 4.1 de 5.664 folhas para 253, e
// daria 199 folhas de tyvek na 4.2 num ano em que nenhuma saiu em tyvek.
//
// POR QUE O PLANEJADO DEIXOU DE VIR DO LOTE (medido em 2026-08-05). Ele saia de
// `acervo.lote.data_fim_prevista`, e nos 19 lotes que a tem ela e IGUAL a
// `data_fim`: a previsao era preenchida no fim, junto com o fato. A meta 1.3
// prometia 48 folhas em agosto e a grade mostrava 49 em JUNHO, porque foi em
// junho que o lote terminou. O plano nao sumia, era reescrito pelo fato.
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

    -- Producao, planejado: o mes que a PROPRIA versao promete.
    --
    -- Nao filtra por tipo de versao, de proposito. A Planejada conta porque e o
    -- plano; a que ja virou Regular tambem, porque plano nao encolhe quando se
    -- cumpre, e a data prevista sobrevive a virada justamente para isso.
    -- (Sem crase neste comentario: ele vive dentro de um template literal.)
    SELECT v.meta_pit_id,
           EXTRACT(MONTH FROM v.data_prevista)::smallint,
           count(*)::int,
           NULL::int
    FROM acervo.versao AS v
    INNER JOIN pit.meta AS mm ON mm.id = v.meta_pit_id
    WHERE v.data_prevista IS NOT NULL
      AND EXTRACT(YEAR FROM v.data_prevista) = mm.ano
    GROUP BY 1, 2

    UNION ALL

    -- Capacitacao, realizado: so a Concluida, no mes em que terminou.
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

    -- Capacitacao, planejado: tudo menos a Cancelada, no mes PROMETIDO.
    --
    -- O mes vem da data prevista, e nao da data de fim: enquanto os dois numeros
    -- saiam da mesma data, concluir com atraso movia o mes que a capacitacao
    -- havia planejado, e o plano seguia o fato.
    SELECT cap.meta_pit_id,
           EXTRACT(MONTH FROM cap.data_prevista)::smallint,
           count(*)::int,
           NULL::int
    FROM rpcmtec.capacitacao AS cap
    INNER JOIN pit.meta AS mm ON mm.id = cap.meta_pit_id
    WHERE cap.data_prevista IS NOT NULL
      AND cap.situacao_id <> ${SITUACAO_CAPACITACAO.CANCELADA}
      AND EXTRACT(YEAR FROM cap.data_prevista) = mm.ano
    GROUP BY 1, 2

    UNION ALL

    -- Impressao, planejado: folha PROMETIDA, pelo pedido que aponta a meta.
    --
    -- A quantidade PEDIDA, e nao a fornecida: aqui se conta o que se prometeu
    -- imprimir, e a fornecida so existe depois de imprimir. O Cancelado sai,
    -- porque pedido cancelado deixou de ser plano.
    SELECT p.meta_pit_id,
           EXTRACT(MONTH FROM p.data_prevista)::smallint,
           SUM(pp.quantidade)::int,
           NULL::int
    FROM mapoteca.pedido AS p
    INNER JOIN mapoteca.produto_pedido AS pp ON pp.pedido_id = p.id
    INNER JOIN pit.meta AS mm ON mm.id = p.meta_pit_id
    WHERE p.data_prevista IS NOT NULL
      AND p.situacao_pedido_id <> ${SITUACAO_PEDIDO.CANCELADO}
      AND EXTRACT(YEAR FROM p.data_prevista) = mm.ano
    GROUP BY 1, 2

    UNION ALL

    -- Impressao, realizado: folha ENTREGUE, pela midia que saiu, somada pelo
    -- de-para do ano. A quantidade FORNECIDA manda sobre a pedida porque o que a
    -- meta conta e o que saiu. (Sem crase aqui: template literal.)
    --
    -- POR MIDIA, e nao pelo pedido que o planejado acima usa. Sao duas perguntas:
    -- o pedido guarda o que se prometeu e a midia guarda o que saiu. Somar o
    -- realizado pelo pedido daria 253 folhas na 4.1 de 2026, onde o RTM publica
    -- 5.664, e daria 199 na 4.2 num ano em que nenhuma folha saiu em tyvek.
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
//
// AS TRES CALCULAM AS DUAS COLUNAS desde 2026-08-05. A impressao entrou no
// planejado quando `mapoteca.pedido.data_prevista` passou a existir: antes dela
// a mapoteca nao tinha como dizer em que mes prometia imprimir, e o planejado da
// meta 4 ficava digitado da PLANEJ_PIT.
const ORIGENS_CALCULAM_PLANEJADA = [
  ORIGEM_META.CAPACITACAO, ORIGEM_META.PRODUCAO, ORIGEM_META.IMPRESSAO
]
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

// O que cada origem conta como ENTIDADE PLANEJADA, e por qual coluna. Uma
// consulta por origem, unidas: as tres moram em schemas diferentes e nenhuma
// junta com as outras.
//
// A UNIDADE MUDA POR ORIGEM, e e por isso que `previstas` nao e sempre count(*).
// A versao vale UMA folha e a capacitacao vale UMA capacitacao, entao ali a
// conta e contar linhas. O pedido vale o que ele PEDE, entao ali a conta e somar
// `produto_pedido.quantidade`: um pedido de 121 folhas e uma linha e cento e
// vinte e uma unidades da meta. Contar pedidos daria 10 onde a meta promete 327.
const ENTIDADES_PLANEJADAS = `
  SELECT meta_id,
         SUM(previstas)::int AS previstas,
         SUM(sem_data)::int AS sem_data,
         SUM(registros)::int AS registros
  FROM (
    -- Producao: uma versao vale uma folha.
    SELECT v.meta_pit_id AS meta_id,
           count(*) FILTER (WHERE v.data_prevista IS NOT NULL)::int AS previstas,
           count(*) FILTER (WHERE v.data_prevista IS NULL)::int AS sem_data,
           count(*)::int AS registros
    FROM acervo.versao AS v
    WHERE v.meta_pit_id IS NOT NULL
    GROUP BY 1

    UNION ALL

    -- Capacitacao: uma capacitacao vale uma unidade. A Cancelada nao conta, pelo
    -- mesmo motivo que ela nao entra no planejado da grade.
    SELECT cap.meta_pit_id,
           count(*) FILTER (WHERE cap.data_prevista IS NOT NULL)::int,
           count(*) FILTER (WHERE cap.data_prevista IS NULL)::int,
           count(*)::int
    FROM rpcmtec.capacitacao AS cap
    WHERE cap.meta_pit_id IS NOT NULL
      AND cap.situacao_id <> ${SITUACAO_CAPACITACAO.CANCELADA}
    GROUP BY 1

    UNION ALL

    -- Impressao: o pedido vale o que ele PEDE, somando os itens.
    SELECT p.meta_pit_id,
           COALESCE(SUM(pp.quantidade) FILTER (WHERE p.data_prevista IS NOT NULL), 0)::int,
           COALESCE(SUM(pp.quantidade) FILTER (WHERE p.data_prevista IS NULL), 0)::int,
           count(DISTINCT p.id)::int
    FROM mapoteca.pedido AS p
    LEFT JOIN mapoteca.produto_pedido AS pp ON pp.pedido_id = p.id
    WHERE p.meta_pit_id IS NOT NULL
      AND p.situacao_pedido_id <> ${SITUACAO_PEDIDO.CANCELADO}
    GROUP BY 1
  ) AS x
  GROUP BY meta_id
`

/**
 * O DIAGNÓSTICO do cadastro do PIT: o que a meta automática promete contra o que
 * existe cadastrado para cumpri-la.
 *
 * POR QUE ELE EXISTE. Numa meta automática o número não se digita: ele é contado
 * das versões, das capacitações e dos pedidos ligados a ela. A consequência é
 * que ESQUECER de cadastrar a entidade não dá erro nenhum, dá ZERO. E zero na
 * grade é indistinguível de "o mês ainda não chegou". O erro fica invisível
 * justamente onde ninguém o procura, que é no plano do ano.
 *
 * Medido em 2026-08-05, antes desta rota existir: a meta 4.1 prometia 327 folhas
 * e tinha 325 nos pedidos, a 4.2 prometia 252 e tinha 229, e as metas 1.3 e 1.4
 * tinham as 74 versões ligadas e nenhuma com data prevista.
 *
 * SÓ A FOLHA ENTRA. O cabeçalho de meta subdividida não recebe lançamento nem
 * cadastro próprio, e cobrar entidade dele acusaria o trabalho dos itens como se
 * faltasse duas vezes.
 *
 * A META MANUAL FICA DE FORA, e não por descuido: ela não tem entidade que a
 * cumpra, e o número dela é o lançamento. Cobrar cadastro ali seria inventar
 * regra que o PIT não tem.
 */
controller.diagnostico = async ano => {
  return db.conn.any(
    `WITH calculada AS (${CELULAS_CALCULADAS}), entidade AS (${ENTIDADES_PLANEJADAS})
     SELECT m.id AS meta_id, m.ano, m.numero_meta, m.item, m.descricao,
            m.unidade, m.quantidade_prevista,
            m.origem_id,
            (SELECT nome FROM dominio.origem_meta WHERE code = m.origem_id) AS origem,
            COALESCE(en.previstas, 0) AS previstas,
            COALESCE(en.sem_data, 0) AS sem_data,
            COALESCE(en.registros, 0) AS registros,
            COALESCE(cal.planejado, 0) AS planejado_calculado,
            -- O QUE FALTA CADASTRAR, ja em numero, para a tela nao ter de fazer
            -- a conta e chegar noutro valor. Nunca negativo: cadastrar A MAIS do
            -- que o PIT promete tambem e divergencia, e quem a mostra e o
            -- proprio par (prometido, previstas), nao um numero que fica
            -- negativo e confunde.
            GREATEST(COALESCE(m.quantidade_prevista, 0) - COALESCE(en.previstas, 0), 0) AS faltam
     FROM pit.meta_vigente AS m
     LEFT JOIN entidade AS en ON en.meta_id = m.id
     LEFT JOIN LATERAL (
       SELECT SUM(c.soma_planejada)::int AS planejado
       FROM calculada AS c WHERE c.meta_id = m.id
     ) AS cal ON TRUE
     WHERE m.ano = $<ano>
       AND m.cancelada IS NOT TRUE
       AND m.origem_id <> ${ORIGEM_META.MANUAL}
       AND ${EH_FOLHA}
     ORDER BY m.numero_meta, m.item NULLS FIRST`,
    { ano }
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
    // A recusa é POR COLUNA, e não pela meta inteira. Hoje as três origens
    // calculam as duas colunas, então a distinção não muda nada na prática; ela
    // fica porque a próxima origem a entrar pode saber provar só uma, como a
    // Impressão sabia até `mapoteca.pedido.data_prevista` existir.
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
