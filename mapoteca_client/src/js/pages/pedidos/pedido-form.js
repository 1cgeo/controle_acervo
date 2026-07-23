import { el } from '@utils/dom.js';
import {
  createTextField,
  createNumberField,
  createSelectField,
  createDateField,
  createTextareaField,
  createCheckboxField,
  createChipInput,
} from '@components/form-fields/form-fields.js';
import { toIsoDate } from '@utils/format.js';

/**
 * Shared pedido form (wizard steps 1-2 and the edit dialog on the details
 * page). Builds every pedido field, the two .form-grid sections and the
 * client-side validations RN02/RN03 (the backend validates them again).
 */

export const SITUACAO_PEDIDO_EM_ANDAMENTO = 3;
export const SITUACAO_PEDIDO_CONCLUIDO = 5;
export const SITUACAO_PEDIDO_CANCELADO = 6;
export const TIPO_CLIENTE_LAI = 9;

function isoDateOrEmpty(value) {
  return value ? String(value).slice(0, 10) : '';
}

/** Trimmed string -> null when empty (optional API fields). */
function orNull(value) {
  return value === '' ? null : value;
}

/**
 * Create every pedido field plus the section elements and validations.
 * @param {Object} options
 * @param {Object|null} [options.pedido] - existing pedido for pre-fill (edit)
 * @param {Array<{id:number, nome:string}>} options.clientes
 * @param {Array<{code:number, nome:string}>} options.situacoes
 * @returns {{fields:Object, basicoElement:HTMLElement, adicionalElement:HTMLElement,
 *   validateBasico:()=>boolean, validateAdicional:()=>boolean, getValues:()=>Object}}
 */
