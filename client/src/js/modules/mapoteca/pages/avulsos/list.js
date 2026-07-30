import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getProdutosAvulsos,
  getReconciliacaoAvulsos,
  deleteProdutosAvulsos,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { permissoes } from '@store/auth-store.js';
import { openAvulsoDialog } from './avulso-dialog.js';

/**
 * Produtos avulsos (#/mapoteca/avulsos).
 *
 * Avulso é o que a mapoteca imprime SEM ser produto do acervo: papel
 * quadriculado, carta de outro CGEO, impresso de ocasião. O corte é de POSSE,
 * não de formato.
 *
 * A faixa de reconciliação no topo não é enfeite. O avulso aceita MI de
 * propósito (a carta de outra área tem MI legítimo), então nenhuma trava de
 * banco impede alguém de registrar como avulso o que deveria estar catalogado.
 * Esta lista é o que ocupa o lugar daquela trava, e por isso fica em cima, e
 * não numa aba escondida.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderAvulsosList(container, _ctx) {
  let disposed = false;
  const pode = permissoes('mapoteca');

  const alerta = el('div', { className: 'hidden' });

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
    onClick: () => openAvulsoDialog({ onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo produto avulso']);

  const table = createDataTable({
    columns: [
      { key: 'nome', label: 'Nome', sortable: true },
      { key: 'mi', label: 'MI', render: (row) => row.mi || '-' },
      { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
      { key: 'tipo_produto_nome', label: 'Tipo', render: (row) => row.tipo_produto_nome || '-' },
      {
        key: 'escala',
        label: 'Escala',
        render: (row) => (row.denominador_escala_especial
          ? `1:${row.denominador_escala_especial}`
          : (row.tipo_escala_nome || '-')),
      },
      {
        key: 'vezes_pedido',
        label: 'Vezes impresso',
        sortable: true,
        // O que se imprime toda semana é produto, não impresso de ocasião. Esta
        // coluna é o sinal de que talvez devesse estar catalogado no acervo.
        render: (row) => formatNumber(row.vezes_pedido),
      },
      { key: 'ativo', label: 'Ativo', render: (row) => (row.ativo ? 'Sim' : 'Não') },
    ],
    rows: [],
    searchable: true,
    selectable: pode.gerente,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum produto avulso cadastrado',
    onSelectionChange: (selected) => {
      bulkDeleteBtn.disabled = selected.length === 0;
      bulkDeleteBtn.textContent = selected.length > 0
        ? `Excluir selecionados (${selected.length})`
        : 'Excluir selecionados';
    },
    actions: pode.gerente ? [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openAvulsoDialog({ avulso: row, onSaved: load }),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete([row]),
      },
    ] : [],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Produtos avulsos' }),
      el('div', { className: 'page__actions' }, pode.gerente ? [bulkDeleteBtn, newBtn] : []),
    ]),
    el('p', {
      className: 'page__subtitle',
      textContent:
        'O que a mapoteca imprime sem ser produto do acervo: papel quadriculado, '
        + 'carta de outro CGEO, impresso de ocasião. Folha nossa ainda não catalogada '
        + 'não entra aqui, e sim no acervo.',
    }),
    alerta,
    table.element,
  ]);
  container.appendChild(page);

  async function carregarReconciliacao() {
    try {
      const dados = await getReconciliacaoAvulsos();
      if (disposed) return;
      if (!dados || !dados.length) {
        alerta.classList.add('hidden');
        return;
      }
      alerta.className = 'alert alert--warning';
      alerta.replaceChildren(
        el('strong', { textContent: `${dados.length} produto(s) avulso(s) com MI que já existe no acervo. ` }),
        el('span', {
          textContent: 'Se a folha é nossa, o lugar dela é o acervo, e o item do pedido '
            + 'deveria apontar a versão catalogada: ',
        }),
        el('span', { textContent: dados.map(d => `${d.nome} (MI ${d.mi})`).join('; ') }),
      );
    } catch {
      // A reconciliação é um aviso, não a função da tela: se ela falhar, a
      // listagem tem de continuar aparecendo.
      if (!disposed) alerta.classList.add('hidden');
    }
  }

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getProdutosAvulsos();
      if (disposed) return;
      table.update({
        rows: (dados || []).map(r => ({ ...r, vezes_pedido: Number(r.vezes_pedido) })),
        loading: false,
      });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar os produtos avulsos');
    }
    await carregarReconciliacao();
  }

  async function handleDelete(items) {
    if (!items.length) return;
    const emUso = items.filter(i => Number(i.vezes_pedido) > 0);
    if (emUso.length) {
      // O servidor recusa de qualquer forma; dizer aqui poupa a viagem e
      // explica a saída certa.
      showError(
        `Estes já foram usados em pedido e não podem ser excluídos: `
        + `${emUso.map(i => i.nome).join(', ')}. Desmarque "Ativo" para tirar de circulação.`
      );
      return;
    }
    const nomes = items.map(i => i.nome).join(', ');
    const ok = await confirmDialog({
      title: items.length > 1 ? `Excluir ${items.length} produtos avulsos` : 'Excluir produto avulso',
      message: `Tem certeza que deseja excluir: ${nomes}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteProdutosAvulsos(items.map(i => i.id));
      showSuccess(items.length > 1
        ? 'Produtos avulsos excluídos com sucesso'
        : 'Produto avulso excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir produtos avulsos');
    }
  }

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
