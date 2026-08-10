'use strict'

// GERENCIA DA PRODUCAO (`/api/gerencia_producao`).
//
// O QUE ESTA TELA FAZ: pausa, reinicia, devolve e avanca atividade; fura a fila
// para uma pessoa ou para um grupo; declara quem esta habilitado a receber o
// que; responde ao problema apontado pelo operador e a alteracao de fluxo;
// escreve a observacao da folha; e mantem o que o cliente de producao precisa ter
// instalado (versao minima do QGIS, plugins, atalhos e o caminho de onde ele se
// atualiza).
//
// O PREFIXO NAO E O DO SAP, e a razao esta em `routes.js`: `/api/gerencia` ja
// existe aqui com 14 rotas do ACERVO, e quem chega e quem se acomoda.
//
// ---------------------------------------------------------------------------
// A GUARDA
// ---------------------------------------------------------------------------
//
// TODA ROTA E `verifyPerfil('gerente', 'producao')`, e o segundo argumento nunca
// falta. As 67 rotas da origem eram `verifyAdmin` do SAP, sem excecao, e a
// traducao acordada para esta leva e: `verifyAdmin` de la vira GERENTE no modulo
// `producao` daqui. Nao ha rota de leitura em `consulta` porque nao ha leitura
// inocente neste arquivo: `GET /view_acompanhamento` devolve a CREDENCIAL de
// banco, `GET /fila_prioritaria` mostra quem furou a fila de quem, e
// `GET /habilitacao_usuario` e o mapa de quem trabalha em que. O administrador
// global continua passando por cima, como em todo modulo.
//
// O DEFAULT DE `verifyPerfil` E 'acervo'. Uma rota daqui que esquecesse o
// segundo argumento passaria a cobrar perfil no ACERVO, sem erro de sintaxe, sem
// teste vermelho e sem nada na tela. `__tests__/routes/gerencia_producao/`
// varre este arquivo e cobra o argumento em toda chamada.
//
// ---------------------------------------------------------------------------
// O QUE NAO ATRAVESSOU NESTA LEVA, e por que
// ---------------------------------------------------------------------------
//
// `GET /projeto_qgis`  o SAP le `templates/sap_config_template.qgs` e interpola
//                      o endereco e a senha do banco dentro do .qgs. O template
//                      nao existe neste repositorio, e traze-lo e decisao a
//                      parte: ele e um projeto do QGIS inteiro, com as camadas
//                      da producao, e o que ele desenha depende das telas que
//                      ainda vao entrar.
//
// `GET /atividade/:id` e `GET /atividade/usuario/:id` montam o PACOTE da
//                      atividade (camadas, estilos, menus, temas, modelos,
//                      regras, insumos, linhagem, requisitos, atalhos), que e a
//                      mesma funcao que a distribuicao entrega ao operador.
//                      Ela mora em `producao`/`distribuicao`, e duplica-la aqui
//                      daria duas respostas para a mesma pergunta.
//
// SEM BARRA-ASTERISCO EM COMENTARIO NESTE ARQUIVO, e a proibicao e literal.
// `__tests__/routes/gerencia_producao/perfil.test.js` limpa o fonte antes de
// varre-lo, e a limpeza casa `/` seguido de `*` como ABERTURA de bloco: um
// `/banco_dados/` com asterisco no fim, escrito em prosa, se fecharia no proximo
// `*/` de verdade -- o fim do primeiro bloco de swagger daqui -- e engoliria as
// rotas do meio. O sintoma foi a varredura enxergar 3 guardas onde ha 59, e ela
// nao acusa a causa: ela acusa que as rotas perderam a protecao.
//
// `PUT /atividades/permissoes` e as duas de `/banco_dados` ENTRARAM, e a razao
//                      de terem ficado para depois esta resolvida: a conexao
//                      administrativa a um banco de producao arbitrario agora
//                      existe, em `database/conexao_admin.js`, e o papel efemero
//                      e o grant camada a camada em
//                      `database/permissoes_producao.js`. As tres estao no fim
//                      deste arquivo, com o cabecalho proprio delas. A
//                      credencial de superusuario vem das chaves
//                      `PRODUCAO_DB_ADMIN_USER` e `PRODUCAO_DB_ADMIN_PASSWORD`
//                      do arquivo de configuracao do servidor, que e gitignored;
//                      sem elas o subsistema fica desligado e as tres respondem
//                      503, sem afetar o resto do modulo.
//
// `/pit` (5 rotas)     `macrocontrole.pit` NAO atravessou, por decisao ja
//                      registrada em `docs/decisoes.md`: a meta do PIT daqui e
//                      `pit.meta`, e quem a serve e `/api/metas`.

