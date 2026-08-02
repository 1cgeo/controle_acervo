import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/acervo/services/admin-service.js', () => ({
  getVolumesArmazenamento: vi.fn(),
  excluirVolumesArmazenamento: vi.fn(),
}));

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { renderVolumesTab } from '@modules/acervo/pages/administracao/volumes-tab.js';
import * as svc from '@modules/acervo/services/admin-service.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { showError } from '@utils/toast.js';
import { logarComo, CONSULTA, OPERADOR, GERENTE } from '@/__tests__/helpers/sessao.js';

// O caminho e um placeholder aceito pelo guard anti-vazamento
// (scripts/check_vazamento.py so libera '\\servidor\...' e '\\host\...').
const VOLUMES = [
  { id: 1, nome: 'Acervo principal', volume: '\\\\servidor\\acervo', capacidade_gb: 40000, layout_origem: false },
  { id: 2, nome: 'Entrega do fornecedor', volume: '\\\\servidor\\entrega', capacidade_gb: 8000, layout_origem: true },
];

const abrir = async () => {
  const container = document.createElement('div');
  const aba = await renderVolumesTab(container);
  return { container, aba };
};

const acao = (container, titulo) =>
  [...container.querySelectorAll('.data-table__action-btn')].find(b => b.title === titulo);

describe('renderVolumesTab', () => {
  beforeEach(() => {
    logarComo({ acervo: GERENTE });
    svc.getVolumesArmazenamento.mockResolvedValue(VOLUMES);
    svc.excluirVolumesArmazenamento.mockResolvedValue({});
    confirmDialog.mockResolvedValue(true);
  });

  test('lista os volumes com nome, caminho e capacidade', async () => {
    const { container, aba } = await abrir();

    expect(svc.getVolumesArmazenamento).toHaveBeenCalled();
    expect(container.textContent).toContain('Acervo principal');
    expect(container.textContent).toContain('\\\\servidor\\acervo');
    // 40000 sai agrupado no padrao pt-BR.
    expect(container.textContent).toContain('40.000');

    aba.cleanup();
  });

  test('o layout de origem aparece como coluna, e nao so no formulario', async () => {
    const { container, aba } = await abrir();

    const linhas = [...container.querySelectorAll('tbody tr')];
    const fornecedor = linhas.find(tr => tr.textContent.includes('Entrega do fornecedor'));
    expect(fornecedor.textContent).toContain('Sim');

    aba.cleanup();
  });

  // O guarda de verdade e o verifyPerfil do servidor; o que se prova aqui e que a
  // tela nao oferece o que aquele perfil levaria 403 ao usar.
  test('quem tem so consulta nao ve novo, editar nem excluir', async () => {
    logarComo({ acervo: CONSULTA });
    const { container, aba } = await abrir();

    expect(container.querySelector('.btn--primary')).toBeNull();
    expect(acao(container, 'Editar')).toBeUndefined();
    expect(acao(container, 'Excluir')).toBeUndefined();

    aba.cleanup();
  });

  test('operador edita mas NAO exclui: excluir e gerente no servidor', async () => {
    logarComo({ acervo: OPERADOR });
    const { container, aba } = await abrir();

    expect(container.querySelector('.btn--primary')).not.toBeNull();
    expect(acao(container, 'Editar')).toBeDefined();
    expect(acao(container, 'Excluir')).toBeUndefined();

    aba.cleanup();
  });

  test('excluir pede confirmacao e recarrega a lista', async () => {
    const { container, aba } = await abrir();

    acao(container, 'Excluir').click();
    await new Promise(r => setTimeout(r, 0));

    expect(confirmDialog).toHaveBeenCalled();
    expect(svc.excluirVolumesArmazenamento).toHaveBeenCalledWith([1]);
    expect(svc.getVolumesArmazenamento).toHaveBeenCalledTimes(2);

    aba.cleanup();
  });

  test('recusar a confirmacao nao chama o servidor', async () => {
    confirmDialog.mockResolvedValue(false);
    const { container, aba } = await abrir();

    acao(container, 'Excluir').click();
    await new Promise(r => setTimeout(r, 0));

    expect(svc.excluirVolumesArmazenamento).not.toHaveBeenCalled();

    aba.cleanup();
  });

  // A recusa do servidor DIZ qual vinculo impede ("há Arquivos associados ao
  // volume"). Trocar por um texto generico esconderia o que a pessoa precisa
  // desfazer, e foi por isso que este caso ganhou teste proprio.
  test('a falha da exclusao mostra a frase do servidor, nao uma generica', async () => {
    svc.excluirVolumesArmazenamento.mockRejectedValue(
      new Error('Não é possível deletar pois há Arquivos associados ao volume'),
    );
    const { container, aba } = await abrir();

    acao(container, 'Excluir').click();
    await new Promise(r => setTimeout(r, 0));

    expect(showError).toHaveBeenCalledWith(
      'Não é possível deletar pois há Arquivos associados ao volume',
    );

    aba.cleanup();
  });
});
