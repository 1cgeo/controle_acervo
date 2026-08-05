import { apiGet, apiPost, apiPut, apiDelete, apiUpload, apiDownload } from './api-client.js';

/**
 * Servicos de PLATAFORMA: o que nao pertence a nenhum modulo.
 *
 * `/api/login` e `/api/usuarios` continuaram SEM o prefixo de modulo na fusao,
 * de proposito: servem os tres modulos. Todo endpoint de modulo mora no
 * service do proprio modulo (ex.: modules/orcamento/services/orcamento-service.js).
 */

// ---- Usuarios (administrador global) ----
//
// O SCA e dono da identidade: `criarUsuario` e `excluirUsuario` cadastram de
// verdade, e nao espelham nenhum servico externo.
export const getUsuarios = () => apiGet('/usuarios');
export const criarUsuario = (body) => apiPost('/usuarios', body);
export const atualizarUsuario = (uuid, body) => apiPut(`/usuarios/${uuid}`, body);
export const excluirUsuario = (uuid) => apiDelete(`/usuarios/${uuid}`);

// Reset em LOTE: a senha de cada um passa a ser o LOGIN dele. A tela diz isso
// com todas as letras antes de chamar, porque a senha resultante e adivinhavel
// de proposito e obriga a troca no primeiro acesso.
export const resetarSenhas = (uuids) => apiPost('/usuarios/senha/reset', { usuarios: uuids });

// Catalogo dos modulos e dos niveis de perfil (1 consulta, 2 operador,
// 3 gerente), para a tela nao decorar os codigos do dominio.
export const getModulos = () => apiGet('/usuarios/dominio/modulo');
export const getTiposPerfil = () => apiGet('/usuarios/dominio/tipo_perfil');

// Posto/graduacao NAO e catalogo de administrador: a tela de "Meu perfil"
// tambem o oferece, e quem a usa e qualquer pessoa logada. O servidor guarda a
// mesma diferenca (verifyLogin nesta rota, verifyAdmin nas duas de cima).
export const getPostosGrad = () => apiGet('/usuarios/dominio/tipo_posto_grad');

// ---- Acessos (administrador global) ----
//
// O historico de quem entrou no sistema.
//
// `total` e o RECORTE do periodo, e o default mora so no Joi do servidor
// (`acessos_schema.js`). Por isso estas funcoes so mandam o parametro quando a
// tela pede um recorte diferente: repetir o 14 e o 30 aqui criaria um segundo
// lugar declarando a mesma coisa, e os dois divergiriam no primeiro ajuste.
const comTotal = (caminho, total, extra = '') => {
  const params = new URLSearchParams();
  if (total) params.set('total', String(total));
  if (extra) params.set('max', String(extra));
  const query = params.toString();
  return apiGet(query ? `${caminho}?${query}` : caminho);
};

export const getAcessosResumo = () => apiGet('/acessos/resumo');
export const getAcessosLogados = () => apiGet('/acessos/logados');
export const getLoginsDia = (total) => comTotal('/acessos/logins/dia', total);
export const getLoginsUsuarios = (total, max) => comTotal('/acessos/logins/usuarios', total, max);

// SEM `getLoginsMes` e SEM `getLoginsClientes`. As duas series nascem
// degeneradas: `dgeo.login` e recente, entao a serie de doze meses fica quase
// toda em zero, e "por onde se entra" e uma barra sobre um dominio de DOIS
// valores. A tela trocou as duas por uma COLUNA da tabela, e o servidor remove
// as rotas. Embrulho sem chamador convida a religar uma pergunta que a Divisao
// ja descartou.

// ---- O PROPRIO cadastro (#/perfil), de qualquer pessoa logada ----
//
// `alterarMinhaSenha` e o unico caminho pelo qual alguem troca a propria senha.
export const getMeuPerfil = () => apiGet('/usuarios/perfil');
export const atualizarMeuPerfil = (body) => apiPut('/usuarios/perfil', body);
export const alterarMinhaSenha = (body) => apiPut('/usuarios/perfil/senha', body);

