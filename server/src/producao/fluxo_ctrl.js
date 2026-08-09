'use strict'

// O FLUXO da produção: linha de produção, fase, subfase, etapa e camadas.
// Atravessou do `projeto_ctrl.js` do SAP 2.3.5 em 2026-08-09.
//
// AS QUATRO CONVERSÕES QUE VALEM PARA O ARQUIVO INTEIRO:
//
//   `db.sapConn` -> `db.conn`, e o schema `macrocontrole` -> `producao`.
//
//   `lote_id` aponta `acervo.lote (id)`, BIGINT. NÃO existe `producao.lote` nem
//   `producao.lote_linha`, e a ausência é decisão do chefe de 2026-08-09.
//
//   Toda coluna de pessoa é `usuario_uuid`, e as quatro colunas de auditoria
//   (`data_cadastramento`, `usuario_cadastramento_uuid`, `data_modificacao`,
//   `usuario_modificacao_uuid`) são PREENCHIDAS em toda escrita.
//
//   `disableTriggers` não existe aqui: o SQL é direto, e os gatilhos de
//   `er/producao.sql` e `er/acompanhamento_producao.sql` mantêm os caches
//   sozinhos. O custo disso está medido no comentário de `criarEtapasPadrao`.
//
// A LINHA DE PRODUÇÃO NÃO ESTÁ NO LOTE, e é a mudança que mais mexeu aqui. No
// SAP, `macrocontrole.lote.linha_producao_id` respondia "que linha este lote
// executa" com um JOIN. Aqui o lote é o do acervo e ATRAVESSA linhas de
// produção (61 dos 102 lotes com versão carregam mais de um subtipo de produto,
// medido em 2026-08-09), então o par (lote, linha) é DERIVADO da ETAPA: um lote
// executa uma linha quando tem etapa numa subfase dela. É a mesma leitura que
// `acompanhamento.linhas_producao_do_lote` faz, e é a ETAPA e não a unidade de
// trabalho porque a etapa é configuração e existe antes de haver geometria.

const { db } = require('../database')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const { SITUACAO_ATIVIDADE } = require('../utils/domain_constants')

const { PADRAO_CONTROLE_QUALIDADE } = require('./fluxo_schema')

const controller = {}

// --- Erros do banco que viram resposta amigável ------------------------------

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'
const CHECK_VIOLATION = '23514'

/**
 * Traduz o erro do PostgreSQL para o 4xx que diz o que fazer.
 *
 * Mesmo desenho de `equipamento_ctrl.js`: o 500 cru cita o nome da restrição
 * ('etapa_execucao_e_primeira'), que não ajuda quem acabou de digitar.
 */
const traduzirErro = (err, mensagens) => {
  if (!err || !err.code) return err
  const frase = mensagens[err.code]
  if (!frase) return err
  return new AppError(frase, mensagens.status || httpCode.Conflict, err)
}

const comTraducao = async (promessa, mensagens) => {
  try {
    return await promessa()
  } catch (err) {
    throw traduzirErro(err, mensagens)
  }
}

// --- Normalização do corpo ---------------------------------------------------

/**
 * O opcional AUSENTE vira null antes da consulta.
 *
 * Sem isto, um corpo válido que omite um campo opcional derruba o pg-promise com
 * "Property doesn't exist", que chega como 500 onde não houve erro nenhum.
 *
 * @param {string[]} colunas
 * @param {object} dados
 * @returns {object}
 */
const normaliza = (colunas, dados) => {
  const saida = {}
  for (const coluna of colunas) {
    saida[coluna] = dados[coluna] !== undefined ? dados[coluna] : null
  }
  return saida
}

// --- O par (lote, linha de produção), derivado da etapa ----------------------

// O SUBSTITUTO DE `lote.linha_producao_id`. Sai como subconsulta porque duas
// leituras precisam dele (a subfase por linha ativa e o estado das subfases de
// um lote) e uma cópia divergiria da outra no primeiro ajuste.
const LOTE_EXECUTA_LINHA = `
  SELECT DISTINCT e.lote_id, f.linha_producao_id
    FROM producao.etapa AS e
    INNER JOIN producao.subfase AS sf ON sf.id = e.subfase_id
    INNER JOIN producao.fase AS f ON f.id = sf.fase_id`

// --- Linha de produção -------------------------------------------------------

const ERROS_LINHA_PRODUCAO = {
  [UNIQUE_VIOLATION]:
    'Já existe uma linha de produção com este nome ou com este nome abreviado',
  [FK_VIOLATION]:
    'Subtipo de produto, tipo de fase ou tipo de pré-requisito inexistente'
}

/**
 * As linhas de produção, com o subtipo de produto que cada uma executa.
 *
 * @param {boolean} somenteAtivas - `?status=ativo`
 */
