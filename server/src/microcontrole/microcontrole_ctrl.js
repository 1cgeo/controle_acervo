'use strict'

// O MICROCONTROLE, QUE VIVE EM DOIS BANCOS.
//
// `db.conn`      - o banco principal, o desta casa. Aqui estao `microcontrole.tipo_monitoramento`
//                  e `microcontrole.perfil_monitoramento`, que dizem O QUE
//                  monitorar, e tambem `producao.atividade` e `dgeo.usuario`,
//                  que sao como se traduz o que a telemetria gravou.
// `db.microConn` - o banco da telemetria. Aqui estao `tipo_operacao`,
//                  `monitoramento_feicao` e `monitoramento_tela`.
//
// NAO EXISTE JUNCAO ENTRE ELES, e nao e limitacao a contornar: e o preco da
// separacao, pago de proposito (ver `er_microcontrole/microcontrole.sql`). As
// tres leituras agregadas juntam em JAVASCRIPT: resolvem no banco principal os
// `atividade_id` de um lote e os nomes dos operadores, e levam os
// identificadores prontos para a consulta do outro banco. Toda tentativa de
// escrever um SQL so aqui exigiria `dblink` ou `postgres_fdw`, que e exatamente
// o acoplamento que a separacao existe para nao ter.
//
// A ASSIMETRIA DA AUDITORIA, e ela e a decisao mais contraintuitiva deste
// arquivo:
//
//   O CADASTRO AUDITA. `perfil_monitoramento` passa por `db.conn.tx()` com
//   `auditoriaCtrl.registrar` na MESMA transacao, como todo o resto do sistema.
//   Alguem DECIDIU monitorar uma subfase de um lote, num dia, e responde por
//   isso: "quem ligou o monitoramento de tela neste lote, e quando" e uma
//   pergunta que se faz.
//
//   A TELEMETRIA NAO AUDITA, e ja estava decidido antes desta travessia. Sao
//   milhares de linhas por turno e por pessoa, em rajada do plugin, e a TABELA E
//   O PROPRIO REGISTRO: cada linha ja carrega quem, quando e o que. Uma linha de
//   `auditoria.evento` por amostra faria a trilha crescer MAIS RAPIDO que o dado
//   que ela descreve, e descreveria um INSERT que ninguem jamais vai contestar.
//   Nao ha o que auditar depois, tambem: nao existe PUT nem DELETE de
//   telemetria, e o GRANT do outro banco so da SELECT e INSERT.

const { db } = require('../database')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const controller = {}

const TABELA_PERFIL = 'microcontrole.perfil_monitoramento'
const ROTULO_PERFIL = 'um perfil de monitoramento'

// ---------------------------------------------------------------------------
// O BANCO DA TELEMETRIA PODE NAO ESTAR LA, E ISSO NAO E UM DEFEITO
// ---------------------------------------------------------------------------
//
// SAO DOIS ESTADOS DIFERENTES, e eles mandam quem le a lugares diferentes:
//
//   NAO CONFIGURADO - as chaves `MICRO_DB_*` de `server/config.env` estao
//                     vazias, e `db.microConn` e `null`. A instalacao nunca
//                     ligou telemetria. A resposta manda configurar.
//   FORA DO AR      - as chaves estao la e o outro servidor nao responde (ou
//                     recusa a senha, ou o banco nao existe). A resposta manda
//                     olhar o servidor.
//
// AS DUAS SAO 503, E NENHUMA E 500. 500 quer dizer "este servico quebrou", e
// manda abrir chamado contra este servico; 503 quer dizer "falta uma dependencia
// externa", que e o que de fato houve. A distincao e o que impede uma
// indisponibilidade tolerada de virar um chamado de defeito.
//
// AS CINCO ROTAS DO BANCO PRINCIPAL NAO PASSAM POR AQUI, e e o ponto inteiro do
// desenho: o tipo de monitoramento e o CRUD do perfil continuam respondendo com
// a telemetria fora do ar. Quem quer LIGAR o monitoramento de um lote consegue
// fazer isso hoje, e as amostras comecam a entrar quando o outro banco voltar.

