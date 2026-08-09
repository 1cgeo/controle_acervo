/**
 * A área do campo entra por ARQUIVO GeoJSON.
 *
 * ERA UM DESENHO NO MAPA até 2026-08-09, com o gesto compartilhado de
 * `components/mapa/desenho-area.js`. O chefe trocou, e a razão é o dado: a área
 * de um campo NÃO nasce na tela. Ela vem do plano de voo do drone, do polígono
 * da folha, do KML da operação -- coisas que já existem em arquivo antes de
 * alguém abrir o SCA. Redesenhar a mão o que já está desenhado é transcrever, e
 * transcrição erra.
 *
 * UM POLÍGONO SÓ, e a validação é aqui e no Joi do servidor. Foi MEDIDO antes de
 * ser decidido: dos 47 polígonos do dump de produção do SAP, os 47 têm UMA parte
 * e nenhum tem buraco. O engano típico de importação é o oposto disto -- um
 * arquivo com várias feições que alguma ferramenta colapsou num MultiPolygon --
 * e é ele que a mensagem abaixo nomeia, dizendo QUANTAS vieram.
 *
 * A VALIDAÇÃO DAQUI NÃO É A GUARDA. Quem recusa de verdade é o
 * `campo_schema.js` no servidor; isto existe para a pessoa saber o que há de
 * errado com o arquivo ANTES de preencher o resto do formulário.
 */

/** Um polígono com um anel de três vértices já é 4 pontos com o fechamento. */
const MIN_VERTICES_DO_ANEL = 4;

const coordenadaOk = (c) => Array.isArray(c) && c.length >= 2
  && Number.isFinite(c[0]) && Number.isFinite(c[1])
  && c[0] >= -180 && c[0] <= 180 && c[1] >= -90 && c[1] <= 90;

/**
 * O polígono de um GeoJSON, seja ele qual for a embalagem.
 *
 * ACEITA AS QUATRO EMBALAGENS que as ferramentas produzem, porque o arquivo vem
 * de fora e não há como pedir uma só: `FeatureCollection` (o que o QGIS exporta),
 * `Feature`, a geometria crua e o `GeometryCollection`. O que se cobra é o
 * CONTEÚDO -- um polígono --, e não a casca.
 *
 * @param {string} texto - o conteúdo do arquivo
 * @returns {{geometria:Object}|{erro:string}}
 */
export function lerGeojson(texto) {
  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { erro: 'O arquivo não é um JSON válido.' };
  }
  if (!bruto || typeof bruto !== 'object') {
    return { erro: 'O arquivo não é um GeoJSON válido.' };
  }

  // Desembrulha até chegar numa lista de geometrias.
  let geometrias;
  if (bruto.type === 'FeatureCollection') {
    if (!Array.isArray(bruto.features)) {
      return { erro: 'A FeatureCollection não tem "features".' };
    }
    geometrias = bruto.features.map(f => f && f.geometry).filter(Boolean);
  } else if (bruto.type === 'Feature') {
    geometrias = bruto.geometry ? [bruto.geometry] : [];
  } else if (bruto.type === 'GeometryCollection') {
    geometrias = Array.isArray(bruto.geometries) ? bruto.geometries : [];
  } else {
    geometrias = [bruto];
  }

  if (!geometrias.length) {
    return { erro: 'O arquivo não tem nenhuma geometria.' };
  }
  // MAIS DE UMA FEIÇÃO É RECUSA, e não "pego a primeira": pegar a primeira
  // gravaria em silêncio a área errada, e o arquivo com várias feições é
  // exatamente o engano que esta tela existe para pegar.
  if (geometrias.length > 1) {
    return {
      erro: `O arquivo tem ${geometrias.length} geometrias, e o campo precisa de UMA. `
        + 'Exporte só o polígono da área.',
    };
  }

  const geo = geometrias[0];
  if (!geo || !Array.isArray(geo.coordinates)) {
    return { erro: 'A geometria do arquivo está vazia ou malformada.' };
  }

  // Polygon e MultiPolygon de UMA parte são a mesma coisa aqui.
  let anelamento;
  if (geo.type === 'Polygon') {
    anelamento = geo.coordinates;
  } else if (geo.type === 'MultiPolygon') {
    if (geo.coordinates.length > 1) {
      return {
        erro: `A geometria tem ${geo.coordinates.length} polígonos, e o campo precisa de UM.`,
      };
    }
    anelamento = geo.coordinates[0];
  } else {
    return {
      erro: `A geometria é do tipo ${geo.type}, e o campo precisa de um polígono.`,
    };
  }

  if (!Array.isArray(anelamento) || !anelamento.length) {
    return { erro: 'O polígono do arquivo não tem anel nenhum.' };
  }

  const aneis = [];
  for (const anel of anelamento) {
    if (!Array.isArray(anel) || anel.length < MIN_VERTICES_DO_ANEL) {
      return { erro: 'Cada anel do polígono precisa de ao menos três vértices.' };
    }
    if (!anel.every(coordenadaOk)) {
      return {
        erro: 'O polígono tem coordenada inválida. O arquivo precisa estar em '
          + 'graus decimais (EPSG:4326 ou 4674), e não em metros.',
      };
    }
    const primeiro = anel[0];
    const ultimo = anel[anel.length - 1];
    // Anel aberto entra no PostGIS como geometria inválida, e o erro que ele
    // devolve não diz qual anel nem por quê.
    if (primeiro[0] !== ultimo[0] || primeiro[1] !== ultimo[1]) {
      return { erro: 'O anel do polígono não está fechado (o último vértice tem de repetir o primeiro).' };
    }
    // Só as duas primeiras ordenadas: arquivo com Z (altitude) é comum, e a
    // terceira não vai para a coluna.
    aneis.push(anel.map(c => [c[0], c[1]]));
  }

  return { geometria: { type: 'Polygon', coordinates: aneis } };
}

/** Quantos vértices e quantos anéis, para o resumo da tela. */
export function resumirGeometria(geometria) {
  if (!geometria) return null;
  const aneis = geometria.coordinates || [];
  const vertices = aneis.reduce((soma, anel) => soma + anel.length, 0);
  const buracos = Math.max(0, aneis.length - 1);
  return buracos
    ? `Área definida: ${vertices} vértices, ${buracos} ilha(s) interna(s)`
    : `Área definida: ${vertices} vértices`;
}
