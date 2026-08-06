import { describe, test, expect, vi } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Smoke test da pagina de Configuracao: hoje ela e SO as secoes de dominios
// editaveis (natureza de despesa, plano interno, UG). Mocka o service, e os
// list() dos dominios devolvem vazio.
//
// A secao "Dados gerais" (UASG e CODOM) saiu em 2026-08-06, junto com a tabela
// orcamento.configuracao que a sustentava. O mock NAO exporta getConfig nem
// updateConfig de proposito: se a tela voltar a chamar qualquer um dos dois, o
// import quebra o teste em vez de passar em silencio.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNaturezaDespesa: vi.fn(() => Promise.resolve([])),
  createNaturezaDespesa: vi.fn(() => Promise.resolve()),
  updateNaturezaDespesa: vi.fn(() => Promise.resolve()),
  deleteNaturezaDespesa: vi.fn(() => Promise.resolve()),
  getPlanoInterno: vi.fn(() => Promise.resolve([])),
  createPlanoInterno: vi.fn(() => Promise.resolve()),
  updatePlanoInterno: vi.fn(() => Promise.resolve()),
  deletePlanoInterno: vi.fn(() => Promise.resolve()),
  getUg: vi.fn(() => Promise.resolve([])),
  createUg: vi.fn(() => Promise.resolve()),
  updateUg: vi.fn(() => Promise.resolve()),
  deleteUg: vi.fn(() => Promise.resolve()),
}));

import { renderConfiguracao } from '@modules/orcamento/pages/configuracao/index.js';
import { getNaturezaDespesa } from '@modules/orcamento/services/orcamento-service.js';

describe('renderConfiguracao', () => {
  test('monta o titulo Configuracao e carrega os tres dominios', async () => {
    const container = document.createElement('div');
    const cleanup = await renderConfiguracao(container);
    await flush();

    const titulo = container.querySelector('.page__title');
    expect(titulo).not.toBeNull();
    expect(titulo.textContent).toContain('Configura');

    // O que a pagina faz de util e manter os dominios, e isso continua.
    expect(getNaturezaDespesa).toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  // REPROVA o estado anterior a 2026-08-06: antes, a tela montava dois inputs
  // ja preenchidos com a UASG (160382) e o CODOM (048215) da propria OM.
  test('nao monta mais o formulario de UASG e CODOM', async () => {
    const container = document.createElement('div');
    const cleanup = await renderConfiguracao(container);
    await flush();

    const texto = container.textContent;
    expect(texto).not.toContain('Dados gerais');
    expect(texto).not.toContain('UASG');
    expect(texto).not.toContain('CODOM');
    expect(container.querySelector('form')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
