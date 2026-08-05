import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/acervo/services/admin-service.js', () => ({
  criarLote: vi.fn(() => Promise.resolve({})),
  atualizarLote: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { openLoteDialog } from '@modules/acervo/pages/administracao/lote-dialog.js';
import * as svc from '@modules/acervo/services/admin-service.js';

const PROJETOS = [{ id: 5, nome: 'Convênio RS' }];
const STATUS = [{ code: 2, nome: 'Em execução' }];

const salvar = () =>
  [...document.querySelectorAll('.modal .btn')].find(b => b.textContent === 'Salvar');

const campo = (rotulo) => {
  const label = [...document.querySelectorAll('.modal label')]
    .find(l => l.textContent.replace('*', '').trim() === rotulo);
  return label.parentElement.querySelector('input, select, textarea');
};

const preencher = (rotulo, valor) => {
  const input = campo(rotulo);
  input.value = valor;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  input.dispatchEvent(new Event('change', { bubbles: true }));
};

describe('openLoteDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('grava o lote com o projeto a que ele pertence e o PIT', async () => {
    openLoteDialog({ projetos: PROJETOS, statusExecucao: STATUS });

    preencher('Projeto', '5');
    preencher('Nome', 'LOTE_1');
    preencher('PIT', 'PIT-2026');
    preencher('Data de início', '2026-01-05');
    preencher('Status de execução', '2');

    salvar().click();
    await flush();

    expect(svc.criarLote).toHaveBeenCalledWith({
      projeto_id: 5,
      pit: 'PIT-2026',
      nome: 'LOTE_1',
      descricao: '',
      data_inicio: '2026-01-05',
      data_fim: null,
      status_execucao_id: 2,
    });
  });

  // `projeto_id` e `pit` sao obrigatorios no servidor, e os dois sao faceis de
  // esquecer: o projeto porque e um select, e o PIT porque nao tem nada a ver
  // com o nome do lote.
  test('sem projeto e sem PIT a tela recusa antes de chamar o servidor', async () => {
    openLoteDialog({ projetos: PROJETOS, statusExecucao: STATUS });

    preencher('Nome', 'LOTE_1');
    preencher('Data de início', '2026-01-05');
    preencher('Status de execução', '2');

    salvar().click();
    await flush();

    expect(svc.criarLote).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Escolha o projeto do lote');
    expect(document.body.textContent).toContain('Informe o PIT do lote');
  });

  test('data de fim anterior a de inicio e recusada na tela', async () => {
    openLoteDialog({ projetos: PROJETOS, statusExecucao: STATUS });

    preencher('Projeto', '5');
    preencher('Nome', 'LOTE_1');
    preencher('PIT', 'PIT-2026');
    preencher('Data de início', '2026-06-01');
    preencher('Data de fim', '2026-05-01');
    preencher('Status de execução', '2');

    salvar().click();
    await flush();

    expect(svc.criarLote).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('não pode ser anterior');
  });
});