const express = require('express')

// O validador ESTRITO, e nao o tolerante de `utils/schema_validation.js`: chave
// desconhecida no corpo vira 400 com sugestao do nome mais parecido, em vez de
// ser descartada em silencio. E a escolha do orcamento e do equipamento, e aqui
// ela vale ainda mais: o corpo destas rotas e uma LISTA de linhas de grade, e um
// `perfil_producao_id` que sobrou do SAP entraria calado e a linha seria gravada
// sem a habilitacao que o nome novo pede.
const schemaValidation = require('../utils/schema_validation_estrito')

const { asyncHandler, httpCode } = require('../utils')

const { verifyPerfil } = require('../login')

const gerenciaProducaoCtrl = require('./gerencia_producao_ctrl')
const gerenciaProducaoSchema = require('./gerencia_producao_schema')

const router = express.Router()

// TODA ROTA LITERAL VEM ANTES DE ROTA COM PARAMETRO. O Express casa na ORDEM DE
// DECLARACAO, e aqui ha uma so com parametro (`/atividade/:id/observacao`): ela
// e declarada DEPOIS de `/atividade/pausar`, `/reiniciar`, `/voltar` e
// `/avancar`, senao 'pausar' cairia no `:id` e morreria no Joi dizendo que
// "pausar" nao e numero.

// --- Habilitacao -------------------------------------------------------------
//
// ERA `perfil_producao*` NO SAP, e o nome mudou porque aqui "perfil" e
// AUTORIZACAO (`dominio.tipo_perfil`: consulta, operador, gerente). Habilitacao
// e o que a DISTRIBUICAO pode entregar a quem ja esta autorizado a operar: quem
// le `habilitacao_usuario` nao pensa que aquilo concede acesso, e quem lia
// `perfil_producao_operador` pensava.

router.get(
  '/habilitacao',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getHabilitacao()
    return res.sendJsonAndLog(
      true, 'Habilitações retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/habilitacao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.criaHabilitacao(
      req.body.habilitacao, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Habilitações criadas com sucesso', httpCode.Created
    )
  })
)

router.put(
  '/habilitacao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaHabilitacao(
      req.body.habilitacao, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Habilitações atualizadas com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/habilitacao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoIds }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.deletaHabilitacao(
      req.body.habilitacao_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Habilitações deletadas com sucesso', httpCode.OK
    )
  })
)

router.get(
  '/habilitacao_etapa',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getHabilitacaoEtapa()
    return res.sendJsonAndLog(
      true, 'Etapas das habilitações retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/habilitacao_etapa',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoEtapa }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.criaHabilitacaoEtapa(
      req.body.habilitacao_etapa, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Etapas das habilitações criadas com sucesso', httpCode.Created
    )
  })
)

router.put(
  '/habilitacao_etapa',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoEtapaAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaHabilitacaoEtapa(
      req.body.habilitacao_etapa, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Etapas das habilitações atualizadas com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/habilitacao_etapa',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoEtapaIds }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.deletaHabilitacaoEtapa(
      req.body.habilitacao_etapa_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Etapas das habilitações deletadas com sucesso', httpCode.OK
    )
  })
)

router.get(
  '/habilitacao_usuario',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getHabilitacaoUsuario()
    return res.sendJsonAndLog(
      true, 'Pessoas habilitadas retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/habilitacao_usuario',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoUsuario }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.criaHabilitacaoUsuario(
      req.body.habilitacao_usuario, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Pessoas habilitadas criadas com sucesso', httpCode.Created
    )
  })
)

router.put(
  '/habilitacao_usuario',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoUsuarioAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaHabilitacaoUsuario(
      req.body.habilitacao_usuario, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Pessoas habilitadas atualizadas com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/habilitacao_usuario',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoUsuarioIds }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.deletaHabilitacaoUsuario(
      req.body.habilitacao_usuario_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Pessoas habilitadas deletadas com sucesso', httpCode.OK
    )
  })
)

router.get(
  '/habilitacao_bloco',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getHabilitacaoBloco()
    return res.sendJsonAndLog(
      true, 'Habilitações de bloco retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/habilitacao_bloco',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoBloco }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.criaHabilitacaoBloco(
      req.body.habilitacao_bloco, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Habilitações de bloco criadas com sucesso', httpCode.Created
    )
  })
)

