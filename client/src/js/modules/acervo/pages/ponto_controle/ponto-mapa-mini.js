import { el } from '@utils/dom.js';
import { ESTILO_OSM, carregarMapLibre } from '@components/mapa/base.js';

/**
 * O mapinha da ficha do ponto de controle.
 *
 * POR QUE ELE EXISTE. Um ponto de controle E um lugar. A ficha mostrava latitude
 * e longitude com oito casas decimais e nada mais: para saber ONDE o ponto fica,
 * era preciso copiar o par e colar noutro programa. O mapa responde essa
 * pergunta de relance, e e o equivalente, aqui, da miniatura da carta na ficha
 * do acervo.
 *
 * ELE NAO CUSTA DOWNLOAD EXTRA. O `maplibre-gl` pesa cerca de 1 MB e por isso
 * entra por `import()` dinamico (decisao do chefe, 2026-07-25). A ficha do ponto
 * so abre a partir da tela de pontos, que JA tem o mapa da lista carregado,
 * entao aqui o modulo vem do cache.
 *
 * SEM INTERNET o fundo nao desenha e o marcador continua aparecendo, porque a
 * coordenada vem da nossa API. E o mesmo comportamento dos outros mapas.
 */

// Zoom de partida: perto o bastante para ver a quadra, longe o bastante para a
// pessoa se situar. Um ponto de apoio nao se confere pelo telhado.
const ZOOM = 15;

/**
 * @param {number} lat
 * @param {number} lon
 * @returns {{elemento: HTMLElement, destruir: Function}}
 */
export function criarMapaDoPonto(lat, lon) {
  const elemento = el('div', { className: 'pc-mapa-mini' });

  if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
    elemento.classList.add('pc-mapa-mini--vazio');
    elemento.textContent = 'Sem coordenada';
    return { elemento, destruir: () => {} };
  }

  let mapa = null;
  let descartado = false;

  carregarMapLibre().then((maplibregl) => {
    // Descartado enquanto o modulo carregava: nao adianta montar um mapa num
    // elemento que ja saiu da tela.
    if (descartado) return;

    if (!maplibregl) {
      elemento.classList.add('pc-mapa-mini--vazio');
      elemento.textContent = 'Mapa indisponível';
      return;
    }

    mapa = new maplibregl.Map({
      container: elemento,
      style: ESTILO_OSM,
      center: [lon, lat],
      zoom: ZOOM,
      // A ficha rola; sem isto, rolar por cima do mapa daria zoom em vez de
      // rolar a pagina, e a pessoa perderia o lugar da leitura.
      scrollZoom: false,
      attributionControl: false,
    });

    mapa.addControl(new maplibregl.NavigationControl({ showCompass: false }), 'top-right');

    // Marcador simples, sem balao: o que ele diria ja esta escrito ao lado.
    new maplibregl.Marker({ color: '#d32f2f' }).setLngLat([lon, lat]).addTo(mapa);
  });

  return {
    elemento,
    destruir: () => {
      descartado = true;
      if (mapa) {
        mapa.remove();
        mapa = null;
      }
    },
  };
}
