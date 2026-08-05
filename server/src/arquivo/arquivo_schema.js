'use strict'

const Joi = require('joi')

const { TIPO_ARQUIVO, TIPO_ESCALA } = require('../utils/domain_constants')

const models = {}

// Espelha o trigger acervo.validate_version: aceita o formato moderno "X-YYYYY"
// e o legado "Xª Edição". As cartas antigas (acervo legado) são cadastradas como
// versões regulares usando "Xª Edição", portanto ambos os tipos aceitam os dois
// formatos (o trigger no banco aplica as regras mais profundas de sequência).
const VERSAO_HISTORICA_REGEX = /^([0-9]+-[A-Z]{1,5}|[0-9]+ª Edição)$/

// Dia de calendário, e não instante. Sem o `.raw()` o Joi converte
// 'AAAA-MM-DD' em meia-noite UTC, e a coluna TIMESTAMP WITH TIME ZONE guarda
// 21:00 do DIA ANTERIOR em UTC-3. Ver a explicação inteira, com o custo no
// RPCMTec, no cabeçalho de `produto/produto_schema.js`.
const dataCalendario = () => Joi.date().iso().raw()

// UM rótulo só, sem condicional por tipo de versão. Era um
// `alternatives().conditional` cujos dois ramos eram idênticos, ou seja, um
// desvio que não desviava nada: como o comentário acima já diz, os dois tipos
// aceitam os dois formatos, e quem aplica as regras mais fundas (sequência,
// ano) é o trigger `acervo.validate_version`.
const versaoSchema = Joi.string().pattern(VERSAO_HISTORICA_REGEX).required()

// O VÍNCULO COM O PIT: a meta que a folha cumpre e o mês em que ela prometeu
// ficar pronta.
//
// ELE FALTAVA AQUI, e o efeito era silencioso. O formulário de versão já
// oferecia a meta do PIT, e ao criar uma versão REGULAR (a que nasce com o
// arquivo, por estas rotas) o `schemaValidation` tolerante DESCARTAVA a chave:
// a pessoa escolhia a meta, recebia 201 e a versão ficava fora da conta do
// plano. O descarte ia para o log e para os "avisos" do envelope, que ninguém lê
// num cadastro bem-sucedido.
//
// `data_prevista` entra junto porque os dois são o mesmo vínculo. Numa versão
// Regular ela costuma vir vazia (a folha nasceu pronta, e o plano dela não foi
// declarado antes), e é legítimo: quem cobra a ausência é o diagnóstico do PIT.
//
// `demanda_extra_id` NÃO entra, e a omissão é deliberada: ele é exclusivo com a
// meta pelo CHECK `versao_plano_ou_excecao`, e aceitar os dois aqui obrigaria a
// espelhar a exclusão nesta árvore, que já é a mais funda do repositório. O
// Extra-PIT se liga pela tela de Extra-PIT, que existe para isso.
const vinculoComOPit = {
  meta_pit_id: Joi.number().integer().strict().allow(null),
  data_prevista: dataCalendario().allow(null)
}

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

// Versão nova de produto que JÁ EXISTE, com seus arquivos. Parametrizada pela
// forma do arquivo pelo mesmo motivo de produtoComVersoes logo abaixo: o que
// muda entre o upload pelo plugin e o envio pelo navegador é só o arquivo, e
// duas cópias desta árvore divergiriam no primeiro campo novo de versão.
const versaoDeProduto = camposArquivo => Joi.object().keys({
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
    data_criacao: dataCalendario().required(),
    // Espelha o CHECK data_edicao >= data_criacao de acervo.versao
    data_edicao: dataCalendario().min(Joi.ref('data_criacao')).required(),
    ...vinculoComOPit
  }).required(),
  arquivos: Joi.array().items(
    Joi.object().keys(camposArquivo)
  ).min(1).required()
});

