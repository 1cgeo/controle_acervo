import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber, formatCurrency } from '@utils/format.js';
import { showError, showSuccess } from '@utils/toast.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { mostrarErroNoGrafico } from '@components/estado-erro.js';
import * as mapotecaService from '@modules/mapoteca/services/mapoteca-service.js';
import { mesLabelNumero } from './utils.js';

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
 * TUDO nesta aba conta ENTREGA (data de atendimento do pedido) e cliente
 * MILITAR. Os dois recortes estao escritos na linha de escopo, e nao so aqui no
 * comentario: sem eles, o cartao "Pedidos no ano" e o cartao "Produtos
 * entregues", lado a lado, parecem falar da mesma populacao e nao falam.
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

  // A CURVA DE ENTREGA do ano, que faltava na tela.
  //
  // O dashboard tinha "Pedidos por mês" (na aba Pedidos, pela data do PEDIDO) e
  // nao tinha o mes da ENTREGA, que e o numero de que a DGEO presta contas. O
  // `entregas_por_mes` ja existia no servidor desde sempre, alimentava so a
  // exportacao CSV e nao aparecia em painel nenhum.
  //
  // Barra EMPILHADA, e nao linha: a pergunta aqui e de composicao (quanto de
  // topografica, quanto de ortoimagem, quanto do resto), e nao de tendencia.
  const entregasMesChart = createBarChart({
    title: 'Entregas por mês',
    data: [],
    xKey: 'mes_nome',
    series: [
      { dataKey: 'carta_topo', label: 'Carta topográfica' },
      { dataKey: 'carta_orto', label: 'Carta ortoimagem' },
      { dataKey: 'outros', label: 'Outros' },
    ],
    stacked: true,
    loading: true,
  });

  const entregasTipoChart = createBarChart({
    title: 'Entregas por Tipo de Produto × Escala',
    data: [],
    xKey: 'tipo_produto',
    series: [],
    stacked: true,
    loading: true,
  });

  // O CONSUMO DE MIDIA, que tambem so saia em CSV.
  //
  // E a entrada direta da compra de papel, e o unico dado real de gasto de
  // insumo enquanto `mapoteca.consumo_material` estiver sem lancamento (a aba
  // Materiais mostra zero nos doze meses).
  const entregasMidiaChart = createBarChart({
    title: 'Entregas por mídia',
    data: [],
    xKey: 'tipo_midia',
    series: [{ dataKey: 'total_produtos', label: 'Exemplares' }],
    horizontal: true,
    loading: true,
  });

  const operacoesChart = createBarChart({
    title: 'Operações Apoiadas',
    data: [],
    xKey: 'operacao',
    series: [
      { dataKey: 'total_produtos', label: 'Produtos' },
      { dataKey: 'total_pedidos', label: 'Pedidos' },
    ],
    horizontal: true,
    loading: true,
    emptyMessage: 'Nenhuma entrega com operação registrada neste ano',
  });

  const escopo = el('p', { className: 'dashboard__escopo' });

  // Quanto do ano este grafico explica.
  //
  // Sem esta linha, o grafico de operacoes se le como se cobrisse a entrega do
  // ano, e ele cobre uma fatia. Medido na producao em 2026-08-07: 69 dos 99
  // pedidos entregues nao tem `operacao` preenchida, e o grafico fala de 1.185
  // dos 6.535 exemplares. Calar isso e o mesmo defeito que o rodape do Anuario
  // existe para evitar: celula vazia e celula zero dizem coisas diferentes.
  const coberturaOperacoes = el('p', { className: 'dashboard__escopo' });

  container.appendChild(el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      // Sem rotulo de ano aqui: o filtro da pagina fica logo acima das abas, e
      // repetir o ano em cada secao so duplicaria a informacao.
      el('h2', { className: 'dashboard-section__title', textContent: 'Resumo Anual' }),
    ]),
    escopo,
    el('div', { className: 'summary-cards' }, Object.values(cards)),
    el('div', {}, [
      el('div', { className: 'export-bar' }, [exportButton('entregas_por_mes', anoDoPainel)]),
      entregasMesChart,
    ]),
    el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
      el('div', {}, [
        el('div', { className: 'export-bar' }, [exportButton('entregas_por_tipo_produto', anoDoPainel)]),
        entregasTipoChart,
      ]),
      el('div', {}, [
        el('div', { className: 'export-bar' }, [exportButton('entregas_por_midia', anoDoPainel)]),
        entregasMidiaChart,
      ]),
    ]),
    el('div', {}, [
      el('div', { className: 'export-bar' }, [exportButton('operacoes_apoiadas', anoDoPainel)]),
      operacoesChart,
      coberturaOperacoes,
    ]),
  ]));

  /**
   * Escreve a linha de cobertura do grafico de operacoes.
   * Precisa dos DOIS numeros. Faltando um, a frase omite a fracao em vez de
   * inventar denominador.
   */
  function descreverCobertura(somaOperacoes, totalEntregas) {
    if (somaOperacoes === null) {
      coberturaOperacoes.textContent = '';
      return;
    }
    if (totalEntregas === null || !totalEntregas) {
      coberturaOperacoes.textContent =
        `O gráfico soma ${formatNumber(somaOperacoes)} exemplares de pedido com operação registrada.`;
      return;
    }
    const pct = Math.round((somaOperacoes / totalEntregas) * 100);
    coberturaOperacoes.textContent =
      `O gráfico cobre ${formatNumber(somaOperacoes)} dos ${formatNumber(totalEntregas)} exemplares `
      + `entregues no ano (${pct}%). O restante saiu de pedido sem o campo operação preenchido.`;
  }

  async function load() {
    // Reler o filtro a cada carga cobre os dois caminhos: o refresh de 60 s da
    // aba e a troca de ano, que o dashboard repassa como refresh.
    anoSelecionado = getAno();
    const ano = anoSelecionado;
    escopo.textContent = `Entregas de ${ano}, pela data de atendimento do pedido, `
      + 'e só de cliente militar. Os pedidos que ENTRARAM no ano estão na aba Pedidos.';

    entregasMesChart.update({ loading: true });
    entregasTipoChart.update({ loading: true });
    entregasMidiaChart.update({ loading: true });
    operacoesChart.update({ loading: true });

    const results = await Promise.allSettled([
      mapotecaService.getResumoAnual(ano),
      mapotecaService.getEntregasPorTipoProduto(ano),
      mapotecaService.getOperacoesApoiadas(ano),
      mapotecaService.getEntregasPorMes(ano),
      mapotecaService.getEntregasPorMidia(ano),
    ]);
    // Trocar o ano no meio da carga invalida a resposta que estiver a caminho.
    if (disposed || ano !== anoSelecionado) return;

    const [resumoRes, tipoRes, operacoesRes, mesRes, midiaRes] = results;

    // Guardados para a linha de cobertura, que precisa dos dois lados.
    let totalEntregas = null;
    let somaOperacoes = null;

    if (resumoRes.status === 'fulfilled') {
      const resumo = resumoRes.value;
      totalEntregas = Number(resumo.total_entregas);
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

    if (mesRes.status === 'fulfilled') {
      entregasMesChart.update({
        data: mesRes.value.map(m => ({
          mes_nome: mesLabelNumero(m.mes),
          carta_topo: Number(m.carta_topo),
          carta_orto: Number(m.carta_orto),
          outros: Number(m.outros),
        })),
        loading: false,
      });
    } else {
      entregasMesChart.update({ data: [], loading: false });
      mostrarErroNoGrafico(entregasMesChart, mesRes.reason, load);
    }

    if (tipoRes.status === 'fulfilled') {
      const { data, series } = pivotEntregasPorTipo(tipoRes.value);
      entregasTipoChart.update({ data, series, loading: false });
    } else {
      entregasTipoChart.update({ data: [], loading: false });
      mostrarErroNoGrafico(entregasTipoChart, tipoRes.reason, load);
    }

    if (midiaRes.status === 'fulfilled') {
      entregasMidiaChart.update({
        data: midiaRes.value.map(m => ({
          // A midia nao cadastrada volta nula do LEFT JOIN, e o grafico
          // escreveria a palavra "null" como categoria.
          tipo_midia: m.tipo_midia || 'Sem mídia registrada',
          total_produtos: Number(m.total_produtos),
        })),
        loading: false,
      });
    } else {
      entregasMidiaChart.update({ data: [], loading: false });
      mostrarErroNoGrafico(entregasMidiaChart, midiaRes.reason, load);
    }

    if (operacoesRes.status === 'fulfilled') {
      const operacoes = operacoesRes.value || [];
      somaOperacoes = operacoes.reduce((soma, o) => soma + Number(o.total_produtos), 0);
      operacoesChart.update({
        data: operacoes.map(o => ({
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

    descreverCobertura(somaOperacoes, totalEntregas);
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      entregasMesChart._cleanup();
      entregasTipoChart._cleanup();
      entregasMidiaChart._cleanup();
      operacoesChart._cleanup();
    },
    refresh: load,
  };
}
