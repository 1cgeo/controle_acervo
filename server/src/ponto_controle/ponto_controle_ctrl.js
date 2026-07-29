// Path: ponto_controle\ponto_controle_ctrl.js
'use strict'

const { db } = require('../database')
const { AppError, httpCode } = require('../utils')

const controller = {}

// As tabelas de domínio do schema. O `campo` difere porque o new_db.sql do
// plugin nomeou as duas primeiras com `nome` e as demais com `code_name`.
//
// Esta lista é a fonte única: dela saem a rota /dominios, os LEFT JOIN que
// resolvem o código em nome na ficha, e o CSV. Domínio novo entra nos três de
// uma vez.
const DOMINIOS = [
  { tabela: 'tipo_situacao', campo: 'nome' },
  { tabela: 'classificacao_ponto', campo: 'nome' },
  { tabela: 'tipo_ref', campo: 'code_name' },
  { tabela: 'sistema_geodesico', campo: 'code_name' },
  { tabela: 'referencial_altim', campo: 'code_name' },
  { tabela: 'metodo_posicionamento', campo: 'code_name' },
  { tabela: 'tipo_medicao_altura', campo: 'code_name' },
  { tabela: 'referencia_medicao_altura', campo: 'code_name' },
  { tabela: 'orbita', campo: 'code_name' },
  { tabela: 'tipo_pto_ref_geod_topo', campo: 'code_name' },
  { tabela: 'tipo_marco_limite', campo: 'code_name' },
  { tabela: 'rede_referencia', campo: 'code_name' },
  { tabela: 'referencial_grav', campo: 'code_name' },
  { tabela: 'situacao_marco', campo: 'code_name' },
  { tabela: 'insumo_medicao', campo: 'code_name' },
  { tabela: 'tipo_arquivo', campo: 'nome' }
]

/**
 * Quais domínios são COLUNA de `ponto_controle.ponto`.
 *
 * Nem todo domínio do schema vira coluna: `insumo_medicao` e `tipo_arquivo`
 * existem para outra coisa. A lista sai do BANCO, e não de uma segunda lista
 * escrita à mão, porque o dia em que o plugin acrescentar uma coluna de domínio
 * ela passa a ser resolvida sozinha.
 *
 * Vale para todos que o nome da coluna é o nome da tabela (`tipo_ref`,
 * `sistema_geodesico`, ...). Se algum dia deixar de valer, este é o lugar.
 */
const dominiosDoPonto = async connection => {
  const colunas = new Set(
    (await connection.any(
      `SELECT column_name FROM information_schema.columns
       WHERE table_schema = 'ponto_controle' AND table_name = 'ponto'`
    )).map(l => l.column_name)
  )
  return DOMINIOS.filter(d => colunas.has(d.tabela))
}

/**
 * Filtros da consulta, compartilhados pela lista, pelas facetas e pelo CSV.
 *
 * O `exceto` é o que faz a faceta funcionar: a lista de projetos aplica os
 * OUTROS filtros e nunca o próprio, senão escolher um projeto faria todos os
 * outros virarem zero e a pessoa teria de limpar antes de trocar. É o mesmo
 * desenho de `montarFiltrosBusca` no acervo.
 *
 * @param {Object} filtros
 * @param {string} [exceto] - nome do filtro a NÃO aplicar
 */
const montarFiltros = (filtros, exceto) => {
  const condicoes = []
  const valores = {}
  const usar = chave => chave !== exceto && filtros[chave]

  if (usar('lote_id')) {
    condicoes.push('p.lote_id = $<lote_id>')
    valores.lote_id = filtros.lote_id
  }
  if (usar('projeto_id')) {
    condicoes.push('l.projeto_id = $<projeto_id>')
    valores.projeto_id = filtros.projeto_id
  }
  if (usar('tipo_situacao')) {
    condicoes.push('p.tipo_situacao = $<tipo_situacao>')
    valores.tipo_situacao = filtros.tipo_situacao
  }
  if (usar('cod_ponto')) {
    condicoes.push('p.cod_ponto ILIKE $<cod_ponto>')
    valores.cod_ponto = `%${filtros.cod_ponto}%`
  }
  if (usar('bbox')) {
    const [minx, miny, maxx, maxy] = filtros.bbox.split(',').map(Number)
    condicoes.push(
      'p.geom && ST_MakeEnvelope($<minx>, $<miny>, $<maxx>, $<maxy>, 4674)'
    )
    Object.assign(valores, { minx, miny, maxx, maxy })
  }
  if (usar('ids')) {
    condicoes.push('p.id IN ($<ids:csv>)')
    valores.ids = filtros.ids
  }

  return {
    where: condicoes.length > 0 ? `WHERE ${condicoes.join(' AND ')}` : '',
    valores
  }
}

const DE = `
  FROM ponto_controle.ponto AS p
  INNER JOIN acervo.lote AS l ON l.id = p.lote_id
  INNER JOIN acervo.projeto AS pr ON pr.id = l.projeto_id`