controller.getLinhasProducao = async (somenteAtivas = false) => {
  return db.conn.any(
    `SELECT lp.id AS linha_producao_id,
            lp.nome AS linha_producao,
            lp.nome_abrev AS linha_producao_abrev,
            lp.descricao,
            lp.disponivel,
            lp.subtipo_produto_id,
            sp.nome AS subtipo_produto
       FROM producao.linha_producao AS lp
       INNER JOIN dominio.subtipo_produto AS sp ON sp.code = lp.subtipo_produto_id
      WHERE ($<somenteAtivas> IS NOT TRUE OR lp.disponivel IS TRUE)
      ORDER BY lp.nome_abrev`,
    { somenteAtivas }
  )
}

/**
 * Cria a linha de produção COM as fases, as subfases, os pré-requisitos entre
 * subfases e as propriedades de camada, tudo numa transação.
 *
 * O MAPA `nome -> id` É POR NOME, e é assim porque o corpo referencia as
 * subfases pelo nome: elas ainda não têm id quando quem escreve o JSON as cita.
 * Os dois buracos que isso tinha no SAP (nome repetido e nome inexistente) já
 * foram fechados pelo Joi, em `fluxo_schema.js`, antes desta transação abrir.
 *
 * A CAMADA É REAPROVEITADA quando já existe: `producao.camada` é o par (schema,
 * nome) e é global, e `producao.propriedades_camada` é que diz como ela se
 * comporta NAQUELA subfase. Criar uma camada nova a cada linha de produção
 * morreria na UNIQUE (schema, nome) na segunda linha que citasse a mesma tabela.
 *
 * UM EVENTO DE AUDITORIA POR LINHA GRAVADA, e não um por requisição: o
 * `contexto.loteId` já agrupa a operação inteira numa tela só, e sem o evento
 * por linha o histórico de uma subfase específica não teria como existir.
 */
controller.insereLinhaProducao = async (linhaProducao, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const linha = await t.one(
          `INSERT INTO producao.linha_producao
             (nome, nome_abrev, descricao, subtipo_produto_id, disponivel,
              usuario_cadastramento_uuid)
           VALUES
             ($<nome>, $<nome_abrev>, $<descricao>, $<subtipo_produto_id>, TRUE,
              $<usuarioUuid>)
           RETURNING *`,
          {
            ...normaliza(
              ['nome', 'nome_abrev', 'descricao', 'subtipo_produto_id'],
              linhaProducao
            ),
            usuarioUuid
          }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: 'producao.linha_producao',
          registroId: linha.id,
          operacao: 'I',
          depois: linha,
          usuarioUuid,
          contexto
        })

        const subfasePorNome = new Map()
        const fasesCriadas = []

        for (const fase of linhaProducao.fases) {
          const faseCriada = await t.one(
            `INSERT INTO producao.fase
               (tipo_fase_id, linha_producao_id, ordem, usuario_cadastramento_uuid)
             VALUES ($<tipo_fase_id>, $<linhaProducaoId>, $<ordem>, $<usuarioUuid>)
             RETURNING *`,
            {
              tipo_fase_id: fase.tipo_fase_id,
              linhaProducaoId: linha.id,
              ordem: fase.ordem,
              usuarioUuid
            }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: 'producao.fase',
            registroId: faseCriada.id,
            operacao: 'I',
            depois: faseCriada,
            usuarioUuid,
            contexto
          })

          fasesCriadas.push(faseCriada)

          for (const subfase of fase.subfases) {
            const subfaseCriada = await t.one(
              `INSERT INTO producao.subfase
                 (nome, fase_id, ordem, usuario_cadastramento_uuid)
               VALUES ($<nome>, $<faseId>, $<ordem>, $<usuarioUuid>)
               RETURNING *`,
              {
                nome: subfase.nome,
                faseId: faseCriada.id,
                ordem: subfase.ordem,
                usuarioUuid
              }
            )

            await auditoriaCtrl.registrar(t, {
              tabela: 'producao.subfase',
              registroId: subfaseCriada.id,
              operacao: 'I',
              depois: subfaseCriada,
              usuarioUuid,
              contexto
            })

            subfasePorNome.set(subfase.nome, subfaseCriada.id)
          }
        }

        // OS PRÉ-REQUISITOS SÓ DEPOIS DE TODAS AS SUBFASES, e não dentro do laço
        // da fase como no SAP: um pré-requisito pode ligar uma subfase da fase 1
        // a uma da fase 3, e lá dentro do laço a segunda ainda não existiria no
        // mapa. Era o mesmo bug do nome repetido, com outra causa.
        for (const fase of linhaProducao.fases) {
          for (const pre of fase.pre_requisito_subfase || []) {
            const preCriado = await t.one(
              `INSERT INTO producao.pre_requisito_subfase
                 (tipo_pre_requisito_id, subfase_anterior_id, subfase_posterior_id,
                  usuario_cadastramento_uuid)
               VALUES ($<tipoPreRequisitoId>, $<anteriorId>, $<posteriorId>,
                       $<usuarioUuid>)
               RETURNING *`,
              {
                tipoPreRequisitoId: pre.tipo_pre_requisito_id,
                anteriorId: subfasePorNome.get(pre.subfase_anterior),
                posteriorId: subfasePorNome.get(pre.subfase_posterior),
                usuarioUuid
              }
            )

            await auditoriaCtrl.registrar(t, {
              tabela: 'producao.pre_requisito_subfase',
              registroId: preCriado.id,
              operacao: 'I',
              depois: preCriado,
              usuarioUuid,
              contexto
            })
          }
        }

        for (const prop of linhaProducao.propriedades_camadas || []) {
          let camada = await t.oneOrNone(
            `SELECT * FROM producao.camada
              WHERE schema = $<schema> AND nome = $<nome>`,
            { schema: prop.schema, nome: prop.camada }
          )

          if (!camada) {
            camada = await t.one(
              `INSERT INTO producao.camada (schema, nome, usuario_cadastramento_uuid)
               VALUES ($<schema>, $<nome>, $<usuarioUuid>)
               RETURNING *`,
              { schema: prop.schema, nome: prop.camada, usuarioUuid }
            )

            await auditoriaCtrl.registrar(t, {
              tabela: 'producao.camada',
              registroId: camada.id,
              operacao: 'I',
              depois: camada,
              usuarioUuid,
              contexto
            })
          }

          const propriedades = await t.one(
            `INSERT INTO producao.propriedades_camada
               (camada_id, camada_incomum, atributo_filtro_subfase,
                camada_apontamento, atributo_situacao_correcao,
                atributo_justificativa_apontamento, subfase_id,
                usuario_cadastramento_uuid)
             VALUES
               ($<camadaId>, $<camada_incomum>, $<atributo_filtro_subfase>,
                $<camada_apontamento>, $<atributo_situacao_correcao>,
                $<atributo_justificativa_apontamento>, $<subfaseId>,
                $<usuarioUuid>)
             RETURNING *`,
            {
              ...normaliza(
                [
                  'camada_incomum',
                  'atributo_filtro_subfase',
                  'camada_apontamento',
                  'atributo_situacao_correcao',
                  'atributo_justificativa_apontamento'
                ],
                prop
              ),
              camadaId: camada.id,
              subfaseId: subfasePorNome.get(prop.subfase),
              usuarioUuid
            }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: 'producao.propriedades_camada',
            registroId: propriedades.id,
            operacao: 'I',
            depois: propriedades,
            usuarioUuid,
            contexto
          })
        }

        return {
          id: linha.id,
          fases: fasesCriadas.length,
          subfases: subfasePorNome.size
        }
      }),
    ERROS_LINHA_PRODUCAO
  )
}

