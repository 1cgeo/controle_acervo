import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { criarHistorico } from '@components/historico/historico.js';
import {
  createTextField,
  createNumberField,
  createDateField,
  createSelectField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { paraId } from '@utils/format.js';
import { createFileAttachment } from '@modules/orcamento/components/file-attachment.js';
import {
  getNotaCredito,
  createNotaCredito,
  updateNotaCredito,
  getNaturezaDespesa,
  getPlanoInterno,
  getUg,
  getClassificacaoNc,
  getNotasCredito,
  getPdrItens,
} from '@modules/orcamento/services/orcamento-service.js';
import { getMetasPit, rotuloMetaPit } from '@services/plataforma-service.js';

// UG emitente default: 160089 (DSG).
const UG_DSG = '160089';
// Classificacao 1 = PDR (aceita pdr_item_id); 2 = Extra-PDR (nao tem item de PDR).
const CLASSIFICACAO_PDR = 1;

/**
 * Rotulo de uma NC numa lista de escolha.
 *
 * Carrega a UG emitente porque a identidade real da NC e (ano, numero, ND, UG):
 * a numeracao do SIAFI e por emitente. Sem a UG, duas NCs distintas aparecem
 * com o mesmo texto e a escolha vira sorteio.
 * @param {Object} nc
 * @returns {string}
 */
function rotuloNc(nc) {
  const numero = nc.numero ?? `NC ${nc.id}`;
  const base = nc.cod_nd ? `${numero} - ${nc.cod_nd}` : numero;
  return nc.ug_emitente ? `${base} (UG ${nc.ug_emitente})` : base;
}

/**
 * Abre o dialog de criar/editar Nota de Credito.
 * valor_nc e o valor recebido na NC e nunca muda por devolucao (a devolucao e
 * registrada a parte; este campo permanece o valor original recebido).
 * @param {Object} options
 * @param {number|null} [options.ncId] - id da NC existente para editar (null cria nova)
 * @param {number} [options.ano] - ano da TELA que abriu o dialog. O dialog nao
 *   tem barra de filtros, entao quem o abre passa o ano; ele nunca le um store
 *   global. Sem o parametro vale o ano atual, o mesmo padrao do filtro da tela.
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export async function openNotaCreditoDialog({
  ncId = null,
  ano = new Date().getFullYear(),
  onSaved = null,
} = {}) {
  const isEdit = ncId !== null && ncId !== undefined;

  let naturezas = [];
  let planos = [];
  let ugs = [];
  let classificacoes = [];
  let outrasNcs = [];
  let pdrItens = [];
  let metas = [];
  let nc = null;

  // Ano de contexto da NC: no edit segue o ano do registro; no create e o ano da tela.
  const anoContexto = isEdit ? null : ano;

  try {
    [naturezas, planos, ugs, classificacoes, outrasNcs, pdrItens] = await Promise.all([
      getNaturezaDespesa(),
      getPlanoInterno(),
      getUg(),
      getClassificacaoNc(),
      getNotasCredito({ ano }),
      getPdrItens(ano),
    ]);
    if (isEdit) nc = await getNotaCredito(ncId);
  } catch (err) {
    showError(err.message || 'Erro ao carregar dados da nota de crédito');
    return;
  }

  const anoMetas = isEdit ? (nc?.ano ?? null) : anoContexto;
  if (anoMetas !== null && anoMetas !== undefined) {
    try {
      metas = await getMetasPit(anoMetas);
    } catch {
      metas = [];
    }
  }

  const ndOptions = (naturezas || []).map(nd => ({
    value: nd.codigo ?? nd.code ?? nd.cod_nd ?? nd.id,
    label: `${nd.codigo ?? nd.code ?? nd.cod_nd ?? nd.id} - ${nd.nome ?? nd.descricao ?? ''}`,
  }));
  const piOptions = (planos || []).map(pi => ({
    value: pi.codigo ?? pi.code ?? pi.cod_pi ?? pi.id,
    label: pi.nome ? `${pi.codigo ?? pi.code ?? pi.cod_pi ?? pi.id} - ${pi.nome}` : String(pi.codigo ?? pi.code ?? pi.cod_pi ?? pi.id),
  }));
  const ugOptions = (ugs || []).map(ug => ({
    value: ug.codigo ?? ug.code ?? ug.codom ?? ug.id,
    label: ug.nome ? `${ug.codigo ?? ug.code ?? ug.codom ?? ug.id} - ${ug.nome}` : String(ug.codigo ?? ug.code ?? ug.codom ?? ug.id),
  }));
  // O dominio classificacao_nc vem como {code, nome}: o value e o code (o mesmo
  // que nc.classificacao_id), senao o select nao casa o valor ao editar.
  const classificacaoOptions = (classificacoes || []).map(c => ({
    value: c.code ?? c.id,
    label: c.nome ?? c.descricao ?? `Classificação ${c.code ?? c.id}`,
  }));
  const ncComplementadaOptions = (outrasNcs || [])
    .filter(o => !isEdit || o.id !== ncId)
    .map(o => ({ value: o.id, label: rotuloNc(o) }));
  // A DESCRICAO entra no rotulo: o item_label e a ND descrevem a celula
  // orcamentaria ("10 - Servicos de terceiros"), e nao o que o item compra
  // ("Producao de Geoinformacao para o EBGeo"). Sem ela a escolha e no escuro.
  const pdrItemOptions = (pdrItens || []).map(it => {
    const base = `${it.item_label || it.cod_nd} - ${it.nd_nome ?? ''}`.trim();
    const descricao = it.descricao ? `: ${it.descricao}` : '';
    const meta = it.meta_numero ? ` (Meta ${it.meta_numero})` : '';
    return { value: it.id, label: `${base}${descricao}${meta}` };
  });

  // O rotulo sai de rotuloMetaPit, a mesma funcao que a tela de metas e a
  // mapoteca usam: uma meta nao pode aparecer com nome diferente em cada tela.
  function metaOptions() {
    return (metas || []).map(m => ({ value: m.id, label: rotuloMetaPit(m) }));
  }

  // ---- Campos ----
  // Os maxLength abaixo copiam o VARCHAR do banco (er/orcamento.sql). Campo que
  // aceita mais do que a coluna guarda deixa o usuario digitar e so reprova
  // depois de salvar, com erro cru do banco.
  const numeroField = createTextField({
    label: 'Número',
    required: true,
    maxLength: 20,
    placeholder: 'Ex.: 2026NC400134',
    value: nc?.numero ?? '',
    helpText: 'Uma NC com mais de uma ND entra uma vez por ND, com o mesmo número.',
  });
  const dataEmissaoField = createDateField({
    label: 'Data de emissão',
    value: nc?.data_emissao ?? '',
  });
  const codNdField = createSelectField({
    label: 'Natureza de despesa',
    required: true,
    options: ndOptions,
    value: nc?.cod_nd ?? undefined,
  });
  const ptresField = createTextField({
    label: 'PTRES',
    maxLength: 10,
    placeholder: 'Ex.: 232039',
    value: nc?.ptres ?? '',
  });
  const fonteField = createTextField({
    label: 'Fonte',
    maxLength: 15,
    placeholder: 'Ex.: 1000000000',
    value: nc?.fonte ?? '',
  });
  const codPiField = createSelectField({
    label: 'Plano interno (PI)',
    options: piOptions,
    value: nc?.cod_pi ?? undefined,
  });
  const ugEmitenteField = createSelectField({
    label: 'UG emitente',
    options: ugOptions,
    value: nc?.ug_emitente ?? UG_DSG,
  });
  const finalidadeField = createTextareaField({
    label: 'Finalidade / histórico',
    value: nc?.finalidade_historico ?? '',
  });
  const metaField = createSelectField({
    label: 'Meta do PIT',
    options: metaOptions(),
    value: nc?.meta_pit_id ?? undefined,
  });
  const valorNcField = createNumberField({
    label: 'Valor da NC',
    required: true,
    min: 0,
    step: 0.01,
    value: nc?.valor_nc ?? undefined,
    helpText: 'Valor recebido na NC. Nunca muda por devolução.',
  });
  const valorRecolhidoField = createNumberField({
    label: 'Valor recolhido',
    min: 0,
    step: 0.01,
    value: nc?.valor_recolhido ?? undefined,
    helpText: 'Parte do crédito recebido que foi devolvida/recolhida. Informativo: não altera o valor recebido.',
  });
  const docRoField = createTextField({
    label: 'Documento RO',
    maxLength: 20,
    value: nc?.doc_ro ?? '',
  });
  const prazoEmpenhoField = createDateField({
    label: 'Prazo de empenho',
    value: nc?.prazo_empenho ?? '',
  });
  const classificacaoField = createSelectField({
    label: 'Classificação',
    required: true,
    options: classificacaoOptions,
    value: nc?.classificacao_id ?? undefined,
    onChange: (id) => updatePdrItemVisibility(id),
  });
  // Sem helpText: o campo inteiro SOME quando a classificacao nao e PDR, entao
  // avisar que ele "so se aplica ao PDR" so aparecia para quem ja estava no PDR.
  const pdrItemField = createSelectField({
    label: 'Item do PDR',
    options: pdrItemOptions,
    value: nc?.pdr_item_id ?? undefined,
  });
  const ncComplementadaField = createSelectField({
    label: 'NC complementada',
    options: ncComplementadaOptions,
    value: nc?.nc_complementada_id ?? undefined,
  });
  const marcadorField = createTextField({
    label: 'Marcador',
    maxLength: 8,
    placeholder: 'Ex.: *',
    value: nc?.marcador ?? '',
  });
  const observacaoField = createTextareaField({
    label: 'Observação',
    value: nc?.observacao ?? '',
  });

  // Anexo (1 PDF do extrato do SIAFI). Em edicao o upload e imediato; ao criar,
  // o arquivo fica retido e e enviado apos a NC ser criada (precisa do id).
  const anexo = createFileAttachment({
    mode: 'single',
    vinculo: isEdit ? { nota_credito_id: ncId } : null,
    accept: '.pdf',
    label: 'Anexo (PDF do SIAFI)',
    buttonLabel: 'Selecionar PDF',
  });

  // Wrapper do campo pdr_item_id para poder ocultar/exibir.
  const pdrItemWrapper = el('div', {}, [pdrItemField.element]);

  // ---- Visibilidade do pdr_item_id ----
  // Quando classificacao = PDR (1) o campo aparece; em Extra-PDR (2) some e e limpo.
  function isPdr(classificacaoId) {
    return Number(classificacaoId) === CLASSIFICACAO_PDR;
  }
  function updatePdrItemVisibility(classificacaoId) {
    if (isPdr(classificacaoId)) {
      pdrItemWrapper.classList.remove('hidden');
    } else {
      pdrItemWrapper.classList.add('hidden');
      pdrItemField.setValue(null);
      pdrItemField.setError(null);
    }
  }

    // Histórico de alterações, RECOLHIDO e só na edição.
    //
    // Recolhido porque o diálogo já é um formulário cheio: aberto, ele cobraria
    // uma consulta de quem só veio corrigir um campo. Só na edição porque num
    // cadastro novo não há o que mostrar.
    const historico = isEdit
      ? criarHistorico({
        modulo: 'orcamento',
        entidade: 'nota_credito',
        id: ncId,
        titulo: 'Histórico de alterações',
        subtitulo: 'Alteracoes nesta nota de credito',
        recolhido: true,
      })
      : null;

  const content = el('div', { className: 'form-grid' }, [
    numeroField.element,
    dataEmissaoField.element,
    codNdField.element,
    ptresField.element,
    fonteField.element,
    codPiField.element,
    ugEmitenteField.element,
    el('div', { className: 'form-grid__full' }, [finalidadeField.element]),
    metaField.element,
    valorNcField.element,
    valorRecolhidoField.element,
    docRoField.element,
    prazoEmpenhoField.element,
    classificacaoField.element,
    pdrItemWrapper,
    ncComplementadaField.element,
    marcadorField.element,
    el('div', { className: 'form-grid__full' }, [observacaoField.element]),
    el('div', { className: 'form-grid__full' }, [anexo.element]),
    historico ? el('div', { className: 'form-grid__full' }, [historico.element]) : null,
  ]);

  // Estado inicial da visibilidade do item de PDR.
  updatePdrItemVisibility(nc?.classificacao_id);

  let saving = false;

  openModal({
    title: isEdit ? `Editar nota de crédito (${nc.ano})` : `Nova nota de crédito (${ano})`,
    content,
    width: '760px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          numeroField.setError(null);
          codNdField.setError(null);
          valorNcField.setError(null);
          valorRecolhidoField.setError(null);
          classificacaoField.setError(null);

          const numero = numeroField.getValue();
          const codNd = codNdField.getValue();
          const valorNc = valorNcField.getValue();
          const valorRecolhido = valorRecolhidoField.getValue();
          const classificacaoId = classificacaoField.getValue();

          let valid = true;
          if (!numero) {
            numeroField.setError('Informe o número da NC');
            valid = false;
          }
          if (codNd === null || codNd === undefined) {
            codNdField.setError('Selecione a natureza de despesa');
            valid = false;
          }
          if (valorNc === null || valorNc <= 0) {
            valorNcField.setError('Informe um valor maior que zero');
            valid = false;
          }
          if (classificacaoId === null || classificacaoId === undefined) {
            classificacaoField.setError('Selecione a classificação');
            valid = false;
          }
          // Nao se devolve credito que nao se recebeu. O schema do servidor cobra
          // o mesmo teto; aqui o usuario ve o erro no campo, antes de enviar.
          if (valorRecolhido !== null && valorNc !== null && valorRecolhido > valorNc) {
            valorRecolhidoField.setError('O recolhido não pode passar do valor da NC');
            valid = false;
          }
          if (!valid) return;

          const body = {
            numero,
            ano: isEdit ? nc.ano : ano,
            data_emissao: dataEmissaoField.getValue(),
            cod_nd: codNd,
            ptres: ptresField.getValue() || null,
            fonte: fonteField.getValue() || null,
            cod_pi: codPiField.getValue(),
            ug_emitente: ugEmitenteField.getValue(),
            finalidade_historico: finalidadeField.getValue() || null,
            // paraId nos tres ids de select: eles chegam da API como TEXTO e os
            // schemas cobram Joi.number().integer().strict().
            meta_pit_id: paraId(metaField.getValue()),
            valor_nc: valorNc,
            valor_recolhido: valorRecolhido ?? null,
            doc_ro: docRoField.getValue() || null,
            prazo_empenho: prazoEmpenhoField.getValue(),
            classificacao_id: classificacaoId,
            nc_complementada_id: paraId(ncComplementadaField.getValue()),
            marcador: marcadorField.getValue() || null,
            observacao: observacaoField.getValue() || null,
          };

          // Só envia pdr_item_id quando a classificacao e PDR (1).
          if (isPdr(classificacaoId)) {
            body.pdr_item_id = paraId(pdrItemField.getValue());
          }

          saving = true;
          try {
            if (isEdit) {
              await updateNotaCredito(ncId, body);
              showSuccess('Nota de crédito atualizada com sucesso');
            } else {
              const criada = await createNotaCredito(body);
              // Envia o anexo retido (se houver) agora que a NC tem id.
              //
              // O SUCESSO SÓ SAI SE O ANEXO SUBIU. A mensagem de falha vinha
              // primeiro e o "Nota de crédito criada com sucesso" logo depois,
              // por cima dela: o último toast dizia sucesso, o diálogo fechava e
              // o PDF escolhido ia junto. O extrato do SIAFI é a prova do
              // crédito, e quem confiasse no aviso final não voltaria para
              // anexá-lo.
              let anexoFalhou = null;
              if (anexo.hasPending() && criada && criada.id != null) {
                try {
                  await anexo.flush({ nota_credito_id: criada.id });
                } catch (errAnexo) {
                  anexoFalhou = errAnexo.message || 'erro desconhecido';
                }
              }
              if (anexoFalhou) {
                showError(
                  `A NC ${numero} foi criada, mas o PDF do SIAFI NÃO foi anexado: ${
                    anexoFalhou}. Abra a NC em Editar e anexe o arquivo de novo.`
                );
              } else {
                showSuccess('Nota de crédito criada com sucesso');
              }
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar nota de crédito');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
