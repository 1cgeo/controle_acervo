import { describe, test, expect, vi } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  // Sem `acumulado`: a série saiu do endpoint quando ela passou a contar por
  // data_edicao, porque o acumulado (milhares) achatava as novas (dezenas) no
  // mesmo eixo Y e o gráfico virava barras iguais.
  getVersaoActivityTimeline: vi.fn((meses) => Promise.resolve([
    { month: '2026-06', novas_versoes: '3', meses },
    { month: '2026-07', novas_versoes: '5', meses },
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
    type_distribution: [
      { version_type: 'Regular', version_count: '6000' },
      { version_type: null, version_count: '23' },
    ],
  })),
}));

import { renderAdvancedTab, renderVersionStats, renderStorageTrends } from './advanced-tab.js';
import { instanciasChart } from '@components/charts/chart-stub.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';

const titulos = (c) => Array.from(c.querySelectorAll('.chart-card__title')).map(t => t.textContent);

describe('renderAdvancedTab', () => {
  test('monta a producao com seletor de periodo e as duas sub-abas', async () => {
    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    expect(acervoService.getVersaoActivityTimeline).toHaveBeenCalledWith(6);
    expect(titulos(container)).toContain('Produção por mês (data de edição)');

    // A "Linha do Tempo de Produtos" SAIU. Ela contava data_cadastramento, que é
    // a entrada no SCA, e desenhava a migração do acervo como se fosse produção.
    expect(titulos(container)).not.toContain('Linha do Tempo de Produtos');
    // Um gráfico só nesta faixa, e não dois lado a lado.
    expect(container.querySelectorAll('.chart-card__select')).toHaveLength(1);

    // DUAS sub-abas: saíram "Status de Projetos" e "Atividade de Usuários".
    const subAbas = Array.from(container.querySelectorAll('.sub-tabs__item')).map(b => b.textContent);
    expect(subAbas).toEqual(['Estatísticas de Versões', 'Tendências de Armazenamento']);

    aba.cleanup();
  });

  test('trocar o periodo refaz a busca com o novo numero de meses', async () => {
    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    const select = container.querySelector('.chart-card__select');
    select.value = '24';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(acervoService.getVersaoActivityTimeline).toHaveBeenCalledWith(24);

    aba.cleanup();
  });

  test('refresh mantem o periodo escolhido', async () => {
    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    const select = container.querySelector('.chart-card__select');
    select.value = '12';
    select.dispatchEvent(new Event('change'));
    await flush();

    acervoService.getVersaoActivityTimeline.mockClear();
    await aba.refresh();
    await flush();

    expect(acervoService.getVersaoActivityTimeline).toHaveBeenCalledWith(12);

    aba.cleanup();
  });

  test('o mes AAAA-MM vira rotulo curto no eixo', async () => {
    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    // O rótulo sai do toLocaleDateString: 'jun. de 2026' em pt-BR.
    expect(container.textContent.toLowerCase()).not.toContain('2026-06');

    aba.cleanup();
  });

  // FALHA E VAZIO SAO COISAS DIFERENTES. Zerando a serie no catch, o card diz
  // "Sem dados disponiveis", que e a frase do mes sem carta editada: rota fora do
  // ar se leria como producao parada.
  test('endpoint fora do ar vira estado de ERRO, e nao grafico vazio', async () => {
    acervoService.getVersaoActivityTimeline.mockRejectedValueOnce(new Error('Falha ao consultar'));

    const container = document.createElement('div');
    const aba = await renderAdvancedTab(container);

    const erro = container.querySelector('.chart-card .dashboard-erro');
    expect(erro).not.toBeNull();
    expect(erro.textContent).toContain('Falha ao consultar');
    expect(container.textContent).not.toContain('Sem dados disponíveis');

    aba.cleanup();
  });
});

describe('sub-aba: estatisticas de versoes', () => {
  test('mostra a media, o maximo e os tipos de versao', async () => {
    const container = document.createElement('div');
    const aba = await renderVersionStats(container);

    const cards = Array.from(container.querySelectorAll('.summary-card__label')).map(l => l.textContent);
    // DOIS cartões. Saíram "Total de Versões", que já é cartão da Visão Geral, e
    // "Produtos com Versões", que vale o mesmo que o total de produtos porque
    // todo produto tem versão.
    expect(cards).toEqual(['Média de versões por produto', 'Máximo por produto']);
    expect(container.textContent).toContain('1.2');
    expect(container.textContent).toContain('9');

    // SAIU a pizza "Distribuição de Versões por Produto": era uma fatia de 85% e
    // quatro lascas, que é cauda longa em setor.
    expect(titulos(container)).toEqual(['Tipos de Versão']);

    aba.cleanup();
  });

  test('o tipo nulo vira rotulo, e nao fatia sem nome', async () => {
    const jaVivos = instanciasChart.length;
    const container = document.createElement('div');
    const aba = await renderVersionStats(container);

    // O rotulo mora na config do Chart, e nao no DOM: a pizza desenha no canvas.
    const pizza = instanciasChart.slice(jaVivos)[0];
    expect(pizza.config.data.labels).toContain('Sem tipo');

    aba.cleanup();
  });

  test('a falha toma a sub-aba inteira, porque uma chamada so alimenta tudo', async () => {
    acervoService.getVersionStatistics.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const aba = await renderVersionStats(container);

    expect(container.querySelector('.dashboard-erro')).not.toBeNull();

    aba.cleanup();
  });
});

describe('sub-aba: tendencias de armazenamento', () => {
  test('carrega com o periodo padrao e desenha o card', async () => {
    const container = document.createElement('div');
    const aba = await renderStorageTrends(container);

    expect(acervoService.getStorageGrowthTrends).toHaveBeenCalledWith(6);
    expect(container.querySelector('.chart-card')).not.toBeNull();

    aba.cleanup();
  });

  test('a falha pinta o erro NO CORPO do card, para o seletor de periodo ficar', async () => {
    acervoService.getStorageGrowthTrends.mockRejectedValueOnce(new Error('sem rede'));

    const container = document.createElement('div');
    const aba = await renderStorageTrends(container);

    expect(container.querySelector('.dashboard-erro')).not.toBeNull();
    // Quem vê o erro precisa do seletor para tentar outra janela.
    expect(container.querySelector('.chart-card__select')).not.toBeNull();

    aba.cleanup();
  });
});
