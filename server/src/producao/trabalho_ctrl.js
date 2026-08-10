'use strict'

// O TRABALHO: bloco, unidade de trabalho, atividade e dado de producao.
//
// Atravessa do `projeto_ctrl.js` do SAP 2.3.5, e tres conversoes valem para o
// arquivo inteiro:
//
//   `db.sapConn`  -> `db.conn`, e o schema `macrocontrole` -> `producao`.
//   `lote_id`     -> `acervo.lote (id)`, BIGINT. A linha de producao e DERIVADA
//                    da etapa (etapa -> subfase -> fase -> linha_producao) e o
//                    status do lote e `acervo.lote.status_execucao_id`.
//   `usuario_id`  -> `usuario_uuid`, apontando `dgeo.usuario (uuid)`.
//
// O `disableTriggers` DO SAP NAO EXISTE AQUI, e a ausencia e o desenho. La o
// servidor desligava os gatilhos, escrevia e recalculava o cache a mao; aqui o
// gatilho `a_relacionamento_unidade_trabalho` de `er/producao.sql` mantem
// `producao.relacionamento_ut` e `producao.relacionamento_versao` sozinho, linha
// a linha. Por isso NAO HA PORTA DE ESCRITA para as duas tabelas neste arquivo:
// abrir uma faz o cache deixar de bater com a geometria no primeiro uso,
// exatamente como `mapoteca.estoque_material` faz com o livro de movimento.
//
// O CUSTO DISSO ESTA MEDIDO EM COMENTARIO nas tres rotas de carga em massa
// (`POST /unidade_trabalho`, `POST /unidade_trabalho/copiar` e
// `POST /atividades/todas`), porque ele e real e nao se esconde.

const { db } = require('../database')

// PELO CAMINHO, E NAO PELO BARRIL: `database/index.js` nao exporta o subsistema
// de conexao ao banco de producao. Ver o cabecalho de
// `database/conexao_admin.js`.
const conexaoAdmin = require('../database/conexao_admin')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const config = require('../config')

const {
  STATUS_EXECUCAO,
  SITUACAO_ATIVIDADE,
  TIPO_ETAPA,
  TIPO_DADO_PRODUCAO
} = require('../utils/domain_constants')

const controller = {}

// --- Erros do banco que viram resposta amigavel ------------------------------

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'
const CHECK_VIOLATION = '23514'
// `RAISE EXCEPTION` de funcao plpgsql sem SQLSTATE proprio. E o codigo dos
// gatilhos de `er/producao.sql`: `chk_bloco_status` e
// `atividade_verifica_subfase`.
const RAISE_EXCEPTION = 'P0001'

/**
 * Traduz o erro do PostgreSQL para o 4xx que diz o que fazer.
 *
 * O 500 cru cita o nome da restricao ('atividade_unique_index') ou a frase do
 * `RAISE EXCEPTION`, e nenhum dos dois chega a quem acabou de clicar. Cada
 * codigo abaixo tem uma causa unica em cada grupo de rotas, e por isso a
 * traducao e por grupo e nao global.
 *
 * O `RAISE_EXCEPTION` E O CASO ESPECIAL, e ele merece o cuidado: a frase do
 * gatilho JA ESTA em portugues e ja e a explicacao (o `chk_bloco_status`
 * distingue "criar ou reabrir" de "alterar o status"). Substitui-la por uma
 * generica perderia informacao, entao ela e aproveitada como a mensagem.
 */
const traduzirErro = (err, mensagens) => {
  if (!err || !err.code) return err

  if (err.code === RAISE_EXCEPTION) {
    const frase = err.message || mensagens[RAISE_EXCEPTION]
    return new AppError(frase, httpCode.BadRequest, err)
  }

  const frase = mensagens[err.code]
  if (!frase) return err
  return new AppError(frase, mensagens.status || httpCode.BadRequest, err)
}

const comTraducao = async (promessa, mensagens) => {
  try {
    return await promessa()
  } catch (err) {
    if (err instanceof AppError) throw err
    throw traduzirErro(err, mensagens)
  }
}

// O opcional AUSENTE vira null antes da consulta: sem isto, um corpo valido que
// omite `nome` ou `observacao` derruba o pg-promise com "Property doesn't
// exist", que chega como 500 onde nao houve erro nenhum.
const normaliza = (colunas, dados) => {
  const saida = {}
  for (const coluna of colunas) {
    saida[coluna] = dados[coluna] !== undefined ? dados[coluna] : null
  }
  return saida
}

// --- Constantes de dominio usadas no SQL -------------------------------------

// ENCERRADO E `IN (3, 4)`, e PAUSADO NAO E ENCERRADO. E a mesma leitura do
// gatilho `chk_bloco_status` e a que `docs/decisoes.md` registra: o
// `dominio.status` do SAP nao atravessou, e `tipo_status_execucao` responde no
// lugar dele.
const STATUS_ENCERRADO = [
  STATUS_EXECUCAO.CONCLUIDO,
  STATUS_EXECUCAO.CONCLUIDO_PARCIALMENTE
]

// A atividade que NAO deixa mexer na geometria: em execucao ou pausada. A
// finalizada (4) nao impede, porque o trabalho dela ja aconteceu.
const SITUACAO_TRABALHANDO = [
  SITUACAO_ATIVIDADE.EM_EXECUCAO,
  SITUACAO_ATIVIDADE.PAUSADA
]

// OS DOIS TIPOS QUE SAO BANCO DE DADOS. O tipo 1 ('Nao controlado') e dado que o
// sistema apenas aponta, e por isso ele nao entra em `GET /banco_dados`.
const TIPOS_COM_BANCO = [
  TIPO_DADO_PRODUCAO.POSTGIS_COM_PERMISSAO,
  TIPO_DADO_PRODUCAO.POSTGIS
]

// --- Auditoria: as quatro tabelas deste arquivo ------------------------------

const TABELA_BLOCO = 'producao.bloco'
const TABELA_UT = 'producao.unidade_trabalho'
const TABELA_ATIVIDADE = 'producao.atividade'
const TABELA_DADO_PRODUCAO = 'producao.dado_producao'

// `producao.insumo_unidade_trabalho` NAO ENTRA NA TRILHA, e a ausencia e a
// decisao do DDL, dita com todas as letras: "e derivada da estrategia de
// associacao, e por isso nao tem auditoria propria. Quem responde por ela e o
// insumo e a unidade de trabalho, cada um com as suas". As copias que o
// `copiar`, o `cut` e o `merge` fazem nela sao consequencia mecanica da operacao
// sobre a UT, e o evento da UT ja as descreve.

// A GEOMETRIA SAI COMO EWKT, e nunca como o WKB hexadecimal do `RETURNING *`.
// `SELECT *, ST_AsEWKT(geom) AS geom` teria DUAS colunas com o mesmo nome, e
// qual delas sobrevive no objeto passa a depender do driver; por isso a lista e
// escrita a mao.
const RETORNO_UT = `id, nome, epsg, dado_producao_id, subfase_id, lote_id,
  bloco_id, disponivel, dificuldade, tempo_estimado_minutos, prioridade,
  observacao, ST_AsEWKT(geom)::text AS geom,
  data_cadastramento, usuario_cadastramento_uuid,
  data_modificacao, usuario_modificacao_uuid`

// --- Bloco -------------------------------------------------------------------

const ERROS_BLOCO = {
  [UNIQUE_VIOLATION]: 'Já existe um bloco com este nome no mesmo lote',
  [FK_VIOLATION]:
    'O lote informado não existe, ou o status de execução informado não está no domínio',
  [RAISE_EXCEPTION]: 'O lote deste bloco já está encerrado'
}

const ERROS_BLOCO_DELETE = {
  [FK_VIOLATION]:
    'Não é possível remover o bloco: existe unidade de trabalho associada a ele'
}

