import { el, clearChildren } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createLineChart } from '@components/charts/line-chart.js';
import { mostrarErroNoGrafico } from '@components/estado-erro.js';
import { badgeAbaixoMinimo } from '@components/status-chip.js';
import * as mapotecaService from '@modules/mapoteca/services/mapoteca-service.js';
import { mesLabel } from './utils.js';

/**
 * Aba "Materiais": o que falta, o que ha em estoque, onde, e o que esta sendo
 * gasto.
 *
 * O ALERTA DE ESTOQUE MINIMO ABRE A ABA, e nao mora so na tela de Insumos.
 * Quem olha o dashboard esta perguntando "o que precisa de mim hoje", e "acabou
 * o papel" e a resposta mais acionavel que esta aba tem. Escondida numa tela que
 * so quem cuida de material visita, ela chegava tarde.
 *
 * Ele mede contra o DISPONIVEL (Seção + Almoxarifado), que e o `abaixo_minimo`
 * que o servidor ja resolve: 'Aquisicao realizada' e 'Saldo no empenho' sao
 * material comprado e ainda nao entregue, e conta-los esconderia a falta na
 * prateleira atras de uma compra que ainda esta com o fornecedor.
 *
 * Estoque e consumo sao duas metades da mesma pergunta, e por isso convivem
 * numa aba so: o consumo do mes explica o saldo que a outra metade mostra.
 * Lembrando que consumo so sai da Seção (RN), entao o grafico por localizacao
 * e o que diz se falta transferir material para la.
 *
 * A unica aba do dashboard em que o ano vale SO PARA METADE. O consumo e do ano
 * do filtro; o estoque e o saldo de HOJE, e nao existe "estoque de 2025".
 * Silenciar essa diferenca seria pior do que ela: quem trocasse o ano veria um
 * grafico mudar e o outro nao, sem explicacao.
 *
 * @param {HTMLElement} container
 * @param {() => number} getAno - ano do filtro da pagina do dashboard
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderMateriaisTab(container, getAno) {
  let disposed = false;
  let ano = getAno();

  // O alerta e um bloco que ENTRA E SAI: sem insumo abaixo do minimo ele some do
  // DOM. Um "nenhum insumo abaixo do mínimo" permanente vira ruido, e um bloco
  // vazio somaria a margem dele em toda carga.
  const alerta = el('div', { className: 'dashboard-section hidden' });

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
    textContent: 'O estoque é o saldo de hoje, e não acompanha o ano escolhido.',
  });
  const tituloConsumo = el('h2', { className: 'dashboard-section__title' });

  // O ano SEM NENHUM lancamento de consumo tem uma frase, e nao dois graficos
  // vazios.
  //
  // Medido na producao em 2026-08-07: o consumo estava vazio, e os doze meses
  // voltavam zero em 2026 e em 2025. A tela mostrava a curva com "Sem dados
  // disponiveis" ao lado de um Top 5 em branco, e metade da aba nao dizia nada.
  // Duas caixas vazias tambem nao explicam POR QUE estao vazias, e a resposta
  // aqui e acionavel: falta lancar, e o lancamento tem um lugar.
  const semConsumo = el('p', { className: 'dashboard__vazio hidden' });
  const graficosConsumo = el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
    consumoLine, topMateriaisBar,
  ]);

  container.appendChild(alerta);
  container.appendChild(escopoEstoque);
  container.appendChild(stockBar);
  container.appendChild(el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [tituloConsumo]),
    semConsumo,
    graficosConsumo,
  ]));

  /** Repinta o alerta com os insumos que o servidor marcou `abaixo_minimo`. */
  function pintarAlerta(materiais) {
    const faltando = (materiais || []).filter(m => m.abaixo_minimo && m.ativo);
    alerta.classList.toggle('hidden', faltando.length === 0);
    if (faltando.length === 0) {
      clearChildren(alerta);
      return;
    }

    const linhas = faltando.map(m => el('li', {}, [
      el('a', {
        href: `#/mapoteca/insumos/${m.id}`,
        textContent: m.nome,
      }),
      // O par (disponivel, minimo) na mesma linha: o nome sozinho diz que ha um
      // problema, e nao o tamanho dele.
      el('span', {
        textContent: ` — ${formatNumber(m.estoque_disponivel)} disponíveis, `
          + `mínimo ${formatNumber(m.estoque_minimo)}`,
      }),
    ]));

    alerta.replaceChildren(
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', {
          className: 'dashboard-section__title',
          textContent: faltando.length === 1
            ? '1 insumo abaixo do mínimo'
            : `${faltando.length} insumos abaixo do mínimo`,
        }),
        badgeAbaixoMinimo(),
      ]),
      el('p', {
        className: 'dashboard__escopo',
        textContent: 'Contando o disponível (Seção + Almoxarifado). O que foi '
          + 'comprado e ainda não chegou não entra.',
      }),
      el('ul', {}, linhas),
    );
  }

  async function load() {
    ano = getAno();
    tituloConsumo.textContent = `Consumo de Material em ${ano}`;

    const [materiaisRes, stockRes, consumoRes] = await Promise.allSettled([
      mapotecaService.getTiposMaterial(),
      mapotecaService.getStockByLocation(),
      mapotecaService.getMaterialConsumption(ano),
    ]);
    if (disposed) return;

    if (materiaisRes.status === 'fulfilled') {
      pintarAlerta(materiaisRes.value);
    } else {
      // Falha de carga NAO pode virar "nao ha nada abaixo do minimo": o alerta
      // sai da tela, e os outros dois blocos seguem contando o que conseguiram.
      alerta.classList.add('hidden');
      clearChildren(alerta);
    }

    if (stockRes.status === 'fulfilled') {
      stockBar.update({
        data: stockRes.value.map(s => ({
          localizacao: s.localizacao,
          quantidade_total: Number(s.quantidade_total),
        })),
        loading: false,
      });
    } else {
      // Grafico vazio le-se como "estoque zerado", que manda comprar papel.
      // Falha de carga pede a acao oposta: tentar de novo.
      stockBar.update({ data: [], loading: false });
      mostrarErroNoGrafico(stockBar, stockRes.reason, load);
    }

    if (consumoRes.status === 'fulfilled') {
      const consumo = consumoRes.value;
      const mensal = consumo.consumo_mensal_total || [];
      const top = consumo.materiais_mais_consumidos || [];

      // "Nao houve lancamento" e diferente de "houve e deu zero". A checagem
      // exige as DUAS coisas: nenhum material no Top 5 e nenhum mes com
      // quantidade. Um mes zerado sozinho e informacao legitima, e nao motivo
      // para trocar o grafico por uma frase.
      const nenhumLancamento = top.length === 0
        && mensal.every(m => Number(m.quantidade_total) === 0);

      semConsumo.classList.toggle('hidden', !nenhumLancamento);
      graficosConsumo.classList.toggle('hidden', nenhumLancamento);
      // O CAMINHO CERTO, corrigido em 2026-08-08: a tela de Materiais nao existe
      // mais, e mesmo quando existia o consumo se lancava em OUTRA tela, a de
      // Consumo de material. A frase mandava a pessoa para o lugar errado desde
      // 2026-08-05.
      semConsumo.textContent = `Nenhum consumo de material lançado em ${ano}. `
        + 'O consumo sai da Seção, e se lança na tela Insumos, pela ação '
        + '"Consumir". '
        + 'O gasto de papel por entrega está no Resumo Anual, em "Entregas por mídia".';

      consumoLine.update({
        data: mensal.map(m => ({
          mes_nome: mesLabel(m.mes),
          quantidade_total: Number(m.quantidade_total),
        })),
        loading: false,
      });
      topMateriaisBar.update({
        data: top.map(m => ({
          nome: m.nome,
          quantidade_total: Number(m.quantidade_total),
        })),
        loading: false,
      });
    } else {
      // Falha de carga NAO pode cair no estado "nenhum lancamento": um manda
      // tentar de novo, o outro manda ir lancar consumo.
      semConsumo.classList.add('hidden');
      graficosConsumo.classList.remove('hidden');
      consumoLine.update({ data: [], loading: false });
      topMateriaisBar.update({ data: [], loading: false });
      mostrarErroNoGrafico(consumoLine, consumoRes.reason, load);
      mostrarErroNoGrafico(topMateriaisBar, consumoRes.reason, load);
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
