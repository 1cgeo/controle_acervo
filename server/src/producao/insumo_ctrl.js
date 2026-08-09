'use strict'

// O INSUMO: o que a unidade de trabalho consome, e como ele chega até ela.
//
// Atravessou do `projeto_ctrl.js` do SAP 2.3.5 em 2026-08-09. As conversões que
// valem para todo o core (`docs/decisoes.md`): `db.sapConn` virou `db.conn`, o
// schema `macrocontrole` virou `producao`, o SRID 4326 virou 4674 e toda coluna
// de pessoa virou `usuario_uuid` apontando `dgeo.usuario (uuid)`.
//
// `disableTriggers` NÃO EXISTE AQUI, e não faz falta nesta fatia: nenhum gatilho
// de `er/producao.sql` mora sobre `producao.insumo`, `producao.grupo_insumo` ou
// `producao.insumo_unidade_trabalho`. Os gatilhos do core vivem sobre
// `unidade_trabalho`, `atividade`, `acervo.versao`, `acervo.lote`, `bloco` e
// `projeto`, e a associação em massa não escreve em nenhuma delas. O custo da
// associação é o CRUZAMENTO ESPACIAL, e está comentado na seção dela.

const { db } = require('../database')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

// --- Erros do banco que viram resposta amigável ------------------------------

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'

const traduzirErro = (err, mensagens) => {
  if (!err || !err.code) return err
  const frase = mensagens[err.code]
  if (!frase) return err
  return new AppError(frase, httpCode.Conflict, err)
}

const comTraducao = async (promessa, mensagens) => {
  try {
    return await promessa()
  } catch (err) {
    throw traduzirErro(err, mensagens)
  }
}

// O opcional AUSENTE vira null antes da consulta: sem isto, um corpo válido que
// omite um campo opcional derruba o pg-promise com "Property doesn't exist", que
// chega como 500 onde não houve erro nenhum.
const ou = (valor, padrao = null) => (valor === undefined ? padrao : valor)

// A string vazia que o formulário manda vira NULO. `epsg`, `geom` e
// `caminho_padrao` são anuláveis no DDL, e '' ao lado de NULL na mesma coluna
// daria dois jeitos de dizer "não tem".
const vazioEhNulo = valor =>
  valor === undefined || valor === null || valor === '' ? null : valor

// --- Grupo de insumo ---------------------------------------------------------

const ERROS_GRUPO_INSUMO = {
  [UNIQUE_VIOLATION]: 'Já existe um grupo de insumo com este nome'
}

controller.getGrupoInsumo = async (filtros = {}) => {
  return db.conn.any(
    `SELECT id, nome, disponivel
       FROM producao.grupo_insumo
      WHERE ($<disponivel> IS NULL OR disponivel = $<disponivel>)
      ORDER BY nome`,
    { disponivel: ou(filtros.disponivel) }
  )
}

// UM EVENTO POR LINHA, e não um pelo lote, nas escritas do CADASTRO. O grupo de
// insumo é ficha que alguém abre, e o histórico dele tem de dizer quem mudou o
// nome daquele grupo -- não "alguém salvou quatro grupos".
controller.gravaGrupoInsumo = async (grupos, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const ids = []

        for (const grupo of grupos) {
          const criado = await t.one(
            `INSERT INTO producao.grupo_insumo
               (nome, disponivel, usuario_cadastramento_uuid)
             VALUES ($<nome>, $<disponivel>, $<usuarioUuid>)
             RETURNING *`,
            { nome: grupo.nome, disponivel: ou(grupo.disponivel, true), usuarioUuid }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: 'producao.grupo_insumo',
            registroId: criado.id,
            operacao: 'I',
            depois: criado,
            usuarioUuid,
            contexto
          })

          ids.push(criado.id)
        }

        // O `RETURNING *` é do rastro; a rota devolve só os ids.
        return { ids }
      }),
    ERROS_GRUPO_INSUMO
  )
}

