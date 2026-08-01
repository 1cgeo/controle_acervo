// Path: arquivo\arquivo_schema.js
'use strict'

const Joi = require('joi')

const { TIPO_ARQUIVO, TIPO_ESCALA, TIPO_VERSAO } = require('../utils/domain_constants')

const models = {}

// Espelha o trigger acervo.validate_version: aceita o formato moderno "X-YYYYY"
// e o legado "Xª Edição". As cartas antigas (acervo legado) são cadastradas como
// versões regulares usando "Xª Edição", portanto ambos os tipos aceitam os dois
// formatos (o trigger no banco aplica as regras mais profundas de sequência).
const VERSAO_HISTORICA_REGEX = /^([0-9]+-[A-Z]{1,5}|[0-9]+ª Edição)$/

const versaoSchema = Joi.alternatives().conditional('tipo_versao_id', {
  is: TIPO_VERSAO.REGISTRO_HISTORICO,
  then: Joi.string().pattern(VERSAO_HISTORICA_REGEX).required(),
  otherwise: Joi.string().pattern(VERSAO_HISTORICA_REGEX).required()
})

// Campos comuns de arquivo, espelhando os CHECKs de acervo.arquivo:
// para Tileserver (tipo 9) nome_arquivo deve ser URL http(s) e
// extensao/tamanho_mb/checksum devem ser NULL; para os demais são obrigatórios
const arquivoCampos = {
  uuid_arquivo: Joi.string().uuid().allow(null),
  nome: Joi.string().required(),
  nome_arquivo: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: TIPO_ARQUIVO.TILESERVER,
    then: Joi.string().pattern(/^https?:\/\//).required(),
    otherwise: Joi.string().required()
  }),
  tipo_arquivo_id: Joi.number().integer().required(),
  extensao: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: TIPO_ARQUIVO.TILESERVER,
    then: Joi.valid(null),
    otherwise: Joi.string().required()
  }),
  tamanho_mb: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: TIPO_ARQUIVO.TILESERVER,
    then: Joi.valid(null),
    otherwise: Joi.number().required()
  }),
  checksum: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: TIPO_ARQUIVO.TILESERVER,
    then: Joi.valid(null),
    otherwise: Joi.string().required()
  }),
  metadado: Joi.object().allow(null),
  situacao_carregamento_id: Joi.number().integer(),
  descricao: Joi.string().allow(null, ''),
  crs_original: Joi.string().max(10).allow(null, '')
}

const fileSchema = Joi.object().keys({
  ...arquivoCampos,
  versao_id: Joi.number().integer().required() // Required versao_id for each file
});

models.arquivoAtualizacao = Joi.object().keys({
  id: Joi.number().integer().strict().required(),
  nome: Joi.string().required(),
  tipo_arquivo_id: Joi.number().integer().strict().required(),
  volume_armazenamento_id: Joi.alternatives().conditional('tipo_arquivo_id', {
    is: TIPO_ARQUIVO.TILESERVER,
    then: Joi.valid(null).required(),
    otherwise: Joi.number().integer().strict().required()
  }),
  metadado: Joi.object().required(),
  tipo_status_id: Joi.number().integer().strict().required(),
  situacao_carregamento_id: Joi.number().integer().strict().required(),
  descricao: Joi.string().allow('').required(),
  crs_original: Joi.string().max(10).allow(null, '')
});

models.arquivoIds = Joi.object().keys({
  arquivo_ids: Joi.array()
    .items(Joi.number().integer().strict().required())
    .unique()
    .required()
    .min(1),
  motivo_exclusao: Joi.string().required()
});

models.prepareAddFiles = Joi.object().keys({
  arquivos: Joi.array().items(fileSchema).min(1).required()
});

// Substituicao de conteudo de arquivos de versoes EXISTENTES, sem criar nova
// versao: mesmo corpo do add-files (cada arquivo com versao_id), mas a semantica
// e "upsert por slot" -- substitui (soft-delete + insert atomico no confirm) o
// arquivo que ocupa o slot (versao_id, nome_arquivo, extensao), ou insere se vazio.
models.prepareReplaceFiles = Joi.object().keys({
  arquivos: Joi.array().items(fileSchema).min(1).required()
});