/**
 * Aposenta (ou reabilita) linhas de produção, uma por linha do corpo.
 *
 * SÓ `disponivel` MUDA. O SAP fazia isto com um `db.pgp.helpers.update` de array
 * inteiro, numa consulta só; aqui é uma por linha, com `lerAntes` antes e
 * `registrar` depois. O custo é uma ida a mais ao banco por linha, e o que se
 * compra é o 404 que diz QUAL id não existe (o update em massa apenas não casava
 * nenhuma linha, em silêncio) e um evento de auditoria por linha alterada.
 */
controller.atualizaLinhaProducao = async (linhasProducao, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    for (const item of linhasProducao) {
      const antes = await auditoriaCtrl.lerAntes(
        t,
        'producao.linha_producao',
        item.id,
        'Linha de produção'
      )

      const depois = await t.one(
        `UPDATE producao.linha_producao SET
           disponivel = $<disponivel>,
           data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<id>
         RETURNING *`,
        { id: item.id, disponivel: item.disponivel, usuarioUuid }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.linha_producao',
        registroId: item.id,
        operacao: 'U',
        antes,
        depois,
        usuarioUuid,
        contexto
      })
    }
  })
}

// --- Fase, subfase e etapa ---------------------------------------------------

controller.getFases = async () => {
  return db.conn.any(
    `SELECT f.id AS fase_id,
            f.tipo_fase_id, tf.nome AS fase,
            f.linha_producao_id, lp.nome AS linha_producao,
            f.ordem,
            lp.subtipo_produto_id, sp.nome AS subtipo_produto
       FROM producao.fase AS f
       INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
       INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
       INNER JOIN dominio.subtipo_produto AS sp ON sp.code = lp.subtipo_produto_id
      ORDER BY lp.nome_abrev, f.ordem`
  )
}

