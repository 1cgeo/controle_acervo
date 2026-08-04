import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { reconciliar } from '@utils/reconciliar.js';
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
import { criarHistorico } from '@components/historico/historico.js';

/**
 * Linha rotulo/valor do cartao, com os dois nos guardados para repintura.
 *
 * Devolve os nos em vez de so a linha porque a ficha se RECARREGA a cada
 * gravacao. Com os nos na mao, a recarga escreve o valor novo no mesmo no, e a
 * tela nao se move. O rotulo tambem muda em um caso: a nota de credito vira
 * "rateio" quando ha mais de uma.
 *
 * @param {string} rotulo
 * @returns {{element:HTMLElement, label:HTMLElement, valor:HTMLElement}}
 */
function criarLinha(rotulo) {
  const label = el('span', { className: 'detail-card__label', textContent: rotulo });
  const valor = el('span', { className: 'detail-card__value' });
  return {
    element: el('div', { className: 'detail-card__row' }, [label, valor]),
    label,
    valor,
  };
}

/** Uma parcela do rateio, como ela aparece na linha da nota de credito. */
function textoRateio(a) {
  return `${a.nota_credito_numero ?? `NC ${a.nota_credito_id}`}: ${formatCurrency(a.valor)}`;
}

/**
 * Pagina de detalhes de uma Nota de Empenho (#/notas_empenho/:id).
 * Cabecalho com os dados da NE e duas secoes com data-table:
 * liquidacoes e recebimentos de material, cada uma com criar/editar/excluir.
 *
 * A TELA SE MONTA UMA VEZ (2026-08-04). Ate aqui, `renderNota` limpava a raiz e
 * criava as duas data-table dentro do `load()`. Como toda gravacao chama
 * `load()`, editar uma liquidacao trocava todos os nos da tela: a ordenacao
 * escolhida voltava ao padrao, o foco do teclado caia no body e o painel de
 * historico saia da tela, porque ele era pendurado DEPOIS do primeiro load e o
 * `clearChildren(root)` seguinte o levava junto.
 *
 * Agora o esqueleto (cabecalho, cartoes e as duas secoes) nasce uma vez, e o
 * `load()` so repinta: escreve no no do valor e chama `table.update({ rows })`.
 *
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderNotaEmpenhoDetails(container, { params }) {
  const notaEmpenhoId = Number(params.id);
  let disposed = false;
  // Verdadeiro depois que o esqueleto entra na tela. Separa a PRIMEIRA carga
  // (que ainda nao tem o que preservar) das recargas de gravacao.
  let montado = false;
  // Liquidacao e recebimento seguem o corte do modulo: lancar e editar sao
  // operador, excluir e gerente. Quem so consulta ve as duas tabelas cheias.
  const pode = permissoes('orcamento');

  const root = el('div', { className: 'page' });
  container.appendChild(root);

  function cleanupTables() {
    liquidacoesTable._cleanup();
    recebimentosTable._cleanup();
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

            // nota_empenho_id vai no corpo TAMBEM na edicao: o models.atualizar
            // do Joi o exige (liquidacao_schema.js:22,33), e sem ele o PUT
            // voltava 400 sempre. O criar ja o mandava.
            const body = {
              nota_empenho_id: notaEmpenhoId,
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

            // Mesmo motivo da liquidacao: recebimento_schema.js:19,33 exige o
            // dono no models.atualizar, e o PUT sem ele voltava 400 sempre.
            const body = {
              nota_empenho_id: notaEmpenhoId,
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
  // Esqueleto: montado UMA vez, e so repintado dali em diante
  // ---------------------------------------------------------------------------
  const carregando = el('div', {
    className: 'data-table__empty',
    textContent: 'Carregando nota de empenho...',
  });
  root.appendChild(carregando);

  const titulo = el('h1', { className: 'page__title' });

  const cabecalho = el('div', { className: 'page__header' }, [
    el('div', {}, [
      el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        onClick: () => { location.hash = '/orcamento/notas_empenho'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar']),
      titulo,
    ]),
  ]);

  const linhaNumero = criarLinha('Número');
  const linhaAno = criarLinha('Ano');
  const linhaNc = criarLinha('Nota de crédito');
  const linhaNd = criarLinha('ND (herdada da NC)');
  const linhaEmpenhado = criarLinha('Empenhado');
  const linhaAnulado = criarLinha('Anulado');
  const linhaSaldo = criarLinha('Saldo a liquidar');

  // O rateio por NC e uma LISTA dentro da linha. Ela vive num no proprio, para
  // a recarga reconciliar as parcelas em vez de refazer o bloco inteiro.
  const rateioLista = el('div');

  const cartoes = el('div', { className: 'detail-cards' }, [
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Dados da NE' }),
      linhaNumero.element,
      linhaAno.element,
      linhaNc.element,
      linhaNd.element,
    ]),
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Valores' }),
      linhaEmpenhado.element,
      linhaAnulado.element,
      linhaSaldo.element,
    ]),
  ]);

  // ---- Secao: Liquidacoes ----
  // A tabela nasce vazia e FORA do load: criada de novo a cada gravacao, ela
  // levava junto a busca, a ordenacao, a pagina atual e a selecao. O
  // `update({ rows })` preserva os quatro.
  const liquidacoesTable = createDataTable({
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
    rows: [],
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

  const secaoLiquidacoes = el('div', { className: 'dashboard-section' }, [
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
  ]);

  // ---- Secao: Recebimentos de material ----
  const recebimentosTable = createDataTable({
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
    rows: [],
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

  const secaoRecebimentos = el('div', { className: 'dashboard-section' }, [
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
  ]);

  // ---------------------------------------------------------------------------
  // Repintura
  // ---------------------------------------------------------------------------
  /** Escreve a linha da nota de credito: rateio com varias, ou o numero so. */
  function pintarNotaCredito(nota) {
    const rateio = nota.notas_credito || [];
    linhaNc.label.textContent = rateio.length > 1
      ? 'Notas de crédito (rateio)'
      : 'Nota de crédito';

    if (!rateio.length) {
      // Sem rateio a linha e texto: escrever nela solta o no da lista, que volta
      // sozinho se a NE ganhar rateio depois.
      linhaNc.valor.textContent = nota.nota_credito_numero || '-';
      return;
    }

    if (rateioLista.parentNode !== linhaNc.valor) {
      linhaNc.valor.replaceChildren(rateioLista);
    }
    reconciliar(rateioLista, rateio, {
      chave: (a, i) => a.nota_credito_id ?? i,
      criar: (a) => el('div', { textContent: textoRateio(a) }),
      atualizar: (no, a) => { no.textContent = textoRateio(a); },
    });
  }

  function pintarNota(nota) {
    titulo.textContent = `Nota de empenho ${nota.numero || `#${nota.id}`}`;

    linhaNumero.valor.textContent = nota.numero || '-';
    linhaAno.valor.textContent = nota.ano != null ? String(nota.ano) : '-';
    pintarNotaCredito(nota);
    linhaNd.valor.textContent = nota.cod_nd
      ? (nota.nd_nome ? `${nota.cod_nd} - ${nota.nd_nome}` : nota.cod_nd)
      : '-';
    linhaEmpenhado.valor.textContent = formatCurrency(nota.valor_empenhado);
    linhaAnulado.valor.textContent = formatCurrency(nota.valor_anulado);
    linhaSaldo.valor.textContent = formatCurrency(nota.saldo_a_liquidar);

    if (!montado) {
      // Troca a mensagem de carga pelo esqueleto, uma vez so. O historico e
      // pendurado DEPOIS disto, e por isso nunca mais e removido.
      root.replaceChildren(cabecalho, cartoes, secaoLiquidacoes, secaoRecebimentos);
      montado = true;
    }

    liquidacoesTable.update({ rows: nota.liquidacoes || [], loading: false });
    recebimentosTable.update({ rows: nota.recebimentos || [], loading: false });
  }

  async function load() {
    if (montado) {
      // Recarga silenciosa: a tabela que ja tem linhas fica na tela e so avisa
      // que esta carregando, por classe. Ver `render` do data-table.
      liquidacoesTable.update({ loading: true });
      recebimentosTable.update({ loading: true });
    }

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
      showError(err.message || 'Erro ao carregar a nota de empenho');
      if (montado) {
        // A ficha ja esta na tela. Trocar tudo por uma mensagem de erro apagaria
        // o trabalho de quem so perdeu a rede por um instante: o aviso ja saiu
        // no toast, e a tela segue mostrando o ultimo estado bom.
        liquidacoesTable.update({ loading: false });
        recebimentosTable.update({ loading: false });
        return;
      }
      clearChildren(root);
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

    pintarNota(nota);
  }

  await load();

  // Histórico de alterações. É o MESMO componente da ficha do pedido.
  //
  // O agregado `nota_empenho` reúne QUATRO tabelas: a NE, o rateio por NC, as
  // liquidações e os recebimentos de material. São as quatro coisas que esta
  // ficha mostra, e é o módulo em que "qual era o valor antes" é a pergunta mais
  // provável do sistema inteiro.
  //
  // Fora do `load` de propósito: dentro dele o histórico seria destruído e
  // refeito a cada edição. Estar fora não bastava enquanto o `load` limpava a
  // raiz: o painel era pendurado depois do primeiro load, e a primeira gravação
  // o arrancava da tela. Hoje a raiz só se limpa na falha da PRIMEIRA carga,
  // quando o histórico ainda nem existe.
  const historico = criarHistorico({
    modulo: 'orcamento',
    entidade: 'nota_empenho',
    id: notaEmpenhoId,
    subtitulo: 'Alterações na NE, no rateio por NC, nas liquidações e nos recebimentos',
  });
  root.appendChild(historico.element);

  return () => {
    disposed = true;
    cleanupTables();
    historico.cleanup();
  };
}
