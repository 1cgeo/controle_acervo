import { el } from '@utils/dom.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { mostrarErroNoGrafico } from '@components/estado-erro.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';

/**
 * Aba "Distribuição": dois setores (produto por tipo e por escala), duas barras
 * (armazenamento por tipo de produto e arquivos por tipo de arquivo) e a barra
 * empilhada de uso por volume.
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderDistributionTab(container) {
  let disposed = false;

  const pieTipo = createPieChart({ title: 'Produtos por Tipo', loading: true });
  const pieEscala = createPieChart({ title: 'Produtos por Escala', loading: true });

  const barGbTipo = createBarChart({
    title: 'Armazenamento por Tipo de Produto',
    xKey: 'tipo_produto',
    series: [{ dataKey: 'total_gb', label: 'GB' }],
    loading: true,
  });

  // UMA UNIDADE POR GRÁFICO. Antes GB e Quantidade dividiam o mesmo eixo Y: com
  // 1.789 GB de arquivo complementar ao lado de 7.233 arquivos de formato
  // alternativo, as duas séries não eram comparáveis e a barra menor virava uma
  // linha no chão. Dois gráficos respondem as duas perguntas; um só não
  // respondia nenhuma.
  const barGbArquivo = createBarChart({
    title: 'Armazenamento por Tipo de Arquivo',
    xKey: 'tipo_arquivo',
    series: [{ dataKey: 'total_gb', label: 'GB' }],
    loading: true,
  });

  const barQtdArquivo = createBarChart({
    title: 'Quantidade por Tipo de Arquivo',
    xKey: 'tipo_arquivo',
    series: [{ dataKey: 'quantidade', label: 'Arquivos' }],
    loading: true,
  });

  // PERCENTUAL, e não GB absoluto. A pergunta do volume é "qual está enchendo",
  // e não "qual é maior". Em GB, o Acervo SCA (37.000 GB de capacidade) dominava
  // o eixo e o volume que está em 76% aparecia como uma barra de dois pixels.
  const barVolume = createBarChart({
    title: 'Uso dos volumes (% da capacidade)',
    xKey: 'nome_volume',
    series: [{ dataKey: 'percentual_uso', label: '% usado' }],
    loading: true,
  });

  container.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [pieTipo, pieEscala]));
  container.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [barGbTipo, barGbArquivo]));
  container.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [barQtdArquivo, barVolume]));

  // Um bloco por grafico, e nao uma carga so.
  //
  // Antes, a falha de qualquer endpoint virava lista vazia, e o card passava a
  // dizer "Sem dados disponiveis": a frase do acervo sem produto daquele tipo.
  // Endpoint fora do ar lia-se como acervo vazio, que e a leitura oposta.
  //
  // Cada bloco cai sozinho, e por isso o "tentar de novo" refaz SO a pergunta
  // que falhou: os quatro graficos que vieram certos ficam na tela.
  const blocos = [
    {
      card: pieTipo,
      buscar: acervoService.getProdutosTipo,
      dados: (linhas) => linhas.map(d => ({
        label: d.tipo_produto, value: Number(d.quantidade),
      })),
    },
    {
      card: pieEscala,
      buscar: acervoService.getProdutosEscala,
      dados: (linhas) => linhas.map(d => ({
        label: d.tipo_escala, value: Number(d.quantidade),
      })),
    },
    {
      card: barGbTipo,
      buscar: acervoService.getGbTipoProduto,
      dados: (linhas) => linhas.map(d => ({ ...d, total_gb: Number(d.total_gb) })),
    },
    {
      card: barGbArquivo,
      buscar: acervoService.getArquivosTipoArquivo,
      dados: (linhas) => linhas.map(d => ({ ...d, total_gb: Number(d.total_gb) })),
    },
    {
      card: barQtdArquivo,
      buscar: acervoService.getArquivosTipoArquivo,
      dados: (linhas) => linhas.map(d => ({ ...d, quantidade: Number(d.quantidade) })),
    },
    {
      card: barVolume,
      buscar: acervoService.getGbVolume,
      // O percentual sai da MESMA conta do alerta de 80% (dashboard_ctrl,
      // getSystemHealth), para o gráfico e o alerta nunca discordarem. Volume sem
      // capacidade declarada fica em zero em vez de dividir por zero.
      dados: (linhas) => linhas.map(d => {
        const capacidade = Number(d.capacidade_gb_volume || 0);
        const usado = Number(d.total_gb || 0);
        return {
          ...d,
          percentual_uso: capacidade > 0 ? Number(((usado / capacidade) * 100).toFixed(1)) : 0,
        };
      }),
    },
  ];

  async function carregarBloco(bloco) {
    try {
      const resposta = await bloco.buscar();
      if (disposed) return;
      bloco.card.update({
        data: bloco.dados(Array.isArray(resposta) ? resposta : []),
        loading: false,
      });
    } catch (erro) {
      if (disposed) return;
      bloco.card.update({ data: [], loading: false });
      mostrarErroNoGrafico(bloco.card, erro, () => carregarBloco(bloco));
    }
  }

  const load = () => Promise.all(blocos.map(carregarBloco));

  await load();

  return {
    cleanup: () => {
      disposed = true;
      [pieTipo, pieEscala, barGbTipo, barGbArquivo, barQtdArquivo, barVolume].forEach(c => c._cleanup && c._cleanup());
    },
    refresh: load,
  };
}
