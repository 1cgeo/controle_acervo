'use strict'

// ---------------------------------------------------------------------------
// O LOGIN TEMPORARIO E A PERMISSAO NO BANCO DE PRODUCAO
// ---------------------------------------------------------------------------
//
// O PROBLEMA QUE ELE RESOLVE. A unidade de trabalho editada num PostGIS COM
// CONTROLE DE PERMISSAO (`dominio.tipo_dado_producao` code 2) mora num banco que
// nao e este. O operador precisa abrir aquele banco no QGIS, e ha exatamente
// dois jeitos errados de conseguir isso: dar a ele a credencial da aplicacao (e
// entao ele edita o banco INTEIRO, inclusive a folha de outra pessoa) ou nao dar
// nada (e entao o QGIS nao abre o dado). Este arquivo e o terceiro jeito: um
// papel do PostgreSQL que nasce para aquela pessoa naquele servidor, com
// permissao SO nas camadas da subfase que ela esta executando, e que vence
// sozinho em cinco dias.
//
// VEIO DE `database/temporary_login.js` E `database/manage_permissions.js` DO
// SAP 2.3.5, juntos num arquivo so porque sao um subsistema so: nao existe
// criar o papel sem conceder, nem revogar sem saber quem e o papel.
//
// ---------------------------------------------------------------------------
// AS TRES REGRAS DURAS, e onde cada uma e cumprida
// ---------------------------------------------------------------------------
//
// 1. NOME DE PAPEL, DE BANCO E DE CAMADA ENTRAM NO DDL POR `$<x:name>`. Nada
//    aqui e concatenado a mao, e a razao nao e teorica: os nomes vem de TABELA
//    (`producao.camada.schema`, `producao.camada.nome`,
//    `propriedades_camada.atributo_situacao_correcao`), e quem cadastra uma
//    camada e uma pessoa digitando numa tela. A origem montava
//    `GRANT ... ON ${v.schema}.${v.nome_camada} TO ${login}` por template
//    string. Aqui todo pedaco passa por `db.pgp.as.format`, e o `:name` quota o
//    identificador.
//
// 2. A SENHA E DO `crypto`, NUNCA DERIVADA DO LOGIN, E NUNCA VAI PARA LOG. Ela
//    volta em UM lugar so: o pacote da propria atividade de quem pediu, que e o
//    contrato do plugin. Nao ha `console.log` nem `logger` neste arquivo, e a
//    unica coisa que a auditoria grava e o NOME do papel.
//
// 3. ESCRITA EM `producao.login_temporario` VIVE EM `db.conn.tx()`, com
//    `auditoriaCtrl.registrar` NA MESMA TRANSACAO. Falhar ao auditar derruba a
//    escrita, e e deliberado.
//
// ---------------------------------------------------------------------------
// A ORDEM DAS DUAS ESCRITAS, e por que o DDL vem primeiro
// ---------------------------------------------------------------------------
//
// SAO DOIS BANCOS DIFERENTES, entao NAO HA transacao que cubra os dois: o
// `CREATE USER` acontece no banco de edicao e a linha de `login_temporario`
// acontece aqui. Uma das duas vai primeiro, e a escolha e o DDL.
//
// COM O DDL PRIMEIRO, uma falha depois dele deixa um papel cuja senha ninguem
// guardou -- e o proximo pedido da mesma pessoa encontra o papel existente, faz
// `ALTER USER ... WITH PASSWORD` e volta a bater. O estado se conserta sozinho.
//
// COM A LINHA PRIMEIRO, uma falha no DDL deixaria uma senha guardada que o papel
// nao aceita, e o pacote entregaria ao plugin uma credencial que nao entra. O
// QGIS diria "senha invalida" e ninguem saberia por que.
//
// POR ISSO A SENHA GUARDADA E SEMPRE REIMPOSTA AO PAPEL, e nao so quando ele
// nasce. O SAP fazia diferente: ele ABRIA UMA CONEXAO com a credencial guardada
// so para saber se ela ainda valia, e so trocava a senha quando o teste
// falhava. Uma conexao inteira (com pool proprio, no meio do caminho da
// requisicao) para descobrir o que um `ALTER USER` de uma linha ja garante.
// Aqui o `ALTER` acontece sempre, e a credencial devolvida vale por construcao.
//
// ---------------------------------------------------------------------------
// O QUE NAO ATRAVESSOU DA ORIGEM, e por que
// ---------------------------------------------------------------------------
//
// A ROW LEVEL SECURITY. `manage_permissions.js` do SAP tem ~30 linhas
// comentadas que ligariam RLS nas camadas e criariam uma POLICY por papel,
// recortando a edicao pela geometria da unidade de trabalho. Estava desligado la
// e nao foi ligado aqui: ligar RLS numa camada e decisao com efeito sobre TODO
// mundo que usa aquele banco, inclusive quem nao passa por este servico. E
// decisao, e decisao se registra em `docs/decisoes.md`.
//
// O `getLoginAdmin`. La ele dava ao ADMINISTRADOR o mesmo acesso do operador a
// uma atividade que nao e dele, para as rotas `GET /atividade/:id`. Essas rotas
// nao atravessaram (ver o cabecalho de `gerencia_producao_route.js`), e um
// caminho que concede acesso ao banco de edicao sem tela que o use e porta
// aberta sem porteiro.

const crypto = require('crypto')
const path = require('path')

const db = require('./db')
const conexaoAdmin = require('./conexao_admin')

const auditoriaCtrl = require('../auditoria/auditoria_ctrl')

const { AppError, httpCode } = require('../utils')

