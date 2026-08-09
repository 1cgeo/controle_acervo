'use strict'

// PRODUÇÃO, fatia do CADASTRO: os DOMÍNIOS do fluxo de produção e o CATÁLOGO do
// QGIS que o cliente de produção baixa do banco (estilos, regras, menus, temas,
// alias, modelos, workflows e o servidor do FME).
//
// Atravessou do `server/src/projeto/projeto_route.js` do SAP 2.3.5. São 49
// rotas, montadas em `/` dentro de `producao_route.js`.
//
// A RÉGUA DE PERFIL, e ela é TRADUÇÃO DAS GUARDAS DO SAP, não invenção. Lá o
// arquivo inteiro abre com `router.use(verifyLogin)` e a maioria das rotas
// acrescenta `verifyAdmin`. A tradução, código por código:
//
//   só o verifyLogin do topo  ->  verifyPerfil('operador', 'producao')
//   verifyLogin + verifyAdmin ->  verifyPerfil('gerente', 'producao')
//
// Na frase da casa (2026-08-08) isso lê bem: os DOMÍNIOS são as listas que quem
// LANÇA precisa para montar um formulário de fluxo, e o CATÁLOGO do QGIS é
// publicação, que responde pela área. Um estilo trocado vale para toda a linha
// de produção que o aponta, e um menu apagado some da tela de todo operador
// distribuído naquela subfase.
//
// E TODO `verifyPerfil` LEVA O SEGUNDO ARGUMENTO. O default dele é 'acervo':
// uma rota daqui que o esquecesse passaria a cobrar perfil no ACERVO, sem erro
// de sintaxe, sem teste vermelho e sem nada na tela. Quem cobra isto é
// `__tests__/routes/producao/dominio_qgis.test.js`, que lê este fonte.
//
// NÃO HÁ ROTA COM PARÂMETRO NESTE ARQUIVO, e por isso a armadilha da ordem de
// declaração (`/perfil` caindo em `/:uuid`) não se aplica aqui. Toda escrita é
// em MASSA, com a lista no CORPO, inclusive o DELETE: é o contrato do SAP
// Gerente e do plugin do QGIS, que publicam o catálogo inteiro de uma vez.
//
// O 201 NO PUT E NO DELETE parece defeito, e é o SAP. Lá as três escritas
// respondem `httpCode.Created`, e os clientes que as consomem são compilados
// FORA deste repositório: trocar por 200 aqui é mudança de contrato que não se
// vê em teste nenhum daqui, e se descobre no dia do deploy. Rota nova deste
// módulo NÃO deve copiar isto.
//
// `GET /tipo_produto` do SAP não atravessou: quem responde é
// `GET /api/gerencia/dominio/subtipo_produto`, porque o `dominio.tipo_produto`
// de lá é o `dominio.subtipo_produto` daqui.

const express = require('express')

const { asyncHandler, httpCode } = require('../utils')

// O validador ESTRITO, e não o tolerante de `utils/schema_validation.js`: chave
// desconhecida no corpo vira 400 com a sugestão do nome mais parecido, em vez de
// ser descartada em silêncio. O SAP usava o tolerante, e a troca é deliberada:
// um `stylename` mandado no lugar de `styleqml` sumia sem aviso e o estilo era
// gravado vazio.
const schemaValidation = require('../utils/schema_validation_estrito')

const { verifyPerfil } = require('../login')

const dominioQgisCtrl = require('./dominio_qgis_ctrl')
const dominioQgisSchema = require('./dominio_qgis_schema')

const router = express.Router()

// =============================================================================
// A. Os domínios do fluxo de produção
// =============================================================================
//
// Onze listas de `code, nome`, uma por rota. No SAP elas tinham só o
// `verifyLogin` do topo, e aqui o piso é `operador`.

