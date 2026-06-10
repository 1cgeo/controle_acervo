import { el } from '@utils/dom.js';

/**
 * Form field builders. Every builder returns:
 *   {
 *     element,           // HTMLElement to append to the form
 *     input,             // the raw input/select/textarea element
 *     getValue(),        // typed value (see each builder)
 *     setValue(value),
 *     setError(message)  // string shows the error; null/'' clears it
 *   }
 */

let fieldIdCounter = 0;

function nextFieldId() {
  fieldIdCounter += 1;
  return `ff-${fieldIdCounter}`;
}

function buildField({ label, required = false, helpText = null }, inputEl) {
  const id = inputEl.id || nextFieldId();
  inputEl.id = id;

  const errorEl = el('div', { className: 'form-field__error hidden' });

  const labelEl = label
    ? el('label', { className: 'form-field__label', for: id }, [
        label,
        required ? el('span', { className: 'form-field__required', textContent: '*' }) : null,
      ])
    : null;

  const children = [labelEl, inputEl];
  if (helpText) {
    children.push(el('div', { className: 'form-field__help', textContent: helpText }));
  }
  children.push(errorEl);

  const element = el('div', { className: 'form-field' }, children);

  function setError(message) {
    if (message) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
      element.classList.add('form-field--error');
    } else {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
      element.classList.remove('form-field--error');
    }
  }

  return { element, errorEl, setError };
}

/**
 * Text input. getValue() returns the trimmed string ('' when empty).
 * @param {{label?:string, value?:string, placeholder?:string, required?:boolean,
 *   type?:string, maxLength?:number, disabled?:boolean, helpText?:string,
 *   onInput?:(value:string)=>void}} options
 */
export function createTextField({
  label,
  value = '',
  placeholder = '',
  required = false,
  type = 'text',
  maxLength,
  disabled = false,
  helpText,
  onInput,
} = {}) {
  const input = el('input', {
    className: 'form-field__input',
    type,
    placeholder,
    value,
  });
  if (maxLength) input.maxLength = maxLength;
  input.disabled = disabled;
  if (onInput) input.addEventListener('input', () => onInput(input.value));

  const { element, setError } = buildField({ label, required, helpText }, input);

  return {
    element,
    input,
    getValue: () => input.value.trim(),
    setValue: (v) => { input.value = v ?? ''; },
    setError,
  };
}

/**
 * Number input. getValue() returns a Number or null when empty/invalid.
 * @param {{label?:string, value?:number, min?:number, max?:number, step?:number|string,
 *   required?:boolean, placeholder?:string, helpText?:string}} options
 */
export function createNumberField({
  label,
  value,
  min,
  max,
  step,
  required = false,
  placeholder = '',
  helpText,
} = {}) {
  const input = el('input', {
    className: 'form-field__input',
    type: 'number',
    placeholder,
  });
  if (min !== undefined) input.min = String(min);
  if (max !== undefined) input.max = String(max);
  if (step !== undefined) input.step = String(step);
  if (value !== undefined && value !== null) input.value = String(value);

  const { element, setError } = buildField({ label, required, helpText }, input);

  return {
    element,
    input,
    getValue: () => {
      if (input.value === '') return null;
      const parsed = Number(input.value);
      return isNaN(parsed) ? null : parsed;
    },
    setValue: (v) => { input.value = (v === null || v === undefined) ? '' : String(v); },
    setError,
  };
}

/**
 * Date input. getValue() returns 'YYYY-MM-DD' (ISO, ready for the API) or null.
 * @param {{label?:string, value?:string, required?:boolean, min?:string, max?:string, helpText?:string}} options
 */
export function createDateField({
  label,
  value = '',
  required = false,
  min,
  max,
  helpText,
} = {}) {
  const input = el('input', {
    className: 'form-field__input',
    type: 'date',
    value,
  });
  if (min) input.min = min;
  if (max) input.max = max;

  const { element, setError } = buildField({ label, required, helpText }, input);

  return {
    element,
    input,
    getValue: () => input.value || null,
    setValue: (v) => { input.value = v ? String(v).slice(0, 10) : ''; },
    setError,
  };
}

/**
 * Select. Option values keep their original type: getValue() returns the
 * `value` of the selected option as provided in `options` (or null when none).
 * @param {{label?:string, options:Array<{value:any, label:string}>, value?:any,
 *   required?:boolean, placeholder?:string, helpText?:string, onChange?:(value:any)=>void}} config
 */