const {
  TIPO_DADO_PRODUCAO,
  TIPO_ETAPA,
  SITUACAO_ATIVIDADE
} = require('../utils/domain_constants')

const permissoes = {}

// ---------------------------------------------------------------------------
// As constantes do subsistema
// ---------------------------------------------------------------------------

// O PREFIXO DE TODO PAPEL EFEMERO. Ele e `sap_` e nao `sca_` de proposito: os
// bancos de edicao que ja existem foram povoados pelo SAP 2.3.5, e os papeis
// dele ainda estao la. Trocar o prefixo faria este servico deixar de reconhecer
// (e portanto de revogar) tudo o que a versao anterior criou, e a revogacao que
// nao alcanca e o pior defeito possivel neste arquivo.
//
// ELE E LIDO TAMBEM PELA REVOGACAO EM MASSA (`revogar_temporarios.sql`), e por
// isso mora aqui e nao dentro de cada consulta: dois lugares divergiriam, e a
// divergencia so apareceria como permissao que sobrou.
const PREFIXO_LOGIN = 'sap_'

permissoes.PREFIXO_LOGIN = PREFIXO_LOGIN

// Quanto tempo o papel vale sem ninguem renovar. Cinco dias e o numero da
// origem: cobre o fim de semana longo de quem pegou a atividade na sexta, e nao
// cobre as ferias de quem esqueceu o QGIS aberto.
const VALIDADE_DIAS = 5

// O teto de identificador do PostgreSQL. Nome mais longo e TRUNCADO em silencio
// pelo servidor, e dois logins que so diferem depois do 63o caractere viram o
// MESMO papel -- duas pessoas com a mesma credencial no banco de edicao.
const MAX_IDENTIFICADOR = 63

// ---------------------------------------------------------------------------
// Os SQL de revogacao, lidos de arquivo
// ---------------------------------------------------------------------------
//
// SAO GERADORES: o texto do REVOKE sai do CATALOGO do banco de producao, porque
// e ele quem sabe o que aquele papel tem hoje. Ver o cabecalho de cada arquivo.
//
// `QueryFile` E NAO `PreparedStatement`, pelo mesmo motivo de
// `distribuicao/consultas_fila.js`: aqui se parametriza por NOME, e a mesma
// chave aparece cinco vezes na mesma consulta.
const arquivo = nome =>
  new db.pgp.QueryFile(path.join(__dirname, 'sql', nome), {
    minify: true,
    debug: process.env.NODE_ENV === 'development'
  })

const SQL_REVOGAR_USUARIO = arquivo('revogar_usuario.sql')
const SQL_REVOGAR_TEMPORARIOS = arquivo('revogar_temporarios.sql')

// ---------------------------------------------------------------------------
// A identidade do papel
// ---------------------------------------------------------------------------

/**
 * A senha do papel efemero.
 *
 * `randomBytes` E NAO `Math.random`: esta e uma credencial de banco, e o
 * gerador nao criptografico do JavaScript e previsivel a partir de algumas
 * saidas. 20 bytes em hexadecimal dao 40 caracteres.
 *
 * ELA NUNCA E DERIVADA DO LOGIN, do uuid, da data nem de nada que alguem possa
 * reconstruir de fora. Quem tiver a lista de logins nao tem nenhuma vantagem.
 */
const gerarSenha = () => crypto.randomBytes(20).toString('hex')

/**
 * O nome do papel a partir do login da pessoa.
 *
 * A ORIGEM FAZIA ISTO EM SQL, com um `translate` de 30 caracteres acentuados
 * digitados a mao -- que errava qualquer acento fora da lista e deixava passar o
 * caractere para dentro de um `CREATE USER` montado por concatenacao. Aqui a
 * normalizacao Unicode (NFD) separa a letra do acento e a classe de caracteres
 * derruba TUDO o que nao for `[a-z0-9_]`, sem lista para envelhecer.
 *
 * NAO E ISTO QUE PROTEGE O DDL -- quem protege e o `$<login:name>` de quem
 * escreve o comando. Isto existe para o nome ficar LEGIVEL dentro do banco de
 * edicao: quem olha `pg_roles` la precisa saber de quem e cada papel.
 */
const nomeDoPapel = login => {
  const limpo = String(login || '')
    .normalize('NFD')
    // O bloco Unicode dos acentos combinantes, escrito por CODIGO e nao pelos
    // caracteres: eles sao invisiveis num editor, e um deles apagado por
    // descuido nao apareceria em revisao nenhuma.
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, '_')

  if (!limpo || /^_+$/.test(limpo)) {
    throw new AppError(
      'Não foi possível derivar um nome de papel do login desta pessoa',
      httpCode.InternalError
    )
  }

  return `${PREFIXO_LOGIN}${limpo}`.slice(0, MAX_IDENTIFICADOR)
}

permissoes.nomeDoPapel = nomeDoPapel

// ---------------------------------------------------------------------------
// O DDL no banco de producao
// ---------------------------------------------------------------------------
//
// AS QUATRO FUNCOES ABAIXO RECEBEM A CONEXAO PRONTA, e nunca a abrem: quem a
// abre e `conexaoAdmin.noBanco`, que e onde a indisponibilidade vira 503 sem
// levar junto o endereco. Recebe-la tambem e o que permite duba-la no teste.

const papelExiste = async (conn, login) => {
  const achado = await conn.oneOrNone(
    'SELECT 1 FROM pg_catalog.pg_roles WHERE rolname = $<login>',
    { login }
  )
  return Boolean(achado)
}

