import { el, svgIcon, ICONS } from '@utils/dom.js';

/**
 * Estado de ERRO do painel, distinto do estado VAZIO.
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
 * @param {Error} erro
 * @param {Function} aoTentarDeNovo
 * @returns {HTMLElement}
 */
export function estadoErro(erro, aoTentarDeNovo) {
  const mensagem = (erro && erro.message) || 'Não foi possível carregar.';

  const botao = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => aoTentarDeNovo(),
  }, [svgIcon(ICONS.schedule, 16), 'Tentar de novo']);

  return el('div', { className: 'dashboard-erro', role: 'alert' }, [
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
}

/**
 * Troca o conteúdo de um container pelo estado de erro, guardando o que estava
 * lá para o "tentar de novo" poder devolver.
 *
 * @param {HTMLElement} container
 * @param {Error} erro
 * @param {Function} recarregar
 */
export function mostrarErro(container, erro, recarregar) {
  const anteriores = [...container.childNodes];
  container.replaceChildren(estadoErro(erro, () => {
    container.replaceChildren(...anteriores);
    recarregar();
  }));
}
