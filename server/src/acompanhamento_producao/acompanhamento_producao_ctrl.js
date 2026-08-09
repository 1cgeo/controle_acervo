'use strict'

const { db } = require('../database')

const { AppError, httpCode } = require('../utils')

const {
  SITUACAO_ATIVIDADE,
  STATUS_EXECUCAO,
  TIPO_DADO_PRODUCAO
} = require('../utils/domain_constants')

const controller = {}

// --- Constantes de dominio usadas no SQL -------------------------------------

// A ATIVIDADE DESCARTADA (`SITUACAO_ATIVIDADE.NAO_FINALIZADA`) e a unica que
// pode repetir o par (etapa, unidade de trabalho): o indice unico parcial de
// `producao.atividade` so cobre os codes 1 a 4. Ela fica FORA de toda contagem
// deste modulo, porque contar trabalho descartado como trabalho inflaria a
// producao do lote.

// "Encerrado" e CONCLUIDO ou CONCLUIDO_PARCIALMENTE, e PAUSADO NAO e encerrado
// -- e a mesma leitura dos gatilhos `chk_*_status` de `er/producao.sql`. O
// acompanhamento mostra o que esta ANDANDO, entao o filtro dos projetos e o
// complemento disto.
const STATUS_ENCERRADO = [
  STATUS_EXECUCAO.CONCLUIDO,
  STATUS_EXECUCAO.CONCLUIDO_PARCIALMENTE
]

// Os dois tipos de dado de producao que tem grade de revisao (banco PostGIS, com
// e sem controle de permissoes). O NAO_CONTROLADO e "dado nao controlado pelo
// SAP", e nele nao existe grade nenhuma a procurar.
const DADO_PRODUCAO_COM_BANCO = [
  TIPO_DADO_PRODUCAO.POSTGIS_COM_PERMISSAO,
  TIPO_DADO_PRODUCAO.POSTGIS
]

// --- Peças de SQL reaproveitadas --------------------------------------------
//
// As tres consultas de PIT, as duas do painel e a de execucao perguntam a MESMA
// coisa em degraus: a unidade de trabalho terminou? a versao terminou? em que
// mes? Escrever isso quatro vezes seria quatro lugares para divergir no dia em
// que a regra de "terminou" mudar -- e ela ja mudou uma vez, quando o code 5
// deixou de contar.
//
// A REGRA, numa frase: a UNIDADE DE TRABALHO esta completa quando toda atividade
// viva dela tem `data_fim`; a VERSAO esta completa quando todas as unidades de
// trabalho dela estao. `producao.relacionamento_versao` e o cache espacial que
// liga uma a outra, mantido pelo gatilho `a_relacionamento_versao`.
const UT_COMPLETA = `
  SELECT ut.id, ut.lote_id, ut.subfase_id,
         (COUNT(*) = COUNT(a.data_fim)) AS completa,
         MAX(a.data_fim) AS data_fim,
         MIN(a.data_inicio) AS data_inicio
    FROM producao.unidade_trabalho AS ut
    INNER JOIN producao.atividade AS a ON a.unidade_trabalho_id = ut.id
   WHERE a.tipo_situacao_atividade_id <> ${SITUACAO_ATIVIDADE.NAO_FINALIZADA}
   GROUP BY ut.id`

const VERSAO_COMPLETA = `
  SELECT rv.versao_id, u.lote_id,
         bool_and(u.completa) AS completa,
         bool_or(u.data_inicio IS NOT NULL) AS iniciada,
         MAX(u.data_fim) AS data_fim
    FROM producao.relacionamento_versao AS rv
    INNER JOIN ut_completa AS u ON u.id = rv.ut_id
   GROUP BY rv.versao_id, u.lote_id`

// --- Informações de lote e de subfase ---------------------------------------

/**
 * As etapas de uma subfase de um lote, com o quadro de hoje.
 *
 * A CONTAGEM SAI DO BANCO, e nao do JavaScript. A origem no SAP trazia as
 * atividades cruas e somava em memoria com `date-fns`, formatando `data_fim` em
 * 'dd.MM.yyyy' e comparando strings. Duas consequencias medidas: `format(null)`
 * lancava RangeError e derrubava a rota inteira quando havia UMA atividade em
 * andamento, e a comparacao de semana usava o fuso do PROCESSO, que nao e o do
 * banco. Aqui `COUNT(*) FILTER` e `date_trunc` respondem no mesmo lugar em que a
 * data esta gravada.
 *
 * DEVOLVE UMA LISTA, e nao um objeto indexado por `etapa_id` como no SAP: a
 * ordem da etapa e informacao (`e.ordem`), e objeto de JavaScript com chave
 * numerica nao a preserva de forma confiavel.
 */
controller.getInfoSubfaseLote = async (loteId, subfaseId) => {
  return db.conn.any(
    `SELECT e.id AS etapa_id, e.ordem AS etapa_ordem, te.nome AS nome,
            COUNT(*) FILTER (
              WHERE a.tipo_situacao_atividade_id = $<emExecucao>
            )::int AS atividades_em_execucao,
            COUNT(*) FILTER (
              WHERE a.tipo_situacao_atividade_id = $<pausada>
            )::int AS atividades_pausadas,
            COUNT(*) FILTER (
              WHERE a.tipo_situacao_atividade_id = $<naoIniciada>
            )::int AS atividades_restantes,
            COUNT(*) FILTER (
              WHERE a.tipo_situacao_atividade_id = $<finalizada>
            )::int AS atividades_finalizadas,
            COUNT(*) FILTER (
              WHERE a.tipo_situacao_atividade_id = $<finalizada>
                AND a.data_fim::date = CURRENT_DATE
            )::int AS atividades_finalizadas_hoje,
            COUNT(*) FILTER (
              WHERE a.tipo_situacao_atividade_id = $<finalizada>
                AND date_trunc('week', a.data_fim) = date_trunc('week', CURRENT_TIMESTAMP)
            )::int AS atividades_finalizadas_semana,
            COUNT(*) FILTER (
              WHERE a.tipo_situacao_atividade_id = $<finalizada>
                AND date_trunc('week', a.data_fim)
                    = date_trunc('week', CURRENT_TIMESTAMP - INTERVAL '1 week')
            )::int AS atividades_finalizadas_semana_anterior
       FROM producao.atividade AS a
       INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
       INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
       INNER JOIN dominio.tipo_etapa AS te ON te.code = e.tipo_etapa_id
      WHERE ut.lote_id = $<loteId> AND ut.subfase_id = $<subfaseId>
        AND a.tipo_situacao_atividade_id <> $<naoFinalizada>
      GROUP BY e.id, e.ordem, te.nome
      ORDER BY e.ordem`,
    {
      loteId,
      subfaseId,
      naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA,
      emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO,
      pausada: SITUACAO_ATIVIDADE.PAUSADA,
      finalizada: SITUACAO_ATIVIDADE.FINALIZADA,
      naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA
    }
  )
}