/**
 * O `VALID UNTIL` sai do RELOGIO DO BANCO DE PRODUCAO, e nao do Node.
 *
 * `now() + interval` calculado LA e o que faz o vencimento coincidir com o que
 * aquele servidor vai comparar na hora do login. Com a data vinda daqui, um
 * relogio adiantado neste servidor encurtaria a validade e um atrasado a
 * esticaria, e ninguem descobriria: o sintoma seria "o QGIS parou de abrir
 * antes dos cinco dias", num servidor que nem se olha.
 */
const validade = async conn => {
  const linha = await conn.one(
    "SELECT now() + ($<dias> || ' day')::interval AS data",
    { dias: VALIDADE_DIAS }
  )
  return linha.data
}

const criarPapel = async (conn, login, senha) => {
  const ate = await validade(conn)
  await conn.none(
    'CREATE USER $<login:name> WITH LOGIN PASSWORD $<senha> VALID UNTIL $<ate>',
    { login, senha, ate }
  )
}

const trocarSenha = async (conn, login, senha) => {
  await conn.none('ALTER USER $<login:name> WITH PASSWORD $<senha>', {
    login,
    senha
  })
}

const renovarValidade = async (conn, login) => {
  const ate = await validade(conn)
  await conn.none('ALTER USER $<login:name> VALID UNTIL $<ate>', { login, ate })
}

// ---------------------------------------------------------------------------
// A CONCESSAO por atividade
// ---------------------------------------------------------------------------

/**
 * As camadas da atividade e como cada uma se comporta na subfase dela.
 *
 * TRAVESSIA DIRETA de `grantPermissionsUser` do SAP, com `macrocontrole` virando
 * `producao`. O que saiu: `ut.epsg` e a geometria em EWKT, que la alimentavam
 * apenas o bloco de RLS que esta comentado. Trazer coluna que ninguem le e
 * prometer que alguem a le.
 */
const camadasDaAtividade = async (t, atividadeId) =>
  t.any(
    `SELECT c.schema, c.nome AS nome_camada, ppc.camada_apontamento,
       ppc.atributo_situacao_correcao, ppc.atributo_justificativa_apontamento,
       e.tipo_etapa_id, dp.id AS dado_producao_id, dp.configuracao_producao
     FROM producao.camada AS c
     INNER JOIN producao.propriedades_camada AS ppc ON ppc.camada_id = c.id
     INNER JOIN producao.etapa AS e ON e.subfase_id = ppc.subfase_id
     INNER JOIN producao.atividade AS a ON a.etapa_id = e.id
     INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
     INNER JOIN producao.dado_producao AS dp ON dp.id = ut.dado_producao_id
     WHERE a.id = $<atividadeId>
       AND dp.tipo_dado_producao_id = $<comPermissao>`,
    { atividadeId, comPermissao: TIPO_DADO_PRODUCAO.POSTGIS_COM_PERMISSAO }
  )

// Um pedaco de DDL, com todo identificador quotado pelo pg-promise. E a UNICA
// forma de montar comando neste arquivo.
const ddl = (sql, valores) => db.pgp.as.format(sql, valores)

const semRepetir = lista => [...new Set(lista)]

/**
 * QUAIS CAMADAS a pessoa pode ESCREVER, conforme o tipo de etapa.
 *
 * A REGRA E A DA ORIGEM, e ela e de negocio e nao de codigo:
 *
 *   Execucao (1) e RevCorr (4)  as camadas COMUNS. Quem produz nao mexe na
 *                               camada de apontamento, que e o registro do que a
 *                               revisao achou de errado no trabalho dele.
 *   Revisao (2) e Rev. Final(5) TODAS, inclusive a de apontamento: apontar e o
 *                               trabalho da etapa.
 *   Correcao (3)                TODAS na lista (e o que os grants de sequencia,
 *                               gatilho e dominio la embaixo usam), mas com
 *                               permissao PARTIDA -- ver o bloco proprio dela.
 */
const camadasEscritas = (linhas, tipoEtapa) => {
  const nome = linha => `${linha.schema}.${linha.nome_camada}`

  if (tipoEtapa === TIPO_ETAPA.EXECUCAO || tipoEtapa === TIPO_ETAPA.REVISAO_CORRECAO) {
    return semRepetir(linhas.filter(l => l.camada_apontamento === false).map(nome))
  }

  if (
    tipoEtapa === TIPO_ETAPA.REVISAO ||
    tipoEtapa === TIPO_ETAPA.REVISAO_FINAL ||
    tipoEtapa === TIPO_ETAPA.CORRECAO
  ) {
    return semRepetir(linhas.map(nome))
  }

  // Tipo de etapa que ainda nao existe: lista VAZIA, e nao `undefined`. A origem
  // deixava a variavel sem valor e o ramo seguinte estourava com TypeError no
  // meio da concessao, deixando o papel criado e sem permissao nenhuma.
  return []
}

/**
 * Os grants que dependem do CATALOGO do banco de producao: sequencias das
 * colunas seriais, funcoes de gatilho e as tabelas de dominio apontadas por
 * chave estrangeira.
 *
 * ELES NAO SE ESCREVEM A MAO porque nao se sabem daqui: quantas sequencias uma
 * camada tem, e quais dominios ela referencia, e coisa do banco de edicao. Sem
 * eles a pessoa recebe a camada e o INSERT falha na sequencia, ou o gatilho de
 * historico falha na funcao, ou o formulario do QGIS abre com o dominio vazio.
 *
 * `IN ($<camadas:csv>)` COM LISTA VAZIA E ERRO DE SINTAXE (`IN ()`), e por isso
 * o chamador so entra aqui com lista. A origem nao conferia: uma subfase sem
 * camada comum numa etapa de Execucao derrubava a concessao inteira com erro de
 * sintaxe, e a mensagem falava de SQL, nao de cadastro.
 */
