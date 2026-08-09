'use strict'

const { errorHandler } = require('../utils')

const {
  DB_USER, DB_PASSWORD, DB_SERVER, DB_PORT, DB_NAME,
  MICRO_DB_USER, MICRO_DB_PASSWORD, MICRO_DB_SERVER, MICRO_DB_PORT, MICRO_DB_NAME
} = require('../config')

const db = {}

db.pgp = require('pg-promise')()

// 1082 é o OID do DATE. Devolver a string crua ('AAAA-MM-DD') impede o driver de
// converter para Date na meia-noite local e o JSON.stringify de serializar em
// UTC: com servidor em UTC e navegador em UTC-3, a tela mostrava um dia a menos.
db.pgp.pg.types.setTypeParser(1082, valor => valor)

// Teto do pool SÓ sob teste. O Jest roda os arquivos em paralelo e cada um abre
// dois pools (`helpers/db.js` e o `createConn` do `helpers/app.js`); com o
// default de 10 por pool, 14 workers pedem 280 conexões de um PostgreSQL que
// aceita 100, e o sintoma é hook estourando o timeout, não erro de conexão.
// Dentro de um arquivo os testes são sequenciais, então dois bastam.
const POOL_TESTE = process.env.NODE_ENV === 'test' ? { max: 2 } : {}

db.createConn = async () => {
  const cn = {
    host: DB_SERVER,
    port: DB_PORT,
    database: DB_NAME,
    user: DB_USER,
    password: DB_PASSWORD,
    ...POOL_TESTE
  }
  const conn = db.pgp(cn)

  await conn
    .connect()
    .then(obj => {
      obj.done() // success, release connection;
    })
    .catch(errorHandler.critical)

  db.conn = conn

  db.criarMicroConn()
}

// ---------------------------------------------------------------------------
// A SEGUNDA CONEXÃO: o banco da TELEMETRIA (microcontrole)
// ---------------------------------------------------------------------------
//
// ELA É A ÚNICA EXCEÇÃO AO "UMA CONEXÃO SÓ" DESTA CASA, e a exceção tem data e
// dono: decisão do chefe em 2026-08-09, quando o microcontrole atravessou. Ver
// `docs/decisoes.md`. Continua valendo que NENHUMA outra parte do sistema abre
// conexão nova (`/grade_acompanhamento` não abre a do banco de edição, e
// `login_info` não cria papel temporário).
//
// PREGUIÇOSA, E É ESSA A DECISÃO QUE IMPORTA. `db.conn` é criada com um
// `connect()` de verdade no boot, e a falha dele passa por `errorHandler.critical`:
// sem o banco principal não há sistema. Aqui é o oposto -- este objeto é montado
// SEM TOCAR A REDE, porque o pg-promise só disca no primeiro `query`. O serviço
// sobe com a telemetria fora do ar, desligada ou nem instalada.
//
// O QUE ISSO COMPRA, MEDIDO CONTRA A ALTERNATIVA. As ONZE rotas de
// `/api/microcontrole` se dividem em duas metades desiguais: CINCO leem o banco
// principal (o tipo de monitoramento e o CRUD do perfil, que é quem diz o que
// monitorar) e SEIS leem a telemetria. Se a segunda conexão fosse cobrada no
// boot, um banco de telemetria fora do ar derrubaria o SERVIÇO INTEIRO -- acervo,
// mapoteca, orçamento, produção -- por causa de três tabelas de medição. E se
// ela fosse cobrada na montagem do roteador, as cinco rotas do banco principal
// cairiam junto com as seis, sem razão nenhuma: elas não tocam esta conexão.
//
// A ALTERNATIVA QUE FOI DESCARTADA era reconectar sob demanda, criando o objeto
// a cada requisição. Ela custa um pool novo por chamada (o plugin manda rajada,
// e cada rajada abriria e abandonaria conexões) e não compra nada: o pool do
// pg-promise já reabre sozinho quando o banco volta, sem reiniciar o serviço.
//
// SEM AS CHAVES, `db.microConn` FICA `null`, e não é um objeto quebrado. Quem
// distingue "não configurado" de "configurado e fora do ar" é
// `microcontrole_ctrl.js`, e as duas respostas são 503 com mensagens
// diferentes: uma manda configurar, a outra manda olhar o servidor.
db.criarMicroConn = () => {
  if (!MICRO_DB_SERVER) {
    db.microConn = null
    return
  }

  // NENHUM `connect()` AQUI. Ver o bloco acima: tocar a rede neste ponto é
  // exatamente o que faria a telemetria derrubar o boot.
  db.microConn = db.pgp({
    host: MICRO_DB_SERVER,
    port: MICRO_DB_PORT,
    database: MICRO_DB_NAME,
    user: MICRO_DB_USER,
    password: MICRO_DB_PASSWORD,
    ...POOL_TESTE
  })
}

module.exports = db