const SELECT_BLOCO = `
  SELECT b.id, b.nome, b.prioridade, b.status_execucao_id,
         tse.nome AS status_execucao,
         b.lote_id, l.nome AS lote, l.status_execucao_id AS lote_status_execucao_id
    FROM producao.bloco AS b
   INNER JOIN dominio.tipo_status_execucao AS tse ON tse.code = b.status_execucao_id
   INNER JOIN acervo.lote AS l ON l.id = b.lote_id`

/**
 * A lista de blocos, com o filtro opcional de situacao.
 *
 * NO SAP O FILTRO ERA `status_id = 1` contra o `dominio.status` de tres codigos,
 * onde 1 era "Em execucao". Aqui o dominio tem cinco e o corte util e o do
 * gatilho: 'execucao' quer dizer NAO ENCERRADO (fora de 3 e 4), e por isso o
 * bloco Pausado continua aparecendo -- ele nao acabou.
 */
controller.getBlocos = async filtro => {
  let where = ''
  if (filtro === 'execucao') {
    where = 'WHERE b.status_execucao_id NOT IN ($<encerrado:csv>)'
  } else if (filtro === 'encerrado') {
    where = 'WHERE b.status_execucao_id IN ($<encerrado:csv>)'
  }

  return db.conn.any(
    `${SELECT_BLOCO} ${where} ORDER BY b.lote_id, b.prioridade, b.nome`,
    { encerrado: STATUS_ENCERRADO }
  )
}

const COLUNAS_BLOCO = ['nome', 'prioridade', 'lote_id', 'status_execucao_id']

/**
 * Cria blocos em massa.
 *
 * UMA LINHA POR VEZ, com `RETURNING *`, e nao o `db.pgp.helpers.insert` do SAP
 * com o array inteiro. O insert em massa devolve o conjunto sem dizer qual linha
 * e qual, e a trilha precisa de UM evento por bloco. O `contexto.loteId` (um por
 * REQUISICAO) e o que reagrupa os eventos numa tela so.
 */
controller.criarBlocos = async (blocos, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const criados = []

        for (const bloco of blocos) {
          const criado = await t.one(
            `INSERT INTO producao.bloco
               (nome, prioridade, lote_id, status_execucao_id,
                usuario_cadastramento_uuid)
             VALUES
               ($<nome>, $<prioridade>, $<lote_id>, $<status_execucao_id>,
                $<usuarioUuid>)
             RETURNING *`,
            { ...normaliza(COLUNAS_BLOCO, bloco), usuarioUuid }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_BLOCO,
            registroId: criado.id,
            operacao: 'I',
            depois: criado,
            usuarioUuid,
            contexto
          })

          criados.push({ id: criado.id, nome: criado.nome })
        }

        return criados
      }),
    ERROS_BLOCO
  )
}

controller.atualizarBlocos = async (blocos, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        for (const bloco of blocos) {
          // `lerAntes` faz as DUAS coisas numa consulta: guarda o estado
          // anterior para o rastro e lanca o 404 quando o registro nao existe.
          const antes = await auditoriaCtrl.lerAntes(
            t,
            TABELA_BLOCO,
            bloco.id,
            'Bloco'
          )

          const depois = await t.one(
            `UPDATE producao.bloco SET
               nome = $<nome>, prioridade = $<prioridade>,
               lote_id = $<lote_id>, status_execucao_id = $<status_execucao_id>,
               data_modificacao = CURRENT_TIMESTAMP,
               usuario_modificacao_uuid = $<usuarioUuid>
             WHERE id = $<id>
             RETURNING *`,
            { ...normaliza(COLUNAS_BLOCO, bloco), id: bloco.id, usuarioUuid }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_BLOCO,
            registroId: bloco.id,
            operacao: 'U',
            antes,
            depois,
            usuarioUuid,
            contexto
          })
        }
      }),
    ERROS_BLOCO
  )
}

controller.deletarBlocos = async (blocoIds, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        // A CHECAGEM EXPLICITA CONTINUA, apesar de a chave estrangeira tambem
        // recusar: ela diz QUE o bloco tem unidade de trabalho antes de a
        // transacao escrever qualquer coisa, e a FK so diria depois, com o nome
        // da restricao no lugar da frase.
        const comUnidade = await t.oneOrNone(
          `SELECT b.nome
             FROM producao.unidade_trabalho AS ut
            INNER JOIN producao.bloco AS b ON b.id = ut.bloco_id
            WHERE ut.bloco_id IN ($<blocoIds:csv>)
            LIMIT 1`,
          { blocoIds }
        )
        if (comUnidade) {
          throw new AppError(
            `O bloco "${comUnidade.nome}" possui unidades de trabalho associadas`,
            httpCode.BadRequest
          )
        }

        for (const id of blocoIds) {
          const antes = await auditoriaCtrl.lerAntes(t, TABELA_BLOCO, id, 'Bloco')

          await t.none('DELETE FROM producao.bloco WHERE id = $<id>', { id })

          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_BLOCO,
            registroId: id,
            operacao: 'D',
            antes,
            usuarioUuid,
            contexto
          })
        }
      }),
    ERROS_BLOCO_DELETE
  )
}

// --- Unidade de trabalho -----------------------------------------------------

const ERROS_UT = {
  [UNIQUE_VIOLATION]: 'Já existe uma unidade de trabalho igual a esta',
  [FK_VIOLATION]:
    'O lote, o bloco, a subfase ou o dado de produção informado não existe',
  [CHECK_VIOLATION]:
    'A dificuldade e o tempo estimado da unidade de trabalho não podem ser negativos'
}

const ERROS_UT_DELETE = {
  [FK_VIOLATION]:
    'Não é possível remover a unidade de trabalho: existe registro associado a ela'
}

/**
 * A lista de unidades de trabalho de um lote.
 *
 * A LINHA DE PRODUCAO SAI DA ETAPA, e nao do lote: `acervo.lote` nao tem
 * `linha_producao_id` e nao vai ter, porque um lote do acervo ATRAVESSA linhas
 * (61 dos 102 lotes com versao carregam mais de um subtipo, medido em
 * 2026-08-09). O caminho e `unidade_trabalho -> subfase -> fase ->
 * linha_producao`, e e por ele que a tela sabe o que aquela UT fabrica.
 */
controller.getUnidadesTrabalho = async loteId => {
  return db.conn.any(
    `SELECT ut.id, ut.nome, ut.epsg, ut.disponivel, ut.prioridade,
            ut.dificuldade, ut.tempo_estimado_minutos, ut.observacao,
            ut.subfase_id, s.nome AS subfase,
            ut.bloco_id, b.nome AS bloco,
            ut.dado_producao_id,
            ut.lote_id,
            lp.id AS linha_producao_id, lp.nome AS linha_producao
       FROM producao.unidade_trabalho AS ut
      INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
      INNER JOIN producao.fase AS f ON f.id = s.fase_id
      INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
      INNER JOIN producao.bloco AS b ON b.id = ut.bloco_id
      WHERE ut.lote_id = $<loteId>
      ORDER BY ut.subfase_id, ut.prioridade, ut.id`,
    { loteId }
  )
}

const COLUNAS_UT = [
  'nome',
  'epsg',
  'observacao',
  'geom',
  'dado_producao_id',
  'bloco_id',
  'disponivel',
  'prioridade',
  'dificuldade',
  'tempo_estimado_minutos'
]

