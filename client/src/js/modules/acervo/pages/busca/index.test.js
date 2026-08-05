import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O jsdom nao tem WebGL, entao o MapLibre real nao sobe. O dublê registra o que
// a pagina PEDE ao mapa (produtos, enquadramento, selecao), que e o contrato de
// verdade entre os dois: o desenho em si nao e o que este teste protege.
const mapaFalso = vi.hoisted(() => ({
  produtos: null,
  selecionados: null,
  extent: null,
  area: null,
  areaVisivel: [-53, -31, -50, -29],
  apontado: undefined,
  enquadradoProduto: null,
  aoMoverCallback: null,
  // Destaque do lugar filtrado: o ULTIMO limite pintado, se ele enquadrou, e
  // quantas vezes o destaque foi apagado.
  limiteDestacado: null,
  limiteEnquadrou: null,
  limiteLimpo: 0,
  iniciado: false,
  limpo: false,
}));

vi.mock('@modules/acervo/pages/busca/mapa.js', () => ({
  criarMapa: ({ onAlternarSelecao, onApontar, onAreaDesenhada, onAreaCancelada }) => {
    mapaFalso.onAlternarSelecao = onAlternarSelecao;
    mapaFalso.onApontar = onApontar;
    mapaFalso.onAreaDesenhada = onAreaDesenhada;
    mapaFalso.onAreaCancelada = onAreaCancelada;
    return {
      element: document.createElement('div'),
      iniciar: () => { mapaFalso.iniciado = true; return Promise.resolve(); },
      setProdutos: (p) => { mapaFalso.produtos = p; },
      setSelecionados: (ids) => { mapaFalso.selecionados = [...ids]; },
      setApontado: (id) => { mapaFalso.apontado = id; },
      enquadrarProduto: (id) => { mapaFalso.enquadradoProduto = id; return true; },
      enquadrar: (e) => { mapaFalso.extent = e; },
      areaVisivel: () => mapaFalso.areaVisivel,
      aoMover: (cb) => { mapaFalso.aoMoverCallback = cb; },
      mostrarArea: (g) => { mapaFalso.area = g; },
      limparArea: () => { mapaFalso.area = null; },
      destacarLimite: (limite, opcoes) => {
        mapaFalso.limiteDestacado = limite;
        mapaFalso.limiteEnquadrou = !opcoes || opcoes.enquadrar !== false;
      },
      limparLimite: () => { mapaFalso.limiteLimpo += 1; },
      tratarTecla: () => false,
      redimensionar: () => {},
      _cleanup: () => { mapaFalso.limpo = true; },
    };
  },
}));

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  buscarProdutos: vi.fn(),
  buscarGeometrias: vi.fn(),
  baixarBuscaCsv: vi.fn(() => Promise.resolve()),
  getPalavrasChave: vi.fn(() => Promise.resolve([
    { palavra: 'Mapeamento Sistemático', usos: 2275 },
    { palavra: 'CDGV', usos: 1558 },
  ])),
  getTiposProduto: vi.fn(() => Promise.resolve([
    { code: 1, nome: 'Carta Topográfica' },
    { code: 9, nome: 'Carta Ortoimagem' },
  ])),
  getTiposEscala: vi.fn(() => Promise.resolve([
    { code: 2, nome: '1:50.000' },
    { code: 3, nome: '1:25.000' },
  ])),
  getSubtiposProduto: vi.fn(() => Promise.resolve([
    { code: 2, nome: 'Carta Topográfica - T34-700', tipo_id: 1 },
    { code: 24, nome: 'Carta Topográfica Militar', tipo_id: 1 },
    { code: 3, nome: 'Carta Ortoimagem', tipo_id: 9 },
  ])),
  getProdutoDetalhado: vi.fn(() => Promise.resolve({ versoes: [] })),
  // Quantitativo de cada opcao, ja cruzado pelos OUTROS filtros. Os numeros
  // batem com PRODUTOS abaixo de proposito: e o contrato da rota (a contagem da
  // opcao e o total que a busca devolve ao escolhe-la).
  getBuscaFacetas: vi.fn(() => Promise.resolve({
    tipos_produto: [
      { code: 1, nome: 'Carta Topográfica', produtos: 2 },
      { code: 9, nome: 'Carta Ortoimagem', produtos: 1 },
    ],
    tipos_escala: [
      { code: 2, nome: '1:50.000', produtos: 2 },
      { code: 3, nome: '1:25.000', produtos: 1 },
    ],
    subtipos_produto: [
      { code: 2, nome: 'Carta Topográfica - T34-700', tipo_id: 1, produtos: 2 },
      { code: 3, nome: 'Carta Ortoimagem', tipo_id: 9, produtos: 1 },
    ],
    // Lugar vem com `id`, e nao com `code` como as demais facetas: e o que a
    // rota do acervo devolve (`SELECT e.id, ...`), e a pagina o traduz.
    estados: [
      { id: 43, sigla: 'RS', nome: 'Rio Grande do Sul', produtos: 2 },
    ],
    municipios: [
      { id: 4314902, nome: 'Porto Alegre', produtos: 2 },
    ],
  })),
  // Projeto e lote NAO vem das facetas: a rota devolve tipo, escala, subtipo,
  // estado e municipio. Os dois filtros novos leem o dominio, como o formulario
  // de versao ja fazia.
  getProjetos: vi.fn(() => Promise.resolve([
    { id: 1, nome: 'Mapeamento RS' },
    { id: 2, nome: 'Copa 2027' },
  ])),
  getLotes: vi.fn(() => Promise.resolve([
    { id: 7, nome: 'Lote 1', projeto_id: 1 },
    { id: 8, nome: 'Lote 2', projeto_id: 1 },
    { id: 9, nome: 'Lote Único', projeto_id: 2 },
  ])),
}));

vi.mock('@modules/acervo/services/limites-service.js', () => ({
  getLimite: vi.fn(),
}));

import { renderBusca } from '@modules/acervo/pages/busca/index.js';
import {
  buscarProdutos, buscarGeometrias, baixarBuscaCsv, getBuscaFacetas,
} from '@modules/acervo/services/acervo-service.js';
import { getLimite } from '@modules/acervo/services/limites-service.js';

const PRODUTOS = [
  {
    id: 10, nome: 'Porto Alegre', mi: '2965-1', inom: 'SH-22-V-C-IV-1',
    escala: '1:50.000', tipo_produto: 'Carta Topográfica',
    num_versoes: 3, ultima_versao: '2ª Edição', ultima_data_edicao: '2024-05-10',
    palavras_chave: ['Mapeamento Sistemático', 'CDGV'],
    geom: { type: 'Polygon', coordinates: [[[-51, -30], [-51, -29], [-50, -29], [-50, -30], [-51, -30]]] },
  },
  {
    id: 11, nome: 'Viamão', mi: '2965-2', inom: null,
    escala: '1:50.000', tipo_produto: 'Carta Topográfica',
    num_versoes: 1, ultima_versao: '1ª Edição', ultima_data_edicao: '2023-02-01',
    palavras_chave: [],
    geom: { type: 'Polygon', coordinates: [[[-51, -31], [-51, -30], [-50, -30], [-50, -31], [-51, -31]]] },
  },
];

function resposta({ dados = PRODUTOS, total = 2, page = 1, extent = [-51, -31, -50, -29] } = {}) {
  return Promise.resolve({ total, page, limit: 20, extent, dados });
}

// O desenho agora produz um POLIGONO (vertice a vertice, como no fotos_aereas),
// e nao mais um retangulo por arrasto.
const TRIANGULO = {
  type: 'Polygon',
  coordinates: [[[-53, -30], [-52, -30], [-52.5, -29], [-53, -30]]],
};

const cartoes = (c) => [...c.querySelectorAll('.busca-cartao')];
// Quem seleciona é o BOTÃO do rodapé; o cartão abre a ficha. Os casos que só
// querem "marque este produto" usam este atalho, em vez de repetir o seletor e
// ficarem presos ao gesto.
const marcar = (c, i) => c.querySelectorAll('.busca-cartao')[i]
  .querySelector('.busca-cartao__selecionar').click();
