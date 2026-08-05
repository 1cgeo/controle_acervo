import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O REMONTE da ficha do cliente.
//
// Cada gravação no diálogo de edição chamava `load()`, e `load()` esvaziava a
// página inteira e montava tudo de novo. O que se perdia: a página da tabela de
// pedidos, o foco do teclado, e a seção de HISTÓRICO, que saía do DOM e nunca
// voltava.
//
// Estes testes provam a IDENTIDADE do nó (===), e não o texto na tela. Remontar
// tudo também acerta o texto, e perde o estado no caminho.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

// O histórico é o mesmo componente da ficha do pedido, e busca por conta
// própria. O service dele é próprio e pequeno, então entra inteiro.
vi.mock('@services/rastreabilidade-service.js', () => ({
  getHistorico: vi.fn(() => Promise.resolve([])),
  getRastreabilidade: vi.fn(() => Promise.resolve({ dados: [], pagination: null })),
  getFiltrosRastreabilidade: vi.fn(() => Promise.resolve({
    modulos: [], entidades: [], origens: [], usuarios: [],
  })),
}));

// O diálogo entra dublado para o teste ter na mão o `onSaved`, que é o GATILHO
// da recarga. O que se prova aqui é a recarga, nunca o formulário.
let aoSalvar = null;
vi.mock('./dialog-cliente.js', () => ({
  openClienteDialog: vi.fn(({ onSaved }) => { aoSalvar = onSaved; }),
}));

import { renderClienteDetails } from '@modules/mapoteca/pages/clientes/details.js';
import { openClienteDialog } from './dialog-cliente.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';

// Oito pedidos, e não um: com pageSize 5 a tabela ganha duas páginas, e a
// página atual passa a ser estado que pode se perder.
const pedidos = () => Array.from({ length: 8 }, (_, i) => ({
  id: 50 + i,
  data_pedido: '2026-06-10',
  situacao_pedido_id: 5,
  situacao_pedido_nome: 'Concluído',
  documento_solicitacao: `DIEx ${100 + i}`,
  prazo: '2026-06-20',
  quantidade_produtos: 8,
}));

// Objetos NOVOS a cada chamada, como o servidor devolve. Devolver sempre o
// mesmo objeto faria a reconciliação passar por identidade de referência, e o
// teste aprovaria código que na tela real perde tudo.
const cliente = (extra = {}) => ({
  id: 7,
  nome: '1º CGEO',
  tipo_cliente_id: 1,
  tipo_cliente_nome: 'OM EB',
  ponto_contato_principal: 'Seção de Geoinformação',
  endereco_entrega_principal: 'Porto Alegre',
  estatisticas: {
    total_pedidos: 12, pedidos_em_andamento: 2, pedidos_concluidos: 10,
    total_produtos: 340, data_primeiro_pedido: '2024-02-01', data_ultimo_pedido: '2026-06-10',
  },
  ultimos_pedidos: pedidos(),
  ...extra,
});

const montar = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderClienteDetails(container, {
    params: { id: '7' }, query: new URLSearchParams(),
  });
  await flush();
  return { container, cleanup };
};

const secaoPedidos = (container) =>
  [...container.querySelectorAll('.dashboard-section')].find(secao => {
    const titulo = secao.querySelector('.dashboard-section__title');
    return titulo && titulo.textContent === 'Últimos pedidos';
  });

const tabelaPedidos = (container) => {
  const secao = secaoPedidos(container);
  return secao ? secao.querySelector('.data-table-wrapper') : null;
};

const linhasPedidos = (container) => {
  const tabela = tabelaPedidos(container);
  return tabela ? [...tabela.querySelectorAll('tbody tr')] : [];
};

const paginaPedidos = (container) => {
  const tabela = tabelaPedidos(container);
  const info = tabela ? tabela.querySelector('.pagination__info span') : null;
  return info ? info.textContent : null;
};

const botaoEditar = (container) => container.querySelector('.page__actions button');

/** Roda o caminho REAL da gravação: o diálogo avisa, e a ficha se recarrega. */
const gravar = async (container) => {
  botaoEditar(container).click();
  expect(typeof aoSalvar).toBe('function');
  await aoSalvar();
  await flush();
};

