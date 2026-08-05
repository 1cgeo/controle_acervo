import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber, formatCurrency } from '@utils/format.js';
import { showError, showSuccess } from '@utils/toast.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { mostrarErroNoGrafico } from '@components/estado-erro.js';
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

// O ano chega como FUNÇÃO, e não como valor: o botão é montado uma vez e o ano
// do filtro muda depois. Com o valor, todo CSV sairia do ano da montagem.
function exportButton(nome, anoDoPainel) {
  return el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await mapotecaService.downloadDashboardCsv(nome, anoDoPainel());
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
 * Abre o dashboard, e por isso e a PRIMEIRA aba: e o que se
 * quer ver ao entrar, antes do movimento do dia a dia.
 *
 * O ano vem do filtro da PAGINA do dashboard, que vale para as cinco abas.
 * Um filtro por aba faria a mesma escolha ser refeita a
 * cada troca de aba.
 *
 * @param {HTMLElement} container
 * @param {() => number} getAno - ano do filtro da pagina
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderResumoAnualTab(container, getAno) {
  let disposed = false;
  let anoSelecionado = getAno();

  const anoDoPainel = () => anoSelecionado;

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
      // Sem rotulo de ano aqui: o filtro da pagina fica logo acima das abas, e
      // repetir o ano em cada secao so duplicaria a informacao.
      el('h2', { className: 'dashboard-section__title', textContent: 'Resumo Anual' }),
    ]),
    el('div', { className: 'summary-cards' }, Object.values(cards)),
    el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
      el('div', {}, [
        el('div', { className: 'export-bar' }, [exportButton('entregas_por_tipo_produto', anoDoPainel)]),
        entregasTipoChart,
      ]),
      el('div', {}, [
        el('div', { className: 'export-bar' }, [exportButton('operacoes_apoiadas', anoDoPainel)]),
        operacoesChart,
      ]),
    ]),
  ]));

  async function load() {
    // Reler o filtro a cada carga cobre os dois caminhos: o refresh de 60 s da
    // aba e a troca de ano, que o dashboard repassa como refresh.
    anoSelecionado = getAno();
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
      // Ausência de fonte não é zero. O servidor manda null quando o ano não
      // tem NENHUM registro de manutenção, e o cartão diz "Sem registro". O
      // R$ 0,00 fica reservado para registro que soma zero. Com
      // `mapoteca.manutencao_plotter` vazia, R$ 0,00 se leria como custo medido.
      cards.custoManutencao.setValue(
        resumo.custo_manutencao_total == null
          ? 'Sem registro'
          : formatCurrency(resumo.custo_manutencao_total)
      );
    } else {
      showError(resumoRes.reason?.message || 'Erro ao carregar o resumo anual');
    }

    if (tipoRes.status === 'fulfilled') {
      const { data, series } = pivotEntregasPorTipo(tipoRes.value);
      entregasTipoChart.update({ data, series, loading: false });
    } else {
      entregasTipoChart.update({ data: [], loading: false });
      mostrarErroNoGrafico(entregasTipoChart, tipoRes.reason, load);
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
      mostrarErroNoGrafico(operacoesChart, operacoesRes.reason, load);
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