/**
 * As subfases COM o lote que as executa, que é a lista que a tela de cadastro de
 * etapa abre.
 *
 * AQUI ESTÁ A DERIVAÇÃO. O SAP escrevia
 * `INNER JOIN macrocontrole.lote AS l ON l.linha_producao_id = lp.id`, lendo a
 * linha DO LOTE. Aqui o lote não tem linha: quem casa os dois é a subconsulta
 * `LOTE_EXECUTA_LINHA`, que sai da etapa.
 *
 * O RESULTADO É MAIS LARGO QUE A SUBCONSULTA, de propósito: o INNER JOIN casa o
 * LOTE com a LINHA, e as subfases vêm todas da linha, inclusive as que aquele
 * lote ainda não tem etapa nenhuma. É o que a tela precisa para mostrar o que
 * FALTA cadastrar; casar subfase a subfase esconderia exatamente isso.
 *
 * @param {boolean} somenteAtivas - `?status=ativo`
 */
controller.getSubfases = async (somenteAtivas = false) => {
  return db.conn.any(
    `SELECT lp.id AS linha_producao_id,
            lp.nome AS linha_producao,
            lp.disponivel AS linha_producao_ativa,
            lp.descricao,
            lp.subtipo_produto_id, sp.nome AS subtipo_produto,
            f.id AS fase_id, tf.nome AS fase, f.ordem AS ordem_fase,
            sf.id AS subfase_id, sf.nome AS subfase, sf.ordem AS ordem_subfase,
            l.id AS lote_id, l.nome AS lote,
            p.id AS projeto_id, p.nome AS projeto
       FROM producao.linha_producao AS lp
       INNER JOIN dominio.subtipo_produto AS sp ON sp.code = lp.subtipo_produto_id
       INNER JOIN producao.fase AS f ON f.linha_producao_id = lp.id
       INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
       INNER JOIN producao.subfase AS sf ON sf.fase_id = f.id
       INNER JOIN (${LOTE_EXECUTA_LINHA}) AS ll ON ll.linha_producao_id = lp.id
       INNER JOIN acervo.lote AS l ON l.id = ll.lote_id
       INNER JOIN acervo.projeto AS p ON p.id = l.projeto_id
      WHERE ($<somenteAtivas> IS NOT TRUE OR lp.disponivel IS TRUE)
      ORDER BY p.nome, l.nome, f.ordem, sf.ordem, sf.id`,
    { somenteAtivas }
  )
}

// TODAS as subfases, SEM lote. É a lista de cadastro da linha de produção, e ela
// existe separada da de cima justamente porque não depende de lote nenhum: uma
// subfase recém-criada, que ainda não tem etapa em lote algum, só aparece aqui.
controller.getAllSubfases = async () => {
  return db.conn.any(
    `SELECT lp.id AS linha_producao_id,
            lp.nome AS linha_producao,
            lp.nome_abrev AS linha_producao_nome_abrev,
            f.id AS fase_id, tf.nome AS fase, f.ordem AS ordem_fase,
            sf.id AS subfase_id, sf.nome AS subfase, sf.ordem AS ordem_subfase
       FROM producao.linha_producao AS lp
       INNER JOIN producao.fase AS f ON f.linha_producao_id = lp.id
       INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
       INNER JOIN producao.subfase AS sf ON sf.fase_id = f.id
      ORDER BY lp.nome_abrev, f.ordem, sf.ordem, sf.nome`
  )
}

// AS ETAPAS, com o caminho inteiro até a linha de produção. O `lote` sai de
// `acervo.lote`, e não de uma tabela de produção: é o mesmo lote da plataforma.
controller.getEtapas = async () => {
  return db.conn.any(
    `SELECT e.id AS etapa_id,
            e.tipo_etapa_id, te.nome AS etapa,
            e.subfase_id, s.nome AS subfase, s.ordem AS ordem_subfase,
            e.ordem,
            e.lote_id, l.nome AS lote,
            f.id AS fase_id, f.tipo_fase_id, tf.nome AS fase, f.ordem AS ordem_fase,
            f.linha_producao_id, lp.nome AS linha_producao,
            lp.subtipo_produto_id, sp.nome AS subtipo_produto
       FROM producao.etapa AS e
       INNER JOIN dominio.tipo_etapa AS te ON te.code = e.tipo_etapa_id
       INNER JOIN producao.subfase AS s ON s.id = e.subfase_id
       INNER JOIN producao.fase AS f ON f.id = s.fase_id
       INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
       INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
       INNER JOIN dominio.subtipo_produto AS sp ON sp.code = lp.subtipo_produto_id
       INNER JOIN acervo.lote AS l ON l.id = e.lote_id
      ORDER BY l.nome, f.ordem, s.ordem, e.ordem`
  )
}

