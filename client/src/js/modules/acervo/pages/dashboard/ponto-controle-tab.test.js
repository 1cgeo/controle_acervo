import { describe, test, expect, vi } from 'vitest';

vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

const DADOS = {
  total_pontos: 3490,
  total_missoes: 8,
  total_arquivos: 6980,
  total_gb: 76.72,
  por_tipo_arquivo: [
    { nome: 'Pacote do ponto', arquivos: '3490', mb: '75000' },
    { nome: 'Monografia', arquivos: '3490', mb: '5500' },
  ],
  por_mes: [{ mes: '2026-06', pontos: '120' }],
  por_missao: [{
    lote: 'Lote 1', pit: 'gov-rs-lote-1', projeto: 'GOV-RS SDP Nr 8155-BR',
    pontos: '668', aprovados: '600',
    primeiro_rastreio: '2018-03-20', ultimo_rastreio: '2018-05-17',
  }],
  ultimas_importacoes: [{
    lote: 'Lote 1', usuario: 'Cap Silva', pontos: '10', status: 'completed',
    completed_at: '2026-07-29T13:45:51.000Z', error_message: null,
  }],
};

vi.mock('@modules/acervo/services/ponto-controle-service.js', () => ({
  getDashboardPontoControle: vi.fn(() => Promise.resolve(DADOS)),
}));

import { renderPontoControleTab } from './ponto-controle-tab.js';
import * as servico from '@modules/acervo/services/ponto-controle-service.js';

describe('aba de ponto de controle do dashboard', () => {
  test('monta a aba inteira, com as DUAS tabelas no DOM', async () => {
    // Esta prova existe por causa de um defeito real: a aba passava o objeto
    // devolvido pelo createDataTable ao appendChild, em vez do `.element` dele.
    // O clique na aba morria com "parameter 1 is not of type 'Node'" e a aba
    // ficava pela metade, sem erro visivel na tela.
    const container = document.createElement('div');
    await renderPontoControleTab(container);

    expect(container.querySelectorAll('table').length).toBe(2);
    expect(container.querySelectorAll('.data-table-wrapper').length).toBe(2);

    // O createDataTable aceita `title` e nao o desenha: quem titula e a aba.
    const titulos = Array.from(container.querySelectorAll('.chart-card__title'))
      .map(h => h.textContent);
    expect(titulos).toContain('Missões com ponto de controle');
    expect(titulos).toContain('Últimas importações');
  });

  test('os quatro cartões trazem o número que veio do servidor', async () => {
    const container = document.createElement('div');
    await renderPontoControleTab(container);

    const texto = container.textContent;
    expect(texto).toContain('3.490');   // pontos
    expect(texto).toContain('6.980');   // arquivos
    expect(texto).toContain('76,72');   // GB
  });

  test('a linha da missão e a da importação chegam à tabela', async () => {
    const container = document.createElement('div');
    await renderPontoControleTab(container);

    const linhas = Array.from(container.querySelectorAll('tbody tr'))
      .map(tr => Array.from(tr.children).map(td => td.textContent).join(' '));
    expect(linhas.some(l => l.includes('GOV-RS SDP Nr 8155-BR'))).toBe(true);
    expect(linhas.some(l => l.includes('600 de 668'))).toBe(true);
    expect(linhas.some(l => l.includes('Concluída'))).toBe(true);
  });

  test('erro do servidor não derruba a aba: os cartões dizem Erro', async () => {
    servico.getDashboardPontoControle.mockRejectedValueOnce(new Error('sem rede'));
    const container = document.createElement('div');
    await renderPontoControleTab(container);

    expect(container.textContent).toContain('Erro');
    // Sem linha nenhuma a tabela troca o <table> pela mensagem de vazio, mas a
    // aba continua montada: o que nao pode e sumir do DOM.
    expect(container.querySelectorAll('.data-table-wrapper').length).toBe(2);
    expect(container.querySelectorAll('.data-table__empty').length).toBe(2);
  });

  test('refresh recarrega sem remontar o DOM', async () => {
    const container = document.createElement('div');
    const controle = await renderPontoControleTab(container);
    const antes = container.querySelectorAll('table').length;

    await controle.refresh();

    expect(container.querySelectorAll('table').length).toBe(antes);
    expect(servico.getDashboardPontoControle).toHaveBeenCalledTimes(2);
  });
});
