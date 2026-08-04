import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import './filtro-multiplo.css';

/**
 * Filtro de dominio com MARCACAO MULTIPLA, no lugar do `<select>` de escolha
 * unica (chefe, 2026-08-04).
 *
 * O combo antigo respondia uma pergunta por vez. "O que existe em 25k e em 50k"
 * exigia duas buscas e a soma na mao, e nao havia como perguntar por dois tipos
 * de produto de uma vez. Aqui cada opcao e uma caixa de marcacao, e o conjunto
 * marcado vira uma lista so na consulta.
 *
 * Tres decisoes que valem registro:
 *
 * 1. **A marcacao aplica na hora.** Nao ha botao de confirmar. E o mesmo que o
 *    `<select>` fazia a cada troca, e e o que mantem o quantitativo da faceta
 *    coerente com o que esta na tela. As respostas fora de ordem ja eram
 *    tratadas por quem chama.
 * 2. **Aberto, o painel NAO se repinta.** A faceta chega a cada busca, e
 *    refazer a lista sob o cursor moveria a opcao que a pessoa esta prestes a
 *    marcar. A repintura fica guardada e acontece ao fechar.
 * 3. **A opcao MARCADA nunca some.** Cruzando a zero ela fica com "(0)", como
 *    no combo antigo: sumir desfaria em silencio o que a pessoa pediu.
 *
 * @param {Object} opcoes
 * @param {string} opcoes.rotuloTodos - texto do botao sem nada marcado
 * @param {string} opcoes.nomePlural - para "3 escalas" no botao
 * @param {string} opcoes.ariaLabel
 * @param {Array<string|number>} [opcoes.valorInicial]
 * @param {Function} opcoes.onMudar - recebe o array de codigos, como texto
 * @returns {Object}
 */