router.put(
  '/habilitacao_bloco',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoBlocoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaHabilitacaoBloco(
      req.body.habilitacao_bloco, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Habilitações de bloco atualizadas com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/habilitacao_bloco',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.habilitacaoBlocoIds }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.deletaHabilitacaoBloco(
      req.body.habilitacao_bloco_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Habilitações de bloco deletadas com sucesso', httpCode.OK
    )
  })
)

// --- Unidade de trabalho -----------------------------------------------------

router.post(
  '/unidade_trabalho/disponivel',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.unidadeTrabalhoDisponivel }),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.unidadeTrabalhoDisponivel(
      req.body.unidade_trabalho_ids,
      req.body.disponivel,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true,
      'Disponibilidade das unidades de trabalho atualizada com sucesso',
      httpCode.Created,
      dados
    )
  })
)

router.put(
  '/unidade_trabalho/propriedades',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.propriedadesAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaPropriedadesUT(
      req.body.unidades_trabalho, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Propriedades das unidades de trabalho atualizadas com sucesso', httpCode.OK
    )
  })
)

// --- Atividade: a maquina de estado ------------------------------------------
//
// TRES DELAS DEVOLVEM `revogacao` NO ENVELOPE, e o campo e NOVO desde 2026-08-09:
// tirar o trabalho da mao de alguem tambem fecha o acesso dele ao banco de
// EDICAO, que e outro PostgreSQL. `dados` e NULO no caso comum -- quando o dado
// de producao daquelas unidades nao e PostGIS com controle de permissao, nao ha
// porta a fechar e o envelope sai como sempre saiu. Ele so traz alguma coisa
// quando houve o que revogar, e traz `ok: false` com a providencia quando a
// revogacao falhou: a operacao vale nos dois casos, e ninguem recebe "sucesso"
// por revogacao que nao revogou. A decisao inteira esta em
// `gerencia_producao_ctrl.js`, no alto da secao da maquina de estado.

router.post(
  '/atividade/pausar',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.atividadePausar }),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.pausaAtividade(
      req.body.unidade_trabalho_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Atividade pausada com sucesso', httpCode.Created, dados
    )
  })
)

router.post(
  '/atividade/reiniciar',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.atividadeReiniciar }),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.reiniciaAtividade(
      req.body.unidade_trabalho_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Atividade reiniciada com sucesso', httpCode.Created, dados
    )
  })
)

router.post(
  '/atividade/voltar',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.atividadeVoltar }),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.voltaAtividade(
      req.body.atividade_ids,
      req.body.manter_usuarios,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Atividade voltou para a etapa anterior com sucesso', httpCode.Created, dados
    )
  })
)

router.post(
  '/atividade/avancar',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.atividadeAvancar }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.avancaAtividade(
      req.body.atividade_ids,
      req.body.concluida,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Atividade avançou para a próxima etapa com sucesso', httpCode.Created
    )
  })
)

// A UNICA ROTA COM PARAMETRO DESTE ARQUIVO, e por isso ela vem DEPOIS das
// quatro acima: com `/atividade/:id/observacao` declarada antes, nada mudaria
// (os caminhos tem numero de segmentos diferente), mas a regra da casa e de
// ORDEM e nao de sorte -- a proxima rota literal de `/atividade` que alguem
// acrescentar acima dela ja nasce protegida.
router.get(
  '/atividade/:id/observacao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ params: gerenciaProducaoSchema.idParams }),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getObservacao(req.params.id)
    return res.sendJsonAndLog(
      true, 'Observações retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.put(
  '/observacao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.observacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.criaObservacao(
      req.body.atividade_ids,
      req.body.observacao_atividade,
      req.body.observacao_unidade_trabalho,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(true, 'Observação gravada com sucesso', httpCode.OK)
  })
)

// --- Modo local --------------------------------------------------------------

router.put(
  '/iniciar_modo_local',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.iniciaAtividadeModoLocal }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.iniciaAtividadeModoLocal(
      req.body.atividade_id, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Atividade iniciada em modo local com sucesso', httpCode.OK
    )
  })
)

router.put(
  '/finalizar_modo_local',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.finalizaAtividadeModoLocal }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.finalizaAtividadeModoLocal(
      req.body.atividade_id,
      req.body.usuario_uuid,
      req.body.data_inicio,
      req.body.data_fim,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Atividade finalizada em modo local com sucesso', httpCode.OK
    )
  })
)

