'use strict'

const { db } = require('../database')

// PELO CAMINHO, E NAO PELO BARRIL. `database/index.js` ainda nao exporta o
// subsistema de permissao do banco de producao; ver o cabecalho de
// `database/conexao_admin.js`.
const permissoesProducao = require('../database/permissoes_producao')

const { AppError, httpCode, domainConstants } = require('../utils')

const { auditoriaCtrl } = require('../auditoria')

const consultas = require('./consultas_fila')

const {
  SITUACAO_ATIVIDADE,
  TIPO_ETAPA,
  TIPO_FASE,
  TIPO_EXIBICAO,
  TIPO_PROBLEMA_ATIVIDADE
} = domainConstants

const controller = {}

// ---------------------------------------------------------------------------
// A FILA: qual atividade esta pessoa recebe
// ---------------------------------------------------------------------------

/**
 * A cascata de quatro consultas que decide a proxima atividade da pessoa.
 *
 * A ORDEM E A REGRA, e ela nao e arbitraria:
 *
 *   1 fila prioritaria         o gerente reservou esta folha PARA ELA
 *   2 fila prioritaria de grupo o gerente reservou para a habilitacao dela
 *   3 atividade pausada        ela mesma parou no meio desta folha
 *   4 fila normal              a ordem natural, por bloco, etapa e dificuldade
 *
 * A PAUSADA VEM DEPOIS DO FURO DE FILA de proposito: o furo e um pedido
 * explicito de quem gerencia, e ele existe justamente para passar na frente do
 * que a pessoa faria por conta propria.
 *
 * As quatro rodam num `task` (e nao numa transacao): sao SO LEITURA, e quem
 * escreve e o `inicia`, que confere a situacao da atividade no proprio UPDATE.
 *
 * @param {string} usuarioUuid
 * @returns {Promise<number|null>} o id da atividade, ou null se nao ha nenhuma
 */
controller.calculaFila = async usuarioUuid => {
  return db.conn.task(async t => {
    const filaPrioritaria = await t.oneOrNone(consultas.calculaFilaPrioritaria, {
      usuarioUuid
    })
    if (filaPrioritaria) return filaPrioritaria.id

    const filaPrioritariaGrupo = await t.oneOrNone(
      consultas.calculaFilaPrioritariaGrupo,
      { usuarioUuid }
    )
    if (filaPrioritariaGrupo) return filaPrioritariaGrupo.id

    const pausada = await t.oneOrNone(consultas.calculaFilaPausada, { usuarioUuid })
    if (pausada) return pausada.id

    const normal = await t.oneOrNone(consultas.calculaFila, { usuarioUuid })
    if (normal) return normal.id

    return null
  })
}

// ---------------------------------------------------------------------------
// O PACOTE que o plugin SAP Operador recebe
// ---------------------------------------------------------------------------
//
// Cada funcao abaixo responde por um pedaco do pacote, e todas recebem a MESMA
// conexao (`t`) porque o pacote inteiro tem de descrever o banco de um instante
// so. Sao ~15 idas ao banco por atividade iniciada, e era assim no SAP 2.3.5.

const getAlias = (t, subfaseId, loteId) =>
  t.any(
    `SELECT la.nome, la.definicao_alias
     FROM producao.perfil_alias AS pa
     INNER JOIN qgis.layer_alias AS la ON la.id = pa.alias_id
     WHERE pa.subfase_id = $<subfaseId> AND pa.lote_id = $<loteId>`,
    { subfaseId, loteId }
  )

/**
 * As camadas que a subfase edita, com o comportamento de cada uma NESTA subfase.
 *
 * A DIVISAO POR TIPO DE ETAPA E A DO SAP, letra por letra: nas etapas 1
 * (Execucao) e 4 (Revisao/Correcao) as camadas de APONTAMENTO ficam de fora e os
 * atributos de apontamento nao viajam; nas demais elas vao junto. Ela nao casa
 * com a divisao que os MENUS usam (2 e 5), e a diferenca ja existia no SAP
 * 2.3.5. Ela e transcrita, e nao consertada: mexer nisso muda o que o operador
 * enxerga na tela, e e decisao do chefe, nao da travessia.
 */
const getInfoCamadas = async (t, tipoEtapaId, subfaseId) => {
  const semApontamento =
    tipoEtapaId === TIPO_ETAPA.EXECUCAO || tipoEtapaId === TIPO_ETAPA.REVISAO_CORRECAO

  const camadas = semApontamento
    ? await t.any(
      `SELECT c.schema, c.nome, pc.atributo_filtro_subfase, pc.camada_incomum
       FROM producao.propriedades_camada AS pc
       INNER JOIN producao.camada AS c ON c.id = pc.camada_id
       WHERE pc.subfase_id = $<subfaseId> AND pc.camada_apontamento IS FALSE`,
      { subfaseId }
    )
    : await t.any(
      `SELECT c.schema, c.nome, pc.atributo_filtro_subfase, pc.camada_apontamento,
         pc.atributo_justificativa_apontamento, pc.atributo_situacao_correcao,
         pc.camada_incomum
       FROM producao.propriedades_camada AS pc
       INNER JOIN producao.camada AS c ON c.id = pc.camada_id
       WHERE pc.subfase_id = $<subfaseId>`,
      { subfaseId }
    )

  return camadas.map(r => {
    const aux = { nome: r.nome, schema: r.schema, camada_incomum: r.camada_incomum }
    if (r.atributo_filtro_subfase) {
      aux.atributo_filtro_subfase = r.atributo_filtro_subfase
    }
    if (r.camada_apontamento) {
      aux.camada_apontamento = r.camada_apontamento
      aux.atributo_situacao_correcao = r.atributo_situacao_correcao
      aux.atributo_justificativa_apontamento = r.atributo_justificativa_apontamento
    }
    return aux
  })
}

/**
 * O menu customizado do QGIS. O menu marcado `menu_revisao` so viaja nas etapas
 * de Revisao (2) e Revisao final (5): e o menu de apontamento, e ele nao serve a
 * quem esta produzindo.
 */
const getInfoMenus = (t, tipoEtapaId, subfaseId, loteId) => {
  const revisor =
    tipoEtapaId === TIPO_ETAPA.REVISAO || tipoEtapaId === TIPO_ETAPA.REVISAO_FINAL

  return t.any(
    `SELECT qm.nome, qm.definicao_menu
     FROM producao.perfil_menu AS pm
     INNER JOIN qgis.qgis_menus AS qm ON qm.id = pm.menu_id
     WHERE pm.subfase_id = $<subfaseId> AND pm.lote_id = $<loteId>
       ${revisor ? '' : 'AND NOT pm.menu_revisao'}`,
    { subfaseId, loteId }
  )
}

const getInfoEstilos = (t, subfaseId, loteId) =>
  t.any(
    `SELECT ls.f_table_schema, ls.f_table_name, ls.f_geometry_column,
       gs.nome AS stylename, ls.styleqml, ls.ui
     FROM producao.perfil_estilo AS pe
     INNER JOIN qgis.group_styles AS gs ON gs.id = pe.grupo_estilo_id
     INNER JOIN qgis.layer_styles AS ls ON ls.grupo_estilo_id = gs.id
     INNER JOIN producao.camada AS c
       ON c.nome = ls.f_table_name AND c.schema = ls.f_table_schema
     INNER JOIN producao.propriedades_camada AS pc
       ON pc.camada_id = c.id AND pe.subfase_id = pc.subfase_id
     WHERE pe.subfase_id = $<subfaseId> AND pe.lote_id = $<loteId>`,
    { subfaseId, loteId }
  )

