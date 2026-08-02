"use strict";
const express = require("express");

const { databaseVersion } = require("./database");
const { httpCode } = require("./utils");

const { loginRoute } = require("./login");
const { acessosRoute } = require("./acessos");
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
const { rpcmtecRoute } = require("./rpcmtec");
const { pontoControleRoute } = require("./ponto_controle");
const { limitesRoute } = require("./limites");
const { pitRoute } = require("./pit");
const { efetivoRoute } = require("./efetivo");
const { auditoriaRoute } = require("./auditoria");

// Modulo orcamento (antigo SCO). Os nomes colidem com os do acervo (dominio,
// relatorio, arquivo), entao entram com apelido e so sob /api/orcamento/.
const {
  dominioRoute: orcamentoDominioRoute,
  configuracaoRoute: orcamentoConfiguracaoRoute,
  dfdRoute: orcamentoDfdRoute,
  pdrRoute: orcamentoPdrRoute,
  notaCreditoRoute: orcamentoNotaCreditoRoute,
  notaEmpenhoRoute: orcamentoNotaEmpenhoRoute,
  liquidacaoRoute: orcamentoLiquidacaoRoute,
  recebimentoRoute: orcamentoRecebimentoRoute,
  licitacaoRoute: orcamentoLicitacaoRoute,
  rpnpRoute: orcamentoRpnpRoute,
  dashboardRoute: orcamentoDashboardRoute,
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

// Histórico de acesso (dgeo.login). Rota de PLATAFORMA, sem prefixo de módulo,
// como /usuarios e /rpcmtec: quem entrou no sistema não é dado do acervo, da
// mapoteca nem do orçamento. Todas as rotas são verifyAdmin.
//
// Existe desde 2026-08-02, com a fusão da autenticação: é o porte do dashboard
// do Auth Server externo, que era quem lia essa tabela.
router.use("/acessos", acessosRoute);

// Rastreabilidade: o que foi mudado, quando, por quem e qual era o estado
// anterior. Rota de PLATAFORMA, sem prefixo de módulo, como /usuarios e
// /acessos: o rastro dos três módulos mora numa tabela só, e a pergunta "o que o
// usuário X fez" não é de módulo nenhum.
//
// NÃO confundir com `/acervo/auditoria`, que roda os invariantes do acervo: essa
// mede a coerência entre tabelas HOJE e não diz quem produziu a incoerência.
// Nomes parecidos, perguntas diferentes.
//
// A guarda é por caminho: quem vê o registro vê o histórico dele. Ver
// `auditoria/auditoria_route.js`.
router.use("/auditoria", auditoriaRoute);

// Metas do PIT. Rota de PLATAFORMA, sem prefixo de módulo, como /usuarios:
// os três módulos consomem o plano anual da Divisão e nenhum é dono dele.
// Esteve em /api/orcamento/metas até 2026-07-31.
router.use("/metas", pitRoute);

// Aproveitamento do efetivo: quem esteve na Divisão, quando, e o que o impediu.
// Rota de PLATAFORMA pela mesma razão das metas, e sob `/efetivo` em vez de
// `/rpcmtec` porque "quem esteve na Divisão" não existe por causa do relatório:
// o relatório é um leitor. Toda ela é `verifyAdmin`, inclusive a leitura, porque
// a tela mostra licença de saúde e função acumulada, nominalmente.
router.use("/efetivo", efetivoRoute);

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

// RPCMTec: o relatório mensal da Divisão, inteiro, num gerador só. Rota de
// PLATAFORMA, sem prefixo de módulo, como /usuarios e /metas: a mesma edição
// fala de acervo, mapoteca e orçamento, e o chefe assina uma só.
//
// Substitui, desde 2026-08-01, as duas gerações que existiam e não se
// conheciam: /api/relatorio/rpcmtec (acervo e mapoteca) e
// /api/orcamento/relatorio/secao3 (o PDR). Ver server/src/rpcmtec/.
router.use("/rpcmtec", rpcmtecRoute);

// Módulo orçamento (antigo SCO). Todas as features do sistema absorvido ficam
// sob /api/orcamento/, o que resolve as colisões de nome com o acervo
// (/dominio, /relatorio, /arquivo) sem renomear nada dentro do módulo.
router.use("/orcamento/dominio", orcamentoDominioRoute);

router.use("/orcamento/configuracao", orcamentoConfiguracaoRoute);

router.use("/orcamento/dfd", orcamentoDfdRoute);

router.use("/orcamento/pdr", orcamentoPdrRoute);

router.use("/orcamento/notas_credito", orcamentoNotaCreditoRoute);

router.use("/orcamento/notas_empenho", orcamentoNotaEmpenhoRoute);

router.use("/orcamento/liquidacoes", orcamentoLiquidacaoRoute);

router.use("/orcamento/recebimentos", orcamentoRecebimentoRoute);

router.use("/orcamento/licitacoes", orcamentoLicitacaoRoute);

router.use("/orcamento/rpnp", orcamentoRpnpRoute);

// SEM /orcamento/relatorio: a geração da seção do PDR e o CRUD da edição mensal
// saíram daqui em 2026-08-01 para /api/rpcmtec. O orçamento continua sendo
// FONTE das subseções 4.1 a 4.7, e não dono do relatório. O que ficou é o
// painel, que pergunta outra coisa e é lido por outro perfil.
router.use("/orcamento/dashboard", orcamentoDashboardRoute);

router.use("/orcamento/arquivo", orcamentoArquivoRoute);

module.exports = router;