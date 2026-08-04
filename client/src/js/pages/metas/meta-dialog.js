import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createNumberField,
  createTextField,
  createTextareaField,
  createDateField,
  createSelectField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { criarHistorico } from '@components/historico/historico.js';
import { isAdmin } from '@store/auth-store.js';
import { createMetaPit, updateMetaPit } from '@services/plataforma-service.js';

/**
 * Criar ou editar uma meta do PIT. Só o administrador global chega aqui: o
 * backend cobra (verifyAdmin) e a lista só oferece o botão a ele.
 *
 * O ANO vem do filtro da tela ao criar, e do próprio registro ao editar. Não há
 * seletor de ano na navbar aqui, porque esta é uma tela de plataforma.
 *
 * @param {Object} options
 * @param {Object|null} [options.meta] - meta existente para editar (null cria nova)
 * @param {number} [options.ano] - ano da meta nova
 * @param {Function} [options.onSaved] - chamado após salvar com sucesso
 */
export function openMetaDialog({ meta = null, ano = null, onSaved = null } = {}) {
  const isEdit = Boolean(meta);
  const anoAlvo = isEdit ? meta.ano : (ano || new Date().getFullYear());

  const numeroMetaField = createNumberField({
    label: 'Número da meta',
    required: true,
    min: 1,
    step: 1,
    value: meta?.numero_meta ?? undefined,
  });
  const itemField = createTextField({
    label: 'Item',
    maxLength: 20,
    placeholder: 'Ex.: 4.1 (use - quando a meta não se subdivide)',
    value: meta?.item ?? '',
  });
  // OBRIGATÓRIA desde 2026-08-04: ela é a frase que a revisão do PIT declara, e
  // a coluna de `pit.meta_revisao` é NOT NULL.
  const descricaoField = createTextareaField({
    label: 'Descrição',
    required: true,
    value: meta?.descricao ?? '',
  });

  // O que o PIT PROMETE no item. Entrou em 2026-08-02, e é o que faltava para a
  // subseção 2.1 do RPCMTec sair: ela pede "Quantidade" e "Previsão de término".
  //
  // Os quatro ficam VAZIOS na linha de cabeçalho da meta, e a ajuda diz isso:
  // quem promete são os itens que ela agrupa, e uma quantidade na meta e outra
  // nos itens dela seriam dois totais para o mesmo compromisso.
  const quantidadeField = createNumberField({
    label: 'Quantidade prevista',
    min: 0,
    step: 1,
    value: meta?.quantidade_prevista ?? undefined,
    helpText: 'Deixe vazio na meta que se subdivide: quem promete são os itens.',
  });
  // DOMÍNIO FECHADO desde 2026-08-04. Era texto livre, e o resultado foram 13
  // valores para cinco coisas ('carta' e 'folha' para a mesma), mais 12 itens
  // sem unidade nenhuma. A grade assume que uma versão do acervo vale UMA
  // unidade da meta, e nada declarava isso.
  //
  // A coerência com a origem é cobrada no servidor: origem Produção e Impressão
  // exigem Folha, e Capacitação exige Capacitação.
  const unidadeField = createSelectField({
    label: 'Unidade',
    options: [
      { value: 1, label: 'Folha' },
      { value: 2, label: 'Marco' },
      { value: 3, label: 'Capacitação' },
      { value: 4, label: 'Item de acervo' },
      { value: 5, label: 'Atividade' },
    ],
    value: meta?.unidade_id ?? undefined,
    helpText: 'O que a meta conta. Vazio só na linha de cabeçalho.',
  });
  const demandanteField = createTextField({
    label: 'Demandante',
    maxLength: 255,
    placeholder: 'Ex.: COTER/DECEX',
    value: meta?.demandante ?? '',
  });
  const prazoField = createDateField({
    label: 'Previsão de término',
    value: meta?.prazo ?? '',
    helpText: 'Sai como "AGO 26" no relatório.',
  });

  // HISTÓRICO da meta, RECOLHIDO e só na edição (2026-08-04).
  //
  // Ele faltava, e era a lacuna mais aguda do sistema: o modelo de revisão do
  // PIT nasceu em 2026-08-04 para responder "por que a 4.2 virou 252", e a
  // resposta só se lia pela varredura geral, filtrando. A pergunta se faz com
  // a meta aberta na frente, e é aqui que ela agora se responde.
  //
  // O agregado 'meta' reúne quatro tabelas: a identidade (`pit.meta`), o que
  // cada revisão declarou (`pit.meta_revisao`), a execução lançada
  // (`pit.execucao`) e o de-para de mídia (`mapoteca.midia_meta_pit`). Por
  // isso o subtítulo nomeia as quatro: quem abre não deve precisar adivinhar
  // que "quantidade prevista" e "realizado" vivem em lugares diferentes.
  //
  // SÓ PARA ADMINISTRADOR, e não por escolha de tela: a rota do histórico de
  // 'plataforma' é `verifyAdmin` (o mesmo agregado guarda evento de usuário,
  // de perfil e de senha), enquanto esta tela abre para qualquer pessoa
  // logada. Mostrar o painel a quem a rota vai recusar entregaria um 403 no
  // meio do formulário.
  const historico = isEdit && isAdmin()
    ? criarHistorico({
      modulo: 'plataforma',
      entidade: 'meta',
      id: meta.id,
      titulo: 'Histórico da meta',
      subtitulo: 'Identidade, o que cada revisão do PIT declarou, execução lançada e mídia',
      recolhido: true,
    })
    : null;

  const content = el('div', { className: 'form-grid' }, [
    numeroMetaField.element,
    itemField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
    quantidadeField.element,
    unidadeField.element,
    demandanteField.element,
    prazoField.element,
    historico
      ? el('div', { className: 'form-grid__full' }, [historico.element])
      : null,
  ].filter(Boolean));

  let saving = false;

  openModal({
    title: isEdit ? `Editar meta (${anoAlvo})` : `Nova meta (${anoAlvo})`,
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          numeroMetaField.setError(null);

          const numeroMeta = numeroMetaField.getValue();

          if (numeroMeta === null || numeroMeta <= 0) {
            numeroMetaField.setError('Informe o número da meta');
            return;
          }

          descricaoField.setError(null);
          const descricao = descricaoField.getValue();
          if (!descricao) {
            descricaoField.setError('Informe a descrição da meta');
            return;
          }

          // A DESCRIÇÃO, A QUANTIDADE, O PRAZO E O DEMANDANTE são o que a DSG
          // DECLARA, e desde 2026-08-04 eles caem na revisão ABERTA do ano.
          // Mudar qualquer um deles sem revisão aberta volta 400, e a mensagem
          // do servidor diz o que fazer. A unidade e a origem são classificação
          // nossa, e mudam sem revisão.
          const payload = {
            ano: anoAlvo,
            numero_meta: numeroMeta,
            item: itemField.getValue() || null,
            descricao,
            quantidade_prevista: quantidadeField.getValue(),
            unidade_id: unidadeField.getValue(),
            demandante: demandanteField.getValue() || null,
            prazo: prazoField.getValue(),
          };

          saving = true;
          try {
            if (isEdit) {
              await updateMetaPit(meta.id, payload);
              showSuccess('Meta atualizada com sucesso');
            } else {
              await createMetaPit(payload);
              showSuccess('Meta criada com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar meta');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
