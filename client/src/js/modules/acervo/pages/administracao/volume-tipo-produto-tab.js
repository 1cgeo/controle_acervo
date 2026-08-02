import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { permissoes } from '@store/auth-store.js';
import { getTiposProduto } from '@modules/acervo/services/acervo-service.js';
import {
  getVolumeTipoProduto,
  getVolumesArmazenamento,
  excluirVolumeTipoProduto,
} from '@modules/acervo/services/admin-service.js';
import { openVolumeTipoProdutoDialog } from './volume-tipo-produto-dialog.js';

/**
 * Aba "Tipo de produto": qual volume recebe cada tipo, e qual deles e o
 * primario -- o destino do upload pela web.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderVolumeTipoProdutoTab(container) {
  let disposed = false;
  const pode = permissoes('acervo');

  // Guardados para o formulario: ele oferece os dois selects, e recarregar os
  // dominios a cada abertura de modal seria pedir a mesma coisa ao servidor
  // toda vez.
  let tiposProduto = [];
  let volumes = [];

  const novoBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openVolumeTipoProdutoDialog({ tiposProduto, volumes, onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova associação']);

  const table = createDataTable({
    columns: [
      { key: 'tipo_produto', label: 'Tipo de produto', sortable: true },
      { key: 'nome_volume', label: 'Volume', sortable: true },
      {
        key: 'volume',
        label: 'Caminho',
        sortable: true,
        render: (row) => el('code', { textContent: row.volume }),
      },
      {
        key: 'primario',
        label: 'Primário',
        sortable: true,
        render: (row) => (row.primario ? 'Sim' : 'Não'),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhuma associação entre volume e tipo de produto',
    actions: pode.operador ? [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openVolumeTipoProdutoDialog({
          assoc: row, tiposProduto, volumes, onSaved: load,
        }),
      },
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      }] : []),
    ] : [],
  });

  const secao = el('div', {}, [
    el('div', { className: 'admin-aba__topo' }, [
      el('p', {
        className: 'page__subtitle',
        textContent: 'Quais volumes recebem cada tipo de produto. O volume marcado '
          + 'como primário é para onde o upload pela web grava, e existe no máximo '
          + 'um por tipo.',
      }),
      el('div', { className: 'page__actions' }, pode.operador ? [novoBtn] : []),
    ]),
    table.element,
  ]);
  container.appendChild(secao);

  async function load() {
    table.update({ loading: true });
    try {
      // Em paralelo: as tres respostas alimentam a mesma tela, e em serie a aba
      // abriria em tres tempos.
      const [assocs, tipos, vols] = await Promise.all([
        getVolumeTipoProduto(),
        getTiposProduto(),
        getVolumesArmazenamento(),
      ]);
      if (disposed) return;
      tiposProduto = tipos;
      volumes = vols;
      table.update({ rows: assocs, loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar as associações');
    }
  }

  async function handleDelete(row) {
    // O aviso do primário não é enfeite: sem ele, o tipo de produto fica sem
    // destino e o próximo upload pela web falha em outra tela, para outra
    // pessoa. O servidor recusa quando já há produto daquele tipo, mas o
    // catálogo vazio passa.
    const aviso = row.primario
      ? ' Este é o volume PRIMÁRIO do tipo: sem ele, o upload pela web de '
        + `"${row.tipo_produto}" fica sem destino.`
      : '';
    const ok = await confirmDialog({
      title: 'Excluir associação',
      message: `Excluir a associação entre "${row.tipo_produto}" e o volume `
        + `"${row.nome_volume}"?${aviso}`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await excluirVolumeTipoProduto([row.id]);
      showSuccess('Associação excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir a associação');
    }
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      table._cleanup();
    },
    refresh: load,
  };
}