// OS DOIS SELETORES DAS TELAS DE ACOMPANHAMENTO, e eles existem por uma lacuna
// de PERFIL que so apareceu quando o cliente foi escrito.
//
// As telas de acompanhamento precisam de duas listas para montar filtro: quais
// lotes tem producao, e quais subfases um lote executa. Nenhuma das duas tinha
// rota de piso `consulta` em `producao`:
//
//   `GET /api/projetos/lote` cobra `verifyPerfil('consulta')` SEM o segundo
//   argumento, e o default e `'acervo'`. Quem so tem perfil em `producao` leva
//   403 ali, o que esta CERTO: aquela rota e do acervo, e devolve o lote inteiro
//   (projeto, datas, status, autoria).
//
//   `GET /api/producao/lote/:lote_id/subfases` cobra `gerente`, porque devolve o
//   ESTADO de cada subfase e aceita `incluir_geom`.
//
// Entao a saida nao foi baixar o piso de nenhuma das duas: foi publicar aqui o
// MINIMO que um seletor precisa, id e nome, no modulo cujo piso ja e `consulta`.
// Baixar o piso das outras entregaria de lambuja o que elas carregam a mais.
controller.lotesComProducao = async () => {
  return db.conn.any(
    `SELECT DISTINCT l.id, l.nome, l.pit, p.nome AS projeto
       FROM acervo.lote AS l
       INNER JOIN acervo.projeto AS p ON p.id = l.projeto_id
      WHERE EXISTS (
        SELECT 1 FROM producao.unidade_trabalho AS ut WHERE ut.lote_id = l.id
      )
      ORDER BY l.nome`
  )
}

// O `EXISTS` sobre `unidade_trabalho`, e nao sobre `etapa`: a etapa e
// CONFIGURACAO (o fluxo desenhado para o lote) e pode existir sem nenhum
// trabalho recortado ainda. O que a tela quer listar e lote que tem o que
// acompanhar.
controller.subfasesDoLote = async loteId => {
  return db.conn.any(
    `SELECT DISTINCT s.id, s.nome, s.ordem,
            f.id AS fase_id, tf.nome AS fase,
            lp.id AS linha_producao_id, lp.nome_abrev AS linha_producao
       FROM producao.unidade_trabalho AS ut
       INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
       INNER JOIN producao.fase AS f ON f.id = s.fase_id
       INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
       INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
      WHERE ut.lote_id = $<loteId>
      ORDER BY f.ordem, s.ordem`,
    { loteId }
  )
}

/**
 * As fases de um lote, com quantas versões passaram por cada uma.
 *
 * A LIGACAO VERSAO x UNIDADE DE TRABALHO SAI DO CACHE, e nao de um `ST_Relate`
 * na hora. A origem cruzava `produto` com `unidade_trabalho` por
 * `st_relate(ut.geom, p.geom, '2********')` a cada requisicao, o que e um
 * cruzamento espacial completo por chamada. Aqui existe
 * `producao.relacionamento_versao`, que e exatamente esse cruzamento mantido por
 * gatilho -- e que ainda FILTRA PELO SUBTIPO da linha de producao, coisa que o
 * `ST_Relate` cru nao fazia: num lote misto (61 dos 102 lotes com versao), a
 * unidade de trabalho da carta reivindicaria a versao do CDGV, e a contagem
 * mentiria sem levantar erro.
 */
controller.getInfoLote = async loteId => {
  return db.conn.any(
    `WITH versao_fase AS (
       SELECT v.id AS versao_id, f.id AS fase_id, f.ordem AS fase_ordem,
              tf.nome AS fase_nome,
              MIN(a.data_inicio) AS data_inicio,
              (CASE WHEN COUNT(*) = COUNT(a.data_fim) THEN MAX(a.data_fim) END) AS data_fim
         FROM acervo.versao AS v
         INNER JOIN producao.relacionamento_versao AS rv ON rv.versao_id = v.id
         INNER JOIN producao.unidade_trabalho AS ut ON ut.id = rv.ut_id
         INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
         INNER JOIN producao.fase AS f ON f.id = s.fase_id
         INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
         INNER JOIN producao.atividade AS a ON a.unidade_trabalho_id = ut.id
        WHERE ut.lote_id = $<loteId>
          AND a.tipo_situacao_atividade_id <> $<naoFinalizada>
        GROUP BY v.id, f.id, f.ordem, tf.nome
     )
     SELECT fase_id, fase_ordem, fase_nome AS nome,
            COUNT(*) FILTER (
              WHERE data_inicio IS NOT NULL AND data_fim IS NOT NULL
            )::int AS atividades_finalizadas,
            COUNT(*) FILTER (
              WHERE data_inicio IS NOT NULL AND data_fim IS NULL
            )::int AS atividades_em_execucao,
            COUNT(*) FILTER (
              WHERE data_inicio IS NULL AND data_fim IS NULL
            )::int AS atividades_restantes,
            COUNT(*) FILTER (
              WHERE data_fim IS NOT NULL
                AND date_trunc('week', data_fim) = date_trunc('week', CURRENT_TIMESTAMP)
            )::int AS atividades_finalizadas_semana,
            COUNT(*) FILTER (
              WHERE data_fim IS NOT NULL
                AND date_trunc('month', data_fim) = date_trunc('month', CURRENT_TIMESTAMP)
            )::int AS atividades_finalizadas_mes,
            COUNT(*) FILTER (
              WHERE data_fim IS NOT NULL
                AND date_trunc('week', data_fim)
                    = date_trunc('week', CURRENT_TIMESTAMP - INTERVAL '1 week')
            )::int AS atividades_finalizadas_semana_anterior,
            COUNT(*) FILTER (
              WHERE data_fim IS NOT NULL
                AND date_trunc('month', data_fim)
                    = date_trunc('month', CURRENT_TIMESTAMP - INTERVAL '1 month')
            )::int AS atividades_finalizadas_mes_anterior
       FROM versao_fase
      GROUP BY fase_id, fase_ordem, fase_nome
      ORDER BY fase_ordem`,
    { loteId, naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA }
  )
}

// --- Pessoas ----------------------------------------------------------------

/**
 * O último login de cada usuário ativo.
 *
 * A FONTE E `dgeo.login`, e nao a `acompanhamento.login` do SAP, que NAO
 * atravessou: o SCA ja registrava a mesma coisa antes do core de producao
 * chegar. Ela e a UNICA tabela deste caminho que guarda a pessoa por
 * `usuario_id INTEGER`, e nao por uuid -- todo o schema `producao` usa
 * `usuario_uuid`, e trocar os dois aqui casaria id com uuid em silencio.
 *
 * O TURNO SAIU da resposta: `dominio.tipo_turno` nao atravessou (decisao de
 * 2026-08-09), e com ele saiu o unico consumidor que nao era `dgeo.usuario`.
 *
 * NAO CONFUNDIR COM `/api/acessos`, que e a tela de PLATAFORMA do historico de
 * acesso e cobra administrador. Esta responde "quem da producao apareceu", e
 * mora na tela de acompanhamento.
 */
controller.ultimosLogin = async () => {
  return db.conn.any(
    `SELECT u.id AS usuario_id, u.uuid AS usuario_uuid,
            tpg.nome_abrev || ' ' || u.nome_guerra AS usuario,
            l.data_login
       FROM dgeo.usuario AS u
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
       INNER JOIN (
         SELECT usuario_id, MAX(data_login) AS data_login
           FROM dgeo.login
          GROUP BY usuario_id
       ) AS l ON l.usuario_id = u.id
      WHERE u.ativo IS TRUE
      ORDER BY l.data_login DESC`
  )
}