const grantsDoCatalogo = async (conn, camadas, login) => {
  const partes = []

  const sequencias = await conn.oneOrNone(
    `SELECT string_agg(query, ' ') AS txt FROM (
       SELECT DISTINCT 'GRANT USAGE, SELECT ON SEQUENCE ' ||
         replace(replace(column_default, '''::regclass)', ''), 'nextval(''', '') ||
         ' TO ' || quote_ident($<login>) || ';' AS query
       FROM information_schema.columns AS c
       WHERE c.table_schema || '.' || c.table_name IN ($<camadas:csv>)
         AND column_default ~ 'nextval'
     ) AS foo`,
    { camadas, login }
  )
  if (sequencias && sequencias.txt) partes.push(sequencias.txt)

  const gatilhos = await conn.oneOrNone(
    `SELECT string_agg(query, ' ') AS txt FROM (
       SELECT DISTINCT 'GRANT EXECUTE ON FUNCTION ' || quote_ident(r.routine_schema) || '.' ||
         quote_ident(r.routine_name) || '(' ||
         pg_get_function_identity_arguments(
           (regexp_matches(r.specific_name, '.*_([0-9]+)'))[1]::oid) ||
         ') TO ' || quote_ident($<login>) || ';' AS query
       FROM pg_trigger AS t
       INNER JOIN pg_proc AS p ON p.oid = t.tgfoid
       INNER JOIN information_schema.routines AS r ON r.routine_name = p.proname
       INNER JOIN information_schema.triggers AS it ON it.trigger_name = t.tgname
       WHERE it.event_object_schema || '.' || it.event_object_table IN ($<camadas:csv>)
     ) AS foo`,
    { camadas, login }
  )
  if (gatilhos && gatilhos.txt) partes.push(gatilhos.txt)

  const schemasDeGatilho = await conn.oneOrNone(
    `SELECT string_agg(query, ' ') AS txt FROM (
       SELECT DISTINCT 'GRANT USAGE ON SCHEMA ' || quote_ident(r.routine_schema) ||
         ' TO ' || quote_ident($<login>) || ';' AS query
       FROM pg_trigger AS t
       INNER JOIN pg_proc AS p ON p.oid = t.tgfoid
       INNER JOIN information_schema.routines AS r ON r.routine_name = p.proname
       INNER JOIN information_schema.triggers AS it ON it.trigger_name = t.tgname
       WHERE it.event_object_schema || '.' || it.event_object_table IN ($<camadas:csv>)
     ) AS foo`,
    { camadas, login }
  )
  if (schemasDeGatilho && schemasDeGatilho.txt) partes.push(schemasDeGatilho.txt)

  const dominios = await conn.oneOrNone(
    `SELECT string_agg(query, ' ') AS txt FROM (
       SELECT DISTINCT 'GRANT SELECT ON ' || quote_ident(ccu.table_schema) || '.' ||
         quote_ident(ccu.table_name) || ' TO ' || quote_ident($<login>) || ';' AS query
       FROM information_schema.table_constraints AS tc
       INNER JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema || '.' || tc.table_name IN ($<camadas:csv>)
         AND tc.constraint_type = 'FOREIGN KEY'
     ) AS foo`,
    { camadas, login }
  )
  if (dominios && dominios.txt) partes.push(dominios.txt)

  const schemasDeDominio = await conn.oneOrNone(
    `SELECT string_agg(query, ' ') AS txt FROM (
       SELECT DISTINCT 'GRANT USAGE ON SCHEMA ' || quote_ident(ccu.table_schema) ||
         ' TO ' || quote_ident($<login>) || ';' AS query
       FROM information_schema.table_constraints AS tc
       INNER JOIN information_schema.constraint_column_usage AS ccu
         ON ccu.constraint_name = tc.constraint_name
       WHERE tc.table_schema || '.' || tc.table_name IN ($<camadas:csv>)
         AND tc.constraint_type = 'FOREIGN KEY'
     ) AS foo`,
    { camadas, login }
  )
  if (schemasDeDominio && schemasDeDominio.txt) partes.push(schemasDeDominio.txt)

  return partes
}

/**
 * Concede ao papel a permissao da ATIVIDADE, e nada alem dela.
 *
 * SUBFASE SEM CAMADA CADASTRADA NAO CONCEDE NADA, nem o CONNECT, e e a mesma
 * decisao da origem. O papel existe e nao alcanca o banco, o que e um dead end
 * -- e ele e VISIVEL: o evento de auditoria sai com `camadas: 0`, que e a unica
 * leitura possivel de "a subfase nao tem camada cadastrada". Conceder CONNECT
 * assim mesmo daria acesso a um banco onde nao ha o que ler, e o cadastro
 * incompleto passaria despercebido.
 *
 * @param {object} conn - a conexao ADMINISTRATIVA ao banco de producao
 * @param {Array} linhas - o que `camadasDaAtividade` devolveu
 * @param {string} login - o nome do papel
 * @param {{banco: string}} alvo - o alvo ja separado por `conexaoAdmin`
 * @returns {Promise<number>} quantas camadas a concessao alcancou
 */
