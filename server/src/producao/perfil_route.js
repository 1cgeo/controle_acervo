'use strict'

// OS PERFIS DE CONFIGURAÇÃO DA SUBFASE NO LOTE: como o QGIS abre para este
// trabalho. São as onze tabelas `producao.perfil_*`, mais a habilitação por
// dificuldade e a cópia de configuração de um lote para outro.
//
// AQUI "PERFIL" É PERFIL DE CONFIGURAÇÃO DO QGIS, e NUNCA autorização. A palavra
// aparece duas vezes neste sistema e significa duas coisas:
//
//   `dominio.tipo_perfil`  - 1 consulta, 2 operador, 3 gerente. É AUTORIZAÇÃO, é
//                            o que o `verifyPerfil` lê do banco a cada
//                            requisição, e é o que barra a escrita.
//   `producao.perfil_*`    - o menu, o tema, o estilo, a regra e o modelo que o
//                            QGIS carrega quando alguém abre a subfase X do lote
//                            Y. Não concede acesso a coisa nenhuma.
//
// O prefixo `perfil_` ficou porque é o nome que o SAP Gerente e o plugin já
// usam. A ambiguidade foi resolvida do outro lado: o `perfil_producao` do SAP,
// que falava de PESSOAS, virou `producao.habilitacao` aqui.
//
// A RÉGUA DE PERFIL: TODAS AS 49 ROTAS SÃO DE `gerente`, sem exceção. No SAP
// 2.3.5 todas carregavam `verifyAdmin`, e a tradução para a régua da casa
// (2026-08-08) é gerente: mexer aqui muda como o QGIS abre para TODO MUNDO que
// trabalha naquela subfase daquele lote, e é ato de quem responde pela área. Não
// há leitura em `consulta`: a lista é o formulário de edição, e ela devolve o
// JSON inteiro de menu, tema e workflow.
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele é 'acervo': uma
// rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, sem erro de
// sintaxe, sem teste vermelho e sem nada na tela.
//
// AS 49 ROTAS SÃO DOZE GRUPOS COM A MESMA FORMA -- GET lista, DELETE recebe uma
// lista de ids no CORPO, POST grava em massa, PUT atualiza em massa -- mais a
// cópia de lote. A fábrica `crudDePerfil` declara os quatro caminhos de um
// grupo, e cada grupo a chama UMA VEZ com o caminho literal: o arquivo de rota é
// o contrato, e uma varredura sobre uma lista de nomes esconderia doze caminhos
// atrás de um `forEach`.
//
// O CORPO É O DO SAP 2.3.5, chave por chave, porque é o SAP Gerente que consome
// estas rotas. Os nomes são irregulares de nascença (`perfil_fme_ids` mas
// `perfis_alias_ids`) e uniformizá-los quebraria o cliente. Ver
// `perfil_schema.js`.

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyPerfil } = require('../login')

const perfilCtrl = require('./perfil_ctrl')
const perfilSchema = require('./perfil_schema')

const router = express.Router()

/**
 * Declara os quatro caminhos de um grupo de perfil.
 *
 * A ORDEM DOS QUATRO É A DO SAP (GET, DELETE, POST, PUT), e não a ordem que a
 * casa costuma usar. Ela não muda o comportamento -- os quatro têm o MESMO
 * caminho e diferem só no método, e o Express casa por método antes de casar por
 * ordem de declaração -- mas manter a ordem de lá faz a comparação com
 * `projeto_route.js` do SAP ser linha a linha enquanto a travessia acontece.
 *
 * @param {object} grupo
 * @param {string} grupo.caminho - o caminho literal, igual ao do SAP
 * @param {object} grupo.ctrl - o grupo em `perfil_ctrl.js`
 * @param {object} grupo.schema - o grupo em `perfil_schema.js` (criar/atualizar/ids)
 * @param {string} grupo.chaveLista - a chave do array no POST e no PUT
 * @param {string} grupo.chaveIds - a chave do array de ids no DELETE
 * @param {string} grupo.rotulo - como a mensagem chama o conjunto, no plural
 * @param {string} [grupo.genero] - 'f' quando o rótulo é feminino
 */