export function createSelectField({
  label,
  options = [],
  value,
  required = false,
  placeholder = 'Selecione...',
  helpText,
  onChange,
} = {}) {
  let currentOptions = options;

  const select = el('select', { className: 'form-field__select' });

  function renderOptions() {
    select.innerHTML = '';
    select.appendChild(el('option', { value: '', textContent: placeholder }));
    for (const opt of currentOptions) {
      select.appendChild(el('option', { value: String(opt.value), textContent: opt.label }));
    }
  }

  renderOptions();
  if (value !== undefined && value !== null) select.value = String(value);

  function resolveValue() {
    if (select.value === '') return null;
    const found = currentOptions.find(opt => String(opt.value) === select.value);
    return found ? found.value : select.value;
  }

  if (onChange) select.addEventListener('change', () => onChange(resolveValue()));

  const { element, setError } = buildField({ label, required, helpText }, select);

  return {
    element,
    input: select,
    getValue: resolveValue,
    setValue: (v) => { select.value = (v === null || v === undefined) ? '' : String(v); },
    /** Replace the option list (keeps the current selection when possible). */
    setOptions: (newOptions) => {
      const previous = select.value;
      currentOptions = newOptions;
      renderOptions();
      select.value = previous;
      if (select.value !== previous) select.value = '';
    },
    setError,
  };
}

/**
 * Textarea. getValue() returns the trimmed string ('' when empty).
 * @param {{label?:string, value?:string, rows?:number, required?:boolean,
 *   placeholder?:string, helpText?:string}} options
 */
export function createTextareaField({
  label,
  value = '',
  rows = 3,
  required = false,
  placeholder = '',
  helpText,
} = {}) {
  const textarea = el('textarea', {
    className: 'form-field__textarea',
    rows: String(rows),
    placeholder,
  });
  textarea.value = value;

  const { element, setError } = buildField({ label, required, helpText }, textarea);

  return {
    element,
    input: textarea,
    getValue: () => textarea.value.trim(),
    setValue: (v) => { textarea.value = v ?? ''; },
    setError,
  };
}

/**
 * Checkbox. getValue() returns a boolean.
 * @param {{label:string, checked?:boolean, helpText?:string, onChange?:(checked:boolean)=>void}} options
 */
export function createCheckboxField({
  label,
  checked = false,
  helpText,
  onChange,
} = {}) {
  const id = nextFieldId();
  const input = el('input', {
    className: 'form-field__checkbox',
    type: 'checkbox',
    id,
  });
  input.checked = checked;
  if (onChange) input.addEventListener('change', () => onChange(input.checked));

  const errorEl = el('div', { className: 'form-field__error hidden' });

  const element = el('div', { className: 'form-field form-field--checkbox' }, [
    input,
    el('label', { className: 'form-field__label', for: id, textContent: label }),
    helpText ? el('div', { className: 'form-field__help', textContent: helpText }) : null,
    errorEl,
  ]);

  function setError(message) {
    if (message) {
      errorEl.textContent = message;
      errorEl.classList.remove('hidden');
      element.classList.add('form-field--error');
    } else {
      errorEl.textContent = '';
      errorEl.classList.add('hidden');
      element.classList.remove('form-field--error');
    }
  }

  return {
    element,
    input,
    getValue: () => input.checked,
    setValue: (v) => { input.checked = Boolean(v); },
    setError,
  };
}

/**
 * Chip input for string arrays (e.g. palavras-chave).
 * Enter or comma commits a chip; Backspace on the empty field removes the last.
 * getValue() returns string[].
 * @param {{label?:string, values?:string[], placeholder?:string, required?:boolean, helpText?:string}} options
 */
export function createChipInput({
  label,
  values = [],
  placeholder = 'Digite e pressione Enter',
  required = false,
  helpText,
} = {}) {
  let chips = [...values];

  const input = el('input', {
    className: 'chip-input__field',
    type: 'text',
    placeholder,
  });

  const container = el('div', {
    className: 'chip-input',
    onClick: () => input.focus(),
  });

  function renderChips() {
    container.innerHTML = '';
    for (let i = 0; i < chips.length; i++) {
      const idx = i;
      container.appendChild(el('span', { className: 'chip-input__chip' }, [
        chips[i],
        el('button', {
          className: 'chip-input__remove',
          type: 'button',
          'aria-label': `Remover ${chips[i]}`,
          textContent: '×',
          onClick: (e) => {
            e.stopPropagation();
            chips.splice(idx, 1);
            renderChips();
          },
        }),
      ]));
    }
    container.appendChild(input);
  }

  function commit() {
    const text = input.value.trim().replace(/,+$/, '').trim();
    if (text && !chips.includes(text)) {
      chips.push(text);
      renderChips();
    }
    input.value = '';
    input.focus();
  }

  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter' || e.key === ',') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Backspace' && input.value === '' && chips.length) {
      chips.pop();
      renderChips();
      input.focus();
    }
  });

  input.addEventListener('blur', () => {
    if (input.value.trim()) commit();
  });

  renderChips();

  const { element, setError } = buildField({ label, required, helpText }, container);

  return {
    element,
    input,
    getValue: () => [...chips],
    setValue: (newValues) => {
      chips = Array.isArray(newValues) ? [...newValues] : [];
      renderChips();
    },
    setError,
  };
}
