'use strict'

/**
 * O TOKEN NÃO PODE FICAR ESCRITO NO LOG DA APLICAÇÃO.
 *
 * O caminho completo do defeito, que é o que este arquivo guarda:
 *
 *   1. a URL da tile MVT leva credencial na query (`?token=`), porque uma camada
 *      XYZ não tem onde pôr cabeçalho -- ver `login/verify_login_tile.js`;
 *   2. o middleware de log do `server/app.js` grava `req.originalUrl`, e
 *      `originalUrl` inclui a query string;
 *   3. a rota `/logs`, no mesmo arquivo, publica os últimos três dias do
 *      `combined.log` SEM guarda nenhuma.
 *
 * Somando os três, a credencial ficava legível a quem abrisse a página do log. O
 * `/logs` continua aberto, e isso é decisão registrada; o que este arquivo cobra
 * é que o valor do token não chegue lá.
 *
 * SÃO DUAS DEFESAS INDEPENDENTES, e esta é a segunda. A primeira é o ESCOPO: o
 * que anda na URL da tile é um token de audiência `tile`, de vida curta, provado
 * em `unit/login/audiencia_do_token.test.js`. A redação sozinha não bastaria (o
 * log de acesso do servidor web, o histórico do navegador, o `Referer` e o proxy
 * continuam vendo a URL inteira), e o escopo sozinho também não (não há por que
 * publicar credencial nenhuma numa rota aberta).
 *
 * NÃO CARREGA O `app.js`: ele exige conexão de banco e a versão do banco já
 * lida no `require`, e isto é teste do pacote rápido. A função vem sozinha, e a
 * ligação dela com o middleware se cobra lendo o fonte -- mesma solução do
 * `unit/server/hpp_removido.test.js`.
 */

const fs = require('fs')
const path = require('path')
const jwt = require('jsonwebtoken')

const redigirTokenDaUrl = require('../../../login/redigir_token_da_url')

const APP_JS = path.join(__dirname, '..', '..', '..', 'server', 'app.js')

// Um JWT de verdade, e não 'abc': o que se procura no log é esta forma de três
// pedaços separados por ponto, e uma string curta esconderia um erro de regex
// que só aparecesse com o `.` ou o `-` do base64url.
const TOKEN = jwt.sign({ uuid: 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22' }, 'segredo-de-teste')
const BASE = 'http://servidor/api/acompanhamento/linha_producao/3/10/20/30.pbf'

describe('redigirTokenDaUrl', () => {
  it('troca o valor do token pela marca, e o valor não sobra em lugar nenhum', () => {
    const redigida = redigirTokenDaUrl(`${BASE}?token=${TOKEN}`)

    expect(redigida).toBe(`${BASE}?token=[REDIGIDO]`)
    expect(redigida).not.toContain(TOKEN)
    // Nem um pedaço dele: o payload sozinho já entrega o uuid.
    expect(redigida).not.toContain(TOKEN.split('.')[1])
  })

  it('preserva o resto da query, antes e depois do token', () => {
    const redigida = redigirTokenDaUrl(`${BASE}?buffer=1&token=${TOKEN}&formato=pbf`)

    expect(redigida).toBe(`${BASE}?buffer=1&token=[REDIGIDO]&formato=pbf`)
  })

  it('URL sem query nenhuma volta idêntica', () => {
    expect(redigirTokenDaUrl(BASE)).toBe(BASE)
  })

  it('query sem token volta idêntica', () => {
    const url = `${BASE}?buffer=1&formato=pbf`
    expect(redigirTokenDaUrl(url)).toBe(url)
  })

  // A forma que fazia 500 antes de 2026-08-09 continua sendo escrita no log, e
  // ela pode carregar um token de verdade dentro.
  it('redige também a forma de arranjo, escrita e percent-encoded', () => {
    expect(redigirTokenDaUrl(`${BASE}?token[]=${TOKEN}`))
      .toBe(`${BASE}?token[]=[REDIGIDO]`)
    expect(redigirTokenDaUrl(`${BASE}?token%5B%5D=${TOKEN}`))
      .toBe(`${BASE}?token%5B%5D=[REDIGIDO]`)
  })

  it('não confunde outro parâmetro que termine em token', () => {
    const url = `${BASE}?refresh_token_id=7`
    expect(redigirTokenDaUrl(url)).toBe(url)
  })

  it('o que não é string volta como veio, porque logar não pode derrubar a requisição', () => {
    expect(redigirTokenDaUrl(undefined)).toBeUndefined()
    expect(redigirTokenDaUrl(null)).toBeNull()
  })
})

describe('o middleware de log do app.js usa a redação', () => {
  const fonte = fs.readFileSync(APP_JS, 'utf8')

  it('o app.js requer a função', () => {
    expect(fonte).toMatch(/require\('\.\.\/login\/redigir_token_da_url'\)/)
  })

  // O QUE IMPORTA É QUE `originalUrl` NÃO CHEGUE CRU AO LOGGER. Sem esta
  // asserção, alguém acrescentaria uma segunda linha de log com a URL inteira e
  // os casos acima continuariam verdes.
  it('nenhuma URL montada com originalUrl vai ao logger sem passar por ela', () => {
    const montagens = [...fonte.matchAll(/req\.originalUrl/g)]
    expect(montagens.length).toBeGreaterThan(0)

    // Todo trecho `logger.info(...)` do arquivo tem de estar precedido de uma
    // URL já redigida: hoje há um só, e ele lê a variável `url` montada logo
    // acima com `redigirTokenDaUrl`.
    expect(fonte).toMatch(/const url = redigirTokenDaUrl\(/)
    expect(fonte).not.toMatch(/const url = req\.protocol/)
  })
})