const getInfoRegras = (t, subfaseId, loteId) =>
  t.any(
    `SELECT lr.nome, lr.regra
     FROM producao.perfil_regras AS pr
     INNER JOIN qgis.layer_rules AS lr ON lr.id = pr.layer_rules_id
     WHERE pr.subfase_id = $<subfaseId> AND pr.lote_id = $<loteId>`,
    { subfaseId, loteId }
  )

const getInfoFME = (t, subfaseId, loteId) =>
  t.any(
    `SELECT gf.url, pf.rotina, pf.tipo_rotina_id, tr.nome AS tipo_rotina,
       pf.requisito_finalizacao, pf.ordem
     FROM producao.perfil_fme AS pf
     INNER JOIN qgis.gerenciador_fme AS gf ON gf.id = pf.gerenciador_fme_id
     INNER JOIN dominio.tipo_rotina AS tr ON tr.code = pf.tipo_rotina_id
     WHERE pf.subfase_id = $<subfaseId> AND pf.lote_id = $<loteId>`,
    { subfaseId, loteId }
  )

const getInfoTemas = (t, subfaseId, loteId) =>
  t.any(
    `SELECT qt.nome, qt.definicao_tema
     FROM producao.perfil_tema AS pt
     INNER JOIN qgis.qgis_themes AS qt ON qt.id = pt.tema_id
     WHERE pt.subfase_id = $<subfaseId> AND pt.lote_id = $<loteId>`,
    { subfaseId, loteId }
  )

const getInfoConfigQGIS = (t, subfaseId, loteId) =>
  t.any(
    `SELECT tipo_configuracao_id, parametros
     FROM producao.perfil_configuracao_qgis
     WHERE subfase_id = $<subfaseId> AND lote_id = $<loteId>`,
    { subfaseId, loteId }
  )

// O QUE MONITORAR NESTA SUBFASE DESTE LOTE, e nao a telemetria em si: a
// telemetria vive noutro banco e o plugin e quem a GRAVA, por
// `POST /api/microcontrole/{feicao,tela}`. Esta lista e o que ARMA o plugin.
//
// A RESPOSTA E UMA LISTA DE CODIGOS (1 feicao, 2 tela), e nao objetos: e o
// contrato do SAP 2.3.5, e o plugin ja instalado le assim. O UNIQUE da tabela
// permite os dois na mesma subfase do mesmo lote, e ai a lista vem com os dois.
//
// LISTA VAZIA E A RESPOSTA NORMAL, e nao um erro: nao existe telemetria "por
// padrao". Sem linha em `microcontrole.perfil_monitoramento`, o plugin nao grava
// nada.
//
// ELE CONSULTA O BANCO PRINCIPAL, e por isso entra no pacote sem depender da
// segunda conexao: se o banco da telemetria estiver fora do ar, o operador
// continua recebendo a atividade com o monitoramento armado, e as amostras
// falham no envio -- que e onde a falha pertence.
const getInfoMonitoramento = async (t, subfaseId, loteId) => {
  const linhas = await t.any(
    `SELECT pm.tipo_monitoramento_id
     FROM microcontrole.perfil_monitoramento AS pm
     WHERE pm.subfase_id = $<subfaseId> AND pm.lote_id = $<loteId>
     ORDER BY pm.tipo_monitoramento_id`,
    { subfaseId, loteId }
  )
  return linhas.map(l => l.tipo_monitoramento_id)
}

const getInfoInsumos = (t, unidadeTrabalhoId) =>
  t.any(
    `SELECT i.id, i.nome, i.caminho, i.epsg, i.tipo_insumo_id, iut.caminho_padrao
     FROM producao.insumo AS i
     INNER JOIN producao.insumo_unidade_trabalho AS iut ON i.id = iut.insumo_id
     WHERE iut.unidade_trabalho_id = $<unidadeTrabalhoId>`,
    { unidadeTrabalhoId }
  )

const getInfoModelsQGIS = (t, subfaseId, loteId) =>
  t.any(
    `SELECT qm.nome, qm.descricao, qm.model_xml, pmq.parametros, pmq.tipo_rotina_id,
       tr.nome AS tipo_rotina, pmq.requisito_finalizacao, pmq.ordem
     FROM producao.perfil_model_qgis AS pmq
     INNER JOIN qgis.qgis_models AS qm ON qm.id = pmq.qgis_model_id
     INNER JOIN dominio.tipo_rotina AS tr ON tr.code = pmq.tipo_rotina_id
     WHERE pmq.subfase_id = $<subfaseId> AND pmq.lote_id = $<loteId>`,
    { subfaseId, loteId }
  )

const getInfoWorkflow = (t, subfaseId, loteId) =>
  t.any(
    `SELECT wd.nome, wd.descricao, wd.workflow_json
     FROM producao.perfil_workflow_dsgtools AS pwd
     INNER JOIN qgis.workflow_dsgtools AS wd ON wd.id = pwd.workflow_dsgtools_id
     WHERE pwd.subfase_id = $<subfaseId> AND pwd.lote_id = $<loteId>`,
    { subfaseId, loteId }
  )

const getInfoRequisitos = (t, subfaseId, loteId) =>
  t.any(
    `SELECT r.descricao
     FROM producao.perfil_requisito_finalizacao AS r
     WHERE r.subfase_id = $<subfaseId> AND r.lote_id = $<loteId>
     ORDER BY r.ordem`,
    { subfaseId, loteId }
  )

const getAtalhos = t =>
  t.any('SELECT ferramenta, idioma, atalho FROM qgis.qgis_shortcuts')

/**
 * A LINHAGEM: o que ja aconteceu com esta area, etapa a etapa.
 *
 * O NOME DE QUEM EXECUTOU SO SAI EM DOIS CASOS, e e o que `perfil_linhagem`
 * declara: exibicao 3 (sempre) ou exibicao 2 (somente revisores) quando quem
 * pede E revisor. Mostrar sempre enviesa a revisao; esconder sempre impede o
 * revisor de saber com quem falar.
 *
 * As duas consultas diferem SO nas tres colunas de pessoa, e continuam duas
 * porque a alternativa seria montar a lista de colunas por concatenacao.
 */
const getInfoLinhagem = async (t, subfaseId, atividadeId, tipoEtapaId, loteId) => {
  const perfilLinhagem = await t.oneOrNone(
    `SELECT tipo_exibicao_id FROM producao.perfil_linhagem
     WHERE subfase_id = $<subfaseId> AND lote_id = $<loteId> LIMIT 1`,
    { subfaseId, loteId }
  )

  const revisor =
    tipoEtapaId === TIPO_ETAPA.REVISAO || tipoEtapaId === TIPO_ETAPA.REVISAO_FINAL

  const comPessoa =
    !!perfilLinhagem &&
    ((perfilLinhagem.tipo_exibicao_id === TIPO_EXIBICAO.SOMENTE_REVISORES && revisor) ||
      perfilLinhagem.tipo_exibicao_id === TIPO_EXIBICAO.SEMPRE_EXIBIR)

  const colunasPessoa = comPessoa
    ? 'u.nome_guerra, tpg.nome_abrev AS posto_grad,'
    : ''
  const juncaoPessoa = comPessoa
    ? `INNER JOIN dgeo.usuario AS u ON u.uuid = a.usuario_uuid
       INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id`
    : ''

  const linhagem = await t.any(
    `SELECT a.data_inicio, a.data_fim, ${colunasPessoa}
       tf.nome AS fase, sf.nome AS subfase, ut.lote_id,
       replace(te.nome || ' - ' || e.ordem, 'Execução - 1', 'Execução') AS etapa,
       ts.nome AS situacao
     FROM producao.atividade AS a
     INNER JOIN dominio.tipo_situacao_atividade AS ts ON ts.code = a.tipo_situacao_atividade_id
     ${juncaoPessoa}
     INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
     INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
     INNER JOIN dominio.tipo_etapa AS te ON te.code = e.tipo_etapa_id
     INNER JOIN producao.subfase AS sf ON sf.id = e.subfase_id
     INNER JOIN producao.fase AS f ON f.id = sf.fase_id
     INNER JOIN dominio.tipo_fase AS tf ON tf.code = f.tipo_fase_id
     INNER JOIN (
       SELECT ut.geom, ut.lote_id
       FROM producao.atividade AS a
       INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
       WHERE a.id = $<atividadeId>
     ) AS ut_ref
       ON ut_ref.lote_id = ut.lote_id AND ut.geom && ut_ref.geom
       AND st_relate(ut.geom, ut_ref.geom, '2********')
     WHERE ts.code <> $<naoFinalizada> AND ts.code <> $<naoIniciada>
     ORDER BY f.ordem, sf.ordem, a.data_fim`,
    {
      atividadeId,
      naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA,
      naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA
    }
  )

  linhagem.forEach(r => {
    if (r.data_inicio) r.data_inicio = new Date(r.data_inicio).toLocaleString()
    if (r.data_fim) r.data_fim = new Date(r.data_fim).toLocaleString()
  })

  return linhagem
}

