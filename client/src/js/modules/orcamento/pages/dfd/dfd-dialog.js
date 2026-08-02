import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { criarHistorico } from '@components/historico/historico.js';
import {
  createTextField,
  createSelectField,
  createNumberField,
  createDateField,
  createTextareaField,
  createCheckboxField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import { formatCurrency } from '@utils/format.js';
import * as svc from '@modules/orcamento/services/orcamento-service.js';
import { getAno } from '@modules/orcamento/store/year-store.js';
import { createFileAttachment } from '@modules/orcamento/components/file-attachment.js';

/** String vazia vira null (campos opcionais da API). */
function orNull(value) {
  return value === '' || value === undefined ? null : value;
}

/**
 * Editor inline e enxuto de UM item do DFD. Aparece abaixo da tabela ao
 * adicionar ou editar um item. O valor total e calculado automaticamente
 * (quantidade x valor unitario) enquanto o usuario nao o edita na mao.
 * @param {Object} options
 * @param {Array<{code:number, nome:string}>} options.tipoItem
 * @param {Object|null} [options.item] - item existente para editar
 * @param {Function} options.onSave - recebe o item validado
 * @param {Function} options.onCancel
 * @returns {{element:HTMLElement, trySave:Function, focus:Function}}
 */
function createItemEditor({ tipoItem = [], item = null, onSave, onCancel }) {
  const tipoField = createSelectField({
    label: 'Tipo do item',
    required: true,
    options: tipoItem.map((t) => ({ value: t.code, label: t.nome })),
    value: item ? item.tipo_item_id : undefined,
  });
  const codField = createTextField({
    label: 'CATMAT/CATSER',
    value: item?.cod_catmat_catser ?? '',
    maxLength: 50,
  });
  const descricaoField = createTextField({
    label: 'Descrição',
    required: true,
    value: item?.descricao ?? '',
  });
  const quantidadeField = createNumberField({
    label: 'Quantidade',
    min: 0,
    step: 0.01,
    value: item?.quantidade ?? undefined,
  });
  const valorUnitarioField = createNumberField({
    label: 'Valor unitário',
    min: 0,
    step: 0.01,
    value: item?.valor_unitario ?? undefined,
  });
  const valorTotalField = createNumberField({
    label: 'Valor total',
    min: 0,
    step: 0.01,
    value: item?.valor_total ?? undefined,
    helpText: 'Calculado da quantidade x unitário (editável).',
  });

  // Auto-calculo do total: enquanto o usuario nao digitar o total na mao, ele
  // segue quantidade x valor unitario.
  let totalTocado = item?.valor_total != null;
  function recalcula() {
    if (totalTocado) return;
    const q = quantidadeField.getValue();
    const u = valorUnitarioField.getValue();
    if (q != null && u != null) {
      valorTotalField.setValue(Math.round(q * u * 100) / 100);
    }
  }
  quantidadeField.input.addEventListener('input', recalcula);
  valorUnitarioField.input.addEventListener('input', recalcula);
  valorTotalField.input.addEventListener('input', () => { totalTocado = true; });

  const cancelBtn = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    textContent: 'Cancelar',
    onClick: () => onCancel(),
  });
  const saveBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    textContent: item ? 'Salvar item' : 'Adicionar',
    onClick: () => trySave(),
  });

  const element = el('div', { className: 'dfd-item-editor' }, [
    el('div', { className: 'form-grid' }, [
      tipoField.element,
      codField.element,
      el('div', { className: 'form-grid__full' }, [descricaoField.element]),
      quantidadeField.element,
      valorUnitarioField.element,
      valorTotalField.element,
    ]),
    el('div', { className: 'dfd-item-editor__actions' }, [cancelBtn, saveBtn]),
  ]);

  function validate() {
    let ok = true;
    tipoField.setError(null);
    descricaoField.setError(null);
    if (tipoField.getValue() === null) {
      tipoField.setError('Selecione o tipo do item');
      ok = false;
    }
    if (!descricaoField.getValue()) {
      descricaoField.setError('Informe a descrição do item');
      ok = false;
    }
    return ok;
  }

  function getValue() {
    return {
      tipo_item_id: tipoField.getValue(),
      cod_catmat_catser: orNull(codField.getValue()),
      descricao: descricaoField.getValue(),
      quantidade: quantidadeField.getValue(),
      valor_unitario: valorUnitarioField.getValue(),
      valor_total: valorTotalField.getValue(),
    };
  }

  function trySave() {
    if (!validate()) return false;
    onSave(getValue());
    return true;
  }

  return { element, trySave, focus: () => tipoField.input.focus() };
}

