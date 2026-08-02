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
    await produtoCtrl.atualizaProduto(req.body, req.usuarioUuid, req.contexto)

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
    await produtoCtrl.atualizaVersao(req.body, req.usuarioUuid, req.contexto);

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
      req.body.correcoes, req.body.motivo, req.usuarioUuid, req.contexto
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
    await produtoCtrl.deleteProdutos(req.body.produto_ids, req.body.motivo_exclusao, req.usuarioUuid, req.contexto)
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
    await produtoCtrl.deleteVersoes(req.body.versao_ids, req.body.motivo_exclusao, req.usuarioUuid, req.contexto);
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
    await produtoCtrl.criaVersaoHistorica(req.body, req.usuarioUuid, req.contexto);

    const msg = 'Versões históricas criadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.Created);
  })
);

// Irma da /versao_historica, e de proposito uma ROTA PROPRIA em vez de um campo
// naquela, pelo mesmo motivo do par /produto_versao_*: "historica" e "planejada"
// sao coisas diferentes (passado registrado x producao prometida) e um nome por
// coisa evita o corpo que muda de significado por um inteiro escondido.
//
// A diferenca para /produto_versao_planejada e o PRODUTO: la ele nasce junto,
// aqui ele ja existe e so ganha mais uma versao.
/**
 * @swagger
 * /api/produtos/versao_planejada:
 *   post:
 *     summary: Versões PLANEJADAS em produtos que já existem
 *     description: >
 *       A versão planejada é a folha que ainda vai ser produzida: nasce sem
 *       arquivo, para o item de pedido da mapoteca poder apontar para ela, e o
 *       arquivo entra nesta MESMA versão quando a produção terminar.
 *       O corpo é o mesmo de `/versao_historica` (as duas criam versão sem
 *       arquivo); quem separa é a rota, que grava `tipo_versao_id = 3`.
 *       Não exige a edição anterior da série N-SIGLA: uma folha que ainda não
 *       existe não tem edição anterior nenhuma.
 *     tags: [produtos]
 *     requestBody:
 *       required: true
 *       content:
 *         application/json:
 *           schema:
 *             type: array
 *             minItems: 1
 *             items:
 *               type: object
 *               required: [uuid_versao, versao, nome, produto_id, subtipo_produto_id, lote_id, metadado, descricao, orgao_produtor, data_criacao, data_edicao]
 *               properties:
 *                 uuid_versao: { type: string, format: uuid, nullable: true }
 *                 versao: { type: string, example: 1-DSG }
 *                 nome: { type: string, nullable: true }
 *                 produto_id: { type: integer }
 *                 subtipo_produto_id: { type: integer }
 *                 lote_id: { type: integer, nullable: true }
 *                 metadado: { type: object }
 *                 descricao: { type: string }
 *                 orgao_produtor: { type: string }
 *                 palavras_chave: { type: array, items: { type: string } }
 *                 data_criacao: { type: string, format: date }
 *                 data_edicao: { type: string, format: date }
 *     responses:
 *       201:
 *         description: Versões planejadas criadas
 *       400:
 *         description: Corpo fora do schema, ou versões duplicadas dentro do próprio corpo
 *       409:
 *         description: Já existe versão com este rótulo no produto
 */
router.post(
  '/versao_planejada',
  verifyPerfil('operador'),
  schemaValidation({
    body: produtoSchema.versoesPlanejadas
  }),
  asyncHandler(async (req, res, next) => {
    await produtoCtrl.criaVersaoPlanejada(req.body, req.usuarioUuid, req.contexto);

    const msg = 'Versões planejadas criadas com sucesso';

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
    await produtoCtrl.criaProdutoVersoesHistoricas(req.body, req.usuarioUuid, req.contexto);

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
    await produtoCtrl.criaProdutoVersoesPlanejadas(req.body, req.usuarioUuid, req.contexto);

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
    await produtoCtrl.moverArquivos(req.body.arquivo_ids, req.body.versao_id_destino, req.usuarioUuid, req.body.permitir_entre_produtos, req.body.permitir_esvaziar_origem, req.contexto);

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
      req.body.nova_data_edicao, req.usuarioUuid, req.contexto
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
    await produtoCtrl.bulkCreateProducts(req.body.produtos, req.usuarioUuid, req.contexto);

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
    await produtoCtrl.criaVersaoRelacionamento(req.body.versao_relacionamento, req.usuarioUuid, req.contexto);

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
    await produtoCtrl.atualizaVersaoRelacionamento(req.body.versao_relacionamento, req.usuarioUuid, req.contexto);

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
    await produtoCtrl.deleteVersaoRelacionamento(req.body.versao_relacionamento_ids, req.usuarioUuid, req.contexto);

    const msg = 'Entradas do Versão Relacionamento deletadas com sucesso';

    return res.sendJsonAndLog(true, msg, httpCode.OK);
  })
);

/**
 * @swagger
 * /api/produtos/folha:
 *   get:
 *     summary: Folha do Sistema Cartográfico Nacional por INOM ou por MI
 *     description: >
 *       Devolve o polígono da folha, o `tipo_escala_id` correspondente e o par
 *       INOM/MI. Não consulta o acervo: a folha existe no SCN esteja ou não
 *       catalogada, e é justamente antes do cadastro que a geometria é
 *       necessária. Informe `inom` OU `mi`, nunca os dois.
 *       Folha sem MI (fora do território brasileiro, ou de fronteira sem número
 *       emitido) responde 200 com `mi: null` e `sem_mi: true`, porque é resposta
 *       e não falha.
 *     tags: [produtos]
 *     parameters:
 *       - in: query
 *         name: inom
 *         schema: { type: string }
 *         example: SF-22-Y-D-II-4-NE
 *       - in: query
 *         name: mi
 *         schema: { type: string }
 *         example: 2757-4-NE
 *       - in: query
 *         name: tipo_escala_id
 *         description: >
 *           Só com `mi`, e só 3 (1:100.000) ou 4 (1:250.000). Desempata o MI nu,
 *           que sem o zero à esquerda é ambíguo entre as duas escalas.
 *         schema: { type: integer, enum: [3, 4] }
 *     responses:
 *       200:
 *         description: Folha resolvida
 *       400:
 *         description: INOM fora do formato do SCN, ou combinação inválida de parâmetros
 *       404:
 *         description: MI não encontrado no Mapa Índice
 */
router.get(
  '/folha',
  verifyPerfil('consulta'),
  schemaValidation({
    query: produtoSchema.folhaQuery
  }),
  asyncHandler(async (req, res, next) => {
    const dados = await produtoCtrl.getFolha(req.query)

    const msg = 'Folha retornada com sucesso'

    return res.sendJsonAndLog(true, msg, httpCode.OK, dados)
  })
)

module.exports = router;
