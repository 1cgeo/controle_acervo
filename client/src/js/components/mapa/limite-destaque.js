/**
 * Destaque do LUGAR filtrado: o contorno do estado ou do municipio escolhido
 * nos filtros, em vermelho, e o zoom nele (chefe, 2026-07-29).
 *
 * Existe porque o filtro por lugar era invisivel no mapa. Escolher "Rio Grande
 * do Sul" mudava a lista e deixava a camera onde estava, entao a tela nao dizia
 * ONDE o recorte caiu, e o resultado parecia ter encolhido sem motivo.
 *
 * So a BORDA, e sem preenchimento: o que interessa aqui e o produto e o ponto,
 * e uma mancha por cima competiria com eles. A cor e a unica do mapa que nao
 * significa dado: azul e o produto, verde e o ponto, laranja e a area desenhada.
 *
 * Modulo compartilhado pela busca do acervo e pelo ponto de controle, como o
 * desenho de area: o gesto e o mesmo nas duas telas, e ele se aprende uma vez.
 */

const FONTE = 'limite-destaque';
const CAMADA = 'limite-destaque-contorno';

/** Vermelho. Nenhuma outra camada do mapa o usa, entao ele nao ambiguiza nada. */
const COR = '#d32f2f';

const VAZIO = { type: 'FeatureCollection', features: [] };

/**
 * @returns {{montar:Function, mostrar:Function, limpar:Function, montado:Function}}
 */
export function criarDestaqueDeLimite() {
  let mapa = null;
  let montado = false;
  /**
   * O que mostrar assim que o mapa terminar de carregar.
   *
   * A geometria vem da API, e a resposta pode chegar ANTES do evento `load`:
   * sem esta espera, o destaque do lugar que veio no link se perderia em
   * silencio, justamente no caso em que a pessoa abriu um link ja filtrado.
   */
  let pendente = null;

  function colecao(geometria) {
    if (!geometria) return VAZIO;
    return {
      type: 'FeatureCollection',
      features: [{ type: 'Feature', properties: {}, geometry: geometria }],
    };
  }

  function pintar(geometria) {
    const fonte = mapa && mapa.getSource(FONTE);
    if (fonte) fonte.setData(colecao(geometria));
  }

  function enquadrarCaixa(bbox) {
    if (!mapa || !Array.isArray(bbox) || bbox.length !== 4) return;
    // `duration: 0` de proposito: o voo animado sobre meio pais leva quase um
    // segundo, e nesse tempo o resultado ja mudou embaixo. Salto seco.
    mapa.fitBounds([[bbox[0], bbox[1]], [bbox[2], bbox[3]]], {
      padding: 40,
      duration: 0,
    });
  }

  /**
   * Liga o destaque a um mapa JA carregado. Chame DENTRO do `load`.
   *
   * A ordem importa: chame depois das camadas de dado (produto, ponto) e antes
   * do desenho de area. O contorno tem de ficar sobre o dado, para nao sumir
   * debaixo de uma carta, e sob a area desenhada, que e o gesto em curso.
   *
   * @param {Object} instancia - o mapa do MapLibre
   */
  function montar(instancia) {
    mapa = instancia;
    mapa.addSource(FONTE, { type: 'geojson', data: VAZIO });
    mapa.addLayer({
      id: CAMADA,
      type: 'line',
      source: FONTE,
      layout: { 'line-join': 'round', 'line-cap': 'round' },
      paint: {
        'line-color': COR,
        // Mais grossa de perto: a mesma espessura que se le bem no Brasil
        // inteiro vira um traco fino demais quando o municipio ocupa a tela.
        'line-width': ['interpolate', ['linear'], ['zoom'], 4, 1.8, 10, 3],
        'line-opacity': 0.95,
      },
    });
    montado = true;

    if (pendente) {
      const { limite, enquadrar } = pendente;
      pendente = null;
      mostrar(limite, { enquadrar });
    }
  }

  /**
   * Desenha o contorno e, por padrao, leva a camera ate ele.
   *
   * @param {{geometria:Object, bbox:Array<number>}} limite - resposta de
   *   /api/limites/<tipo>/<id>
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.enquadrar=true] - false quando a camera ja esta
   *   onde a pessoa quer (area desenhada, link com recorte proprio)
   */
  function mostrar(limite, { enquadrar = true } = {}) {
    if (!limite || !limite.geometria) return;
    if (!montado) {
      pendente = { limite, enquadrar };
      return;
    }
    pintar(limite.geometria);
    if (enquadrar) enquadrarCaixa(limite.bbox);
  }

  /** Apaga o contorno. Nao mexe na camera: tirar o filtro nao e pedir zoom. */
  function limpar() {
    pendente = null;
    if (montado) pintar(null);
  }

  return { montar, mostrar, limpar, montado: () => montado };
}