const contador = (c) => c.querySelector('.busca-resultados__contador').textContent;
const ultimaBusca = () => buscarProdutos.mock.calls[buscarProdutos.mock.calls.length - 1][0];

// Os filtros de dominio viraram marcacao MULTIPLA. Os auxiliares
// abaixo dirigem o componente pelo mesmo gesto de quem usa a tela: abrir o
// painel, marcar a caixa, fechar.
const filtro = (c, rotuloBotao) => c
  .querySelector(`.filtro-multiplo__botao[aria-label="${rotuloBotao}"]`)
  .closest('.filtro-multiplo');

/** Texto do botao: e o que a pessoa le sem abrir o painel. */
const rotulo = (raiz) => raiz.querySelector('.filtro-multiplo__texto').textContent;

/** Codigos marcados, na ordem em que aparecem no painel. */
const marcados = (raiz) => [...raiz.querySelectorAll('input[type="checkbox"]')]
  .filter(i => i.checked).map(i => i.value);

function abrirFiltro(raiz) {
  const botao = raiz.querySelector('.filtro-multiplo__botao');
  if (botao.getAttribute('aria-expanded') !== 'true') botao.click();
  return botao;
}

/** Marca (ou desmarca) um codigo, e fecha o painel para a repintura entrar. */
function marcarFiltro(raiz, valor, ligado = true) {
  const botao = abrirFiltro(raiz);
  const caixa = raiz.querySelector(`input[type="checkbox"][value="${valor}"]`);
  caixa.checked = ligado;
  caixa.dispatchEvent(new Event('change'));
  botao.click();
}

/** Opcoes do painel como 'Nome (N)', para comparar com o combo antigo. */
function opcoesFiltro(raiz) {
  const botao = abrirFiltro(raiz);
  const itens = [...raiz.querySelectorAll('.filtro-multiplo__opcao')].map((o) => {
    const nome = o.querySelector('.filtro-multiplo__nome').textContent;
    const total = o.querySelector('.filtro-multiplo__total');
    return total ? `${nome} (${total.textContent})` : nome;
  });
  botao.click();
  return itens;
}

async function montar(ctx = {}) {
  const container = document.createElement('div');
  const cleanup = await renderBusca(container, {
    params: {},
    query: new URLSearchParams(ctx.query || ''),
  });
  await flush();
  return { container, cleanup };
}

beforeEach(() => {
  // `resetAllMocks`, e nao `clearAllMocks`: o `clear` zera as CHAMADAS e deixa
  // de pe a fila de `mockResolvedValueOnce`. Um `Once` que o teste dono nao
  // consumiu era servido ao teste seguinte, que recebia facetas parciais e
  // falhava por um motivo que nao era o dele. O `reset` drena a fila e devolve
  // a implementacao original do `vi.fn(impl)`, entao cada teste comeca igual.
  vi.resetAllMocks();
  buscarProdutos.mockImplementation(() => resposta());
  buscarGeometrias.mockImplementation(() => Promise.resolve({
    total: PRODUTOS.length, truncado: false, dados: PRODUTOS,
  }));
  getLimite.mockImplementation((tipo, id) => Promise.resolve({
    tipo, id: Number(id), nome: 'Rio Grande do Sul', sigla: 'RS',
    bbox: [-57.6, -33.7, -49.6, -27.0],
    geometria: {
      type: 'Polygon',
      coordinates: [[[-57.6, -33.7], [-49.6, -33.7], [-49.6, -27], [-57.6, -27], [-57.6, -33.7]]],
    },
  }));
  Object.assign(mapaFalso, {
    produtos: null, selecionados: null, extent: null, area: null,
    aoMoverCallback: null, iniciado: false, limpo: false,
    limiteDestacado: null, limiteEnquadrou: null, limiteLimpo: 0,
    // `enquadradoProduto` ficava de fora e vazava entre testes: um teste que nao
    // enquadra nada ainda via o id do anterior. So aparece quando alguem afirma
    // sobre ele, e foi o que aconteceu ao inverter o gesto do cartao.
    enquadradoProduto: null, apontado: undefined,
  });
  document.body.innerHTML = '';
  location.hash = '#/acervo/busca';
});

afterEach(() => {
  vi.useRealTimers();
});

describe('busca do acervo: montagem', () => {
  test('monta o titulo, o campo de busca e o mapa', async () => {
    const { container, cleanup } = await montar();

    expect(container.querySelector('.busca__titulo').textContent).toBe('Busca no Acervo');
    // O campo de texto e a acao principal: fica no topo, em toda a largura,
    // e nao espremido dentro do painel da lista.
    expect(container.querySelector('.busca__topo .busca-campo__input')).not.toBeNull();
    expect(container.querySelector('.busca__corpo')).not.toBeNull();
    expect(mapaFalso.iniciado).toBe(true);

    cleanup();
  });

  // A altura do mapa vem do contêiner, nunca do conteúdo da coluna vizinha. Sem
  // `grid-template-rows`, a linha implícita `auto` se dimensiona pelo
  // max-content do painel de cartões e estica o mapa para fora da tela.
  test('as duas colunas ficam numa linha de altura definida', async () => {
    const { container, cleanup } = await montar();

    const corpo = container.querySelector('.busca__corpo');
    expect(corpo.children).toHaveLength(2);
    // O painel da lista e o mapa sao irmaos diretos da mesma linha do grid.
    expect(corpo.children[0].classList.contains('busca-painel')).toBe(true);

    cleanup();
  });

  test('preenche os filtros de dominio a partir do servidor', async () => {
    const { container, cleanup } = await montar();

    const tipo = filtro(container, 'Tipo de produto');
    // Sem nada marcado, o botao diz que o filtro nao esta valendo.
    expect(rotulo(tipo)).toBe('Todos os tipos');
    // Com o quantitativo ao lado: o numero e o total que a busca devolveria ao
    // marcar aquela opcao.
    expect(opcoesFiltro(tipo)).toContain('Carta Ortoimagem (1)');

    cleanup();
  });

  // A lista pagina; o mapa, nao. Sao duas chamadas com os MESMOS filtros: a
  // paginada alimenta os cartoes, e a de geometrias alimenta o mapa inteiro.
  test('a lista pagina e NAO pede geometria; o mapa vem da rota propria', async () => {
    const { cleanup } = await montar();

    expect(ultimaBusca().com_geometria).toBe(false);
    expect(ultimaBusca().limit).toBe(20);
    expect(buscarGeometrias).toHaveBeenCalledTimes(1);
    // A camada do mapa nao leva page nem limit: ela e o conjunto todo.
    expect(buscarGeometrias.mock.calls[0][0].page).toBeUndefined();
    expect(mapaFalso.produtos).toHaveLength(2);

    cleanup();
  });

  // Era o defeito relatado: com 20 poligonos numa busca de 800, o mapa afirmava
  // visualmente que o acervo tinha 20 cartas ali.
  test('o mapa mostra TODOS os resultados, nao so a pagina', async () => {
    const muitos = Array.from({ length: 120 }, (_, i) => ({
      id: 500 + i, nome: `Carta ${i}`, escala: '1:50.000',
      geom: { type: 'Polygon', coordinates: [[[-51, -30], [-51, -29], [-50, -29], [-50, -30], [-51, -30]]] },
    }));
    buscarProdutos.mockImplementation(() => resposta({ dados: PRODUTOS, total: 120 }));
    buscarGeometrias.mockImplementation(() => Promise.resolve({
      total: 120, truncado: false, dados: muitos,
    }));

    const { container, cleanup } = await montar();

    expect(cartoes(container)).toHaveLength(2);   // a pagina
    expect(mapaFalso.produtos).toHaveLength(120); // o mapa inteiro

    cleanup();
  });

  test('trocar de pagina nao refaz a camada do mapa', async () => {
    buscarProdutos.mockImplementation(() => resposta({ total: 45 }));
    const { container, cleanup } = await montar();
    expect(buscarGeometrias).toHaveBeenCalledTimes(1);

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Próxima')).click();
    await flush();

    // A pagina mudou, mas o conjunto e o mesmo: repetir 1,4 MB de geometria a
    // cada clique de pagina seria desperdicio puro.
    expect(ultimaBusca().page).toBe(2);
    expect(buscarGeometrias).toHaveBeenCalledTimes(1);

    cleanup();
  });

  test('avisa quando a camada do mapa foi truncada, em vez de mentir por omissao', async () => {
    buscarProdutos.mockImplementation(() => resposta({ total: 30000 }));
    buscarGeometrias.mockImplementation(() => Promise.resolve({
      total: 30000, truncado: true, dados: PRODUTOS,
    }));

    const { container, cleanup } = await montar();

    expect(contador(container)).toContain('o mapa mostra os primeiros');

    cleanup();
  });
});