controller.atualizaGrupoInsumo = async (grupos, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        for (const grupo of grupos) {
          // `lerAntes` faz as DUAS coisas numa consulta: guarda o estado
          // anterior para o rastro e lança o 404 quando o registro não existe.
          const antes = await auditoriaCtrl.lerAntes(
            t,
            'producao.grupo_insumo',
            grupo.id,
            'Grupo de insumo'
          )

          const depois = await t.one(
            `UPDATE producao.grupo_insumo SET
               nome = $<nome>, disponivel = $<disponivel>,
               data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
             WHERE id = $<id>
             RETURNING *`,
            {
              id: grupo.id,
              nome: grupo.nome,
              disponivel: ou(grupo.disponivel, true),
              usuarioUuid
            }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: 'producao.grupo_insumo',
            registroId: grupo.id,
            operacao: 'U',
            antes,
            depois,
            usuarioUuid,
            contexto
          })
        }
      }),
    ERROS_GRUPO_INSUMO
  )
}

controller.deletaGrupoInsumo = async (grupoInsumoIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const existentes = await t.any(
      'SELECT id FROM producao.grupo_insumo WHERE id IN ($<grupoInsumoIds:csv>)',
      { grupoInsumoIds }
    )
    if (existentes.length < grupoInsumoIds.length) {
      throw new AppError(
        'Um dos ids informados não corresponde a um grupo de insumo',
        httpCode.BadRequest
      )
    }

    // A CONFERÊNCIA VEM ANTES DO DELETE de propósito. A chave estrangeira já
    // recusaria, mas com o nome da restrição no meio de um 500; aqui a recusa é
    // 400 com a frase que diz o que fazer.
    const insumoAssociado = await t.oneOrNone(
      `SELECT id FROM producao.insumo
        WHERE grupo_insumo_id IN ($<grupoInsumoIds:csv>)
        LIMIT 1`,
      { grupoInsumoIds }
    )
    if (insumoAssociado) {
      throw new AppError(
        'Um dos grupos de insumo possui insumos associados',
        httpCode.BadRequest
      )
    }

    const apagados = await t.any(
      'DELETE FROM producao.grupo_insumo WHERE id IN ($<grupoInsumoIds:csv>) RETURNING *',
      { grupoInsumoIds }
    )

    for (const antes of apagados) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.grupo_insumo',
        registroId: antes.id,
        operacao: 'D',
        antes,
        usuarioUuid,
        contexto
      })
    }
  })
}

// --- Insumo ------------------------------------------------------------------

// A GEOMETRIA SAI COMO EWKT E ENTRA COMO EWKT, nos dois sentidos.
//
// `SELECT *` numa tabela com coluna geométrica devolve o WKB em hexadecimal, que
// é ilegível na tela e no rastro. E `RETURNING *, ST_AsEWKT(geom) AS geom` teria
// DUAS colunas com o mesmo nome, e qual delas sobrevive no objeto passaria a
// depender do driver -- é a mesma armadilha que `auditoria/auditoria_ctrl.js`
// documenta. Por isso a lista é explícita.
const COLUNAS_INSUMO = `
  id, nome, caminho, epsg, tipo_insumo_id, grupo_insumo_id,
  ST_AsEWKT(geom)::text AS geom,
  data_cadastramento, usuario_cadastramento_uuid,
  data_modificacao, usuario_modificacao_uuid`

// `::text` no parâmetro porque `ST_GeomFromEWKT(NULL)` sem tipo é ambíguo para o
// PostgreSQL; com o tipo, NULO entra como NULO e o insumo não espacial nasce sem
// recorte, que é o desenho.
const GEOM_DE_EWKT = 'ST_GeomFromEWKT($<geom>::text)'

const ERROS_INSUMO = {
  [FK_VIOLATION]: 'Tipo de insumo ou grupo de insumo inexistente'
}

