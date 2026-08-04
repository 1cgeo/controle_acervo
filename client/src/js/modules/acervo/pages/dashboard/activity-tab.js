import { createBarChart } from '@components/charts/bar-chart.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createTabs } from '@components/tabs/tabs.js';
import { chip } from '@components/status-chip.js';
import { formatDateTime, formatNumber } from '@utils/format.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';
import { mostrarErro } from './estado-erro.js';

const DIAS_DA_SERIE = 30;

/**
 * Monta o render de uma sub-aba que e so uma tabela alimentada por um endpoint.
 * Devolve { cleanup, refresh } para o auto-refresh recarregar no lugar.
 * @param {{columns:Array, getData:Function, mapData?:Function, emptyMessage?:string}} cfg
 * @returns {Function}
 */
function tabelaTab({ columns, getData, mapData = null, emptyMessage = 'Sem dados disponíveis' }) {
  return async (content) => {
    let disposed = false;
    const tabela = createDataTable({
      columns,
      rows: [],
      loading: true,
      pageSize: 5,
      searchable: true,
      emptyMessage,
    });
    content.appendChild(tabela.element);

    const load = async () => {
      try {
        const dados = await getData();
        if (disposed) return;
        const linhas = Array.isArray(dados) ? dados : [];
        tabela.update({ rows: mapData ? linhas.map(mapData) : linhas, loading: false });
      } catch (erro) {
        if (disposed) return;
        // Estado de ERRO proprio, e nao lista vazia. Zerar as linhas fazia a
        // tabela mostrar "Sem dados disponiveis", que e a frase do acervo
        // vazio: a falha da API lia-se como ausencia de dado.
        tabela.update({ rows: [], loading: false });
        mostrarErro(content, erro, load);
      }
    };

    await load();

    return {
      cleanup: () => { disposed = true; tabela._cleanup(); },
      refresh: load,
    };
  };
}

/** Tamanho em MB com duas casas, ou '-' quando o servidor nao mandou. */
function mb(valor) {
  return valor === null || valor === undefined ? '-' : Number(valor).toFixed(2);
}

const COLUNAS_ARQUIVO = [
  { key: 'nome', label: 'Nome', sortable: true, className: 'data-table__cell--truncate' },
  { key: 'tamanho_mb', label: 'Tamanho (MB)', sortable: true, render: (row) => mb(row.tamanho_mb) },
  { key: 'extensao', label: 'Tipo', render: (row) => (row.extensao ? String(row.extensao).toUpperCase() : '-') },
  { key: 'data', label: 'Data', sortable: true, render: (row) => formatDateTime(row.data) },
];

const COLUNAS_EXCLUSAO = [
  { key: 'nome', label: 'Nome', sortable: true, className: 'data-table__cell--truncate' },
  { key: 'tamanho_mb', label: 'Tamanho (MB)', sortable: true, render: (row) => mb(row.tamanho_mb) },
  { key: 'extensao', label: 'Tipo', render: (row) => (row.extensao ? String(row.extensao).toUpperCase() : '-') },
  { key: 'data_delete', label: 'Data', sortable: true, render: (row) => formatDateTime(row.data_delete) },
  {
    key: 'motivo_exclusao',
    label: 'Motivo',
    className: 'data-table__cell--truncate',
    render: (row) => row.motivo_exclusao || '-',
  },
];

const COLUNAS_DOWNLOAD = [
  { key: 'id', label: 'ID', sortable: true },
  { key: 'arquivo_id', label: 'Arquivo ID' },
  { key: 'data_download', label: 'Data do Download', sortable: true, render: (row) => formatDateTime(row.data_download) },
  {
    key: 'apagado',
    label: 'Situação',
    render: (row) => (row.apagado
      ? chip('Arquivo excluído', 'error')
      : chip('Disponível', 'success')),
  },
];

const COLUNAS_PRODUTO = [
  { key: 'nome', label: 'Nome', sortable: true, className: 'data-table__cell--truncate' },
  { key: 'mi', label: 'MI', sortable: true },
  { key: 'tipo_produto', label: 'Tipo' },
  { key: 'tipo_escala', label: 'Escala' },
  { key: 'total_versoes', label: 'Versões', sortable: true, render: (row) => formatNumber(row.total_versoes) },
  { key: 'data_cadastramento', label: 'Data do Cadastro', sortable: true, render: (row) => formatDateTime(row.data_cadastramento) },
];

const COLUNAS_VERSAO = [
  { key: 'versao', label: 'Versão', sortable: true },
  { key: 'produto_nome', label: 'Produto', sortable: true, className: 'data-table__cell--truncate' },
  { key: 'mi', label: 'MI' },
  { key: 'tipo_versao', label: 'Tipo' },
  { key: 'orgao_produtor', label: 'Órgão Produtor', className: 'data-table__cell--truncate' },
  { key: 'total_arquivos', label: 'Arquivos', sortable: true, render: (row) => formatNumber(row.total_arquivos) },
  { key: 'data_criacao', label: 'Data de Criação', sortable: true, render: (row) => formatDateTime(row.data_criacao) },
];