describe('busca do acervo: resultados', () => {
  test('lista os produtos com identificacao, versao e palavras-chave', async () => {
    const { container, cleanup } = await montar();

    const lista = cartoes(container);
    expect(lista).toHaveLength(2);
    expect(contador(container)).toContain('2 produtos encontrados');

    const primeiro = lista[0].textContent;
    expect(primeiro).toContain('Porto Alegre');
    expect(primeiro).toContain('2965-1');
    expect(primeiro).toContain('SH-22-V-C-IV-1');
    expect(primeiro).toContain('2ª Edição');
    expect(primeiro).toContain('Mapeamento Sistemático');

    cleanup();
  });

  // A mesma folha existe como carta padrao E como Carta Topografica Militar, e
  // no SCA sao PRODUTOS distintos. Sem o subtipo no cartao, os dois saem
  // identicos e a lista parece estar mostrando versoes.
  test('o subtipo que define o produto aparece no cartao', async () => {
    buscarProdutos.mockImplementation(() => resposta({
      dados: [
        { ...PRODUTOS[0], id: 20, subtipo_produto: null },
        { ...PRODUTOS[0], id: 21, subtipo_produto: 'Carta Topográfica Militar' },
      ],
      total: 2,
    }));
    const { container, cleanup } = await montar();

    const [semSubtipo, comSubtipo] = cartoes(container).map(c => c.textContent);
    expect(comSubtipo).toContain('Carta Topográfica · Carta Topográfica Militar');
    // Sem subtipo, o cartao nao ganha separador pendurado.
    expect(semSubtipo).not.toContain('·  ');
    expect(semSubtipo).toContain('Carta Topográfica');

    cleanup();
  });

  test('produto sem versao nao inventa uma', async () => {
    buscarProdutos.mockImplementation(() => resposta({
      dados: [{ id: 3, nome: 'Sem versão', escala: '1:25.000', num_versoes: 0, ultima_versao: null }],
      total: 1,
    }));
    const { container, cleanup } = await montar();

    expect(cartoes(container)[0].textContent).toContain('Sem versão cadastrada');

    cleanup();
  });

  test('resultado vazio explica o que fazer', async () => {
    buscarProdutos.mockImplementation(() => resposta({ dados: [], total: 0, extent: null }));
    const { container, cleanup } = await montar();

    expect(contador(container)).toBe('Nenhum produto encontrado');
    expect(container.querySelector('.busca-lista__vazio').textContent)
      .toContain('Tente um termo mais curto');

    cleanup();
  });

  // O cartão abre a ficha e o botão do rodapé seleciona. O par de casos cobre os
  // dois lados, porque só o primeiro passaria se o botão não fizesse nada.
  test('clicar no cartao abre a FICHA, e nao seleciona', async () => {
    const { container, cleanup } = await montar();

    cartoes(container)[1].click();
    await flush();

    const modal = document.querySelector('.modal');
    expect(modal).not.toBeNull();
    expect(modal.querySelector('.modal__title').textContent).toBe('Viamão');
    // O mapa continua indo ate a carta: fechada a ficha, o poligono ja esta
    // enquadrado atras dela.
    expect(mapaFalso.enquadradoProduto).toBe(11);
    expect(mapaFalso.selecionados).toEqual([]);
    expect(cartoes(container)[1].classList.contains('busca-cartao--selecionado')).toBe(false);

    cleanup();
  });

  test('o botao do rodape seleciona, e clicar de novo DESSELECIONA', async () => {
    const { container, cleanup } = await montar();
    const botao = () => cartoes(container)[1].querySelector('.busca-cartao__selecionar');

    expect(botao().getAttribute('aria-pressed')).toBe('false');

    botao().click();
    expect(mapaFalso.selecionados).toEqual([11]);
    expect(cartoes(container)[1].classList.contains('busca-cartao--selecionado')).toBe(true);
    expect(botao().getAttribute('aria-pressed')).toBe('true');
    expect(botao().textContent).toContain('Selecionado');

    // Era o defeito relatado: nao havia como desmarcar o que se marcou.
    botao().click();
    expect(mapaFalso.selecionados).toEqual([]);
    expect(cartoes(container)[1].classList.contains('busca-cartao--selecionado')).toBe(false);
    expect(botao().getAttribute('aria-pressed')).toBe('false');

    cleanup();
  });

  test('clicar no produto NO MAPA alterna a selecao e marca o cartao', async () => {
    const { container, cleanup } = await montar();

    mapaFalso.onAlternarSelecao([10]);
    expect(cartoes(container)[0].classList.contains('busca-cartao--selecionado')).toBe(true);

    mapaFalso.onAlternarSelecao([10]);
    expect(cartoes(container)[0].classList.contains('busca-cartao--selecionado')).toBe(false);

    cleanup();
  });

  // A mesma folha tem Carta Topografica, CDGV, Ortoimagem, MDS e MDT com a
  // MESMA moldura. Antes o clique pegava so o poligono de cima, e os outros
  // ficavam inalcancaveis pelo mapa.
  test('clicar sobre poligonos SOBREPOSTOS seleciona todos', async () => {
    const { container, cleanup } = await montar();

    mapaFalso.onAlternarSelecao([10, 11]);

    expect(mapaFalso.selecionados.slice().sort()).toEqual([10, 11]);
    expect(cartoes(container)[0].classList.contains('busca-cartao--selecionado')).toBe(true);
    expect(cartoes(container)[1].classList.contains('busca-cartao--selecionado')).toBe(true);

    cleanup();
  });

  // Tudo ou nada: com a pilha inteira marcada, o mesmo clique tira a pilha
  // inteira. Alternando um a um, este clique inverteria cada um e devolveria
  // uma selecao parcial, que e o que a pessoa nao pediu.
  test('clicar de novo na pilha inteira DESSELECIONA todos', async () => {
    const { container, cleanup } = await montar();

    mapaFalso.onAlternarSelecao([10, 11]);
    mapaFalso.onAlternarSelecao([10, 11]);

    expect(mapaFalso.selecionados).toEqual([]);
    expect(cartoes(container)[0].classList.contains('busca-cartao--selecionado')).toBe(false);
    expect(cartoes(container)[1].classList.contains('busca-cartao--selecionado')).toBe(false);

    cleanup();
  });

  // Pilha com um ja marcado: o clique COMPLETA a selecao, em vez de inverter.
  test('pilha parcialmente selecionada completa, em vez de inverter', async () => {
    const { container, cleanup } = await montar();

    mapaFalso.onAlternarSelecao([10]);
    mapaFalso.onAlternarSelecao([10, 11]);

    expect(mapaFalso.selecionados.slice().sort()).toEqual([10, 11]);

    cleanup();
  });
});

