import { apiGet, apiPost, apiPut, apiDelete, apiUpload, apiDownload } from './api-client.js';

/**
 * Servicos de PLATAFORMA: o que nao pertence a nenhum modulo.
 *
 * `/api/login` e `/api/usuarios` continuaram SEM o prefixo de modulo na fusao,
 * de proposito: servem todos os modulos. Todo endpoint de modulo mora no
 * service do proprio modulo (ex.: modules/orcamento/services/orcamento-service.js).
 */

// ---- Instituicao: de QUEM e esta instalacao ----
//
// Nome, sigla e Unidade Gestora do Centro que opera este SAP. Uma linha so em
// `dgeo.instituicao`, e e dela que saem o cabecalho do RPCMTec, o nome do
// arquivo do Anuario e o filtro da area de suprimento na subsecao 2.7.
//
// A LEITURA E DE QUEM ESTA LOGADO, e nao do administrador: o rodape do relatorio
// e o titulo precisam do nome, e esconde-lo de quem so consulta faria a tela
// mostrar o rotulo errado. Quem ESCREVE e o administrador global, e o servidor
// cobra `verifyAdmin` no PUT.
export const getInstituicao = () => apiGet('/instituicao');
export const atualizarInstituicao = (body) => apiPut('/instituicao', body);

// A lista de Unidades Gestoras, para o seletor da tela de instituicao. Ela e do
// ORCAMENTO (`dominio.ug`), e nao da plataforma, mas quem a consome aqui e a
// tela de instituicao: repetir a rota no service do orcamento faria a tela de
// plataforma importar de um modulo.
export const getUnidadesGestoras = () => apiGet('/orcamento/dominio/ug');

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
// os modulos o consomem. LER e de quem tem perfil em ALGUM modulo
// (`verifyAcesso`, e `acessoLoader` na rota do client); ESCREVER e do
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

// O DIAGNOSTICO do cadastro: o que cada meta automatica promete contra o que
// existe cadastrado para cumpri-la.
//
// Numa meta automatica o numero nao se digita, ele e contado das versoes, das
// capacitacoes e dos pedidos ligados a ela. Entao ESQUECER de cadastrar a
// entidade nao da erro: da ZERO, indistinguivel de "o mes ainda nao chegou".
// Esta rota e quem torna esse silencio visivel.
export const getDiagnosticoPit = (ano) =>
  apiGet(`/metas/execucao/diagnostico?ano=${ano}`);

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
// relatorio.
//
// GUARDA, desde a 1.33.0: o modulo EFETIVO. O cadastro (periodos e impedimentos)
// exige OPERADOR, e o mapa anual e o resumo mensal exigem GERENTE, porque eles
// agregam a Divisao inteira num quadro so. A leitura tambem e guardada, e a
// razao continua a mesma de quando tudo era verifyAdmin: a tela mostra licenca
// de saude e funcao acumulada, nominalmente.
export const getMapaEfetivo = (ano) => apiGet(`/efetivo/mapa?ano=${ano}`);
export const getEfetivoDoMes = (ano, mes) => apiGet(`/efetivo/mes?ano=${ano}&mes=${mes}`);

// Conta ativa sem passagem pela DGEO no mes. Mora sob /efetivo, e nao no
// cliente: a conta antes era feita aqui, cruzando `getUsuarios` com o efetivo, e
// `GET /usuarios` e verifyAdmin -- para contar tres nomes, a tela pedia o
// cadastro inteiro (login, flag de administrador, perfil em cada modulo) e o
// dashboard do efetivo ficava trancado atras do administrador global.
export const getDivergenciasEfetivo = (ano, mes) =>
  apiGet(`/efetivo/divergencias?ano=${ano}&mes=${mes}`);

// A MESMA rota do resumo mensal, com `formato=csv`. Um endpoint separado
// divergiria do que a tela mostra na primeira regra nova.
export const exportacoesEfetivo = (ano, mes) => [
  {
    label: 'Efetivo do mês (CSV)',
    title: 'Baixar o efetivo do mês, com aproveitamento, dias perdidos e impedimentos',
    endpoint: `/efetivo/mes?ano=${ano}&mes=${mes}&formato=csv`,
    filename: `efetivo_${ano}_${String(mes).padStart(2, '0')}.csv`,
  },
];

