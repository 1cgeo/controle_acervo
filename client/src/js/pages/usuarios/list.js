import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getUsuarios,
  getUsuariosAuthServer,
  importarUsuarios,
  atualizarUsuario,
  sincronizarUsuarios,
  getModulos,
  getTiposPerfil,
} from '@services/plataforma-service.js';

/**
 * O que cada nivel permite, em uma linha, para o chefe escolher sem adivinhar.
 * Vale igual nos tres modulos: o nivel e a hierarquia, o modulo e o escopo.
 */
const AJUDA_NIVEL = {
  0: 'Sem acesso: a pessoa não entra no módulo, nem para ler.',
  1: 'Consulta: lê os dados do módulo. Não escreve.',
  2: 'Operador: lê e lança o trabalho do dia a dia do módulo.',
  3: 'Gerente: tudo do operador, mais editar o que é estruturante e excluir registros.',
};

/** Rotulo do nivel a partir do catalogo do servidor (evita decorar codigo). */
function rotuloPerfil(nivel, tiposPerfil) {
  if (!nivel) return 'Sem acesso';
  const achado = (tiposPerfil || []).find(t => t.code === nivel);
  return achado ? achado.nome : `Nível ${nivel}`;
}

/** Nome de exibicao do usuario (prefere nome, depois nome_guerra, depois login). */
function nomeExibicao(u) {
  return u.nome || u.nome_guerra || u.login || '-';
}