controller.getInsumos = async (filtros = {}) => {
  return db.conn.any(
    `SELECT i.id, i.nome, i.caminho, i.epsg,
            i.tipo_insumo_id, ti.nome AS tipo_insumo,
            i.grupo_insumo_id, gi.nome AS grupo_insumo,
            ST_AsEWKT(i.geom)::text AS geom
       FROM producao.insumo AS i
       INNER JOIN dominio.tipo_insumo AS ti ON ti.code = i.tipo_insumo_id
       INNER JOIN producao.grupo_insumo AS gi ON gi.id = i.grupo_insumo_id
      WHERE ($<grupoInsumoId> IS NULL OR i.grupo_insumo_id = $<grupoInsumoId>)
        AND ($<tipoInsumoId> IS NULL OR i.tipo_insumo_id = $<tipoInsumoId>)
      ORDER BY gi.nome, i.nome`,
    {
      grupoInsumoId: ou(filtros.grupo_insumo_id),
      tipoInsumoId: ou(filtros.tipo_insumo_id)
    }
  )
}

// UM EVENTO POR INSUMO, por decisão do chefe, e o custo está medido no relatório
// desta fatia: uma carga de cobertura de imagens entra com centenas de linhas
// numa requisição, e cada uma delas grava um evento. É o preço de o insumo ter
// ficha própria no rastro; a alternativa (um evento pela carga) esconderia qual
// linha da carga foi editada depois.
controller.criaInsumos = async (
  insumos,
  tipoInsumoId,
  grupoInsumoId,
  usuarioUuid,
  contexto
) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        const ids = []

        for (const insumo of insumos) {
          const criado = await t.one(
            `INSERT INTO producao.insumo
               (nome, caminho, epsg, tipo_insumo_id, grupo_insumo_id, geom,
                usuario_cadastramento_uuid)
             VALUES
               ($<nome>, $<caminho>, $<epsg>, $<tipoInsumoId>, $<grupoInsumoId>,
                ${GEOM_DE_EWKT}, $<usuarioUuid>)
             RETURNING ${COLUNAS_INSUMO}`,
            {
              nome: insumo.nome,
              caminho: insumo.caminho,
              epsg: vazioEhNulo(insumo.epsg),
              geom: vazioEhNulo(insumo.geom),
              tipoInsumoId,
              grupoInsumoId,
              usuarioUuid
            }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: 'producao.insumo',
            registroId: criado.id,
            operacao: 'I',
            depois: criado,
            usuarioUuid,
            contexto
          })

          ids.push(criado.id)
        }

        return { ids }
      }),
    ERROS_INSUMO
  )
}

controller.atualizaInsumos = async (insumos, usuarioUuid, contexto) => {
  return comTraducao(
    () =>
      db.conn.tx(async t => {
        for (const insumo of insumos) {
          const antes = await auditoriaCtrl.lerAntes(
            t,
            'producao.insumo',
            insumo.id,
            'Insumo'
          )

          const depois = await t.one(
            `UPDATE producao.insumo SET
               nome = $<nome>, caminho = $<caminho>, epsg = $<epsg>,
               tipo_insumo_id = $<tipo_insumo_id>,
               grupo_insumo_id = $<grupo_insumo_id>,
               geom = ${GEOM_DE_EWKT},
               data_modificacao = now(), usuario_modificacao_uuid = $<usuarioUuid>
             WHERE id = $<id>
             RETURNING ${COLUNAS_INSUMO}`,
            {
              id: insumo.id,
              nome: insumo.nome,
              caminho: insumo.caminho,
              epsg: vazioEhNulo(insumo.epsg),
              geom: vazioEhNulo(insumo.geom),
              tipo_insumo_id: insumo.tipo_insumo_id,
              grupo_insumo_id: insumo.grupo_insumo_id,
              usuarioUuid
            }
          )

          await auditoriaCtrl.registrar(t, {
            tabela: 'producao.insumo',
            registroId: insumo.id,
            operacao: 'U',
            antes,
            depois,
            usuarioUuid,
            contexto
          })
        }
      }),
    ERROS_INSUMO
  )
}

