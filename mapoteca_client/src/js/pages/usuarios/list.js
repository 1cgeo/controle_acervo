import { el, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  getUsuarios,
  getUsuariosAuthServer,
  importarUsuarios,
  sincronizarUsuarios,
  atualizarUsuario,
  getModulos,
  getTiposPerfil,
} from '@services/usuario-service.js';

// A tela mostra os DOIS módulos do SCA lado a lado, porque a mesma pessoa costuma
// ter níveis diferentes em cada um (ex.: opera a mapoteca e só consulta o acervo).
const AJUDA = {
  acervo: {
    1: 'Consulta: busca, situação geral, dashboard e download.',
    2: 'Operador: catalogar produto, versão, arquivo, volume e projeto.',
    3: 'Gerente: tudo do operador, mais excluir e as ferramentas de diagnóstico.',
  },
  mapoteca: {
    1: 'Consulta: dashboard e ver pedidos.',
    2: 'Operador: imprimir, registrar impressão e dar baixa em material.',
    3: 'Gerente: cadastrar pedido, cliente, prazo, entrega e anexo, e excluir.',
  },
};

const SEM_ACESSO = 'Sem acesso: a pessoa não consegue nem ler esse módulo.';

/** Nome de exibição (prefere nome, depois nome de guerra, depois login). */
function nomeExibicao(u) {
  return u.nome || u.nome_guerra || u.login || '-';
}

