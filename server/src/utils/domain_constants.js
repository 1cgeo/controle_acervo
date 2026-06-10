// Path: utils\domain_constants.js
'use strict'

/**
 * Constantes que espelham os valores das tabelas de domínio do banco de dados.
 * Referência: er/dominio.sql, er/mapoteca.sql
 */

// dominio.tipo_status_arquivo
const STATUS_ARQUIVO = {
  CARREGADO: 1,
  ERRO_CARREGAMENTO: 2,
  EXCLUIDO: 3,
  ERRO_EXCLUSAO: 4
}

// dominio.tipo_arquivo
const TIPO_ARQUIVO = {
  ARQUIVO_PRINCIPAL: 1,
  FORMATO_ALTERNATIVO: 2,
  INSUMO: 3,
  METADADO: 4,
  JSON_EDICAO: 5,
  DOCUMENTOS: 6,
  PROJETO_QGIS: 7,
  COMPLEMENTAR: 8,
  TILESERVER: 9
}

// dominio.tipo_versao
const TIPO_VERSAO = {
  REGULAR: 1,
  REGISTRO_HISTORICO: 2
}

// dominio.tipo_escala
const TIPO_ESCALA = {
  ESCALA_25K: 1,
  ESCALA_50K: 2,
  ESCALA_100K: 3,
  ESCALA_250K: 4,
  ESCALA_PERSONALIZADA: 5
}

// dominio.situacao_carregamento
const SITUACAO_CARREGAMENTO = {
  NAO_CARREGADO: 1,
  CARREGADO_BDGEX_OSTENSIVO: 2,
  CARREGADO_BDGEX_OPERACOES: 3,
  CARREGADO_IGW: 4,
  CARREGADO_GEDW: 5
}

// dominio.subtipo_produto (subconjuntos usados em queries)
const SUBTIPO_PRODUTO = {
  CARTA_TOPOGRAFICA_T34_700: 2,
  CARTA_ORTOIMAGEM: 3,
  CARTA_TOPOGRAFICA_ET_RDG: 12,
  CARTA_ORTOIMAGEM_OM: 19,
  CARTA_TOPOGRAFICA_MILITAR: 24
}

// dominio.tipo_produto (subconjuntos usados em relatórios da mapoteca)
const TIPO_PRODUTO = {
  CARTA_TOPOGRAFICA: 2,
  CARTA_ORTOIMAGEM: 3,
  CARTA_TEMATICA: 7
}

// mapoteca.tipo_cliente
const TIPO_CLIENTE = {
  OM_EB: 1,
  OM_AERONAUTICA: 2,
  OM_MARINHA: 3,
  ORGAO_PUBLICO_FEDERAL: 4,
  ORGAO_PUBLICO_ESTADUAL: 5,
  ORGAO_PUBLICO_MUNICIPAL: 6,
  PESSOA_JURIDICA: 7,
  PESSOA_FISICA: 8,
  LAI: 9
}

// mapoteca.situacao_pedido
const SITUACAO_PEDIDO = {
  PRE_CADASTRAMENTO: 1,
  DOCUMENTO_RECEBIDO: 2,
  EM_ANDAMENTO: 3,
  REMETIDO: 4,
  CONCLUIDO: 5,
  CANCELADO: 6,
  AGUARDANDO_PRODUCAO: 7
}

// mapoteca.tipo_midia
const TIPO_MIDIA = {
  BANNER: 1,
  GLOSSY: 2,
  COUCHE: 3,
  VERGE: 4,
  SULFITE_90G: 5,
  SULFITE_120G: 6,
  DIGITAL: 7,
  TYVEK: 8
}

// mapoteca.forma_entrega
const FORMA_ENTREGA = {
  CORREIOS: 1,
  ENTREGA_EM_MAOS: 2,
  RETIRADO_NO_CGEO: 3,
  EMAIL: 4,
  OUTROS: 5
}

// mapoteca.tipo_localizacao
const TIPO_LOCALIZACAO = {
  SECAO: 1,
  ALMOXARIFADO: 2,
  AQUISICAO_REALIZADA: 3,
  SALDO_NO_EMPENHO: 4
}

// dominio.tipo_relacionamento
const TIPO_RELACIONAMENTO = {
  INSUMO: 1,
  COMPLEMENTAR: 2,
  CONJUNTO: 3
}

module.exports = {
  STATUS_ARQUIVO,
  TIPO_ARQUIVO,
  TIPO_VERSAO,
  TIPO_ESCALA,
  SITUACAO_CARREGAMENTO,
  SUBTIPO_PRODUTO,
  TIPO_PRODUTO,
  TIPO_CLIENTE,
  SITUACAO_PEDIDO,
  TIPO_MIDIA,
  FORMA_ENTREGA,
  TIPO_LOCALIZACAO,
  TIPO_RELACIONAMENTO
}