/**
 * Quem está sem habilitação de produção ou sem habilitação de bloco.
 *
 * OS `perfil_producao*` DO SAP VIRARAM `habilitacao*` (decisao registrada em
 * `docs/decisoes.md`): aqui "perfil" e AUTORIZACAO (`dominio.tipo_perfil`), e ler
 * `perfil_producao_operador` faria acreditar que aquilo concede acesso.
 * `perfil_producao_operador` virou `producao.habilitacao_usuario` e
 * `perfil_bloco_operador` virou `producao.habilitacao_bloco`.
 *
 * O PARENTESES E A CORRECAO. A origem escrevia
 * `WHERE ppo.id IS NULL OR pbloco.id IS NULL AND u.ativo IS TRUE`, e em SQL o
 * `AND` liga mais forte que o `OR`: quem nao tinha perfil de producao entrava na
 * lista mesmo INATIVO, e a tela cobrava habilitacao de gente que ja saiu da
 * Divisao. O filtro de ativo vale para os dois lados.
 */
controller.usuariosSemPerfil = async () => {
  return db.conn.any(
    `SELECT u.id AS usuario_id, u.uuid AS usuario_uuid,
            tpg.nome_abrev || ' ' || u.nome_guerra AS usuario,
            (CASE
               WHEN hu.usuario_uuid IS NULL AND hb.usuario_uuid IS NULL
                 THEN 'Usuário sem habilitação de produção e sem habilitação de bloco'
               WHEN hu.usuario_uuid IS NULL
                 THEN 'Usuário sem habilitação de produção'
               ELSE 'Usuário sem habilitação de bloco'
             END) AS situacao
       FROM dgeo.usuario AS u
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
       LEFT JOIN producao.habilitacao_usuario AS hu ON hu.usuario_uuid = u.uuid
       LEFT JOIN (
         SELECT DISTINCT usuario_uuid FROM producao.habilitacao_bloco
       ) AS hb ON hb.usuario_uuid = u.uuid
      WHERE u.ativo IS TRUE
        AND (hu.usuario_uuid IS NULL OR hb.usuario_uuid IS NULL)
      ORDER BY usuario`
  )
}

/**
 * Onde cada pessoa ativa está agora: ociosa, em atividade ou pausada.
 */
controller.resumoUsuario = async () => {
  return db.conn.any(
    `SELECT u.id AS usuario_id, u.uuid AS usuario_uuid,
            u.nome_guerra AS nome_usuario, tpg.nome_abrev AS nome_abrev,
            (CASE
               WHEN a.usuario_uuid IS NULL THEN 'Ocioso'
               WHEN a.tipo_situacao_atividade_id = $<emExecucao> THEN 'Em Atividade'
               WHEN a.tipo_situacao_atividade_id = $<pausada> THEN 'Atividade Pausada'
             END) AS status_usuario,
            COALESCE(s.nome, 'N/A') AS nome_subfase,
            COALESCE(l.nome, 'N/A') AS nome_lote,
            COALESCE(b.nome, 'N/A') AS nome_bloco
       FROM dgeo.usuario AS u
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
       LEFT JOIN producao.atividade AS a
         ON a.usuario_uuid = u.uuid
        AND a.tipo_situacao_atividade_id IN ($<emExecucao>, $<pausada>)
       LEFT JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
       LEFT JOIN producao.subfase AS s ON s.id = ut.subfase_id
       LEFT JOIN acervo.lote AS l ON l.id = ut.lote_id
       LEFT JOIN producao.bloco AS b ON b.id = ut.bloco_id
      WHERE u.ativo IS TRUE
      ORDER BY tpg.code DESC, u.nome_guerra`,
    {
      emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO,
      pausada: SITUACAO_ATIVIDADE.PAUSADA
    }
  )
}

// --- Atividades -------------------------------------------------------------

// As duas listas de atividade (em execucao e ultimas finalizadas) leem as MESMAS
// dez juncoes, e por isso o corpo e um so: duas copias divergiriam na primeira
// coluna que alguem acrescentasse a uma delas.
//
// A CADEIA E LONGA DE PROPOSITO, e ela e o mapa do schema: a atividade sabe da
// etapa e da unidade de trabalho; o LOTE e o PROJETO vem do ACERVO (nao existe
// `producao.lote` nem `producao.projeto`, e quem os procura em `producao` esta
// procurando no lugar errado); a linha de producao vem da fase da subfase.
const LISTA_ATIVIDADE = ordem => `
  SELECT a.id AS atividade_id,
         p.id AS projeto_id, p.nome AS projeto_nome,
         l.id AS lote_id, l.nome AS lote,
         lp.nome AS linha_producao_nome, tf.nome AS fase_nome, s.nome AS subfase_nome,
         te.nome AS etapa_nome, b.nome AS bloco,
         ut.id AS unidade_trabalho_id, ut.nome AS unidade_trabalho_nome,
         u.id AS usuario_id, u.uuid AS usuario_uuid,
         tpg.nome_abrev || ' ' || u.nome_guerra AS usuario,
         a.data_inicio, a.data_fim,
         CURRENT_TIMESTAMP - a.data_inicio AS duracao
    FROM producao.atividade AS a
    INNER JOIN dgeo.usuario AS u ON u.uuid = a.usuario_uuid
    INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
    INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
    INNER JOIN dominio.tipo_etapa AS te ON te.code = e.tipo_etapa_id
    INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
    INNER JOIN producao.bloco AS b ON b.id = ut.bloco_id
    INNER JOIN producao.subfase AS s ON s.id = e.subfase_id
    INNER JOIN producao.fase AS f ON f.id = s.fase_id
    INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
    INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
    INNER JOIN acervo.lote AS l ON l.id = ut.lote_id
    INNER JOIN acervo.projeto AS p ON p.id = l.projeto_id
   WHERE a.tipo_situacao_atividade_id = $<situacao>
   ORDER BY ${ordem}`

controller.atividadesEmExecucao = async () => {
  return db.conn.any(
    LISTA_ATIVIDADE('a.data_inicio ASC'),
    { situacao: SITUACAO_ATIVIDADE.EM_EXECUCAO }
  )
}

controller.ultimasAtividadesFinalizadas = async () => {
  return db.conn.any(
    `${LISTA_ATIVIDADE('a.data_fim DESC')} LIMIT 20`,
    { situacao: SITUACAO_ATIVIDADE.FINALIZADA }
  )
}