// --- Fila prioritaria --------------------------------------------------------

router.get(
  '/fila_prioritaria',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getFilaPrioritaria()
    return res.sendJsonAndLog(
      true, 'Fila prioritária retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/fila_prioritaria',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.filaPrioritaria }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.criaFilaPrioritaria(
      req.body.atividade_ids,
      req.body.usuario_uuid,
      req.body.prioridade,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Entradas da fila prioritária criadas com sucesso', httpCode.Created
    )
  })
)

router.put(
  '/fila_prioritaria',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.filaPrioritariaAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaFilaPrioritaria(
      req.body.fila_prioritaria, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Entradas da fila prioritária atualizadas com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/fila_prioritaria',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.filaPrioritariaIds }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.deletaFilaPrioritaria(
      req.body.fila_prioritaria_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Entradas da fila prioritária deletadas com sucesso', httpCode.OK
    )
  })
)

router.get(
  '/fila_prioritaria_grupo',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getFilaPrioritariaGrupo()
    return res.sendJsonAndLog(
      true, 'Fila prioritária de grupo retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/fila_prioritaria_grupo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.filaPrioritariaGrupo }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.criaFilaPrioritariaGrupo(
      req.body.atividade_ids,
      req.body.habilitacao_id,
      req.body.prioridade,
      req.usuarioUuid,
      req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Entradas da fila prioritária de grupo criadas com sucesso', httpCode.Created
    )
  })
)

router.put(
  '/fila_prioritaria_grupo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.filaPrioritariaGrupoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaFilaPrioritariaGrupo(
      req.body.fila_prioritaria_grupo, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Entradas da fila prioritária de grupo atualizadas com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/fila_prioritaria_grupo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.filaPrioritariaGrupoIds }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.deletaFilaPrioritariaGrupo(
      req.body.fila_prioritaria_grupo_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Entradas da fila prioritária de grupo deletadas com sucesso', httpCode.OK
    )
  })
)

// --- Problema de atividade e alteracao de fluxo ------------------------------

router.get(
  '/problema_atividade',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getProblemaAtividade()
    return res.sendJsonAndLog(
      true, 'Problemas de atividade retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.put(
  '/problema_atividade',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.problemaAtividadeAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaProblemaAtividade(
      req.body.problema_atividade, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Problemas de atividade atualizados com sucesso', httpCode.OK
    )
  })
)

router.get(
  '/alteracao_fluxo',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getAlteracaoFluxo()
    return res.sendJsonAndLog(
      true, 'Alterações de fluxo retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.put(
  '/alteracao_fluxo',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.alteracaoFluxoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaAlteracaoFluxo(
      req.body.alteracao_fluxo, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Alterações de fluxo atualizadas com sucesso', httpCode.OK
    )
  })
)

// --- Relatorio de alteracao --------------------------------------------------

router.get(
  '/relatorio_alteracao',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getRelatorioAlteracao()
    return res.sendJsonAndLog(
      true, 'Relatórios de alteração retornados com sucesso', httpCode.OK, dados
    )
  })
)

router.post(
  '/relatorio_alteracao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.relatorioAlteracao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.gravaRelatorioAlteracao(
      req.body.relatorio_alteracao, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Relatórios de alteração gravados com sucesso', httpCode.Created
    )
  })
)

router.put(
  '/relatorio_alteracao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.relatorioAlteracaoAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaRelatorioAlteracao(
      req.body.relatorio_alteracao, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Relatórios de alteração atualizados com sucesso', httpCode.OK
    )
  })
)

router.delete(
  '/relatorio_alteracao',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.relatorioAlteracaoIds }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.deletaRelatorioAlteracao(
      req.body.relatorio_alteracao_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Relatórios de alteração deletados com sucesso', httpCode.OK
    )
  })
)

// --- QGIS: o que o cliente de producao precisa ter instalado -----------------

router.get(
  '/versao_qgis',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getVersaoQGIS()
    return res.sendJsonAndLog(
      true, 'Versão mínima do QGIS retornada com sucesso', httpCode.OK, dados
    )
  })
)

router.put(
  '/versao_qgis',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.versaoQGIS }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaVersaoQGIS(
      req.body.versao_minima, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Versão mínima do QGIS atualizada com sucesso', httpCode.OK
    )
  })
)