describe('busca do acervo: filtros', () => {
  test('digitar espera antes de buscar, e nao dispara por tecla', async () => {
    vi.useFakeTimers();
    const container = document.createElement('div');
    const pronta = renderBusca(container, { params: {}, query: new URLSearchParams() });
    await vi.advanceTimersByTimeAsync(0);
    const cleanup = await pronta;

    const chamadasIniciais = buscarProdutos.mock.calls.length;
    const input = container.querySelector('input[type="search"]');

    input.value = 'porto';
    input.dispatchEvent(new Event('input'));
    input.value = 'porto ale';
    input.dispatchEvent(new Event('input'));
    input.value = 'porto alegre';
    input.dispatchEvent(new Event('input'));

    // Ainda nada: as tres teclas caem dentro da mesma espera.
    expect(buscarProdutos.mock.calls.length).toBe(chamadasIniciais);

    await vi.advanceTimersByTimeAsync(400);
    expect(buscarProdutos.mock.calls.length).toBe(chamadasIniciais + 1);
    expect(ultimaBusca().termo).toBe('porto alegre');

    cleanup();
  });

  test('trocar o tipo de produto busca na hora e volta para a primeira pagina', async () => {
    buscarProdutos.mockImplementation(() => resposta({ total: 45 }));
    const { container, cleanup } = await montar();

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Próxima')).click();
    await flush();
    expect(ultimaBusca().page).toBe(2);

    const tipo = filtro(container, 'Tipo de produto');
    marcarFiltro(tipo, '9');
    await flush();

    expect(ultimaBusca().tipo_produto_id).toEqual(['9']);
    // Trocar filtro na pagina 3 e continuar na pagina 3 costuma cair num vazio
    // que parece "nao ha nada", quando na verdade ha, na primeira pagina.
    expect(ultimaBusca().page).toBe(1);

    cleanup();
  });

  // O subtipo e o filtro que separa T34-700 de ET-RDG dentro da mesma escala.
  test('filtra por subtipo de produto', async () => {
    const { container, cleanup } = await montar();

    const subtipo = filtro(container, 'Subtipo de produto');
    marcarFiltro(subtipo, '2');
    await flush();

    expect(ultimaBusca().subtipo_produto_id).toEqual(['2']);

    cleanup();
  });

  // Sao 13 subtipos espalhados por 13 tipos: mostrar todos junto de um tipo
  // escolhido oferece combinacao que devolve zero sem dizer por que.
  test('escolher o tipo estreita a lista de subtipos', async () => {
    const { container, cleanup } = await montar();

    const tipo = filtro(container, 'Tipo de produto');
    const subtipo = filtro(container, 'Subtipo de produto');
    // Os subtipos COM produto. O terceiro do dominio (Carta Topografica
    // Militar) nao voltou nas facetas, ou seja, tem zero, e por isso nao
    // aparece: e o que "uma opcao marcada filtra as demais" significa.
    expect(opcoesFiltro(subtipo)).toHaveLength(2);

    marcarFiltro(tipo, '9'); // Carta Ortoimagem
    await flush();

    expect(opcoesFiltro(subtipo)).toEqual(['Carta Ortoimagem (1)']);

    cleanup();
  });

  test('trocar o tipo descarta o subtipo que nao pertence a ele', async () => {
    const { container, cleanup } = await montar();

    const tipo = filtro(container, 'Tipo de produto');
    const subtipo = filtro(container, 'Subtipo de produto');
    marcarFiltro(subtipo, '2'); // T34-700, do tipo 1
    await flush();

    marcarFiltro(tipo, '9'); // Carta Ortoimagem: o subtipo 2 nao existe aqui
    await flush();

    expect(marcados(subtipo)).toEqual([]);
    expect(ultimaBusca().subtipo_produto_id).toEqual([]);

    cleanup();
  });

  test('subtipo da URL entra na primeira busca', async () => {
    const { cleanup } = await montar({ query: 'subtipo_produto_id=24' });

    expect(ultimaBusca().subtipo_produto_id).toEqual(['24']);

    cleanup();
  });

  test('limpar filtros zera tudo, inclusive o recorte espacial', async () => {
    const { container, cleanup } = await montar();

    const input = container.querySelector('input[type="search"]');
    input.value = 'x';
    mapaFalso.onAreaDesenhada(TRIANGULO);
    await flush();
    expect(JSON.parse(ultimaBusca().geometria)).toEqual(TRIANGULO);

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Limpar filtros')).click();
    await flush();

    expect(ultimaBusca().termo).toBe('');
    expect(ultimaBusca().geometria).toBeNull();
    expect(mapaFalso.area).toBeNull();

    cleanup();
  });
});

// Pedido do chefe: "mostrar a quantidade de produtos em cada
// escolha, e uma opcao preenchida deve filtrar as demais". O quantitativo vem
// do servidor ja cruzado; a tela so pinta e decide o que fazer com a escolha
// que zerou.
describe('busca do acervo: quantitativo nos filtros', () => {
  test('as opcoes mostram quantos produtos cada uma tem', async () => {
    const { container, cleanup } = await montar();

    const tipo = filtro(container, 'Tipo de produto');
    const escala = filtro(container, 'Escala');
    expect(opcoesFiltro(tipo)).toEqual([
      'Carta Topográfica (2)', 'Carta Ortoimagem (1)',
    ]);
    expect(opcoesFiltro(escala)).toEqual(['1:50.000 (2)', '1:25.000 (1)']);

    cleanup();
  });

  test('as facetas saem com os MESMOS filtros da busca, e junto com ela', async () => {
    const { container, cleanup } = await montar();

    const tipo = filtro(container, 'Tipo de produto');
    marcarFiltro(tipo, '1');
    await flush();

    const facetas = getBuscaFacetas.mock.calls[getBuscaFacetas.mock.calls.length - 1][0];
    expect(facetas.tipo_produto_id).toEqual(['1']);
    expect(facetas.termo).toBe(ultimaBusca().termo);
    // Uma ida por busca, e nao duas: as tres chamadas saem no mesmo Promise.all.
    expect(getBuscaFacetas).toHaveBeenCalledTimes(buscarProdutos.mock.calls.length);

    cleanup();
  });

  // Descartar em silencio a escolha que zerou faria a tela desfazer o que a
  // pessoa pediu, e ela veria o resultado mudar sem entender por que.
  test('a escolha que o cruzamento zerou FICA na lista, com (0)', async () => {
    const { container, cleanup } = await montar();

    const tipo = filtro(container, 'Tipo de produto');
    marcarFiltro(tipo, '9');
    await flush();

    getBuscaFacetas.mockResolvedValueOnce({
      tipos_produto: [{ code: 1, nome: 'Carta Topográfica', produtos: 2 }],
      tipos_escala: [],
      subtipos_produto: [],
    });
    // Qualquer busca nova basta para trazer o cruzamento novo.
    container.querySelector('input[type="search"]').value = 'nada';
    container.querySelector('input[type="search"]').dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 400));
    await flush();

    expect(marcados(tipo)).toEqual(['9']);
    expect(opcoesFiltro(tipo)).toContain('Carta Ortoimagem (0)');
    // E continua valendo como filtro: a tela nao mexeu na busca por conta propria.
    expect(ultimaBusca().tipo_produto_id).toEqual(['9']);

    cleanup();
  });

  test('faceta que falha nao derruba a busca', async () => {
    getBuscaFacetas.mockRejectedValueOnce(new Error('sem rede'));
    const { container, cleanup } = await montar();

    expect(cartoes(container)).toHaveLength(2);
    // Sem quantitativo, as opcoes ficam so com o nome.
    const tipo = filtro(container, 'Tipo de produto');
    expect(opcoesFiltro(tipo)).toContain('Carta Ortoimagem');

    cleanup();
  });
});

