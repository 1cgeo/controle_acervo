import { el } from '@utils/dom.js';
import {
  createTextField,
  createNumberField,
  createSelectField,
  createComboBoxField,
  createDateField,
  createTextareaField,
  createCheckboxField,
  createChipInput,
} from '@components/form-fields/form-fields.js';
import { toIsoDate } from '@utils/format.js';
import { rotuloMetaPit } from '@services/plataforma-service.js';

/**
 * Shared pedido form (wizard steps 1-2 and the edit dialog on the details
 * page). Builds every pedido field, the two .form-grid sections and the
 * client-side validations RN02/RN03 (the backend validates them again).
 */

export const SITUACAO_PEDIDO_EM_ANDAMENTO = 3;
export const SITUACAO_PEDIDO_CONCLUIDO = 5;
export const SITUACAO_PEDIDO_CANCELADO = 6;
export const TIPO_CLIENTE_LAI = 9;

// Tipos de cliente militares (mapoteca.tipo_cliente): 1 OM EB, 2 Aeronáutica,
// 3 Marinha. Todo o resto (órgão público, empresa, pessoa física, LAI) é civil.
export const TIPOS_CLIENTE_MILITAR = [1, 2, 3];

// Campos que só o pedido militar usa: demandante, operação e o vínculo com o
// PIT. Em pedido civil eles ficam vazios.
//
// Sem `omds`: a coluna saiu do banco em 2026-08-08. Ela estava preenchida em
// 124 linhas com UM único valor distinto em todas ('1º CGEO'), ou seja, era uma
// constante disfarçada de campo, e o formulário pedia que se redigitasse o nome
// da própria unidade em todo pedido.
const CAMPOS_SO_MILITAR = [
  'demandante', 'operacao', 'previsto_pit', 'meta_pit_id',
  // A data prevista acompanha a meta: ela só existe para dizer em que mês o
  // pedido entra no planejado do PIT, e pedido civil não cumpre meta.
  'data_prevista',
];

// Campos que só o pedido de civil usa. Canal de recebimento preenchido em 33 de
// 33 civis e 0 de 100 militares (mesma medição).
const CAMPOS_SO_CIVIL = ['canal_recebimento_id', 'municipio', 'qtd_imagens'];

export const ROTULO_MODO = { militar: 'Pedido militar', civil: 'Pedido civil' };

/**
 * Modo do pedido a partir do tipo de cliente.
 * @param {number|string|null} tipoClienteId
 * @returns {'militar'|'civil'}
 */
export function modoDoTipoCliente(tipoClienteId) {
  return TIPOS_CLIENTE_MILITAR.includes(Number(tipoClienteId)) ? 'militar' : 'civil';
}

/**
 * Clientes que o modo aceita. Serve a criação, onde o usuário escolhe o modo
 * primeiro e só depois o cliente.
 * @param {Array<{tipo_cliente_id:number}>} clientes
 * @param {'militar'|'civil'} modo
 */
export function filtrarClientesPorModo(clientes, modo) {
  const militar = modo === 'militar';
  return clientes.filter(c => TIPOS_CLIENTE_MILITAR.includes(c.tipo_cliente_id) === militar);
}

/** Campo sem valor gravado nem digitado (o checkbox desmarcado conta como vazio). */
function campoVazio(field) {
  const valor = field.getValue();
  if (valor === null || valor === undefined || valor === false) return true;
  if (Array.isArray(valor)) return valor.length === 0;
  return String(valor).trim() === '';
}

/**
 * Mostra só os campos do modo, escondendo o campo do OUTRO modo que está VAZIO.
 *
 * O campo PREENCHIDO nunca some, mesmo fora do modo: há pedido civil com
 * demandante e com operação gravados, e esconder às cegas deixaria dado gravado
 * e invisível, sem ninguém conseguir corrigi-lo.
 *
 * A visibilidade não muda o payload: getValues lê todos os campos, então o
 * campo escondido continua enviando o valor que já tinha.
 *
 * @param {Object} options
 * @param {Object} options.fields - o `fields` de createPedidoFormFields
 * @param {'militar'|'civil'} options.modo
 * @param {HTMLElement|null} [options.civilElement] - bloco da seção de civil
 * @returns {boolean} true quando o modo é civil
 */
