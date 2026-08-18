import { apiGet, apiPost } from '@services/api-client.js';
import { PREFIXO_API } from '@utils/base-path.js';

/**
 * Serviço do módulo PRODUÇÃO: a porta ÚNICA das telas de `#/producao`.
 *
 * Ele nasceu de três arquivos escritos em paralelo (`producao-service.js`,
 * `producao-acompanhamento-service.js` e `acompanhamento-producao-service.js`),
 * fundidos em 2026-08-09. Nenhuma assinatura mudou na fusão: são todas as mesmas
 * chamadas, com os mesmos parâmetros e as mesmas respostas.
 *
 * AS ROTAS DO MÓDULO MORAM EM PREFIXOS DIFERENTES DO NOME DELE, e isso não é
 * desordem: `/api/acompanhamento` responde "como está indo" e é toda de LEITURA,
 * `/api/distribuicao` é a fila do operador e é onde se ESCREVE, e `/api/producao`
 * é o CADASTRO do fluxo. Quem procurar um `/api/producao` para o painel não vai
 * achar.
 *
 * E O PISO DE PERFIL NÃO É O MESMO NOS PREFIXOS. Cada bloco abaixo começa
 * dizendo qual módulo do servidor responde e qual o piso que ele cobra, porque
 * misturar dois pisos numa chamada só é o que faz uma tela inteira morrer com o
 * 403 da chamada que não era a principal. Chamada de outro prefixo, de outra
 * guarda ou opcional carrega SOZINHA, com o próprio `catch`.
 */

// --- `/api/acompanhamento` ---------------------------------------------------
//
// Servidor: `server/src/acompanhamento_producao/`.
// Piso: `verifyPerfil('consulta', 'producao')` em TODAS as funções deste bloco.
//
// TODAS SÃO DE LEITURA, e a ausência de POST, PUT e DELETE aqui não é omissão:
// quem lança produção é `/api/distribuicao`, quem configura é `/api/producao` e
// quem apaga é `/api/perigo`.

// O painel (#/producao). TRÊS CHAMADAS INDEPENDENTES, e a tela as trata assim.
// As duas primeiras são por ANO; a terceira é o retrato de HOJE e não recebe ano
// nenhum, porque "em execução" é um estado do presente e não um acumulado do
// exercício.

/** `[{ lote_id, lote, quantidade }]` — as versões que o PIT do ano prevê. */
export const getQuantidadeAno = (ano) =>
  apiGet(`/acompanhamento/dashboard/quantidade/${ano}`);

/** `[{ lote_id, lote, finalizadas }]` — as versões concluídas dentro do ano. */
export const getFinalizadasAno = (ano) =>
  apiGet(`/acompanhamento/dashboard/finalizadas/${ano}`);

/**
 * `[{ lote_id, lote, em_execucao }]` — os lotes com versão iniciada e ainda não
 * concluída. É AGREGADO, não cadastro.
 *
 * O NOME É `getLotesEmExecucao`, e não `getExecucao`, desde a fusão de
 * 2026-08-09: os dois nomes existiam para esta mesma rota, e o que ficou é o que
 * diz O QUE SE PERGUNTA. "Execução" sozinho é o último pedaço do caminho, e ao
 * lado de `getAtividadesEmExecucao` ele não deixava claro se o que volta é lote
 * ou atividade — que é justamente a única coisa que se precisa saber para usar a
 * resposta.
 *
 * O CAMPO É `em_execucao`, e não `count`: o SAP 2.3.5 chamava a coluna de
 * `count`, e o SCA a renomeou. Quem copiar o nome antigo lê `undefined` sem erro
 * nenhum, e a tela mostra zero onde há trabalho em curso.
 */
export const getLotesEmExecucao = () => apiGet('/acompanhamento/dashboard/execucao');

// As atividades (#/producao/atividades).

/** As que estão abertas agora, da mais antiga para a mais nova. */
export const getAtividadesEmExecucao = () =>
  apiGet('/acompanhamento/atividades_em_execucao');

/** As VINTE últimas fechadas, da mais recente para a mais antiga. O limite é do servidor. */
export const getUltimasAtividadesFinalizadas = () =>
  apiGet('/acompanhamento/ultimas_atividades_finalizadas');

// A grade, o lote e as subfases.