const ERROS_ETAPA = {
  [CHECK_VIOLATION]:
    'A etapa de Execução tem de ser a primeira da subfase (ordem 1): uma revisão antes do trabalho revisaria o nada',
  [UNIQUE_VIOLATION]:
    'Já existe uma etapa com esta ordem nesta subfase deste lote',
  [FK_VIOLATION]: 'Subfase, lote ou tipo de etapa inexistente'
}

/**
 * Cria as etapas padrão de TODAS as subfases de uma fase, num lote.
 *
 * O `padrao_cq` do SAP virou `tipo_controle_qualidade_id`, que é o nome do
 * domínio que ele lê. O que cada código significa em etapas está em
 * `PADRAO_CONTROLE_QUALIDADE`, no schema, e a ORDEM do array de lá é a coluna
 * `ordem` daqui, começando em 1 -- é isso que faz `TIPO_ETAPA.EXECUCAO` cair
 * sempre em `ordem = 1`, como o CHECK `etapa_execucao_e_primeira` exige.
 *
 * O CÓDIGO É CONFERIDO CONTRA `dominio.tipo_controle_qualidade`, mesmo já tendo
 * passado pelo `.valid()` do Joi. Não é redundância: o Joi garante que o código
 * está IMPLEMENTADO aqui, e a consulta garante que ele existe no BANCO daquela
 * instalação. Os dois discordarem é o sintoma de um `er/dominio.sql` fora de
 * data, e ele deve aparecer como 400 com o nome do domínio, e não como uma
 * inserção que produz etapas que ninguém pediu.
 *
 * SEM `disableTriggers`, E O CUSTO ESTÁ MEDIDO NO DDL. Cada INSERT em
 * `producao.etapa` dispara DOIS gatilhos FOR EACH ROW de
 * `er/acompanhamento_producao.sql`: `trigger_view_acompanhamento_lote` (que
 * sincroniza a view materializada do par lote/linha) e
 * `refresh_view_acompanhamento_etapa`. Numa fase de sete subfases com o padrão
 * 3, são 21 etapas e 42 disparos, cada um mexendo em view materializada. É a
 * escrita mais cara da minha fatia, e ela acontece uma vez por fase por lote, na
 * tela de cadastro. RELATADO: se isso doer em produção, o remédio é uma rotina
 * de recriação em massa das views ao fim da transação, e não desligar gatilho
 * (o SCA não tem `disableTriggers`, de propósito).
 */
controller.criarEtapasPadrao = async (
  { tipo_controle_qualidade_id: tipoCq, fase_id: faseId, lote_id: loteId },
  usuarioUuid,
  contexto
) => {
  const padrao = PADRAO_CONTROLE_QUALIDADE[tipoCq]

  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const dominio = await t.oneOrNone(
          'SELECT code, nome FROM dominio.tipo_controle_qualidade WHERE code = $<tipoCq>',
          { tipoCq }
        )
        if (!dominio) {
          throw new AppError(
            'Tipo de controle de qualidade inexistente no banco',
            httpCode.BadRequest
          )
        }

        const lote = await t.oneOrNone(
          'SELECT id, nome FROM acervo.lote WHERE id = $<loteId>',
          { loteId }
        )
        if (!lote) {
          throw new AppError('Lote não encontrado', httpCode.NotFound)
        }

        const fase = await t.oneOrNone(
          'SELECT id, linha_producao_id FROM producao.fase WHERE id = $<faseId>',
          { faseId }
        )
        if (!fase) {
          throw new AppError('Fase não encontrada', httpCode.NotFound)
        }

        // A MESMA GUARDA DO SAP: etapa já criada em qualquer subfase desta fase
        // impede o padrão. Não é teimosia -- o padrão insere a partir da ordem 1,
        // e sobre um cadastro parcial ele produziria ordens repetidas (a UNIQUE
        // recusaria) ou uma Revisão sem Execução (o CHECK recusaria). Recusar
        // aqui diz o que fazer; recusar no banco diz o nome da restrição.
        const jaExistem = await t.oneOrNone(
          `SELECT e.id
             FROM producao.etapa AS e
             INNER JOIN producao.subfase AS s ON s.id = e.subfase_id
            WHERE e.lote_id = $<loteId> AND s.fase_id = $<faseId>
            LIMIT 1`,
          { loteId, faseId }
        )
        if (jaExistem) {
          throw new AppError(
            'Já existem etapas criadas em alguma subfase desta fase para este lote',
            httpCode.BadRequest
          )
        }

        const subfases = await t.any(
          `SELECT id, nome FROM producao.subfase
            WHERE fase_id = $<faseId>
            ORDER BY ordem, id`,
          { faseId }
        )
        if (!subfases.length) {
          throw new AppError(
            'A fase não tem subfase cadastrada, e etapa é etapa DE uma subfase',
            httpCode.BadRequest
          )
        }

        let etapasCriadas = 0
        let restricoesCriadas = 0

        for (const subfase of subfases) {
          const daSubfase = []

          for (const [indice, tipoEtapaId] of padrao.etapas.entries()) {
            const etapa = await t.one(
              `INSERT INTO producao.etapa
                 (tipo_etapa_id, subfase_id, lote_id, ordem,
                  usuario_cadastramento_uuid)
               VALUES ($<tipoEtapaId>, $<subfaseId>, $<loteId>, $<ordem>,
                       $<usuarioUuid>)
               RETURNING *`,
              {
                tipoEtapaId,
                subfaseId: subfase.id,
                loteId,
                // A ORDEM É A POSIÇÃO NO ARRAY, começando em 1. Ver o comentário
                // de `PADRAO_CONTROLE_QUALIDADE`.
                ordem: indice + 1,
                usuarioUuid
              }
            )

            await auditoriaCtrl.registrar(t, {
              tabela: 'producao.etapa',
              registroId: etapa.id,
              operacao: 'I',
              depois: etapa,
              usuarioUuid,
              contexto
            })

            daSubfase.push(etapa)
            etapasCriadas += 1
          }

          for (const restricao of padrao.restricoes) {
            const criada = await t.one(
              `INSERT INTO producao.restricao_etapa
                 (tipo_restricao_id, etapa_anterior_id, etapa_posterior_id,
                  usuario_cadastramento_uuid)
               VALUES ($<tipoRestricaoId>, $<anteriorId>, $<posteriorId>,
                       $<usuarioUuid>)
               RETURNING *`,
              {
                tipoRestricaoId: restricao.tipo,
                anteriorId: daSubfase[restricao.de].id,
                posteriorId: daSubfase[restricao.para].id,
                usuarioUuid
              }
            )

            await auditoriaCtrl.registrar(t, {
              tabela: 'producao.restricao_etapa',
              registroId: criada.id,
              operacao: 'I',
              depois: criada,
              usuarioUuid,
              contexto
            })

            restricoesCriadas += 1
          }
        }

        return {
          tipo_controle_qualidade: dominio.nome,
          subfases: subfases.length,
          etapas: etapasCriadas,
          restricoes: restricoesCriadas
        }
      }),
    ERROS_ETAPA
  )
}