// ---- Metas do PIT ----
// Rota de plataforma, e nao do orcamento: o PIT e o plano anual da Divisao, e os
// tres modulos o consomem. LER e de qualquer pessoa logada; ESCREVER e do
// administrador global (o backend cobra, o cliente so evita oferecer o botao).
export const getMetasPit = (ano) => apiGet(ano ? `/metas?ano=${ano}` : '/metas');
export const getAnosMetaPit = () => apiGet('/metas/anos');
// SEM `getMetaPit(id)`: nenhuma tela busca uma meta sozinha. A lista do ano ja
// traz a linha inteira, e o dialogo de edicao recebe o objeto que a tabela tem.
// ACRESCENTAR META E ATO DA DSG, como alterar e cancelar: o servidor exige a
// revisao em rascunho e a declaracao cai dentro dela. Por isso "Nova meta" mora
// na tela de revisoes, e nao na de metas.
export const createMetaPit = (body) => apiPost('/metas', body);
/**
 * SO A IDENTIDADE da meta: ano, numero, item, unidade e origem.
 *
 * O que a DSG PROMETE (descricao, quantidade, prazo, demandante, cancelada) NAO
 * entra aqui, e o servidor recusa com 400 quem mandar: isso muda dentro de uma
 * revisao, por `declararNaRevisao`.
 */
export const updateMetaPit = (id, body) => apiPut(`/metas/${id}`, body);
/**
 * APAGAR A META, e so a partir da revisao que a CRIOU.
 *
 * A primeira criacao pode ter nascido errada, e o documento assinado talvez nem
 * tenha a meta: por isso ela se apaga. Da segunda declaracao em diante o plano
 * ja contou com ela, e o que cabe e CANCELAR dentro de uma revisao. O servidor
 * cobra a contagem sozinho; `revisaoId` e o que diz de ONDE se esta apagando, e
 * sem ele a segunda metade da regra ficaria so na tela.
 *
 * @param {number} id
 * @param {number} [revisaoId] - a revisao aberta na tela.
 */
export const deleteMetaPit = (id, revisaoId) =>
  apiDelete(`/metas/${id}${revisaoId ? `?revisao_id=${revisaoId}` : ''}`);

/**
 * CORRIGIR A TRANSCRICAO da meta, e nao alterar o PIT.
 *
 * `declararNaRevisao` muda o que a DSG PROMETE, e por isso exige uma revisao em
 * rascunho. Esta rota e a outra porta: o gerente digitou 53 onde o documento
 * assinado diz 35, e o conserto e da TRANSCRICAO, nao um ato da DSG.
 * Ela reescreve a linha da revisao EM VIGOR e cobra `motivo`, que e o que separa
 * "digitei errado" de "a DSG mudou".
 *
 * O corpo manda os CINCO campos da declaracao, inclusive `cancelada`. O
 * servidor grava a declaracao inteira, e campo ausente vira o padrao: omitir
 * `cancelada` DESCANCELARIA em silencio a meta que a DSG cancelou.
 *
 * @param {number} id
 * @param {{descricao:string, quantidade_prevista:?number, prazo:?string,
 *          demandante:?string, cancelada:boolean, motivo:string}} body
 */
export const corrigirTranscricaoMeta = (id, body) =>
  apiPut(`/metas/${id}/transcricao`, body);

// ---- O mes de cada meta: planejado e realizado (2.1 do RPCMTec) ----
// UMA GRADE do ano, e nao um mes por vez: a planilha da Divisao tem duas abas
// (PLANEJ_PIT e EXEC_PIT) com as MESMAS linhas e as mesmas doze colunas, e a
// diferenca entre elas e qual dos dois numeros a celula guarda.
//
// LER e do gerente de qualquer modulo e do administrador; ESCREVER e do
// administrador global.
export const getGradePit = (ano) => apiGet(`/metas/execucao?ano=${ano}`);
// UMA rota para criar e alterar: o par (meta, mes) e uma CELULA de grade, e quem
// preenche nao sabe se aquele mes ja tinha linha. Quem separa e o servidor, e so
// para o rastro.
export const salvarExecucaoPit = (body) => apiPost('/metas/execucao', body);

// ---- Demanda Extra-PIT (3.3 do RPCMTec) ----
export const getExtraPit = (ano) =>
  apiGet(ano ? `/metas/extra?ano=${ano}` : '/metas/extra');
export const getAnosExtraPit = () => apiGet('/metas/extra/anos');
export const createExtraPit = (body) => apiPost('/metas/extra', body);
export const updateExtraPit = (id, body) => apiPut(`/metas/extra/${id}`, body);
export const deleteExtraPit = (id) => apiDelete(`/metas/extra/${id}`);

// AS VERSÕES QUE MATERIALIZAM A DEMANDA. O Extra-PIT é produção, e o vínculo
// mora em `acervo.versao.demanda_extra_id`, exclusivo com `meta_pit_id` pelo
// CHECK `versao_plano_ou_excecao`. Até aqui a tela só via a CONTAGEM
// (`quantidade_materializada`), e nunca quais folhas.
//
// LER é de qualquer pessoa logada; LIGAR e DESLIGAR são do administrador, como o
// resto da escrita da 3.3.
export const getVersoesExtraPit = (id) => apiGet(`/metas/extra/${id}/versoes`);

