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
  createPdrItem,
  updatePdrItem,
  getNaturezaDespesa,
} from '@modules/orcamento/services/orcamento-service.js';
import { paraId, formatDateTime } from '@utils/format.js';
import { getMetasPit, rotuloMetaPit } from '@services/plataforma-service.js';
import { criarHistorico } from '@components/historico/historico.js';

/**
 * Bloco de fatos de auditoria do registro: quando e por quem.
 *
 * O historico de alteracoes so tem linha a partir de 2026-07-30, e os itens do
 * PDR foram gravados em 2026-06-15: para todas as pecas atuais o historico abre
 * vazio, e a data de cadastro e a unica rastreabilidade em tela.
 *
 * @param {Object} registro - linha com as quatro colunas de auditoria
 * @returns {HTMLElement|null} null quando nao ha data de cadastro
 */
function blocoDeFatos(registro) {
  if (!registro || !registro.data_cadastramento) return null;

  const partes = [
    `Cadastrado em ${formatDateTime(registro.data_cadastramento)}`
      + (registro.usuario_cadastramento ? ` por ${registro.usuario_cadastramento}` : ''),
  ];
  // A linha de alteracao so aparece quando houve alteracao: registro nunca
  // editado nao ganha um campo vazio para a pessoa interpretar.
  if (registro.data_modificacao) {
    partes.push(
      `Alterado em ${formatDateTime(registro.data_modificacao)}`
        + (registro.usuario_modificacao ? ` por ${registro.usuario_modificacao}` : '')
    );
  }

  return el('p', {
    className: 'form-field__help',
    textContent: partes.join('. ') + '.',
    style: { margin: '0' },
  });
}

