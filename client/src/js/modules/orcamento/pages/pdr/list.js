import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import { createFileAttachment } from '@modules/orcamento/components/file-attachment.js';
import { getAno, onAnoChange } from '@modules/orcamento/store/year-store.js';
import { getPdrItens, deletePdrItem } from '@modules/orcamento/services/orcamento-service.js';
import { permissoes } from '@store/auth-store.js';
import { openPdrItemDialog } from './item-dialog.js';

/**
 * Tela do PDR (#/pdr). O PDR e o CONJUNTO DOS SEUS ITENS amarrados no ano de
 * contexto global (navbar): esta pagina lista os itens (CRUD) e mostra um
 * cartao-resumo com os totais calculados a partir dos itens carregados.
 * Recarrega ao trocar o ano de contexto.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderPdrList(container, _ctx) {
  let disposed = false;
  const pode = permissoes('orcamento');

  const title = el('h1', { className: 'page__title', textContent: `PDR ${getAno()}` });

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openPdrItemDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo item']);

  // Anexos do PDR: ficam no nivel do ano (nao do item; o PDR nao tem cabecalho).
  // Abre um modal com a lista de arquivos (XLSX/PDF) do ano selecionado.
  const anexosBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => {
      const ano = getAno();
      const anexo = createFileAttachment({
        mode: 'multi',
        vinculo: { pdr_ano: ano },
        accept: '.pdf,.xlsx,.xls,.csv,.ods',
        label: 'Arquivos originais do PDR (planilhas, PDFs)',
      });
      openModal({
        title: `Anexos do PDR ${ano}`,
        content: anexo.element,
        width: '600px',
        actions: [{ label: 'Fechar', variant: 'text', onClick: ({ close }) => close() }],
      });
    },
  }, [svgIcon(ICONS.description, 16), 'Anexos do PDR']);

  // ---- Cartao-resumo (totais calculados a partir dos itens carregados) ----
  const totalSolicitadoValue = el('div', { className: 'pdr-summary__value', style: { fontWeight: '600' } });
  const totalAutorizadoValue = el('div', { className: 'pdr-summary__value', style: { fontWeight: '600' } });
  const gnd3AutorizadoValue = el('div', { className: 'pdr-summary__value', style: { fontWeight: '600' } });
  const gnd4AutorizadoValue = el('div', { className: 'pdr-summary__value', style: { fontWeight: '600' } });

  function summaryItem(label, valueEl) {
    return el('div', { className: 'pdr-summary__item' }, [
      el('div', {
        className: 'pdr-summary__label',
        textContent: label,
        style: { fontSize: 'var(--font-size-xs, 0.75rem)', color: 'var(--text-secondary)' },
      }),
      valueEl,
    ]);
  }

  const summaryCard = el('div', {
    className: 'pdr-summary',
    style: {
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md, 8px)',
      padding: 'var(--space-lg, 24px)',
      marginBottom: 'var(--space-md, 16px)',
    },
  }, [
    el('div', {
      className: 'pdr-summary__grid',
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 'var(--space-md, 16px)',
      },
    }, [
      summaryItem('Total solicitado', totalSolicitadoValue),
      summaryItem('Total autorizado', totalAutorizadoValue),
      summaryItem('GND3 autorizado', gnd3AutorizadoValue),
      summaryItem('GND4 autorizado', gnd4AutorizadoValue),
    ]),
  ]);

  function renderSummary(itens) {
    let totalSolicitado = 0;
    let totalAutorizado = 0;
    let gnd3Autorizado = 0;
    let gnd4Autorizado = 0;
    for (const item of itens) {
      const sol = Number(item.valor_solicitado);
      const aut = Number(item.valor_autorizado);
      if (!isNaN(sol)) totalSolicitado += sol;
      if (!isNaN(aut)) {
        totalAutorizado += aut;
        if (Number(item.gnd) === 3) gnd3Autorizado += aut;
        if (Number(item.gnd) === 4) gnd4Autorizado += aut;
      }
    }
    totalSolicitadoValue.textContent = formatCurrency(totalSolicitado);
    totalAutorizadoValue.textContent = formatCurrency(totalAutorizado);
    gnd3AutorizadoValue.textContent = formatCurrency(gnd3Autorizado);
    gnd4AutorizadoValue.textContent = formatCurrency(gnd4Autorizado);
  }
  renderSummary([]);

  const table = createDataTable({
    columns: [
      { key: 'item_label', label: 'Rótulo', sortable: true, render: (row) => row.item_label || '-' },
      // A descricao e o que identifica o item para uma pessoa. Ela existe em 36
      // de 36 itens reais e nao aparecia em tela nenhuma.
      {
        key: 'descricao',
        label: 'Descrição',
        className: 'data-table__cell--truncate',
        render: (row) => row.descricao || '-',
      },
      {
        key: 'cod_nd',
        label: 'ND',
        render: (row) => (row.nd_nome ? `${row.cod_nd} - ${row.nd_nome}` : (row.cod_nd ?? '-')),
      },
      {
        key: 'meta_numero',
        label: 'Meta',
        render: (row) => {
          if (row.meta_numero === null || row.meta_numero === undefined) return '-';
          return row.meta_item ? `${row.meta_numero} (${row.meta_item})` : String(row.meta_numero);
        },
      },
      { key: 'gnd', label: 'GND', sortable: true, render: (row) => (row.gnd ?? '-') },
      {
        key: 'valor_solicitado',
        label: 'Solicitado',
        sortable: true,
        render: (row) => formatCurrency(row.valor_solicitado),
      },
      {
        key: 'valor_autorizado',
        label: 'Autorizado',
        sortable: true,
        render: (row) => formatCurrency(row.valor_autorizado),
      },
      { key: 'observacao', label: 'Observação', render: (row) => row.observacao || '-' },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum item de PDR cadastrado',
    // O PDR e a EXCECAO do orcamento: aqui criar e editar tambem sao gerente,
    // e nao operador como no resto do modulo. Um operador via os botoes, era
    // recusado pelo servidor e (antes de 2026-07-28) ainda levava logout.
    actions: pode.gerente ? [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openPdrItemDialog({ item: row, onSaved: load }),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      },
    ] : [],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      title,
      // Os anexos do PDR tem gate proprio dentro do widget: quem consulta abre
      // o modal e baixa, sem anexar nem remover.
      el('div', { className: 'page__actions' }, [
        anexosBtn,
        ...(pode.gerente ? [newBtn] : []),
      ]),
    ]),
    summaryCard,
    table.element,
  ]);
  container.appendChild(page);

  async function load() {
    const ano = getAno();
    title.textContent = `PDR ${ano}`;
    table.update({ loading: true });
    try {
      const dados = await getPdrItens(ano);
      if (disposed) return;
      const itens = dados || [];
      renderSummary(itens);
      table.update({ rows: itens, loading: false });
    } catch (err) {
      if (disposed) return;
      renderSummary([]);
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar os itens do PDR');
    }
  }

  async function handleDelete(row) {
    const rotulo = row.item_label || row.cod_nd || `#${row.id}`;
    const ok = await confirmDialog({
      title: 'Excluir item do PDR',
      message: `Tem certeza que deseja excluir o item ${rotulo}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePdrItem(row.id);
      showSuccess('Item do PDR excluído com sucesso');
      await load();
    } catch (err) {
      // O backend bloqueia com 409 quando ha NC vinculada; mostra a mensagem.
      showError(err.message || 'Erro ao excluir item do PDR');
    }
  }

  const offAno = onAnoChange(() => { if (!disposed) load(); });

  await load();

  return () => {
    disposed = true;
    offAno();
    table._cleanup();
  };
}
