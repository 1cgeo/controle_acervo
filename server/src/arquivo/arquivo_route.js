// Path: arquivo\arquivo_route.js
'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyPerfil, verifyAdmin } = require('../login')

const arquivoCtrl = require('./arquivo_ctrl')
const arquivoSchema = require('./arquivo_schema')

const router = express.Router()

router.put(
  '/arquivo',
  verifyPerfil('operador'),
  schemaValidation({
    body: arquivoSchema.arquivoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await arquivoCtrl.atualizaArquivo(req.body, req.usuarioUuid);

    const msg = 'Arquivo atualizado com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.delete(
  '/arquivo',
  verifyPerfil('gerente'),
  schemaValidation({
    body: arquivoSchema.arquivoIds
  }),
  asyncHandler(async (req, res, next) => {
    await arquivoCtrl.deleteArquivos(req.body.arquivo_ids, req.body.motivo_exclusao, req.usuarioUuid);
    const msg = 'Arquivos deletados com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.post(
  '/prepare-upload/files',
  verifyPerfil('operador'),
  schemaValidation({
    body: arquivoSchema.prepareAddFiles
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.prepareAddFiles(req.body, req.usuarioUuid);
    const msg = 'Upload de arquivos preparado com sucesso. Transfira os arquivos e utilize confirm-upload para confirmar.';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/prepare-upload/version',
  verifyPerfil('operador'),
  schemaValidation({
    body: arquivoSchema.prepareAddVersion
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.prepareAddVersion(req.body, req.usuarioUuid);
    const msg = 'Upload de versão preparado com sucesso. Transfira os arquivos e utilize confirm-upload para confirmar.';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/prepare-upload/product',
  verifyPerfil('operador'),
  schemaValidation({
    body: arquivoSchema.prepareAddProduct
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.prepareAddProduct(req.body, req.usuarioUuid);
    const msg = 'Upload de produto preparado com sucesso. Transfira os arquivos e utilize confirm-upload para confirmar.';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/prepare-upload/replace-files',
  verifyPerfil('operador'),
  schemaValidation({
    body: arquivoSchema.prepareReplaceFiles
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.prepareReplaceFiles(req.body, req.usuarioUuid);
    const msg = 'Substituição de arquivos preparada com sucesso. Transfira os arquivos e utilize confirm-upload para confirmar.';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/confirm-upload',
  verifyPerfil('operador'),
  schemaValidation({
    body: arquivoSchema.confirmUpload
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.confirmUpload(req.body.session_uuid, req.usuarioUuid);
    
    let msg = 'Validação de upload concluída com sucesso';
    if (dados.status === 'failed') {
      msg = 'Upload falhou na validação: ' + dados.error_message;
    }
    
    return res.sendJsonAndLog(dados.status === 'completed', msg, httpCode.OK, dados);
  })
);

router.get(
  '/problem-uploads',
  verifyPerfil('operador'),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.getProblemUploads();
    const msg = 'Uploads com problemas recuperados com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);


router.get(
  '/upload-sessions',
  verifyPerfil('operador'),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.getUploadSessions();

    const msg = 'Sessões de upload retornadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/cancel-upload',
  verifyPerfil('operador'),
  schemaValidation({
    body: arquivoSchema.cancelUpload
  }),
  asyncHandler(async (req, res, next) => {
    await arquivoCtrl.cancelUpload(req.body.session_uuid, req.usuarioUuid);

    const msg = 'Sessão de upload cancelada com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

// Recompressao sem perda do acervo: o GeoTIFF e reescrito com COMPRESS=DEFLATE,
// o pixel continua identico, mas o SHA-256 do arquivo muda. Esta rota manda o
// servidor RELER o arquivo no volume e gravar o que ele mesmo mediu. O cliente
// nao declara checksum nem tamanho. Preserva id, uuid_arquivo e historico de
// download (ao contrario de prepare-upload/replace-files, que troca o arquivo).
router.post(
  '/atualizar-checksum',
  verifyAdmin,
  schemaValidation({
    body: arquivoSchema.atualizarChecksum
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.atualizarChecksum(
      req.body.arquivo_ids,
      req.body.motivo,
      req.usuarioUuid
    );

    const msg = 'Checksum e tamanho atualizados por releitura do volume';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

module.exports = router
