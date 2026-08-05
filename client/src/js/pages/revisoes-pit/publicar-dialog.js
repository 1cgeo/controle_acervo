import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { showSuccess, showError } from '@utils/toast.js';
import { toIsoDate } from '@utils/format.js';
import { createDateField } from '@components/form-fields/form-fields.js';
import { publicarRevisao } from '@services/plataforma-service.js';

/**
 * PUBLICAR a revisão do PIT: o ato que a faz passar a reger.
 *
 * DIÁLOGO PRÓPRIO, e não um campo do formulário de metadados. Publicar é um ATO:
 * como campo, alguém publicaria sem perceber ao corrigir o nome do assinante.
 * `pit.revisao.data_vigencia` nula é o que define o rascunho, e preenchê-la é
 * publicar.
 *
 * A DATA PODE SER RETROATIVA, e às vezes tem de ser: o R1 de 2026 foi assinado
 * em 14/05 e o documento é de 11/05. Quem escolhe é quem publica.
 *
 * @param {Object} opcoes
 * @param {{id:number, codigo:string, ano:number, data_assinatura:?string}} opcoes.revisao
 * @param {number} opcoes.alteracoes - quantas metas a revisão altera.
 * @param {Function} [opcoes.onPublicado]
 */
export function abrirPublicarRevisao({ revisao, alteracoes = 0, onPublicado = null } = {}) {
  // `toIsoDate`, e NUNCA `new Date().toISOString()`: o ISO é em UTC, e em UTC-3
  // toda hora a partir das 21:00 devolve o dia SEGUINTE. Aqui isso é o dia em
  // que a revisão passa a reger: publicar às 21h30 de 4 de agosto propunha 5 de
  // agosto, e o relatório do dia 4 continuaria reportando a revisão anterior.
  const hoje = toIsoDate(new Date());

  const vigenciaField = createDateField({
    label: 'Rege a partir de',
    required: true,
    value: revisao.data_assinatura
      ? String(revisao.data_assinatura).slice(0, 10)
      : hoje,
    helpText: 'O relatório de um mês anterior a esta data continua reportando '
      + 'a revisão que estava no ar naquele mês.',
  });

  let publicando = false;

  return openModal({
    title: `Publicar a revisão ${revisao.codigo} de ${revisao.ano}`,
    width: '520px',
    content: el('div', {}, [
      el('p', {
        className: 'rpcm-aviso__nota',
        style: { marginBottom: '12px' },
        textContent: `A revisão passa a reger, com ${alteracoes} alteração(ões). `
          + 'Depois disso ela continua editável, mas só para consertar a '
          + 'TRANSCRIÇÃO do documento assinado, com motivo. Mudança de plano é '
          + 'revisão nova.',
      }),
      vigenciaField.element,
    ]),
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Publicar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (publicando) return;
          vigenciaField.setError(null);

          const vigencia = vigenciaField.getValue();
          if (!vigencia) {
            vigenciaField.setError('Informe a data de vigência');
            return;
          }

          publicando = true;
          try {
            const r = await publicarRevisao(revisao.id, { data_vigencia: vigencia });
            showSuccess(`Revisão publicada com ${r.alteracoes} alteração(ões)`);
            close();
            if (onPublicado) onPublicado();
          } catch (err) {
            // O modal FICA ABERTO: a data digitada continua na tela, e o motivo
            // do servidor diz o que corrigir.
            showError(err.message || 'Erro ao publicar a revisão');
          } finally {
            publicando = false;
          }
        },
      },
    ],
  });
}
