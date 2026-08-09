'use strict'

// A INSTITUICAO que opera esta instalacao: nome, sigla e Unidade Gestora.
//
// DUAS ROTAS SOBRE UMA LINHA SO, e por isso NENHUMA delas tem parametro: nao ha
// `/:id`, nao ha listagem e nao ha `POST` nem `DELETE`. A linha e unica pelo
// CHECK `(id = 1)` do DDL, nasce com o banco e so se altera. A regra da casa
// sobre rota literal antes de rota com parametro nao chega a valer aqui, porque
// rota com parametro nao existe.
//
// AS GUARDAS, E POR QUE ELAS SAO DIFERENTES ENTRE SI
//
//   GET  -> `verifyLogin`. E a guarda mais baixa da plataforma (a propria
//           conta), e ela e a certa AQUI por uma razao medida: desde 2026-08-08,
//           ter conta e ter acesso sao dois momentos, e quem nao tem perfil em
//           modulo nenhum alcanca so a propria pagina (`#/perfil`). Essa pagina
//           e o cabecalho do sistema mostram DE QUEM E a instalacao, e o rodape
//           do relatorio e o titulo tambem precisam. Cobrar `verifyAcesso` aqui
//           deixaria sem nome de Centro exatamente a tela que existe para dizer
//           a quem pedir acesso.
//
//           NAO HA VAZAMENTO NISSO: quem chegou ate aqui ja passou pelo login,
//           e o que ele le e o nome de uma OM, que esta na porta do quartel.
//
//   PUT  -> `verifyAdmin`. Trocar o nome muda a que Centro o sistema inteiro se
//           diz pertencer, e a subsecao 2.7 do RPCMTec passa a procurar outra
//           area de suprimento -- e a mesma familia de escritas que ja e do
//           administrador global (usuarios, meta e revisao do PIT, fechar o
//           RPCMTec). Nao existe gerente desta tela, porque nao existe area que
//           responda por ela: a instituicao nao e de modulo nenhum.
//
// SEM `verifyPerfil`, E POR ISSO SEM O SEGUNDO ARGUMENTO. A armadilha do
// CLAUDE.md (o default 'acervo') nao alcanca este arquivo: rota de PLATAFORMA
// escolhe entre `verifyLogin`, `verifyAcesso`, `verifyGerente` e `verifyAdmin`,
// e nenhuma delas pergunta modulo.
//
// O VALIDADOR E O TOLERANTE, e nao o estrito de `equipamento/` e `orcamento/`.
// A escolha e do contrato de leitura e escrita: o `GET` devolve os tres campos
// que o `PUT` aceita MAIS `id`, `ug_nome`, `data_modificacao` e
// `usuario_modificacao_uuid`, que sao derivados ou de rastro. Com o validador
// estrito, ler a instituicao, trocar a sigla e reenviar o corpo lido daria 400
// em `ug_nome` -- e ler, mudar um campo e reenviar e o fluxo mais banal do
// sistema. O tolerante descarta as chaves de leitura e AVISA no envelope, que e
// o comportamento desejado aqui.

const express = require('express')

const { schemaValidation, asyncHandler, httpCode } = require('../utils')

const { verifyLogin, verifyAdmin } = require('../login')

const instituicaoCtrl = require('./instituicao_ctrl')
const instituicaoSchema = require('./instituicao_schema')

const router = express.Router()

router.get(
  '/',
  verifyLogin,
  asyncHandler(async (req, res, next) => {
    const dados = await instituicaoCtrl.get()
    return res.sendJsonAndLog(
      true, 'Instituição retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.put(
  '/',
  verifyAdmin,
  schemaValidation({ body: instituicaoSchema.atualizar }),
  asyncHandler(async (req, res, next) => {
    await instituicaoCtrl.atualizar(req.body, req.usuarioUuid, req.contexto)
    return res.sendJsonAndLog(
      true, 'Instituição atualizada com sucesso', httpCode.OK
    )
  })
)

module.exports = router
