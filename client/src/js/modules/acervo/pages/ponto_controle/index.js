import { el, svgIcon, ICONS } from '@utils/dom.js';
import { reconciliar } from '@utils/reconciliar.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { chip } from '@components/status-chip.js';
import { estadoErro } from '@components/estado-erro.js';
import {
  buscarPontos, buscarPosicoes, getFacetas, baixarPontosCsv,
} from '@modules/acervo/services/ponto-controle-service.js';
import { getLimite } from '@modules/acervo/services/limites-service.js';
import { criarSelecao, pintarBotaoSelecao } from '@modules/acervo/pages/busca/selecao.js';
import { criarFiltroMultiplo } from '@components/filtro-multiplo/filtro-multiplo.js';
import { criarMapaPontos } from './mapa.js';
import { abrirCodigosDisponiveis } from './codigos-dialog.js';
import { abrirPontoDialog } from './ponto-dialog.js';

/** Espera antes de disparar a consulta enquanto a pessoa ainda digita. */
const ESPERA_DIGITACAO = 350;
/** Espera depois de mover o mapa, quando a consulta segue a area visivel. */
const ESPERA_MAPA = 500;
const POR_PAGINA = 20;

// Chip por situacao, na mesma leitura de cor do mapa e da ficha. Os codigos sao
// os de ponto_controle.tipo_situacao: 1 Nao medido, 2 Aguardando revisao,
// 3 APROVADO, 4 REPROVADO. Trocar o 3 com o 4 pinta a lista mentindo.
const VARIANTE_SITUACAO = { 1: 'warning', 2: 'info', 3: 'success', 4: 'error' };

// Item sentinela do resultado vazio. Ele entra na mesma reconciliacao dos
// cartoes, e por isso o aviso "nada encontrado" sai da tela sozinho quando o
// resultado volta a ter ponto.
const VAZIO = { vazio: true };

