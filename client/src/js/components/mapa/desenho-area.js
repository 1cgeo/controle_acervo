import { el, svgIcon, ICONS } from '@utils/dom.js';
import { criarModeloDesenho, colecaoDoDesenho } from './poligono.js';

/**
 * Desenho de área sobre um mapa MapLibre: o botão, os controles e a ligação.
 *
 * Saiu do mapa da busca do acervo em 2026-07-29, quando a tela de ponto de
 * controle pediu a mesma ferramenta. Duplicar as duzentas linhas faria as duas
 * telas desenharem área com gestos que divergem no dia em que uma delas mudar,
 * e o gesto é a parte que a pessoa aprende UMA vez.
 *
 * O módulo não sabe o que há no mapa: ele recebe o mapa pronto, acrescenta a
 * fonte e as camadas do desenho, e avisa por callback quando a área fecha ou é
 * removida. Quem chama decide o que fazer com o polígono.
 *
 * Uso:
 *   const desenho = criarDesenhoDeArea({ onAreaDesenhada, onAreaCancelada });
 *   // no layout: desenho.botao e desenho.controles
 *   mapa.on('load', () => desenho.montar(mapa));
 *   // nos handlers do mapa: if (desenho.ocupado()) return;
 */

const FONTE = 'desenho';
/** Distância em pixels para o clique "fechar no primeiro vértice". */
const RAIO_FECHAMENTO = 12;
/** Laranja do desenho, distinto da cor de qualquer dado no mapa. */
const COR = '#ed6c02';

/**
 * @param {Object} opts
 * @param {(geometria:Object)=>void} opts.onAreaDesenhada - polígono concluído
 * @param {()=>void} [opts.onAreaCancelada] - área que VALIA foi removida
 * @returns {Object} controle do desenho
 */
