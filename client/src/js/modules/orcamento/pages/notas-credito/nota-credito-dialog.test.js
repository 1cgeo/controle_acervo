import { describe, test, expect, vi, beforeEach } from 'vitest';

// Regressao do bug: ao EDITAR uma NC, o select de classificacao vinha vazio
// porque as opcoes eram montadas com c.id (inexistente) em vez de c.code. Este
// teste fixa que, no modo edicao, o select de classificacao vem pre-selecionado
// com o classificacao_id da NC.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotaCredito: vi.fn(() => Promise.resolve({
    id: 5, ano: 2026, numero: '2026NC400134', cod_nd: '339015',
    valor_nc: 1000, classificacao_id: 2, ug_emitente: '160089',
  })),
  createNotaCredito: vi.fn(() => Promise.resolve({})),
  updateNotaCredito: vi.fn(() => Promise.resolve({})),
  getNaturezaDespesa: vi.fn(() => Promise.resolve([{ code: '339015', nome: 'Diárias', gnd: 3 }])),
  getPlanoInterno: vi.fn(() => Promise.resolve([])),
  getUg: vi.fn(() => Promise.resolve([{ code: '160089', nome: 'DSG' }])),
  getClassificacaoNc: vi.fn(() => Promise.resolve([
    { code: 1, nome: 'PDR' },
    { code: 2, nome: 'Extra-PDR' },
  ])),
  getMetas: vi.fn(() => Promise.resolve([])),
  getNotasCredito: vi.fn(() => Promise.resolve([])),
  getPdrItens: vi.fn(() => Promise.resolve([])),
  // Anexos (componente file-attachment, carregado no modo edicao da NC)
  getArquivos: vi.fn(() => Promise.resolve([])),
  uploadArquivo: vi.fn(() => Promise.resolve([])),
  downloadArquivo: vi.fn(() => Promise.resolve()),
  deleteArquivo: vi.fn(() => Promise.resolve()),
}));

import { openNotaCreditoDialog } from '@modules/orcamento/pages/notas-credito/nota-credito-dialog.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// Acha o select cujo .form-field tem o label com o texto dado.
function selectByLabel(label) {
  const fields = [...document.querySelectorAll('.modal__body .form-field')];
  const field = fields.find(f => f.querySelector('.form-field__label')?.textContent.includes(label));
  return field ? field.querySelector('.form-field__select') : null;
}

describe('openNotaCreditoDialog (edicao)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.setItem('@sca-orcamento-ano', '2026');
    vi.clearAllMocks();
  });

  test('o select de classificacao vem pre-selecionado com o valor da NC', async () => {
    await openNotaCreditoDialog({ ncId: 5 });
    await flush();
    await flush();

    const select = selectByLabel('Classificação');
    expect(select).not.toBeNull();
    expect(select.value).toBe('2');
    const selecionada = select.options[select.selectedIndex];
    expect(selecionada.textContent).toBe('Extra-PDR');
  });
});
