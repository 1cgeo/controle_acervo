import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, monthName } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { getSecao3, downloadSecao3Docx } from '@modules/orcamento/services/orcamento-service.js';
import { getAno, onAnoChange } from '@modules/orcamento/store/year-store.js';

const cur = (key) => (row) => formatCurrency(row[key]);
const txt = (key) => (row) => row[key] ?? '-';

// Definicao das 7 subtabelas da secao 3 do RPCMTec.
const SUBTABELAS = [
  {
    titulo: '3.1 Execução por ND (PDR)', id: 'tabela_31_pdr', chave: 'tabela_31', emptyMessage: 'Sem execução por ND',
    columns: [
      { key: 'cod_nd', label: 'Cód. ND', render: txt('cod_nd') },
      { key: 'nd_nome', label: 'Natureza de Despesa', render: txt('nd_nome') },
      { key: 'previsto', label: 'Previsto', render: cur('previsto') },
      { key: 'recebido_pdr', label: 'Recebido', render: cur('recebido_pdr') },
      { key: 'recolhido_pdr', label: 'Recolhido', render: cur('recolhido_pdr') },
      { key: 'empenhado_pdr', label: 'Empenhado', render: cur('empenhado_pdr') },
      { key: 'liquidado_pdr', label: 'Liquidado', render: cur('liquidado_pdr') },
    ],
  },
  {
    titulo: '3.1 Execução por ND (Extra-PDR)', id: 'tabela_31_extra', chave: 'tabela_31', emptyMessage: 'Sem execução por ND',
    columns: [
      { key: 'cod_nd', label: 'Cód. ND', render: txt('cod_nd') },
      { key: 'nd_nome', label: 'Natureza de Despesa', render: txt('nd_nome') },
      { key: 'recebido_extra', label: 'Recebido', render: cur('recebido_extra') },
      { key: 'recolhido_extra', label: 'Recolhido', render: cur('recolhido_extra') },
      { key: 'empenhado_extra', label: 'Empenhado', render: cur('empenhado_extra') },
      { key: 'liquidado_extra', label: 'Liquidado', render: cur('liquidado_extra') },
    ],
  },
  {
    titulo: '3.2 Créditos recebidos (PDR)', chave: 'tabela_32', emptyMessage: 'Sem créditos recebidos',
    columns: [
      { key: 'nc', label: 'NC', render: txt('nc') },
      { key: 'ne', label: 'NE', render: txt('ne') },
      { key: 'cod_nd', label: 'Cód. ND', render: txt('cod_nd') },
      { key: 'finalidade', label: 'Finalidade', render: txt('finalidade') },
      { key: 'valor_nc', label: 'Valor NC', render: cur('valor_nc') },
      { key: 'valor_recolhido', label: 'Recolhido', render: cur('valor_recolhido') },
      { key: 'valor_empenhado', label: 'Empenhado', render: cur('valor_empenhado') },
      { key: 'valor_liquidado', label: 'Liquidado', render: cur('valor_liquidado') },
    ],
  },
  {
    titulo: '3.3 RPNP', chave: 'tabela_33', emptyMessage: 'Sem RPNP',
    columns: [
      { key: 'empenho', label: 'Empenho', render: txt('empenho') },
      { key: 'finalidade', label: 'Finalidade', render: txt('finalidade') },
      { key: 'valor_empenhado', label: 'Empenhado', render: cur('valor_empenhado') },
      { key: 'valor_a_liquidar', label: 'A Liquidar', render: cur('valor_a_liquidar') },
    ],
  },
  {
    titulo: '3.4 GCALC DSG', chave: 'tabela_34', emptyMessage: 'Sem itens GCALC DSG',
    columns: [
      { key: 'objeto', label: 'Objeto', render: txt('objeto') },
      { key: 'fase_atual', label: 'Fase Atual', render: txt('fase_atual') },
      { key: 'valor_total_estimado', label: 'Valor Estimado', render: cur('valor_total_estimado') },
      { key: 'valor_final_homologado', label: 'Valor Homologado', render: cur('valor_final_homologado') },
    ],
  },
  {
    titulo: '3.5 Licitações próprias', chave: 'tabela_35', emptyMessage: 'Sem licitações próprias',
    columns: [
      { key: 'objeto', label: 'Objeto', render: txt('objeto') },
      { key: 'fase_atual', label: 'Fase Atual', render: txt('fase_atual') },
      { key: 'valor_total_estimado', label: 'Valor Estimado', render: cur('valor_total_estimado') },
      { key: 'valor_final_homologado', label: 'Valor Homologado', render: cur('valor_final_homologado') },
    ],
  },
  {
    titulo: '3.6 Recebimento de material', chave: 'tabela_36', emptyMessage: 'Sem recebimentos de material',
    columns: [
      { key: 'empenho', label: 'Empenho', render: txt('empenho') },
      { key: 'material', label: 'Material', render: txt('material') },
      { key: 'prazo_entrega', label: 'Prazo de Entrega', render: txt('prazo_entrega') },
      { key: 'situacao', label: 'Situação', render: txt('situacao') },
    ],
  },
  {
    titulo: '3.7 Extra-PDR', chave: 'tabela_37', emptyMessage: 'Sem itens Extra-PDR',
    columns: [
      { key: 'nc', label: 'NC', render: txt('nc') },
      { key: 'ne', label: 'NE', render: txt('ne') },
      { key: 'cod_nd', label: 'Cód. ND', render: txt('cod_nd') },
      { key: 'finalidade', label: 'Finalidade', render: txt('finalidade') },
      { key: 'valor_nc', label: 'Valor NC', render: cur('valor_nc') },
      { key: 'valor_recolhido', label: 'Recolhido', render: cur('valor_recolhido') },
      { key: 'valor_empenhado', label: 'Empenhado', render: cur('valor_empenhado') },
      { key: 'valor_liquidado', label: 'Liquidado', render: cur('valor_liquidado') },
    ],
  },
];