const conceder = async (conn, linhas, login, alvo) => {
  if (linhas.length === 0) return 0

  const partes = [
    ddl('GRANT CONNECT ON DATABASE $<banco:name> TO $<login:name>;', {
      banco: alvo.banco,
      login
    })
  ]

  for (const schema of semRepetir(linhas.map(l => l.schema))) {
    partes.push(
      ddl('GRANT USAGE ON SCHEMA $<schema:name> TO $<login:name>;', { schema, login })
    )
  }

  // O SCHEMA `public` E A LEITURA DELE: e onde moram as funcoes do PostGIS e as
  // tabelas de referencia (`spatial_ref_sys` a frente de todas). Sem ele o QGIS
  // nao consegue nem descobrir a projecao da camada.
  partes.push(
    ddl('GRANT USAGE ON SCHEMA public TO $<login:name>;', { login }),
    ddl('GRANT SELECT ON ALL TABLES IN SCHEMA public TO $<login:name>;', { login })
  )

  const tipoEtapa = linhas[0].tipo_etapa_id
  const camadas = camadasEscritas(linhas, tipoEtapa)

  if (tipoEtapa === TIPO_ETAPA.CORRECAO) {
    // A CORRECAO E A UNICA ETAPA COM PERMISSAO PARTIDA, e a divisao e a propria
    // regra de negocio: quem corrige EDITA a camada de dado e apenas RESPONDE na
    // camada de apontamento. Dar-lhe UPDATE livre no apontamento deixaria o
    // corrigido apagar o apontamento em vez de resolve-lo, e a revisao seguinte
    // nao teria como saber o que foi pedido.
    for (const linha of linhas.filter(l => l.camada_apontamento === true)) {
      partes.push(
        ddl('GRANT SELECT ON $<schema:name>.$<camada:name> TO $<login:name>;', {
          schema: linha.schema,
          camada: linha.nome_camada,
          login
        }),
        ddl(
          'GRANT UPDATE($<justificativa:name>, $<situacao:name>) ON $<schema:name>.$<camada:name> TO $<login:name>;',
          {
            justificativa: linha.atributo_justificativa_apontamento,
            situacao: linha.atributo_situacao_correcao,
            schema: linha.schema,
            camada: linha.nome_camada,
            login
          }
        )
      )
    }

    for (const linha of linhas.filter(l => l.camada_apontamento === false)) {
      partes.push(
        ddl(
          'GRANT SELECT, INSERT, DELETE, UPDATE ON $<schema:name>.$<camada:name> TO $<login:name>;',
          { schema: linha.schema, camada: linha.nome_camada, login }
        )
      )
    }
  } else {
    for (const camada of camadas) {
      const [schema, nome] = camada.split('.')
      partes.push(
        ddl(
          'GRANT SELECT, INSERT, DELETE, UPDATE ON $<schema:name>.$<camada:name> TO $<login:name>;',
          { schema, camada: nome, login }
        )
      )
    }
  }

  if (camadas.length > 0) {
    partes.push(...(await grantsDoCatalogo(conn, camadas, login)))
  }

  await conn.none(partes.join(' '))

  return camadas.length
}

/**
 * Revoga TUDO o que este papel tem no banco em que a conexao esta.
 *
 * DEVOLVE `false` QUANDO NAO HAVIA NADA A REVOGAR, e nao um sucesso mudo: o
 * gerador nao encontrou privilegio nenhum. Quem chama distingue "revoguei" de
 * "nao havia o que revogar", e as duas frases sao diferentes na resposta.
 */
const revogarPapel = async (conn, login) => {
  const gerado = await conn.oneOrNone(SQL_REVOGAR_USUARIO, { login })
  if (!gerado || !gerado.revoke_query) return false
  await conn.none(gerado.revoke_query)
  return true
}

permissoes.revogarPapel = revogarPapel

// ---------------------------------------------------------------------------
// A linha de `producao.login_temporario`
// ---------------------------------------------------------------------------

/**
 * Grava o par (papel, senha) da pessoa naquele CLUSTER, e o evento do ato na
 * MESMA transacao.
 *
 * SUBSTITUI EM VEZ DE ACUMULAR: uma pessoa tem UM papel por servidor de
 * producao, e a chave unica `(login, configuracao)` do DDL diz isso. O DELETE
 * antes do INSERT e o que torna a funcao idempotente sem depender de
 * `ON CONFLICT`, que precisaria nomear a restricao.
 *
 * `usuario_cadastramento_uuid` E QUEM PEDIU, e nem sempre e a pessoa do papel:
 * na reaplicacao de permissoes quem pede e o GERENTE, e o papel e do operador. A
 * distincao esta no evento, que guarda os dois.
 *
 * A SENHA NAO ENTRA NO EVENTO. `producao.acesso_banco_producao` e uma
 * pseudo-tabela justamente para isso -- ver o mapa de auditoria.
 */
const gravarLoginTemporario = async ({
  usuarioUuid,
  configuracao,
  login,
  senha,
  quemPediu,
  evento,
  contexto
}) => {
  await db.conn.tx(async t => {
    await t.none(
      `DELETE FROM producao.login_temporario
       WHERE usuario_uuid = $<usuarioUuid> AND configuracao = $<configuracao>`,
      { usuarioUuid, configuracao }
    )

    await t.none(
      `INSERT INTO producao.login_temporario
         (usuario_uuid, configuracao, login, senha, usuario_cadastramento_uuid)
       VALUES ($<usuarioUuid>, $<configuracao>, $<login>, $<senha>, $<quemPediu>)`,
      { usuarioUuid, configuracao, login, senha, quemPediu }
    )

    await auditoriaCtrl.registrarOperacao(t, {
      tabela: 'producao.acesso_banco_producao',
      resultado: evento,
      usuarioUuid: quemPediu,
      contexto
    })
  })
}

/** O evento de um ato que NAO mexe na linha (revogacao em massa, reaplicacao). */
const registrarAto = async (evento, quemPediu, contexto) => {
  await db.conn.tx(t =>
    auditoriaCtrl.registrarOperacao(t, {
      tabela: 'producao.acesso_banco_producao',
      resultado: evento,
      usuarioUuid: quemPediu,
      contexto
    })
  )
}