// Os codigos do PostgreSQL/driver que significam "o outro banco nao esta la", e
// nao "a consulta estava errada". Um erro de sintaxe ou de coluna continua sendo
// 500, porque ai o defeito e nosso.
const INDISPONIVEL = new Set([
  'ECONNREFUSED', // ninguem escutando na porta
  'ENOTFOUND', // o nome do host nao resolve
  'EHOSTUNREACH',
  'ENETUNREACH',
  'ETIMEDOUT',
  'ECONNRESET',
  '57P03', // cannot_connect_now: o servidor esta subindo
  '3D000', // invalid_catalog_name: o banco nao existe
  '28P01', // invalid_password
  '28000', // invalid_authorization_specification
  '53300' // too_many_connections
])

const SEM_CHAVES =
  'A telemetria do microcontrole não está configurada nesta instalação. ' +
  'Ela vive num banco separado, e as chaves MICRO_DB_* do arquivo de ' +
  'configuração do servidor estão vazias. As telas de perfil de monitoramento ' +
  'continuam funcionando.'

const FORA_DO_AR =
  'O banco da telemetria do microcontrole não respondeu. Ele é um banco ' +
  'separado deste, e o restante do sistema não é afetado. Procure quem cuida ' +
  'do servidor dele.'

/**
 * Roda uma leitura ou escrita NO BANCO DA TELEMETRIA, traduzindo a ausencia
 * dele em 503.
 *
 * Ela existe para que nenhuma das seis rotas de telemetria precise lembrar de
 * conferir `db.microConn` -- seis lugares para esquecer o mesmo `if` -- e para
 * que a traducao do erro do driver aconteca num lugar so.
 *
 * @param {Function} consulta - recebe a conexao da telemetria
 */
const naTelemetria = async consulta => {
  if (!db.microConn) {
    throw new AppError(SEM_CHAVES, httpCode.ServiceUnavailable)
  }
  try {
    return await consulta(db.microConn)
  } catch (err) {
    if (err && INDISPONIVEL.has(err.code)) {
      throw new AppError(FORA_DO_AR, httpCode.ServiceUnavailable, err)
    }
    throw err
  }
}

// ---------------------------------------------------------------------------
// Os catalogos
// ---------------------------------------------------------------------------

controller.getTipoMonitoramento = async () => {
  return db.conn.any(
    'SELECT code, nome FROM microcontrole.tipo_monitoramento ORDER BY code'
  )
}

// A GEMEA DA DE CIMA, E NO OUTRO BANCO. As duas sao tabelas de codigo com a
// mesma forma, e e so por morarem em bancos diferentes que uma responde sempre e
// a outra pode responder 503. Ver o cabecalho de `er/microcontrole.sql`, sob
// "por que `tipo_monitoramento` nao foi para `dominio`".
controller.getTipoOperacao = async () => {
  return naTelemetria(conn =>
    conn.any('SELECT code, nome FROM microcontrole.tipo_operacao ORDER BY code')
  )
}

// ---------------------------------------------------------------------------
// A ESCRITA DO PLUGIN
// ---------------------------------------------------------------------------
//
// `usuario_uuid` VEM DO TOKEN, e nunca do corpo. E a unica coisa que impede um
// operador de lancar telemetria em nome de outro, e por isso a chave nem existe
// no Joi.
//
// `atividade_id` VEM DO CORPO E NAO E CONFERIDO, e a ausencia da conferencia e
// decidida. Confirmar que a atividade e daquela pessoa custaria uma consulta ao
// banco PRINCIPAL a cada rajada -- barata, mas nao e o custo que decide. O que
// decide e o risco: o plugin manda a rajada em segundo plano, e uma amostra que
// chegasse logo depois de a atividade ser finalizada seria RECUSADA com 400,
// perdendo o lote inteiro de medicoes do fim do trabalho, que e justamente o
// pedaco que interessa. O SAP 2.3.5 tambem nao conferia. O estrago possivel e
// pequeno e visivel: uma amostra citando atividade alheia aparece na leitura com
// o nome de quem a gravou, que veio do token.