export function createPedidoFormFields({ pedido = null, clientes = [], situacoes = [], canais = [] }) {
  const fields = {
    // Etapa 1 — Básico
    cliente_id: createSelectField({
      label: 'Cliente',
      required: true,
      options: clientes.map(c => ({ value: c.id, label: c.nome })),
      value: pedido ? pedido.cliente_id : undefined,
    }),
    situacao_pedido_id: createSelectField({
      label: 'Situação',
      required: true,
      options: situacoes.map(s => ({ value: s.code, label: s.nome })),
      value: pedido ? pedido.situacao_pedido_id : undefined,
    }),
    data_pedido: createDateField({
      label: 'Data do pedido',
      required: true,
      value: pedido ? isoDateOrEmpty(pedido.data_pedido) : toIsoDate(new Date()),
    }),
    data_atendimento: createDateField({
      label: 'Data de atendimento',
      value: isoDateOrEmpty(pedido && pedido.data_atendimento),
      helpText: 'Obrigatória quando a situação é Concluído (RN02)',
    }),
    prazo: createDateField({
      label: 'Prazo',
      value: isoDateOrEmpty(pedido && pedido.prazo),
    }),
    documento_solicitacao: createTextField({
      label: 'Documento de solicitação (DIEx/Ofício)',
      value: (pedido && pedido.documento_solicitacao) || '',
      maxLength: 255,
    }),
    documento_solicitacao_nup: createTextField({
      label: 'NUP do documento',
      value: (pedido && pedido.documento_solicitacao_nup) || '',
      maxLength: 255,
    }),

    // Etapa 2 — Adicional
    ponto_contato: createTextField({
      label: 'Ponto de contato',
      value: (pedido && pedido.ponto_contato) || '',
      maxLength: 255,
    }),
    demandante: createTextField({
      label: 'Demandante',
      value: (pedido && pedido.demandante) || '',
      maxLength: 255,
      helpText: 'Quem encaminhou o pedido (ex.: CMS)',
    }),
    omds: createTextField({
      label: 'OM responsável (OMDS)',
      value: (pedido && pedido.omds) || '',
      maxLength: 255,
      helpText: 'OM responsável pelo atendimento (ex.: 1º CGEO)',
    }),
    operacao: createTextField({
      label: 'Operação',
      value: (pedido && pedido.operacao) || '',
    }),
    localizador_envio: createTextField({
      label: 'Localizador de envio (rastreio)',
      value: (pedido && pedido.localizador_envio) || '',
    }),
    previsto_pit: createCheckboxField({
      label: 'Previsto no PIT',
      checked: Boolean(pedido && pedido.previsto_pit),
    }),
    endereco_entrega: createTextareaField({
      label: 'Endereço de entrega',
      value: (pedido && pedido.endereco_entrega) || '',
      rows: 2,
    }),
    palavras_chave: createChipInput({
      label: 'Palavras-chave',
      values: (pedido && pedido.palavras_chave) || [],
    }),
    observacao_envio: createTextareaField({
      label: 'Observação de envio',
      value: (pedido && pedido.observacao_envio) || '',
      rows: 2,
    }),
    observacao: createTextareaField({
      label: 'Observação',
      value: (pedido && pedido.observacao) || '',
      rows: 2,
    }),
    motivo_cancelamento: createTextareaField({
      label: 'Motivo do cancelamento',
      value: (pedido && pedido.motivo_cancelamento) || '',
      rows: 2,
      helpText: 'Obrigatório quando a situação é Cancelado (RN03)',
    }),

    // Dados de pedido de CIVIL (LAI/órgão/empresa/pessoa) — opcionais; deixe
    // em branco para pedido de OM.
    canal_recebimento_id: createSelectField({
      label: 'Canal de recebimento (civil)',
      options: canais.map(c => ({ value: c.code, label: c.nome })),
      value: pedido ? pedido.canal_recebimento_id : undefined,
      helpText: 'Como a demanda de civil chegou (Ouvidoria/LAI, e-mail, ofício).',
    }),
    municipio: createTextField({
      label: 'Município/Área (civil)',
      value: (pedido && pedido.municipio) || '',
      maxLength: 255,
    }),
    qtd_imagens: createNumberField({
      label: 'Nº de imagens entregues (civil)',
      value: pedido && pedido.qtd_imagens != null ? pedido.qtd_imagens : null,
      min: 0,
      helpText: 'Contagem de imagens/produtos entregues (LAI não usa folha MI).',
    }),
  };

  fields.cliente_id.element.classList.add('form-grid__full');
  fields.endereco_entrega.element.classList.add('form-grid__full');
  fields.palavras_chave.element.classList.add('form-grid__full');
  fields.observacao_envio.element.classList.add('form-grid__full');
  fields.observacao.element.classList.add('form-grid__full');
  fields.motivo_cancelamento.element.classList.add('form-grid__full');

  const basicoElement = el('div', { className: 'form-grid' }, [
    fields.cliente_id.element,
    fields.situacao_pedido_id.element,
    fields.data_pedido.element,
    fields.data_atendimento.element,
    fields.prazo.element,
    fields.documento_solicitacao.element,
    fields.documento_solicitacao_nup.element,
  ]);

  const adicionalElement = el('div', { className: 'form-grid' }, [
    fields.ponto_contato.element,
    fields.demandante.element,
    fields.omds.element,
    fields.operacao.element,
    fields.localizador_envio.element,
    fields.previsto_pit.element,
    fields.endereco_entrega.element,
    fields.palavras_chave.element,
    fields.observacao_envio.element,
    fields.observacao.element,
    fields.motivo_cancelamento.element,
  ]);

  const civilElement = el('div', { className: 'form-grid' }, [
    fields.canal_recebimento_id.element,
    fields.municipio.element,
    fields.qtd_imagens.element,
  ]);

  /**
   * Validate the basic fields (required + RN02). Sets field errors.
   * @returns {boolean}
   */
  function validateBasico() {
    let ok = true;
    fields.cliente_id.setError(null);
    fields.situacao_pedido_id.setError(null);
    fields.data_pedido.setError(null);
    fields.data_atendimento.setError(null);

    if (fields.cliente_id.getValue() === null) {
      fields.cliente_id.setError('Campo obrigatório');
      ok = false;
    }
    const situacao = fields.situacao_pedido_id.getValue();
    if (situacao === null) {
      fields.situacao_pedido_id.setError('Campo obrigatório');
      ok = false;
    }
    const dataPedido = fields.data_pedido.getValue();
    if (!dataPedido) {
      fields.data_pedido.setError('Campo obrigatório');
      ok = false;
    }
    const dataAtendimento = fields.data_atendimento.getValue();
    if (situacao === SITUACAO_PEDIDO_CONCLUIDO && !dataAtendimento) {
      fields.data_atendimento.setError('Pedido Concluído exige a data de atendimento (RN02)');
      ok = false;
    }
    if (dataAtendimento && dataPedido && dataAtendimento < dataPedido) {
      fields.data_atendimento.setError('A data de atendimento deve ser igual ou posterior à data do pedido');
      ok = false;
    }
    return ok;
  }

  /**
   * Validate the additional fields (RN03). Sets field errors.
   * @returns {boolean}
   */
  function validateAdicional() {
    fields.motivo_cancelamento.setError(null);
    const situacao = fields.situacao_pedido_id.getValue();
    if (situacao === SITUACAO_PEDIDO_CANCELADO && !fields.motivo_cancelamento.getValue()) {
      fields.motivo_cancelamento.setError('Pedido Cancelado exige o motivo do cancelamento (RN03)');
      return false;
    }
    return true;
  }

  /**
   * Build the API payload (dates as 'YYYY-MM-DD', optional strings as null).
   * @returns {Object}
   */
  function getValues() {
    return {
      cliente_id: fields.cliente_id.getValue(),
      situacao_pedido_id: fields.situacao_pedido_id.getValue(),
      data_pedido: fields.data_pedido.getValue(),
      data_atendimento: fields.data_atendimento.getValue(),
      prazo: fields.prazo.getValue(),
      documento_solicitacao: orNull(fields.documento_solicitacao.getValue()),
      documento_solicitacao_nup: orNull(fields.documento_solicitacao_nup.getValue()),
      ponto_contato: orNull(fields.ponto_contato.getValue()),
      endereco_entrega: orNull(fields.endereco_entrega.getValue()),
      palavras_chave: fields.palavras_chave.getValue(),
      operacao: orNull(fields.operacao.getValue()),
      demandante: orNull(fields.demandante.getValue()),
      omds: orNull(fields.omds.getValue()),
      previsto_pit: fields.previsto_pit.getValue(),
      observacao: orNull(fields.observacao.getValue()),
      localizador_envio: orNull(fields.localizador_envio.getValue()),
      observacao_envio: orNull(fields.observacao_envio.getValue()),
      motivo_cancelamento: orNull(fields.motivo_cancelamento.getValue()),
      canal_recebimento_id: fields.canal_recebimento_id.getValue(),
      municipio: orNull(fields.municipio.getValue()),
      qtd_imagens: fields.qtd_imagens.getValue(),
    };
  }

  return { fields, basicoElement, adicionalElement, civilElement, validateBasico, validateAdicional, getValues };
}
