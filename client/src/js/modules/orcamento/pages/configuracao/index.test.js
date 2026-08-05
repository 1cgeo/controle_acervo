import { describe, test, expect, vi } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Smoke test da pagina de Configuracao geral (UASG e CODOM) e das secoes de
// dominios editaveis (natureza de despesa, plano interno, UG).
// Mocka o service: getConfig devolve os dados atuais, updateConfig salva e os
// list() dos dominios devolvem vazio.
//
// O `ano_referencia` fica no retorno do getConfig de proposito: a coluna so sai
// do banco depois, e a tela tem de IGNORAR o campo que ainda chega.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getConfig: vi.fn(() => Promise.resolve({ uasg: '160382', codom: '12345', ano_referencia: 2026 })),
  updateConfig: vi.fn(() => Promise.resolve({ uasg: '160382', codom: '12345' })),
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
import { getConfig } from '@modules/orcamento/services/orcamento-service.js';

describe('renderConfiguracao', () => {
  test('monta o titulo Configuracao e carrega os valores do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderConfiguracao(container);
    await flush();

    expect(getConfig).toHaveBeenCalled();

    const titulo = container.querySelector('.page__title');
    expect(titulo).not.toBeNull();
    expect(titulo.textContent).toContain('Configura');

    // Os valores carregados pelo getConfig caem nos inputs do formulario.
    const inputs = Array.from(container.querySelectorAll('input'));
    const valores = inputs.map(i => i.value);
    expect(valores).toContain('160382');
    expect(valores).toContain('12345');
    // O campo "Ano de referência" saiu: o ano e de cada tela.
    expect(valores).not.toContain('2026');

    if (typeof cleanup === 'function') cleanup();
  });
});
