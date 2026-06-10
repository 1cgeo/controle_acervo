import { el, svgIcon, ICONS } from '@utils/dom.js';

/**
 * Horizontal wizard stepper (numbered circles + labels + connectors).
 * Navigation is programmatic via setActive(); optionally completed steps can
 * be clicked when onStepClick is provided.
 *
 * @param {Object} options
 * @param {string[]} options.steps - step labels, e.g. ['Básico', 'Adicional', 'Produtos', 'Confirmação']
 * @param {number} [options.active] - initial active index (0-based)
 * @param {(index:number)=>void} [options.onStepClick] - called when a completed step is clicked
 * @returns {{element:HTMLElement, setActive:(index:number)=>void, getActive:()=>number}}
 */
export function createWizardStepper({ steps, active = 0, onStepClick = null }) {
  let activeIndex = active;

  const stepEls = steps.map((label, index) => {
    const circle = el('span', { className: 'wizard-stepper__circle' });
    const labelEl = el('span', { className: 'wizard-stepper__label', textContent: label });

    return el('button', {
      className: 'wizard-stepper__step',
      type: 'button',
      'aria-label': `Etapa ${index + 1}: ${label}`,
      onClick: () => {
        if (onStepClick && index < activeIndex) {
          onStepClick(index);
        }
      },
    }, [circle, labelEl]);
  });

  const element = el('div', { className: 'wizard-stepper', role: 'group', 'aria-label': 'Etapas' }, stepEls);

  function render() {
    stepEls.forEach((stepEl, index) => {
      const circle = stepEl.querySelector('.wizard-stepper__circle');
      circle.innerHTML = '';

      stepEl.classList.toggle('wizard-stepper__step--active', index === activeIndex);
      stepEl.classList.toggle('wizard-stepper__step--completed', index < activeIndex);
      stepEl.classList.toggle('wizard-stepper__step--clickable', Boolean(onStepClick) && index < activeIndex);
      stepEl.setAttribute('aria-current', index === activeIndex ? 'step' : 'false');

      if (index < activeIndex) {
        circle.appendChild(svgIcon(ICONS.check, 18));
      } else {
        circle.textContent = String(index + 1);
      }
    });
  }

  /**
   * Set the active step (0-based). Steps before it are marked completed.
   * @param {number} index
   */
  function setActive(index) {
    activeIndex = Math.max(0, Math.min(index, steps.length - 1));
    render();
  }

  /** @returns {number} - the active step index (0-based) */
  function getActive() {
    return activeIndex;
  }

  render();

  return { element, setActive, getActive };
}
