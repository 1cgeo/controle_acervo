import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mesmo defeito de tipo de id das outras telas do modulo: o select devolve o
// valor da opcao com o tipo original, os ids da API sao TEXTO, e o servidor
// cobra Joi.number().integer().strict() em nota_empenho_id (rpnp_schema.js:28).
// Vincular o RPNP a uma NE dava 400. Em producao, nota_empenho_id e nulo em
// 100% dos 30 RPNP de 2025 e 2026.

const { createRpnp, updateRpnp } = vi.hoisted(() => ({
  createRpnp: vi.fn(() => Promise.resolve({})),
  updateRpnp: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  createRpnp,
  updateRpnp,
  getRpnp: vi.fn(() => Promise.resolve({})),
  // id como TEXTO, igual ao que a API real devolve.
  getNotasEmpenho: vi.fn(() => Promise.resolve([
    { id: '55', numero: 'RPCA-400267', ano: 2025, valor_empenhado: '65996.85' },
    { id: '56', numero: 'RPCA-400392', ano: 2025, valor_empenhado: '1000.00' },
  ])),
}));

vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: vi.fn(() => ({ element: document.createElement('div'), recarregar: vi.fn() })),
}));

import { openRpnpDialog } from '@modules/orcamento/pages/rpnp/rpnp-dialog.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function botao(rotulo) {
  return [...document.querySelectorAll('.modal__footer .btn')]
    .find(b => b.textContent.trim() === rotulo);
}

function campoPorRotulo(rotulo) {
  const campos = [...document.querySelectorAll('.modal__body .form-field')];
  const campo = campos.find(f => f.querySelector('.form-field__label')?.textContent.includes(rotulo));
  return campo ? campo.querySelector('select, input, textarea') : null;
}

describe('openRpnpDialog: tipo do id enviado ao servidor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.setItem('@sca-orcamento-ano', '2026');
    vi.clearAllMocks();
  });

  test('nota_empenho_id vai como numero, e nao como texto', async () => {
    await openRpnpDialog({});
    await flush();

    const select = campoPorRotulo('Nota de empenho');
    expect(select).not.toBeNull();
    select.value = '55';
    select.dispatchEvent(new Event('change', { bubbles: true }));

    botao('Salvar').click();
    await flush();

    expect(createRpnp).toHaveBeenCalledTimes(1);
    const corpo = createRpnp.mock.calls[0][0];
    expect(typeof corpo.nota_empenho_id).toBe('number');
    expect(corpo.nota_empenho_id).toBe(55);
  });

  test('sem NE escolhida, nota_empenho_id continua null', async () => {
    await openRpnpDialog({});
    await flush();

    const rotulo = campoPorRotulo('Rótulo do empenho');
    rotulo.value = '2025NE000001';
    rotulo.dispatchEvent(new Event('input', { bubbles: true }));

    botao('Salvar').click();
    await flush();

    expect(createRpnp).toHaveBeenCalledTimes(1);
    expect(createRpnp.mock.calls[0][0].nota_empenho_id).toBeNull();
  });
});
