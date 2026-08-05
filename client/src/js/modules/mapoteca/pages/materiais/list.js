import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatBoolean, formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { badgeAbaixoMinimo } from '@components/status-chip.js';
import { getTiposMaterial, deleteTiposMaterial } from '@modules/mapoteca/services/mapoteca-service.js';
import { permissoes } from '@store/auth-store.js';
import { criarAvisoDeErro } from '../aviso-carga.js';
import { openMaterialDialog } from './material-dialog.js';

/**
 * Tipos de material list page (#/materiais).
 *
 * Tipo de material e cadastro estruturante: criar, editar e excluir sao gerente
 * no servidor. Quem tem operador lanca CONSUMO (outra tela), nao mexe no
 * catalogo.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderMateriaisList(container, _ctx) {
  let disposed = false;
  const pode = permissoes('mapoteca');

  const bulkDeleteBtn = el('button', {
    className: 'btn btn--danger',
    type: 'button',
    textContent: 'Excluir selecionados',
    onClick: () => handleDelete(table.getSelected()),
  });
  bulkDeleteBtn.disabled = true;

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openMaterialDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo tipo de material']);

  const table = createDataTable({
    columns: [
      {
        key: 'nome',
        label: 'Nome',
        sortable: true,
        render: (row) => {
          const cell = el('span', {
            style: { display: 'inline-flex', alignItems: 'center', gap: '8px', flexWrap: 'wrap' },
          }, [
            el('a', { href: `#/mapoteca/materiais/${row.id}`, textContent: row.nome }),
          ]);
          if (row.abaixo_minimo) cell.appendChild(badgeAbaixoMinimo());
          return cell;
        },
      },
      { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
      {
        key: 'estoque_total',
        label: 'Estoque total',
        sortable: true,
        render: (row) => formatNumber(row.estoque_total),
      },
      {
        key: 'localizacoes_armazenadas',
        label: 'Localizações',
        sortable: true,
        render: (row) => formatNumber(row.localizacoes_armazenadas),
      },
      {
        key: 'estoque_minimo',
        label: 'Estoque mínimo',
        sortable: true,
        render: (row) => formatNumber(row.estoque_minimo),
      },
      {
        key: 'meta_anual',
        label: 'Meta anual',
        sortable: true,
        render: (row) => formatNumber(row.meta_anual),
      },
      { key: 'ativo', label: 'Ativo', render: (row) => formatBoolean(row.ativo) },
    ],
    rows: [],
    searchable: true,
    // A selecao existe SO para a exclusao em lote.
    selectable: pode.gerente,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum tipo de material cadastrado',
    onSelectionChange: (selected) => {
      bulkDeleteBtn.disabled = selected.length === 0;
      bulkDeleteBtn.textContent = selected.length > 0
        ? `Excluir selecionados (${selected.length})`
        : 'Excluir selecionados';
    },
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver detalhes',
        onClick: (row) => { location.hash = `/mapoteca/materiais/${row.id}`; },
      },
      ...(pode.gerente ? [
        {
          icon: ICONS.edit,
          title: 'Editar',
          onClick: (row) => openMaterialDialog({ material: row, onSaved: load }),
        },
        {
          icon: ICONS.delete,
          title: 'Excluir',
          variant: 'danger',
          onClick: (row) => handleDelete([row]),
        },
      ] : []),
    ],
  });

  const aviso = criarAvisoDeErro(table, load);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Tipos de Material' }),
      el('div', { className: 'page__actions' }, pode.gerente ? [bulkDeleteBtn, newBtn] : []),
    ]),
    aviso.element,
  ]);
  container.appendChild(page);

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getTiposMaterial();
      if (disposed) return;
      const rows = dados.map(r => ({
        ...r,
        estoque_total: Number(r.estoque_total),
        localizacoes_armazenadas: Number(r.localizacoes_armazenadas),
        estoque_minimo: r.estoque_minimo === null ? null : Number(r.estoque_minimo),
        meta_anual: r.meta_anual === null ? null : Number(r.meta_anual),
      }));
      table.update({ rows, loading: false });
      aviso.ok();
    } catch (err) {
      if (disposed) return;
      table.update({ loading: false });
      aviso.falhou(err.message || 'Erro ao carregar tipos de material');
      showError(err.message || 'Erro ao carregar tipos de material');
    }
  }

  async function handleDelete(items) {
    if (!items.length) return;
    const nomes = items.map(m => m.nome).join(', ');
    const ok = await confirmDialog({
      title: items.length > 1
        ? `Excluir ${items.length} tipos de material`
        : 'Excluir tipo de material',
      message: `Tem certeza que deseja excluir: ${nomes}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteTiposMaterial(items.map(m => m.id));
      showSuccess(items.length > 1
        ? 'Tipos de material excluídos com sucesso'
        : 'Tipo de material excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir tipos de material');
    }
  }

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
