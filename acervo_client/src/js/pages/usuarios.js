import { el } from '@utils/dom.js';
import { createDataTable } from '@components/data-table.js';
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

// O que cada nível permite, em uma linha, para escolher sem adivinhar.
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

function nomeExibicao(u) {
  return u.nome || u.nome_guerra || u.login || '-';
}

/**
 * Página de Usuários (#/usuarios). Sem modal de propósito: os perfis se definem
 * DIRETO na linha, num select por módulo, porque a tarefa é passar a lista
 * inteira de uma vez, e não editar uma pessoa por vez.
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderUsuarios(container) {
  let disposed = false;
  let modulos = [];
  let tiposPerfil = [];

  const importarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirImportar(),
    textContent: 'Importar do serviço de autenticação',
  });

  const sincronizarBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => sincronizar(),
    textContent: 'Sincronizar',
  });

  const importarArea = el('div', { className: 'usuarios__importar' });

  const tabelaArea = el('div', {});

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'dashboard__header' }, [
      el('h1', { className: 'dashboard__title', textContent: 'Usuários' }),
      el('div', { className: 'export-bar' }, [importarBtn, sincronizarBtn]),
    ]),
    el('p', {
      className: 'page__subtitle',
      textContent:
        'O administrador passa em qualquer módulo. Os demais só acessam o módulo onde tiverem perfil, '
        + 'e quem fica "Sem acesso" não consegue nem ler. A mudança vale na requisição seguinte, sem novo login.',
    }),
    importarArea,
    tabelaArea,
  ]);
  container.appendChild(page);

  // O catálogo vem do servidor: as colunas SÃO os módulos declarados lá.
  try {
    const [m, t] = await Promise.all([getModulos(), getTiposPerfil()]);
    modulos = m || [];
    tiposPerfil = t || [];
  } catch (err) {
    showError(err.message || 'Erro ao carregar o catálogo de perfis');
  }

  /** Select de nível de um módulo, que grava sozinho ao mudar. */
  function selectDeModulo(row, modulo) {
    if (row.administrador) {
      return el('span', { textContent: 'todos (administrador)' });
    }

    const atual = (row.perfis || {})[modulo.nome_abrev] || 0;
    const select = el('select', {
      className: 'form-field__input',
      title: (AJUDA[modulo.nome_abrev] || {})[atual] || 'Sem acesso a este módulo',
    }, [
      el('option', { value: '0', textContent: 'Sem acesso' }),
      ...tiposPerfil.map(t => el('option', { value: String(t.code), textContent: t.nome })),
    ]);
    select.value = String(atual);

    select.addEventListener('change', async () => {
      const escolhido = Number(select.value);
      select.disabled = true;
      try {
        await atualizarUsuario(row.uuid, {
          administrador: row.administrador,
          ativo: row.ativo,
          // 0 vira null de propósito: é assim que se REMOVE o acesso
          perfis: { [modulo.nome_abrev]: escolhido === 0 ? null : escolhido },
        });
        row.perfis = { ...(row.perfis || {}) };
        if (escolhido === 0) delete row.perfis[modulo.nome_abrev];
        else row.perfis[modulo.nome_abrev] = escolhido;
        select.title = (AJUDA[modulo.nome_abrev] || {})[escolhido] || 'Sem acesso a este módulo';
        showSuccess(`${nomeExibicao(row)}: perfil de ${modulo.nome} atualizado`);
      } catch (err) {
        select.value = String(atual);
        showError(err.message || 'Erro ao atualizar o perfil');
      } finally {
        select.disabled = false;
      }
    });

    return select;
  }

  /** Botão que alterna um booleano da pessoa (administrador ou ativo). */
  function botaoBooleano(row, campo, rotulos) {
    const btn = el('button', {
      className: `btn btn--sm ${row[campo] ? 'btn--secondary' : 'btn--text'}`,
      type: 'button',
      textContent: row[campo] ? rotulos.sim : rotulos.nao,
    });
    btn.addEventListener('click', async () => {
      const novo = !row[campo];
      if (campo === 'administrador' && novo
        && !window.confirm(`Conceder administrador a ${nomeExibicao(row)}? Ele passa a poder tudo em TODOS os módulos.`)) {
        return;
      }
      if (campo === 'ativo' && !novo
        && !window.confirm(`Desativar ${nomeExibicao(row)}? O acesso cai na hora, mesmo com sessão aberta.`)) {
        return;
      }
      btn.disabled = true;
      try {
        await atualizarUsuario(row.uuid, {
          administrador: campo === 'administrador' ? novo : row.administrador,
          ativo: campo === 'ativo' ? novo : row.ativo,
        });
        showSuccess('Usuário atualizado com sucesso');
        await load();
      } catch (err) {
        showError(err.message || 'Erro ao atualizar usuário');
        btn.disabled = false;
      }
    });
    return btn;
  }

  const colunas = [
    { key: 'nome', label: 'Nome', sortable: true, format: (_v, row) => nomeExibicao(row) },
    { key: 'login', label: 'Login', sortable: true },
    { key: 'tipo_posto_grad', label: 'Posto/Grad' },
    ...modulos.map(modulo => ({
      key: `perfil_${modulo.nome_abrev}`,
      label: modulo.nome,
      format: (_v, row) => selectDeModulo(row, modulo),
    })),
    {
      key: 'administrador',
      label: 'Administrador',
      format: (_v, row) => botaoBooleano(row, 'administrador', { sim: 'Sim', nao: 'Não' }),
    },
    {
      key: 'ativo',
      label: 'Ativo',
      format: (_v, row) => botaoBooleano(row, 'ativo', { sim: 'Sim', nao: 'Não' }),
    },
  ];

  let table = null;

  async function load() {
    try {
      const dados = await getUsuarios();
      if (disposed) return;
      tabelaArea.innerHTML = '';
      table = createDataTable({
        columns: colunas,
        data: dados || [],
        loading: false,
        searchable: true,
        pageSize: 25,
        emptyMessage: 'Nenhum usuário cadastrado',
      });
      tabelaArea.appendChild(table.element);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar usuários');
    }
  }

  async function sincronizar() {
    sincronizarBtn.disabled = true;
    try {
      await sincronizarUsuarios();
      showSuccess('Usuários sincronizados com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao sincronizar usuários');
    } finally {
      sincronizarBtn.disabled = false;
    }
  }

  /** Importação: lista com checkbox, sem modal (o client não tem um). */
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

    importarArea.innerHTML = '';
    if (!disponiveis || !disponiveis.length) {
      importarArea.appendChild(el('p', {
        className: 'page__subtitle',
        textContent: 'Nenhum usuário novo no serviço de autenticação.',
      }));
      return;
    }

    const checkboxes = disponiveis.map((u) => {
      const input = el('input', { type: 'checkbox', value: u.uuid });
      return {
        input,
        element: el('label', { className: 'form-field form-field--checkbox' }, [
          input,
          el('span', { textContent: ` ${u.login || '-'}, ${nomeExibicao(u)}` }),
        ]),
      };
    });

    const confirmar = el('button', {
      className: 'btn btn--primary',
      type: 'button',
      textContent: 'Importar selecionados',
    });
    confirmar.addEventListener('click', async () => {
      const uuids = checkboxes.filter(c => c.input.checked).map(c => c.input.value);
      if (!uuids.length) {
        showError('Selecione ao menos um usuário.');
        return;
      }
      confirmar.disabled = true;
      try {
        await importarUsuarios(uuids);
        showSuccess('Usuários importados com sucesso');
        importarArea.innerHTML = '';
        await load();
      } catch (err) {
        showError(err.message || 'Erro ao importar usuários');
        confirmar.disabled = false;
      }
    });

    importarArea.appendChild(el('div', { className: 'card' }, [
      el('h2', { textContent: 'Importar do serviço de autenticação' }),
      el('p', {
        className: 'page__subtitle',
        textContent: 'O usuário importado começa SEM perfil em nenhum módulo. Defina o perfil dele na tabela depois de importar.',
      }),
      ...checkboxes.map(c => c.element),
      confirmar,
    ]));
  }

  await load();

  return () => {
    disposed = true;
    if (table && table._cleanup) table._cleanup();
  };
}