router.get(
  '/plugins',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getPlugins()
    return res.sendJsonAndLog(true, 'Plugins retornados com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/plugins',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.plugins }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.gravaPlugins(
      req.body.plugins, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Plugins gravados com sucesso', httpCode.Created)
  })
)

router.put(
  '/plugins',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.pluginsAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaPlugins(
      req.body.plugins, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Plugins atualizados com sucesso', httpCode.OK)
  })
)

router.delete(
  '/plugins',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.pluginsIds }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.deletaPlugins(
      req.body.plugins_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Plugins deletados com sucesso', httpCode.OK)
  })
)

router.get(
  '/atalhos',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getAtalhos()
    return res.sendJsonAndLog(true, 'Atalhos retornados com sucesso', httpCode.OK, dados)
  })
)

router.post(
  '/atalhos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.atalhos }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.gravaAtalhos(
      req.body.atalhos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Atalhos gravados com sucesso', httpCode.Created)
  })
)

router.put(
  '/atalhos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.atalhosAtualizacao }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaAtalhos(
      req.body.atalhos, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Atalhos atualizados com sucesso', httpCode.OK)
  })
)

router.delete(
  '/atalhos',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.atalhosIds }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.deletaAtalhos(
      req.body.atalhos_ids, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(true, 'Atalhos deletados com sucesso', httpCode.OK)
  })
)

router.get(
  '/plugin_path',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getPluginPath()
    return res.sendJsonAndLog(
      true, 'Caminho do plugin retornado com sucesso', httpCode.OK, dados
    )
  })
)

router.put(
  '/plugin_path',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.pluginPath }),
  asyncHandler(async (req, res, next) => {
    await gerenciaProducaoCtrl.atualizaPluginPath(
      req.body.plugin_path, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Caminho do plugin atualizado com sucesso', httpCode.OK
    )
  })
)

// --- A credencial de leitura do banco ----------------------------------------

// ELA SAIU DO LOGIN E VIROU UMA ROTA PRÓPRIA, de GERENTE (chefe, 2026-08-09).
//
// No SAP 2.3.5 o `POST /login` devolvia `DB_USER` e `DB_PASSWORD` no mesmo corpo
// do token, para TODO cliente que entrasse, inclusive o web. O SAP Gerente
// precisa mesmo desse par: ele monta URI de camada e o QGIS conecta DIRETO no
// PostgreSQL, sem passar por rota nenhuma. Mas o login é a porta de quem ainda
// não provou nada, e mandar credencial de banco por ali entrega o par a quem só
// tinha uma senha de aplicação.
//
// A SAÍDA NÃO FOI CORTAR A FUNCIONALIDADE, foi mover a porta: quem quer a
// credencial pede aqui, depois de autenticado, e cai no mesmo `verifyPerfil`
// que o resto deste arquivo. Para o plugin, é uma chamada a mais logo após o
// login; para quem não é gerente, é 403 em vez de um segredo no corpo.
//
// O PAR É O DE LEITURA, e o recuo para o de ESCRITA é a prática que já existe
// no acervo (`GET /api/acervo/camadas_produto` faz igual, com o mesmo
// `DB_PASSWORD_READONLY || DB_PASSWORD`): sem `DB_USER_READONLY` configurado,
// quem recebe recebe o par de escrita. Configurar o papel somente-leitura é o
// que separa os dois, e `create_config.js` o cria.
router.get(
  '/banco_dados',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getCredencialLeitura()
    return res.sendJsonAndLog(
      true, 'Credencial de leitura do banco retornada com sucesso', httpCode.OK, dados
    )
  })
)

// --- Views de acompanhamento -------------------------------------------------

router.get(
  '/view_acompanhamento',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ query: gerenciaProducaoSchema.viewAcompanhamentoQuery }),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.getViewsAcompanhamento(
      req.query.em_andamento_projeto === 'true',
      req.query.em_andamento_lote === 'true',
      req.query.bloco ? parseInt(req.query.bloco, 10) : null
    )
    return res.sendJsonAndLog(
      true, 'Views de acompanhamento retornadas com sucesso', httpCode.OK, dados
    )
  })
)

router.put(
  '/refresh_views',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.refreshViews(
      req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Views de acompanhamento atualizadas com sucesso', httpCode.OK, dados
    )
  })
)