// A MONTAGEM DA CONSULTA FICA DENTRO DO `naTelemetria`, e nao antes dele. Nao e
// arrumacao: uma rajada tem dezenas de linhas, e `pgp.helpers.insert` constroi o
// SQL inteiro em memoria. Montado antes, esse trabalho seria jogado fora toda
// vez que a telemetria estivesse fora do ar -- e o plugin de cada pessoa que
// esta trabalhando repete a rajada a cada poucos minutos. Dentro, o 503 sai
// antes de a primeira linha ser formatada.

controller.armazenaFeicao = async (atividadeId, usuarioUuid, dados) =>
  naTelemetria(conn => {
    // `def: 0` NAS DUAS METRICAS DE GEOMETRIA: elas so sao exigidas na insercao
    // (ver o Joi), e as colunas sao NOT NULL. Sem o default, uma exclusao
    // derrubaria o insert com "Property 'comprimento' doesn't exist".
    const cs = new db.pgp.helpers.ColumnSet([
      'tipo_operacao_id',
      'camada',
      'quantidade',
      { name: 'comprimento', def: 0 },
      { name: 'vertices', def: 0 },
      // A HORA E A DO SERVIDOR, e nao a do corpo: aqui, ao contrario da tela, o
      // plugin nao manda instante nenhum. `:raw` porque `NOW()` e uma expressao
      // SQL, e nao um valor a escapar.
      { name: 'data', mod: ':raw', init: () => 'NOW()' },
      { name: 'atividade_id', init: () => atividadeId },
      { name: 'usuario_uuid', init: () => usuarioUuid }
    ])

    // UM INSERT SO PARA A RAJADA INTEIRA, e nao um por linha.
    return conn.none(db.pgp.helpers.insert(dados, cs, {
      table: 'monitoramento_feicao',
      schema: 'microcontrole'
    }))
  })

controller.armazenaTela = async (atividadeId, usuarioUuid, dados) =>
  naTelemetria(conn => {
    const cs = new db.pgp.helpers.ColumnSet([
      // `:raw` PORQUE O VALOR E UMA EXPRESSAO SQL, e nao um texto: sem ele o
      // `ST_MakeEnvelope(...)` entraria como literal e o cast de texto para
      // geometria falharia. Mesmo padrao de `campo_ctrl.js`.
      { name: 'geom', mod: ':raw' },
      'zoom',
      'data',
      { name: 'atividade_id', init: () => atividadeId },
      { name: 'usuario_uuid', init: () => usuarioUuid }
    ])

    // A `geom` e a ENVELOPE RETANGULAR da extensao de tela: o plugin le quatro
    // numeros do canvas do QGIS e nao monta WKT. `pgp.as.format` escapa as
    // coordenadas antes de a expressao virar `:raw`.
    dados.forEach(d => {
      d.geom = db.pgp.as.format('ST_MakeEnvelope($1, $2, $3, $4, 4326)', [
        d.x_min,
        d.y_min,
        d.x_max,
        d.y_max
      ])
    })

    return conn.none(db.pgp.helpers.insert(dados, cs, {
      table: 'monitoramento_tela',
      schema: 'microcontrole'
    }))
  })

// ---------------------------------------------------------------------------
// O PERFIL DE MONITORAMENTO: o cadastro, no banco principal
// ---------------------------------------------------------------------------
//
// ELE E O DECIMO SEGUNDO PERFIL DE CONFIGURACAO DO LOTE, e por isso tem a mesma
// forma dos onze de `producao.perfil_*`: (alguma coisa, subfase, lote) mais as
// quatro colunas de auditoria. A diferenca e o prefixo de rota, que continua
// `/api/microcontrole` porque e onde o SAP Gerente o procura.

