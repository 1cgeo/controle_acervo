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

  const barTipoArquivo = createBarChart({
    title: 'Arquivos por Tipo de Arquivo',
    xKey: 'tipo_arquivo',
    series: [
      { dataKey: 'total_gb', label: 'GB' },
      { dataKey: 'quantidade', label: 'Quantidade' },
    ],
    loading: true,
  });

  const barVolume = createBarChart({
    title: 'Armazenamento por Volume',
    xKey: 'nome_volume',
    series: [
      { dataKey: 'total_gb', label: 'Usado (GB)' },
      { dataKey: 'available_gb', label: 'Disponível (GB)' },
    ],
    stacked: true,
    loading: true,
  });

  container.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [pieTipo, pieEscala]));
  container.appendChild(el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [barGbTipo, barTipoArquivo]));
  container.appendChild(barVolume);

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
      card: barTipoArquivo,
      buscar: acervoService.getArquivosTipoArquivo,
      dados: (linhas) => linhas.map(d => ({
        ...d,
        total_gb: Number(d.total_gb),
        quantidade: Number(d.quantidade),
      })),
    },
    {
      card: barVolume,
      buscar: acervoService.getGbVolume,
      // O disponivel e a capacidade do volume menos o usado, nunca negativo.
      dados: (linhas) => linhas.map(d => ({
        ...d,
        total_gb: Number(d.total_gb),
        available_gb: Math.max(0, Number(d.capacidade_gb_volume || 0) - Number(d.total_gb)),
      })),
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
      [pieTipo, pieEscala, barGbTipo, barTipoArquivo, barVolume].forEach(c => c._cleanup && c._cleanup());
    },
    refresh: load,
  };
}