export function criarDesenhoDeArea({ onAreaDesenhada, onAreaCancelada }) {
  const modelo = criarModeloDesenho();

  let mapa = null;
  let montado = false;
  let desenhando = false;
  let previa = null;
  let quadro = null;
  let verticeArrastado = null;

  const botao = el('button', {
    className: 'btn btn--secondary btn--sm busca-mapa__btn',
    type: 'button',
    title: 'Desenhar uma área para filtrar o resultado',
    onClick: () => (desenhando ? cancelar() : ativar()),
  }, [svgIcon(ICONS.layers, 16), 'Desenhar área']);

  // O texto é `aria-live` porque a validação ("as bordas não podem se cruzar")
  // precisa chegar a quem usa leitor de tela.
  const estado = el('p', {
    className: 'desenho-controles__estado',
    'aria-live': 'polite',
  });

  const btnDesfazer = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => { modelo.desfazer(); previa = null; pintar(); },
  }, ['Desfazer vértice']);

  const btnConcluir = el('button', {
    className: 'btn btn--primary btn--sm',
    type: 'button',
    onClick: () => concluir(),
  }, ['Concluir área']);

  const btnCancelar = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    onClick: () => cancelar(),
  }, ['Cancelar']);

  const controles = el('div', {
    className: 'desenho-controles hidden',
    role: 'group',
    'aria-label': 'Controles do desenho de área',
  }, [estado, el('div', { className: 'desenho-controles__botoes' }, [
    btnDesfazer, btnConcluir, btnCancelar,
  ])]);

  // ---------------------------------------------------------------------------
  // Montagem sobre o mapa
  // ---------------------------------------------------------------------------
  /**
   * Acrescenta a fonte, as camadas e os gestos. Chame DENTRO do `load` do mapa:
   * antes disso o estilo ainda não existe e o `addSource` falha.
   * @param {Object} instancia - o mapa MapLibre
   */
  function montar(instancia) {
    mapa = instancia;

    mapa.addSource(FONTE, { type: 'geojson', data: colecaoDoDesenho([]) });
    mapa.addLayer({
      id: 'desenho-area',
      type: 'fill',
      source: FONTE,
      filter: ['==', ['get', 'kind'], 'area'],
      paint: { 'fill-color': COR, 'fill-opacity': 0.12 },
    });
    mapa.addLayer({
      id: 'desenho-linha',
      type: 'line',
      source: FONTE,
      filter: ['in', ['get', 'kind'], ['literal', ['area', 'linha']]],
      paint: { 'line-color': COR, 'line-width': 2, 'line-dasharray': [2, 1] },
    });
    mapa.addLayer({
      id: 'desenho-vertices',
      type: 'circle',
      source: FONTE,
      filter: ['==', ['get', 'kind'], 'vertice'],
      paint: {
        // O primeiro vértice é maior e colorido: é o alvo de "clique aqui para
        // fechar a área", e precisa se distinguir dos demais.
        'circle-radius': ['case', ['get', 'primeiro'], 7, 5],
        'circle-color': ['case', ['get', 'primeiro'], '#d32f2f', '#ffffff'],
        'circle-stroke-color': COR,
        'circle-stroke-width': 2,
      },
    });

    mapa.on('click', (evento) => { if (desenhando) clique(evento); });
    mapa.on('mousemove', (evento) => mover(evento));
    mapa.on('mouseup', () => soltarVertice());
    mapa.on('mousedown', 'desenho-vertices', (evento) => pegarVertice(evento));

    montado = true;
    // Área que veio pela URL foi montada no modelo antes do mapa existir.
    pintar();
  }

  // ---------------------------------------------------------------------------
  // Desenho
  // ---------------------------------------------------------------------------
  function coordenadaDe(evento) {
    const { lng, lat } = evento.lngLat || {};
    return Number.isFinite(lng) && Number.isFinite(lat) ? [lng, lat] : null;
  }

  function pintar(mensagem = '') {
    const concluido = modelo.estado === 'concluido' || modelo.estado === 'editando';
    if (montado) {
      mapa.getSource(FONTE).setData(colecaoDoDesenho(modelo.vertices, previa, concluido));
    }

    const total = modelo.vertices.length;
    btnDesfazer.disabled = modelo.estado !== 'desenhando' || total === 0;
    btnConcluir.disabled = modelo.estado !== 'desenhando' || total < 3;
    btnDesfazer.classList.toggle('hidden', concluido);
    btnConcluir.classList.toggle('hidden', concluido);
    btnCancelar.textContent = concluido ? 'Remover área' : 'Cancelar';

    estado.textContent = mensagem || (concluido
      ? 'Área concluída. Arraste os vértices para ajustar.'
      : total === 0
        ? 'Clique no mapa para marcar o primeiro vértice.'
        : `${total} vértice(s). Clique no primeiro para fechar, ou tecle Enter.`);
  }

  function ativar() {
    desenhando = true;
    modelo.limpar();
    previa = null;
    botao.classList.replace('btn--secondary', 'btn--primary');
    controles.classList.remove('hidden');
    if (mapa) {
      mapa.getCanvas().style.cursor = 'crosshair';
      if (mapa.doubleClickZoom.isEnabled()) mapa.doubleClickZoom.disable();
    }
    pintar();
  }

  function desativar() {
    desenhando = false;
    previa = null;
    botao.classList.replace('btn--primary', 'btn--secondary');
    controles.classList.add('hidden');
    if (mapa) {
      mapa.getCanvas().style.cursor = '';
      mapa.doubleClickZoom.enable();
    }
  }

  function cancelar() {
    const tinhaArea = modelo.estado === 'concluido';
    modelo.limpar();
    desativar();
    pintar();
    // Só avisa quem chamou quando havia área VALENDO: cancelar um desenho pela
    // metade não deve refazer a consulta.
    if (tinhaArea && onAreaCancelada) onAreaCancelada();
  }

  function concluir() {
    const r = modelo.concluir();
    if (!r.valid) {
      pintar(r.message);
      return false;
    }
    previa = null;
    desativar();
    // Os controles seguem visíveis com a área concluída, para dar o "Remover".
    controles.classList.remove('hidden');
    pintar();
    if (onAreaDesenhada) onAreaDesenhada(r.geometria);
    return true;
  }

  function clique(evento) {
    if (modelo.estado === 'editando') return;
    const coordenada = coordenadaDe(evento);
    if (!coordenada) return;

    // Área já concluída: o clique começa OUTRA, em vez de não fazer nada.
    if (modelo.estado === 'concluido') {
      modelo.limpar();
      modelo.acrescentar(coordenada);
      previa = null;
      pintar();
      return;
    }

    // Perto do primeiro vértice: fecha.
    if (modelo.vertices.length >= 3) {
      const primeiro = mapa.project(modelo.vertices[0]);
      const distancia = Math.hypot(evento.point.x - primeiro.x, evento.point.y - primeiro.y);
      if (distancia <= RAIO_FECHAMENTO) {
        concluir();
        return;
      }
    }

    const r = modelo.acrescentar(coordenada);
    previa = null;
    pintar(r.valid ? '' : r.message);
  }

  function mover(evento) {
    if (verticeArrastado !== null) {
      const coordenada = coordenadaDe(evento);
      if (coordenada) {
        modelo.moverVertice(verticeArrastado, coordenada);
        pintar('Solte para validar a nova área.');
      }
      return;
    }
    if (!desenhando || modelo.estado !== 'desenhando') return;
    previa = coordenadaDe(evento);
    // Uma repintura por quadro: sem isto o mousemove redesenha a fonte dezenas
    // de vezes por segundo e o mapa engasga.
    if (quadro !== null) return;
    quadro = requestAnimationFrame(() => { quadro = null; pintar(); });
  }

  function pegarVertice(evento) {
    const indice = Number(evento.features?.[0]?.properties?.indice);
    if (!Number.isInteger(indice) || !modelo.vertices[indice]) return;
    evento.preventDefault();
    if (!modelo.iniciarEdicao()) return;
    verticeArrastado = indice;
    mapa.dragPan.disable();
    mapa.getCanvas().style.cursor = 'grabbing';
  }

  function soltarVertice() {
    if (verticeArrastado === null) return;
    const r = modelo.confirmarEdicao();
    verticeArrastado = null;
    mapa.dragPan.enable();
    mapa.getCanvas().style.cursor = '';
    if (r.valid) {
      pintar();
      if (onAreaDesenhada) onAreaDesenhada(r.geometria);
    } else {
      pintar(`${r.message} A alteração foi desfeita.`);
    }
  }

  // ---------------------------------------------------------------------------
  // API
  // ---------------------------------------------------------------------------
  /**
   * Teclado do desenho. A página repassa o keydown do documento, porque o foco
   * costuma estar num campo de filtro quando a pessoa desenha.
   * @returns {boolean} true quando a tecla foi tratada aqui
   */
  function tratarTecla(evento) {
    if (!desenhando && modelo.estado !== 'editando') return false;
    if (evento.key === 'Backspace' && modelo.estado === 'desenhando') {
      evento.preventDefault();
      modelo.desfazer();
      previa = null;
      pintar();
      return true;
    }
    if (evento.key === 'Enter' && modelo.estado === 'desenhando') {
      evento.preventDefault();
      concluir();
      return true;
    }
    if (evento.key === 'Escape') {
      evento.preventDefault();
      if (modelo.estado === 'editando') {
        modelo.cancelarEdicao();
        verticeArrastado = null;
        if (mapa) mapa.dragPan.enable();
        pintar('Edição cancelada.');
      } else {
        cancelar();
      }
      return true;
    }
    return false;
  }

  /** Restaura uma área que veio pela URL, para ela ficar visível no mapa. */
  function mostrarArea(geometria) {
    if (!geometria || !geometria.coordinates) return;
    const anel = geometria.coordinates[0] || [];
    // Sem o último ponto: o modelo fecha o anel sozinho.
    const vertices = anel.slice(0, -1);
    modelo.limpar();
    for (const v of vertices) modelo.acrescentar(v);
    modelo.concluir();
    controles.classList.remove('hidden');
    pintar();
  }

  function limparArea() {
    modelo.limpar();
    desativar();
    pintar();
  }

  /**
   * O mapa está OCUPADO com o desenho?
   *
   * Quem tem dado no mapa pergunta isto antes de tratar clique e movimento: no
   * meio de um desenho, o clique marca vértice e não seleciona feição, e o
   * `moveend` do arrasto de vértice não é navegação de quem consulta.
   */
  function ocupado() {
    return desenhando || verticeArrastado !== null;
  }

  function desabilitar() {
    botao.disabled = true;
  }

  function destruir() {
    if (quadro !== null) cancelAnimationFrame(quadro);
    quadro = null;
    mapa = null;
    montado = false;
  }

  return {
    botao,
    controles,
    montar,
    tratarTecla,
    mostrarArea,
    limparArea,
    ocupado,
    desabilitar,
    destruir,
  };
}
