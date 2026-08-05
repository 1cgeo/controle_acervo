import { el, svgIcon, ICONS } from '@utils/dom.js';

/**
 * Estado de ERRO de um painel, distinto do estado VAZIO.
 *
 * Existe por um defeito de leitura, e não de código: todo bloco do dashboard
 * engolia a falha no `catch` e pintava a lista com zero linhas. A tabela então
 * mostrava "Sem dados disponíveis", que é a frase do acervo vazio. Endpoint fora
 * do ar lia-se como acervo sem conteúdo, e quem olhasse o painel concluiria que
 * não há o que mostrar quando na verdade não se conseguiu perguntar.
 *
 * A diferença importa mais aqui do que em outra tela: este painel é o que o
 * chefe olha para saber o estado do acervo. "Não há" e "não consegui saber" são
 * respostas opostas, e só uma delas pede ação.
 *
 * MORA EM `components/`, e não dentro de um módulo: os painéis dos três têm o
 * mesmo defeito, e o cliente não importa nada entre módulos. O CSS
 * (`.dashboard-erro`, em `css/dashboard.css`) também é comum.
 *
 * @param {Error} erro
 * @param {Function} aoTentarDeNovo
 * @returns {HTMLElement}
 */
/**
 * O que estava no container antes do PRIMEIRO aviso de erro dele.
 *
 * Fica FORA do DOM, pelo mesmo motivo do `reconciliar`: guardar isto num
 * atributo exporia detalhe interno, e quem reescrevesse o atributo quebraria o
 * "tentar de novo" em silêncio. O WeakMap solta o container junto com a página.
 */
const guardadosPorContainer = new WeakMap();

/** Marca o nó de erro, para o `mostrarErro` reconhecer o que ele mesmo pintou. */
const ESTE_E_UM_ESTADO_DE_ERRO = Symbol('estado-erro');

export function estadoErro(erro, aoTentarDeNovo) {
  const mensagem = (erro && erro.message) || 'Não foi possível carregar.';

  const botao = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => aoTentarDeNovo(),
  }, [svgIcon(ICONS.schedule, 16), 'Tentar de novo']);

  const no = el('div', { className: 'dashboard-erro', role: 'alert' }, [
    el('span', { className: 'dashboard-erro__icone' }, [svgIcon(ICONS.warning, 20)]),
    el('div', { className: 'dashboard-erro__texto' }, [
      el('p', { className: 'dashboard-erro__titulo', textContent: 'Não foi possível carregar' }),
      // A mensagem do SERVIDOR, e não uma frase genérica: ela distingue "sem
      // rede" de "sem permissão" de "erro no banco", e é o que decide se a
      // pessoa tenta de novo ou chama alguém.
      el('p', { className: 'dashboard-erro__detalhe', textContent: mensagem }),
    ]),
    botao,
  ]);

  no[ESTE_E_UM_ESTADO_DE_ERRO] = true;
  return no;
}

/**
 * Troca o conteúdo de um container pelo estado de erro, guardando o que estava
 * lá para o "tentar de novo" poder devolver.
 *
 * A SEGUNDA FALHA SEGUIDA NÃO REGUARDA O AVISO. Capturar `childNodes` sem olhar
 * o que eles são fazia o segundo erro guardar o PRÓPRIO aviso como "o que estava
 * aqui": a partir daí "Tentar de novo" trocava uma caixa de erro por outra
 * caixa de erro, e a tabela nunca mais voltava. É um laço que só a recarga da
 * página quebrava, e ele aparece justamente quando o servidor está fora do ar,
 * que é quando a falha se repete.
 *
 * Por isso o container lembra o conteúdo do PRIMEIRO aviso, e só o esquece
 * quando o "tentar de novo" devolve o que estava lá.
 *
 * @param {HTMLElement} container
 * @param {Error} erro
 * @param {Function} recarregar
 */
export function mostrarErro(container, erro, recarregar) {
  const filhos = [...container.childNodes];
  const jaMostraErro = filhos.some(no => no[ESTE_E_UM_ESTADO_DE_ERRO]);

  const anteriores = jaMostraErro && guardadosPorContainer.has(container)
    ? guardadosPorContainer.get(container)
    : filhos;

  guardadosPorContainer.set(container, anteriores);

  container.replaceChildren(estadoErro(erro, () => {
    container.replaceChildren(...anteriores);
    // Devolvido o conteúdo, a memória perde o sentido: a próxima falha tem de
    // capturar o que estiver na tela naquela hora, e não este retrato velho.
    guardadosPorContainer.delete(container);
    recarregar();
  }));
}

/**
 * O mesmo estado de erro, mas dentro do CORPO de um card de gráfico.
 *
 * Serve ao card que divide a linha com outro (a aba de análises tem dois lado a
 * lado) e ao que tem seletor de período no cabeçalho. Trocar o container
 * inteiro apagaria o gráfico vizinho, que talvez tenha carregado bem, e levaria
 * junto o seletor: quem visse o erro perderia o controle que refaz a pergunta
 * com outro período.
 *
 * O `chart-card__body` é seguro de sobrescrever porque o `render()` do gráfico
 * já o esvazia a cada `update()`. A carga seguinte apaga o erro sozinha.
 *
 * @param {HTMLElement} card - o elemento devolvido por createBarChart/createPieChart
 * @param {Error} erro
 * @param {Function} recarregar
 */
export function mostrarErroNoGrafico(card, erro, recarregar) {
  const corpo = card.querySelector('.chart-card__body');
  // Sem corpo não há onde pintar. Some é melhor que quebrar a aba inteira num
  // TypeError, e o card segue mostrando o que já tinha.
  if (!corpo) return;
  mostrarErro(corpo, erro, recarregar);
}
