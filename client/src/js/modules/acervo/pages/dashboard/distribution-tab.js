import { el } from '@utils/dom.js';
import { createPieChart } from '@components/charts/pie-chart.js';
import { createBarChart } from '@components/charts/bar-chart.js';
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

  async function load() {
    const [tipo, escala, gbTipo, tipoArquivo, gbVolume] = await Promise.allSettled([
      acervoService.getProdutosTipo(),
      acervoService.getProdutosEscala(),
      acervoService.getGbTipoProduto(),
      acervoService.getArquivosTipoArquivo(),
      acervoService.getGbVolume(),
    ]);
    if (disposed) return;

    const lista = (resultado) =>
      (resultado.status === 'fulfilled' && Array.isArray(resultado.value)) ? resultado.value : [];

    pieTipo.update({
      data: lista(tipo).map(d => ({ label: d.tipo_produto, value: Number(d.quantidade) })),
      loading: false,
    });

    pieEscala.update({
      data: lista(escala).map(d => ({ label: d.tipo_escala, value: Number(d.quantidade) })),
      loading: false,
    });

    barGbTipo.update({
      data: lista(gbTipo).map(d => ({ ...d, total_gb: Number(d.total_gb) })),
      loading: false,
    });

    barTipoArquivo.update({
      data: lista(tipoArquivo).map(d => ({
        ...d,
        total_gb: Number(d.total_gb),
        quantidade: Number(d.quantidade),
      })),
      loading: false,
    });

    // O disponivel e a capacidade do volume menos o usado, nunca negativo.
    barVolume.update({
      data: lista(gbVolume).map(d => ({
        ...d,
        nome_volume: d.nome_volume || d.volume,
        total_gb: Number(d.total_gb),
        available_gb: Math.max(0, Number(d.capacidade_gb_volume || 0) - Number(d.total_gb)),
      })),
      loading: false,
    });
  }

  await load();

  return {
    cleanup: () => {
      disposed = true;
      [pieTipo, pieEscala, barGbTipo, barTipoArquivo, barVolume].forEach(c => c._cleanup && c._cleanup());
    },
    refresh: load,
  };
}
