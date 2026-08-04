import { describe, test, expect, vi } from 'vitest';

vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getProdutoActivityTimeline: vi.fn((meses) => Promise.resolve([
    { month: '2026-06', new_products: 4, modified_products: 1, meses },
    { month: '2026-07', new_products: 6, modified_products: 2, meses },
  ])),
  getVersaoActivityTimeline: vi.fn(() => Promise.resolve([
    { month: '2026-06', novas_versoes: '3', acumulado: '3' },
    { month: '2026-07', novas_versoes: '5', acumulado: '8' },
  ])),
  getStorageGrowthTrends: vi.fn(() => Promise.resolve([
    { month: '2026-07', gb_added: '10.5', cumulative_gb: '120.5' },
  ])),
  getVersionStatistics: vi.fn(() => Promise.resolve({
    stats: {
      total_versions: '7023',
      products_with_versions: '5741',
      avg_versions_per_product: '1.22',
      max_versions_per_product: '9',
    },
    distribution: [{ versions_per_product: 1, product_count: '5000' }],
    type_distribution: [{ version_type: 'Regular', version_count: '6000' }, { version_type: null, version_count: '23' }],
  })),
  getProjectStatusSummary: vi.fn(() => Promise.resolve({
    projects_without_lots: '2',
    project_status: [{ status: 'Em execução', project_count: '5' }],
    lot_status: [{ status: 'Concluído', lot_count: '30' }],
  })),
  getUserActivityMetrics: vi.fn(() => Promise.resolve([
    { usuario_nome: 'Fulano', usuario_login: 'fulano', uploads: '10', modifications: '2', downloads: '5', total_activity: '17' },
    { usuario_nome: null, usuario_login: 'ciclano', uploads: '1', modifications: '0', downloads: '0', total_activity: '1' },
  ])),
}));

import {
  renderAdvancedTab, renderVersionStats, renderStorageTrends,
  renderProjectStatus, renderUserActivity,
} from './advanced-tab.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderAdvancedTab', () => {
  test('monta as duas linhas do tempo com seletor de periodo e as quatro sub-abas', async () => {
    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    expect(acervoService.getProdutoActivityTimeline).toHaveBeenCalledWith(6);
    expect(acervoService.getVersaoActivityTimeline).toHaveBeenCalledWith(6);

    const seletores = container.querySelectorAll('.chart-card__select');
    expect(seletores.length).toBeGreaterThanOrEqual(2);
    expect(Array.from(seletores[0].options).map(o => o.value)).toEqual(['6', '12', '24']);

    // O titulo saiu do lugar padrao e entrou no cabecalho com o seletor.
    const titulos = Array.from(container.querySelectorAll('.chart-card__header .chart-card__title'))
      .map(n => n.textContent);
    expect(titulos).toContain('Linha do Tempo de Produtos');
    expect(titulos).toContain('Linha do Tempo de Versões Cadastradas');

    expect(container.querySelectorAll('.sub-tabs__item')).toHaveLength(4);

    aba.cleanup();
  });

  test('trocar o periodo refaz a busca com o novo numero de meses', async () => {
    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    const seletor = container.querySelectorAll('.chart-card__select')[0];
    seletor.value = '24';
    seletor.dispatchEvent(new Event('change'));
    await flush();

    expect(acervoService.getProdutoActivityTimeline).toHaveBeenCalledWith(24);

    aba.cleanup();
  });

  test('refresh mantem o periodo escolhido em cada linha do tempo', async () => {
    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    const seletor = container.querySelectorAll('.chart-card__select')[1];
    seletor.value = '12';
    seletor.dispatchEvent(new Event('change'));
    await flush();

    acervoService.getVersaoActivityTimeline.mockClear();
    await aba.refresh();
    expect(acervoService.getVersaoActivityTimeline).toHaveBeenCalledWith(12);

    aba.cleanup();
  });

  test('o mes AAAA-MM vira rotulo curto no eixo', async () => {
    const { instanciasChart } = await import('@components/charts/chart-stub.js');
    instanciasChart.length = 0;

    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    // Varias abas montam grafico em paralelo: acha pelo rotulo da serie.
    const timeline = instanciasChart.find(c =>
      c.data.datasets.some(d => d.label === 'Novos Produtos'));
    expect(timeline).toBeDefined();
    expect(timeline.data.labels).toHaveLength(2);
    expect(timeline.data.labels[0]).not.toBe('2026-06');
    expect(timeline.data.labels[0]).toContain('2026');

    aba.cleanup();
  });
});

