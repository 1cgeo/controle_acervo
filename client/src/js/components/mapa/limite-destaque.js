/**
 * Destaque do LUGAR filtrado: o contorno do estado ou do municipio escolhido
 * nos filtros, em vermelho, e o zoom nele.
 *
 * Sem ele o filtro por lugar e invisivel no mapa: a lista muda, a camera fica
 * onde estava, e o resultado parece ter encolhido sem motivo.
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

  function colecao(geometrias) {
    const features = (geometrias || [])
      .filter(Boolean)
      .map(geometry => ({ type: 'Feature', properties: {}, geometry }));
    if (!features.length) return VAZIO;
    return { type: 'FeatureCollection', features };
  }

  function pintar(geometrias) {
    const fonte = mapa && mapa.getSource(FONTE);
    if (fonte) fonte.setData(colecao(geometrias));
  }

  /**
   * Caixa que cobre TODOS os limites destacados.
   *
   * Com marcacao multipla, escolher dois estados tem de enquadrar os dois:
   * enquadrar so o primeiro deixa o outro fora da tela, dizendo que o recorte e
   * menor do que e.
   */
  function caixaDaUniao(bboxes) {
    const validas = (bboxes || []).filter(b => Array.isArray(b) && b.length === 4);
    if (!validas.length) return null;
    return validas.reduce((uniao, b) => [
      Math.min(uniao[0], b[0]),
      Math.min(uniao[1], b[1]),
      Math.max(uniao[2], b[2]),
      Math.max(uniao[3], b[3]),
    ]);
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
   * Aceita UM limite ou uma LISTA deles, porque o filtro por lugar marca varios
   * estados ou municipios. Com lista, a camera enquadra a uniao das caixas, e
   * nao a do primeiro.
   *
   * @param {Object|Array<Object>} limite - resposta de /api/limites/<tipo>/<id>,
   *   no formato {geometria, bbox}, ou um array delas
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.enquadrar=true] - false quando a camera ja esta
   *   onde a pessoa quer (area desenhada, link com recorte proprio)
   */
  function mostrar(limite, { enquadrar = true } = {}) {
    const limites = (Array.isArray(limite) ? limite : [limite]).filter(l => l && l.geometria);
    if (!limites.length) return;
    if (!montado) {
      pendente = { limite: limites, enquadrar };
      return;
    }
    pintar(limites.map(l => l.geometria));
    if (enquadrar) enquadrarCaixa(caixaDaUniao(limites.map(l => l.bbox)));
  }

  /** Apaga o contorno. Nao mexe na camera: tirar o filtro nao e pedir zoom. */
  function limpar() {
    pendente = null;
    if (montado) pintar(null);
  }

  return { montar, mostrar, limpar, montado: () => montado };
}
