import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { criarHistorico } from '@components/historico/historico.js';
import {
  createTextField,
  createSelectField,
  createNumberField,
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
 * Bloco de fatos de auditoria do registro: quando e por quem.
 *
 * O historico de alteracoes e mais novo que os DFDs ja gravados: para eles o
 * historico abre vazio, e a data de cadastro e a unica rastreabilidade em tela.
 *
 * SO O CADASTRO. `dfd.data_modificacao` e `dfd.usuario_modificacao_uuid` sairam
 * do banco em 2026-08-08: nenhum DFD jamais foi editado em 8 de 8, e quem
 * responde "o que mudou, quando e por quem" e o painel de historico logo abaixo,
 * que traz o diff pronto.
 *
 * @param {Object} registro - linha com as colunas de cadastro
 * @returns {HTMLElement|null} null quando nao ha data de cadastro
 */
function blocoDeFatos(registro) {
  if (!registro || !registro.data_cadastramento) return null;

  const texto = `Cadastrado em ${formatDateTime(registro.data_cadastramento)}`
    + (registro.usuario_cadastramento ? ` por ${registro.usuario_cadastramento}` : '')
    + '.';

  return el('p', {
    className: 'form-field__help',
    textContent: texto,
    style: { margin: '0' },
  });
}

/**
 * O total do item, para EXIBIR.
 *
 * O total nao e mais digitado: desde 2026-08-08 ele e derivado de
 * quantidade x valor unitario, e o servidor e quem o calcula. O item que ja veio
 * do servidor traz o numero pronto; o item recem-adicionado no editor inline
 * ainda nao passou por la, e o produto e a mesma conta que o servidor vai fazer.
 *
 * @param {Object} item
 * @returns {number|null} null quando nao ha o que multiplicar
 */
function totalDoItem(item) {
  if (!item) return null;
  if (item.valor_total != null) return Number(item.valor_total);
  if (item.quantidade == null || item.valor_unitario == null) return null;
  const produto = Math.round(Number(item.quantidade) * Number(item.valor_unitario) * 100) / 100;
  return isNaN(produto) ? null : produto;
}

/**
 * Editor inline e enxuto de UM item do DFD. Aparece abaixo da tabela ao
 * adicionar ou editar um item.
 *
 * NAO HA CAMPO "Valor total". Ele era digitavel e vinha calculado, e nos 31
 * itens reais era `quantidade x valor_unitario` em 31 de 31: um campo cujo unico
 * estado possivel diferente do calculo seria um erro de digitacao. A coluna saiu
 * do banco em 2026-08-08 e virou derivada; a TABELA ao lado continua mostrando o
 * total, marcado como calculado.
 *
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
  // O total APARECE enquanto se digita, e nao e um campo: quem preenche precisa
  // ver o numero que vai valer antes de salvar, e nao ha o que ele possa fazer
  // com ele alem de conferir.
  const totalCalculado = el('p', {
    className: 'form-field__help',
    style: { margin: '0', alignSelf: 'end' },
  });
  function pintarTotal() {
    const total = totalDoItem({
      quantidade: quantidadeField.getValue(),
      valor_unitario: valorUnitarioField.getValue(),
    });
    totalCalculado.textContent = total == null
      ? 'Valor total: informe quantidade e valor unitário.'
      : `Valor total (calculado): ${formatCurrency(total)}`;
  }
  quantidadeField.input.addEventListener('input', pintarTotal);
  valorUnitarioField.input.addEventListener('input', pintarTotal);
  pintarTotal();

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
      totalCalculado,
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
      // SEM `valor_total`: a coluna virou derivada em 2026-08-08, e o validador
      // estrito do módulo devolve 400 para chave desconhecida.
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
 * @param {Object} options.dominios - { tipoItem }
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
    tipoItem = [],
  } = dominios;

  const tipoNome = new Map(tipoItem.map((t) => [String(t.code), t.nome]));

  const numeroField = createTextField({
    label: 'Número',
    required: true,
    value: dfd?.numero ?? '',
    // Os limites da tela seguem o DDL (er/orcamento.sql:40,42): `numero`
    // VARCHAR(20) e `rotulo` VARCHAR(120). A tela aceitava 50 e 255, e o banco
    // recusava o excedente na hora de salvar, depois do formulario inteiro
    // preenchido.
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
  // O DFD novo nasce com a area requisitante que a lista do ano mostra: ela e
  // igual nos 8 DFDs reais, e redigita-la a cada cadastro so cria divergencia de
  // grafia.
  //
  // OS CINCO CAMPOS QUE SAIRAM DAQUI em 2026-08-08: justificativa, grau de
  // prioridade, data prevista de conclusao, CPF do responsavel e vinculo com o
  // plano de gestao. Os tres primeiros e o CPF estavam em 0 de 8 DFDs, nenhum
  // DFD jamais foi editado, e nada no sistema os lia; o vinculo tinha UM valor
  // distinto em 8 de 8 ('Plano de Gestão do 1º CGEO'), que e uma constante
  // disfarcada de coluna. O CPF tinha um motivo a mais: dado pessoal num
  // repositorio publico e num banco que nao precisa dele.
  const areaField = createTextField({
    label: 'Área requisitante',
    value: dfd?.area_requisitante ?? padroes.area_requisitante ?? '',
    maxLength: 255,
  });
  // O valor estimado e o numero que o DFD leva ao PCA, e a lista o mostra numa
  // coluna. Ele NAO SE DIGITA MAIS: em 8 de 8 DFDs ele era exatamente a soma dos
  // `valor_total` dos itens, e desde 2026-08-08 quem o calcula e o servidor. O
  // campo fica na tela, desabilitado, pelo mesmo motivo do GND no item do PDR:
  // quem preenche precisa ver o numero que vai valer.
  const valorEstimadoField = createNumberField({
    label: 'Valor estimado',
    value: dfd?.valor_estimado ?? undefined,
    helpText: 'Calculado: soma dos itens.',
  });
  valorEstimadoField.input.disabled = true;
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

  /**
   * As celulas de dado de UMA linha, iguais em leitura e em edicao.
   *
   * A coluna CATMAT/CATSER entrou aqui em 2026-08-08: o editor pedia o codigo do
   * catalogo federal desde sempre e a tabela ao lado nao tinha a coluna, entao
   * ele era GRAVAVEL E INVISIVEL, como o ano de referencia do recebimento.
   *
   * O valor total sai de `totalDoItem`, e nao mais da coluna: ele e derivado
   * desde 2026-08-08, e o item recem-adicionado no editor ainda nao passou pelo
   * servidor que o calcula.
   */
  function celulasDoItem(it) {
    return [
      el('td', { textContent: tipoNome.get(String(it.tipo_item_id)) || '-' }),
      el('td', { textContent: it.cod_catmat_catser || '-' }),
      el('td', { textContent: it.descricao || '-' }),
      el('td', { className: 'dfd-itens-table__num', textContent: it.quantidade != null ? String(it.quantidade) : '-' }),
      el('td', { className: 'dfd-itens-table__num', textContent: formatCurrency(it.valor_unitario) }),
      el('td', { className: 'dfd-itens-table__num', textContent: formatCurrency(totalDoItem(it)) }),
    ];
  }

  function renderItens() {
    tbody.innerHTML = '';
    if (!itens.length) {
      tbody.appendChild(el('tr', {}, [
        el('td', { className: 'dfd-itens-table__empty', colSpan: '7', textContent: 'Nenhum item adicionado' }),
      ]));
      return;
    }
    itens.forEach((it, idx) => {
      // Em leitura a linha nao tem botao: a celula de acoes fica vazia, e a
      // tabela mantem as sete colunas do cabecalho.
      if (somenteLeitura) {
        tbody.appendChild(el('tr', {}, [
          ...celulasDoItem(it),
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
        ...celulasDoItem(it),
        el('td', { className: 'dfd-itens-table__actions' }, [editBtn, removeBtn]),
      ]));
    });
  }

  const itensTable = el('table', { className: 'dfd-itens-table' }, [
    el('thead', {}, [
      el('tr', {}, [
        el('th', { textContent: 'Tipo' }),
        el('th', { textContent: 'CATMAT/CATSER' }),
        el('th', { textContent: 'Descrição' }),
        el('th', { className: 'dfd-itens-table__num', textContent: 'Qtd' }),
        el('th', { className: 'dfd-itens-table__num', textContent: 'V. unitário' }),
        // O rotulo diz que o numero e CALCULADO: ele deixou de ser digitavel em
        // 2026-08-08, e sem a marca a coluna se le como campo que alguem
        // preencheu.
        el('th', { className: 'dfd-itens-table__num', textContent: 'V. total (calc.)' }),
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
  // O valor estimado ja nasce desabilitado, nos dois modos.
  if (somenteLeitura) {
    for (const campo of [
      numeroField, rotuloField, objetoField, areaField, constaPcaField,
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

        let valid = true;
        if (!numeroField.getValue()) {
          numeroField.setError('Informe o número do DFD');
          valid = false;
        }
        // Se houver um item em edicao, tenta consolida-lo antes de salvar.
        if (editor && !editor.trySave()) valid = false;
        if (!valid) return;

        // SEM `justificativa`, `grau_prioridade_id`, `data_prevista_conclusao`,
        // `responsavel_cpf`, `vinculo_plano_gestao` e `valor_estimado`: as cinco
        // primeiras sairam do banco em 2026-08-08 e a ultima virou derivada da
        // soma dos itens. O validador estrito do modulo devolve 400 para chave
        // desconhecida.
        const body = {
          numero: numeroField.getValue(),
          ano: isEdit ? dfd.ano : ano,
          rotulo: orNull(rotuloField.getValue()),
          objeto: orNull(objetoField.getValue()),
          area_requisitante: orNull(areaField.getValue()),
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