models.prepareAddVersion = Joi.object().keys({
  versoes: Joi.array().items(
    Joi.object().keys({
      produto_id: Joi.number().integer().required(),
      versao: Joi.object().keys({
        uuid_versao: Joi.string().uuid().allow(null),
        versao: versaoSchema,
        nome: Joi.string().allow(null).required(),
        tipo_versao_id: Joi.number().integer().required(),
        subtipo_produto_id: Joi.number().integer().required(),
        lote_id: Joi.number().integer().allow(null),
        metadado: Joi.object().allow(null),
        descricao: Joi.string().allow(null, ''),
        orgao_produtor: Joi.string().required(),
        palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
        data_criacao: Joi.date().iso().required(),
        // Espelha o CHECK data_edicao >= data_criacao de acervo.versao
        data_edicao: Joi.date().iso().min(Joi.ref('data_criacao')).required()
      }).required(),
      arquivos: Joi.array().items(
        Joi.object().keys(arquivoCampos)
      ).min(1).required()
    })
  ).min(1).required()
});

// Produto novo com suas versões e arquivos. O que muda entre o upload e a
// catalogação in-place é SÓ a forma do arquivo, então ela é o parâmetro: duas
// cópias desta árvore divergiriam no primeiro campo novo de produto ou versão.
const produtoComVersoes = camposArquivo => Joi.object().keys({
  produto: Joi.object().keys({
    nome: Joi.string().allow(null).required(),
    mi: Joi.string().allow(null).required(),
    inom: Joi.string().allow(null).required(),
    tipo_escala_id: Joi.number().integer().strict().required(),
    // Espelha o CHECK de acervo.produto: denominador obrigatório
    // apenas para escala personalizada (tipo 5), NULL nos demais
    denominador_escala_especial: Joi.alternatives().conditional('tipo_escala_id', {
      is: TIPO_ESCALA.ESCALA_PERSONALIZADA,
      then: Joi.number().integer().strict().required(),
      otherwise: Joi.valid(null)
    }),
    tipo_produto_id: Joi.number().integer().required(),
    // Subtipo que define a identidade do produto (ex.: 24 = Carta Topografica
    // Militar); NULL = produto comum, identidade so por (mi, escala, tipo).
    subtipo_produto_id: Joi.number().integer().allow(null).default(null),
    descricao: Joi.string().allow(null, ''),
    geom: Joi.string().required()
  }).required(),
  versoes: Joi.array().items(
    Joi.object().keys({
      uuid_versao: Joi.string().uuid().allow(null),
      versao: versaoSchema,
      nome: Joi.string().allow(null).required(),
      tipo_versao_id: Joi.number().integer().required(),
      subtipo_produto_id: Joi.number().integer().required(),
      lote_id: Joi.number().integer().allow(null),
      metadado: Joi.object().allow(null),
      descricao: Joi.string().allow(null, ''),
      orgao_produtor: Joi.string().required(),
      palavras_chave: Joi.array().items(Joi.string()).allow(null).default([]),
      data_criacao: Joi.date().iso().required(),
      data_edicao: Joi.date().iso().min(Joi.ref('data_criacao')).required(),
      arquivos: Joi.array().items(
        Joi.object().keys(camposArquivo)
      ).min(1).required()
    })
  ).min(1).required()
});

models.prepareAddProduct = Joi.object().keys({
  produtos: Joi.array().items(produtoComVersoes(arquivoCampos)).min(1).required()
});