/**
 * Cria unidades de trabalho, uma por par (recorte, subfase).
 *
 * DESEMPENHO, e esta e a rota que mais sente a ausencia do `disableTriggers`: o
 * gatilho `a_relacionamento_unidade_trabalho` roda FOR EACH ROW e refaz os dois
 * caches espaciais a cada linha, com um `st_relate` contra as demais UTs do
 * mesmo lote e contra `acervo.produto`. Numa carga de milhares de recortes vezes
 * varias subfases isso e O(n) chamadas espaciais em vez de uma passada so.
 *
 * A TROCA E DELIBERADA e esta em `docs/decisoes.md`: desligar gatilho para
 * escrever mais rapido foi justamente o que obrigava o SAP a recalcular o cache
 * a mao depois, e um recalculo esquecido deixa `relacionamento_ut` e
 * `relacionamento_versao` mentindo em silencio. Se a carga de um lote inteiro
 * passar a doer, o caminho e a funcao de MASSA que o DDL ja expoe
 * (`producao.handle_relacionamento_ut_insert_update(INTEGER[])`), e trocar o
 * gatilho por ela e DECISAO, que se registra em `docs/decisoes.md`.
 */
controller.criarUnidadesTrabalho = async (
  unidadesTrabalho,
  loteId,
  subfaseIds,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const criadas = []

        for (const subfaseId of subfaseIds) {
          for (const unidade of unidadesTrabalho) {
            const criada = await t.one(
              `INSERT INTO producao.unidade_trabalho
                 (nome, epsg, dado_producao_id, subfase_id, lote_id, bloco_id,
                  disponivel, dificuldade, tempo_estimado_minutos, prioridade,
                  observacao, geom, usuario_cadastramento_uuid)
               VALUES
                 ($<nome>, $<epsg>, $<dado_producao_id>, $<subfaseId>, $<loteId>,
                  $<bloco_id>, $<disponivel>, $<dificuldade>,
                  $<tempo_estimado_minutos>, $<prioridade>, $<observacao>,
                  ST_GeomFromEWKT($<geom>), $<usuarioUuid>)
               RETURNING ${RETORNO_UT}`,
              {
                ...normaliza(COLUNAS_UT, unidade),
                subfaseId,
                loteId,
                usuarioUuid
              }
            )

            await auditoriaCtrl.registrar(t, {
              tabela: TABELA_UT,
              registroId: criada.id,
              operacao: 'I',
              depois: criada,
              usuarioUuid,
              contexto
            })

            criadas.push(criada.id)
          }
        }

        return { unidade_trabalho_ids: criadas }
      }),
    ERROS_UT
  )
}

/**
 * Remove unidades de trabalho.
 *
 * O CACHE ESPACIAL SE LIMPA SOZINHO: o gatilho de DELETE de
 * `a_relacionamento_unidade_trabalho` apaga as linhas de
 * `producao.relacionamento_ut` e `producao.relacionamento_versao` ANTES de a
 * linha sumir, e e por isso que as duas tabelas nao tem chave estrangeira. O SAP
 * apagava `relacionamento_produto` a mao aqui; fazer o mesmo seria escrever num
 * cache que nao tem porta de escrita.
 */
controller.deletarUnidadesTrabalho = async (
  unidadeTrabalhoIds,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const comAtividade = await t.oneOrNone(
          `SELECT a.unidade_trabalho_id
             FROM producao.atividade AS a
            WHERE a.unidade_trabalho_id IN ($<unidadeTrabalhoIds:csv>)
            LIMIT 1`,
          { unidadeTrabalhoIds }
        )
        if (comAtividade) {
          throw new AppError(
            `A unidade de trabalho ${comAtividade.unidade_trabalho_id} possui atividades associadas`,
            httpCode.BadRequest
          )
        }

        for (const id of unidadeTrabalhoIds) {
          const antes = await auditoriaCtrl.lerAntes(
            t,
            TABELA_UT,
            id,
            'Unidade de trabalho'
          )

          // A associacao de insumo cai junto, e sem evento proprio: ver o
          // comentario de `producao.insumo_unidade_trabalho` no topo.
          await t.none(
            `DELETE FROM producao.insumo_unidade_trabalho
              WHERE unidade_trabalho_id = $<id>`,
            { id }
          )

          await t.none('DELETE FROM producao.unidade_trabalho WHERE id = $<id>', {
            id
          })

          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_UT,
            registroId: id,
            operacao: 'D',
            antes,
            usuarioUuid,
            contexto
          })
        }
      }),
    ERROS_UT_DELETE
  )
}

controller.unidadeTrabalhoBloco = async (
  unidadeTrabalhoIds,
  blocoId,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        for (const id of unidadeTrabalhoIds) {
          const antes = await auditoriaCtrl.lerAntes(
            t,
            TABELA_UT,
            id,
            'Unidade de trabalho'
          )

          const depois = await t.one(
            `UPDATE producao.unidade_trabalho SET
               bloco_id = $<blocoId>,
               data_modificacao = CURRENT_TIMESTAMP,
               usuario_modificacao_uuid = $<usuarioUuid>
             WHERE id = $<id>
             RETURNING ${RETORNO_UT}`,
            { id, blocoId, usuarioUuid }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_UT,
            registroId: id,
            operacao: 'U',
            antes,
            depois,
            usuarioUuid,
            contexto
          })
        }
      }),
    ERROS_UT
  )
}

/**
 * Copia unidades de trabalho para outras subfases.
 *
 * O MESMO RECORTE EM OUTRA SUBFASE, e nao um recorte novo: e assim que um lote
 * ganha a segunda subfase sem alguem redesenhar a grade. A geometria e copiada
 * como esta, entao o gatilho recalcula o cache das copias -- ver a nota de
 * desempenho de `criarUnidadesTrabalho`, que vale igual aqui.
 */
controller.copiarUnidadesTrabalho = async (
  subfaseIds,
  unidadeTrabalhoIds,
  associarInsumos,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const criadas = []

        for (const origemId of unidadeTrabalhoIds) {
          // O 404 amigavel de quebra: copiar de uma UT que nao existe tem de
          // dizer isso, e nao devolver uma lista vazia com 200.
          await auditoriaCtrl.lerAntes(
            t,
            TABELA_UT,
            origemId,
            'Unidade de trabalho'
          )

          for (const subfaseId of subfaseIds) {
            const copia = await t.one(
              `INSERT INTO producao.unidade_trabalho
                 (nome, epsg, dado_producao_id, subfase_id, lote_id, bloco_id,
                  disponivel, dificuldade, tempo_estimado_minutos, prioridade,
                  observacao, geom, usuario_cadastramento_uuid)
               SELECT ut.nome, ut.epsg, ut.dado_producao_id, $<subfaseId>,
                      ut.lote_id, ut.bloco_id, ut.disponivel, ut.dificuldade,
                      ut.tempo_estimado_minutos, ut.prioridade, ut.observacao,
                      ut.geom, $<usuarioUuid>
                 FROM producao.unidade_trabalho AS ut
                WHERE ut.id = $<origemId>
               RETURNING ${RETORNO_UT}`,
              { origemId, subfaseId, usuarioUuid }
            )

            if (associarInsumos) {
              await t.none(
                `INSERT INTO producao.insumo_unidade_trabalho
                   (unidade_trabalho_id, insumo_id, caminho_padrao)
                 SELECT $<copiaId>, iut.insumo_id, iut.caminho_padrao
                   FROM producao.insumo_unidade_trabalho AS iut
                  WHERE iut.unidade_trabalho_id = $<origemId>
                 ON CONFLICT (unidade_trabalho_id, insumo_id) DO NOTHING`,
                { copiaId: copia.id, origemId }
              )
            }

            await auditoriaCtrl.registrar(t, {
              tabela: TABELA_UT,
              registroId: copia.id,
              operacao: 'I',
              depois: copia,
              usuarioUuid,
              contexto
            })

            criadas.push(copia.id)
          }
        }

        return { unidade_trabalho_ids: criadas }
      }),
    ERROS_UT
  )
}

// --- As tres operacoes geometricas -------------------------------------------