// A ROTA SE CHAMA `/status` E A TABELA NÃO. No SAP ela lia `dominio.status`, que
// não atravessou; quem responde é `dominio.tipo_status_execucao` (1 Não
// iniciado, 2 Em execução, 3 Concluído, 4 Concluído parcialmente, 5 Pausado),
// que é a mesma pergunta com o nome que o SCA já usava. O CAMINHO fica como
// estava porque é o que o SAP Gerente chama.
router.get(
  '/status',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.status()
    return res.sendJsonAndLog(
      true, 'Valores possíveis para status retornados', httpCode.OK, dados
    )
  })
)

router.get(
  '/tipo_rotina',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoRotina()
    return res.sendJsonAndLog(
      true, 'Tipos de rotina retornados', httpCode.OK, dados
    )
  })
)

router.get(
  '/tipo_criacao_unidade_trabalho',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoCriacaoUnidadeTrabalho()
    return res.sendJsonAndLog(
      true, 'Tipos de criação de unidade de trabalho retornados', httpCode.OK, dados
    )
  })
)

router.get(
  '/tipo_controle_qualidade',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoControleQualidade()
    return res.sendJsonAndLog(
      true, 'Tipos de controle de qualidade retornados', httpCode.OK, dados
    )
  })
)

router.get(
  '/tipo_fase',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoFase()
    return res.sendJsonAndLog(
      true, 'Tipos de fase retornados', httpCode.OK, dados
    )
  })
)

// BUG DA ORIGEM, CORRIGIDO AQUI. No SAP esta rota chamava
// `getTipoPreRequisito`, que lia `metadado.tipo_palavra_chave`: a rota se chama
// pré-requisito e devolvia palavras-chave de metadado, que é outro assunto.
// Aqui ela lê `dominio.tipo_pre_requisito`, que é o domínio que
// `producao.pre_requisito_subfase` referencia de verdade.
router.get(
  '/tipo_pre_requisito',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoPreRequisito()
    return res.sendJsonAndLog(
      true, 'Tipos de pré-requisito retornados', httpCode.OK, dados
    )
  })
)

router.get(
  '/tipo_etapa',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoEtapa()
    return res.sendJsonAndLog(
      true, 'Tipos de etapa retornados', httpCode.OK, dados
    )
  })
)

router.get(
  '/tipo_exibicao',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoExibicao()
    return res.sendJsonAndLog(
      true, 'Tipos de exibição retornados', httpCode.OK, dados
    )
  })
)

// SÃO DOIS CODES, e não três: 'Operadores no mesmo turno' saiu em 2026-08-09
// junto com `dominio.tipo_turno`. Quem espera três aqui vem do SAP 2.3.5.
router.get(
  '/tipo_restricao',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoRestricao()
    return res.sendJsonAndLog(
      true, 'Tipos de restrição retornados', httpCode.OK, dados
    )
  })
)

router.get(
  '/tipo_insumo',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoInsumo()
    return res.sendJsonAndLog(
      true, 'Tipos de insumo retornados', httpCode.OK, dados
    )
  })
)

router.get(
  '/tipo_dado_producao',
  verifyPerfil('operador', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoDadoProducao()
    return res.sendJsonAndLog(
      true, 'Tipos de dado de produção retornados', httpCode.OK, dados
    )
  })
)

// =============================================================================
// B. O catálogo do QGIS
// =============================================================================
//
// Nove grupos de quatro rotas, todos `gerente`: no SAP as 36 tinham
// `verifyAdmin`. A forma é sempre a mesma -- GET lista, POST grava uma leva, PUT
// atualiza uma leva, DELETE apaga pela lista de ids NO CORPO.

// --- Grupo de estilos --------------------------------------------------------

router.get(
  '/grupo_estilos',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.grupoEstilos.listar()
    return res.sendJsonAndLog(
      true, 'Grupo de estilos retornados', httpCode.OK, dados
    )
  })
)

router.post(
  '/grupo_estilos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.grupoEstilos }),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.grupoEstilos.gravar(
      req.body.grupo_estilos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Grupo de estilos gravados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/grupo_estilos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.grupoEstilosAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.grupoEstilos.atualizar(
      req.body.grupo_estilos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Grupo de estilos atualizados com sucesso', httpCode.Created
    )
  })
)