// A sugestao de palavra-chave era um `<datalist>`, e o navegador escolhia
// sozinho a altura: com vinte etiquetas ela abria cobrindo boa parte da tela.
// Agora e um popover nosso, com altura no CSS.
describe('busca do acervo: palavra-chave', () => {
  const campo = (c) => c.querySelector('.busca-palavras-campo input');
  const itens = (c) => [...c.querySelectorAll('.busca-palavras__item')];

  test('nao usa mais datalist, e a lista nasce fechada', async () => {
    const { container, cleanup } = await montar();

    expect(container.querySelector('datalist')).toBeNull();
    expect(container.querySelector('.busca-palavras').classList.contains('hidden')).toBe(true);

    cleanup();
  });

  test('focar abre a sugestao com a etiqueta e quantos usos ela tem', async () => {
    const { container, cleanup } = await montar();
    // O relogio falso entra DEPOIS da montagem: `montar` espera por um
    // setTimeout de verdade, e com ele congelado a tela nunca ficaria pronta.
    vi.useFakeTimers();

    campo(container).dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(300);

    const lista = container.querySelector('.busca-palavras');
    expect(lista.classList.contains('hidden')).toBe(false);
    expect(itens(container).map(i => i.textContent)).toEqual([
      'Mapeamento Sistemático2.275', 'CDGV1.558',
    ]);

    cleanup();
  });

  test('escolher uma sugestao vira filtro da busca', async () => {
    const { container, cleanup } = await montar();
    vi.useFakeTimers();

    campo(container).dispatchEvent(new Event('focus'));
    await vi.advanceTimersByTimeAsync(300);
    itens(container)[1].dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
    await vi.advanceTimersByTimeAsync(10);

    expect(campo(container).value).toBe('CDGV');
    expect(ultimaBusca().palavra_chave).toBe('CDGV');
    expect(container.querySelector('.busca-palavras').classList.contains('hidden')).toBe(true);

    cleanup();
  });

  // A sugestao vem limitada a 20 etiquetas, e o acervo tem mais: exigir a
  // escolha na lista impediria buscar a que ficou de fora.
  test('Enter aplica o que foi digitado, mesmo fora da sugestao', async () => {
    const { container, cleanup } = await montar();

    campo(container).value = 'Etiqueta Rara';
    campo(container).dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
    await flush();

    expect(ultimaBusca().palavra_chave).toBe('Etiqueta Rara');

    cleanup();
  });

  test('a palavra-chave da URL nasce no campo', async () => {
    const { container, cleanup } = await montar({ query: 'palavra_chave=CDGV' });

    expect(campo(container).value).toBe('CDGV');
    expect(ultimaBusca().palavra_chave).toBe('CDGV');

    cleanup();
  });
});

describe('busca do acervo: recorte espacial', () => {
  test('desenhar uma area no mapa filtra a busca e mostra o chip', async () => {
    const { container, cleanup } = await montar();

    mapaFalso.onAreaDesenhada(TRIANGULO);
    await flush();

    expect(JSON.parse(ultimaBusca().geometria)).toEqual(TRIANGULO);
    const chip = container.querySelector('.busca-area-chip');
    expect(chip.classList.contains('hidden')).toBe(false);
    expect(chip.textContent).toContain('Área desenhada');

    cleanup();
  });

  test('remover o chip tira o recorte e busca de novo', async () => {
    const { container, cleanup } = await montar();

    mapaFalso.onAreaDesenhada(TRIANGULO);
    await flush();

    container.querySelector('.busca-area-chip__remover').click();
    await flush();

    expect(ultimaBusca().geometria).toBeNull();
    expect(container.querySelector('.busca-area-chip').classList.contains('hidden')).toBe(true);

    cleanup();
  });

  test('seguir a area do mapa usa a area visivel e NAO reenquadra', async () => {
    const { container, cleanup } = await montar();
    mapaFalso.extent = null;

    const check = container.querySelector('.busca-filtros__area input[type="checkbox"]');
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    await flush();

    expect(ultimaBusca().bbox).toEqual(mapaFalso.areaVisivel);
    // Reenquadrar aqui moveria o mapa, que dispararia outra busca: cabo de
    // guerra entre a tela e a pessoa.
    expect(mapaFalso.extent).toBeNull();

    cleanup();
  });

  // Existem produtos de cobertura NACIONAL no acervo, e eles intersectam
  // qualquer retangulo.: 22 produtos achados num quadrado
  // de 15 km no RS devolveram `extent` do Brasil inteiro. Reenquadrar por esse
  // extent jogaria o mapa para o pais todo logo depois de desenhar a area.
  test('desenhar uma area NAO reenquadra o mapa, mesmo com extent gigante', async () => {
    buscarProdutos.mockImplementation(() => resposta({ extent: [-74, -34, -28, 5] }));
    const { cleanup } = await montar();
    mapaFalso.extent = null;

    mapaFalso.onAreaDesenhada(TRIANGULO);
    await flush();

    expect(mapaFalso.extent).toBeNull();

    cleanup();
  });

  // O contraponto do caso acima: sem área, o `extent` da resposta manda na
  // câmera. É ele que prova que a asserção de cima mede alguma coisa.
  test('sem area nenhuma, o mapa enquadra a extensao de TODO o resultado', async () => {
    const { cleanup } = await montar();

    // O extent é o do resultado inteiro, e não o da página.
    expect(mapaFalso.extent).toEqual([-51, -31, -50, -29]);

    cleanup();
  });

  // Os dois modos sao exclusivos: sem isso o retangulo desenhado sumiria no
  // primeiro arrasto do mapa, sem a pessoa entender por que.
  test('desenhar uma area desliga o modo "seguir o mapa"', async () => {
    const { container, cleanup } = await montar();

    const check = container.querySelector('.busca-filtros__area input[type="checkbox"]');
    check.checked = true;
    check.dispatchEvent(new Event('change'));
    await flush();

    mapaFalso.onAreaDesenhada(TRIANGULO);
    await flush();

    expect(check.checked).toBe(false);
    expect(JSON.parse(ultimaBusca().geometria)).toEqual(TRIANGULO);

    cleanup();
  });

  test('mover o mapa fora do modo "seguir" nao busca nada', async () => {
    const { cleanup } = await montar();
    const antes = buscarProdutos.mock.calls.length;

    mapaFalso.aoMoverCallback([-60, -35, -55, -30]);
    await flush();

    expect(buscarProdutos.mock.calls.length).toBe(antes);

    cleanup();
  });
});

describe('busca do acervo: a busca vive na URL', () => {
  test('os filtros da URL entram na primeira busca', async () => {
    const geo = encodeURIComponent(JSON.stringify(TRIANGULO));
    const { container, cleanup } = await montar({
      query: `termo=porto&tipo_escala_id=2&palavra_chave=CDGV&geometria=${geo}`,
    });

    const chamada = ultimaBusca();
    expect(chamada.termo).toBe('porto');
    expect(chamada.tipo_escala_id).toEqual(['2']);
    expect(chamada.palavra_chave).toBe('CDGV');
    expect(JSON.parse(chamada.geometria)).toEqual(TRIANGULO);

    // O recorte que veio no link e DESENHADO no mapa: filtrar por uma area
    // invisivel faria a tela parecer quebrada.
    expect(mapaFalso.area).toEqual(TRIANGULO);
    expect(container.querySelector('.busca-area-chip').classList.contains('hidden')).toBe(false);

    cleanup();
  });

  test('buscar reescreve a URL, para o resultado ser um link', async () => {
    const { container, cleanup } = await montar();

    const input = container.querySelector('input[type="search"]');
    input.value = 'viamão';
    const tipo = filtro(container, 'Tipo de produto');
    marcarFiltro(tipo, '1');
    await flush();

    expect(location.hash).toContain('termo=viam');
    expect(location.hash).toContain('tipo_produto_id=1');

    cleanup();
  });

  test('geometria ilegivel na URL e ignorada em vez de quebrar a tela', async () => {
    const { container, cleanup } = await montar({ query: 'geometria=nao-e-json' });

    expect(ultimaBusca().geometria).toBeNull();
    expect(container.querySelector('.busca-area-chip').classList.contains('hidden')).toBe(true);
    expect(cartoes(container)).toHaveLength(2);

    cleanup();
  });
});

describe('busca do acervo: paginacao', () => {
  test('some quando cabe numa pagina', async () => {
    const { container, cleanup } = await montar();
    expect(container.querySelector('.busca-paginacao').classList.contains('hidden')).toBe(true);
    cleanup();
  });

  test('avanca de pagina sem perder os filtros', async () => {
    buscarProdutos.mockImplementation(() => resposta({ total: 45 }));
    const { container, cleanup } = await montar({ query: 'termo=carta' });

    const paginacao = container.querySelector('.busca-paginacao');
    expect(paginacao.classList.contains('hidden')).toBe(false);
    expect(paginacao.textContent).toContain('Página 1 de 3');

    [...paginacao.querySelectorAll('button')]
      .find(b => b.textContent.includes('Próxima')).click();
    await flush();

    expect(ultimaBusca().page).toBe(2);
    expect(ultimaBusca().termo).toBe('carta');

    cleanup();
  });
});

