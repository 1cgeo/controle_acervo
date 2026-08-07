import { el } from '@utils/dom.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createTabs } from '@components/tabs/tabs.js';
import { formatNumber } from '@utils/format.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';
import { mostrarErro, mostrarErroNoGrafico } from '@components/estado-erro.js';

const PERIODOS = [6, 12, 24];

/**
 * Guarda os paineis de uma sub-aba e sabe devolve-los.
 *
 * `mostrarErro` TIRA os paineis do container para pintar a caixa de erro. O
 * auto-refresh de 60 s chama a mesma carga: sem devolver os nos, a carga que
 * desse certo pintaria elementos fora do DOM, e a caixa de erro ficaria na tela
 * ate alguem clicar em "Tentar de novo". Pior, na segunda falha seguida o
 * `mostrarErro` guardaria como "anteriores" o proprio no de erro, e o botao
 * passaria a restaurar uma caixa de erro velha.
 *
 * Chame `guardar()` depois de montar a sub-aba e `devolver()` no inicio de toda
 * carga que deu certo.
 *
 * @param {HTMLElement} container
 */
function paineisDe(container) {
  let nos = [];
  return {
    guardar: () => { nos = [...container.childNodes]; },
    devolver: () => {
      if (!nos.length || container.contains(nos[0])) return;
      container.replaceChildren(...nos);
    },
  };
}

/**
 * Rotulo curto de um mes 'AAAA-MM' (ex.: 'mar. de 2026').
 * @param {string} mes
 * @returns {string}
 */
function formatMes(mes) {
  if (!mes) return '-';
  const [ano, numero] = String(mes).split('-');
  const data = new Date(Number(ano), Number(numero) - 1, 1);
  if (isNaN(data.getTime())) return String(mes);
  return data.toLocaleDateString('pt-BR', { month: 'short', year: 'numeric' });
}

/** Select de periodo em meses, usado nos graficos de linha do tempo. */
function seletorPeriodo(onChange) {
  return el('select', {
    className: 'chart-card__select',
    'aria-label': 'Período em meses',
    onChange: (e) => onChange(parseInt(e.target.value, 10)),
  }, PERIODOS.map(m => el('option', { value: String(m), textContent: `${m} meses` })));
}

/**
 * Grafico de barras com um seletor de periodo no cabecalho.
 * O createBarChart monta o card como [titulo, corpo]; aqui o titulo sai e entra
 * um cabecalho com titulo + select, que e o padrao do chart-card__header.
 * @param {{title:string, xKey:string, series:Array, onPeriodo:Function}} cfg
 * @returns {{card:HTMLElement, getPeriodo:()=>number}}
 */
function graficoComPeriodo({ title, xKey, series, onPeriodo }) {
  let periodo = PERIODOS[0];

  const card = createBarChart({ title: '', xKey, series, loading: true });

  const select = seletorPeriodo((meses) => {
    periodo = meses;
    onPeriodo(meses);
  });

  const tituloAntigo = card.querySelector('.chart-card__title');
  if (tituloAntigo) tituloAntigo.remove();
  card.prepend(el('div', { className: 'chart-card__header' }, [
    el('div', { className: 'chart-card__title', textContent: title }),
    select,
  ]));

  return { card, getPeriodo: () => periodo };
}

/**
 * Aba "Análises Avançadas": a produção mês a mês, com seletor de periodo, e duas
 * sub-abas de detalhe (versoes e armazenamento).
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderAdvancedTab(container) {
  let disposed = false;

  // --- A PRODUÇÃO, mês a mês ---
  //
  // SAIU a "Linha do Tempo de Produtos", e não foi poda de gosto. Ela contava
  // `produto.data_cadastramento`, que é o dia em que a linha entrou no SCA, e não
  // o dia em que a folha ficou pronta. Na produção, medido em 2026-08-07, ela
  // desenhava 3.500 produtos em junho e 2.200 em julho: era a MIGRAÇÃO do acervo,
  // e o painel a mostrava como se fosse produção da Divisão.
  //
  // Ficou UM gráfico, contado por `data_edicao`, que é a mesma data de onde o PIT
  // tira o realizado. O painel do acervo e a grade do PIT param de contar coisas
  // diferentes com o mesmo nome.
  const versoes = graficoComPeriodo({
    title: 'Produção por mês (data de edição)',
    xKey: 'mes_label',
    series: [
      { dataKey: 'novas_versoes', label: 'Folhas editadas' },
    ],
    onPeriodo: (meses) => loadVersoes(meses),
  });

  // Trocar o periodo depressa deixa duas respostas na rede, e a que chega por
  // ultimo pinta. Sem este contador, escolher 24 meses logo depois de 6 podia
  // deixar o grafico de 6 na tela com o select marcando 24: o painel afirmaria
  // um recorte que nao e o dele. E o mesmo guarda que a busca e a auditoria ja
  // usam.
  let pedidoVersoes = 0;

  async function loadVersoes(meses, silencioso = false) {
    if (!silencioso) versoes.card.update({ loading: true });
    const meu = ++pedidoVersoes;
    try {
      const dados = await acervoService.getVersaoActivityTimeline(meses);
      if (disposed || meu !== pedidoVersoes) return;
      versoes.card.update({
        data: (Array.isArray(dados) ? dados : []).map(d => ({
          ...d,
          mes_label: formatMes(d.month),
          novas_versoes: Number(d.novas_versoes),
        })),
        loading: false,
      });
    } catch (erro) {
      if (disposed || meu !== pedidoVersoes) return;
      // Estado de ERRO, e nao grafico vazio. Zerar a serie fazia o card mostrar
      // "Sem dados disponiveis", que e a frase do acervo sem producao: a falha
      // da API lia-se como mes sem carta editada. O painel e o que o chefe olha
      // para decidir, e "nao houve" e "nao consegui saber" pedem acoes opostas.
      versoes.card.update({ data: [], loading: false });
      mostrarErroNoGrafico(versoes.card, erro, () => loadVersoes(versoes.getPeriodo()));
    }
  }

  container.appendChild(versoes.card);

  // SAIU a sub-aba "Atividade de Usuários" e SAIU a "Status de Projetos".
  //
  // A primeira listava os dez usuários mais ativos, e na produção o acervo
  // inteiro (17.499 arquivos) foi carregado por UM login de carga: a tabela era
  // uma linha e nove zeros. A segunda desenhava duas pizzas para dizer que 17
  // projetos de 18 e 98 lotes de 99 estão concluídos, e o único "em execução" é
  // um projeto guarda-chuva aberto em 1982. O que interessa do lote agora tem
  // lugar melhor: a aba Plano do Ano mostra o lote que ainda não fechou, com
  // prazo e atraso.
  const subAbas = createTabs({
    className: 'sub-tabs',
    ariaLabel: 'Detalhe das análises',
    tabs: [
      { id: 'versoes', label: 'Estatísticas de Versões', render: renderVersionStats },
      { id: 'armazenamento', label: 'Tendências de Armazenamento', render: renderStorageTrends },
    ],
  });
  container.appendChild(subAbas.element);

  await Promise.all([
    loadVersoes(PERIODOS[0]),
    subAbas.ready,
  ]);

  return {
    cleanup: () => {
      disposed = true;
      if (versoes.card._cleanup) versoes.card._cleanup();
      subAbas._cleanup();
    },
    refresh: async () => {
      await Promise.all([
        loadVersoes(versoes.getPeriodo(), true),
        subAbas.refreshActive(),
      ]);
    },
  };
}

/** Card pequeno de resumo (valor em cima, rotulo embaixo). */
function summaryCard(valor, rotulo) {
  return el('div', { className: 'summary-card' }, [
    el('div', { className: 'summary-card__value', textContent: valor }),
    el('div', { className: 'summary-card__label', textContent: rotulo }),
  ]);
}