controller.deletaInsumos = async (insumoIds, usuarioUuid, contexto) => {
  return db.conn.tx(async t => {
    const existentes = await t.any(
      'SELECT id FROM producao.insumo WHERE id IN ($<insumoIds:csv>)',
      { insumoIds }
    )
    if (existentes.length < insumoIds.length) {
      throw new AppError(
        'Um dos ids informados não corresponde a um insumo',
        httpCode.BadRequest
      )
    }

    // APAGAR O INSUMO NÃO DESFAZ A ASSOCIAÇÃO EM SILÊNCIO. Quem quer tirá-lo da
    // unidade de trabalho usa `DELETE /unidade_trabalho/insumos`, que é ato
    // próprio e tem o próprio evento de auditoria.
    const associado = await t.oneOrNone(
      `SELECT id FROM producao.insumo_unidade_trabalho
        WHERE insumo_id IN ($<insumoIds:csv>)
        LIMIT 1`,
      { insumoIds }
    )
    if (associado) {
      throw new AppError(
        'Um dos insumos está associado a unidades de trabalho',
        httpCode.BadRequest
      )
    }

    const apagados = await t.any(
      `DELETE FROM producao.insumo WHERE id IN ($<insumoIds:csv>)
       RETURNING ${COLUNAS_INSUMO}`,
      { insumoIds }
    )

    for (const antes of apagados) {
      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.insumo',
        registroId: antes.id,
        operacao: 'D',
        antes,
        usuarioUuid,
        contexto
      })
    }
  })
}

// --- A associação com a unidade de trabalho ----------------------------------

controller.getInsumosUnidadeTrabalho = async unidadeTrabalhoId => {
  return db.conn.any(
    `SELECT iut.id AS associacao_id, iut.caminho_padrao,
            ut.id AS unidade_trabalho_id, ut.nome AS unidade_trabalho,
            i.id AS insumo_id, i.nome, i.caminho, i.epsg,
            i.tipo_insumo_id, ti.nome AS tipo_insumo,
            i.grupo_insumo_id, gi.nome AS grupo_insumo
       FROM producao.insumo_unidade_trabalho AS iut
       INNER JOIN producao.unidade_trabalho AS ut ON ut.id = iut.unidade_trabalho_id
       INNER JOIN producao.insumo AS i ON i.id = iut.insumo_id
       INNER JOIN dominio.tipo_insumo AS ti ON ti.code = i.tipo_insumo_id
       INNER JOIN producao.grupo_insumo AS gi ON gi.id = i.grupo_insumo_id
      WHERE iut.unidade_trabalho_id = $<unidadeTrabalhoId>
      ORDER BY gi.nome, i.nome`,
    { unidadeTrabalhoId }
  )
}

// AS CINCO ESTRATÉGIAS, e o que muda entre elas é UMA LINHA.
//
// No SAP eram dez blocos de SQL quase idênticos (cinco por rota), e a diferença
// entre eles cabia na cláusula de junção. Dez cópias divergem: bastaria uma
// delas esquecer o `iut.id IS NULL` para a rota do bloco estourar na UNIQUE onde
// a da unidade de trabalho não estoura, sem nada acusar.
//
// Os codes são os de `dominio.tipo_estrategia_associacao`, e a lista mora AQUI
// porque cada estratégia É um pedaço de SQL. `domain_constants.js` diz por que
// ela não virou constante: é argumento de rotina, e nenhuma coluna aponta para
// ela.
//
// A ESTRATÉGIA 5 É A ÚNICA QUE ALCANÇA O INSUMO NÃO ESPACIAL, e isso não é
// defeito: as quatro primeiras cruzam geometria, e `ST_Intersects` com NULL é
// NULL, que não passa no INNER JOIN. Um serviço WMS ou um banco PostGIS não têm
// recorte e valem para toda a área -- é exatamente o que "associar a todas as
// unidades de trabalho" quer dizer.
const JUNCAO_POR_ESTRATEGIA = {
  1: 'INNER JOIN producao.insumo AS i ON ST_Intersects(ST_Centroid(ut.geom), i.geom)',
  2: 'INNER JOIN producao.insumo AS i ON ST_Intersects(ST_Centroid(i.geom), ut.geom)',
  3: 'INNER JOIN producao.insumo AS i ON ST_Intersects(i.geom, ut.geom)',
  4: "INNER JOIN producao.insumo AS i ON ST_Relate(ut.geom, i.geom, '2********')",
  5: 'CROSS JOIN producao.insumo AS i'
}