describe('busca do acervo: limpeza', () => {
  test('sair da pagina destroi o mapa', async () => {
    const { cleanup } = await montar();

    cleanup();

    expect(mapaFalso.limpo).toBe(true);
  });

  test('resposta que chega depois do cleanup nao pinta a tela', async () => {
    // A busca da carga já respondeu e pintou. A tela fica com dois cartões.
    buscarProdutos.mockImplementation(() => resposta({ total: 45 }));
    const { container, cleanup } = await montar();
    expect(cartoes(container)).toHaveLength(2);

    // A SEGUNDA busca fica em voo, e a página sai antes de ela responder.
    let resolver;
    buscarProdutos.mockImplementation(() => new Promise((r) => { resolver = r; }));
    [...container.querySelectorAll('.busca-paginacao button')]
      .find(b => b.textContent.includes('Próxima')).click();
    await flush();

    cleanup();

    const ATRASADO = [{ ...PRODUTOS[0], id: 99, nome: 'Chegou tarde' }];
    resolver({ total: 45, page: 2, limit: 20, extent: [-1, -1, 1, 1], dados: ATRASADO });
    await flush();

    // O guard de descarte segurou a resposta: a lista não recebeu o produto
    // atrasado, e o mapa destruído não foi reenquadrado por ela.
    expect(container.textContent).not.toContain('Chegou tarde');
    expect(mapaFalso.extent).not.toEqual([-1, -1, 1, 1]);
    expect(mapaFalso.limpo).toBe(true);
  });
});

describe('busca do acervo: seleção múltipla', () => {
  const barra = (c) => c.querySelector('.busca-selecao');
  const chips = (c) => [...c.querySelectorAll('.busca-selecao__chip-nome')].map(e => e.textContent);
  const botao = (c, texto) => [...c.querySelectorAll('.busca-selecao button')]
    .find(b => b.textContent.includes(texto));

  test('a barra de seleção só aparece quando há algo selecionado', async () => {
    const { container, cleanup } = await montar();

    expect(barra(container).classList.contains('hidden')).toBe(true);

    marcar(container, 0);
    expect(barra(container).classList.contains('hidden')).toBe(false);
    expect(barra(container).textContent).toContain('1 produto selecionado');

    cleanup();
  });

  test('seleciona vários e lista o que está selecionado', async () => {
    const { container, cleanup } = await montar();

    marcar(container, 0);
    marcar(container, 1);

    expect(barra(container).textContent).toContain('2 produtos selecionados');
    expect(chips(container)).toEqual(['Porto Alegre', 'Viamão']);
    expect(mapaFalso.selecionados).toEqual([10, 11]);

    cleanup();
  });

  test('o chip remove o próprio produto da seleção', async () => {
    const { container, cleanup } = await montar();

    marcar(container, 0);
    marcar(container, 1);
    container.querySelector('.busca-selecao__chip-remover').click();

    expect(chips(container)).toEqual(['Viamão']);
    expect(mapaFalso.selecionados).toEqual([11]);

    cleanup();
  });

  test('"limpar" esvazia a seleção e apaga o realce do mapa', async () => {
    const { container, cleanup } = await montar();

    marcar(container, 0);
    marcar(container, 1);
    botao(container, 'Limpar').click();

    expect(barra(container).classList.contains('hidden')).toBe(true);
    expect(mapaFalso.selecionados).toEqual([]);
    expect(cartoes(container).some(c => c.classList.contains('busca-cartao--selecionado'))).toBe(false);

    cleanup();
  });

  // Era o terceiro defeito relatado: selecionar não levava a nada.
  test('"ver fichas" abre a ficha dos selecionados, com navegação entre eles', async () => {
    const { container, cleanup } = await montar();

    marcar(container, 0);
    marcar(container, 1);
    botao(container, 'Ver fichas').click();
    await flush();

    const modal = document.querySelector('.modal');
    expect(modal).not.toBeNull();
    expect(modal.querySelector('.modal__title').textContent).toBe('Porto Alegre');
    // Com mais de um selecionado, a ficha navega em vez de abrir uma pilha de janelas.
    expect(modal.querySelector('.produto-ficha__posicao').textContent).toBe('1 de 2');

    [...modal.querySelectorAll('button')].find(b => b.textContent.includes('Próxima')).click();
    await flush();
    expect(modal.querySelector('.modal__title').textContent).toBe('Viamão');
    expect(modal.querySelector('.produto-ficha__posicao').textContent).toBe('2 de 2');

    cleanup();
  });

  test('a ficha de um produto só não mostra navegação', async () => {
    const { container, cleanup } = await montar();

    // Quem abre a ficha é o cartão; o botão do rodapé seleciona.
    cartoes(container)[0].click();
    await flush();

    const modal = document.querySelector('.modal');
    expect(modal.querySelector('.produto-ficha__posicao')).toBeNull();
    // Abrir a ficha NÃO seleciona: são gestos diferentes. A carga inicial já
    // sincroniza o mapa com a seleção vazia, então o que se afirma é que ela
    // continua vazia.
    expect(mapaFalso.selecionados).toEqual([]);
    expect(container.querySelector('.busca-selecao').classList.contains('hidden')).toBe(true);

    cleanup();
  });

  // O produto clicado no mapa pode estar numa página que não está na tela.
  test('selecionar pelo mapa funciona para produto fora da página atual', async () => {
    buscarGeometrias.mockImplementation(() => Promise.resolve({
      total: 3, truncado: false,
      dados: [...PRODUTOS, { id: 99, nome: 'Fora da página', escala: '1:25.000' }],
    }));
    const { container, cleanup } = await montar();

    mapaFalso.onAlternarSelecao(99);

    expect(chips(container)).toEqual(['Fora da página']);

    cleanup();
  });

  test('a seleção sobrevive à troca de página', async () => {
    buscarProdutos.mockImplementation(() => resposta({ total: 45 }));
    const { container, cleanup } = await montar();

    marcar(container, 0);
    expect(chips(container)).toEqual(['Porto Alegre']);

    [...container.querySelectorAll('.busca-paginacao button')]
      .find(b => b.textContent.includes('Próxima')).click();
    await flush();

    expect(chips(container)).toEqual(['Porto Alegre']);

    cleanup();
  });
});

// Que o clique no cartão enquadre o mapa está provado no caso 'clicar no cartao
// abre a FICHA, e nao seleciona': repetir aqui seria o mesmo clique com a mesma
// asserção.
describe('busca do acervo: mapa e lista se acompanham', () => {
  test('apontar o cartão realça o polígono, e tirar o mouse o apaga', async () => {
    const { container, cleanup } = await montar();

    cartoes(container)[0].dispatchEvent(new Event('mouseenter'));
    expect(mapaFalso.apontado).toBe(10);

    cartoes(container)[0].dispatchEvent(new Event('mouseleave'));
    expect(mapaFalso.apontado).toBeNull();

    cleanup();
  });

  test('apontar o polígono realça o cartão', async () => {
    const { container, cleanup } = await montar();

    mapaFalso.onApontar(11);
    expect(cartoes(container)[1].classList.contains('busca-cartao--apontado')).toBe(true);
    expect(cartoes(container)[0].classList.contains('busca-cartao--apontado')).toBe(false);

    mapaFalso.onApontar(null);
    expect(cartoes(container).some(c => c.classList.contains('busca-cartao--apontado'))).toBe(false);

    cleanup();
  });
});

