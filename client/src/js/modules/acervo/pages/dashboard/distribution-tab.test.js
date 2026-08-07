import { describe, test, expect, vi } from 'vitest';

// O jsdom nao tem canvas: sem o dublê, todo grafico com dado explodiria.
vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

// Aba de distribuicao: quatro endpoints em paralelo, dois setores e quatro barras (uma unidade por grafico).
vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getProdutosTipo: vi.fn(() => Promise.resolve([
    { tipo_produto: 'Carta Topográfica', quantidade: '120' },
    { tipo_produto: 'Ortoimagem', quantidade: '30' },
  ])),
  getProdutosEscala: vi.fn(() => Promise.resolve([
    { tipo_escala: '1:25.000', quantidade: '90' },
  ])),
  getGbTipoProduto: vi.fn(() => Promise.resolve([
    { tipo_produto: 'Carta Topográfica', total_gb: '12.5' },
  ])),
  getArquivosTipoArquivo: vi.fn(() => Promise.resolve([
    { tipo_arquivo: 'PDF', total_gb: '3.2', quantidade: '400' },
  ])),
  // `nome_volume` vem de `va.nome`, que e NOT NULL em `acervo.volume_armazenamento`
  // (er/acervo.sql). A tela nao tem recuo para `volume`: aquele campo e o CAMINHO
  // no disco, e o eixo do grafico passaria a mostrar caminho de sistema de
  // arquivos. A segunda linha usa mais do que a capacidade, que e o caso que o
  // `Math.max(0, ...)` do disponivel existe para tratar.
  getGbVolume: vi.fn(() => Promise.resolve([
    { nome_volume: 'Volume 1', total_gb: '80', capacidade_gb_volume: '100' },
    { nome_volume: 'Volume 2', total_gb: '150', capacidade_gb_volume: '100' },
  ])),
}));

import { renderDistributionTab } from './distribution-tab.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';

describe('renderDistributionTab', () => {
  test('chama os endpoints e monta os seis graficos', async () => {
    const container = document.createElement('div');
    const aba = await renderDistributionTab(container);

    expect(acervoService.getProdutosTipo).toHaveBeenCalled();
    expect(acervoService.getProdutosEscala).toHaveBeenCalled();
    expect(acervoService.getGbTipoProduto).toHaveBeenCalled();
    expect(acervoService.getArquivosTipoArquivo).toHaveBeenCalled();
    expect(acervoService.getGbVolume).toHaveBeenCalled();

    expect(container.querySelectorAll('.chart-card')).toHaveLength(6);
    expect(container.querySelectorAll('.dashboard-grid--2col')).toHaveLength(3);

    aba.cleanup();
  });

  test('refresh recarrega os mesmos endpoints', async () => {
    const container = document.createElement('div');
    const aba = await renderDistributionTab(container);
    const antes = acervoService.getProdutosTipo.mock.calls.length;

    await aba.refresh();
    expect(acervoService.getProdutosTipo.mock.calls.length).toBe(antes + 1);

    aba.cleanup();
  });

  test('endpoint que falha nao derruba a aba', async () => {
    acervoService.getGbVolume.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const aba = await renderDistributionTab(container);

    expect(container.querySelectorAll('.chart-card')).toHaveLength(6);
    aba.cleanup();
  });

  test('refresh chamado depois do cleanup nao lanca e nao toca no DOM', async () => {
    const container = document.createElement('div');
    const aba = await renderDistributionTab(container);
    const antes = container.innerHTML;
    aba.cleanup();

    // O que importa e nao lancar e nao pintar. O valor devolvido nao faz parte
    // do contrato: `load` e `Promise.all` sobre os blocos, entao sempre resolve
    // num ARRANJO, e cada bloco e que enxerga o `disposed` e volta cedo.
    await aba.refresh();
    expect(container.innerHTML).toBe(antes);
  });
});

// Antes, a falha de qualquer endpoint virava lista vazia, e o card passava a
// dizer "Sem dados disponíveis": a frase do acervo sem produto daquele tipo.
// Endpoint fora do ar lia-se como acervo vazio, que é a leitura oposta.
describe('renderDistributionTab: falha por gráfico', () => {
  test('só o gráfico que falhou vira estado de erro; os outros cinco ficam', async () => {
    acervoService.getProdutosTipo.mockRejectedValueOnce(new Error('sem rede'));

    const container = document.createElement('div');
    const aba = await renderDistributionTab(container);

    const comErro = container.querySelectorAll('.chart-card .dashboard-erro');
    expect(comErro).toHaveLength(1);
    expect(comErro[0].querySelector('.dashboard-erro__detalhe').textContent).toBe('sem rede');
    // Os cinco cards continuam montados: o que falhou foi a pergunta, não a aba.
    expect(container.querySelectorAll('.chart-card')).toHaveLength(6);

    aba.cleanup();
  });

  test('"Tentar de novo" refaz SÓ a pergunta que falhou', async () => {
    acervoService.getProdutosTipo.mockRejectedValueOnce(new Error('sem rede'));
    const container = document.createElement('div');
    const aba = await renderDistributionTab(container);

    const outrosAntes = acervoService.getProdutosEscala.mock.calls.length;
    container.querySelector('.chart-card .dashboard-erro .btn').click();
    await new Promise(r => setTimeout(r, 0));

    expect(container.querySelectorAll('.chart-card .dashboard-erro')).toHaveLength(0);
    expect(acervoService.getProdutosEscala.mock.calls.length).toBe(outrosAntes);

    aba.cleanup();
  });
});
