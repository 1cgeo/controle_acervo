import { el, svgIcon, ICONS } from '@utils/dom.js';
import { createTextField, createNumberField } from '@components/form-fields/form-fields.js';
import { openModal } from '@components/modal/modal-base.js';
import { carregarMapLibre, ESTILO_OSM, BRASIL, caixaDe } from './base.js';
import { criarDesenhoDeArea } from './desenho-area.js';
import {
  criarModeloDesenho,
  colecaoDoDesenho,
  paraPolygon,
  paraEwkt,
  deEwkt,
  retanguloDeCantos,
} from './poligono.js';
import { getFolha } from '@modules/acervo/services/acervo-service.js';
import './editor-geometria.css';

/**
 * Editor da geometria de um produto do acervo.
 *
 * A DECISAO CENTRAL: o modo de definir o poligono sai da ESCALA, e nao da
 * vontade de quem cadastra.
 *
 *   escala 1 a 4 (25k, 50k, 100k, 250k)  -> SCN: so por MI ou INOM
 *   escala 5 (personalizada)             -> fora do SCN: pelos cantos
 *
 * Folha do Sistema Cartografico Nacional tem quadro DEFINIDO pelo identificador:
 * a 2965-1-NE nao e "mais ou menos ali", ela e exatamente aqueles 7'30" por
 * 7'30". Deixar alguem desenha-la a mao e o que produz os defeitos que a
 * auditoria hoje persegue DEPOIS do fato, em `server/src/acervo/invariantes.js`:
 * 1d (profundidade do INOM diverge da escala), 1e (a caixa casa outra escala),
 * 1g (MI sem INOM, ou o contrario), 1h (MI preenchido com o INOM, 29 produtos
 * errados achados em 2026-07-30) e 1i (MI fora da forma da escala).
 *
 * Nascendo do identificador, geometria, MI, INOM e escala ficam coerentes POR
 * CONSTRUCAO, e esses cinco invariantes deixam de ter como falhar em produto
 * novo. E por isso que o poligono do modo SCN nao e editavel: poder arrastar um
 * vertice ali seria reabrir exatamente a porta que este desenho fecha.
 *
 * Fora do SCN nao ha folha para calcular, e o quadro e mesmo arbitrario. Ali os
 * cantos sao a forma direta de dizer o retangulo, e o desenho livre fica como
 * escape para o recorte irregular, que existe de verdade no acervo (o invariante
 * `1e_info` conta quantos sao).
 */

const FONTE = 'editor-geom';
/** Azul de produto, a mesma convencao de cor da busca do acervo. */
const COR = '#1976d2';

/** A escala personalizada (5) e a unica que nao e enquadramento SCN. */
const ESCALA_PERSONALIZADA = 5;

export const ehEscalaScn = (tipoEscalaId) => {
  const n = Number(tipoEscalaId);
  return Number.isInteger(n) && n >= 1 && n <= 4;
};

/**
 * Monta o editor.
 *
 * @param {Object} opts
 * @param {string} [opts.ewktAtual] geometria ja gravada, para editar
 * @param {number} opts.tipoEscalaId decide o modo; ver o cabecalho
 * @param {string} [opts.mi]
 * @param {string} [opts.inom]
 * @returns {{element:HTMLElement, iniciar:Function, resultado:Function, _cleanup:Function}}
 */