/**
 * Abre o dialog de criar/editar DFD, incluindo a lista de itens.
 * O ano vem do contexto global (navbar): no create grava o ano de contexto; no
 * edit mantem o ano do registro.
 * @param {Object} options
 * @param {Object|null} [options.dfd] - DFD existente (ja com itens) para editar
 * @param {Object} options.dominios - { grauPrioridade, tipoItem }
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export function openDfdDialog({ dfd = null, dominios = {}, onSaved = null } = {}) {
  const isEdit = Boolean(dfd);
  const {
    grauPrioridade = [],
    tipoItem = [],
  } = dominios;

  const tipoNome = new Map(tipoItem.map((t) => [String(t.code), t.nome]));

  const numeroField = createTextField({
    label: 'Número',
    required: true,
    value: dfd?.numero ?? '',
    maxLength: 50,
  });
  const rotuloField = createTextField({
    label: 'Rótulo',
    value: dfd?.rotulo ?? '',
    maxLength: 255,
  });
  const objetoField = createTextareaField({
    label: 'Objeto',
    value: dfd?.objeto ?? '',
  });
  const justificativaField = createTextareaField({
    label: 'Justificativa',
    value: dfd?.justificativa ?? '',
  });
  const areaField = createTextField({
    label: 'Área requisitante',
    value: dfd?.area_requisitante ?? '',
    maxLength: 255,
  });
  const grauField = createSelectField({
    label: 'Grau de prioridade',
    options: grauPrioridade.map((g) => ({ value: g.code, label: g.nome })),
    value: dfd ? dfd.grau_prioridade_id : undefined,
  });
  const dataPrevistaField = createDateField({
    label: 'Data prevista de conclusão',
    value: dfd?.data_prevista_conclusao ?? '',
  });
  const cpfField = createTextField({
    label: 'CPF do responsável',
    value: dfd?.responsavel_cpf ?? '',
    maxLength: 14,
  });
  const vinculoField = createTextField({
    label: 'Vínculo com plano de gestão',
    value: dfd?.vinculo_plano_gestao ?? '',
    maxLength: 255,
  });
  const constaPcaField = createCheckboxField({
    label: 'Consta no PCA',
    checked: dfd ? Boolean(dfd.consta_pca) : true,
  });

  // Anexo (1 PDF do DFD). Em edicao sobe na hora; ao criar, fica retido e e
  // enviado apos o DFD ser criado (precisa do id).
  const anexo = createFileAttachment({
    mode: 'single',
    vinculo: isEdit ? { dfd_id: dfd.id } : null,
    accept: '.pdf',
    buttonLabel: 'Selecionar PDF',
  });

  // ---- Itens do DFD: tabela compacta + editor inline ----
  let itens = (isEdit && Array.isArray(dfd.itens)) ? dfd.itens.map((it) => ({ ...it })) : [];
  let editor = null; // editor inline aberto no momento (ou null)

  const tbody = el('tbody');
  const editorContainer = el('div', { className: 'dfd-itens__editor' });

  const addItemBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => abrirEditor(null),
  }, [svgIcon(ICONS.add, 14), 'Adicionar item']);

  function fecharEditor() {
    editor = null;
    editorContainer.innerHTML = '';
    addItemBtn.disabled = false;
  }

  function abrirEditor(idx) {
    if (editor) return; // ja ha um editor aberto
    addItemBtn.disabled = true;
    editor = createItemEditor({
      tipoItem,
      item: idx === null ? null : itens[idx],
      onSave: (value) => {
        if (idx === null) itens.push(value);
        else itens[idx] = value;
        fecharEditor();
        renderItens();
      },
      onCancel: () => fecharEditor(),
    });
    editorContainer.appendChild(editor.element);
    editor.focus();
  }

  function renderItens() {
    tbody.innerHTML = '';
    if (!itens.length) {
      tbody.appendChild(el('tr', {}, [
        el('td', { className: 'dfd-itens-table__empty', colSpan: '6', textContent: 'Nenhum item adicionado' }),
      ]));
      return;
    }
    itens.forEach((it, idx) => {
      const editBtn = el('button', {
        className: 'data-table__action-btn',
        type: 'button',
        title: 'Editar item',
        'aria-label': 'Editar item',
        onClick: () => abrirEditor(idx),
      }, [svgIcon(ICONS.edit, 16)]);
      const removeBtn = el('button', {
        className: 'data-table__action-btn data-table__action-btn--danger',
        type: 'button',
        title: 'Remover item',
        'aria-label': 'Remover item',
        onClick: () => { itens.splice(idx, 1); renderItens(); },
      }, [svgIcon(ICONS.delete, 16)]);

      tbody.appendChild(el('tr', {}, [
        el('td', { textContent: tipoNome.get(String(it.tipo_item_id)) || '-' }),
        el('td', { textContent: it.descricao || '-' }),
        el('td', { className: 'dfd-itens-table__num', textContent: it.quantidade != null ? String(it.quantidade) : '-' }),
        el('td', { className: 'dfd-itens-table__num', textContent: formatCurrency(it.valor_unitario) }),
        el('td', { className: 'dfd-itens-table__num', textContent: formatCurrency(it.valor_total) }),
        el('td', { className: 'dfd-itens-table__actions' }, [editBtn, removeBtn]),
      ]));
    });
  }

  const itensTable = el('table', { className: 'dfd-itens-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { textContent: 'Tipo' }),
        el('th', { textContent: 'Descrição' }),
        el('th', { className: 'dfd-itens-table__num', textContent: 'Qtd' }),
        el('th', { className: 'dfd-itens-table__num', textContent: 'V. unitário' }),
        el('th', { className: 'dfd-itens-table__num', textContent: 'V. total' }),
        el('th', { 'aria-label': 'Ações' }),
      ]),
    ]),
    tbody,
  ]);

  renderItens();

    // Histórico de alterações, RECOLHIDO e só na edição.
    //
    // Recolhido porque o diálogo já é um formulário cheio: aberto, ele cobraria
    // uma consulta de quem só veio corrigir um campo. Só na edição porque num
    // cadastro novo não há o que mostrar.
    const historico = isEdit
      ? criarHistorico({
        modulo: 'orcamento',
        entidade: 'dfd',
        id: dfd.id,
        titulo: 'Histórico de alterações',
        subtitulo: 'Alteracoes neste DFD e nos itens dele',
        recolhido: true,
      })
      : null;

  const content = el('div', {}, [
    el('div', { className: 'form-grid' }, [
      numeroField.element,
      rotuloField.element,
      areaField.element,
      el('div', { className: 'form-grid__full' }, [objetoField.element]),
      el('div', { className: 'form-grid__full' }, [justificativaField.element]),
      grauField.element,
      dataPrevistaField.element,
      cpfField.element,
      vinculoField.element,
      el('div', { className: 'form-grid__full' }, [constaPcaField.element]),
    ]),
    el('div', { className: 'dfd-itens-section' }, [
      el('div', { className: 'dfd-itens-section__header' }, [
        el('h3', { className: 'dfd-itens-section__title', textContent: 'Itens do DFD' }),
        addItemBtn,
      ]),
      itensTable,
      editorContainer,
    ]),
    el('div', { className: 'dfd-itens-section' }, [
      el('div', { className: 'dfd-itens-section__header' }, [
        el('h3', { className: 'dfd-itens-section__title', textContent: 'Anexo (PDF do DFD)' }),
      ]),
      anexo.element,
    ]),
    historico ? historico.element : null,
  ]);

  let saving = false;

  openModal({
    title: isEdit ? `Editar DFD (${dfd.ano})` : `Novo DFD (${getAno()})`,
    content,
    width: '820px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close }) => {
          if (saving) return;

          numeroField.setError(null);

          let valid = true;
          if (!numeroField.getValue()) {
            numeroField.setError('Informe o número do DFD');
            valid = false;
          }
          // Se houver um item em edicao, tenta consolida-lo antes de salvar.
          if (editor && !editor.trySave()) valid = false;
          if (!valid) return;

          const body = {
            numero: numeroField.getValue(),
            ano: isEdit ? dfd.ano : getAno(),
            rotulo: orNull(rotuloField.getValue()),
            objeto: orNull(objetoField.getValue()),
            justificativa: orNull(justificativaField.getValue()),
            area_requisitante: orNull(areaField.getValue()),
            grau_prioridade_id: grauField.getValue(),
            data_prevista_conclusao: dataPrevistaField.getValue(),
            responsavel_cpf: orNull(cpfField.getValue()),
            vinculo_plano_gestao: orNull(vinculoField.getValue()),
            consta_pca: constaPcaField.getValue(),
            itens,
          };

          saving = true;
          try {
            if (isEdit) {
              await svc.updateDfd(dfd.id, body);
              showSuccess('DFD atualizado com sucesso');
            } else {
              const criado = await svc.createDfd(body);
              // Envia o anexo retido (se houver) agora que o DFD tem id.
              if (anexo.hasPending() && criado && criado.id != null) {
                try {
                  await anexo.flush({ dfd_id: criado.id });
                } catch (errAnexo) {
                  showError(
                    'DFD criado, mas houve falha ao anexar o PDF: ' +
                      (errAnexo.message || 'erro desconhecido')
                  );
                }
              }
              showSuccess('DFD criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar DFD');
          } finally {
            saving = false;
          }
        },
      },
    ],
  });
}
