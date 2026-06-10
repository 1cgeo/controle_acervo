import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatNumber, monthName } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { getRelatorio, downloadRelatorioCsv } from '@services/mapoteca-service.js';

function simNao(value) {
  if (value === true) return 'Sim';
  if (value === false) return 'Não';
  return '-';
}

function linkPedido(row) {
  if (!row.pedido_id) return row.localizador_pedido || '-';
  return el('a', {
    href: `#/pedidos/${row.pedido_id}`,
    textContent: row.localizador_pedido || `#${row.pedido_id}`,
  });
}

function colNum(key, label) {
  return { key, label, render: (row) => formatNumber(row[key] ?? 0) };
}

function colData(key, label, sortable = false) {
  return { key, label, sortable, render: (row) => formatDate(row[key]) };
}

// As colunas espelham controller.COLUNAS_* de server/src/mapoteca/relatorio_ctrl.js
// (mesmos rótulos das exportações CSV), com o localizador como link para o pedido.
const RELATORIOS = {
  pedidos_mil: {
    label: 'Pedidos militares (Mil)',
    descricao: 'Pedidos de organizações militares, um por linha, com o pivô de quantidades por escala e tipo de produto da aba Mil da planilha.',
    emptyMessage: 'Nenhum pedido militar no ano selecionado',
    columns: [
      { key: 'numero', label: 'Nº', sortable: true },
      { key: 'possui_detalhamento', label: 'Det.?', render: (row) => simNao(row.possui_detalhamento) },
      colData('data_pedido', 'Data Pedido', true),
      { key: 'documento_solicitacao', label: 'Número do DIEx' },
      { key: 'previsto_pit', label: 'Previsto no PIT', render: (row) => simNao(row.previsto_pit) },
      { key: 'situacao', label: 'Status' },
      { key: 'unidade', label: 'Unidade', sortable: true },
      { key: 'endereco', label: 'Endereço' },
      colData('data_envio', 'Data Envio/Retirada'),
      {
        key: 'tempo_atendimento_dias',
        label: 'Tempo Atendimento (dias)',
        sortable: true,
        render: (row) => row.tempo_atendimento_dias == null ? '-' : formatNumber(row.tempo_atendimento_dias),
      },
      { key: 'informacoes_remessa', label: 'Informações de Remessa' },
      { key: 'observacao', label: 'Observação' },
      { key: 'operacao', label: 'Operação' },
      colNum('off_25k', '25k Off'),
      colNum('off_50k', '50k Off'),
      colNum('off_100k', '100k Off'),
      colNum('off_250k', '250k Off'),
      colNum('total_offset', 'Total Offset'),
      colNum('topo_25k', '25k Topo Imp'),
      colNum('topo_50k', '50k Topo Imp'),
      colNum('topo_100k', '100k Topo Imp'),
      colNum('topo_250k', '250k Topo Imp'),
      colNum('total_topo', 'Total Topo Imp'),
      colNum('orto_25k', '25k Orto Imp'),
      colNum('orto_50k', '50k Orto Imp'),
      colNum('orto_100k', '100k Orto Imp'),
      colNum('orto_250k', '250k Orto Imp'),
      colNum('total_orto', 'Total Orto Imp'),
      colNum('outros_produtos', 'Outros Produtos'),
      colNum('produtos_digitais', 'Produtos Digitais'),
      { key: 'total', label: 'Total', sortable: true, render: (row) => formatNumber(row.total ?? 0) },
      { key: 'localizador_pedido', label: 'Localizador', render: linkPedido },
    ],
  },
  pedidos_detalhado: {
    label: 'Pedidos detalhados (Detalhado)',
    descricao: 'Um item de pedido por linha, com produto do acervo, material previsto/fornecido e datas de entrega — aba Detalhado da planilha.',
    emptyMessage: 'Nenhum item de pedido no ano selecionado',
    columns: [
      { key: 'omds', label: 'OMDS' },
      { key: 'demandante', label: 'Demandante' },
      { key: 'om_destino', label: 'OM Destino', sortable: true },
      { key: 'previsto_pit', label: 'Previsto no PIT', render: (row) => simNao(row.previsto_pit) },
      colData('meta', 'Meta'),
      { key: 'produto', label: 'Produto' },
      { key: 'produto_nome', label: 'Nome do Produto', sortable: true },
      { key: 'mi', label: 'MI', sortable: true },
      { key: 'escala', label: 'Escala' },
      {
        key: 'quantidade_prevista',
        label: 'Qnt Prevista',
        sortable: true,
        render: (row) => formatNumber(row.quantidade_prevista),
      },
      { key: 'material_previsto', label: 'Material Previsto' },
      {
        key: 'quantidade_fornecida',
        label: 'Qnt Fornecida',
        render: (row) => row.quantidade_fornecida == null ? '-' : formatNumber(row.quantidade_fornecida),
      },
      { key: 'material_fornecido', label: 'Material Fornecido' },
      colData('data_entrega', 'Data da Entrega', true),
      { key: 'forma_entrega', label: 'Forma da Entrega' },
      { key: 'observacao', label: 'Observações' },
      { key: 'mes', label: 'Mês', render: (row) => row.mes == null ? '-' : monthName(row.mes) },
      { key: 'localizador_pedido', label: 'Localizador', render: linkPedido },
    ],
  },
  pedidos_civ: {
    label: 'Pedidos civis (Civ)',
    descricao: 'Pedidos de clientes civis — LAI, órgãos públicos e pessoas físicas/jurídicas — aba Civ da planilha.',
    emptyMessage: 'Nenhum pedido civil no ano selecionado',
    columns: [
      { key: 'ordem', label: 'Ord', sortable: true },
      colData('data_pedido', 'Data Pedido', true),
      { key: 'solicitante', label: 'Solicitante', sortable: true },
      { key: 'tipo_cliente', label: 'Tipo de Cliente' },
      { key: 'numero_oficio', label: 'Número do Ofício' },
      { key: 'nup_lai', label: 'NUP LAI' },
      { key: 'resumo_pedido', label: 'Resumo do Pedido' },
      colData('data_envio', 'Data Envio/Retirada'),
      { key: 'situacao', label: 'Status' },
      { key: 'observacao', label: 'Observação' },
      { key: 'localizador_pedido', label: 'Localizador', render: linkPedido },
    ],
  },
  tematicos: {
    label: 'Mapas temáticos',
    descricao: 'Produção temática sob demanda — itens marcados como produção específica (RN07) — aba Mapas Temáticos da planilha.',
    emptyMessage: 'Nenhuma produção temática no ano selecionado',
    columns: [
      { key: 'ordem', label: 'ID', sortable: true },
      { key: 'nome_projeto', label: 'Nome do Projeto', sortable: true },
      { key: 'demandante', label: 'Demandante', sortable: true },
      { key: 'tipo_produto', label: 'Tipo de Produto' },
      { key: 'descricao_pedido', label: 'Descrição sumária do pedido' },
      colData('data_entrega', 'Data da entrega', true),
      { key: 'descricao_produto', label: 'Descrição sumária do produto' },
      { key: 'secao_responsavel', label: 'Seção responsável' },
      { key: 'militar_responsavel', label: 'Militar responsável' },
      {
        key: 'tamanho_mb',
        label: 'Tamanho (MB)',
        render: (row) => row.tamanho_mb == null ? '-' : Number(row.tamanho_mb).toLocaleString('pt-BR', { maximumFractionDigits: 2 }),
      },
      { key: 'localizador_pedido', label: 'Localizador', render: linkPedido },
    ],
  },
};

