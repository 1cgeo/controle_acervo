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
//
// NAO COMECA EM 1, e o buraco e deliberado. O code 1 era 'Pre cadastramento do
// pedido realizado' e saiu em 2026-08-08 com ZERO pedidos: a mapoteca nunca
// trabalhou o estagio "alguem avisou que vem um pedido". Renumerar as outras
// seis reescreveria a situacao dos 166 pedidos e mentiria sobre o que ja esta
// gravado em `auditoria.evento`, entao a lacuna fica.
//
// O 2 se chamava DOCUMENTO_RECEBIDO ('DIEx/Oficio do pedido recebido') e virou
// PEDIDO_RECEBIDO no mesmo dia. So o rotulo mudou: o code e o mesmo, porque o
// estagio existe -- ele so estava nomeado pelo DOCUMENTO, e o pedido de civil
// chega por e-mail, sem DIEx nenhum.
const SITUACAO_PEDIDO = {
  PEDIDO_RECEBIDO: 2,
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

// NÃO EXISTE `CATEGORIA_MATERIAL`, desde 2026-08-08. Ela espelhava
// `dominio.categoria_material`, e a única coisa que a categoria decidia era em
// qual das duas tabelas de insumo do RPCMTec o material sairia: a 7.2 (Papel) ou
// a 7.3 (Tintas). O chefe fundiu as duas na 7.2, e a 7.3 sumiu -- a tabela de
// domínio, a coluna e esta constante foram junto. Ver
// migrations/2026-08-08_livro_de_movimentos.sql.

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

// A CHAVE DO SIAFI DA NOTA DE EMPENHO: UG + GESTÃO + ANO + NÚMERO
// (`160382000012026NE000005`). É ela que `uniq_nota_empenho_chave_siafi` cobra,
// e o servidor DERIVA as duas primeiras: elas não são campo de formulário.
//
// A REGRA SAI DO DADO, e é a mesma que o backfill de
// `migrations/2026-08-07_identidade_da_nota_empenho.sql` mediu: quem empenha é a
// UG que RECEBEU o crédito, e o crédito da 167382 é emitido pela UG 167035, do
// mesmo modo que o da 160382 vem da 160035. A 167382 é unidade gestora distinta,
// com numeração própria começando do 1: as duas têm legitimamente uma
// 2026NE000005, e sem a UG na chave uma recusaria a outra.
//
// Os códigos são de `dominio.ug`, e não segredo nenhum: eles já estão no DDL e
// na migração, os dois versionados.
const CHAVE_SIAFI_NE = {
  // UG emitente da NC representativa -> UG que emite o empenho.
  UG_POR_EMITENTE: {
    167035: '167382'
  },
  // Qualquer outra emitente cai aqui. É o 1º CGEO.
  UG_PADRAO: '160382',
  // Hoje só existe a 00001. A coluna guarda a gestão mesmo assim, porque ela faz
  // parte da chave e o dia em que aparecer outra não pode custar outra migração.
  GESTAO_PADRAO: '00001'
}

// mapoteca.tipo_localizacao
const TIPO_LOCALIZACAO = {
  SECAO: 1,
  ALMOXARIFADO: 2,
  AQUISICAO_REALIZADA: 3,
  SALDO_NO_EMPENHO: 4
}

// ONDE O MATERIAL ESTÁ DE VERDADE. As quatro localizações são ETAPAS da vida do
// material, e não prateleiras: 'Aquisição realizada' e 'Saldo no empenho' são
// material COMPRADO e ainda não entregue. Somá-las ao estoque faria a Divisão
// contar, como disponível, resma que ainda está com o fornecedor -- e é por isso
// que tanto a coluna "Estoque atual" da 7.2 do RPCMTec quanto o alerta de
// estoque mínimo contam só estas duas.
const LOCALIZACOES_NA_CASA = [
  TIPO_LOCALIZACAO.SECAO,
  TIPO_LOCALIZACAO.ALMOXARIFADO
]

// mapoteca.tipo_movimento_material: o livro de movimentos do material.
//
// São as três coisas que acontecem com o material: ele CHEGA, MUDA de lugar e
// ACABA. Não há ajuste de saldo, e a ausência é a regra: o saldo tem de estar
// certo por estes três, e lançamento errado se conserta editando a linha errada.
//
// O CODE 4 NÃO ENTRA AQUI, e continua no banco. Ele foi a Contagem, extinta em
// 2026-08-08, e a linha do domínio sobrevive só para a auditoria antiga se
// traduzir. Ressuscitá-lo neste mapa daria ao Joi um valor que o CHECK do banco
// recusa, e a recusa chegaria como 500 em vez de 400.
const TIPO_MOVIMENTO_MATERIAL = {
  ENTRADA: 1,
  TRANSFERENCIA: 2,
  CONSUMO: 3
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
  TIPO_LICITACAO,
  CLASSIFICACAO_NC,
  CHAVE_SIAFI_NE,
  TIPO_LOCALIZACAO,
  LOCALIZACOES_NA_CASA,
  TIPO_MOVIMENTO_MATERIAL,
  TIPO_RELACIONAMENTO,
  TIPO_ANEXO_PEDIDO,
  CANAL_RECEBIMENTO,
  SITUACAO_EXTRA_PIT,
  TIPO_CAPACITACAO,
  SITUACAO_CAPACITACAO,
  STATUS_EXECUCAO
}
