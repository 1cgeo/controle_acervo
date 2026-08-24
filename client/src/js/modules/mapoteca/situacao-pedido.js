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
 *   8 Aguardando envio
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
 * O 8 ENTROU EM 2026-08-24, e nomeia o pedido impresso que ainda nao foi
 * despachado. NAO E O 7: o 7 espera CARTA QUE AINDA NAO EXISTE, e o 8 espera so
 * o despacho do que ja esta pronto. Os dois comecam com 'Aguardando' e sao
 * esperas opostas, uma da producao e outra nossa.
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
  AGUARDANDO_ENVIO: 8,
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

/**
 * Verdadeiro quando o pedido ainda esta na fila de IMPRESSAO.
 *
 * E o teste POSITIVO, e ele SUBSTITUIU um `estaRemetido` negado. A tela de
 * atendimento partia a fila de atendimento por `!estaRemetido`, o que funcionava
 * enquanto Remetido era a unica situacao dela fora da impressao. Com o
 * Aguardando envio (8) na mesma fila, o negativo mandaria para a mesa de quem
 * IMPRIME um pedido que ja esta impresso. O `estaRemetido` saiu junto, em vez de
 * ficar sem uso: o proximo a precisar dele escreveria o mesmo bug.
 */
export const estaNaFilaDeImpressao = (pedido) =>
  SITUACOES_DA_FILA.includes(Number(pedido.situacao_pedido_id));

/**
 * As situacoes que a tela de atendimento mostra ABAIXO da fila: o pedido que ja
 * saiu da impressao e ainda nao fechou.
 *
 * Somadas as de cima, sao as quatro de `SITUACOES_FILA_ATENDIMENTO`
 * (server/src/mapoteca/query_fragments.js), que e o que a rota devolve com
 * `?incluir_remetidos=true`.
 */
export const SITUACOES_DE_FECHAMENTO = [
  SITUACAO_PEDIDO.AGUARDANDO_ENVIO,
  SITUACAO_PEDIDO.REMETIDO,
];

/**
 * Verdadeiro quando o pedido espera despacho ou a marca de Concluido.
 *
 * E LISTA POSITIVA, e nao a negacao de `estaNaFilaDeImpressao`. Com a negacao,
 * qualquer situacao inesperada na resposta (um Concluido, um code novo) cairia
 * nesta seccao como se fosse trabalho pendente. As duas listas cobrem juntas o
 * que a rota promete, e o que nao estiver em nenhuma nao aparece.
 */
export const estaEmFechamento = (pedido) =>
  SITUACOES_DE_FECHAMENTO.includes(Number(pedido.situacao_pedido_id));
