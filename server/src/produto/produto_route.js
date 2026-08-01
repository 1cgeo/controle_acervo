"use strict";

const express = require("express");

const { schemaValidation, asyncHandler, httpCode } = require("../utils");

const { verifyPerfil } = require("../login");

const produtoCtrl = require("./produto_ctrl");
const produtoSchema = require("./produto_schema");

const router = express.Router();

router.put(
  '/produto',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.produtoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.atualizaProduto(req.body, req.usuarioUuid)

    const msg = 'Produto atualizado com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.put(
  '/versao',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.versaoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.atualizaVersao(req.body, req.usuarioUuid);

    const msg = 'Versão atualizada com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
)

// Corrige o identificador da versao para o que o BDGEx ja publicou.
//
// POST, e nao PUT em /versao, de proposito: no PUT o uuid_versao segue IMUTAVEL,
// porque la ele chega junto de vinte outros campos e troca-lo seria acidente.
// Aqui a troca e o proposito declarado, vem em lote e exige motivo.
//
// Perfil GERENTE: mexe no identificador com que o produto foi publicado, e o
// item de pedido que aponta a versao acompanha por cascata.
router.post(
  '/versao/uuid',
  verifyPerfil('gerente'),
  schemaValidation({
    body: produtoSchema.versaoUuidCorrecao
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await produtoCtrl.corrigeUuidVersao(
      req.body.correcoes, req.body.motivo, req.usuarioUuid
    )
    const alteradas = dados.filter(d => d.alterado).length
    const msg = `Identificador corrigido em ${alteradas} versão(ões)`
    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

router.delete(
  '/produto',
  verifyPerfil('gerente'),
  schemaValidation({
    body: produtoSchema.produtoIds
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.deleteProdutos(req.body.produto_ids, req.body.motivo_exclusao, req.usuarioUuid)
    const msg = 'Produtos deletados com sucesso'
    return res.sendJsonAndLog(true, msg, httpCode.OK)
  })
)

router.delete(
  '/versao',
  verifyPerfil('gerente'),
  schemaValidation({
    body: produtoSchema.versaoIds
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.deleteVersoes(req.body.versao_ids, req.body.motivo_exclusao, req.usuarioUuid);
    const msg = 'Versões deletadas com sucesso';
    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.post(
  '/versao_historica',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.versoesHistoricas
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.criaVersaoHistorica(req.body, req.usuarioUuid);

    const msg = 'Versões históricas criadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.post(
  '/produto_versao_historica',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.produtosVersoesHistoricas
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.criaProdutoVersoesHistoricas(req.body, req.usuarioUuid);

    const msg = 'Produtos com versões históricas criados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

// Irma da /produto_versao_historica, e de proposito uma ROTA PROPRIA em vez de
// um campo naquela: "historica" e "planejada" sao coisas diferentes (passado
// registrado x producao prometida) e um nome por coisa evita o corpo que muda
// de significado por um inteiro escondido.
router.post(
  '/produto_versao_planejada',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.produtosVersoesPlanejadas
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.criaProdutoVersoesPlanejadas(req.body, req.usuarioUuid);

    const msg = 'Produtos com versões planejadas criados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.post(
  '/mover-arquivos',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.moverArquivos
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.moverArquivos(req.body.arquivo_ids, req.body.versao_id_destino, req.usuarioUuid, req.body.permitir_entre_produtos, req.body.permitir_esvaziar_origem);

    const msg = 'Arquivos movidos de versão com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.post(
  '/renumerar-versoes',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.renumeraVersoes
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await produtoCtrl.renumeraVersoes(
      req.body.produto_id, req.body.subtipo_produto_id, req.body.familia,
      req.body.nova_data_edicao, req.usuarioUuid
    );

    const msg = 'Versões renumeradas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/produtos',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.produtos
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.bulkCreateProducts(req.body.produtos, req.usuarioUuid);

    const msg = 'Produtos criados com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.get(
  '/versao_relacionamento',
  verifyPerfil('consulta'),
  asyncHandler(async (req, res, next) => {
    const dados = await produtoCtrl.getVersaoRelacionamento();

    const msg = 'Versão Relacionamento retornada com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados);
  })
);

router.post(
  '/versao_relacionamento',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.versaoRelacionamento
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.criaVersaoRelacionamento(req.body.versao_relacionamento, req.usuarioUuid );

    const msg = 'Entradas do Versão Relacionamento criadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

router.put(
  '/versao_relacionamento',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.versaoRelacionamentoAtualizacao
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.atualizaVersaoRelacionamento(req.body.versao_relacionamento, req.usuarioUuid );

    const msg = 'Entradas do Versão Relacionamento atualizadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

router.delete(
  '/versao_relacionamento',
  verifyPerfil('gerente'),
  schemaValidation({
    body: produtoSchema.versaoRelacionamentoIds
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.deleteVersaoRelacionamento(req.body.versao_relacionamento_ids);

    const msg = 'Entradas do Versão Relacionamento deletadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

module.exports = router;
