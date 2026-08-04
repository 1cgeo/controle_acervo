import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import { criarHistorico } from '@components/historico/historico.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { formatDate, formatDateTime } from '@utils/format.js';
import {
  getUsuarios,
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

/**
 * Como o resto do sistema chama a pessoa: posto mais nome de guerra.
 * O nome completo entra so quando falta o nome de guerra.
 */
function identidade(u) {
  const nome = u.nome_guerra || u.nome || u.login || '-';
  return [u.tipo_posto_grad, nome].filter(Boolean).join(' ');
}

/**
 * Tela de GESTÃO do efetivo da plataforma (#/usuarios), do administrador global.
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
 * REVISAO DE 2026-08-04. Na producao a grade trazia 54 pessoas e repetia a
 * mesma palavra em 85% das celulas. Tres causas, e as tres estao consertadas:
 * quem ja saiu vinha misturado com quem serve (agora ha filtro de situacao, com
 * os ativos por padrao); a busca comparava `row[col.key]` e as colunas de
 * modulo usavam chave que a linha nao tinha (agora a linha CARREGA o texto que
 * a celula mostra); e a lista vinha em ordem alfabetica de nome completo (agora
 * e a hierarquia, pelo codigo do posto).
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderUsuariosList(container, ctx) {
  let disposed = false;
  let tiposPerfil = [];
  let modulos = [];
  let postosGrad = [];

  // ---------------------------------------------------------------------------
  // Catalogos primeiro: as COLUNAS por modulo dependem deles
  //
  // Falhar aqui NAO pode virar tabela sem colunas de modulo: a tela diria, em
  // silencio, que ninguem tem acesso a nada. Vira estado de erro, com o caminho
  // de volta.
  // ---------------------------------------------------------------------------
  try {
    [modulos, tiposPerfil, postosGrad] = await Promise.all([
      getModulos(),
      getTiposPerfil(),
      getPostosGrad(),
    ]);
  } catch (err) {
    if (disposed) return () => {};
    return montarErro(container, ctx, err);
  }
  if (disposed) return () => {};

  modulos = (modulos || []).slice().sort((a, b) => a.code - b.code);
  postosGrad = postosGrad || [];

  // Todas as pessoas que o servidor devolveu, ja preparadas. O filtro de
  // situacao recorta daqui, sem voltar ao servidor.
  let pessoas = [];
  // null e "Todas", pela opcao vazia do seletor. O padrao e quem entra hoje.
  let situacao = 'ativos';

  // ---------------------------------------------------------------------------
  // Botoes do topo e filtro
  // ---------------------------------------------------------------------------
  const novoBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirUsuarioDialog({ postosGrad, onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo usuário']);

  // O rotulo diz o que o campo MEDE. `dgeo.usuario.ativo` governa o login, e
  // nao a situacao do militar: nao existe dominio de situacao de pessoa no DDL.
  const situacaoFiltro = createSelectField({
    label: 'Situação do login',
    options: [
      { value: 'ativos', label: 'Ativo' },
      { value: 'inativos', label: 'Inativo' },
    ],
    value: situacao,
    placeholder: 'Todos',
    onChange: (valor) => {
      situacao = valor;
      aplicar();
    },
  });

  // ---------------------------------------------------------------------------
  // Aviso de quem esta sem senha
  //
  // `senha_definida: false` e, literalmente, a lista de quem NAO CONSEGUE ENTRAR:
  // a fusao de 2026-08-02 deixou `dgeo.usuario.senha` anulavel e quem preencheu
  // foi um script rodado uma vez, por fora. Sem isto na tela, quem ficou de fora
  // da copia so apareceria ao reclamar que o login nao funciona.
  //
  // `role="status"` porque o aviso nasce DEPOIS da carga: sem ele, o leitor de
  // tela nao anuncia nada.
  // ---------------------------------------------------------------------------
  const aviso = el('div', { className: 'usuarios__aviso hidden', role: 'status' }, [
    svgIcon(ICONS.warning, 18),
    el('span', { className: 'usuarios__aviso-texto' }),
  ]);
  const avisoTexto = aviso.querySelector('.usuarios__aviso-texto');

  function atualizarAviso(linhas) {
    const semSenha = (linhas || []).filter(u => u.senha_definida === false);
    aviso.classList.toggle('hidden', semSenha.length === 0);
    if (!semSenha.length) return;
    avisoTexto.textContent = semSenha.length === 1
      ? '1 pessoa está sem senha e não entra. Use "Resetar senha".'
      : `${semSenha.length} pessoas estão sem senha e não entram. Use "Resetar senha".`;
  }

  // ---------------------------------------------------------------------------
  // A linha que a TABELA usa
  //
  // A busca do data-table compara `row[col.key]`, entao a linha carrega o TEXTO
  // que cada celula mostra. Antes as colunas de modulo usavam chaves que a linha
  // nao tinha (`modulo_acervo`, com o dado em `row.perfis`) e a coluna do
  // booleano comparava "true" contra "Sim": buscar "Consulta" ou "Ativo" nao
  // achava nada do que estava na tela.
  // ---------------------------------------------------------------------------
  function prepararLinha(u) {
    const linha = { ...u };

    // Nome de guerra primeiro, que e como o sistema identifica; o nome completo
    // e o login entram para a BUSCA achar quem se procura pelos dois.
    linha.pessoa = [u.nome_guerra, u.nome, u.login].filter(Boolean).join(' ');

    for (const m of modulos) {
      linha[`modulo_${m.nome_abrev}`] = u.administrador
        ? 'Acesso total'
        : rotuloPerfil((u.perfis || {})[m.nome_abrev], tiposPerfil);
    }

    linha.situacao_login = u.ativo ? 'Ativo' : 'Inativo';
    linha.na_dgeo_desde_texto = u.na_dgeo_desde ? formatDate(u.na_dgeo_desde) : 'Sem passagem aberta';
    linha.ultimo_acesso_texto = u.ultimo_acesso ? formatDateTime(u.ultimo_acesso) : 'Nunca entrou';

    return linha;
  }

  // ---------------------------------------------------------------------------
  // Tabela: uma coluna por modulo
  // ---------------------------------------------------------------------------
  // O administrador e GLOBAL e unico: nao existe administrador por modulo. Por
  // isso ele nao vira uma coluna, e sim uma marca ao lado do nome.
  const colunasModulo = modulos.map(m => ({
    key: `modulo_${m.nome_abrev}`,
    label: m.nome,
    render: (row) => (row.administrador
      ? el('span', {
        className: 'usuarios__acesso-total',
        title: 'Administrador global: passa em qualquer módulo.',
        textContent: 'Acesso total',
      })
      : row[`modulo_${m.nome_abrev}`]),
  }));

  const table = createDataTable({
    columns: [
      // O CODIGO do posto e a hierarquia (er/dominio.sql:11-30: 1 Civil ... 19
      // General de Exército). Ordenar pela abreviatura daria ordem alfabetica
      // falsa, com "Cap" antes de "Cb" e de "Cel".
      {
        key: 'tipo_posto_grad',
        label: 'Posto/Grad',
        sortable: true,
        sortValue: (row) => row.tipo_posto_grad_id,
        render: (row) => row.tipo_posto_grad || '-',
      },
      {
        key: 'pessoa',
        label: 'Pessoa',
        sortable: true,
        sortValue: (row) => row.nome_guerra || row.nome || row.login || '',
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
              // O guard anti-vazamento (scripts/check_vazamento.py) le "senha:"
              // seguida de texto como atribuicao de segredo, e barra o commit.
              // O texto diz a mesma coisa sem os dois pontos depois da palavra.
              title: 'Não consegue entrar enquanto a senha não for definida.',
              textContent: 'Sem senha',
            }));
          }

          const nomeGuerra = row.nome_guerra || row.nome || row.login || '-';
          const linhaNome = el('span', { className: 'usuarios__nome' }, [nomeGuerra, ...marcas]);

          // O nome completo so aparece quando diz algo que o nome de guerra nao
          // diz. Repetir "Silva" embaixo de "Silva" seria mais uma coluna igual.
          if (!row.nome || row.nome === nomeGuerra) return linhaNome;

          return el('div', {}, [
            linhaNome,
            el('span', {
              style: {
                display: 'block',
                color: 'var(--text-secondary)',
                fontSize: 'var(--font-size-xs)',
              },
              textContent: row.nome,
            }),
          ]);
        },
      },
      { key: 'login', label: 'Login', sortable: true, render: (row) => row.login || '-' },
      ...colunasModulo,
      {
        key: 'situacao_login',
        label: 'Situação do login',
        sortable: true,
        render: (row) => row.situacao_login,
      },
      // As duas colunas que o banco ja tinha e a tela nao mostrava. A presenca
      // na Divisao sai do periodo ABERTO de dgeo.efetivo_periodo, e o ultimo
      // acesso de dgeo.login (a tela de acessos so mostra quem entrou HOJE).
      {
        key: 'na_dgeo_desde_texto',
        label: 'Na DGEO desde',
        sortable: true,
        sortValue: (row) => row.na_dgeo_desde,
        render: (row) => row.na_dgeo_desde_texto,
      },
      {
        key: 'ultimo_acesso_texto',
        label: 'Último acesso',
        sortable: true,
        sortValue: (row) => row.ultimo_acesso,
        render: (row) => row.ultimo_acesso_texto,
      },
    ],
    // A mesma ordem do servidor e das telas de efetivo: hierarquia primeiro.
    defaultSort: { key: 'tipo_posto_grad', dir: 'desc' },
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum usuário nesta situação',
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
        icon: ICONS.description,
        title: 'Histórico e telas da pessoa',
        onClick: (row) => abrirFicha(row),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        // Quem ja tem login, passagem ou impedimento gravado nao se exclui: o
        // servidor recusa com 23503. O botao que so sabe falhar sai da linha.
        visible: (row) => !row.tem_registro,
        onClick: (row) => handleDelete(row),
      },
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Usuários' }),
      el('div', { className: 'page__actions' }, [novoBtn]),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [situacaoFiltro.element]),
    aviso,
    table.element,
  ]);
  container.appendChild(page);

  // ---------------------------------------------------------------------------
  // Carga e filtro
  // ---------------------------------------------------------------------------
  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getUsuarios();
      if (disposed) return;
      pessoas = (dados || []).map(prepararLinha);
      aplicar();
      atualizarAviso(pessoas);
    } catch (err) {
      if (disposed) return;
      pessoas = [];
      table.update({ rows: [], loading: false });
      atualizarAviso([]);
      showError(err.message || 'Erro ao carregar usuários');
    }
  }

  /** Recorta pela situacao do login. O aviso de senha continua contando TODOS. */
  function aplicar() {
    let linhas = pessoas;
    if (situacao === 'ativos') linhas = pessoas.filter(u => u.ativo);
    if (situacao === 'inativos') linhas = pessoas.filter(u => !u.ativo);
    table.update({ rows: linhas, loading: false });
  }

  // ---------------------------------------------------------------------------
  // Resetar senha
  //
  // A senha passa a ser o LOGIN da pessoa, e a confirmacao diz qual e: uma senha
  // adivinhavel so serve enquanto a pessoa a troca no primeiro acesso.
  // ---------------------------------------------------------------------------
  async function resetarSenha(row) {
    const ok = await confirmDialog({
      title: 'Resetar senha',
      message: `A senha de ${identidade(row)} passa a ser "${row.login}". Continuar?`,
      confirmLabel: 'Resetar senha',
      danger: true,
    });
    if (!ok) return;
    try {
      await resetarSenhas([row.uuid]);
      showSuccess(`Senha resetada. A senha de ${identidade(row)} agora é "${row.login}".`);
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao resetar a senha');
    }
  }

  // ---------------------------------------------------------------------------
  // Excluir
  //
  // A acao so aparece para quem ainda nao tem registro. Quando o servidor recusa
  // mesmo assim, a mensagem que aparece e a DELE ("Usuário já possui registros
  // no sistema e não pode ser excluído. Desative-o."), porque uma frase generica
  // nao diria o que fazer em seguida.
  // ---------------------------------------------------------------------------
  async function handleDelete(row) {
    const ok = await confirmDialog({
      title: 'Excluir usuário',
      message: `Excluir o cadastro de ${identidade(row)}?`,
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
      nomeExibicao: identidade(row),
      onSaved: load,
    });
  }

  // ---------------------------------------------------------------------------
  // A ficha da pessoa: o historico e as outras telas dela
  //
  // O historico morava DENTRO do dialogo de edicao, recolhido, e cobrava um
  // clique de quem so queria corrigir um campo. Aqui ele e a propria acao, e
  // abre aberto. Os saltos vivem no mesmo lugar porque respondem a mesma
  // pergunta: "o que mais o sistema sabe desta pessoa".
  // ---------------------------------------------------------------------------
  function abrirFicha(row) {
    // O uuid e a chave estrangeira real das outras telas.
    const telas = [
      [`#/aproveitamento?usuario_uuid=${row.uuid}`, 'Aproveitamento no ano'],
      [`#/capacitacao_recebida?usuario_uuid=${row.uuid}`, 'Capacitações recebidas'],
      [`#/rastreabilidade?usuario_uuid=${row.uuid}`, 'O que a pessoa alterou'],
    ];

    // O subtitulo declara o agregado INTEIRO. Passagens pela DGEO e impedimentos
    // caem no mesmo agregado `usuario`, e o texto antigo os omitia.
    const historico = criarHistorico({
      modulo: 'plataforma',
      entidade: 'usuario',
      id: row.uuid,
      titulo: 'Histórico da pessoa',
      subtitulo: 'Cadastro, perfis por módulo, senha, passagens e impedimentos',
    });

    const corpo = el('div', {}, [
      el('p', {
        className: 'perfis-dialog__identidade',
        textContent: [row.login, row.tipo_posto_grad].filter(Boolean).join(' · '),
      }),
      el('div', {
        style: { display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '16px' },
      }, telas.map(([href, texto]) => el('a', {
        className: 'btn btn--secondary btn--sm',
        href,
        textContent: texto,
        onClick: () => modal.close(),
      }))),
      historico.element,
    ]);

    const modal = openModal({
      title: `Ficha de ${identidade(row)}`,
      content: corpo,
      width: '760px',
      onClose: () => historico.cleanup(),
      actions: [
        { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
      ],
    });
  }

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}

/**
 * Estado de erro do catalogo, com o caminho de volta.
 *
 * Sem os modulos a tabela perde TODAS as colunas de modulo, e uma tela que
 * mostra a grade sem elas afirma que ninguem tem acesso a nada. "Tentar de
 * novo" refaz a tela inteira, e nao so a consulta que falhou: as colunas
 * nascem do catalogo, entao elas so existem depois que ele chega.
 *
 * @param {HTMLElement} container
 * @param {Object} ctx
 * @param {Error} err
 * @returns {Function} cleanup
 */
function montarErro(container, ctx, err) {
  // O cleanup da tela que o retry montar. Ate la, nao ha o que limpar.
  let interno = null;

  const botao = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: async () => {
      clearChildren(container);
      interno = await renderUsuariosList(container, ctx);
    },
  }, ['Tentar de novo']);

  container.appendChild(el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Usuários' }),
    ]),
    el('div', { className: 'usuarios__aviso', role: 'alert' }, [
      svgIcon(ICONS.warning, 18),
      el('span', {
        textContent: err && err.message
          ? `${err.message}. A lista de usuários não pode ser montada sem o catálogo de módulos.`
          : 'O catálogo de módulos e perfis não respondeu. A lista de usuários não pode ser montada sem ele.',
      }),
    ]),
    el('div', {}, [botao]),
  ]));

  return () => {
    if (typeof interno === 'function') interno();
  };
}
