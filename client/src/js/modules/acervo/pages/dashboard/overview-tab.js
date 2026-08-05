import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { createStatsCard } from '@components/stats-card.js';
import { estadoErro } from '@components/estado-erro.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';

/**
 * Monta o painel de alertas do sistema a partir de /dashboard/system_health.
 * Sem alerta nenhum, mostra a linha verde de sistema saudavel.
 * @param {Object} health
 * @returns {HTMLElement}
 */
export function createAlertPanel(health) {
  const alertas = [];

  // Volume perto da capacidade (o servidor so devolve os acima de 80%)
  const volumes = (health && health.volumes_alertas) || [];
  for (const vol of volumes) {
    const pct = Number(vol.percentual_uso);
    const severidade = pct > 90 ? 'error' : 'warning';

    const barra = el('div', { className: 'progress-bar' }, [
      el('div', {
        className: `progress-bar__fill progress-bar__fill--${severidade}`,
        style: { width: `${Math.min(pct, 100)}%` },
      }),
    ]);

    alertas.push(
      el('div', { className: `alert-panel__item alert-panel__item--${severidade}` }, [
        svgIcon(ICONS.warning, 18),
        el('span', {
          className: 'alert-panel__item-text',
          textContent: `Volume "${vol.nome}" em ${pct}% da capacidade`,
        }),
        barra,
      ])
    );
  }

  // Arquivo com erro de carregamento ou de exclusao
  const erros = (health && health.erros_arquivo) || {};
  const totalErros = (erros.erros_carregamento || 0) + (erros.erros_exclusao || 0);
  if (totalErros > 0) {
    const partes = [];
    if (erros.erros_carregamento > 0) partes.push(`${erros.erros_carregamento} de carregamento`);
    if (erros.erros_exclusao > 0) partes.push(`${erros.erros_exclusao} de exclusão`);
    const texto = partes.length
      ? `${totalErros} arquivo(s) com erro (${partes.join(', ')})`
      : `${totalErros} arquivo(s) com erro`;

    alertas.push(
      el('div', { className: 'alert-panel__item alert-panel__item--error' }, [
        svgIcon(ICONS.warning, 18),
        el('span', { className: 'alert-panel__item-text', textContent: texto }),
      ])
    );
  }

  // Sessao de upload em andamento
  if (health && health.sessoes_upload_ativas > 0) {
    alertas.push(
      el('div', { className: 'alert-panel__item alert-panel__item--warning' }, [
        svgIcon(ICONS.warning, 18),
        el('span', {
          className: 'alert-panel__item-text',
          textContent: `${health.sessoes_upload_ativas} sessão(ões) de upload ativa(s)`,
        }),
      ])
    );
  }

  if (!alertas.length) {
    alertas.push(
      el('div', { className: 'alert-panel__item alert-panel__item--success' }, [
        svgIcon(ICONS.checkCircle, 18),
        el('span', { className: 'alert-panel__item-text', textContent: 'Nenhum alerta: sistema saudável' }),
      ])
    );
  }

  return el('div', { className: 'alert-panel' }, [
    el('div', { className: 'alert-panel__title' }, [
      svgIcon(ICONS.warning, 20),
      'Alertas do Sistema',
    ]),
    el('div', { className: 'alert-panel__list' }, alertas),
  ]);
}

/**
 * Aba "Visão Geral": seis cards e o painel de alertas.
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderOverviewTab(container) {
  let disposed = false;

  const mkCard = (title, icon, color) => createStatsCard({
    title, value: '-', icon: svgIcon(icon, 24), color, loading: true,
  });

  const cardProdutos = mkCard('Total de Produtos', ICONS.storage, 'primary');
  const cardArmazenamento = createStatsCard({
    title: 'Armazenamento Total',
    value: '-',
    icon: svgIcon(ICONS.dataUsage, 24),
    color: 'warning',
    loading: true,
    suffix: 'GB',
  });
  // Saiu "Total de Usuários" e entrou "Pontos de Controle"; saiu "Total de
  // Projetos" e entrou "Carregamento no mês". A visão geral
  // do acervo responde o que existe e o que ENTROU, e a contagem de usuários
  // não é acervo: ela vive na tela de usuários da plataforma.
  const cardPontosControle = mkCard('Pontos de Controle', ICONS.place, 'success');
  const cardCarregamentoMes = mkCard('Carregamento no mês', ICONS.assignment, 'info');
  const cardVersoes = mkCard('Total de Versões', ICONS.layers, 'info');
  const cardDownloads = mkCard('Downloads (30d)', ICONS.download, 'info');

  const cards = [
    cardProdutos, cardArmazenamento, cardPontosControle,
    cardCarregamentoMes, cardVersoes, cardDownloads,
  ];
  container.appendChild(el('div', { className: 'stats-grid' }, cards));

  const alertContainer = el('div');
  container.appendChild(alertContainer);

  async function load() {
    // Promise.allSettled: um endpoint fora do ar nao derruba a aba inteira.
    const [produtos, armazenamento, health] = await Promise.allSettled([
      acervoService.getProdutosTotal(),
      acervoService.getArquivosTotalGb(),
      acervoService.getSystemHealth(),
    ]);
    if (disposed) return;

    if (produtos.status === 'fulfilled') {
      cardProdutos.update({ value: formatNumber(produtos.value?.total_produtos ?? 0), loading: false });
    } else {
      cardProdutos.update({ value: 'Erro', loading: false });
    }

    if (armazenamento.status === 'fulfilled') {
      const gb = Number(armazenamento.value?.total_gb ?? 0);
      cardArmazenamento.update({
        value: gb.toLocaleString('pt-BR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }),
        loading: false,
        suffix: 'GB',
      });
    } else {
      cardArmazenamento.update({ value: 'Erro', loading: false });
    }

    if (health.status === 'fulfilled') {
      const dados = health.value;
      cardPontosControle.update({
        value: formatNumber(dados?.total_pontos_controle ?? 0), loading: false,
      });
      // Contado em VERSÕES: é a versão que carrega os arquivos, e é ela que o
      // operador cadastra. Contar produtos responderia outra pergunta (quantas
      // folhas novas), e produto antigo que ganha edição nova não apareceria.
      cardCarregamentoMes.update({
        value: formatNumber(dados?.versoes_carregadas_mes ?? 0), loading: false,
      });
      cardVersoes.update({ value: formatNumber(dados?.total_versoes ?? 0), loading: false });
      cardDownloads.update({ value: formatNumber(dados?.downloads_30d ?? 0), loading: false });

      alertContainer.innerHTML = '';
      alertContainer.appendChild(createAlertPanel(dados));
    } else {
      cardPontosControle.update({ value: 'Erro', loading: false });
      cardCarregamentoMes.update({ value: 'Erro', loading: false });
      cardVersoes.update({ value: 'Erro', loading: false });
      cardDownloads.update({ value: 'Erro', loading: false });
      // O painel de alertas TEM de mudar quando o health falha.
      //
      // Antes o ramo de falha nao o tocava, e o auto-refresh de 60 s deixava na
      // tela o painel da carga anterior: "Nenhum alerta: sistema saudavel"
      // seguia afirmando saude horas depois de o endpoint parar de responder.
      // Na primeira carga era pior ainda, porque nao aparecia painel nenhum, e
      // a ausencia se le como "nao ha alerta". E o painel que o chefe olha para
      // saber se ha volume enchendo: dizer saude sem saber e a falha mais cara.
      alertContainer.replaceChildren(estadoErro(health.reason, load));
    }
  }

  await load();

  return {
    cleanup: () => { disposed = true; },
    refresh: load,
  };
}
