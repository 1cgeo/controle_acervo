// Espera a tela terminar de pintar.
//
// As páginas do client carregam dado com `await` dentro do render, então o DOM
// só fica completo depois que a fila de microtarefas esvazia. `setTimeout(0)`
// cede o controle uma vez e devolve a execução depois disso.
//
// Estava copiado em 80 arquivos de teste, sempre com o mesmo corpo.

export const flush = () => new Promise(resolve => setTimeout(resolve, 0));
