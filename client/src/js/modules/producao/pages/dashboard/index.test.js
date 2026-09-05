import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

vi.mock('@services/producao-service.js', () => ({
  getQuantidadeAno: vi.fn(),
  getFinalizadasAno: vi.fn(),
  getLotesEmExecucao: vi.fn(),
}));

import { renderProducaoDashboard, juntarPorLote } from './index.js';
import * as servico from '@services/producao-service.js';

const ANO = new Date().getFullYear();

const cartoes = (container) =>
  Array.from(container.querySelectorAll('.stats-card__value')).map(n => n.textContent.trim());

const falhas = (container) =>
  Array.from(container.querySelectorAll('.producao-painel__falha-texto')).map(n => n.textContent);

const celulas = (container) =>
  Array.from(container.querySelectorAll('tbody tr')).map(tr =>
    Array.from(tr.querySelectorAll('td')).map(td => td.textContent.trim()));

beforeEach(() => {
  servico.getQuantidadeAno.mockResolvedValue([
    { lote_id: 1, lote: 'Lote A', quantidade: 10 },
    { lote_id: 2, lote: 'Lote B', quantidade: 4 },
  ]);
  servico.getFinalizadasAno.mockResolvedValue([
    { lote_id: 1, lote: 'Lote A', finalizadas: 3 },
  ]);
  servico.getLotesEmExecucao.mockResolvedValue([
    { lote_id: 1, lote: 'Lote A', em_execucao: 2 },
  ]);
});

describe('juntarPorLote', () => {
  test('casa as tres fontes pelo lote_id, e nao pelo nome', () => {
    // Dois lotes de projetos diferentes podem repetir o rotulo. Casar por nome
    // juntaria os dois numa linha so, e ninguem veria o erro.
    const linhas = juntarPorLote({
      previsto: [
        { lote_id: 7, lote: 'Lote 1', quantidade: 10 },
        { lote_id: 9, lote: 'Lote 1', quantidade: 6 },
      ],
      finalizadas: [{ lote_id: 9, lote: 'Lote 1', finalizadas: 2 }],
      execucao: [],
    });

    expect(linhas).toHaveLength(2);
    expect(linhas.map(l => [l.lote_id, l.previsto, l.finalizadas])).toEqual([
      [7, 10, 0],
      [9, 6, 2],
    ]);
  });

  test('fonte que FALHOU vira null, e nao zero', () => {
    // Zero e uma afirmacao sobre o banco; a ausencia de resposta e outra coisa.
    const linhas = juntarPorLote({
      previsto: [{ lote_id: 1, lote: 'A', quantidade: 5 }],
      finalizadas: null,
      execucao: null,
    });

    expect(linhas[0].finalizadas).toBeNull();
    expect(linhas[0].em_execucao).toBeNull();
    expect(linhas[0].nao_iniciado).toBeNull();
    expect(linhas[0].conclusao).toBeNull();
  });

  test('o em execucao nao passa do que sobra do previsto', () => {
    // As duas contagens tem recortes diferentes: o previsto e do ANO e o em
    // execucao e de HOJE. Sem o teto, o nao iniciado ficaria negativo.
    const linhas = juntarPorLote({
      previsto: [{ lote_id: 1, lote: 'A', quantidade: 10 }],
      finalizadas: [{ lote_id: 1, lote: 'A', finalizadas: 8 }],
      execucao: [{ lote_id: 1, lote: 'A', em_execucao: 9 }],
    });

    expect(linhas[0].em_execucao).toBe(2);
    expect(linhas[0].nao_iniciado).toBe(0);
  });

  test('fonte que respondeu sem citar o lote esta dizendo zero sobre ele', () => {
    const linhas = juntarPorLote({
      previsto: [{ lote_id: 1, lote: 'A', quantidade: 5 }],
      finalizadas: [],
      execucao: [],
    });

    expect(linhas[0].finalizadas).toBe(0);
    expect(linhas[0].nao_iniciado).toBe(5);
  });
});

