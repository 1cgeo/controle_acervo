'use strict'

const path = require('path')

// Registro dos recursos da API. Cada entrada aponta para o MODULO DE SCHEMA da
// feature no server/, e o CLI le dali o contrato (campos, tipos, obrigatorios,
// filtros de listagem). Nada de contrato e copiado para ca: se o schema mudar,
// o CLI muda junto no mesmo commit. Este arquivo so guarda o que NAO esta no
// schema: o caminho da rota e a escolha de apresentacao (colunas padrao).
//
// O require e preguicoso (funcao) para que um recurso com schema faltando
// quebre so o comando daquele recurso, e nao o CLI inteiro.
//
// O orcamento e um MODULO do SCA, nao um sistema. Duas consequencias moram neste
// arquivo, e so aqui:
//   1. as rotas do modulo levam o prefixo /orcamento (routes.js do server/);
//   2. os schemas do modulo vivem em server/src/orcamento/<feature>/.
// A excecao e a rota de PLATAFORMA, que fica sem prefixo e le o schema de fora
// de server/src/orcamento/. Hoje a unica aqui e /metas, do PIT.

const RAIZ_SERVER = path.join(__dirname, '..', '..', 'server', 'src')

// Schema de uma feature do modulo orcamento.
function carregar (relativo) {
  return () => require(path.join(RAIZ_SERVER, 'orcamento', relativo))
}

// Schema de uma feature de plataforma (fora do modulo orcamento).
function carregarPlataforma (relativo) {
  return () => require(path.join(RAIZ_SERVER, relativo))
}