describe('sub-aba: estatisticas de versoes', () => {
  test('preenche os quatro cards de resumo e os dois setores', async () => {
    const container = document.createElement('div');
    const sub = await renderVersionStats(container);

    const valores = Array.from(container.querySelectorAll('.summary-card__value')).map(n => n.textContent);
    expect(valores).toEqual(['7.023', '5.741', '1.2', '9']);
    expect(container.querySelectorAll('.chart-card')).toHaveLength(2);

    sub.cleanup();
  });

  test('tipo de versao nulo nao vira rotulo vazio', async () => {
    const { instanciasChart } = await import('@components/charts/chart-stub.js');
    instanciasChart.length = 0;

    const container = document.createElement('div');
    const sub = await renderVersionStats(container);

    const pieTipo = instanciasChart.find(c =>
      c.config.type === 'pie' && c.data.labels.includes('Regular'));
    expect(pieTipo).toBeDefined();
    expect(pieTipo.data.labels).toContain('Sem tipo');

    sub.cleanup();
  });

  // ESTE TESTE FIXAVA O DEFEITO: ele exigia os dois setores VAZIOS quando o
  // endpoint falhava. O que ele cobrava era exatamente a leitura errada. A
  // asercao virou "nao lanca", que e a parte legitima, e o estado de erro tem
  // teste proprio no bloco do fim.
  test('falha do endpoint nao lanca, e a sub-aba continua de pe', async () => {
    acervoService.getVersionStatistics.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const sub = await renderVersionStats(container);

    expect(sub.cleanup).toBeTypeOf('function');
    expect(container.querySelectorAll('.chart-card__empty')).toHaveLength(0);
    sub.cleanup();
  });
});

describe('sub-aba: tendencias de armazenamento', () => {
  test('busca 6 meses por padrao e respeita a troca de periodo', async () => {
    const container = document.createElement('div');
    const sub = await renderStorageTrends(container);

    expect(acervoService.getStorageGrowthTrends).toHaveBeenCalledWith(6);

    const seletor = container.querySelector('.chart-card__select');
    seletor.value = '12';
    seletor.dispatchEvent(new Event('change'));
    await flush();
    expect(acervoService.getStorageGrowthTrends).toHaveBeenCalledWith(12);

    acervoService.getStorageGrowthTrends.mockClear();
    await sub.refresh();
    expect(acervoService.getStorageGrowthTrends).toHaveBeenCalledWith(12);

    sub.cleanup();
  });
});

describe('sub-aba: status de projetos', () => {
  test('mostra o card de projetos sem lote e os dois setores', async () => {
    const container = document.createElement('div');
    const sub = await renderProjectStatus(container);

    expect(container.querySelector('.summary-card__value').textContent).toBe('2');
    expect(container.querySelector('.summary-card__label').textContent).toBe('Projetos sem Lotes');
    expect(container.querySelectorAll('.chart-card')).toHaveLength(2);

    sub.cleanup();
  });
});

describe('sub-aba: atividade de usuarios', () => {
  test('lista os usuarios e cai no login quando nao ha nome', async () => {
    const container = document.createElement('div');
    const sub = await renderUserActivity(container);

    expect(acervoService.getUserActivityMetrics).toHaveBeenCalledWith(10);

    const linhas = Array.from(container.querySelectorAll('tbody tr'));
    expect(linhas).toHaveLength(2);
    expect(linhas[0].children[0].textContent).toBe('Fulano');
    expect(linhas[0].children[1].textContent).toBe('10');
    expect(linhas[1].children[0].textContent).toBe('ciclano');

    sub.cleanup();
  });

  // ESTE TESTE FIXAVA O DEFEITO. Ele exigia a frase "Sem atividade de usuario
  // registrada" quando o endpoint falhava, ou seja, cobrava justamente a leitura
  // errada: acervo sem movimento e API fora do ar viravam a mesma tela.
  test('falha do endpoint mostra ERRO, e nao a frase de tabela vazia', async () => {
    acervoService.getUserActivityMetrics.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const sub = await renderUserActivity(container);

    const erro = container.querySelector('.dashboard-erro');
    expect(erro).not.toBeNull();
    expect(erro.getAttribute('role')).toBe('alert');
    expect(container.textContent).not.toContain('Sem atividade de usuário registrada');

    sub.cleanup();
  });
});

