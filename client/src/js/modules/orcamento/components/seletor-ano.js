import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createNumberField } from '@components/form-fields/form-fields.js';
import { getAnos } from '../services/orcamento-service.js';
import { getAno, setAno, onAnoChange } from '../store/year-store.js';

// Valor sentinela da opcao "adicionar ano" no seletor.
const ADD_ANO = '__add__';

/**
 * Seletor de ano do modulo orcamento, montado na navbar via `navbarExtras`.
 * Lista os anos com dado e o ano de contexto atual; "+ Outro ano…" permite
 * passar a cadastrar num ano ainda sem nenhum lancamento.
 * @returns {{elements: Array<HTMLElement>, cleanup: Function}}
 */
export function criarSeletorAno() {
  let anosCache = [getAno()];

  const yearSelect = el('select', {
    className: 'navbar__year',
    'aria-label': 'Ano de referência',
    title: 'Ano de referência (define o ano em que você cadastra)',
    onChange: (e) => {
      if (e.target.value === ADD_ANO) {
        e.target.value = String(getAno()); // desfaz a selecao do item especial
        abrirAdicionarAno();
        return;
      }
      setAno(e.target.value);
    },
  });

  function renderYearOptions(anos) {
    if (anos) anosCache = anos;
    const atual = getAno();
    const set = new Set((anosCache || []).map(Number));
    set.add(atual);
    const lista = [...set].sort((a, b) => b - a);
    yearSelect.innerHTML = '';
    for (const a of lista) {
      yearSelect.appendChild(el('option', { value: String(a), textContent: String(a) }));
    }
    yearSelect.appendChild(el('option', { value: ADD_ANO, textContent: '+ Outro ano…' }));
    yearSelect.value = String(atual);
  }

  // Abre um dialog para escolher um ano novo e passar a cadastrar nele.
  function abrirAdicionarAno() {
    const anoField = createNumberField({
      label: 'Ano',
      min: 2000,
      max: 2100,
      value: getAno() + 1,
      helpText: 'Passa a cadastrar e exibir os dados deste ano.',
    });
    openModal({
      title: 'Trabalhar em outro ano',
      content: el('div', { className: 'form-grid' }, [anoField.element]),
      width: '420px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Usar este ano',
          variant: 'primary',
          onClick: ({ close }) => {
            const ano = anoField.getValue();
            if (ano === null || ano < 2000 || ano > 2100) {
              anoField.setError('Informe um ano entre 2000 e 2100');
              return;
            }
            setAno(ano);
            close();
          },
        },
      ],
    });
  }

  renderYearOptions([getAno()]);
  getAnos().then(renderYearOptions).catch(() => {});
  // Ao trocar o ano de contexto, re-renderiza (inclui o ano recem-escolhido).
  const offAno = onAnoChange(() => renderYearOptions());

  return {
    elements: [yearSelect],
    cleanup: () => offAno(),
  };
}
