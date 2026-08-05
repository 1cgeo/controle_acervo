import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, toNumber } from '@utils/format.js';
import { rotuloMetaPit } from '@services/plataforma-service.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { mostrarErro } from '@components/estado-erro.js';
import { createFileAttachment } from '@modules/orcamento/components/file-attachment.js';
import { getPdrItens, deletePdrItem, getAnos } from '@modules/orcamento/services/orcamento-service.js';
import { permissoes } from '@store/auth-store.js';
import { openPdrItemDialog } from './item-dialog.js';

/**
 * Tela do PDR (#/pdr). O PDR e o CONJUNTO DOS SEUS ITENS amarrados num ano:
 * esta pagina lista os itens (CRUD) e mostra um cartao-resumo com os totais
 * calculados a partir dos itens carregados. O filtro de ano do topo recarrega a
 * tela.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderPdrList(container, _ctx) {
  let disposed = false;
  const pode = permissoes('orcamento');

  // O ano e DESTA tela, comeca no ano atual e nao guarda nada. `permitirOutroAno` porque o ano decide ONDE o item e
  // cadastrado: montar o PDR do exercicio seguinte comeca num ano vazio.
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnos,
    permitirOutroAno: true,
    onChange: () => { if (!disposed) load(); },
  });

  const title = el('h1', { className: 'page__title', textContent: `PDR ${filtroAno.getAno()}` });

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openPdrItemDialog({ ano: filtroAno.getAno(), onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Novo item']);

  // Anexos do PDR: ficam no nivel do ano (nao do item; o PDR nao tem cabecalho).
  // Abre um modal com a lista de arquivos (XLSX/PDF) do ano selecionado.
  const anexosBtn = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => {
      const ano = filtroAno.getAno();
      const anexo = createFileAttachment({
        mode: 'multi',
        vinculo: { pdr_ano: ano },
        accept: '.pdf,.xlsx,.xls,.csv,.ods',
        label: 'Arquivos originais do PDR (planilhas, PDFs)',
      });
      openModal({
        title: `Anexos do PDR ${ano}`,
        content: anexo.element,
        width: '600px',
        actions: [{ label: 'Fechar', variant: 'text', onClick: ({ close }) => close() }],
      });
    },
  }, [svgIcon(ICONS.description, 16), 'Anexos do PDR']);

  // ---- Cartao-resumo (totais calculados a partir dos itens carregados) ----
  const totalSolicitadoValue = el('div', { className: 'pdr-summary__value', style: { fontWeight: '600' } });
  const totalAutorizadoValue = el('div', { className: 'pdr-summary__value', style: { fontWeight: '600' } });
  const gnd3AutorizadoValue = el('div', { className: 'pdr-summary__value', style: { fontWeight: '600' } });
  const gnd4AutorizadoValue = el('div', { className: 'pdr-summary__value', style: { fontWeight: '600' } });

  // Nota discreta abaixo do valor: diz quantos itens tem o valor informado,
  // quando nem todos tem. Sem ela o cartao soma 20 itens e cala que 8 estao em
  // branco, e a diferenca entre "solicitou menos" e "nao informou" se perde.
  const totalSolicitadoNota = el('div', {
    className: 'pdr-summary__nota',
    style: { fontSize: 'var(--font-size-xs, 0.75rem)', color: 'var(--text-secondary)' },
  });
  const totalAutorizadoNota = el('div', {
    className: 'pdr-summary__nota',
    style: { fontSize: 'var(--font-size-xs, 0.75rem)', color: 'var(--text-secondary)' },
  });

  function summaryItem(label, valueEl, notaEl = null) {
    return el('div', { className: 'pdr-summary__item' }, [
      el('div', {
        className: 'pdr-summary__label',
        textContent: label,
        style: { fontSize: 'var(--font-size-xs, 0.75rem)', color: 'var(--text-secondary)' },
      }),
      valueEl,
      notaEl,
    ].filter(Boolean));
  }

  const summaryCard = el('div', {
    className: 'pdr-summary',
    style: {
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md, 8px)',
      padding: 'var(--space-lg, 24px)',
      marginBottom: 'var(--space-md, 16px)',
    },
  }, [
    el('div', {
      className: 'pdr-summary__grid',
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 'var(--space-md, 16px)',
      },
    }, [
      summaryItem('Total solicitado', totalSolicitadoValue, totalSolicitadoNota),
      summaryItem('Total autorizado', totalAutorizadoValue, totalAutorizadoNota),
      summaryItem('GND3 autorizado', gnd3AutorizadoValue),
      summaryItem('GND4 autorizado', gnd4AutorizadoValue),
    ]),
  ]);

  /** Valor de dinheiro INFORMADO (nulo, vazio e texto nao numerico ficam fora). */
  function temValor(valor) {
    if (valor === null || valor === undefined || valor === '') return false;
    return !isNaN(Number(valor));
  }

  // O cartao distingue ZERO de DESCONHECIDO. `Number(null)` e 0, entao a soma
  // antiga escrevia "Total solicitado R$ 0,00" para os 8 itens do PDR de 2025,
  // todos com o valor em branco: a tela afirmava que a Divisao pediu nada. Sem
  // nenhum item informado o cartao mostra "-", como a celula da tabela ja faz.
  function renderSummary(itens) {
    let totalSolicitado = 0;
    let totalAutorizado = 0;
    let gnd3Autorizado = 0;
    let gnd4Autorizado = 0;
    let comSolicitado = 0;
    let comAutorizado = 0;
    let comGnd3 = 0;
    let comGnd4 = 0;
    for (const item of itens) {
      if (temValor(item.valor_solicitado)) {
        totalSolicitado += toNumber(item.valor_solicitado);
        comSolicitado += 1;
      }
      if (temValor(item.valor_autorizado)) {
        const aut = toNumber(item.valor_autorizado);
        totalAutorizado += aut;
        comAutorizado += 1;
        if (Number(item.gnd) === 3) { gnd3Autorizado += aut; comGnd3 += 1; }
        if (Number(item.gnd) === 4) { gnd4Autorizado += aut; comGnd4 += 1; }
      }
    }
    const total = itens.length;
    totalSolicitadoValue.textContent = comSolicitado ? formatCurrency(totalSolicitado) : '-';
    totalAutorizadoValue.textContent = comAutorizado ? formatCurrency(totalAutorizado) : '-';
    gnd3AutorizadoValue.textContent = comGnd3 ? formatCurrency(gnd3Autorizado) : '-';
    gnd4AutorizadoValue.textContent = comGnd4 ? formatCurrency(gnd4Autorizado) : '-';
    totalSolicitadoNota.textContent = notaDeCobertura(comSolicitado, total);
    totalAutorizadoNota.textContent = notaDeCobertura(comAutorizado, total);
  }

  /** Texto da nota: vazio quando todo item informou, ou nao ha item nenhum. */
  function notaDeCobertura(informados, total) {
    if (!total || informados === total) return '';
    return `${informados} de ${total} ${total === 1 ? 'item' : 'itens'} com valor`;
  }

  renderSummary([]);

  const table = createDataTable({
    columns: [
      { key: 'item_label', label: 'Rótulo', sortable: true, render: (row) => row.item_label || '-' },
      // A descricao e o que identifica o item para uma pessoa. Ela existe em 36
      // de 36 itens reais e nao aparecia em tela nenhuma.
      {
        key: 'descricao',
        label: 'Descrição',
        className: 'data-table__cell--truncate',
        render: (row) => row.descricao || '-',
      },
      {
        key: 'cod_nd',
        label: 'ND',
        render: (row) => (row.nd_nome ? `${row.cod_nd} - ${row.nd_nome}` : (row.cod_nd ?? '-')),
      },
      {
        // A meta com o NOME dela, e nao o algarismo solto. O servidor manda
        // `meta_descricao` na mesma linha (pdr_ctrl.js) e a tela a descartava:
        // como os 17 itens de 2026 com meta tem `meta_item` nulo, 100% deles
        // caiam no ramo que escrevia so "3". `rotuloMetaPit` e a MESMA funcao do
        // dialog e da tela de metas: uma meta nao pode ter nome diferente em
        // cada tela.
        key: 'meta_numero',
        label: 'Meta',
        className: 'data-table__cell--truncate',
        render: (row) => {
          if (row.meta_numero === null || row.meta_numero === undefined) return '-';
          return rotuloMetaPit({
            numero_meta: row.meta_numero,
            item: row.meta_item,
            descricao: row.meta_descricao,
          });
        },
      },
      { key: 'gnd', label: 'GND', sortable: true, render: (row) => (row.gnd ?? '-') },
      {
        key: 'valor_solicitado',
        label: 'Solicitado',
        sortable: true,
        // NUMERIC chega como texto: sem sortValue a ordem sai do comparador de
        // string. As irmas (notas-empenho, rpnp) ja passam por toNumber.
        sortValue: (row) => toNumber(row.valor_solicitado),
        render: (row) => formatCurrency(row.valor_solicitado),
      },
      {
        key: 'valor_autorizado',
        label: 'Autorizado',
        sortable: true,
        sortValue: (row) => toNumber(row.valor_autorizado),
        render: (row) => formatCurrency(row.valor_autorizado),
      },
      { key: 'observacao', label: 'Observação', render: (row) => row.observacao || '-' },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhum item de PDR cadastrado',
    // O PDR e a EXCECAO do orcamento: aqui criar e editar tambem sao gerente,
    // e nao operador como no resto do modulo. Um operador via os botoes, era
    // recusado pelo servidor.
    actions: pode.gerente ? [
      {
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openPdrItemDialog({ item: row, ano: filtroAno.getAno(), onSaved: load }),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      },
    ] : [],
  });

  // A tabela vive num no proprio para o estado de ERRO poder tomar o lugar dela
  // e devolve-lo depois, sem recriar a tabela. Ver `falhaNaCarga`.
  const areaTabela = el('div', {}, [table.element]);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      title,
      // Os anexos do PDR tem gate proprio dentro do widget: quem consulta abre
      // o modal e baixa, sem anexar nem remover.
      el('div', { className: 'page__actions' }, [
        anexosBtn,
        ...(pode.gerente ? [newBtn] : []),
      ]),
    ]),
    el('div', { className: 'page__filters' }, [
      filtroAno.element,
    ]),
    summaryCard,
    areaTabela,
  ]);
  container.appendChild(page);

  /**
   * Estado de ERRO no lugar da tabela.
   *
   * Zerar as linhas fazia a tabela escrever "Nenhum item de PDR cadastrado": a
   * falha da API lia-se como ano sem PDR, e as duas pedem acoes opostas.
   *
   * A tabela volta ANTES do aviso porque `mostrarErro` guarda o que estava no
   * no: uma segunda falha guardaria o proprio aviso, e "Tentar de novo" pararia
   * de devolver a tabela.
   */
  function falhaNaCarga(err) {
    areaTabela.replaceChildren(table.element);
    mostrarErro(areaTabela, err, load);
  }

  async function load() {
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!areaTabela.contains(table.element)) areaTabela.replaceChildren(table.element);

    const ano = filtroAno.getAno();
    title.textContent = `PDR ${ano}`;
    table.update({ loading: true });
    try {
      const dados = await getPdrItens(ano);
      if (disposed) return;
      const itens = dados || [];
      renderSummary(itens);
      table.update({ rows: itens, loading: false });
    } catch (err) {
      if (disposed) return;
      // Lista vazia agora pinta "-" nos quatro cartoes. Depois de uma falha de
      // carga a tela nao pode afirmar "R$ 0,00", que se le como dado real.
      renderSummary([]);
      table.update({ loading: false });
      falhaNaCarga(err);
      showError(err.message || 'Erro ao carregar os itens do PDR');
    }
  }

  async function handleDelete(row) {
    const rotulo = row.item_label || row.cod_nd || `#${row.id}`;
    const ok = await confirmDialog({
      title: 'Excluir item do PDR',
      message: `Tem certeza que deseja excluir o item ${rotulo}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deletePdrItem(row.id);
      showSuccess('Item do PDR excluído com sucesso');
      await load();
    } catch (err) {
      // O backend bloqueia com 409 quando ha NC vinculada; mostra a mensagem.
      showError(err.message || 'Erro ao excluir item do PDR');
    }
  }

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
