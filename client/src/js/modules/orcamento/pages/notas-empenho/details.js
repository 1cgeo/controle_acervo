import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, formatDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  createTextField,
  createNumberField,
  createDateField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import {
  getNotaEmpenho,
  getLiquidacoes,
  createLiquidacao,
  updateLiquidacao,
  deleteLiquidacao,
  getRecebimentos,
  createRecebimento,
  updateRecebimento,
  deleteRecebimento,
} from '@modules/orcamento/services/orcamento-service.js';
import { permissoes } from '@store/auth-store.js';

function infoRow(label, value) {
  return el('div', { className: 'detail-card__row' }, [
    el('span', { className: 'detail-card__label', textContent: label }),
    value instanceof Node
      ? el('span', { className: 'detail-card__value' }, [value])
      : el('span', { className: 'detail-card__value', textContent: value || '-' }),
  ]);
}

/**
 * Pagina de detalhes de uma Nota de Empenho (#/notas_empenho/:id).
 * Cabecalho com os dados da NE e duas secoes com data-table:
 * liquidacoes e recebimentos de material, cada uma com criar/editar/excluir.
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderNotaEmpenhoDetails(container, { params }) {
  const notaEmpenhoId = Number(params.id);
  let disposed = false;
  let liquidacoesTable = null;
  let recebimentosTable = null;
  // Liquidacao e recebimento seguem o corte do modulo: lancar e editar sao
  // operador, excluir e gerente. Quem so consulta ve as duas tabelas cheias.
  const pode = permissoes('orcamento');

  const root = el('div', { className: 'page' });
  container.appendChild(root);

  function cleanupTables() {
    if (liquidacoesTable) { liquidacoesTable._cleanup(); liquidacoesTable = null; }
    if (recebimentosTable) { recebimentosTable._cleanup(); recebimentosTable = null; }
  }

  // ---------------------------------------------------------------------------
  // Liquidacoes
  // ---------------------------------------------------------------------------
  function novaLiquidacao() {
    abrirLiquidacaoDialog({});
  }

  function editarLiquidacao(row) {
    abrirLiquidacaoDialog({ liquidacao: row });
  }

  function abrirLiquidacaoDialog({ liquidacao = null }) {
    const isEdit = Boolean(liquidacao);

    const valorField = createNumberField({
      label: 'Valor liquidado',
      required: true,
      min: 0,
      step: 0.01,
      value: liquidacao?.valor_liquidado ?? undefined,
    });
    const dataField = createDateField({
      label: 'Data',
      value: liquidacao?.data ?? '',
    });
    const documentoField = createTextField({
      label: 'Documento (NS)',
      maxLength: 30,
      placeholder: 'Ex.: 2025NS000045',
      value: liquidacao?.documento_ns ?? '',
    });

    const content = el('div', { className: 'form-grid' }, [
      valorField.element,
      dataField.element,
      el('div', { className: 'form-grid__full' }, [documentoField.element]),
    ]);

    let saving = false;

    openModal({
      title: isEdit ? 'Editar liquidação' : 'Nova liquidação',
      content,
      width: '560px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Salvar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (saving) return;

            valorField.setError(null);
            const valor = valorField.getValue();
            if (valor === null || valor <= 0) {
              valorField.setError('Informe um valor maior que zero');
              return;
            }

            const body = {
              valor_liquidado: valor,
              data: dataField.getValue(),
              documento_ns: documentoField.getValue() || null,
            };

            saving = true;
            try {
              if (isEdit) {
                await updateLiquidacao(liquidacao.id, body);
                showSuccess('Liquidação atualizada com sucesso');
              } else {
                await createLiquidacao({ nota_empenho_id: notaEmpenhoId, ...body });
                showSuccess('Liquidação registrada com sucesso');
              }
              close();
              load();
            } catch (err) {
              showError(err.message || 'Erro ao salvar liquidação');
            } finally {
              saving = false;
            }
          },
        },
      ],
    });
  }

  async function excluirLiquidacao(row) {
    const ok = await confirmDialog({
      title: 'Excluir liquidação',
      message: `Excluir a liquidação de ${formatCurrency(row.valor_liquidado)}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteLiquidacao(row.id);
      showSuccess('Liquidação excluída com sucesso');
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir liquidação');
    }
  }

  // ---------------------------------------------------------------------------
  // Recebimentos de material
  // ---------------------------------------------------------------------------
  function novoRecebimento() {
    abrirRecebimentoDialog({});
  }

  function editarRecebimento(row) {
    abrirRecebimentoDialog({ recebimento: row });
  }

  function abrirRecebimentoDialog({ recebimento = null }) {
    const isEdit = Boolean(recebimento);

    const materialField = createTextareaField({
      label: 'Material',
      required: true,
      value: recebimento?.material ?? '',
    });
    const prazoField = createTextField({
      label: 'Prazo de entrega',
      maxLength: 100,
      value: recebimento?.prazo_entrega ?? '',
    });
    const situacaoField = createTextareaField({
      label: 'Situação',
      value: recebimento?.situacao ?? '',
    });
    const anoRefField = createNumberField({
      label: 'Ano de referência (3.6)',
      step: 1,
      value: recebimento?.ano_referencia ?? undefined,
      helpText: 'Ano em que o material foi recebido, ou seja, em que RPCMTec (3.6) deve constar. Em branco usa o ano do empenho. Use para itens de RPNP (empenho de ano anterior) recebidos neste ano.',
    });

    const content = el('div', { className: 'form-grid' }, [
      el('div', { className: 'form-grid__full' }, [materialField.element]),
      prazoField.element,
      anoRefField.element,
      el('div', { className: 'form-grid__full' }, [situacaoField.element]),
    ]);

    let saving = false;

    openModal({
      title: isEdit ? 'Editar recebimento' : 'Novo recebimento',
      content,
      width: '560px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Salvar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (saving) return;

            materialField.setError(null);
            const material = materialField.getValue();
            if (!material) {
              materialField.setError('Informe o material');
              return;
            }

            const body = {
              material,
              prazo_entrega: prazoField.getValue() || null,
              situacao: situacaoField.getValue() || null,
              ano_referencia: anoRefField.getValue(),
            };

            saving = true;
            try {
              if (isEdit) {
                await updateRecebimento(recebimento.id, body);
                showSuccess('Recebimento atualizado com sucesso');
              } else {
                await createRecebimento({ nota_empenho_id: notaEmpenhoId, ...body });
                showSuccess('Recebimento registrado com sucesso');
              }
              close();
              load();
            } catch (err) {
              showError(err.message || 'Erro ao salvar recebimento');
            } finally {
              saving = false;
            }
          },
        },
      ],
    });
  }

  async function excluirRecebimento(row) {
    const ok = await confirmDialog({
      title: 'Excluir recebimento',
      message: 'Excluir este recebimento de material? Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteRecebimento(row.id);
      showSuccess('Recebimento excluído com sucesso');
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir recebimento');
    }
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function renderNota(nota) {
    cleanupTables();
    clearChildren(root);

    // Header com botao voltar
    root.appendChild(el('div', { className: 'page__header' }, [
      el('div', {}, [
        el('button', {
          className: 'btn btn--text btn--sm',
          type: 'button',
          onClick: () => { location.hash = '/orcamento/notas_empenho'; },
        }, [svgIcon(ICONS.arrowBack, 16), 'Voltar']),
        el('h1', { className: 'page__title', textContent: `Nota de empenho ${nota.numero || `#${nota.id}`}` }),
      ]),
    ]));

    // Cabecalho com os dados da NE
    root.appendChild(el('div', { className: 'detail-cards' }, [
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Dados da NE' }),
        infoRow('Número', nota.numero),
        infoRow('Ano', nota.ano != null ? String(nota.ano) : '-'),
        infoRow(
          (nota.notas_credito && nota.notas_credito.length > 1) ? 'Notas de crédito (rateio)' : 'Nota de crédito',
          (nota.notas_credito && nota.notas_credito.length)
            ? el('div', {}, nota.notas_credito.map(a => el('div', {
              textContent: `${a.nota_credito_numero ?? `NC ${a.nota_credito_id}`}: ${formatCurrency(a.valor)}`,
            })))
            : nota.nota_credito_numero,
        ),
        infoRow('ND (herdada da NC)', nota.cod_nd ? (nota.nd_nome ? `${nota.cod_nd} - ${nota.nd_nome}` : nota.cod_nd) : '-'),
      ]),
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Valores' }),
        infoRow('Empenhado', formatCurrency(nota.valor_empenhado)),
        infoRow('Anulado', formatCurrency(nota.valor_anulado)),
        infoRow('Saldo a liquidar', formatCurrency(nota.saldo_a_liquidar)),
      ]),
    ]));

    // ---- Secao: Liquidacoes ----
    liquidacoesTable = createDataTable({
      columns: [
        {
          key: 'valor_liquidado',
          label: 'Valor liquidado',
          sortable: true,
          render: (row) => formatCurrency(row.valor_liquidado),
        },
        {
          key: 'data',
          label: 'Data',
          sortable: true,
          render: (row) => formatDate(row.data),
        },
        {
          key: 'documento_ns',
          label: 'Documento (NS)',
          render: (row) => row.documento_ns || '-',
        },
      ],
      rows: nota.liquidacoes || [],
      pageSize: 10,
      emptyMessage: 'Nenhuma liquidação registrada',
      actions: [
        ...(pode.operador ? [{
          icon: ICONS.edit,
          title: 'Editar liquidação',
          onClick: (row) => editarLiquidacao(row),
        }] : []),
        ...(pode.gerente ? [{
          icon: ICONS.delete,
          title: 'Excluir liquidação',
          variant: 'danger',
          onClick: (row) => excluirLiquidacao(row),
        }] : []),
      ],
    });

    root.appendChild(el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Liquidações' }),
        el('div', { className: 'dashboard-section__controls' }, pode.operador ? [
          el('button', {
            className: 'btn btn--primary btn--sm',
            type: 'button',
            onClick: novaLiquidacao,
          }, [svgIcon(ICONS.add, 14), 'Nova liquidação']),
        ] : []),
      ]),
      liquidacoesTable.element,
    ]));

    // ---- Secao: Recebimentos de material ----
    recebimentosTable = createDataTable({
      columns: [
        {
          key: 'material',
          label: 'Material',
          render: (row) => row.material || '-',
        },
        {
          key: 'prazo_entrega',
          label: 'Prazo de entrega',
          render: (row) => row.prazo_entrega || '-',
        },
        {
          key: 'situacao',
          label: 'Situação',
          render: (row) => row.situacao || '-',
        },
      ],
      rows: nota.recebimentos || [],
      pageSize: 10,
      emptyMessage: 'Nenhum recebimento de material registrado',
      actions: [
        ...(pode.operador ? [{
          icon: ICONS.edit,
          title: 'Editar recebimento',
          onClick: (row) => editarRecebimento(row),
        }] : []),
        ...(pode.gerente ? [{
          icon: ICONS.delete,
          title: 'Excluir recebimento',
          variant: 'danger',
          onClick: (row) => excluirRecebimento(row),
        }] : []),
      ],
    });

    root.appendChild(el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Recebimentos de material' }),
        el('div', { className: 'dashboard-section__controls' }, pode.operador ? [
          el('button', {
            className: 'btn btn--primary btn--sm',
            type: 'button',
            onClick: novoRecebimento,
          }, [svgIcon(ICONS.add, 14), 'Novo recebimento']),
        ] : []),
      ]),
      recebimentosTable.element,
    ]));
  }

  async function load() {
    cleanupTables();
    clearChildren(root);
    root.appendChild(el('div', { className: 'data-table__empty', textContent: 'Carregando nota de empenho...' }));

    let nota;
    let liquidacoes = [];
    let recebimentos = [];
    try {
      [nota, liquidacoes, recebimentos] = await Promise.all([
        getNotaEmpenho(notaEmpenhoId),
        getLiquidacoes(notaEmpenhoId),
        getRecebimentos(notaEmpenhoId),
      ]);
    } catch (err) {
      if (disposed) return;
      clearChildren(root);
      showError(err.message || 'Erro ao carregar a nota de empenho');
      root.appendChild(el('div', { className: 'data-table__empty', textContent: err.message || 'Nota de empenho não encontrada' }));
      root.appendChild(el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => { location.hash = '/orcamento/notas_empenho'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar']));
      return;
    }
    if (disposed) return;

    // As liquidacoes e recebimentos podem vir embutidos na NE ou em endpoints
    // proprios; usamos os endpoints proprios como fonte das sub-tabelas.
    nota.liquidacoes = liquidacoes || nota.liquidacoes || [];
    nota.recebimentos = recebimentos || nota.recebimentos || [];

    renderNota(nota);
  }

  await load();

  return () => {
    disposed = true;
    cleanupTables();
  };
}