beforeEach(() => {
  // Gerente na mapoteca: sem isso o botão Editar não aparece, e não há como
  // disparar a gravação que este arquivo mede.
  saveAuth({ token: 't', administrador: false, uuid: 'u-1', perfis: { mapoteca: 3 } }, 'fulano');
  aoSalvar = null;
  svc.getCliente.mockImplementation(async () => cliente());
});

afterEach(() => {
  clearAuth();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ficha do cliente: o que sobrevive a uma gravação', () => {
  test('a tabela de últimos pedidos e o MESMO objeto depois de salvar', async () => {
    const { container, cleanup } = await montar();

    const antes = tabelaPedidos(container);
    expect(antes).toBeTruthy();

    await gravar(container);

    expect(tabelaPedidos(container)).toBe(antes);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a linha do pedido mantem o mesmo <tr>', async () => {
    const { container, cleanup } = await montar();

    const linha = linhasPedidos(container)[0];
    expect(linha).toBeTruthy();

    await gravar(container);

    expect(linhasPedidos(container)[0]).toBe(linha);

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem estava na página 2 continua na página 2', async () => {
    const { container, cleanup } = await montar();

    tabelaPedidos(container).querySelector('[aria-label="Próxima página"]').click();
    expect(paginaPedidos(container)).toBe('6-8 de 8');

    await gravar(container);

    expect(paginaPedidos(container)).toBe('6-8 de 8');

    if (typeof cleanup === 'function') cleanup();
  });

  // O remonte não pode tirar o histórico do DOM: um `clearChildren(root)`
  // seguido de um `renderCliente` que só repõe os outros blocos faz a seção
  // sumir da tela até a pessoa navegar de novo.
  test('a seção de histórico continua na tela depois de salvar', async () => {
    const { container, cleanup } = await montar();

    const historico = container.querySelector('.historico');
    expect(historico).toBeTruthy();

    await gravar(container);

    expect(container.querySelector('.historico')).toBe(historico);
    expect(container.contains(historico)).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o botão Editar mantem o foco do teclado', async () => {
    const { container, cleanup } = await montar();

    const botao = botaoEditar(container);
    botao.focus();
    expect(document.activeElement).toBe(botao);

    await gravar(container);

    expect(botaoEditar(container)).toBe(botao);
    expect(document.activeElement).toBe(botao);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o título muda de TEXTO sem trocar de nó', async () => {
    const { container, cleanup } = await montar();

    const titulo = container.querySelector('.page__title');
    svc.getCliente.mockImplementation(async () => cliente({ nome: '1º CGEO (renomeado)' }));

    await gravar(container);

    expect(container.querySelector('.page__title')).toBe(titulo);
    expect(titulo.textContent).toBe('1º CGEO (renomeado)');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o cartão de estatística muda de VALOR sem trocar de nó', async () => {
    const { container, cleanup } = await montar();

    const cartao = container.querySelectorAll('.summary-card')[0];
    const valor = cartao.querySelector('.summary-card__value');
    expect(valor.textContent).toBe('12');

    svc.getCliente.mockImplementation(async () => cliente({
      estatisticas: { ...cliente().estatisticas, total_pedidos: 13 },
    }));

    await gravar(container);

    expect(container.querySelectorAll('.summary-card')[0]).toBe(cartao);
    expect(valor.textContent).toBe('13');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a linha de contato muda de VALOR sem trocar de nó', async () => {
    const { container, cleanup } = await montar();

    const linha = container.querySelector('.detail-card__row');
    const valor = linha.querySelector('.detail-card__value');

    svc.getCliente.mockImplementation(async () => cliente({ tipo_cliente_nome: 'OM de outra FA' }));

    await gravar(container);

    expect(container.querySelector('.detail-card__row')).toBe(linha);
    expect(valor.textContent).toBe('OM de outra FA');

    if (typeof cleanup === 'function') cleanup();
  });

  // Guarda da própria correção: o botão passa a viver fora do `load()`, e o
  // closure dele não pode congelar o cliente da PRIMEIRA carga.
  test('o Editar abre com o cliente recarregado, nunca com o da primeira carga', async () => {
    const { container, cleanup } = await montar();

    svc.getCliente.mockImplementation(async () => cliente({ nome: 'Nome novo' }));
    await gravar(container);

    botaoEditar(container).click();

    expect(openClienteDialog).toHaveBeenLastCalledWith(
      expect.objectContaining({ cliente: expect.objectContaining({ nome: 'Nome novo' }) })
    );

    if (typeof cleanup === 'function') cleanup();
  });
});
