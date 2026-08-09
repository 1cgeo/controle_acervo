'use strict'

// `/api/producao`: o CADASTRO da produção cartográfica, herdado do SAP 2.3.5.
//
// DE ONDE VEIO, E POR QUE O NOME MUDOU. Lá isto era `server/src/projeto/`, com
// 159 rotas, e o nome mentia: 146 delas são o cadastro da PRODUÇÃO (linha,
// fase, subfase, etapa, bloco, unidade de trabalho, insumo, perfis de
// configuração do QGIS) e só 13 falavam de projeto, lote e produto. As 13 NÃO
// atravessaram, porque o SCA já as responde:
//
//   GET/POST/PUT/DELETE /projetos  ->  /api/projetos/projeto
//   GET/POST/PUT/DELETE /lote      ->  /api/projetos/lote
//   GET/POST/PUT/DELETE /produto   ->  /api/produtos/produto (PUT e DELETE),
//                                      POST /api/produtos/produtos e
//                                      POST /api/produtos/produto_versao_planejada,
//                                      e a LEITURA por /api/acervo/busca
//   GET /tipo_produto              ->  GET /api/gerencia/dominio/subtipo_produto
//
// A ÚLTIMA linha da lista merece a explicação: o `dominio.tipo_produto` do SAP
// é, code a code, o `dominio.subtipo_produto` do SCA, e o `dominio.tipo_produto`
// daqui é outra coisa, mais grossa. Ver `er/producao.sql`.
//
// SEIS ARQUIVOS DE ROTA, E NÃO UM, e a razão é o tamanho. 146 rotas num arquivo
// só passariam de duas mil linhas, e a fatia que alguém edita (os perfis de
// configuração, digamos) ficaria no meio de outras cinco que ela não toca. O
// precedente da casa é `mapoteca/` e `pit/`, que já separam o controlador por
// assunto; aqui a separação alcança também a rota e o schema. Este arquivo é o
// ÍNDICE: quem procura uma rota acha aqui em qual fatia ela mora.
//
// A ORDEM DE MONTAGEM NÃO IMPORTA ENTRE AS FATIAS, e isso é uma afirmação
// medida, não um descuido. O Express casa por caminho INTEIRO, e não por
// prefixo: `/unidade_trabalho` de `trabalho_route.js` e `/unidade_trabalho/insumos`
// de `insumo_route.js` são caminhos diferentes e não disputam. A ordem que
// IMPORTA é a de DENTRO de cada arquivo, onde a rota literal vem antes da rota
// com parâmetro -- e a única rota com parâmetro do módulo inteiro
// (`GET /lote/:lote_id/subfases`) está declarada por último em `fluxo_route.js`.
//
// TODAS AS 146 COBRAM O MÓDULO `producao` (code 7 de `dominio.modulo`), e
// nenhuma delas aceita o default de `verifyPerfil`, que é 'acervo': rota que
// esquecesse o segundo argumento passaria a cobrar perfil no ACERVO, sem erro de
// sintaxe e sem teste vermelho. A tradução das duas guardas do SAP para as
// quatro daqui é:
//
//   só o `router.use(verifyLogin)` do topo  ->  verifyPerfil('operador','producao')
//   `verifyLogin` mais `verifyAdmin`        ->  verifyPerfil('gerente','producao')
//
// e o administrador global continua passando por cima, como em todo módulo. São
// 12 rotas no piso `operador` (os 11 domínios do fluxo e a leitura dos insumos
// de uma unidade de trabalho) e 134 no piso `gerente`.

const express = require('express')

// Os domínios do fluxo e o catálogo do QGIS que o SAP Gerente publica: estilos,
// regras, menus, temas, apelidos, modelos, workflows e o servidor do FME. 49.
const dominioQgisRoute = require('./dominio_qgis_route')

// A linha de produção, a fase, a subfase, a etapa e as camadas: o desenho do
// fluxo, antes de haver geometria. 14.
const fluxoRoute = require('./fluxo_route')

// As onze `producao.perfil_*` (como o QGIS abre para a subfase de um lote), a
// habilitação por dificuldade e a cópia de configuração entre lotes. 49.
const perfilRoute = require('./perfil_route')

// O bloco, a unidade de trabalho, a atividade e o dado de produção: onde o
// trabalho acontece. 22.
const trabalhoRoute = require('./trabalho_route')

// O grupo de insumo, o insumo e a associação dele com a unidade de trabalho. 12.
const insumoRoute = require('./insumo_route')

const router = express.Router()

router.use(dominioQgisRoute)
router.use(fluxoRoute)
router.use(perfilRoute)
router.use(trabalhoRoute)
router.use(insumoRoute)

module.exports = router
