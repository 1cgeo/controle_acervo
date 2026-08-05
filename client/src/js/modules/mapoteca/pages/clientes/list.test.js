import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderClientesList } from '@modules/mapoteca/pages/clientes/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, CONSULTA, OPERADOR, GERENTE } from '@/__tests__/helpers/sessao.js';

const CLIENTES = [
  {
    id: 1, nome: '1º CGEO', tipo_cliente_nome: 'OM EB', ponto_contato_principal: 'S3',
    total_pedidos: 4, data_ultimo_pedido: '2026-06-01', pedidos_em_andamento: 1,
  },
  {
    id: 2, nome: 'Prefeitura de Porto Alegre', tipo_cliente_nome: 'Órgão público',
    ponto_contato_principal: null, total_pedidos: 1, data_ultimo_pedido: null,
    pedidos_em_andamento: 0,
  },
];

describe('renderClientesList', () => {
  beforeEach(() => {
    // A tela esconde escrita por perfil: sem sessao nao ha botao para testar.
    logarComo({ mapoteca: GERENTE });
    svc.getClientes.mockResolvedValue(CLIENTES);
  });

  test('monta o titulo e carrega a lista do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getClientes).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Clientes');
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();
    expect(container.textContent).toContain('1º CGEO');
    expect(container.textContent).toContain('Prefeitura de Porto Alegre');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o botao de exclusao em lote nasce escondido', async () => {
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const botao = container.querySelector('.btn--danger');
    expect(botao.classList.contains('hidden')).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  // ESTE TESTE JA EXISTIA COM A EXPECTATIVA CONTRARIA: ele exigia que o erro
  // mostrasse "Nenhum cliente cadastrado". Aquilo era o defeito, escrito como
  // regra. "Nao ha cliente" manda cadastrar; "nao consegui saber" manda tentar
  // de novo. A tela dizia a primeira frase quando acontecia a segunda.
  test('erro do service aparece como ERRO, e nao como lista vazia', async () => {
    svc.getClientes.mockRejectedValueOnce(new Error('Erro de conexão'));
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Erro de conexão');
    expect(container.textContent).not.toContain('Nenhum cliente cadastrado');
    // E oferece o caminho de saida, que a mensagem de vazio nao oferecia.
    expect([...container.querySelectorAll('button')]
      .some(b => b.textContent.includes('Tentar de novo'))).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  test('tentar de novo devolve a lista, sem remontar a pagina', async () => {
    svc.getClientes.mockRejectedValueOnce(new Error('Erro de conexão'));
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Tentar de novo')).click();
    await flush();

    expect(container.textContent).not.toContain('Erro de conexão');
    expect(container.textContent).toContain('1º CGEO');

    if (typeof cleanup === 'function') cleanup();
  });
});

// Criar, editar e excluir cliente exigem gerente no servidor. A tela esconde as
// três ações de quem não é gerente, para o clique não levar 403.
describe('renderClientesList: o que cada perfil ve', () => {
  beforeEach(() => {
    svc.getClientes.mockResolvedValue(CLIENTES);
  });

  test('consulta ve a lista, sem "Novo cliente", sem selecao e sem acao de escrita', async () => {
    logarComo({ mapoteca: CONSULTA });
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('1º CGEO');
    expect(container.textContent).not.toContain('Novo cliente');
    expect(container.textContent).not.toContain('Excluir selecionados');
    expect(container.querySelector('input[type="checkbox"]')).toBeNull();
    // Sobra so o "Ver detalhes" na coluna de acoes.
    expect(container.querySelectorAll('.data-table__action-btn')).toHaveLength(CLIENTES.length);
    expect(container.querySelector('.data-table__action-btn--danger')).toBeNull();

    cleanup();
  });

  test('operador tambem nao escreve aqui: o nivel exigido e gerente', async () => {
    logarComo({ mapoteca: OPERADOR });
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).not.toContain('Novo cliente');
    expect(container.querySelector('.data-table__action-btn--danger')).toBeNull();

    cleanup();
  });

  test('gerente ve criar, editar e excluir', async () => {
    logarComo({ mapoteca: GERENTE });
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Novo cliente');
    expect(container.querySelector('input[type="checkbox"]')).not.toBeNull();
    expect(container.querySelector('.data-table__action-btn--danger')).not.toBeNull();

    cleanup();
  });

  test('administrador global escreve mesmo sem perfil na mapoteca', async () => {
    logarComo({}, { administrador: true });
    const container = document.createElement('div');
    const cleanup = await renderClientesList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Novo cliente');

    cleanup();
  });
});