// --- Camadas -----------------------------------------------------------------

const ERROS_CAMADA = {
  [UNIQUE_VIOLATION]: 'Já existe uma camada com este schema e este nome'
}

/**
 * O catálogo de camadas.
 *
 * `tem_propriedades` SE CHAMAVA `perfil` NO SAP, e o nome não atravessou: aqui
 * "perfil" quer dizer AUTORIZAÇÃO (`dominio.tipo_perfil`), e uma coluna booleana
 * chamada `perfil` na lista de camadas faria quem lesse achar que ela concede
 * acesso. O que ela responde é se a camada tem alguma linha em
 * `producao.propriedades_camada`, isto é, se alguma subfase já a usa -- que é
 * exatamente o que impede removê-la.
 */
controller.getCamadas = async () => {
  return db.conn.any(
    `SELECT c.id, c.schema, c.nome,
            COUNT(pc.id) > 0 AS tem_propriedades
       FROM producao.camada AS c
       LEFT JOIN producao.propriedades_camada AS pc ON pc.camada_id = c.id
      GROUP BY c.id, c.schema, c.nome
      ORDER BY c.schema, c.nome`
  )
}

// EM QUE LINHAS DE PRODUÇÃO CADA CAMADA APARECE, pelo caminho
// propriedades_camada -> subfase -> fase -> linha_producao. É a coluna que a
// tela de camadas mostra ao lado do nome, e o que responde "posso mexer nesta
// camada sem afetar outra linha de produção".
controller.getCamadasLinhaProducao = async () => {
  return db.conn.any(
    `SELECT c.id AS camada_id,
            STRING_AGG(DISTINCT lp.nome, ', ' ORDER BY lp.nome) AS linhas_producao
       FROM producao.camada AS c
       INNER JOIN producao.propriedades_camada AS pc ON pc.camada_id = c.id
       INNER JOIN producao.subfase AS s ON s.id = pc.subfase_id
       INNER JOIN producao.fase AS f ON f.id = s.fase_id
       INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
      GROUP BY c.id
      ORDER BY c.id`
  )
}

controller.criaCamadas = async (camadas, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const criadas = []

        // UMA POR UMA, e não `db.pgp.helpers.insert` de array inteiro como no
        // SAP: o `RETURNING *` de cada linha é o que alimenta o evento de
        // auditoria dela. O `contexto.loteId` agrupa as N numa tela só.
        for (const camada of camadas) {
          const criada = await t.one(
            `INSERT INTO producao.camada (schema, nome, usuario_cadastramento_uuid)
             VALUES ($<schema>, $<nome>, $<usuarioUuid>)
             RETURNING *`,
            { schema: camada.schema, nome: camada.nome, usuarioUuid }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: 'producao.camada',
            registroId: criada.id,
            operacao: 'I',
            depois: criada,
            usuarioUuid,
            contexto
          })

          criadas.push({ id: criada.id, schema: criada.schema, nome: criada.nome })
        }

        return criadas
      }),
    ERROS_CAMADA
  )
}