// As candidatas trazem `meta_pit_id` preenchido quando a folha já cumpre meta do
// PIT. A tela recusa essa antes de chamar o servidor, para a pessoa ler o motivo
// em vez da violação do CHECK.
export const getVersoesCandidatasExtraPit = (id, termo) =>
  apiGet(`/metas/extra/${id}/versoes/candidatas${termo ? `?termo=${encodeURIComponent(termo)}` : ''}`);

export const associarVersaoExtraPit = (id, versaoId) =>
  apiPost(`/metas/extra/${id}/versoes`, { versao_id: versaoId });

export const desassociarVersaoExtraPit = (id, versaoId) =>
  apiDelete(`/metas/extra/${id}/versoes/${versaoId}`);

// ---- Aproveitamento do efetivo (6.1) ----
// INTERVALO, e nao retrato mensal. `dgeo.efetivo_periodo`
// diz quando a pessoa esteve na Divisao e `dgeo.impedimento` diz o que a tirou
// do trabalho sem tira-la da Divisao. Mes, semana e ano sao consulta.
//
// Sob /efetivo, e nao /rpcmtec: "quem esteve na Divisao" nao existe por causa do
// relatorio. Todas sao verifyAdmin no servidor, inclusive a leitura, porque a
// tela mostra licenca de saude e funcao acumulada, nominalmente.
export const getMapaEfetivo = (ano) => apiGet(`/efetivo/mapa?ano=${ano}`);
export const getEfetivoDoMes = (ano, mes) => apiGet(`/efetivo/mes?ano=${ano}&mes=${mes}`);

export const getPeriodosEfetivo = (ano) =>
  apiGet(ano ? `/efetivo/periodos?ano=${ano}` : '/efetivo/periodos');
export const createPeriodoEfetivo = (body) => apiPost('/efetivo/periodos', body);
export const updatePeriodoEfetivo = (id, body) => apiPut(`/efetivo/periodos/${id}`, body);
export const deletePeriodoEfetivo = (id) => apiDelete(`/efetivo/periodos/${id}`);

export const getImpedimentos = (ano) =>
  apiGet(ano ? `/efetivo/impedimentos?ano=${ano}` : '/efetivo/impedimentos');
export const createImpedimento = (body) => apiPost('/efetivo/impedimentos', body);
export const updateImpedimento = (id, body) => apiPut(`/efetivo/impedimentos/${id}`, body);
export const deleteImpedimento = (id) => apiDelete(`/efetivo/impedimentos/${id}`);

// ---- Capacitacao (2.6 ministrada e 6.2 recebida) ----
export const getCapacitacoes = (ano, tipoId) => {
  const q = new URLSearchParams();
  if (ano) q.set('ano', ano);
  if (tipoId) q.set('tipo_id', tipoId);
  const busca = q.toString();
  return apiGet(busca ? `/rpcmtec/capacitacao?${busca}` : '/rpcmtec/capacitacao');
};
export const getAnosCapacitacao = () => apiGet('/rpcmtec/capacitacao/anos');
export const createCapacitacao = (body) => apiPost('/rpcmtec/capacitacao', body);
export const updateCapacitacao = (id, body) => apiPut(`/rpcmtec/capacitacao/${id}`, body);
export const deleteCapacitacao = (id) => apiDelete(`/rpcmtec/capacitacao/${id}`);

/**
 * Rotulo curto da meta, como a planilha e as telas a escrevem: '4.1' quando a
 * meta se subdivide, e o numero da meta quando ela e indivisa (`item` NULO; o
 * '-' literal tambem cai aqui, caso alguem o digite).
 * Mesma regra do SQL em mapoteca_ctrl (ROTULO_META), para as duas nao divergirem.
 * @param {Object} meta
 * @returns {string}
 */
export function codigoMetaPit(meta) {
  if (!meta) return '';
  const item = meta.item && meta.item !== '-' ? String(meta.item) : null;
  return item || String(meta.numero_meta ?? '');
}

/**
 * Rotulo completo para lista de escolha: 'Meta 4.1 - Carta Topográfica...'.
 * @param {Object} meta
 * @returns {string}
 */
export function rotuloMetaPit(meta) {
  if (!meta) return '';
  const codigo = codigoMetaPit(meta);
  return meta.descricao ? `Meta ${codigo} - ${meta.descricao}` : `Meta ${codigo}`;
}


