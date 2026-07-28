import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createNumberField } from '@components/form-fields/form-fields.js';

// Valor sentinela da opcao "trabalhar em outro ano".
const OUTRO_ANO = '__outro__';

/**
 * Seletor de ano para a navbar, montado pelo modulo via `navbarExtras`.
 *
 * Um so componente serve o orcamento e a mapoteca porque a diferenca entre os
 * dois e de POLITICA, nao de aparencia:
 *  - no orcamento o ano tambem decide ONDE se cadastra, entao existe a opcao de
 *    passar a trabalhar num ano ainda sem lancamento nenhum (`permitirOutroAno`);
 *  - na mapoteca o ano so FILTRA o que ja aconteceu, e oferecer um ano vazio
 *    seria oferecer uma tela em branco.
 *
 * @param {Object} opts
 * @param {{getAno:Function, setAno:Function, onAnoChange:Function}} opts.store
 * @param {() => Promise<Array<number>>} [opts.carregarAnos] - anos com dado
 * @param {boolean} [opts.permitirOutroAno=false]
 * @param {string} [opts.title] - dica do proprio seletor
 * @returns {{elements: Array<HTMLElement>, cleanup: Function}}
 */
export function criarSeletorAno({
  store,
  carregarAnos,
  permitirOutroAno = false,
  title = 'Ano de referência',
}) {
  const { getAno, setAno, onAnoChange } = store;
  let anosCache = [getAno()];

  const yearSelect = el('select', {
    className: 'navbar__year',
    'aria-label': 'Ano de referência',
    title,
    onChange: (e) => {
      if (e.target.value === OUTRO_ANO) {
        e.target.value = String(getAno()); // desfaz a selecao do item especial
        abrirOutroAno();
        return;
      }
      setAno(e.target.value);
    },
  });

  function renderYearOptions(anos) {
    if (anos) anosCache = anos;
    const atual = getAno();
    // O ano ATUAL entra sempre, mesmo sem dado nenhum: senao o seletor mostraria
    // um ano diferente do que as telas estao exibindo.
    const set = new Set((anosCache || []).map(Number).filter(Number.isInteger));
    set.add(atual);
    const lista = [...set].sort((a, b) => b - a);
    yearSelect.innerHTML = '';
    for (const a of lista) {
      yearSelect.appendChild(el('option', { value: String(a), textContent: String(a) }));
    }
    if (permitirOutroAno) {
      yearSelect.appendChild(el('option', { value: OUTRO_ANO, textContent: '+ Outro ano…' }));
    }
    yearSelect.value = String(atual);
  }

  // Abre um dialog para escolher um ano fora da lista.
  function abrirOutroAno() {
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
  if (typeof carregarAnos === 'function') {
    carregarAnos().then(renderYearOptions).catch(() => {});
  }
  // Ao trocar o ano de contexto, re-renderiza (inclui o ano recem-escolhido).
  const offAno = onAnoChange(() => renderYearOptions());

  return {
    elements: [yearSelect],
    cleanup: () => offAno(),
  };
}
