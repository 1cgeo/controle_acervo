import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderMateriaisTab } from '@modules/mapoteca/pages/dashboard/materiais-tab.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const ANO = new Date().getFullYear();

// Papel A0: 52 no total das quatro localizacoes, mas so 12 DISPONIVEIS (Seção +
// Almoxarifado) contra um minimo de 20. Os outros 40 sao compra que ainda esta
// com o fornecedor.
const MATERIAIS = [
  {
    id: 1, nome: 'Papel A0', ativo: true,
    estoque_total: '52', estoque_disponivel: '12', estoque_minimo: '20',
    abaixo_minimo: true,
  },
  {
    id: 2, nome: 'Cartucho MK', ativo: true,
    estoque_total: '30', estoque_disponivel: '30', estoque_minimo: '10',
    abaixo_minimo: false,
  },
  // Insumo DESATIVADO nao alerta: ele saiu de circulacao de proposito, e cobrar
  // reposicao dele seria pedir a compra que alguem decidiu nao fazer mais.
  {
    id: 3, nome: 'Papel vegetal', ativo: false,
    estoque_total: '0', estoque_disponivel: '0', estoque_minimo: '5',
    abaixo_minimo: true,
  },
];

async function montar() {
  const container = document.createElement('div');
  const aba = await renderMateriaisTab(container, () => ANO);
  await flush();
  return { container, aba };
}

describe('a aba Materiais do dashboard', () => {
  beforeEach(() => {
    svc.getTiposMaterial.mockResolvedValue(MATERIAIS);
    svc.getStockByLocation.mockResolvedValue([]);
    svc.getMaterialConsumption.mockResolvedValue({
      consumo_mensal_total: [], materiais_mais_consumidos: [],
    });
  });

  // O ALERTA NAO MORA SO NA TELA DE INSUMOS. Quem olha o dashboard pergunta "o
  // que precisa de mim hoje", e "acabou o papel" e a resposta mais acionavel que
  // esta aba tem.
  test('o alerta de estoque minimo abre a aba, medindo o DISPONIVEL', async () => {
    const { container, aba } = await montar();

    expect(svc.getTiposMaterial).toHaveBeenCalled();
    expect(container.textContent).toContain('1 insumo abaixo do mínimo');
    expect(container.textContent).toContain('Papel A0');
    // O total das quatro (52) esta acima do minimo, e mesmo assim o insumo
    // alerta: o que conta e o disponivel.
    expect(container.textContent).toContain('12 disponíveis');
    expect(container.textContent).toContain('mínimo 20');
    // Quem esta acima do minimo nao entra, e o desativado tambem nao.
    expect(container.textContent).not.toContain('Cartucho MK');
    expect(container.textContent).not.toContain('Papel vegetal');

    aba.cleanup();
  });

  test('o alerta leva a ficha do insumo, na rota nova', async () => {
    const { container, aba } = await montar();

    const link = [...container.querySelectorAll('a')].find(a => a.textContent === 'Papel A0');
    expect(link.getAttribute('href')).toBe('#/mapoteca/insumos/1');

    aba.cleanup();
  });

  test('sem insumo abaixo do minimo, o alerta some do DOM', async () => {
    svc.getTiposMaterial.mockResolvedValue([MATERIAIS[1]]);
    const { container, aba } = await montar();

    expect(container.textContent).not.toContain('abaixo do mínimo');

    aba.cleanup();
  });

  // A frase mandava a pessoa para "a tela de Materiais" desde 2026-08-05, e o
  // consumo se lancava em OUTRA tela. Hoje a tela se chama Insumos e o
  // lancamento tem dois caminhos, os dois nomeados.
  test('o ano sem consumo diz ONDE se lanca, e o lugar existe', async () => {
    const { container, aba } = await montar();

    const vazio = container.querySelector('.dashboard__vazio');
    expect(vazio.classList.contains('hidden')).toBe(false);
    expect(vazio.textContent).toContain('na tela Insumos');
    expect(vazio.textContent).toContain('Contagem');
    expect(vazio.textContent).not.toContain('tela de Materiais');

    aba.cleanup();
  });

  test('falha na busca dos insumos nao vira "nada abaixo do minimo"', async () => {
    svc.getTiposMaterial.mockRejectedValueOnce(new Error('Erro de conexão'));
    const { container, aba } = await montar();

    // O alerta sai da tela; os outros blocos seguem contando o que conseguiram.
    expect(container.textContent).not.toContain('abaixo do mínimo');
    expect(container.textContent).toContain('O estoque é o saldo de hoje');

    aba.cleanup();
  });
});