const UNIQUE_VIOLATION = '23505'
const FK_VIOLATION = '23503'

const ERROS = {
  [UNIQUE_VIOLATION]:
    'Já existe este tipo de monitoramento para a mesma subfase do mesmo lote',
  [FK_VIOLATION]:
    'A subfase, o lote ou o tipo de monitoramento informado não existe'
}

const comTraducao = async promessa => {
  try {
    return await promessa()
  } catch (err) {
    const frase = err && err.code ? ERROS[err.code] : null
    if (!frase) throw err
    throw new AppError(frase, httpCode.Conflict, err)
  }
}

// A LISTAGEM DEVOLVE SUBFASE E LOTE PELO NOME, e o SAP devolvia so os ids. A
// tela e uma grade de "este monitoramento, nesta subfase, neste lote": sem os
// nomes cada linha mostra tres numeros que ninguem le, e a tela precisaria de
// duas chamadas a mais para traduzi-los.
const SELECT_PERFIL = `
  SELECT pm.id, pm.tipo_monitoramento_id, pm.subfase_id, pm.lote_id,
         tm.nome AS tipo_monitoramento,
         s.nome AS subfase, l.nome AS lote
    FROM microcontrole.perfil_monitoramento AS pm
   INNER JOIN microcontrole.tipo_monitoramento AS tm ON tm.code = pm.tipo_monitoramento_id
   INNER JOIN producao.subfase AS s ON s.id = pm.subfase_id
   INNER JOIN acervo.lote AS l ON l.id = pm.lote_id
   ORDER BY l.nome, s.nome, pm.tipo_monitoramento_id`

controller.getPerfilMonitoramento = async () => db.conn.any(SELECT_PERFIL)

controller.criaPerfilMonitoramento = async (perfis, usuarioUuid, contexto) =>
  comTraducao(() =>
    db.conn.tx(async t => {
      const ids = []
      for (const linha of perfis) {
        const criado = await t.one(
          `INSERT INTO microcontrole.perfil_monitoramento
             (tipo_monitoramento_id, subfase_id, lote_id, usuario_cadastramento_uuid)
           VALUES ($<tipo_monitoramento_id>, $<subfase_id>, $<lote_id>, $<usuarioUuid>)
           RETURNING *`,
          { ...linha, usuarioUuid }
        )

        // NA MESMA TRANSACAO: falhar ao auditar derruba a escrita, e e
        // deliberado. UM EVENTO POR LINHA, e nao um por requisicao: o
        // `contexto.loteId` ja agrupa a operacao numa tela so, e um evento unico
        // para vinte linhas nao responderia "quem ligou o monitoramento de tela
        // nesta subfase".
        await auditoriaCtrl.registrar(t, {
          tabela: TABELA_PERFIL,
          registroId: criado.id,
          operacao: 'I',
          depois: criado,
          usuarioUuid,
          contexto
        })

        ids.push(criado.id)
      }
      return { ids }
    })
  )

controller.atualizaPerfilMonitoramento = async (perfis, usuarioUuid, contexto) =>
  comTraducao(() =>
    db.conn.tx(async t => {
      for (const linha of perfis) {
        // `lerAntes` FAZ AS DUAS COISAS numa consulta: guarda o estado anterior
        // para o rastro e lanca o 404 quando o id nao existe. E ele que
        // substitui o `SELECT id ... WHERE id IN (...)` que o SAP rodava antes.
        const antes = await auditoriaCtrl.lerAntes(
          t, TABELA_PERFIL, linha.id, ROTULO_PERFIL
        )

        const depois = await t.one(
          `UPDATE microcontrole.perfil_monitoramento SET
             tipo_monitoramento_id = $<tipo_monitoramento_id>,
             subfase_id = $<subfase_id>,
             lote_id = $<lote_id>,
             data_modificacao = CURRENT_TIMESTAMP,
             usuario_modificacao_uuid = $<usuarioUuid>
           WHERE id = $<id>
           RETURNING *`,
          { ...linha, usuarioUuid }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: TABELA_PERFIL,
          registroId: linha.id,
          operacao: 'U',
          antes,
          depois,
          usuarioUuid,
          contexto
        })
      }
    })
  )

