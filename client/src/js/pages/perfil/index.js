import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { meusAcessos } from '@store/auth-store.js';
import {
  createTextField,
  createSelectField,
} from '@components/form-fields/form-fields.js';
import {
  getMeuPerfil,
  atualizarMeuPerfil,
  alterarMinhaSenha,
  getPostosGrad,
  getMeuPeriodoEfetivo,
  getMeuImpedimento,
} from '@services/plataforma-service.js';
// A MESMA ficha da tela `#/aproveitamento`, com a rota do PRÓPRIO injetada. Ver
// o bloco "Meu aproveitamento" mais abaixo.
import {
  criarFichaEfetivo,
  API_PROPRIO,
} from '@pages/aproveitamento/militar-dialog.js';

/**
 * Meu perfil (#/perfil). Tela de PLATAFORMA de qualquer pessoa logada.
 *
 * É o Único caminho pelo qual alguém troca a PRÓPRIA senha. Sem ela, o único
 * jeito seria o administrador resetar a de todo mundo.
 *
 * São DOIS formulários separados, e não um só com um botão. O cadastro
 * (`PUT /usuarios/perfil`) e a senha (`PUT /usuarios/perfil/senha`) são rotas
 * diferentes porque só a segunda exige a senha vigente; num formulário único,
 * corrigir o nome de guerra passaria a pedir a senha atual.
 *
 * O LOGIN não se edita aqui: quem a pessoa é, e o que ela pode, é do
 * administrador. Fosse editável, "editar meu perfil" seria o caminho para se
 * promover. Ele aparece assim mesmo, desabilitado, porque é o que ela digita
 * para entrar e some da tela em qualquer outro lugar.
 *
 * A TERCEIRA SEÇÃO É "MEUS ACESSOS", e ela é a razão de esta tela ser a porta de
 * entrada de quem ainda não tem perfil nenhum. Só aqui a pessoa descobre o que
 * pode e, quando não pode nada, o que fazer a respeito: pedir a um gerente o
 * acesso ao módulo de interesse. Sem ela, a conta recém-criada entrava, não via
 * nada e não tinha como saber se o problema era com ela ou com o sistema.
 *
 * Os acessos saem do STORE, e não de uma rota nova: são os mesmos `perfis` que o
 * `POST /api/login` devolveu, e que o `sincronizarSessao()` reconfere a cada
 * boot. Uma rota só para repetir o que a sessão já sabe seria uma segunda fonte
 * da mesma verdade, e as duas divergiriam no dia da concessão.
 *
 * A QUARTA SEÇÃO É "MEU APROVEITAMENTO", e ela nasceu em 2026-08-08 junto com a
 * régua que tirou a tela `#/aproveitamento` do operador: cada pessoa passou a
 * cuidar do próprio aproveitamento aqui, e o dado da Divisão inteira ficou com
 * quem responde por ela. O porquê completo está no bloco da seção, mais abaixo.
 *
 * A ORDEM DAS QUATRO tem razão: acessos, aproveitamento, dados, senha. Quem abre
 * esta página abre por causa das duas primeiras (o que eu posso, e o que eu
 * preciso declarar); corrigir o nome de guerra e trocar a senha são atos raros, e
 * ficam depois.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderPerfil(container, _ctx) {
  let disposed = false;

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Meu perfil' }),
    ]),
    el('div', { className: 'perfil__carregando', textContent: 'Carregando...' }),
  ]);
  container.appendChild(page);

  let perfil = null;
  let postosGrad = [];

  try {
    [perfil, postosGrad] = await Promise.all([getMeuPerfil(), getPostosGrad()]);
  } catch (err) {
    if (disposed) return () => {};
    page.querySelector('.perfil__carregando').textContent =
      err.message || 'Erro ao carregar o perfil';
    return () => { disposed = true; };
  }
  if (disposed) return () => {};

  postosGrad = postosGrad || [];
  page.querySelector('.perfil__carregando').remove();

  // ---------------------------------------------------------------------------
  // Cadastro: nome, nome de guerra e posto/graduação
  // ---------------------------------------------------------------------------
  const loginField = createTextField({
    label: 'Login',
    value: perfil.login || '',
    disabled: true,
    helpText: 'Só o administrador troca o login. Ele é o seu nome de usuário no SCA.',
  });

  const nomeField = createTextField({
    label: 'Nome completo',
    required: true,
    value: perfil.nome || '',
  });

  const nomeGuerraField = createTextField({
    label: 'Nome de guerra',
    required: true,
    value: perfil.nome_guerra || '',
  });

  const postoField = createSelectField({
    label: 'Posto/Graduação',
    required: true,
    options: postosGrad.map(p => ({ value: p.code, label: p.nome })),
    value: perfil.tipo_posto_grad_id ?? null,
    placeholder: 'Selecione...',
  });

  const salvarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'submit',
  }, [svgIcon(ICONS.check, 16), 'Salvar alterações']);

  const formCadastro = el('form', {
    className: 'perfil__form',
    onSubmit: (e) => {
      e.preventDefault();
      salvarCadastro();
    },
  }, [
    el('div', { className: 'form-grid' }, [
      loginField.element,
      postoField.element,
      el('div', { className: 'form-grid__full' }, [nomeField.element]),
      el('div', { className: 'form-grid__full' }, [nomeGuerraField.element]),
    ]),
    el('div', { className: 'perfil__acoes' }, [salvarBtn]),
  ]);

  async function salvarCadastro() {
    const nome = nomeField.getValue();
    const nomeGuerra = nomeGuerraField.getValue();
    const posto = postoField.getValue();

    nomeField.setError(nome ? null : 'Informe o nome completo');
    nomeGuerraField.setError(nomeGuerra ? null : 'Informe o nome de guerra');
    postoField.setError(posto === null ? 'Escolha o posto ou a graduação' : null);
    if (!nome || !nomeGuerra || posto === null) return;

    salvarBtn.disabled = true;
    try {
      await atualizarMeuPerfil({
        nome,
        nome_guerra: nomeGuerra,
        tipo_posto_grad_id: Number(posto),
      });
      if (disposed) return;
      showSuccess('Perfil atualizado com sucesso');
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao atualizar o perfil');
    } finally {
      salvarBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Senha
  //
  // A senha ATUAL é exigida pelo servidor, e é o que impede uma sessão esquecida
  // aberta de virar uma conta tomada. A CONFIRMAÇÃO é só daqui: o servidor não a
  // recebe, ela existe para a pessoa não se trancar fora por um erro de digitação
  // numa senha que ninguém vê enquanto digita.
  // ---------------------------------------------------------------------------
  const senhaAtualField = createTextField({
    label: 'Senha atual',
    required: true,
    type: 'password',
  });

  const senhaNovaField = createTextField({
    label: 'Nova senha',
    required: true,
    type: 'password',
  });

  const senhaConfirmaField = createTextField({
    label: 'Repita a nova senha',
    required: true,
    type: 'password',
    helpText: 'Conferida aqui na tela, para você não se trancar fora por um erro de digitação.',
  });

  const trocarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'submit',
  }, [svgIcon(ICONS.key, 16), 'Alterar senha']);

  const formSenha = el('form', {
    className: 'perfil__form',
    onSubmit: (e) => {
      e.preventDefault();
      trocarSenha();
    },
  }, [
    el('div', { className: 'form-grid' }, [
      el('div', { className: 'form-grid__full' }, [senhaAtualField.element]),
      senhaNovaField.element,
      senhaConfirmaField.element,
    ]),
    el('div', { className: 'perfil__acoes' }, [trocarBtn]),
  ]);

  async function trocarSenha() {
    const atual = senhaAtualField.getValue();
    const nova = senhaNovaField.getValue();
    const confirmacao = senhaConfirmaField.getValue();

    senhaAtualField.setError(atual ? null : 'Informe a senha atual');
    senhaNovaField.setError(nova ? null : 'Informe a nova senha');
    senhaConfirmaField.setError(confirmacao ? null : 'Repita a nova senha');
    if (!atual || !nova || !confirmacao) return;

    if (nova !== confirmacao) {
      senhaConfirmaField.setError('As duas senhas não são iguais');
      return;
    }

    trocarBtn.disabled = true;
    try {
      await alterarMinhaSenha({ senha_atual: atual, senha_nova: nova });
      if (disposed) return;
      // A sessão continua valendo: o token não carrega a senha, então trocá-la
      // não expulsa quem está usando o sistema neste momento.
      showSuccess('Senha alterada com sucesso');
      senhaAtualField.setValue('');
      senhaNovaField.setValue('');
      senhaConfirmaField.setValue('');
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao alterar a senha');
    } finally {
      trocarBtn.disabled = false;
    }
  }

  // ---------------------------------------------------------------------------
  // Meus acessos
  //
  // A LISTA VEM PRIMEIRO na tela de quem não tem nenhum: para essa pessoa é a
  // única informação nova da página, e a que diz o que fazer em seguida.
  // ---------------------------------------------------------------------------
  const acessos = meusAcessos();

  const listaAcessos = acessos.length
    ? el('ul', { className: 'perfil__acessos' }, acessos.map(a => el('li', {
      className: 'perfil__acesso',
    }, [
      el('span', { className: 'perfil__acesso-modulo', textContent: a.nome }),
      el('span', { className: 'perfil__acesso-perfil', textContent: a.perfil }),
    ])))
    : el('div', { className: 'perfil__sem-acesso' }, [
      el('p', {
        className: 'perfil__sem-acesso-titulo',
        textContent: 'Você ainda não tem acesso a nenhum módulo do sistema.',
      }),
      // "ADMINISTRADOR", e não "gerente": é o administrador global quem concede
      // perfil (`/api/usuarios` é `verifyAdmin`), e mandar pedir a quem não pode
      // dar faria a pessoa percorrer o caminho errado antes de chegar ao certo.
      el('p', {
        className: 'perfil__sem-acesso-texto',
        // Os cinco nomes seguem `dominio.modulo.nome`, que é o que a tela de
        // concessão mostra ao administrador: a pessoa pede pelo nome que ele vê.
        // Note que o menu chama a seção de Produção de "PIT", e aqui não: o
        // módulo continua sendo Produção, porque guarda também a capacitação
        // ministrada.
        textContent: 'Peça ao administrador do sistema o acesso ao módulo de interesse '
          + '(Acervo, Mapoteca, Orçamento, Produção ou Efetivo). '
          + 'Enquanto isso, esta página é sua: você pode corrigir seus dados e trocar sua senha.',
      }),
    ]);

  // ---------------------------------------------------------------------------
  // Meu aproveitamento
  //
  // POR QUE ESTA SEÇÃO EXISTE. Em 2026-08-08 a escrita da passagem e do
  // impedimento DOS OUTROS subiu para o gerente do módulo Efetivo, e a tela
  // `#/aproveitamento` -- que mostra a Divisão inteira, nominalmente, com licença
  // de saúde e função acumulada de cada um -- deixou de abrir para o operador.
  // Sem esta seção, o efeito colateral seria que ninguém abaixo do gerente teria
  // como declarar o PRÓPRIO impedimento, e o aproveitamento da subseção 6.1 do
  // RPCMTec depende de cada um declarar o seu. A régua nova tirou o alheio de
  // quem não responde por ele e devolveu o próprio a todo mundo; esta seção é a
  // segunda metade.
  //
  // A FICHA É A MESMA de `#/aproveitamento`, com a rota trocada: `criarFichaEfetivo`
  // desenha as duas listas e abre os mesmos diálogos, e `API_PROPRIO` os faz
  // gravar em `/efetivo/meu_periodo` e `/efetivo/meu_impedimento`, onde o dono sai
  // do token. Copiar os formulários daria uma segunda cópia do par campo-data mais
  // caixa "Sem previsão de saída" e das validações que espelham o banco, e a cópia
  // menos olhada seria justamente esta.
  //
  // CARREGADA À PARTE, e não junto do `getMeuPerfil`. É o defeito que a tela do
  // aproveitamento tinha: uma chamada que pode recusar dentro do mesmo
  // `Promise.all` derruba a página inteira. Aqui a falha fica dentro da seção, e
  // os dois formulários continuam de pé.
  //
  // SÓ PARA QUEM TEM ACESSO A ALGUM MÓDULO, porque é isso que as rotas exigem
  // (`verifyAcesso`). Quem não tem lê acima o pedido de acesso, e oferecer-lhe um
  // botão que responderia 403 seria prometer o que a conta ainda não pode.
  const temAcesso = acessos.length > 0;

  const corpoAproveitamento = el('div', {
    className: 'perfil__carregando',
    textContent: 'Carregando...',
  });

  const secaoAproveitamento = el('section', { className: 'perfil__secao' }, [
    el('h2', {
      className: 'perfil__secao-titulo',
      textContent: 'Meu aproveitamento',
    }),
    el('p', {
      className: 'perfil__secao-ajuda',
      textContent: 'Sua passagem pela DGEO e o que o tira do trabalho da Divisão '
        + 'sem tirá-lo dela (função acumulada, licença, curso, férias). É daqui '
        + 'que sai o aproveitamento do efetivo no relatório da Divisão.',
    }),
    corpoAproveitamento,
  ]);

  page.appendChild(el('div', { className: 'perfil' }, [
    el('section', { className: 'perfil__secao' }, [
      el('h2', { className: 'perfil__secao-titulo', textContent: 'Meus acessos' }),
      listaAcessos,
    ]),
    ...(temAcesso ? [secaoAproveitamento] : []),
    el('section', { className: 'perfil__secao' }, [
      el('h2', { className: 'perfil__secao-titulo', textContent: 'Meus dados' }),
      formCadastro,
    ]),
    el('section', { className: 'perfil__secao' }, [
      el('h2', { className: 'perfil__secao-titulo', textContent: 'Trocar senha' }),
      formSenha,
    ]),
  ]));

  /**
   * As duas listas do próprio, sempre juntas.
   *
   * O AVISO "fora de qualquer passagem" da ficha depende das DUAS: um impedimento
   * que não cruza passagem nenhuma não desconta nada, e é a lista de passagens que
   * responde isso. Buscar uma sem a outra faria a ficha afirmar sobre o que não
   * está na mesa.
   */
  async function carregarAproveitamento() {
    const [periodos, impedimentos] = await Promise.all([
      getMeuPeriodoEfetivo(),
      getMeuImpedimento(),
    ]);
    return { periodos: periodos || [], impedimentos: impedimentos || [] };
  }

  async function montarAproveitamento() {
    let listas;
    try {
      listas = await carregarAproveitamento();
    } catch (err) {
      if (disposed) return;
      // O ERRO FICA NO LUGAR DA LISTA, e não num toast que some em seis segundos:
      // a seção vazia se leria como "não tenho nada cadastrado", que é a
      // afirmação oposta.
      corpoAproveitamento.className = 'perfil__erro';
      corpoAproveitamento.textContent =
        err.message || 'Erro ao carregar o seu aproveitamento';
      return;
    }
    if (disposed) return;

    const ficha = criarFichaEfetivo({
      usuarioUuid: perfil.uuid,
      // SEM `nomeMilitar`: na própria página, "excluir a passagem de Fulano" é o
      // nome do Fulano escrito à toa para o Fulano.
      nomeMilitar: null,
      api: API_PROPRIO,
      periodos: listas.periodos,
      impedimentos: listas.impedimentos,
      // SEM RECORTE DE ANO nas rotas do próprio, e por isso o texto do vazio não
      // pode dizer "neste ano": a lista traz a vida inteira da pessoa na Divisão.
      vazios: {
        periodos: 'Você ainda não tem passagem pela DGEO cadastrada. '
          + 'Se já está na Divisão, cadastre a sua.',
        impedimentos: 'Nenhum impedimento cadastrado.',
      },
      // Cada gravação relê as duas listas e devolve as novas: é assim que a ficha
      // se repinta sem a tela inteira ser reconstruída.
      onSaved: async () => {
        try {
          return await carregarAproveitamento();
        } catch (err) {
          showError(err.message || 'Erro ao recarregar o seu aproveitamento');
          return null;
        }
      },
    });

    corpoAproveitamento.replaceWith(ficha.element);
  }

  if (temAcesso) await montarAproveitamento();

  return () => {
    disposed = true;
  };
}
