import { el, svgIcon, ICONS } from '@utils/dom.js';
import { downloadFile } from '@services/api-client.js';
import { showSuccess, showError, showInfo } from '@utils/toast.js';

/**
 * Exportadores do acervo. Cada um baixa um ZIP gerado pelo servidor:
 * - planilha: CSVs no mesmo formato da planilha de referência (um por escala/tipo)
 * - situação geral: GeoJSONs para o site de produtos
 */
const EXPORTS = [
  {
    label: 'Exportar planilha (CSV)',
    title: 'Baixa um ZIP com CSVs no formato da planilha de referência (um por escala e tipo de produto)',
    endpoint: '/acervo/export-planilha-csv',
    filename: 'planilha-acervo.zip',
  },
  {
    label: 'Exportar GeoJSON (site de produtos)',
    title: 'Baixa um ZIP com os GeoJSONs de situação geral, no formato consumido pelo site de produtos',
    endpoint: '/acervo/situacao-geral',
    filename: 'situacao-geral.zip',
  },
];

/**
 * Cria a barra de botões de exportação.
 * @returns {HTMLElement}
 */
export function createExportBar() {
  const buttons = EXPORTS.map((cfg) => {
    const labelSpan = el('span', { textContent: cfg.label });
    const btn = el(
      'button',
      {
        className: 'export-btn',
        type: 'button',
        title: cfg.title,
        onClick: async () => {
          if (btn.disabled) return;
          btn.disabled = true;
          const original = labelSpan.textContent;
          labelSpan.textContent = 'Exportando…';
          showInfo('Gerando exportação…');
          try {
            await downloadFile(cfg.endpoint, cfg.filename);
            showSuccess('Exportação concluída');
          } catch (e) {
            showError(e.message || 'Falha na exportação');
          } finally {
            labelSpan.textContent = original;
            btn.disabled = false;
          }
        },
      },
      [svgIcon(ICONS.download, 18), labelSpan]
    );
    return btn;
  });

  return el('div', { className: 'export-bar' }, buttons);
}