export function aplicarModoPedido({ fields, modo, civilElement = null }) {
  const civil = modo === 'civil';

  for (const nome of CAMPOS_SO_MILITAR) {
    const field = fields[nome];
    if (field) field.element.classList.toggle('hidden', civil && campoVazio(field));
  }
  for (const nome of CAMPOS_SO_CIVIL) {
    const field = fields[nome];
    if (field) field.element.classList.toggle('hidden', !civil && campoVazio(field));
  }

  // A seção inteira de civil só some quando os três campos dela estão vazios.
  // Com um deles preenchido, o título tem de continuar na tela, senão o campo
  // aparece solto e sem contexto.
  if (civilElement) {
    const algumPreenchido = CAMPOS_SO_CIVIL.some(nome => fields[nome] && !campoVazio(fields[nome]));
    civilElement.classList.toggle('hidden', !civil && !algumPreenchido);
  }

  return civil;
}

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
 * @param {Array<{code:number, nome:string}>} [options.formasEntrega] - dominio
 *   mapoteca.forma_entrega
 * @returns {{fields:Object, basicoElement:HTMLElement, adicionalElement:HTMLElement,
 *   validateBasico:()=>boolean, validateAdicional:()=>boolean, getValues:()=>Object}}
 */
export function createPedidoFormFields({
  pedido = null, clientes = [], situacoes = [], canais = [], formasEntrega = [],
  metas = [],
}) {
  const fields = {
    // Etapa 1, Básico
    cliente_id: createComboBoxField({
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
    // Esta data e a que o cliente ve na consulta publica, como "data de
    // envio/entrega": na pratica o pedido fecha no dia em que o material sai
    // e essa data casa com a maior data de entrega dos itens. Por isso NAO
    // existe um campo separado de data de envio.
    data_atendimento: createDateField({
      label: 'Data de atendimento (envio/entrega)',
      value: isoDateOrEmpty(pedido && pedido.data_atendimento),
      helpText: 'Dia em que o material saiu. Obrigatória quando a situação é Concluído (RN02). O cliente a vê como "envio/entrega".',
    }),
    prazo: createDateField({
      label: 'Prazo',
      value: isoDateOrEmpty(pedido && pedido.prazo),
      helpText: 'O limite que o CLIENTE impôs. Não confunda com a data prevista, que é o mês em que nós planejamos imprimir.',
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

    // Etapa 2, Adicional
    // Contato DESTE pedido, que costuma vir no DIEx. E diferente do contato
    // geral da OM (mapoteca.cliente.ponto_contato_principal), que fica no
    // cadastro do cliente e vale para todos os pedidos dela.
    ponto_contato: createTextField({
      label: 'Ponto de contato do pedido',
      value: (pedido && pedido.ponto_contato) || '',
      maxLength: 255,
      helpText: 'Contato específico deste pedido. Em branco, vale o contato geral da OM.',
    }),
    demandante: createTextField({
      label: 'Demandante',
      value: (pedido && pedido.demandante) || '',
      maxLength: 255,
      helpText: 'Quem encaminhou o pedido (ex.: CMS)',
    }),
    operacao: createTextField({
      label: 'Operação',
      value: (pedido && pedido.operacao) || '',
    }),
    // A forma de entrega e do PEDIDO, nao do item: o pedido inteiro sai numa
    // remessa so. Item com forma propria e caso raro o bastante para nao pagar
    // uma coluna.
    forma_entrega_id: createSelectField({
      label: 'Forma de entrega',
      options: formasEntrega.map(f => ({ value: f.code, label: f.nome })),
      value: pedido ? pedido.forma_entrega_id : undefined,
      placeholder: 'Não informada',
      helpText: 'Como o material chega ao cliente (Correios, entrega em mãos).',
    }),
    localizador_envio: createTextField({
      label: 'Localizador de envio (rastreio)',
      value: (pedido && pedido.localizador_envio) || '',
    }),
    previsto_pit: createCheckboxField({
      label: 'Previsto no PIT',
      checked: Boolean(pedido && pedido.previsto_pit),
    }),
    // Lista do PIT do ano, e não texto digitado: código à mão ('4.1') não casa
    // com a meta e apodrece na virada do ano. A meta NÃO se deriva do material
    // do item: a correlação 4.1 sulfite / 4.2 tyvek / 4.3 glossy valeu só em
    // 2026, e o PIT é reescrito todo ano.
    meta_pit_id: createComboBoxField({
      label: 'Meta do PIT',
      options: (metas || []).map(m => ({ value: m.id, label: rotuloMetaPit(m) })),
      value: (pedido && pedido.meta_pit_id) || undefined,
      placeholder: 'Selecione a meta...',
    }),
    // O MÊS EM QUE NÓS PROMETEMOS IMPRIMIR, e é daqui que sai o PLANEJADO da
    // meta 4 do PIT: a soma dos itens dos pedidos ligados à meta, agrupada por
    // este mês.
    //
    // NÃO é o `prazo` acima, que é o limite do cliente. Medido em 2026-08-05:
    // `prazo` estava preenchido em 33 dos 164 pedidos e em NENHUM dos 16 ligados
    // a meta, ou seja, os dois campos nunca foram a mesma coisa.
    //
    // Fica ao lado da meta, e não das outras datas, porque só faz sentido junto
    // dela: pedido sem meta não entra em plano nenhum.
    data_prevista: createDateField({
      label: 'Data prevista de impressão',
      value: isoDateOrEmpty(pedido && pedido.data_prevista),
      helpText: 'O mês em que NÓS planejamos imprimir. É daqui que sai o planejado do PIT.',
    }),
    // O endereço DESTE pedido, que nem sempre é o do cadastro do cliente: o
    // material da OM vai muitas vezes para a seção que pediu, para um exercício
    // no campo ou para um endereço que veio escrito no próprio DIEx.
    //
    // EM BRANCO NÃO É FALTA DE DADO: o servidor cai no endereço do cadastro do
    // cliente (`COALESCE(p.endereco_entrega, c.endereco_entrega_principal)`), e
    // a etiqueta de envio faz a mesma queda. O aviso está no campo porque, sem
    // ele, quem vê o campo vazio copia o endereço do cliente para dentro dele e
    // congela ali um endereço que o cadastro vai corrigir depois.
    endereco_entrega: createTextareaField({
      label: 'Endereço de entrega',
      value: (pedido && pedido.endereco_entrega) || '',
      rows: 2,
      helpText: 'Só quando a entrega for para um endereço diferente do cadastro. Em branco, vale o endereço do cliente.',
    }),
    // As etiquetas do pedido, e é por elas que a lista de pedidos filtra. A
    // busca casa a etiqueta INTEIRA e diferencia maiúscula de minúscula, então
    // o que se digita aqui é o termo de busca de amanhã: escrever 'Extra-PIT'
    // hoje e 'extra-pit' na semana que vem cria duas etiquetas, e cada busca
    // acha metade dos pedidos.
    palavras_chave: createChipInput({
      label: 'Palavras-chave',
      values: (pedido && pedido.palavras_chave) || [],
      helpText: 'Etiquetas para achar o pedido depois. A busca da lista casa a etiqueta inteira e diferencia maiúscula de minúscula.',
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
    // A observacao e a observacao de envio APARECEM na consulta publica do
    // cliente (rota por localizador, sem sessao). Esta nao aparece: e onde vai
    // quem levou aos Correios, com quem esta o cartao de envio, o que
    // reimprimir. O aviso no campo existe porque, sem ele, a diferenca entre os
    // tres campos de texto e invisivel na hora de escrever.
    observacao_interna: createTextareaField({
      label: 'Observação interna',
      value: (pedido && pedido.observacao_interna) || '',
      rows: 2,
      helpText: 'Só para a equipe. NÃO aparece na consulta do cliente.',
    }),
    motivo_cancelamento: createTextareaField({
      label: 'Motivo do cancelamento',
      value: (pedido && pedido.motivo_cancelamento) || '',
      rows: 2,
      helpText: 'Obrigatório quando a situação é Cancelado (RN03)',
    }),

    // Dados de pedido de CIVIL (LAI/órgão/empresa/pessoa), opcionais. Deixe
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
  fields.observacao_interna.element.classList.add('form-grid__full');
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
    fields.operacao.element,
    fields.forma_entrega_id.element,
    fields.localizador_envio.element,
    fields.previsto_pit.element,
    fields.meta_pit_id.element,
    fields.data_prevista.element,
    fields.endereco_entrega.element,
    fields.palavras_chave.element,
    fields.observacao_envio.element,
    fields.observacao.element,
    fields.observacao_interna.element,
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
    fields.meta_pit_id.setError(null);
    const situacao = fields.situacao_pedido_id.getValue();
    if (situacao === SITUACAO_PEDIDO_CANCELADO && !fields.motivo_cancelamento.getValue()) {
      fields.motivo_cancelamento.setError('Pedido Cancelado exige o motivo do cancelamento (RN03)');
      return false;
    }
    // Mesma regra do Joi e do CHECK do banco: previsto no PIT exige a meta.
    // Aqui ela existe só para o erro aparecer no campo, e não como 400 seco.
    if (fields.previsto_pit.getValue() && !fields.meta_pit_id.getValue()) {
      fields.meta_pit_id.setError('Pedido previsto no PIT exige a meta do PIT');
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
      previsto_pit: fields.previsto_pit.getValue(),
      meta_pit_id: fields.meta_pit_id.getValue(),
      data_prevista: fields.data_prevista.getValue() || null,
      observacao: orNull(fields.observacao.getValue()),
      forma_entrega_id: fields.forma_entrega_id.getValue(),
      localizador_envio: orNull(fields.localizador_envio.getValue()),
      observacao_envio: orNull(fields.observacao_envio.getValue()),
      observacao_interna: orNull(fields.observacao_interna.getValue()),
      motivo_cancelamento: orNull(fields.motivo_cancelamento.getValue()),
      canal_recebimento_id: fields.canal_recebimento_id.getValue(),
      municipio: orNull(fields.municipio.getValue()),
      qtd_imagens: fields.qtd_imagens.getValue(),
    };
  }

  return { fields, basicoElement, adicionalElement, civilElement, validateBasico, validateAdicional, getValues };
}