const juncaoDaEstrategia = estrategiaId => {
  const juncao = JUNCAO_POR_ESTRATEGIA[estrategiaId]
  if (!juncao) {
    throw new AppError('Estratégia de associação inválida', httpCode.BadRequest)
  }
  return juncao
}

// A DESCRIÇÃO DO ALVO, para o evento de auditoria. Ela é TEXTO e não a lista
// crua: uma associação de bloco alcança milhares de unidades, e um array com
// milhares de ids dentro de `auditoria.evento` seria maior que a operação que
// ele descreve. Os primeiros ids ficam porque são o que permite conferir a
// operação; o resto vira contagem.
const TETO_IDS_NO_EVENTO = 20

const descreverIds = (rotulo, ids) => {
  const mostrados = ids.slice(0, TETO_IDS_NO_EVENTO).join(', ')
  const restantes = ids.length - Math.min(ids.length, TETO_IDS_NO_EVENTO)
  return restantes > 0
    ? `${rotulo} ${mostrados} e mais ${restantes}`
    : `${rotulo} ${mostrados}`
}

/**
 * Os LOTES que a operação alcança, lidos ANTES da escrita.
 *
 * O agregado de `producao.insumo_unidade_trabalho` no mapa de auditoria é o LOTE
 * (o do acervo), alcançado por `unidade_trabalho.lote_id`. Como o evento aqui é
 * um por OPERAÇÃO e não um por linha, quem resolve o lote é esta consulta, e não
 * o `agregado` do mapa -- que recebe uma linha e aqui não há linha nenhuma.
 *
 * Ela roda ANTES do INSERT de propósito: assim a operação que não casou NADA
 * (estratégia errada, grupo vazio) também deixa rastro, dizendo em que lote
 * alguém tentou. Depois do INSERT não haveria lote a que apontar.
 *
 * `lote_id` é BIGINT, e o driver o devolve como TEXTO. Ele é usado como chave de
 * Map e como `entidadeId`, e os dois querem texto mesmo.
 */
const lotesAlvo = (t, { recorte, params }) =>
  t.map(
    `SELECT DISTINCT ut.lote_id
       FROM producao.unidade_trabalho AS ut
      WHERE ${recorte}
      ORDER BY ut.lote_id`,
    params,
    linha => String(linha.lote_id)
  )

/**
 * O INSERT da associação, devolvendo QUANTAS linhas entraram POR LOTE.
 *
 * O `LEFT JOIN ... WHERE iut.id IS NULL` é o que faz a rotina ser reexecutável:
 * associar de novo o mesmo grupo às mesmas unidades não estoura a UNIQUE
 * `(unidade_trabalho_id, insumo_id)`, só não acrescenta nada. É comportamento do
 * SAP, e é o que a tela de carga espera.
 *
 * A CONTAGEM SAI DE UM CTE, e não de mil linhas trazidas para o JavaScript: o
 * `RETURNING` fica dentro da consulta e o que atravessa a rede é uma linha por
 * lote.
 *
 * O CUSTO ESTÁ AQUI, e não na auditoria: o cruzamento espacial percorre o
 * produto das unidades de trabalho pelos insumos do grupo. As estratégias 1 a 4
 * se apoiam nos índices GiST `idx_unidade_trabalho_geom` e `idx_insumo_geom`; a
 * 5 é um CROSS JOIN e não tem índice que a ajude -- ela é, por definição, uma
 * linha por par. Uma carga de 3.000 unidades com 500 insumos gera 1,5 milhão de
 * linhas num INSERT só, e é por isso que o evento de auditoria é UM por lote.
 *
 * NENHUM GATILHO DISPARA NISSO, e é o que dispensa o `disableTriggers` do SAP:
 * `er/producao.sql` não põe gatilho nenhum sobre `insumo_unidade_trabalho`. Os
 * caches espaciais do core (`relacionamento_unidade_trabalho`,
 * `relacionamento_versao`) são mantidos por gatilhos sobre `unidade_trabalho` e
 * `acervo.versao`, que esta rotina não toca.
 */
