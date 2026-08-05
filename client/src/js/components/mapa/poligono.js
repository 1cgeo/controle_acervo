// Geometria e maquina de estados do desenho de area.
//
// Portado do repositorio `fotos_aereas` (src/tools/polygon-query/), para que
// desenhar area no SCA seja o MESMO gesto do portal de fotos aereas: clicar
// vertice a vertice, fechar no primeiro vertice, Enter conclui, Backspace
// desfaz, Escape cancela.
//
// Copiado em vez de importado porque sao dois repositorios independentes, sem
// pacote comum. O que veio junto foi a VALIDACAO, que e a parte que ninguem
// lembra de escrever: poligono com menos de tres vertices, vertice repetido,
// area nula e borda que se cruza. Sem ela, o PostGIS recebe geometria invalida
// e a consulta inteira falha, em vez de devolver zero.

const EPSILON = 1e-10;

function ehCoordenada(valor) {
  return Array.isArray(valor) && valor.length >= 2
    && Number.isFinite(valor[0]) && Number.isFinite(valor[1])
    && valor[0] >= -180 && valor[0] <= 180
    && valor[1] >= -90 && valor[1] <= 90;
}

function mesmoPonto(a, b) {
  return Math.abs(a[0] - b[0]) <= EPSILON && Math.abs(a[1] - b[1]) <= EPSILON;
}

function orientacao(a, b, c) {
  const valor = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0]);
  if (Math.abs(valor) <= EPSILON) return 0;
  return valor > 0 ? 1 : -1;
}

function noSegmento(a, b, ponto) {
  return ponto[0] >= Math.min(a[0], b[0]) - EPSILON
    && ponto[0] <= Math.max(a[0], b[0]) + EPSILON
    && ponto[1] >= Math.min(a[1], b[1]) - EPSILON
    && ponto[1] <= Math.max(a[1], b[1]) + EPSILON;
}

/** Dois segmentos se cruzam? */
export function segmentosSeCruzam(a, b, c, d) {
  const o1 = orientacao(a, b, c);
  const o2 = orientacao(a, b, d);
  const o3 = orientacao(c, d, a);
  const o4 = orientacao(c, d, b);
  if (o1 !== o2 && o3 !== o4) return true;
  return (o1 === 0 && noSegmento(a, b, c))
    || (o2 === 0 && noSegmento(a, b, d))
    || (o3 === 0 && noSegmento(c, d, a))
    || (o4 === 0 && noSegmento(c, d, b));
}

/** O anel se cruza em algum ponto? (o "laco" que invalida o poligono) */
export function temAutoIntersecao(vertices) {
  const n = vertices.length;
  if (n < 4) return false;
  for (let i = 0; i < n; i += 1) {
    const iProx = (i + 1) % n;
    for (let j = i + 1; j < n; j += 1) {
      const jProx = (j + 1) % n;
      if (i === j || iProx === j || jProx === i) continue;
      if (i === 0 && jProx === 0) continue;
      if (segmentosSeCruzam(vertices[i], vertices[iProx], vertices[j], vertices[jProx])) {
        return true;
      }
    }
  }
  return false;
}

/** Area com sinal: serve para detectar poligono degenerado (area zero). */
export function areaComSinal(vertices) {
  return vertices.reduce((soma, v, i) => {
    const prox = vertices[(i + 1) % vertices.length];
    return soma + v[0] * prox[1] - prox[0] * v[1];
  }, 0) / 2;
}

/** @returns {{valid:boolean, message?:string}} */
export function validarVertices(vertices) {
  if (!Array.isArray(vertices) || vertices.length < 3) {
    return { valid: false, message: 'Desenhe pelo menos três vértices.' };
  }
  if (!vertices.every(ehCoordenada)) {
    return { valid: false, message: 'O desenho tem coordenada inválida.' };
  }
  for (let i = 0; i < vertices.length; i += 1) {
    if (mesmoPonto(vertices[i], vertices[(i + 1) % vertices.length])) {
      return { valid: false, message: 'O desenho tem vértices repetidos.' };
    }
  }
  if (Math.abs(areaComSinal(vertices)) <= EPSILON) {
    return { valid: false, message: 'A área desenhada é pequena demais.' };
  }
  if (temAutoIntersecao(vertices)) {
    return { valid: false, message: 'As bordas da área não podem se cruzar.' };
  }
  return { valid: true };
}

