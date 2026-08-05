import { el, svgIcon, ICONS } from '@utils/dom.js';
import { apiDownload } from '@services/api-client.js';
import { showSuccess, showError, showInfo } from '@utils/toast.js';
import './export-bar.css';

/**
 * Barra de botoes de exportacao. Cada botao baixa um arquivo gerado pelo
 * servidor (CSV, GeoJSON, ZIP) pelo `apiDownload`, que ja manda o Bearer token.
 *
 * O componente e generico: a lista de exportacoes vem do modulo que o usa.
 *
 * @param {Object} options
 * @param {Array<{label:string, title?:string, endpoint:string, filename:string}>} options.items
 *        - endpoint: caminho da API SEM o prefixo '/api' (ex.: '/acervo/situacao-geral')
 *        - filename: nome de queda quando o servidor nao manda Content-Disposition
 * @param {string} [options.ariaLabel]
 * @returns {HTMLElement}
 */
export function createExportBar({ items = [], ariaLabel = 'Exportações' }) {
  const buttons = items.map((cfg) => {
    const labelSpan = el('span', { textContent: cfg.label });

    const btn = el('button', {
      className: 'export-bar__btn',
      type: 'button',
      title: cfg.title || cfg.label,
      onClick: async () => {
        if (btn.disabled) return;
        btn.disabled = true;
        const original = labelSpan.textContent;
        labelSpan.textContent = 'Exportando...';
        // O botao desabilitado perde o foco do teclado, e sem isto a pessoa nao
        // sabe que a exportacao esta correndo.
        btn.setAttribute('aria-busy', 'true');
        showInfo('Gerando a exportação...');
        try {
          await apiDownload(cfg.endpoint, cfg.filename);
          showSuccess('Exportação concluída');
        } catch (err) {
          showError(err.message || 'Falha na exportação');
        } finally {
          labelSpan.textContent = original;
          btn.removeAttribute('aria-busy');
          btn.disabled = false;
        }
      },
    }, [svgIcon(ICONS.download, 18), labelSpan]);

    return btn;
  });

  // `role="group"` junto do `aria-label`: num `<div>` sem papel nenhum, o
  // `aria-label` e IGNORADO, e a barra chegava ao leitor de tela como uma fila
  // de botoes soltos, sem dizer do que eram.
  return el('div', { className: 'export-bar', role: 'group', 'aria-label': ariaLabel }, buttons);
}
