import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { permissoes } from '@store/auth-store.js';
import {
  getLotes,
  getProjetos,
  getStatusExecucao,
  excluirLotes,
} from '@modules/acervo/services/admin-service.js';
import { openLoteDialog } from './lote-dialog.js';

/**
 * Aba "Lotes": o recorte de trabalho dentro de um projeto, e o que a versao de
 * um produto aponta.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderLotesTab(container) {
  let disposed = false;
  const pode = permissoes('acervo');

  let projetos = [];
  let statusExecucao = [];

  const novoBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openLoteDialog({ projetos, statusExecucao, onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo lote']);

  // Lote sem projeto nao existe (`projeto_id` e obrigatorio no servidor). Com o
  // cadastro de projetos vazio, abrir o formulario so levaria a pessoa ate o
  // botao de salvar para receber um 400. O botao desabilita e diz por que.
  function ajustarBotaoNovo() {
    const semProjeto = projetos.length === 0;
    novoBtn.disabled = semProjeto;
    novoBtn.title = semProjeto
      ? 'Cadastre um projeto antes: todo lote pertence a um projeto'
      : '';
  }

  const table = createDataTable({
    columns: [
      { key: 'nome', label: 'Nome', sortable: true },
      { key: 'pit', label: 'PIT', sortable: true },
      { key: 'projeto', label: 'Projeto', sortable: true },
      {
        key: 'data_inicio',
        label: 'Início',
        sortable: true,
        render: (row) => formatDate(row.data_inicio),
      },
      {
        key: 'data_fim',
        label: 'Fim',
        sortable: true,
        render: (row) => (row.data_fim ? formatDate(row.data_fim) : '-'),
      },
      { key: 'status_execucao', label: 'Status', sortable: true },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum lote cadastrado',
    actions: pode.operador ? [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openLoteDialog({ lote: row, projetos, statusExecucao, onSaved: load }),
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
        textContent: 'Lotes de produção, sempre dentro de um projeto. É o lote que a '
          + 'versão de um produto aponta, e por ele que a produção se agrupa nos '
          + 'relatórios.',
      }),
      el('div', { className: 'page__actions' }, pode.operador ? [novoBtn] : []),
    ]),
    table.element,
  ]);
  container.appendChild(secao);

  async function load() {
    table.update({ loading: true });
    try {
      const [lotes, projs, status] = await Promise.all([
        getLotes(),
        getProjetos(),
        getStatusExecucao(),
      ]);
      if (disposed) return;
      projetos = projs;
      statusExecucao = status;
      ajustarBotaoNovo();
      table.update({ rows: lotes, loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar os lotes');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir lote',
      message: `Excluir o lote "${row.nome}"? A exclusão falha enquanto houver versão `
        + 'vinculada a ele.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await excluirLotes([row.id]);
      showSuccess('Lote excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o lote');
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
