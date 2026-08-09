import { apiGet } from '@services/api-client.js';

/**
 * Serviço do MICROCONTROLE: a medição do trabalho no QGIS.
 *
 * ARQUIVO PRÓPRIO, e não uma seção do serviço de acompanhamento, porque as rotas
 * daqui têm uma propriedade que nenhuma outra do sistema tem: METADE DELAS PODE
 * RESPONDER 503 SOZINHA. A telemetria vive num banco SEPARADO, opcional, que uma
 * instalação pode nunca ter configurado. Misturá-las com `/api/acompanhamento`
 * faria a próxima tela chamar as duas coisas num `Promise.all` sem saber que uma
 * delas cai por conta própria.
 *
 * SÃO ONZE ROTAS EM DOIS BANCOS, e quem consome precisa saber de qual:
 *
 *   BANCO PRINCIPAL (respondem sempre) - `getTipoMonitoramento` e as quatro do
 *     perfil de monitoramento. Elas dizem O QUE monitorar.
 *   BANCO DA TELEMETRIA (podem responder 503) - `getTipoOperacao`,
 *     `getResumoFeicao`, `getCoberturaTela` e `getAproveitamentoTela`.
 *
 * O 503 NÃO É FALHA DESTA TELA, e a mensagem que vem do servidor já distingue
 * "não configurado" de "fora do ar". Ela sobe para o painel como está: quem
 * consome mostra a mensagem DENTRO da seção, e NUNCA num `Promise.all` com o
 * resto -- uma falha lá derrubaria a tela inteira, e a frase que sobraria seria
 * a da telemetria numa tela que também mostra outras coisas.
 *
 * AS DUAS ROTAS DE ESCRITA (`POST /feicao` e `POST /tela`) NÃO ESTÃO AQUI, e a
 * ausência é a regra: quem grava telemetria é o PLUGIN do QGIS, em nome de quem
 * está com a atividade na mão. O navegador não mede tela de ninguém, e uma
 * função aqui só serviria para alguém inventar um uso.
 *
 * TODAS AS ONZE SÃO `gerente` NO MÓDULO `producao`, menos as duas de escrita,
 * que são `operador`. Aqui isso quer dizer: quem não é gerente leva 403 em tudo
 * o que este arquivo oferece.
 */

/** Monta a query string, omitindo o que não foi filtrado. */
const query = (params) => {
  const busca = new URLSearchParams();
  for (const [chave, valor] of Object.entries(params)) {
    if (valor === null || valor === undefined || valor === '') continue;
    busca.set(chave, String(valor));
  }
  const texto = busca.toString();
  return texto ? `?${texto}` : '';
};

// --- Banco principal: respondem sempre ---------------------------------------

/** Os tipos de monitoramento (1 feição, 2 tela). */
export const getTipoMonitoramento = () => apiGet('/microcontrole/tipo_monitoramento');

/** O perfil: qual subfase de qual lote é monitorada, e como. */
export const getPerfilMonitoramento = () => apiGet(
  '/microcontrole/configuracao/perfil_monitoramento',
);

// --- Banco da telemetria: podem responder 503 --------------------------------

/** Os tipos de operação de feição (1 inserção, 2 exclusão, 3 atributo, 4 geometria). */
export const getTipoOperacao = () => apiGet('/microcontrole/tipo_operacao');

/**
 * O resumo de feição: por operador, por camada e por dia.
 *
 * Sem período, o servidor usa os últimos 30 dias. Sem lote, todos os lotes.
 */
export const getResumoFeicao = ({ loteId, dataInicio, dataFim } = {}) => apiGet(
  `/microcontrole/feicao/resumo${query({
    lote_id: loteId, data_inicio: dataInicio, data_fim: dataFim,
  })}`,
);

/**
 * A cobertura de tela, como GeoJSON FeatureCollection.
 *
 * A RESPOSTA PODE VIR TRUNCADA, e nesse caso ela traz `aviso` preenchido. Quem
 * consome MOSTRA o aviso: uma lista cortada em silêncio se lê como "só
 * trabalharam até aqui".
 */
export const getCoberturaTela = ({ loteId, usuarioUuid, dataInicio, dataFim } = {}) => apiGet(
  `/microcontrole/tela/cobertura${query({
    lote_id: loteId, usuario_uuid: usuarioUuid,
    data_inicio: dataInicio, data_fim: dataFim,
  })}`,
);

/**
 * O aproveitamento diário de tela de UM operador.
 *
 * O `usuarioUuid` é OBRIGATÓRIO no servidor, e não por descuido: somar o tempo
 * de tela de vários operadores num percentual só esconde exatamente a diferença
 * que se foi olhar.
 */
export const getAproveitamentoTela = ({ usuarioUuid, dataInicio, dataFim }) => apiGet(
  `/microcontrole/tela/aproveitamento${query({
    usuario_uuid: usuarioUuid, data_inicio: dataInicio, data_fim: dataFim,
  })}`,
);