/**
 * A grade de acompanhamento: as atividades em execução que TÊM malha a procurar.
 *
 * A RESPOSTA VEM COM `grade: null` E UM MOTIVO em `grade_indisponivel`, e isso
 * é o contrato de hoje, não uma falha: a malha de revisão mora no banco de
 * PRODUÇÃO, e o SCA tem uma conexão só. Quem consome MOSTRA o motivo: pintar
 * a tela vazia diria "ninguém está revisando", que é a afirmação oposta.
 */
export const getGradeAcompanhamento = () => apiGet('/acompanhamento/grade_acompanhamento');

/** As fases de um lote, com quantas VERSÕES passaram por cada uma. */
export const getInfoLote = (loteId) => apiGet(`/acompanhamento/informacoes/${loteId}`);

/**
 * As etapas de uma subfase num lote, com a contagem de ATIVIDADES.
 *
 * A ORDEM É (lote, subfase), a mesma do caminho. Invertê-la manda os dois
 * filtros para a coluna errada e a resposta vem VAZIA, sem erro nenhum: foi
 * exatamente o defeito que a origem tinha, e está registrado no comentário da
 * rota.
 */
export const getInfoSubfaseLote = (loteId, subfaseId) => apiGet(
  `/acompanhamento/informacoes/${loteId}/${subfaseId}`,
);

/** Linha do tempo por (lote, subfase): faixas [inicio, 0 ou 1, dia seguinte ao fim]. */
export const getAtividadeSubfase = () => apiGet('/acompanhamento/atividade_subfase');

/** Quantas atividades cada bloco fechou em cada subfase, e quantas faltam. */
export const getSituacaoSubfase = () => apiGet('/acompanhamento/situacao_subfase');

// As pessoas (#/producao/atividade-usuario).

/**
 * A LINHA DO TEMPO de cada pessoa no ano corrente.
 *
 * Cada elemento de `data` é uma FAIXA `[dia_inicial, '0' ou '1', dia_seguinte_ao_final]`,
 * e não um dia solto: dias consecutivos com o mesmo valor entram numa faixa só.
 * O fim é EXCLUSIVO (o servidor manda `fim + 1`).
 */
export const getAtividadeUsuario = () => apiGet('/acompanhamento/atividade_usuario');

/** O retrato de AGORA: quem está em atividade, quem pausou e quem está ocioso. */
export const getResumoUsuario = () => apiGet('/acompanhamento/resumo_usuario');

// O PIT visto pela produção.

/**
 * O PIT do ano por LOTE: a meta do lote e o que cada mês fechou.
 * @param {number} ano
 */
export const getPitProducao = (ano) => apiGet(`/acompanhamento/pit/${ano}`);

/**
 * O mesmo ano por SUBFASE, que é o detalhe de onde o trabalho passou.
 *
 * ROTA LITERAL ANTES DA COM PARÂMETRO no servidor (`/pit/subfase/:ano` vem antes
 * de `/pit/:ano`), e aqui isso não muda nada: são dois caminhos escritos por
 * extenso.
 * @param {number} ano
 */
export const getPitSubfaseProducao = (ano) => apiGet(`/acompanhamento/pit/subfase/${ano}`);

// Os mapas.

/**
 * A FORMA do nome de uma camada de acompanhamento, a mesma expressão ancorada do
 * `nomeParams` do servidor (`acompanhamento_producao_schema.js`).
 *
 * Ela está repetida aqui de propósito, e a repetição é ERGONOMIA e não regra: a
 * regra continua sendo do Joi do servidor, que recusa o que não casar. O que
 * esta cópia evita é a ida ao servidor para receber um 400 que já dava para
 * prever no campo de texto.
 */
export const NOME_CAMADA = /^(bloco|lote_[0-9]+_linha_[0-9]+|lote_[0-9]+_subfase_[0-9]+)$/;

/** Sinaliza o 404 de camada que ainda não nasceu. Ver `getMapaAcompanhamento`. */
export const CAMADA_INEXISTENTE = 'camada-inexistente';

