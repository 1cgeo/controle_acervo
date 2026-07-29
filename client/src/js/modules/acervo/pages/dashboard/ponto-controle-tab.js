import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber, formatDate, formatDateTime } from '@utils/format.js';
import { createStatsCard } from '@components/stats-card.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { chip } from '@components/status-chip.js';
import { getDashboardPontoControle } from '@modules/acervo/services/ponto-controle-service.js';

/** Cores por situação, as MESMAS do mapa e dos chips da tela de ponto. */
const COR_SITUACAO = {
  1: '#f59e0b', // Não medido
  2: '#3b82f6', // Aguardando revisão
  3: '#22c55e', // Aprovado
  4: '#ef4444', // Reprovado
};

const VARIANTE_SESSAO = {
  completed: 'success',
  failed: 'error',
  cancelled: 'default',
  pending: 'warning',
};

const ROTULO_SESSAO = {
  completed: 'Concluída',
  failed: 'Falhou',
  cancelled: 'Cancelada',
  pending: 'Em andamento',
};

/**
 * Aba "Ponto de Controle" do dashboard do acervo.
 *
 * Uma chamada só alimenta a aba inteira, e não sete: o dashboard do acervo
 * divide por endpoint porque cada aba dele é um assunto diferente; aqui é um
 * assunto só, e sete requisições pagariam sete vezes a rede sem ganhar nada.
 *
 * O recorte de MISSÃO é o lote, porque no modelo do SCA a missão É um
 * `acervo.lote` (ver er/ponto_controle.sql). Por isso a tabela se chama
 * "missões" e a coluna, "lote".
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderPontoControleTab(container) {
  let disposed = false;

  const mkCard = (title, icon, color, suffix) => createStatsCard({
    title, value: '-', icon: svgIcon(icon, 24), color, loading: true, suffix,
  });

  const cardPontos = mkCard('Pontos de Controle', ICONS.place, 'primary');
  const cardMissoes = mkCard('Missões com pontos', ICONS.assignment, 'info');
  const cardArquivos = mkCard('Arquivos', ICONS.description, 'info');
  const cardGb = mkCard('Armazenamento', ICONS.dataUsage, 'warning', 'GB');

  container.appendChild(el('div', { className: 'stats-grid' }, [
    cardPontos, cardMissoes, cardArquivos, cardGb,
  ]));

  const pieSituacao = createPieChart({ title: 'Pontos por Situação', loading: true });

  const barTipoArquivo = createBarChart({
    title: 'Arquivos por Tipo',
    xKey: 'nome',
    series: [
      { dataKey: 'arquivos', label: 'Quantidade' },
      { dataKey: 'mb', label: 'MB' },
    ],
    loading: true,
  });

  container.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
    pieSituacao, barTipoArquivo,
  ]));

  const barMes = createBarChart({
    title: 'Pontos por mês de rastreio (12 meses)',
    xKey: 'mes',
    series: [{ dataKey: 'pontos', label: 'Pontos' }],
    loading: true,
  });
  container.appendChild(barMes);

  const tabelaMissoes = createDataTable({
    title: 'Missões com ponto de controle',
    columns: [
      { key: 'lote', label: 'Lote (missão)' },
      { key: 'pit', label: 'PIT' },
      { key: 'projeto', label: 'Projeto' },
      { key: 'pontos', label: 'Pontos', render: r => formatNumber(r.pontos) },
      {
        key: 'aprovados',
        label: 'Aprovados',
        render: r => `${formatNumber(r.aprovados)} de ${formatNumber(r.pontos)}`,
      },
      {
        key: 'periodo',
        label: 'Período de rastreio',
        render: r => (r.primeiro_rastreio
          ? `${formatDate(r.primeiro_rastreio)} a ${formatDate(r.ultimo_rastreio)}`
          : '-'),
      },
    ],
    rows: [],
    paginated: false,
    emptyMessage: 'Nenhuma missão importada ainda.',
    loading: true,
  });
  // Duas coisas aqui, e as duas foram defeito na primeira versão desta aba:
  //
  // 1. entra `.element`, e não o objeto. O createDataTable devolve
  //    { element, update, ... }, ao contrário do stats-card e dos gráficos, que
  //    devolvem o próprio nó. Passar o objeto ao appendChild derrubava a aba
  //    inteira com "parameter 1 is not of type 'Node'".
  // 2. o TÍTULO vem daqui. O createDataTable aceita `title` e não o desenha,
  //    então as duas tabelas apareciam empilhadas sem dizer qual era qual.
  const comTitulo = (texto, tabela) => el('div', { className: 'chart-card' }, [
    el('div', { className: 'chart-card__title', textContent: texto }),
    tabela.element,
  ]);

  container.appendChild(comTitulo('Missões com ponto de controle', tabelaMissoes));

  const tabelaImportacoes = createDataTable({
    title: 'Últimas importações',
    columns: [
      { key: 'lote', label: 'Lote (missão)' },
      { key: 'usuario', label: 'Quem importou' },
      { key: 'pontos', label: 'Pontos', render: r => formatNumber(r.pontos) },
      {
        key: 'status',
        label: 'Situação',
        render: r => chip(ROTULO_SESSAO[r.status] || r.status,
          VARIANTE_SESSAO[r.status] || 'default'),
      },
      {
        key: 'completed_at',
        label: 'Concluída em',
        render: r => (r.completed_at ? formatDateTime(r.completed_at) : '-'),
      },
      // O motivo da falha aparece na TABELA, e não só no log do servidor: quem
      // importou precisa saber qual arquivo não passou na conferência.
      { key: 'error_message', label: 'Motivo', render: r => r.error_message || '' },
    ],
    rows: [],
    paginated: false,
    emptyMessage: 'Nenhuma importação registrada.',
    loading: true,
  });
  container.appendChild(comTitulo('Últimas importações', tabelaImportacoes));

  async function load() {
    let dados;
    try {
      dados = await getDashboardPontoControle();
    } catch {
      if (disposed) return;
      for (const c of [cardPontos, cardMissoes, cardArquivos, cardGb]) {
        c.update({ value: 'Erro', loading: false });
      }
      pieSituacao.update({ data: [], loading: false });
      barTipoArquivo.update({ data: [], loading: false });
      barMes.update({ data: [], loading: false });
      tabelaMissoes.update({ rows: [], loading: false });
      tabelaImportacoes.update({ rows: [], loading: false });
      return;
    }
    if (disposed) return;

    cardPontos.update({ value: formatNumber(dados.total_pontos ?? 0), loading: false });
    cardMissoes.update({ value: formatNumber(dados.total_missoes ?? 0), loading: false });
    cardArquivos.update({ value: formatNumber(dados.total_arquivos ?? 0), loading: false });
    cardGb.update({
      value: Number(dados.total_gb ?? 0).toLocaleString('pt-BR', {
        minimumFractionDigits: 2, maximumFractionDigits: 2,
      }),
      loading: false,
      suffix: 'GB',
    });

    // Situação com ZERO entra no gráfico: omitir "Reprovado" quando não há
    // reprovado nenhum faz parecer que a categoria não existe.
    pieSituacao.update({
      data: (dados.por_situacao || []).map(s => ({
        label: s.nome,
        value: Number(s.pontos),
        color: COR_SITUACAO[s.code],
      })),
      loading: false,
    });

    barTipoArquivo.update({
      data: (dados.por_tipo_arquivo || []).map(t => ({
        ...t, arquivos: Number(t.arquivos), mb: Number(t.mb),
      })),
      loading: false,
    });

    barMes.update({
      data: (dados.por_mes || []).map(m => ({ ...m, pontos: Number(m.pontos) })),
      loading: false,
    });

    tabelaMissoes.update({ rows: dados.por_missao || [], loading: false });
    tabelaImportacoes.update({ rows: dados.ultimas_importacoes || [], loading: false });
  }

  await load();

  return {
    cleanup: () => { disposed = true; },
    refresh: load,
  };
}