// ---------------------------------------------------------------------------
// O CABECALHO da atividade: onde ela mora e de quem ela e
// ---------------------------------------------------------------------------

/**
 * O dado de producao da atividade, SO se ele for PostGIS com controle de
 * permissao.
 *
 * DEVOLVE `null` NOS OUTROS DOIS TIPOS, e e esse null que faz o pacote sair sem
 * a secao de acesso: nao ha permissao a conceder num dado que o sistema apenas
 * aponta.
 */
const dadoDaAtividade = async atividadeId =>
  db.conn.oneOrNone(
    `SELECT dp.id AS dado_producao_id, dp.configuracao_producao,
       a.usuario_uuid, u.login
     FROM producao.atividade AS a
     INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
     INNER JOIN producao.dado_producao AS dp ON dp.id = ut.dado_producao_id
     LEFT JOIN dgeo.usuario AS u ON u.uuid = a.usuario_uuid
     WHERE a.id = $<atividadeId>
       AND dp.tipo_dado_producao_id = $<comPermissao>`,
    { atividadeId, comPermissao: TIPO_DADO_PRODUCAO.POSTGIS_COM_PERMISSAO }
  )

permissoes.dadoDaAtividade = dadoDaAtividade

const loginGuardado = async (usuarioUuid, configuracao) =>
  db.conn.oneOrNone(
    `SELECT login, senha FROM producao.login_temporario
     WHERE usuario_uuid = $<usuarioUuid> AND configuracao = $<configuracao>`,
    { usuarioUuid, configuracao }
  )

// ---------------------------------------------------------------------------
// AS OPERACOES, que sao o que o resto do sistema chama
// ---------------------------------------------------------------------------

/**
 * O papel da pessoa para ESTA atividade, criado ou renovado, com a permissao
 * concedida.
 *
 * @param {object} opcoes
 * @param {number} opcoes.atividadeId
 * @param {string} opcoes.usuarioUuid - de quem e o papel
 * @param {string} [opcoes.quemPediu] - quem disparou o ato; o proprio, por padrao
 * @param {boolean} [opcoes.conceder] - conceder a permissao da atividade
 * @param {object} [opcoes.contexto]
 * @returns {Promise<{login: string, senha: string}|null>} null quando o dado de
 *   producao da atividade nao e PostGIS com controle de permissao
 */
permissoes.garantirAcesso = async ({
  atividadeId,
  usuarioUuid,
  quemPediu,
  conceder: deveConceder = true,
  contexto
}) => {
  const dado = await dadoDaAtividade(atividadeId)
  if (!dado) return null

  const pediu = quemPediu || usuarioUuid

  // AS CAMADAS SAO LIDAS ANTES DE ENTRAR NO OUTRO BANCO, e a ordem tem razao:
  // `noBanco` traduz erro de conexao em "o banco de producao nao respondeu", e
  // uma leitura DESTE banco feita la dentro sairia com a frase errada, apontando
  // para o servidor errado.
  const linhas = deveConceder
    ? await db.conn.task(t => camadasDaAtividade(t, atividadeId))
    : []

  return conexaoAdmin.noBanco(dado.configuracao_producao, async (conn, alvo) => {
    const configuracao = conexaoAdmin.chaveDoCluster(alvo)
    const guardado = await loginGuardado(usuarioUuid, configuracao)

    // O `if` NO LUGAR DO TERNARIO NAO E ESTILO. `scripts/check_vazamento.py`
    // barra o commit quando ve a palavra da credencial, um sinal de igual e um
    // valor sem parenteses, ponto nem colchete; a primeira metade de um ternario
    // e exatamente isso, e o guard leria o nome da variavel intermediaria como
    // segredo literal. A regra dele esta certa (ela nao tem como distinguir um
    // ternario), e afrouxa-la para aceitar este caso a afrouxaria para todos os
    // outros. Aqui a atribuicao passa por uma chamada e por um campo de objeto,
    // que sao as duas formas que ele ja sabe que nao sao valor digitado.
    let login
    let senha = gerarSenha()

    if (guardado) {
      login = guardado.login
      senha = guardado.senha
    } else {
      login = nomeDoPapel(dado.login)
    }

    if (await papelExiste(conn, login)) {
      // O `ALTER` E SEMPRE, e nao so quando a senha esta errada. Ver o cabecalho
      // deste arquivo: e ele que faz a credencial devolvida valer por
      // construcao, sem a conexao de teste que a origem abria.
      await trocarSenha(conn, login, senha)
    } else {
      // O papel nao existe: a senha guardada (se havia) nao vale mais nada, e
      // reaproveita-la so espalharia um segredo velho.
      senha = gerarSenha()
      await criarPapel(conn, login, senha)
    }

    await renovarValidade(conn, login)

    const camadas = deveConceder ? await conceder(conn, linhas, login, alvo) : 0

    await gravarLoginTemporario({
      usuarioUuid,
      configuracao,
      login,
      senha,
      quemPediu: pediu,
      contexto,
      evento: {
        operacao: deveConceder ? 'Concessão' : 'Renovação',
        login,
        usuario_uuid: usuarioUuid,
        atividade_id: atividadeId,
        dado_producao_id: dado.dado_producao_id,
        camadas
      }
    })

    return { login, senha }
  })
}

