'use strict'

// O QUE NUNCA PODE ENTRAR NO JSON DA AUDITORIA.
//
// Este arquivo guarda o unico caso do trabalho de rastreabilidade que causa dano
// se falhar em silencio: o hash da senha vazando para uma tabela que ninguem
// pensa como guardadora de credencial e que a tela de administrador le.

const { sanitizar, TETO_VALOR_BYTES } = require('../../auditoria/sanitizar')
const { diffCampos } = require('../../auditoria/diff')

describe('sanitizar: segredo', () => {
  it('a senha vira NULO, e nao some da chave', () => {
    const linha = { login: 'fulano', senha: '$2b$10$abcdefghijklmnopqrstuv', ativo: true }

    const saida = sanitizar(linha, { omitir: ['senha'] })

    expect(saida.senha).toBeNull()
    // A chave CONTINUA presente: ausente ela se leria como "esta coluna nao
    // existia", e o que aconteceu foi "existe e nao se guarda".
    expect('senha' in saida).toBe(true)
    expect(saida.login).toBe('fulano')
  })

  it('o hash nao sobra em canto nenhum do JSON', () => {
    const hash = '$2b$10$abcdefghijklmnopqrstuv'
    const saida = sanitizar({ senha: hash }, { omitir: ['senha'] }) // path-ok: fixture

    expect(JSON.stringify(saida)).not.toContain(hash)
  })

  // A ORDEM entre diff e sanitizacao e o que faz a troca de senha continuar
  // visivel no historico. Sanitizar ANTES apagaria a mudanca, porque nulo
  // comparado a nulo nao acusa nada, e "trocaram a senha de alguem" deixaria de
  // aparecer -- que e justamente o evento que se quer ver.
  it('o diff roda ANTES e continua acusando que a senha mudou', () => {
    const antes = { login: 'fulano', senha: 'hash-antigo' } // path-ok: fixture
    const depois = { login: 'fulano', senha: 'hash-novo' } // path-ok: fixture

    expect(diffCampos(antes, depois)).toEqual(['senha'])

    expect(sanitizar(antes, { omitir: ['senha'] }).senha).toBeNull()
    expect(sanitizar(depois, { omitir: ['senha'] }).senha).toBeNull()
  })
})

describe('sanitizar: binario', () => {
  it('BYTEA vira o tamanho, e nao o conteudo', () => {
    const linha = {
      nome_original: 'diex.pdf',
      tamanho_bytes: 4,
      conteudo: Buffer.from([1, 2, 3, 4])
    }

    const saida = sanitizar(linha)

    expect(saida.conteudo).toEqual({ _omitido: 'conteudo', bytes: 4 })
    // O diff continua acusando a troca do anexo, porque o nome e o tamanho
    // continuam la.
    expect(saida.nome_original).toBe('diex.pdf')
  })
})

describe('sanitizar: geometria e texto grande', () => {
  it('a folha do SCN cabe INTEIRA, que e o caso comum', () => {
    // Cinco vertices. O estado anterior de uma geometria redesenhada e
    // exatamente o que se quer para desfazer, entao ela nao pode ser recortada
    // por precaucao.
    const ewkt = 'SRID=4674;POLYGON((-50 -15,-49 -15,-49 -14,-50 -14,-50 -15))'

    expect(sanitizar({ geom: ewkt }).geom).toBe(ewkt)
  })

  it('geometria acima do teto vira resumo legivel, com tipo e contagem', () => {
    const pares = []
    for (let i = 0; i < 2000; i += 1) pares.push(`-50.${i} -15.${i}`)
    const ewkt = `SRID=4674;POLYGON((${pares.join(',')}))`

    expect(Buffer.byteLength(ewkt, 'utf8')).toBeGreaterThan(TETO_VALOR_BYTES)

    const saida = sanitizar({ geom: ewkt }).geom

    expect(saida._truncado).toBe(true)
    expect(saida.resumo).toContain('POLYGON')
    expect(saida.resumo).toContain('2000 vertices')
  })

  it('texto comum acima do teto guarda o comeco e o tamanho', () => {
    const texto = 'a'.repeat(TETO_VALOR_BYTES + 1)

    const saida = sanitizar({ observacao: texto }).observacao

    expect(saida._truncado).toBe(true)
    expect(saida.bytes).toBe(TETO_VALOR_BYTES + 1)
    // Nao ganha resumo geometrico: nao e geometria.
    expect(saida.resumo).not.toContain('vertices')
  })

  it('o teto e por VALOR, e nao por linha', () => {
    // O campo grande nao pode empurrar os pequenos para fora do registro.
    const grande = 'a'.repeat(TETO_VALOR_BYTES + 1)
    const saida = sanitizar({ observacao: grande, nome: 'cabe', id: 7 })

    expect(saida.nome).toBe('cabe')
    expect(saida.id).toBe(7)
  })
})

describe('sanitizar: casos de borda', () => {
  it('linha nula continua nula', () => {
    expect(sanitizar(null)).toBeNull()
  })

  it('sem lista de omissao, nada e omitido', () => {
    expect(sanitizar({ a: 1 })).toEqual({ a: 1 })
  })
})