/**
 * O CADASTRO MINIMO de militar, para a tela do aproveitamento.
 *
 * POR QUE ELA NAO E `getUsuarios`. `GET /api/usuarios` e `verifyAdmin`, e a tela
 * `#/aproveitamento` a pedia no MESMO `Promise.all` das rotas de `/efetivo`: o
 * gerente do efetivo tomava 403 numa das quatro e a tela INTEIRA morria dizendo
 * "necessita ser um administrador", com as outras tres respondendo 200. Voltar a
 * pedir `/usuarios` aqui e reabrir isso -- e, pior, e pagar com a flag global o
 * preco de um seletor de nomes.
 *
 * O RECORTE DE CAMPO E O QUE PERMITE A GUARDA MAIS BAIXA (consulta em Efetivo):
 * daqui saem `uuid`, `nome`, `nome_guerra`, `tipo_posto_grad_id`,
 * `tipo_posto_grad` e `ativo`, e nada mais. `login`, `administrador`,
 * `senha_definida` e os perfis por modulo dizem quem manda no sistema e
 * continuam so em `/usuarios`.
 *
 * `ativo` VEM JUNTO porque e flag de LOGIN, e e ela que sustenta o rodape de
 * divergencia ("acessa o SCA e nao tem passagem no ano").
 */
export const getMilitaresEfetivo = () => apiGet('/efetivo/militares');

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

// ---- O PROPRIO aproveitamento (#/perfil), de quem tem acesso ao sistema ----
//
// AS OITO ROTAS ACIMA SAO DO GERENTE do Efetivo desde 2026-08-08, e a tela
// `#/aproveitamento` deixou de abrir para o operador. Estas sao a outra metade
// da regra: cada pessoa cuida do PROPRIO aproveitamento na pagina dela. Sem
// elas, ninguem abaixo do gerente teria como declarar o proprio impedimento, e o
// aproveitamento da 6.1 do RPCMTec depende de cada um declarar o seu.
//
// O DONO NAO VIAJA NO CORPO. `usuario_uuid` nao entra em nenhum destes corpos: o
// servidor o toma de `req.usuarioUuid`, e no PUT e no DELETE confere que a linha
// e da propria pessoa antes de tocar nela (404 quando nao for). Acrescentar o
// campo aqui nao mudaria nada no banco e faria a tela mentir sobre o contrato.
/**
 * A GRADE DO PROPRIO ANO: as 53 semanas e o fechamento anual de UMA pessoa.
 *
 * POR QUE ELA NAO E `getMapaEfetivo`. Aquela rota e `verifyPerfil('consulta',
 * 'efetivo')` e devolve a Divisao inteira, nominalmente. Quem trabalha so no
 * acervo nao tem perfil em Efetivo e mesmo assim precisa ver o proprio ano: e a
 * mesma razao pela qual as outras rotas do proprio ficaram em `verifyAcesso`.
 *
 * O DONO NAO VIAJA. `usuario_uuid` nao e parametro desta rota: o servidor o toma
 * de `req.usuarioUuid`, e o Joi da query so conhece `ano` -- mandar o campo aqui
 * seria 400, e nao um mapa de outra pessoa.
 *
 * AS CONSULTAS SAO AS MESMAS do mapa da Divisao, recortadas por pessoa. E o que
 * faz o numero da propria pagina bater com o do mapa que o gerente ve.
 */
export const getMeuAproveitamento = (ano) =>
  apiGet(`/efetivo/meu_aproveitamento?ano=${ano}`);

export const getMeuPeriodoEfetivo = () => apiGet('/efetivo/meu_periodo');
export const createMeuPeriodoEfetivo = (body) => apiPost('/efetivo/meu_periodo', body);
export const updateMeuPeriodoEfetivo = (id, body) =>
  apiPut(`/efetivo/meu_periodo/${id}`, body);
export const deleteMeuPeriodoEfetivo = (id) => apiDelete(`/efetivo/meu_periodo/${id}`);

export const getMeuImpedimento = () => apiGet('/efetivo/meu_impedimento');
export const createMeuImpedimento = (body) => apiPost('/efetivo/meu_impedimento', body);
export const updateMeuImpedimento = (id, body) =>
  apiPut(`/efetivo/meu_impedimento/${id}`, body);
export const deleteMeuImpedimento = (id) => apiDelete(`/efetivo/meu_impedimento/${id}`);

