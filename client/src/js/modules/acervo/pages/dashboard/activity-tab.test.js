import { describe, test, expect, vi } from 'vitest';

vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

const hoje = new Date().toISOString().split('T')[0];

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getArquivosDia: vi.fn(() => Promise.resolve([
    { dia: `${new Date().toISOString().split('T')[0]}T00:00:00.000Z`, quantidade: '7' },
  ])),
  getDownloadsDia: vi.fn(() => Promise.resolve([
    { dia: `${new Date().toISOString().split('T')[0]}T00:00:00.000Z`, quantidade: '3' },
  ])),
  getUltimosProdutos: vi.fn(() => Promise.resolve([
    { nome: 'Carta X', mi: '2965-1', tipo_produto: 'Carta Topográfica', tipo_escala: '1:25.000', total_versoes: '3', data_cadastramento: '2026-07-01T10:00:00.000Z' },
  ])),
  getUltimasVersoes: vi.fn(() => Promise.resolve([
    { versao: '1', produto_nome: 'Carta X', mi: '2965-1', tipo_versao: 'Regular', orgao_produtor: '1 CGEO', total_arquivos: '9', data_criacao: '2026-07-02T10:00:00.000Z' },
  ])),
  getUltimosCarregamentos: vi.fn(() => Promise.resolve([
    { nome: 'arquivo.tif', tamanho_mb: '1024.456', extensao: 'tif', data_cadastramento: '2026-07-03T10:00:00.000Z' },
  ])),
  getUltimasModificacoes: vi.fn(() => Promise.resolve([
    { nome: 'outro.pdf', tamanho_mb: null, extensao: null, data_modificacao: '2026-07-04T10:00:00.000Z' },
  ])),
  getUltimosDeletes: vi.fn(() => Promise.resolve([
    { nome: 'velho.tif', tamanho_mb: '2', extensao: 'tif', data_delete: '2026-07-05T10:00:00.000Z', motivo_exclusao: 'Duplicado' },
  ])),
  getDownloads: vi.fn(() => Promise.resolve([
    { id: 1, arquivo_id: 10, data_download: '2026-07-06T10:00:00.000Z', apagado: false },
    { id: 2, arquivo_id: 11, data_download: '2026-07-06T11:00:00.000Z', apagado: true },
  ])),
  getSituacaoCarregamento: vi.fn(() => Promise.resolve([
    { situacao: 'Carregado', quantidade: '15346' },
  ])),
}));

import { renderActivityTab } from './activity-tab.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';

/** Texto das celulas da primeira linha da tabela ativa. */
function primeiraLinha(container) {
  const tr = container.querySelector('.tabs__content tbody tr');
  return tr ? Array.from(tr.children).map(td => td.textContent) : [];
}