/**
 * Tela UNICA de usuarios da plataforma (#/usuarios), do administrador global.
 *
 * Uma coluna por MODULO, com o nivel da pessoa em cada um. Os modulos e os
 * niveis vem do catalogo do servidor (GET /api/usuarios/dominio/modulo e
 * /tipo_perfil), entao um modulo novo aparece aqui sozinho, sem tocar no codigo.
 * Salvar manda PUT /api/usuarios/:uuid com `perfis` (nivel 1 a 3, ou null para
 * revogar o acesso naquele modulo).
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderUsuariosList(container, _ctx) {
  let disposed = false;
  let tiposPerfil = [];
  let modulos = [];

  // ---------------------------------------------------------------------------
  // Catalogos primeiro: as COLUNAS por modulo dependem deles
  // ---------------------------------------------------------------------------
  try {
    [modulos, tiposPerfil] = await Promise.all([getModulos(), getTiposPerfil()]);
  } catch (err) {
    showError(err.message || 'Erro ao carregar o catálogo de módulos e perfis');
    modulos = [];
    tiposPerfil = [];
  }
  if (disposed) return () => {};

  modulos = (modulos || []).slice().sort((a, b) => a.code - b.code);

  // ---------------------------------------------------------------------------
  // Botoes do topo
  // ---------------------------------------------------------------------------
  const importarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirImportar(),
  }, [svgIcon(ICONS.add, 16), 'Importar do serviço de autenticação']);

  const sincronizarBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => handleSincronizar(),
  }, [svgIcon(ICONS.swapHoriz, 16), 'Sincronizar']);

  // ---------------------------------------------------------------------------
  // Tabela: uma coluna por modulo
  // ---------------------------------------------------------------------------
  const colunasModulo = modulos.map(m => ({
    key: `modulo_${m.nome_abrev}`,
    label: m.nome,
    render: (row) => (row.administrador
      ? 'Administrador'
      : rotuloPerfil((row.perfis || {})[m.nome_abrev], tiposPerfil)),
  }));

  const table = createDataTable({
    columns: [
      { key: 'nome', label: 'Nome', sortable: true, render: (row) => nomeExibicao(row) },
      { key: 'login', label: 'Login', sortable: true, render: (row) => row.login || '-' },
      { key: 'tipo_posto_grad', label: 'Posto/Grad', render: (row) => row.tipo_posto_grad || '-' },
      ...colunasModulo,
      { key: 'administrador', label: 'Administrador', render: (row) => (row.administrador ? 'Sim' : 'Não') },
      { key: 'ativo', label: 'Ativo', render: (row) => (row.ativo ? 'Sim' : 'Não') },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum usuário cadastrado',
    actions: [
      {
        icon: ICONS.edit,
        title: 'Definir perfis por módulo',
        onClick: (row) => abrirPerfis(row),
      },
      {
        icon: ICONS.lock,
        title: 'Alternar administrador',
        onClick: (row) => toggleAdmin(row),
      },
      {
        icon: ICONS.swapHoriz,
        title: 'Alternar ativo',
        onClick: (row) => toggleAtivo(row),
      },
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Usuários' }),
      el('div', { className: 'page__actions' }, [importarBtn, sincronizarBtn]),
    ]),
    table.element,
  ]);
  container.appendChild(page);

  // ---------------------------------------------------------------------------
  // Carga
  // ---------------------------------------------------------------------------
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
  // Alternar flags (administrador / ativo) com confirmacao
  // ---------------------------------------------------------------------------
  async function toggleAdmin(row) {
    const novoAdmin = !row.administrador;
    const ok = await confirmDialog({
      title: 'Alterar administrador',
      message: `Deseja ${novoAdmin ? 'conceder' : 'remover'} o privilégio de administrador de ${nomeExibicao(row)}? O administrador passa em todos os módulos.`,
      confirmLabel: 'Confirmar',
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
      message: `Deseja ${novoAtivo ? 'ativar' : 'desativar'} o usuário ${nomeExibicao(row)}?`,
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

  // ---------------------------------------------------------------------------
  // Sincronizar
  // ---------------------------------------------------------------------------
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

  // ---------------------------------------------------------------------------
  // Importar do servico de autenticacao (modal com checkboxes)
  // ---------------------------------------------------------------------------
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
      const input = el('input', {
        className: 'form-field__checkbox',
        type: 'checkbox',
        value: u.uuid,
      });
      return {
        input,
        element: el('label', { className: 'form-field form-field--checkbox' }, [
          input,
          el('span', { className: 'form-field__label', textContent: `${u.login || '-'}, ${nomeExibicao(u)}` }),
        ]),
      };
    });

    const content = el('div', { className: 'form-grid' },
      checkboxes.map(c => c.element));

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

  // ---------------------------------------------------------------------------
  // Perfil em CADA modulo, num modal so (e o que de fato libera o sistema)
  // ---------------------------------------------------------------------------
  async function abrirPerfis(row) {
    if (!modulos.length) {
      showError('Catálogo de módulos indisponível. Recarregue a página.');
      return;
    }

    const niveis = tiposPerfil.length ? tiposPerfil : [];
    const atuais = row.perfis || {};

    const campos = modulos.map((m) => {
      const atual = atuais[m.nome_abrev] || 0;

      const select = el('select', { className: 'form-field__input' }, [
        el('option', { value: '0', textContent: 'Sem acesso' }),
        ...niveis.map(t => el('option', { value: String(t.code), textContent: t.nome })),
      ]);
      select.value = String(atual);

      const ajuda = el('p', { className: 'form-field__hint', textContent: AJUDA_NIVEL[atual] });
      select.addEventListener('change', () => {
        ajuda.textContent = AJUDA_NIVEL[Number(select.value)] || AJUDA_NIVEL[0];
      });

      return {
        modulo: m.nome_abrev,
        inicial: atual,
        select,
        element: el('label', { className: 'form-field' }, [
          el('span', { className: 'form-field__label', textContent: m.nome }),
          select,
          ajuda,
        ]),
      };
    });

    const conteudo = el('div', { className: 'form-grid' }, [
      ...campos.map(c => c.element),
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
            // So manda o que MUDOU: modulo omitido fica como esta no servidor.
            const perfis = {};
            for (const campo of campos) {
              const escolhido = Number(campo.select.value);
              if (escolhido === campo.inicial) continue;
              // 0 vira null de proposito: e assim que se REVOGA o acesso.
              perfis[campo.modulo] = escolhido === 0 ? null : escolhido;
            }

            if (!Object.keys(perfis).length) {
              close();
              return;
            }

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

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
