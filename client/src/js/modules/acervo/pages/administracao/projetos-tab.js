import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
import { permissoes } from '@store/auth-store.js';
import {
  getProjetos,
  getStatusExecucao,
  excluirProjetos,
} from '@modules/acervo/services/admin-service.js';
import { openProjetoDialog } from './projeto-dialog.js';

/**
 * Aba "Projetos": o cadastro que agrupa os lotes, e por eles as versoes.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderProjetosTab(container) {
  let disposed = false;
  const pode = permissoes('acervo');

  let statusExecucao = [];

  const novoBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openProjetoDialog({ statusExecucao, onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo projeto']);

  const table = createDataTable({
    columns: [
      { key: 'nome', label: 'Nome', sortable: true },
      { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
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
    emptyMessage: 'Nenhum projeto cadastrado',
    actions: pode.operador ? [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openProjetoDialog({ projeto: row, statusExecucao, onSaved: load }),
      },
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      }] : []),
    ] : [],
  });

  // A tabela num container proprio, para o estado de erro nao levar junto o
  // texto de apoio nem o botao "Novo projeto".
  const areaTabela = el('div', {}, [table.element]);

  const secao = el('div', {}, [
    el('div', { className: 'admin-aba__topo' }, [
      el('p', {
        className: 'page__subtitle',
        textContent: 'Projetos do acervo. Cada lote pertence a um projeto, e é pelo '
          + 'lote que a versão de um produto se liga ao trabalho que a produziu.',
      }),
      el('div', { className: 'page__actions' }, pode.operador ? [novoBtn] : []),
    ]),
    areaTabela,
  ]);
  container.appendChild(secao);

  async function load() {
    table.update({ loading: true });
    try {
      const [projetos, status] = await Promise.all([getProjetos(), getStatusExecucao()]);
      if (disposed) return;
      if (!areaTabela.contains(table.element)) areaTabela.replaceChildren(table.element);
      statusExecucao = status;
      novoBtn.disabled = false;
      novoBtn.title = '';
      table.update({ rows: projetos, loading: false });
    } catch (err) {
      if (disposed) return;
      // Estado de ERRO, e nao "Nenhum projeto cadastrado": a falha da carga
      // lia-se como cadastro vazio.
      table.update({ rows: [], loading: false });
      // "Status de execucao" e obrigatorio no formulario e vem desta carga: com
      // ela falhando, abrir o dialogo daria um campo impossivel de preencher.
      novoBtn.disabled = true;
      novoBtn.title = 'A lista de status não carregou. Tente de novo antes de cadastrar.';
      mostrarErro(areaTabela, err, load);
      showError(err.message || 'Erro ao carregar os projetos');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir projeto',
      message: `Excluir o projeto "${row.nome}"? A exclusão falha enquanto houver `
        + 'lote vinculado a ele.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await excluirProjetos([row.id]);
      showSuccess('Projeto excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o projeto');
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
