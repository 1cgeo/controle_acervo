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
  REGISTRO_HISTORICO: 2,
  // Folha que ainda vai ser produzida. Nasce sem arquivo, e o arquivo entra na
  // MESMA versao quando a producao terminar.
  PLANEJADA: 3
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
  CARTA_ORTOIMAGEM_SARP: 19,
  CARTA_TOPOGRAFICA_MILITAR: 24
}

// dominio.tipo_produto (subconjuntos usados em relatórios da mapoteca)
//
// PONTO_CONTROLE não é um produto do acervo: um CHECK em acervo.produto barra o
// tipo 10 (ver er/ponto_controle.sql). Ele fica aqui porque o schema
// ponto_controle usa a MESMA infraestrutura de volume, e
// acervo.volume_tipo_produto chaveia por tipo_produto_id.
const TIPO_PRODUTO = {
  CARTA_TOPOGRAFICA: 2,
  CARTA_ORTOIMAGEM: 3,
  // Ortoimagem crua (sem moldura de carta). É o que o Anuário Estatístico conta
  // na linha "Imagem de Satélite" / "Imagem de Satélite / Fotografia aérea".
  ORTOIMAGEM: 4,
  CARTA_TEMATICA: 7,
  PONTO_CONTROLE: 10
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
  TYVEK: 8,
  SULFITE_75G: 9
}

// mapoteca.forma_entrega
const FORMA_ENTREGA = {
  CORREIOS: 1,
  ENTREGA_EM_MAOS: 2,
  RETIRADO_NO_CGEO: 3,
  EMAIL: 4,
  OUTROS: 5
}

// dominio.categoria_material (o que separa as tabelas 7.2 e 7.3 do RPCMTec)
const CATEGORIA_MATERIAL = {
  PAPEL: 1,
  TINTA: 2,
  // Material que não é insumo de impressão (cabeçote, peça). Não sai em
  // nenhuma das duas tabelas do RPCMTec.
  OUTRO: 3
}

// dominio.tipo_licitacao (4.4 GCALC DSG / 4.5 demais licitações)
const TIPO_LICITACAO = {
  GCALC_DSG: 1,
  PROPRIA: 2,
  PARTICIPANTE: 3
}

// dominio.classificacao_nc (4.2 PDR / 4.7 Extra-PDR)
const CLASSIFICACAO_NC = {
  PDR: 1,
  EXTRA_PDR: 2
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

// mapoteca.tipo_anexo_pedido
const TIPO_ANEXO_PEDIDO = {
  DOCUMENTO_SOLICITACAO: 1,
  ANEXO_DOCUMENTO: 2,
  COMPROVANTE_ENTREGA: 3,
  OUTROS: 4
}

// mapoteca.canal_recebimento (por onde a demanda de civil chega)
const CANAL_RECEBIMENTO = {
  OUVIDORIA_LAI: 1,
  EMAIL: 2,
  OFICIO: 3,
  OUTRO: 4
}

// dominio.situacao_extra_pit (3.3 do RPCMTec)
const SITUACAO_EXTRA_PIT = {
  PREVISTO: 1,
  EM_PRODUCAO: 2,
  ENVIADO: 3,
  CONCLUIDO: 4,
  CANCELADO: 5
}

// dominio.tipo_capacitacao: MINISTRADA sai na 2.6 e RECEBIDA na 6.2. São duas
// subseções do relatório e um cadastro só.
const TIPO_CAPACITACAO = {
  MINISTRADA: 1,
  RECEBIDA: 2
}

// dominio.tipo_status_execucao (projeto e lote)
const STATUS_EXECUCAO = {
  NAO_INICIADO: 1,
  EM_EXECUCAO: 2,
  CONCLUIDO: 3,
  CONCLUIDO_PARCIALMENTE: 4,
  PAUSADO: 5
}

// dominio.situacao_capacitacao
const SITUACAO_CAPACITACAO = {
  PREVISTA: 1,
  EM_EXECUCAO: 2,
  CONCLUIDA: 3,
  CANCELADA: 4
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
  CATEGORIA_MATERIAL,
  TIPO_LICITACAO,
  CLASSIFICACAO_NC,
  TIPO_LOCALIZACAO,
  TIPO_RELACIONAMENTO,
  TIPO_ANEXO_PEDIDO,
  CANAL_RECEBIMENTO,
  SITUACAO_EXTRA_PIT,
  TIPO_CAPACITACAO,
  SITUACAO_CAPACITACAO,
  STATUS_EXECUCAO
}
