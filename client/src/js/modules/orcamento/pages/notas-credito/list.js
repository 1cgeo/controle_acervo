import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, formatDate, toNumber, toIsoDate } from '@utils/format.js';
import { rotuloMetaPit } from '@services/plataforma-service.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  getNotasCredito,
  deleteNotaCredito,
  getClassificacaoNc,
  getAnos,
  downloadArquivo,
} from '@modules/orcamento/services/orcamento-service.js';
import { permissoes } from '@store/auth-store.js';
import { openNotaCreditoDialog } from './nota-credito-dialog.js';

// Tolerancia de meio centavo. valor_nc e valor_recolhido sao NUMERIC(15,2) e
// chegam como TEXTO; a comparacao exata reprova a devolucao integral por um
// residuo de ponto flutuante que ninguem consegue ver na tela.
const CENTAVO = 0.005;

/**
 * A NC teve o credito devolvido POR INTEIRO?
 *
 * Em 2026 isso vale para 11 das 44 NCs, e a tela nao dizia: em 8 delas alguem
 * escreveu "RECOLH" no campo livre `marcador` para nao perder o fato. Exige
 * valor_nc positivo porque NC de valor zero satisfaria a comparacao sem que
 * devolucao nenhuma tivesse ocorrido.
 * @param {Object} nc
 * @returns {boolean}
 */
function recolhidaPorInteiro(nc) {
  const recebido = toNumber(nc.valor_nc);
  return recebido > 0 && toNumber(nc.valor_recolhido) >= recebido - CENTAVO;
}

/**
 * O prazo de empenho ja passou?
 *
 * A coluna DATE chega como texto 'AAAA-MM-DD' (o driver do banco nao a
 * converte), entao a comparacao com a data de hoje no mesmo formato e direta e
 * imune a fuso.
 * @param {Object} nc
 * @returns {boolean}
 */
function prazoVencido(nc) {
  if (!nc.prazo_empenho) return false;
  return String(nc.prazo_empenho).slice(0, 10) < toIsoDate(new Date());
}