/**
 * Abre o dialog de criar/editar um item do PDR. O PDR e o conjunto dos itens do
 * ano: nao ha cabecalho de PDR, so o item. No create o ano e o da tela; no edit,
 * o ano do registro. Um item: { ano, cod_nd, meta_pit_id, item_label, gnd,
 * valor_solicitado, valor_autorizado, observacao }.
 *
 * @param {Object} options
 * @param {Object|null} [options.item] - item existente para editar (null cria novo)
 * @param {number} [options.ano] - ano da TELA que abriu o dialog. O dialog nao
 *   tem barra de filtros, entao quem o abre passa o ano; ele nunca le um store
 *   global. Sem o parametro vale o ano atual, o mesmo padrao do filtro da tela.
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export async function openPdrItemDialog({
  item = null,
  ano = new Date().getFullYear(),
  onSaved = null,
} = {}) {
  const isEdit = item !== null && item !== undefined && item.id !== undefined;

  // No create o ano e o da tela; no edit, o ano do registro.
  const anoItem = isEdit ? (item.ano ?? ano) : ano;

  let naturezas = [];
  let metas = [];

  try {
    [naturezas, metas] = await Promise.all([
      getNaturezaDespesa(),
      getMetasPit(anoItem),
    ]);
  } catch (err) {
    showError(err.message || 'Erro ao carregar dados do item do PDR');
    return;
  }

  const ndOptions = (naturezas || []).map(nd => ({
    value: nd.code,
    label: `${nd.code} - ${nd.nome}`,
  }));

  // O GND e DERIVADO da ND: `dominio.natureza_despesa` traz o gnd de cada
  // codigo, e nos 36 itens reais o GND digitado bate com o da ND em 36 de 36.
  // Enquanto o campo era livre, um GND divergente da ND quebrava a divisao
  // custeio/capital do cartao-resumo do PDR, sem aviso nenhum.
  const gndPorNd = new Map((naturezas || []).map(nd => [String(nd.code), nd.gnd]));
  const gndDaNd = (codNd) => {
    if (codNd === null || codNd === undefined || codNd === '') return null;
    const gnd = gndPorNd.get(String(codNd));
    return gnd === undefined ? null : gnd;
  };

  // O rotulo sai de rotuloMetaPit, a mesma funcao que a tela de metas e a
  // mapoteca usam: uma meta nao pode aparecer com nome diferente em cada tela.
  const metaOptions = (metas || []).map(m => ({ value: m.id, label: rotuloMetaPit(m) }));

  // ---- Campos ----
  const codNdField = createSelectField({
    label: 'Natureza de despesa',
    required: true,
    options: ndOptions,
    value: item?.cod_nd ?? undefined,
    onChange: (codNd) => { gndField.setValue(gndDaNd(codNd)); },
  });
  const metaField = createSelectField({
    label: 'Meta do PIT',
    options: metaOptions,
    value: item?.meta_pit_id ?? undefined,
  });
  const itemLabelField = createTextField({
    label: 'Rótulo',
    maxLength: 10,
    placeholder: 'Ex.: 1D',
    value: item?.item_label ?? '',
  });
  // A descricao e o unico texto que identifica o item para uma pessoa: o
  // item_label vale "10", "1D" ou ate "339040". O campo nao existia na tela, e
  // como o UPDATE grava null no que nao vem no corpo (pdr_ctrl.js:13-27),
  // salvar qualquer outra coisa APAGAVA a descricao. Coluna TEXT, sem maxLength.
  const descricaoField = createTextareaField({
    label: 'Descrição',
    rows: 2,
    value: item?.descricao ?? '',
    helpText: 'O que o item financia. Aparece na lista do PDR.',
  });
  // Somente leitura: quem manda e a ND. O campo continua na tela porque o GND e
  // o que separa custeio de capital, e o usuario precisa ver o efeito da ND que
  // escolheu antes de salvar.
  const gndField = createSelectField({
    label: 'GND',
    options: [
      { value: 3, label: '3 (custeio)' },
      { value: 4, label: '4 (capital)' },
    ],
    value: gndDaNd(item?.cod_nd) ?? item?.gnd ?? undefined,
    helpText: 'Vem da natureza de despesa escolhida.',
  });
  gndField.input.disabled = true;
  const valorSolicitadoField = createNumberField({
    label: 'Valor solicitado',
    min: 0,
    step: 0.01,
    value: item?.valor_solicitado ?? undefined,
  });
  const valorAutorizadoField = createNumberField({
    label: 'Valor autorizado',
    min: 0,
    step: 0.01,
    value: item?.valor_autorizado ?? undefined,
  });
  const observacaoField = createTextareaField({
    label: 'Observação',
    value: item?.observacao ?? '',
  });

  const fatos = isEdit ? blocoDeFatos(item) : null;

  const historico = isEdit
    ? criarHistorico({
      modulo: 'orcamento',
      entidade: 'pdr',
      id: anoItem,
      titulo: 'Histórico do PDR do ano',
      subtitulo: 'O agregado é o ANO: o histórico traz todos os itens do PDR do exercício',
      recolhido: true,
    })
    : null;

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [
      el('p', {
        className: 'pdr-item-dialog__ano',
        textContent: `Ano do item: ${anoItem}`,
        style: { margin: '0', color: 'var(--text-secondary)' },
      }),
    ]),
    codNdField.element,
    metaField.element,
    itemLabelField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
    gndField.element,
    valorSolicitadoField.element,
    valorAutorizadoField.element,
    el('div', { className: 'form-grid__full' }, [observacaoField.element]),
    fatos
      ? el('div', { className: 'form-grid__full' }, [fatos])
      : null,
    historico
      ? el('div', { className: 'form-grid__full' }, [historico.element])
      : null,
  ].filter(Boolean));

  let saving = false;

  openModal({
    title: isEdit ? 'Editar item do PDR' : 'Novo item do PDR',
    content,
    width: '640px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          codNdField.setError(null);

          const codNd = codNdField.getValue();
          if (codNd === null || codNd === undefined) {
            codNdField.setError('Selecione a natureza de despesa');
            return;
          }

          const body = {
            ano: anoItem,
            cod_nd: codNd,
            // Number: /api/metas devolve id como TEXTO e o schema cobra
            // Joi.number().integer().strict().
            meta_pit_id: paraId(metaField.getValue()),
            item_label: itemLabelField.getValue() || null,
            descricao: descricaoField.getValue() || null,
            gnd: gndField.getValue(),
            valor_solicitado: valorSolicitadoField.getValue(),
            valor_autorizado: valorAutorizadoField.getValue(),
            observacao: observacaoField.getValue() || null,
          };

          saving = true;
          try {
            if (isEdit) {
              await updatePdrItem(item.id, body);
              showSuccess('Item do PDR atualizado com sucesso');
            } else {
              await createPdrItem(body);
              showSuccess('Item do PDR criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar item do PDR');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
