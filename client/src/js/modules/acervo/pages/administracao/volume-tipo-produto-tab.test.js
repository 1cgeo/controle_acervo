import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/acervo/services/admin-service.js', () => ({
  getVolumeTipoProduto: vi.fn(),
  getVolumesArmazenamento: vi.fn(),
  excluirVolumeTipoProduto: vi.fn(),
}));

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getTiposProduto: vi.fn(),
}));

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { renderVolumeTipoProdutoTab } from '@modules/acervo/pages/administracao/volume-tipo-produto-tab.js';
import * as admin from '@modules/acervo/services/admin-service.js';
import * as acervo from '@modules/acervo/services/acervo-service.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { logarComo, GERENTE } from '@/__tests__/helpers/sessao.js';

const ASSOCS = [
  {
    id: 10, tipo_produto_id: 1, volume_armazenamento_id: 1, primario: true,
    tipo_produto: 'Carta Topográfica', volume: '\\\\servidor\\acervo',
    nome_volume: 'Acervo principal', volume_capacidade_gb: 40000,
  },
  {
    id: 11, tipo_produto_id: 1, volume_armazenamento_id: 2, primario: false,
    tipo_produto: 'Carta Topográfica', volume: '\\\\servidor\\espelho',
    nome_volume: 'Espelho', volume_capacidade_gb: 8000,
  },
];

const abrir = async () => {
  const container = document.createElement('div');
  const aba = await renderVolumeTipoProdutoTab(container);
  return { container, aba };
};

const linhaDe = (container, texto) =>
  [...container.querySelectorAll('tbody tr')].find(tr => tr.textContent.includes(texto));

describe('renderVolumeTipoProdutoTab', () => {
  beforeEach(() => {
    logarComo({ acervo: GERENTE });
    admin.getVolumeTipoProduto.mockResolvedValue(ASSOCS);
    admin.getVolumesArmazenamento.mockResolvedValue([]);
    admin.excluirVolumeTipoProduto.mockResolvedValue({});
    acervo.getTiposProduto.mockResolvedValue([{ code: 1, nome: 'Carta Topográfica' }]);
    confirmDialog.mockResolvedValue(true);
  });

  test('lista as associacoes com tipo, volume e a marca de primario', async () => {
    const { container, aba } = await abrir();

    expect(container.textContent).toContain('Carta Topográfica');
    expect(linhaDe(container, 'Acervo principal').textContent).toContain('Sim');
    expect(linhaDe(container, 'Espelho').textContent).toContain('Não');

    aba.cleanup();
  });

  // O primario e o destino do upload pela web. Excluir o de um tipo deixa aquele
  // tipo sem destino, e o servidor SO recusa quando ja existe produto do tipo:
  // com o catalogo vazio a exclusao passa, e a falha aparece depois, na tela de
  // envio, para outra pessoa. Por isso o aviso e da tela.
  test('excluir o PRIMARIO avisa que o tipo fica sem destino de upload', async () => {
    const { container, aba } = await abrir();

    const btn = [...linhaDe(container, 'Acervo principal')
      .querySelectorAll('.data-table__action-btn')].find(b => b.title === 'Excluir');
    btn.click();
    await new Promise(r => setTimeout(r, 0));

    const { message } = confirmDialog.mock.calls[0][0];
    expect(message).toContain('PRIMÁRIO');
    expect(message).toContain('Carta Topográfica');

    aba.cleanup();
  });

  test('excluir um NAO primario nao traz esse aviso', async () => {
    const { container, aba } = await abrir();

    const btn = [...linhaDe(container, 'Espelho')
      .querySelectorAll('.data-table__action-btn')].find(b => b.title === 'Excluir');
    btn.click();
    await new Promise(r => setTimeout(r, 0));

    const { message } = confirmDialog.mock.calls[0][0];
    expect(message).not.toContain('PRIMÁRIO');
    expect(admin.excluirVolumeTipoProduto).toHaveBeenCalledWith([11]);

    aba.cleanup();
  });
});