/**
 * Recusa mexer na geometria de uma UT que esta sendo trabalhada.
 *
 * EM EXECUCAO OU PAUSADA, e nao finalizada: quem esta com o QGIS aberto naquele
 * recorte perderia o chao debaixo dos pes, e a pausada volta para a mesma mao.
 */
const exigirUnidadeParada = async (t, unidadeTrabalhoIds) => {
  const trabalhando = await t.oneOrNone(
    `SELECT a.unidade_trabalho_id
       FROM producao.atividade AS a
      WHERE a.unidade_trabalho_id IN ($<unidadeTrabalhoIds:csv>)
        AND a.tipo_situacao_atividade_id IN ($<situacoes:csv>)
      LIMIT 1`,
    { unidadeTrabalhoIds, situacoes: SITUACAO_TRABALHANDO }
  )
  if (trabalhando) {
    throw new AppError(
      `A unidade de trabalho ${trabalhando.unidade_trabalho_id} possui atividade em execução ou pausada`,
      httpCode.BadRequest
    )
  }
}

// A GEOMETRIA ENTRA POR `ST_GeomFromEWKT` e sai conferida por duas guardas: o
// Joi ja cobrou "SRID=4674;POLYGON" no texto, e a coluna
// `geometry(POLYGON, 4674)` cobra o mesmo no banco. A dupla e de proposito: o
// texto pode dizer 4674 e o corpo da geometria estar vazio ou invalido, e nesse
// caso quem recusa e o PostGIS.
const SET_GEOM = `geom = ST_GeomFromEWKT($<geom>),
  data_modificacao = CURRENT_TIMESTAMP,
  usuario_modificacao_uuid = $<usuarioUuid>`

controller.reshapeUnidadeTrabalho = async (
  unidadeTrabalhoId,
  geom,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const antes = await auditoriaCtrl.lerAntes(
          t,
          TABELA_UT,
          unidadeTrabalhoId,
          'Unidade de trabalho'
        )

        await exigirUnidadeParada(t, [unidadeTrabalhoId])

        const depois = await t.one(
          `UPDATE producao.unidade_trabalho SET ${SET_GEOM}
            WHERE id = $<id>
           RETURNING ${RETORNO_UT}`,
          { id: unidadeTrabalhoId, geom, usuarioUuid }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: TABELA_UT,
          registroId: unidadeTrabalhoId,
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto
        })
      }),
    ERROS_UT
  )
}

/**
 * Corta uma unidade de trabalho em varias.
 *
 * A PRIMEIRA PECA FICA COM A UNIDADE ORIGINAL e as demais viram unidades novas,
 * que herdam tudo dela: subfase, lote, bloco, insumo e ATIVIDADE, com a situacao
 * e as datas que a atividade original tinha. Sem herdar a atividade, o corte
 * apagaria o trabalho ja distribuido das pecas novas.
 *
 * O INDICE UNICO PARCIAL NAO E VIOLADO por isto: as pecas novas tem `id` novo,
 * entao o par (etapa, unidade de trabalho) tambem e novo.
 */
controller.cutUnidadeTrabalho = async (
  unidadeTrabalhoId,
  cutGeoms,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const antes = await auditoriaCtrl.lerAntes(
          t,
          TABELA_UT,
          unidadeTrabalhoId,
          'Unidade de trabalho'
        )

        await exigirUnidadeParada(t, [unidadeTrabalhoId])

        const [primeira, ...demais] = cutGeoms

        const depois = await t.one(
          `UPDATE producao.unidade_trabalho SET ${SET_GEOM}
            WHERE id = $<id>
           RETURNING ${RETORNO_UT}`,
          { id: unidadeTrabalhoId, geom: primeira, usuarioUuid }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: TABELA_UT,
          registroId: unidadeTrabalhoId,
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto
        })

        const novas = []

        for (const geom of demais) {
          const nova = await t.one(
            `INSERT INTO producao.unidade_trabalho
               (nome, epsg, dado_producao_id, subfase_id, lote_id, bloco_id,
                disponivel, dificuldade, tempo_estimado_minutos, prioridade,
                observacao, geom, usuario_cadastramento_uuid)
             SELECT ut.nome, ut.epsg, ut.dado_producao_id, ut.subfase_id,
                    ut.lote_id, ut.bloco_id, ut.disponivel, ut.dificuldade,
                    ut.tempo_estimado_minutos, ut.prioridade, ut.observacao,
                    ST_GeomFromEWKT($<geom>), $<usuarioUuid>
               FROM producao.unidade_trabalho AS ut
              WHERE ut.id = $<origemId>
             RETURNING ${RETORNO_UT}`,
            { origemId: unidadeTrabalhoId, geom, usuarioUuid }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_UT,
            registroId: nova.id,
            operacao: 'I',
            depois: nova,
            usuarioUuid,
            contexto
          })

          await t.none(
            `INSERT INTO producao.insumo_unidade_trabalho
               (unidade_trabalho_id, insumo_id, caminho_padrao)
             SELECT $<novaId>, iut.insumo_id, iut.caminho_padrao
               FROM producao.insumo_unidade_trabalho AS iut
              WHERE iut.unidade_trabalho_id = $<origemId>
             ON CONFLICT (unidade_trabalho_id, insumo_id) DO NOTHING`,
            { novaId: nova.id, origemId: unidadeTrabalhoId }
          )

          const atividades = await t.any(
            `INSERT INTO producao.atividade
               (etapa_id, unidade_trabalho_id, usuario_uuid,
                tipo_situacao_atividade_id, data_inicio, data_fim, observacao)
             SELECT a.etapa_id, $<novaId>, a.usuario_uuid,
                    a.tipo_situacao_atividade_id, a.data_inicio, a.data_fim,
                    a.observacao
               FROM producao.atividade AS a
              WHERE a.unidade_trabalho_id = $<origemId>
             RETURNING *`,
            { novaId: nova.id, origemId: unidadeTrabalhoId }
          )

          for (const atividade of atividades) {
            await auditoriaCtrl.registrar(t, {
              tabela: TABELA_ATIVIDADE,
              registroId: atividade.id,
              operacao: 'I',
              depois: atividade,
              usuarioUuid,
              contexto
            })
          }

          novas.push(nova.id)
        }

        return { unidade_trabalho_ids: [unidadeTrabalhoId, ...novas] }
      }),
    ERROS_UT
  )
}

/**
 * Funde varias unidades de trabalho numa so.
 *
 * A PRIMEIRA DA LISTA SOBREVIVE e recebe a geometria fundida; as demais somem. A
 * regra dificil e a das ATIVIDADES, e ela vem do SAP inteira:
 *
 *   - se alguma das UTs fundidas ainda NAO COMECOU aquela etapa (situacao 1) e a
 *     sobrevivente ja a tinha FINALIZADA (4), a finalizada vira 'Nao finalizada'
 *     (5) e uma nova nasce 'Nao iniciada' (1). Herdar o "finalizado" seria dizer
 *     que a area toda esta pronta quando um pedaco dela nunca foi tocado.
 *   - a observacao das nao iniciadas e concatenada, para nao se perder.
 *   - o que sobrar nas UTs que somem vira 5 e muda de dono, e as nao iniciadas
 *     delas sao apagadas.
 *
 * O CODE 5 E O QUE PERMITE ISSO SEM VIOLAR o `atividade_unique_index`: ele e o
 * unico fora do indice parcial, justamente por ser o registro das tentativas que
 * nao vingaram.
 */
