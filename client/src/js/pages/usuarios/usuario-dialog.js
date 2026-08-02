import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { criarHistorico } from '@components/historico/historico.js';
import {
  createTextField,
  createSelectField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { criarUsuario, atualizarUsuario } from '@services/plataforma-service.js';

/**
 * Criar ou editar uma pessoa (#/usuarios), do administrador global.
 *
 * Existe desde 2026-08-02, quando a autenticação veio para dentro do SCA: até
 * ali o SCA não criava ninguém, só espelhava o Auth Server pelo par
 * importar/sincronizar, e cadastrar gente era trabalho em DOIS sistemas.
 *
 * A SENHA só aparece na criação. Trocar senha depois tem dois caminhos, e
 * nenhum deles é este: o dono troca a dele em #/perfil (informando a vigente), e
 * o administrador usa "Resetar senha" na lista, que a devolve para o login. Um
 * campo de senha aqui seria um terceiro caminho, sem a senha atual e sem o aviso
 * de que a nova é adivinhável.
 *
 * @param {Object} opts
 * @param {Object|null} [opts.usuario] - linha da lista para editar (null cria)
 * @param {Array<{code:number, nome:string, nome_abrev:string}>} opts.postosGrad
 * @param {Function} opts.onSaved - recarrega a lista
 */
export function abrirUsuarioDialog({ usuario = null, postosGrad = [], onSaved }) {
  const edicao = Boolean(usuario);

  const loginField = createTextField({
    label: 'Login',
    required: true,
    value: usuario?.login ?? '',
    placeholder: 'Ex.: sgt.silva',
    helpText: edicao
      ? 'Trocar o login troca o nome de usuário do login desta pessoa.'
      : 'É o nome de usuário do login. Também é a senha que o reset devolve.',
  });

  // Só na criação: ver o comentário do cabeçalho.
  const senhaField = edicao ? null : createTextField({
    label: 'Senha inicial',
    required: true,
    type: 'password',
    helpText: 'Combine com a pessoa que ela troque a senha no primeiro acesso, em "Meu perfil".',
  });

  const nomeField = createTextField({
    label: 'Nome completo',
    required: true,
    value: usuario?.nome ?? '',
  });

  const nomeGuerraField = createTextField({
    label: 'Nome de guerra',
    required: true,
    value: usuario?.nome_guerra ?? '',
  });

  const postoField = createSelectField({
    label: 'Posto/Graduação',
    required: true,
    options: (postosGrad || []).map(p => ({ value: p.code, label: p.nome })),
    value: usuario?.tipo_posto_grad_id ?? null,
    placeholder: 'Selecione...',
  });

  const ativoField = createCheckboxField({
    label: 'Ativo',
    // Quem nasce inativo não entra: cadastrar alguém desligado é a exceção.
    checked: edicao ? Boolean(usuario.ativo) : true,
    helpText: 'Desativar é o que se faz com quem sai: quem já trabalhou no sistema não se exclui.',
  });

  const adminField = createCheckboxField({
    label: 'Administrador global',
    checked: edicao ? Boolean(usuario.administrador) : false,
    helpText: 'Passa em TODOS os módulos e em todos os níveis, independente dos perfis.',
  });

    // Histórico de alterações, RECOLHIDO e só na edição.
    //
    // Recolhido porque o diálogo já é um formulário cheio: aberto, ele cobraria
    // uma consulta de quem só veio corrigir um campo. Só na edição porque num
    // cadastro novo não há o que mostrar.
    const historico = edicao
      ? criarHistorico({
        modulo: 'plataforma',
        entidade: 'usuario',
        id: usuario.uuid,
        titulo: 'Histórico de alterações',
        subtitulo: 'Alteracoes no cadastro, no perfil por modulo e na senha',
        recolhido: true,
      })
      : null;

  const content = el('div', { className: 'form-grid' }, [
    loginField.element,
    senhaField ? senhaField.element : null,
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    nomeGuerraField.element,
    postoField.element,
    ativoField.element,
    adminField.element,
    // Criar NÃO libera módulo nenhum: sem linha em usuario_perfil a pessoa entra
    // e não vê nada. Conceder continua sendo ato explícito, na tela de perfis.
    edicao ? null : el('p', {
      className: 'form-grid__full usuario-dialog__nota',
      textContent: 'Criar a pessoa não concede acesso a módulo nenhum. '
        + 'O acesso é dado depois, em "Definir perfis por módulo".',
    }),
    historico ? el('div', { className: 'form-grid__full' }, [historico.element]) : null,
  ]);

  let salvando = false;

  const modal = openModal({
    title: edicao ? 'Editar usuário' : 'Novo usuário',
    content,
    width: '620px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (salvando) return;
          if (!valido()) return;

          salvando = true;
          salvarBtn.disabled = true;
          try {
            if (edicao) {
              await atualizarUsuario(usuario.uuid, corpoEdicao());
              showSuccess('Usuário atualizado com sucesso');
            } else {
              await criarUsuario(corpoCriacao());
              showSuccess('Usuário criado com sucesso');
            }
            close();
            await onSaved();
          } catch (err) {
            salvando = false;
            salvarBtn.disabled = false;
            showError(err.message || 'Erro ao salvar usuário');
          }
        },
      },
    ],
  });

  const salvarBtn = modal.element.querySelector('.modal__footer .btn--primary');

  /**
   * Campo vazio é RECUSADO aqui, e não mandado vazio: o servidor lê a ausência
   * como "não mexe neste campo" (preserveOmitted), então mandar '' para
   * preencher o corpo seria pedir para apagar o nome de quem só mudou de posto.
   * @returns {boolean}
   */
  function valido() {
    const obrigatorios = [
      [loginField, 'Informe o login'],
      [nomeField, 'Informe o nome completo'],
      [nomeGuerraField, 'Informe o nome de guerra'],
    ];
    if (senhaField) obrigatorios.push([senhaField, 'Informe a senha inicial']);

    let ok = true;
    for (const [campo, mensagem] of obrigatorios) {
      const vazio = !campo.getValue();
      campo.setError(vazio ? mensagem : null);
      if (vazio) ok = false;
    }

    const posto = postoField.getValue();
    postoField.setError(posto === null ? 'Escolha o posto ou a graduação' : null);
    if (posto === null) ok = false;

    return ok;
  }

  function corpoCriacao() {
    return {
      login: loginField.getValue(),
      senha: senhaField.getValue(),
      nome: nomeField.getValue(),
      nome_guerra: nomeGuerraField.getValue(),
      tipo_posto_grad_id: Number(postoField.getValue()),
      administrador: adminField.getValue(),
      ativo: ativoField.getValue(),
    };
  }

  /**
   * Só `administrador` e `ativo` são obrigatórios; os campos de identidade vão
   * apenas quando MUDARAM. É o mesmo contrato que os botões de alternar da lista
   * já usavam, e é o que permite ao servidor preservar o que não veio.
   */
  function corpoEdicao() {
    const corpo = {
      administrador: adminField.getValue(),
      ativo: ativoField.getValue(),
    };

    const identidade = [
      ['login', loginField.getValue(), usuario.login],
      ['nome', nomeField.getValue(), usuario.nome],
      ['nome_guerra', nomeGuerraField.getValue(), usuario.nome_guerra],
      ['tipo_posto_grad_id', Number(postoField.getValue()), usuario.tipo_posto_grad_id],
    ];
    for (const [chave, novo, atual] of identidade) {
      if (novo !== atual) corpo[chave] = novo;
    }

    return corpo;
  }
}
