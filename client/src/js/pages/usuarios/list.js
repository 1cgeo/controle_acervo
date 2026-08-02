import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getUsuarios,
  atualizarUsuario,
  excluirUsuario,
  resetarSenhas,
  getModulos,
  getTiposPerfil,
  getPostosGrad,
} from '@services/plataforma-service.js';
import { abrirPerfisDialog } from './perfis-dialog.js';
import { abrirUsuarioDialog } from './usuario-dialog.js';

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
 * Tela de GESTÃO de usuarios da plataforma (#/usuarios), do administrador global.
 *
 * Uma coluna por MODULO, com o nivel da pessoa em cada um. Os modulos e os
 * niveis vem do catalogo do servidor (GET /api/usuarios/dominio/modulo e
 * /tipo_perfil), entao um modulo novo aparece aqui sozinho, sem tocar no codigo.
 * Salvar manda PUT /api/usuarios/:uuid com `perfis` (nivel 1 a 3, ou null para
 * revogar o acesso naquele modulo).
 *
 * Em 2026-08-02 a autenticacao veio para dentro do SCA, e esta tela mudou de
 * natureza: sairam "Importar do serviço de autenticação" e "Sincronizar", que
 * espelhavam o Auth Server, e entrou o CADASTRO (criar, editar, excluir e
 * resetar senha). O SCA passou a ser a fonte das pessoas, e nao mais a copia.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderUsuariosList(container, _ctx) {
  let disposed = false;
  let tiposPerfil = [];
  let modulos = [];
  let postosGrad = [];

  // ---------------------------------------------------------------------------
  // Catalogos primeiro: as COLUNAS por modulo dependem deles
  // ---------------------------------------------------------------------------
  try {
    [modulos, tiposPerfil, postosGrad] = await Promise.all([
      getModulos(),
      getTiposPerfil(),
      getPostosGrad(),
    ]);
  } catch (err) {
    showError(err.message || 'Erro ao carregar o catálogo de módulos e perfis');
    modulos = [];
    tiposPerfil = [];
    postosGrad = [];
  }
  if (disposed) return () => {};

  modulos = (modulos || []).slice().sort((a, b) => a.code - b.code);
  postosGrad = postosGrad || [];

  // ---------------------------------------------------------------------------
  // Botoes do topo
  // ---------------------------------------------------------------------------
  const novoBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirUsuarioDialog({ postosGrad, onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo usuário']);

  // ---------------------------------------------------------------------------
  // Aviso de quem esta sem senha
  //
  // `senha_definida: false` e, literalmente, a lista de quem NAO CONSEGUE ENTRAR:
  // a fusao de 2026-08-02 deixou `dgeo.usuario.senha` anulavel e quem preencheu
  // foi um script rodado uma vez, por fora. Sem isto na tela, quem ficou de fora
  // da copia so apareceria ao reclamar que o login nao funciona.
  // ---------------------------------------------------------------------------
  const aviso = el('div', { className: 'usuarios__aviso hidden' }, [
    svgIcon(ICONS.warning, 18),
    el('span', { className: 'usuarios__aviso-texto' }),
  ]);
  const avisoTexto = aviso.querySelector('.usuarios__aviso-texto');

  function atualizarAviso(linhas) {
    const semSenha = (linhas || []).filter(u => u.senha_definida === false);
    aviso.classList.toggle('hidden', semSenha.length === 0);
    if (!semSenha.length) return;
    avisoTexto.textContent = semSenha.length === 1
      ? '1 usuário está sem senha definida e não consegue entrar. Use "Resetar senha" para dar a ele a senha igual ao login.'
      : `${semSenha.length} usuários estão sem senha definida e não conseguem entrar. Use "Resetar senha" para dar a cada um a senha igual ao login.`;
  }

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
        // As marcas dizem coisas de natureza diferente e por isso convivem:
        // "Admin" e o que a pessoa PODE, "Sem senha" e se ela consegue entrar.
        render: (row) => {
          const marcas = [];
          if (row.administrador) {
            marcas.push(el('span', {
              className: 'usuarios__chip-admin',
              title: 'Administrador global da plataforma',
              textContent: 'Admin',
            }));
          }
          if (row.senha_definida === false) {
            marcas.push(el('span', {
              className: 'usuarios__chip-sem-senha',
              title: 'Sem senha definida: esta pessoa não consegue entrar. Use "Resetar senha".',
              textContent: 'Sem senha',
            }));
          }
          if (!marcas.length) return nomeExibicao(row);
          return el('span', { className: 'usuarios__nome' }, [nomeExibicao(row), ...marcas]);
        },
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
        title: 'Editar cadastro',
        onClick: (row) => abrirUsuarioDialog({ usuario: row, postosGrad, onSaved: load }),
      },
      {
        icon: ICONS.layers,
        title: 'Definir perfis por módulo',
        onClick: (row) => abrirPerfis(row),
      },
      {
        icon: ICONS.key,
        title: 'Resetar senha',
        onClick: (row) => resetarSenha(row),
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
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      },
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Usuários' }),
      el('div', { className: 'page__actions' }, [novoBtn]),
    ]),
    aviso,
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
      atualizarAviso(dados);
    } catch (err) {
      if (disposed) return;
      table.update({ rows: [], loading: false });
      atualizarAviso([]);
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
  // Resetar senha
  //
  // A senha passa a ser o LOGIN da pessoa. A confirmacao diz isso com todas as
  // letras, e diz o login: uma senha adivinhavel so serve enquanto a pessoa a
  // troca no primeiro acesso, e quem reseta precisa saber que e assim.
  // ---------------------------------------------------------------------------
  async function resetarSenha(row) {
    const ok = await confirmDialog({
      title: 'Resetar senha',
      message: `A senha de ${nomeExibicao(row)} passará a ser o login dele: "${row.login}". `
        + 'Qualquer pessoa que saiba o login poderá entrar até que ele troque a senha em "Meu perfil". Deseja continuar?',
      confirmLabel: 'Resetar senha',
      danger: true,
    });
    if (!ok) return;
    try {
      await resetarSenhas([row.uuid]);
      showSuccess(`Senha resetada. A senha de ${nomeExibicao(row)} agora é "${row.login}".`);
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao resetar a senha');
    }
  }

  // ---------------------------------------------------------------------------
  // Excluir
  //
  // Quase sempre o servidor RECUSA, e esta certo: quem ja trabalhou no sistema
  // tem registros apontando para ele, e apagar reescreveria a autoria do que
  // cadastrou. A mensagem que aparece e a DELE ("Usuário já possui registros no
  // sistema e não pode ser excluído. Desative-o."), porque uma frase generica
  // nao diria o que fazer em seguida.
  // ---------------------------------------------------------------------------
  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir usuário',
      message: `Deseja excluir ${nomeExibicao(row)}? Só é possível excluir quem ainda não tem `
        + 'nenhum registro no sistema. Quem já trabalhou aqui deve ser DESATIVADO, não excluído.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await excluirUsuario(row.uuid);
      showSuccess('Usuário excluído com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir usuário');
    }
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
