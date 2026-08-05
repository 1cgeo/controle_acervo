/**
 * Codigos do dominio `mapoteca.situacao_pedido`.
 *
 * COPIADOS DO DDL (er/mapoteca.sql, o INSERT da tabela), e nao deduzidos do
 * nome do campo. Codigo de dominio errado nao produz erro: produz tela que
 * mente, filtrando o pedido errado com a cara de estar certa.
 *
 * O DDL:
 *   1 Pre cadastramento do pedido realizado
 *   2 DIEx/Oficio do pedido recebido
 *   3 Em andamento
 *   4 Remetido
 *   5 Concluido
 *   6 Cancelado
 *   7 Aguardando producao
 *
 * O servidor tem a MESMA tabela em server/src/utils/domain_constants.js
 * (SITUACAO_PEDIDO). As duas copias existem porque client e servidor nao
 * compartilham modulo; o DDL e a fonte das duas.
 */
export const SITUACAO_PEDIDO = {
  PRE_CADASTRAMENTO: 1,
  DOCUMENTO_RECEBIDO: 2,
  EM_ANDAMENTO: 3,
  REMETIDO: 4,
  CONCLUIDO: 5,
  CANCELADO: 6,
  AGUARDANDO_PRODUCAO: 7,
};

/**
 * As situacoes que a FILA de atendimento mostra.
 *
 * Espelha `SITUACOES_EM_ABERTO` de server/src/mapoteca/query_fragments.js, que
 * e quem monta a resposta de GET /mapoteca/pedido/em_aberto. A copia serve para
 * a tela saber o que a fila NAO mostra, e avisar sobre isso.
 */
export const SITUACOES_DA_FILA = [
  SITUACAO_PEDIDO.PRE_CADASTRAMENTO,
  SITUACAO_PEDIDO.DOCUMENTO_RECEBIDO,
  SITUACAO_PEDIDO.EM_ANDAMENTO,
];

/** Verdadeiro quando o pedido esta Remetido, o que o tira da fila. */
export const estaRemetido = (pedido) =>
  Number(pedido.situacao_pedido_id) === SITUACAO_PEDIDO.REMETIDO;
