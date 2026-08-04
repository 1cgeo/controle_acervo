'use strict'

// A LISTAGEM de usuarios (`GET /api/usuarios`), com o banco mockado.
//
// O que estes casos guardam e o CONTRATO da consulta que alimenta a tela de
// gestao do efetivo, e nao o resultado dela:
//
//   - a ordem e a HIERARQUIA (posto/graduacao decrescente, depois nome de
//     guerra), a mesma das telas de efetivo. Por nome completo, a lista
//     misturava coronel e soldado em ordem alfabetica;
//   - "Na DGEO desde" sai do periodo ABERTO de `dgeo.efetivo_periodo`;
//   - "Ultimo acesso" sai de `dgeo.login`, SEM recorte de data. A rota
//     `/acessos/logados` filtra `data_login >= now()::date`, entao quem nao
//     entrou hoje nao aparecia em lugar nenhum;
//   - `tem_registro` diz se a pessoa ja deixou rastro, para a tela esconder o
//     botao "Excluir" que o banco recusaria com 23503.
//
// Banco mockado, e nao a suite de rotas: o que se afirma aqui e o TEXTO da
// consulta. O comportamento com dado real fica em routes/usuario_cadastro.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const ctrl = require('../../usuario/usuario_ctrl')

/** O SQL da unica consulta que `getUsuarios` dispara. */
const sqlDaListagem = () => mockDb.conn.any.mock.calls[0][0]

describe('usuario_ctrl.getUsuarios', () => {
  beforeEach(() => mockDb.reset())

  test('ordena pela hierarquia: posto decrescente, depois nome de guerra', async () => {
    await ctrl.getUsuarios()

    const sql = sqlDaListagem()
    expect(sql).toMatch(/ORDER BY\s+u\.tipo_posto_grad_id DESC,\s*u\.nome_guerra/)
    expect(sql).not.toMatch(/ORDER BY\s+u\.nome\s*$/m)
  })

  test('traz a data de entrada na DGEO, lida do periodo ABERTO', async () => {
    await ctrl.getUsuarios()

    const sql = sqlDaListagem()
    expect(sql).toContain('dgeo.efetivo_periodo')
    expect(sql).toContain('data_fim IS NULL')
    expect(sql).toContain('AS na_dgeo_desde')
  })

  test('traz o ultimo acesso de dgeo.login, sem recorte de data', async () => {
    await ctrl.getUsuarios()

    const sql = sqlDaListagem()
    expect(sql).toContain('dgeo.login')
    expect(sql).toContain('MAX(l.data_login)')
    expect(sql).toContain('AS ultimo_acesso')
    // O recorte de "quem entrou hoje" e de /acessos/logados. Aqui ele esconderia
    // justamente a informacao que se procura.
    expect(sql).not.toContain('now()::date')
  })

  test('diz se a pessoa ja tem registro, para a tela esconder o Excluir', async () => {
    await ctrl.getUsuarios()

    const sql = sqlDaListagem()
    expect(sql).toContain('AS tem_registro')
  })

  test('continua sem carregar a coluna senha, so o booleano derivado', async () => {
    await ctrl.getUsuarios()

    const sql = sqlDaListagem()
    expect(sql).toContain('(u.senha IS NOT NULL) AS senha_definida')
    expect(sql).not.toMatch(/SELECT[^;]*\bu\.senha\b\s*,/)
  })
})
