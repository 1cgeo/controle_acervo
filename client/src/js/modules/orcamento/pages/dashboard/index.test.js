import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O jsdom devolve null em canvas.getContext('2d'), e o Chart real estoura no
// primeiro update com dado. Sem este dublê o try/catch do load() engolia a
// falha: o teste passava com o gráfico QUEBRADO e não perceberia se ele
// parasse de renderizar em produção.
vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

// Smoke test do dashboard. A carga chama getExecucaoNd e popula os
// cards/grafico/tabela a partir da LISTA de linhas por ND (com a linha TOTAL).
//
// A rota devolve { linhas, pendencias }: as pendências de dado do ano andam
// junto da execução porque o registro sem data entra em TODOS os meses.
//
// `getAnos` alimenta o filtro de ano DA TELA. Cada tela tem o seu, começa no
// ano atual e não guarda nada. Por isso nenhum caso aqui escreve em
// localStorage.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getExecucaoNd: vi.fn(),
  getAnos: vi.fn(),
}));

import { renderDashboard } from '@modules/orcamento/pages/dashboard/index.js';
import { getExecucaoNd, getAnos } from '@modules/orcamento/services/orcamento-service.js';
import { instanciasChart } from '@components/charts/chart-stub.js';

const ANO_ATUAL = new Date().getFullYear();

// 2025 e o exercicio carregado do RPCATec, e entra na lista sempre: e o ano em
// que as pendencias de data NAO vao a zero, e um teste abaixo prova o rotulo.
const ANOS = [...new Set([ANO_ATUAL, ANO_ATUAL - 1, 2025])];

const LINHAS = [
  { cod_nd: '339030', nd_nome: 'Material', previsto: 60, recebido: 30, recebido_pdr: 20, recebido_extra: 10, recolhido: 5, recolhido_pdr: 3, recolhido_extra: 2, empenhado: 25, empenhado_pdr: 15, empenhado_extra: 10, liquidado: 20, liquidado_pdr: 12, liquidado_extra: 8 },
  { cod_nd: 'TOTAL', nd_nome: 'TOTAL', previsto: 100, recebido: 50, recebido_pdr: 35, recebido_extra: 15, recolhido: 8, recolhido_pdr: 5, recolhido_extra: 3, empenhado: 40, empenhado_pdr: 25, empenhado_extra: 15, liquidado: 30, liquidado_pdr: 18, liquidado_extra: 12 },
];

// Os numeros reais de 2026. A NC sem data ja esta zerada, e serve
// para provar que a pendencia sem ocorrencia NAO vira linha.
const PENDENCIAS = {
  ne_sem_data: { n: 25, total: 30 },
  liquidacao_sem_data: { n: 10, total: 18 },
  nc_sem_data: { n: 0, total: 44 },
  rpnp_sem_valor: { n: 11, total: 15 },
  nc_sem_meta: { n: 15, total: 44 },
  nc_prazo_vencido: { n: 9, total: 44 },
};

const SEM_PENDENCIA = {
  ne_sem_data: { n: 0, total: 30 },
  liquidacao_sem_data: { n: 0, total: 18 },
  nc_sem_data: { n: 0, total: 44 },
  rpnp_sem_valor: { n: 0, total: 15 },
  nc_sem_meta: { n: 0, total: 44 },
  nc_prazo_vencido: { n: 0, total: 44 },
};