models.prepareAddVersion = Joi.object().keys({
  versoes: Joi.array().items(versaoDeProduto(arquivoCampos)).min(1).required()
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
      data_criacao: dataCalendario().required(),
      // Espelha o CHECK data_edicao >= data_criacao de acervo.versao
      data_edicao: dataCalendario().min(Joi.ref('data_criacao')).required(),
      ...vinculoComOPit,
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

// Envio pelo NAVEGADOR: o cliente descreve o produto (ou a versão) e depois
// manda os bytes, um arquivo por requisição, em
// PUT /api/arquivo/upload-web/<sessao>/arquivo/<id>.
//
// `checksum` e `tamanho_mb` são RECUSADOS, e aqui a razão é ainda mais forte do
// que na catalogação in-place: lá o servidor precisa ler o arquivo no volume,
// aqui os bytes PASSAM pelo processo, então o SHA-256 sai do mesmo passo que
// escreve e não custa leitura nenhuma. O navegador, aliás, não teria como
// declará-lo: `crypto.subtle.digest` exige o arquivo inteiro na memória, e é
// justamente o arquivo grande que não cabe lá.
//
// Recusar em vez de ignorar, pela mesma razão de sempre: descartado em
// silêncio, o cliente acredita ter gravado o checksum que mandou.
// UM ENVIO, UMA REQUISIÇÃO. O corpo é multipart: o campo de texto `dados` traz
// este JSON, e os arquivos vêm no campo `arquivos`. Ver o cabeçalho de
// `upload_web.js` para por que não há sessão aqui.
//
// TRÊS COISAS O CLIENTE NÃO DECLARA, e cada recusa tem a sua razão:
//
//   `nome_arquivo` -- o nome físico sai de `acervo.nome_arquivo_padrao`, a mesma
//     função que o invariante `7a` usa para auditar. Auditor e escritor são a
//     mesma regra, como já está escrito em `renomearPadrao`. Deixar o cliente
//     nomear produzia uma linha de DEFECT no `7a` a cada envio.
//   `extensao` -- ela sai do NOME DO ARQUIVO que subiu. Declarada, poderia dizer
//     `tif` num PDF, e o acervo passaria a prometer um formato que não tem.
//   `checksum` e `tamanho_mb` -- o servidor os mede enquanto grava, no mesmo
//     passo, sem segunda leitura. O navegador nem teria como declarar o
//     checksum: `crypto.subtle.digest` exige o arquivo inteiro na memória.
//
// Recusar em vez de ignorar, pela razão de sempre: descartado em silêncio, o
// cliente acredita ter gravado o que mandou.
const recusado = (mensagem) => Joi.any().forbidden().messages({ 'any.unknown': mensagem });

const arquivoWebCampos = {
  uuid_arquivo: Joi.string().uuid().allow(null),
  // O rótulo humano do arquivo, que aparece na ficha. Não é o nome no volume.
  nome: Joi.string().required(),
  // Tileserver (9) é URL, não byte: não há o que enviar pelo navegador.
  tipo_arquivo_id: Joi.number().integer().invalid(TIPO_ARQUIVO.TILESERVER).required()
    .messages({
      'any.invalid': 'Tileserver é uma URL e não tem arquivo para enviar; cadastre-o pelo prepare-upload'
    }),
  metadado: Joi.object().allow(null),
  situacao_carregamento_id: Joi.number().integer(),
  descricao: Joi.string().allow(null, ''),
  crs_original: Joi.string().max(10).allow(null, ''),
  nome_arquivo: recusado(
    'O nome físico é derivado dos metadados por acervo.nome_arquivo_padrao (a mesma regra do invariante 7a); não o envie'
  ),
  extensao: recusado(
    'A extensão sai do nome do arquivo enviado; não a envie'
  ),
  checksum: recusado(
    'O checksum é medido pelo servidor enquanto ele grava os bytes no volume; não o envie'
  ),
  tamanho_mb: recusado(
    'O tamanho é medido pelo servidor enquanto ele grava os bytes no volume; não o envie'
  )
};

// A versão, sem o produto: os campos são os mesmos das rotas irmãs.
const versaoWeb = Joi.object().keys({
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
  data_criacao: dataCalendario().required(),
  // Espelha o CHECK data_edicao >= data_criacao de acervo.versao
  data_edicao: dataCalendario().min(Joi.ref('data_criacao')).required()
}).required();

const arquivosWeb = Joi.array().items(Joi.object().keys(arquivoWebCampos)).min(1).required();

/** Versão nova, com arquivos, em produto que já existe. */
models.uploadWebVersao = Joi.object().keys({
  // Sem `.strict()`, como na rota irma `versaoDeProduto`: `acervo.produto.id` e
  // BIGINT, o driver o entrega como STRING, e e assim que ele viaja no JSON da
  // ficha ate voltar aqui.
  produto_id: Joi.number().integer().positive().required(),
  versao: versaoWeb,
  arquivos: arquivosWeb
});

/**
 * Arquivos novos numa versão que JÁ EXISTE.
 *
 * É o que completa a versão PLANEJADA: ela nasce sem arquivo, de propósito, e o
 * arquivo entra nesta MESMA versão quando a produção terminar
 * (`domain_constants.js`). Sem esta rota, a folha planejada pela web ficava sem
 * como ser completada pela web.
 *
 * Não traz produto nem versão: os dois já estão gravados, e reenviá-los abriria
 * a porta para esta rota editar o que ela não deveria.
 */
models.uploadWebArquivos = Joi.object().keys({
  versao_id: Joi.number().integer().positive().required(),
  arquivos: arquivosWeb
});

/** Produto novo, com a primeira versão e os arquivos dela. */
models.uploadWebProduto = Joi.object().keys({
  produto: Joi.object().keys({
    nome: Joi.string().allow(null).required(),
    mi: Joi.string().allow(null).required(),
    inom: Joi.string().allow(null).required(),
    tipo_escala_id: Joi.number().integer().strict().required(),
    denominador_escala_especial: Joi.alternatives().conditional('tipo_escala_id', {
      is: TIPO_ESCALA.ESCALA_PERSONALIZADA,
      then: Joi.number().integer().strict().required(),
      otherwise: Joi.valid(null)
    }),
    tipo_produto_id: Joi.number().integer().required(),
    subtipo_produto_id: Joi.number().integer().allow(null).default(null),
    descricao: Joi.string().allow(null, ''),
    geom: Joi.string().required()
  }).required(),
  versao: versaoWeb,
  arquivos: arquivosWeb
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
// O cliente NAO manda nome nenhum: o nome sai de `acervo.nome_arquivo_padrao`,
// a mesma funcao que o invariante 7a usa para auditar. Nome vindo de fora e o
// que faz o acervo acumular sufixo improvisado por carga (_mil, _1-esp).
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
