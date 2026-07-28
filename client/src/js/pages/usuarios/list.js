import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getUsuarios,
  getUsuariosAuthServer,
  atualizarUsuario,
  sincronizarUsuarios,
  getModulos,
  getTiposPerfil,
} from '@services/plataforma-service.js';
import { abrirPerfisDialog } from './perfis-dialog.js';
import { abrirImportarDialog } from './importar-dialog.js';

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
  // O administrador e GLOBAL e unico: nao existe administrador por modulo. Por
  // isso ele nao vira uma coluna, e sim uma marca ao lado do nome. Antes a
  // palavra "Administrador" se repetia numa coluna por modulo MAIS uma coluna
  // propria, o que dava quatro colunas dizendo a mesma coisa.
  const colunasModulo = modulos.map(m => ({
    key: `modulo_${m.nome_abrev}`,
    label: m.nome,
    render: (row) => (row.administrador
      ? el('span', {
        className: 'usuarios__acesso-total',
        title: 'Administrador global: passa neste e em qualquer módulo, independente do perfil',
        textContent: 'Acesso total',
      })
      : rotuloPerfil((row.perfis || {})[m.nome_abrev], tiposPerfil)),
  }));

  const table = createDataTable({
    columns: [
      {
        key: 'nome',
        label: 'Nome',
        sortable: true,
        render: (row) => (row.administrador
          ? el('span', { className: 'usuarios__nome' }, [
            nomeExibicao(row),
            el('span', {
              className: 'usuarios__chip-admin',
              title: 'Administrador global da plataforma',
              textContent: 'Admin',
            }),
          ])
          : nomeExibicao(row)),
      },
      { key: 'login', label: 'Login', sortable: true, render: (row) => row.login || '-' },
      { key: 'tipo_posto_grad', label: 'Posto/Grad', render: (row) => row.tipo_posto_grad || '-' },
      ...colunasModulo,
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
  // Importar do servico de autenticacao
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
      showError('Nenhuma pessoa disponível para importação.');
      return;
    }

    abrirImportarDialog({ disponiveis, nomeExibicao, onSaved: load });
  }

  // ---------------------------------------------------------------------------
  // Perfil em CADA modulo, num modal so (e o que de fato libera o sistema)
  // ---------------------------------------------------------------------------
  function abrirPerfis(row) {
    if (!modulos.length) {
      showError('Catálogo de módulos indisponível. Recarregue a página.');
      return;
    }

    abrirPerfisDialog({
      usuario: row,
      modulos,
      tiposPerfil,
      nomeExibicao: nomeExibicao(row),
      onSaved: load,
    });
  }

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
