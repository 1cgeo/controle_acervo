'use strict'

// Exercita o middleware de perfil por modulo com o fluxo REAL do JWT (assina e
// valida de verdade), mockando so o banco. E o teste que prova as tres regras
// que sustentam o modelo: hierarquia, administrador global e revogacao imediata.

const jwt = require('jsonwebtoken')
const express = require('express')
const request = require('supertest')

const { createMockDb } = require('../../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../../database', () => ({ db: mockDb }))

const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { JWT_SECRET } = require('../../../config')
const verifyPerfil = require('../../../login/verify_perfil')
const { asyncHandler, httpCode } = require('../../../utils')

const UUID = '11111111-1111-1111-1111-111111111111'

const token = () => 'Bearer ' + jwt.sign({ id: 1, uuid: UUID }, JWT_SECRET, { expiresIn: '1h' })

// Rota de mentira para cada nivel, so para observar quem passa. Passam o modulo
// 'orcamento' explicitamente, como toda rota do modulo faz depois da fusao: o
// default do middleware no SCA e 'acervo'.
const router = express.Router()
const ok = asyncHandler(async (req, res) =>
  res.sendJsonAndLog(true, 'ok', httpCode.OK, { perfilId: req.perfilId, administrador: req.administrador })
)
router.get('/le', verifyPerfil('consulta', 'orcamento'), ok)
router.get('/escreve', verifyPerfil('operador', 'orcamento'), ok)
router.get('/gerencia', verifyPerfil('gerente', 'orcamento'), ok)

const app = buildTestApp([{ path: '/teste', router }])

// Simula o retorno do JOIN usuario + usuario_perfil do middleware
const usuarioComPerfil = (perfilId, administrador = false) =>
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, administrador, perfil_id: perfilId })

beforeEach(() => mockDb.reset())

describe('verifyPerfil: hierarquia dentro do modulo', () => {
  test('operador passa em rota de consulta (nivel acima satisfaz o de baixo)', async () => {
    usuarioComPerfil(2)
    const res = await request(app).get('/teste/le').set('Authorization', token())
    expect(res.status).toBe(200)
    expect(res.body.dados.perfilId).toBe(2)
  })

  test('consulta NAO passa em rota de escrita', async () => {
    usuarioComPerfil(1)
    const res = await request(app).get('/teste/escreve').set('Authorization', token())
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/perfil operador/i)
  })

  test('operador NAO passa em rota de gerente', async () => {
    usuarioComPerfil(2)
    const res = await request(app).get('/teste/gerencia').set('Authorization', token())
    expect(res.status).toBe(403)
  })

  test('gerente passa em todos os niveis', async () => {
    usuarioComPerfil(3)
    expect((await request(app).get('/teste/gerencia').set('Authorization', token())).status).toBe(200)
    usuarioComPerfil(3)
    expect((await request(app).get('/teste/escreve').set('Authorization', token())).status).toBe(200)
  })
})

describe('verifyPerfil: administrador e global', () => {
  test('administrador passa mesmo SEM linha de perfil no modulo', async () => {
    usuarioComPerfil(null, true)
    const res = await request(app).get('/teste/gerencia').set('Authorization', token())
    expect(res.status).toBe(200)
    expect(res.body.dados.administrador).toBe(true)
  })
})

describe('verifyPerfil: sem perfil e sem token', () => {
  test('usuario sem linha de perfil no modulo nao acessa nem a leitura', async () => {
    usuarioComPerfil(null)
    const res = await request(app).get('/teste/le').set('Authorization', token())
    expect(res.status).toBe(403)
  })

  test('usuario inativo ou inexistente vira 403 (a query filtra ativo)', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce(null)
    const res = await request(app).get('/teste/le').set('Authorization', token())
    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/inativo/i)
  })

  test('sem token vira 401', async () => {
    const res = await request(app).get('/teste/le')
    expect(res.status).toBe(401)
  })
})

describe('verifyPerfil: revogacao imediata', () => {
  test('o que a pessoa pode vem do BANCO, nao do token', async () => {
    // Token assinado quando ela era gerente; o banco ja diz consulta.
    const tokenAntigo = 'Bearer ' + jwt.sign(
      { id: 1, uuid: UUID, administrador: true }, JWT_SECRET, { expiresIn: '1h' }
    )
    usuarioComPerfil(1, false)
    const res = await request(app).get('/teste/escreve').set('Authorization', tokenAntigo)
    expect(res.status).toBe(403)
  })
})

describe('verifyPerfil: erro de programacao falha cedo', () => {
  test('nivel desconhecido estoura no carregamento da rota, nao em runtime', () => {
    expect(() => verifyPerfil('chefao')).toThrow(/Perfil mínimo desconhecido/)
  })

  test('modulo desconhecido estoura do mesmo jeito', () => {
    // O EXEMPLO JA MUDOU DUAS VEZES, e isso conta uma historia: era 'acervo' no
    // repo de origem (onde so havia orcamento), virou 'producao' na fusao, e
    // 'producao' virou modulo de verdade na 1.33.0. O exemplo agora e um nome
    // que nao descreve nenhum trabalho da Divisao, para nao virar modulo amanha.
    expect(() => verifyPerfil('consulta', 'jabuticaba')).toThrow(/Módulo desconhecido/)
  })

  test('os cinco modulos da plataforma sao aceitos', () => {
    expect(() => verifyPerfil('consulta', 'acervo')).not.toThrow()
    expect(() => verifyPerfil('consulta', 'mapoteca')).not.toThrow()
    expect(() => verifyPerfil('consulta', 'orcamento')).not.toThrow()
    expect(() => verifyPerfil('consulta', 'producao')).not.toThrow()
    expect(() => verifyPerfil('consulta', 'efetivo')).not.toThrow()
    expect(verifyPerfil.MODULO).toEqual({
      acervo: 1, mapoteca: 2, orcamento: 3, producao: 4, efetivo: 5
    })
  })
})

// O MAPA DO CODIGO CONTRA O DDL.
//
// `MODULO` traduz nome para `dominio.modulo.code`, e o numero esta escrito a mao
// nos DOIS lugares. O teste acima congela o mapa, mas congelar os dois lados
// separadamente nao os obriga a CONCORDAR: um modulo novo so no DDL faria toda
// concessao nele cair no `Módulo desconhecido`, e um modulo novo so aqui faria a
// consulta procurar um `modulo_id` que a chave estrangeira recusa.
//
// Le o er/dominio.sql, que e a instalacao nova, e nao a migracao: as duas TEM de
// convergir, e quem prova isso e o `migrations/ensaiar_migracao.cjs`.
describe('MODULO espelha dominio.modulo', () => {
  test('os mesmos nomes e os mesmos codigos, nos dois lados', () => {
    const fs = require('fs')
    const path = require('path')

    const ddl = fs.readFileSync(
      path.resolve(__dirname, '..', '..', '..', '..', '..', 'er', 'dominio.sql'),
      'utf8'
    )

    const bloco = ddl.match(
      /INSERT INTO dominio\.modulo \(code, nome, nome_abrev\) VALUES([\s\S]*?);/
    )
    expect(bloco).not.toBeNull()

    const doDdl = {}
    for (const linha of bloco[1].matchAll(/\((\d+),\s*'[^']*',\s*'([a-z_]+)'\)/g)) {
      doDdl[linha[2]] = Number(linha[1])
    }

    // A variancia primeiro: um bloco vazio satisfaria a comparacao abaixo sem
    // provar nada.
    expect(Object.keys(doDdl).length).toBeGreaterThanOrEqual(5)
    expect(verifyPerfil.MODULO).toEqual(doDdl)
  })
})