router.delete(
  '/grupo_estilos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.grupoEstilosIds }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.grupoEstilos.deletar(
      req.body.grupo_estilos_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Grupo de estilos deletados com sucesso', httpCode.Created
    )
  })
)

// --- Regras ------------------------------------------------------------------

router.get(
  '/regras',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.regras.listar()
    return res.sendJsonAndLog(true, 'Regras retornadas', httpCode.OK, dados)
  })
)

router.post(
  '/regras',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.regras }),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.regras.gravar(
      req.body.regras, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Regras gravadas com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/regras',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.regrasAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.regras.atualizar(
      req.body.regras, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Regras atualizadas com sucesso', httpCode.Created
    )
  })
)

router.delete(
  '/regras',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.regrasIds }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.regras.deletar(
      req.body.regras_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Regras deletadas com sucesso', httpCode.Created
    )
  })
)

// --- Menus -------------------------------------------------------------------

router.get(
  '/menus',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.menus.listar()
    return res.sendJsonAndLog(true, 'Menus retornados', httpCode.OK, dados)
  })
)

router.post(
  '/menus',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.menus }),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.menus.gravar(
      req.body.menus, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Menus gravados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/menus',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.menusAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.menus.atualizar(
      req.body.menus, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Menus atualizados com sucesso', httpCode.Created
    )
  })
)

router.delete(
  '/menus',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.menusIds }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.menus.deletar(
      req.body.menus_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Menus deletados com sucesso', httpCode.Created
    )
  })
)

// --- Estilos -----------------------------------------------------------------

router.get(
  '/estilos',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.estilos.listar()
    return res.sendJsonAndLog(true, 'Estilos retornados', httpCode.OK, dados)
  })
)

router.post(
  '/estilos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.estilos }),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.estilos.gravar(
      req.body.estilos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Estilos gravados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/estilos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.estilosAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.estilos.atualizar(
      req.body.estilos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Estilos atualizados com sucesso', httpCode.Created
    )
  })
)

router.delete(
  '/estilos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.estilosIds }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.estilos.deletar(
      req.body.estilos_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Estilos deletados com sucesso', httpCode.Created
    )
  })
)

// --- Modelos -----------------------------------------------------------------

router.get(
  '/modelos',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.modelos.listar()
    return res.sendJsonAndLog(true, 'Modelos retornados', httpCode.OK, dados)
  })
)

router.post(
  '/modelos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.modelos }),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.modelos.gravar(
      req.body.modelos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Modelos gravados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/modelos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.modelosAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.modelos.atualizar(
      req.body.modelos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Modelos atualizados com sucesso', httpCode.Created
    )
  })
)

router.delete(
  '/modelos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.modelosIds }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.modelos.deletar(
      req.body.modelos_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Modelos deletados com sucesso', httpCode.Created
    )
  })
)

// --- Alias -------------------------------------------------------------------

router.get(
  '/alias',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.alias.listar()
    return res.sendJsonAndLog(true, 'Alias retornados', httpCode.OK, dados)
  })
)

router.post(
  '/alias',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.alias }),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.alias.gravar(
      req.body.alias, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Alias gravados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/alias',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.aliasAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.alias.atualizar(
      req.body.alias, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Alias atualizados com sucesso', httpCode.Created
    )
  })
)

router.delete(
  '/alias',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.aliasIds }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.alias.deletar(
      req.body.alias_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Alias deletados com sucesso', httpCode.Created
    )
  })
)

// --- Temas -------------------------------------------------------------------

router.get(
  '/temas',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.temas.listar()
    return res.sendJsonAndLog(true, 'Temas retornados', httpCode.OK, dados)
  })
)

router.post(
  '/temas',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.temas }),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.temas.gravar(
      req.body.temas, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Temas gravados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/temas',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.temasAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.temas.atualizar(
      req.body.temas, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Temas atualizados com sucesso', httpCode.Created
    )
  })
)