/** O proximo vertice pode entrar sem cruzar borda ja desenhada? */
export function podeAcrescentarVertice(vertices, coordenada) {
  if (!ehCoordenada(coordenada)) return { valid: false, message: 'Coordenada inválida.' };
  if (vertices.some(v => mesmoPonto(v, coordenada))) {
    return { valid: false, message: 'Este vértice já existe.' };
  }
  if (vertices.length < 2) return { valid: true };
  const ultimo = vertices[vertices.length - 1];
  for (let i = 0; i < vertices.length - 2; i += 1) {
    if (segmentosSeCruzam(ultimo, coordenada, vertices[i], vertices[i + 1])) {
      return { valid: false, message: 'O novo segmento cruza uma borda existente.' };
    }
  }
  return { valid: true };
}

/** Vertices -> GeoJSON Polygon (anel fechado, como o PostGIS exige). */
export function paraPolygon(vertices) {
  const coordenadas = vertices.map(v => [...v]);
  if (coordenadas.length > 0) coordenadas.push([...coordenadas[0]]);
  return { type: 'Polygon', coordinates: [coordenadas] };
}

// SRID do acervo. `acervo.produto.geom` e `geometry(POLYGON, 4674)` (SIRGAS
// 2000), e o servidor grava com ST_GeomFromEWKT, que exige o prefixo SRID=.
export const SRID_ACERVO = 4674;

// Casas decimais do EWKT. Sete casas em grau valem cerca de 1 cm no equador, o
// que e ordens de grandeza melhor do que qualquer folha do acervo precisa, e
// evita que a serializacao devolva o ruido binario do double ("-50.10000000000001")
// para dentro do banco.
const CASAS = 7;

/**
 * Numero em notacao decimal simples, sem expoente e sem zero a direita.
 *
 * O corte dos zeros e feito na STRING, e nao voltando por `Number()`: para
 * coordenada proxima de zero, `Number('0.0000001').toString()` devolve "1e-7",
 * e o PostGIS nao le expoente em WKT. Como as coordenadas sao graus (presos a
 * +-180), `toFixed` nunca cai em notacao cientifica do outro lado.
 */
function numero(valor) {
  const fixo = valor.toFixed(CASAS);
  if (!fixo.includes('.')) return fixo;
  const semZeros = fixo.replace(/0+$/, '').replace(/\.$/, '');
  // `(-0.00000001).toFixed(7)` e "-0.0000000", que vira "-0" ao perder os zeros.
  return semZeros === '-0' ? '0' : semZeros;
}

/**
 * Vertices -> EWKT que o PUT/POST de produto aceita.
 *
 * O anel sai FECHADO (primeiro vertice repetido no fim), como o PostGIS exige.
 * Devolve null para geometria invalida, em vez de um EWKT que o banco recusaria
 * longe daqui: quem chama trata o null como "nao ha o que salvar".
 *
 * @param {Array<Array<number>>} vertices anel ABERTO
 * @returns {string|null}
 */
export function paraEwkt(vertices) {
  if (!validarVertices(vertices).valid) return null;
  const anel = [...vertices, vertices[0]]
    .map(v => `${numero(v[0])} ${numero(v[1])}`)
    .join(', ');
  return `SRID=${SRID_ACERVO};POLYGON((${anel}))`;
}

