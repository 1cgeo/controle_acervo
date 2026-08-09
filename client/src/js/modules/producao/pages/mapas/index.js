import { el, clearChildren } from '@utils/dom.js';
import { createSelectField, createCheckboxField, createTextField } from '@components/form-fields/form-fields.js';
import { estadoErro } from '@components/estado-erro.js';
import {
  getMapaAcompanhamento,
  getCatalogoCamadas,
  NOME_CAMADA,
} from '@services/producao-service.js';
import { criarMapaAcompanhamento } from './mapas-mapa.js';
import './mapas.css';

/** A camada que existe sempre, e é uma só no banco inteiro. */
const BLOCO = 'bloco';

const MENSAGEM_FORMA = 'Nome de camada de acompanhamento inválido. São aceitos '
  + '"bloco", "lote_<lote>_linha_<linha_producao>" e "lote_<lote>_subfase_<subfase>".';

/** O id da linha de produção escondido no nome da view, quando houver. */
export function linhaProducaoDoNome(nome) {
  const achado = /^lote_[0-9]+_linha_([0-9]+)$/.exec(String(nome || ''));
  return achado ? Number(achado[1]) : null;
}

/** O rótulo humano de uma view do catálogo. */
export function rotuloDaCamada(view) {
  if (!view || !view.nome) return '';
  if (view.nome === BLOCO) return 'Blocos (todos os lotes)';

  const linha = /^lote_([0-9]+)_linha_([0-9]+)$/.exec(view.nome);
  const subfase = /^lote_([0-9]+)_subfase_([0-9]+)$/.exec(view.nome);
  const lote = view.lote || (linha ? `lote ${linha[1]}` : subfase ? `lote ${subfase[1]}` : view.nome);
  const projeto = view.projeto ? `${view.projeto} / ` : '';

  if (linha) return `${projeto}${lote} — linha de produção ${linha[2]}`;
  if (subfase) return `${projeto}${lote} — subfase ${subfase[2]}`;
  return view.nome;
}