/**
 * Relatórios anuais page (#/relatorios): as quatro abas da antiga planilha
 * (Mil, Detalhado, Civ e Mapas Temáticos) com seleção de ano e exportação CSV.
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderRelatorios(container) {
  let currentNome = 'pedidos_mil';
  let currentAno = new Date().getFullYear();
  let table = null;
  let disposed = false;
  let loadToken = 0;

  const tableContainer = el('div');
  const descricaoEl = el('p', {
    className: 'detail-card__label',
    textContent: RELATORIOS[currentNome].descricao,
  });

  const relatorioSelect = el('select', {
    className: 'chart-card__select',
    'aria-label': 'Selecionar relatório',
    onChange: (e) => {
      currentNome = e.target.value;
      descricaoEl.textContent = RELATORIOS[currentNome].descricao;
      load();
    },
  }, Object.entries(RELATORIOS).map(([value, cfg]) =>
    el('option', { value, textContent: cfg.label })
  ));
  relatorioSelect.value = currentNome;

  const yearSelect = el('select', {
    className: 'chart-card__select',
    'aria-label': 'Selecionar ano',
    onChange: (e) => {
      currentAno = parseInt(e.target.value, 10);
      load();
    },
  }, Array.from({ length: 6 }, (_, i) => {
    const year = currentAno - i;
    return el('option', { value: String(year), textContent: String(year) });
  }));
  yearSelect.value = String(currentAno);

  const exportBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: async (e) => {
      const btn = e.currentTarget;
      btn.disabled = true;
      try {
        await downloadRelatorioCsv(currentNome, currentAno);
        showSuccess('Exportação CSV iniciada');
      } catch (err) {
        showError(err.message || 'Erro ao exportar CSV');
      } finally {
        btn.disabled = false;
      }
    },
  }, [svgIcon(ICONS.download, 14), 'Exportar CSV']);

  function rebuildTable() {
    if (table) table._cleanup();
    const cfg = RELATORIOS[currentNome];
    table = createDataTable({
      columns: cfg.columns,
      rows: [],
      searchable: true,
      pageSize: 25,
      loading: true,
      emptyMessage: cfg.emptyMessage,
    });
    clearChildren(tableContainer);
    tableContainer.appendChild(table.element);
  }

  async function load() {
    const nome = currentNome;
    const ano = currentAno;
    const token = ++loadToken;
    rebuildTable();
    try {
      const rows = await getRelatorio(nome, ano);
      if (disposed || token !== loadToken) return;
      table.update({ rows: Array.isArray(rows) ? rows : [], loading: false });
    } catch (err) {
      if (disposed || token !== loadToken) return;
      table.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar o relatório');
    }
  }

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Relatórios Anuais' }),
      el('div', { className: 'page__actions' }, [exportBtn]),
    ]),
    el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Relatório' }),
        el('div', { className: 'dashboard-section__controls' }, [
          relatorioSelect,
          el('span', { textContent: 'Ano:' }),
          yearSelect,
        ]),
      ]),
      descricaoEl,
      tableContainer,
    ]),
  ]);
  container.appendChild(page);

  await load();

  return () => {
    disposed = true;
    if (table) table._cleanup();
  };
}