/**
 * As VERSOES do acervo que esta unidade de trabalho produz, com as palavras
 * chave de cada uma. So viaja na fase de EDICAO, que e onde o operador redige o
 * toponimo da folha.
 *
 * NAO E `acervo.produto`, E `acervo.versao`, e a distincao e a mesma que
 * `producao.relacionamento_versao` registra: o produto do acervo e a folha
 * ETERNA, a mesma em todas as edicoes dela, e o que uma corrida de producao
 * entrega e uma VERSAO. No SAP `macrocontrole.produto` era um produto POR LOTE,
 * e por isso la o nome se editava nele.
 *
 * LE O CACHE, e nao refaz o `st_relate`: `relacionamento_versao` ja e mantido
 * por gatilho nas duas pontas, e ele ja aplica o filtro de SUBTIPO que impede a
 * unidade de trabalho da carta de reivindicar a versao do CDGV que ocupa o mesmo
 * poligono do mesmo lote.
 */
const getInfoMetadadoEdicao = async (t, unidadeTrabalhoId) => {
  const versoes = await t.any(
    `SELECT v.id AS versao_id, v.uuid_versao, v.nome AS nome_produto, v.versao,
       p.id AS produto_id, p.mi, p.inom
     FROM producao.relacionamento_versao AS rv
     INNER JOIN acervo.versao AS v ON v.id = rv.versao_id
     INNER JOIN acervo.produto AS p ON p.id = v.produto_id
     WHERE rv.ut_id = $<unidadeTrabalhoId>
     ORDER BY p.inom, p.mi, v.versao`,
    { unidadeTrabalhoId }
  )

  for (const versao of versoes) {
    versao.palavras_chave = await t.any(
      `SELECT nome, tipo_palavra_chave_id
       FROM metadado.palavra_chave_produto WHERE versao_id = $<versaoId>`,
      { versaoId: versao.versao_id }
    )
  }

  return versoes
}

/**
 * O pacote inteiro de uma atividade.
 *
 * O QUE NAO ESTA AQUI, e por que:
 *
 *   `denominador_escala` Sem sucessor: ver o cabecalho de
 *   `sql/retorna_dados_producao.sql`.
 *
 * `login_info` ESTA, e ele nao sai daqui: ver `montarLoginInfo` logo abaixo.
 */
const dadosProducao = async atividadeId => {
  return db.conn.task(async t => {
    const dadosut = await t.oneOrNone(consultas.retornaDadosProducao, { atividadeId })

    if (!dadosut) {
      throw new AppError('Atividade não encontrada', httpCode.NotFound)
    }

    const info = {
      usuario_uuid: dadosut.usuario_uuid,
      login: dadosut.login,
      usuario_nome: dadosut.nome_guerra,
      atividade: {
        id: atividadeId,
        epsg: dadosut.epsg,
        projeto: dadosut.projeto,
        lote: dadosut.lote,
        bloco: dadosut.bloco,
        subtipo_produto: dadosut.subtipo_produto,
        dificuldade: dadosut.dificuldade,
        tempo_estimado_minutos: dadosut.tempo_estimado_minutos,
        observacao_atividade: dadosut.observacao_atividade,
        observacao_unidade_trabalho: dadosut.observacao_unidade_trabalho,
        geom: dadosut.unidade_trabalho_geom,
        unidade_trabalho_id: dadosut.unidade_trabalho_id,
        lote_id: dadosut.lote_id,
        linha_producao_id: dadosut.linha_producao_id,
        fase_id: dadosut.fase_id,
        tipo_fase_id: dadosut.tipo_fase_id,
        subfase_id: dadosut.subfase_id,
        etapa_id: dadosut.etapa_id,
        tipo_etapa_id: dadosut.tipo_etapa_id,
        nome: `${dadosut.subfase_nome} - ${dadosut.etapa_nome} - ${dadosut.ut_id}`,
        dado_producao: {
          configuracao_producao: dadosut.configuracao_producao,
          tipo_dado_producao_id: dadosut.tipo_dado_producao_id
        }
      }
    }

    const { subfase_id: subfaseId, lote_id: loteId, tipo_etapa_id: tipoEtapaId } = dadosut

    info.atividade.camadas = await getInfoCamadas(t, tipoEtapaId, subfaseId)
    info.atividade.alias = await getAlias(t, subfaseId, loteId)
    info.atividade.menus = await getInfoMenus(t, tipoEtapaId, subfaseId, loteId)
    info.atividade.estilos = await getInfoEstilos(t, subfaseId, loteId)
    info.atividade.regras = await getInfoRegras(t, subfaseId, loteId)
    info.atividade.fme = await getInfoFME(t, subfaseId, loteId)
    info.atividade.temas = await getInfoTemas(t, subfaseId, loteId)
    info.atividade.configuracao_qgis = await getInfoConfigQGIS(t, subfaseId, loteId)
    info.atividade.monitoramento = await getInfoMonitoramento(t, subfaseId, loteId)
    info.atividade.insumos = await getInfoInsumos(t, dadosut.unidade_trabalho_id)
    info.atividade.models_qgis = await getInfoModelsQGIS(t, subfaseId, loteId)
    info.atividade.workflow_dsgtools = await getInfoWorkflow(t, subfaseId, loteId)
    info.atividade.linhagem = await getInfoLinhagem(
      t, subfaseId, atividadeId, tipoEtapaId, loteId
    )
    info.atividade.requisitos = await getInfoRequisitos(t, subfaseId, loteId)
    info.atividade.atalhos = await getAtalhos(t)

    // O metadado por folha so existe na fase de EDICAO, que e onde o operador o
    // redige. Nas outras fases o campo nao vai, e nao vai vazio.
    if (dadosut.tipo_fase_id === TIPO_FASE.EDICAO) {
      info.atividade.metadado_edicao = await getInfoMetadadoEdicao(
        t, dadosut.unidade_trabalho_id
      )
    }

    return info
  })
}