// ---- Capacitacao: DUAS rotas, uma por tipo ----
//
// A MINISTRADA (2.6) e a RECEBIDA (6.2) eram a MESMA rota, com o tipo num filtro
// e num campo do corpo. Desde a 1.33.0 o tipo e o CAMINHO, porque a permissao e
// por tipo: a ministrada e do operador do PIT (servico que a Divisao
// presta), a recebida e do operador de EFETIVO (gente nossa em curso). A guarda
// da rota nao enxerga o corpo, entao um POST so nao tinha como ser guardado.
//
// `tipo_id` NAO vai mais no corpo: quem o fixa e o servidor.
//
// A tabela do banco continua UMA. O que se separou foi o endereco.
const caminhoCapacitacao = (tipo) => `/rpcmtec/capacitacao/${tipo}`;

// Molde, e nao dez funcoes escritas a mao: o que muda entre os dois tipos e uma
// palavra do caminho, e dez copias divergiriam na primeira correcao.
const listarCapacitacao = (tipo) => (ano) => {
  const base = caminhoCapacitacao(tipo);
  return apiGet(ano ? `${base}?ano=${ano}` : base);
};
const anosCapacitacao = (tipo) => () => apiGet(`${caminhoCapacitacao(tipo)}/anos`);
const criarCapacitacao = (tipo) => (body) => apiPost(caminhoCapacitacao(tipo), body);
const atualizarCapacitacao = (tipo) => (id, body) =>
  apiPut(`${caminhoCapacitacao(tipo)}/${id}`, body);
const excluirCapacitacao = (tipo) => (id) =>
  apiDelete(`${caminhoCapacitacao(tipo)}/${id}`);

export const getCapacitacoesMinistradas = listarCapacitacao('ministrada');
// SO os anos com capacitacao MINISTRADA. A lista unica de antes oferecia ano
// vazio: em 2026-08-06 a producao tinha ministrada em oito anos e recebida so em
// 2026, e a tela da recebida oferecia os oito.
export const getAnosCapacitacaoMinistrada = anosCapacitacao('ministrada');
export const createCapacitacaoMinistrada = criarCapacitacao('ministrada');
export const updateCapacitacaoMinistrada = atualizarCapacitacao('ministrada');
export const deleteCapacitacaoMinistrada = excluirCapacitacao('ministrada');

export const getCapacitacoesRecebidas = listarCapacitacao('recebida');
export const getAnosCapacitacaoRecebida = anosCapacitacao('recebida');
export const createCapacitacaoRecebida = criarCapacitacao('recebida');
export const updateCapacitacaoRecebida = atualizarCapacitacao('recebida');
export const deleteCapacitacaoRecebida = excluirCapacitacao('recebida');

/**
 * Rotulo curto da meta, como a planilha e as telas a escrevem: '4.1' quando a
 * item ('4.1'). Desde a 1.30.0 toda meta do plano E um item, e `item` e NOT
 * NULL: o `numero_meta` sozinho so aparece quando a linha vem sem item nenhum,
 * que e o caso do registro sem vinculo com o PIT.
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

/**
 * A meta a que o trabalho se pode ligar.
 *
 * SEMPRE VERDADEIRO desde a 1.30.0, e a funcao fica so como ponto unico da
 * regra. Ate a 1.29.0 uma meta subdividida tinha uma linha de CABECALHO (`item`
 * nulo) e uma linha por item, e ligar trabalho ao cabecalho contaria o mesmo
 * duas vezes; a tela precisava filtrar isso sozinha, com a mesma conta que o
 * servidor fazia em `EH_FOLHA`.
 *
 * Hoje o cabecalho nao e mais uma meta: ele e `pit.meta.nome`, e a lista que
 * chega da API ja tem so item. A funcao continua exportada porque as telas a
 * chamam, e o dia em que voltar a haver linha que nao recebe trabalho e aqui que
 * a regra entra, num lugar so.
 *
 * @param {Object} meta
 * @returns {boolean}
 */
export function ehFolhaMetaPit(meta) {
  return Boolean(meta);
}


// ---- Exercicio e REVISOES do PIT ----
//
// A DSG revisa o plano durante a execucao, e alterar o PIT e cancelar, alterar
// e adicionar item: as tres viram uma linha em `pit.meta_item_revisao`, esparsa,
// que por isso E o historico.
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
 * AS TRES OPERACOES cabem nesta chamada, porque `pit.meta_item_revisao` e esparsa:
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