const inserirAssociacoes = (t, { estrategiaId, recorte, params }) => {
  const juncao = juncaoDaEstrategia(estrategiaId)

  return t.any(
    `WITH inseridos AS (
       INSERT INTO producao.insumo_unidade_trabalho
         (unidade_trabalho_id, insumo_id, caminho_padrao)
       SELECT ut.id, i.id, $<caminhoPadrao>
         FROM producao.unidade_trabalho AS ut
         ${juncao}
         LEFT JOIN producao.insumo_unidade_trabalho AS iut
           ON iut.unidade_trabalho_id = ut.id AND iut.insumo_id = i.id
        WHERE ${recorte}
          AND i.grupo_insumo_id = $<grupoInsumoId>
          AND iut.id IS NULL
       RETURNING unidade_trabalho_id
     )
     SELECT ut.lote_id, COUNT(*)::int AS associacoes
       FROM inseridos AS ins
       INNER JOIN producao.unidade_trabalho AS ut ON ut.id = ins.unidade_trabalho_id
      GROUP BY ut.lote_id`,
    params
  )
}

const contagemPorLote = linhas =>
  new Map(linhas.map(linha => [String(linha.lote_id), linha.associacoes]))

/**
 * UM EVENTO POR OPERAÇÃO E POR LOTE, e não um por linha.
 *
 * `producao.insumo_unidade_trabalho` recebe milhares de linhas de uma vez, e um
 * evento por linha faria a trilha crescer mais rápido que a tabela que ela
 * audita -- para registrar algo que ninguém decidiu linha a linha. É o mesmo
 * desenho de `campo.track_ponto`, que não tem entrada no mapa: o que se audita é
 * a operação, com a quantidade num campo sintético.
 *
 * POR LOTE, e não um só, porque o agregado declarado no mapa é o LOTE: a ficha
 * que alguém abre é a do lote, e uma operação que alcançasse dois lotes com um
 * evento só apareceria na ficha de um deles e sumiria da do outro. São poucos
 * (uma tela de carga trabalha num lote), então o "por lote" quase sempre é um.
 *
 * OS CAMPOS `alvo`, `associacoes`, `estrategia_id` e `grupo_insumo_id` SÃO
 * SINTÉTICOS: nenhum deles é coluna de `insumo_unidade_trabalho`. Só
 * `caminho_padrao` é coluna de verdade. Eles precisam ser declarados
 * `sintetico: true` no mapa (`auditoria/mapa/producao.js`), senão a varredura de
 * `__tests__/auditoria/mapa.test.js` os cobra contra o DDL.
 */
const registrarPorLote = async (
  t,
  { operacao, lotes, contagem, corpo, usuarioUuid, contexto }
) => {
  let total = 0

  for (const loteId of lotes) {
    const associacoes = contagem.get(loteId) || 0
    total += associacoes

    const estado = { ...corpo, associacoes }

    await auditoriaCtrl.registrar(t, {
      tabela: 'producao.insumo_unidade_trabalho',
      operacao,
      // Sem `registroId`: a operação não tem uma linha, tem milhares.
      antes: operacao === 'D' ? estado : undefined,
      depois: operacao === 'D' ? undefined : estado,
      // O AGREGADO VAI EXPLÍCITO porque o `agregado` do mapa lê
      // `linha.unidade_trabalho_id`, e o estado sintético não tem uma linha.
      // O valor é o MESMO que ele resolveria: `unidade_trabalho.lote_id`.
      entidadeId: loteId,
      usuarioUuid,
      contexto
    })
  }

  return total
}

controller.associaInsumos = async (
  unidadeTrabalhoIds,
  grupoInsumoId,
  estrategiaId,
  caminhoPadrao,
  usuarioUuid,
  contexto
) => {
  const recorte = 'ut.id IN ($<unidadeTrabalhoIds:csv>)'
  const params = {
    unidadeTrabalhoIds,
    grupoInsumoId,
    caminhoPadrao: vazioEhNulo(caminhoPadrao)
  }

  return db.conn.tx(async t => {
    const lotes = await lotesAlvo(t, { recorte, params })
    const linhas = await inserirAssociacoes(t, { estrategiaId, recorte, params })

    const associacoes = await registrarPorLote(t, {
      operacao: 'I',
      lotes,
      contagem: contagemPorLote(linhas),
      corpo: {
        alvo: descreverIds(
          `${unidadeTrabalhoIds.length} unidade(s) de trabalho:`,
          unidadeTrabalhoIds
        ),
        grupo_insumo_id: grupoInsumoId,
        estrategia_id: estrategiaId,
        caminho_padrao: vazioEhNulo(caminhoPadrao)
      },
      usuarioUuid,
      contexto
    })

    return { associacoes }
  })
}