function debounce(fn, ms) {
  let id = null;
  const chamada = (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
  chamada.cancelar = () => clearTimeout(id);
  return chamada;
}

/**
 * Preenche um filtro de faceta com marcacao multipla.
 *
 * So entra quem TEM ponto, e o numero vai ao lado. Um filtro com os 86 lotes do
 * acervo, dos quais dois tem ponto de controle, faz a pessoa procurar agulha; e
 * opcao sem numero nao diz se marcar vale a pena.
 *
 * A opcao MARCADA sobrevive mesmo com zero, com "(0)": some-la enquanto esta
 * marcada tiraria da tela o filtro que produziu o resultado vazio, e a pessoa
 * nao teria o que desfazer. Quem guarda essa regra e o `filtro-multiplo`.
 *
 * O total no rotulo de "nada marcado" e a soma da faceta, e nao um dominio
 * fixo: e quantos pontos a consulta devolve sem este filtro.
 */
function preencherFaceta(filtro, itens, rotuloVazio, desejado = null) {
  const total = itens.reduce((s, i) => s + i.pontos, 0);
  const contagem = new Map(itens.map(i => [String(i.code), i.pontos]));
  filtro.preencher(
    itens,
    total > 0 ? `${rotuloVazio} (${formatNumber(total)})` : rotuloVazio,
    contagem,
    desejado
  );
}

/**
 * Ponto de controle (#/acervo/ponto_controle): mapa e lista lado a lado.
 *
 * Replica a BUSCA do acervo de propósito, gesto por gesto: os mesmos filtros com
 * quantitativo, a mesma seleção múltipla com barra e chips, o mesmo "só na área
 * do mapa", a mesma exportação, e o clique no cartão levando o mapa até o item.
 * Quem já usa o sistema não aprende nada novo aqui.
 *
 * Três diferenças, que vêm do dado e não do gosto:
 *
 * 1. **O item é um PONTO, não um polígono.** Onde a busca pinta cobertura, aqui
 *    a cor diz a SITUAÇÃO, que é o que decide se o dado serve ao ajuste. E
 *    "enquadrar" vira um voo com zoom fixo: ponto não tem extensão para caber.
 * 2. **Não há desenho de área.** O recorte é a área VISÍVEL do mapa, porque a
 *    pergunta de campo é "que pontos existem nesta região".
 * 3. **Não há botão de importar.** A missão entra pelo plugin, com o GeoPackage
 *    validado em campo. A tela é de CONSULTA, e um botão de upload aqui
 *    prometeria um caminho que não existe.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} ctx
 * @returns {Promise<Function>} cleanup
 */
export async function renderPontoControle(container, ctx) {
  let disposed = false;
  let pagina = 1;
  // Respostas voltam fora de ordem; so a mais recente pode pintar a tela.
  let requisicao = 0;
  let seguirMapa = false;
  // Recorte por área DESENHADA. Exclui o "só na área do mapa": os dois são
  // recortes espaciais, e cruzá-los devolveria a interseção de um retângulo com
  // um polígono, que ninguém pediu e ninguém consegue ler na tela.
  let areaDesenhada = null;
  // Lugar destacado no mapa, como 'estado:43' ou 'municipio:4314902'. Guarda a
  // CHAVE, e não a geometria: serve para saber quando o destaque mudou e para
  // descartar a resposta de um pedido que já ficou velho.
  let chaveLugar = '';
  // Verdadeiro quando o destaque do lugar levou a câmera. É ele, e não a chave,
  // que impede o enquadramento automático nos pontos: um link que já trouxe
  // recorte próprio destaca o lugar SEM mexer na câmera, e ali o enquadramento
  // nos pontos continua sendo o certo.
  let lugarComandaCamera = false;

  const query = ctx && ctx.query ? ctx.query : new URLSearchParams();

  /**
   * Caixa que veio no LINK, como 'minx,miny,maxx,maxy'.
   *
   * Vale so enquanto o mapa nao souber a propria area visivel: `caixaVisivel`
   * devolve null ate ele terminar de carregar, e a primeira consulta sai antes
   * disso. Sem ela, um link com `bbox` abria o acervo inteiro.
   */
  let bboxDoLink = query.get('bbox') || '';

  /** @type {Map<number, HTMLElement>} id -> cartao, para o realce cruzado. */
  const cartoesPorId = new Map();
  /**
   * id -> ponto, para TODOS os pontos do resultado.
   *
   * Distinto do `cartoesPorId`, que tem só a página da lista. O mapa mostra o
   * resultado inteiro, então o ponto clicado quase nunca está na página: com
   * 3.490 pontos e 20 por página, 99% dos cliques caem fora dela.
   * @type {Map<number, Object>}
   */
  const posicoesPorId = new Map();

  // ---------------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------------
  const codigoInput = el('input', {
    className: 'busca-campo__input',
    type: 'search',
    placeholder: 'Buscar pelo código do ponto',
    'aria-label': 'Buscar pelo código do ponto',
    autocomplete: 'off',
    value: query.get('cod_ponto') || '',
    onInput: () => buscarComEspera(),
  });

  const campoBusca = el('div', { className: 'busca-campo' }, [
    el('span', { className: 'busca-campo__icone' }, [svgIcon(ICONS.search, 20)]),
    codigoInput,
  ]);

  /** Lista de codigos que veio na URL, como '1,3'. */
  const daUrl = (campo) => (query.get(campo) || '').split(',').filter(v => v !== '');

  // Marcacao MULTIPLA, igual a busca do acervo: as duas
  // telas andam juntas, e um filtro que se usa de um jeito aqui e de outro la
  // seria a pessoa reaprendendo a interface ao trocar de aba.
  const projetoFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Todos os projetos',
    nomePlural: 'projetos',
    ariaLabel: 'Projeto',
    valorInicial: daUrl('projeto_id'),
    onMudar: () => reiniciar(),
  });

  const loteFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Todos os lotes',
    nomePlural: 'lotes',
    ariaLabel: 'Lote (missão)',
    valorInicial: daUrl('lote_id'),
    onMudar: () => reiniciar(),
  });

  // Lugar. O município depende do ESTADO: sem estado escolhido o servidor
  // devolve lista vazia, porque um combo com os municípios de todo o país não
  // ajuda a escolher. Trocar de estado zera o município, senão a consulta
  // levaria um município que não pertence ao estado da tela.
  const estadoFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Todos os estados',
    nomePlural: 'estados',
    ariaLabel: 'Estado',
    valorInicial: daUrl('estado_id'),
    onMudar: () => {
      municipioFiltro.limpar();
      destacarLugar();
      reiniciar();
    },
  });

  const municipioFiltro = criarFiltroMultiplo({
    rotuloTodos: 'Escolha o estado',
    nomePlural: 'municípios',
    ariaLabel: 'Município',
    valorInicial: daUrl('municipio_id'),
    onMudar: () => { destacarLugar(); reiniciar(); },
  });

  const areaCheck = el('input', {
    type: 'checkbox',
    id: 'pc-seguir-mapa',
    onChange: () => {
      seguirMapa = areaCheck.checked;
      // Marcar "só na área do mapa" tira a área desenhada: são dois recortes
      // espaciais, e o último gesto é o que vale.
      if (seguirMapa && areaDesenhada) removerArea();
      reiniciar();
    },
  });

  // Chip da área desenhada, no mesmo lugar dos outros filtros: sem ele o único
  // sinal de que a consulta está recortada seria o polígono no mapa, que sai da
  // vista assim que a pessoa navega para outro canto.
  //
  // O conteudo nasce junto com ele, e nao a cada desenho: o chip so aparece e
  // some, e refazer o icone, o texto e o botao de remover a cada area nova
  // tiraria o foco de quem estava sobre o ×.
  const chipArea = el('div', { className: 'busca-area-chip hidden' }, [
    svgIcon(ICONS.layers, 16),
    el('span', { textContent: 'Área desenhada no mapa' }),
    el('button', {
      className: 'busca-area-chip__remover',
      type: 'button',
      'aria-label': 'Remover a área desenhada',
      textContent: '×',
      onClick: () => { removerArea(); reiniciar(); },
    }),
  ]);

  const limparBtn = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    onClick: () => limparTudo(),
  }, [svgIcon(ICONS.close, 16), 'Limpar filtros']);

  // Era o P14 do plugin, e virou tela porque a resposta certa exige o acervo
  // INTEIRO: a camada da missão aberta no QGIS declarava livre o código que
  // outra missão já tinha usado.
  const codigosBtn = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    onClick: () => abrirCodigosDisponiveis(),
  }, [svgIcon(ICONS.add, 16), 'Códigos disponíveis']);

  async function exportarCsv(soSelecionados, botao) {
    const ids = soSelecionados ? [...selecao.ids()] : [];
    if (soSelecionados && !ids.length) return;

    botao.disabled = true;
    try {
      await baixarPontosCsv(
        { ...filtrosAtuais(), ids: ids.length ? ids.join(',') : null },
        soSelecionados ? 'pontos-selecionados.csv' : 'pontos-de-controle.csv'
      );
    } catch (err) {
      showError(err.message || 'Erro ao exportar o CSV');
    } finally {
      botao.disabled = false;
    }
  }

  const exportarTudoBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    title: 'Baixa em CSV todos os pontos do resultado, e não apenas a página exibida',
    onClick: (e) => exportarCsv(false, e.currentTarget),
  }, [svgIcon(ICONS.download, 16), 'Exportar CSV']);

  // So aparece quando ha selecao: um botao permanentemente desativado e ruido.
  // O rotulo muda a cada clique de selecao, e por isso ele e um NO DE TEXTO
  // guardado: refazer o conteudo do botao recriaria o icone junto, a cada
  // clique, sem nada ter mudado nele.
  const exportarSelecaoTexto = document.createTextNode('Exportar selecionados');
  const exportarSelecaoBtn = el('button', {
    className: 'btn btn--secondary btn--sm hidden',
    type: 'button',
    onClick: (e) => exportarCsv(true, e.currentTarget),
  }, [svgIcon(ICONS.download, 16), exportarSelecaoTexto]);

  const acoesTopo = el('div', { className: 'busca__acoes' }, [
    limparBtn, codigosBtn, exportarSelecaoBtn, exportarTudoBtn,
  ]);

  const filtros = el('div', { className: 'busca-filtros' }, [
    projetoFiltro.element,
    loteFiltro.element,
    estadoFiltro.element,
    municipioFiltro.element,
    el('label', { className: 'busca-filtros__area' }, [
      areaCheck,
      el('span', { textContent: 'Só na área do mapa' }),
    ]),
    chipArea,
    el('span', { className: 'busca-filtros__espaco' }),
    acoesTopo,
  ]);

  // ---------------------------------------------------------------------------
  // Selecao
  // ---------------------------------------------------------------------------
  const selecao = criarSelecao({
    rotulo: p => p.cod_ponto,
    substantivo: ['ponto selecionado', 'pontos selecionados'],
    onMudou: (ids) => {
      mapa.setSelecionados(ids);
      marcarCartoes();
      exportarSelecaoBtn.classList.toggle('hidden', ids.size === 0);
      exportarSelecaoTexto.data =
        ` Exportar ${ids.size} selecionado${ids.size > 1 ? 's' : ''}`;
    },
    onVerFichas: (pontos) => abrirPontoDialog(pontos.map(p => p.cod_ponto), 0),
  });

  // ---------------------------------------------------------------------------
  // Resultado
  // ---------------------------------------------------------------------------
  const contador = el('p', {
    className: 'busca-resultados__contador',
    'aria-live': 'polite',
    textContent: 'Consultando...',
  });
  const lista = el('div', { className: 'pc-lista' });

  // O aviso de lista vazia entra pela MESMA reconciliação dos cartões, como um
  // item sentinela. Fora dela, ele seria apagado na varredura seguinte (a
  // reconciliação remove todo filho que não está na lista final), ou teria de
  // morar noutro nó, sempre presente e mentindo "nada encontrado" no texto da
  // página.
  const listaVazia = el('div', { className: 'busca-lista__vazio' }, [
    el('p', { textContent: 'Nenhum ponto de controle com esses filtros.' }),
  ]);

  const paginacao = el('div', { className: 'busca-paginacao' });

  // `disabled` vai como PROPRIEDADE, e nunca como atributo no el(): o helper faz
  // setAttribute, e `disabled="false"` desabilita o botao do mesmo jeito.
  //
  // Os tres nos nascem aqui, e nao a cada consulta: quem clica em "Próxima"
  // dispara a consulta que recriava o proprio botao debaixo do cursor, e o foco
  // caia no body. Virar a segunda pagina pelo teclado era impossivel.
  const paginaAnteriorBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => { pagina -= 1; consultar(); },
  }, [svgIcon(ICONS.arrowBack, 16), 'Anterior']);

  const paginaPosicao = el('span', { className: 'busca-paginacao__posicao' });

  const paginaProximaBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => { pagina += 1; consultar(); },
  }, ['Próxima']);

  const mapa = criarMapaPontos({
    // O ponto clicado no mapa quase nunca está na página atual da lista: o mapa
    // recebe o resultado INTEIRO e a lista pagina de 20 em 20. Antes só o cartão
    // servia de fonte, e o clique nos outros 99% dos pontos não fazia nada. A
    // camada de posições guarda o id e o código, que é tudo o que a barra de
    // seleção e a ficha precisam. Mesma solução da busca do acervo.
    onAlternarSelecao: (id) => {
      const ponto = posicoesPorId.get(Number(id))
        || (cartoesPorId.get(Number(id)) || {})._dados;
      if (!ponto) return;
      selecao.alternar(ponto);
      mapa.setSelecionados(selecao.ids());
    },
    onApontar: (id) => apontarCartao(id),
    onMover: () => { if (seguirMapa) buscarPorMapa(); },
    onAreaDesenhada: (geometria) => {
      areaDesenhada = geometria;
      seguirMapa = false;
      areaCheck.checked = false;
      atualizarChipArea();
      reiniciar();
    },
    onAreaCancelada: () => {
      areaDesenhada = null;
      atualizarChipArea();
      reiniciar();
    },
  });

  /**
   * Pinta no mapa o contorno do lugar filtrado e leva a câmera até ele.
   *
   * O município ganha do estado quando os dois estão escolhidos: é o recorte
   * mais estreito, e é o que a consulta está aplicando.
   *
   * Falha em silêncio de propósito. O destaque é um apoio visual; o filtro
   * funciona sem ele, e um alerta a cada troca de estado seria pior do que a
   * borda faltando.
   *
   * @param {Object} [opcoes]
   * @param {boolean} [opcoes.enquadrar=true]
   */
  async function destacarLugar({ enquadrar = true } = {}) {
    // O municipio manda quando ha algum marcado: e o recorte mais fino, e o
    // contorno do estado por cima diria que a consulta cobre o estado inteiro.
    const municipios = municipioFiltro.valores();
    const estados = estadoFiltro.valores();
    const tipoLugar = municipios.length ? 'municipio' : (estados.length ? 'estado' : '');
    const idsLugar = municipios.length ? municipios : estados;
    const chave = tipoLugar ? `${tipoLugar}:${idsLugar.join(',')}` : '';
    if (chave === chaveLugar) return;
    chaveLugar = chave;

    if (!chave) {
      lugarComandaCamera = false;
      mapa.limparLimite();
      return;
    }

    // Marcado ANTES da espera, e não depois: quem chama não aguarda esta função,
    // e a consulta que vem logo em seguida pinta o resultado antes de a
    // geometria chegar. Marcando depois, essa pintura enquadraria nos pontos e a
    // câmera saltaria duas vezes, para dois lugares diferentes.
    lugarComandaCamera = enquadrar;

    try {
      // `allSettled`: um limite que falha não pode apagar os que vieram. Com
      // três estados marcados, dois contornos valem mais que nenhum.
      const respostas = await Promise.allSettled(
        idsLugar.map(id => getLimite(tipoLugar, id))
      );
      // Trocar de lugar duas vezes seguidas: a primeira resposta pode chegar
      // depois da segunda, e pintaria o estado que a pessoa já abandonou.
      if (disposed || chaveLugar !== chave) return;

      const limites = respostas
        .filter(r => r.status === 'fulfilled' && r.value)
        .map(r => r.value);
      if (!limites.length) {
        chaveLugar = '';
        lugarComandaCamera = false;
        mapa.limparLimite();
        return;
      }
      mapa.destacarLimite(limites, { enquadrar });
    } catch {
      if (chaveLugar !== chave) return;
      chaveLugar = '';
      lugarComandaCamera = false;
    }
  }

  /** Tira a área e avisa o mapa, que apaga o polígono. */
  function removerArea() {
    areaDesenhada = null;
    mapa.limparArea();
    atualizarChipArea();
  }

  function atualizarChipArea() {
    chipArea.classList.toggle('hidden', !areaDesenhada);
  }

  const painel = el('div', { className: 'pc-painel' }, [
    contador, selecao.element, lista, paginacao,
  ]);

  const raiz = el('div', { className: 'pc-pagina' }, [
    el('div', { className: 'pc-topo' }, [
      el('h1', { className: 'pc-titulo', textContent: 'Ponto de controle' }),
      campoBusca,
      filtros,
    ]),
    el('div', { className: 'pc-conteudo' }, [painel, mapa.elemento]),
  ]);

  container.replaceChildren(raiz);
  container.classList.add('main-content--altura-fixa');
  mapa.iniciar();

  // ---------------------------------------------------------------------------
  // Consulta
  // ---------------------------------------------------------------------------
  function filtrosAtuais() {
    return {
      cod_ponto: codigoInput.value.trim(),
      // Arrays: o servico junta com virgula, e o servidor aceita a lista.
      projeto_id: projetoFiltro.valores(),
      lote_id: loteFiltro.valores(),
      estado_id: estadoFiltro.valores(),
      municipio_id: municipioFiltro.valores(),
      // O desenho VENCE a área visível: quem desenhou pediu aquele recorte, e
      // mandar os dois traria a interseção dos dois.
      // `caixaVisivel` devolve null ate o mapa terminar de carregar. Na
      // primeira consulta de um link com `bbox`, isso descartava o recorte que
      // o link trazia: a tela abria o acervo inteiro e a URL era reescrita sem
      // ele. A caixa do link vale ate o mapa saber a propria.
      bbox: !areaDesenhada && seguirMapa ? (mapa.caixaVisivel() || bboxDoLink) : '',
      geometria: areaDesenhada ? JSON.stringify(areaDesenhada) : '',
    };
  }

  /** O filtro vive na URL: toda consulta e um endereco que sobrevive ao F5. */
  function gravarNaUrl(atuais) {
    const params = new URLSearchParams();
    for (const [chave, valor] of Object.entries(atuais)) {
      // Array VAZIO e verdadeiro em JavaScript, e sem este teste o filtro de
      // marcacao multipla sem nada marcado sujaria a URL com `lote_id=`.
      if (Array.isArray(valor)) {
        if (valor.length) params.set(chave, valor.join(','));
        continue;
      }
      if (valor) params.set(chave, valor);
    }
    if (pagina > 1) params.set('pagina', String(pagina));
    const consulta = params.toString();
    const destino = `/acervo/ponto_controle${consulta ? `?${consulta}` : ''}`;
    if (location.hash.slice(1) !== destino) {
      history.replaceState(null, '', `#${destino}`);
    }
  }

  async function consultar() {
    const meu = ++requisicao;
    const atuais = filtrosAtuais();
    gravarNaUrl(atuais);

    lista.setAttribute('aria-busy', 'true');
    try {
      // A LISTA pagina; o MAPA, nao. Sao duas chamadas, como na busca do
      // acervo: vinte pontos numa consulta de quinhentos afirmariam
      // visualmente que a missao tem vinte pontos ali.
      const [dados, posicoes, facetas] = await Promise.all([
        buscarPontos({ ...atuais, pagina, por_pagina: POR_PAGINA }),
        buscarPosicoes(atuais),
        getFacetas(atuais),
      ]);
      if (disposed || meu !== requisicao) return;
      pintarFacetas(facetas);
      pintar(dados, posicoes);
    } catch (erro) {
      if (disposed || meu !== requisicao) return;
      showError(erro.message || 'Não foi possível consultar os pontos de controle');
      contador.textContent = 'A consulta falhou.';
      // Estado de ERRO, e nao lista em branco. A lista vazia ja tem uma frase
      // propria ("Nenhum ponto de controle com esses filtros"), e apagar tudo
      // era ainda pior: nao restava nem a frase nem um botao, e o toast some em
      // segundos. Sem um caminho de volta, a unica saida era mexer num filtro.
      cartoesPorId.clear();
      lista.replaceChildren(estadoErro(erro, consultar));
      paginacao.replaceChildren();
    } finally {
      lista.removeAttribute('aria-busy');
    }
  }

  const buscarComEspera = debounce(() => { pagina = 1; consultar(); }, ESPERA_DIGITACAO);
  const buscarPorMapa = debounce(() => { pagina = 1; consultar(); }, ESPERA_MAPA);

  function reiniciar() {
    pagina = 1;
    consultar();
  }

  function limparTudo() {
    codigoInput.value = '';
    // `limpar` nao dispara `onMudar`: limpar a tela consulta UMA vez, no fim.
    projetoFiltro.limpar();
    loteFiltro.limpar();
    estadoFiltro.limpar();
    municipioFiltro.limpar();
    destacarLugar();
    areaCheck.checked = false;
    seguirMapa = false;
    removerArea();
    selecao.limpar();
    reiniciar();
  }

  // ---------------------------------------------------------------------------
  // Pintura
  // ---------------------------------------------------------------------------
  function pintarFacetas(facetas) {
    preencherFaceta(projetoFiltro, facetas.projetos || [], 'Todos os projetos');
    // O lote ja chega estreitado pelos projetos marcados: a faceta aplica os
    // OUTROS filtros, entao o servidor ja o fez. Nao ha o que filtrar aqui.
    preencherFaceta(
      loteFiltro,
      (facetas.lotes || []).map(l => ({
        ...l, nome: l.pit ? `${l.nome} (${l.pit})` : l.nome,
      })),
      'Todos os lotes'
    );
    // O estado mostra a SIGLA junto do nome: "Rio Grande do Sul (RS)" é o que
    // quem opera reconhece de imediato numa lista de 27.
    preencherFaceta(
      estadoFiltro,
      (facetas.estados || []).map(e => ({ ...e, nome: `${e.nome} (${e.sigla})` })),
      'Todos os estados'
    );
    preencherFaceta(
      municipioFiltro,
      facetas.municipios || [],
      estadoFiltro.valores().length ? 'Todos os municípios' : 'Escolha o estado'
    );
  }

  /**
   * Monta o cartao VAZIO (nos, listeners) e pinta nele o primeiro ponto.
   *
   * Criar e pintar sao separados porque a lista se RECONCILIA: o cartao do ponto
   * que continua no resultado sobrevive a consulta nova, e so troca de conteudo.
   * Mesmo desenho do `buildRow`/`paintRow` do data-table.
   *
   * Todo listener le `cartao._dados`, e nunca o `p` da criacao. Com o `p`
   * capturado, o cartao reaproveitado abriria a ficha do ponto da consulta
   * ANTERIOR, e a tela nao mostraria nada de errado.
   */
  function cartaoPonto(p) {
    // Clicar no cartao ABRE A FICHA, igual a busca de
    // produtos. O cartao mostra um resumo, e o gesto natural sobre um resumo e
    // "quero ver o resto". Selecionar virou o botao do rodape, que diz o que faz.
    //
    // As duas telas andam JUNTAS de proposito: sao a mesma lista, com o mesmo
    // cartao e a mesma barra de selecao. Gesto diferente entre elas seria a
    // pessoa reaprendendo a interface ao trocar de aba.
    //
    // O mapa continua indo ate o ponto: fechada a ficha, o circulo ja esta
    // enquadrado atras dela.
    const abrirFicha = () => {
      const dados = cartao._dados;
      mapa.enquadrarPonto(dados.id);
      abrirPontoDialog([dados.cod_ponto], 0);
    };

    const alternarSelecao = () => {
      selecao.alternar(cartao._dados);
      mapa.setSelecionados(selecao.ids());
    };

    const partes = {
      nome: el('h2', { className: 'busca-cartao__nome' }),
      chip: null,
      projeto: el('p', { className: 'busca-cartao__id' }),
      lote: el('p', { className: 'busca-cartao__id' }),
      meta: el('div', { className: 'pc-cartao__meta' }),
      arquivos: el('span'),
    };
    partes.topo = el('div', { className: 'busca-cartao__topo' }, [partes.nome]);

    const cartao = el('article', {
      className: 'busca-cartao pc-cartao',
      tabIndex: 0,
      onClick: abrirFicha,
      onKeyDown: (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        abrirFicha();
      },
      // Apontar na lista acende o ponto, e vice-versa: e o que liga os dois
      // lados sem exigir clique.
      onMouseEnter: () => mapa.setApontado(cartao._dados.id),
      onMouseLeave: () => mapa.setApontado(null),
      onFocus: () => mapa.setApontado(cartao._dados.id),
      onBlur: () => mapa.setApontado(null),
    }, [
      partes.topo,
      partes.projeto,
      partes.lote,
      partes.meta,
      el('div', { className: 'busca-cartao__rodape' }, [
        partes.arquivos,
        // O botao que era "Ficha" virou o de SELECAO, agora que o cartao inteiro
        // abre a ficha. Conteudo e `aria-pressed` saem de `pintarBotaoSelecao`.
        el('button', {
          className: 'btn btn--text btn--sm busca-cartao__selecionar',
          type: 'button',
          onClick: (e) => {
            // Sem isto o clique subiria para o cartao e abriria a ficha.
            e.stopPropagation();
            alternarSelecao();
          },
        }),
      ]),
    ]);

    cartao._partes = partes;
    pintarCartao(cartao, p);
    return cartao;
  }

  /** Repinta um cartao ja montado com o ponto novo, sem trocar o no. */
  function pintarCartao(cartao, p) {
    const partes = cartao._partes;
    cartao._dados = p;
    cartao.dataset.id = String(p.id);

    partes.nome.textContent = p.cod_ponto;

    // O chip e um no montado pelo componente, e nao um texto: troca-se o no.
    // A situacao muda de verdade entre duas consultas (o ponto e revisado), e um
    // chip que nao acompanha faz a tela mentir a situacao.
    const novo = chip(
      p.tipo_situacao_nome || `Situação ${p.tipo_situacao}`,
      VARIANTE_SITUACAO[p.tipo_situacao] || 'default'
    );
    if (partes.chip) partes.topo.replaceChild(novo, partes.chip);
    else partes.topo.appendChild(novo);
    partes.chip = novo;

    partes.projeto.textContent = p.projeto || '-';
    partes.lote.textContent = p.pit ? `${p.lote} · ${p.pit}` : (p.lote || '-');

    // A meta tem de um a tres spans, conforme o ponto tenha medidor e altitude.
    // Refazer os tres cabe aqui: sao folhas sem foco e sem estado, e a contagem
    // muda de um ponto para o outro.
    partes.meta.replaceChildren(...[
      el('span', { textContent: formatDate(p.data_rastreio) }),
      p.medidor ? el('span', { textContent: p.medidor }) : null,
      p.altitude_ortometrica != null
        ? el('span', {
          textContent: `${formatNumber(Number(p.altitude_ortometrica).toFixed(2))} m`,
        })
        : null,
    ].filter(Boolean));

    partes.arquivos.textContent =
      `${p.total_arquivos} ${p.total_arquivos === 1 ? 'arquivo' : 'arquivos'}`
      + (p.total_mb ? ` · ${formatNumber(Number(p.total_mb).toFixed(1))} MB` : '');

    return cartao;
  }

  function marcarCartoes() {
    for (const [id, cartao] of cartoesPorId) {
      cartao.classList.toggle('busca-cartao--selecionado', selecao.tem(id));
      // O botao acompanha a marca do cartao: a selecao muda por varios caminhos
      // (mapa, chip da barra, Limpar), e todos passam por aqui.
      pintarBotaoSelecao(cartao, selecao.tem(id));
    }
  }

  /** Realce vindo do MAPA: o mouse esta sobre o ponto, e o cartao acende. */
  function apontarCartao(id) {
    for (const [outroId, cartao] of cartoesPorId) {
      cartao.classList.toggle('busca-cartao--apontado', outroId === Number(id));
    }
  }

  function caixaDos(pontos) {
    const comPosicao = (pontos || []).filter(p => p.longitude != null && p.latitude != null);
    if (comPosicao.length === 0) return null;
    const lons = comPosicao.map(p => Number(p.longitude));
    const lats = comPosicao.map(p => Number(p.latitude));
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  }

  function pintar(dados, posicoes) {
    const pontos = dados.pontos || [];
    const total = dados.total || 0;

    contador.textContent = total === 0
      ? 'Nenhum ponto de controle encontrado.'
      : `${formatNumber(total)} ${total === 1 ? 'ponto' : 'pontos'}`;

    posicoesPorId.clear();
    for (const p of posicoes.pontos || []) posicoesPorId.set(Number(p.id), p);

    // A lista se RECONCILIA. Antes ela era refeita inteira a cada
    // consulta, e a consulta dispara a cada tecla digitada e a cada arrasto do
    // mapa com "só na área do mapa": vinte cartões trocados de meio em meio
    // segundo. O foco do teclado morria com o nó, e a rolagem voltava ao topo.
    //
    // A chave é o `id` do ponto. O cartão que continua no resultado fica, e só
    // muda de conteúdo; o que saiu é removido; o que mudou de lugar é movido.
    const montados = reconciliar(lista, pontos.length ? pontos : [VAZIO], {
      chave: (item) => (item === VAZIO ? '__vazio__' : Number(item.id)),
      criar: (item) => (item === VAZIO ? listaVazia : cartaoPonto(item)),
      atualizar: (no, item) => { if (item !== VAZIO) pintarCartao(no, item); },
    });

    // O índice do realce cruzado sai da reconciliação, e não de uma montagem
    // própria. Ele fica SEPARADO do mapa devolvido acima por dois motivos: o
    // aviso de lista vazia não é cartão, e três chamadas (`marcarCartoes`,
    // `apontarCartao` e o clique no mapa) esperam só ponto aqui dentro.
    cartoesPorId.clear();
    for (const p of pontos) {
      const cartao = montados.get(Number(p.id));
      if (cartao) cartoesPorId.set(Number(p.id), cartao);
    }
    marcarCartoes();

    // O mapa recebe o resultado INTEIRO, e nao a pagina.
    mapa.mostrar(posicoes.pontos || []);
    mapa.setSelecionados(selecao.ids());

    // Enquadrar so quando a consulta NAO segue o mapa: no modo "so na area do
    // mapa", mover a camera mudaria a area, que mudaria o resultado. O laco
    // nao fecharia.
    //
    // Com lugar destacado, quem manda na camera e o contorno dele: enquadrar os
    // pontos por cima faria a borda vermelha sair da vista logo depois de
    // aparecer, e o destaque perderia a razao de existir.
    if (!seguirMapa && !lugarComandaCamera) {
      const caixa = caixaDos(posicoes.pontos);
      if (caixa) mapa.enquadrar(caixa);
    }

    pintarPaginacao(total);
  }

  function pintarPaginacao(total) {
    const paginas = Math.ceil(total / POR_PAGINA);
    if (paginas <= 1) {
      paginacao.replaceChildren();
      return;
    }

    paginaAnteriorBtn.disabled = pagina <= 1;
    paginaProximaBtn.disabled = pagina >= paginas;
    paginaPosicao.textContent = `Página ${pagina} de ${paginas}`;

    // Os nos ja estao na tela na virada de pagina comum. So se inserem quando a
    // paginacao volta a existir, depois de um resultado que cabia numa pagina.
    if (paginaAnteriorBtn.parentNode !== paginacao) {
      paginacao.replaceChildren(paginaAnteriorBtn, paginaPosicao, paginaProximaBtn);
    }
  }

  // ---------------------------------------------------------------------------
  // Estado que veio no link
  // ---------------------------------------------------------------------------
  // Os filtros ja nascem marcados com o que veio na URL (`valorInicial`), e por
  // isso a PRIMEIRA consulta ja os aplica. O nome de cada um chega depois, com
  // as facetas, e ate la o botao mostra o codigo.
  if (bboxDoLink) {
    seguirMapa = true;
    areaCheck.checked = true;
    // Leva a camera ate a caixa do link. Sem isto, o mapa abriria no
    // enquadramento padrao ao lado de uma lista filtrada por outra area.
    const numeros = bboxDoLink.split(',').map(Number);
    if (numeros.length === 4 && numeros.every(Number.isFinite)) {
      mapa.enquadrar(numeros);
    } else {
      bboxDoLink = '';
      seguirMapa = false;
      areaCheck.checked = false;
      showError('A área do link não pôde ser lida. A consulta seguiu sem ela.');
    }
  }

  // Área que veio no link. GeoJSON quebrado no endereço não pode derrubar a
  // tela: a consulta segue sem o recorte, que é o pior caso aceitável.
  const geometriaUrl = query.get('geometria');
  if (geometriaUrl) {
    try {
      const geo = JSON.parse(geometriaUrl);
      if (geo && geo.type === 'Polygon' && Array.isArray(geo.coordinates)) {
        areaDesenhada = geo;
        seguirMapa = false;
        areaCheck.checked = false;
        mapa.mostrarArea(geo);
        atualizarChipArea();
      }
    } catch {
      showError('A área do link não pôde ser lida. A consulta seguiu sem ela.');
    }
  }

  // Lugar que veio no link. Só enquadra quando o link NÃO trouxe recorte
  // próprio: quem mandou um link com área desenhada ou com "só na área do mapa"
  // já escolheu onde a câmera devia parar, e o zoom no estado a tiraria de lá.
  destacarLugar({ enquadrar: !areaDesenhada && !seguirMapa });

  // Enter, Backspace e Escape do desenho. No documento, e não no mapa: o foco
  // costuma estar num campo de filtro quando a pessoa desenha.
  const aoTeclar = (e) => {
    if (e.target && ['INPUT', 'SELECT', 'TEXTAREA'].includes(e.target.tagName)) return;
    mapa.tratarTecla(e);
  };
  document.addEventListener('keydown', aoTeclar);

  const paginaUrl = parseInt(query.get('pagina'), 10);
  if (Number.isFinite(paginaUrl) && paginaUrl > 1) pagina = paginaUrl;

  await consultar();

  return () => {
    disposed = true;
    container.classList.remove('main-content--altura-fixa');
    document.removeEventListener('keydown', aoTeclar);
    buscarComEspera.cancelar();
    buscarPorMapa.cancelar();
    // Os filtros ouvem o DOCUMENTO (clique fora, Escape). Sem isto, a tela
    // seguinte herdaria o ouvinte de uma tela que ja morreu.
    for (const f of [projetoFiltro, loteFiltro, estadoFiltro, municipioFiltro]) f._cleanup();
    mapa.destruir();
  };
}