/**
 * As atividades em execução sobre dado controlado em banco PostGIS.
 *
 * A GRADE DE REVISAO NAO VEM JUNTO, E A AUSENCIA E DECLARADA.
 *
 * No SAP esta rota abria uma conexao ao banco de EDICAO descrito em
 * `producao.dado_producao.configuracao_producao`, e lia dali a
 * `public.aux_grid_revisao_a` -- a malha de quadriculas que diz por onde o
 * revisor ja passou.
 *
 * O `db.microConn` DO MICROCONTROLE NAO E PRECEDENTE PARA ISTO, e a diferenca
 * nao e de tamanho. Aquela conexao e UMA, fixa, declarada nas chaves
 * `MICRO_DB_*` de `server/config.env` e montada sem tocar a rede; ela existe
 * desde 2026-08-09, por decisao do chefe, e esta descrita em `docs/decisoes.md`.
 * A daqui seria UMA POR LOTE, com endereco lido de uma LINHA DO BANCO em tempo
 * de execucao: outro numero de conexoes, outro ciclo de vida e outra superficie
 * de falha. Abri-la de carona na outra seria decidir por baixo.
 *
 * O QUE ESTA ROTA ENTREGA, entao, e a lista de atividades que TEM grade a
 * procurar, com `grade: null` e o motivo em `grade_indisponivel`. A tela mostra
 * a linha e diz por que o quadriculado nao veio, em vez de a rota devolver 500
 * ou uma lista vazia que se leria como "ninguem esta revisando".
 */
controller.acompanhamentoGrade = async () => {
  const atividades = await db.conn.any(
    `SELECT a.id AS atividade_id, ut.id AS unidade_trabalho_id, a.etapa_id,
            dp.tipo_dado_producao_id,
            u.uuid AS usuario_uuid,
            tpg.nome_abrev || ' ' || u.nome_guerra AS usuario,
            a.data_inicio,
            te.nome AS etapa, s.nome AS subfase, tf.nome AS fase,
            l.nome AS lote, p.nome AS projeto, b.nome AS bloco
       FROM producao.atividade AS a
       INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
       INNER JOIN producao.dado_producao AS dp ON dp.id = ut.dado_producao_id
       INNER JOIN dgeo.usuario AS u ON u.uuid = a.usuario_uuid
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
       INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
       INNER JOIN dominio.tipo_etapa AS te ON te.code = e.tipo_etapa_id
       INNER JOIN producao.subfase AS s ON s.id = e.subfase_id
       INNER JOIN producao.fase AS f ON f.id = s.fase_id
       INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
       INNER JOIN producao.bloco AS b ON b.id = ut.bloco_id
       INNER JOIN acervo.lote AS l ON l.id = ut.lote_id
       INNER JOIN acervo.projeto AS p ON p.id = l.projeto_id
      WHERE a.tipo_situacao_atividade_id = $<emExecucao>
        AND dp.tipo_dado_producao_id IN ($<comBanco:csv>)
      ORDER BY a.data_inicio`,
    {
      emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO,
      comBanco: DADO_PRODUCAO_COM_BANCO
    }
  )

  // A configuracao de producao (servidor, porta e banco) NAO sai na resposta: ela
  // e endereco de maquina interna, e a resposta de uma rota e lugar publico.
  return atividades.map(a => ({
    ...a,
    grade: null,
    grade_indisponivel:
      'A grade de revisão mora no banco de produção, e o SCA não abre conexão para ele'
  }))
}

// --- Linhas do tempo --------------------------------------------------------
//
// AS DUAS CONSULTAS ABAIXO DEVOLVEM FAIXAS, e nao dias soltos: cada elemento e
// `[dia_inicial, 0 ou 1, dia_seguinte_ao_final]`, que e o que a barra da tela
// consome. Dias consecutivos com o mesmo valor entram numa faixa so.
//
// A MONTAGEM E TODA EM SQL, e a origem fazia em JavaScript: ela trazia so os
// dias COM atividade, preenchia os buracos num gerador de datas e depois fundia
// faixas iguais num segundo laco. Alem de dois lacos onde cabe uma consulta,
// aquilo gerava as datas com `new Date(...).toISOString()`, que e UTC, sobre
// dias que o banco produziu no fuso do banco -- em UTC-3 a barra comecava um dia
// antes do primeiro trabalho.
//
// Aqui `generate_series` da a grade de dias, um `EXISTS` marca cada dia, e a
// tecnica de ilhas (`dia - row_number()`, constante dentro de uma sequencia
// ininterrupta) funde as faixas. Nenhuma data passa por JavaScript.
/**
 * Monta a consulta de faixas.
 *
 * `chaves` e `saida` chegam como ARRAYS, e nao como texto a ser fatiado por
 * vírgula: a expressao de saida do usuario e
 * `tpg.nome_abrev || ' ' || u.nome_guerra`, e um dia alguem escreve
 * `concat_ws(', ', ...)` ali. Fatiar texto por ", " funcionaria hoje e montaria
 * SQL invalido naquele dia, sem que nada acusasse antes do banco.
 *
 * @param {object} params
 * @param {string[]} params.chaves - colunas que identificam a serie
 * @param {string} params.intervalos - SELECT com as chaves mais `inicio` e `fim`
 * @param {string} params.juncoes - JOINs que traduzem as chaves em rotulo
 * @param {Array<[string, string]>} params.saida - pares [expressao, apelido]
 */
const linhaDoTempo = ({ chaves, intervalos, juncoes, saida }) => {
  const listaChaves = chaves.join(', ')
  const expressoes = saida.map(([expressao]) => expressao).join(', ')
  const selecao = saida.map(([expressao, apelido]) => `${expressao} AS ${apelido}`)

  return `
    WITH dias AS (
      SELECT generate_series(
        date_trunc('year', CURRENT_DATE)::date, CURRENT_DATE, '1 day'
      )::date AS dia
    ),
    intervalos AS (${intervalos}),
    chaves AS (SELECT DISTINCT ${listaChaves} FROM intervalos),
    grade AS (
      SELECT ${chaves.map(c => `c.${c}`).join(', ')}, d.dia,
             (EXISTS (
                SELECT 1 FROM intervalos AS i
                 WHERE ${chaves.map(c => `i.${c} = c.${c}`).join(' AND ')}
                   AND d.dia BETWEEN i.inicio AND i.fim
             ))::int AS valor
        FROM chaves AS c CROSS JOIN dias AS d
    ),
    ilhas AS (
      SELECT ${listaChaves}, dia, valor,
             dia - (ROW_NUMBER() OVER (
               PARTITION BY ${listaChaves}, valor ORDER BY dia
             ))::int AS grupo
        FROM grade
    ),
    faixas AS (
      SELECT ${listaChaves}, valor, MIN(dia) AS inicio, MAX(dia) AS fim
        FROM ilhas
       GROUP BY ${listaChaves}, valor, grupo
    )
    SELECT ${selecao.join(', ')},
           array_agg(
             ARRAY[f.inicio::text, f.valor::text, (f.fim + 1)::text]
             ORDER BY f.inicio
           ) AS data
      FROM faixas AS f
      ${juncoes}
     GROUP BY ${expressoes}
     ORDER BY ${expressoes}`
}

controller.atividadeSubfase = async () => {
  return db.conn.any(
    linhaDoTempo({
      chaves: ['lote_id', 'subfase_id'],
      intervalos: `
        SELECT ut.lote_id, ut.subfase_id,
               a.data_inicio::date AS inicio,
               COALESCE(a.data_fim, CURRENT_TIMESTAMP)::date AS fim
          FROM producao.atividade AS a
          INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
         WHERE a.data_inicio IS NOT NULL`,
      juncoes: `
        INNER JOIN acervo.lote AS l ON l.id = f.lote_id
        INNER JOIN producao.subfase AS s ON s.id = f.subfase_id`,
      saida: [['l.nome', 'lote'], ['s.nome', 'subfase']]
    })
  )
}

