import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import * as svc from '@modules/orcamento/services/orcamento-service.js';
import { getAno, onAnoChange } from '@modules/orcamento/store/year-store.js';
import { permissoes } from '@store/auth-store.js';
import { openDfdDialog } from './dfd-dialog.js';

const MAX_OBJETO = 80;

function truncar(texto, limite) {
  if (!texto) return '-';
  const str = String(texto);
  return str.length > limite ? `${str.slice(0, limite)}...` : str;
}

/**
 * Lista de DFD (#/dfd). Documento de Formalizacao da Demanda, com itens.
 * O conjunto de DFDs do ano de contexto e o "PCA do ano".
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderDfdList(container, _ctx) {
  let disposed = false;
  // Criar e editar DFD sao operador; excluir e gerente. Baixar o anexo e
  // consulta e fica para todo mundo.
  const pode = permissoes('orcamento');
  // Dominios e selects compartilhados pelos dialogs (carregados uma vez).
  let dominios = {
    grauPrioridade: [],
    tipoItem: [],
  };

  const resumo = el('p', { className: 'page__subtitle', textContent: '' });

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openDfdDialog({ dominios, onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo DFD']);

  const table = createDataTable({
    columns: [
      { key: 'numero', label: 'Número', sortable: true },
      { key: 'ano', label: 'Ano', sortable: true },
      { key: 'rotulo', label: 'Rótulo', render: (row) => row.rotulo || '-' },
      {
        key: 'objeto',
        label: 'Objeto',
        className: 'truncate',
        render: (row) => truncar(row.objeto, MAX_OBJETO),
      },
      {
        key: 'valor_estimado',
        label: 'Valor estimado',
        sortable: true,
        render: (row) => formatCurrency(row.valor_estimado),
      },
      {
        key: 'consta_pca',
        label: 'Consta PCA',
        render: (row) => (row.consta_pca ? 'Sim' : 'Não'),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum DFD cadastrado',
    actions: [
      {
        icon: ICONS.download,
        title: 'Baixar anexo (PDF)',
        visible: (row) => row.arquivo_id != null,
        onClick: (row) => svc.downloadArquivo(row.arquivo_id, row.arquivo_nome)
          .catch((err) => showError(err.message || 'Erro ao baixar anexo')),
      },
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => handleEdit(row),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      }] : []),
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('div', {}, [
        el('h1', { className: 'page__title', textContent: 'DFD' }),
        resumo,
      ]),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    table.element,
  ]);
  container.appendChild(page);

  function atualizarResumo(dfds) {
    const total = (dfds || []).reduce((soma, d) => soma + (Number(d.valor_estimado) || 0), 0);
    const n = (dfds || []).length;
    resumo.textContent = `PCA ${getAno()}: ${n} ${n === 1 ? 'DFD' : 'DFDs'}, total ${formatCurrency(total)}`;
  }

  async function load() {
    table.update({ loading: true });
    try {
      const [dfds, grauPrioridade, tipoItem] = await Promise.all([
        svc.getDfds(getAno()),
        svc.getGrauPrioridade(),
        svc.getTipoItemDfd(),
      ]);
      if (disposed) return;
      dominios = { grauPrioridade, tipoItem };
      atualizarResumo(dfds);
      table.update({ rows: dfds, loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar DFD');
    }
  }

  async function handleEdit(row) {
    try {
      const dfd = await svc.getDfd(row.id);
      if (disposed) return;
      openDfdDialog({ dfd, dominios, onSaved: load });
    } catch (err) {
      showError(err.message || 'Erro ao carregar DFD');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir DFD',
      message: `Tem certeza que deseja excluir o DFD ${row.numero}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await svc.deleteDfd(row.id);
      showSuccess('DFD excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir DFD');
    }
  }

  const offAno = onAnoChange(() => load());

  await load();

  return () => {
    disposed = true;
    offAno();
    table._cleanup();
  };
}