/**
 * O painel nao pode dizer "nao ha" quando a resposta certa e "nao consegui
 * saber". Os seis carregamentos desta aba engoliam a falha no `catch` e
 * pintavam a serie com zero pontos, e o card entao mostrava "Sem dados
 * disponiveis", que e a frase do acervo sem producao (2026-08-04).
 */
describe('endpoint que falha mostra ERRO, e nao grafico vazio', () => {
  const semDados = (container) =>
    Array.from(container.querySelectorAll('.chart-card__empty'))
      .some(n => n.textContent.includes('Sem dados disponíveis'));

  test('linha do tempo de produtos', async () => {
    acervoService.getProdutoActivityTimeline.mockRejectedValueOnce(new Error('Falha ao consultar'));

    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    const erro = container.querySelector('.dashboard-erro');
    expect(erro).not.toBeNull();
    expect(erro.textContent).toContain('Falha ao consultar');
    expect(semDados(container)).toBe(false);

    aba.cleanup();
  });

  // O GRAFICO VIZINHO SOBREVIVE. As duas linhas do tempo dividem a mesma grade,
  // e vem de endpoints diferentes: pintar o erro por cima do container apagaria
  // o grafico que carregou BEM, o que e perder informacao boa por causa de uma
  // falha alheia.
  test('a falha de uma linha do tempo nao apaga a outra', async () => {
    acervoService.getProdutoActivityTimeline.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    expect(container.querySelectorAll('.dashboard-erro')).toHaveLength(1);

    // O card de versoes carregou, e o erro esta no card de produtos.
    const cards = Array.from(container.querySelectorAll('.chart-card'));
    const comErro = cards.filter(c => c.querySelector('.dashboard-erro'));
    expect(comErro).toHaveLength(1);
    expect(comErro[0].querySelector('.chart-card__title').textContent)
      .toBe('Linha do Tempo de Produtos');

    // E o seletor de periodo continua no cabecalho do card que falhou: sem ele
    // quem ve o erro perde o controle que refaz a pergunta com outra janela.
    expect(comErro[0].querySelector('.chart-card__select')).not.toBeNull();

    aba.cleanup();
  });

  test('o "tentar de novo" da linha do tempo refaz a chamada', async () => {
    acervoService.getVersaoActivityTimeline.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);
    expect(container.querySelector('.dashboard-erro')).not.toBeNull();

    const antes = acervoService.getVersaoActivityTimeline.mock.calls.length;
    [...container.querySelectorAll('.dashboard-erro button')]
      .find(b => b.textContent.includes('Tentar de novo')).click();
    await flush();

    expect(acervoService.getVersaoActivityTimeline.mock.calls.length).toBe(antes + 1);
    expect(container.querySelector('.dashboard-erro')).toBeNull();

    aba.cleanup();
  });

  test('estatisticas de versoes', async () => {
    acervoService.getVersionStatistics.mockRejectedValueOnce(new Error('sem permissão'));

    const container = document.createElement('div');
    const sub = await renderVersionStats(container);

    const erro = container.querySelector('.dashboard-erro');
    expect(erro).not.toBeNull();
    expect(erro.textContent).toContain('sem permissão');
    expect(semDados(container)).toBe(false);

    sub.cleanup();
  });

  test('tendencias de armazenamento', async () => {
    acervoService.getStorageGrowthTrends.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const sub = await renderStorageTrends(container);

    expect(container.querySelector('.dashboard-erro')).not.toBeNull();
    expect(semDados(container)).toBe(false);
    // O seletor de periodo fica de pe tambem aqui.
    expect(container.querySelector('.chart-card__select')).not.toBeNull();

    sub.cleanup();
  });

  test('status de projetos', async () => {
    acervoService.getProjectStatusSummary.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const sub = await renderProjectStatus(container);

    expect(container.querySelector('.dashboard-erro')).not.toBeNull();
    expect(semDados(container)).toBe(false);

    sub.cleanup();
  });
});