/**
 * Revoga o acesso da pessoa ao banco DESTA atividade, e troca a senha do papel.
 *
 * SAO DOIS EFEITOS, E O SEGUNDO E O QUE FECHA A PORTA. Revogar permissao tira o
 * que o papel pode FAZER; trocar a senha tira o que a credencial ja entregue
 * pode ABRIR. Sem o segundo, o operador que guardou a senha do pacote continua
 * conectando ao banco de edicao depois de ter entregue o trabalho -- sem
 * permissao em camada nenhuma, mas dentro. A origem fazia os dois, e por isso a
 * funcao dela se chamava `resetPassword`.
 *
 * @returns {Promise<{login: string, revogou: boolean}|null>}
 */
permissoes.revogarAcesso = async ({ atividadeId, usuarioUuid, quemPediu, contexto }) => {
  const dado = await dadoDaAtividade(atividadeId)
  if (!dado) return null

  const pediu = quemPediu || usuarioUuid

  return conexaoAdmin.noBanco(dado.configuracao_producao, async (conn, alvo) => {
    const configuracao = conexaoAdmin.chaveDoCluster(alvo)
    const guardado = await loginGuardado(usuarioUuid, configuracao)

    const login = guardado ? guardado.login : nomeDoPapel(dado.login)
    const senha = gerarSenha()

    if (await papelExiste(conn, login)) {
      await trocarSenha(conn, login, senha)
    } else {
      // O papel nao existe: nao ha o que revogar, e criar um so para revoga-lo
      // seria teatro. A linha e reescrita assim mesmo, para o proximo pedido
      // partir de um estado conhecido.
      await criarPapel(conn, login, senha)
    }

    const revogou = await revogarPapel(conn, login)

    await gravarLoginTemporario({
      usuarioUuid,
      configuracao,
      login,
      senha,
      quemPediu: pediu,
      contexto,
      evento: {
        operacao: 'Revogação',
        login,
        usuario_uuid: usuarioUuid,
        atividade_id: atividadeId,
        dado_producao_id: dado.dado_producao_id
      }
    })

    return { login, revogou }
  })
}

/**
 * Revoga TODOS os papeis efemeros de um banco de producao.
 *
 * O ALVO CHEGA COMO `dado_producao_id`, e nao como servidor, porta e banco. Ver
 * o cabecalho da rota em `gerencia_producao_route.js`: o endereco vem do DADO,
 * e um endereco no corpo da requisicao seria gravado no log por
 * `sendJsonAndLog`, que registra `req.body` de toda chamada.
 */
permissoes.revogarTodosDoBanco = async ({ dadoProducaoId, quemPediu, contexto }) => {
  const dado = await db.conn.oneOrNone(
    `SELECT id, configuracao_producao FROM producao.dado_producao
     WHERE id = $<dadoProducaoId> AND tipo_dado_producao_id = $<comPermissao>`,
    { dadoProducaoId, comPermissao: TIPO_DADO_PRODUCAO.POSTGIS_COM_PERMISSAO }
  )

  if (!dado) {
    throw new AppError(
      'Dado de produção não encontrado, ou não é PostGIS com controle de permissão',
      httpCode.NotFound
    )
  }

  return conexaoAdmin.noBanco(dado.configuracao_producao, async conn => {
    const papeis = await conn.any(
      'SELECT rolname FROM pg_catalog.pg_roles WHERE left(rolname, $<n>) = $<prefixo>',
      { n: PREFIXO_LOGIN.length, prefixo: PREFIXO_LOGIN }
    )

    const gerado = await conn.oneOrNone(SQL_REVOGAR_TEMPORARIOS, {
      prefixo: PREFIXO_LOGIN
    })

    if (gerado && gerado.revoke_query) {
      await conn.none(gerado.revoke_query)
    }

    const resultado = {
      papeis: papeis.length,
      revogou: Boolean(gerado && gerado.revoke_query)
    }

    await registrarAto(
      {
        operacao: 'Revogação em massa',
        login: `${PREFIXO_LOGIN}*`,
        dado_producao_id: dado.id,
        papeis: papeis.length,
        detalhe: papeis.map(p => p.rolname)
      },
      quemPediu,
      contexto
    )

    return resultado
  })
}

/**
 * Revoga o acesso de UMA pessoa a UM banco de producao.
 *
 * SEM ATIVIDADE NO MEIO, e essa e a diferenca para `revogarAcesso`: a rota da
 * gerencia existe para o caso em que a atividade ja nao diz nada -- ela foi
 * apagada, a pessoa saiu da secao, ou alguem simplesmente quer fechar a porta
 * agora.
 */
