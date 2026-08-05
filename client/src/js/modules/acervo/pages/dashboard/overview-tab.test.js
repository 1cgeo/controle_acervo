import { describe, test, expect, vi } from 'vitest';

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getProdutosTotal: vi.fn(() => Promise.resolve({ total_produtos: '5741' })),
  getArquivosTotalGb: vi.fn(() => Promise.resolve({ total_gb: '1234.5678' })),
  getSystemHealth: vi.fn(() => Promise.resolve({
    volumes_alertas: [],
    erros_arquivo: { erros_carregamento: 0, erros_exclusao: 0 },
    sessoes_upload_ativas: 0,
    total_versoes: 7023,
    total_projetos: 12,
    downloads_30d: 5,
    total_pontos_controle: 314,
    versoes_carregadas_mes: 27,
  })),
}));

import { renderOverviewTab, createAlertPanel } from './overview-tab.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';

const textos = (container, seletor) =>
  Array.from(container.querySelectorAll(seletor)).map(n => n.textContent);

describe('renderOverviewTab', () => {
  test('monta os seis cards e preenche com o numero do servidor', async () => {
    const container = document.createElement('div');
    const aba = await renderOverviewTab(container);

    expect(acervoService.getProdutosTotal).toHaveBeenCalled();
    expect(acervoService.getSystemHealth).toHaveBeenCalled();

    const cards = container.querySelectorAll('.stats-card');
    expect(cards).toHaveLength(6);

    const valores = textos(container, '.stats-card__value');
    expect(valores).toContain('5.741');       // total de produtos
    expect(valores).toContain('1.234,57 GB'); // armazenamento com o sufixo
    expect(valores).toContain('314');         // pontos de controle
    expect(valores).toContain('27');          // carregamento do mes, em versoes
    expect(valores).toContain('7.023');       // versoes
    expect(valores).toContain('5');           // downloads em 24h

    // Fora do painel de propósito: contagem de usuário não é acervo, e o lugar
    // do total de projetos é do que ENTROU no mês.
    expect(valores).not.toContain('42');
    expect(valores).not.toContain('12');

    aba.cleanup();
  });

  test('sem alerta nenhum, o painel mostra a linha de sistema saudavel', async () => {
    const container = document.createElement('div');
    const aba = await renderOverviewTab(container);

    const itens = container.querySelectorAll('.alert-panel__item');
    expect(itens).toHaveLength(1);
    expect(itens[0].classList.contains('alert-panel__item--success')).toBe(true);
    expect(itens[0].textContent).toContain('sistema saudável');

    aba.cleanup();
  });

  test('endpoint que falha vira "Erro" no card, sem derrubar os outros', async () => {
    acervoService.getProdutosTotal.mockRejectedValueOnce(new Error('500'));

    const container = document.createElement('div');
    const aba = await renderOverviewTab(container);

    const valores = textos(container, '.stats-card__value');
    expect(valores).toContain('Erro');
    expect(valores).toContain('314');

    aba.cleanup();
  });

  test('refresh chama os endpoints de novo', async () => {
    const container = document.createElement('div');
    const aba = await renderOverviewTab(container);
    const antes = acervoService.getSystemHealth.mock.calls.length;

    await aba.refresh();
    expect(acervoService.getSystemHealth.mock.calls.length).toBe(antes + 1);

    aba.cleanup();
  });
});

// O painel de alertas é o que o chefe olha para saber se há volume enchendo.
// Antes, o ramo de falha do health NÃO o tocava: na primeira carga ele nem
// aparecia (e ausência lê-se como "não há alerta"), e no auto-refresh de 60 s o
// painel da carga anterior seguia afirmando "sistema saudável" horas depois de
// o endpoint parar de responder. Dizer saúde sem saber é a falha mais cara.
describe('renderOverviewTab: falha do system_health', () => {
  test('o painel de alertas vira estado de erro, e nao "sistema saudavel"', async () => {
    acervoService.getSystemHealth.mockRejectedValueOnce(new Error('sem rede'));
    const container = document.createElement('div');
    const aba = await renderOverviewTab(container);

    expect(container.querySelector('.dashboard-erro')).not.toBeNull();
    expect(container.querySelector('.dashboard-erro__detalhe').textContent).toBe('sem rede');
    expect(container.textContent).not.toContain('Nenhum alerta: sistema saudável');

    aba.cleanup();
  });

  test('o painel VELHO nao fica na tela quando a carga seguinte falha', async () => {
    const container = document.createElement('div');
    const aba = await renderOverviewTab(container);
    expect(container.textContent).toContain('Nenhum alerta: sistema saudável');

    acervoService.getSystemHealth.mockRejectedValueOnce(new Error('caiu'));
    await aba.refresh();

    expect(container.textContent).not.toContain('Nenhum alerta: sistema saudável');
    expect(container.querySelector('.dashboard-erro')).not.toBeNull();

    aba.cleanup();
  });
});

describe('createAlertPanel', () => {
  test('volume acima de 90% vira alerta de erro com a barra de uso', () => {
    const painel = createAlertPanel({
      volumes_alertas: [{ nome: 'Volume 1', percentual_uso: '95.3' }],
      erros_arquivo: {},
      sessoes_upload_ativas: 0,
    });

    const item = painel.querySelector('.alert-panel__item');
    expect(item.classList.contains('alert-panel__item--error')).toBe(true);
    expect(item.textContent).toContain('Volume "Volume 1" em 95.3% da capacidade');
    expect(painel.querySelector('.progress-bar__fill--error').style.width).toBe('95.3%');
  });

  test('volume entre 80% e 90% vira alerta de atencao', () => {
    const painel = createAlertPanel({
      volumes_alertas: [{ nome: 'Volume 2', percentual_uso: '85' }],
    });

    expect(painel.querySelector('.alert-panel__item--warning')).not.toBeNull();
    expect(painel.querySelector('.progress-bar__fill--warning').style.width).toBe('85%');
  });

  test('a barra nao passa de 100% quando o volume estoura a capacidade', () => {
    const painel = createAlertPanel({ volumes_alertas: [{ nome: 'Cheio', percentual_uso: '140' }] });
    expect(painel.querySelector('.progress-bar__fill').style.width).toBe('100%');
  });

  test('erro de carregamento e de exclusao entram na mesma linha', () => {
    const painel = createAlertPanel({
      volumes_alertas: [],
      erros_arquivo: { erros_carregamento: 3, erros_exclusao: 2 },
      sessoes_upload_ativas: 0,
    });

    const item = painel.querySelector('.alert-panel__item--error');
    expect(item.textContent).toContain('5 arquivo(s) com erro');
    expect(item.textContent).toContain('3 de carregamento');
    expect(item.textContent).toContain('2 de exclusão');
  });

  test('sessao de upload ativa vira alerta de atencao', () => {
    const painel = createAlertPanel({ sessoes_upload_ativas: 2 });
    const item = painel.querySelector('.alert-panel__item--warning');
    expect(item.textContent).toContain('2 sessão(ões) de upload ativa(s)');
  });
});
