'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../login')

const gerenciaCtrl = require('./gerencia_ctrl')
const gerenciaSchema = require('./gerencia_schema')

const router = express.Router()


router.get(
  '/dominio/tipo_posto_grad',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoPostoGrad()

    const msg = 'Domínio Tipo Posto Graduação retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_produto',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoProduto()

    const msg = 'Domínio Tipos de produto retornados com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_escala',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoEscala()

    const msg = 'Domínio Tipo Escala retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/subtipo_produto',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getSubtipoProduto()

    const msg = 'Domínio Subtipo de Produto retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/situacao_carregamento',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getSituacaoCarregamento()

    const msg = 'Domínio Situação de carregamento retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_arquivo',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoArquivo()

    const msg = 'Domínio Tipo de Arquivos retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_relacionamento',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoRelacionamento()

    const msg = 'Domínio Tipo de Relacionamento retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_status_arquivo',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoStatusArquivo()

    const msg = 'Domínio Tipo de Status do Arquivo retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_versao',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoVersao()

    const msg = 'Domínio Tipo de Versão retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.get(
  '/dominio/tipo_status_execucao',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaCtrl.getTipoStatusExecucao()

    const msg = 'Domínio Tipo de Status de Execução retornado com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

// AS TRES LEITURAS DO DIAGNOSTICO, em `consulta` desde 2026-09-05.
//
// Cobravam `gerente`, que e o piso mais alto do modulo, sem registro em
// `docs/decisoes.md` e sem teste que o fixasse. Pela regua de 2026-08-08
// (`consulta` LE as telas do modulo, `operador` LANCA, `gerente` responde pela
// area), leitura pura e `consulta`, e nenhuma das duas excecoes deliberadas da
// regua cobre este caso.
//
// O QUE ISSO ALARGA, e fica dito: as tres devolvem `acervo.volume_armazenamento.
// volume`, o caminho do share. Nao e exposicao nova -- `POST
// /api/acervo/prepare-download/arquivos` ja e `consulta` e devolve o mesmo
// caminho montado em `file_path`.
//
// O RECORTE DA TELA NAO MUDA: quem as consome e `#/acervo/administracao`, que e
// do ADMINISTRADOR e continua sendo. O piso da rota e o minimo que o servidor
// cobra, e nao o publico da tela.
router.get(
  '/arquivos_deletados',
  verifyPerfil('consulta'),
  schemaValidation({
    query: gerenciaSchema.paginationParams
  }),
  asyncHandler(async (req, res, next) => {
    const page = parseInt(req.query.page || 1);
    const limit = parseInt(req.query.limit || 20);
    
    const resultado = await gerenciaCtrl.getArquivosDeletados(page, limit);

    const msg = 'Arquivos deletados retornados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, resultado.data, null, {
      pagination: resultado.pagination
    });
  })
)

router.post(
  '/verificar_inconsistencias',
  verifyPerfil('gerente'),
  asyncHandler(async (req, res, next) => {
    const resultados = await gerenciaCtrl.verificarConsistencia(req.usuarioUuid, req.contexto)

    const msg = 'Verificação de consistência concluída com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, resultados)
  })
)

router.get(
  '/arquivos_incorretos',
  verifyPerfil('consulta'),
  schemaValidation({
    query: gerenciaSchema.paginationParams
  }),
  asyncHandler(async (req, res, next) => {
    const page = parseInt(req.query.page || 1);
    const limit = parseInt(req.query.limit || 20);
    
    const resultado = await gerenciaCtrl.getArquivosIncorretos(page, limit);

    const msg = 'Arquivos incorretos recuperados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, resultado.data, null, {
      pagination: resultado.pagination
    });
  })
)

router.get(
  '/downloads_deletados',
  verifyPerfil('consulta'),
  schemaValidation({
    query: gerenciaSchema.paginationParams
  }),
  asyncHandler(async (req, res, next) => {
    const page = parseInt(req.query.page || 1);
    const limit = parseInt(req.query.limit || 20);

    const resultado = await gerenciaCtrl.getDownloadsDeletados(page, limit);

    const msg = 'Downloads deletados retornados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, resultado.data, null, {
      pagination: resultado.pagination
    });
  })
);

module.exports = router