/**
 * O GeoJSON de uma camada de acompanhamento.
 *
 * AS VIEWS SÃO GERADAS EM TEMPO DE EXECUÇÃO pelos gatilhos de
 * `er/acompanhamento_producao.sql`, uma por par (lote, linha de produção), outra
 * por (lote, subfase), mais a `bloco`, que é única no banco. VIEW QUE AINDA NÃO
 * NASCEU É CASO NORMAL: o par só vira view quando o lote recebe a primeira
 * etapa. O servidor responde 404 com a frase que explica isso, e aqui esse 404
 * vira um resultado (`{ vazio: true }`), e não uma exceção: tratá-lo como erro
 * pintaria de vermelho um lote que só ainda não começou.
 *
 * Qualquer outra falha CONTINUA subindo: 403 é falta de perfil e 500 é problema
 * de verdade, e nenhum dos dois é "ainda não há o que mostrar".
 *
 * @param {string} nome - 'bloco', 'lote_<L>_linha_<P>' ou 'lote_<L>_subfase_<S>'
 * @returns {Promise<{vazio:boolean, motivo?:string, geojson?:Object}>}
 */
export async function getMapaAcompanhamento(nome) {
  try {
    const dados = await apiGet(`/acompanhamento/mapa/${encodeURIComponent(nome)}`);
    // `array_agg` sobre view vazia devolve NULL, e não uma lista vazia: sem esta
    // normalização o `features` chegaria nulo e o MapLibre recusaria a fonte.
    const geojson = (dados && dados.geojson) || null;
    const features = (geojson && geojson.features) || [];
    if (!features.length) {
      return { vazio: true, motivo: 'A camada existe e ainda não tem nenhuma feição.' };
    }
    return { vazio: false, geojson: { type: 'FeatureCollection', features } };
  } catch (err) {
    if (err && err.status === 404) {
      return { vazio: true, motivo: err.message, causa: CAMADA_INEXISTENTE };
    }
    throw err;
  }
}

// --- `/api/acompanhamento/linha_producao/.../{z}/{x}/{y}.pbf` ----------------
//
// Servidor: `server/src/acompanhamento_producao/` (a mesma pasta do bloco acima).
// Guarda: `verifyLoginTile`, e NÃO `verifyPerfil`. Basta estar logado -- com um
// token de TILE, que é outra credencial e não o bearer da sessão.
//
// Bloco à parte por causa da guarda, e não do caminho: é a única rota do sistema
// cuja credencial anda na query, e juntá-la às de `consulta` faria alguém supor
// que o `apiGet` serve aqui.

/**
 * Pede ao servidor um token de TILE: audiência própria e vida de minutos.
 *
 * POR QUE NÃO É MAIS O `getToken()` DA SESSÃO. Até 2026-08-09 a URL da camada
 * levava o bearer inteiro (8 horas, aceito por todas as guardas), o middleware
 * de log do servidor gravava a URL COM a query em `logs/combined.log`, e a rota
 * `/logs` publica esse arquivo sem guarda nenhuma. A credencial completa ficava
 * legível a quem abrisse a página do log. O `/logs` continua aberto por decisão;
 * o que se tirou de circulação foi a credencial.
 *
 * O que anda na URL hoje só abre `verifyLoginTile`, e só por alguns minutos.
 *
 * NÃO GUARDA O TOKEN em lugar nenhum de propósito: ele vence, e um cache aqui
 * seria uma segunda cópia da regra de validade que só o servidor conhece. Quem
 * pede uma URL de tile pede um token novo, e o mapa pede isso uma vez por camada
 * montada.
 *
 * @returns {Promise<string>}
 */
export async function tokenDeTile() {
  const dados = await apiPost('/login/tile');
  return (dados && dados.token) || '';
}

/**
 * O molde XYZ da camada vetorial de uma linha de produção.
 *
 * ESTA É A ÚNICA URL DO SISTEMA QUE LEVA UM TOKEN NA QUERY, e não é escolha
 * nossa: o MapLibre monta o pedido de tile sozinho, dentro do renderizador, e
 * uma camada XYZ não tem onde pôr cabeçalho `Authorization`. O que é escolha
 * nossa é QUAL token vai ali, e desde 2026-08-09 é o de tile, e não o da sessão.
 *
 * ELA É ASSÍNCRONA POR ISSO, e era síncrona antes: o token de tile vem de uma
 * chamada ao servidor. Quem a consome é `modules/producao/pages/mapas/mapas-mapa.js`,
 * que já refaz a fonte a cada troca de linha de produção e agora também quando o
 * token vence.
 *
 * `{z}/{x}/{y}` ficam literais: quem os substitui é o MapLibre.
 *
 * @param {number|string} linhaProducaoId
 * @returns {Promise<string>}
 */