/**
 * Aba "Atividade": a serie diaria de upload e download dos ultimos 30 dias,
 * mais sete sub-abas de detalhe (produtos, versoes, uploads, modificacoes,
 * exclusoes, downloads e situacao de carregamento).
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderActivityTab(container) {
  let disposed = false;

  const graficoDiario = createBarChart({
    title: 'Atividade Diária (Últimos 30 Dias)',
    xKey: 'dia',
    series: [
      { dataKey: 'uploads', label: 'Uploads' },
      { dataKey: 'downloads', label: 'Downloads' },
    ],
    loading: true,
  });
  container.appendChild(graficoDiario);

  const subAbas = createTabs({
    className: 'sub-tabs',
    ariaLabel: 'Detalhe da atividade',
    tabs: [
      {
        id: 'produtos',
        label: 'Produtos Recentes',
        render: tabelaTab({ columns: COLUNAS_PRODUTO, getData: acervoService.getUltimosProdutos }),
      },
      {
        id: 'versoes',
        label: 'Versões Recentes',
        render: tabelaTab({ columns: COLUNAS_VERSAO, getData: acervoService.getUltimasVersoes }),
      },
      {
        id: 'uploads',
        label: 'Uploads Recentes',
        render: tabelaTab({
          columns: COLUNAS_ARQUIVO,
          getData: acervoService.getUltimosCarregamentos,
          mapData: (d) => ({ ...d, data: d.data_cadastramento }),
        }),
      },
      {
        id: 'modificacoes',
        label: 'Modificações Recentes',
        render: tabelaTab({
          columns: COLUNAS_ARQUIVO,
          getData: acervoService.getUltimasModificacoes,
          mapData: (d) => ({ ...d, data: d.data_modificacao || d.data_cadastramento }),
        }),
      },
      {
        id: 'exclusoes',
        label: 'Exclusões Recentes',
        render: tabelaTab({ columns: COLUNAS_EXCLUSAO, getData: acervoService.getUltimosDeletes }),
      },
      {
        id: 'downloads',
        label: 'Histórico de Downloads',
        render: tabelaTab({ columns: COLUNAS_DOWNLOAD, getData: acervoService.getDownloads }),
      },
      {
        id: 'carregamento',
        label: 'Situação de Carregamento',
        render: async (content) => {
          let fechada = false;
          const grafico = createPieChart({
            title: 'Distribuição por Situação de Carregamento',
            loading: true,
          });
          content.appendChild(grafico);

          const load = async () => {
            try {
              const dados = await acervoService.getSituacaoCarregamento();
              if (fechada) return;
              grafico.update({
                data: (Array.isArray(dados) ? dados : []).map(d => ({
                  label: d.situacao,
                  value: Number(d.quantidade),
                })),
                loading: false,
              });
            } catch {
              if (fechada) return;
              grafico.update({ data: [], loading: false });
            }
          };

          await load();
          return {
            cleanup: () => { fechada = true; if (grafico._cleanup) grafico._cleanup(); },
            refresh: load,
          };
        },
      },
    ],
  });

  container.appendChild(subAbas.element);

  /** Serie de 30 dias com zero nos dias sem movimento. */
  function serieVazia() {
    const serie = {};
    const hoje = new Date();
    for (let i = DIAS_DA_SERIE - 1; i >= 0; i--) {
      const d = new Date(hoje);
      d.setDate(d.getDate() - i);
      const chave = d.toISOString().split('T')[0];
      serie[chave] = { dia: chave.slice(5), uploads: 0, downloads: 0 };
    }
    return serie;
  }

  async function loadDiario() {
    const [arquivos, downloads] = await Promise.allSettled([
      acervoService.getArquivosDia(),
      acervoService.getDownloadsDia(),
    ]);
    if (disposed) return;

    const serie = serieVazia();

    const preencher = (resultado, campo) => {
      if (resultado.status !== 'fulfilled' || !Array.isArray(resultado.value)) return;
      for (const item of resultado.value) {
        const chave = item.dia ? String(item.dia).split('T')[0] : null;
        if (chave && serie[chave]) serie[chave][campo] = Number(item.quantidade);
      }
    };

    preencher(arquivos, 'uploads');
    preencher(downloads, 'downloads');

    graficoDiario.update({ data: Object.values(serie), loading: false });
  }

  await Promise.all([loadDiario(), subAbas.ready]);

  return {
    cleanup: () => {
      disposed = true;
      if (graficoDiario._cleanup) graficoDiario._cleanup();
      subAbas._cleanup();
    },
    refresh: async () => {
      await Promise.all([loadDiario(), subAbas.refreshActive()]);
    },
  };
}
