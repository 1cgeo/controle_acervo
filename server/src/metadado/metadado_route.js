'use strict'

// MODULO METADADO: o CRUD das 16 tabelas de `metadado` e as quatro rotas que
// GERAM a saida (o JSON de edicao e o XML de metadado), por lote ou por versao.
//
// A GUARDA, E ELA MUDOU EM RELACAO A ORIGEM. No SAP havia dois niveis: as seis
// listas de dominio nao tinham guarda NENHUMA, e o resto era `verifyAdmin`. As
// duas rotas por uuid (`/json_edicao/produto/:uuid` e `/xml/produto/:uuid`)
// eram PUBLICAS de proposito, para uma ferramenta buscar o arquivo pronto.
//
// Aqui os dois niveis viraram `consulta` e `gerente` no modulo `producao`, e
// rota publica NAO existe:
//
//   consulta - LE as telas do modulo: as listas de dominio, o cadastro de cada
//              tabela e a saida gerada (o JSON de edicao e o XML). Gerar e ler:
//              nada disso muda uma linha do banco.
//   gerente  - ESCREVE. Toda declaracao de metadado responde pela ficha que sai
//              impressa na moldura e pelo XML que viaja com o produto, e o
//              `verifyAdmin` da origem se traduz aqui em quem responde pela
//              area.
//
// O CORTE DA ROTA PUBLICA E DELIBERADO. O acervo nao tem rota anonima, e o JSON
// de edicao expoe servidor, porta e nome do banco de edicao (sem credenciais):
// deixa-lo aberto seria publicar a topologia da producao para quem passasse. Um
// consumidor automatizado usa o token que ja usa para o resto do sistema.
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele e 'acervo':
// uma rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, sem erro
// de sintaxe, sem teste vermelho e sem nada na tela. Quem cobra isso arquivo a
// arquivo e `__tests__/routes/metadado/modulo_na_rota.test.js`.
//
// ORDEM DAS ROTAS: as literais vem antes das que tem parametro. Aqui nao ha
// `/:uuid` na raiz (a origem tinha uma, comentada), entao nenhuma literal corre
// risco de ser engolida; a regra continua valendo para quem acrescentar uma.

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

// O validador ESTRITO, e nao o tolerante de `utils/schema_validation.js`. Ele
// recusa a chave desconhecida no corpo com 400 e sugere o nome declarado mais
// parecido, em vez de descarta-la em silencio. Aqui isso vale mais do que em
// qualquer outro modulo: o corpo de `informacoes_edicao` tem 19 campos, e
// `pec_planimetrico` digitado como `pec_planimetrica` sairia da ficha impressa
// sem que ninguem percebesse ate a carta estar na moldura.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyPerfil } = require('../login')

const metadadoCtrl = require('./metadado_ctrl')
const metadadoSchema = require('./metadado_schema')

const router = express.Router()

// --- Dominios da norma -------------------------------------------------------
//
// O `nome` destas cinco NAO se traduz nem se acentua: ele sai literal para
// dentro do XML, onde a ISO19115 espera 'ultraSecreto' e
// 'intellectualPropertyRights' exatamente assim.

router.get(
  '/tipo_palavra_chave',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarTipoPalavraChave()
    return res.sendJsonAndLog(true, 'Tipos de palavra-chave retornados com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/especificacao',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarEspecificacao()
    return res.sendJsonAndLog(true, 'Especificações retornadas com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/datum_vertical',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarDatumVertical()
    return res.sendJsonAndLog(true, 'Datum vertical retornados com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/codigo_restricao',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarCodigoRestricao()
    return res.sendJsonAndLog(true, 'Códigos de restrição retornados com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/codigo_classificacao',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarCodigoClassificacao()
    return res.sendJsonAndLog(true, 'Códigos de classificação retornados com sucesso', httpCode.OK, dados)
  })
)

// --- Organizacao (os cinco CGEO) ---------------------------------------------
//
// Nao ha POST nem DELETE: os cinco Centros sao semeados por `er/metadado.sql`, e
// o que se edita e o CONTATO institucional de cada um -- endereco postal,
// telefone e site publico, o mesmo que esta na porta de cada Centro. E o que o
// XML publica como produtor e como distribuidor, que nem sempre sao a mesma OM.

router.get(
  '/organizacao',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarOrganizacao()
    return res.sendJsonAndLog(true, 'Organizações retornadas com sucesso', httpCode.OK, dados)
  })
)