/**
 * A SECAO DE ACESSO AO BANCO DE EDICAO do pacote.
 *
 * O QUE ELA E. Quando o dado de producao da atividade e PostGIS COM CONTROLE DE
 * PERMISSAO (`dominio.tipo_dado_producao` code 2), este servico cria no banco de
 * EDICAO um papel do PostgreSQL para aquela pessoa, com permissao so nas camadas
 * da subfase dela, e entrega aqui a credencial. E o que faz o QGIS abrir o dado
 * -- e o que faz ele abrir SO o dado dela. O subsistema inteiro mora em
 * `database/permissoes_producao.js`.
 *
 * AUSENTE, PRESENTE E PRESENTE COM ERRO SAO TRES COISAS, e a diferenca entre
 * elas e o contrato deste campo:
 *
 *   AUSENTE           nao ha permissao a conceder. E o caso dos tipos 1 (dado
 *                     nao controlado) e 3 (PostGIS sem controle): ninguem cria
 *                     papel nenhum, e o cliente nao tem o que fazer. Um objeto
 *                     vazio aqui diria "ha permissao, e ela e nenhuma".
 *   `{ login, senha }` o acesso foi concedido, e vale por cinco dias.
 *   `{ erro }`        HA permissao a conceder e NAO foi possivel concede-la. O
 *                     campo aparece justamente para o cliente nao ler a ausencia
 *                     como o primeiro caso, e a frase diz o que houve.
 *
 * O TERCEIRO CASO E A RESPOSTA A "E SE O BANCO DE PRODUCAO ESTIVER FORA DO AR".
 * Ele NAO pode derrubar `/verifica` nem `/inicia`: o pacote traz camadas,
 * estilos, menus, temas, modelos, regras, insumos, linhagem e atalhos, e nada
 * disso depende do outro banco. Um `Promise.all` implicito -- deixar a excecao
 * subir -- faria a tela inteira morrer com a mensagem do banco de edicao, que e
 * a armadilha que o `CLAUDE.md` descreve e que ja mordeu tres vezes em
 * 2026-08-08. Aqui a falha fica na SECAO DELA.
 *
 * E O ERRO CHEGA COMO FRASE, E NUNCA COMO O ERRO DO DRIVER. A mensagem do
 * PostgreSQL traz o HOST (`getaddrinfo ENOTFOUND ...`), e este e um repositorio
 * publico com um log que sai da maquina. Quem traduz e `conexao_admin.js`; aqui
 * so passam mensagens de `AppError`, que sao escritas por nos. Qualquer outro
 * erro vira uma frase generica.
 *
 * NAO E ELA QUEM BARRA NADA. Quem impede a pessoa de editar a folha de outro e o
 * `GRANT` no banco de edicao, e nao a ausencia deste campo.
 */
const montarLoginInfo = async (atividadeId, usuarioUuid, contexto) => {
  try {
    return await permissoesProducao.garantirAcesso({
      atividadeId,
      usuarioUuid,
      contexto
    })
  } catch (err) {
    return {
      erro: err instanceof AppError
        ? err.message
        : 'Não foi possível conceder o acesso ao banco de produção desta atividade.'
    }
  }
}

/**
 * O ACESSO AO BANCO DE EDICAO SE FECHA AQUI, e este e o outro lado de
 * `montarLoginInfo`.
 *
 * ENTREGOU O TRABALHO, PERDEU O DADO. Sao dois efeitos, e o segundo e o que
 * fecha de fato: `revogarAcesso` revoga tudo o que o papel efemero tem naquele
 * banco E TROCA A SENHA dele. Sem a troca, quem guardou a credencial do pacote
 * continuaria CONECTANDO ao banco de edicao depois de entregar -- sem permissao
 * em camada nenhuma, mas dentro. A origem fazia os dois, e por isso a funcao
 * dela se chamava `resetPassword`.
 *
 * DEPOIS DO COMMIT, e nunca dentro dele: o banco de edicao e OUTRO PostgreSQL, e
 * nao ha transacao que cubra os dois.
 *
 * A FALHA VOLTA NA RESPOSTA, E NAO EM SILENCIO. E a decisao que mais pesa neste
 * caminho, e ela tem duas metades:
 *
 *   A ATIVIDADE FICA COMO FICOU. Desfazer a entrega porque o banco de edicao nao
 *   respondeu prenderia o operador numa folha que ele ja terminou, por causa de
 *   um servidor que nao e deste servico. O trabalho e o registro dele estao
 *   gravados e auditados; o que faltou foi fechar uma porta.
 *
 *   E NINGUEM RECEBE "SUCESSO" POR UMA REVOGACAO QUE NAO REVOGOU. O envelope
 *   traz `revogacao: { ok: false, ... }`, e a providencia diz o que fazer: um
 *   gerente fecha a porta a mao por
 *   `POST /api/gerencia_producao/banco_dados/revogar_permissoes_usuario`. Uma
 *   revogacao que falha calada e o pior defeito possivel aqui, porque quem le a
 *   resposta acredita nela.
 *
 * O ERRO NAO E O DO DRIVER. So mensagem de `AppError` atravessa: a do PostgreSQL
 * traz o HOST do banco de edicao, e esta resposta vai para o cliente E para o
 * log. Ver `database/conexao_admin.js`.
 *
 * @param {string} situacao - como a atividade ficou, para a frase da providencia
 * @returns {Promise<object|null>} `null` quando nao havia acesso a revogar
 */
const fecharAcesso = async (atividadeId, usuarioUuid, contexto, situacao) => {
  try {
    const revogado = await permissoesProducao.revogarAcesso({
      atividadeId,
      usuarioUuid,
      contexto
    })

    // `null` quer dizer que o dado de producao nao e PostGIS controlado: nao
    // havia acesso nenhum, e a resposta nao fala do que nao existe.
    if (!revogado) return null

    return { revogacao: { ok: true } }
  } catch (err) {
    return {
      revogacao: {
        ok: false,
        mensagem: err instanceof AppError
          ? err.message
          : 'Não foi possível revogar o acesso ao banco de produção desta atividade.',
        providencia:
          `A atividade foi ${situacao}. O acesso ao banco de produção continua ` +
          'aberto até que um gerente o revogue.'
      }
    }
  }
}

/**
 * O pacote da atividade, com a secao de acesso quando ela existe.
 *
 * `usuarioUuid` E QUEM VAI RECEBER A CREDENCIAL, e por isso ele e obrigatorio
 * para a secao existir. As duas rotas que chamam isto (`/verifica` e `/inicia`)
 * so entregam a atividade DA PROPRIA PESSOA -- e o contrato do plugin, e e o que
 * impede este caminho de virar um jeito de pedir acesso a folha alheia.
 */
controller.getDadosAtividade = async (atividadeId, usuarioUuid, contexto) => {
  const dados = await dadosProducao(atividadeId)

  if (!usuarioUuid) return dados

  const loginInfo = await montarLoginInfo(atividadeId, usuarioUuid, contexto)

  // `null` quer dizer "nao ha permissao a conceder", e ai o campo NAO VAI.
  if (loginInfo) dados.login_info = loginInfo

  return dados
}

// ---------------------------------------------------------------------------
// O RASTRO
// ---------------------------------------------------------------------------
//
// TODA ESCRITA DESTE MODULO GERA EVENTO, na MESMA transacao: falhar ao auditar
// derruba a escrita, e e deliberado.
//
// AS TABELAS DE PRODUCAO NAO TEM AS QUATRO COLUNAS DE AUDITORIA DA CASA
// (`usuario_cadastramento_uuid` e companhia), e a ausencia delas e decidida no
// DDL: `producao.atividade` E o registro de execucao, e `usuario_uuid`,
// `data_inicio` e `data_fim` ja sao o quem e o quando. O que `auditoria.evento`
// acrescenta e o que aconteceu DEPOIS que ela nasceu -- quem a iniciou, quem a
// finalizou, quem apagou a correcao que viria a seguir. Sem isso, "por que esta
// folha nao tem revisao?" nao tem resposta.
//
// O AGREGADO DE QUASE TUDO AQUI E O LOTE (do acervo), e nao a atividade: a ficha
// que uma pessoa abre e a do lote, e ninguem procura "atividade n.o 4712".

