// Dublê do 'maplibre-gl' para os testes (vitest + jsdom).
//
// POR QUE: o MapLibre precisa de WebGL, que o jsdom nao tem. Sem dublê, toda
// tela com mapa cairia no caminho de erro ("não foi possível desenhar o mapa"),
// e o teste passaria sem nunca ter conferido as feições que foram para o mapa.
//
// COMO USAR, no topo do arquivo de teste:
//   vi.mock('maplibre-gl', async () => await import('@components/mapa/maplibre-stub.js'));
//
// O dublê guarda as fontes e as camadas, entao o teste pode conferir o GeoJSON
// que a pagina mandou desenhar sem desenhar nada.

/** Instancias vivas, na ordem de criacao. */
export const instanciasMapa = [];

class Fonte {
  constructor(dados) {
    this.dados = dados;
  }

  setData(dados) {
    this.dados = dados;
  }
}

export class Map {
  constructor(opcoes) {
    this.opcoes = opcoes;
    this.fontes = {};
    this.camadas = {};
    this.estados = {};
    this.ouvintes = {};
    this.enquadramentos = [];
    this.removido = false;
    // Gestos que o mapa da busca liga e desliga durante o desenho de area.
    this.dragPan = { enable: () => {}, disable: () => {} };
    this.doubleClickZoom = {
      isEnabled: () => true, enable: () => {}, disable: () => {},
    };
    instanciasMapa.push(this);
    // O 'load' do MapLibre e assincrono. Aqui ele dispara no proximo tique, que
    // e o que faz o teste precisar de um `flush` e nao de um `await` mentiroso.
    setTimeout(() => this.emitir('load'), 0);
  }

  on(evento, camadaOuHandler, talvezHandler) {
    const handler = talvezHandler || camadaOuHandler;
    (this.ouvintes[evento] = this.ouvintes[evento] || []).push(handler);
  }

  emitir(evento, payload) {
    for (const handler of this.ouvintes[evento] || []) handler(payload);
  }

  addControl() {}

  addSource(id, config) {
    this.fontes[id] = new Fonte(config && config.data);
  }

  getSource(id) {
    return this.fontes[id];
  }

  addLayer(config) {
    this.camadas[config.id] = config;
  }

  setFeatureState({ source, id }, estado) {
    this.estados[`${source}:${id}`] = { ...(this.estados[`${source}:${id}`] || {}), ...estado };
  }

  fitBounds(bounds, opcoes) {
    this.enquadramentos.push({ bounds, opcoes });
  }

  getBounds() {
    return {
      getWest: () => -74, getSouth: () => -34, getEast: () => -34, getNorth: () => 6,
    };
  }

  getCanvas() {
    return { style: {} };
  }

  resize() {}

  project() {
    return { x: 0, y: 0 };
  }

  remove() {
    this.removido = true;
    const i = instanciasMapa.indexOf(this);
    if (i >= 0) instanciasMapa.splice(i, 1);
  }
}

export class NavigationControl {}
export class ScaleControl {}

export class Popup {
  constructor(opcoes) {
    this.opcoes = opcoes;
    this.aberto = false;
  }

  setLngLat(lngLat) { this.lngLat = lngLat; return this; }

  setDOMContent(node) { this.conteudo = node; return this; }

  addTo(mapa) { this.mapa = mapa; this.aberto = true; return this; }

  remove() { this.aberto = false; return this; }
}

export default { Map, NavigationControl, ScaleControl, Popup };