export function criarEditorGeometria({ ewktAtual = null, tipoEscalaId, mi = '', inom = '' }) {
  // `null` quando a escala ainda nao foi escolhida no formulario. Nao da para
  // deduzir: cair no modo livre por omissao ofereceria desenho a mao para uma
  // folha do SCN, que e o que este componente existe para impedir. Entao a
  // pessoa DECLARA o enquadramento uma vez, e dali em diante o modo esta fixo.
  //
  // Nao e a mesma coisa que deixar escolher o metodo: escolher entre "e folha do
  // SCN" e "nao e" e uma pergunta sobre o PRODUTO, e a resposta dela determina o
  // metodo. Escolher entre "desenhar" e "digitar o INOM" seria sobre o gosto de
  // quem cadastra, e essa nunca aparece.
  const escalaConhecida = tipoEscalaId !== null && tipoEscalaId !== undefined && tipoEscalaId !== '';
  let scn = escalaConhecida ? ehEscalaScn(tipoEscalaId) : null;

  const modelo = criarModeloDesenho();

  let mapa = null;
  let disposto = false;
  let requisicao = 0;
  // O que vai voltar para o formulario. No modo SCN o identificador tambem
  // volta, porque foi ele que gerou o quadro: devolver so o poligono deixaria o
  // formulario com um MI antigo ao lado de uma geometria nova.
  let escolha = null;

  const verticesIniciais = ewktAtual ? deEwkt(ewktAtual) : null;
  if (verticesIniciais) modelo.carregar(verticesIniciais);

  const aviso = el('div', { className: 'editor-geom__aviso' });
  const resumo = el('div', { className: 'editor-geom__resumo' });
  const canvas = el('div', { className: 'editor-geom__canvas' });

  function dizer(texto, tipo = 'info') {
    aviso.textContent = texto || '';
    aviso.className = `editor-geom__aviso editor-geom__aviso--${tipo}`;
    aviso.classList.toggle('hidden', !texto);
  }

  // ---------------------------------------------------------------- desenho

  function pintar() {
    if (!mapa || !mapa.getSource(FONTE)) return;
    const concluido = modelo.estado === 'concluido' || modelo.estado === 'editando';
    mapa.getSource(FONTE).setData(colecaoDoDesenho(modelo.vertices, null, concluido));
  }

  function enquadrar() {
    const geometria = modelo.geometria();
    if (!mapa || !geometria) return;
    const caixa = caixaDe(geometria);
    if (caixa) {
      mapa.fitBounds([[caixa[0], caixa[1]], [caixa[2], caixa[3]]], { padding: 60, duration: 0 });
    }
  }

  /** Registra o que o modelo tem hoje como resposta do editor. */
  function fixarEscolha(extra = {}) {
    const ewkt = paraEwkt(modelo.vertices);
    escolha = ewkt ? { ewkt, ...extra } : null;
    return escolha;
  }

  // ------------------------------------------------------------- modo SCN

  const campoMi = createTextField({
    label: 'MI',
    value: mi || '',
    placeholder: '2965-1-NE',
    helpText: 'Mapa-Índice da folha. Nem toda folha tem MI.',
  });

  const campoInom = createTextField({
    label: 'INOM',
    value: inom || '',
    placeholder: 'SF-22-Y-D-II-1-NE',
    helpText: 'Índice de Nomenclatura. Sozinho já determina o quadro e a escala.',
  });

  const btnCalcular = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => calcularFolha(),
  }, [svgIcon(ICONS.search, 16), 'Calcular a folha']);

  async function calcularFolha() {
    const miDigitado = campoMi.getValue();
    const inomDigitado = campoInom.getValue();

    campoMi.setError(null);
    campoInom.setError(null);

    if (!miDigitado && !inomDigitado) {
      campoInom.setError('Informe o MI ou o INOM da folha');
      return;
    }

    // O INOM manda quando os dois vem preenchidos: ele determina o quadro E a
    // escala sozinho, enquanto o MI depende de tabela e pode nao existir.
    const consulta = inomDigitado ? { inom: inomDigitado } : { mi: miDigitado };

    const meuToken = requisicao + 1;
    requisicao = meuToken;
    btnCalcular.disabled = true;
    dizer('Calculando a folha...', 'info');

    try {
      const folha = await getFolha(consulta);
      if (disposto || meuToken !== requisicao) return;

      const vertices = deEwkt(folha.geom);
      if (!vertices) {
        dizer('O servidor devolveu uma geometria que esta tela não consegue ler.', 'erro');
        return;
      }

      const carga = modelo.carregar(vertices);
      if (!carga.valid) {
        dizer(carga.message, 'erro');
        return;
      }

      campoInom.setValue(folha.inom || '');
      campoMi.setValue(folha.mi || '');

      pintar();
      enquadrar();
      fixarEscolha({
        mi: folha.mi || null,
        inom: folha.inom || null,
        tipo_escala_id: folha.tipo_escala_id,
      });

      // "Esta folha nao tem MI" e resposta legitima, e nao falha: folha fora do
      // territorio brasileiro nao recebe MI, e ha listas de exclusao no 25k e no
      // 50k. Dizer isso e melhor do que deixar o campo vazio sem motivo, que e o
      // que faz a pessoa procurar um numero que nao existe.
      if (folha.sem_mi) {
        dizer('Folha calculada. Esta folha não tem MI, e o campo fica vazio de propósito.', 'aviso');
      } else {
        dizer(`Folha ${folha.inom} calculada.`, 'ok');
      }

      mostrarResumo(folha);
    } catch (erro) {
      if (disposto || meuToken !== requisicao) return;
      dizer(erro.message || 'Não foi possível calcular a folha.', 'erro');
    } finally {
      if (!disposto) btnCalcular.disabled = false;
    }
  }

  function mostrarResumo(folha) {
    const caixa = caixaDe(modelo.geometria());
    resumo.replaceChildren(
      el('div', { className: 'editor-geom__fato' }, [
        el('span', { textContent: 'INOM' }),
        el('strong', { textContent: folha.inom || '-' }),
      ]),
      el('div', { className: 'editor-geom__fato' }, [
        el('span', { textContent: 'MI' }),
        el('strong', { textContent: folha.mi || 'sem MI' }),
      ]),
      caixa ? el('div', { className: 'editor-geom__fato' }, [
        el('span', { textContent: 'Extensão' }),
        el('strong', {
          textContent: `${(caixa[2] - caixa[0]).toFixed(4)}° x ${(caixa[3] - caixa[1]).toFixed(4)}°`,
        }),
      ]) : null,
    );
  }

  // -------------------------------------------------------- modo fora do SCN

  // `createNumberField` nao expoe `onInput` (so o de texto expoe), entao o
  // ouvinte entra no input devolvido. Sem isso, digitar um canto nao repintaria
  // o mapa e a pessoa so descobriria o erro ao salvar.
  const canto = (rotulo, valor) => {
    const campo = createNumberField({ label: rotulo, value: valor, step: 'any' });
    campo.input.addEventListener('input', () => aplicarCantos());
    return campo;
  };

  const caixaInicial = verticesIniciais ? caixaDe(paraPolygon(verticesIniciais)) : null;

  const campoOeste = canto('Longitude oeste', caixaInicial ? caixaInicial[0] : null);
  const campoSul = canto('Latitude sul', caixaInicial ? caixaInicial[1] : null);
  const campoLeste = canto('Longitude leste', caixaInicial ? caixaInicial[2] : null);
  const campoNorte = canto('Latitude norte', caixaInicial ? caixaInicial[3] : null);

  function aplicarCantos() {
    const oeste = campoOeste.getValue();
    const sul = campoSul.getValue();
    const leste = campoLeste.getValue();
    const norte = campoNorte.getValue();

    if ([oeste, sul, leste, norte].some(v => v === null)) {
      dizer('Preencha os quatro valores para formar o retângulo.', 'info');
      return;
    }

    const vertices = retanguloDeCantos([oeste, sul], [leste, norte]);
    if (!vertices) {
      dizer('Esses cantos não formam área: confira se a longitude e a latitude não estão repetidas.', 'erro');
      return;
    }

    modelo.carregar(vertices);
    pintar();
    enquadrar();
    fixarEscolha();
    dizer('Retângulo definido pelos cantos.', 'ok');
  }

  // O desenho livre existe SO fora do SCN, e como escape: o acervo tem folha
  // recortada de verdade (invariante 1e_info), e a coluna guarda POLYGON, nao
  // retangulo. Dentro do SCN o BOTAO dele nao aparece, pela razao do cabecalho.
  //
  // O objeto e criado sempre, e nao so no modo livre, porque o modo pode ainda
  // nao ter sido escolhido quando o mapa carrega: criar depois exigiria montar
  // camada num mapa ja pronto, e a ordem das camadas passaria a depender de
  // quando a pessoa clicou.
  const desenho = criarDesenhoDeArea({
    onAreaDesenhada: (geometria) => {
      const vertices = geometria.coordinates[0].slice(0, -1);
      modelo.carregar(vertices);
      sincronizarCantosComModelo();
      fixarEscolha();
      dizer('Área desenhada. Os cantos abaixo passaram a mostrar a caixa dela.', 'ok');
    },
    onAreaCancelada: () => {
      modelo.limpar();
      escolha = null;
      dizer('Desenho descartado.', 'info');
    },
  });

  function sincronizarCantosComModelo() {
    const caixa = caixaDe(modelo.geometria());
    if (!caixa) return;
    campoOeste.setValue(caixa[0]);
    campoSul.setValue(caixa[1]);
    campoLeste.setValue(caixa[2]);
    campoNorte.setValue(caixa[3]);
  }

  const campoColar = createTextField({
    label: 'Colar WKT ou EWKT',
    placeholder: 'SRID=4674;POLYGON((...))',
    helpText: 'Aceita o que a ficha do produto mostra. MULTIPOLYGON não entra: a coluna guarda POLYGON.',
    onInput: (valor) => {
      if (!valor.trim()) return;
      const vertices = deEwkt(valor);
      if (!vertices) {
        campoColar.setError('Não consegui ler isso como um POLYGON de anel único.');
        return;
      }
      campoColar.setError(null);
      modelo.carregar(vertices);
      sincronizarCantosComModelo();
      pintar();
      enquadrar();
      fixarEscolha();
      dizer('Geometria colada.', 'ok');
    },
  });

  // ------------------------------------------------------------------ painel

  const conteudoScn = () => [
    el('p', { className: 'editor-geom__intro', textContent:
      'Esta escala é do Sistema Cartográfico Nacional, então o quadro sai do '
      + 'identificador da folha, e não do desenho. Informe o MI ou o INOM.' }),
    campoInom.element,
    campoMi.element,
    btnCalcular,
    aviso,
    resumo,
  ];

  const conteudoLivre = () => [
    el('p', { className: 'editor-geom__intro', textContent:
      'Produto fora do Sistema Cartográfico Nacional não tem folha para calcular. '
      + 'Defina o quadro pelos cantos, ou desenhe quando o recorte for irregular.' }),
    el('div', { className: 'editor-geom__cantos' }, [
      campoOeste.element, campoLeste.element,
      campoSul.element, campoNorte.element,
    ]),
    el('div', { className: 'editor-geom__acoes' }, [desenho.botao]),
    desenho.controles,
    campoColar.element,
    aviso,
  ];

  /**
   * A pergunta que decide o modo, feita UMA vez, e só quando a escala ainda não
   * foi escolhida no formulário.
   *
   * Ela é sobre o PRODUTO ("esta folha é do SCN?"), e não sobre o método: a
   * resposta determina o método, e depois disso não há mais escolha. É a mesma
   * regra do resto do componente, só que aqui a escala ainda não a respondeu.
   */
  const conteudoEscolha = () => [
    el('p', { className: 'editor-geom__intro', textContent:
      'Antes de definir o quadro: este produto é uma folha do Sistema Cartográfico '
      + 'Nacional? A resposta decide como a geometria é definida, e a escala sai '
      + 'junto.' }),
    el('div', { className: 'editor-geom__escolha' }, [
      el('button', {
        className: 'btn btn--primary',
        type: 'button',
        onClick: () => trocarModo(true),
      }, ['É folha do SCN (25k, 50k, 100k ou 250k)']),
      el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => trocarModo(false),
      }, ['Não é do SCN (escala personalizada)']),
    ]),
  ];

  const painel = el('div', { className: 'editor-geom__painel' });

  function pintarPainel() {
    const filhos = scn === null ? conteudoEscolha() : (scn ? conteudoScn() : conteudoLivre());
    painel.replaceChildren(...filhos.filter(Boolean));
  }

  function trocarModo(ehScn) {
    scn = ehScn;
    pintarPainel();
    // Geometria que veio de fora continua valendo: trocar de modo não é
    // descartar o que já estava gravado.
    if (!ehScn) sincronizarCantosComModelo();
  }

  pintarPainel();

  const element = el('div', { className: 'editor-geom' }, [painel, canvas]);

  // ------------------------------------------------------------------ mapa

  async function iniciar() {
    const maplibre = await carregarMapLibre();
    if (disposto) return;
    if (!maplibre) {
      canvas.appendChild(el('div', { className: 'editor-geom__semmapa', textContent:
        'Não foi possível carregar o mapa. Os campos ao lado continuam funcionando.' }));
      return;
    }

    mapa = new maplibre.Map({
      container: canvas,
      style: ESTILO_OSM,
      bounds: BRASIL,
      fitBoundsOptions: { padding: 20 },
      attributionControl: false,
    });

    mapa.addControl(new maplibre.NavigationControl({ showCompass: false }), 'top-left');
    mapa.addControl(new maplibre.ScaleControl({ maxWidth: 120 }));

    mapa.on('load', () => {
      if (disposto) return;

      mapa.addSource(FONTE, { type: 'geojson', data: colecaoDoDesenho([], null, false) });

      mapa.addLayer({
        id: 'editor-geom-area',
        type: 'fill',
        source: FONTE,
        filter: ['==', ['get', 'kind'], 'area'],
        paint: { 'fill-color': COR, 'fill-opacity': 0.25 },
      });
      mapa.addLayer({
        id: 'editor-geom-contorno',
        type: 'line',
        source: FONTE,
        filter: ['in', ['get', 'kind'], ['literal', ['area', 'linha']]],
        paint: { 'line-color': COR, 'line-width': 2 },
      });
      mapa.addLayer({
        id: 'editor-geom-vertices',
        type: 'circle',
        source: FONTE,
        filter: ['==', ['get', 'kind'], 'vertice'],
        paint: {
          'circle-radius': 4,
          'circle-color': '#ffffff',
          'circle-stroke-color': COR,
          'circle-stroke-width': 2,
        },
      });

      // O desenho entra DEPOIS, para as camadas dele ficarem por cima.
      desenho.montar(mapa);

      pintar();
      if (modelo.estado === 'concluido') {
        enquadrar();
        // Geometria que ja existia conta como escolha desde o inicio: quem abre
        // o editor so para conferir e confirma nao pode receber "nada definido".
        fixarEscolha({ mi: mi || null, inom: inom || null, tipo_escala_id: tipoEscalaId });
      }
    });
  }

  return {
    element,
    iniciar,
    /** @returns {{ewkt:string, mi?:string, inom?:string, tipo_escala_id?:number}|null} */
    resultado: () => escolha,
    redimensionar: () => { if (mapa) mapa.resize(); },
    _cleanup: () => {
      disposto = true;
      desenho.destruir();
      if (mapa) mapa.remove();
      mapa = null;
    },
  };
}