/**
 * Le a linha, escreve, rele e registra -- os quatro passos de uma escrita
 * auditada, numa chamada.
 *
 * Ela existe porque este modulo repete o padrao dez vezes em quatro funcoes, e
 * dez copias de `lerAntes`/`lerDepois`/`registrar` sao dez lugares para alguem
 * esquecer o terceiro.
 *
 * @param {object} t - a transacao da escrita
 * @param {object} evento - { tabela, id, nome, usuarioUuid, contexto }
 * @param {Function} escrever - o que fazer entre a leitura de antes e a de
 *   depois; recebe `t` e devolve o que quiser
 * @returns {Promise<*>} o que `escrever` devolveu
 */
const escritaAuditada = async (t, { tabela, id, nome, usuarioUuid, contexto }, escrever) => {
  const antes = await auditoriaCtrl.lerAntes(t, tabela, id, nome)

  const resultado = await escrever(t)

  const depois = await auditoriaCtrl.lerDepois(t, tabela, id)

  await auditoriaCtrl.registrar(t, {
    tabela,
    registroId: id,
    operacao: 'U',
    antes,
    depois,
    usuarioUuid,
    contexto
  })

  return resultado
}

// ---------------------------------------------------------------------------
// As rotas
// ---------------------------------------------------------------------------

/**
 * A atividade que esta pessoa tem EM EXECUCAO, se houver.
 *
 * E a primeira coisa que o plugin pergunta ao abrir: quem fechou o QGIS sem
 * finalizar volta para a mesma folha, com o mesmo pacote.
 *
 * ELA RENOVA O ACESSO AO BANCO DE EDICAO, e nao so o le. O papel efemero vence
 * em cinco dias, e e este pedido que empurra o vencimento para frente: quem
 * abre o QGIS na segunda-feira sobre a folha que pegou na quarta anterior
 * encontra a credencial valida porque passou por aqui. Ver `montarLoginInfo`.
 */
controller.verifica = async (usuarioUuid, contexto) => {
  const emAndamento = await db.conn.oneOrNone(
    `SELECT a.id
     FROM producao.atividade AS a
     INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
     WHERE a.usuario_uuid = $<usuarioUuid> AND ut.disponivel IS TRUE
       AND a.tipo_situacao_atividade_id = $<emExecucao>
     LIMIT 1`,
    { usuarioUuid, emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO }
  )

  if (!emAndamento) return null

  return controller.getDadosAtividade(emAndamento.id, usuarioUuid, contexto)
}

/**
 * Pega a proxima atividade da fila e a poe em execucao.
 *
 * A CORRIDA ENTRE DOIS OPERADORES E RESOLVIDA PELO PROPRIO UPDATE, e nao por uma
 * fila de requisicoes no servidor. O SAP serializava `/inicia` e `/finaliza`
 * numa fila de processo (`asyncHandlerWithQueue`, sobre `better-queue`), o que
 * transformava o servidor inteiro num gargalo de uma requisicao por vez. Aqui a
 * clausula `AND tipo_situacao_atividade_id IN (1, 3)` e quem decide: quem
 * chegou primeiro atualiza a linha, e o segundo encontra zero linhas e recebe a
 * mensagem de que a tarefa nao pode ser iniciada. Nenhum dos dois recebe uma
 * atividade que ja e do outro, que e a garantia que importa.
 */
controller.inicia = async (usuarioUuid, contexto) => {
  const dataInicio = new Date()
  const prioridade = await controller.calculaFila(usuarioUuid)
  if (!prioridade) return null

  await db.conn.tx(async t => {
    const emAndamento = await t.oneOrNone(
      `SELECT id FROM producao.atividade
       WHERE usuario_uuid = $<usuarioUuid> AND tipo_situacao_atividade_id = $<emExecucao>
       LIMIT 1`,
      { usuarioUuid, emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO }
    )

    if (emAndamento) {
      throw new AppError(
        'O usuário já possui atividade em andamento',
        httpCode.BadRequest
      )
    }

    // A RESERVA SE CONSOME AO SER ATENDIDA: deixa-la faria a mesma atividade
    // voltar a furar a fila na proxima vez que a pessoa pedisse trabalho.
    //
    // O DELETE E AUDITADO, e este e o unico ponto do sistema em que o furo de
    // fila some sem ninguem ter mandado: quem o criou precisa poder ler que ele
    // foi CONSUMIDO, e nao revogado por alguem.
    for (const tabela of ['producao.fila_prioritaria', 'producao.fila_prioritaria_grupo']) {
      const reservas = await t.any(
        `DELETE FROM ${tabela} WHERE atividade_id = $<prioridade> RETURNING *`,
        { prioridade }
      )

      for (const reserva of reservas) {
        await auditoriaCtrl.registrar(t, {
          tabela,
          registroId: reserva.id,
          operacao: 'D',
          antes: reserva,
          usuarioUuid,
          contexto
        })
      }
    }

    await escritaAuditada(
      t,
      {
        tabela: 'producao.atividade',
        id: prioridade,
        nome: 'Atividade',
        usuarioUuid,
        contexto
      },
      async t => {
        const result = await t.result(
          `UPDATE producao.atividade SET
             data_inicio = $<dataInicio>, tipo_situacao_atividade_id = $<emExecucao>,
             usuario_uuid = $<usuarioUuid>
           WHERE id = $<prioridade>
             AND tipo_situacao_atividade_id IN ($<naoIniciada>, $<pausada>)`,
          {
            dataInicio,
            prioridade,
            usuarioUuid,
            emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO,
            naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA,
            pausada: SITUACAO_ATIVIDADE.PAUSADA
          }
        )

        if (result.rowCount !== 1) {
          throw new AppError(
            'Não foi possível iniciar a atividade selecionada para a fila',
            httpCode.BadRequest
          )
        }
      }
    )
  })

  // A CONCESSAO ACONTECE FORA DA TRANSACAO QUE INICIOU A ATIVIDADE, e nao pode
  // ser diferente: ela mexe em OUTRO PostgreSQL, e nao ha transacao que cubra os
  // dois. Se ela falhar, a atividade JA ESTA iniciada e o pacote sai com a
  // secao de acesso trazendo o erro -- o operador ve a folha que recebeu e le
  // por que o QGIS nao vai abrir o dado. O contrario (desfazer o inicio porque o
  // banco de edicao nao respondeu) devolveria a atividade a fila e a entregaria
  // ao proximo da fila, que bateria no mesmo banco fora do ar.
  return controller.getDadosAtividade(prioridade, usuarioUuid, contexto)
}

// ---------------------------------------------------------------------------
// O METADADO POR FOLHA, que o operador redige na fase de Edicao
// ---------------------------------------------------------------------------
//
// DUAS ROTAS ESCREVEM A MESMA COISA: `/metadados_edicao`, durante a atividade, e
// o `info_edicao` do `/finaliza`, no fim dela. O corpo e um so de proposito --
// uma copia divergiria na primeira mudanca da checagem de dono, e a checagem de
// dono e justamente o que impede um operador de renomear qualquer folha do
// acervo por esta rota.

/**
 * Confere que a versao pertence a unidade de trabalho de uma atividade de EDICAO
 * DESTA pessoa, e lanca 400 se nao pertencer.
 *
 * SAO DOIS MOMENTOS, e por isso dois recortes. Durante a atividade (o
 * `/metadados_edicao`) o alvo e a atividade EM EXECUCAO; no `/finaliza` a
 * situacao ja virou Finalizada quando este trecho roda, e o alvo passa a ser a
 * atividade PELO ID -- que continua sendo desta pessoa, porque o UPDATE que a
 * finalizou exigiu isso.
 *
 * NO SAP NAO HAVIA CHECAGEM NENHUMA no caminho do `/finaliza`: ele atualizava
 * `macrocontrole.produto` por `produto_id` cru, vindo do corpo. A checagem
 * existia so na outra rota. Fechar isso e o unico ponto em que esta travessia
 * recusa o que a origem aceitava.
 */
