import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/acervo/services/admin-service.js', () => ({
  getLotes: vi.fn(),
  getProjetos: vi.fn(),
  getStatusExecucao: vi.fn(),
  excluirLotes: vi.fn(),
}));

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { renderLotesTab } from '@modules/acervo/pages/administracao/lotes-tab.js';
import * as svc from '@modules/acervo/services/admin-service.js';
import { logarComo, GERENTE } from '@/__tests__/helpers/sessao.js';

const PROJETOS = [{ id: 5, nome: 'Convênio RS' }];

const LOTES = [
  {
    id: 3, projeto_id: 5, projeto: 'Convênio RS', pit: 'PIT-2026', nome: 'LOTE_1',
    descricao: '', data_inicio: '2026-01-05', data_fim: null,
    status_execucao_id: 2, status_execucao: 'Em execução',
  },
];

const abrir = async () => {
  const container = document.createElement('div');
  const aba = await renderLotesTab(container);
  return { container, aba };
};

describe('renderLotesTab', () => {
  beforeEach(() => {
    logarComo({ acervo: GERENTE });
    svc.getLotes.mockResolvedValue(LOTES);
    svc.getProjetos.mockResolvedValue(PROJETOS);
    svc.getStatusExecucao.mockResolvedValue([{ code: 2, nome: 'Em execução' }]);
    svc.excluirLotes.mockResolvedValue({});
  });

  test('lista o lote com o projeto a que ele pertence', async () => {
    const { container, aba } = await abrir();

    expect(container.textContent).toContain('LOTE_1');
    expect(container.textContent).toContain('Convênio RS');
    expect(container.textContent).toContain('PIT-2026');

    aba.cleanup();
  });

  test('data de fim vazia sai como "-", e nao como data invalida', async () => {
    const { container, aba } = await abrir();

    expect(container.textContent).not.toContain('Invalid');
    expect(container.querySelector('tbody tr').textContent).toContain('-');

    aba.cleanup();
  });

  // `projeto_id` e obrigatorio no servidor. Sem projeto cadastrado, abrir o
  // formulario so levaria a pessoa ate o botao de salvar para receber 400.
  test('sem projeto cadastrado o botao de novo lote fica desabilitado e diz por que', async () => {
    svc.getProjetos.mockResolvedValue([]);
    const { container, aba } = await abrir();

    const btn = container.querySelector('.btn--primary');
    expect(btn.disabled).toBe(true);
    expect(btn.title).toContain('projeto');

    aba.cleanup();
  });

  test('com projeto cadastrado o botao fica habilitado', async () => {
    const { container, aba } = await abrir();

    expect(container.querySelector('.btn--primary').disabled).toBe(false);

    aba.cleanup();
  });
});