describe('busca do acervo: exportar CSV', () => {
  const botaoPorTexto = (c, texto) => [...c.querySelectorAll('.busca__acoes button')]
    .find(b => b.textContent.includes(texto));

  // Pedido do chefe. O que se exporta e o resultado dos filtros,
  // entao a acao pertence a linha deles; e o topo perde uma faixa, que vira
  // altura para a lista e o mapa.
  test('as acoes ficam na mesma linha dos filtros, e nao num cabecalho proprio', async () => {
    const { container, cleanup } = await montar();

    const acoes = container.querySelector('.busca__acoes');
    expect(acoes.closest('.busca-filtros')).not.toBeNull();
    // "Limpar filtros" desceu junto: as duas sao acoes sobre o mesmo recorte.
    expect([...acoes.querySelectorAll('button')].map(b => b.textContent))
      .toEqual(['Limpar filtros', 'Exportar selecionados', 'Exportar CSV']);

    cleanup();
  });

  test('exporta o resultado inteiro com os filtros da busca', async () => {
    const { container, cleanup } = await montar({ query: 'termo=porto&tipo_escala_id=2' });

    botaoPorTexto(container, 'Exportar CSV').click();
    await flush();

    const [filtros, nome] = baixarBuscaCsv.mock.calls[0];
    expect(filtros.termo).toBe('porto');
    expect(filtros.tipo_escala_id).toEqual(['2']);
    // Sem ids: o CSV é do conjunto todo, e não da página exibida.
    expect(filtros.ids).toBeNull();
    expect(nome).toBe('busca-acervo.csv');

    cleanup();
  });

  test('o botão de exportar selecionados só aparece quando há seleção', async () => {
    const { container, cleanup } = await montar();

    // O botão existe no DOM desde o início, mas fica escondido: um botão
    // permanentemente desativado seria ruído no cabeçalho.
    const botao = botaoPorTexto(container, 'Exportar selecionado');
    expect(botao.classList.contains('hidden')).toBe(true);

    marcar(container, 0);
    expect(botao.classList.contains('hidden')).toBe(false);
    expect(botao.textContent).toContain('Exportar 1 selecionado');

    marcar(container, 1);
    expect(botao.textContent).toContain('Exportar 2 selecionados');

    // Desmarcar tudo o esconde de volta.
    marcar(container, 0);
    marcar(container, 1);
    expect(botao.classList.contains('hidden')).toBe(true);

    cleanup();
  });

  test('exportar selecionados manda só os ids escolhidos, sem perder os filtros', async () => {
    const { container, cleanup } = await montar({ query: 'termo=carta' });

    marcar(container, 0);
    marcar(container, 1);
    botaoPorTexto(container, 'Exportar 2 selecionados').click();
    await flush();

    const [filtros, nome] = baixarBuscaCsv.mock.calls[0];
    expect(filtros.ids).toBe('10,11');
    expect(filtros.termo).toBe('carta');
    expect(nome).toBe('selecionados-acervo.csv');

    cleanup();
  });

  test('falha na exportação não derruba a tela', async () => {
    baixarBuscaCsv.mockRejectedValueOnce(new Error('volume indisponível'));
    const { container, cleanup } = await montar();

    const botao = botaoPorTexto(container, 'Exportar CSV');
    botao.click();
    await flush();

    expect(botao.disabled).toBe(false);
    expect(cartoes(container)).toHaveLength(2);

    cleanup();
  });
});

describe('busca do acervo: carregamento', () => {
  test('a lista nasce com esqueleto, e não vazia, enquanto a busca não volta', async () => {
    // Segura a busca para observar o estado intermediário, que é justamente o
    // que a pessoa via em branco antes.
    let liberar;
    buscarProdutos.mockImplementation(() => new Promise((r) => { liberar = r; }));

    const container = document.createElement('div');
    const pronta = renderBusca(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.querySelectorAll('.busca-esqueleto').length).toBeGreaterThan(0);
    expect(container.querySelector('.busca-lista').getAttribute('aria-busy')).toBe('true');
    expect(contador(container)).toBe('Buscando...');

    liberar({ total: 2, page: 1, limit: 20, extent: null, dados: PRODUTOS });
    const cleanup = await pronta;
    await flush();

    // Chegou o resultado: o esqueleto sai e os cartões entram.
    expect(container.querySelectorAll('.busca-esqueleto')).toHaveLength(0);
    expect(cartoes(container)).toHaveLength(2);
    expect(container.querySelector('.busca-lista').hasAttribute('aria-busy')).toBe(false);

    cleanup();
  });

  test('o esqueleto aparece já na montagem, antes dos domínios voltarem', async () => {
    const container = document.createElement('div');
    // Sem await: o que se afirma é o estado do primeiro instante, quando os
    // domínios dos filtros ainda estão a caminho.
    const pronta = renderBusca(container, { params: {}, query: new URLSearchParams() });

    expect(container.querySelectorAll('.busca-esqueleto').length).toBeGreaterThan(0);

    const cleanup = await pronta;
    await flush();
    cleanup();
  });
});

describe('busca do acervo: altura da tela', () => {
  // A barra de rolagem só deve existir quando o conteúdo de fato não cabe. A
  // altura mora na área de conteúdo, que já conhece a navbar e o próprio
  // padding; a página só declara que precisa dela.
  test('marca a área de conteúdo como altura fixa, e desfaz ao sair', async () => {
    const container = document.createElement('div');
    const cleanup = await renderBusca(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.classList.contains('main-content--altura-fixa')).toBe(true);

    cleanup();

    // Sem isto, a próxima rota herdaria a altura travada e perderia o rolamento.
    expect(container.classList.contains('main-content--altura-fixa')).toBe(false);
  });
});

// --- Destaque do lugar filtrado --------------------------
//
// O filtro por lugar era invisivel no mapa: escolher um estado mudava a lista e
// deixava a camera onde estava, entao a tela nao dizia ONDE o recorte caiu.
describe('busca do acervo: destaque do lugar', () => {
  test('marcar o estado pinta o contorno e leva a camera ate ele', async () => {
    const { container } = await montar();
    const estado = filtro(container, 'Estado');

    marcarFiltro(estado, '43');
    await flush();

    expect(getLimite).toHaveBeenCalledWith('estado', '43');
    // Uma LISTA de limites: o filtro marca varios estados.
    expect(mapaFalso.limiteDestacado[0].bbox).toEqual([-57.6, -33.7, -49.6, -27.0]);
    expect(mapaFalso.limiteEnquadrou).toBe(true);
  });

  test('o MUNICIPIO ganha do estado: e o recorte mais estreito', async () => {
    const { container } = await montar();
    const estado = filtro(container, 'Estado');
    marcarFiltro(estado, '43');
    await flush();

    const municipio = filtro(container, 'Município');
    marcarFiltro(municipio, '4314902');
    await flush();

    expect(getLimite).toHaveBeenLastCalledWith('municipio', '4314902');
  });

  test('tirar o lugar apaga o contorno', async () => {
    const { container } = await montar();
    const estado = filtro(container, 'Estado');

    marcarFiltro(estado, '43');
    await flush();
    expect(mapaFalso.limiteLimpo).toBe(0);

    marcarFiltro(estado, '43', false);
    await flush();

    expect(mapaFalso.limiteLimpo).toBe(1);
  });

  test('com lugar destacado, o `extent` do resultado NAO reenquadra por cima', async () => {
    const { container } = await montar();
    // Sem lugar, a busca enquadra no extent, como sempre fez.
    expect(mapaFalso.extent).not.toBeNull();

    mapaFalso.extent = null;
    const estado = filtro(container, 'Estado');
    marcarFiltro(estado, '43');
    await flush();

    // Aqui o extent e ainda pior do que na tela de ponto: existem produtos de
    // cobertura NACIONAL, e eles intersectam qualquer recorte, entao o extent de
    // uma busca por um municipio podia ser o Brasil inteiro.
    expect(mapaFalso.extent).toBeNull();
  });

  test('"Limpar filtros" tira tambem o contorno do lugar', async () => {
    const { container } = await montar();
    const estado = filtro(container, 'Estado');
    marcarFiltro(estado, '43');
    await flush();

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Limpar filtros')).click();
    await flush();

    expect(mapaFalso.limiteLimpo).toBe(1);
  });

  test('o lugar que veio no LINK aparece destacado', async () => {
    await montar({ query: 'estado_id=43' });

    expect(getLimite).toHaveBeenCalledWith('estado', '43');
    expect(mapaFalso.limiteEnquadrou).toBe(true);
  });

  test('link com area desenhada destaca o lugar SEM mover a camera', async () => {
    await montar({
      query: `estado_id=43&geometria=${encodeURIComponent(JSON.stringify(TRIANGULO))}`,
    });

    // Quem mandou o link ja escolheu onde a camera devia parar. O zoom no
    // estado jogaria a area desenhada para fora da tela.
    expect(mapaFalso.limiteDestacado).not.toBeNull();
    expect(mapaFalso.limiteEnquadrou).toBe(false);
  });

  test('o contorno que falha nao derruba a busca', async () => {
    getLimite.mockImplementation(() => Promise.reject(new Error('sem rede')));
    const { container } = await montar();
    const estado = filtro(container, 'Estado');

    marcarFiltro(estado, '43');
    await flush();

    // O destaque e apoio visual. Sem ele a tela perde a borda, e nao a lista.
    expect(mapaFalso.limiteDestacado).toBeNull();
    expect(cartoes(container)).toHaveLength(2);
    expect(ultimaBusca().estado_id).toEqual(['43']);
  });

  test('marcar DOIS estados destaca os dois e enquadra a uniao', async () => {
    getBuscaFacetas.mockResolvedValue({
      tipos_produto: [], tipos_escala: [], subtipos_produto: [],
      estados: [
        { id: 43, sigla: 'RS', nome: 'Rio Grande do Sul', produtos: 2 },
        { id: 42, sigla: 'SC', nome: 'Santa Catarina', produtos: 1 },
      ],
      municipios: [],
    });
    const { container } = await montar();
    const estado = filtro(container, 'Estado');

    marcarFiltro(estado, '43');
    await flush();
    marcarFiltro(estado, '42');
    await flush();

    // Enquadrar so o primeiro deixaria o outro fora da tela, dizendo que o
    // recorte e menor do que e.
    expect(mapaFalso.limiteDestacado).toHaveLength(2);
    expect(ultimaBusca().estado_id).toEqual(['43', '42']);
  });
});