controller.atividadeUsuario = async () => {
  return db.conn.any(
    linhaDoTempo({
      chaves: ['usuario_uuid'],
      intervalos: `
        SELECT a.usuario_uuid,
               a.data_inicio::date AS inicio,
               COALESCE(a.data_fim, CURRENT_TIMESTAMP)::date AS fim
          FROM producao.atividade AS a
         WHERE a.data_inicio IS NOT NULL AND a.usuario_uuid IS NOT NULL`,
      juncoes: `
        INNER JOIN dgeo.usuario AS u ON u.uuid = f.usuario_uuid
        INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id`,
      saida: [["tpg.nome_abrev || ' ' || u.nome_guerra", 'usuario']]
    })
  )
}

/**
 * Quantas atividades cada bloco fechou em cada subfase, e quantas faltam.
 *
 * O RECORTE E O PROJETO QUE NAO ENCERROU. A origem cobrava `p.status_id = 1`
 * ("Em execucao" no dominio `status` do SAP, que NAO atravessou). Aqui o dominio
 * e `tipo_status_execucao`, e o code 1 e "Nao iniciado": copiar o numero teria
 * invertido o filtro, mostrando so o que ninguem comecou. A leitura correta e a
 * dos gatilhos de `er/producao.sql` -- encerrado e 3 ou 4, e todo o resto anda.
 */
controller.situacaoSubfase = async () => {
  return db.conn.any(
    `WITH contagem AS (
       SELECT ut.bloco_id, ut.subfase_id,
              COUNT(*) FILTER (
                WHERE a.tipo_situacao_atividade_id = $<finalizada>
              )::int AS finalizadas,
              COUNT(*) FILTER (
                WHERE a.tipo_situacao_atividade_id NOT IN ($<finalizada>, $<naoFinalizada>)
              )::int AS nao_finalizadas
         FROM producao.atividade AS a
         INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
        GROUP BY ut.bloco_id, ut.subfase_id
     )
     SELECT b.id AS bloco_id, b.nome AS bloco, s.nome AS subfase,
            c.finalizadas, c.nao_finalizadas
       FROM contagem AS c
       INNER JOIN producao.bloco AS b ON b.id = c.bloco_id
       INNER JOIN producao.subfase AS s ON s.id = c.subfase_id
       INNER JOIN acervo.lote AS l ON l.id = b.lote_id
       INNER JOIN acervo.projeto AS p ON p.id = l.projeto_id
      WHERE p.status_execucao_id NOT IN ($<encerrado:csv>)
      ORDER BY b.prioridade, s.ordem`,
    {
      finalizada: SITUACAO_ATIVIDADE.FINALIZADA,
      naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA,
      encerrado: STATUS_ENCERRADO
    }
  )
}

// --- O PIT ------------------------------------------------------------------
//
// A META NAO E UMA COLUNA DE LOTE, e este e o ponto em que o core de producao
// mais se afasta da origem.
//
// No SAP havia `macrocontrole.pit (lote_id, ano, meta)`: um numero digitado por
// lote e por ano. Aqui a meta do PIT e um DOCUMENTO -- `pit.meta` (o grupo),
// `pit.meta_item` (o item que conta) e `pit.meta_item_revisao` (o que a DSG
// declarou sobre ele) -- e quem CUMPRE uma unidade da meta e a VERSAO, por
// `acervo.versao.meta_pit_id`. Ver o comentario daquela coluna em `er/acervo.sql`:
// o vinculo esta na versao, e nao no lote, porque todo lote de carta traz o CDGV
// junto e a meta promete folhas, nao linhas de lote.
//
// A CONSEQUENCIA PRATICA: a "meta do lote no ano" aqui e CONTADA, e nao lida --
// e o numero de versoes daquele lote que apontam um item de meta daquele ano. O
// numero e o mesmo que o SAP guardava a mao, com a diferenca de nao poder
// divergir do que foi cadastrado.
//
// A OUTRA HOMONIMIA, e ela morde: `pit.pit` e o ANO, e a `macrocontrole.pit` do
// SAP corresponde a `pit.meta` daqui. As duas vao existir no mesmo banco.

controller.getInfoSubfasePIT = async ano => {
  return db.conn.any(
    `WITH ut_completa AS (${UT_COMPLETA}),
     versao_subfase AS (
       SELECT rv.versao_id, u.lote_id, u.subfase_id,
              bool_and(u.completa) AS completa,
              MAX(u.data_fim) AS data_fim
         FROM producao.relacionamento_versao AS rv
         INNER JOIN ut_completa AS u ON u.id = rv.ut_id
        GROUP BY rv.versao_id, u.lote_id, u.subfase_id
     )
     SELECT l.nome AS lote, s.nome AS subfase,
            EXTRACT(MONTH FROM vs.data_fim)::int AS mes,
            COUNT(*)::int AS quantidade
       FROM versao_subfase AS vs
       INNER JOIN acervo.lote AS l ON l.id = vs.lote_id
       INNER JOIN producao.subfase AS s ON s.id = vs.subfase_id
      WHERE vs.completa IS TRUE
        AND EXTRACT(YEAR FROM vs.data_fim) = $<ano>
      GROUP BY l.nome, s.nome, s.ordem, EXTRACT(MONTH FROM vs.data_fim)
      ORDER BY l.nome, s.ordem, mes`,
    { ano }
  )
}

controller.getInfoPIT = async ano => {
  return db.conn.any(
    // A GRADE DE MESES E ANCORADA NO ANO PEDIDO, e nao em hoje. A origem usava
    // `generate_series(1, EXTRACT(MONTH FROM current_date))` sempre, o que
    // TRUNCAVA em silencio toda consulta de ano passado: pedir o PIT de 2025 em
    // julho de 2026 devolvia so os meses 1 a 7 de 2025, e a soma anual saia
    // subestimada num relatorio assinado. Ano corrente para no mes atual, para
    // nao exibir mes que ainda nao aconteceu como producao zerada.
    `WITH meses AS (
       SELECT generate_series(
         1,
         CASE WHEN $<ano>::int = EXTRACT(YEAR FROM CURRENT_DATE)::int
              THEN EXTRACT(MONTH FROM CURRENT_DATE)::int
              ELSE 12 END
       ) AS mes
     ),
     lotes AS (
       SELECT pr.nome AS projeto, l.id AS lote_id, l.nome AS lote,
              COUNT(v.id) FILTER (WHERE m.ano = $<ano>)::int AS meta
         FROM acervo.lote AS l
         INNER JOIN acervo.projeto AS pr ON pr.id = l.projeto_id
         LEFT JOIN acervo.versao AS v ON v.lote_id = l.id
         LEFT JOIN pit.meta_item AS mi ON mi.id = v.meta_pit_id
         LEFT JOIN pit.meta AS m ON m.id = mi.meta_id
        GROUP BY pr.nome, l.id, l.nome
     ),
     ut_completa AS (${UT_COMPLETA}),
     versao_completa AS (${VERSAO_COMPLETA}),
     realizado AS (
       SELECT lote_id, EXTRACT(MONTH FROM data_fim)::int AS mes,
              COUNT(*)::int AS finalizadas
         FROM versao_completa
        WHERE completa IS TRUE AND EXTRACT(YEAR FROM data_fim) = $<ano>
        GROUP BY lote_id, EXTRACT(MONTH FROM data_fim)
     )
     SELECT lo.projeto, lo.lote_id, lo.lote, lo.meta, ms.mes,
            COALESCE(r.finalizadas, 0)::int AS finalizadas
       FROM lotes AS lo
       CROSS JOIN meses AS ms
       LEFT JOIN realizado AS r ON r.lote_id = lo.lote_id AND r.mes = ms.mes
      WHERE lo.meta > 0
      ORDER BY lo.projeto, lo.lote, ms.mes`,
    { ano }
  )
}