controller.mergeUnidadeTrabalho = async (
  unidadeTrabalhoIds,
  geom,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        await exigirUnidadeParada(t, unidadeTrabalhoIds)

        const divergentes = await t.any(
          `SELECT DISTINCT subfase_id, lote_id, bloco_id
             FROM producao.unidade_trabalho
            WHERE id IN ($<unidadeTrabalhoIds:csv>)`,
          { unidadeTrabalhoIds }
        )
        // AS DUAS CONTAGENS DIZEM COISAS DIFERENTES, e uma mensagem so para as
        // duas mentiria: zero e "nenhuma dessas unidades existe", e mais de uma
        // e "elas nao sao do mesmo recorte de trabalho".
        if (divergentes.length === 0) {
          throw new AppError(
            'Nenhuma das unidades de trabalho informadas existe',
            httpCode.NotFound
          )
        }
        if (divergentes.length > 1) {
          throw new AppError(
            'As unidades de trabalho são de subfases, lotes ou blocos divergentes',
            httpCode.BadRequest
          )
        }

        const [primeiraId, ...absorvidasIds] = unidadeTrabalhoIds

        const antes = await auditoriaCtrl.lerAntes(
          t,
          TABELA_UT,
          primeiraId,
          'Unidade de trabalho'
        )

        const depois = await t.one(
          `UPDATE producao.unidade_trabalho SET ${SET_GEOM}
            WHERE id = $<id>
           RETURNING ${RETORNO_UT}`,
          { id: primeiraId, geom, usuarioUuid }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: TABELA_UT,
          registroId: primeiraId,
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto
        })

        const auditarAtividades = async (linhas, operacao) => {
          for (const linha of linhas) {
            await auditoriaCtrl.registrar(t, {
              tabela: TABELA_ATIVIDADE,
              registroId: linha.id,
              operacao,
              [operacao === 'D' ? 'antes' : 'depois']: linha,
              usuarioUuid,
              contexto
            })
          }
        }

        // 1) A finalizada da sobrevivente cai para 'Nao finalizada' quando
        //    alguma das absorvidas ainda nao comecou a mesma etapa.
        const rebaixadas = await t.any(
          `UPDATE producao.atividade AS a
              SET tipo_situacao_atividade_id = $<naoFinalizada>
             FROM (
               SELECT etapa_id
                 FROM producao.atividade
                WHERE unidade_trabalho_id IN ($<todas:csv>)
                  AND tipo_situacao_atividade_id <> $<naoFinalizada>
                GROUP BY etapa_id
               HAVING MIN(tipo_situacao_atividade_id) = $<naoIniciada>
             ) AS sub
            WHERE a.unidade_trabalho_id = $<primeiraId>
              AND a.etapa_id = sub.etapa_id
              AND a.tipo_situacao_atividade_id = $<finalizada>
           RETURNING *`,
          {
            primeiraId,
            todas: unidadeTrabalhoIds,
            naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA,
            finalizada: SITUACAO_ATIVIDADE.FINALIZADA,
            naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA
          }
        )
        await auditarAtividades(rebaixadas, 'U')

        if (rebaixadas.length > 0) {
          const recriadas = await t.any(
            `INSERT INTO producao.atividade
               (etapa_id, unidade_trabalho_id, tipo_situacao_atividade_id,
                observacao)
             SELECT a.etapa_id, $<primeiraId>, $<naoIniciada>, a.observacao
               FROM producao.atividade AS a
              WHERE a.id IN ($<ids:csv>)
             RETURNING *`,
            {
              primeiraId,
              ids: rebaixadas.map(a => a.id),
              naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA
            }
          )
          await auditarAtividades(recriadas, 'I')
        }

        if (absorvidasIds.length > 0) {
          // 2) A observacao das nao iniciadas nao se perde.
          const observadas = await t.any(
            `UPDATE producao.atividade AS a
                SET observacao = concat_ws(' | ', a.observacao, sub.observacao_agg)
               FROM (
                 SELECT etapa_id, string_agg(observacao, ' | ') AS observacao_agg
                   FROM producao.atividade
                  WHERE unidade_trabalho_id IN ($<absorvidasIds:csv>)
                    AND tipo_situacao_atividade_id = $<naoIniciada>
                  GROUP BY etapa_id
               ) AS sub
              WHERE a.unidade_trabalho_id = $<primeiraId>
                AND a.etapa_id = sub.etapa_id
                AND a.tipo_situacao_atividade_id = $<naoIniciada>
             RETURNING *`,
            {
              primeiraId,
              absorvidasIds,
              naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA
            }
          )
          await auditarAtividades(observadas, 'U')

          // 3) O insumo das absorvidas passa para a sobrevivente, sem repetir.
          await t.none(
            `INSERT INTO producao.insumo_unidade_trabalho
               (unidade_trabalho_id, insumo_id, caminho_padrao)
             SELECT DISTINCT ON (iut.insumo_id) $<primeiraId>, iut.insumo_id,
                    iut.caminho_padrao
               FROM producao.insumo_unidade_trabalho AS iut
              WHERE iut.unidade_trabalho_id IN ($<absorvidasIds:csv>)
              -- O ORDER BY NAO E ENFEITE: sem ele o DISTINCT ON escolhe uma
              -- linha ARBITRARIA entre as repetidas, e o caminho_padrao que
              -- sobrevive passa a depender do plano de execucao.
              ORDER BY iut.insumo_id, iut.id
             ON CONFLICT (unidade_trabalho_id, insumo_id) DO NOTHING`,
            { primeiraId, absorvidasIds }
          )

          await t.none(
            `DELETE FROM producao.insumo_unidade_trabalho
              WHERE unidade_trabalho_id IN ($<absorvidasIds:csv>)`,
            { absorvidasIds }
          )

          // 4) O que ja aconteceu nas absorvidas muda de dono como 'Nao
          //    finalizada'; o que nunca comecou some.
          const mudadas = await t.any(
            `UPDATE producao.atividade
                SET tipo_situacao_atividade_id = $<naoFinalizada>,
                    unidade_trabalho_id = $<primeiraId>
              WHERE unidade_trabalho_id IN ($<absorvidasIds:csv>)
                AND tipo_situacao_atividade_id IN ($<finalizada>, $<naoFinalizada>)
             RETURNING *`,
            {
              primeiraId,
              absorvidasIds,
              finalizada: SITUACAO_ATIVIDADE.FINALIZADA,
              naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA
            }
          )
          await auditarAtividades(mudadas, 'U')

          const apagadas = await t.any(
            `DELETE FROM producao.atividade
              WHERE unidade_trabalho_id IN ($<absorvidasIds:csv>)
                AND tipo_situacao_atividade_id = $<naoIniciada>
             RETURNING *`,
            { absorvidasIds, naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA }
          )
          await auditarAtividades(apagadas, 'D')

          for (const id of absorvidasIds) {
            const utAntes = await auditoriaCtrl.lerAntes(
              t,
              TABELA_UT,
              id,
              'Unidade de trabalho'
            )

            await t.none(
              'DELETE FROM producao.unidade_trabalho WHERE id = $<id>',
              { id }
            )

            await auditoriaCtrl.registrar(t, {
              tabela: TABELA_UT,
              registroId: id,
              operacao: 'D',
              antes: utAntes,
              usuarioUuid,
              contexto
            })
          }
        }

        return { unidade_trabalho_id: primeiraId }
      }),
    ERROS_UT
  )
}

// --- Atividade ---------------------------------------------------------------

const ERROS_ATIVIDADE = {
  // `atividade_unique_index`: uma atividade VIVA (situacao 1 a 4) por par
  // (etapa, unidade de trabalho). Sem esta traducao o erro chega como 500
  // citando o nome do indice.
  [UNIQUE_VIOLATION]:
    'Já existe uma atividade em aberto para esta etapa nesta unidade de trabalho',
  [FK_VIOLATION]: 'A etapa ou a unidade de trabalho informada não existe',
  // `chk_subfase_lote_consistency`, de `producao.atividade_verifica_subfase`.
  [RAISE_EXCEPTION]:
    'A etapa e a unidade de trabalho não são da mesma subfase e do mesmo lote'
}

