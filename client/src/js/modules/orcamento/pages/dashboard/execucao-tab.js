import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency } from '@utils/format.js';
import { createStatsCard } from '@components/stats-card.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { mostrarErro } from '@components/estado-erro.js';
import { getLinhas, getTotalRow, semTotal } from './secao3-store.js';

/**
 * Percentual de `parte` sobre `base`, com uma casa decimal.
 *
 * Base zero devolve '-', e nao '0,0': dividir por zero nao produz "zero por
 * cento", produz uma pergunta sem resposta. O painel de um ano sem PDR mostrava
 * "0,0%" de execucao, que se le como "nada foi executado".
 *
 * @param {number} parte
 * @param {number} base
 * @returns {string} ja com o separador decimal do pt-BR, sem o sinal de %
 */
function percentual(parte, base) {
  const b = Number(base) || 0;
  if (b === 0) return '-';
  return ((Number(parte) || 0) / b * 100).toLocaleString('pt-BR', {
    minimumFractionDigits: 1,
    maximumFractionDigits: 1,
  });
}

/**
 * Aba "Visão Geral": a linha TOTAL da execução por ND em cards, mais a mesma
 * execução por Natureza de Despesa em barras.
 *
 * Os cards vem em tres blocos (Totais, PDR, Extra-PDR) porque somar PDR com
 * Extra-PDR e o erro classico de leitura: os dois recortes convivem na mesma
 * linha. O "Previsto" so existe no PDR, e por isso so aparece la.
 *
 * @param {HTMLElement} container
 * @param {{carregar:Function}} store
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderExecucaoTab(container, store) {
  let disposed = false;

  const mkCard = (title, color, icon, suffix = '') => createStatsCard({
    title, value: '-', icon: svgIcon(icon, 24), color, loading: true, suffix,
  });

  const cardPrevisto = mkCard('Previsto', 'info', ICONS.assignment);
  const cardRecebido = mkCard('Recebido', 'primary', ICONS.download);
  const cardRecolhido = mkCard('Recolhido', 'info', ICONS.logout);
  const cardEmpenhado = mkCard('Empenhado', 'warning', ICONS.description);
  const cardLiquidado = mkCard('Liquidado', 'success', ICONS.checkCircle);

  // A pergunta que a tela inicial do modulo tem de responder: como esta a
  // execucao AGORA. Os quatro valores acima nao a respondem sozinhos, porque a
  // conta de cabeca erra: o recolhido nao desconta do recebido em lugar nenhum.
  //
  // O SALDO VEM EM DUAS METADES, e nao num liquido so. O card unico somava
  // credito por empenhar com saldo NEGATIVO e cancelava um com o outro. Medido
  // em 2026-08-07: ele mostrava R$ 428,73, que eram R$ 5.612,10 por empenhar
  // MENOS R$ 5.183,37 de negativo. Saldo negativo e impossivel (empenhado maior
  // que o credito disponivel) e sempre aponta defeito de lancamento; naquele dia
  // eram dois empenhos anulados no SIAFI que o SCA ainda contava.
  const cardCreditoAEmpenhar = mkCard('Crédito a empenhar', 'success', ICONS.storage);
  // So aparece quando EXISTE. Um card de inconsistencia zerado, todo mes na
  // tela, ensina a ignora-lo, e no mes em que ele acender ninguem olha.
  const cardSaldoNegativo = mkCard('Saldo negativo (inconsistência)', 'error', ICONS.warning);
  // Nasce ESCONDIDO: enquanto a consulta nao voltou nao se sabe se ha
  // inconsistencia, e um card de alerta piscando em toda carga vale zero.
  cardSaldoNegativo.classList.add('hidden');
  const cardPctEmpenhado = mkCard('% empenhado do recebido', 'warning', ICONS.dataUsage, '%');
  // O DENOMINADOR E O PDR, e o numerador tambem. O card dividia o recebido TOTAL
  // (PDR mais Extra-PDR) pelo previsto, que e so do PDR: o Extra-PDR e, por
  // definicao, o credito que o PDR nao previu, e nao tem denominador honesto.
  // Medido em 2026-08-07: previsto R$ 569.300,66, recebido PDR R$ 279.016,07,
  // recebido Extra-PDR R$ 386.254,00. O card mostrava 116,9% onde a execucao do
  // PDR era 49,0%, que e a diferenca entre "estamos sobrando" e "falta metade do
  // credito chegar".
  const cardPctRecebido = mkCard('% recebido do previsto (PDR)', 'primary', ICONS.dataUsage, '%');
  // O Extra-PDR ao lado, em VALOR ABSOLUTO e sem percentual nenhum.
  const cardRecebidoExtraTotal = mkCard('Recebido Extra-PDR (sem previsão)', 'info', ICONS.download);

  const cardRecebidoPdr = mkCard('Recebido PDR', 'primary', ICONS.download);
  const cardRecolhidoPdr = mkCard('Recolhido PDR', 'info', ICONS.logout);
  const cardEmpenhadoPdr = mkCard('Empenhado PDR', 'warning', ICONS.description);
  const cardLiquidadoPdr = mkCard('Liquidado PDR', 'success', ICONS.checkCircle);

  const cardRecebidoExtra = mkCard('Recebido Extra-PDR', 'primary', ICONS.download);
  const cardRecolhidoExtra = mkCard('Recolhido Extra-PDR', 'info', ICONS.logout);
  const cardEmpenhadoExtra = mkCard('Empenhado Extra-PDR', 'warning', ICONS.description);
  const cardLiquidadoExtra = mkCard('Liquidado Extra-PDR', 'success', ICONS.checkCircle);

  const todosCards = [
    cardPrevisto, cardRecebido, cardRecolhido, cardEmpenhado, cardLiquidado,
    cardCreditoAEmpenhar, cardSaldoNegativo, cardPctEmpenhado,
    cardPctRecebido, cardRecebidoExtraTotal,
    cardRecebidoPdr, cardRecolhidoPdr, cardEmpenhadoPdr, cardLiquidadoPdr,
    cardRecebidoExtra, cardRecolhidoExtra, cardEmpenhadoExtra, cardLiquidadoExtra,
  ];

  const grupoCards = (titulo, cards) => el('div', { className: 'dashboard-cards-group' }, [
    el('h3', { className: 'dashboard-cards-group__title', textContent: titulo }),
    el('div', { className: 'stats-grid' }, cards),
  ]);

  const execucaoChart = createBarChart({
    title: 'Execução por Natureza de Despesa',
    data: [],
    xKey: 'cod_nd',
    series: [
      { dataKey: 'previsto', label: 'Previsto' },
      { dataKey: 'recebido', label: 'Recebido' },
      { dataKey: 'empenhado', label: 'Empenhado' },
      { dataKey: 'liquidado', label: 'Liquidado' },
    ],
    loading: true,
  });

  // SEM um h2 "Execução por Natureza de Despesa": ele repetiria o titulo do
  // proprio grafico logo abaixo, sob um h1 que ja diz "Execução Orçamentária".
  // Tres titulos para um grafico so.
  const conteudo = el('div', {}, [
    el('div', { className: 'dashboard-cards' }, [
      grupoCards('Totais', [
        cardRecebido, cardRecolhido, cardEmpenhado, cardLiquidado,
        cardCreditoAEmpenhar, cardSaldoNegativo, cardPctEmpenhado,
        cardPctRecebido, cardRecebidoExtraTotal,
      ]),
      grupoCards('PDR', [
        cardPrevisto, cardRecebidoPdr, cardRecolhidoPdr, cardEmpenhadoPdr, cardLiquidadoPdr,
      ]),
      grupoCards('Extra-PDR', [
        cardRecebidoExtra, cardRecolhidoExtra, cardEmpenhadoExtra, cardLiquidadoExtra,
      ]),
    ]),
    el('div', { className: 'dashboard-section' }, [execucaoChart]),
  ]);
  container.appendChild(conteudo);

  async function load() {
    // Uma recarga (troca de mes ou de ano) enquanto o erro esta na tela tem de
    // devolver os cards e o grafico antes de pintar neles.
    if (!container.contains(conteudo)) container.replaceChildren(conteudo);

    todosCards.forEach(c => c.update({ loading: true }));
    execucaoChart.update({ loading: true });

    try {
      // A rota do painel devolve { linhas, pendencias }, e nao o pacote de
      // tabelas do RPCMTec: sao perguntas diferentes.
      const rows = getLinhas(await store.carregar());
      if (disposed) return;
      const total = getTotalRow(rows);

      const recebido = Number(total.recebido || 0);
      const recolhido = Number(total.recolhido || 0);
      const empenhado = Number(total.empenhado || 0);

      cardPrevisto.update({ value: formatCurrency(total.previsto), loading: false });
      cardRecebido.update({ value: formatCurrency(recebido), loading: false });
      cardRecolhido.update({ value: formatCurrency(recolhido), loading: false });
      cardEmpenhado.update({ value: formatCurrency(empenhado), loading: false });
      cardLiquidado.update({ value: formatCurrency(total.liquidado), loading: false });

      // AS DUAS METADES DO SALDO, somadas NOTA A NOTA no servidor. Somar aqui
      // seria impossivel: `recebido - recolhido - empenhado` e um liquido, e o
      // sinal de cada NC ja se perdeu nele.
      //
      // O recolhido SAI da conta do saldo, ainda que nao saia do recebido: ele
      // e credito devolvido, e empenhar sobre ele produz nota devolvida no
      // SIAFI. Nenhuma soma da tela muda por causa disto.
      const saldoNegativo = Number(total.saldo_negativo || 0);
      cardCreditoAEmpenhar.update({
        value: formatCurrency(total.saldo_positivo), loading: false,
      });
      // O card da inconsistencia SOME quando nao ha nenhuma, em vez de mostrar
      // "R$ 0,00". Ele vem NEGATIVO do servidor e sai assim, com o sinal: o
      // sinal e o dado, e o modulo aqui esconderia que aquilo e um defeito.
      // `createStatsCard` devolve o PROPRIO elemento, com `update` acoplado.
      cardSaldoNegativo.classList.toggle('hidden', !(saldoNegativo < 0));
      cardSaldoNegativo.update({
        value: formatCurrency(saldoNegativo), loading: false,
      });
      cardPctEmpenhado.update({ value: percentual(empenhado, recebido), loading: false });
      // PDR sobre PDR. Ver o comentario da declaracao do card.
      cardPctRecebido.update({
        value: percentual(total.recebido_pdr, total.previsto), loading: false,
      });
      cardRecebidoExtraTotal.update({
        value: formatCurrency(total.recebido_extra), loading: false,
      });

      cardRecebidoPdr.update({ value: formatCurrency(total.recebido_pdr), loading: false });
      cardRecolhidoPdr.update({ value: formatCurrency(total.recolhido_pdr), loading: false });
      cardEmpenhadoPdr.update({ value: formatCurrency(total.empenhado_pdr), loading: false });
      cardLiquidadoPdr.update({ value: formatCurrency(total.liquidado_pdr), loading: false });
      cardRecebidoExtra.update({ value: formatCurrency(total.recebido_extra), loading: false });
      cardRecolhidoExtra.update({ value: formatCurrency(total.recolhido_extra), loading: false });
      cardEmpenhadoExtra.update({ value: formatCurrency(total.empenhado_extra), loading: false });
      cardLiquidadoExtra.update({ value: formatCurrency(total.liquidado_extra), loading: false });

      execucaoChart.update({
        data: semTotal(rows).map(r => ({
          cod_nd: r.cod_nd,
          previsto: Number(r.previsto || 0),
          recebido: Number(r.recebido || 0),
          empenhado: Number(r.empenhado || 0),
          liquidado: Number(r.liquidado || 0),
        })),
        loading: false,
      });
    } catch (err) {
      if (disposed) return;
      // Uma chamada so alimenta todos os cards e o grafico desta aba. Falhando
      // ela, nada aqui tem valor, entao o erro toma a aba inteira. Antes o
      // catch pintava tracos nos cards, e a tela dizia "sem execucao" quando o
      // certo era "nao consegui perguntar".
      todosCards.forEach(c => c.update({ value: '-', loading: false }));
      // A falha nao afirma inconsistencia nenhuma: o card de alerta volta a se
      // esconder, em vez de mostrar '-' como se algo estivesse errado no dado.
      cardSaldoNegativo.classList.add('hidden');
      execucaoChart.update({ data: [], loading: false });
      mostrarErro(container, err, load);
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      execucaoChart._cleanup();
    },
    refresh: load,
  };
}
