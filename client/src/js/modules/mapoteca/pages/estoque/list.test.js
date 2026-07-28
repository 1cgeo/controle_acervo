import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderEstoqueList } from '@modules/mapoteca/pages/estoque/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, CONSULTA, OPERADOR, GERENTE } from '@/__tests__/helpers/sessao.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const ESTOQUE = [
  {
    id: 10, tipo_material_id: 1, tipo_material_nome: 'Papel A0',
    localizacao_id: 1, localizacao_nome: 'Seção', quantidade: '12',
    data_atualizacao: '2026-06-01T10:00:00Z', usuario_atualizacao_nome: 'Diniz',
  },
];
const POR_LOCALIZACAO = [
  { localizacao_id: 1, localizacao_nome: 'Seção', quantidade_total: '12', tipos_materiais_diferentes: '1' },
];

describe('renderEstoqueList', () => {
  beforeEach(() => {
    // A tela esconde escrita por perfil: sem sessao nao ha botao para testar.
    logarComo({ mapoteca: GERENTE });
    svc.getEstoqueMaterial.mockResolvedValue(ESTOQUE);
    svc.getEstoquePorLocalizacao.mockResolvedValue(POR_LOCALIZACAO);
    svc.getTiposMaterial.mockResolvedValue([{ id: 1, nome: 'Papel A0' }]);
    svc.getDominioTipoLocalizacao.mockResolvedValue([
      { code: 1, nome: 'Seção' }, { code: 2, nome: 'Depósito' },
    ]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('monta o titulo, os cards por localizacao e a tabela', async () => {
    const container = document.createElement('div');
    const cleanup = await renderEstoqueList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getEstoqueMaterial).toHaveBeenCalled();
    expect(svc.getEstoquePorLocalizacao).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Estoque de Material');
    expect(container.textContent).toContain('Seção');
    expect(container.textContent).toContain('Papel A0');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o dialogo de transferencia pede material, origem, destino e quantidade', async () => {
    const container = document.createElement('div');
    const cleanup = await renderEstoqueList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const transferir = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Transferir'));
    transferir.click();
    await flush();

    expect(document.body.textContent).toContain('Transferir estoque');
    expect(document.body.textContent).toContain('Origem');
    expect(document.body.textContent).toContain('Destino');
    // Abrir o dialogo nao transfere nada.
    expect(svc.transferirEstoque).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  test('transferir sem preencher nada mostra o erro e nao chama o service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderEstoqueList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    [...container.querySelectorAll('button')].find(b => b.textContent.includes('Transferir')).click();
    await flush();

    const confirmar = [...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Transferir');
    confirmar.click();
    await flush();

    expect(svc.transferirEstoque).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Selecione o tipo de material');

    if (typeof cleanup === 'function') cleanup();
  });

  test('erro na leitura do estoque nao derruba a pagina', async () => {
    svc.getEstoqueMaterial.mockRejectedValueOnce(new Error('Erro de conexão'));
    const container = document.createElement('div');
    const cleanup = await renderEstoqueList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Nenhum registro de estoque');

    if (typeof cleanup === 'function') cleanup();
  });
});

// A tela de estoque separa os DOIS niveis: transferir e operador (mover
// material entre localizacoes e trabalho do dia), mexer no saldo na mao e
// gerente. E o caso que mais mostra por que esconder por perfil vale a pena.
describe('renderEstoqueList: o que cada perfil ve', () => {
  beforeEach(() => {
    svc.getEstoqueMaterial.mockResolvedValue(ESTOQUE);
    svc.getEstoquePorLocalizacao.mockResolvedValue(POR_LOCALIZACAO);
    svc.getTiposMaterial.mockResolvedValue([{ id: 1, nome: 'Papel A0' }]);
    svc.getDominioTipoLocalizacao.mockResolvedValue([
      { code: 1, nome: 'Seção' }, { code: 2, nome: 'Depósito' },
    ]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('consulta nao ve transferir nem adicionar, e nao tem acao de linha', async () => {
    logarComo({ mapoteca: CONSULTA });
    const container = document.createElement('div');
    const cleanup = await renderEstoqueList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).not.toContain('Transferir');
    expect(container.textContent).not.toContain('Adicionar estoque');
    expect(container.querySelectorAll('.data-table__action-btn')).toHaveLength(0);

    cleanup();
  });

  test('operador transfere, mas nao adiciona nem edita saldo', async () => {
    logarComo({ mapoteca: OPERADOR });
    const container = document.createElement('div');
    const cleanup = await renderEstoqueList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Transferir');
    expect(container.textContent).not.toContain('Adicionar estoque');
    expect(container.querySelectorAll('.data-table__action-btn')).toHaveLength(0);

    cleanup();
  });

  test('gerente ve tudo', async () => {
    logarComo({ mapoteca: GERENTE });
    const container = document.createElement('div');
    const cleanup = await renderEstoqueList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Transferir');
    expect(container.textContent).toContain('Adicionar estoque');
    expect(container.querySelector('.data-table__action-btn--danger')).not.toBeNull();

    cleanup();
  });
});