describe('renderProducaoDashboard', () => {
  test('monta o painel e pergunta as tres fontes pelo ano corrente', async () => {
    const container = document.createElement('div');
    const cleanup = await renderProducaoDashboard(container, { params: {}, query: new URLSearchParams() });

    expect(container.querySelector('.page__title').textContent).toBe('Painel da produção');
    expect(servico.getQuantidadeAno).toHaveBeenCalledWith(ANO);
    expect(servico.getFinalizadasAno).toHaveBeenCalledWith(ANO);
    // A terceira NAO recebe ano: e o retrato de hoje.
    expect(servico.getLotesEmExecucao).toHaveBeenCalledWith();

    expect(cartoes(container)).toEqual(['14', '3', '2']);
    expect(falhas(container)).toEqual([]);

    cleanup();
  });

  test('a tabela junta as tres fontes por lote', async () => {
    const container = document.createElement('div');
    const cleanup = await renderProducaoDashboard(container);

    // Lote A: 10 previsto, 3 finalizado, 2 em execucao, 5 nao iniciado.
    // Lote B: 4 previsto, nada finalizado nem em execucao.
    expect(celulas(container)).toEqual([
      ['Lote A', '10', '3', '2', '5', '30.0%'],
      ['Lote B', '4', '0', '0', '4', '0.0%'],
    ]);

    cleanup();
  });

  test('UMA fonte que falha NAO derruba a tela: as outras duas continuam', async () => {
    // A regra que mordeu tres vezes em 2026-08-08. Sem ela, o painel inteiro
    // mostraria "sem perfil" por causa de uma chamada so.
    servico.getFinalizadasAno.mockRejectedValue(new Error('Usuário necessita do perfil consulta'));

    const container = document.createElement('div');
    const cleanup = await renderProducaoDashboard(container);

    // O cartao da fonte que falhou fica em travessao; os outros dois trazem o
    // numero.
    expect(cartoes(container)).toEqual(['14', '—', '2']);

    const aviso = falhas(container);
    expect(aviso).toHaveLength(1);
    // A MENSAGEM DO SERVIDOR entra: e ela que distingue "sem perfil" de "sem rede".
    expect(aviso[0]).toContain('Usuário necessita do perfil consulta');
    expect(aviso[0]).toContain('finalizadas do ano');

    cleanup();
  });

  test('o "tentar de novo" da faixa refaz SO a pergunta que falhou', async () => {
    servico.getLotesEmExecucao.mockRejectedValueOnce(new Error('falha de rede'));

    const container = document.createElement('div');
    const cleanup = await renderProducaoDashboard(container);

    expect(falhas(container)).toHaveLength(1);
    const chamadasDePrevisto = servico.getQuantidadeAno.mock.calls.length;

    container.querySelector('.producao-painel__falha .btn').click();
    await flush();

    expect(falhas(container)).toEqual([]);
    expect(cartoes(container)[2]).toBe('2');
    // As outras duas NAO foram refeitas.
    expect(servico.getQuantidadeAno.mock.calls.length).toBe(chamadasDePrevisto);

    cleanup();
  });

  test('o grafico so recebe as series cujas fontes responderam', async () => {
    servico.getFinalizadasAno.mockRejectedValue(new Error('falhou'));

    const container = document.createElement('div');
    const cleanup = await renderProducaoDashboard(container);

    // Uma serie de zeros por falha de rede se leria como "nada foi finalizado".
    const legendas = Array.from(container.querySelectorAll('.chart-card'))
      .length;
    expect(legendas).toBe(1);

    const { instanciasChart } = await import('@components/charts/chart-stub.js');
    const grafico = instanciasChart[instanciasChart.length - 1];
    // "Nao iniciado" TAMBEM SAI, e nao so a serie que caiu: ele e uma CONTA
    // entre as tres (`juntarPorLote` o deixa nulo em toda linha quando falta
    // qualquer uma delas). Mantendo a legenda, o grafico ganharia um rotulo que
    // nao desenha barra nenhuma, e a leitura seria "nao ha nada nao iniciado".
    expect(grafico.data.datasets.map(d => d.label)).toEqual(['Em execução']);

    cleanup();
  });

  test('a fonte de execucao que cai tambem leva o "Nao iniciado" embora', async () => {
    servico.getLotesEmExecucao.mockRejectedValue(new Error('falhou'));

    const container = document.createElement('div');
    const cleanup = await renderProducaoDashboard(container);

    const { instanciasChart } = await import('@components/charts/chart-stub.js');
    const grafico = instanciasChart[instanciasChart.length - 1];
    expect(grafico.data.datasets.map(d => d.label)).toEqual(['Finalizado']);

    cleanup();
  });

  test('o seletor abre no ano corrente e oferece trabalhar em outro', async () => {
    // NAO HA ROTA que diga quais anos tem dado de producao, entao o seletor nao
    // recebe `carregarAnos`: inventar uma lista seria afirmar o que o servidor
    // nao confirmou.
    const container = document.createElement('div');
    const cleanup = await renderProducaoDashboard(container);

    const opcoes = Array.from(container.querySelectorAll('.page__filters select option'))
      .map(o => o.textContent);
    expect(opcoes).toEqual([String(ANO), '+ Outro ano…']);

    cleanup();
  });

  test('Atualizar refaz as TRES perguntas', async () => {
    const container = document.createElement('div');
    const cleanup = await renderProducaoDashboard(container);

    container.querySelector('.page__actions .btn').click();
    await flush();

    expect(servico.getQuantidadeAno).toHaveBeenCalledTimes(2);
    expect(servico.getFinalizadasAno).toHaveBeenCalledTimes(2);
    expect(servico.getLotesEmExecucao).toHaveBeenCalledTimes(2);

    cleanup();
  });
});