const conferirVersaoDaAtividade = async (t, usuarioUuid, versaoId, atividadeId) => {
  const recorte = atividadeId != null
    ? 'a.id = $<atividadeId>'
    : 'a.tipo_situacao_atividade_id = $<emExecucao>'

  const dono = await t.oneOrNone(
    `SELECT 1
     FROM producao.atividade AS a
     INNER JOIN producao.relacionamento_versao AS rv ON rv.ut_id = a.unidade_trabalho_id
     INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
     INNER JOIN producao.subfase AS s ON s.id = ut.subfase_id
     INNER JOIN producao.fase AS f ON f.id = s.fase_id
     WHERE a.usuario_uuid = $<usuarioUuid>
       AND f.tipo_fase_id = $<edicao>
       AND rv.versao_id = $<versaoId>
       AND ${recorte}
     LIMIT 1`,
    {
      usuarioUuid,
      versaoId,
      atividadeId,
      emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO,
      edicao: TIPO_FASE.EDICAO
    }
  )

  if (!dono) {
    throw new AppError(
      'Versão não corresponde à atividade de edição deste operador',
      httpCode.BadRequest
    )
  }
}

/**
 * Grava nome e palavras chave das versoes informadas, na transacao de quem
 * chamou.
 *
 * SUBSTITUI o conjunto de palavras chave, e nao faz upsert: a lista que o
 * operador manda E a lista da folha, e um upsert nunca removeria a palavra que
 * ele tirou.
 *
 * AS DUAS TABELAS ESTAO NO MAPA DE AUDITORIA (`acervo.versao` no agregado do
 * produto, `metadado.palavra_chave_produto` no mesmo), e por isso as duas geram
 * evento na MESMA transacao.
 *
 * A SUBSTITUICAO E POR DIFERENCA, e nao apagando tudo e reinserindo. As duas
 * chegam ao mesmo estado final, e a diferenca esta no RASTRO: com o apaga-tudo,
 * salvar a mesma folha duas vezes seguidas geraria uma enxurrada de eventos
 * dizendo que toda palavra-chave saiu e voltou, e o historico da folha viraria
 * ruido em que a mudanca de verdade se perde. Aqui, salvar sem mexer em nada nao
 * gera evento nenhum, e o `id` de quem ficou nao muda.
 */
const chaveDaPalavra = p => `${p.nome}\u0000${p.tipo_palavra_chave_id}`

const gravarMetadadoEdicao = async (t, usuarioUuid, edicoes, contexto, atividadeId) => {
  for (const edicao of edicoes) {
    await conferirVersaoDaAtividade(t, usuarioUuid, edicao.versao_id, atividadeId)

    // --- O nome da folha, em acervo.versao ---------------------------------
    await escritaAuditada(
      t,
      {
        tabela: 'acervo.versao',
        id: edicao.versao_id,
        nome: 'Versão',
        usuarioUuid,
        contexto
      },
      t => t.none(
        `UPDATE acervo.versao SET
           nome = $<nome>, data_modificacao = NOW(), usuario_modificacao_uuid = $<usuarioUuid>
         WHERE id = $<versaoId>`,
        { nome: edicao.nome_produto, versaoId: edicao.versao_id, usuarioUuid }
      )
    )

    // --- As palavras-chave, por diferenca ----------------------------------
    const atuais = await t.any(
      `SELECT id, nome, tipo_palavra_chave_id, versao_id
       FROM metadado.palavra_chave_produto WHERE versao_id = $<versaoId>`,
      { versaoId: edicao.versao_id }
    )

    const desejadas = edicao.palavras_chave || []
    const queremos = new Set(desejadas.map(chaveDaPalavra))
    const jaTemos = new Set(atuais.map(chaveDaPalavra))

    for (const saindo of atuais.filter(a => !queremos.has(chaveDaPalavra(a)))) {
      await t.none(
        'DELETE FROM metadado.palavra_chave_produto WHERE id = $<id>',
        { id: saindo.id }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'metadado.palavra_chave_produto',
        registroId: saindo.id,
        operacao: 'D',
        antes: saindo,
        usuarioUuid,
        contexto
      })
    }

    const entrando = desejadas.filter(d => !jaTemos.has(chaveDaPalavra(d)))

    if (entrando.length > 0) {
      const cs = new db.pgp.helpers.ColumnSet(
        ['nome', 'tipo_palavra_chave_id', { name: 'versao_id', init: () => edicao.versao_id }],
        { table: { table: 'palavra_chave_produto', schema: 'metadado' } }
      )

      const inseridas = await t.any(
        `${db.pgp.helpers.insert(entrando, cs)} RETURNING *`
      )

      for (const nova of inseridas) {
        await auditoriaCtrl.registrar(t, {
          tabela: 'metadado.palavra_chave_produto',
          registroId: nova.id,
          operacao: 'I',
          depois: nova,
          usuarioUuid,
          contexto
        })
      }
    }
  }
}

/** A rota `/metadados_edicao`: grava durante a atividade em execucao. */
controller.salvaMetadadoEdicao = async (usuarioUuid, metadados, contexto) => {
  await db.conn.tx(async t => {
    await gravarMetadadoEdicao(t, usuarioUuid, metadados, contexto, null)
  })
}

/**
 * Finaliza a atividade da pessoa.
 *
 * O `usuario_uuid` VAI NO `WHERE` de proposito, e nao so o `atividade_id`: e o
 * que garante que quem finaliza e o dono da atividade, e nao alguem que
 * adivinhou o numero.
 *
 * OS GATILHOS FICAM LIGADOS. O SAP desligava TODOS os gatilhos do banco dentro
 * desta transacao (`disableAllTriggersInTransaction`) e reagendava a atualizacao
 * das visoes materializadas depois; aqui a atualizacao acontece pelo gatilho
 * `acompanhamento.refresh_view_acompanhamento_atividade`, dentro da transacao. E
 * A REVOGACAO DO ACESSO AO BANCO DE EDICAO ACONTECE DEPOIS DO COMMIT, e o
 * resultado dela VOLTA NA RESPOSTA. Ver o bloco no fim da funcao.
 *
 * OS GATILHOS FICAM LIGADOS. O SAP desligava TODOS os gatilhos do banco dentro
 * desta transacao (`disableAllTriggersInTransaction`) e reagendava a atualizacao
 * das visoes materializadas depois; aqui a atualizacao acontece pelo gatilho
 * `acompanhamento.refresh_view_acompanhamento_atividade`, dentro da transacao. E
 * mais lento e e correto: desligar gatilho por sessao vale para o banco INTEIRO,
 * inclusive para as outras requisicoes que estiverem em curso.
 */