// --- Painel -----------------------------------------------------------------

controller.getQuantidadeAno = async ano => {
  return db.conn.any(
    `SELECT l.id AS lote_id, l.nome AS lote, COUNT(v.id)::int AS quantidade
       FROM acervo.lote AS l
       INNER JOIN acervo.versao AS v ON v.lote_id = l.id
       INNER JOIN pit.meta_item AS mi ON mi.id = v.meta_pit_id
       INNER JOIN pit.meta AS m ON m.id = mi.meta_id
      WHERE m.ano = $<ano>
      GROUP BY l.id, l.nome
      ORDER BY l.nome`,
    { ano }
  )
}

controller.getFinalizadasAno = async ano => {
  return db.conn.any(
    `WITH ut_completa AS (${UT_COMPLETA}),
     versao_completa AS (${VERSAO_COMPLETA})
     SELECT l.id AS lote_id, l.nome AS lote, COUNT(*)::int AS finalizadas
       FROM versao_completa AS vc
       INNER JOIN acervo.lote AS l ON l.id = vc.lote_id
      WHERE vc.completa IS TRUE AND EXTRACT(YEAR FROM vc.data_fim) = $<ano>
      GROUP BY l.id, l.nome
      ORDER BY l.nome`,
    { ano }
  )
}

controller.getExecucao = async () => {
  return db.conn.any(
    `WITH ut_completa AS (${UT_COMPLETA}),
     versao_completa AS (${VERSAO_COMPLETA})
     SELECT l.id AS lote_id, l.nome AS lote, COUNT(*)::int AS em_execucao
       FROM versao_completa AS vc
       INNER JOIN acervo.lote AS l ON l.id = vc.lote_id
      WHERE vc.iniciada IS TRUE AND vc.completa IS FALSE
      GROUP BY l.id, l.nome
      ORDER BY l.nome`
  )
}

// --- Projetos ---------------------------------------------------------------
//
// AS QUATRO ROTAS DE PROJETO SAO NOVAS, e nao herdadas: no SAP 2.3.5 elas
// existiam COMENTADAS, apontando todas para um `getInfoProjetos` que era um
// `// TODO` com uma consulta de outro assunto dentro (ele lia `acompanhamento
// .login` filtrando por um `$<mes>` que a funcao nao recebia -- nunca rodou).
// Trazer o comentario junto seria trazer quatro rotas quebradas.

controller.getInfoProjetos = async finalizado => {
  return db.conn.any(
    `WITH ut_completa AS (${UT_COMPLETA}),
     versao_completa AS (${VERSAO_COMPLETA}),
     por_lote AS (
       SELECT vc.lote_id,
              COUNT(*)::int AS versoes,
              COUNT(*) FILTER (WHERE vc.completa IS TRUE)::int AS finalizadas,
              COUNT(*) FILTER (
                WHERE vc.completa IS FALSE AND vc.iniciada IS TRUE
              )::int AS em_execucao,
              MAX(vc.data_fim) FILTER (WHERE vc.completa IS TRUE) AS ultima_entrega
         FROM versao_completa AS vc
        GROUP BY vc.lote_id
     )
     SELECT p.id AS projeto_id, p.nome AS projeto, p.descricao,
            p.data_inicio, p.data_fim, p.status_execucao_id,
            tse.nome AS status,
            COUNT(DISTINCT l.id)::int AS lotes,
            COALESCE(SUM(pl.versoes), 0)::int AS versoes,
            COALESCE(SUM(pl.finalizadas), 0)::int AS finalizadas,
            COALESCE(SUM(pl.em_execucao), 0)::int AS em_execucao,
            MAX(pl.ultima_entrega) AS ultima_entrega
       FROM acervo.projeto AS p
       INNER JOIN dominio.tipo_status_execucao AS tse ON tse.code = p.status_execucao_id
       LEFT JOIN acervo.lote AS l ON l.projeto_id = p.id
       LEFT JOIN por_lote AS pl ON pl.lote_id = l.id
      WHERE ($<finalizado> IS NULL
             OR ($<finalizado> IS TRUE AND p.status_execucao_id IN ($<encerrado:csv>))
             OR ($<finalizado> IS FALSE AND p.status_execucao_id NOT IN ($<encerrado:csv>)))
      GROUP BY p.id, p.nome, p.descricao, p.data_inicio, p.data_fim,
               p.status_execucao_id, tse.nome
      ORDER BY p.nome`,
    {
      finalizado: finalizado === undefined ? null : finalizado,
      encerrado: STATUS_ENCERRADO
    }
  )
}

// O 404 sai daqui, e nao da rota: e a mesma consulta que ja vai ao banco.
const exigirProjeto = async projetoId => {
  const projeto = await db.conn.oneOrNone(
    'SELECT id, nome FROM acervo.projeto WHERE id = $<projetoId>',
    { projetoId }
  )
  if (!projeto) {
    throw new AppError('Projeto não encontrado', httpCode.NotFound)
  }
  return projeto
}

controller.getInfoProjetoAnual = async (projetoId, ano) => {
  await exigirProjeto(projetoId)

  return db.conn.any(
    `WITH meses AS (
       SELECT generate_series(1, 12) AS mes
     ),
     ut_completa AS (${UT_COMPLETA}),
     versao_completa AS (${VERSAO_COMPLETA}),
     realizado AS (
       SELECT l.id AS lote_id, l.nome AS lote,
              EXTRACT(MONTH FROM vc.data_fim)::int AS mes,
              COUNT(*)::int AS finalizadas
         FROM versao_completa AS vc
         INNER JOIN acervo.lote AS l ON l.id = vc.lote_id
        WHERE l.projeto_id = $<projetoId>
          AND vc.completa IS TRUE
          AND EXTRACT(YEAR FROM vc.data_fim) = $<ano>
        GROUP BY l.id, l.nome, EXTRACT(MONTH FROM vc.data_fim)
     ),
     lotes AS (
       SELECT id AS lote_id, nome AS lote
         FROM acervo.lote WHERE projeto_id = $<projetoId>
     )
     SELECT lo.lote_id, lo.lote, ms.mes,
            COALESCE(r.finalizadas, 0)::int AS finalizadas
       FROM lotes AS lo
       CROSS JOIN meses AS ms
       LEFT JOIN realizado AS r ON r.lote_id = lo.lote_id AND r.mes = ms.mes
      ORDER BY lo.lote, ms.mes`,
    { projetoId, ano }
  )
}

