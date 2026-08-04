'use strict'


const { caminhoNoVolume } = require('../utils/caminho_volume');
const { db } = require('../database')
const { AppError, httpCode } = require('../utils')
const { temValor } = require('../utils/lista_schema')

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
  // `temValor` e nao a verdade do JavaScript: os filtros de dominio chegam como
  // ARRAY desde 2026-08-04, e array vazio e verdadeiro. Sem isto, desmarcar a
  // ultima opcao montaria `IN ()` e derrubaria a consulta.
  const usar = chave => chave !== exceto && temValor(filtros[chave])

  // `IN` e nao `=`: marcar dois lotes pergunta por um OU o outro. O cruzamento
  // ENTRE filtros continua sendo E, que e o que a faceta ja contava.
  if (usar('lote_id')) {
    condicoes.push('p.lote_id IN ($<lote_id:csv>)')
    valores.lote_id = filtros.lote_id
  }
  if (usar('projeto_id')) {
    condicoes.push('l.projeto_id IN ($<projeto_id:csv>)')
    valores.projeto_id = filtros.projeto_id
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
  // Área DESENHADA no mapa (chefe, 2026-07-29). O `&&` usa o índice GIST e o
  // `ST_Intersects` decide de verdade; sozinho, o `&&` compararia retângulos
  // envolventes e traria ponto de fora do desenho. O `ST_MakeValid` é cinto de
  // segurança: o desenho da tela já barra autointerseção, mas geometria inválida
  // vinda por URL derrubaria a consulta inteira em vez de devolver zero.
  if (usar('geometria')) {
    condicoes.push(`(
      p.geom && ST_SetSRID(ST_GeomFromGeoJSON($<geometria>), 4674)
      AND ST_Intersects(p.geom, ST_MakeValid(ST_SetSRID(ST_GeomFromGeoJSON($<geometria>), 4674)))
    )`)
    valores.geometria = filtros.geometria
  }
  if (usar('ids')) {
    condicoes.push('p.id IN ($<ids:csv>)')
    valores.ids = filtros.ids
  }
  // Filtro por LUGAR (chefe, 2026-07-29). Recorte espacial contra `limites`, e
  // nao coluna do ponto: o ponto tem geometria, e guardar o municipio nela seria
  // duas versoes da mesma verdade, que divergem quando a malha muda. Medido em
  // producao com os 3.490 pontos: 19 ms por municipio e 11 ms por estado.
  if (usar('municipio_id')) {
    condicoes.push(`EXISTS (
      SELECT 1 FROM limites.municipio AS mu
      WHERE mu.id IN ($<municipio_id:csv>) AND ST_Intersects(p.geom, mu.geom)
    )`)
    valores.municipio_id = filtros.municipio_id
  }
  if (usar('estado_id')) {
    condicoes.push(`EXISTS (
      SELECT 1 FROM limites.estado AS es
      WHERE es.id IN ($<estado_id:csv>) AND ST_Intersects(p.geom, es.geom)
    )`)
    valores.estado_id = filtros.estado_id
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

    // Lugar. Mesma regra das outras listas: so quem TEM ponto, com o
    // quantitativo, e cada uma aplicando os outros filtros e nunca o proprio.
    const porEstado = montarFiltros(filtros, 'estado_id')
    const porMunicipio = montarFiltros(filtros, 'municipio_id')

    const estados = await t.any(
      `SELECT es.id AS code, es.sigla, es.nome, COUNT(p.id)::int AS pontos
       ${DE}
       INNER JOIN limites.estado AS es ON ST_Intersects(p.geom, es.geom)
       ${porEstado.where}
       GROUP BY es.id, es.sigla, es.nome
       ORDER BY es.nome`,
      porEstado.valores
    )

    // O municipio so vem quando ha ESTADO marcado: sem isso a lista traria os
    // 204 municipios com ponto espalhados pelo pais, e escolher fica pior do que
    // digitar. Com mais de um estado marcado, a lista e a UNIAO dos municipios
    // deles.
    const municipios = temValor(filtros.estado_id)
      ? await t.any(
        `SELECT mu.id AS code, mu.nome, COUNT(p.id)::int AS pontos
         ${DE}
         INNER JOIN limites.municipio AS mu ON ST_Intersects(p.geom, mu.geom)
         ${porMunicipio.where}
           ${porMunicipio.where ? 'AND' : 'WHERE'} mu.estado_id IN ($<estado_da_lista:csv>)
         GROUP BY mu.id, mu.nome
         ORDER BY mu.nome`,
        { ...porMunicipio.valores, estado_da_lista: filtros.estado_id }
      )
      : []

    return { projetos, lotes, estados, municipios }
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

/**
 * O arquivo de um ponto, para DOWNLOAD.
 *
 * Devolve o caminho no volume e o nome com que ele deve chegar a quem baixa. A
 * rota é que faz o streaming; aqui fica a regra.
 *
 * São dois por ponto (`ponto_controle.tipo_arquivo`): o PACOTE e a MONOGRAFIA.
 * O tipo entra pelo código, e não por texto livre, porque quem chama é a tela e
 * o contrato é o domínio.
 *
 * Diferente do acervo, isto ENTREGA OS BYTES em vez de devolver um caminho de
 * rede. O acervo pode devolver caminho porque quem baixa é o plugin QGIS, que
 * enxerga o share; a tela do navegador não enxerga, e um caminho `\host\...`
 * numa página web não serve para nada.
 *
 * @param {string} codPonto
 * @param {number} tipoArquivoId
 */
controller.getArquivoParaDownload = async (codPonto, tipoArquivoId) => {
  const arquivo = await db.conn.oneOrNone(
    `SELECT a.nome_arquivo, a.extensao, a.tamanho_mb, a.checksum,
            tp.nome AS tipo_arquivo,
            v.volume, p.cod_ponto
     FROM ponto_controle.arquivo AS a
     INNER JOIN ponto_controle.ponto AS p ON p.id = a.ponto_id
     INNER JOIN ponto_controle.tipo_arquivo AS tp ON tp.code = a.tipo_arquivo_id
     INNER JOIN acervo.volume_armazenamento AS v
       ON v.id = a.volume_armazenamento_id
     WHERE p.cod_ponto = $<codPonto> AND a.tipo_arquivo_id = $<tipoArquivoId>`,
    { codPonto, tipoArquivoId }
  )

  if (!arquivo) {
    throw new AppError(
      `O ponto ${codPonto} não tem arquivo do tipo ${tipoArquivoId}`,
      httpCode.NotFound
    )
  }

  const nome = arquivo.extensao
    ? `${arquivo.nome_arquivo}.${arquivo.extensao}`
    : arquivo.nome_arquivo

  return {
    // O caminho é montado como o upload o montou: volume + cod_ponto + nome.
    caminho: caminhoNoVolume(arquivo.volume, arquivo.cod_ponto, nome),
    nome,
    tamanho_mb: arquivo.tamanho_mb,
    checksum: arquivo.checksum,
    tipo_arquivo: arquivo.tipo_arquivo
  }
}

/** Teto do código: o padrão do SCA aceita até quatro dígitos. */
const MAIOR_NUMERO = 9999

/**
 * Códigos de ponto ainda livres, por UF e tipo.
 *
 * Era o P14 do plugin (`verificarcodigos`), e mudou de lado em 2026-07-29 por um
 * motivo de CORRETUDE, não de conveniência: lá a resposta saía da camada da
 * missão ABERTA no QGIS, que conhece só os pontos daquela missão. Ela declarava
 * livre o código que outra missão já tinha usado, e o erro só aparecia na
 * importação, depois da medição em campo. Aqui a base é o acervo INTEIRO.
 *
 * Devolve duas listas, e a diferença importa:
 *  - `buracos`: números que ficaram para trás, abaixo do maior já usado. São os
 *    que fecham lacuna, e por isso vêm primeiro.
 *  - `proximos`: a sequência depois do maior. É de onde sai a numeração de uma
 *    missão nova.
 *
 * Sem `uf`, devolve o RESUMO por grupo, que é o mapa de onde há folga.
 */
controller.getCodigosDisponiveis = async ({ uf, tipo, quantidade = 50 }) => {
  const grupos = await db.conn.any(
    `SELECT split_part(cod_ponto, '-', 1) AS uf,
            split_part(cod_ponto, '-', 2) AS tipo,
            COUNT(*)::int AS usados,
            MAX(split_part(cod_ponto, '-', 3)::int) AS maior_usado
       FROM ponto_controle.ponto
      GROUP BY 1, 2
      ORDER BY 1, 2`
  )

  if (!uf) return { grupos }

  const grupo = grupos.find(g => g.uf === uf && g.tipo === tipo)
  const maiorUsado = grupo ? grupo.maior_usado : 0

  // A lacuna sai por diferença de conjunto contra a série inteira, e não
  // varrendo em JavaScript: o maior grupo tem 4.019 números e o Postgres resolve
  // isso num passo. `quantidade` limita a RESPOSTA, nunca a busca, senão a lista
  // deixaria de fora justamente os menores.
  const buracos = maiorUsado > 0
    ? await db.conn.any(
      `SELECT n FROM generate_series(1, $<maiorUsado>) AS n
        WHERE NOT EXISTS (
          SELECT 1 FROM ponto_controle.ponto
           WHERE split_part(cod_ponto, '-', 1) = $<uf>
             AND split_part(cod_ponto, '-', 2) = $<tipo>
             AND split_part(cod_ponto, '-', 3)::int = n
        )
        ORDER BY n
        LIMIT $<quantidade>`,
      { maiorUsado, uf, tipo, quantidade }
    )
    : []

  const proximos = []
  for (let n = maiorUsado + 1; n <= MAIOR_NUMERO && proximos.length < quantidade; n += 1) {
    proximos.push(n)
  }

  const codigo = n => `${uf}-${tipo}-${n}`
  return {
    uf,
    tipo,
    usados: grupo ? grupo.usados : 0,
    maior_usado: maiorUsado,
    // O total de lacunas, e não quantas couberam na resposta: é o número que
    // diz se vale a pena preencher antes de seguir adiante.
    total_buracos: maiorUsado - (grupo ? grupo.usados : 0),
    buracos: buracos.map(b => codigo(b.n)),
    proximos: proximos.map(codigo),
    grupos
  }
}

module.exports = controller
module.exports.DOMINIOS = DOMINIOS