/**
 * EWKT (ou WKT) de POLYGON -> vertices, no anel ABERTO que o modelo usa.
 *
 * Le o que `ST_AsEWKT` devolve nas rotas de leitura (`acervo_ctrl.js:130,188`),
 * que e justamente o formato pensado para poder voltar no PUT. Aceita WKT sem o
 * prefixo SRID, porque colar geometria de outra ferramenta e caso real.
 *
 * Devolve null para qualquer coisa que nao seja um POLYGON de anel unico:
 * MULTIPOLYGON nao entra, e nao por descuido. A coluna e `geometry(POLYGON,
 * 4674)`, entao um MULTIPOLYGON e recusado pelo PostGIS na gravacao. O plugin
 * promete aceita-lo num texto de ajuda e quebra na hora de gravar; aqui a
 * recusa e imediata e diz o motivo.
 *
 * @param {string} ewkt
 * @returns {Array<Array<number>>|null} anel aberto
 */
export function deEwkt(ewkt) {
  if (typeof ewkt !== 'string') return null;

  const semSrid = ewkt.trim().replace(/^SRID=\d+\s*;\s*/i, '');
  const casa = /^POLYGON\s*\(\s*\((.+)\)\s*\)$/is.exec(semSrid);
  if (!casa) return null;
  // Anel interno (buraco) viria como um segundo par de parenteses dentro do
  // grupo capturado. O acervo nao guarda buraco, e aceitar so o contorno
  // externo em silencio seria perder area sem avisar.
  if (casa[1].includes('(')) return null;

  const vertices = [];
  for (const par of casa[1].split(',')) {
    const partes = par.trim().split(/\s+/);
    if (partes.length < 2) return null;
    const lon = Number(partes[0]);
    const lat = Number(partes[1]);
    if (!ehCoordenada([lon, lat])) return null;
    vertices.push([lon, lat]);
  }

  // O WKT chega FECHADO; o modelo trabalha com o anel aberto.
  if (vertices.length > 1 && mesmoPonto(vertices[0], vertices[vertices.length - 1])) {
    vertices.pop();
  }

  return validarVertices(vertices).valid ? vertices : null;
}

/**
 * Retangulo a partir de dois cantos opostos, para o produto FORA do
 * enquadramento SCN (escala personalizada), que nao tem folha para calcular.
 *
 * Normaliza os cantos em vez de exigir que a pessoa acerte qual e o sudoeste:
 * trocar os dois na digitacao produziria um anel de orientacao invertida, e o
 * erro so apareceria no mapa, sem mensagem.
 *
 * @returns {Array<Array<number>>|null} anel aberto, no sentido anti-horario
 */
export function retanguloDeCantos(cantoA, cantoB) {
  if (!ehCoordenada(cantoA) || !ehCoordenada(cantoB)) return null;

  const oeste = Math.min(cantoA[0], cantoB[0]);
  const leste = Math.max(cantoA[0], cantoB[0]);
  const sul = Math.min(cantoA[1], cantoB[1]);
  const norte = Math.max(cantoA[1], cantoB[1]);

  const vertices = [[oeste, sul], [leste, sul], [leste, norte], [oeste, norte]];
  return validarVertices(vertices).valid ? vertices : null;
}

/**
 * O que o mapa desenha em cada instante: a area (quando concluida), a linha em
 * andamento (com a previa que segue o cursor) e os vertices.
 *
 * Uma fonte GeoJSON so, com `kind` distinguindo as tres coisas, em vez de tres
 * fontes: menos camada para criar, remover e manter em sincronia.
 */
export function colecaoDoDesenho(vertices, previa = null, concluido = false) {
  const features = [];

  if (vertices.length >= 3 && concluido) {
    features.push({
      type: 'Feature',
      properties: { kind: 'area' },
      geometry: paraPolygon(vertices),
    });
  }

  const linha = previa && !concluido ? [...vertices, previa] : vertices;
  if (linha.length >= 2) {
    features.push({
      type: 'Feature',
      properties: { kind: 'linha' },
      geometry: { type: 'LineString', coordinates: linha.map(c => [...c]) },
    });
  }

  vertices.forEach((coordenada, indice) => {
    features.push({
      type: 'Feature',
      properties: { kind: 'vertice', indice, primeiro: indice === 0 },
      geometry: { type: 'Point', coordinates: [...coordenada] },
    });
  });

  return { type: 'FeatureCollection', features };
}