/**
 * Cria atividades para os pares (unidade de trabalho, etapa) informados.
 *
 * A UNIDADE PRECISA DE VERSAO ASSOCIADA, e a checagem le
 * `producao.relacionamento_versao` -- o cache que o gatilho mantem, e que aqui e
 * so LIDO. No SAP a tabela se chamava `relacionamento_produto` e a coluna
 * `p_id`, e apontava um produto POR LOTE; aqui ela aponta `acervo.versao`,
 * porque o produto do acervo e a folha ETERNA e o que uma corrida de producao
 * entrega e uma VERSAO.
 *
 * A ETAPA DE CORRECAO ENTRA DE CARONA: quando uma etapa de revisao (2) ou de
 * revisao final (5) e pedida e a proxima da ordem e uma correcao (3), a correcao
 * entra junto. Revisao sem correcao e revisao que nao pode apontar nada.
 */
controller.criarAtividades = async (
  unidadeTrabalhoIds,
  etapaIds,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const semVersao = await t.any(
          `SELECT ut.id
             FROM producao.unidade_trabalho AS ut
             LEFT JOIN producao.relacionamento_versao AS rv ON rv.ut_id = ut.id
            WHERE ut.id IN ($<unidadeTrabalhoIds:csv>)
            GROUP BY ut.id
           HAVING COUNT(rv.versao_id) = 0`,
          { unidadeTrabalhoIds }
        )
        if (semVersao.length > 0) {
          throw new AppError(
            `Uma ou mais unidades de trabalho não têm versão do acervo associada: ${semVersao
              .map(u => u.id)
              .join(', ')}`,
            httpCode.BadRequest
          )
        }

        const correcoes = await t.any(
          `WITH prox AS (
             SELECT e.id,
                    lead(e.id, 1) OVER (PARTITION BY e.subfase_id, e.lote_id ORDER BY e.ordem) AS prox_id
               FROM producao.etapa AS e
           )
           SELECT p.prox_id
             FROM producao.etapa AS e
            INNER JOIN prox AS p ON p.id = e.id
            INNER JOIN producao.etapa AS prox_e ON prox_e.id = p.prox_id
            WHERE e.tipo_etapa_id IN ($<revisao>, $<revisaoFinal>)
              AND e.id IN ($<etapaIds:csv>)
              AND prox_e.tipo_etapa_id = $<correcao>`,
          {
            etapaIds,
            revisao: TIPO_ETAPA.REVISAO,
            revisaoFinal: TIPO_ETAPA.REVISAO_FINAL,
            correcao: TIPO_ETAPA.CORRECAO
          }
        )

        const etapas = [
          ...new Set([
            ...etapaIds,
            ...correcoes.map(c => c.prox_id).filter(id => id !== null)
          ])
        ]

        const criadas = await t.any(
          `INSERT INTO producao.atividade
             (etapa_id, unidade_trabalho_id, tipo_situacao_atividade_id)
           SELECT DISTINCT e.id, ut.id, $<naoIniciada>
             FROM producao.unidade_trabalho AS ut
            INNER JOIN producao.etapa AS e
               ON e.subfase_id = ut.subfase_id AND e.lote_id = ut.lote_id
             LEFT JOIN producao.atividade AS a
               ON a.unidade_trabalho_id = ut.id AND a.etapa_id = e.id
            WHERE ut.id IN ($<unidadeTrabalhoIds:csv>)
              AND e.id IN ($<etapas:csv>)
              AND a.id IS NULL
           RETURNING *`,
          {
            unidadeTrabalhoIds,
            etapas,
            naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA
          }
        )

        if (criadas.length === 0) {
          throw new AppError(
            'As atividades não podem ser criadas pois já existem',
            httpCode.BadRequest
          )
        }

        for (const atividade of criadas) {
          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_ATIVIDADE,
            registroId: atividade.id,
            operacao: 'I',
            depois: atividade,
            usuarioUuid,
            contexto
          })
        }

        return { criadas: criadas.length }
      }),
    ERROS_ATIVIDADE
  )
}

/**
 * Cria as atividades de um lote inteiro, por tipo de etapa.
 *
 * DESEMPENHO: e a rota mais pesada da fatia, e a que mais paga a ausencia do
 * `disableTriggers` -- nao pelos gatilhos de geometria, que nao rodam sobre
 * `atividade`, mas pelo volume. UM EVENTO DE AUDITORIA POR ATIVIDADE e o preco
 * combinado, e `contexto.loteId` (um por REQUISICAO) e o que reagrupa os
 * milhares de eventos numa tela so.
 *
 * A EXECUCAO (1) ENTRA SEMPRE; as demais dependem das tres bandeiras.
 */
controller.criarTodasAtividades = async (
  loteId,
  bandeiras,
  usuarioUuid,
  contexto
) => {
  const grupos = [
    { tipos: [TIPO_ETAPA.EXECUCAO], quando: true },
    {
      tipos: [TIPO_ETAPA.REVISAO, TIPO_ETAPA.CORRECAO],
      quando: bandeiras.atividades_revisao
    },
    {
      tipos: [TIPO_ETAPA.REVISAO_CORRECAO],
      quando: bandeiras.atividades_revisao_correcao
    },
    {
      tipos: [TIPO_ETAPA.REVISAO_FINAL],
      quando: bandeiras.atividades_revisao_final
    }
  ]

  return comTraducao(
    () =>
      db.conn.tx(async t => {
        let total = 0

        for (const grupo of grupos) {
          if (!grupo.quando) continue

          const criadas = await t.any(
            `INSERT INTO producao.atividade
               (etapa_id, unidade_trabalho_id, tipo_situacao_atividade_id)
             SELECT e.id, ut.id, $<naoIniciada>
               FROM producao.unidade_trabalho AS ut
              INNER JOIN producao.etapa AS e
                 ON e.subfase_id = ut.subfase_id AND e.lote_id = ut.lote_id
               LEFT JOIN (
                 SELECT id, etapa_id, unidade_trabalho_id
                   FROM producao.atividade
                  WHERE tipo_situacao_atividade_id <> $<naoFinalizada>
               ) AS a ON a.unidade_trabalho_id = ut.id AND a.etapa_id = e.id
              WHERE e.tipo_etapa_id IN ($<tipos:csv>)
                AND ut.lote_id = $<loteId>
                AND a.id IS NULL
             RETURNING *`,
            {
              loteId,
              tipos: grupo.tipos,
              naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA,
              naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA
            }
          )

          for (const atividade of criadas) {
            await auditoriaCtrl.registrar(t, {
              tabela: TABELA_ATIVIDADE,
              registroId: atividade.id,
              operacao: 'I',
              depois: atividade,
              usuarioUuid,
              contexto
            })
          }

          total += criadas.length
        }

        return { criadas: total }
      }),
    ERROS_ATIVIDADE
  )
}

/**
 * Apaga atividades NAO INICIADAS.
 *
 * A ATIVIDADE DE CORRECAO NAO SE APAGA SOZINHA: se a lista quebrar o par
 * revisao (2) -> correcao (3), a operacao e recusada inteira. Uma revisao sem a
 * correcao seguinte nao tem onde apontar o que achou.
 */
