import { describe, test, expect, vi } from 'vitest';

// O jsdom devolve null em canvas.getContext('2d'), e o Chart real estoura no
// primeiro update com dado. Sem o dublê, o try/catch do load() engoliria a
// falha e o teste passaria com o gráfico quebrado.
vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

import { renderExecucaoTab } from '@modules/orcamento/pages/dashboard/execucao-tab.js';

/**
 * OS DOIS CARTÕES QUE MENTIAM, com os números medidos em produção em 2026-08-07.
 *
 * 1. "% recebido do previsto" dividia o recebido TOTAL (PDR mais Extra-PDR) pelo
 *    previsto, que é só do PDR. Extra-PDR é, por definição, o crédito que o PDR
 *    não previu: ele não tem denominador honesto. O cartão mostrava 116,9% onde
 *    a execução do PDR era 49,0%, que é a diferença entre "estamos sobrando" e
 *    "falta metade do crédito chegar".
 *
 * 2. "Saldo" era um líquido que cancelava coisas opostas: R$ 428,73 eram
 *    R$ 5.612,10 de crédito por empenhar MENOS R$ 5.183,37 de saldo negativo.
 *    Saldo negativo é impossível e sempre aponta defeito de lançamento (naquele
 *    dia, dois empenhos anulados no SIAFI que o SCA ainda contava).
 */
const TOTAL_MEDIDO = {
  cod_nd: 'TOTAL',
  nd_nome: 'TOTAL',
  previsto: 569300.66,
  recebido: 665270.07,
  recebido_pdr: 279016.07,
  recebido_extra: 386254.00,
  recolhido: 80208.27,
  recolhido_pdr: 80208.27,
  recolhido_extra: 0,
  empenhado: 579449.07,
  empenhado_pdr: 193195.07,
  empenhado_extra: 386254.00,
  liquidado: 400000.00,
  liquidado_pdr: 200000.00,
  liquidado_extra: 200000.00,
  saldo_positivo: 5612.10,
  saldo_negativo: -5183.37,
};

// Uma linha de ND qualquer, só para o gráfico ter o que plotar. Os cartões leem
// a linha TOTAL.
const LINHA_ND = { ...TOTAL_MEDIDO, cod_nd: '339030', nd_nome: 'Material' };

const storeFake = (total) => ({
  carregar: vi.fn(async () => ({
    linhas: [{ ...LINHA_ND }, { ...total }],
    pendencias: {},
  })),
});

/** O valor do cartão cujo título é `titulo`. */
function valorDoCard(container, titulo) {
  const cards = [...container.querySelectorAll('.stats-card')];
  const card = cards.find(
    c => c.querySelector('.stats-card__title')?.textContent === titulo
  );
  expect(card, `cartão "${titulo}" não encontrado`).toBeTruthy();
  return card.querySelector('.stats-card__value').textContent;
}

/** O elemento do cartão cujo título é `titulo` (ou undefined). */
function cardPorTitulo(container, titulo) {
  return [...container.querySelectorAll('.stats-card')].find(
    c => c.querySelector('.stats-card__title')?.textContent === titulo
  );
}

/** Só os dígitos e a vírgula, para a comparação não depender do símbolo nem do espaço. */
const numero = (texto) => texto.replace(/[^\d,.-]/g, '');

describe('cartão "% recebido do previsto"', () => {
  test('divide o recebido do PDR pelo previsto, e não o recebido total', async () => {
    const container = document.createElement('div');
    const aba = await renderExecucaoTab(container, storeFake(TOTAL_MEDIDO));

    // 279.016,07 / 569.300,66 = 49,0%. Antes do conserto saía 116,9%.
    expect(valorDoCard(container, '% recebido do previsto (PDR)')).toContain('49,0');
    expect(valorDoCard(container, '% recebido do previsto (PDR)')).not.toContain('116,9');

    aba.cleanup();
  });

  test('o Extra-PDR aparece em VALOR, sem percentual', async () => {
    const container = document.createElement('div');
    const aba = await renderExecucaoTab(container, storeFake(TOTAL_MEDIDO));

    const valor = valorDoCard(container, 'Recebido Extra-PDR (sem previsão)');
    expect(numero(valor)).toBe('386.254,00');
    expect(valor).not.toContain('%');

    aba.cleanup();
  });

  test('previsto zero devolve "-", e não 0,0 (ano sem PDR)', async () => {
    // VARIÂNCIA contra o caso acima: sem este, o conserto passaria numa versão
    // que dividisse por zero e escrevesse "Infinity" ou "0,0", e um ano sem PDR
    // se leria como "nada foi recebido".
    const container = document.createElement('div');
    const aba = await renderExecucaoTab(
      container, storeFake({ ...TOTAL_MEDIDO, previsto: 0 })
    );

    expect(valorDoCard(container, '% recebido do previsto (PDR)')).toContain('-');

    aba.cleanup();
  });
});

describe('cartões de saldo', () => {
  test('separa o crédito a empenhar do saldo negativo, sem cancelar um com o outro', async () => {
    const container = document.createElement('div');
    const aba = await renderExecucaoTab(container, storeFake(TOTAL_MEDIDO));

    expect(numero(valorDoCard(container, 'Crédito a empenhar'))).toBe('5.612,10');
    expect(numero(valorDoCard(container, 'Saldo negativo (inconsistência)')))
      .toBe('-5.183,37');

    // O líquido de antes NÃO aparece em lugar nenhum da aba: era ele que
    // escondia os dois números de cima atrás de R$ 428,73.
    expect(container.textContent).not.toContain('428,73');

    aba.cleanup();
  });

  test('o cartão de inconsistência SOME quando não há saldo negativo', async () => {
    const container = document.createElement('div');
    const aba = await renderExecucaoTab(
      container, storeFake({ ...TOTAL_MEDIDO, saldo_negativo: 0 })
    );

    const card = cardPorTitulo(container, 'Saldo negativo (inconsistência)');
    // Ele existe no DOM (o mesmo nó volta quando a inconsistência aparecer), mas
    // está escondido: alerta zerado todo mês ensina a ignorar o alerta.
    expect(card.classList.contains('hidden')).toBe(true);

    aba.cleanup();
  });

  test('o cartão de inconsistência APARECE quando há saldo negativo', async () => {
    const container = document.createElement('div');
    const aba = await renderExecucaoTab(container, storeFake(TOTAL_MEDIDO));

    const card = cardPorTitulo(container, 'Saldo negativo (inconsistência)');
    expect(card.classList.contains('hidden')).toBe(false);

    aba.cleanup();
  });
});
