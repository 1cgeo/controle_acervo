'use strict'

// REGRESSÃO: a data de entrega aparecia um dia antes na tela.
//
// A coluna é DATE, e o driver do PostgreSQL a converte para um Date na
// MEIA-NOITE LOCAL DO SERVIDOR. O `JSON.stringify` da resposta serializa esse
// Date em UTC, e o navegador a oeste o puxa para o dia anterior. Com o servidor
// em UTC e o navegador em UTC-3, a data sai um dia atrás.
//
// O defeito SOME num servidor em UTC-3, e é por isso que ele atravessa o
// desenvolvimento: desenvolve-se em UTC-3 e implanta-se em UTC.
//
// O conserto vive em database/db.js: um type parser para o OID 1082 (DATE) que
// devolve a string crua. DATE não tem hora nem fuso, então converter para
// instante é o erro de origem.
//
// Este teste NÃO precisa de banco: ele afere o que o parser devolve, que é
// exatamente o contrato que a tela consome.

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

  // NAO se pergunta se `getTypeParser` devolve uma funcao: ele devolve sempre,
  // e para OID sem registro entrega o parser embutido do pg. Quem separa o
  // nosso do dele e o COMPORTAMENTO: o embutido para DATE devolve um Date, e o
  // nosso devolve a string crua. Desregistrado o conserto, este caso cai.
  test('DATE volta como string AAAA-MM-DD, nunca como Date', () => {
    const parser = db.pgp.pg.types.getTypeParser(OID_DATE)

    for (const bruto of ['2026-01-14', '2026-01-01', '2026-12-31', '2026-03-01']) {
      const saida = parser(bruto)
      expect(typeof saida).toBe('string')
      expect(saida).toBe(bruto)
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
})