export async function urlTileLinhaProducao(linhaProducaoId) {
  const token = await tokenDeTile();
  return `${PREFIXO_API}/acompanhamento/linha_producao/${linhaProducaoId}`
    + `/{z}/{x}/{y}.pbf?token=${encodeURIComponent(token)}`;
}

/**
 * O nome da camada DENTRO da tile, que o servidor escreve em `ST_AsMVT`.
 *
 * O MapLibre precisa dele em `source-layer`, e errá-lo não dá erro nenhum: a
 * camada simplesmente não desenha.
 */
export const camadaDaTile = (linhaProducaoId) => `linha_producao_${linhaProducaoId}`;

// --- `/api/gerencia_producao` ------------------------------------------------
//
// Servidor: `server/src/gerencia_producao/`.
// Piso: `verifyPerfil('gerente', 'producao')`.
//
// A tela dos mapas é de CONSULTA, e esta chamada é de GERENTE: ela carrega
// SOZINHA, com o próprio `catch`, e a tela continua de pé sem ela.

/**
 * O catálogo das views de acompanhamento que existem no banco.
 *
 * Não há catálogo de nomes no piso de consulta, e a ausência é do desenho do
 * servidor, não um esquecimento da tela.
 *
 * SÓ `views` ATRAVESSA. A resposta do servidor traz também um objeto
 * `banco_dados` com servidor, porta, login e SENHA do papel somente-leitura:
 * ele existe para o QGIS montar a conexão, e nada disso pode chegar ao DOM de
 * uma página. Este `map` é a peneira, e é deliberado que ele copie campo a
 * campo em vez de espalhar o objeto inteiro.
 *
 * @returns {Promise<Array<{nome:string, tipo:string, lote_id?:number, lote?:string, projeto?:string}>>}
 */
export async function getCatalogoCamadas() {
  const dados = await apiGet('/gerencia_producao/view_acompanhamento?em_andamento_projeto=true');
  const views = (dados && dados.views) || [];
  return views.map(v => ({
    nome: v.nome,
    tipo: v.tipo,
    lote_id: v.lote_id,
    lote: v.lote,
    projeto: v.projeto,
  }));
}

// --- `/api/producao` ---------------------------------------------------------
//
// Servidor: `server/src/producao/` (o CADASTRO do fluxo).
// Piso: `verifyPerfil('gerente', 'producao')`.

/**
 * As subfases que um lote executa, com as etapas de cada uma.
 *
 * É de GERENTE, e a tela do lote é de consulta: ela carrega SOZINHA, com o
 * próprio `catch`. Quem só consulta não monta o seletor de subfase, e a tela diz
 * isso na seção dele em vez de morrer inteira.
 */
export const getSubfasesDoLote = (loteId) => apiGet(`/producao/lote/${loteId}/subfases`);

/**
 * OS DOIS SELETORES, no piso `consulta` de `producao`.
 *
 * Eles são o que as telas de acompanhamento devem usar, e existem por uma lacuna
 * que só apareceu quando o cliente foi escrito: `listarLotesDoAcervo` cobra o
 * ACERVO e `getSubfasesDoLote` cobra GERENTE, então quem tem `consulta` só em
 * `producao` levava 403 nos dois e a tela caía para o modo degradado.
 *
 * Eles devolvem id e NOME, e nada mais: é o mínimo que um filtro de tela precisa.
 * Quem precisar do lote inteiro (projeto, datas, autoria) continua indo em
 * `listarLotesDoAcervo`; quem precisar do ESTADO de cada subfase, ou da
 * geometria, continua indo em `getSubfasesDoLote`.
 */
export const getLotesComProducao = () => apiGet('/acompanhamento/lotes');

export const getSubfasesComProducao = (loteId) =>
  apiGet(`/acompanhamento/lotes/${loteId}/subfases`);

// --- `/api/projetos` ---------------------------------------------------------
//
// Servidor: `server/src/projeto/`.
// Piso: `verifyPerfil('consulta')` SEM segundo argumento, e o default dele é
// `'acervo'`. É o único bloco deste arquivo que NÃO cobra perfil em `producao`.

