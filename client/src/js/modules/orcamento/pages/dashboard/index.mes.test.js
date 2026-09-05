import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O MÊS DO PAINEL, E O ANO QUE MEXE NELE.
//
// Arquivo SEPARADO do `index.test.js` por causa do RELÓGIO: aqui todo caso fala
// de "o mês de hoje", e o relógio fica congelado no ARQUIVO INTEIRO, e não dentro
// de um `describe`. O `index.test.js` ao lado roda no relógio de parede e computa
// `ANO_ATUAL` na importação, antes de qualquer hook: congelá-lo lá faria o ano da
// fixture discordar do ano que o código lê.
//
// O DEFEITO QUE ESTE ARQUIVO TRANCA: ir a um exercício anterior levava o mês para
// dezembro (certo, e o `index.test.js` já cobre), e VOLTAR ao ano corrente
// deixava o dezembro lá. O painel do ano em curso passava a se ler como exercício
// fechado, e o mês que o seletor mostrava não era o mês em que se estava. Só o
// mês que a própria troca de ano escolheu se desfaz: o escolhido a mão fica.

vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getExecucaoNd: vi.fn(),
  getAnos: vi.fn(),
}));

import { renderDashboard } from '@modules/orcamento/pages/dashboard/index.js';
import { getExecucaoNd, getAnos } from '@modules/orcamento/services/orcamento-service.js';

// 05/09/2026: um mês que NÃO é dezembro, senão a ida e a volta não se
// distinguiriam, e um dia que não é o primeiro nem o último do mês.
const HOJE = new Date('2026-09-05T10:00:00');
const ANO = 2026;
const MES = 9;

const LINHAS = [
  { cod_nd: 'TOTAL', nd_nome: 'TOTAL', previsto: 100, recebido: 50, recebido_pdr: 35, recebido_extra: 15, recolhido: 8, recolhido_pdr: 5, recolhido_extra: 3, empenhado: 40, empenhado_pdr: 25, empenhado_extra: 15, liquidado: 30, liquidado_pdr: 18, liquidado_extra: 12 },
];

// `shouldAdvanceTime` mantem o `setTimeout` do `flush` andando.
beforeEach(() => {
  vi.useFakeTimers({ shouldAdvanceTime: true });
  vi.setSystemTime(HOJE);
  getExecucaoNd.mockReset();
  getExecucaoNd.mockResolvedValue({ linhas: LINHAS, pendencias: {} });
  getAnos.mockReset();
  getAnos.mockResolvedValue([ANO, ANO - 1]);
});

afterEach(() => {
  vi.useRealTimers();
});

const montar = async () => {
  const container = document.createElement('div');
  const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
};

function selectDoCampo(container, rotulo) {
  const campo = [...container.querySelectorAll('.form-field')]
    .find(f => f.querySelector('.form-field__label')?.textContent.trim() === rotulo);
  if (!campo) throw new Error(`campo "${rotulo}" nao existe na tela`);
  return campo.querySelector('select');
}

async function trocarCampo(container, rotulo, valor) {
  const select = selectDoCampo(container, rotulo);
  select.value = String(valor);
  select.dispatchEvent(new Event('change'));
  await flush();
}

describe('painel do orçamento: o mês que a troca de ano escolhe', () => {
  test('o painel abre no mês de hoje', async () => {
    const { container, cleanup } = await montar();

    expect(selectDoCampo(container, 'Mês').value).toBe(String(MES));
    expect(getExecucaoNd).toHaveBeenLastCalledWith({ ano: ANO, mes: MES });

    cleanup();
  });

  test('voltar ao ano corrente DESFAZ o dezembro que a ida escolheu', async () => {
    const { container, cleanup } = await montar();

    await trocarCampo(container, 'Ano', ANO - 1);
    expect(selectDoCampo(container, 'Mês').value).toBe('12');

    await trocarCampo(container, 'Ano', ANO);

    expect(selectDoCampo(container, 'Mês').value).toBe(String(MES));
    expect(getExecucaoNd).toHaveBeenLastCalledWith({ ano: ANO, mes: MES });

    cleanup();
  });

  test('o mês escolhido A MÃO não sobrevive à ida ao exercício fechado', async () => {
    const { container, cleanup } = await montar();

    await trocarCampo(container, 'Mês', 3);
    await trocarCampo(container, 'Ano', ANO - 1);
    // O exercício fechado continua abrindo fechado, mesmo com escolha manual
    // atrás: ali dezembro é a resposta certa.
    expect(selectDoCampo(container, 'Mês').value).toBe('12');

    await trocarCampo(container, 'Ano', ANO);

    // E a volta devolve o mês de HOJE, e não o 3: o dezembro que se desfaz é o da
    // troca de ano, e a escolha manual de março morreu na ida.
    expect(selectDoCampo(container, 'Mês').value).toBe(String(MES));

    cleanup();
  });

  test('o ano FUTURO também abre em dezembro, e não no mês de hoje', async () => {
    // `permitirOutroAno` existe para o exercício que ainda não começou. Cortar a
    // execução de 2027 em 30/09/2027 esconde a NC emitida em novembro do
    // recebido, do recolhido e do saldo, enquanto o "Previsto" (que vem do PDR e
    // não tem recorte de mês) sai inteiro: previsto cheio contra execução
    // cortada, sem nada dizer.
    getAnos.mockResolvedValue([ANO + 1, ANO, ANO - 1]);
    const { container, cleanup } = await montar();

    await trocarCampo(container, 'Ano', ANO + 1);

    expect(selectDoCampo(container, 'Mês').value).toBe('12');
    expect(getExecucaoNd).toHaveBeenLastCalledWith({ ano: ANO + 1, mes: 12 });

    // E a volta ao ano corrente desfaz, pelo mesmo `mesVeioDoAno`.
    await trocarCampo(container, 'Ano', ANO);
    expect(selectDoCampo(container, 'Mês').value).toBe(String(MES));

    cleanup();
  });

  test('escolher o mês A MÃO no ano corrente não é desfeito por nada', async () => {
    const { container, cleanup } = await montar();

    await trocarCampo(container, 'Mês', 3);
    await trocarCampo(container, 'Ano', ANO);

    expect(selectDoCampo(container, 'Mês').value).toBe('3');

    cleanup();
  });
});
