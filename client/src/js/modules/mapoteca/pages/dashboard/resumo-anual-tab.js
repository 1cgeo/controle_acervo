import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber, formatCurrency } from '@utils/format.js';
import { showError, showSuccess } from '@utils/toast.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import * as mapotecaService from '@modules/mapoteca/services/mapoteca-service.js';

/** Card simples de numero, sem icone: aqui o que importa e o valor. */
function summaryCard(label) {
  const valueEl = el('div', { className: 'summary-card__value', textContent: '-' });
  const card = el('div', { className: 'summary-card' }, [
    valueEl,
    el('div', { className: 'summary-card__label', textContent: label }),
  ]);
  card.setValue = (v) => { valueEl.textContent = v; };
  return card;
}

function exportButton(nome, getAno) {
  return el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await mapotecaService.downloadDashboardCsv(nome, getAno());
        showSuccess('Exportação CSV iniciada');
      } catch (err) {
        showError(err.message || 'Erro ao exportar CSV');
      } finally {
        btn.disabled = false;
      }
    },
  }, [svgIcon(ICONS.download, 14), 'Exportar CSV']);
}

/** Pivota entregas_por_tipo_produto em dados de barra empilhada + series. */
function pivotEntregasPorTipo(rows) {
  const tipos = [...new Set(rows.map(r => r.tipo_produto))];
  const escalas = [...new Set(rows.map(r => r.escala))];

  const data = tipos.map(tipo => {
    const item = { tipo_produto: tipo };
    for (const escala of escalas) {
      const found = rows.find(r => r.tipo_produto === tipo && r.escala === escala);
      item[escala] = found ? Number(found.total_produtos) : 0;
    }
    return item;
  });

  const series = escalas.map(escala => ({ dataKey: escala, label: escala }));
  return { data, series };
}

/**
 * Aba "Resumo Anual": o numero de que a DGEO presta contas.
 *
 * Abre o dashboard (chefe, 2026-07-27), e por isso e a PRIMEIRA aba: e o que se
 * quer ver ao entrar, antes do movimento do dia a dia.
 *
 * O ano e local desta aba, e nao da pagina: nenhum outro painel da mapoteca e
 * por ano, entao um seletor no cabecalho da pagina ficaria sem efeito em tres
 * das quatro abas.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderResumoAnualTab(container) {
  let disposed = false;
  const anoAtual = new Date().getFullYear();
  let anoSelecionado = anoAtual;

  const getAno = () => anoSelecionado;

  const yearSelect = el('select', {
    className: 'chart-card__select',
    'aria-label': 'Selecionar ano',
    onChange: (e) => {
      anoSelecionado = parseInt(e.target.value, 10);
      load();
    },
  }, Array.from({ length: 6 }, (_, i) => {
    const year = anoAtual - i;
    return el('option', { value: String(year), textContent: String(year) });
  }));
  yearSelect.value = String(anoAtual);

  const cards = {
    totalPedidos: summaryCard('Pedidos no ano'),
    totalEntregas: summaryCard('Produtos entregues'),
    omsDistintas: summaryCard('OMs distintas'),
    operacoesDistintas: summaryCard('Operações apoiadas'),
    custoManutencao: summaryCard('Custo de manutenção'),
  };

  const entregasTipoChart = createBarChart({
    title: 'Entregas por Tipo de Produto × Escala',
    data: [],
    xKey: 'tipo_produto',
    series: [],
    stacked: true,
    loading: true,
  });

  const operacoesChart = createBarChart({
    title: 'Operações Apoiadas',
    data: [],
    xKey: 'operacao',
    series: [
      { dataKey: 'total_pedidos', label: 'Pedidos' },
      { dataKey: 'total_produtos', label: 'Produtos' },
    ],
    horizontal: true,
    loading: true,
  });

  container.appendChild(el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Resumo Anual' }),
      el('div', { className: 'dashboard-section__controls' }, [
        el('span', { textContent: 'Ano:' }),
        yearSelect,
      ]),
    ]),
    el('div', { className: 'summary-cards' }, Object.values(cards)),
    el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
      el('div', {}, [
        el('div', { className: 'export-bar' }, [exportButton('entregas_por_tipo_produto', getAno)]),
        entregasTipoChart,
      ]),
      el('div', {}, [
        el('div', { className: 'export-bar' }, [exportButton('operacoes_apoiadas', getAno)]),
        operacoesChart,
      ]),
    ]),
  ]));

  async function load() {
    const ano = anoSelecionado;
    entregasTipoChart.update({ loading: true });
    operacoesChart.update({ loading: true });

    const results = await Promise.allSettled([
      mapotecaService.getResumoAnual(ano),
      mapotecaService.getEntregasPorTipoProduto(ano),
      mapotecaService.getOperacoesApoiadas(ano),
    ]);
    // Trocar o ano no meio da carga invalida a resposta que estiver a caminho.
    if (disposed || ano !== anoSelecionado) return;

    const [resumoRes, tipoRes, operacoesRes] = results;

    if (resumoRes.status === 'fulfilled') {
      const resumo = resumoRes.value;
      cards.totalPedidos.setValue(formatNumber(resumo.total_pedidos));
      cards.totalEntregas.setValue(formatNumber(resumo.total_entregas));
      cards.omsDistintas.setValue(formatNumber(resumo.oms_distintas_count));
      cards.operacoesDistintas.setValue(formatNumber(resumo.operacoes_distintas_count));
      cards.custoManutencao.setValue(formatCurrency(resumo.custo_manutencao_total));
    } else {
      showError(resumoRes.reason?.message || 'Erro ao carregar o resumo anual');
    }

    if (tipoRes.status === 'fulfilled') {
      const { data, series } = pivotEntregasPorTipo(tipoRes.value);
      entregasTipoChart.update({ data, series, loading: false });
    } else {
      entregasTipoChart.update({ data: [], loading: false });
    }

    if (operacoesRes.status === 'fulfilled') {
      operacoesChart.update({
        data: operacoesRes.value.map(o => ({
          operacao: o.operacao,
          total_pedidos: Number(o.total_pedidos),
          total_produtos: Number(o.total_produtos),
        })),
        loading: false,
      });
    } else {
      operacoesChart.update({ data: [], loading: false });
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      entregasTipoChart._cleanup();
      operacoesChart._cleanup();
    },
    refresh: load,
  };
}
