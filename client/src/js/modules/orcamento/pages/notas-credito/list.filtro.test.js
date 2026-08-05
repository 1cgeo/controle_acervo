import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Regressao: o filtro de Classificacao montava as opcoes com c.id, e o dominio
// devolve c.code (GET /api/orcamento/dominio/classificacao_nc responde
// [{"code":1,"nome":"PDR"},{"code":2,"nome":"Extra-PDR"}]). As duas opcoes
// viravam value="undefined", resolveValue devolvia undefined e o parametro era
// descartado: o unico filtro da tela nao filtrava nada. O mesmo defeito ja tinha
// sido corrigido no dialog (nota-credito-dialog.js:94) e nao na lista.

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotasCredito: vi.fn(() => Promise.resolve([])),
  deleteNotaCredito: vi.fn(() => Promise.resolve()),
  getClassificacaoNc: vi.fn(() => Promise.resolve([
    { code: 1, nome: 'PDR' },
    { code: 2, nome: 'Extra-PDR' },
  ])),
  getAnos: vi.fn(() => Promise.resolve([2026, 2025])),
  getNaturezaDespesa: vi.fn(() => Promise.resolve([])),
  getPlanoInterno: vi.fn(() => Promise.resolve([])),
  getUg: vi.fn(() => Promise.resolve([])),
  getPdrItens: vi.fn(() => Promise.resolve([])),
  getNotaCredito: vi.fn(() => Promise.resolve({})),
  createNotaCredito: vi.fn(() => Promise.resolve({})),
  updateNotaCredito: vi.fn(() => Promise.resolve({})),
  getArquivos: vi.fn(() => Promise.resolve([])),
  uploadArquivo: vi.fn(() => Promise.resolve([])),
  downloadArquivo: vi.fn(() => Promise.resolve()),
  deleteArquivo: vi.fn(() => Promise.resolve()),
}));

import { renderNotasCreditoList } from '@modules/orcamento/pages/notas-credito/list.js';
import { getNotasCredito } from '@modules/orcamento/services/orcamento-service.js';

// A barra de filtros tem DOIS selects, e o de ano vem primeiro. Buscar pelo
// rótulo evita que o caso passe a medir o campo errado quando outro filtro
// entrar na barra.
function selectPorRotulo(container, rotulo) {
  const campos = [...container.querySelectorAll('.page__filters .form-field')];
  const campo = campos.find(f => f.querySelector('.form-field__label')?.textContent.includes(rotulo));
  return campo ? campo.querySelector('select') : null;
}

describe('renderNotasCreditoList: filtro de classificacao', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('as opcoes do filtro carregam o code do dominio', async () => {
    const container = document.createElement('div');
    await renderNotasCreditoList(container, { params: {}, query: new URLSearchParams() });
    await flush();
    await flush();

    const select = selectPorRotulo(container, 'Classificação');
    expect(select).not.toBeNull();
    const valores = [...select.options].map(o => o.value);
    expect(valores).toEqual(['', '1', '2']);
  });

  test('escolher Extra-PDR manda classificacao_id ao servidor', async () => {
    const container = document.createElement('div');
    await renderNotasCreditoList(container, { params: {}, query: new URLSearchParams() });
    await flush();
    await flush();

    const select = selectPorRotulo(container, 'Classificação');
    select.value = '2';
    select.dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    const ultimaChamada = getNotasCredito.mock.calls.at(-1)[0];
    expect(ultimaChamada.classificacao_id).toBe(2);
  });
});
