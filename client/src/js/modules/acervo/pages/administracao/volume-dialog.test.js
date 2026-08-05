import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/acervo/services/admin-service.js', () => ({
  criarVolumeArmazenamento: vi.fn(() => Promise.resolve({})),
  atualizarVolumeArmazenamento: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { openVolumeDialog } from '@modules/acervo/pages/administracao/volume-dialog.js';
import * as svc from '@modules/acervo/services/admin-service.js';

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
};

describe('openVolumeDialog', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('grava nome, caminho, capacidade e layout de origem', async () => {
    openVolumeDialog({});

    preencher('Nome', 'Acervo principal');
    preencher('Caminho', '\\\\servidor\\acervo');
    preencher('Capacidade (GB)', '40000');
    campo('Layout de origem (volume de fornecedor)').click();

    salvar().click();
    await flush();

    expect(svc.criarVolumeArmazenamento).toHaveBeenCalledWith({
      nome: 'Acervo principal',
      volume: '\\\\servidor\\acervo',
      capacidade_gb: 40000,
      layout_origem: true,
    });
  });

  // `capacidade_gb` e `.required()` no Joi. Vazio aqui viraria um 400 com a
  // mensagem crua do servidor, num campo que a pessoa nao saberia qual e.
  test('capacidade vazia e recusada NA TELA, sem chamar o servidor', async () => {
    openVolumeDialog({});

    preencher('Nome', 'Acervo principal');
    preencher('Caminho', '\\\\servidor\\acervo');

    salvar().click();
    await flush();

    expect(svc.criarVolumeArmazenamento).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Informe a capacidade em GB');
  });

  test('nome e caminho vazios sao recusados na tela', async () => {
    openVolumeDialog({});

    preencher('Capacidade (GB)', '100');
    salvar().click();
    await flush();

    expect(svc.criarVolumeArmazenamento).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Informe o nome do volume');
    expect(document.body.textContent).toContain('Informe o caminho do volume');
  });

  // O PUT do servidor preserva `layout_origem` quando a chave nao vem
  // (preserveOmitted). A tela sempre MANDA a chave, com o valor que a caixinha
  // mostra -- e ela nasce com o valor gravado, entao editar o nome nao apaga a
  // marca.
  test('editar manda o id e preserva o layout de origem que veio do servidor', async () => {
    openVolumeDialog({
      volume: {
        id: 7, nome: 'Entrega', volume: '\\\\servidor\\entrega',
        capacidade_gb: 8000, layout_origem: true,
      },
    });

    preencher('Nome', 'Entrega do fornecedor');
    salvar().click();
    await flush();

    expect(svc.atualizarVolumeArmazenamento).toHaveBeenCalledWith({
      id: 7,
      nome: 'Entrega do fornecedor',
      volume: '\\\\servidor\\entrega',
      capacidade_gb: 8000,
      layout_origem: true,
    });
  });
});
