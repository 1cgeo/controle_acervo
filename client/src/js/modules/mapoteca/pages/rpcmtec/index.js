import { el, svgIcon, ICONS } from '@utils/dom.js';
import { monthName, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import {
  getRpcmtecAcervo,
  downloadRpcmtecDocx,
  getAnuario,
  downloadAnuarioOds,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { getAno, onAnoChange } from '@modules/mapoteca/store/year-store.js';

const num = (key) => (row) => formatNumber(row[key] ?? 0);
const txt = (key) => (row) => row[key] ?? '-';
const pct = (key) => (row) => (row[key] == null ? '-' : `${row[key]}%`);

// No Anuário, célula nula quer dizer "o SCA não tem essa fonte", e zero quer
// dizer "não houve entrega". Um `?? 0` apagaria a diferença, que é justamente a
// que o rodapé do arquivo declara.
const numOuTraco = (key) => (row) => (row[key] == null ? '-' : formatNumber(row[key]));

// As 8 colunas da Tabela 5.4.9, na ordem do arquivo que sobe para a DSG.
const COLUNAS_ANUARIO = [
  { key: 'rotulo', label: 'Suprimento de cartografia', render: txt('rotulo') },
  { key: 'exercito', label: 'Exército', render: numOuTraco('exercito') },
  { key: 'rm', label: 'RM', render: numOuTraco('rm') },
  { key: 'ee_exercito', label: 'EE do Exército', render: numOuTraco('ee_exercito') },
  { key: 'outras_forcas', label: 'Outras Forças', render: numOuTraco('outras_forcas') },
  { key: 'orgao_publico', label: 'Órgão Público', render: numOuTraco('orgao_publico') },
  { key: 'empresa_privada', label: 'Empresa Privada', render: numOuTraco('empresa_privada') },
  { key: 'prof_autonomo', label: 'Prof. Autônomo', render: numOuTraco('prof_autonomo') },
];

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

  // O ano vem do contexto do modulo (seletor da navbar). O MÊS continua aqui:
  // ele e desta tela, e o RPCMTec e sempre de um mes especifico.
  const anoLabel = el('span', {
    className: 'dashboard-section__ano',
    textContent: String(getAno()),
  });

  const offAno = onAnoChange(() => {
    anoLabel.textContent = String(getAno());
    gerar();
  });

  const baixarBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => baixarDocx(),
  }, [svgIcon(ICONS.print, 16), 'Baixar DOCX']);

  // O Anuário sobe para a DSG junto com o RTM, e sai do mesmo mês desta tela.
  // Fica aqui, e não numa página própria, porque é a mesma tarefa mensal.
  const anuarioBtn = el('button', {
    className: 'btn',
    type: 'button',
    onClick: () => baixarAnuario(),
  }, [svgIcon(ICONS.print, 16), 'Baixar Anuário (ODS)']);

  const toolbar = el('div', { className: 'rpcm-toolbar' }, [
    el('div', { className: 'rpcm-toolbar__field' }, [
      el('label', { className: 'rpcm-toolbar__label', for: 'rpcmtec-mes', textContent: 'Mês' }),
      mesSelect,
    ]),
    el('div', { className: 'rpcm-toolbar__field' }, [
      el('span', { className: 'rpcm-toolbar__label', textContent: 'Ano' }),
      anoLabel,
    ]),
    el('div', { className: 'rpcm-toolbar__spacer' }),
    anuarioBtn,
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

  const anuarioTable = createDataTable({
    columns: COLUNAS_ANUARIO,
    rows: [],
    pageSize: 40,
    emptyMessage: 'Sem entregas no mês',
  });

  // As lacunas que o SCA declara não saber preencher. Ficam à vista na tela, e
  // não só no rodapé do arquivo: quem confere o número precisa saber onde ele
  // não existe.
  const anuarioLacunas = el('ul', { className: 'dashboard-section__nota' });

  const blocoAnuario = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', {
        className: 'dashboard-section__title',
        textContent: 'Anuário Estatístico - Tabela 5.4.9 (sobe para a DSG)',
      }),
    ]),
    anuarioTable.element,
    anuarioLacunas,
  ]);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header page__header--column' }, [
      el('h1', { className: 'page__title', textContent: 'RPCMTec - Seção Acervo' }),
      toolbar,
    ]),
    ...blocos,
    blocoAnuario,
  ]);
  container.appendChild(page);

  function getParams() {
    return {
      ano: getAno(),
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
    await gerarAnuario();
  }

  // Chamada à parte da do RPCMTec, de propósito: o Anuário é outro relatório,
  // com outra rota, e uma falha nele não pode apagar as tabelas do RPCMTec.
  async function gerarAnuario() {
    anuarioTable.update({ loading: true });
    try {
      const a = await getAnuario(getParams());
      if (disposed) return;
      const rows = [
        a.total_convencional,
        ...a.convencional,
        a.total_digital,
        ...a.digital,
      ];
      anuarioTable.update({ rows, loading: false });
      anuarioLacunas.replaceChildren(
        ...(a.lacunas || []).map((l) => el('li', { textContent: l })),
      );
    } catch (err) {
      if (disposed) return;
      anuarioTable.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao gerar o Anuário Estatístico');
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

  async function baixarAnuario() {
    anuarioBtn.disabled = true;
    try {
      await downloadAnuarioOds(getParams());
    } catch (err) {
      showError(err.message || 'Erro ao baixar o Anuário');
    } finally {
      anuarioBtn.disabled = false;
    }
  }

  await gerar();

  return () => {
    disposed = true;
    offAno();
    for (const def of SECOES) tables[def.chave]._cleanup();
    anuarioTable._cleanup();
  };
}
