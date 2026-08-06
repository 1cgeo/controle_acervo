import { el, clearChildren } from '@utils/dom.js';

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
    // <input type="date"> so aceita 'YYYY-MM-DD'. Fatiamos para tolerar um valor
    // que chegue como ISO completo (ex.: '2026-06-15T00:00:00.000Z'); caso
    // contrario o campo ficaria vazio e perderia a data ao salvar.
    value: value ? String(value).slice(0, 10) : '',
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
    // `placeholder: null` DISPENSA a opcao vazia, para o select que sempre tem um
    // valor (o filtro de ano, por exemplo: nao existe "nenhum ano"). String
    // vazia continua criando a opcao, porque e assim que os filtros oferecem o
    // "todos" -- trocar isso mudaria o comportamento de quem ja usa.
    if (placeholder !== null) {
      select.appendChild(el('option', { value: '', textContent: placeholder }));
    }
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

/**
 * COMBO BUSCÁVEL: um `<select>` com campo de busca e lista filtrada.
 *
 * POR QUE ELE EXISTE. O `createSelectField` é um `<select>` nativo, e ele para
 * de servir quando a lista cresce: escolher a nota de crédito ao lançar um
 * empenho é rolar 95 opções sem poder digitar nada. O navegador só casa o
 * PREFIXO do rótulo, e o rótulo aqui começa pelo número da NC, então quem lembra
 * da natureza de despesa e não do número não tem por onde começar.
 *
 * A MESMA API DO `createSelectField`, de propósito: `element`, `input`,
 * `getValue`, `setValue`, `setOptions` e `setError`. Trocar um pelo outro numa
 * tela é trocar o nome da função, e nada mais. Foi isso que permitiu adotá-lo em
 * um lugar por vez, em vez de reescrever 115 campos de uma vez.
 *
 * A BUSCA É POR SUBSTRING, e não por prefixo: é a diferença que faz o campo
 * valer. Ela ignora acento e caixa, então "credito" acha "Crédito".
 *
 * ORDENA POR PADRÃO, com comparação NUMÉRICA: a NC 2 vem antes da 10, e não
 * depois, que é onde a ordenação por texto a colocaria. `ordenar: false` mantém
 * a ordem recebida, para a lista que já tem ordem própria (um fluxo de situação,
 * os meses do ano).
 *
 * @param {{label?:string, options?:Array<{value:*,label:string}>, value?:*,
 *   required?:boolean, placeholder?:string, helpText?:string, ordenar?:boolean,
 *   onChange?:(value:*)=>void}} opcoes
 */
