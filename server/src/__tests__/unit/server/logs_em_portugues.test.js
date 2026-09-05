'use strict'

/**
 * A ROTA `/logs`: verbo e idioma.
 *
 * Ela publica os três últimos dias do `combined.log` SEM autenticação, e isso é
 * decisão registrada. O que este arquivo cobra são as duas coisas que não
 * dependem daquela decisão:
 *
 *   1. É `GET`, e nada mais. Montada com `app.use`, ela respondia POST, PUT e
 *      DELETE com o mesmo conteúdo. Verbo de escrita que devolve 200 com o log
 *      dentro é ruído no log de acesso do proxy e sugere uma porta de escrita
 *      que não existe.
 *   2. As duas mensagens de erro estão em português, como toda string de erro
 *      da casa. Elas eram as únicas em inglês do arquivo, e quem as lê é quem
 *      abriu `/logs` numa subida nova (a pasta `logs/` ainda não existe) ou sem
 *      permissão de leitura.
 *
 * NÃO CARREGA O `app.js`: ele exige conexão de banco e a versão do banco já no
 * `require`, e isto é teste do pacote rápido. Mesma solução de
 * `unit/server/hpp_removido.test.js` e de `redacao_do_token_no_log.test.js`: as
 * afirmações sobre o `app.js` saem do FONTE, e o mecanismo (o que `use` faz e o
 * que `get` não faz) se prova num express de mentira, ao lado.
 */

const fs = require('fs')
const path = require('path')
const express = require('express')
const request = require('supertest')

const APP_JS = path.join(__dirname, '..', '..', '..', 'server', 'app.js')
const fonte = fs.readFileSync(APP_JS, 'utf8')

const FRASE = 'Não foi possível ler o arquivo de log do serviço'

describe('/logs no app.js', () => {
  test('é montada com app.get, e não com app.use', () => {
    expect(fonte).toContain("app.get('/logs'")
    expect(fonte).not.toContain("app.use('/logs'")
  })

  test('as duas mensagens de erro estão em português, e nenhuma em inglês sobrou', () => {
    expect(fonte).not.toContain('Error reading log file')
    // São DUAS: a do `fs.stat` que falha e a do fluxo de leitura que morre no
    // meio. Uma só traduzida deixaria a outra em inglês, que é o defeito.
    expect(fonte.split(FRASE)).toHaveLength(3)
  })
})

describe('o mecanismo: por que `use` e `get` não são a mesma coisa', () => {
  const handler = (req, res) => res.status(200).send('conteudo do log')

  test('com app.use, o POST recebe o log inteiro', async () => {
    const app = express()
    app.use('/logs', handler)

    const resposta = await request(app).post('/logs')

    expect(resposta.status).toBe(200)
    expect(resposta.text).toBe('conteudo do log')
  })

  test('com app.get, o POST responde 404 e não vaza nada', async () => {
    const app = express()
    app.get('/logs', handler)

    const resposta = await request(app).post('/logs')

    expect(resposta.status).toBe(404)
    expect(resposta.text).not.toContain('conteudo do log')
  })

  test('com app.get, o GET continua respondendo', async () => {
    const app = express()
    app.get('/logs', handler)

    const resposta = await request(app).get('/logs')

    expect(resposta.status).toBe(200)
    expect(resposta.text).toBe('conteudo do log')
  })
})
