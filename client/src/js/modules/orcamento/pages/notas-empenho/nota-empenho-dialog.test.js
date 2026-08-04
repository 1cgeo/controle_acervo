import { describe, test, expect, vi, beforeEach } from 'vitest';

// Regressao do bug de tipo de id: createSelectField devolve o valor da opcao com
// o TIPO ORIGINAL (form-fields.js:198-201). Os ids chegam da API como TEXTO
// (pg-promise entrega BIGINT como string), e o schema do servidor cobra
// Joi.number().integer().strict() em notas_credito[].nota_credito_id
// (nota_empenho_schema.js:20). Texto nao passa: toda NE salva pela web dava 400.
// Este teste fixa que o corpo enviado leva o id como NUMERO.

const { createNotaEmpenho, updateNotaEmpenho } = vi.hoisted(() => ({
  createNotaEmpenho: vi.fn(() => Promise.resolve({})),
  updateNotaEmpenho: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotaEmpenho: vi.fn(() => Promise.resolve({
    id: 55,
    ano: 2026,
    numero: '2026NE000023',
    data_empenho: '2026-03-01',
    finalidade: 'Teste',
    valor_anulado: 0,
    valor_empenhado: 1000,
    notas_credito: [{ nota_credito_id: '3', valor: '1000.00' }],
  })),
  createNotaEmpenho,
  updateNotaEmpenho,
  // Ids como TEXTO, igual ao que a API real devolve.
  getNotasCredito: vi.fn(() => Promise.resolve([
    { id: '3', numero: '2026NC400136', cod_nd: '339039', nd_nome: 'Serviços de terceiros' },
    { id: '7', numero: '2026NC400137', cod_nd: '339039', nd_nome: 'Serviços de terceiros' },
  ])),
}));

import { openNotaEmpenhoDialog } from '@modules/orcamento/pages/notas-empenho/nota-empenho-dialog.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

function botao(rotulo) {
  return [...document.querySelectorAll('.modal__footer .btn')]
    .find(b => b.textContent.trim() === rotulo);
}

function preencherTexto(input, valor) {
  input.value = valor;
  input.dispatchEvent(new Event('input', { bubbles: true }));
}

describe('openNotaEmpenhoDialog: tipo do id enviado ao servidor', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  test('nota_credito_id do rateio vai como numero, e nao como texto', async () => {
    // O ano vem por PARAMETRO de quem abre o dialog: ele nao le store global.
    await openNotaEmpenhoDialog({ ano: 2026 });
    await flush();

    const numero = document.querySelector('.modal__body input[type="text"]');
    preencherTexto(numero, '2026NE000099');

    const ncSelect = document.querySelector('.modal__body select');
    ncSelect.value = '3';
    ncSelect.dispatchEvent(new Event('change', { bubbles: true }));

    const valor = [...document.querySelectorAll('.modal__body input[type="number"]')][0];
    preencherTexto(valor, '1000');

    botao('Salvar').click();
    await flush();

    expect(createNotaEmpenho).toHaveBeenCalledTimes(1);
    const corpo = createNotaEmpenho.mock.calls[0][0];
    // A NE nova nasce no ano que a TELA passou, e nao num ano guardado.
    expect(corpo.ano).toBe(2026);
    expect(corpo.notas_credito).toHaveLength(1);
    expect(typeof corpo.notas_credito[0].nota_credito_id).toBe('number');
    expect(corpo.notas_credito[0].nota_credito_id).toBe(3);
  });

  test('na edicao com duas NCs, os dois ids vao como numero', async () => {
    await openNotaEmpenhoDialog({ neId: 55, ano: 2026 });
    await flush();

    // Acrescenta a segunda NC do rateio.
    const addBtn = [...document.querySelectorAll('.modal__body button')]
      .find(b => b.textContent.includes('Adicionar NC'));
    addBtn.click();
    await flush();

    const selects = [...document.querySelectorAll('.modal__body select')];
    expect(selects).toHaveLength(2);
    selects[1].value = '7';
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));

    const valores = [...document.querySelectorAll('.modal__body input[type="number"]')];
    preencherTexto(valores[1], '500');

    botao('Salvar').click();
    await flush();

    expect(updateNotaEmpenho).toHaveBeenCalledTimes(1);
    const corpo = updateNotaEmpenho.mock.calls[0][1];
    for (const alocacao of corpo.notas_credito) {
      expect(typeof alocacao.nota_credito_id).toBe('number');
    }
  });
});
