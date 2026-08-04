import { describe, test, expect, vi, beforeEach } from 'vitest';

// Regressao: o DFD tem coluna "Valor estimado" na lista e no total do PCA, e
// nenhuma tela permitia informa-la. O corpo nunca levava valor_estimado, entao
// o servidor caia em resolveValorEstimado(undefined, itens) (dfd_ctrl.js:26-37):
// sem itens grava null, com itens sem valor_total grava 0. Abrir um DFD sem
// itens so para corrigir o objeto zerava o valor que vai ao PCA.

const { createDfd, updateDfd } = vi.hoisted(() => ({
  createDfd: vi.fn(() => Promise.resolve({ id: 9 })),
  updateDfd: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  createDfd,
  updateDfd,
  getDfd: vi.fn(() => Promise.resolve({})),
  getTipoItemDfd: vi.fn(() => Promise.resolve([{ code: 1, nome: 'Material' }])),
  getGrauPrioridade: vi.fn(() => Promise.resolve([{ code: 1, nome: 'Alto' }])),
  getArquivos: vi.fn(() => Promise.resolve([])),
  uploadArquivo: vi.fn(() => Promise.resolve([])),
  downloadArquivo: vi.fn(() => Promise.resolve()),
  deleteArquivo: vi.fn(() => Promise.resolve()),
}));

vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: vi.fn(() => ({ element: document.createElement('div'), recarregar: vi.fn() })),
}));

import { openDfdDialog } from '@modules/orcamento/pages/dfd/dfd-dialog.js';

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

const DFD = {
  id: 4,
  ano: 2026,
  numero: '103/2025',
  rotulo: 'Impressoras',
  objeto: 'Aquisição de suprimentos',
  valor_estimado: '187800.00',
  consta_pca: true,
  itens: [],
};

describe('openDfdDialog: valor estimado', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.setItem('@sca-orcamento-ano', '2026');
    vi.clearAllMocks();
  });

  test('o formulario tem o campo Valor estimado', async () => {
    await openDfdDialog({ dfd: DFD });
    await flush();

    const campo = campoPorRotulo('Valor estimado');
    expect(campo).not.toBeNull();
    expect(Number(campo.value)).toBe(187800);
  });

  test('editar sem mexer nos itens preserva o valor estimado', async () => {
    await openDfdDialog({ dfd: DFD });
    await flush();

    botao('Salvar').click();
    await flush();

    expect(updateDfd).toHaveBeenCalledTimes(1);
    const corpo = updateDfd.mock.calls[0][1];
    expect(Number(corpo.valor_estimado)).toBe(187800);
  });
});