const crudDePerfil = ({
  caminho,
  ctrl,
  schema,
  chaveLista,
  chaveIds,
  rotulo,
  genero
}) => {
  const a = genero === 'f' ? 'a' : 'o'

  router.get(
    caminho,
    verifyPerfil('gerente', 'producao'),
    asyncHandler(async (req, res, next) => {
      const dados = await ctrl.listar()
      return res.sendJsonAndLog(
        true, `${rotulo} retornad${a}s com sucesso`, httpCode.OK, dados
      )
    })
  )

  router.delete(
    caminho,
    verifyPerfil('gerente', 'producao'),
    schemaValidation({ body: schema.ids }),
    asyncHandler(async (req, res, next) => {
      await ctrl.deletar(req.body[chaveIds], req.usuarioUuid, req.contexto)
      return res.sendJsonAndLog(
        true, `${rotulo} excluíd${a}s com sucesso`, httpCode.OK
      )
    })
  )

  router.post(
    caminho,
    verifyPerfil('gerente', 'producao'),
    schemaValidation({ body: schema.criar }),
    asyncHandler(async (req, res, next) => {
      const dados = await ctrl.criar(
        req.body[chaveLista], req.usuarioUuid, req.contexto
      )
      return res.sendJsonAndLog(
        true, `${rotulo} criad${a}s com sucesso`, httpCode.Created, dados
      )
    })
  )

  router.put(
    caminho,
    verifyPerfil('gerente', 'producao'),
    schemaValidation({ body: schema.atualizar }),
    asyncHandler(async (req, res, next) => {
      await ctrl.atualizar(
        req.body[chaveLista], req.usuarioUuid, req.contexto
      )
      return res.sendJsonAndLog(
        true, `${rotulo} atualizad${a}s com sucesso`, httpCode.OK
      )
    })
  )
}

// --- 1. As rotinas FME -------------------------------------------------------
//
// `requisito_finalizacao` TRUE faz a rotina BARRAR a finalização quando acusa
// erro; FALSE a deixa informativa.

crudDePerfil({
  caminho: '/configuracao/perfil_fme',
  ctrl: perfilCtrl.fme,
  schema: perfilSchema.grupos.fme,
  chaveLista: 'perfis_fme',
  chaveIds: 'perfil_fme_ids',
  rotulo: 'Perfis FME'
})

// --- 2. O menu customizado do QGIS -------------------------------------------

crudDePerfil({
  caminho: '/configuracao/perfil_menu',
  ctrl: perfilCtrl.menu,
  schema: perfilSchema.grupos.menu,
  chaveLista: 'perfis_menu',
  chaveIds: 'perfil_menu_ids',
  rotulo: 'Perfis de menu QGIS'
})

// --- 3. Quanto da linhagem o operador vê -------------------------------------
//
// É o único grupo cujo UNIQUE no banco é só (subfase, lote): a resposta é uma só
// por subfase de lote.

crudDePerfil({
  caminho: '/configuracao/perfil_linhagem',
  ctrl: perfilCtrl.linhagem,
  schema: perfilSchema.grupos.linhagem,
  chaveLista: 'perfis_linhagem',
  chaveIds: 'perfil_linhagem_ids',
  rotulo: 'Perfis de linhagem'
})

// --- 4. Os modelos de processamento do QGIS ----------------------------------
//
// O CAMINHO É `perfil_modelo` e a TABELA é `producao.perfil_model_qgis`. Os dois
// nomes vêm do SAP, e trocar qualquer um deles quebra um dos dois lados.

crudDePerfil({
  caminho: '/configuracao/perfil_modelo',
  ctrl: perfilCtrl.modelo,
  schema: perfilSchema.grupos.modelo,
  chaveLista: 'perfis_modelo',
  chaveIds: 'perfil_modelo_ids',
  rotulo: 'Perfis de modelo QGIS'
})

// --- 5. As regras de atributo que o DSGTools cobra ---------------------------

crudDePerfil({
  caminho: '/configuracao/perfil_regras',
  ctrl: perfilCtrl.regras,
  schema: perfilSchema.grupos.regras,
  chaveLista: 'perfis_regras',
  chaveIds: 'perfil_regras_ids',
  rotulo: 'Perfis de regras'
})

// --- 6. O grupo de estilos ---------------------------------------------------
//
// CAMINHO PLURAL, TABELA SINGULAR (`producao.perfil_estilo`). É o GRUPO de
// estilos que a subfase escolhe, e não o estilo camada a camada.

crudDePerfil({
  caminho: '/configuracao/perfil_estilos',
  ctrl: perfilCtrl.estilos,
  schema: perfilSchema.grupos.estilos,
  chaveLista: 'perfis_estilos',
  chaveIds: 'perfil_estilos_ids',
  rotulo: 'Perfis de estilos'
})

// --- 7. O requisito de finalização -------------------------------------------
//
// O que o operador confirma à mão antes de finalizar. Texto puro, na ordem em
// que aparece.

crudDePerfil({
  caminho: '/configuracao/perfil_requisito_finalizacao',
  ctrl: perfilCtrl.requisitoFinalizacao,
  schema: perfilSchema.grupos.requisitoFinalizacao,
  chaveLista: 'perfis_requisito',
  chaveIds: 'perfil_requisito_ids',
  rotulo: 'Requisitos de finalização'
})

// --- 8. O apelido dos campos das camadas -------------------------------------
//
// ATENÇÃO À CHAVE DOS IDS: aqui ela é `perfis_alias_ids`, no plural do
// primeiro termo, e não `perfil_alias_ids` como nos grupos de 1 a 7. É assim no
// SAP, e é assim que o SAP Gerente a manda.

