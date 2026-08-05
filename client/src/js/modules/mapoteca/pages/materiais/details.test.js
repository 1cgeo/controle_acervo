import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderMaterialDetails } from '@modules/mapoteca/pages/materiais/details.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const MATERIAL = {
  id: 1,
  nome: 'Papel A0',
  descricao: 'Bobina de papel',
  ativo: true,
  estoque_minimo: 20,
  meta_anual: 100,
  estoque: {
    total: 12,
    registros: [{ localizacao_nome: 'Seção', quantidade: 12, data_atualizacao: '2026-06-01T10:00:00Z' }],
  },
  consumo: {
    total_consumido: 88,
    ultimo_consumo: '2026-06-05',
    registros_recentes: [{ data_consumo: '2026-06-05', quantidade: 3 }],
  },
};

describe('renderMaterialDetails', () => {
  beforeEach(() => {
    svc.getTipoMaterial.mockResolvedValue(MATERIAL);
    svc.getConsumoMensal.mockResolvedValue([]);
  });

  test('busca o material do :id e monta cards e tabelas', async () => {
    const container = document.createElement('div');
    const cleanup = await renderMaterialDetails(container, { params: { id: '1' }, query: new URLSearchParams() });
    await flush();

    expect(svc.getTipoMaterial).toHaveBeenCalledWith(1);
    expect(container.querySelector('.page__title').textContent).toBe('Papel A0');
    expect(container.textContent).toContain('Estoque total');
    expect(container.textContent).toContain('Estoque por localização');
    expect(container.textContent).toContain('Consumo recente');

    if (typeof cleanup === 'function') cleanup();
  });

  test('estoque abaixo do minimo aparece com o selo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderMaterialDetails(container, { params: { id: '1' }, query: new URLSearchParams() });
    await flush();

    // 12 no estoque contra minimo 20
    expect(container.querySelector('.badge')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('erro na carga mostra a mensagem e o botao de voltar', async () => {
    svc.getTipoMaterial.mockRejectedValueOnce(new Error('Material não encontrado'));
    const container = document.createElement('div');
    const cleanup = await renderMaterialDetails(container, { params: { id: '99' }, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Material não encontrado');
    expect(container.textContent).toContain('Voltar');

    if (typeof cleanup === 'function') cleanup();
  });
});
