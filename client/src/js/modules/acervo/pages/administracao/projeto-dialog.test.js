import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/acervo/services/admin-service.js', () => ({
  criarProjeto: vi.fn(() => Promise.resolve({})),
  atualizarProjeto: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { openProjetoDialog } from '@modules/acervo/pages/administracao/projeto-dialog.js';
import * as svc from '@modules/acervo/services/admin-service.js';

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

describe('openProjetoDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // AS DATAS VAO COMO STRING 'AAAA-MM-DD'. E o formato que o `<input type="date">`
  // produz, e o servidor usa `Joi.date().raw()` justamente para ele chegar cru ao
  // Postgres: convertido em Date, viraria meia-noite UTC e a coluna DATE guardaria
  // o dia ANTERIOR em UTC-3.
  test('manda as datas como dia de calendario, sem hora e sem fuso', async () => {
    openProjetoDialog({ statusExecucao: STATUS });

    preencher('Nome', 'Convênio RS');
    preencher('Data de início', '2026-01-05');
    preencher('Data de fim', '2026-12-31');
    preencher('Status de execução', '2');

    salvar().click();
    await flush();

    expect(svc.criarProjeto).toHaveBeenCalledWith({
      nome: 'Convênio RS',
      descricao: '',
      data_inicio: '2026-01-05',
      data_fim: '2026-12-31',
      status_execucao_id: 2,
    });
  });

  // `descricao` e `Joi.string().allow('').required()`: null seria 400. A tela
  // manda '' quando o campo fica em branco, e nao null.
  test('descricao em branco vai como string vazia, nunca null', async () => {
    openProjetoDialog({ statusExecucao: STATUS });

    preencher('Nome', 'Projeto sem descrição');
    preencher('Data de início', '2026-02-01');
    preencher('Status de execução', '2');

    salvar().click();
    await flush();

    const enviado = svc.criarProjeto.mock.calls[0][0];
    expect(enviado.descricao).toBe('');
    // Projeto em andamento nao tem fim, e null e o que o schema aceita.
    expect(enviado.data_fim).toBeNull();
  });

  // Espelha o CHECK data_fim >= data_inicio do banco. Sem isto, o erro chegaria
  // como 400 do Joi, sem apontar campo.
  test('data de fim anterior a de inicio e recusada na tela', async () => {
    openProjetoDialog({ statusExecucao: STATUS });

    preencher('Nome', 'Invertido');
    preencher('Data de início', '2026-06-01');
    preencher('Data de fim', '2026-05-01');
    preencher('Status de execução', '2');

    salvar().click();
    await flush();

    expect(svc.criarProjeto).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('não pode ser anterior');
  });

  test('editar manda o id junto do corpo', async () => {
    openProjetoDialog({
      projeto: {
        id: 5, nome: 'Convênio RS', descricao: 'Sistemático',
        data_inicio: '2026-01-05', data_fim: null, status_execucao_id: 2,
      },
      statusExecucao: STATUS,
    });

    salvar().click();
    await flush();

    expect(svc.atualizarProjeto).toHaveBeenCalledWith({
      id: 5,
      nome: 'Convênio RS',
      descricao: 'Sistemático',
      data_inicio: '2026-01-05',
      data_fim: null,
      status_execucao_id: 2,
    });
  });
});
