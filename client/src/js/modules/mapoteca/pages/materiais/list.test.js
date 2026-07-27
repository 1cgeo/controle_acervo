import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderMateriaisList } from '@modules/mapoteca/pages/materiais/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const MATERIAIS = [
  {
    id: 1, nome: 'Papel A0', descricao: 'Bobina', estoque_total: '12',
    localizacoes_armazenadas: '2', estoque_minimo: '20', meta_anual: '100',
    ativo: true, abaixo_minimo: true,
  },
  {
    id: 2, nome: 'Tinta preta', descricao: null, estoque_total: '30',
    localizacoes_armazenadas: '1', estoque_minimo: null, meta_anual: null,
    ativo: true, abaixo_minimo: false,
  },
];

describe('renderMateriaisList', () => {
  beforeEach(() => {
    svc.getTiposMaterial.mockResolvedValue(MATERIAIS);
  });

  test('monta o titulo e carrega os tipos de material', async () => {
    const container = document.createElement('div');
    const cleanup = await renderMateriaisList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getTiposMaterial).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Tipos de Material');
    expect(container.textContent).toContain('Papel A0');
    expect(container.textContent).toContain('Tinta preta');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o link do nome leva ao detalhe COM o prefixo do modulo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderMateriaisList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const link = [...container.querySelectorAll('a')].find(a => a.textContent === 'Papel A0');
    expect(link.getAttribute('href')).toBe('#/mapoteca/materiais/1');

    if (typeof cleanup === 'function') cleanup();
  });

  test('material abaixo do minimo ganha o selo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderMateriaisList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.querySelector('.badge')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('o botao de exclusao em lote comeca desabilitado', async () => {
    const container = document.createElement('div');
    const cleanup = await renderMateriaisList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.querySelector('.btn--danger').disabled).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });
});
