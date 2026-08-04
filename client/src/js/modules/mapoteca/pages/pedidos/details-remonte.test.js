import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// O QUE ESTE ARQUIVO GUARDA.
//
// O detalhe do pedido remontava a tela INTEIRA a cada gravacao: o `load()`
// limpava o `root` e montava tudo de novo, as tres tabelas inclusive. Quem
// gravava perdia a busca, a ordenacao, a pagina, a selecao e o foco, e a tela
// encolhia e esticava. O chefe mediu isso em 2026-08-04: "quando edita a UI
// reconstroi que torna muito chato ficar editando pois a tela fica se movendo".
//
// Nenhum teste daqui afirma layout nem regra de negocio: os outros quatro
// arquivos desta pasta ja fazem isso. Todos afirmam o que SOBREVIVE a uma
// gravacao, e por isso comparam NO DO DOM, e nao texto: texto igual passa
// mesmo quando o no foi jogado fora e refeito, que e justamente o defeito.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});
vi.mock('@services/plataforma-service.js', async () => {
  const { mockPlataformaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockPlataformaService();
});
vi.mock('@modules/mapoteca/services/acervo-service.js', async () => {
  const { mockAcervoService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockAcervoService();
});
vi.mock('@services/rastreabilidade-service.js', () => ({
  getHistorico: vi.fn(() => Promise.resolve([])),
  getRastreabilidade: vi.fn(() => Promise.resolve({ dados: [], pagination: null })),
  getFiltrosRastreabilidade: vi.fn(() => Promise.resolve({
    modulos: [], entidades: [], origens: [], usuarios: [],
  })),
}));

import { renderPedidoDetails } from '@modules/mapoteca/pages/pedidos/details.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

/**
 * Itens do pedido. Sao 25 para a paginacao existir (a pagina e de 10), e o
 * primeiro tem nome fora da serie para a busca e a ordenacao terem o que fazer.
 */
function produtos() {
  const lista = [{
    id: 900, produto_nome: 'Porto Alegre', mi: '2987-2', inom: 'SH-22-Y-B-VI-2',
    escala: '1:25.000', versao: '1', data_edicao: '2025-01-10', tipo_midia_nome: 'Papel',
    quantidade: 10, quantidade_impressa: 4, quantidade_restante: 6,
    impressao_concluida: false,
  }];
  for (let i = 2; i <= 25; i += 1) {
    lista.push({
      id: 900 + i,
      produto_nome: `Folha ${String(i).padStart(2, '0')}`,
      mi: `30${String(i).padStart(2, '0')}-1`,
      inom: 'SH-22-Y-B-VI-2', escala: '1:50.000', versao: '1',
      data_edicao: '2025-02-10', tipo_midia_nome: 'Papel',
      quantidade: 5, quantidade_impressa: 1, quantidade_restante: 4,
      impressao_concluida: false,
    });
  }
  return lista;
}

// Cada carga devolve OBJETOS NOVOS, como o servidor devolve. Reaproveitar o no
// por referencia passaria de graca; o que se cobra aqui e a identidade por id.
const pedidoNovo = (extra = {}) => ({
  id: 55,
  cliente_id: 7,
  cliente_nome: '1º CGEO',
  tipo_cliente_nome: 'OM EB',
  localizador_pedido: 'AB12-CD34-EF56',
  situacao_pedido_id: 3,
  situacao_pedido_nome: 'Em andamento',
  data_pedido: '2026-06-10',
  prazo: '2026-06-30',
  documento_solicitacao: 'DIEx 123',
  palavras_chave: [],
  produtos: produtos(),
  impressao: { concluida: false, itens_concluidos: 0, total_itens: 25 },
  ...extra,
});

const anexosNovos = () => ([
  {
    id: 41, nome_original: 'diex-123.pdf', tipo_anexo_nome: 'Documento de solicitação (DIEx/Ofício)',
    descricao: null, tamanho_bytes: 2048, data_cadastramento: '2026-06-11T10:00:00Z',
    usuario_cadastramento_nome: 'Cap Fulano',
  },
  {
    id: 42, nome_original: 'anexo-a.pdf', tipo_anexo_nome: 'Outros',
    descricao: 'planta', tamanho_bytes: 4096, data_cadastramento: '2026-06-12T10:00:00Z',
    usuario_cadastramento_nome: 'Sd Beltrano',
  },
]);

const HISTORICO_ITEM = () => ({
  produto_pedido_id: 900,
  quantidade: 10,
  quantidade_impressa: 4,
  quantidade_restante: 6,
  impressao_concluida: false,
  registros: [
    { id: 1, quantidade: 2, observacao: null, data_impressao: '2026-07-28T10:00:00Z', usuario_nome: 'Cap Fulano' },
    { id: 2, quantidade: 1, observacao: null, data_impressao: '2026-07-29T10:00:00Z', usuario_nome: 'Sd Beltrano' },
    { id: 3, quantidade: 1, observacao: 'reimpressão', data_impressao: '2026-07-30T10:00:00Z', usuario_nome: 'Sd Beltrano' },
  ],
});

const secao = (raiz, titulo) => [...raiz.querySelectorAll('.dashboard-section')]
  .find(s => {
    const t = s.querySelector('.dashboard-section__title');
    return t && t.textContent === titulo;
  });

const tabelaProdutos = (raiz) => secao(raiz, 'Produtos do pedido');
const tabelaAnexos = (raiz) => secao(raiz, 'Anexos do pedido');
const linhas = (raiz) => [...raiz.querySelectorAll('tbody tr')];
const buscaProdutos = (raiz) => tabelaProdutos(raiz).querySelector('.data-table-toolbar__search-input');
const paginaProdutos = (raiz) => tabelaProdutos(raiz).querySelector('.pagination__info span').textContent;

const cabecalhoProduto = (raiz) => [...tabelaProdutos(raiz).querySelectorAll('th')]
  .find(th => th.textContent.startsWith('Produto'));

/** O modal mais recente da pilha, que e o que responde ao clique. */
const modalDoTopo = () => [...document.querySelectorAll('.modal')].pop();

const botaoPorTexto = (raiz, texto) => [...raiz.querySelectorAll('button')]
  .filter(b => b.textContent.trim() === texto).pop();

async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderPedidoDetails(container, {
    params: { id: '55' }, query: new URLSearchParams(),
  });
  await flush();
  await flush();
  return { container, cleanup };
}

/**
 * Uma GRAVACAO de verdade, pela tela: registrar impressao do primeiro item
 * visivel. Ela termina chamando o `load()` da pagina, que e o momento em que a
 * tela se remontava.
 */
async function gravar(container) {
  const primeira = linhas(tabelaProdutos(container))[0];
  const botao = [...primeira.querySelectorAll('button')]
    .find(b => (b.title || '').includes('Registrar impressão'));
  botao.click();
  await flush();

  const campo = [...modalDoTopo().querySelectorAll('input[type="number"]')].pop();
  campo.value = '1';
  campo.dispatchEvent(new Event('input'));
  botaoPorTexto(modalDoTopo(), 'Registrar').click();
  await flush();
  await flush();
}

beforeEach(() => {
  // Gerente na mapoteca: e quem abre esta tela, e gerente satisfaz operador.
  saveAuth({ token: 't', administrador: false, uuid: 'u-1', perfis: { mapoteca: 3 } }, 'fulano');
  svc.getPedido.mockImplementation(() => Promise.resolve(pedidoNovo()));
  svc.getAnexosPedido.mockImplementation(() => Promise.resolve(anexosNovos()));
  svc.getImpressaoItem.mockImplementation(() => Promise.resolve(HISTORICO_ITEM()));
  svc.registrarImpressao.mockResolvedValue(null);
  svc.deleteImpressoes.mockResolvedValue(null);
});

afterEach(() => {
  clearAuth();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('detalhe do pedido: a gravacao nao remonta a tela', () => {
  test('a linha do item continua sendo o MESMO no do DOM', async () => {
    const { container, cleanup } = await montar();
    const antes = linhas(tabelaProdutos(container))[0];

    await gravar(container);

    expect(linhas(tabelaProdutos(container))[0]).toBe(antes);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a busca da tabela de itens sobrevive', async () => {
    const { container, cleanup } = await montar();

    const busca = buscaProdutos(container);
    busca.value = 'Porto';
    busca.dispatchEvent(new Event('input'));
    expect(linhas(tabelaProdutos(container))).toHaveLength(1);

    await gravar(container);

    // O proprio campo continua vivo, com o texto digitado, e o filtro continua
    // aplicado. Recriar a tabela zerava os tres.
    expect(buscaProdutos(container)).toBe(busca);
    expect(buscaProdutos(container).value).toBe('Porto');
    expect(linhas(tabelaProdutos(container))).toHaveLength(1);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a ordenacao escolhida sobrevive', async () => {
    const { container, cleanup } = await montar();

    // Sem ordem, o primeiro item e 'Porto Alegre' (a ordem da consulta). Ordenar
    // por Produto poe 'Folha 02' na frente, e e isso que tem de continuar la.
    expect(linhas(tabelaProdutos(container))[0].textContent).toContain('Porto Alegre');
    cabecalhoProduto(container).click();
    expect(linhas(tabelaProdutos(container))[0].textContent).toContain('Folha 02');

    await gravar(container);

    expect(cabecalhoProduto(container).getAttribute('aria-sort')).toBe('ascending');
    expect(linhas(tabelaProdutos(container))[0].textContent).toContain('Folha 02');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a pagina em que a pessoa estava sobrevive', async () => {
    const { container, cleanup } = await montar();

    const proxima = tabelaProdutos(container).querySelector('[aria-label="Próxima página"]');
    proxima.click();
    expect(paginaProdutos(container)).toBe('11-20 de 25');

    await gravar(container);

    expect(paginaProdutos(container)).toBe('11-20 de 25');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o cabecalho e os cards de detalhe nao sao recriados', async () => {
    const { container, cleanup } = await montar();

    const titulo = container.querySelector('.page__title');
    const cards = container.querySelector('.detail-cards');
    const secaoProdutos = tabelaProdutos(container);

    await gravar(container);

    expect(container.querySelector('.page__title')).toBe(titulo);
    expect(container.querySelector('.detail-cards')).toBe(cards);
    expect(tabelaProdutos(container)).toBe(secaoProdutos);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o valor que mudou e escrito NO no, sem trocar a linha do card', async () => {
    const { container, cleanup } = await montar();

    const rotulo = [...container.querySelectorAll('.detail-card__label')]
      .find(e => e.textContent === 'Prazo');
    const valor = rotulo.nextElementSibling;
    expect(valor.textContent).toBe('30/06/2026');

    // A gravacao seguinte devolve um prazo diferente: o texto tem de mudar no
    // MESMO no. Repintar e o oposto de remontar, e as duas metades importam.
    svc.getPedido.mockImplementation(() => Promise.resolve(pedidoNovo({ prazo: '2026-07-15' })));
    await gravar(container);

    expect(rotulo.nextElementSibling).toBe(valor);
    expect(valor.textContent).toBe('15/07/2026');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a tabela de anexos tambem mantem os nos das linhas', async () => {
    const { container, cleanup } = await montar();
    const antes = linhas(tabelaAnexos(container))[0];
    expect(antes.textContent).toContain('diex-123.pdf');

    await gravar(container);

    expect(linhas(tabelaAnexos(container))[0]).toBe(antes);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a secao de historico e recarregada, e nao trocada por outra', async () => {
    const { container, cleanup } = await montar();
    const antes = secao(container, 'Histórico do pedido');

    await gravar(container);

    expect(secao(container, 'Histórico do pedido')).toBe(antes);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a rolagem da pagina sobrevive a gravacao', async () => {
    const { container, cleanup } = await montar();

    const scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', { value: scrollTo, configurable: true, writable: true });
    Object.defineProperty(window, 'scrollY', { value: 304, configurable: true, writable: true });

    await gravar(container);

    expect(scrollTo).toHaveBeenCalledWith(0, 304);

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('detalhe do pedido: o historico de impressao nao remonta', () => {
  /** Abre o modal do historico de impressao do primeiro item. */
  async function abrirHistorico(container) {
    const primeira = linhas(tabelaProdutos(container))[0];
    [...primeira.querySelectorAll('button')]
      .find(b => (b.title || '').includes('Histórico de impressão')).click();
    await flush();
    return modalDoTopo();
  }

  test('excluir uma sessao repinta o modal, sem refazer a tabela', async () => {
    const { container, cleanup } = await montar();
    const modal = await abrirHistorico(container);

    const registros = [...modal.querySelectorAll('tbody tr')];
    expect(registros).toHaveLength(3);
    const sobrevivente = registros[0];
    const resumo = modal.querySelector('.detail-card');

    // A exclusao devolve o item com uma sessao a menos.
    const restante = HISTORICO_ITEM();
    restante.registros = restante.registros.slice(0, 2);
    restante.quantidade_impressa = 3;
    restante.quantidade_restante = 7;
    svc.getImpressaoItem.mockImplementation(() => Promise.resolve(restante));

    [...registros[2].querySelectorAll('button')]
      .find(b => (b.title || '').includes('Excluir registro')).click();
    await flush();
    botaoPorTexto(modalDoTopo(), 'Excluir').click();
    await flush();
    await flush();

    // A linha que ficou e o card do resumo continuam sendo os mesmos nos, e o
    // resumo mostra o numero novo: repintou, nao remontou.
    expect([...modal.querySelectorAll('tbody tr')]).toHaveLength(2);
    expect([...modal.querySelectorAll('tbody tr')][0]).toBe(sobrevivente);
    expect(modal.querySelector('.detail-card')).toBe(resumo);
    expect(resumo.textContent).toContain('3');

    if (typeof cleanup === 'function') cleanup();
  });
});
