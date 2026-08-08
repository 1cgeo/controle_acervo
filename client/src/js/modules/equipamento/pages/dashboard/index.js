import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createStatsCard } from '@components/stats-card.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { mostrarErro } from '@components/estado-erro.js';
import { getDashboard } from '@modules/equipamento/services/equipamento-service.js';
import { SITUACAO, chipDias } from '@modules/equipamento/situacao.js';

/**
 * Painel do modulo EQUIPAMENTO (#/equipamento).
 *
 * UMA CHAMADA SO alimenta a tela inteira (`GET /api/equipamento/dashboard`), e
 * por isso ela tem UM estado de erro, e nao seis. A regra do `Promise.all` que
 * mordeu tres vezes em 2026-08-08 vale para tela que faz VARIAS chamadas de
 * guardas diferentes: aqui a chamada e uma, de perfil `consulta`, e parti-la em
 * seis so multiplicaria a mesma falha.
 *
 * O CORACAO DA TELA E "Parados ha mais tempo", e nao os cartoes. Os cartoes
 * contam; aquela lista NOMEIA, e traz o numero de dias que faz alguem agir --
 * ha bem parado desde 22/07/2019. Ela vem do servidor ja ordenada pelo mais
 * antigo primeiro, no maximo 10 linhas, e a tela NAO a reordena por padrao.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderEquipamentoDashboard(container, _ctx) {
  let disposed = false;

  // ---- Cartoes -------------------------------------------------------------
  // Nascem em esqueleto e sao SUBSTITUIDOS quando os dados chegam: a quebra por
  // situacao e dinamica (o dominio pode ganhar um degrau), entao nao ha um
  // conjunto fixo de cartoes para atualizar em cima.
  const cartoes = el('div', { className: 'stats-grid' }, [
    createStatsCard({ title: '', value: '', icon: svgIcon(ICONS.layers, 22), loading: true }),
    createStatsCard({ title: '', value: '', icon: svgIcon(ICONS.layers, 22), loading: true }),
    createStatsCard({ title: '', value: '', icon: svgIcon(ICONS.layers, 22), loading: true }),
    createStatsCard({ title: '', value: '', icon: svgIcon(ICONS.layers, 22), loading: true }),
  ]);

  /** Cor e icone de cada situacao, para o cartao dizer a severidade sem ler. */
  const APARENCIA_SITUACAO = {
    [SITUACAO.DISPONIVEL]: { cor: 'success', icone: ICONS.checkCircle },
    [SITUACAO.AFASTADO]: { cor: 'info', icone: ICONS.localShipping },
    [SITUACAO.EM_MANUTENCAO]: { cor: 'warning', icone: ICONS.settings },
    [SITUACAO.INDISPONIVEL]: { cor: 'error', icone: ICONS.warning },
    [SITUACAO.BAIXADO]: { cor: 'primary', icone: ICONS.delete },
  };

  function pintarCartoes(dados) {
    const porSituacao = dados.porSituacao || [];
    // O TOTAL e derivado da propria quebra, e nao um numero novo: somar aqui
    // garante que ele nunca discorde dos cartoes ao lado.
    const total = porSituacao.reduce((soma, s) => soma + Number(s.quantidade || 0), 0);

    const custo = dados.custoManutencao || {};
    const lista = [
      createStatsCard({
        title: 'Bens cadastrados',
        value: formatNumber(total),
        icon: svgIcon(ICONS.layers, 22),
        color: 'primary',
      }),
      ...porSituacao.map((s) => {
        const aparencia = APARENCIA_SITUACAO[Number(s.situacao_id)]
          || { cor: 'info', icone: ICONS.info };
        return createStatsCard({
          title: s.situacao || `Situação ${s.situacao_id}`,
          value: formatNumber(s.quantidade),
          icon: svgIcon(aparencia.icone, 22),
          color: aparencia.cor,
        });
      }),
      createStatsCard({
        // O cartao veio do Resumo Anual: quanto a manutencao de equipamento
        // custou no ano corrente, contando `equipamento.manutencao`.
        title: custo.ano
          ? `Manutenção em ${custo.ano} (${formatNumber(custo.quantidade || 0)} lançamentos)`
          : 'Manutenção no ano',
        value: formatCurrency(custo.valor || 0),
        icon: svgIcon(ICONS.dataUsage, 22),
        color: 'warning',
      }),
      createStatsCard({
        title: 'Descargas solicitadas',
        value: formatNumber(dados.descargasSolicitadas || 0),
        icon: svgIcon(ICONS.localShipping, 22),
        color: 'info',
      }),
    ];

    cartoes.replaceChildren(...lista);
  }

  // ---- Quebras por secao e por tipo ---------------------------------------
  const quebraSecao = el('div', { className: 'equip-quebra' });
  const quebraTipo = el('div', { className: 'equip-quebra' });

  /**
   * Uma quebra de contagem: rotulo, numero e barra proporcional ao maior.
   *
   * A barra e relativa ao MAIOR item, e nao ao total: com 101 de 105 numa
   * secao, todas as outras barras ficariam invisiveis contra o total.
   *
   * @param {HTMLElement} destino
   * @param {Array<Object>} itens
   * @param {(item:Object)=>string} rotuloDe
   */
  function pintarQuebra(destino, itens, rotuloDe) {
    const lista = itens || [];
    if (!lista.length) {
      destino.replaceChildren(el('div', {
        className: 'equip-quebra__vazio',
        textContent: 'Nada a mostrar',
      }));
      return;
    }
    const maior = Math.max(...lista.map(i => Number(i.quantidade || 0)), 1);
    destino.replaceChildren(...lista.map((item) => {
      const quantidade = Number(item.quantidade || 0);
      const largura = Math.max(2, Math.round((quantidade / maior) * 100));
      return el('div', { className: 'equip-quebra__item' }, [
        el('span', { className: 'equip-quebra__rotulo', textContent: rotuloDe(item), title: rotuloDe(item) }),
        el('span', { className: 'equip-quebra__valor', textContent: formatNumber(quantidade) }),
        el('div', { className: 'equip-quebra__barra' }, [
          el('div', {
            className: 'equip-quebra__barra-preenchida',
            style: { width: `${largura}%` },
          }),
        ]),
      ]);
    }));
  }

  const blocosQuebra = el('div', { className: 'equip-painel__quebras' }, [
    el('div', { className: 'equip-painel__quebra' }, [
      el('div', { className: 'equip-painel__quebra-titulo', textContent: 'Por seção detentora' }),
      quebraSecao,
    ]),
    el('div', { className: 'equip-painel__quebra' }, [
      el('div', { className: 'equip-painel__quebra-titulo', textContent: 'Por tipo de equipamento' }),
      quebraTipo,
    ]),
  ]);

  // ---- Parados ha mais tempo ----------------------------------------------
  const tabelaParados = createDataTable({
    columns: [
      {
        key: 'nr_patrimonio',
        label: 'Patrimônio',
        render: (r) => el('span', {
          className: 'equip-patrimonio',
          textContent: r.nr_patrimonio || '-',
        }),
      },
      { key: 'tipo', label: 'Tipo', className: 'data-table__cell--truncate', render: (r) => r.tipo || '-' },
      { key: 'modelo', label: 'Modelo', className: 'data-table__cell--truncate', render: (r) => r.modelo || '-' },
      { key: 'data_inicio', label: 'Parado desde', render: (r) => formatDate(r.data_inicio) },
      {
        key: 'dias',
        label: 'Há',
        // A lista JA vem ordenada pelo mais antigo. `sortable` deixa reordenar,
        // e `sortValue` numerico impede a ordem por texto, em que '999' passa
        // a frente de '2574'.
        sortable: true,
        sortValue: (r) => (r.dias === null || r.dias === undefined ? null : Number(r.dias)),
        render: (r) => chipDias(r.dias),
      },
      {
        key: 'motivo',
        label: 'Motivo',
        className: 'data-table__cell--truncate',
        render: (r) => r.motivo || '-',
      },
    ],
    rows: [],
    loading: true,
    // O servidor ja limitou a 10: paginar 10 linhas em paginas de 5 esconderia
    // metade de uma lista que cabe inteira na tela.
    paginated: false,
    searchable: false,
    emptyMessage: 'Nenhum equipamento indisponível',
    actions: [{
      icon: ICONS.visibility,
      title: 'Abrir a ficha do bem',
      onClick: (r) => { location.hash = `/equipamento/bens/${r.id}`; },
    }],
  });

  const secaoParados = el('div', { className: 'dashboard-section equip-parados' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Parados há mais tempo' }),
    ]),
    el('p', {
      className: 'equip-parados__nota',
      textContent: 'Equipamentos com indisponibilidade em aberto, do mais antigo para o mais recente.',
    }),
    tabelaParados.element,
  ]);

  // ---- Montagem ------------------------------------------------------------
  // O corpo inteiro vive num no proprio para o estado de erro poder tomar o
  // lugar dele e devolve-lo depois (ver `mostrarErro`).
  const corpo = el('div', {}, [cartoes, blocosQuebra, secaoParados]);

  const page = el('div', { className: 'dashboard' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h1', { className: 'dashboard__title', textContent: 'Equipamento' }),
    ]),
    corpo,
  ]);
  container.appendChild(page);

  async function carregar() {
    // O "Tentar de novo" do estado de erro DEVOLVE o conteudo de `corpo` antes
    // de chamar esta funcao (ver `mostrarErro`), entao aqui nao ha o que
    // restaurar: os nos abaixo ja estao de volta na tela.
    tabelaParados.update({ loading: true });
    let dados;
    try {
      dados = await getDashboard();
    } catch (err) {
      if (disposed) return;
      tabelaParados.update({ rows: [], loading: false });
      mostrarErro(corpo, err, carregar);
      showError(err.message || 'Erro ao carregar o painel de equipamentos');
      return;
    }
    if (disposed) return;

    dados = dados || {};
    pintarCartoes(dados);
    pintarQuebra(quebraSecao, dados.porSecao, (i) => i.secao_detentora || `Seção ${i.secao_detentora_id}`);
    pintarQuebra(quebraTipo, dados.porTipo, (i) => i.tipo || `Tipo ${i.tipo_id}`);
    tabelaParados.update({ rows: dados.indisponiveisHa || [], loading: false });
  }

  await carregar();

  return () => {
    disposed = true;
    tabelaParados._cleanup();
  };
}
