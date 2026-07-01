import { el, svgIcon, ICONS } from '@utils/dom.js';
import { monthName, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { getRpcmtecAcervo, downloadRpcmtecDocx } from '@services/mapoteca-service.js';

const num = (key) => (row) => formatNumber(row[key] ?? 0);
const txt = (key) => (row) => row[key] ?? '-';
const pct = (key) => (row) => (row[key] == null ? '-' : `${row[key]}%`);

// Colunas do detalhe 2.4/2.7, no formato exato do RPCMTec histórico.
const COLUNAS_DETALHE = [
  { key: 'solicitante', label: 'Solicitante', render: txt('solicitante') },
  { key: 'documento', label: 'Documento de solicitação', render: txt('documento') },
  { key: 'quantidade', label: 'Quantidade', render: num('quantidade') },
  { key: 'situacao', label: 'Situação', render: txt('situacao') },
];

// Definição das 8 seções do RPCMTec (seção acervo).
const SECOES = [
  {
    titulo: '1. Estado do Acervo', chave: 'estadoAcervo', emptyMessage: 'Sem dados de acervo',
    columns: [
      { key: 'escala', label: 'Escala', render: txt('escala') },
      { key: 'total_catalogado', label: 'Total catalogado', render: num('total_catalogado') },
      { key: 'catalogado_no_mes', label: 'Catalogado no mês', render: num('catalogado_no_mes') },
      { key: 'universo_asc', label: 'Universo da ASC', render: num('universo_asc') },
      { key: 'percentual_asc', label: '% da ASC', render: pct('percentual_asc') },
    ],
  },
  {
    titulo: '2. Produtos Entregues no Mês/Ano, por Tipo', chave: 'produtosPorTipo', emptyMessage: 'Sem produtos entregues no período',
    columns: [
      { key: 'tipo_produto', label: 'Tipo de produto', render: txt('tipo_produto') },
      { key: 'quantidade_mes', label: 'Quantidade no mês', render: num('quantidade_mes') },
      { key: 'quantidade_ano', label: 'Quantidade no ano', render: num('quantidade_ano') },
    ],
  },
  {
    titulo: '2.4. Entregas da Mapoteca', chave: 'mapotecaDetalhe', emptyMessage: 'Sem pedidos de mapoteca no mês',
    columns: COLUNAS_DETALHE,
  },
  {
    titulo: '2.7. LAI e Atendimento a Órgãos Públicos', chave: 'laiDetalhe', emptyMessage: 'Sem pedidos de LAI/órgãos públicos no mês',
    columns: COLUNAS_DETALHE,
  },
  {
    titulo: '3. Mapoteca — Totais do Mês e do Ano', chave: 'mapotecaLinhas', emptyMessage: 'Sem indicadores de mapoteca',
    columns: [
      { key: 'indicador', label: 'Indicador', render: txt('indicador') },
      { key: 'mes', label: 'Total no mês', render: num('mes') },
      { key: 'ano', label: 'Total no ano', render: num('ano') },
    ],
  },
  {
    titulo: '3.1 Insumos de Impressão', chave: 'insumos', emptyMessage: 'Sem tipos de material cadastrados',
    columns: [
      { key: 'insumo', label: 'Insumo', render: txt('insumo') },
      { key: 'estoque_atual', label: 'Estoque atual', render: num('estoque_atual') },
      { key: 'consumo_no_mes', label: 'Consumo no mês', render: num('consumo_no_mes') },
      { key: 'abaixo_minimo', label: 'Abaixo do mínimo', render: (row) => (row.abaixo_minimo ? 'Sim' : 'Não') },
    ],
  },
  {
    titulo: '4. LAI e Órgãos Públicos — Totais do Mês e do Ano', chave: 'laiLinhas', emptyMessage: 'Sem indicadores de LAI/órgãos públicos',
    columns: [
      { key: 'indicador', label: 'Indicador', render: txt('indicador') },
      { key: 'mes', label: 'Total no mês', render: num('mes') },
      { key: 'ano', label: 'Total no ano', render: num('ano') },
    ],
  },
  {
    titulo: '5. Totais do Mês e do Ano (consolidado)', chave: 'totaisConsolidados', emptyMessage: 'Sem totais consolidados',
    columns: [
      { key: 'indicador', label: 'Indicador', render: txt('indicador') },
      { key: 'mes', label: 'Total no mês', render: num('mes') },
      { key: 'ano', label: 'Total no ano', render: num('ano') },
    ],
  },
];

/**
 * RPCMTec - Seção Acervo (#/rpcmtec). Ao abrir, gera automaticamente o
 * preview do mês/ano corrente (estado do acervo, produtos entregues,
 * mapoteca + insumos de impressão, LAI/órgãos públicos e totais
 * consolidados). O usuário pode trocar mês/ano, gerar de novo, e baixar o
 * DOCX. Mesmo padrão da Seção 3 do RPCMTec no controle orçamentário.
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderRpcMtec(container) {
  let disposed = false;
  const tables = {};

  const hoje = new Date();

  const mesSelect = el('select', {
    className: 'form-field__select',
    id: 'rpcmtec-mes',
    'aria-label': 'Selecionar mês',
    onChange: () => gerar(),
  }, Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return el('option', { value: String(m), textContent: monthName(m) });
  }));
  mesSelect.value = String(hoje.getMonth() + 1);

  const anoSelect = el('select', {
    className: 'form-field__select',
    id: 'rpcmtec-ano',
    'aria-label': 'Selecionar ano',
    onChange: () => gerar(),
  }, Array.from({ length: 6 }, (_, i) => {
    const year = hoje.getFullYear() - i;
    return el('option', { value: String(year), textContent: String(year) });
  }));
  anoSelect.value = String(hoje.getFullYear());

  const baixarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => baixarDocx(),
  }, [svgIcon(ICONS.print, 16), 'Baixar DOCX']);

  const toolbar = el('div', { className: 'rpcm-toolbar' }, [
    el('div', { className: 'rpcm-toolbar__field' }, [
      el('label', { className: 'rpcm-toolbar__label', for: 'rpcmtec-mes', textContent: 'Mês' }),
      mesSelect,
    ]),
    el('div', { className: 'rpcm-toolbar__field' }, [
      el('label', { className: 'rpcm-toolbar__label', for: 'rpcmtec-ano', textContent: 'Ano' }),
      anoSelect,
    ]),
    el('div', { className: 'rpcm-toolbar__spacer' }),
    baixarBtn,
  ]);

  const blocos = SECOES.map(def => {
    const table = createDataTable({
      columns: def.columns,
      rows: [],
      pageSize: 25,
      emptyMessage: def.emptyMessage,
    });
    tables[def.chave] = table;
    return el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: def.titulo }),
      ]),
      table.element,
    ]);
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header page__header--column' }, [
      el('h1', { className: 'page__title', textContent: 'RPCMTec - Seção Acervo' }),
      toolbar,
    ]),
    ...blocos,
  ]);
  container.appendChild(page);

  function getParams() {
    return {
      ano: parseInt(anoSelect.value, 10),
      mes: parseInt(mesSelect.value, 10),
    };
  }

  async function gerar() {
    for (const def of SECOES) tables[def.chave].update({ loading: true });
    try {
      const dados = await getRpcmtecAcervo(getParams());
      if (disposed) return;
      for (const def of SECOES) {
        const rows = (dados && dados[def.chave]) || [];
        tables[def.chave].update({ rows, loading: false });
      }
    } catch (err) {
      if (disposed) return;
      for (const def of SECOES) tables[def.chave].update({ rows: [], loading: false });
      showError(err.message || 'Erro ao gerar o RPCMTec');
    }
  }

  async function baixarDocx() {
    baixarBtn.disabled = true;
    try {
      await downloadRpcmtecDocx(getParams());
    } catch (err) {
      showError(err.message || 'Erro ao baixar o DOCX');
    } finally {
      baixarBtn.disabled = false;
    }
  }

  await gerar();

  return () => {
    disposed = true;
    for (const def of SECOES) tables[def.chave]._cleanup();
  };
}