/**
 * MAPAS DE ACOMPANHAMENTO (#/producao/mapas).
 *
 * O QUE ESTA TELA DESENHA são as views materializadas do schema
 * `acompanhamento`, que NASCEM EM TEMPO DE EXECUÇÃO: os gatilhos de
 * `er/acompanhamento_producao.sql` criam uma por par (lote, linha de produção),
 * outra por (lote, subfase) e a `bloco`, que é única. O par só vira view quando
 * o lote recebe a primeira ETAPA -- e por isso "esta camada ainda não existe" é
 * um estado NORMAL do sistema, e não uma falha. A tela diz isso com essas
 * palavras, e nada aqui pinta de vermelho por causa disso.
 *
 * O CATÁLOGO DE CAMADAS É DE GERENTE, e a tela é de consulta.
 * `GET /gerencia_producao/view_acompanhamento` cobra
 * `verifyPerfil('gerente', 'producao')`, e não existe equivalente no piso de
 * consulta: `pg_matviews` é a única fonte de verdade dos nomes, e ela não é
 * publicada mais abaixo. Portanto o catálogo carrega SOZINHO, com o próprio
 * `catch`: quem é gerente ganha a lista pronta; quem é consulta continua com a
 * camada de blocos e com o campo que abre uma camada pelo nome. Num
 * `Promise.all`, o 403 do catálogo derrubaria a tela inteira e a mensagem que
 * sobraria seria "necessita do perfil gerente", numa tela que a pessoa TEM
 * perfil para ver.
 *
 * A TILE É OUTRA PERGUNTA, e por isso ela é uma marcação à parte e não um modo
 * do seletor: o GeoJSON mostra UM par (lote, linha), e a tile mostra a LINHA DE
 * PRODUÇÃO inteira, sobre todos os lotes que a executam. Ela só se oferece
 * quando a camada escolhida é de linha de produção, porque é de lá que sai o id.
 *
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderMapas(container) {
  let disposed = false;
  let catalogo = [];
  let camadaAtual = BLOCO;

  const mapa = criarMapaAcompanhamento();

  const situacao = el('p', { className: 'mapas__situacao' });
  const avisoCatalogo = el('p', { className: 'mapas__catalogo hidden' });
  const areaMapa = el('div', { className: 'mapas__area' }, [mapa.element]);

  const seletor = createSelectField({
    label: 'Camada',
    placeholder: null,
    options: [{ value: BLOCO, label: 'Blocos (todos os lotes)' }],
    value: BLOCO,
    onChange: (valor) => {
      if (!valor) return;
      camadaAtual = String(valor);
      sincronizarTile();
      carregarCamada();
    },
  });

  const marcaTile = createCheckboxField({
    label: 'Mostrar o recorte da linha de produção (tiles)',
    checked: false,
    helpText: 'A camada vetorial da linha inteira, sobre todos os lotes que a executam.',
    onChange: () => sincronizarTile(),
  });

  const campoNome = createTextField({
    label: 'Abrir camada pelo nome',
    placeholder: 'lote_3_linha_1',
    helpText: 'Para quem sabe o nome da view e não alcança o catálogo.',
  });

  const botaoAbrir = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => abrirPeloNome(),
  }, 'Abrir');

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Mapas de acompanhamento' }),
    ]),
    el('p', { className: 'page__subtitle' }, [
      'A situação de cada folha, pela view de acompanhamento do lote. As views ',
      'nascem quando o lote recebe a primeira etapa: camada que ainda não existe ',
      'é um lote que ainda não começou, e não um erro.',
    ]),

    el('div', { className: 'page__filters' }, [
      seletor.element,
      marcaTile.element,
    ]),

    avisoCatalogo,

    el('div', { className: 'mapas__manual' }, [
      campoNome.element,
      botaoAbrir,
    ]),

    situacao,
    areaMapa,
  ]);

  container.appendChild(page);

  // --- A tile ---------------------------------------------------------------

  function sincronizarTile() {
    const linha = linhaProducaoDoNome(camadaAtual);

    // A marcação só existe quando há linha de produção de onde tirar o id.
    marcaTile.element.classList.toggle('hidden', linha == null);
    if (linha == null) {
      marcaTile.setValue(false);
      mapa.setTile(null);
      return;
    }

    mapa.setTile(marcaTile.getValue() ? linha : null);
  }

  // --- O catálogo -----------------------------------------------------------

  function montarOpcoes() {
    const opcoes = [{ value: BLOCO, label: 'Blocos (todos os lotes)' }];
    for (const view of catalogo) {
      if (view.nome === BLOCO) continue;
      opcoes.push({ value: view.nome, label: rotuloDaCamada(view) });
    }
    // A camada aberta à mão entra na lista, senão o seletor mostraria uma camada
    // diferente da que está desenhada.
    if (!opcoes.some(o => o.value === camadaAtual)) {
      opcoes.push({ value: camadaAtual, label: rotuloDaCamada({ nome: camadaAtual }) });
    }
    seletor.setOptions(opcoes);
    seletor.setValue(camadaAtual);
  }

  async function carregarCatalogo() {
    try {
      catalogo = await getCatalogoCamadas();
      if (disposed) return;
      montarOpcoes();
      avisoCatalogo.classList.add('hidden');
      if (!catalogo.length) {
        avisoCatalogo.textContent = 'O catálogo respondeu sem nenhuma camada: '
          + 'nenhum lote de projeto em execução tem view de acompanhamento ainda.';
        avisoCatalogo.classList.remove('hidden');
      }
    } catch (err) {
      if (disposed) return;
      // A FALHA DO CATÁLOGO NÃO É A FALHA DA TELA. Ela vira uma nota, e a tela
      // segue com a camada de blocos e com o campo do nome.
      avisoCatalogo.textContent = 'A lista completa de camadas é lida por uma rota '
        + 'de GERENTE da produção, e ela não respondeu para este perfil '
        + `(${err.message}). A camada de blocos e o campo abaixo continuam valendo.`;
      avisoCatalogo.classList.remove('hidden');
    }
  }

  // --- A camada escolhida ---------------------------------------------------

  function abrirPeloNome() {
    const nome = (campoNome.getValue() || '').trim();
    if (!nome) {
      campoNome.setError('Escreva o nome da camada.');
      return;
    }
    // A MESMA FORMA QUE O SERVIDOR COBRA, conferida aqui só para a pessoa não
    // esperar uma ida ao servidor para receber o 400 que já dava para prever.
    if (!NOME_CAMADA.test(nome)) {
      campoNome.setError(MENSAGEM_FORMA);
      return;
    }
    campoNome.setError('');
    camadaAtual = nome;
    montarOpcoes();
    sincronizarTile();
    carregarCamada();
  }

  async function carregarCamada() {
    situacao.textContent = `Carregando ${rotuloDaCamada({ nome: camadaAtual })}...`;
    situacao.className = 'mapas__situacao';
    try {
      const resultado = await getMapaAcompanhamento(camadaAtual);
      if (disposed) return;

      if (resultado.vazio) {
        // CAMADA QUE AINDA NÃO NASCEU NÃO É ERRO. A frase é a do servidor, que
        // já explica quando a view passa a existir.
        mapa.setFeicoes({ type: 'FeatureCollection', features: [] });
        situacao.className = 'mapas__situacao mapas__situacao--ausente';
        situacao.textContent = `Ainda não há o que mostrar. ${resultado.motivo}`;
        return;
      }

      mapa.setFeicoes(resultado.geojson);
      situacao.className = 'mapas__situacao';
      situacao.textContent = `${resultado.geojson.features.length} feição(ões) em `
        + `${rotuloDaCamada({ nome: camadaAtual })}.`;
    } catch (err) {
      if (disposed) return;
      // Aqui sim é falha: 403 de perfil ou erro do servidor. O mapa some e o
      // aviso ocupa o lugar dele, com o caminho de volta.
      situacao.textContent = '';
      clearChildren(areaMapa);
      areaMapa.appendChild(estadoErro(err, () => {
        clearChildren(areaMapa);
        areaMapa.appendChild(mapa.element);
        mapa.redimensionar();
        carregarCamada();
      }));
    }
  }

  // O MAPA COMEÇA A CARREGAR JUNTO, e não depois: a biblioteca vem por
  // `import()` dinâmico e leva mais tempo que a consulta.
  mapa.iniciar();
  sincronizarTile();
  carregarCatalogo();
  carregarCamada();

  return () => {
    disposed = true;
    mapa._cleanup();
  };
}
