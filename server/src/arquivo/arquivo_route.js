'use strict'

const express = require('express')

const { schemaValidation, asyncHandler, httpCode, AppError } = require('../utils')

const { verifyPerfil, verifyAdmin } = require('../login')

const arquivoCtrl = require('./arquivo_ctrl')
const arquivoSchema = require('./arquivo_schema')
const {
  uploadWebProduto, uploadWebVersao, uploadWebArquivos, planoDaRequisicao, limparParciais
} = require('./upload_web')

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

// ---------------------------------------------------------------------------
// Envio pelo NAVEGADOR. O byte sobe por HTTP e quem o grava no volume e o
// SERVIDOR, e numa requisicao so.
//
// Ate 2026-08-01 nenhuma rota gravava byte em volume: o prepare-upload reservava
// o destino, o PLUGIN copiava por SMB e o confirm-upload conferia o checksum que
// o cliente declarara. Quem nao tem o volume montado (e nao tem o QGIS aberto)
// ficava de fora do cadastro. O servidor ja ALCANCA o volume -- o download faz
// createReadStream e pipe --, entao o que faltava era o sentido contrario.
//
// SEM SESSAO, e isso e o ponto. O par prepare/confirm existe para cobrir a
// janela em que o cliente sai para copiar os bytes por conta propria. Aqui os
// bytes vem DENTRO da requisicao: nao ha janela, e portanto nao ha o que a
// sessao cobrir -- o mesmo raciocinio que `/catalogar/product` ja registrou. O
// desenho anterior usava a sessao mesmo assim, e cobrava por isso: linha
// pendurada em `upload_session` e `.parcial` no volume a cada envio abandonado.
//
// O que se perde e reenviar SO o arquivo que falhou. Aceitavel: o teto do
// caminho web e de poucos GB e a mediana em producao e de 6 a 11 MB; acima
// disso o caminho continua sendo o plugin.
//
// O CLIENTE NAO NOMEIA, NAO DECLARA EXTENSAO E NAO DECLARA CHECKSUM. O nome
// fisico sai de `acervo.nome_arquivo_padrao`, a mesma funcao que o invariante
// `7a` audita; a extensao sai do arquivo enviado; o checksum sai do mesmo passo
// que grava. Deixar o cliente nomear produzia uma linha de DEFECT no `7a` a cada
// envio -- medido em 2026-08-02.
//
// O campo `dados` (JSON) tem de vir ANTES dos arquivos no multipart: e dele que
// sai o destino de cada byte.
router.post(
  '/upload-web/produto',
  verifyPerfil('operador'),
  // Sem `schemaValidation` de corpo: ele roda antes do multer, e antes do multer
  // o multipart ainda nao foi parseado. O Joi e chamado dentro do middleware,
  // com o MESMO schema, assim que o campo `dados` existe.
  ...uploadWebProduto,
  asyncHandler(async (req, res, next) => {
    const plano = await planoDaRequisicao(req);
    try {
      const dados = await arquivoCtrl.enviarWeb(plano, req.usuarioUuid);
      const msg = `Produto cadastrado com a versão ${plano.versao.versao} e ` +
        `${dados.arquivos.length} arquivo(s) gravado(s) no volume ${dados.volume} ` +
        `como "${dados.nome_arquivo}"`;
      return res.sendJsonAndLog(true, msg, httpCode.Created, dados);
    } catch (erro) {
      await limparParciais(plano, { usuario_uuid: req.usuarioUuid });
      throw erro;
    }
  })
);

router.post(
  '/upload-web/versao',
  verifyPerfil('operador'),
  ...uploadWebVersao,
  asyncHandler(async (req, res, next) => {
    const plano = await planoDaRequisicao(req);
    try {
      const dados = await arquivoCtrl.enviarWeb(plano, req.usuarioUuid);
      const msg = `Versão ${plano.versao.versao} cadastrada com ${dados.arquivos.length} ` +
        `arquivo(s) gravado(s) no volume ${dados.volume} como "${dados.nome_arquivo}"`;
      return res.sendJsonAndLog(true, msg, httpCode.Created, dados);
    } catch (erro) {
      await limparParciais(plano, { usuario_uuid: req.usuarioUuid });
      throw erro;
    }
  })
);

