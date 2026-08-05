import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createNumberField, createSelectField } from '@components/form-fields/form-fields.js';
import { showError } from '@utils/toast.js';

// Valor sentinela da opcao "trabalhar em outro ano".
const OUTRO_ANO = '__outro__';

/**
 * Filtro de ano DA TELA, montado na barra de filtros junto com os demais.
 *
 * O ano e DA TELA, e nunca do modulo: cada tela tem o seu, comeca sempre no ANO
 * ATUAL e nao guarda nada. Um seletor global guardado no localStorage traz tres
 * defeitos: a escolha sobrevive a sessao e reabre num ano antigo sem avisar;
 * olhar o PDR de um ano muda calado a lista de notas de credito; e a tela de
 * PLATAFORMA passa a depender do store de um MODULO.
 *
 * @param {Object} opts
 * @param {() => Promise<Array<number>>} [opts.carregarAnos] - anos com dado
 * @param {boolean} [opts.permitirOutroAno=false] - oferece ano fora da lista.
 *   Verdadeiro no orcamento, onde o ano decide ONDE se cadastra: comecar um
 *   exercicio novo passa por escolher um ano ainda vazio. Falso na mapoteca e
 *   nas metas, onde o ano so filtra o que ja aconteceu, e um ano vazio seria
 *   oferecer uma tela em branco.
 * @param {(ano:number) => void} opts.onChange - chamado a cada troca
 * @param {string} [opts.label='Ano']
 * @returns {{element:HTMLElement, getAno:Function, setAno:Function}}
 */
export function criarFiltroAno({
  carregarAnos,
  permitirOutroAno = false,
  onChange,
  label = 'Ano',
} = {}) {
  let ano = new Date().getFullYear();
  let anosCache = [ano];

  const campo = createSelectField({
    label,
    options: [{ value: ano, label: String(ano) }],
    value: ano,
    placeholder: null,
    onChange: (valor) => {
      if (valor === OUTRO_ANO) {
        campo.setValue(ano); // desfaz a selecao do item especial
        abrirOutroAno();
        return;
      }
      trocar(Number(valor));
    },
  });

  function trocar(novo) {
    if (!Number.isInteger(novo) || novo === ano) return;
    ano = novo;
    renderOpcoes();
    if (onChange) onChange(ano);
  }

  function renderOpcoes(anos) {
    if (anos) anosCache = anos;
    // O ano escolhido entra sempre, mesmo sem dado nenhum: senao o seletor
    // mostraria um ano diferente do que a tela esta exibindo.
    const set = new Set((anosCache || []).map(Number).filter(Number.isInteger));
    set.add(ano);
    const opcoes = [...set]
      .sort((a, b) => b - a)
      .map((a) => ({ value: a, label: String(a) }));
    if (permitirOutroAno) {
      opcoes.push({ value: OUTRO_ANO, label: '+ Outro ano…' });
    }
    campo.setOptions(opcoes);
    campo.setValue(ano);
  }

  function abrirOutroAno() {
    const anoField = createNumberField({
      label: 'Ano',
      min: 2000,
      max: 2100,
      value: ano + 1,
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
            const escolhido = anoField.getValue();
            if (escolhido === null || escolhido < 2000 || escolhido > 2100) {
              anoField.setError('Informe um ano entre 2000 e 2100');
              return;
            }
            trocar(escolhido);
            close();
          },
        },
      ],
    });
  }

  renderOpcoes([ano]);
  if (typeof carregarAnos === 'function') {
    // A falha AVISA. O catch vazio de antes deixava o seletor com um ano so, e o
    // usuario concluia que nao havia dado de outros anos.
    carregarAnos()
      .then(renderOpcoes)
      .catch((err) => showError(err.message || 'Não foi possível carregar os anos'));
  }

  return {
    element: campo.element,
    getAno: () => ano,
    setAno: trocar,
  };
}
