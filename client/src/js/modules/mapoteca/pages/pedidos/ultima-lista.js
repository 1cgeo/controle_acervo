/**
 * A lista de pedidos como ela estava quando se saiu dela.
 *
 * Guarda a ROTA INTEIRA, com a query que `list.js` espelha na URL (ano,
 * palavra-chave, filtro, busca da tabela, ordem, página e itens por página). O
 * detalhe do pedido volta por aqui, e não pelo '/mapoteca/pedidos' pelado que
 * jogava fora tudo o que a pessoa tinha escolhido antes de abrir o pedido.
 *
 * NÃO É PERSISTÊNCIA. Vive numa variável de módulo, morre no F5 e não vaza para
 * outra aba, pela mesma razão que o filtro de ano não vai para o localStorage
 * (ver @components/filtro-ano.js): escolha guardada além da sessão reabre a tela
 * num recorte antigo sem avisar.
 *
 * `history.back()` faria o mesmo com uma linha, e foi recusado: quem entra no
 * pedido pela fila de atendimento, pelo dashboard, pela ficha do cliente ou pela
 * rastreabilidade voltaria para lá, com o botão escrito "Pedidos".
 */

const ROTA_PELADA = '/mapoteca/pedidos';

let ultima = null;

/**
 * @param {string} rota - ex.: '/mapoteca/pedidos?ano=2026&filtro=civil&pagina=3'
 */
export function guardarListaDePedidos(rota) {
  ultima = typeof rota === 'string' && rota.startsWith(ROTA_PELADA) ? rota : null;
}

/** @returns {string} a última lista, ou a rota pelada para quem nunca passou por ela. */
export function listaDePedidos() {
  return ultima || ROTA_PELADA;
}

/**
 * Devolve o módulo ao estado de quem acabou de abrir a aba.
 *
 * NÃO é só dos testes. Quem a chama de verdade é o wizard, ao GRAVAR um pedido:
 * o recorte de onde a pessoa saiu quase nunca contém o pedido que ela acabou de
 * criar (filtro, palavra-chave, ano e página foram escolhidos antes dele
 * existir), e voltar restaurado mostraria uma lista sem ele.
 */
export function esquecerListaDePedidos() {
  ultima = null;
}
