/**
 * Operar o COMBO BUSCAVEL num teste, pelo caminho da pessoa.
 *
 * O combo substituiu o `<select>` nativo onde a lista CRESCE com os dados
 * (clientes, metas do PIT, militares, notas de credito). Ele nao e um `<select>`
 * com CSS: e um `<input>` mais uma lista filtrada, entao `select.value = x` nao
 * o alcanca.
 *
 * ESTES HELPERS PASSAM PELO MESMO CAMINHO DA PESSOA (focar, digitar, clicar), e
 * nao por uma API interna do componente. E o que faz o teste reprovar se o combo
 * parar de filtrar ou de confirmar a escolha, em vez de continuar verde medindo
 * um estado que a tela nao mostra.
 */

/** Os combos de um container, na ordem em que aparecem. */
export const combos = (container) => [...container.querySelectorAll('.combo')];

/** Abre a lista de um combo sem digitar nada: mostra tudo o que ele oferece. */
export function abrirCombo(combo) {
  const campo = combo.querySelector('.combo__campo');
  campo.dispatchEvent(new Event('focus'));
  campo.dispatchEvent(new Event('input', { bubbles: true }));
  return campo;
}

/** Os rotulos que o combo oferece agora. */
export const opcoesDoCombo = (combo) => {
  abrirCombo(combo);
  return [...combo.querySelectorAll('.combo__item')].map((i) => i.textContent);
};

/**
 * Escolhe no combo o primeiro item que casa `termo`.
 *
 * `mousedown`, e nao `click`: e nele que o item confirma, porque o `blur` do
 * campo dispara ANTES do clique e fecharia a lista.
 *
 * @param {HTMLElement} combo o no `.combo`
 * @param {string} termo o que a pessoa digitaria
 */
export function escolherNoCombo(combo, termo) {
  const campo = combo.querySelector('.combo__campo');
  campo.dispatchEvent(new Event('focus'));
  campo.value = String(termo);
  campo.dispatchEvent(new Event('input', { bubbles: true }));

  const item = combo.querySelector('.combo__item');
  if (!item) {
    throw new Error(`Nenhuma opção do combo casa "${termo}". Oferecidas: `
      + `${[...combo.querySelectorAll('.combo__item')].map((i) => i.textContent).join(' | ')}`);
  }
  item.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }));
  return item;
}