controller.deletarAtividades = async (atividadeIds, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        // DUAS DIVERGENCIAS DELIBERADAS EM RELACAO AO SAP, e as duas sao
        // conserto e nao gosto:
        //
        //   1) La a consulta compara `e.etapa_anterior IN (atividadeIds)`, ou
        //      seja, ID DE ETAPA contra ID DE ATIVIDADE. Sao dois espacos de
        //      identificador diferentes, e o encontro so acontece por acaso
        //      numerico: a guarda passa a proteger um par que ninguem pediu e a
        //      deixar passar o par que se quebrou. Aqui a comparacao e entre
        //      ATIVIDADES, que e o que a rota recebe.
        //   2) La a janela usa `lead(e.id, 2)`, e a irma `criaAtividades` usa
        //      `lead(e.id, 1)` para a MESMA relacao revisao -> correcao. Uma das
        //      duas esta errada, e a que faz sentido com a ordem das etapas
        //      (revisao vem imediatamente antes da correcao dela) e a de passo
        //      1. Fica o 1.
        //
        // O PAR SE MEDE POR UNIDADE DE TRABALHO, e nao por etapa solta: e a
        // atividade de revisao daquele recorte que aponta o que a correcao
        // daquele mesmo recorte vai consertar.
        const quebraPar = await t.any(
          `WITH par AS (
             SELECT e.id AS etapa_revisao,
                    lead(e.id, 1) OVER (PARTITION BY e.lote_id, e.subfase_id ORDER BY e.ordem) AS etapa_correcao
               FROM producao.etapa AS e
           )
           SELECT a_rev.id AS atividade_revisao, a_cor.id AS atividade_correcao
             FROM par
            INNER JOIN producao.etapa AS e_rev ON e_rev.id = par.etapa_revisao
            INNER JOIN producao.etapa AS e_cor ON e_cor.id = par.etapa_correcao
            INNER JOIN producao.atividade AS a_rev ON a_rev.etapa_id = e_rev.id
            INNER JOIN producao.atividade AS a_cor
               ON a_cor.etapa_id = e_cor.id
              AND a_cor.unidade_trabalho_id = a_rev.unidade_trabalho_id
            WHERE e_rev.tipo_etapa_id = $<revisao>
              AND e_cor.tipo_etapa_id = $<correcao>
              AND (
                (a_rev.id IN ($<atividadeIds:csv>) AND a_cor.id NOT IN ($<atividadeIds:csv>))
                OR
                (a_rev.id NOT IN ($<atividadeIds:csv>) AND a_cor.id IN ($<atividadeIds:csv>))
              )
            LIMIT 1`,
          {
            atividadeIds,
            revisao: TIPO_ETAPA.REVISAO,
            correcao: TIPO_ETAPA.CORRECAO
          }
        )
        if (quebraPar.length > 0) {
          throw new AppError(
            'Atividade de correção não deve ser deletada separadamente da revisão',
            httpCode.BadRequest
          )
        }

        const loteDistinto = await t.any(
          `SELECT DISTINCT ut.lote_id
             FROM producao.atividade AS a
            INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
            WHERE a.id IN ($<atividadeIds:csv>)`,
          { atividadeIds }
        )
        if (loteDistinto.length > 1) {
          throw new AppError(
            'As atividades informadas são de lotes distintos',
            httpCode.BadRequest
          )
        }

        const apagadas = await t.any(
          `DELETE FROM producao.atividade
            WHERE id IN ($<atividadeIds:csv>)
              AND tipo_situacao_atividade_id = $<naoIniciada>
           RETURNING *`,
          { atividadeIds, naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA }
        )

        for (const atividade of apagadas) {
          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_ATIVIDADE,
            registroId: atividade.id,
            operacao: 'D',
            antes: atividade,
            usuarioUuid,
            contexto
          })
        }

        return { apagadas: apagadas.length }
      }),
    ERROS_ATIVIDADE
  )
}

/**
 * Apaga as atividades nao iniciadas (1) e nao finalizadas (5) de unidades de
 * trabalho.
 *
 * OS DOIS CODES JUNTOS, e nao so o 1: e a limpeza de uma unidade de trabalho que
 * vai ser reconfigurada, e a 'Nao finalizada' e o registro de tentativa que nao
 * vingou. O que estiver em execucao, pausado ou finalizado fica.
 */
controller.deletarAtividadesUnidadeTrabalho = async (
  unidadeTrabalhoIds,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const apagadas = await t.any(
          `DELETE FROM producao.atividade
            WHERE unidade_trabalho_id IN ($<unidadeTrabalhoIds:csv>)
              AND tipo_situacao_atividade_id IN ($<naoIniciada>, $<naoFinalizada>)
           RETURNING *`,
          {
            unidadeTrabalhoIds,
            naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA,
            naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA
          }
        )

        for (const atividade of apagadas) {
          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_ATIVIDADE,
            registroId: atividade.id,
            operacao: 'D',
            antes: atividade,
            usuarioUuid,
            contexto
          })
        }

        return { apagadas: apagadas.length }
      }),
    ERROS_ATIVIDADE
  )
}

// --- Dado de producao --------------------------------------------------------

const ERROS_DADO_PRODUCAO = {
  [FK_VIOLATION]: 'O tipo de dado de produção informado não existe'
}

const ERROS_DADO_PRODUCAO_DELETE = {
  [FK_VIOLATION]:
    'Não é possível remover o dado de produção: existe unidade de trabalho associada a ele'
}

/**
 * A lista de dados de producao, com a situacao derivada dos lotes que os usam.
 *
 * O `lote_status_execucao_id` E DERIVADO, e nao coluna: ele responde "este dado
 * ainda esta em uso?". No SAP ele saia de `lote.status_id`; aqui o lote e o do
 * ACERVO, e o status e `acervo.lote.status_execucao_id`. Sem unidade de trabalho
 * nenhuma, o dado conta como Nao iniciado.
 */
controller.getDadoProducao = async () => {
  return db.conn.any(
    `SELECT dp.id, dp.tipo_dado_producao_id, tdp.nome AS tipo_dado_producao,
            dp.configuracao_producao,
            CASE
              WHEN COUNT(ut.id) = 0 THEN $<naoIniciado>
              WHEN bool_or(l.status_execucao_id = $<naoIniciado>) THEN $<naoIniciado>
              WHEN bool_or(l.status_execucao_id = $<emExecucao>) THEN $<emExecucao>
              ELSE $<concluido>
            END AS lote_status_execucao_id
       FROM producao.dado_producao AS dp
      INNER JOIN dominio.tipo_dado_producao AS tdp ON tdp.code = dp.tipo_dado_producao_id
       LEFT JOIN producao.unidade_trabalho AS ut ON ut.dado_producao_id = dp.id
       LEFT JOIN acervo.lote AS l ON l.id = ut.lote_id
      GROUP BY dp.id, dp.tipo_dado_producao_id, tdp.nome, dp.configuracao_producao
      ORDER BY dp.id`,
    {
      naoIniciado: STATUS_EXECUCAO.NAO_INICIADO,
      emExecucao: STATUS_EXECUCAO.EM_EXECUCAO,
      concluido: STATUS_EXECUCAO.CONCLUIDO
    }
  )
}

const COLUNAS_DADO_PRODUCAO = ['tipo_dado_producao_id', 'configuracao_producao']

controller.criarDadoProducao = async (dados, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const criados = []

        for (const dado of dados) {
          const criado = await t.one(
            `INSERT INTO producao.dado_producao
               (tipo_dado_producao_id, configuracao_producao,
                usuario_cadastramento_uuid)
             VALUES
               ($<tipo_dado_producao_id>, $<configuracao_producao>, $<usuarioUuid>)
             RETURNING *`,
            { ...normaliza(COLUNAS_DADO_PRODUCAO, dado), usuarioUuid }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_DADO_PRODUCAO,
            registroId: criado.id,
            operacao: 'I',
            depois: criado,
            usuarioUuid,
            contexto
          })

          criados.push({ id: criado.id })
        }

        return criados
      }),
    ERROS_DADO_PRODUCAO
  )
}