controller.associaInsumosBloco = async (
  blocoId,
  subfaseIds,
  grupoInsumoId,
  estrategiaId,
  caminhoPadrao,
  usuarioUuid,
  contexto
) => {
  // AS DUAS CONDIÇÕES JUNTAS, e não só o bloco: um bloco tem unidades de
  // trabalho de VÁRIAS subfases, e associar o insumo de restituição às unidades
  // de edição entregaria dado que ninguém pediu.
  const recorte = 'ut.bloco_id = $<blocoId> AND ut.subfase_id IN ($<subfaseIds:csv>)'
  const params = {
    blocoId,
    subfaseIds,
    grupoInsumoId,
    caminhoPadrao: vazioEhNulo(caminhoPadrao)
  }

  return db.conn.tx(async t => {
    const lotes = await lotesAlvo(t, { recorte, params })
    const linhas = await inserirAssociacoes(t, { estrategiaId, recorte, params })

    const associacoes = await registrarPorLote(t, {
      operacao: 'I',
      lotes,
      contagem: contagemPorLote(linhas),
      corpo: {
        alvo: descreverIds(
          `Bloco ${blocoId}, ${subfaseIds.length} subfase(s):`,
          subfaseIds
        ),
        grupo_insumo_id: grupoInsumoId,
        estrategia_id: estrategiaId,
        caminho_padrao: vazioEhNulo(caminhoPadrao)
      },
      usuarioUuid,
      contexto
    })

    return { associacoes }
  })
}

controller.deletaInsumosAssociados = async (
  unidadeTrabalhoIds,
  grupoInsumoId,
  usuarioUuid,
  contexto
) => {
  const recorte = 'ut.id IN ($<unidadeTrabalhoIds:csv>)'
  const params = { unidadeTrabalhoIds, grupoInsumoId }

  return db.conn.tx(async t => {
    const lotes = await lotesAlvo(t, { recorte, params })

    // `USING` em vez do `DELETE ... WHERE id IN (SELECT ...)` do SAP: o filtro é
    // pelo GRUPO do insumo, que mora na outra tabela, e a junção direta poupa a
    // subconsulta de ids que a versão de lá materializava.
    const linhas = await t.any(
      `WITH apagados AS (
         DELETE FROM producao.insumo_unidade_trabalho AS iut
          USING producao.insumo AS i
          WHERE i.id = iut.insumo_id
            AND i.grupo_insumo_id = $<grupoInsumoId>
            AND iut.unidade_trabalho_id IN ($<unidadeTrabalhoIds:csv>)
        RETURNING iut.unidade_trabalho_id
       )
       SELECT ut.lote_id, COUNT(*)::int AS associacoes
         FROM apagados AS ap
         INNER JOIN producao.unidade_trabalho AS ut ON ut.id = ap.unidade_trabalho_id
        GROUP BY ut.lote_id`,
      params
    )

    // A EXCLUSÃO EM MASSA TAMBÉM É UM EVENTO POR LOTE, pelo mesmo motivo da
    // inserção: apagar milhares de associações uma a uma inundaria a trilha do
    // mesmo jeito que criá-las.
    const associacoes = await registrarPorLote(t, {
      operacao: 'D',
      lotes,
      contagem: contagemPorLote(linhas),
      corpo: {
        alvo: descreverIds(
          `${unidadeTrabalhoIds.length} unidade(s) de trabalho:`,
          unidadeTrabalhoIds
        ),
        grupo_insumo_id: grupoInsumoId
      },
      usuarioUuid,
      contexto
    })

    return { associacoes }
  })
}

module.exports = controller