// Catalogação de produto que JÁ ESTÁ no volume.
//
// Duas diferenças de contrato em relação ao prepare-upload/product, e as duas
// vêm de não haver transferência:
//
//   - `volume_armazenamento_id` é OBRIGATÓRIO e vem do cliente. No upload o
//     volume é o primário do tipo de produto, porque o servidor escolhe para
//     onde copiar. Aqui o volume é onde o arquivo JÁ ESTÁ: é dado de entrada, e
//     derivá-lo do tipo tornaria impossível catalogar num volume que não é o
//     primário daquele tipo (e `idx_unique_primario` só admite um por tipo).
//   - `checksum` e `tamanho_mb` são RECUSADOS. Quem mede é o servidor, que lê o
//     arquivo uma vez. Aceitar do cliente custaria a segunda leitura do mesmo
//     byte pelo mesmo share só para conferir uma cópia que não aconteceu.
//     Recusar em vez de ignorar: descartado em silêncio, o cliente acredita ter
//     gravado o checksum que mandou.
const arquivoCatalogoCampos = {
  nome: Joi.string().required(),
  // Caminho RELATIVO à raiz do volume, com barra normal e subpasta inclusa
  // (`LOTE_1/IMAGENS/Ortoimagem_MI 2965-1`). O servidor recusa travessia.
  nome_arquivo: Joi.string().required(),
  // Tileserver (9) é URL, não byte em volume: não há o que catalogar in-place.
  tipo_arquivo_id: Joi.number().integer().invalid(TIPO_ARQUIVO.TILESERVER).required()
    .messages({
      'any.invalid': 'Tileserver não tem arquivo físico no volume; cadastre-o pelo prepare-upload'
    }),
  extensao: Joi.string().required(),
  metadado: Joi.object().allow(null),
  situacao_carregamento_id: Joi.number().integer(),
  descricao: Joi.string().allow(null, ''),
  crs_original: Joi.string().max(10).allow(null, ''),
  checksum: Joi.any().forbidden().messages({
    'any.unknown': 'O checksum é medido pelo servidor ao ler o arquivo no volume; não o envie'
  }),
  tamanho_mb: Joi.any().forbidden().messages({
    'any.unknown': 'O tamanho é medido pelo servidor ao ler o arquivo no volume; não o envie'
  })
};

models.catalogarProduto = Joi.object().keys({
  volume_armazenamento_id: Joi.number().integer().strict().positive().required(),
  // O teto existe porque a requisição fica aberta enquanto o servidor lê os
  // bytes: quem carrega um lote inteiro chama em laço, e cada chamada é
  // atômica. Sem sessão, a retomada é a própria requisição seguinte.
  produtos: Joi.array().items(produtoComVersoes(arquivoCatalogoCampos)).min(1).max(200).required()
});

models.confirmUpload = Joi.object().keys({
  session_uuid: Joi.string().uuid().required()
});

models.cancelUpload = Joi.object().keys({
  session_uuid: Joi.string().uuid().required()
});

// Recompressao sem perda: o arquivo no volume muda de bytes (compressao), mas
// nao de pixel. So a lista de ids viaja. O checksum e o tamanho NAO vem do
// cliente: o servidor rele o arquivo no volume e mede. Ver arquivo_ctrl.
models.atualizarChecksum = Joi.object().keys({
  arquivo_ids: Joi.array()
    .items(Joi.number().integer().strict().positive().required())
    .unique()
    .min(1)
    .max(500)
    .required(),
  motivo: Joi.string().min(5).required()
});

// Renomeia o arquivo fisico para o padrao derivado dos metadados.
//
// O cliente NAO manda nome nenhum: o nome sai de acervo.nome_arquivo_padrao, a
// mesma funcao que o invariante 7a usa para auditar. Mandar o nome de fora foi o
// que permitiu, ate 2026-07-29, que o acervo acumulasse sufixo improvisado por
// carga (_mil, _1-esp, _st27_<hash>).
//
// `arquivo_ids` e opcional. Sem ele, a rota pega os divergentes por ordem de id,
// ate `limite`. E para chamar em laco ate `restantes` zerar: uma passada inteira
// numa requisicao so seguraria a conexao por dezenas de minutos.
models.renomearPadrao = Joi.object().keys({
  arquivo_ids: Joi.array()
    .items(Joi.number().integer().strict().positive().required())
    .unique()
    .min(1)
    .max(5000),
  limite: Joi.number().integer().min(1).max(5000).default(500),
  dry_run: Joi.boolean().default(true),
  motivo: Joi.string().min(5).required()
});

module.exports = models