/**
 * Seção 3 do RPCMTec (#/relatorio). O ano vem do contexto global; ao abrir, gera
 * automaticamente o relatório do mês corrente (cumulativo) e mostra as 7
 * subtabelas. O usuário pode trocar o mês/cumulativo, gerar de novo, e baixar o
 * DOCX (abre no Google Docs preservando as tabelas).
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderRelatorio(container) {
  let disposed = false;
  const tables = {};

  const mesSelect = el('select', {
    className: 'form-field__select',
    id: 'relatorio-mes',
    'aria-label': 'Selecionar mês',
  }, Array.from({ length: 12 }, (_, i) => {
    const m = i + 1;
    return el('option', { value: String(m), textContent: monthName(m) });
  }));
  mesSelect.value = String(new Date().getMonth() + 1);
  mesSelect.addEventListener('change', () => gerar());

  const cumulativoInput = el('input', {
    className: 'form-field__checkbox',
    type: 'checkbox',
    id: 'relatorio-cumulativo',
    onChange: () => gerar(),
  });
  cumulativoInput.checked = true;

  const baixarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => baixarDocx(),
  }, [svgIcon(ICONS.download, 16), 'Baixar DOCX']);

  const toolbar = el('div', { className: 'rpcm-toolbar' }, [
    el('div', { className: 'rpcm-toolbar__field' }, [
      el('label', { className: 'rpcm-toolbar__label', for: 'relatorio-mes', textContent: 'Mês' }),
      mesSelect,
    ]),
    el('label', { className: 'rpcm-toolbar__check' }, [
      cumulativoInput,
      el('span', { textContent: 'Cumulativo' }),
    ]),
    el('div', { className: 'rpcm-toolbar__spacer' }),
    baixarBtn,
  ]);

  const blocos = SUBTABELAS.map(def => {
    const table = createDataTable({
      columns: def.columns,
      rows: [],
      pageSize: 25,
      emptyMessage: def.emptyMessage,
    });
    tables[def.id || def.chave] = table;
    return el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: def.titulo }),
      ]),
      table.element,
    ]);
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header page__header--column' }, [
      el('h1', { className: 'page__title', textContent: 'Seção 3 do RPCMTec' }),
      toolbar,
    ]),
    ...blocos,
  ]);
  container.appendChild(page);

  function getParams() {
    return {
      ano: getAno(),
      mes: parseInt(mesSelect.value, 10),
      cumulativo: cumulativoInput.checked,
    };
  }

  async function gerar() {
    for (const def of SUBTABELAS) tables[def.id || def.chave].update({ loading: true });
    try {
      const secao3 = await getSecao3(getParams());
      if (disposed) return;
      for (const def of SUBTABELAS) {
        const rows = (secao3 && secao3[def.chave]) || [];
        tables[def.id || def.chave].update({ rows, loading: false });
      }
    } catch (err) {
      if (disposed) return;
      for (const def of SUBTABELAS) tables[def.id || def.chave].update({ rows: [], loading: false });
      showError(err.message || 'Erro ao gerar a seção 3');
    }
  }

  async function baixarDocx() {
    baixarBtn.disabled = true;
    try {
      await downloadSecao3Docx(getParams());
    } catch (err) {
      showError(err.message || 'Erro ao baixar o DOCX');
    } finally {
      baixarBtn.disabled = false;
    }
  }

  const offAno = onAnoChange(() => { gerar(); });

  await gerar();

  return () => {
    disposed = true;
    offAno();
    for (const def of SUBTABELAS) tables[def.id || def.chave]._cleanup();
  };
}
