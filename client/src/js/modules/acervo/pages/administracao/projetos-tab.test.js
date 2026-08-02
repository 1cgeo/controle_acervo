import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/acervo/services/admin-service.js', () => ({
  getProjetos: vi.fn(),
  getStatusExecucao: vi.fn(),
  excluirProjetos: vi.fn(),
}));

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { renderProjetosTab } from '@modules/acervo/pages/administracao/projetos-tab.js';
import * as svc from '@modules/acervo/services/admin-service.js';
import { showError } from '@utils/toast.js';
import { logarComo, OPERADOR, GERENTE } from '@/__tests__/helpers/sessao.js';

const PROJETOS = [
  {
    id: 5, nome: 'Convênio RS', descricao: 'Mapeamento sistemático',
    data_inicio: '2026-01-05', data_fim: null,
    status_execucao_id: 2, status_execucao: 'Em execução',
  },
];

const abrir = async () => {
  const container = document.createElement('div');
  const aba = await renderProjetosTab(container);
  return { container, aba };
};

const acao = (container, titulo) =>
  [...container.querySelectorAll('.data-table__action-btn')].find(b => b.title === titulo);

describe('renderProjetosTab', () => {
  beforeEach(() => {
    logarComo({ acervo: GERENTE });
    svc.getProjetos.mockResolvedValue(PROJETOS);
    svc.getStatusExecucao.mockResolvedValue([{ code: 2, nome: 'Em execução' }]);
    svc.excluirProjetos.mockResolvedValue({});
  });

  test('lista os projetos com status e datas', async () => {
    const { container, aba } = await abrir();

    expect(container.textContent).toContain('Convênio RS');
    expect(container.textContent).toContain('Em execução');

    aba.cleanup();
  });

  test('operador nao ve o botao de excluir: excluir projeto e gerente', async () => {
    logarComo({ acervo: OPERADOR });
    const { container, aba } = await abrir();

    expect(acao(container, 'Editar')).toBeDefined();
    expect(acao(container, 'Excluir')).toBeUndefined();

    aba.cleanup();
  });

  // O servidor nomeia o vinculo que impediu ("pois há lotes associados"), e e
  // isso que diz a quem le o que precisa ser desfeito antes.
  test('a falha da exclusao mostra a frase do servidor', async () => {
    svc.excluirProjetos.mockRejectedValue(
      new Error('Não é possível deletar os projetos com IDs: 5 pois há lotes associados'),
    );
    const { container, aba } = await abrir();

    acao(container, 'Excluir').click();
    await new Promise(r => setTimeout(r, 0));

    expect(showError).toHaveBeenCalledWith(
      'Não é possível deletar os projetos com IDs: 5 pois há lotes associados',
    );

    aba.cleanup();
  });
});
