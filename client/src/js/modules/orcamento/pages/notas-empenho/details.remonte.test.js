import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// O que estes testes protegem: a ficha da NE NAO se remonta a cada gravacao.
//
// O defeito medido em 2026-08-04: `renderNota` limpava a raiz inteira e criava
// as duas data-table de novo dentro do `load()`. Gravar uma liquidacao trocava
// todos os nos da tela. A ordenacao escolhida voltava ao padrao, o foco do
// teclado caia no `body`, e o painel de historico saia da tela, porque o
// `clearChildren(root)` levava junto o no que tinha sido pendurado depois.
//
// Arquivo SEPARADO por assunto: aqui nao se testa regra de negocio da NE, e sim
// o que sobrevive a uma gravacao.

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotaEmpenho: vi.fn(),
  getLiquidacoes: vi.fn(),
  createLiquidacao: vi.fn(() => Promise.resolve({})),
  updateLiquidacao: vi.fn(() => Promise.resolve({})),
  deleteLiquidacao: vi.fn(() => Promise.resolve({})),
  getRecebimentos: vi.fn(),
  createRecebimento: vi.fn(() => Promise.resolve({})),
  updateRecebimento: vi.fn(() => Promise.resolve({})),
  deleteRecebimento: vi.fn(() => Promise.resolve({})),
}));

// O historico e componente proprio, com service proprio: o mock dele sao tres
// funcoes, e nao a fabrica inteira de um service grande.
vi.mock('@services/rastreabilidade-service.js', () => ({
  getHistorico: vi.fn(() => Promise.resolve([])),
  getRastreabilidade: vi.fn(() => Promise.resolve({ dados: [], pagination: null })),
  getFiltrosRastreabilidade: vi.fn(() => Promise.resolve({
    modulos: [], entidades: [], origens: [], usuarios: [],
  })),
}));

// O dialogo de confirmacao vira "sim" direto: o caminho testado e o do RELOAD
// depois da gravacao, e nao o da pergunta.
vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
}));

import { renderNotaEmpenhoDetails } from '@modules/orcamento/pages/notas-empenho/details.js';
import {
  getNotaEmpenho, getLiquidacoes, getRecebimentos, deleteLiquidacao,
} from '@modules/orcamento/services/orcamento-service.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const NOTA = {
  id: 10,
  numero: '2026NE000123',
  ano: 2026,
  nota_credito_id: 5,
  nota_credito_numero: '2026NC000045',
  notas_credito: [
    { nota_credito_id: 5, nota_credito_numero: '2026NC000045', valor: 1000 },
  ],
  cod_nd: '449052',
  nd_nome: 'Equipamentos de processamento de dados',
  valor_empenhado: 1000,
  valor_anulado: 0,
  saldo_a_liquidar: 400,
};

const LIQUIDACOES = [
  { id: 1, valor_liquidado: 600, data: '2026-03-10', documento_ns: '2026NS000001' },
  { id: 2, valor_liquidado: 200, data: '2026-01-05', documento_ns: '2026NS000002' },
];

const RECEBIMENTOS = [
  { id: 20, material: 'Plotter A0', prazo_entrega: '30 dias', situacao: 'Entregue' },
];

/** A secao de liquidacoes e a primeira; a de recebimentos, a segunda. */
const secao = (c, i) => c.querySelectorAll('.dashboard-section')[i];
const tabela = (c, i) => secao(c, i).querySelector('.data-table-wrapper');
const novaBtn = (c) => secao(c, 0).querySelector('.dashboard-section__controls button');
const acao = (c, titulo) => c.querySelector(`.data-table__action-btn[title="${titulo}"]`);
const valorDe = (c, rotulo) => [...c.querySelectorAll('.detail-card__row')]
  .find(r => r.querySelector('.detail-card__label').textContent === rotulo)
  .querySelector('.detail-card__value');

/** Exclui a primeira liquidacao. E o caminho mais curto ate um `load()` novo. */
async function gravar(container) {
  acao(container, 'Excluir liquidação').click();
  await flush();
  await flush();
}

async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderNotaEmpenhoDetails(container, { params: { id: '10' } });
  await flush();
  return { container, cleanup };
}