router.put(
  '/organizacao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.organizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarOrganizacao(req.body.organizacoes, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Organizações atualizadas com sucesso', httpCode.OK)
  })
)

// --- Usuario do metadado -----------------------------------------------------
//
// NAO E UMA CONTA: `dgeo.usuario` responde quem entra no sistema, e esta tabela
// responde que nome, que funcao e que OM saem impressos no XML para a mesma
// pessoa. Apagar uma linha daqui nao apaga conta nenhuma.

router.get(
  '/usuario',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarUsuario()
    return res.sendJsonAndLog(true, 'Usuários do metadado retornados com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/usuario',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.usuario }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.criarUsuario(req.body.usuario, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Usuários do metadado criados com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/usuario',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.usuarioAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarUsuario(req.body.usuario, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Usuários do metadado atualizados com sucesso', httpCode.OK)
  })
)

router.delete(
  '/usuario',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.usuarioIds }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.apagarUsuario(req.body.usuarios_ids, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(true, 'Usuários do metadado excluídos com sucesso', httpCode.OK)
  })
)

// --- Informacoes do produto --------------------------------------------------

router.get(
  '/informacoes_produto',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarInformacoesProduto()
    return res.sendJsonAndLog(true, 'Informações do produto retornadas com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/informacoes_produto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.informacoesProduto }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.criarInformacoesProduto(
      req.body.informacoes_produto, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Informações do produto criadas com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/informacoes_produto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.informacoesProdutoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarInformacoesProduto(
      req.body.informacoes_produto, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Informações do produto atualizadas com sucesso', httpCode.OK)
  })
)

router.delete(
  '/informacoes_produto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.informacoesProdutoIds }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.apagarInformacoesProduto(
      req.body.informacoes_produto_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Informações do produto excluídas com sucesso', httpCode.OK)
  })
)

// --- Responsavel por fase ----------------------------------------------------

router.get(
  '/responsavel_fase_produto',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarResponsavelFaseProduto()
    return res.sendJsonAndLog(true, 'Responsáveis por fase retornados com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/responsavel_fase_produto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.responsavelFaseProduto }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.criarResponsavelFaseProduto(
      req.body.responsavel_fase_produto, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Responsáveis por fase criados com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/responsavel_fase_produto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.responsavelFaseProdutoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarResponsavelFaseProduto(
      req.body.responsavel_fase_produto, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Responsáveis por fase atualizados com sucesso', httpCode.OK)
  })
)

router.delete(
  '/responsavel_fase_produto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.responsavelFaseProdutoIds }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.apagarResponsavelFaseProduto(
      req.body.responsavel_fase_produto_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Responsáveis por fase excluídos com sucesso', httpCode.OK)
  })
)

// --- Palavra-chave -----------------------------------------------------------
//
// A UNICA TABELA DO SCHEMA SEM NIVEL DE LOTE. Toponimo e descricao sao por
// FOLHA, e herdar a palavra-chave do lote faria toda folha dele se descrever
// pelo mesmo lugar.

router.get(
  '/palavra_chave_produto',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarPalavraChaveProduto()
    return res.sendJsonAndLog(true, 'Palavras-chave retornadas com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/palavra_chave_produto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.palavraChaveProduto }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.criarPalavraChaveProduto(
      req.body.palavras_chave_produto, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Palavras-chave criadas com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/palavra_chave_produto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.palavraChaveProdutoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarPalavraChaveProduto(
      req.body.palavras_chave_produto, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Palavras-chave atualizadas com sucesso', httpCode.OK)
  })
)

router.delete(
  '/palavra_chave_produto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.palavraChaveProdutoIds }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.apagarPalavraChaveProduto(
      req.body.palavras_chave_produto_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Palavras-chave excluídas com sucesso', httpCode.OK)
  })
)

