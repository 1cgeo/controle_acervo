import { el } from '@utils/dom.js';

/**
 * Create a stats card component (dashboard numeric cards).
 * @param {Object} options
 * @param {string} options.title
 * @param {string|number} options.value
 * @param {SVGElement|HTMLElement|string} options.icon - SVG element or emoji
 * @param {'primary'|'warning'|'success'|'info'|'error'} [options.color]
 * @param {boolean} [options.loading]
 * @param {string} [options.suffix]
 * @returns {HTMLElement} - element with .update({ value, loading, suffix })
 */
export function createStatsCard({ title, value, icon, color = 'primary', loading = false, suffix = '' }) {
  const iconWrapper = el('div', {
    className: `stats-card__icon-wrapper stats-card__icon-wrapper--${color}`,
  });
  if (icon instanceof SVGElement || icon instanceof HTMLElement) {
    iconWrapper.appendChild(icon);
  } else {
    iconWrapper.textContent = icon;
  }

  const displayValue = loading ? '' : `${value}${suffix ? ' ' + suffix : ''}`;

  const valueEl = el('div', {
    className: `stats-card__value${loading ? ' skeleton' : ''}`,
    textContent: displayValue,
  });

  const titleEl = el('div', {
    className: `stats-card__title${loading ? ' skeleton' : ''}`,
    textContent: loading ? '' : title,
  });

  const card = el('div', {
    className: `stats-card${loading ? ' stats-card--loading' : ''}`,
  }, [
    iconWrapper,
    el('div', { className: 'stats-card__content' }, [valueEl, titleEl]),
  ]);

  /**
   * Update the card values.
   * @param {{value?:string|number, loading?:boolean, suffix?:string}} options
   */
  card.update = ({ value: newValue, loading: newLoading, suffix: newSuffix = suffix }) => {
    if (newLoading) {
      card.classList.add('stats-card--loading');
      valueEl.classList.add('skeleton');
      titleEl.classList.add('skeleton');
      valueEl.textContent = '';
      titleEl.textContent = '';
    } else {
      card.classList.remove('stats-card--loading');
      valueEl.classList.remove('skeleton');
      titleEl.classList.remove('skeleton');
      valueEl.textContent = `${newValue}${newSuffix ? ' ' + newSuffix : ''}`;
      titleEl.textContent = title;
    }
  };

  return card;
}