controller.getDominios = async () => {
  const dados = {}
  for (const { tabela, campo } of DOMINIOS) {
    dados[tabela] = await db.conn.any(
      `SELECT code, ${campo} AS nome FROM ponto_controle.${tabela} ORDER BY code`
    )
  }
  return dados
}

/**
 * Opções dos filtros da tela, com o quantitativo de PONTOS de cada uma.
 *
 * Só aparece quem TEM ponto: um combo com os 86 lotes do acervo, dos quais dois
 * têm ponto de controle, faz a pessoa procurar agulha. O número entre parênteses
 * é, por construção, o total que a lista devolveria ao escolher aquela opção.
 */
controller.getFacetas = async (filtros = {}) => {
  return db.conn.task(async t => {
    const porProjeto = montarFiltros(filtros, 'projeto_id')
    const porLote = montarFiltros(filtros, 'lote_id')
    const porSituacao = montarFiltros(filtros, 'tipo_situacao')

    const projetos = await t.any(
      `SELECT pr.id AS code, pr.nome, COUNT(p.id)::int AS pontos
       ${DE} ${porProjeto.where}
       GROUP BY pr.id, pr.nome
       ORDER BY pr.nome`,
      porProjeto.valores
    )

    const lotes = await t.any(
      `SELECT l.id AS code, l.nome, l.pit, l.projeto_id,
              COUNT(p.id)::int AS pontos
       ${DE} ${porLote.where}
       GROUP BY l.id, l.nome, l.pit, l.projeto_id
       ORDER BY l.nome`,
      porLote.valores
    )

    const situacoes = await t.any(
      `SELECT s.code, s.nome, COUNT(p.id)::int AS pontos
       ${DE}
       INNER JOIN ponto_controle.tipo_situacao AS s ON s.code = p.tipo_situacao
       ${porSituacao.where}
       GROUP BY s.code, s.nome
       ORDER BY s.code`,
      porSituacao.valores
    )

    return { projetos, lotes, situacoes }
  })
}

controller.getPontos = async filtros => {
  const { where, valores } = montarFiltros(filtros)
  valores.limite = filtros.por_pagina
  valores.deslocamento = (filtros.pagina - 1) * filtros.por_pagina

  const total = await db.conn.one(
    `SELECT COUNT(*)::int AS total ${DE} ${where}`,
    valores
  )

  // O número de arquivos sai por COUNT, e não de coluna guardada no ponto. As
  // colunas `numero_fotos` e `possui_*` do plugin não atravessaram de propósito,
  // justamente para não divergirem do que existe na tabela de arquivo.
  const pontos = await db.conn.any(
    `SELECT p.id, p.cod_ponto, p.lote_id, l.nome AS lote, l.pit,
            l.projeto_id, pr.nome AS projeto,
            p.data_rastreio, p.tipo_situacao, s.nome AS tipo_situacao_nome,
            p.medidor, p.altitude_ortometrica,
            ST_X(p.geom) AS longitude, ST_Y(p.geom) AS latitude,
            (SELECT COUNT(*)::int FROM ponto_controle.arquivo AS a
              WHERE a.ponto_id = p.id) AS total_arquivos,
            (SELECT COALESCE(SUM(a.tamanho_mb), 0)::real FROM ponto_controle.arquivo AS a
              WHERE a.ponto_id = p.id) AS total_mb
     ${DE}
     LEFT JOIN ponto_controle.tipo_situacao AS s ON s.code = p.tipo_situacao
     ${where}
     ORDER BY p.cod_ponto
     LIMIT $<limite> OFFSET $<deslocamento>`,
    valores
  )

  return { total: total.total, pagina: filtros.pagina, pontos }
}

/**
 * Posição de TODOS os pontos que casam com os filtros, sem paginação.
 *
 * Rota separada da lista pela mesma razão do `busca/geometrias` do acervo: a
 * lista pagina porque ninguém lê 500 cartões, mas o mapa não pode paginar.
 * Cinquenta pontos numa tela de quinhentos afirmam visualmente que a missão tem
 * cinquenta pontos ali.
 */
controller.getPosicoes = async (filtros = {}) => {
  const { where, valores } = montarFiltros(filtros)
  const pontos = await db.conn.any(
    `SELECT p.id, p.cod_ponto, p.tipo_situacao,
            ST_X(p.geom) AS longitude, ST_Y(p.geom) AS latitude
     ${DE} ${where}
     ORDER BY p.cod_ponto`,
    valores
  )
  return { total: pontos.length, pontos }
}