describe('busca do acervo: filtro por projeto e lote', () => {
  // O servidor sempre aceitou `projeto_id` e `lote_id` (`filtrosBusca`, em
  // server/src/acervo/acervo_schema.js) e a tela nao os oferecia: "que cartas
  // sairam do lote 3" so tinha resposta pelo SQL ou pelo plugin.
  test('marcar um projeto manda projeto_id na busca e no endereco', async () => {
    const { container, cleanup } = await montar();

    marcarFiltro(filtro(container, 'Projeto'), '1');
    await flush();

    expect(ultimaBusca().projeto_id).toEqual(['1']);
    expect(location.hash).toContain('projeto_id=1');

    cleanup();
  });

  test('o lote leva o nome do projeto, para "Lote 1" nao virar dois iguais', async () => {
    const { container, cleanup } = await montar();

    expect(opcoesFiltro(filtro(container, 'Lote'))).toEqual([
      'Mapeamento RS · Lote 1',
      'Mapeamento RS · Lote 2',
      'Copa 2027 · Lote Único',
    ]);

    cleanup();
  });

  test('escolher o projeto estreita a lista de lotes', async () => {
    const { container, cleanup } = await montar();

    marcarFiltro(filtro(container, 'Projeto'), '2');
    await flush();

    // O lote de outro projeto SAI da lista, e nao fica com "(0)": ele deixou de
    // fazer sentido, e mantido daria dois filtros que nunca se cruzam.
    expect(opcoesFiltro(filtro(container, 'Lote'))).toEqual(['Copa 2027 · Lote Único']);

    cleanup();
  });

  test('lote marcado que nao pertence ao projeto escolhido e descartado', async () => {
    const { container, cleanup } = await montar();

    marcarFiltro(filtro(container, 'Lote'), '7');
    await flush();
    expect(ultimaBusca().lote_id).toEqual(['7']);

    marcarFiltro(filtro(container, 'Projeto'), '2');
    await flush();

    expect(ultimaBusca().lote_id).toEqual([]);
    expect(marcados(filtro(container, 'Lote'))).toEqual([]);

    cleanup();
  });

  test('o link traz projeto e lote ja marcados', async () => {
    const { container, cleanup } = await montar({ query: 'projeto_id=1&lote_id=8' });

    expect(ultimaBusca().projeto_id).toEqual(['1']);
    expect(ultimaBusca().lote_id).toEqual(['8']);
    expect(rotulo(filtro(container, 'Projeto'))).toBe('Mapeamento RS');

    cleanup();
  });

  test('"Limpar filtros" apaga projeto e lote', async () => {
    const { container, cleanup } = await montar({ query: 'projeto_id=1&lote_id=8' });

    [...container.querySelectorAll('.btn--text')]
      .find(b => b.textContent.includes('Limpar filtros')).click();
    await flush();

    expect(ultimaBusca().projeto_id).toEqual([]);
    expect(ultimaBusca().lote_id).toEqual([]);

    cleanup();
  });
});

describe('busca do acervo: a recarga nao desmonta o que esta na tela', () => {
  // A REGRA DE OURO do projeto: salvar nao pode reconstruir a tela. Antes, toda
  // busca chamava `replaceChildren` na lista e pintava o esqueleto de novo:
  // esvaziar a lista zera a altura rolavel, e o navegador prende a rolagem no
  // topo. Salvar uma versao na ficha devolvia a busca ao primeiro cartao.
  test('a segunda busca reaproveita os NOS dos cartoes que continuam no resultado', async () => {
    const { container, cleanup } = await montar();

    const antes = cartoes(container);
    expect(antes).toHaveLength(2);

    marcarFiltro(filtro(container, 'Tipo de produto'), '1');
    await flush();

    const depois = cartoes(container);
    expect(depois).toHaveLength(2);
    // Mesmos nos, e nao nos novos com o mesmo texto. E o que preserva a
    // rolagem e o foco do teclado.
    expect(depois[0]).toBe(antes[0]);
    expect(depois[1]).toBe(antes[1]);

    cleanup();
  });

  test('o cartao cujo conteudo mudou e repintado, e o vizinho nao', async () => {
    const { container, cleanup } = await montar();
    const antes = cartoes(container);

    buscarProdutos.mockImplementation(() => resposta({
      dados: [{ ...PRODUTOS[0], nome: 'Porto Alegre (revisado)' }, PRODUTOS[1]],
    }));

    marcarFiltro(filtro(container, 'Tipo de produto'), '1');
    await flush();

    const depois = cartoes(container);
    expect(depois[0].querySelector('.busca-cartao__nome').textContent)
      .toBe('Porto Alegre (revisado)');
    expect(depois[1]).toBe(antes[1]);

    cleanup();
  });

  test('o esqueleto nao volta depois da primeira carga', async () => {
    const { container, cleanup } = await montar();
    expect(container.querySelectorAll('.busca-esqueleto')).toHaveLength(0);

    // Segura a segunda busca: e nela que o esqueleto reaparecia, apagando os
    // cartoes que a pessoa estava lendo.
    let liberar;
    buscarProdutos.mockImplementation(() => new Promise((r) => { liberar = r; }));

    marcarFiltro(filtro(container, 'Tipo de produto'), '1');
    await flush();

    expect(container.querySelectorAll('.busca-esqueleto')).toHaveLength(0);
    expect(cartoes(container)).toHaveLength(2);
    expect(contador(container)).toBe('Buscando...');

    liberar({ total: 2, page: 1, limit: 20, extent: null, dados: PRODUTOS });
    await flush();

    cleanup();
  });
});

describe('busca do acervo: falha da API', () => {
  // "Nenhum produto encontrado" e "nao consegui perguntar" pedem acoes opostas:
  // a primeira manda afrouxar o filtro, a segunda manda tentar de novo.
  test('a falha vira estado de erro, e nao a frase do resultado vazio', async () => {
    buscarProdutos.mockImplementation(() => Promise.reject(new Error('Falha de rede')));

    const { container, cleanup } = await montar();

    expect(container.querySelector('.dashboard-erro')).not.toBeNull();
    expect(container.querySelector('.dashboard-erro__detalhe').textContent)
      .toBe('Falha de rede');
    // A frase do resultado vazio NAO pode aparecer aqui.
    expect(container.querySelector('.busca-lista__vazio')).toBeNull();
    expect(contador(container)).toBe('Não foi possível buscar');

    cleanup();
  });

  test('"Tentar de novo" refaz a busca e devolve os cartoes', async () => {
    buscarProdutos.mockImplementation(() => Promise.reject(new Error('Falha de rede')));
    const { container, cleanup } = await montar();

    buscarProdutos.mockImplementation(() => resposta());
    container.querySelector('.dashboard-erro .btn').click();
    await flush();

    expect(container.querySelector('.dashboard-erro')).toBeNull();
    expect(cartoes(container)).toHaveLength(2);

    cleanup();
  });
});
