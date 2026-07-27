'use strict'

// REGRESSAO 2026-07-27: a "Data de entrega" aparecia como D-1 na tela.
//
// A coluna e DATE. O driver do PostgreSQL a convertia para um objeto Date na
// MEIA-NOITE LOCAL DO SERVIDOR, e o JSON.stringify da resposta serializava esse
// Date em UTC. Com o servidor em UTC e o navegador em UTC-3, a data 2026-01-14
// virava '2026-01-14T00:00:00.000Z' e a tela mostrava 13/01.
//
// Rodando o servidor em UTC-3 o defeito SOME, e foi por isso que ele passou
// despercebido: quem desenvolve esta em UTC-3, quem implanta esta em UTC.
//
// O conserto vive em database/db.js: um type parser para o OID 1082 (DATE) que
// devolve a string crua. DATE nao tem hora nem fuso, entao converter para
// instante e o erro de origem.
//
// Este teste NAO precisa de banco: ele afere o registro do parser e o que ele
// devolve, que e exatamente o contrato que a tela consome.

// db.js so precisa de `errorHandler` e das chaves de conexao. O `../utils` real
// arrasta o serialize-error, que e ESM-only e nao carrega dentro do Jest; nada
// disso interessa aqui, entao entra mockado.
jest.mock('../../utils', () => ({
  errorHandler: { critical: jest.fn() }
}))

jest.mock('../../config', () => ({
  DB_USER: 'u', DB_PASSWORD: 'p', DB_SERVER: 'h', DB_PORT: 5432, DB_NAME: 'd'
}))

const OID_DATE = 1082

describe('type parser de DATE (defesa contra o D-1)', () => {
  let db

  beforeAll(() => {
    // Carregar o modulo tem efeito colateral: registra o parser no pg.
    // Nenhuma conexao e aberta: createConn nao e chamado.
    db = require('../../database/db')
  })

  test('o modulo registra um parser proprio para o OID 1082', () => {
    const parser = db.pgp.pg.types.getTypeParser(OID_DATE)
    expect(typeof parser).toBe('function')
  })

  test('DATE volta como string AAAA-MM-DD, nunca como Date', () => {
    const parser = db.pgp.pg.types.getTypeParser(OID_DATE)

    for (const bruto of ['2026-01-14', '2026-01-01', '2026-12-31', '2026-03-01']) {
      const saida = parser(bruto)
      expect(typeof saida).toBe('string')
      expect(saida).toBe(bruto)
      expect(saida instanceof Date).toBe(false)
    }
  })

  test('a string sobrevive ao JSON da resposta, que era onde o dia se perdia', () => {
    const parser = db.pgp.pg.types.getTypeParser(OID_DATE)
    const linha = { data_entrega: parser('2026-01-14'), prazo: parser('2026-08-10') }

    const enviado = JSON.parse(JSON.stringify(linha))

    expect(enviado.data_entrega).toBe('2026-01-14')
    expect(enviado.prazo).toBe('2026-08-10')
    // O que a tela recebia antes, e que o fuso do navegador puxava para tras.
    expect(enviado.data_entrega).not.toContain('T')
    expect(enviado.data_entrega).not.toContain('Z')
  })

  test('o defeito antigo era real: Date de DATE muda o dia em UTC', () => {
    // Documenta o mecanismo, para o conserto nao ser desfeito por engano.
    // Um Date na meia-noite de um servidor em UTC, lido num navegador a oeste,
    // cai no dia anterior.
    const comoEra = new Date(Date.UTC(2026, 0, 14, 0, 0, 0))
    const noNavegadorUtcMenos3 = comoEra.toLocaleDateString('pt-BR', {
      timeZone: 'America/Sao_Paulo',
      day: '2-digit',
      month: '2-digit',
      year: 'numeric'
    })

    expect(noNavegadorUtcMenos3).toBe('13/01/2026')
  })
})
