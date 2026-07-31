import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getMetasPit,
  getAnosMetaPit,
  deleteMetaPit,
  codigoMetaPit,
} from '@services/plataforma-service.js';
import { isAdmin } from '@store/auth-store.js';
import { openMetaDialog } from './meta-dialog.js';

/**
 * Metas do PIT (#/metas). Tela de PLATAFORMA, como a de usuarios.
 *
 * Ela morou dentro do modulo orcamento ate 2026-07-31, e saiu porque o PIT nao
 * e artefato orcamentario: e o plano anual da Divisao. O orcamento amarra a NC e
 * o item do PDR a meta que financiam, e a mapoteca amarra o pedido de impressao
 * a meta que ele cumpre. Enquanto a tela era do orcamento, quem so tinha perfil
 * na mapoteca nao conseguia nem VER a lista.
 *
 * LER e de qualquer pessoa logada. ESCREVER e do administrador global: o PIT
 * muda uma vez por ano, vem de documento assinado, e errar nele contamina os
 * tres modulos. O backend cobra a regra; aqui so escondemos o que nao adianta
 * oferecer.
 *
 * O ANO tem filtro PROPRIO no topo, e nao o seletor da navbar: aquele e do
 * modulo orcamento e some quando a pessoa troca de modulo. Os anos vem de
 * GET /metas/anos, mais o ano corrente, para cadastrar o exercicio novo.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderMetasList(container, _ctx) {
  let disposed = false;
  const podeEscrever = isAdmin();
  let anoSelecionado = new Date().getFullYear();

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openMetaDialog({ ano: anoSelecionado, onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova meta']);

  const anoFilter = createSelectField({
    label: 'Ano',
    options: [],
    placeholder: 'Todos os anos',
    value: anoSelecionado,
    onChange: (valor) => {
      anoSelecionado = valor === null ? null : Number(valor);
      load();
    },
  });

  const table = createDataTable({
    columns: [
      { key: 'ano', label: 'Ano', sortable: true },
      {
        key: 'codigo',
        label: 'Meta',
        sortable: true,
        render: (row) => codigoMetaPit(row),
      },
      { key: 'descricao', label: 'Descrição', render: (row) => row.descricao || '-' },
    ],
    rows: [],
    searchable: true,
    pageSize: 50,
    loading: true,
    emptyMessage: 'Nenhuma meta cadastrada',
    actions: podeEscrever ? [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openMetaDialog({ meta: row, onSaved: load }),
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
      el('h1', { className: 'page__title', textContent: 'Metas do PIT' }),
      el('div', { className: 'page__actions' }, podeEscrever ? [newBtn] : []),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [anoFilter.element]),
    table.element,
  ]);
  container.appendChild(page);

  async function loadAnos() {
    let anos = [];
    try {
      anos = await getAnosMetaPit();
    } catch (err) {
      if (disposed) return;
      // Sem a lista de anos a tela continua util: o filtro nasce com o ano
      // corrente e a listagem responde. Nao vale interromper por isto.
      anos = [];
    }
    if (disposed) return;
    const corrente = new Date().getFullYear();
    const todos = [...new Set([corrente, ...(anos || []).map(Number)])].sort((a, b) => b - a);
    anoFilter.setOptions(todos.map(a => ({ value: a, label: String(a) })));
    anoFilter.setValue(anoSelecionado);
  }

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getMetasPit(anoSelecionado);
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar as metas do PIT');
    }
  }

  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir meta',
      message: `Tem certeza que deseja excluir a meta ${codigoMetaPit(row)} de ${row.ano}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteMetaPit(row.id);
      showSuccess('Meta excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir meta');
    }
  }

  await loadAnos();
  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
