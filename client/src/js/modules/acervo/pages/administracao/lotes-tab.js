import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
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
  //
  // Vale tambem quando a CARGA FALHA: sem projeto na mao, o formulario abriria
  // com um `<select>` de projeto vazio e um campo obrigatorio impossivel de
  // preencher. O motivo e outro, e por isso a frase e outra.
  function ajustarBotaoNovo(falhou = false) {
    const semProjeto = projetos.length === 0;
    novoBtn.disabled = semProjeto;
    if (!semProjeto) {
      novoBtn.title = '';
      return;
    }
    novoBtn.title = falhou
      ? 'A lista de projetos não carregou. Tente de novo antes de cadastrar um lote.'
      : 'Cadastre um projeto antes: todo lote pertence a um projeto';
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

  // A tabela num container proprio, para o estado de erro nao levar junto o
  // texto de apoio nem o botao "Novo lote".
  const areaTabela = el('div', {}, [table.element]);

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
    areaTabela,
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
      if (!areaTabela.contains(table.element)) areaTabela.replaceChildren(table.element);
      projetos = projs;
      statusExecucao = status;
      ajustarBotaoNovo();
      table.update({ rows: lotes, loading: false });
    } catch (err) {
      if (disposed) return;
      // Estado de ERRO, e nao "Nenhum lote cadastrado": a falha da carga lia-se
      // como cadastro vazio.
      table.update({ rows: [], loading: false });
      // O botao "Novo lote" tambem depende desta carga, e ficava habilitado com
      // a lista de projetos vazia.
      ajustarBotaoNovo(true);
      mostrarErro(areaTabela, err, load);
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
