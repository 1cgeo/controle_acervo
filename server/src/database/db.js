'use strict'

const { errorHandler } = require('../utils')

const { DB_USER, DB_PASSWORD, DB_SERVER, DB_PORT, DB_NAME } = require('../config')

const db = {}

db.pgp = require('pg-promise')()

// Coluna DATE volta como TEXTO 'AAAA-MM-DD', nunca como objeto Date.
//
// O driver converte DATE para um Date na MEIA-NOITE LOCAL DO SERVIDOR, e o
// JSON.stringify da resposta serializa esse Date em UTC. Com o servidor em UTC
// e o navegador em UTC-3, a data 2026-01-14 sai como '2026-01-14T00:00:00.000Z'
// e a tela mostra 13/01: um dia a menos, sem ninguem ter errado a digitacao.
// Rodando o servidor em UTC-3 o defeito some, e foi por isso que ele passou
// despercebido em desenvolvimento.
//
// DATE nao tem hora nem fuso, entao converter para instante e o erro de origem.
// Devolvendo a string crua, nenhum fuso a alcanca. Vale para toda coluna DATE
// do sistema (prazo, data_atendimento, ...). Medido e corrigido em 2026-07-27.
//
// 1082 e o OID do tipo DATE no PostgreSQL.
db.pgp.pg.types.setTypeParser(1082, valor => valor)

// TETO DO POOL SOB TESTE, e so sob teste.
//
// O `pg` abre ate 10 conexoes por pool, e o pacote de banco tem DOIS pools por
// arquivo de teste: o de `helpers/db.js` e o que este `createConn` monta para o
// `helpers/app.js`. O Jest roda os arquivos em paralelo, um banco por worker,
// entao o teto real e (workers x 2 pools x 10). Com 14 workers isso pede 280
// conexoes de um PostgreSQL que aceita 100 por padrao, e o que se ve nao e um
// erro de conexao: sao HOOKS estourando os 5s do Jest, em arquivos que passam
// sozinhos e falham juntos, cada hora um. Medido em 2026-08-02, quando os dois
// arquivos novos de teste da fusao da autenticacao levaram um arranjo que ja
// estava no limite para o outro lado.
//
// Dois basta: dentro de um arquivo os testes sao sequenciais, e a transacao usa
// uma conexao por vez. Em producao NAO se mexe -- la o pool serve requisicoes
// concorrentes de gente de verdade, e 10 e o default do driver.
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
}

module.exports = db