controller.deletePerfilMonitoramento = async (ids, usuarioUuid, contexto) =>
  comTraducao(() =>
    db.conn.tx(async t => {
      for (const id of ids) {
        const antes = await auditoriaCtrl.lerAntes(
          t, TABELA_PERFIL, id, ROTULO_PERFIL
        )

        await t.none(
          'DELETE FROM microcontrole.perfil_monitoramento WHERE id = $<id>',
          { id }
        )

        await auditoriaCtrl.registrar(t, {
          tabela: TABELA_PERFIL,
          registroId: id,
          operacao: 'D',
          antes,
          usuarioUuid,
          contexto
        })
      }
    })
  )

// ---------------------------------------------------------------------------
// AS TRES LEITURAS AGREGADAS: onde os dois bancos se encontram
// ---------------------------------------------------------------------------

/**
 * Os `atividade_id` de um lote, resolvidos NO BANCO PRINCIPAL.
 *
 * `null` significa "todos os lotes" (sem filtro de atividade la), e nao "nenhuma
 * atividade" -- a distincao importa, e por isso o retorno nao e um array vazio.
 */
const getAtividadesDoLote = async loteId => {
  if (!loteId) return null

  const atividades = await db.conn.any(
    `SELECT a.id
       FROM producao.atividade AS a
      INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
      WHERE ut.lote_id = $<loteId>`,
    { loteId }
  )
  return atividades.map(a => a.id)
}

/**
 * Mapa uuid -> nome formatado, resolvido NO BANCO PRINCIPAL.
 *
 * A telemetria guarda o UUID e mais nada: sem chave estrangeira entre bancos,
 * nao ha como o outro lado saber o posto nem o nome de guerra de ninguem.
 */
const getMapaUsuarios = async uuids => {
  if (!uuids || uuids.length === 0) return {}

  const usuarios = await db.conn.any(
    `SELECT u.uuid, tpg.nome_abrev || ' ' || u.nome_guerra AS usuario
       FROM dgeo.usuario AS u
      INNER JOIN dominio.tipo_posto_grad AS tpg ON tpg.code = u.tipo_posto_grad_id
      WHERE u.uuid IN ($<uuids:csv>)`,
    { uuids }
  )

  const mapa = {}
  usuarios.forEach(u => {
    mapa[u.uuid] = u.usuario
  })
  return mapa
}

// O UUID QUE O MAPA NAO ACHOU NAO SOME DA RESPOSTA. Sem chave estrangeira entre
// bancos, uma amostra pode citar uma conta que ja foi apagada -- e a medicao
// continua sendo a prova de que aquele trabalho aconteceu. Esconder a linha
// faria o total da tela nao bater com o total do banco, sem dizer por que.
const nomeDe = (mapa, uuid) => mapa[uuid] || 'Operador não identificado'

// Janela e limites NOMEADOS, e nao literais soltos pela leitura.
const JANELA_DIAS_PADRAO = 30
const LIMITE_COBERTURA = 5000
const GAP_INATIVIDADE_MIN = 3

// A projecao das quatro operacoes (1 insercao, 2 exclusao, 3 atributo, 4
// geometria), compartilhada pelas tres agregacoes de feicao.
const SOMA_OPERACOES = `
      SUM(CASE WHEN tipo_operacao_id = 1 THEN quantidade ELSE 0 END)::int AS insercoes,
      SUM(CASE WHEN tipo_operacao_id = 2 THEN quantidade ELSE 0 END)::int AS delecoes,
      SUM(CASE WHEN tipo_operacao_id = 3 THEN quantidade ELSE 0 END)::int AS atualizacoes_atributo,
      SUM(CASE WHEN tipo_operacao_id = 4 THEN quantidade ELSE 0 END)::int AS atualizacoes_geometria`

