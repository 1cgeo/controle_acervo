// Path: routes.js
"use strict";
const express = require("express");

const { databaseVersion } = require("./database");
const { httpCode } = require("./utils");

const { loginRoute } = require("./login");
const { acervoRoute } = require("./acervo");
const { volumeRoute } = require("./volume");
const { usuarioRoute } = require("./usuario");
const { produtoRoute } = require("./produto");
const { projetoRoute } = require("./projeto");
const { gerenciaRoute } = require("./gerencia");
const { arquivoRoute } = require("./arquivo");
const { mapotecaRoute, dashboardRoute: mapotecaDashboardRoute } = require("./mapoteca");
const { dashboardRoute: acervoDashboardRoute } = require("./dashboard");
const { integracaoRoute } = require("./integracao");
const { relatorioRoute } = require("./relatorio");
const { pontoControleRoute } = require("./ponto_controle");
const { limitesRoute } = require("./limites");

// Modulo orcamento (antigo SCO). Os nomes colidem com os do acervo (dominio,
// relatorio, arquivo), entao entram com apelido e so sob /api/orcamento/.
const {
  dominioRoute: orcamentoDominioRoute,
  configuracaoRoute: orcamentoConfiguracaoRoute,
  metaRoute: orcamentoMetaRoute,
  dfdRoute: orcamentoDfdRoute,
  pdrRoute: orcamentoPdrRoute,
  notaCreditoRoute: orcamentoNotaCreditoRoute,
  notaEmpenhoRoute: orcamentoNotaEmpenhoRoute,
  liquidacaoRoute: orcamentoLiquidacaoRoute,
  recebimentoRoute: orcamentoRecebimentoRoute,
  licitacaoRoute: orcamentoLicitacaoRoute,
  rpnpRoute: orcamentoRpnpRoute,
  relatorioRoute: orcamentoRelatorioRoute,
  arquivoRoute: orcamentoArquivoRoute
} = require("./orcamento");

const router = express.Router();

router.get("/", (req, res, next) => {
  return res.sendJsonAndLog(
    true,
    "Sistema de Controle do Acervo operacional",
    httpCode.OK,
    {
      database_version: databaseVersion.nome
    }
  );
});

router.use("/login", loginRoute);

router.use("/acervo", acervoRoute);

router.use("/usuarios", usuarioRoute);

router.use("/volumes", volumeRoute);

router.use("/produtos", produtoRoute);

router.use("/projetos", projetoRoute);

router.use("/gerencia", gerenciaRoute);

router.use("/arquivo", arquivoRoute);

router.use("/dashboard", acervoDashboardRoute);

// Ponto de controle. Schema próprio, mas módulo de perfil do ACERVO: é uma tela
// do acervo, e não um sistema à parte.
router.use("/ponto_controle", pontoControleRoute);

// Limite político-administrativo (schema `limites`). Rota própria porque é dado
// de REFERÊNCIA: o acervo e o ponto de controle consultam, nenhum é dono.
router.use("/limites", limitesRoute);

router.use("/mapoteca/dashboard", mapotecaDashboardRoute);

router.use("/mapoteca", mapotecaRoute);

// Rotas públicas de integração (read-only, sem autenticação) para o vault da DGEO
router.use("/integracao", integracaoRoute);

// Geração do RPCMTec (seção acervo): admin-only
router.use("/relatorio", relatorioRoute);

// Módulo orçamento (antigo SCO). Todas as features do sistema absorvido ficam
// sob /api/orcamento/, o que resolve as colisões de nome com o acervo
// (/dominio, /relatorio, /arquivo) sem renomear nada dentro do módulo.
router.use("/orcamento/dominio", orcamentoDominioRoute);

router.use("/orcamento/configuracao", orcamentoConfiguracaoRoute);

router.use("/orcamento/metas", orcamentoMetaRoute);

router.use("/orcamento/dfd", orcamentoDfdRoute);

router.use("/orcamento/pdr", orcamentoPdrRoute);

router.use("/orcamento/notas_credito", orcamentoNotaCreditoRoute);

router.use("/orcamento/notas_empenho", orcamentoNotaEmpenhoRoute);

router.use("/orcamento/liquidacoes", orcamentoLiquidacaoRoute);

router.use("/orcamento/recebimentos", orcamentoRecebimentoRoute);

router.use("/orcamento/licitacoes", orcamentoLicitacaoRoute);

router.use("/orcamento/rpnp", orcamentoRpnpRoute);

router.use("/orcamento/relatorio", orcamentoRelatorioRoute);

router.use("/orcamento/arquivo", orcamentoArquivoRoute);

module.exports = router;