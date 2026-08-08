/**
 * Codigos do dominio `mapoteca.situacao_pedido`.
 *
 * COPIADOS DO DDL (er/mapoteca.sql, o INSERT da tabela), e nao deduzidos do
 * nome do campo. Codigo de dominio errado nao produz erro: produz tela que
 * mente, filtrando o pedido errado com a cara de estar certa.
 *
 * O DDL, desde a poda de 2026-08-08:
 *   2 Pedido Recebido
 *   3 Em andamento
 *   4 Remetido
 *   5 Concluido
 *   6 Cancelado
 *   7 Aguardando producao
 *
 * A CONTAGEM COMECA NO 2, E O BURACO E DELIBERADO. O code 1 era 'Pre
 * cadastramento do pedido realizado', a situacao mais oferecida pelo formulario
 * e usada por ZERO dos 166 pedidos: ela prometia um estagio ("alguem avisou que
 * vem um pedido") que a mapoteca nunca trabalhou, porque o pedido nasce ja
 * recebido. Renumerar as outras seis para fechar a lacuna reescreveria a
 * situacao de todo pedido gravado, e code de dominio e exatamente o que nao se
 * renumera: ele ja esta em `auditoria.evento` e no historico de cada pedido que
 * mudou de situacao.
 *
 * O 2 TROCOU DE ROTULO E NAO DE CODE, na mesma poda: 'DIEx/Oficio do pedido
 * recebido' virou 'Pedido Recebido'. O estagio existe, so estava nomeado pelo
 * DOCUMENTO em vez do fato, e o pedido de civil chega por e-mail, sem DIEx
 * nenhum. Quem escreve o rotulo na tela e sempre o servidor
 * (`situacao_pedido_nome`), e nunca esta lista, que so guarda os codigos.
 *
 * O servidor tem a MESMA tabela em server/src/utils/domain_constants.js
 * (SITUACAO_PEDIDO). As duas copias existem porque client e servidor nao
 * compartilham modulo; o DDL e a fonte das duas.
 */
export const SITUACAO_PEDIDO = {
  PEDIDO_RECEBIDO: 2,
  EM_ANDAMENTO: 3,
  REMETIDO: 4,
  CONCLUIDO: 5,
  CANCELADO: 6,
  AGUARDANDO_PRODUCAO: 7,
};

/**
 * As situacoes que a FILA de atendimento mostra.
 *
 * Espelha `SITUACOES_FILA_IMPRESSAO` de server/src/mapoteca/query_fragments.js,
 * que e quem monta a resposta de GET /mapoteca/pedido/em_aberto. A copia serve
 * para a tela saber o que a fila NAO mostra, e avisar sobre isso.
 */
export const SITUACOES_DA_FILA = [
  SITUACAO_PEDIDO.PEDIDO_RECEBIDO,
  SITUACAO_PEDIDO.EM_ANDAMENTO,
];

/** Verdadeiro quando o pedido esta Remetido, o que o tira da fila. */
export const estaRemetido = (pedido) =>
  Number(pedido.situacao_pedido_id) === SITUACAO_PEDIDO.REMETIDO;