controller.atualizaCamadas = async (camadas, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        for (const camada of camadas) {
          const antes = await auditoriaCtrl.lerAntes(
            t,
            'producao.camada',
            camada.id,
            'Camada'
          )

          const depois = await t.one(
            `UPDATE producao.camada SET
               schema = $<schema>, nome = $<nome>,
               data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
             WHERE id = $<id>
             RETURNING *`,
            { id: camada.id, schema: camada.schema, nome: camada.nome, usuarioUuid }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: 'producao.camada',
            registroId: camada.id,
            operacao: 'U',
            antes,
            depois,
            usuarioUuid,
            contexto
          })
        }
      }),
    ERROS_CAMADA
  )
}

/**
 * Remove camadas do catálogo.
 *
 * A GUARDA DE `propriedades_camada` VEM ANTES DA CHAVE ESTRANGEIRA, e é a mesma
 * do SAP: sem ela o DELETE morreria com 23503 citando o nome da FK. A frase daqui
 * diz o que fazer -- a camada está em uso por alguma subfase, e é a propriedade
 * dela naquela subfase que precisa sair primeiro.
 */
controller.deleteCamadas = async (camadasIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const emUso = await t.any(
      `SELECT DISTINCT c.id, c.schema, c.nome
         FROM producao.propriedades_camada AS pc
         INNER JOIN producao.camada AS c ON c.id = pc.camada_id
        WHERE pc.camada_id IN ($<camadasIds:csv>)
        ORDER BY c.schema, c.nome`,
      { camadasIds }
    )
    if (emUso.length) {
      const nomes = emUso.map(c => `${c.schema}.${c.nome}`).join(', ')
      throw new AppError(
        `Não é possível remover: alguma subfase usa ${nomes}. Remova as propriedades de camada dessas subfases antes.`,
        httpCode.BadRequest
      )
    }

    for (const id of camadasIds) {
      // `lerAntes` faz as DUAS coisas numa consulta: o estado anterior para o
      // rastro e o 404 que diz QUAL id não existe.
      const antes = await auditoriaCtrl.lerAntes(t, 'producao.camada', id, 'Camada')

      await t.none('DELETE FROM producao.camada WHERE id = $<id>', { id })

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.camada',
        registroId: id,
        operacao: 'D',
        antes,
        usuarioUuid,
        contexto
      })
    }
  })
}

// --- O estado das subfases de um lote ----------------------------------------

/**
 * O estado das subfases de um lote: quantas etapas cada uma tem, que unidades de
 * trabalho existem e em que situação estão as atividades.
 *
 * É A ROTA QUE EXISTE PORQUE ISTO ERA LIDO POR `psql` DIRETO NO BANCO, com
 * credencial fora do sistema e SQL montado por interpolação de string. Leitura
 * pertence a uma rota, e aqui ela passa pela mesma guarda, pelo mesmo log e pelo
 * mesmo schema que o resto.
 *
 * O RECORTE MUDOU EM RELAÇÃO AO SAP, e a razão é a linha de produção sair do
 * lote. Lá, sem `subfase_ids`, a consulta varria TODAS as subfases do banco:
 * como o lote tinha uma linha só, o que sobrava era quase o certo. Aqui o padrão
 * é as subfases das LINHAS QUE O LOTE EXECUTA, derivadas da etapa. A subfase com
 * ZERO etapa continua aparecendo, com `etapas: 0`, e é ela o motivo desta rota
 * existir: o que se procura é a fase que FALTOU cadastrar.
 *
 * COM `subfase_ids` o filtro é exatamente ele, e não a interseção com as linhas
 * derivadas. É deliberado: quem cita a subfase pelo id está perguntando por uma
 * subfase que o lote talvez ainda não execute, que é o caso de quem vai clonar o
 * molde de um lote noutro.
 *
 * @param {number} loteId - `acervo.lote (id)`
 * @param {object} [opcoes]
 * @param {number[]|null} [opcoes.subfaseIds]
 * @param {boolean} [opcoes.incluirGeom]
 */
