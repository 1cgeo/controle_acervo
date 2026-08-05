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
import { formatCurrency, formatDateTime } from '@utils/format.js';
import * as svc from '@modules/orcamento/services/orcamento-service.js';
import { createFileAttachment } from '@modules/orcamento/components/file-attachment.js';

/** String vazia vira null (campos opcionais da API). */
function orNull(value) {
  return value === '' || value === undefined ? null : value;
}

/**
 * CPF no formato aceito: 11 digitos, com ou sem pontuacao.
 *
 * So o formato, e nao os digitos verificadores: o campo e antigo e ja tem valor
 * gravado. Reprovar um CPF legado aqui travaria a correcao de qualquer OUTRO
 * campo do mesmo DFD.
 *
 * @param {string} texto
 * @returns {boolean}
 */
function cpfNoFormato(texto) {
  return /^\d{11}$/.test(String(texto).replace(/\D/g, ''));
}

/**
 * Bloco de fatos de auditoria do registro: quando e por quem.
 *
 * O historico de alteracoes e mais novo que os DFDs ja gravados: para elas o
 * historico
 * abre vazio, e a data de cadastro e a unica rastreabilidade em tela.
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
 * O total gravado do item foi digitado na mao?
 *
 * Verdadeiro quando o item tem total e ele NAO e quantidade x unitario. Sem
 * quantidade ou sem unitario nao ha produto para comparar, e o total so pode ter
 * vindo da mao.
 *
 * @param {Object|null} item
 * @returns {boolean}
 */