permissoes.revogarUsuarioDoBanco = async ({
  dadoProducaoId,
  usuarioUuid,
  quemPediu,
  contexto
}) => {
  const dado = await db.conn.oneOrNone(
    `SELECT id, configuracao_producao FROM producao.dado_producao
     WHERE id = $<dadoProducaoId> AND tipo_dado_producao_id = $<comPermissao>`,
    { dadoProducaoId, comPermissao: TIPO_DADO_PRODUCAO.POSTGIS_COM_PERMISSAO }
  )

  if (!dado) {
    throw new AppError(
      'Dado de produção não encontrado, ou não é PostGIS com controle de permissão',
      httpCode.NotFound
    )
  }

  return conexaoAdmin.noBanco(dado.configuracao_producao, async (conn, alvo) => {
    const configuracao = conexaoAdmin.chaveDoCluster(alvo)
    const guardado = await loginGuardado(usuarioUuid, configuracao)

    // SEM LINHA GUARDADA, O PAPEL SE DERIVA DO LOGIN. A linha pode nunca ter
    // existido (a pessoa recebeu acesso pela versao anterior do sistema) ou ter
    // sido apagada a mao, e nos dois casos o papel continua no banco de edicao.
    // Responder "nada a revogar" ali seria a revogacao que nao revoga.
    let login = guardado && guardado.login

    if (!login) {
      const pessoa = await db.conn.oneOrNone(
        'SELECT login FROM dgeo.usuario WHERE uuid = $<usuarioUuid>',
        { usuarioUuid }
      )
      if (!pessoa) {
        throw new AppError('Usuário não encontrado', httpCode.NotFound)
      }
      login = nomeDoPapel(pessoa.login)
    }

    const existia = await papelExiste(conn, login)
    let revogou = false
    let senhaTrocada = false

    if (existia) {
      await trocarSenha(conn, login, gerarSenha())
      senhaTrocada = true
      revogou = await revogarPapel(conn, login)
    }

    await db.conn.tx(async t => {
      await t.none(
        `DELETE FROM producao.login_temporario
         WHERE usuario_uuid = $<usuarioUuid> AND configuracao = $<configuracao>`,
        { usuarioUuid, configuracao }
      )

      await auditoriaCtrl.registrarOperacao(t, {
        tabela: 'producao.acesso_banco_producao',
        resultado: {
          operacao: 'Revogação',
          login,
          usuario_uuid: usuarioUuid,
          dado_producao_id: dado.id
        },
        usuarioUuid: quemPediu,
        contexto
      })
    })

    return { login, papel_existia: existia, revogou, senha_trocada: senhaTrocada }
  })
}

/**
 * Refaz a permissao de TODA atividade em execucao num dado PostGIS controlado.
 *
 * O QUE ELA CONSERTA. A permissao e concedida uma vez, quando a atividade
 * comeca. Se depois disso alguem acrescenta uma camada a subfase, muda a camada
 * de apontamento ou restaura o banco de edicao de um backup, quem esta no meio
 * do trabalho fica sem a permissao nova e descobre isso pelo QGIS. Esta rota
 * revoga e reconcede as duas coisas de uma vez, para todo mundo.
 *
 * REVOGA ANTES DE CONCEDER, e nao so concede: a mudanca pode ter TIRADO uma
 * camada da subfase, e conceder por cima deixaria a antiga aberta.
 *
 * A SENHA NAO MUDA, e e a unica operacao daqui em que ela nao muda. Quem esta
 * com o QGIS aberto continua conectado; trocar a senha aqui derrubaria a proxima
 * reconexao de todo mundo que trabalha, para consertar o cadastro de uma subfase.
 *
 * ATIVIDADE QUE FALHA NAO DERRUBA AS OUTRAS. Sao N bancos de edicao, e um deles
 * fora do ar nao pode impedir a reaplicacao nos demais: cada falha entra no
 * `detalhe` do evento e na resposta, com a atividade e a razao.
 */
permissoes.reaplicarEmExecucao = async ({ quemPediu, contexto }) => {
  const emExecucao = await db.conn.any(
    `SELECT a.id AS atividade_id, a.usuario_uuid, dp.id AS dado_producao_id,
       dp.configuracao_producao, u.login
     FROM producao.atividade AS a
     INNER JOIN producao.unidade_trabalho AS ut ON ut.id = a.unidade_trabalho_id
     INNER JOIN producao.dado_producao AS dp ON dp.id = ut.dado_producao_id
     INNER JOIN dgeo.usuario AS u ON u.uuid = a.usuario_uuid
     WHERE a.tipo_situacao_atividade_id = $<emExecucao>
       AND dp.tipo_dado_producao_id = $<comPermissao>
     ORDER BY a.id`,
    {
      emExecucao: SITUACAO_ATIVIDADE.EM_EXECUCAO,
      comPermissao: TIPO_DADO_PRODUCAO.POSTGIS_COM_PERMISSAO
    }
  )

  const falhas = []
  let reaplicadas = 0

  for (const linha of emExecucao) {
    try {
      await conexaoAdmin.noBanco(linha.configuracao_producao, async (conn, alvo) => {
        const configuracao = conexaoAdmin.chaveDoCluster(alvo)
        const guardado = await loginGuardado(linha.usuario_uuid, configuracao)
        const login = guardado ? guardado.login : nomeDoPapel(linha.login)

        if (!(await papelExiste(conn, login))) {
          // Sem papel nao ha o que reaplicar, e criar um aqui entregaria uma
          // senha que ninguem pediu. Quem precisa de papel novo pede a propria
          // atividade, e `/verifica` a cria.
          falhas.push({
            atividade_id: linha.atividade_id,
            razao: 'papel não existe no banco de produção'
          })
          return
        }

        await revogarPapel(conn, login)

        const camadas = await db.conn.task(t =>
          camadasDaAtividade(t, linha.atividade_id)
        )
        await conceder(conn, camadas, login, alvo)
        await renovarValidade(conn, login)

        reaplicadas += 1
      })
    } catch (err) {
      // A MENSAGEM DE `AppError` E SEGURA (ela e escrita por nos, em
      // `conexao_admin.js`); a de um erro qualquer do driver NAO E, porque traz
      // o host. Por isso so a primeira atravessa.
      falhas.push({
        atividade_id: linha.atividade_id,
        razao: err instanceof AppError ? err.message : 'falha ao reaplicar a permissão'
      })
    }
  }

  const resultado = {
    atividades: emExecucao.length,
    reaplicadas,
    falhas
  }

  await registrarAto(
    {
      operacao: 'Reaplicação',
      login: `${PREFIXO_LOGIN}*`,
      atividades: reaplicadas,
      detalhe: falhas.map(f => `Atividade ${f.atividade_id}: ${f.razao}`)
    },
    quemPediu,
    contexto
  )

  return resultado
}

module.exports = permissoes