/**
 * Usuários do SCA (#/usuarios): importa do serviço de autenticação, sincroniza,
 * concede o perfil de cada módulo e alterna administrador/ativo.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderUsuariosList(container, _ctx) {
  let disposed = false;
  let modulos = [];
  let tiposPerfil = [];

  /** Rótulo do nível a partir do catálogo do servidor (sem decorar código). */
  function rotuloNivel(nivel) {
    if (!nivel) return 'Sem acesso';
    const achado = tiposPerfil.find(t => t.code === nivel);
    return achado ? achado.nome : `Nível ${nivel}`;
  }

  function colunaDeModulo(modulo) {
    return {
      key: `perfil_${modulo.nome_abrev}`,
      label: modulo.nome,
      render: (row) => (row.administrador
        ? 'todos (administrador)'
        : rotuloNivel((row.perfis || {})[modulo.nome_abrev])),
    };
  }

  const importarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirImportar(),
  }, [svgIcon(ICONS.add, 16), 'Importar do serviço de autenticação']);

  const sincronizarBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => handleSincronizar(),
  }, [svgIcon(ICONS.refresh || ICONS.description, 16), 'Sincronizar']);

  // O catalogo vem ANTES da tabela porque as colunas SAO os modulos declarados
  // pelo servidor: absorver um modulo novo nao exige mexer nesta tela.
  try {
    const [m, t] = await Promise.all([getModulos(), getTiposPerfil()]);
    modulos = m || [];
    tiposPerfil = t || [];
  } catch (err) {
    showError(err.message || 'Erro ao carregar o catálogo de perfis');
  }

  const table = createDataTable({
    columns: [
      { key: 'nome', label: 'Nome', sortable: true, render: (row) => nomeExibicao(row) },
      { key: 'login', label: 'Login', sortable: true, render: (row) => row.login || '-' },
      { key: 'tipo_posto_grad', label: 'Posto/Grad', render: (row) => row.tipo_posto_grad || '-' },
      ...modulos.map(colunaDeModulo),
      { key: 'ativo', label: 'Ativo', render: (row) => (row.ativo ? 'Sim' : 'Não') },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum usuário cadastrado',
    actions: [
      { icon: ICONS.edit || ICONS.people, title: 'Definir perfis', onClick: (row) => abrirPerfis(row) },
      { icon: ICONS.lock, title: 'Alternar administrador', onClick: (row) => toggleAdmin(row) },
      { icon: ICONS.swapHoriz || ICONS.people, title: 'Alternar ativo', onClick: (row) => toggleAtivo(row) },
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Usuários' }),
      el('div', { className: 'page__actions' }, [importarBtn, sincronizarBtn]),
    ]),
    el('p', {
      className: 'page__subtitle',
      textContent: 'O administrador passa em qualquer módulo. Os demais só acessam o módulo onde tiverem perfil.',
    }),
    table.element,
  ]);
  container.appendChild(page);

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getUsuarios();
      if (disposed) return;
      table.update({ rows: dados || [], loading: false });
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar usuários');
    }
  }

  // ---------------------------------------------------------------------------
  // Perfis por módulo: é aqui que se libera o sistema para a pessoa
  // ---------------------------------------------------------------------------
  function abrirPerfis(row) {
    const selects = modulos.map((modulo) => {
      const atual = (row.perfis || {})[modulo.nome_abrev] || 0;

      const select = el('select', { className: 'form-field__input' }, [
        el('option', { value: '0', textContent: 'Sem acesso' }),
        ...tiposPerfil.map(t => el('option', { value: String(t.code), textContent: t.nome })),
      ]);
      select.value = String(atual);

      const ajudaDoModulo = AJUDA[modulo.nome_abrev] || {};
      const ajuda = el('p', {
        className: 'form-field__hint',
        textContent: ajudaDoModulo[atual] || SEM_ACESSO,
      });
      select.addEventListener('change', () => {
        ajuda.textContent = ajudaDoModulo[Number(select.value)] || SEM_ACESSO;
      });

      return {
        modulo: modulo.nome_abrev,
        select,
        element: el('label', { className: 'form-field' }, [
          el('span', { className: 'form-field__label', textContent: modulo.nome }),
          select,
          ajuda,
        ]),
      };
    });

    const conteudo = el('div', { className: 'form-grid' }, [
      ...selects.map(s => s.element),
      row.administrador
        ? el('p', {
            className: 'form-field__hint',
            textContent: 'Este usuário é administrador: passa em qualquer módulo e nível, independente do que for escolhido aqui.',
          })
        : el('span', {}),
    ]);

    openModal({
      title: `Perfis de ${nomeExibicao(row)}`,
      content: conteudo,
      width: '560px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Salvar',
          variant: 'primary',
          onClick: async ({ close }) => {
            const perfis = {};
            selects.forEach((s) => {
              const escolhido = Number(s.select.value);
              // 0 vira null de propósito: é assim que se REMOVE o acesso
              perfis[s.modulo] = escolhido === 0 ? null : escolhido;
            });
            try {
              await atualizarUsuario(row.uuid, {
                administrador: row.administrador,
                ativo: row.ativo,
                perfis,
              });
              showSuccess('Perfis atualizados com sucesso');
              close();
              await load();
            } catch (err) {
              showError(err.message || 'Erro ao atualizar os perfis');
            }
          },
        },
      ],
    });
  }

  async function toggleAdmin(row) {
    const novoAdmin = !row.administrador;
    const ok = await confirmDialog({
      title: 'Alterar administrador',
      message: novoAdmin
        ? `Conceder administrador a ${nomeExibicao(row)}? Ele passa a poder tudo em TODOS os módulos.`
        : `Remover o administrador de ${nomeExibicao(row)}? Ele fica só com os perfis de módulo que tiver.`,
      confirmLabel: 'Confirmar',
      danger: !novoAdmin,
    });
    if (!ok) return;
    try {
      await atualizarUsuario(row.uuid, { administrador: novoAdmin, ativo: row.ativo });
      showSuccess('Usuário atualizado com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao atualizar usuário');
    }
  }

  async function toggleAtivo(row) {
    const novoAtivo = !row.ativo;
    const ok = await confirmDialog({
      title: novoAtivo ? 'Ativar usuário' : 'Desativar usuário',
      message: novoAtivo
        ? `Ativar ${nomeExibicao(row)}?`
        : `Desativar ${nomeExibicao(row)}? O acesso cai na hora, mesmo com sessão aberta.`,
      confirmLabel: 'Confirmar',
      danger: !novoAtivo,
    });
    if (!ok) return;
    try {
      await atualizarUsuario(row.uuid, { administrador: row.administrador, ativo: novoAtivo });
      showSuccess('Usuário atualizado com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao atualizar usuário');
    }
  }

  async function handleSincronizar() {
    sincronizarBtn.disabled = true;
    try {
      await sincronizarUsuarios();
      if (disposed) return;
      showSuccess('Usuários sincronizados com sucesso');
      await load();
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao sincronizar usuários');
    } finally {
      sincronizarBtn.disabled = false;
    }
  }

  async function abrirImportar() {
    importarBtn.disabled = true;
    let disponiveis = [];
    try {
      disponiveis = await getUsuariosAuthServer();
    } catch (err) {
      showError(err.message || 'Erro ao consultar o serviço de autenticação');
      importarBtn.disabled = false;
      return;
    }
    importarBtn.disabled = false;
    if (disposed) return;

    if (!disponiveis || !disponiveis.length) {
      showError('Nenhum usuário disponível para importação.');
      return;
    }

    const checkboxes = disponiveis.map((u) => {
      const input = el('input', { className: 'form-field__checkbox', type: 'checkbox', value: u.uuid });
      return {
        input,
        element: el('label', { className: 'form-field form-field--checkbox' }, [
          input,
          el('span', { className: 'form-field__label', textContent: `${u.login || '-'}, ${nomeExibicao(u)}` }),
        ]),
      };
    });

    const content = el('div', { className: 'form-grid' }, [
      ...checkboxes.map(c => c.element),
      el('p', {
        className: 'form-field__hint',
        textContent: 'O usuário importado começa SEM perfil em nenhum módulo. Defina o perfil dele depois de importar.',
      }),
    ]);

    openModal({
      title: 'Importar usuários',
      content,
      width: '560px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Importar',
          variant: 'primary',
          onClick: async ({ close }) => {
            const uuids = checkboxes.filter(c => c.input.checked).map(c => c.input.value);
            if (!uuids.length) {
              showError('Selecione ao menos um usuário.');
              return;
            }
            try {
              await importarUsuarios(uuids);
              showSuccess('Usuários importados com sucesso');
              close();
              await load();
            } catch (err) {
              showError(err.message || 'Erro ao importar usuários');
            }
          },
        },
      ],
    });
  }

  await load();

  return () => {
    disposed = true;
    if (table._cleanup) table._cleanup();
  };
}
