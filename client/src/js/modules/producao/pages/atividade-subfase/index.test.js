import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O QUE ESTA TELA DECIDE são três coisas, e as três já morderam alguém:
//
//   o FUSO      'YYYY-MM-DD' lido por `new Date(texto)` é meia-noite em UTC, e
//               em UTC-3 a barra inteira anda um dia para trás;
//   o FIM       o servidor manda o dia SEGUINTE ao último (`fim + 1`), que é o
//               certo para desenhar e um dia a mais para escrever;
//   o AGRUPAMENTO  um quadro por lote, na ordem em que o servidor mandou.
const servico = vi.hoisted(() => ({ resposta: [], falha: null, chamadas: 0 }));

vi.mock('@services/producao-service.js', () => ({
  getAtividadeSubfase: () => {
    servico.chamadas += 1;
    if (servico.falha) return Promise.reject(servico.falha);
    return Promise.resolve(servico.resposta);
  },
}));

const { renderAtividadeSubfase, diaLocal, faixasDe } = await import('./index.js');

let container;

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
  servico.resposta = [];
  servico.falha = null;
  servico.chamadas = 0;
});

const abrir = async () => {
  const cleanup = await renderAtividadeSubfase(container);
  await flush();
  return cleanup;
};

const quadros = () => [...container.querySelectorAll('.linha-tempo__quadro')];
const barras = () => [...container.querySelectorAll('.linha-tempo__barra')];

describe('diaLocal: o dia do banco é o dia daqui', () => {
  test("'2026-01-01' é 1º de janeiro no fuso local, e não 31 de dezembro", async () => {
    const d = diaLocal('2026-01-01');
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(0);
    expect(d.getDate()).toBe(1);
  });

  test('aceita o timestamp completo, usando só os dez primeiros caracteres', async () => {
    const d = diaLocal('2026-03-15T00:00:00.000Z');
    expect(d.getMonth()).toBe(2);
    expect(d.getDate()).toBe(15);
  });

  test('nulo e lixo viram nulo, e não Invalid Date', async () => {
    expect(diaLocal(null)).toBeNull();
    expect(diaLocal('')).toBeNull();
    expect(diaLocal('nao-e-data')).toBeNull();
  });
});

describe('faixasDe: o que o servidor manda e o que a tela desenha', () => {
  test('lê o valor como TEXTO, que é como o SQL o entrega', async () => {
    const faixas = faixasDe({ data: [['2026-01-01', '1', '2026-01-05']] });
    expect(faixas).toHaveLength(1);
    expect(faixas[0].ativa).toBe(true);
  });

  test('lê o valor também como número, para o dia em que o cast sair', async () => {
    const faixas = faixasDe({ data: [['2026-01-01', 1, '2026-01-05']] });
    expect(faixas[0].ativa).toBe(true);
  });

  test('a faixa de valor 0 vem marcada como inativa', async () => {
    const faixas = faixasDe({ data: [['2026-01-01', '0', '2026-01-05']] });
    expect(faixas[0].ativa).toBe(false);
  });

  test('faixa torta é descartada em vez de derrubar a tela', async () => {
    const faixas = faixasDe({ data: [['2026-01-01'], null, ['x', '1', 'y']] });
    expect(faixas).toHaveLength(0);
  });

  test('sem `data`, a série não quebra', async () => {
    expect(faixasDe({})).toEqual([]);
  });
});

