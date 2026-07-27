// Path: lib\recursos.js
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
// Desde a fusao de 2026-07-27 o orcamento e um MODULO do SCA, nao um sistema.
// Duas consequencias moram neste arquivo, e so aqui:
//   1. as rotas do modulo levam o prefixo /orcamento (routes.js do server/);
//   2. os schemas do modulo vivem em server/src/orcamento/<feature>/.
// A excecao e /usuarios, que e rota de PLATAFORMA: fica sem prefixo e le o
// schema de server/src/usuario/, o mesmo que o acervo e a mapoteca usam.

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
    // os quatro campos de auditoria (data/usuario de cadastramento e
    // modificacao), que sao ruido para quem so quer ler: ficam de fora daqui e
    // so aparecem com --campos explicito ou --json.
    colunas: ['id', 'numero', 'ano', 'rotulo', 'objeto', 'grau_prioridade', 'valor_estimado', 'consta_pca'],
    anexo: 'dfd_id'
  },

  nc: {
    nome: 'nota de credito',
    caminho: '/orcamento/notas_credito',
    schema: carregar('nota_credito/nota_credito_schema'),
    colunas: ['id', 'numero', 'ano', 'cod_nd', 'valor_nc', 'valor_recolhido', 'classificacao_nome', 'numero_meta'],
    anexo: 'nota_credito_id'
  },

  ne: {
    nome: 'nota de empenho',
    caminho: '/orcamento/notas_empenho',
    schema: carregar('nota_empenho/nota_empenho_schema'),
    colunas: ['id', 'numero', 'ano', 'data_empenho', 'nota_credito_numero', 'cod_nd', 'valor_empenhado', 'valor_anulado', 'valor_liquidado']
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

  meta: {
    nome: 'meta do PIT',
    caminho: '/orcamento/metas',
    schema: carregar('meta/meta_schema'),
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

  relatorio: {
    nome: 'edicao mensal do RPCMTec',
    caminho: '/orcamento/relatorio',
    schema: carregar('relatorio/relatorio_schema'),
    colunas: ['id', 'ano', 'mes', 'assinante', 'data_assinatura']
  },

  configuracao: {
    nome: 'configuracao (singleton id=1)',
    caminho: '/orcamento/configuracao',
    schema: carregar('configuracao/configuracao_schema'),
    colunas: null,
    singleton: true
  },

  arquivo: {
    nome: 'anexo de documento',
    caminho: '/orcamento/arquivo',
    schema: carregar('arquivo/arquivo_schema'),
    colunas: ['id', 'nome_original', 'tamanho_bytes', 'nota_credito_id', 'dfd_id', 'pdr_ano']
  },

  usuario: {
    nome: 'usuario',
    caminho: '/usuarios',
    schema: carregarPlataforma('usuario/usuario_schema'),
    colunas: ['id', 'uuid', 'login', 'nome', 'administrador', 'ativo']
  },

  dominio: {
    nome: 'tabela de dominio',
    caminho: '/orcamento/dominio',
    schema: carregar('dominio/dominio_schema'),
    colunas: ['code', 'nome'],
    // Somente estes tres tem CRUD admin; os demais dominios sao so leitura.
    subEscrita: ['natureza_despesa', 'plano_interno', 'ug'],
    subLeitura: [
      'tipo_posto_grad', 'natureza_despesa', 'plano_interno', 'ug',
      'tipo_licitacao', 'classificacao_nc', 'tipo_item_dfd', 'grau_prioridade'
    ]
  }
}

// Extensoes aceitas por tipo de vinculo no upload de anexo. Espelha a regra do
// backend (arquivo/): NC e DFD levam um PDF unico; o PDR (nivel ano) aceita
// varios, incluindo planilha.
const EXTENSOES_ANEXO = {
  nota_credito_id: ['.pdf'],
  dfd_id: ['.pdf'],
  pdr_ano: ['.pdf', '.xlsx', '.xls', '.csv', '.ods']
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