router.delete(
  '/temas',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.temasIds }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.temas.deletar(
      req.body.temas_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Temas deletados com sucesso', httpCode.Created
    )
  })
)

// --- Workflow do DSGTools ----------------------------------------------------
//
// O caminho é `/workflow`, no SINGULAR, e a chave do corpo é `workflows`, no
// plural. É assim no SAP, e é assim que o SAP Gerente chama.

router.get(
  '/workflow',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.workflows.listar()
    return res.sendJsonAndLog(true, 'Workflows retornados', httpCode.OK, dados)
  })
)

router.post(
  '/workflow',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.workflows }),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.workflows.gravar(
      req.body.workflows, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Workflows gravados com sucesso', httpCode.Created, dados
    )
  })
)

router.put(
  '/workflow',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.workflowsAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.workflows.atualizar(
      req.body.workflows, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Workflows atualizados com sucesso', httpCode.Created
    )
  })
)

router.delete(
  '/workflow',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.workflowsIds }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.workflows.deletar(
      req.body.workflows_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Workflows deletados com sucesso', httpCode.Created
    )
  })
)

// --- Gerenciador do FME ------------------------------------------------------
//
// O SAP CHECAVA A CONEXÃO ANTES DE GRAVAR, e aqui isso NÃO acontece.
//
// Lá, `criaGerenciadorFME` e `atualizaGerenciadorFME` chamavam
// `checkFMEConnection(url)` de `src/gerenciador_fme`, que batia no servidor e
// recusava o cadastro se ele não respondesse. Esse módulo não atravessou para o
// SCA, e a consequência é honesta: uma URL errada é aceita aqui e só falha na
// hora em que uma rotina de validação for executada. É PENDÊNCIA, e está no
// relatório desta fatia.

router.get(
  '/configuracao/gerenciador_fme',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.gerenciadorFme.listar()
    return res.sendJsonAndLog(
      true,
      'Informações dos serviços do Gerenciador do FME retornadas com sucesso',
      httpCode.OK,
      dados
    )
  })
)

router.post(
  '/configuracao/gerenciador_fme',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.gerenciadorFme }),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.gerenciadorFme.gravar(
      req.body.gerenciador_fme, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true,
      'Informações dos serviços do Gerenciador do FME inseridas com sucesso',
      httpCode.Created,
      dados
    )
  })
)

router.put(
  '/configuracao/gerenciador_fme',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.gerenciadorFmeAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.gerenciadorFme.atualizar(
      req.body.gerenciador_fme, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true,
      'Informações dos serviços do Gerenciador do FME atualizadas com sucesso',
      httpCode.Created
    )
  })
)

router.delete(
  '/configuracao/gerenciador_fme',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: dominioQgisSchema.gerenciadorFmeIds }),
  asyncHandler(async (req, res, next) => {
    await dominioQgisCtrl.gerenciadorFme.deletar(
      req.body.servidores_id, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true,
      'Informações dos serviços do Gerenciador do FME deletadas com sucesso',
      httpCode.Created
    )
  })
)

// =============================================================================
// C. As duas listas de domínio que no SAP eram de administrador
// =============================================================================
//
// As duas são `code, nome` como as onze de cima, e mesmo assim o piso é
// `gerente`: no SAP as duas carregavam `verifyAdmin`, e a tradução das guardas
// não escolhe por parecença. As duas descrevem ARGUMENTO de rotina em massa (a
// associação de insumo às unidades de trabalho e a fila prioritária por
// dificuldade), que é decisão de quem responde pela área.

router.get(
  '/tipo_estrategia_associacao',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoEstrategiaAssociacao()
    return res.sendJsonAndLog(
      true, 'Estratégias retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.get(
  '/tipo_perfil_dificuldade',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await dominioQgisCtrl.dominio.tipoPerfilDificuldade()
    return res.sendJsonAndLog(
      true, 'Tipo perfil dificuldade retornado com sucesso', httpCode.OK, dados
    )
  })
)

module.exports = router