describe('atividade por subfase: o desenho', () => {
  test('só a faixa ATIVA vira barra; o trilho vazio é o "não trabalhou"', async () => {
    servico.resposta = [{
      lote: 'Lote 1',
      subfase: 'Edição',
      data: [
        ['2026-01-01', '0', '2026-02-01'],
        ['2026-02-01', '1', '2026-03-01'],
        ['2026-03-01', '0', '2026-04-01'],
      ],
    }];
    await abrir();

    expect(barras()).toHaveLength(1);
  });

  test('o rótulo da barra escreve o último dia INCLUSIVO', async () => {
    // O servidor manda `fim + 1`. Repeti-lo no texto diria um dia a mais.
    servico.resposta = [{
      lote: 'Lote 1',
      subfase: 'Edição',
      data: [['2026-02-10', '1', '2026-02-15']],
    }];
    await abrir();

    const titulo = barras()[0].getAttribute('title');
    expect(titulo).toContain('10/02/2026');
    expect(titulo).toContain('14/02/2026');
    expect(titulo).not.toContain('15/02/2026');
    expect(titulo).toContain('5 dias');
  });

  test('a posição da barra é proporcional ao período do conjunto', async () => {
    servico.resposta = [{
      lote: 'Lote 1',
      subfase: 'Edição',
      data: [
        ['2026-01-01', '1', '2026-01-11'],
        ['2026-01-11', '0', '2026-01-21'],
        ['2026-01-21', '1', '2026-01-31'],
      ],
    }];
    await abrir();

    const [primeira, segunda] = barras();
    // O domínio vai de 01/01 a 31/01 (30 dias). A primeira começa em 0%, a
    // terceira faixa (segunda barra) começa aos 20 dias, ou seja, em 2/3.
    expect(primeira.style.left).toBe('0%');
    expect(Math.round(parseFloat(segunda.style.left))).toBe(67);
  });

  test('faixa de um dia não some: o mínimo é em pixel, e a posição segue exata', async () => {
    servico.resposta = [{
      lote: 'Lote 1',
      subfase: 'Edição',
      data: [
        ['2026-01-01', '1', '2026-01-02'],
        ['2026-01-02', '0', '2026-12-31'],
      ],
    }];
    await abrir();

    expect(barras()[0].style.width).toContain('3px');
  });
});

describe('atividade por subfase: o agrupamento e os filtros', () => {
  const duasLinhas = () => [
    { lote: 'Lote 1', subfase: 'Edição', data: [['2026-01-01', '1', '2026-01-10']] },
    { lote: 'Lote 1', subfase: 'Validação', data: [['2026-01-05', '1', '2026-01-20']] },
    { lote: 'Lote 2', subfase: 'Edição', data: [['2026-02-01', '1', '2026-02-10']] },
  ];

  test('um quadro por lote, na ordem do servidor', async () => {
    servico.resposta = duasLinhas();
    await abrir();

    const titulos = quadros().map(q => q.querySelector('.linha-tempo__lote').textContent);
    expect(titulos).toEqual(['Lote 1', 'Lote 2']);
    expect(quadros()[0].querySelectorAll('.linha-tempo__linha')).toHaveLength(2);
  });

  test('o filtro de lote deixa um quadro só', async () => {
    servico.resposta = duasLinhas();
    await abrir();

    const select = container.querySelector('.page__filters select');
    select.value = 'Lote 2';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(quadros()).toHaveLength(1);
    expect(quadros()[0].querySelector('.linha-tempo__lote').textContent).toBe('Lote 2');
  });

  test('a busca por subfase ignora acento e caixa', async () => {
    servico.resposta = duasLinhas();
    await abrir();

    const input = container.querySelector('.page__filters input');
    input.value = 'validacao';
    input.dispatchEvent(new Event('input'));
    await new Promise(r => setTimeout(r, 300));

    expect(container.querySelectorAll('.linha-tempo__linha')).toHaveLength(1);
    expect(container.textContent).toContain('Validação');
  });

  test('sem atividade no ano, a tela afirma isso', async () => {
    servico.resposta = [];
    await abrir();
    expect(container.textContent).toContain('Nenhuma atividade lançada no ano corrente');
  });

  test('erro troca a área pelo estado de erro, e "tentar de novo" repete', async () => {
    servico.falha = new Error('linha do tempo indisponível');
    await abrir();
    expect(container.textContent).toContain('linha do tempo indisponível');

    servico.falha = null;
    servico.resposta = duasLinhas();
    container.querySelector('.dashboard-erro button').click();
    await flush();

    expect(servico.chamadas).toBe(2);
    expect(quadros()).toHaveLength(2);
  });
});