const RECURSOS = {
  dfd: {
    nome: 'DFD (documento de formalizacao de demanda)',
    caminho: '/orcamento/dfd',
    schema: carregar('dfd/dfd_schema'),
    // Colunas padrao da listagem compacta. O listar do backend devolve tambem
    // os campos de cadastramento (data, uuid e nome de quem cadastrou), que sao
    // ruido para quem so quer ler: ficam de fora daqui e so aparecem com
    // --campos explicito ou --json. O PAR DE MODIFICACAO nao existe mais: saiu
    // do DFD na 1.43.0, e quem guarda quem mexeu e quando e `auditoria.evento`.
    //
    // `area_requisitante` ESTA NO LUGAR DE `grau_prioridade`, e a troca e de
    // 2026-08-08. A prioridade saiu do banco na 1.43.0 (1 de 8 preenchida, um
    // unico codigo) e levou `dominio.grau_prioridade` junto; a area
    // requisitante e o campo que sobrou dizendo DE QUEM e a demanda.
    //
    // `valor_estimado` FICA, e continua saindo com o mesmo nome: ele virou
    // DERIVADO (a soma dos itens) na mesma migracao, e o que mudou foi a fonte,
    // nao a resposta. Ver a nota em REGRAS.dfd sobre o que deixou de ser
    // DIGITAVEL.
    colunas: ['id', 'numero', 'ano', 'rotulo', 'objeto', 'area_requisitante', 'valor_estimado', 'consta_pca'],
    anexo: 'dfd_id'
  },

  nc: {
    nome: 'nota de credito',
    caminho: '/orcamento/notas_credito',
    schema: carregar('nota_credito/nota_credito_schema'),
    colunas: ['id', 'numero', 'ano', 'cod_nd', 'valor_nc', 'valor_recolhido', 'classificacao_nome', 'numero_meta'],
    anexo: 'nota_credito_id'
  },

  // O DOCUMENTO DE RECOLHIMENTO de credito. Recurso proprio, e nao um campo da
  // NC: ate a 1.39.0 o recolhido era a coluna `nota_credito.valor_recolhido`,
  // digitada a mao, e o documento que produziu a devolucao nao existia em lugar
  // nenhum. O `valor_recolhido` da NC continua saindo na LEITURA, agora como a
  // soma destas linhas.
  recolhimento: {
    nome: 'recolhimento de credito',
    caminho: '/orcamento/recolhimentos',
    schema: carregar('nota_credito/recolhimento_schema'),
    colunas: ['id', 'numero', 'ano', 'data_emissao', 'cod_nd', 'ug_emitente', 'valor', 'nc_numero'],
    anexo: 'recolhimento_id'
  },

  ne: {
    nome: 'nota de empenho',
    caminho: '/orcamento/notas_empenho',
    schema: carregar('nota_empenho/nota_empenho_schema'),
    // `total_liquidado`, e nao `valor_liquidado`: quem se chama assim e a linha
    // da LIQUIDACAO, e na NE o campo e a soma delas. O nome errado ficava aqui
    // sem barulho nenhum, porque a coluna padrao que a resposta nao traz e
    // DESCARTADA em silencio (saida.js so avisa o que veio por --campos).
    //
    // SEM `ug` e `gestao`, e nao por escolha de apresentacao: as duas viraram
    // NOT NULL na 1.43.0 e sao a chave do SIAFI (ug, gestao, ano, numero), mas
    // NENHUMA das duas consultas do servidor as devolve. Nao ha o que pedir aqui
    // nem com --campos; o 409 da colisao e a unica forma de a chave aparecer.
    colunas: ['id', 'numero', 'ano', 'data_empenho', 'nota_credito_numero', 'cod_nd', 'valor_empenhado', 'valor_anulado', 'total_liquidado']
  },

  liquidacao: {
    nome: 'liquidacao',
    caminho: '/orcamento/liquidacoes',
    schema: carregar('nota_empenho/liquidacao_schema'),
    colunas: ['id', 'nota_empenho_numero', 'valor_liquidado', 'data', 'documento_ns']
  },

  recebimento: {
    nome: 'recebimento de material',
    caminho: '/orcamento/recebimentos',
    schema: carregar('nota_empenho/recebimento_schema'),
    colunas: ['id', 'nota_empenho_numero', 'material', 'prazo_entrega', 'situacao']
  },

  pdr: {
    nome: 'item do PDR',
    caminho: '/orcamento/pdr',
    schema: carregar('pdr/pdr_schema'),
    colunas: ['id', 'ano', 'item_label', 'cod_nd', 'descricao', 'valor_solicitado', 'valor_autorizado'],
    anexo: 'pdr_ano'
  },

  // Meta do PIT: recurso de PLATAFORMA. Mora em /metas (sem o prefixo do
  // modulo) e le o schema de server/src/pit/, porque o PIT e o plano anual da
  // Divisao e todos os modulos o consomem.
  //
  // LER pede `verifyAcesso`, e nao `verifyLogin`: ter conta nao e ter acesso, e
  // quem nao tem perfil em modulo NENHUM alcanca so a propria pagina. A troca e
  // de 2026-08-08. ESCREVER (criar, editar, apagar meta e mexer nas revisoes)
  // continua do ADMINISTRADOR.
  meta: {
    nome: 'meta do PIT',
    caminho: '/metas',
    schema: carregarPlataforma('pit/pit_schema'),
    colunas: ['id', 'ano', 'numero_meta', 'item', 'descricao']
  },

  licitacao: {
    nome: 'licitacao',
    caminho: '/orcamento/licitacoes',
    schema: carregar('licitacao/licitacao_schema'),
    colunas: ['id', 'ano', 'tipo_nome', 'objeto', 'fase_atual', 'valor_total_estimado', 'valor_final_homologado']
  },

  rpnp: {
    nome: 'RPNP (restos a pagar nao processados)',
    caminho: '/orcamento/rpnp',
    schema: carregar('licitacao/rpnp_schema'),
    colunas: ['id', 'ano', 'nota_empenho_numero', 'empenho_label', 'finalidade', 'valor_empenhado', 'valor_a_liquidar']
  },

  // O RPCMTec nao e recurso do orcamento: ele mora em /api/rpcmtec, com o
  // relatorio inteiro, e quem o alcanca pelo terminal e o `acervo rpcmtec`. Aqui
  // fica o PAINEL: a execucao por ND, que e pergunta do orcamento e tem o perfil
  // do orcamento.
  dashboard: {
    nome: 'execucao por ND (o painel do orcamento)',
    caminho: '/orcamento/dashboard',
    schema: carregar('dashboard/dashboard_schema'),
    colunas: ['cod_nd', 'nd_nome', 'previsto', 'recebido', 'empenhado', 'liquidado'],
    // Recurso de LEITURA: o painel CALCULA a partir de NC, NE e liquidacao, e
    // nao ha o que escrever nele. Sem isto o CLI anunciaria o CRUD que o
    // registry assume por padrao, e o agente descobriria pelo 404.
    somenteLeitura: [
      { caminho: 'execucao_nd', descricao: 'perfil consulta; query: ano*, mes*' }
    ]
  },

  // O QUE SOBROU da configuracao: os ANOS com dado, para o seletor de ano das
  // telas. A tabela `orcamento.configuracao` foi podada na 1.34.0 (guardava
  // `uasg` e `codom`, preenchidas e sem leitor), e com ela sairam o `GET /` e o
  // `PUT /` do singleton, o schema da feature e o CRUD que este recurso
  // anunciava. Esta rota le o `ano` das tabelas de NEGOCIO, e por isso nao
  // dependia daquela tabela.
  //
  // SEM `schema`: a feature nao tem arquivo de schema nenhum, porque a rota que
  // sobrou nao valida corpo nem query.
  configuracao: {
    nome: 'anos com dado no orcamento (o seletor de ano das telas)',
    caminho: '/orcamento/configuracao',
    colunas: null,
    somenteLeitura: [
      { caminho: 'anos', descricao: 'perfil consulta; sem query' }
    ]
  },

  // O anexo NAO segue o CRUD por id: a listagem e por VINCULO na query, o upload
  // e multipart na colecao e nao existe PUT nenhum. Quem cria e o verbo `anexar`
  // (ou o `lancar`), nunca `criar --data`.
  arquivo: {
    nome: 'anexo de documento',
    caminho: '/orcamento/arquivo',
    schema: carregar('arquivo/arquivo_schema'),
    // A query da listagem chama-se `vinculoQuery`, e nao `listarQuery`: sem
    // dizer isso, o CLI descartava --dfd_id e a rota devolvia 400 pedindo o
    // vinculo que o agente tinha passado.
    queryListar: 'vinculoQuery',
    // Nao ha GET por id nem PUT: os bytes so saem pelo /:id/download, e trocar
    // um anexo e apagar e subir de novo.
    semObter: true,
    semAtualizar: true,
    colunas: ['id', 'nome_original', 'tamanho_bytes', 'nota_credito_id', 'dfd_id', 'pdr_ano', 'recolhimento_id'],
    rotas: [
      'GET    <base>            query: nota_credito_id | dfd_id | pdr_ano | recolhimento_id (exatamente um)',
      'POST   <base>            multipart; use o verbo `anexar` de nc, dfd, pdr ou recolhimento',
      'GET    <base>/:id/download   verbo: orcamento arquivo baixar --id N',
      'DELETE <base>/:id'
    ]
  },

  dominio: {
    nome: 'tabela de dominio',
    caminho: '/orcamento/dominio',
    schema: carregar('dominio/dominio_schema'),
    colunas: ['code', 'nome'],
    // Somente estes tres tem CRUD admin; os demais dominios sao so leitura.
    // A lista de leitura espelha os GET de orcamento/dominio/dominio_route.js:
    // sub que falte aqui e sub que o CLI recusa antes de tentar a rota, e sub
    // que SOBRE aqui e 404 depois da rede, que e o pior dos dois -- o agente
    // gasta uma chamada para descobrir o que o mapa ja sabia.
    //
    // SAO OITO desde 2026-08-08. `grau_prioridade` era a nona e saiu com a
    // tabela: `dominio.grau_prioridade` foi apagada na 1.43.0, junto com
    // `dfd.grau_prioridade_id`, que era a unica chave estrangeira que a
    // apontava.
    subEscrita: ['natureza_despesa', 'plano_interno', 'ug'],
    subLeitura: [
      'tipo_posto_grad', 'natureza_despesa', 'plano_interno', 'ug',
      'tipo_licitacao', 'fase_licitacao', 'classificacao_nc', 'tipo_item_dfd'
    ]
  }
}

// Extensoes aceitas por tipo de vinculo no upload de anexo. Espelha a regra do
// backend (arquivo/): NC e DFD levam um PDF unico; o PDR (nivel ano) aceita
// varios, incluindo planilha.
const EXTENSOES_ANEXO = {
  nota_credito_id: ['.pdf'],
  dfd_id: ['.pdf'],
  pdr_ano: ['.pdf', '.xlsx', '.xls', '.csv', '.ods'],
  // O extrato do SIAFI e o DIEx que pede a devolucao: os dois sao PDF, e o
  // recolhimento aceita VARIOS, como o PDR.
  recolhimento_id: ['.pdf']
}

function obter (chave) {
  const recurso = RECURSOS[chave]
  if (!recurso) {
    throw new Error(
      `Recurso desconhecido: "${chave}". Disponiveis: ${Object.keys(RECURSOS).join(', ')}.`
    )
  }
  return recurso
}

function listarChaves () {
  return Object.keys(RECURSOS)
}

module.exports = { RECURSOS, EXTENSOES_ANEXO, obter, listarChaves }
