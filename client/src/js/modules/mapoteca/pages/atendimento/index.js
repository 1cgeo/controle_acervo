import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { chip, chipSituacaoPedido } from '@components/status-chip.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import {
  getPedidosEmAberto,
  getImpressaoDoPedido,
  baixarCartaDoPedido,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { openEtiquetaEnvioDialog } from '@modules/mapoteca/pages/pedidos/etiqueta-envio.js';
// O dialogo de registrar impressao mora em pedidos/ e serve as DUAS telas. Ele
// era daqui ate 2026-07-30, quando o detalhe do pedido passou a registrar
// impressao tambem: duas copias divergiriam no texto que evita o erro de somar.
import { openRegistrarImpressaoDialog } from '@modules/mapoteca/pages/pedidos/dialog-impressao.js';
import { openModal } from '@components/modal/modal-base.js';

/**
 * Atender pedidos (#/mapoteca/atendimento): a FILA de trabalho da mapoteca.
 *
 * É tela separada da lista de Pedidos de propósito, e as diferenças não são de
 * enfeite:
 *
 *  - só pedido EM ABERTO (nem concluído, nem cancelado), porque fila é o que
 *    falta fazer;
 *  - SEM o ano da navbar: o pedido de dezembro ainda não atendido é trabalho em
 *    janeiro, e fila que esconde o atrasado não serve de fila;
 *  - ordenada por PRAZO, que é o que decide o dia de quem atende;
 *  - perfil OPERADOR, então não aparece no menu de quem só consulta (o guarda sai
 *    do próprio manifesto, ver modules/registry.js).
 *
 * As três ações que a tela junta são as três que a pessoa faz com o pedido na
 * mão: baixar a carta para imprimir, registrar o que imprimiu e tirar a etiqueta
 * de envio. Antes elas moravam em lugares diferentes (a etiqueta no detalhe do
 * pedido, o registro de impressão só no plugin do QGIS, a carta em nenhum).
 *
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderAtendimento(container) {
  let disposed = false;
  let pedidos = [];
  const cleanups = [];

  const contador = el('span', { className: 'page__meta' });
  const corpo = el('div');

  const root = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('div', {}, [
        el('h1', { className: 'page__title', textContent: 'Atender pedidos' }),
        contador,
      ]),
      el('div', { className: 'page__actions' }, [
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => carregar(),
        }, [svgIcon(ICONS.dataUsage, 16), 'Atualizar']),
      ]),
    ]),
    corpo,
  ]);
  container.appendChild(root);

  // ---------------------------------------------------------------------------
  // Prazo: a coluna que ordena a fila
  // ---------------------------------------------------------------------------
  /**
   * O prazo dito em dias, e não só a data.
   *
   * `dias_para_prazo` vem calculado no BANCO (prazo - CURRENT_DATE), então a tela
   * não faz conta de data e não erra por fuso. Sem prazo não vira "0 dias": vira
   * "sem prazo", que é informação diferente.
   */
  function chipPrazo(p) {
    if (p.prazo == null) return chip('sem prazo', 'default');
    const dias = Number(p.dias_para_prazo);
    if (!Number.isFinite(dias)) return chip(formatDate(p.prazo), 'default');
    if (dias < 0) return chip(`atrasado ${Math.abs(dias)} dia(s)`, 'error');
    if (dias === 0) return chip('vence hoje', 'warning');
    if (dias <= 7) return chip(`${dias} dia(s)`, 'warning');
    return chip(`${dias} dia(s)`, 'info');
  }

  function textoProgresso(p) {
    const itens = Number(p.total_itens) || 0;
    if (itens === 0) return 'sem itens';
    return `${formatNumber(p.itens_impressos)}/${formatNumber(itens)} itens`
      + ` · ${formatNumber(p.quantidade_impressa)}/${formatNumber(p.quantidade_pedida)} cópias`;
  }

  // Downloads em andamento, por uuid do arquivo. O botão de ação da tabela não
  // chega até aqui (o onClick da data-table recebe só a linha), então o guarda
  // contra o clique repetido é este conjunto, e não o `disabled` do botão.
  const baixando = new Set();

  async function baixarCarta(pedidoId, item) {
    if (!item.uuid_arquivo) {
      showError('Este item não tem PDF no acervo para baixar');
      return;
    }
    if (baixando.has(item.uuid_arquivo)) return;
    baixando.add(item.uuid_arquivo);
    try {
      await baixarCartaDoPedido(pedidoId, item.uuid_arquivo, item.arquivo_nome_fisico);
    } catch (err) {
      showError(err.message || 'Não foi possível baixar a carta');
    } finally {
      baixando.delete(item.uuid_arquivo);
    }
  }

  // ---------------------------------------------------------------------------
  // Painel de atendimento de UM pedido
  // ---------------------------------------------------------------------------
  async function abrirAtendimento(pedido) {
    let dados;
    try {
      dados = await getImpressaoDoPedido(pedido.id);
    } catch (err) {
      showError(err.message || 'Erro ao carregar os itens do pedido');
      return;
    }
    if (disposed) return;

    const conteudo = el('div');
    let tabela = null;

    const pintar = (payload) => {
      if (tabela) tabela._cleanup();

      tabela = createDataTable({
        columns: [
          {
            key: 'produto_nome',
            label: 'Carta',
            render: (r) => el('div', {}, [
              el('div', { textContent: r.produto_nome || r.mi || '-' }),
              el('span', { className: 'detail-card__label', textContent: [r.mi, r.escala, r.versao ? `versão ${r.versao}` : null].filter(Boolean).join(' · ') }),
            ]),
          },
          { key: 'tipo_midia_nome', label: 'Mídia', render: (r) => r.tipo_midia_nome || '-' },
          {
            key: 'quantidade',
            label: 'Impressão',
            render: (r) => el('span', { className: 'flex gap-sm' }, [
              el('span', { textContent: `${formatNumber(r.quantidade_impressa)}/${formatNumber(r.quantidade)}` }),
              r.impressao_concluida
                ? chip('completa', 'success')
                : chip(`faltam ${formatNumber(r.quantidade_restante)}`, 'warning'),
            ]),
          },
          {
            key: 'uuid_arquivo',
            label: 'Carta digital',
            render: (r) => r.uuid_arquivo
              ? el('span', { className: 'detail-card__label', textContent: `${r.arquivo_nome_fisico} · ${formatNumber(Number(r.tamanho_mb).toFixed(1))} MB` })
              // Não esconde a linha: quem atende precisa saber que essa carta não
              // tem PDF para imprimir, e não descobrir isso na hora de plotar.
              : chip('sem PDF no acervo', 'error'),
          },
        ],
        rows: payload.itens || [],
        pageSize: 10,
        emptyMessage: 'Este pedido não tem itens cadastrados',
        actions: [
          {
            icon: ICONS.download,
            title: 'Baixar a carta para imprimir',
            onClick: (r) => baixarCarta(pedido.id, r),
          },
          {
            icon: ICONS.print,
            title: 'Registrar impressão',
            onClick: (r) => openRegistrarImpressaoDialog(r, async () => {
              const novo = await getImpressaoDoPedido(pedido.id);
              if (disposed) return;
              pintar(novo);
              carregar();
            }),
          },
        ],
      });

      const imp = payload.impressao || {};
      clearChildren(conteudo);
      conteudo.appendChild(el('div', { className: 'flex gap-sm', style: { marginBottom: 'var(--space-sm)' } }, [
        imp.concluida ? chip('impressão concluída', 'success') : chip('impressão pendente', 'warning'),
        el('span', {
          className: 'detail-card__label',
          textContent: `${formatNumber(imp.itens_concluidos ?? 0)}/${formatNumber(imp.total_itens ?? 0)} itens impressos`,
        }),
        imp.itens_sem_arquivo
          ? chip(`${imp.itens_sem_arquivo} sem PDF`, 'error')
          : null,
      ].filter(Boolean)));
      conteudo.appendChild(tabela.element);
    };

    pintar(dados);

    openModal({
      title: `Atender pedido ${pedido.localizador_pedido || `#${pedido.id}`} — ${pedido.cliente_nome || ''}`,
      content: conteudo,
      width: '900px',
      actions: [
        {
          label: 'Etiqueta de envio',
          variant: 'secondary',
          onClick: () => openEtiquetaEnvioDialog(pedido),
        },
        {
          label: 'Abrir o pedido',
          variant: 'text',
          onClick: ({ close }) => {
            close();
            location.hash = `/mapoteca/pedidos/${pedido.id}`;
          },
        },
        { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
      ],
      onClose: () => { if (tabela) tabela._cleanup(); },
    });
  }

  // ---------------------------------------------------------------------------
  // A fila
  // ---------------------------------------------------------------------------
  function pintarFila() {
    const tabela = createDataTable({
      columns: [
        {
          key: 'prazo',
          label: 'Prazo',
          sortable: true,
          render: (p) => el('div', {}, [
            chipPrazo(p),
            p.prazo ? el('div', { className: 'detail-card__label', textContent: formatDate(p.prazo) }) : null,
          ].filter(Boolean)),
        },
        {
          key: 'cliente_nome',
          label: 'Cliente',
          sortable: true,
          render: (p) => el('div', {}, [
            el('div', { textContent: p.cliente_nome || '-' }),
            el('span', { className: 'detail-card__label', textContent: p.documento_solicitacao || '-' }),
          ]),
        },
        {
          key: 'situacao_pedido_id',
          label: 'Situação',
          render: (p) => chipSituacaoPedido(p.situacao_pedido_id, p.situacao_pedido_nome),
        },
        {
          key: 'total_itens',
          label: 'Impressão',
          render: (p) => el('span', { className: 'detail-card__label', textContent: textoProgresso(p) }),
        },
        {
          key: 'localizador_pedido',
          label: 'Localizador',
          render: (p) => chip(p.localizador_pedido || '-', 'secondary'),
        },
      ],
      rows: pedidos,
      searchable: true,
      pageSize: 15,
      emptyMessage: 'Nenhum pedido em aberto. A fila está limpa.',
      actions: [
        {
          icon: ICONS.print,
          title: 'Atender (imprimir e registrar)',
          onClick: (p) => abrirAtendimento(p),
        },
        {
          icon: ICONS.localShipping,
          title: 'Etiqueta de envio',
          onClick: (p) => openEtiquetaEnvioDialog(p),
        },
        {
          icon: ICONS.description,
          title: 'Abrir o pedido',
          onClick: (p) => { location.hash = `/mapoteca/pedidos/${p.id}`; },
        },
      ],
    });
    cleanups.push(() => tabela._cleanup());

    clearChildren(corpo);
    corpo.appendChild(tabela.element);
  }

  async function carregar() {
    clearChildren(corpo);
    corpo.appendChild(el('div', { className: 'data-table__empty', textContent: 'Carregando a fila...' }));
    try {
      pedidos = await getPedidosEmAberto();
      if (disposed) return;
      const atrasados = pedidos.filter(p => Number(p.dias_para_prazo) < 0).length;
      contador.textContent = atrasados
        ? `${pedidos.length} pedido(s) em aberto, ${atrasados} com prazo vencido`
        : `${pedidos.length} pedido(s) em aberto`;
      pintarFila();
    } catch (err) {
      if (disposed) return;
      pedidos = [];
      contador.textContent = '';
      clearChildren(corpo);
      corpo.appendChild(el('div', { className: 'data-table__empty', textContent: err.message || 'Erro ao carregar a fila' }));
      showError(err.message || 'Erro ao carregar a fila de atendimento');
    }
  }

  await carregar();

  return () => {
    disposed = true;
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch { /* ignore */ }
    }
  };
}