const montar = async () => {
  const container = document.createElement('div');
  const cleanup = await renderDashboard(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
};

/** Troca o ano NO FILTRO DA TELA (o primeiro campo da barra de filtros). */
async function trocarAno(container, ano) {
  const select = container.querySelector('.form-field__select');
  select.value = String(ano);
  select.dispatchEvent(new Event('change'));
  await flush();
}

const linhasPendencia = (container) =>
  Array.from(container.querySelectorAll('.pendencias__lista > li'));

beforeEach(() => {
  getExecucaoNd.mockReset();
  getExecucaoNd.mockResolvedValue({ linhas: LINHAS, pendencias: PENDENCIAS });
  getAnos.mockReset();
  getAnos.mockResolvedValue(ANOS);
  instanciasChart.length = 0;
});

/**
 * O select de um campo, achado pelo ROTULO.
 *
 * Antes o mês era um `<select>` solto com a classe `chart-card__select`, e o
 * ano vinha do componente de campo: dava para pegá-los por classes diferentes.
 * Agora os dois são `.form-field`, então a classe não discrimina e a POSIÇÃO
 * quebraria no dia em que a barra ganhasse um filtro novo.
 */
function selectDoCampo (container, rotulo) {
  const campo = [...container.querySelectorAll('.form-field')]
    .find(f => f.querySelector('.form-field__label')?.textContent.trim() === rotulo);
  if (!campo) throw new Error(`campo "${rotulo}" nao existe na tela`);
  return campo.querySelector('select');
}

describe('renderDashboard', () => {
  test('monta o dashboard e carrega a execucao por ND do ano da tela', async () => {
    const { container, cleanup } = await montar();

    expect(getExecucaoNd).toHaveBeenCalledWith({ ano: ANO_ATUAL, mes: expect.any(Number) });
    expect(container.querySelector('.dashboard__title')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // Sem esta asserção o teste acima passa com o gráfico QUEBRADO: o try/catch do
  // load() engole a falha do Chart e ninguém percebe. Aqui o dublê prova que o
  // gráfico foi montado e recebeu a linha TOTAL da tabela 3.1.
  test('monta o grafico com o dado da execucao por ND, e nao em silencio', async () => {
    const { container: _container, cleanup } = await montar();

    expect(instanciasChart.length).toBeGreaterThan(0);
    const grafico = instanciasChart[0];
    expect(grafico.config.data.datasets.length).toBeGreaterThan(0);
    const valores = grafico.config.data.datasets.flatMap(d => d.data);
    expect(valores.some(v => Number(v) > 0)).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('renderDashboard: as tres abas', () => {
  const abas = (container) => Array.from(container.querySelectorAll('.tabs > .tabs__item'));

  async function abrirAba(container, rotulo) {
    abas(container).find(b => b.textContent === rotulo).click();
    await flush();
  }

  test('monta as tres abas e abre na visao geral', async () => {
    const { container, cleanup } = await montar();

    // Sem a numeracao 3.x: ela era do modelo antigo e apontava para a subsecao
    // errada (a aba "PDR" mostra a quebra por ND, que o RPCMTec numera 4.1).
    expect(abas(container).map(b => b.textContent)).toEqual([
      'Visão Geral', 'PDR', 'Extra-PDR',
    ]);
    // A visao geral e a unica montada: as tabelas ainda nao existem no DOM.
    expect(container.querySelector('.tabs__content .stats-grid')).not.toBeNull();
    expect(container.querySelector('.tabs__content tbody')).toBeNull();

    cleanup();
  });

  // As tres abas saem da MESMA consulta. Sem a memoizacao do store, cada clique
  // de aba pagaria um round-trip para reexibir dado que ja estava na mao.
  test('trocar de aba NAO refaz a consulta da execucao por ND', async () => {
    const { container, cleanup } = await montar();

    expect(getExecucaoNd).toHaveBeenCalledTimes(1);

    await abrirAba(container, 'PDR');
    await abrirAba(container, 'Extra-PDR');
    await abrirAba(container, 'Visão Geral');

    expect(getExecucaoNd).toHaveBeenCalledTimes(1);

    cleanup();
  });

  test('cada aba de ND mostra as colunas do seu recorte', async () => {
    const { container, cleanup } = await montar();

    await abrirAba(container, 'PDR');
    const cabecalhoPdr = container.querySelector('.tabs__content thead').textContent;
    // O previsto so existe no PDR.
    expect(cabecalhoPdr).toContain('Previsto');
    // O recolhido e o que faltava: sem ele o leitor soma recebido menos
    // empenhado e conclui um saldo maior do que o disponivel.
    expect(cabecalhoPdr).toContain('Recolhido');
    expect(container.querySelector('.tabs__content tbody').textContent).toContain('339030');

    await abrirAba(container, 'Extra-PDR');
    const cabecalhoExtra = container.querySelector('.tabs__content thead').textContent;
    expect(cabecalhoExtra).not.toContain('Previsto');
    expect(cabecalhoExtra).toContain('Empenhado');
    expect(cabecalhoExtra).toContain('Recolhido');

    cleanup();
  });

  // A linha TOTAL e uma linha comum na tabela: o grafico a filtra, a tabela
  // nao. Sem a marca, ela le-se como mais uma natureza de despesa.
  test('a linha TOTAL da tabela de ND leva a classe de total', async () => {
    const { container, cleanup } = await montar();

    await abrirAba(container, 'PDR');
    const marcadas = container.querySelectorAll('.tabs__content tbody tr.data-table__row--total');

    expect(marcadas.length).toBe(1);
    expect(marcadas[0].textContent).toContain('TOTAL');

    cleanup();
  });

  test('trocar o mes invalida a execucao por ND e recarrega a aba ativa', async () => {
    const { container, cleanup } = await montar();

    expect(getExecucaoNd).toHaveBeenCalledTimes(1);

    const select = selectDoCampo(container, 'Mês');
    select.value = '3';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(getExecucaoNd).toHaveBeenCalledTimes(2);
    expect(getExecucaoNd).toHaveBeenLastCalledWith({ ano: ANO_ATUAL, mes: 3 });

    cleanup();
  });
});

describe('renderDashboard: o filtro de ano da tela', () => {
  // O painel tem filtro de ano próprio e começa no ano atual. Sem esta
  // asserção, ele poderia passar a ler um ano guardado sem que nada avisasse.
  test('abre no ano atual e oferece os anos com dado', async () => {
    const { container, cleanup } = await montar();

    const select = container.querySelector('.form-field__select');

    expect(select.value).toBe(String(ANO_ATUAL));
    expect(getAnos).toHaveBeenCalled();
    const opcoes = Array.from(select.options).map(o => o.value);
    for (const ano of ANOS) expect(opcoes).toContain(String(ano));

    cleanup();
  });

  // Exercicio fechado abre fechado. O mes nascia com o mes de hoje, entao ir
  // para um ano anterior cortava o ano encerrado no mes corrente: o painel
  // mostrava um total menor que o real, e nada avisava.
  test('trocar para um ano anterior leva o mes para dezembro', async () => {
    const { container, cleanup } = await montar();

    await trocarAno(container, ANO_ATUAL - 1);

    expect(selectDoCampo(container, 'Mês').value).toBe('12');
    expect(getExecucaoNd).toHaveBeenLastCalledWith({ ano: ANO_ATUAL - 1, mes: 12 });

    cleanup();
  });
});

describe('renderDashboard: o painel de pendencias', () => {
  // O recorte do painel aceita `data IS NULL`, entao esses registros entram em
  // TODOS os meses. Nada na tela dizia isso, e mais cinco defeitos de dado nao
  // apareciam em lugar nenhum.
  test('lista uma linha por pendencia, com a contagem e o total', async () => {
    const { container, cleanup } = await montar();

    const linhas = linhasPendencia(container);
    const texto = linhas.map(li => li.textContent);

    // Cinco das seis medidas: a NC sem data ja esta zerada em 2026, e pendencia
    // sem ocorrencia NAO vira linha.
    expect(linhas.length).toBe(5);
    expect(texto.join(' ')).toContain('25 de 30');
    expect(texto.join(' ')).toContain('9 de 44');
    expect(texto.join(' ')).not.toContain('sem data de emissão');

    cleanup();
  });

  // O link leva a lista onde o conserto se faz. A liquidacao nao tem lista
  // propria (vive na ficha da NE), e por isso e a unica linha sem link.
  test('cada pendencia com lista propria leva o link para ela', async () => {
    const { container, cleanup } = await montar();

    const destinos = Array.from(container.querySelectorAll('.pendencias__lista a'))
      .map(a => a.getAttribute('href'));

    expect(destinos).toContain('#/orcamento/notas_empenho');
    expect(destinos).toContain('#/orcamento/notas_credito');
    expect(destinos).toContain('#/orcamento/rpnp');

    cleanup();
  });

  // Bloco que some quando zera faz o usuario duvidar se ele existiu: "nao vi
  // pendencia" e diferente de "nao ha pendencia".
  test('sem pendencia nenhuma o bloco diz que esta tudo em ordem', async () => {
    getExecucaoNd.mockResolvedValue({ linhas: LINHAS, pendencias: SEM_PENDENCIA });
    const { container, cleanup } = await montar();

    const bloco = container.querySelector('.pendencias');

    expect(bloco.classList.contains('hidden')).toBe(false);
    expect(bloco.textContent).toContain('Nenhuma pendência de dado neste ano');

    cleanup();
  });

  // 2025 foi carregado do RPCATec, sem documento individual: as datas nao
  // existem em fonte nenhuma, e nenhuma acao humana leva essas tres a zero. O
  // alvo de ZERO vale para 2026 em diante.
  test('2025 marca as pendencias de data como carga historica', async () => {
    const { container, cleanup } = await montar();

    await trocarAno(container, 2025);

    const linhas = linhasPendencia(container);
    const empenho = linhas.find(li => li.textContent.includes('Empenhos sem data'));
    const meta = linhas.find(li => li.textContent.includes('sem meta do PIT'));

    expect(empenho.textContent).toContain('carregado do RPCATec');
    expect(empenho.querySelector('.chip--default')).not.toBeNull();
    expect(empenho.querySelector('.chip--warning')).toBeNull();

    // As demais pendencias de 2025 continuam sendo pendencia de verdade: elas
    // tem conserto, e o tom de alerta fica.
    expect(meta.textContent).not.toContain('carregado do RPCATec');
    expect(meta.querySelector('.chip--warning')).not.toBeNull();

    cleanup();
  });
});