/**
 * Maquina de estados do desenho: 'pronto' -> 'desenhando' -> 'concluido',
 * com 'editando' enquanto um vertice esta sendo arrastado.
 *
 * O estado mora aqui, e nao no modulo do mapa, para poder ser testado sem
 * WebGL: o jsdom nao desenha nada, mas a regra de "pode fechar?" e a de "este
 * vertice cruza a borda?" sao justamente o que precisa de teste.
 */
export function criarModeloDesenho() {
  let estado = 'pronto';
  let vertices = [];
  let copiaEdicao = null;

  return {
    get estado() { return estado; },
    get vertices() { return vertices.map(v => [...v]); },

    acrescentar(coordenada) {
      if (estado === 'concluido' || estado === 'editando') {
        return { valid: false, message: 'Conclua a edição atual.' };
      }
      const validacao = podeAcrescentarVertice(vertices, coordenada);
      if (!validacao.valid) return validacao;
      vertices = [...vertices, [coordenada[0], coordenada[1]]];
      estado = 'desenhando';
      return { valid: true };
    },

    desfazer() {
      if (estado !== 'desenhando' || vertices.length === 0) return false;
      vertices = vertices.slice(0, -1);
      if (vertices.length === 0) estado = 'pronto';
      return true;
    },

    concluir() {
      const validacao = validarVertices(vertices);
      if (!validacao.valid) return validacao;
      estado = 'concluido';
      return { valid: true, geometria: paraPolygon(vertices) };
    },

    iniciarEdicao() {
      if (estado !== 'concluido') return false;
      copiaEdicao = vertices.map(v => [...v]);
      estado = 'editando';
      return true;
    },

    moverVertice(indice, coordenada) {
      if (estado !== 'editando' || !vertices[indice]) return false;
      vertices = vertices.map((v, i) => (i === indice ? [coordenada[0], coordenada[1]] : v));
      return true;
    },

    // Edicao que invalida a geometria e DESFEITA, nao aceita: e melhor voltar ao
    // que funcionava do que guardar um poligono que o banco vai recusar.
    confirmarEdicao() {
      if (estado !== 'editando') return { valid: false, message: 'Nenhuma edição ativa.' };
      const validacao = validarVertices(vertices);
      if (!validacao.valid) {
        vertices = copiaEdicao;
        copiaEdicao = null;
        estado = 'concluido';
        return { ...validacao, revertido: true };
      }
      copiaEdicao = null;
      estado = 'concluido';
      return { valid: true, geometria: paraPolygon(vertices) };
    },

    cancelarEdicao() {
      if (estado !== 'editando') return false;
      vertices = copiaEdicao;
      copiaEdicao = null;
      estado = 'concluido';
      return true;
    },

    // Parte de um poligono que JA EXISTE, em vez de do zero.
    //
    // E o que separa "desenhar area para filtrar a busca", que sempre comeca
    // vazio, de "editar a geometria de um produto ja cadastrado", que comeca do
    // que esta gravado. Entra direto em 'concluido': o poligono ja e valido, e
    // exigir que a pessoa reclique os vertices para poder mexer num deles seria
    // pedir que ela redesenhe o que ja existe.
    //
    // Geometria invalida e RECUSADA em vez de carregada pela metade: melhor a
    // tela dizer que nao consegue editar aquele produto do que abrir um editor
    // que vai gravar um poligino pior do que o que estava la.
    carregar(novosVertices) {
      const validacao = validarVertices(novosVertices);
      if (!validacao.valid) return validacao;
      vertices = novosVertices.map(v => [v[0], v[1]]);
      copiaEdicao = null;
      estado = 'concluido';
      return { valid: true, geometria: paraPolygon(vertices) };
    },

    limpar() {
      vertices = [];
      copiaEdicao = null;
      estado = 'pronto';
    },

    geometria() {
      return estado === 'concluido' || estado === 'editando' ? paraPolygon(vertices) : null;
    },
  };
}