const SOMA_GEOM = `
      COALESCE(SUM(comprimento), 0) AS comprimento,
      COALESCE(SUM(vertices), 0)::int AS vertices`

// O fragmento `AND atividade_id IN (...)` JA ESCAPADO, ou '' quando nao ha lote.
// Ele nao pode ser parametro nomeado porque a lista vem de OUTRO banco e o seu
// tamanho varia: `pgp.as.format` escapa os inteiros antes de a lista virar texto.
const filtroAtividadeSql = atividadeIds =>
  atividadeIds !== null
    ? db.pgp.as.format('AND atividade_id IN ($<atividadeIds:csv>)', { atividadeIds })
    : ''

// ---------------------------------------------------------------------------
// A JANELA DE TEMPO, RESOLVIDA NO POSTGRES E NAO EM JAVASCRIPT
// ---------------------------------------------------------------------------
//
// ELA JA FOI CALCULADA AQUI, e o calculo estava um dia UTC fora do lugar. As
// datas chegam como DIA (AAAA-MM-DD) e o `new Date('2026-08-09')` do JavaScript
// le isso como meia-noite UTC: somado o `+ 24h - 1ms`, a janela de "hoje" ia das
// 21h de 08-08 as 20h59 de 08-09 no horario de Brasilia. Filtrar por
// `data_fim=hoje` perdia as tres ultimas horas do dia e engolia tres do
// anterior, sem nada acusar.
//
// O `::date` DO POSTGRES INTERPRETA O DIA NO FUSO DA SESSAO, que e o mesmo em
// que `monitoramento_feicao.data` e `monitoramento_tela.data` foram gravadas.
// Por isso o dia atravessa como TEXTO (o `.raw()` do Joi em
// `microcontrole_schema.js`) e a conta acontece no SQL. E o padrao de
// `auditoria/auditoria_ctrl.js`.
//
// O FIM E EXCLUSIVO (`< fim + 1 dia`), e nao `<= fim`. E o que faz o dia final
// entrar INTEIRO -- inclusive a amostra das 22h -- sem ninguem ter de somar
// "menos um milissegundo" a mao, que era a outra metade do defeito.
//
// O PADRAO DO INICIO PENDURA NO FIM, e nao em hoje: quem pede so
// `data_fim=2026-01-15` quer os 30 dias que terminam ali, e nao os 30 ultimos
// dias (que podem nem se cruzar com o periodo pedido).
const JANELA_INICIO = `COALESCE($<dataInicio>::date, COALESCE($<dataFim>::date, CURRENT_DATE) - $<janelaDias>::int)`
const JANELA_FIM = `(COALESCE($<dataFim>::date, CURRENT_DATE) + INTERVAL '1 day')`
const NA_JANELA = `data >= ${JANELA_INICIO} AND data < ${JANELA_FIM}`

/**
 * Os parametros da janela, prontos para o `$<...>` das tres leituras.
 *
 * `null` e o que diz ao SQL "use o padrao", e o `|| null` existe porque o Joi
 * entrega `undefined` quando o filtro nao veio -- e `undefined` nao e valor que
 * o driver saiba formatar.
 *
 * @param {string} [dataInicio] - dia AAAA-MM-DD, como texto
 * @param {string} [dataFim] - dia AAAA-MM-DD, como texto
 */
const paramsJanela = (dataInicio, dataFim) => ({
  dataInicio: dataInicio || null,
  dataFim: dataFim || null,
  janelaDias: JANELA_DIAS_PADRAO
})

