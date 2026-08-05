import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createSelectField, createTextareaField } from '@components/form-fields/form-fields.js';
import { criarHistorico } from '@components/historico/historico.js';
import { criarExercicio, atualizarExercicio } from '@services/plataforma-service.js';

// Espelha `dominio.situacao_exercicio`. Encerrado (3) faz o servidor recusar
// revisão nova naquele ano, e é o que fecha o exercício.
const SITUACOES = [
  { value: 1, label: 'Em elaboração' },
  { value: 2, label: 'Vigente' },
  { value: 3, label: 'Encerrado' },
];

/**
 * O EXERCÍCIO do PIT: o ano, a situação dele e a observação.
 *
 * É o PRIMEIRO passo do fluxo, e sem ele o ano é um beco sem saída: `pit.meta`,
 * `pit.revisao` e `pit.demanda_extra` têm chave estrangeira para
 * `pit.exercicio(ano)`, e o `criarRevisao` recusa com "o exercício de AAAA não
 * existe" antes de qualquer coisa.
 *
 * O ANO NÃO SE EDITA depois de criado: ele é a chave que os três schemas
 * referenciam, e trocá-lo órfãos o que já aponta para ele. Para corrigir um ano
 * digitado errado, exclua as revisões e crie o certo.
 *
 * ENCERRAR é mudar a situação para 'Encerrado', e não apagar: o exercício
 * encerrado continua sendo o que o relatório daqueles meses reportou.
 */
export function abrirDialogoExercicio({ exercicio = null, ano = null, onSaved = null } = {}) {
  const editando = Boolean(exercicio);
  const anoAlvo = editando ? Number(exercicio.ano) : Number(ano);

  // `placeholder: null`: a situação sempre tem um valor, e uma opção vazia aqui
  // deixaria salvar sem dizer em que estado o ano está.
  const situacaoField = createSelectField({
    label: 'Situação',
    options: SITUACOES,
    value: exercicio?.situacao_id ?? 2,
    placeholder: null,
    helpText: 'Encerrado impede revisão nova neste ano.',
  });

  const observacaoField = createTextareaField({
    label: 'Observação',
    value: exercicio?.observacao ?? '',
  });

  const historico = editando
    ? criarHistorico({
      modulo: 'plataforma',
      entidade: 'exercicio',
      id: anoAlvo,
      titulo: 'Histórico do exercício',
      subtitulo: 'Revisões do ano, publicação e anexos do documento assinado',
      recolhido: true,
    })
    : null;

  const content = el('div', { className: 'form-grid' }, [
    el('p', {
      className: 'form-help',
      textContent: editando
        ? `Exercício de ${anoAlvo}. O ano não se edita: ele é a chave que as metas e as revisões referenciam.`
        : `Abre o exercício de ${anoAlvo}. Sem ele não há como cadastrar meta nem revisão neste ano.`,
    }),
    el('div', { className: 'form-grid__full' }, [situacaoField.element]),
    el('div', { className: 'form-grid__full' }, [observacaoField.element]),
    historico ? el('div', { className: 'form-grid__full' }, [historico.element]) : null,
  ].filter(Boolean));

  let salvando = false;

  openModal({
    title: editando ? `Editar exercício ${anoAlvo}` : `Abrir exercício ${anoAlvo}`,
    content,
    width: '560px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (salvando) return;

          const body = {
            situacao_id: Number(situacaoField.getValue()),
            observacao: observacaoField.getValue() || null,
          };

          salvando = true;
          try {
            if (editando) {
              await atualizarExercicio(anoAlvo, body);
              showSuccess('Exercício atualizado');
            } else {
              await criarExercicio({ ano: anoAlvo, ...body });
              showSuccess(`Exercício de ${anoAlvo} aberto`);
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar o exercício');
          } finally {
            salvando = false;
          }
        },
      },
    ],
  });
}
