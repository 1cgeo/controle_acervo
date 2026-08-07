import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { showSuccess, showError } from '@utils/toast.js';
import { formatCurrency, formatDate, toNumber } from '@utils/format.js';
import { permissoes } from '@store/auth-store.js';
import {
  getRecolhimentos,
  deleteRecolhimento,
} from '@modules/orcamento/services/orcamento-service.js';
import { openRecolhimentoDialog } from './recolhimento-dialog.js';

/**
 * Os recolhimentos de UMA nota de crédito: listar, acrescentar e remover.
 *
 * O TOTAL DESTA LISTA É O "Valor recolhido" DA NC. Desde a 1.40.0 não há coluna
 * `valor_recolhido`: o número que a lista de NCs, o CLI e as subseções 4.1, 4.2
 * e 4.7 do RPCMTec mostram é a soma das linhas daqui. Por isso o rodapé escreve
 * o total: quem abre este diálogo precisa ver que ele fecha com a coluna da tela
 * anterior.
 *
 * @param {Object} options
 * @param {Object} options.nc - a linha da NC (id, numero, cod_nd, ug_emitente, ano)
 * @param {Function} [options.onChanged] - chamado quando a lista muda, para a
 *   tela de trás recarregar o recolhido e o saldo
 */
export async function openRecolhimentosDialog({ nc, onChanged = null } = {}) {
  const pode = permissoes('orcamento');

  // O número sozinho NÃO identifica a NC: o mesmo número e a mesma ND existem
  // para UGs emitentes diferentes. O título nomeia as três partes da chave.
  const rotuloNc = [nc.numero, nc.cod_nd, nc.ug_emitente ? `UG ${nc.ug_emitente}` : null]
    .filter(Boolean)
    .join(' / ');

  const totalValue = el('strong', { textContent: '-' });
  const rodape = el('div', {
    className: 'nc-summary__item',
    style: { marginTop: 'var(--space-md, 16px)' },
  }, [
    el('span', { textContent: 'Total recolhido desta NC: ' }),
    totalValue,
  ]);

  const table = createDataTable({
    columns: [
      { key: 'numero', label: 'Documento' },
      {
        key: 'data_emissao',
        label: 'Emissão',
        render: (row) => formatDate(row.data_emissao),
      },
      {
        key: 'cod_nd',
        label: 'ND da anulação',
        render: (row) => (row.nd_nome ? `${row.cod_nd} - ${row.nd_nome}` : (row.cod_nd ?? '-')),
      },
      {
        key: 'ug_emitente',
        label: 'UG emitente',
        render: (row) => (row.ug_nome
          ? `${row.ug_emitente} - ${row.ug_nome}`
          : (row.ug_emitente ?? '-')),
      },
      {
        key: 'valor',
        label: 'Valor',
        sortable: true,
        sortValue: (row) => toNumber(row.valor),
        render: (row) => formatCurrency(row.valor),
      },
      {
        // Quantos documentos estão anexados. O anexo é a prova de que o
        // recolhimento existiu no SIAFI; sem esta coluna, a linha sem anexo é
        // indistinguível da com anexo até alguém abrir uma por uma.
        key: 'qtd_anexos',
        label: 'Anexos',
        render: (row) => (Number(row.qtd_anexos || 0) > 0 ? String(row.qtd_anexos) : '-'),
      },
    ],
    rows: [],
    // Sem paginação e sem busca: a lista é de UMA NC, e em 2026 a maior tinha
    // duas linhas. Paginar duas linhas só esconde o rodapé do total.
    paginated: false,
    searchable: false,
    loading: true,
    emptyMessage: 'Nenhum recolhimento lançado para esta nota de crédito',
    actions: [
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openRecolhimentoDialog({
          notaCreditoId: nc.id,
          recolhimentoId: row.id,
          ano: row.ano,
          onSaved: () => recarregarAposEscrita(),
        }),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => remover(row),
      }] : []),
    ],
  });

  const novoBtn = el('button', {
    className: 'btn btn--primary btn--sm',
    type: 'button',
    onClick: () => openRecolhimentoDialog({
      notaCreditoId: nc.id,
      ano: nc.ano,
      onSaved: () => recarregarAposEscrita(),
    }),
  }, [svgIcon(ICONS.add, 16), ' Novo recolhimento']);

  const content = el('div', {}, [
    el('div', {
      className: 'page__actions',
      style: { marginBottom: 'var(--space-md, 16px)' },
    }, pode.operador ? [novoBtn] : []),
    table.element,
    rodape,
  ]);

  /**
   * Carrega a lista e refaz o total.
   *
   * O TOTAL SAI DAS LINHAS QUE ESTÃO NA TELA, e não de uma segunda chamada: dois
   * números da mesma janela lidos de fontes diferentes ficam livres para
   * discordar. No erro ele vira '-', nunca "R$ 0,00": lista que não carregou tem
   * total DESCONHECIDO, e zero afirmaria que nada foi devolvido.
   *
   * @param {boolean} [mudou] - houve escrita, e a tela de trás precisa recarregar
   *   o recolhido e o saldo. A carga de ABERTURA não muda nada, e avisar ali
   *   custaria uma releitura da lista inteira de NCs a cada clique no ícone.
   */
  async function recarregar(mudou = false) {
    table.update({ loading: true });
    try {
      const linhas = await getRecolhimentos({ nota_credito_id: nc.id }) || [];
      const total = linhas.reduce((soma, l) => soma + toNumber(l.valor), 0);
      totalValue.textContent = formatCurrency(total);
      table.update({ rows: linhas, loading: false });
    } catch (err) {
      totalValue.textContent = '-';
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar os recolhimentos');
    }
    if (mudou && onChanged) onChanged();
  }

  /** Recarrega DEPOIS de uma escrita, avisando a tela de trás. */
  const recarregarAposEscrita = () => recarregar(true);

  async function remover(row) {
    const ok = await confirmDialog({
      title: 'Excluir recolhimento',
      message: `Excluir o recolhimento ${row.numero} de ${formatCurrency(row.valor)}? `
        + 'Os anexos dele saem junto, e esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteRecolhimento(row.id);
      showSuccess('Recolhimento excluído com sucesso');
      await recarregarAposEscrita();
    } catch (err) {
      showError(err.message || 'Erro ao excluir recolhimento');
    }
  }

  openModal({
    title: `Recolhimentos da NC ${rotuloNc}`,
    content,
    width: '860px',
    actions: [
      { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
    ],
    onClose: () => table._cleanup(),
  });

  await recarregar();
}