controller.atualizarDadoProducao = async (dados, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        for (const dado of dados) {
          const antes = await auditoriaCtrl.lerAntes(
            t,
            TABELA_DADO_PRODUCAO,
            dado.id,
            'Dado de produção'
          )

          const depois = await t.one(
            `UPDATE producao.dado_producao SET
               tipo_dado_producao_id = $<tipo_dado_producao_id>,
               configuracao_producao = $<configuracao_producao>,
               data_modificacao = CURRENT_TIMESTAMP,
               usuario_modificacao_uuid = $<usuarioUuid>
             WHERE id = $<id>
             RETURNING *`,
            {
              ...normaliza(COLUNAS_DADO_PRODUCAO, dado),
              id: dado.id,
              usuarioUuid
            }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_DADO_PRODUCAO,
            registroId: dado.id,
            operacao: 'U',
            antes,
            depois,
            usuarioUuid,
            contexto
          })
        }
      }),
    ERROS_DADO_PRODUCAO
  )
}

controller.deletarDadoProducao = async (
  dadoProducaoIds,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const emUso = await t.oneOrNone(
          `SELECT ut.dado_producao_id
             FROM producao.unidade_trabalho AS ut
            WHERE ut.dado_producao_id IN ($<dadoProducaoIds:csv>)
            LIMIT 1`,
          { dadoProducaoIds }
        )
        if (emUso) {
          throw new AppError(
            `O dado de produção ${emUso.dado_producao_id} possui unidades de trabalho associadas`,
            httpCode.BadRequest
          )
        }

        for (const id of dadoProducaoIds) {
          const antes = await auditoriaCtrl.lerAntes(
            t,
            TABELA_DADO_PRODUCAO,
            id,
            'Dado de produção'
          )

          await t.none('DELETE FROM producao.dado_producao WHERE id = $<id>', {
            id
          })

          await auditoriaCtrl.registrar(t, {
            tabela: TABELA_DADO_PRODUCAO,
            registroId: id,
            operacao: 'D',
            antes,
            usuarioUuid,
            contexto
          })
        }
      }),
    ERROS_DADO_PRODUCAO_DELETE
  )
}

// --- As duas leituras de conexao ---------------------------------------------

/**
 * Os bancos de producao cadastrados, SEM O ENDERECO DELES.
 *
 * `configuracao_producao` GUARDA `servidor:porta/banco`, e nao o nome do banco.
 * Foi MEDIDO no dump de producao do SAP 2.3.5 em 2026-08-09, e o repositorio
 * inteiro le a coluna assim: `er/producao.sql` diz o formato com todas as letras,
 * `database/conexao_admin.js` a analisa por expressao regular e
 * `producao/trabalho_schema.js` a documenta. Este comentario afirmava o CONTRARIO
 * ate 2026-08-09 ("aqui ela guarda so o nome do banco"), e a rota devolvia a
 * coluna crua como `nome` -- o que fazia sair na resposta, e no log de
 * `sendJsonAndLog`, o endereco de cada banco de edicao da instalacao.
 *
 * ENTAO O ENDERECO E FATIADO AQUI, e so o NOME atravessa. Quem fatia e o
 * `conexaoAdmin.separar`, que e o mesmo que o subsistema de permissao usa: duas
 * analises do mesmo formato divergiriam, e a divergencia so apareceria como
 * endereco vazado ou como banco que ninguem acha.
 *
 * E `servidor` E `porta` NAO VOLTAM COMO COLUNAS, ao contrario do `split_part` em
 * tres do SAP. Nao e economia de campo: `er/producao.sql` proibe o endereco de
 * sair em resposta de API e em log, e este repositorio e publico. Quem precisa do
 * endereco e o servidor, que o le do proprio dado; quem consome esta rota escolhe
 * um `id` de dado de producao, e as rotas de permissao recebem esse `id`.
 *
 * `nome` VEM NULO QUANDO A COLUNA ESTA MALFORMADA, e o nulo e a leitura certa de
 * "o cadastro deste dado de producao esta incompleto". Devolver o texto cru nesse
 * caso seria justamente vazar o que nao se sabe ler.
 *
 * O FILTRO POR TIPO CONTINUA: so os dois tipos PostGIS sao banco de dados; o
 * tipo 1 ('Nao controlado') e dado que o sistema apenas aponta.
 */
controller.getBancoDados = async () => {
  const linhas = await db.conn.any(
    `SELECT dp.id, dp.tipo_dado_producao_id, tdp.nome AS tipo_dado_producao,
            dp.configuracao_producao,
            CASE
              WHEN COUNT(ut.id) = 0 THEN $<naoIniciado>
              WHEN bool_or(l.status_execucao_id = $<naoIniciado>) THEN $<naoIniciado>
              WHEN bool_or(l.status_execucao_id = $<emExecucao>) THEN $<emExecucao>
              ELSE $<concluido>
            END AS lote_status_execucao_id
       FROM producao.dado_producao AS dp
      INNER JOIN dominio.tipo_dado_producao AS tdp ON tdp.code = dp.tipo_dado_producao_id
       LEFT JOIN producao.unidade_trabalho AS ut ON ut.dado_producao_id = dp.id
       LEFT JOIN acervo.lote AS l ON l.id = ut.lote_id
      WHERE dp.tipo_dado_producao_id IN ($<tiposBanco:csv>)
      GROUP BY dp.id, dp.tipo_dado_producao_id, tdp.nome, dp.configuracao_producao
      ORDER BY dp.id`,
    {
      tiposBanco: TIPOS_COM_BANCO,
      naoIniciado: STATUS_EXECUCAO.NAO_INICIADO,
      emExecucao: STATUS_EXECUCAO.EM_EXECUCAO,
      concluido: STATUS_EXECUCAO.CONCLUIDO
    }
  )

  // A COLUNA CRUA E DESCARTADA AQUI, e nao renomeada: `configuracao_producao`
  // sai do objeto pela desestruturacao, e o que sobra nao tem como levar o
  // endereco junto por descuido.
  return linhas.map(({ configuracao_producao: configuracao, ...resto }) => {
    const alvo = conexaoAdmin.separar(configuracao)
    return { ...resto, nome: alvo ? alvo.banco : null }
  })
}

/**
 * O LOGIN da conexao de edicao, e SO o login.
 *
 * O QUE O SAP FAZ, E O QUE ESTA ROTA NAO FAZ. La `getLogin` devolve DUAS chaves
 * do `config`, o login e o segredo dele, que juntos sao a credencial com que o
 * cliente manda o QGIS abrir a conexao do banco de producao. Aqui SO O LOGIN
 * sai. Nada do `config` alem de `DB_USER` e lido por esta funcao, e o teste de
 * `__tests__/routes/producao/trabalho.test.js` prende isso lendo o fonte -- ele
 * exige que a chave do segredo nao apareca NEM EM COMENTARIO neste arquivo,
 * porque o proximo a ler copiaria dali.
 *
 * POR QUE O CORTE, e por que ele nao e meu para desfazer. O `CLAUDE.md` deste
 * repositorio diz "Senha nunca em claro, e nunca de volta por rota", e a frase
 * foi escrita sobre `dgeo.usuario.senha`, que e hash bcrypt e nao e esta
 * credencial. As duas coisas sao diferentes, e por isso a regra NAO decide
 * sozinha o caso. Mas devolver por rota o segredo de uma conta de banco, num
 * sistema onde a frase acima existe, e mudanca de postura e nao detalhe de
 * implementacao.
 *
 * ENTAO A DECISAO FICA COM O CHEFE, e ela se registra em `docs/decisoes.md`. Se
 * ele decidir que o par inteiro sai por aqui, o que muda e esta funcao e o
 * `sendJsonAndLog` da rota; ate la o cliente do QGIS recebe o login e pede o
 * resto por onde ja pedia.
 *
 * E O VALOR NUNCA ENTRA EM ARQUIVO VERSIONADO: o que este arquivo cita e a
 * CHAVE `DB_USER` do `server/config.env`, que e gitignored. O catalogo sem valor
 * nenhum esta em `.env.example`.
 */
controller.getLogin = async () => {
  return { login: config.DB_USER }
}

module.exports = controller