/**
 * O detalhe de um projeto: cada lote, cada fase, quanto andou.
 *
 * `ano` OPCIONAL, e nulo quer dizer "a vida inteira do projeto". As duas rotas
 * (`/informacao_detalhada` e `/informacao_detalhada/:ano`) sao a MESMA pergunta
 * com e sem recorte, e por isso uma funcao so: duas divergiriam na primeira
 * coluna acrescentada a uma delas.
 */
controller.getInfoProjetoDetalhada = async (projetoId, ano = null) => {
  await exigirProjeto(projetoId)

  return db.conn.any(
    `WITH versao_fase AS (
       SELECT v.id AS versao_id, ut.lote_id, f.id AS fase_id, f.ordem AS fase_ordem,
              tf.nome AS fase_nome, lp.nome AS linha_producao,
              MIN(a.data_inicio) AS data_inicio,
              (CASE WHEN COUNT(*) = COUNT(a.data_fim) THEN MAX(a.data_fim) END) AS data_fim
         FROM acervo.versao AS v
         INNER JOIN producao.relacionamento_versao AS rv ON rv.versao_id = v.id
         INNER JOIN producao.unidade_trabalho AS ut ON ut.id = rv.ut_id
         INNER JOIN acervo.lote AS l ON l.id = ut.lote_id
         INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
         INNER JOIN producao.fase AS f ON f.id = s.fase_id
         INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
         INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
         INNER JOIN producao.atividade AS a ON a.unidade_trabalho_id = ut.id
        WHERE l.projeto_id = $<projetoId>
          AND a.tipo_situacao_atividade_id <> $<naoFinalizada>
        GROUP BY v.id, ut.lote_id, f.id, f.ordem, tf.nome, lp.nome
     )
     SELECT l.id AS lote_id, l.nome AS lote, vf.linha_producao,
            vf.fase_id, vf.fase_ordem, vf.fase_nome AS fase,
            COUNT(*)::int AS versoes,
            COUNT(*) FILTER (WHERE vf.data_fim IS NOT NULL)::int AS finalizadas,
            COUNT(*) FILTER (
              WHERE vf.data_inicio IS NOT NULL AND vf.data_fim IS NULL
            )::int AS em_execucao,
            COUNT(*) FILTER (WHERE vf.data_inicio IS NULL)::int AS restantes
       FROM versao_fase AS vf
       INNER JOIN acervo.lote AS l ON l.id = vf.lote_id
      WHERE ($<ano> IS NULL OR EXTRACT(YEAR FROM vf.data_fim) = $<ano>)
      GROUP BY l.id, l.nome, vf.linha_producao, vf.fase_id, vf.fase_ordem, vf.fase_nome
      ORDER BY l.nome, vf.linha_producao, vf.fase_ordem`,
    { projetoId, ano, naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA }
  )
}

// --- Mapa e tiles -----------------------------------------------------------
//
// AS VIEWS DESTE SCHEMA SAO GERADAS EM TEMPO DE EXECUCAO, e essa e a armadilha
// que as duas funcoes abaixo existem para tratar.
//
// `er/acompanhamento_producao.sql` nao cria view nenhuma: ele cria FUNCOES que
// EMITEM DDL, e os gatilhos que as chamam. Uma view materializada nasce quando a
// primeira etapa de um par (lote, linha de producao) e cadastrada, e some quando
// a ultima e removida -- `acompanhamento.lote_<lote>_linha_<linha>`,
// `acompanhamento.lote_<lote>_subfase_<subfase>` e a `acompanhamento.bloco`,
// que e unica.
//
// LOGO: nome valido cuja view ainda NAO EXISTE e caso NORMAL, e nao erro do
// sistema. Sem a conferencia em `pg_matviews` o Postgres responderia
// "relation ... does not exist", que o `errorHandler` traduziria em 500 -- a
// tela diria "erro no servidor" para um lote que simplesmente ainda nao tem
// etapa cadastrada. Aqui isso e 404 com a frase que explica o que fazer.
//
// `pg_matviews` E A FONTE DE VERDADE, e nao um catalogo derivado de
// (lote x linha de producao): o par so vira view quando ha ETAPA, e um catalogo
// calculado mentiria para todo lote configurado pela metade.

const camadaExiste = async nome => {
  const achado = await db.conn.oneOrNone(
    `SELECT 1 AS existe
       FROM pg_matviews
      WHERE schemaname = 'acompanhamento' AND matviewname = $<nome>`,
    { nome }
  )
  return !!achado
}

controller.getLayerGeoJSON = async nome => {
  if (!(await camadaExiste(nome))) {
    throw new AppError(
      `A camada de acompanhamento "${nome}" ainda não existe. Ela é criada ` +
      'quando o lote recebe a primeira etapa da linha de produção ou da subfase.',
      httpCode.NotFound
    )
  }

  // O NOME VAI COMO `:raw`, e e o unico lugar deste modulo em que isso acontece:
  // identificador de tabela nao e parametro em SQL. Ele passou por DUAS peneiras
  // antes -- a expressao regular ancorada do Joi (`nomeParams`) e a existencia em
  // `pg_matviews` logo acima -- e nenhuma das duas deixa passar aspas, ponto e
  // virgula ou espaco.
  return db.conn.oneOrNone(
    `SELECT row_to_json(fc) AS geojson
       FROM (
         SELECT 'FeatureCollection' AS type, array_to_json(array_agg(f)) AS features
           FROM (
             SELECT 'Feature' AS type,
                    ST_AsGeoJSON(d.geom)::json AS geometry,
                    to_jsonb(lg) - 'geom' AS properties
               FROM acompanhamento.$<nome:raw> AS lg,
               LATERAL ST_Dump(lg.geom) AS d
           ) AS f
       ) AS fc`,
    { nome }
  )
}

/**
 * A tile vetorial de uma linha de produção, sobre todos os lotes que a executam.
 *
 * UMA CAMADA, VARIAS VIEWS. A view materializada e por PAR (lote, linha de
 * producao) -- o nome `lote_<L>_linha_<P>` foi escolhido em 2026-08-09
 * justamente porque um lote atravessa linhas, e o `lote_<N>` do SAP colidiria.
 * Um mapa de acompanhamento, porem, pergunta pela LINHA inteira, entao a tile e
 * a uniao das views daquele `P` sobre todos os lotes que tem etapa nela.
 *
 * SO AS COLUNAS FIXAS ENTRAM. As views geradas tem colunas DINAMICAS, duas por
 * fase (`f_1_extracao_data_inicio`...), e o conjunto delas muda quando a linha de
 * producao ganha fase. Uma tile que as carregasse mudaria de esquema sozinha, e
 * o estilo do cliente quebraria sem ninguem ter tocado no mapa. As oito fixas
 * (`id`, `uuid`, `nome`, `mi`, `inom`, `escala`, `subtipo_produto`, `geom`) sao
 * contrato do gerador.
 *
 * DEVOLVE `null` QUANDO NAO HA VIEW NENHUMA, e a rota traduz isso em 204. Linha
 * de producao sem lote configurado nao e erro: e uma linha que ainda nao comecou.
 */