// Arquivos numa versao que JA EXISTE.
//
// E o que COMPLETA a versao PLANEJADA: ela nasce sem arquivo de proposito, e o
// arquivo entra nesta MESMA versao quando a producao termina (ver TIPO_VERSAO em
// utils/domain_constants.js). Sem esta rota, a folha planejada pela web nao
// tinha como ser completada pela web.
//
// O corpo NAO traz produto nem versao: os dois ja estao gravados, e aceita-los
// abriria a porta para esta rota editar o que ela nao e dona. O rotulo e o
// subtipo que o nome fisico exige sao lidos do banco.
//
// O tipo da versao NAO muda ao ganhar arquivo. "Planejada" e "Regular" dizem
// coisas diferentes sobre a PROMESSA, nao sobre ter byte, e o RPCMTec conta
// produto entregue por tipo de versao: virar Regular sozinho mexeria no
// relatorio sem ninguem ter pedido. Quem quiser mudar edita a versao.
router.post(
  '/upload-web/arquivos',
  verifyPerfil('operador'),
  ...uploadWebArquivos,
  asyncHandler(async (req, res, next) => {
    const plano = await planoDaRequisicao(req);
    try {
      const dados = await arquivoCtrl.enviarWeb(plano, req.usuarioUuid);
      const msg = `${dados.arquivos.length} arquivo(s) acrescentado(s) à versão ` +
        `${plano.versao.versao}, no volume ${dados.volume} como "${dados.nome_arquivo}"`;
      return res.sendJsonAndLog(true, msg, httpCode.Created, dados);
    } catch (erro) {
      await limparParciais(plano, { usuario_uuid: req.usuarioUuid });
      throw erro;
    }
  })
);

// ---------------------------------------------------------------------------

// Cataloga produto que JA ESTA no volume, sem transferir nem renomear byte.
//
// Rota propria, e nao o par prepare-upload/confirm-upload, pelo mesmo motivo do
// renomear-padrao: aquele caminho existe para TRANSFERIR bytes, e aqui nao ha
// transferencia. O que ele cobraria a mais e uma segunda leitura integral do
// arquivo (o cliente ja lera uma vez para declarar o checksum), com essa
// releitura DENTRO de uma transacao aberta por horas. Aqui o servidor le uma
// vez, fora de transacao, e grava o checksum e o tamanho que ele mesmo mediu.
//
// So aceita volume marcado com `layout_origem`: e essa marca que declara que o
// produto ja esta gravado no volume. Sem ela a rota viraria atalho para pular a
// validacao de transferencia no acervo comum.
//
// Uma requisicao, sem sessao: nao ha janela entre reservar o destino e copiar,
// entao nao ha o que a sessao cobriria. Cada chamada e atomica, e quem carrega
// um lote grande chama em laco.
router.post(
  '/catalogar/product',
  verifyPerfil('operador'),
  schemaValidation({
    body: arquivoSchema.catalogarProduto
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.catalogarProduto(req.body, req.usuarioUuid);

    const msg = `Produto catalogado no volume: ${dados.produtos.length} produto(s), ` +
      `${dados.total_arquivos} arquivo(s), ${dados.total_mb.toFixed(2)} MB lidos ` +
      `em ${dados.segundos_leitura.toFixed(1)}s`;

    return res.sendJsonAndLog(true, msg, httpCode.Created, dados);
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

// Renome do arquivo fisico para o padrao derivado dos metadados
// ({TIPOPROD}_s{NN}_{MI|slug}_{EDICAO}).
//
// Rota propria, e nao o par prepare-upload/confirm-upload, porque aquele caminho
// existe para TRANSFERIR bytes: sessao, checksum declarado, copia e revalidacao.
// Renomear nao move byte nenhum, e so metadado de diretorio. Passar 15 mil
// arquivos pelo caminho de upload custaria horas de releitura para nao mudar
// nenhum pixel.
//
// O cliente nao manda nome: o servidor o deriva de acervo.nome_arquivo_padrao, a
// MESMA funcao do invariante 7a. Chamar em laco ate `restantes` zerar.
// Comeca em dry_run=true de proposito.
router.post(
  '/renomear-padrao',
  verifyAdmin,
  schemaValidation({
    body: arquivoSchema.renomearPadrao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await arquivoCtrl.renomearPadrao(
      req.body.arquivo_ids,
      req.body.limite,
      req.body.dry_run,
      req.body.motivo,
      req.usuarioUuid
    );

    const msg = dados.dry_run
      ? 'Plano de renome calculado (nada foi alterado)'
      : `Renome aplicado: ${dados.renomeados} arquivo(s), ${dados.falhas} falha(s), ${dados.restantes} restante(s)`;

    return res.sendJsonAndLog(dados.falhas === 0, msg, httpCode.OK, dados);
  })
);

module.exports = router