// --- Permissao no banco de PRODUCAO ------------------------------------------
//
// AS TRES QUE FALTAVAM, e o cabecalho deste arquivo dizia por que: elas mexem em
// OUTRO PostgreSQL. O subsistema que faltava (a conexao administrativa, o papel
// efemero e o grant camada a camada) esta em `database/conexao_admin.js` e
// `database/permissoes_producao.js`.
//
// O CORPO NAO TRAZ ENDERECO, e essa e a unica divergencia de contrato em relacao
// a origem. O SAP recebia `{ servidor, porta, banco }`; aqui o alvo e
// `dado_producao_id`, e o endereco sai do banco. A razao esta escrita no schema:
// `sendJsonAndLog` grava `req.body` no log de toda chamada, e este repositorio e
// publico. Nao ha cliente a quebrar -- nenhuma tela do SCA consumia estas rotas,
// porque elas nunca existiram aqui.
//
// AS TRES SAO `gerente` NO MODULO `producao`, como as outras 56. O `verifyAdmin`
// da origem vira gerente do modulo nesta travessia, e o administrador global
// continua passando por cima.
//
// ELAS SAO ESCRITA, E POR ISSO NAO SAO IDEMPOTENTES DE GRACA: as duas revogacoes
// sao POST porque cada chamada TROCA A SENHA do papel efemero, o que derruba
// quem estiver com o QGIS aberto -- e derrubar alguem e efeito, nao consulta. A
// reaplicacao e PUT porque ela leva o estado ao mesmo lugar toda vez, e porque e
// o metodo que a origem usava.

/**
 * @swagger
 * /api/gerencia_producao/banco_dados/revogar_permissoes:
 *   post:
 *     summary: Revoga as permissões de todos os papéis temporários de um banco de produção
 *     description: Alcança apenas os papéis efêmeros criados por este sistema, identificados pelo prefixo deles. O alvo é o dado de produção, e o endereço do banco sai do cadastro.
 *     tags:
 *       - gerencia_producao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Permissões do banco revogadas com sucesso
 *       404:
 *         description: Dado de produção não encontrado, ou não é PostGIS com controle de permissão
 *       503:
 *         description: O banco de produção não respondeu, ou o acesso administrativo não está configurado
 */
router.post(
  '/banco_dados/revogar_permissoes',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.bancoDeProducao }),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.revogarPermissoesBanco(
      req.body.dado_producao_id, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Permissões do banco de produção revogadas com sucesso', httpCode.OK, dados
    )
  })
)

/**
 * @swagger
 * /api/gerencia_producao/banco_dados/revogar_permissoes_usuario:
 *   post:
 *     summary: Revoga as permissões de uma pessoa num banco de produção
 *     description: Revoga tudo o que o papel efêmero da pessoa tem naquele banco e troca a senha dele, para que a credencial já entregue deixe de abrir. Não depende de haver atividade.
 *     tags:
 *       - gerencia_producao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Permissões da pessoa revogadas com sucesso
 *       404:
 *         description: Dado de produção ou usuário não encontrado
 *       503:
 *         description: O banco de produção não respondeu, ou o acesso administrativo não está configurado
 */
router.post(
  '/banco_dados/revogar_permissoes_usuario',
  verifyPerfil('gerente', 'producao'),
  schemaValidation({ body: gerenciaProducaoSchema.bancoDeProducaoUsuario }),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.revogarPermissoesUsuario(
      req.body.dado_producao_id, req.body.usuario_uuid, req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Permissões da pessoa no banco de produção revogadas com sucesso',
      httpCode.OK, dados
    )
  })
)

/**
 * @swagger
 * /api/gerencia_producao/atividades/permissoes:
 *   put:
 *     summary: Refaz a permissão de todas as atividades em execução
 *     description: Revoga e reconcede a permissão de cada atividade em execução cujo dado de produção é PostGIS com controle de permissão. A senha do papel não muda, para não derrubar quem está com o QGIS aberto. Uma atividade que falha não impede as outras, e cada falha volta na resposta.
 *     tags:
 *       - gerencia_producao
 *     security:
 *       - BearerAuth: []
 *     responses:
 *       200:
 *         description: Permissões das atividades em execução reaplicadas
 */
router.put(
  '/atividades/permissoes',
  verifyPerfil('gerente', 'producao'),
  asyncHandler(async (req, res, next) => {
    const dados = await gerenciaProducaoCtrl.reaplicarPermissoes(
      req.usuarioUuid, req.contexto
    )
    return res.sendJsonAndLog(
      true, 'Permissões das atividades em execução reaplicadas', httpCode.OK, dados
    )
  })
)

module.exports = router