function totalDivergeDoProduto(item) {
  if (!item || item.valor_total == null) return false;
  if (item.quantidade == null || item.valor_unitario == null) return true;
  const produto = Math.round(Number(item.quantidade) * Number(item.valor_unitario) * 100) / 100;
  if (isNaN(produto)) return true;
  // Tolerancia de centavo: o produto de dois NUMERIC volta do banco como texto e
  // a multiplicacao em ponto flutuante deixa residuo.
  return Math.abs(Number(item.valor_total) - produto) >= 0.005;
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
    // `cod_catmat_catser VARCHAR(30)` (er/orcamento.sql:62). A tela aceitava 50
    // e o banco recusava o resto.
    maxLength: 30,
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

  // Auto-calculo do total: enquanto o total gravado for o proprio produto
  // quantidade x unitario, editar a quantidade recalcula o total.
  //
  // A marca antiga era `item?.valor_total != null`, verdadeira em TODA edicao de
  // item ja salvo, nos 26 itens reais: o recalculo nunca disparava e o texto de
  // ajuda prometia um comportamento que a tela nao tinha. Agora so conta como
  // "digitado na mao" o total que DIVERGE do produto, com tolerancia de centavo.
  let totalTocado = totalDivergeDoProduto(item);
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
 * No create grava o ano recebido; no edit mantem o ano do registro.
 * @param {Object} options
 * @param {Object|null} [options.dfd] - DFD existente (ja com itens) para editar
 * @param {number} [options.ano] - ano da TELA que abriu o dialog. O dialog nao
 *   tem barra de filtros, entao quem o abre passa o ano; ele nunca le um store
 *   global. Sem o parametro vale o ano atual, o mesmo padrao do filtro da tela.
 * @param {Object} options.dominios - { grauPrioridade, tipoItem }
 * @param {Object} [options.padroes] - valores padrao do DFD novo, medidos na lista
 * @param {boolean} [options.somenteLeitura] - abre a ficha sem permitir salvar
 * @param {Function} [options.onSaved] - chamado apos salvar com sucesso
 */
export function openDfdDialog({
  dfd = null,
  ano = new Date().getFullYear(),
  dominios = {},
  padroes = {},
  somenteLeitura = false,
  onSaved = null,
} = {}) {
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
    // Os limites da tela seguem o DDL (er/orcamento.sql:40,42,49): `numero`
    // VARCHAR(20), `rotulo` VARCHAR(120), `vinculo_plano_gestao` VARCHAR(60). A
    // tela aceitava 50, 255 e 255, e o banco recusava o excedente na hora de
    // salvar, depois do formulario inteiro preenchido.
    maxLength: 20,
  });
  const rotuloField = createTextField({
    label: 'Rótulo',
    value: dfd?.rotulo ?? '',
    maxLength: 120,
  });
  const objetoField = createTextareaField({
    label: 'Objeto',
    value: dfd?.objeto ?? '',
  });
  const justificativaField = createTextareaField({
    label: 'Justificativa',
    value: dfd?.justificativa ?? '',
  });
  // O DFD novo nasce com a area requisitante e o vinculo do plano de gestao que
  // a lista do ano mostra: os dois campos sao iguais nos 8 DFDs reais.
  const areaField = createTextField({
    label: 'Área requisitante',
    value: dfd?.area_requisitante ?? padroes.area_requisitante ?? '',
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
    placeholder: '000.000.000-00',
    helpText: '11 dígitos, com ou sem pontuação.',
  });
  const vinculoField = createTextField({
    label: 'Vínculo com plano de gestão',
    value: dfd?.vinculo_plano_gestao ?? padroes.vinculo_plano_gestao ?? '',
    maxLength: 60,
  });
  // O valor estimado e o numero que o DFD leva ao PCA, e a lista ja o mostrava
  // numa coluna. Nenhuma tela permitia informa-lo: o corpo saia sem o campo e o
  // servidor caia em resolveValorEstimado(undefined, itens), que grava null sem
  // itens e 0 com itens sem valor_total. Editar o objeto de um DFD sem itens
  // zerava o valor. Em branco, o servidor volta a somar os itens.
  const valorEstimadoField = createNumberField({
    label: 'Valor estimado',
    min: 0,
    step: 0.01,
    value: dfd?.valor_estimado ?? undefined,
    helpText: 'Em branco, soma os itens.',
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
      // Em leitura a linha nao tem botao: a celula de acoes fica vazia, e a
      // tabela mantem as seis colunas do cabecalho.
      if (somenteLeitura) {
        tbody.appendChild(el('tr', {}, [
          el('td', { textContent: tipoNome.get(String(it.tipo_item_id)) || '-' }),
          el('td', { textContent: it.descricao || '-' }),
          el('td', { className: 'dfd-itens-table__num', textContent: it.quantidade != null ? String(it.quantidade) : '-' }),
          el('td', { className: 'dfd-itens-table__num', textContent: formatCurrency(it.valor_unitario) }),
          el('td', { className: 'dfd-itens-table__num', textContent: formatCurrency(it.valor_total) }),
          el('td', { className: 'dfd-itens-table__actions' }),
        ]));
        return;
      }
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

  const fatos = isEdit ? blocoDeFatos(dfd) : null;

  const content = el('div', {}, [
    // O cabecalho ganha titulo de secao, como "Itens do DFD" e "Anexo" ja
    // tinham: eram 10 campos soltos no topo, sem nome que dissesse do que se
    // trata. Sem a borda e o respiro do topo, que a classe usa para SEPARAR de
    // uma secao anterior, e aqui nao ha secao anterior.
    el('div', {
      className: 'dfd-itens-section',
      style: { marginTop: '0', borderTop: 'none', paddingTop: '0' },
    }, [
      el('div', { className: 'dfd-itens-section__header' }, [
        el('h3', { className: 'dfd-itens-section__title', textContent: 'Dados do DFD' }),
      ]),
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
        valorEstimadoField.element,
        el('div', { className: 'form-grid__full' }, [constaPcaField.element]),
        fatos ? el('div', { className: 'form-grid__full' }, [fatos]) : null,
      ].filter(Boolean)),
    ]),
    el('div', { className: 'dfd-itens-section' }, [
      el('div', { className: 'dfd-itens-section__header' }, [
        el('h3', { className: 'dfd-itens-section__title', textContent: 'Itens do DFD' }),
        somenteLeitura ? null : addItemBtn,
      ].filter(Boolean)),
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

  // Leitura: os campos ficam desabilitados e o rodape so tem Fechar. O anexo
  // segue de fora, porque o widget tem gate proprio e quem consulta pode baixar.
  if (somenteLeitura) {
    for (const campo of [
      numeroField, rotuloField, objetoField, justificativaField, areaField,
      grauField, dataPrevistaField, cpfField, vinculoField, valorEstimadoField,
      constaPcaField,
    ]) {
      campo.input.disabled = true;
    }
  }

  let saving = false;

  const acoesLeitura = [
    { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
  ];

  const acoesEdicao = [
    { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
    {
      label: 'Salvar',
      variant: 'primary',
      onClick: async ({ close }) => {
        if (saving) return;

        numeroField.setError(null);
        cpfField.setError(null);

        let valid = true;
        if (!numeroField.getValue()) {
          numeroField.setError('Informe o número do DFD');
          valid = false;
        }
        // O CPF tinha maxLength e nenhuma validacao: qualquer texto de ate 14
        // caracteres virava "CPF do responsavel" no PCA.
        const cpf = cpfField.getValue();
        if (cpf && !cpfNoFormato(cpf)) {
          cpfField.setError('CPF deve ter 11 dígitos');
          valid = false;
        }
        // Se houver um item em edicao, tenta consolida-lo antes de salvar.
        if (editor && !editor.trySave()) valid = false;
        if (!valid) return;

        const body = {
          numero: numeroField.getValue(),
          ano: isEdit ? dfd.ano : ano,
          rotulo: orNull(rotuloField.getValue()),
          objeto: orNull(objetoField.getValue()),
          justificativa: orNull(justificativaField.getValue()),
          area_requisitante: orNull(areaField.getValue()),
          grau_prioridade_id: grauField.getValue(),
          data_prevista_conclusao: dataPrevistaField.getValue(),
          responsavel_cpf: orNull(cpfField.getValue()),
          vinculo_plano_gestao: orNull(vinculoField.getValue()),
          valor_estimado: valorEstimadoField.getValue(),
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
            //
            // O SUCESSO SÓ SAI SE O ANEXO SUBIU. A mensagem de falha vinha
            // primeiro e o "DFD criado com sucesso" logo depois, por cima dela:
            // o último toast dizia sucesso, o diálogo fechava e o PDF escolhido
            // ia junto. Quem confiasse no aviso final acharia que o anexo está
            // no servidor.
            let anexoFalhou = null;
            if (anexo.hasPending() && criado && criado.id != null) {
              try {
                await anexo.flush({ dfd_id: criado.id });
              } catch (errAnexo) {
                anexoFalhou = errAnexo.message || 'erro desconhecido';
              }
            }
            if (anexoFalhou) {
              showError(
                `O DFD ${body.numero} foi criado, mas o PDF NÃO foi anexado: ${
                  anexoFalhou}. Abra o DFD em Editar e anexe o arquivo de novo.`
              );
            } else {
              showSuccess('DFD criado com sucesso');
            }
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
  ];

  const tituloLeitura = isEdit ? `DFD ${dfd.numero} (${dfd.ano})` : 'DFD';

  openModal({
    title: somenteLeitura
      ? tituloLeitura
      : (isEdit ? `Editar DFD (${dfd.ano})` : `Novo DFD (${ano})`),
    content,
    width: '820px',
    actions: somenteLeitura ? acoesLeitura : acoesEdicao,
  });
}