crudDePerfil({
  caminho: '/configuracao/perfil_alias',
  ctrl: perfilCtrl.alias,
  schema: perfilSchema.grupos.alias,
  chaveLista: 'perfis_alias',
  chaveIds: 'perfis_alias_ids',
  rotulo: 'Perfis de alias'
})

// --- 9. O tema de camadas ----------------------------------------------------
//
// Caminho plural, tabela singular (`producao.perfil_tema`), como o de estilos.

crudDePerfil({
  caminho: '/configuracao/perfil_temas',
  ctrl: perfilCtrl.temas,
  schema: perfilSchema.grupos.temas,
  chaveLista: 'perfis_temas',
  chaveIds: 'perfil_temas_ids',
  rotulo: 'Perfis de tema'
})

// --- 10. Como as ferramentas do DSGTools nascem configuradas -----------------

crudDePerfil({
  caminho: '/configuracao/perfil_configuracao_qgis',
  ctrl: perfilCtrl.configuracaoQgis,
  schema: perfilSchema.grupos.configuracaoQgis,
  chaveLista: 'perfis_configuracao_qgis',
  chaveIds: 'perfis_configuracao_qgis_ids',
  rotulo: 'Perfis de configuração do QGIS'
})

// --- 11. O workflow do DSGTools ----------------------------------------------
//
// A CHAVE DO ARRAY É SINGULAR (`perfil_workflow_dsgtools`), e é a única assim
// entre os doze grupos. Vem do SAP.

crudDePerfil({
  caminho: '/configuracao/perfil_workflow_dsgtools',
  ctrl: perfilCtrl.workflowDsgtools,
  schema: perfilSchema.grupos.workflowDsgtools,
  chaveLista: 'perfil_workflow_dsgtools',
  chaveIds: 'perfil_workflow_dsgtools_ids',
  rotulo: 'Perfis de workflow DSGTools'
})

// --- 12. Que dificuldade entregar a esta pessoa ------------------------------
//
// O CAMINHO É `perfil_dificuldade_operador` E A TABELA É
// `producao.habilitacao_dificuldade`. O caminho é o do SAP porque o SAP Gerente
// o consome; a tabela mudou de nome porque no SCA "perfil" já quer dizer
// autorização, e esta é a única das doze que fala de PESSOAS.
//
// ISTO NÃO CONCEDE ACESSO A NADA. Quem barra escrita continua sendo o perfil do
// módulo `producao` em `dgeo.usuario_perfil`, lido pelo `verifyPerfil` acima.
// Esta tabela só diz que trabalho a distribuição pode entregar a quem já está
// autorizado a operar.
//
// A PESSOA É `usuario_uuid`, e não o `usuario_id` INTEGER do SAP: no SCA toda
// coluna de pessoa aponta `dgeo.usuario (uuid)`.

crudDePerfil({
  caminho: '/configuracao/perfil_dificuldade_operador',
  ctrl: perfilCtrl.dificuldadeOperador,
  schema: perfilSchema.grupos.dificuldadeOperador,
  chaveLista: 'perfis_dificuldade_operador',
  chaveIds: 'perfis_dificuldade_operador_ids',
  rotulo: 'Habilitações por dificuldade',
  genero: 'f'
})

// --- 13. A cópia da configuração de um lote para outro -----------------------
//
// DECLARADA À MÃO, e não pela fábrica: ela não é um CRUD, é uma operação. Doze
// interruptores no corpo dizem que grupos atravessam, e o ato inteiro é UMA
// transação -- copiar onze grupos em onze requisições deixaria o lote meio
// configurado quando a sexta falhasse.
//
// ELA RECUSA CÓPIA ENTRE LINHAS DE PRODUÇÃO DIFERENTES desde 2026-08-09, com
// 400: a configuração aponta subfases, e subfase de uma linha que o lote de
// destino não executa vira dezenas de linhas que sessão nenhuma do QGIS lê. É a
// trava do SAP 2.3.5 recuperada; o `perfil_ctrl.js` explica por que ela deixou
// de ser a igualdade de `linha_producao_id` que a origem cobrava, e por que a
// chave estrangeira não pega isso sozinha.
//
// `copiar_monitoramento` PASSOU A COPIAR EM 2026-08-09, quando o microcontrole
// atravessou por decisão do chefe: ele leva `microcontrole.perfil_monitoramento`
// pela mesma fábrica dos outros onze. Até ali ele era aceito e não copiava nada,
// e a resposta o declarava em `nao_copiado`. A lista `nao_copiado` continua na
// resposta, hoje sempre vazia. Ver `perfil_ctrl.js` e `docs/decisoes.md`.

router.post(
  '/configuracao/lote/copiar',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: perfilSchema.configuracaoLoteCopiar }),
  asyncHandler(async (req, res, next) => {
    const dados = await perfilCtrl.copiarConfiguracaoLote(
      req.body, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Configuração do lote copiada com sucesso', httpCode.OK, dados
    )
  })
)

module.exports = router