/**
 * Sub-aba "Estatísticas de Versões".
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderVersionStats(container) {
  let disposed = false;

  const resumo = el('div', { className: 'summary-cards' });
  container.appendChild(resumo);

  // SAIU a pizza "Distribuição de Versões por Produto". Na produção ela era uma
  // fatia de 85% (5.356 produtos com uma versão) e quatro lascas: cauda longa em
  // setor não se lê. E saíram dois cartões: "Total de Versões", que já é cartão
  // da Visão Geral, e "Produtos com Versões", que vale 6.309, exatamente o total
  // de produtos, porque todo produto tem versão.
  const pieTipo = createPieChart({ title: 'Tipos de Versão', loading: true });
  container.appendChild(pieTipo);

  const paineis = paineisDe(container);
  paineis.guardar();

  async function load() {
    try {
      const dados = await acervoService.getVersionStatistics();
      if (disposed) return;
      paineis.devolver();
      const stats = (dados && dados.stats) || {};

      resumo.innerHTML = '';
      resumo.appendChild(summaryCard(Number(stats.avg_versions_per_product || 0).toFixed(1), 'Média de versões por produto'));
      resumo.appendChild(summaryCard(formatNumber(stats.max_versions_per_product), 'Máximo por produto'));

      pieTipo.update({
        data: (Array.isArray(dados?.type_distribution) ? dados.type_distribution : []).map(d => ({
          label: d.version_type || 'Sem tipo',
          value: Number(d.version_count),
        })),
        loading: false,
      });
    } catch (erro) {
      if (disposed) return;
      // Uma chamada so alimenta os cartoes e o grafico desta sub-aba. Falhando
      // ela, nada aqui tem valor, entao o erro toma a sub-aba inteira, e nao
      // cada grafico.
      pieTipo.update({ data: [], loading: false });
      mostrarErro(container, erro, load);
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      if (pieTipo._cleanup) pieTipo._cleanup();
    },
    refresh: load,
  };
}

/**
 * Sub-aba "Tendências de Armazenamento".
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderStorageTrends(container) {
  let disposed = false;

  const grafico = graficoComPeriodo({
    title: 'Tendências de Armazenamento',
    xKey: 'mes_label',
    series: [
      { dataKey: 'gb_added', label: 'GB Adicionados' },
      { dataKey: 'cumulative_gb', label: 'GB Acumulados' },
    ],
    onPeriodo: (meses) => load(meses),
  });
  container.appendChild(grafico.card);

  let pedido = 0;

  async function load(meses, silencioso = false) {
    if (!silencioso) grafico.card.update({ loading: true });
    const meu = ++pedido;
    try {
      const dados = await acervoService.getStorageGrowthTrends(meses);
      if (disposed || meu !== pedido) return;
      grafico.card.update({
        data: (Array.isArray(dados) ? dados : []).map(d => ({
          ...d,
          mes_label: formatMes(d.month),
          gb_added: Number(d.gb_added),
          cumulative_gb: Number(d.cumulative_gb),
        })),
        loading: false,
      });
    } catch (erro) {
      if (disposed || meu !== pedido) return;
      // No corpo do card, e nao no container: o cabecalho tem o seletor de
      // periodo, e quem ve o erro precisa dele para tentar outra janela.
      grafico.card.update({ data: [], loading: false });
      mostrarErroNoGrafico(grafico.card, erro, () => load(grafico.getPeriodo()));
    }
  }

  await load(PERIODOS[0]);

  return {
    cleanup: () => {
      disposed = true;
      if (grafico.card._cleanup) grafico.card._cleanup();
    },
    refresh: () => load(grafico.getPeriodo(), true),
  };
}