export function criarFiltroMultiplo({
  rotuloTodos,
  nomePlural,
  ariaLabel,
  valorInicial = [],
  onMudar,
}) {
  /** Codigos marcados, como texto, na ordem em que a pessoa marcou. */
  let marcados = [...new Set(valorInicial.map(String))].filter(v => v !== '');
  /** Opcoes visiveis hoje: [{code, nome, total}]. */
  let opcoesAtuais = [];
  /** code -> nome, inclusive de opcao que ja saiu da lista. */
  const rotulos = new Map();
  let textoTodos = rotuloTodos;
  let aberto = false;
  /** Repintura que chegou com o painel aberto, para aplicar ao fechar. */
  let pendente = null;

  const lista = el('div', { className: 'filtro-multiplo__lista', role: 'group' });

  const limparBtn = el('button', {
    className: 'filtro-multiplo__limpar',
    type: 'button',
    onClick: () => {
      if (!marcados.length) return;
      marcados = [];
      pintarLista();
      pintarBotao();
      onMudar(valores());
    },
  }, ['Limpar']);

  const cabecalho = el('div', { className: 'filtro-multiplo__cabecalho' }, [
    el('span', { className: 'filtro-multiplo__titulo', textContent: ariaLabel }),
    limparBtn,
  ]);

  const vazio = el('p', {
    className: 'filtro-multiplo__vazio hidden',
    textContent: 'Nenhuma opção para este recorte.',
  });

  const painel = el('div', { className: 'filtro-multiplo__painel hidden' }, [
    cabecalho, vazio, lista,
  ]);

  const texto = el('span', { className: 'filtro-multiplo__texto', textContent: rotuloTodos });
  const seta = el('span', { className: 'filtro-multiplo__seta' }, [svgIcon(ICONS.expandMore, 16)]);

  const botao = el('button', {
    className: 'filtro-multiplo__botao',
    type: 'button',
    'aria-label': ariaLabel,
    'aria-haspopup': 'true',
    'aria-expanded': 'false',
    onClick: () => (aberto ? fechar() : abrir()),
    onKeyDown: (e) => {
      if (e.key === 'ArrowDown' && !aberto) {
        e.preventDefault();
        abrir();
      }
    },
  }, [texto, seta]);

  const element = el('div', { className: 'filtro-multiplo' }, [botao, painel]);

  // Clique FORA fecha. Registrado no documento e retirado no `_cleanup`, senao
  // a tela seguinte herdaria o ouvinte de uma tela que ja morreu.
  function aoClicarFora(e) {
    if (!aberto) return;
    if (!element.contains(e.target)) fechar();
  }

  function aoTeclarNoDocumento(e) {
    if (!aberto) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      fechar();
      botao.focus();
    }
  }

  document.addEventListener('mousedown', aoClicarFora);
  document.addEventListener('keydown', aoTeclarNoDocumento);

  function abrir() {
    aberto = true;
    painel.classList.remove('hidden');
    botao.setAttribute('aria-expanded', 'true');
    const primeira = lista.querySelector('input[type="checkbox"]');
    if (primeira) primeira.focus();
  }

  function fechar() {
    if (!aberto) return;
    aberto = false;
    painel.classList.add('hidden');
    botao.setAttribute('aria-expanded', 'false');
    // A faceta que chegou enquanto o painel estava aberto entra agora.
    if (pendente) {
      const p = pendente;
      pendente = null;
      preencher(p.itens, p.rotuloTodos, p.contagem, p.desejado);
    }
  }

  function valores() {
    return [...marcados];
  }

  function pintarBotao() {
    if (!marcados.length) {
      texto.textContent = textoTodos;
    } else if (marcados.length === 1) {
      texto.textContent = rotulos.get(marcados[0]) || marcados[0];
    } else {
      texto.textContent = `${marcados.length} ${nomePlural}`;
    }
    element.classList.toggle('filtro-multiplo--ativo', marcados.length > 0);
    limparBtn.disabled = marcados.length === 0;
    botao.title = marcados.length > 1
      ? marcados.map(c => rotulos.get(c) || c).join(', ')
      : '';
  }

  function alternar(codigo, ligado) {
    if (ligado) {
      if (!marcados.includes(codigo)) marcados.push(codigo);
    } else {
      marcados = marcados.filter(c => c !== codigo);
    }
    pintarBotao();
    onMudar(valores());
  }

  function pintarLista() {
    lista.replaceChildren(...opcoesAtuais.map((o) => {
      const codigo = String(o.code);
      const caixa = el('input', {
        className: 'form-field__checkbox',
        type: 'checkbox',
        value: codigo,
        onChange: (e) => alternar(codigo, e.target.checked),
      });
      // `checked` vai como PROPRIEDADE, e nunca dentro do el(): o helper faz
      // setAttribute, e `checked="false"` MARCA a caixa do mesmo jeito. E a
      // mesma armadilha que o repo ja registrou para o `disabled`.
      caixa.checked = marcados.includes(codigo);
      return el('label', { className: 'filtro-multiplo__opcao' }, [
        caixa,
        el('span', { className: 'filtro-multiplo__nome', textContent: o.nome }),
        o.total === null || o.total === undefined
          ? el('span')
          : el('span', {
            className: 'filtro-multiplo__total',
            textContent: formatNumber(o.total),
          }),
      ]);
    }));
    vazio.classList.toggle('hidden', opcoesAtuais.length > 0);
  }

  /**
   * Troca as opcoes, com o quantitativo cruzado de cada uma.
   *
   * Mesma assinatura e mesmas regras do `preencherSelect` que ela substitui,
   * para a migracao das telas ser troca de linha e nao reescrita:
   *
   * - opcao com zero SAI da lista, que e o que "filtrar as demais" significa;
   * - opcao MARCADA fica, com "(0)", mesmo cruzando a zero;
   * - marcacao que sumiu ate do dominio (o subtipo, quando o tipo muda) e
   *   descartada, e quem chama decide isso pelo `desejado`.
   *
   * @param {Array<{code:number|string, nome:string}>} itens
   * @param {string} [novoRotuloTodos] - muda o texto de "nada marcado"
   * @param {Map<string, number>|null} [contagem] - null antes da 1a resposta
   * @param {Array<string>|null} [desejado] - marcacao a manter, no lugar da atual
   */
  function preencher(itens, novoRotuloTodos = null, contagem = null, desejado = null) {
    // Aberto, guarda para aplicar ao fechar: repintar sob o cursor moveria a
    // opcao que a pessoa esta prestes a marcar.
    if (aberto) {
      pendente = { itens, rotuloTodos: novoRotuloTodos, contagem, desejado };
      return;
    }

    if (novoRotuloTodos !== null) textoTodos = novoRotuloTodos;
    if (desejado !== null) marcados = [...new Set(desejado.map(String))].filter(v => v !== '');

    for (const i of itens) rotulos.set(String(i.code), i.nome);

    opcoesAtuais = [];
    for (const i of itens) {
      const codigo = String(i.code);
      const total = contagem ? (contagem.get(codigo) || 0) : null;
      if (contagem && total === 0 && !marcados.includes(codigo)) continue;
      opcoesAtuais.push({ code: codigo, nome: i.nome, total });
    }

    // Marcacao que sumiu da lista de dominio, e nao so do cruzamento. O rotulo
    // guardado e a unica forma de ela continuar legivel.
    for (const codigo of marcados) {
      if (opcoesAtuais.some(o => o.code === codigo)) continue;
      opcoesAtuais.push({ code: codigo, nome: rotulos.get(codigo) || codigo, total: 0 });
    }

    pintarLista();
    pintarBotao();
  }

  pintarBotao();

  return {
    element,
    botao,
    painel,
    valores,
    preencher,
    /** Desmarca tudo SEM disparar `onMudar`: quem limpa a tela busca uma vez só. */
    limpar: () => {
      marcados = [];
      pintarLista();
      pintarBotao();
    },
    /** Marca sem disparar `onMudar`, para a carga inicial e o link colado. */
    definir: (codigos) => {
      marcados = [...new Set((codigos || []).map(String))].filter(v => v !== '');
      pintarLista();
      pintarBotao();
    },
    definirVisivel: (visivel) => {
      element.classList.toggle('hidden', !visivel);
    },
    _cleanup: () => {
      document.removeEventListener('mousedown', aoClicarFora);
      document.removeEventListener('keydown', aoTeclarNoDocumento);
    },
  };
}