// --- Creditos QPT ------------------------------------------------------------
//
// E CATALOGO, e nao linha por produto: um mesmo quadro de creditos serve a todos
// os produtos que a mesma equipe assinou.

router.get(
  '/creditos_qpt',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarCreditosQpt()
    return res.sendJsonAndLog(true, 'Créditos QPT retornados com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/creditos_qpt',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.creditosQpt }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.criarCreditosQpt(
      req.body.creditos_qpt, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Créditos QPT criados com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/creditos_qpt',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.creditosQptAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarCreditosQpt(
      req.body.creditos_qpt, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Créditos QPT atualizados com sucesso', httpCode.OK)
  })
)

router.delete(
  '/creditos_qpt',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.creditosQptIds }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.apagarCreditosQpt(
      req.body.creditos_qpt_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Créditos QPT excluídos com sucesso', httpCode.OK)
  })
)

// --- Informacoes de edicao ---------------------------------------------------
//
// E daqui que sai quase toda a ficha ET-PCDG: PEC, origem da altimetria, quadro
// de fases, DPI e o MDE usado.

router.get(
  '/informacoes_edicao',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarInformacoesEdicao()
    return res.sendJsonAndLog(true, 'Informações de edição retornadas com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/informacoes_edicao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.informacoesEdicao }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.criarInformacoesEdicao(
      req.body.informacoes_edicao, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Informações de edição criadas com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/informacoes_edicao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.informacoesEdicaoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarInformacoesEdicao(
      req.body.informacoes_edicao, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Informações de edição atualizadas com sucesso', httpCode.OK)
  })
)

router.delete(
  '/informacoes_edicao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.informacoesEdicaoIds }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.apagarInformacoesEdicao(
      req.body.informacoes_edicao_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Informações de edição excluídas com sucesso', httpCode.OK)
  })
)

// --- Imagens da carta ortoimagem ---------------------------------------------
//
// As tres secoes a seguir nao se aplicam a carta topografica, e ficam vazias
// para ela. Nao ha CHECK que cubra isso, e nao ha como haver: o subtipo do
// produto mora no acervo, dois saltos acima, e a regra e da geracao da saida.

router.get(
  '/imagens_carta_ortoimagem',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarImagensCartaOrtoimagem()
    return res.sendJsonAndLog(true, 'Imagens da carta ortoimagem retornadas com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/imagens_carta_ortoimagem',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.imagensCartaOrtoimagem }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.criarImagensCartaOrtoimagem(
      req.body.imagens_carta_ortoimagem, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Imagens da carta ortoimagem criadas com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/imagens_carta_ortoimagem',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.imagensCartaOrtoimagemAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarImagensCartaOrtoimagem(
      req.body.imagens_carta_ortoimagem, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Imagens da carta ortoimagem atualizadas com sucesso', httpCode.OK)
  })
)

router.delete(
  '/imagens_carta_ortoimagem',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.imagensCartaOrtoimagemIds }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.apagarImagensCartaOrtoimagem(
      req.body.imagens_carta_ortoimagem_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Imagens da carta ortoimagem excluídas com sucesso', httpCode.OK)
  })
)

// --- Classes complementares da ortoimagem ------------------------------------

router.get(
  '/classes_complementares_orto',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarClassesComplementaresOrto()
    return res.sendJsonAndLog(true, 'Classes complementares retornadas com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/classes_complementares_orto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.classesComplementaresOrto }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.criarClassesComplementaresOrto(
      req.body.classes_complementares_orto, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Classes complementares criadas com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/classes_complementares_orto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.classesComplementaresOrtoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarClassesComplementaresOrto(
      req.body.classes_complementares_orto, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Classes complementares atualizadas com sucesso', httpCode.OK)
  })
)

router.delete(
  '/classes_complementares_orto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.classesComplementaresOrtoIds }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.apagarClassesComplementaresOrto(
      req.body.classes_complementares_orto_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Classes complementares excluídas com sucesso', httpCode.OK)
  })
)

// --- Perfil de classes complementares ----------------------------------------
//
// "perfil" aqui e heranca do SAP e NAO tem relacao com `dominio.tipo_perfil`: e
// a escolha de qual lista do catalogo vale para qual versao ou lote.