controller.finaliza = async (
  usuarioUuid,
  atividadeId,
  semCorrecao,
  alterarFluxo,
  infoEdicao,
  observacaoProximaAtividade,
  observacaoAtividade,
  contexto
) => {
  const dataFim = new Date()

  await db.conn.tx(async t => {
    // UM EVENTO SO PARA A ATIVIDADE QUE SE FECHA, e nao um por UPDATE: a
    // situacao e a observacao mudam na mesma finalizacao, e dois eventos
    // gravados a um milissegundo de distancia obrigariam quem le a ficha a
    // remonta-los.
    await escritaAuditada(
      t,
      {
        tabela: 'producao.atividade',
        id: atividadeId,
        nome: 'Atividade',
        usuarioUuid,
        contexto
      },
      async t => {
        const result = await t.result(
          `UPDATE producao.atividade SET
             data_fim = $<dataFim>, tipo_situacao_atividade_id = $<finalizada>
           WHERE id = $<atividadeId> AND usuario_uuid = $<usuarioUuid>
             AND tipo_situacao_atividade_id = $<emExecucao>`,
          {
            dataFim,
            atividadeId,
            usuarioUuid,
            finalizada: SITUACAO_ATIVIDADE.FINALIZADA,
            emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO
          }
        )

        if (result.rowCount !== 1) {
          throw new AppError(
            'Erro ao finalizar atividade. Atividade não encontrada ou não corresponde a este operador',
            httpCode.BadRequest
          )
        }

        if (observacaoAtividade) {
          await t.none(
            `UPDATE producao.atividade SET
               observacao = concat_ws(' | ', observacao, $<observacaoAtividade>)
             WHERE id = $<atividadeId>`,
            { atividadeId, observacaoAtividade }
          )
        }
      }
    )

    // A OBSERVACAO PARA A PROXIMA ATIVIDADE E OUTRA LINHA, e por isso e outro
    // evento: quem abrir a proxima atividade precisa ver que o recado veio de
    // quem fechou a anterior.
    if (observacaoProximaAtividade) {
      const proxima = await t.oneOrNone(
        `SELECT aprox.id FROM producao.atividade AS a
         INNER JOIN producao.atividade AS aprox
           ON aprox.unidade_trabalho_id = a.unidade_trabalho_id
         INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
         INNER JOIN producao.etapa AS eprox ON eprox.id = aprox.etapa_id
         WHERE a.id = $<atividadeId> AND eprox.ordem > e.ordem
         ORDER BY eprox.ordem
         LIMIT 1`,
        { atividadeId }
      )

      if (!proxima) {
        throw new AppError(
          'Erro ao finalizar atividade. Não foi encontrada uma próxima atividade para preencher a observação.',
          httpCode.BadRequest
        )
      }

      await escritaAuditada(
        t,
        {
          tabela: 'producao.atividade',
          id: proxima.id,
          nome: 'Próxima atividade',
          usuarioUuid,
          contexto
        },
        t => t.none(
          `UPDATE producao.atividade SET
             observacao = concat_ws(' | ', observacao, $<observacaoProximaAtividade>)
           WHERE id = $<proximaId>`,
          { proximaId: proxima.id, observacaoProximaAtividade }
        )
      )
    }

    if (infoEdicao) {
      await gravarMetadadoEdicao(t, usuarioUuid, infoEdicao, contexto, atividadeId)
    }

    if (semCorrecao) {
      // O revisor declarou que nao ha o que corrigir: a atividade de Correcao
      // que viria a seguir, ainda Nao iniciada, deixa de existir.
      //
      // O `RETURNING *` NAO E ENFEITE: apagada a linha, `auditoria.evento` passa
      // a ser o unico lugar do banco que sabe que aquela correcao existiu e quem
      // decidiu que ela nao precisava acontecer. "Por que esta folha nao tem
      // revisao?" e uma pergunta que se faz meses depois.
      const apagadas = await t.any(
        `DELETE FROM producao.atividade
         WHERE id IN (
           WITH prox_e AS (
             SELECT e.id, lead(e.id, 1) OVER (
               PARTITION BY e.subfase_id, e.lote_id ORDER BY e.ordem
             ) AS prox_id
             FROM producao.etapa AS e
           ),
           prox AS (
             SELECT prox_e.id, prox_e.prox_id FROM prox_e
             INNER JOIN producao.atividade AS a ON a.etapa_id = prox_e.id
             WHERE a.id = $<atividadeId>
           )
           SELECT a.id
           FROM producao.atividade AS a
           INNER JOIN producao.atividade AS arev
             ON arev.unidade_trabalho_id = a.unidade_trabalho_id
           INNER JOIN prox AS p ON p.prox_id = a.etapa_id AND p.id = arev.etapa_id
           INNER JOIN producao.etapa AS e ON e.id = a.etapa_id
           WHERE arev.id = $<atividadeId> AND e.tipo_etapa_id = $<correcao>
             AND a.tipo_situacao_atividade_id = $<naoIniciada>
         )
         RETURNING *`,
        {
          atividadeId,
          correcao: TIPO_ETAPA.CORRECAO,
          naoIniciada: SITUACAO_ATIVIDADE.NAO_INICIADA
        }
      )

      if (apagadas.length === 0) {
        throw new AppError(
          'Erro ao bloquear correção: não há atividade de correção não iniciada a seguir',
          httpCode.BadRequest
        )
      }

      for (const apagada of apagadas) {
        await auditoriaCtrl.registrar(t, {
          tabela: 'producao.atividade',
          registroId: apagada.id,
          operacao: 'D',
          antes: apagada,
          usuarioUuid,
          contexto
        })
      }
    }

    if (alterarFluxo) {
      const alteracao = await t.one(
        `INSERT INTO producao.alteracao_fluxo (atividade_id, usuario_uuid, descricao, geom)
         SELECT a.id, $<usuarioUuid>, $<alterarFluxo>, ut.geom
         FROM producao.atividade AS a
         INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
         WHERE a.id = $<atividadeId>
         RETURNING id`,
        { atividadeId, usuarioUuid, alterarFluxo }
      )

      await auditoriaCtrl.registrar(t, {
        tabela: 'producao.alteracao_fluxo',
        registroId: alteracao.id,
        operacao: 'I',
        // Relido pelo controller da auditoria para a geometria sair em EWKT: o
        // `RETURNING geom` cru devolveria o WKB em hexadecimal.
        depois: await auditoriaCtrl.lerDepois(t, 'producao.alteracao_fluxo', alteracao.id),
        usuarioUuid,
        contexto
      })

      // A UNIDADE DE TRABALHO SAI DA DISTRIBUICAO ate alguem decidir o que fazer
      // com ela: com `disponivel` verdadeiro, a fila a entregaria de novo.
      const alvo = await t.one(
        'SELECT unidade_trabalho_id FROM producao.atividade WHERE id = $<atividadeId>',
        { atividadeId }
      )

      await escritaAuditada(
        t,
        {
          tabela: 'producao.unidade_trabalho',
          id: alvo.unidade_trabalho_id,
          nome: 'Unidade de trabalho',
          usuarioUuid,
          contexto
        },
        t => t.none(
          'UPDATE producao.unidade_trabalho SET disponivel = FALSE WHERE id = $<utId>',
          { utId: alvo.unidade_trabalho_id }
        )
      )
    }
  })

  return fecharAcesso(atividadeId, usuarioUuid, contexto, 'finalizada')
}

/**
 * O operador aponta um problema e a atividade PARA.
 *
 * SAO TRES EFEITOS, e nenhum deles e opcional: a atividade em execucao vira Nao
 * finalizada (code 5), nasce uma nova atividade Pausada da MESMA etapa para
 * quando o problema for resolvido, e a unidade de trabalho sai da distribuicao.
 * Sem o terceiro, a fila entregaria a folha problematica ao proximo da fila.
 *
 * O QUARTO EFEITO E O ACESSO AO BANCO DE EDICAO, que se fecha aqui como se fecha
 * na finalizacao (`fecharAcesso`). A atividade parou, e quem parou nao continua
 * editando o dado: a atividade de retomada nasce Pausada, e a fila so a devolve
 * quando o problema for resolvido -- o `/verifica` daquele dia concede o acesso
 * de novo. Deixar a porta aberta no intervalo daria ao operador o dado de uma
 * folha que o sistema tirou da mao dele.
 */