controller.getPonto = async codPonto => {
  return db.conn.task(async t => {
    const dominios = await dominiosDoPonto(t)

    // Os LEFT JOIN saem da LISTA de domínios, e não escritos um a um: quinze
    // joins copiados à mão apodrecem no primeiro domínio novo.
    const juncoes = dominios
      .map(d => `LEFT JOIN ponto_controle.${d.tabela} AS d_${d.tabela}
                   ON d_${d.tabela}.code = p.${d.tabela}`)
      .join('\n     ')
    const rotulos = dominios
      .map(d => `d_${d.tabela}.${d.campo} AS ${d.tabela}_nome`)
      .join(',\n            ')

    // ATENÇÃO ao `p.*`: a tabela JÁ tem colunas `latitude` e `longitude` (REAL,
    // vindas do plugin). Chamar as derivadas da geometria pelos mesmos nomes
    // criaria duas colunas homônimas no resultado, e qual delas sobrevive passa
    // a ser detalhe do driver. Elas saem com nome PRÓPRIO, e a ficha escolhe.
    //
    // A da geometria é a boa: geometry guarda double precision, e REAL só tem
    // uns 7 dígitos significativos. Na sétima casa decimal isso já é 1 cm.
    const ponto = await t.oneOrNone(
      // Todo campo DERIVADO leva sufixo, e a razao e a mesma das coordenadas:
      // `p.*` ja traz colunas `lote` e `projeto`, que sao TEXTO LIVRE do
      // plugin (o que o medidor digitou em campo). Aliasar o JOIN com esses
      // nomes criaria colunas homonimas, e qual sobrevive seria detalhe do
      // driver. `lote_nome` e `projeto_nome` sao as entidades do acervo.
      `SELECT p.*, ST_X(p.geom) AS geom_longitude, ST_Y(p.geom) AS geom_latitude,
              l.nome AS lote_nome, l.pit, l.projeto_id, pr.nome AS projeto_nome,
              ${rotulos}
       ${DE}
       ${juncoes}
       WHERE p.cod_ponto = $<codPonto>`,
      { codPonto }
    )

    if (!ponto) {
      throw new AppError('Ponto de controle não encontrado', httpCode.NotFound)
    }

    // A geometria vai como latitude/longitude; o WKB cru não serve à tela.
    delete ponto.geom

    // O CAMINHO do arquivo no volume não sai daqui. Ele é infraestrutura, não
    // informação do ponto, e quem consulta não tem o que fazer com ele.
    ponto.arquivos = await t.any(
      `SELECT a.id, a.uuid_arquivo, a.tipo_arquivo_id, tp.nome AS tipo_arquivo,
              a.nome_arquivo, a.extensao, a.tamanho_mb, a.checksum,
              a.data_cadastramento
       FROM ponto_controle.arquivo AS a
       INNER JOIN ponto_controle.tipo_arquivo AS tp ON tp.code = a.tipo_arquivo_id
       WHERE a.ponto_id = $<id>
       ORDER BY a.tipo_arquivo_id, a.nome_arquivo`,
      { id: ponto.id }
    )

    return ponto
  })
}

/**
 * CSV do resultado, com os domínios já resolvidos em NOME.
 *
 * Exporta o conjunto INTEIRO (ou só os selecionados, via `ids`), e não a página
 * na tela: exportar 50 de 500 seria a mesma armadilha do mapa paginado.
 */
controller.getCsv = async (filtros = {}) => {
  return db.conn.task(async t => {
    const dominios = await dominiosDoPonto(t)
    const { where, valores } = montarFiltros(filtros)

    const juncoes = dominios
      .map(d => `LEFT JOIN ponto_controle.${d.tabela} AS d_${d.tabela}
                   ON d_${d.tabela}.code = p.${d.tabela}`)
      .join('\n     ')
    const rotulos = dominios
      .map(d => `d_${d.tabela}.${d.campo} AS "${d.tabela}"`)
      .join(',\n            ')

    return t.any(
      `SELECT p.cod_ponto, pr.nome AS projeto, l.nome AS lote, l.pit,
              ST_Y(p.geom) AS latitude, ST_X(p.geom) AS longitude,
              p.altitude_ortometrica, p.altitude_geometrica,
              p.norte, p.leste, p.fuso, p.meridiano_central,
              p.data_rastreio, p.inicio_rastreio, p.fim_rastreio, p.medidor,
              p.ponto_base, p.materializado, p.reserva, p.geometria_aproximada,
              p.altura_antena, p.altura_objeto, p.mascara_elevacao,
              p.taxa_gravacao, p.modelo_gps, p.numero_serie_gps,
              p.modelo_antena, p.numero_serie_antena, p.modelo_geoidal,
              p.data_processamento, p.freq_processada,
              p.precisao_horizontal_esperada, p.precisao_vertical_esperada,
              p.orgao_executante, p.engenheiro_responsavel,
              p.crea_engenheiro_responsavel,
              p.data_visita, p.valor_gravidade, p.observacao,
              ${rotulos},
              (SELECT COUNT(*)::int FROM ponto_controle.arquivo AS a
                WHERE a.ponto_id = p.id) AS total_arquivos
       ${DE}
       ${juncoes}
       ${where}
       ORDER BY p.cod_ponto`,
      valores
    )
  })
}

module.exports = controller
module.exports.DOMINIOS = DOMINIOS