export function createComboBoxField({
  label,
  options = [],
  value,
  required = false,
  placeholder = 'Selecione...',
  helpText,
  ordenar = true,
  onChange,
} = {}) {
  /** Sem acento e em minúscula, para a busca casar "credito" com "Crédito". */
  const normalizar = (texto) => String(texto ?? '')
    .normalize('NFD').replace(/\p{Diacritic}/gu, '').toLowerCase();

  const ordenarOpcoes = (lista) => (ordenar
    ? [...lista].sort((a, b) => String(a.label).localeCompare(String(b.label), 'pt-BR', {
      // `numeric` é o que põe a NC 2 antes da 10. Sem ele a ordem é a do
      // dicionário, e "10" vem antes de "2" porque '1' < '2'.
      numeric: true,
      sensitivity: 'base',
    }))
    : [...lista]);

  let opcoes = ordenarOpcoes(options);
  let selecionado = value === undefined ? null : value;
  let ativo = -1;
  let aberto = false;

  const input = el('input', {
    className: 'form-field__input combo__campo',
    type: 'text',
    role: 'combobox',
    autocomplete: 'off',
    'aria-expanded': 'false',
    'aria-autocomplete': 'list',
    placeholder,
  });

  const lista = el('div', { className: 'combo__lista hidden', role: 'listbox' });
  const caixa = el('div', { className: 'combo' }, [input, lista]);

  const achar = (v) => opcoes.find(o => String(o.value) === String(v)) || null;

  /** O texto do campo quando ele NÃO está sendo editado: o rótulo escolhido. */
  function mostrarSelecionado() {
    const o = achar(selecionado);
    input.value = o ? o.label : '';
  }

  function filtradas() {
    const termo = normalizar(input.value);
    // Campo igual ao rótulo escolhido significa "acabei de abrir", e não "filtre
    // por este texto": mostrar uma opção só ali esconderia as outras 94.
    const o = achar(selecionado);
    if (o && input.value === o.label) return opcoes;
    if (!termo) return opcoes;
    return opcoes.filter(x => normalizar(x.label).includes(termo));
  }

  function desenharLista() {
    const itens = filtradas();
    clearChildren(lista);

    if (!itens.length) {
      lista.appendChild(el('div', {
        className: 'combo__vazio',
        textContent: 'Nada encontrado',
      }));
      return;
    }

    itens.forEach((o, i) => {
      const item = el('div', {
        className: `combo__item${i === ativo ? ' combo__item--ativo' : ''}`
          + (String(o.value) === String(selecionado) ? ' combo__item--escolhido' : ''),
        role: 'option',
        'aria-selected': String(o.value) === String(selecionado) ? 'true' : 'false',
        textContent: o.label,
      });
      // `mousedown`, e não `click`: o `blur` do campo dispara ANTES do clique e
      // fecharia a lista, e o clique cairia no vazio.
      item.addEventListener('mousedown', (e) => {
        e.preventDefault();
        escolher(o.value);
      });
      lista.appendChild(item);
    });
  }

  function abrir() {
    if (aberto) return;
    aberto = true;
    ativo = filtradas().findIndex(o => String(o.value) === String(selecionado));
    lista.classList.remove('hidden');
    input.setAttribute('aria-expanded', 'true');
    desenharLista();
  }

  function fechar() {
    if (!aberto) return;
    aberto = false;
    lista.classList.add('hidden');
    input.setAttribute('aria-expanded', 'false');
    // O campo volta ao rótulo escolhido: texto digitado e não commitado não pode
    // ficar na tela parecendo seleção.
    mostrarSelecionado();
  }

  function escolher(v) {
    const mudou = String(v) !== String(selecionado);
    selecionado = v;
    fechar();
    if (!mudou) return;

    // DISPARA O `change` NATIVO, e não só o callback.
    //
    // A promessa deste componente é ser troca direta do `createSelectField`, e
    // parte das telas não usa a opção `onChange`: elas fazem
    // `campo.input.addEventListener('change', ...)` no `<select>` de fora. O
    // `details.js` do pedido faz isso para reaplicar o modo civil/militar quando
    // o cliente muda, e sem este disparo a troca de cliente deixava o formulário
    // no modo do cliente anterior.
    input.dispatchEvent(new Event('change', { bubbles: true }));
    if (onChange) onChange(selecionado);
  }

  input.addEventListener('focus', abrir);
  input.addEventListener('input', () => {
    if (!aberto) abrir();
    ativo = 0;
    desenharLista();
  });

  input.addEventListener('keydown', (e) => {
    const itens = filtradas();
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault();
      if (!aberto) { abrir(); return; }
      if (!itens.length) return;
      const passo = e.key === 'ArrowDown' ? 1 : -1;
      ativo = (ativo + passo + itens.length) % itens.length;
      desenharLista();
      lista.querySelector('.combo__item--ativo')?.scrollIntoView({ block: 'nearest' });
      return;
    }
    if (e.key === 'Enter') {
      if (!aberto) return;
      e.preventDefault();
      if (itens[ativo]) escolher(itens[ativo].value);
      return;
    }
    if (e.key === 'Escape') {
      if (!aberto) return;
      e.preventDefault();
      fechar();
    }
  });

  input.addEventListener('blur', () => {
    // Sai do campo sem escolher: volta ao que estava. Aceitar o texto digitado
    // gravaria uma opção que a pessoa não confirmou.
    setTimeout(fechar, 0);
  });

  mostrarSelecionado();

  const { element, setError } = buildField({ label, required, helpText }, caixa);

  return {
    element,
    input,
    getValue: () => (selecionado === '' || selecionado === undefined ? null : selecionado),
    setValue: (v) => {
      selecionado = (v === null || v === undefined) ? null : v;
      mostrarSelecionado();
    },
    /** Troca a lista, mantendo a escolha quando ela sobrevive. */
    setOptions: (novas) => {
      opcoes = ordenarOpcoes(novas);
      if (selecionado !== null && !achar(selecionado)) selecionado = null;
      mostrarSelecionado();
      if (aberto) desenharLista();
    },
    setError,
  };
}