controller.problemaAtividade = async (
  atividadeId, tipoProblemaId, descricao, polygonEwkt, usuarioUuid, contexto
) => {
  const dataFim = new Date()

  await db.conn.tx(async t => {
    await escritaAuditada(
      t,
      {
        tabela: 'producao.atividade',
        id: atividadeId,
        nome: 'Atividade',
        usuarioUuid,
        contexto
      },
      async t => {
        const result = await t.result(
          `UPDATE producao.atividade SET
             data_fim = $<dataFim>, tipo_situacao_atividade_id = $<naoFinalizada>
           WHERE id = $<atividadeId> AND usuario_uuid = $<usuarioUuid>
             AND tipo_situacao_atividade_id = $<emExecucao>`,
          {
            dataFim,
            atividadeId,
            usuarioUuid,
            naoFinalizada: SITUACAO_ATIVIDADE.NAO_FINALIZADA,
            emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO
          }
        )

        if (result.rowCount !== 1) {
          throw new AppError(
            'Não foi possível reportar o problema: a atividade não foi encontrada ou não está em execução por este operador',
            httpCode.BadRequest
          )
        }
      }
    )

    const atividade = await t.one(
      `SELECT a.etapa_id, a.unidade_trabalho_id
       FROM producao.atividade AS a WHERE a.id = $<atividadeId>`,
      { atividadeId }
    )

    // A ATIVIDADE DE RETOMADA nasce Pausada e ja com dono: quando o problema for
    // resolvido, a fila de pausadas a devolve a MESMA pessoa.
    const nova = await t.one(
      `INSERT INTO producao.atividade
         (etapa_id, unidade_trabalho_id, usuario_uuid, tipo_situacao_atividade_id)
       VALUES ($<etapaId>, $<unidadeTrabalhoId>, $<usuarioUuid>, $<pausada>)
       RETURNING *`,
      {
        etapaId: atividade.etapa_id,
        unidadeTrabalhoId: atividade.unidade_trabalho_id,
        usuarioUuid,
        pausada: SITUACAO_ATIVIDADE.PAUSADA
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'producao.atividade',
      registroId: nova.id,
      operacao: 'I',
      depois: nova,
      usuarioUuid,
      contexto
    })

    // A GEOMETRIA CHEGA NA PROJECAO DE EDICAO, e a coluna e 4674. O SAP gravava
    // o EWKT cru porque la a coluna era 4326 e o cliente ja mandava em 4326;
    // aqui o SCA inteiro guarda SIRGAS 2000, e sem o ST_Transform o INSERT
    // morreria com "Geometry SRID does not match column SRID". O Joi exige o
    // prefixo `SRID=` justamente para essa recusa chegar como 400.
    const problema = await t.one(
      `INSERT INTO producao.problema_atividade
         (atividade_id, usuario_uuid, tipo_problema_atividade_id, descricao, data, resolvido, geom)
       VALUES ($<id>, $<usuarioUuid>, $<tipoProblemaId>, $<descricao>, NOW(), FALSE,
         ST_Transform(ST_GeomFromEWKT($<geom>), 4674))
       RETURNING id`,
      {
        id: nova.id,
        usuarioUuid,
        tipoProblemaId,
        descricao,
        geom: polygonEwkt
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'producao.problema_atividade',
      registroId: problema.id,
      operacao: 'I',
      // Relido para a geometria sair em EWKT, e nao como WKB hexadecimal.
      depois: await auditoriaCtrl.lerDepois(t, 'producao.problema_atividade', problema.id),
      usuarioUuid,
      contexto
    })

    await escritaAuditada(
      t,
      {
        tabela: 'producao.unidade_trabalho',
        id: atividade.unidade_trabalho_id,
        nome: 'Unidade de trabalho',
        usuarioUuid,
        contexto
      },
      t => t.none(
        'UPDATE producao.unidade_trabalho SET disponivel = FALSE WHERE id = $<utId>',
        { utId: atividade.unidade_trabalho_id }
      )
    )
  })

  return fecharAcesso(atividadeId, usuarioUuid, contexto, 'interrompida')
}

/**
 * "Finalizei sem querer": aponta o problema na ULTIMA atividade que esta pessoa
 * finalizou.
 *
 * O tipo e sempre o 7 de `dominio.tipo_problema_atividade`, e o poligono e o da
 * propria unidade de trabalho: o operador nao tem como desenhar a area do erro
 * depois de ja ter fechado o projeto.
 *
 * A ATIVIDADE NAO VOLTA A EXECUCAO por esta rota, e nunca voltou: quem decide o
 * que fazer com ela e quem gerencia, pela tela de problemas.
 */
controller.finalizacaoIncorreta = async (descricao, usuarioUuid, contexto) => {
  await db.conn.tx(async t => {
    const atividade = await t.oneOrNone(
      `SELECT a.id, a.unidade_trabalho_id, ST_AsEWKT(ut.geom) AS geom
       FROM producao.atividade AS a
       INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
       WHERE a.usuario_uuid = $<usuarioUuid>
         AND a.tipo_situacao_atividade_id = $<finalizada>
       ORDER BY a.data_fim DESC
       LIMIT 1`,
      { usuarioUuid, finalizada: SITUACAO_ATIVIDADE.FINALIZADA }
    )

    // O SAP usava `one()` aqui, e quem nunca finalizou nada levava um 500. A
    // resposta certa e 400: nao ha o que apontar.
    if (!atividade) {
      throw new AppError(
        'Não há atividade finalizada por este operador para reportar',
        httpCode.BadRequest
      )
    }

    const problema = await t.one(
      `INSERT INTO producao.problema_atividade
         (atividade_id, usuario_uuid, tipo_problema_atividade_id, descricao, data, resolvido, geom)
       VALUES ($<id>, $<usuarioUuid>, $<tipoProblemaId>, $<descricao>, NOW(), FALSE,
         ST_GeomFromEWKT($<geom>))
       RETURNING id`,
      {
        id: atividade.id,
        usuarioUuid,
        tipoProblemaId: TIPO_PROBLEMA_ATIVIDADE.FINALIZACAO_INCORRETA,
        descricao,
        geom: atividade.geom
      }
    )

    await auditoriaCtrl.registrar(t, {
      tabela: 'producao.problema_atividade',
      registroId: problema.id,
      operacao: 'I',
      depois: await auditoriaCtrl.lerDepois(t, 'producao.problema_atividade', problema.id),
      usuarioUuid,
      contexto
    })
  })
}

/**
 * O catalogo de problemas que o operador pode apontar.
 *
 * AS CHAVES SAO AS DO SAP (`tipo_problema_id`, `tipo_problema`), e nao as da
 * coluna (`tipo_problema_atividade_id`). O plugin SAP Operador ja instalado em
 * cada maquina le por esses nomes, e renomea-los na resposta quebraria todo
 * cliente que esta no ar sem que ninguem tivesse mexido nele. E a mesma razao
 * pela qual `login_schema.js` continua aceitando 'sca_web' e 'sca_qgis'.
 */
controller.getTipoProblema = async () => {
  const tipos = await db.conn.any(
    'SELECT code, nome FROM dominio.tipo_problema_atividade ORDER BY code'
  )

  return tipos.map(p => ({ tipo_problema_id: p.code, tipo_problema: p.nome }))
}

/**
 * De onde o cliente baixa o plugin para se atualizar sozinho.
 *
 * `qgis.plugin_path` nasce com o texto VAZIO porque o valor e uma pasta de rede
 * da instalacao e este repositorio e publico. Responder texto vazio e o
 * comportamento certo: quem instala preenche pelo SAP Gerente.
 */
controller.getPluginPath = () =>
  db.conn.one('SELECT path FROM qgis.plugin_path WHERE code = 1')

module.exports = controller