controller.getResumoFeicao = async (loteId, dataInicio, dataFim) => {
  const janela = paramsJanela(dataInicio, dataFim)

  // O BANCO PRINCIPAL PRIMEIRO, e de proposito: se o lote informado nao tem
  // atividade nenhuma, a resposta sai sem tocar a telemetria -- e sem 503 quando
  // ela estiver fora do ar, porque nao havia o que perguntar a ela.
  const atividadeIds = await getAtividadesDoLote(loteId)

  if (atividadeIds !== null && atividadeIds.length === 0) {
    return { por_operador: [], por_camada: [], serie_diaria: [] }
  }

  const filtroAtividade = filtroAtividadeSql(atividadeIds)

  // AS TRES AGREGACOES SAO INDEPENDENTES e batem na mesma janela: rodam em
  // paralelo, no mesmo pool. Elas estao no MESMO `naTelemetria` de propósito --
  // se o banco caiu, as tres caem juntas, e a resposta e uma so.
  const [porOperador, porCamada, serieDiaria] = await naTelemetria(conn =>
    Promise.all([
      conn.any(
        `SELECT usuario_uuid, ${SOMA_OPERACOES}, ${SOMA_GEOM}
           FROM microcontrole.monitoramento_feicao
          WHERE ${NA_JANELA} ${filtroAtividade}
          GROUP BY usuario_uuid`,
        janela
      ),
      conn.any(
        `SELECT camada, ${SOMA_OPERACOES}, ${SOMA_GEOM}
           FROM microcontrole.monitoramento_feicao
          WHERE ${NA_JANELA} ${filtroAtividade}
          GROUP BY camada
          ORDER BY camada`,
        janela
      ),
      conn.any(
        `SELECT to_char(data::date, 'YYYY-MM-DD') AS dia, ${SOMA_OPERACOES}
           FROM microcontrole.monitoramento_feicao
          WHERE ${NA_JANELA} ${filtroAtividade}
          GROUP BY data::date
          ORDER BY data::date`,
        janela
      )
    ])
  )

  const mapaUsuarios = await getMapaUsuarios(porOperador.map(o => o.usuario_uuid))

  return {
    por_operador: porOperador.map(o => ({
      ...o,
      usuario: nomeDe(mapaUsuarios, o.usuario_uuid)
    })),
    por_camada: porCamada,
    serie_diaria: serieDiaria
  }
}

controller.getCoberturaTela = async (loteId, usuarioUuid, dataInicio, dataFim) => {
  const janela = paramsJanela(dataInicio, dataFim)
  const atividadeIds = await getAtividadesDoLote(loteId)

  if (atividadeIds !== null && atividadeIds.length === 0) {
    return { type: 'FeatureCollection', features: [], aviso: null }
  }

  let filtros = filtroAtividadeSql(atividadeIds)
  if (usuarioUuid) {
    filtros += db.pgp.as.format(' AND usuario_uuid = $<usuarioUuid>', { usuarioUuid })
  }

  // O TETO EXISTE PORQUE A RESPOSTA E UM GeoJSON, e cada feicao e um poligono.
  // Um mes de tela de uma equipe passa de centenas de milhares de amostras, e a
  // resposta sem teto derrubaria o navegador antes de desenhar. Pede-se UM A
  // MAIS que o teto so para saber se truncou, e o aviso vai na resposta: uma
  // lista cortada em silencio se le como "so trabalharam ate aqui".
  const registros = await naTelemetria(conn =>
    conn.any(
      `SELECT atividade_id, usuario_uuid, zoom,
              to_char(data, 'YYYY-MM-DD"T"HH24:MI:SSOF') AS data,
              ST_AsGeoJSON(geom)::json AS geometry
         FROM microcontrole.monitoramento_tela
        WHERE ${NA_JANELA} ${filtros}
        ORDER BY data DESC
        LIMIT $<limite>`,
      { ...janela, limite: LIMITE_COBERTURA + 1 }
    )
  )

  const truncou = registros.length > LIMITE_COBERTURA
  const usados = truncou ? registros.slice(0, LIMITE_COBERTURA) : registros

  const mapaUsuarios = await getMapaUsuarios([
    ...new Set(usados.map(r => r.usuario_uuid))
  ])

  // O AVISO CITA A JANELA EFETIVA, e nao so o teto. A consulta ordena por `data
  // DESC`, entao o que sobrevive ao corte sao as amostras MAIS RECENTES: quem
  // pede um lote inteiro em trinta dias recebe um mapa dos ultimos dias, com o
  // painel ainda rotulado com o periodo que a pessoa pediu. A leitura natural
  // ("o operador so cobriu esta area") e exatamente a leitura errada. Como
  // `usados` ja esta ordenado, os dois extremos saem de graca.
  const primeira = usados.length > 0 ? usados[usados.length - 1].data : null
  const ultima = usados.length > 0 ? usados[0].data : null

  return {
    type: 'FeatureCollection',
    aviso: truncou
      ? `Resultado truncado em ${LIMITE_COBERTURA} amostras: o mapa mostra apenas de ` +
        `${primeira} até ${ultima}, e não o período inteiro que você pediu. ` +
        'Refine o filtro de lote, de operador ou de período.'
      : null,
    features: usados.map(r => ({
      type: 'Feature',
      geometry: r.geometry,
      properties: {
        atividade_id: r.atividade_id,
        usuario_uuid: r.usuario_uuid,
        usuario: nomeDe(mapaUsuarios, r.usuario_uuid),
        data: r.data,
        zoom: r.zoom
      }
    }))
  }
}