beforeEach(() => {
  // Gerente do orcamento: e o perfil que ve as duas tabelas com editar e excluir.
  saveAuth({ token: 't', administrador: false, uuid: 'u-1', perfis: { orcamento: 3 } }, 'fulano');
  getNotaEmpenho.mockImplementation(() => Promise.resolve({ ...NOTA }));
  getLiquidacoes.mockImplementation(() => Promise.resolve([...LIQUIDACOES]));
  getRecebimentos.mockImplementation(() => Promise.resolve([...RECEBIMENTOS]));
  deleteLiquidacao.mockImplementation(() => Promise.resolve({}));
});

afterEach(() => {
  clearAuth();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ficha da NE: a gravacao nao remonta a tela', () => {
  test('as duas tabelas sao as MESMAS depois de gravar', async () => {
    const { container, cleanup } = await montar();
    const liquidacoes = tabela(container, 0);
    const recebimentos = tabela(container, 1);
    expect(liquidacoes).toBeTruthy();

    await gravar(container);

    // Criar a tabela de novo joga fora busca, ordenacao, pagina e selecao, e e
    // o que faz a tela "se mover" a cada edicao.
    expect(tabela(container, 0)).toBe(liquidacoes);
    expect(tabela(container, 1)).toBe(recebimentos);
    cleanup();
  });

  test('a ordenacao escolhida sobrevive a gravacao', async () => {
    const { container, cleanup } = await montar();
    const cabecalho = () => secao(container, 0)
      .querySelectorAll('.data-table__th--sortable')[1];

    // Dois cliques na coluna Data: ascendente e depois descendente.
    cabecalho().click();
    cabecalho().click();
    expect(cabecalho().getAttribute('aria-sort')).toBe('descending');

    await gravar(container);

    expect(cabecalho().getAttribute('aria-sort')).toBe('descending');
    cleanup();
  });

  test('o cabecalho e os cartoes nao sao recriados, e o valor muda no proprio no', async () => {
    const { container, cleanup } = await montar();
    const header = container.querySelector('.page__header');
    const titulo = container.querySelector('.page__title');
    const saldo = valorDe(container, 'Saldo a liquidar');
    expect(saldo.textContent).toContain('400');

    getNotaEmpenho.mockImplementation(() =>
      Promise.resolve({ ...NOTA, saldo_a_liquidar: 250 }));
    await gravar(container);

    expect(container.querySelector('.page__header')).toBe(header);
    expect(container.querySelector('.page__title')).toBe(titulo);
    // O MESMO no, com o texto novo: e a diferenca entre repintar e remontar.
    expect(valorDe(container, 'Saldo a liquidar')).toBe(saldo);
    expect(saldo.textContent).toContain('250');
    cleanup();
  });

  test('o painel de historico continua na tela depois de gravar', async () => {
    const { container, cleanup } = await montar();
    const historico = container.querySelector('.historico');
    expect(historico).toBeTruthy();

    await gravar(container);

    // O historico e pendurado DEPOIS do primeiro load. Limpar a raiz no load
    // seguinte o arrancava da tela, e ele so voltava com F5.
    expect(container.querySelector('.historico')).toBe(historico);
    cleanup();
  });

  test('o foco do teclado sobrevive a gravacao', async () => {
    const { container, cleanup } = await montar();
    const botao = novaBtn(container);
    botao.focus();
    expect(document.activeElement).toBe(botao);

    await gravar(container);

    // Quem edita em sequencia trabalha pelo teclado. Com a tela remontada, o
    // foco caia no body e o proximo Tab recomecava do topo da pagina.
    expect(document.activeElement).toBe(botao);
    cleanup();
  });

  test('a recarga troca as linhas da tabela, e nao a tabela', async () => {
    const { container, cleanup } = await montar();
    const corpo = () => secao(container, 0).querySelectorAll('tbody tr');
    expect(corpo()).toHaveLength(2);

    getLiquidacoes.mockImplementation(() => Promise.resolve([LIQUIDACOES[1]]));
    await gravar(container);

    expect(corpo()).toHaveLength(1);
    expect(secao(container, 0).textContent).toContain('2026NS000002');
    expect(secao(container, 0).textContent).not.toContain('2026NS000001');
    cleanup();
  });
});
