import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createSelectField,
  createTextField,
  createNumberField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  getRpnp,
  createRpnp,
  updateRpnp,
  getNotasEmpenho,
} from '@modules/orcamento/services/orcamento-service.js';
import { getAno } from '@modules/orcamento/store/year-store.js';
import { paraId, formatCurrency, toNumber } from '@utils/format.js';
import { criarHistorico } from '@components/historico/historico.js';

/**
 * Abre o dialog de criar/editar RPNP (Restos a Pagar Não Processados).
 * Alimenta a subseção 4.3 do RPCMTec. A nota de empenho vinculada e opcional;
 * quando a NE nao esta no sistema, usa-se empenho_label como rotulo livre do
 * empenho.
 * @param {Object} options
 * @param {number|null} [options.rpnpId] - id do RPNP existente para editar (null cria novo)
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export async function openRpnpDialog({ rpnpId = null, onSaved = null } = {}) {
  const isEdit = rpnpId !== null && rpnpId !== undefined;

  let notasEmpenho = [];
  let rpnp = null;

  try {
    notasEmpenho = await getNotasEmpenho();
    if (isEdit) rpnp = await getRpnp(rpnpId);
  } catch (err) {
    showError(err.message || 'Erro ao carregar dados do RPNP');
    return;
  }

  // Ano do RPNP: decide quais NEs podem ser vinculadas.
  const anoRpnp = isEdit ? rpnp.ano : getAno();

  // Resto a pagar e SEMPRE de exercicio anterior, entao a NE do proprio ano nao
  // entra. O rotulo antigo era so `ne.numero`, que em producao vale
  // 'RPCA-400267', enquanto os rotulos gravados no RPNP sao '2025NE000001': as
  // duas numeracoes nao casam e ninguem achava a NE certa. Ano, numero e valor
  // dao os tres sinais que o operador confere no SIAFI.
  const neVinculada = rpnp?.nota_empenho_id ?? null;
  const neOptions = (notasEmpenho || [])
    // A NE ja vinculada fica na lista mesmo fora do filtro, senao editar outro
    // campo apagaria o vinculo em silencio.
    .filter(ne => String(ne.id) === String(neVinculada)
      || anoRpnp == null
      || toNumber(ne.ano) < toNumber(anoRpnp))
    .sort((a, b) => toNumber(b.ano) - toNumber(a.ano))
    .map(ne => ({
      value: ne.id,
      label: `${ne.ano ?? '?'} - ${ne.numero ?? `NE ${ne.id}`} - ${formatCurrency(ne.valor_empenhado)}`,
    }));

  // ---- Campos ----
  const notaEmpenhoField = createSelectField({
    label: 'Nota de empenho',
    options: neOptions,
    value: rpnp?.nota_empenho_id ?? undefined,
  });
  const empenhoLabelField = createTextField({
    label: 'Rótulo do empenho',
    // 60 e o limite da coluna (er/orcamento.sql:213, VARCHAR(60)). A tela
    // aceitava 255 e o banco cortava a diferenca com erro no salvar.
    maxLength: 60,
    placeholder: 'Ex.: 2023NE000261 (PI K1...)',
    value: rpnp?.empenho_label ?? '',
    helpText: 'Use quando a NE não estiver cadastrada no sistema.',
  });
  const finalidadeField = createTextareaField({
    label: 'Finalidade',
    value: rpnp?.finalidade ?? '',
  });
  const valorEmpenhadoField = createNumberField({
    label: 'Valor empenhado',
    min: 0,
    step: 0.01,
    value: rpnp?.valor_empenhado ?? undefined,
  });
  const valorALiquidarField = createNumberField({
    label: 'Valor a liquidar',
    min: 0,
    step: 0.01,
    value: rpnp?.valor_a_liquidar ?? undefined,
  });

  const historico = isEdit
    ? criarHistorico({
      modulo: 'orcamento',
      entidade: 'rpnp',
      id: rpnpId,
      titulo: 'Histórico do RPNP',
      subtitulo: 'Empenho, finalidade e valores',
      recolhido: true,
    })
    : null;

  const content = el('div', { className: 'form-grid' }, [
    notaEmpenhoField.element,
    el('div', { className: 'form-grid__full' }, [empenhoLabelField.element]),
    el('div', { className: 'form-grid__full' }, [finalidadeField.element]),
    valorEmpenhadoField.element,
    valorALiquidarField.element,
    historico
      ? el('div', { className: 'form-grid__full' }, [historico.element])
      : null,
  ].filter(Boolean));

  let saving = false;

  openModal({
    title: isEdit ? 'Editar RPNP' : 'Novo RPNP',
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          const body = {
            ano: anoRpnp,
            // paraId: o select devolve o id como TEXTO e o schema cobra
            // Joi.number().integer().strict().
            nota_empenho_id: paraId(notaEmpenhoField.getValue()),
            empenho_label: empenhoLabelField.getValue() || null,
            finalidade: finalidadeField.getValue() || null,
            valor_empenhado: valorEmpenhadoField.getValue(),
            valor_a_liquidar: valorALiquidarField.getValue(),
          };

          saving = true;
          try {
            if (isEdit) {
              await updateRpnp(rpnpId, body);
              showSuccess('RPNP atualizado com sucesso');
            } else {
              await createRpnp(body);
              showSuccess('RPNP criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar RPNP');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