controller.getAproveitamentoTela = async (usuarioUuid, dataInicio, dataFim) => {
  const janela = paramsJanela(dataInicio, dataFim)

  // SO A TELEMETRIA, sem tocar o banco principal: a tabela de tela ja guarda o
  // `usuario_uuid`, e nao ha nome a traduzir numa resposta que e uma serie por
  // dia. Quem pergunta ja sabe de quem e.
  //
  // ANALISE DE GAPS, e e ela que da o numero: ordena as amostras por dia e
  // considera INATIVO todo intervalo maior que GAP_INATIVIDADE_MIN entre duas
  // amostras consecutivas. `tempo_total` e do primeiro ao ultimo ponto do dia;
  // `tempo_ativo` e o total menos a soma dos gaps. Nao e ponto eletronico: um
  // dia inteiro em reuniao aparece como tempo total pequeno, e nao como
  // aproveitamento ruim.
  const linhas = await naTelemetria(conn =>
    conn.any(
      `WITH pontos AS (
         SELECT data::date AS dia, data,
                EXTRACT(EPOCH FROM (data - LAG(data) OVER (PARTITION BY data::date ORDER BY data))) / 60.0 AS gap_min
           FROM microcontrole.monitoramento_tela
          WHERE usuario_uuid = $<usuarioUuid>
            AND ${NA_JANELA}
       )
       SELECT to_char(dia, 'YYYY-MM-DD') AS dia,
              EXTRACT(EPOCH FROM (MAX(data) - MIN(data))) / 60.0 AS tempo_total_min,
              COALESCE(SUM(gap_min) FILTER (WHERE gap_min > $<gap>), 0) AS tempo_inativo_min
         FROM pontos
        GROUP BY dia
        ORDER BY dia`,
      { usuarioUuid, ...janela, gap: GAP_INATIVIDADE_MIN }
    )
  )

  return linhas.map(l => {
    const total = Number(l.tempo_total_min) || 0
    const inativo = Number(l.tempo_inativo_min) || 0
    const ativo = Math.max(total - inativo, 0)
    return {
      dia: l.dia,
      tempo_total_min: Math.round(total * 100) / 100,
      tempo_ativo_min: Math.round(ativo * 100) / 100,
      aproveitamento_pct:
        total > 0 ? Math.round(((100 * ativo) / total) * 100) / 100 : 0
    }
  })
}

module.exports = controller
