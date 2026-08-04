import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// O que esta tela NAO pode fazer: jogar a pagina fora a cada gravacao.
//
// A ficha do plotter tem tres gravacoes ligadas ao recarregador: editar o
// equipamento, salvar uma manutencao e excluir uma manutencao. Cada uma passava
// pelo `load()`, que zerava o container e montava outra tabela.
//
// Estes testes provam a IDENTIDADE do no (toBe), e nao o texto na tela. O
// gatilho de recarga e a exclusao de manutencao, que e o caminho real mais
// curto: acao da linha, confirmacao, recarga.

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderPlotterDetails } from '@modules/mapoteca/pages/plotters/details.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, GERENTE } from '@/__tests__/helpers/sessao.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const MANUTENCAO_A = { id: 90, data_manutencao: '2026-04-10', valor: 1600, descricao: 'Troca de cabeçote' };
const MANUTENCAO_B = { id: 91, data_manutencao: '2026-05-20', valor: 900, descricao: 'Limpeza geral' };

const PLOTTER = {
  id: 3,
  ativo: true,
  nr_serie: 'BR12345',
  modelo: 'HP DesignJet T2600',
  data_aquisicao: '2023-03-01',
  vida_util: 60,
  estatisticas: {
    total_manutencoes: 2,
    data_ultima_manutencao: '2026-05-20',
    valor_total_manutencoes: 2500,
    valor_medio_manutencoes: 1250,
    tempo_medio_entre_manutencoes_dias: 180,
  },
  manutencoes: [MANUTENCAO_A, MANUTENCAO_B],
};

/** A pagina precisa estar no documento: sem isso o foco do teclado nao existe. */
function novoContainer() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

const secaoManutencoes = (container) =>
  [...container.querySelectorAll('.dashboard-section')]
    .find(s => {
      const h = s.querySelector('.dashboard-section__title');
      return h && h.textContent === 'Manutenções';
    });

const tabela = (container) => secaoManutencoes(container).querySelector('.data-table-wrapper');

const cabecalho = (container, rotulo) =>
  [...secaoManutencoes(container).querySelectorAll('th')].find(th => th.textContent.includes(rotulo));

const botaoDaLinha = (container, titulo, indice = 0) =>
  [...container.querySelectorAll(`button[title="${titulo}"]`)][indice];

async function montar() {
  const container = novoContainer();
  const cleanup = await renderPlotterDetails(container, {
    params: { id: '3' },
    query: new URLSearchParams(),
  });
  await flush();
  return { container, cleanup };
}

/**
 * Exclui a manutencao da linha e espera a recarga.
 *
 * @param {HTMLElement} container
 * @param {number} indice - a linha a excluir
 * @param {Object} [depois] - o que o servidor devolve na recarga. O padrao e o
 *        mesmo plotter sem a linha excluida.
 */
async function excluirLinha(container, indice, depois = null) {
  svc.getPlotter.mockResolvedValue(depois || {
    ...PLOTTER,
    manutencoes: PLOTTER.manutencoes.filter((_, i) => i !== indice),
  });
  botaoDaLinha(container, 'Excluir manutenção', indice).click();
  await flush();
  [...document.querySelectorAll('.modal__footer button')]
    .find(b => b.textContent === 'Excluir')
    .click();
  await flush();
  await flush();
}

describe('renderPlotterDetails, o que sobrevive a uma gravacao', () => {
  beforeEach(() => {
    logarComo({ mapoteca: GERENTE });
    svc.getPlotter.mockResolvedValue(PLOTTER);
    svc.deleteManutencoes.mockResolvedValue(null);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('a raiz da pagina e a tabela sao as MESMAS depois da gravacao', async () => {
    const { container, cleanup } = await montar();
    const paginaAntes = container.querySelector('.page');
    const tabelaAntes = tabela(container);

    await excluirLinha(container, 1);

    expect(svc.deleteManutencoes).toHaveBeenCalledWith([91]);
    expect(container.querySelector('.page')).toBe(paginaAntes);
    expect(tabela(container)).toBe(tabelaAntes);
    cleanup();
  });

  test('a ordenacao escolhida sobrevive a gravacao', async () => {
    const { container, cleanup } = await montar();
    cabecalho(container, 'Valor').click();
    expect(cabecalho(container, 'Valor').getAttribute('aria-sort')).toBe('ascending');

    await excluirLinha(container, 1);

    expect(cabecalho(container, 'Valor').getAttribute('aria-sort')).toBe('ascending');
    cleanup();
  });

  test('o titulo e o MESMO no, com o texto novo', async () => {
    const { container, cleanup } = await montar();
    const tituloAntes = container.querySelector('.page__title');

    await excluirLinha(container, 1, {
      ...PLOTTER,
      modelo: 'HP DesignJet T1600',
      manutencoes: [MANUTENCAO_A],
    });

    expect(container.querySelector('.page__title')).toBe(tituloAntes);
    expect(tituloAntes.textContent).toContain('HP DesignJet T1600');
    cleanup();
  });

  test('o cartao de resumo e o MESMO no, com o valor novo', async () => {
    const { container, cleanup } = await montar();
    const cartaoAntes = container.querySelector('.summary-card');
    expect(cartaoAntes.querySelector('.summary-card__value').textContent).toBe('2');

    await excluirLinha(container, 1, {
      ...PLOTTER,
      manutencoes: [MANUTENCAO_A],
      estatisticas: { ...PLOTTER.estatisticas, total_manutencoes: 1 },
    });

    expect(container.querySelector('.summary-card')).toBe(cartaoAntes);
    expect(cartaoAntes.querySelector('.summary-card__value').textContent).toBe('1');
    cleanup();
  });

  test('o foco no botao Adicionar manutencao sobrevive a gravacao', async () => {
    const { container, cleanup } = await montar();
    const adicionar = [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Adicionar manutenção'));
    adicionar.focus();

    await excluirLinha(container, 1);

    expect(container.contains(adicionar)).toBe(true);
    expect(document.activeElement).toBe(adicionar);
    cleanup();
  });

  test('o foco na acao de uma linha que ficou sobrevive a gravacao', async () => {
    const { container, cleanup } = await montar();
    const editarLinha1 = botaoDaLinha(container, 'Editar manutenção', 0);
    editarLinha1.focus();

    await excluirLinha(container, 1);

    expect(container.contains(editarLinha1)).toBe(true);
    expect(document.activeElement).toBe(editarLinha1);
    cleanup();
  });
});