controller.getSubfasesLote = async (
  loteId,
  { subfaseIds = null, incluirGeom = false } = {}
) => {
  return db.conn.task(async t => {
    const lote = await t.oneOrNone(
      'SELECT id, nome FROM acervo.lote WHERE id = $<loteId>',
      { loteId }
    )
    if (!lote) {
      throw new AppError('Lote não encontrado', httpCode.NotFound)
    }

    const temFiltro = Boolean(subfaseIds && subfaseIds.length)
    const filtro = temFiltro
      ? 'AND s.id IN ($<subfaseIds:csv>)'
      : 'AND f.linha_producao_id IN (SELECT linha_producao_id FROM linhas)'

    const subfases = await t.any(
      `WITH linhas AS (
         SELECT DISTINCT ll.linha_producao_id
           FROM (${LOTE_EXECUTA_LINHA}) AS ll
          WHERE ll.lote_id = $<loteId>
       )
       SELECT s.id AS subfase_id, s.nome AS subfase, s.ordem AS ordem_subfase,
              s.fase_id, f.ordem AS ordem_fase, f.tipo_fase_id, tf.nome AS fase,
              f.linha_producao_id, lp.nome AS linha_producao,
              COUNT(DISTINCT e.id)::int AS etapas
         FROM producao.subfase AS s
         INNER JOIN producao.fase AS f ON f.id = s.fase_id
         INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
         INNER JOIN producao.linha_producao AS lp ON lp.id = f.linha_producao_id
         LEFT JOIN producao.etapa AS e
           ON e.subfase_id = s.id AND e.lote_id = $<loteId>
        WHERE TRUE ${filtro}
        GROUP BY s.id, s.nome, s.ordem, s.fase_id, f.ordem, f.tipo_fase_id,
                 tf.nome, f.linha_producao_id, lp.nome
        ORDER BY lp.nome, f.ordem, s.ordem, s.id`,
      { loteId, subfaseIds }
    )

    if (!subfases.length) return []

    const ids = subfases.map(s => s.subfase_id)

    const unidades = await t.any(
      // EWKT, e não WKT: a coluna é geometry(POLYGON, 4674) e quem for CLONAR o
      // molde precisa da geometria COM o SRID. O `ut.epsg` ao lado é outra
      // coisa (a projeção de EDIÇÃO, tipicamente uma UTM local), e confundir os
      // dois faz o clone nascer com a geometria rotulada errada.
      `SELECT ut.id, ut.nome, ut.subfase_id, ut.epsg, ut.dado_producao_id,
              ut.bloco_id, ut.disponivel, ut.prioridade
              ${incluirGeom ? ', ST_AsEWKT(ut.geom) AS geom' : ''}
         FROM producao.unidade_trabalho AS ut
        WHERE ut.lote_id = $<loteId> AND ut.subfase_id IN ($<ids:csv>)
        ORDER BY ut.subfase_id, ut.id`,
      { loteId, ids }
    )

    // Uma linha por (subfase, situação) com a contagem, mais os ids do que ainda
    // não começou e as datas em que se concluiu. As datas vêm DISTINTAS de
    // propósito: mais de uma data numa subfase concluída significa que ela não
    // fechou de uma vez, e quem for datar um lançamento retroativo precisa
    // ESCOLHER, e não receber a primeira calada.
    const atividades = await t.any(
      `SELECT e.subfase_id,
              a.tipo_situacao_atividade_id,
              COUNT(*)::int AS quantidade,
              array_agg(a.id ORDER BY a.id)
                FILTER (WHERE a.tipo_situacao_atividade_id = $<naoIniciada>) AS nao_iniciadas,
              array_agg(DISTINCT a.data_fim)
                FILTER (WHERE a.tipo_situacao_atividade_id = $<finalizada>) AS datas_fim
         FROM producao.atividade AS a
         INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
        WHERE e.lote_id = $<loteId> AND e.subfase_id IN ($<ids:csv>)
        GROUP BY e.subfase_id, a.tipo_situacao_atividade_id
        ORDER BY e.subfase_id, a.tipo_situacao_atividade_id`,
      {
        loteId,
        ids,
        naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA,
        finalizada: SITUACAO_ATIVIDADE.FINALIZADA
      }
    )

    return subfases.map(s => {
      const minhas = atividades.filter(a => a.subfase_id === s.subfase_id)
      const porSituacao = {}
      let naoIniciadas = []
      let datasFim = []

      for (const a of minhas) {
        porSituacao[a.tipo_situacao_atividade_id] = a.quantidade
        if (a.nao_iniciadas) naoIniciadas = naoIniciadas.concat(a.nao_iniciadas)
        if (a.datas_fim) datasFim = datasFim.concat(a.datas_fim)
      }

      return {
        ...s,
        unidades_trabalho: unidades.filter(u => u.subfase_id === s.subfase_id),
        atividades: {
          por_situacao: porSituacao,
          nao_iniciadas: naoIniciadas,
          datas_fim_concluidas: [
            ...new Set(
              datasFim
                .filter(d => d !== null)
                .map(d => (d instanceof Date ? d.toISOString() : d))
            )
          ]
        }
      }
    })
  })
}

module.exports = controller