controller.getMvtLinhaProducao = async (linhaProducaoId, z, x, y) => {
  // O padrao ancora o `_linha_<id>` no FIM, senao a linha 1 casaria a view da
  // linha 10. O `id` ja veio inteiro positivo do Joi.
  const views = await db.conn.any(
    `SELECT matviewname AS nome,
            substring(matviewname FROM 'lote_([0-9]+)_linha_')::bigint AS lote_id
       FROM pg_matviews
      WHERE schemaname = 'acompanhamento'
        AND matviewname ~ ('^lote_[0-9]+_linha_' || $<linhaProducaoId> || '$')
      ORDER BY lote_id`,
    { linhaProducaoId: String(linhaProducaoId) }
  )

  if (views.length === 0) return null

  // A ENVELOPE DA TILE E CALCULADA UMA VEZ, em 3857, e comparada com a geometria
  // em 4674 por transformacao da ENVELOPE (e nao da coluna): transformar a coluna
  // impediria o indice GiST que o gerador cria sobre `geom`.
  const partes = views.map(v =>
    db.pgp.as.format(
      `SELECT $<loteId>::bigint AS lote_id, c.id, c.uuid, c.nome, c.mi, c.inom,
              c.escala, c.subtipo_produto,
              ST_AsMVTGeom(
                ST_Transform(c.geom, 3857),
                ST_TileEnvelope($<z>, $<x>, $<y>),
                4096, 0, true
              ) AS geom
         FROM acompanhamento.$<nome:raw> AS c
        WHERE c.geom && ST_Transform(ST_TileEnvelope($<z>, $<x>, $<y>), 4674)`,
      { loteId: v.lote_id, nome: v.nome, z, x, y }
    )
  )

  const linha = await db.conn.one(
    `SELECT ST_AsMVT(q, $<camada>, 4096, 'geom') AS tile
       FROM (${partes.join(' UNION ALL ')}) AS q
      WHERE q.geom IS NOT NULL`,
    { camada: `linha_producao_${linhaProducaoId}` }
  )

  return linha.tile
}

// --- O pacote do site de acompanhamento -------------------------------------

/**
 * Os arquivos que o site estático de acompanhamento consome, prontos para o zip.
 *
 * Devolve `[{ nome, dados }]`: um `dados.json` com a árvore projeto/lote e um
 * `<lote>.geojson` por lote, com a folha e a fase em que ela está.
 */
controller.getDadosSiteAcompanhamento = async () => {
  const cabecalho = await db.conn.any(
    `SELECT DISTINCT p.id AS projeto_id, p.nome AS projeto,
            p.descricao AS descricao_projeto,
            l.id AS lote_id, l.nome AS lote, l.descricao AS descricao_lote,
            f.tipo_fase_id AS fase_id, f.ordem AS fase_ordem,
            json_build_array(
              json_build_array(ST_XMin(b.bounds), ST_YMin(b.bounds)),
              json_build_array(ST_XMax(b.bounds), ST_YMax(b.bounds))
            ) AS bounds
       FROM acervo.projeto AS p
       INNER JOIN acervo.lote AS l ON l.projeto_id = p.id
       -- A LINHA DE PRODUCAO DO LOTE E DERIVADA DA ETAPA, e nao cadastrada: a
       -- a producao.lote_linha foi removida em 2026-08-09, e quem responde "que
       -- linhas este lote executa" e a existencia de etapa numa subfase delas.
       INNER JOIN producao.etapa AS e ON e.lote_id = l.id
       INNER JOIN producao.subfase AS s ON s.id = e.subfase_id
       INNER JOIN producao.fase AS f ON f.id = s.fase_id
       INNER JOIN (
         SELECT v.lote_id, ST_Envelope(ST_Collect(pr.geom)) AS bounds
           FROM acervo.versao AS v
           INNER JOIN acervo.produto AS pr ON pr.id = v.produto_id
          WHERE v.lote_id IS NOT NULL
          GROUP BY v.lote_id
       ) AS b ON b.lote_id = l.id
      WHERE p.status_execucao_id NOT IN ($<encerrado:csv>)
      ORDER BY p.id, l.id, f.ordem`,
    { encerrado: STATUS_ENCERRADO }
  )

  const dadosOrganizados = {}
  const auxLotes = {}

  cabecalho.forEach(d => {
    if (!(d.projeto_id in dadosOrganizados)) {
      dadosOrganizados[d.projeto_id] = { lotes: [] }
      auxLotes[d.projeto_id] = {}
    }
    dadosOrganizados[d.projeto_id].title = d.projeto
    dadosOrganizados[d.projeto_id].description = d.descricao_projeto

    if (!(d.lote_id in auxLotes[d.projeto_id])) {
      auxLotes[d.projeto_id][d.lote_id] = { legend: [0] }
    }
    const lote = auxLotes[d.projeto_id][d.lote_id]
    lote.name = d.lote_id
    lote.subtitle = d.lote
    lote.description = d.descricao_lote
    lote.zoom = d.bounds
    if (!lote.legend.includes(d.fase_id)) lote.legend.push(d.fase_id)
  })

  Object.keys(auxLotes).forEach(projeto => {
    Object.keys(auxLotes[projeto]).forEach(lote => {
      dadosOrganizados[projeto].lotes.push(auxLotes[projeto][lote])
    })
  })

  const geojson = await db.conn.any(
    `SELECT v.lote_id, json_build_object(
              'type', 'FeatureCollection',
              'features', json_agg(
                json_build_object(
                  'type', 'Feature',
                  'geometry', ST_AsGeoJSON(pr.geom)::json,
                  'properties', json_build_object(
                    'id', v.id,
                    'identificador', COALESCE(pr.mi, pr.inom, v.nome),
                    'situacao', COALESCE(sit.nome, 'Previsto')
                  )
                )
              )
            ) AS json
       FROM acervo.versao AS v
       INNER JOIN acervo.produto AS pr ON pr.id = v.produto_id
       INNER JOIN acervo.lote AS l ON l.id = v.lote_id
       INNER JOIN acervo.projeto AS proj ON proj.id = l.projeto_id
       -- A FASE MAIS ADIANTADA em que esta versao ja teve trabalho INICIADO.
       -- LATERAL com ORDER BY f.ordem DESC LIMIT 1 responde isso numa
       -- passada; a origem montava tres subconsultas aninhadas e um
       -- bool_or(completed) para chegar ao mesmo lugar.
       LEFT JOIN LATERAL (
         SELECT tf.nome
           FROM producao.relacionamento_versao AS rv
           INNER JOIN producao.unidade_trabalho AS ut ON ut.id = rv.ut_id
           INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
           INNER JOIN producao.fase AS f ON f.id = s.fase_id
           INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
          WHERE rv.versao_id = v.id
            AND EXISTS (
              SELECT 1 FROM producao.atividade AS a
               WHERE a.unidade_trabalho_id = ut.id AND a.data_inicio IS NOT NULL
            )
          ORDER BY f.ordem DESC
          LIMIT 1
       ) AS sit ON TRUE
      WHERE proj.status_execucao_id NOT IN ($<encerrado:csv>)
      GROUP BY v.lote_id`,
    { encerrado: STATUS_ENCERRADO }
  )

  const retorno = [{ nome: 'dados.json', dados: dadosOrganizados }]
  geojson.forEach(g => {
    retorno.push({ nome: `${g.lote_id}.geojson`, dados: g.json })
  })

  return retorno
}

module.exports = controller