/**
 * O cadastro de lotes.
 *
 * Quem tem `consulta` só em `producao` leva 403 aqui, e isso é normal. Por isso
 * ela carrega SOZINHA, com o próprio `catch`, e a tela cai para
 * `getLotesEmExecucao`, que é `consulta` no `producao`. Num `Promise.all` com o
 * resto, este 403 derrubaria a tela inteira com a mensagem dele.
 */
export const listarLotesDoAcervo = () => apiGet('/projetos/lote');

// --- `/api/distribuicao` -----------------------------------------------------
//
// Servidor: `server/src/distribuicao/`.
// Piso: `verifyPerfil('operador', 'producao')` nas OITO rotas, até nas duas de
// LEITURA.
//
// Quem só consulta a produção toma 403 em `/verifica` e em `/tipo_problema`, e
// por isso a tela do operador carrega essas duas com o próprio `catch`, e nunca
// junto de uma leitura de acompanhamento.

/**
 * O pacote da atividade que ESTA pessoa tem em execução, ou `null`.
 *
 * `null` NÃO É ERRO, e é o caso normal de quem acabou de fechar a anterior: o
 * servidor responde 200 com `dados` nulo. Tratar a ausência como falha faria a
 * tela pedir "tentar de novo" para uma resposta que já é a certa.
 */
export const verificarAtividade = () => apiGet('/distribuicao/verifica');

/** `[{ tipo_problema_id, tipo_problema }]` — as chaves são as do SAP, não as da coluna. */
export const getTiposProblema = () => apiGet('/distribuicao/tipo_problema');

/**
 * Pega a próxima atividade da fila.
 *
 * ELA RESPONDE 400 EM DOIS CASOS QUE NÃO SÃO FALHA DE SISTEMA: a fila vazia
 * (`success: true`, contrato do SAP que o plugin já instalado lê) e "o usuário
 * já possui atividade em andamento". O `api-client` transforma os dois em
 * exceção com `err.status === 400`, e o envelope não sobrevive ao `throw`:
 * distinguir um do outro aqui exigiria casar o TEXTO da mensagem, que muda no
 * dia em que alguém melhorar a frase.
 *
 * Por isso o serviço não decide nada. Quem chama olha o `status` e mostra os
 * dois como AVISO, com a mensagem do servidor: as duas frases são para a pessoa
 * ler, e nenhuma delas é uma tela quebrada.
 */
export const iniciarAtividade = () => apiPost('/distribuicao/inicia', {});

/**
 * Finaliza a atividade em execução.
 *
 * `atividade_id` é o único campo obrigatório. Os outros são opcionais no Joi, e
 * o que NÃO for preenchido não deve ir no corpo: `Joi.string()` recusa string
 * vazia, e mandar `observacao_atividade: ''` viraria 400 numa finalização que
 * não tinha observação nenhuma.
 *
 * @param {{atividade_id:number, sem_correcao?:boolean, alterar_fluxo?:string,
 *   observacao_atividade?:string, observacao_proxima_atividade?:string}} body
 */
export const finalizarAtividade = (body) => apiPost('/distribuicao/finaliza', body);

/**
 * Aponta um problema na atividade em execução, e a interrompe.
 *
 * `polygon_ewkt` PRECISA DO PREFIXO `SRID=`: a coluna é `geometry(POLYGON,
 * 4674)` e o servidor faz `ST_Transform(ST_GeomFromEWKT(...), 4674)`. Sem o
 * prefixo o SRID sai 0 e o INSERT morreria com 500 onde a resposta certa é 400,
 * e é por isso que o Joi cobra o padrão.
 *
 * @param {{atividade_id:number, tipo_problema_id:number, descricao:string,
 *   polygon_ewkt:string}} body
 */
export const reportarProblema = (body) =>
  apiPost('/distribuicao/problema_atividade', body);

/**
 * "Finalizei sem querer": aponta o problema na ÚLTIMA atividade que esta pessoa
 * fechou. O servidor escolhe qual é, usa o tipo 7 do domínio e o polígono da
 * própria unidade de trabalho.
 *
 * A ATIVIDADE NÃO VOLTA A EXECUÇÃO por aqui, e nunca voltou: quem decide o que
 * fazer com ela é quem gerencia.
 */
export const reportarFinalizacaoIncorreta = (descricao) =>
  apiPost('/distribuicao/finalizacao_incorreta', { descricao });
