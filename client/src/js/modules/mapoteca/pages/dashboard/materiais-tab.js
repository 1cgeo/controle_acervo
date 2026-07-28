import { el } from '@utils/dom.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createLineChart } from '@components/charts/line-chart.js';
import * as mapotecaService from '@modules/mapoteca/services/mapoteca-service.js';
import { getAno } from '@modules/mapoteca/store/year-store.js';
import { mesLabel } from './utils.js';

/**
 * Aba "Materiais": o que ha em estoque, onde, e o que esta sendo gasto.
 *
 * Estoque e consumo sao duas metades da mesma pergunta, e por isso convivem
 * numa aba so: o consumo do mes explica o saldo que a outra metade mostra.
 * Lembrando que consumo so sai da Seção (RN), entao o grafico por localizacao
 * e o que diz se falta transferir material para la.
 *
 * A unica aba do dashboard em que o ano vale SO PARA METADE. O consumo e do ano
 * de contexto; o estoque e o saldo de HOJE, e nao existe "estoque de 2025".
 * Silenciar essa diferenca seria pior do que ela: quem trocasse o ano veria um
 * grafico mudar e o outro nao, sem explicacao.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderMateriaisTab(container) {
  let disposed = false;
  let ano = getAno();

  const stockBar = createBarChart({
    title: 'Estoque por Localização',
    data: [],
    xKey: 'localizacao',
    series: [{ dataKey: 'quantidade_total', label: 'Quantidade' }],
    loading: true,
  });

  const consumoLine = createLineChart({
    title: 'Consumo total por mês',
    data: [],
    xKey: 'mes_nome',
    series: [{ dataKey: 'quantidade_total', label: 'Quantidade', fill: true }],
    loading: true,
  });

  const topMateriaisBar = createBarChart({
    title: 'Materiais mais consumidos (Top 5)',
    data: [],
    xKey: 'nome',
    series: [{ dataKey: 'quantidade_total', label: 'Quantidade' }],
    horizontal: true,
    loading: true,
  });

  const escopoEstoque = el('p', {
    className: 'dashboard__escopo',
    textContent: 'O estoque é o saldo de hoje, e não acompanha o ano de referência.',
  });
  const tituloConsumo = el('h2', { className: 'dashboard-section__title' });

  container.appendChild(escopoEstoque);
  container.appendChild(stockBar);
  container.appendChild(el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [tituloConsumo]),
    el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [consumoLine, topMateriaisBar]),
  ]));

  async function load() {
    ano = getAno();
    tituloConsumo.textContent = `Consumo de Material em ${ano}`;

    const [stockRes, consumoRes] = await Promise.allSettled([
      mapotecaService.getStockByLocation(),
      mapotecaService.getMaterialConsumption(ano),
    ]);
    if (disposed) return;

    if (stockRes.status === 'fulfilled') {
      stockBar.update({
        data: stockRes.value.map(s => ({
          localizacao: s.localizacao,
          quantidade_total: Number(s.quantidade_total),
        })),
        loading: false,
      });
    } else {
      stockBar.update({ data: [], loading: false });
    }

    if (consumoRes.status === 'fulfilled') {
      const consumo = consumoRes.value;
      consumoLine.update({
        data: (consumo.consumo_mensal_total || []).map(m => ({
          mes_nome: mesLabel(m.mes),
          quantidade_total: Number(m.quantidade_total),
        })),
        loading: false,
      });
      topMateriaisBar.update({
        data: (consumo.materiais_mais_consumidos || []).map(m => ({
          nome: m.nome,
          quantidade_total: Number(m.quantidade_total),
        })),
        loading: false,
      });
    } else {
      consumoLine.update({ data: [], loading: false });
      topMateriaisBar.update({ data: [], loading: false });
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      stockBar._cleanup();
      consumoLine._cleanup();
      topMateriaisBar._cleanup();
    },
    refresh: load,
  };
}