// ---- Exercicio e REVISOES do PIT ----
//
// A DSG revisa o plano durante a execucao, e alterar o PIT e cancelar, alterar
// e adicionar meta: as tres viram uma linha em `pit.meta_revisao`, esparsa, que
// por isso E o historico.
//
// RASCUNHO e a revisao sem `data_vigencia`. Publicar e preencher essa data, e e
// so a partir dai que ela rege.

export const listarExercicios = () => apiGet('/metas/exercicios');

export const criarExercicio = (body) => apiPost('/metas/exercicios', body);

export const atualizarExercicio = (ano, body) =>
  apiPut(`/metas/exercicios/${ano}`, body);

export const listarRevisoes = (ano) =>
  apiGet(`/metas/revisoes${ano ? `?ano=${ano}` : ''}`);

/**
 * O que a revisao FAZ, meta a meta, com o valor anterior ao lado.
 *
 * E a tela de conferencia: o gerente le isto contra o DIEx antes de publicar.
 * O "anterior" sai da revisao vigente ANTES desta, o que para um rascunho e a
 * que esta no ar hoje.
 */
export const getAlteracoesRevisao = (id) =>
  apiGet(`/metas/revisoes/${id}/alteracoes`);

export const criarRevisao = (body) => apiPost('/metas/revisoes', body);

export const atualizarRevisao = (id, body) =>
  apiPut(`/metas/revisoes/${id}`, body);

export const excluirRevisao = (id) => apiDelete(`/metas/revisoes/${id}`);

/** Publicar e o ato que faz a revisao passar a reger. Recusa com zero alteracao. */
export const publicarRevisao = (id, body) =>
  apiPost(`/metas/revisoes/${id}/publicar`, body);

/**
 * Tira a declaracao de UMA meta do RASCUNHO.
 *
 * So no rascunho: na revisao publicada esta linha e o que o relatorio de um mes
 * passado reporta, e remove-la reescreveria esse passado.
 */
export const removerDeclaracao = (revisaoId, metaId) =>
  apiDelete(`/metas/revisoes/${revisaoId}/meta/${metaId}`);

/**
 * A META COMO ESTA REVISAO A DECLARA: a porta unica para mudar o que o PIT
 * promete.
 *
 * OS DOIS IDS NO CAMINHO. A alteracao entrava por `updateMetaPit`, e o servidor
 * descobria sozinho em que revisao gravar, procurando o rascunho do ano: quem
 * estivesse olhando o R0 publicado e mudasse um numero via a mudanca cair no R1,
 * sem nada dizer. Aqui a revisao e escolhida por quem chama, e a revisao
 * publicada e RECUSADA em vez de desviada.
 *
 * AS TRES OPERACOES cabem nesta chamada, porque `pit.meta_revisao` e esparsa:
 * acrescentar e a primeira linha da meta, alterar e a linha com o numero novo,
 * cancelar e a linha com `cancelada`. Tirar a meta da revisao e
 * `removerDeclaracao`.
 *
 * A REVISAO PUBLICADA ACEITA A EDICAO, com `motivo`. O texto assinado e o rei, e
 * o que esta no sistema e transcricao dele: editar o R0 publicado conserta a
 * nossa COPIA, e nao o plano. O servidor recusa sem o motivo.
 *
 * A IDENTIDADE VIAJA JUNTO, e e opcional: `numero_meta`, `item` e `unidade_id`
 * gravam em `pit.meta` na MESMA transacao. Era o botao "Corrigir cadastro" ao
 * lado do de alterar, e ninguem distinguia os dois.
 *
 * @param {number} revisaoId
 * @param {number} metaId
 * @param {{descricao:string, quantidade_prevista:?number, prazo:?string,
 *          demandante:?string, cancelada:boolean, motivo:?string,
 *          numero_meta:?number, item:?string, unidade_id:?number}} body
 */
export const declararNaRevisao = (revisaoId, metaId, body) =>
  apiPut(`/metas/revisoes/${revisaoId}/meta/${metaId}`, body);

export const listarAnexosRevisao = (id) => apiGet(`/metas/revisoes/${id}/anexos`);

export const enviarAnexoRevisao = (id, formData) =>
  apiUpload(`/metas/revisoes/${id}/anexos`, formData);

export const excluirAnexoRevisao = (anexoId) =>
  apiDelete(`/metas/revisoes/anexo/${anexoId}`);

export const baixarAnexoRevisao = (anexoId, nome) =>
  apiDownload(`/metas/revisoes/anexo/${anexoId}/download`, nome);