describe('renderActivityTab', () => {
  test('carrega a serie diaria e abre a sub-aba de produtos', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    expect(acervoService.getArquivosDia).toHaveBeenCalled();
    expect(acervoService.getDownloadsDia).toHaveBeenCalled();
    expect(acervoService.getUltimosProdutos).toHaveBeenCalled();

    expect(container.querySelectorAll('.sub-tabs__item')).toHaveLength(7);
    expect(container.querySelector('.sub-tabs__item--active').textContent).toBe('Produtos Recentes');
    expect(primeiraLinha(container)[0]).toBe('Carta X');

    aba.cleanup();
  });

  test('a serie diaria cobre 30 dias e casa o dia de hoje com a quantidade', async () => {
    const { instanciasChart } = await import('@components/charts/chart-stub.js');
    instanciasChart.length = 0;

    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const grafico = instanciasChart.find(c =>
      c.data.datasets.some(d => d.label === 'Uploads'));
    expect(grafico).toBeDefined();
    expect(grafico.data.labels).toHaveLength(30);
    expect(grafico.data.labels[29]).toBe(hoje.slice(5));
    expect(grafico.data.datasets[0].data[29]).toBe(7); // uploads
    expect(grafico.data.datasets[1].data[29]).toBe(3); // downloads
    // Dia sem movimento entra como zero, e nao como buraco.
    expect(grafico.data.datasets[0].data[0]).toBe(0);

    aba.cleanup();
  });

  test('trocar de sub-aba busca o endpoint daquela aba', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const botoes = Array.from(container.querySelectorAll('.sub-tabs__item'));
    botoes.find(b => b.textContent === 'Exclusões Recentes').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(acervoService.getUltimosDeletes).toHaveBeenCalled();
    const linha = primeiraLinha(container);
    expect(linha[0]).toBe('velho.tif');
    expect(linha[4]).toBe('Duplicado');

    aba.cleanup();
  });

  test('o historico de downloads marca com chip o arquivo excluido', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const botoes = Array.from(container.querySelectorAll('.sub-tabs__item'));
    botoes.find(b => b.textContent === 'Histórico de Downloads').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const chips = Array.from(container.querySelectorAll('.tabs__content .chip')).map(c => c.textContent);
    expect(chips).toContain('Disponível');
    expect(chips).toContain('Arquivo excluído');

    aba.cleanup();
  });

  test('tamanho nulo vira "-" e a extensao sobe para maiuscula', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const botoes = Array.from(container.querySelectorAll('.sub-tabs__item'));
    botoes.find(b => b.textContent === 'Uploads Recentes').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(primeiraLinha(container)[1]).toBe('1024.46');
    expect(primeiraLinha(container)[2]).toBe('TIF');

    botoes.find(b => b.textContent === 'Modificações Recentes').click();
    await new Promise(resolve => setTimeout(resolve, 0));
    expect(primeiraLinha(container)[1]).toBe('-');
    expect(primeiraLinha(container)[2]).toBe('-');

    aba.cleanup();
  });

  test('a sub-aba de situacao de carregamento monta um grafico de setores', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const botoes = Array.from(container.querySelectorAll('.sub-tabs__item'));
    botoes.find(b => b.textContent === 'Situação de Carregamento').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    expect(acervoService.getSituacaoCarregamento).toHaveBeenCalled();
    expect(container.querySelector('.tabs__content .chart-card')).not.toBeNull();

    aba.cleanup();
  });

  // FALHA E VAZIO SAO COISAS DIFERENTES. Zerando a serie no catch, o card diz
  // "Sem dados disponiveis", que e a frase do acervo sem arquivo: rota fora do
  // ar se leria como situacao sem registro. "Nao houve" e "nao consegui saber"
  // pedem acoes opostas, e o painel e o que o chefe olha para decidir.
  test('falha na situacao de carregamento pinta ERRO, e nao pizza vazia', async () => {
    acervoService.getSituacaoCarregamento.mockRejectedValueOnce(
      new Error('Falha ao consultar o acervo'),
    );

    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const botoes = Array.from(container.querySelectorAll('.sub-tabs__item'));
    botoes.find(b => b.textContent === 'Situação de Carregamento').click();
    await new Promise(resolve => setTimeout(resolve, 0));

    const erro = container.querySelector('.tabs__content .dashboard-erro');
    expect(erro).not.toBeNull();
    // A mensagem do SERVIDOR, e nao uma frase generica: ela e o que decide se a
    // pessoa tenta de novo ou chama alguem.
    expect(erro.textContent).toContain('Falha ao consultar o acervo');
    expect(container.textContent).not.toContain('Sem dados disponíveis');

    aba.cleanup();
  });

  test('refresh recarrega a serie diaria e a sub-aba ativa', async () => {
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const antesDiario = acervoService.getArquivosDia.mock.calls.length;
    const antesProdutos = acervoService.getUltimosProdutos.mock.calls.length;

    await aba.refresh();

    expect(acervoService.getArquivosDia.mock.calls.length).toBe(antesDiario + 1);
    expect(acervoService.getUltimosProdutos.mock.calls.length).toBe(antesProdutos + 1);

    aba.cleanup();
  });

  // Este teste FIXAVA o defeito: ele exigia o estado vazio quando o endpoint
  // falhava. Zerar as linhas fazia a tabela mostrar "Sem dados disponiveis", que
  // e a frase do acervo vazio, e a falha da API lia-se como ausencia de dado.
  // "Nao ha" e "nao consegui saber" sao respostas opostas.
  test('endpoint que falha mostra ERRO, e nao a frase de acervo vazio', async () => {
    acervoService.getUltimosProdutos.mockRejectedValueOnce(new Error('Falha ao consultar'));

    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const erro = container.querySelector('.dashboard-erro');
    expect(erro).not.toBeNull();
    // A mensagem do SERVIDOR aparece: e ela que distingue sem rede de sem
    // permissao, e o que decide se a pessoa tenta de novo ou chama alguem.
    expect(erro.textContent).toContain('Falha ao consultar');
    expect(erro.getAttribute('role')).toBe('alert');
    aba.cleanup();
  });

  test('o "tentar de novo" refaz a chamada e devolve a tabela', async () => {
    acervoService.getUltimosProdutos.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const aba = await renderActivityTab(container);
    expect(container.querySelector('.dashboard-erro')).not.toBeNull();

    const botao = [...container.querySelectorAll('.dashboard-erro button')]
      .find(b => b.textContent.includes('Tentar de novo'));
    botao.click();
    await new Promise(r => setTimeout(r, 0));

    expect(container.querySelector('.dashboard-erro')).toBeNull();
    aba.cleanup();
  });
});

// A série nasce com zero em cada dia para o dia sem movimento aparecer no eixo.
// Com o endpoint fora do ar, esse mesmo zero deixava de dizer "nada aconteceu
// neste dia" e passava a afirmar "nada aconteceu no mês": não parecia vazio nem
// erro, parecia resposta. É o modo de falhar mais caro do painel, porque a barra
// chata é uma resposta, e errada.
describe('renderActivityTab: falha da série diária', () => {
  test('endpoint fora do ar vira estado de erro, e nao 30 dias de zero', async () => {
    acervoService.getArquivosDia.mockRejectedValueOnce(new Error('sem rede'));

    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const erro = container.querySelector('.chart-card .dashboard-erro');
    expect(erro).not.toBeNull();
    expect(erro.querySelector('.dashboard-erro__detalhe').textContent).toBe('sem rede');

    aba.cleanup();
  });

  test('basta UMA das duas cair: a série que veio não sai como linha reta', async () => {
    // As duas dividem o mesmo gráfico. Desenhar só a que voltou deixaria a
    // outra como uma reta no chão ao lado dela, afirmando zero download no mês.
    acervoService.getDownloadsDia.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    expect(container.querySelector('.chart-card .dashboard-erro')).not.toBeNull();

    aba.cleanup();
  });

  test('"Tentar de novo" refaz as duas chamadas', async () => {
    acervoService.getArquivosDia.mockRejectedValueOnce(new Error('sem rede'));
    const container = document.createElement('div');
    const aba = await renderActivityTab(container);

    const antes = acervoService.getDownloadsDia.mock.calls.length;
    container.querySelector('.chart-card .dashboard-erro .btn').click();
    await new Promise(r => setTimeout(r, 0));

    expect(acervoService.getDownloadsDia.mock.calls.length).toBe(antes + 1);
    expect(container.querySelector('.chart-card .dashboard-erro')).toBeNull();

    aba.cleanup();
  });
});
