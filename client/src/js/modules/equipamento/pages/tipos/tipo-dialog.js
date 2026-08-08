import { el } from '@utils/dom.js';
import { showSuccess } from '@utils/toast.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createNumberField,
  createTextareaField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { createTipo, updateTipo } from '@modules/equipamento/services/equipamento-service.js';
import { gravarNoModal } from '@modules/equipamento/dialogo-comum.js';

/**
 * Cadastro e alteração de TIPO DE EQUIPAMENTO (do operador).
 *
 * O tipo é CADASTRO, e não domínio: o `id` é SERIAL, muda de instalação para
 * instalação, e por isso NÃO vira constante em `domain_constants.js`. Quem
 * guarda o vínculo é o `tipo_id` do bem, nunca o nome.
 *
 * A VIDA ÚTIL AQUI É O PADRÃO DE TODOS OS BENS DAQUELE TIPO. O bem só a
 * sobrescreve se declarar a própria, e a lista marca o valor herdado com
 * "do tipo". Mudar este número muda todos os bens que não declararam nada.
 *
 * @param {Object} opcoes
 * @param {Object|null} [opcoes.tipo]
 * @param {Function} [opcoes.onSaved]
 */
export function abrirTipoDialog({ tipo = null, onSaved } = {}) {
  const edicao = Boolean(tipo);

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    maxLength: 255,
    placeholder: 'Ex.: Estação Total',
    value: tipo?.nome ?? '',
    helpText: 'O nome é único: dois tipos não podem se chamar igual.',
  });

  const vidaUtilField = createNumberField({
    label: 'Vida útil (meses)',
    min: 1,
    step: 1,
    value: tipo?.vida_util_meses ?? undefined,
    // MESES, e não anos, porque é assim que a coluna guarda
    // (`vida_util_meses SMALLINT`). Os valores semeados são 60, 120 e 180.
    helpText: 'Em meses. Vale para todo bem do tipo que não declarar a própria.',
  });

  const ativoField = createCheckboxField({
    label: 'Ativo',
    checked: tipo ? tipo.ativo !== false : true,
    helpText: 'Tipo inativo não é oferecido no cadastro de bem novo, e os bens existentes ficam como estão.',
  });

  const descricaoField = createTextareaField({
    label: 'Descrição',
    rows: 3,
    value: tipo?.descricao ?? '',
  });

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    vidaUtilField.element,
    ativoField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
  ]);

  openModal({
    title: edicao ? 'Editar tipo de equipamento' : 'Novo tipo de equipamento',
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: ({ close, setOcupado }) => {
          nomeField.setError(null);
          vidaUtilField.setError(null);

          const nome = nomeField.getValue();
          if (!nome) {
            nomeField.setError('Informe o nome do tipo');
            return;
          }

          const vidaUtil = vidaUtilField.getValue();
          if (vidaUtil !== null && vidaUtil <= 0) {
            vidaUtilField.setError('A vida útil deve ser maior que zero, ou ficar em branco');
            return;
          }

          const body = {
            nome,
            descricao: descricaoField.getValue() || null,
            vida_util_meses: vidaUtil,
            ativo: ativoField.getValue(),
          };

          gravarNoModal({
            gravar: async () => {
              if (edicao) {
                await updateTipo(tipo.id, body);
                showSuccess('Tipo atualizado com sucesso');
              } else {
                await createTipo(body);
                showSuccess('Tipo cadastrado com sucesso');
              }
            },
            close,
            setOcupado,
            aoGravar: onSaved,
            erroPadrao: 'Erro ao salvar o tipo de equipamento',
          });
        },
      },
    ],
  });
}
