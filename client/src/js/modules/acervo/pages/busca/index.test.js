import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

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
  })),
}));

import { renderBusca } from '@modules/acervo/pages/busca/index.js';
import {
  buscarProdutos, buscarGeometrias, baixarBuscaCsv, getBuscaFacetas,
} from '@modules/acervo/services/acervo-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

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
const contador = (c) => c.querySelector('.busca-resultados__contador').textContent;
const ultimaBusca = () => buscarProdutos.mock.calls[buscarProdutos.mock.calls.length - 1][0];

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
  vi.clearAllMocks();
  buscarProdutos.mockImplementation(() => resposta());
  buscarGeometrias.mockImplementation(() => Promise.resolve({
    total: PRODUTOS.length, truncado: false, dados: PRODUTOS,
  }));
  Object.assign(mapaFalso, {
    produtos: null, selecionados: null, extent: null, area: null,
    aoMoverCallback: null, iniciado: false, limpo: false,
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

  // Regressao 2026-07-28: o grid ficou sem `grid-template-rows`, a linha
  // implicita `auto` se dimensionou pelo max-content do painel de cartoes, e o
  // mapa foi esticado para fora da tela. A altura do mapa TEM de vir do
  // contêiner, nunca do conteudo da coluna vizinha.
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

    const opcoesTipo = [...container.querySelectorAll('select')][0].options;
    expect(opcoesTipo[0].textContent).toBe('Todos os tipos');
    // Com o quantitativo ao lado: o numero e o total que a busca devolveria ao
    // escolher aquela opcao.
    expect([...opcoesTipo].map(o => o.textContent)).toContain('Carta Ortoimagem (1)');

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

  test('o mapa enquadra a extensao de TODO o resultado, nao a da pagina', async () => {
    const { cleanup } = await montar();

    expect(mapaFalso.extent).toEqual([-51, -31, -50, -29]);

    cleanup();
  });

  test('clicar no cartao seleciona, e clicar de novo DESSELECIONA', async () => {
    const { container, cleanup } = await montar();

    cartoes(container)[1].click();
    expect(mapaFalso.selecionados).toEqual([11]);
    expect(cartoes(container)[1].classList.contains('busca-cartao--selecionado')).toBe(true);

    // Era o defeito relatado: nao havia como desmarcar o que se marcou.
    cartoes(container)[1].click();
    expect(mapaFalso.selecionados).toEqual([]);
    expect(cartoes(container)[1].classList.contains('busca-cartao--selecionado')).toBe(false);

    cleanup();
  });

  test('clicar no produto NO MAPA alterna a selecao e marca o cartao', async () => {
    const { container, cleanup } = await montar();

    mapaFalso.onAlternarSelecao(10);
    expect(cartoes(container)[0].classList.contains('busca-cartao--selecionado')).toBe(true);

    mapaFalso.onAlternarSelecao(10);
    expect(cartoes(container)[0].classList.contains('busca-cartao--selecionado')).toBe(false);

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

    const tipo = [...container.querySelectorAll('select')][0];
    tipo.value = '9';
    tipo.dispatchEvent(new Event('change'));
    await flush();

    expect(ultimaBusca().tipo_produto_id).toBe('9');
    // Trocar filtro na pagina 3 e continuar na pagina 3 costuma cair num vazio
    // que parece "nao ha nada", quando na verdade ha, na primeira pagina.
    expect(ultimaBusca().page).toBe(1);

    cleanup();
  });

  // O subtipo e o filtro que separa T34-700 de ET-RDG dentro da mesma escala.
  test('filtra por subtipo de produto', async () => {
    const { container, cleanup } = await montar();

    const subtipo = [...container.querySelectorAll('select')][1];
    expect(subtipo.getAttribute('aria-label')).toBe('Subtipo de produto');
    subtipo.value = '2';
    subtipo.dispatchEvent(new Event('change'));
    await flush();

    expect(ultimaBusca().subtipo_produto_id).toBe('2');

    cleanup();
  });

  // Sao 13 subtipos espalhados por 13 tipos: mostrar todos junto de um tipo
  // escolhido oferece combinacao que devolve zero sem dizer por que.
  test('escolher o tipo estreita a lista de subtipos', async () => {
    const { container, cleanup } = await montar();

    const [tipo, subtipo] = [...container.querySelectorAll('select')];
    // "Todos" mais os subtipos COM produto. O terceiro do dominio (Carta
    // Topografica Militar) nao voltou nas facetas, ou seja, tem zero, e por isso
    // nao aparece: e o que "uma opcao preenchida filtra as demais" significa.
    expect(subtipo.options).toHaveLength(3);

    tipo.value = '9'; // Carta Ortoimagem
    tipo.dispatchEvent(new Event('change'));
    await flush();

    const rotulos = [...subtipo.options].map(o => o.textContent);
    expect(rotulos).toEqual(['Todos os subtipos', 'Carta Ortoimagem (1)']);

    cleanup();
  });

  test('trocar o tipo descarta o subtipo que nao pertence a ele', async () => {
    const { container, cleanup } = await montar();

    const [tipo, subtipo] = [...container.querySelectorAll('select')];
    subtipo.value = '2'; // T34-700, do tipo 1
    subtipo.dispatchEvent(new Event('change'));
    await flush();

    tipo.value = '9'; // Carta Ortoimagem: o subtipo 2 nao existe aqui
    tipo.dispatchEvent(new Event('change'));
    await flush();

    expect(subtipo.value).toBe('');
    expect(ultimaBusca().subtipo_produto_id).toBe('');

    cleanup();
  });

  test('subtipo da URL entra na primeira busca', async () => {
    const { cleanup } = await montar({ query: 'subtipo_produto_id=24' });

    expect(ultimaBusca().subtipo_produto_id).toBe('24');

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

// Pedido do chefe em 2026-07-28: "mostrar a quantidade de produtos em cada
// escolha, e uma opcao preenchida deve filtrar as demais". O quantitativo vem
// do servidor ja cruzado; a tela so pinta e decide o que fazer com a escolha
// que zerou.
describe('busca do acervo: quantitativo nos filtros', () => {
  test('as opcoes mostram quantos produtos cada uma tem', async () => {
    const { container, cleanup } = await montar();

    const [tipo, , escala] = [...container.querySelectorAll('select')];
    expect([...tipo.options].map(o => o.textContent)).toEqual([
      'Todos os tipos', 'Carta Topográfica (2)', 'Carta Ortoimagem (1)',
    ]);
    expect([...escala.options].map(o => o.textContent)).toEqual([
      'Todas as escalas', '1:50.000 (2)', '1:25.000 (1)',
    ]);

    cleanup();
  });

  test('as facetas saem com os MESMOS filtros da busca, e junto com ela', async () => {
    const { container, cleanup } = await montar();

    const [tipo] = [...container.querySelectorAll('select')];
    tipo.value = '1';
    tipo.dispatchEvent(new Event('change'));
    await flush();

    const facetas = getBuscaFacetas.mock.calls[getBuscaFacetas.mock.calls.length - 1][0];
    expect(facetas.tipo_produto_id).toBe('1');
    expect(facetas.termo).toBe(ultimaBusca().termo);
    // Uma ida por busca, e nao duas: as tres chamadas saem no mesmo Promise.all.
    expect(getBuscaFacetas).toHaveBeenCalledTimes(buscarProdutos.mock.calls.length);

    cleanup();
  });

  // Descartar em silencio a escolha que zerou faria a tela desfazer o que a
  // pessoa pediu, e ela veria o resultado mudar sem entender por que.
  test('a escolha que o cruzamento zerou FICA na lista, com (0)', async () => {
    const { container, cleanup } = await montar();

    const [tipo] = [...container.querySelectorAll('select')];
    tipo.value = '9';
    tipo.dispatchEvent(new Event('change'));
    await flush();

    getBuscaFacetas.mockResolvedValueOnce({
      tipos_produto: [{ code: 1, nome: 'Carta Topográfica', produtos: 2 }],
      tipos_escala: [],
      subtipos_produto: [],
    });
    // Qualquer busca nova basta para trazer o cruzamento novo.
    container.querySelector('input[type="search"]').value = 'nada';
    tipo.dispatchEvent(new Event('change'));
    await flush();

    expect(tipo.value).toBe('9');
    expect([...tipo.options].map(o => o.textContent)).toContain('Carta Ortoimagem (0)');
    // E continua valendo como filtro: a tela nao mexeu na busca por conta propria.
    expect(ultimaBusca().tipo_produto_id).toBe('9');

    cleanup();
  });

  test('faceta que falha nao derruba a busca', async () => {
    getBuscaFacetas.mockRejectedValueOnce(new Error('sem rede'));
    const { container, cleanup } = await montar();

    expect(cartoes(container)).toHaveLength(2);
    // Sem quantitativo, as opcoes ficam so com o nome.
    const [tipo] = [...container.querySelectorAll('select')];
    expect([...tipo.options].map(o => o.textContent)).toContain('Carta Ortoimagem');

    cleanup();
  });
});

// A sugestao de palavra-chave era um `<datalist>`, e o navegador escolhia
// sozinho a altura: com vinte etiquetas ela abria cobrindo boa parte da tela
// (chefe, 2026-07-28). Agora e um popover nosso, com altura no CSS.
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

    const check = container.querySelector('input[type="checkbox"]');
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
  // qualquer retangulo. Medido em 2026-07-28: 22 produtos achados num quadrado
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

  test('sem area nenhuma, o mapa enquadra o resultado', async () => {
    const { cleanup } = await montar();

    expect(mapaFalso.extent).toEqual([-51, -31, -50, -29]);

    cleanup();
  });

  // Os dois modos sao exclusivos: sem isso o retangulo desenhado sumiria no
  // primeiro arrasto do mapa, sem a pessoa entender por que.
  test('desenhar uma area desliga o modo "seguir o mapa"', async () => {
    const { container, cleanup } = await montar();

    const check = container.querySelector('input[type="checkbox"]');
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
    expect(chamada.tipo_escala_id).toBe('2');
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
    const tipo = [...container.querySelectorAll('select')][0];
    tipo.value = '1';
    tipo.dispatchEvent(new Event('change'));
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
    let resolver;
    buscarProdutos.mockImplementation(() => new Promise((r) => { resolver = r; }));

    const container = document.createElement('div');
    const pronta = renderBusca(container, { params: {}, query: new URLSearchParams() });
    await flush();

    resolver({ total: 2, page: 1, limit: 20, extent: null, dados: PRODUTOS });
    const cleanup = await pronta;
    cleanup();

    // A pagina ja saiu: nada de erro, e nada pintado por engano.
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

    cartoes(container)[0].click();
    expect(barra(container).classList.contains('hidden')).toBe(false);
    expect(barra(container).textContent).toContain('1 produto selecionado');

    cleanup();
  });

  test('seleciona vários e lista o que está selecionado', async () => {
    const { container, cleanup } = await montar();

    cartoes(container)[0].click();
    cartoes(container)[1].click();

    expect(barra(container).textContent).toContain('2 produtos selecionados');
    expect(chips(container)).toEqual(['Porto Alegre', 'Viamão']);
    expect(mapaFalso.selecionados).toEqual([10, 11]);

    cleanup();
  });

  test('o chip remove o próprio produto da seleção', async () => {
    const { container, cleanup } = await montar();

    cartoes(container)[0].click();
    cartoes(container)[1].click();
    container.querySelector('.busca-selecao__chip-remover').click();

    expect(chips(container)).toEqual(['Viamão']);
    expect(mapaFalso.selecionados).toEqual([11]);

    cleanup();
  });

  test('"limpar" esvazia a seleção e apaga o realce do mapa', async () => {
    const { container, cleanup } = await montar();

    cartoes(container)[0].click();
    cartoes(container)[1].click();
    botao(container, 'Limpar').click();

    expect(barra(container).classList.contains('hidden')).toBe(true);
    expect(mapaFalso.selecionados).toEqual([]);
    expect(cartoes(container).some(c => c.classList.contains('busca-cartao--selecionado'))).toBe(false);

    cleanup();
  });

  // Era o terceiro defeito relatado: selecionar não levava a nada.
  test('"ver fichas" abre a ficha dos selecionados, com navegação entre eles', async () => {
    const { container, cleanup } = await montar();

    cartoes(container)[0].click();
    cartoes(container)[1].click();
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

    [...cartoes(container)[0].querySelectorAll('button')]
      .find(b => b.textContent.includes('Ficha')).click();
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

    cartoes(container)[0].click();
    expect(chips(container)).toEqual(['Porto Alegre']);

    [...container.querySelectorAll('.busca-paginacao button')]
      .find(b => b.textContent.includes('Próxima')).click();
    await flush();

    expect(chips(container)).toEqual(['Porto Alegre']);

    cleanup();
  });
});

describe('busca do acervo: mapa e lista se acompanham', () => {
  test('clicar no cartão leva o mapa até aquela carta', async () => {
    const { container, cleanup } = await montar();

    cartoes(container)[1].click();

    expect(mapaFalso.enquadradoProduto).toBe(11);

    cleanup();
  });

  test('apontar o cartão realça o polígono', async () => {
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

  test('exporta o resultado inteiro com os filtros da busca', async () => {
    const { container, cleanup } = await montar({ query: 'termo=porto&tipo_escala_id=2' });

    botaoPorTexto(container, 'Exportar CSV').click();
    await flush();

    const [filtros, nome] = baixarBuscaCsv.mock.calls[0];
    expect(filtros.termo).toBe('porto');
    expect(filtros.tipo_escala_id).toBe('2');
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

    cartoes(container)[0].click();
    expect(botao.classList.contains('hidden')).toBe(false);
    expect(botao.textContent).toContain('Exportar 1 selecionado');

    cartoes(container)[1].click();
    expect(botao.textContent).toContain('Exportar 2 selecionados');

    // Desmarcar tudo o esconde de volta.
    cartoes(container)[0].click();
    cartoes(container)[1].click();
    expect(botao.classList.contains('hidden')).toBe(true);

    cleanup();
  });

  test('exportar selecionados manda só os ids escolhidos, sem perder os filtros', async () => {
    const { container, cleanup } = await montar({ query: 'termo=carta' });

    cartoes(container)[0].click();
    cartoes(container)[1].click();
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