/**
 * Lista de Notas de Credito (#/notas-credito). Filtros no topo: ano da tela e
 * classificacao (PDR / Extra-PDR).
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderNotasCreditoList(container, _ctx) {
  let disposed = false;
  let filtroClassificacao = null;
  const pode = permissoes('orcamento');

  const newBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openNotaCreditoDialog({ ano: filtroAno.getAno(), onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova nota de crédito']);

  // ---- Filtros ----
  // O ano e DESTA tela, comeca no ano atual e nao guarda nada (chefe,
  // 2026-08-04). `permitirOutroAno` porque o ano decide ONDE a NC e cadastrada:
  // abrir um exercicio novo passa por escolher um ano ainda vazio.
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnos,
    permitirOutroAno: true,
    onChange: () => load(),
  });

  const classificacaoFilter = createSelectField({
    label: 'Classificação',
    options: [],
    placeholder: 'Todas as classificações',
    onChange: (id) => {
      filtroClassificacao = id;
      load();
    },
  });

  // ---- Cartao-resumo (totais do que esta na tela, no molde do PDR) ----
  const totalRecebidoValue = el('div', { className: 'nc-summary__value', style: { fontWeight: '600' } });
  const totalRecolhidoValue = el('div', { className: 'nc-summary__value', style: { fontWeight: '600' } });
  const recebidoLiquidoValue = el('div', { className: 'nc-summary__value', style: { fontWeight: '600' } });

  function summaryItem(label, valueEl) {
    return el('div', { className: 'nc-summary__item' }, [
      el('div', {
        className: 'nc-summary__label',
        textContent: label,
        style: { fontSize: 'var(--font-size-xs, 0.75rem)', color: 'var(--text-secondary)' },
      }),
      valueEl,
    ]);
  }

  const summaryCard = el('div', {
    className: 'nc-summary',
    style: {
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md, 8px)',
      padding: 'var(--space-lg, 24px)',
      marginBottom: 'var(--space-md, 16px)',
    },
  }, [
    el('div', {
      className: 'nc-summary__grid',
      style: {
        display: 'grid',
        gridTemplateColumns: 'repeat(auto-fit, minmax(160px, 1fr))',
        gap: 'var(--space-md, 16px)',
      },
    }, [
      summaryItem('Total recebido', totalRecebidoValue),
      summaryItem('Total recolhido', totalRecolhidoValue),
      summaryItem('Recebido líquido', recebidoLiquidoValue),
    ]),
  ]);

  /** Recalcula os totais a partir das NCs carregadas. */
  function renderSummary(ncs) {
    let recebido = 0;
    let recolhido = 0;
    for (const nc of ncs) {
      recebido += toNumber(nc.valor_nc);
      recolhido += toNumber(nc.valor_recolhido);
    }
    totalRecebidoValue.textContent = formatCurrency(recebido);
    totalRecolhidoValue.textContent = formatCurrency(recolhido);
    recebidoLiquidoValue.textContent = formatCurrency(recebido - recolhido);
  }

  /**
   * Apaga os totais. Usado no caminho de ERRO: lista que nao carregou tem total
   * DESCONHECIDO, e "R$ 0,00" afirmaria que a Divisao nao recebeu nada.
   */
  function limparSummary() {
    totalRecebidoValue.textContent = '-';
    totalRecolhidoValue.textContent = '-';
    recebidoLiquidoValue.textContent = '-';
  }
  limparSummary();

  const table = createDataTable({
    columns: [
      { key: 'numero', label: 'Número', sortable: true },
      { key: 'ano', label: 'Ano', sortable: true },
      {
        // A UG emitente separa NCs de MESMO numero e MESMA ND: a numeracao do
        // SIAFI e por emitente. Em 2026 a NC 2026NC400412 existe duas vezes,
        // e so esta coluna distingue as duas.
        key: 'ug_emitente',
        label: 'UG emitente',
        render: (row) => (row.ug_nome
          ? `${row.ug_emitente} - ${row.ug_nome}`
          : (row.ug_emitente ?? '-')),
      },
      {
        key: 'cod_nd',
        label: 'ND',
        render: (row) => (row.nd_nome ? `${row.cod_nd} - ${row.nd_nome}` : (row.cod_nd ?? '-')),
      },
      {
        key: 'classificacao_nome',
        label: 'Classificação',
        render: (row) => row.classificacao_nome || '-',
      },
      {
        // A meta do PIT so aparecia no dialog de edicao, que abre para operador:
        // quem tem perfil de consulta nao tinha caminho nenhum ate ela.
        // O NOME da meta, e nao o algarismo solto: rotuloMetaPit e a mesma
        // funcao do dialog, da tela de metas e da lista do PDR. Uma meta nao
        // pode aparecer com nome diferente em cada tela.
        key: 'numero_meta',
        label: 'Meta',
        sortable: true,
        className: 'data-table__cell--truncate',
        sortValue: (row) => (row.numero_meta == null ? null : Number(row.numero_meta)),
        render: (row) => (row.numero_meta == null
          ? '-'
          : rotuloMetaPit({
            numero_meta: row.numero_meta,
            item: row.meta_item,
            descricao: row.meta_descricao,
          })),
      },
      {
        key: 'valor_nc',
        label: 'Valor',
        sortable: true,
        sortValue: (row) => toNumber(row.valor_nc),
        render: (row) => formatCurrency(row.valor_nc),
      },
      {
        // Coluna NOVA: o credito devolvido. A NC devolvida por inteiro ganha
        // destaque na celula, alem da linha esmaecida.
        key: 'valor_recolhido',
        label: 'Recolhido',
        sortable: true,
        sortValue: (row) => toNumber(row.valor_recolhido),
        render: (row) => (recolhidaPorInteiro(row)
          ? el('span', {
            className: 'chip chip--warning',
            textContent: formatCurrency(row.valor_recolhido),
            title: 'Crédito devolvido por inteiro',
          })
          : formatCurrency(row.valor_recolhido)),
      },
      {
        // Coluna NOVA: a data limite para empenhar o credito. Vencida, ela vira
        // chip de erro, porque o prazo perdido custa o credito inteiro.
        key: 'prazo_empenho',
        label: 'Prazo de empenho',
        sortable: true,
        render: (row) => (prazoVencido(row)
          ? el('span', {
            className: 'chip chip--error',
            textContent: formatDate(row.prazo_empenho),
            title: 'Prazo de empenho vencido',
          })
          : formatDate(row.prazo_empenho)),
      },
      {
        key: 'data_emissao',
        label: 'Emissão',
        sortable: true,
        render: (row) => formatDate(row.data_emissao),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    // A NC mais recente primeiro, igual a ordem que o servidor ja devolve. As
    // NCs sem data (todas as de 2025) descem para o fim sozinhas: o data-table
    // joga nulo para o fim em qualquer direcao.
    defaultSort: { key: 'data_emissao', dir: 'desc' },
    // Credito devolvido por inteiro fica esmaecido, no mesmo padrao da NE
    // liquidada: da para varrer a lista e ver de longe o que nao empenha mais.
    rowClassName: (row) => (recolhidaPorInteiro(row) ? 'data-table__row--quitada' : ''),
    emptyMessage: 'Nenhuma nota de crédito cadastrada',
    actions: [
      {
        icon: ICONS.download,
        title: 'Baixar anexo (PDF)',
        visible: (row) => row.arquivo_id != null,
        onClick: (row) => downloadArquivo(row.arquivo_id, row.arquivo_nome)
          .catch((err) => showError(err.message || 'Erro ao baixar anexo')),
      },
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar',
        onClick: (row) => openNotaCreditoDialog({
          ncId: row.id,
          ano: filtroAno.getAno(),
          onSaved: load,
        }),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => handleDelete(row),
      }] : []),
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Notas de Crédito' }),
      el('div', { className: 'page__actions' }, pode.operador ? [newBtn] : []),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [
      filtroAno.element,
      classificacaoFilter.element,
    ]),
    summaryCard,
    table.element,
  ]);
  container.appendChild(page);

  async function loadFilterOptions() {
    try {
      const classificacoes = await getClassificacaoNc();
      if (disposed) return;
      // O dominio devolve `code`, e nao `id`. Com c.id as duas opcoes viravam
      // value="undefined", o parametro era descartado e o filtro nao filtrava
      // nada. O dialog ja tinha essa correcao; a lista tinha ficado para tras.
      classificacaoFilter.setOptions((classificacoes || []).map(c => ({
        value: c.code ?? c.id,
        label: c.nome ?? c.descricao ?? `Classificação ${c.code ?? c.id}`,
      })));
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar filtros');
    }
  }

  async function load() {
    table.update({ loading: true });
    try {
      const dados = await getNotasCredito({
        ano: filtroAno.getAno(),
        classificacao_id: filtroClassificacao ?? undefined,
      });
      if (disposed) return;
      const ncs = dados || [];
      renderSummary(ncs);
      table.update({ rows: ncs, loading: false });
    } catch (err) {
      if (disposed) return;
      limparSummary();
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar notas de crédito');
    }
  }

  async function handleDelete(row) {
    // O numero sozinho NAO identifica a NC: o mesmo numero e a mesma ND existem
    // para UGs emitentes diferentes. A confirmacao nomeia as tres partes da
    // chave, senao quem confirma nao sabe qual das duas linhas vai sair.
    const rotulo = [row.numero, row.cod_nd, row.ug_emitente ? `UG ${row.ug_emitente}` : null]
      .filter(Boolean)
      .join(' / ');
    const ok = await confirmDialog({
      title: 'Excluir nota de crédito',
      message: `Tem certeza que deseja excluir a NC ${rotulo}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteNotaCredito(row.id);
      showSuccess('Nota de crédito excluída com sucesso');
      await load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir nota de crédito');
    }
  }

  await loadFilterOptions();
  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