/**
 * Abre o editor num modal de TELA CHEIA.
 *
 * Tela cheia, e nao a largura de um formulario, porque o mapa e a ferramenta:
 * num quadro pequeno nao da para ver onde a folha cai, que e justamente o que a
 * pessoa precisa conferir antes de gravar.
 *
 * @param {Object} opts o mesmo de criarEditorGeometria, mais onConfirmar
 * @param {(r:{ewkt:string, mi?:string, inom?:string, tipo_escala_id?:number})=>void} opts.onConfirmar
 */
export function abrirEditorGeometria({ onConfirmar, onFechar, ...opts }) {
  const editor = criarEditorGeometria(opts);
  let confirmado = false;

  const modal = openModal({
    title: 'Geometria do produto',
    content: editor.element,
    width: '96vw',
    onClose: () => {
      editor._cleanup();
      // Fechar sem confirmar e uma resposta: quem chamou precisa saber que a
      // geometria NAO mudou, para nao apagar a que ja estava gravada.
      if (!confirmado && onFechar) onFechar();
    },
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Usar esta geometria',
        variant: 'primary',
        onClick: ({ close }) => {
          const resultado = editor.resultado();
          if (!resultado) {
            // Confirmar sem geometria apagaria em silencio o que ja estava
            // gravado. O botao nao fecha, e o aviso ao lado diz o que falta.
            return;
          }
          confirmado = true;
          close();
          if (onConfirmar) onConfirmar(resultado);
        },
      },
    ],
  });

  modal.element.classList.add('modal--tela-cheia');
  editor.iniciar().then(() => editor.redimensionar());

  return modal;
}

/**
 * O mesmo editor, com interface de PROMESSA.
 *
 * E a forma que o formulario de produto consome: `await pedirGeometria(...)`
 * devolve a geometria escolhida, ou `null` quando a pessoa fechou sem confirmar.
 * O `null` importa tanto quanto o resultado: e ele que diz ao formulario para
 * preservar a geometria que ja estava la.
 *
 * @param {Object} opts o mesmo de criarEditorGeometria
 * @returns {Promise<{ewkt:string, mi?:string, inom?:string, tipo_escala_id?:number}|null>}
 */
export function pedirGeometria(opts) {
  return new Promise((resolve) => {
    abrirEditorGeometria({
      ...opts,
      onConfirmar: resolve,
      onFechar: () => resolve(null),
    });
  });
}