router.get(
  '/perfil_classes_complementares_orto',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarPerfilClassesComplementaresOrto()
    return res.sendJsonAndLog(true, 'Perfis de classes complementares retornados com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/perfil_classes_complementares_orto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.perfilClassesComplementaresOrto }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.criarPerfilClassesComplementaresOrto(
      req.body.perfil_classes_complementares_orto, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Perfis de classes complementares criados com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/perfil_classes_complementares_orto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.perfilClassesComplementaresOrtoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarPerfilClassesComplementaresOrto(
      req.body.perfil_classes_complementares_orto, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Perfis de classes complementares atualizados com sucesso', httpCode.OK)
  })
)

router.delete(
  '/perfil_classes_complementares_orto',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.perfilClassesComplementaresOrtoIds }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.apagarPerfilClassesComplementaresOrto(
      req.body.perfil_classes_complementares_orto_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Perfis de classes complementares excluídos com sucesso', httpCode.OK)
  })
)

// --- Sensores da carta ortoimagem --------------------------------------------
//
// Mais de uma linha por produto e o caso NORMAL: um mosaico costura imagens de
// plataformas diferentes, e a ficha lista todas.

router.get(
  '/sensor_carta_ortoimagem',
  verifyPerfil('consulta', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.listarSensorCartaOrtoimagem()
    return res.sendJsonAndLog(true, 'Sensores da carta ortoimagem retornados com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/sensor_carta_ortoimagem',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.sensorCartaOrtoimagem }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.criarSensorCartaOrtoimagem(
      req.body.sensor_carta_ortoimagem, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Sensores da carta ortoimagem criados com sucesso', httpCode.Created, dados)
  })
)

router.put(
  '/sensor_carta_ortoimagem',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.sensorCartaOrtoimagemAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.atualizarSensorCartaOrtoimagem(
      req.body.sensor_carta_ortoimagem, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Sensores da carta ortoimagem atualizados com sucesso', httpCode.OK)
  })
)

router.delete(
  '/sensor_carta_ortoimagem',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: metadadoSchema.sensorCartaOrtoimagemIds }),
  asyncHandler(async (req, res, next) => {
    await metadadoCtrl.apagarSensorCartaOrtoimagem(
      req.body.sensor_carta_ortoimagem_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Sensores da carta ortoimagem excluídos com sucesso', httpCode.OK)
  })
)

// =============================================================================
// A SAIDA
// =============================================================================
//
// AS QUATRO ROTAS ABAIXO SAO AS UNICAS COM PARAMETRO DE CAMINHO, e ficam por
// ultimo. Nenhuma delas ESCREVE: as duas de lote geram uma entrada por versao do
// lote, e uma folha que falha nao derruba as outras -- o erro dela sai no campo
// `erros` da linha dela.
//
// O `:uuid` E O `acervo.versao.uuid_versao`, e nao o do produto. O que se
// publica e uma EDICAO: a mesma folha reeditada em outro ano tem outro resumo,
// outra data de criacao e outro responsavel, e por isso outro metadado.

router.get(
  '/json_edicao/lote/:loteId',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: metadadoSchema.loteIdParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.gerarJsonEdicaoLote(req.params.loteId)
    return res.sendJsonAndLog(true, 'JSON de edição do lote gerado com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/json_edicao/produto/:uuid',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: metadadoSchema.uuidParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.gerarJsonEdicaoVersao(req.params.uuid)
    return res.sendJsonAndLog(true, 'JSON de edição gerado com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/xml/lote/:loteId',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: metadadoSchema.loteIdParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.gerarMetadadoXmlLote(req.params.loteId)
    return res.sendJsonAndLog(true, 'Metadados XML do lote gerados com sucesso', httpCode.OK, dados)
  })
)

router.get(
  '/xml/produto/:uuid',
  verifyPerfil('consulta', 'producao'),
  schemaValidation({ params: metadadoSchema.uuidParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await metadadoCtrl.gerarMetadadoXmlVersao(req.params.uuid)
    return res.sendJsonAndLog(true, 'Metadados XML gerados com sucesso', httpCode.OK, dados)
  })
)

module.exports = router
