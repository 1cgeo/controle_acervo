'use strict'

// A INSTITUICAO que opera esta instalacao, contra o banco e as rotas de verdade.
//
// TRES COISAS SE PROVAM AQUI, e a terceira e do BANCO e nao da rota:
//
//   1. AS GUARDAS. `GET` e `verifyLogin` (a propria conta) e `PUT` e
//      `verifyAdmin`. A leitura e a guarda mais baixa da plataforma de
//      proposito: desde 2026-08-08 ter conta e ter acesso sao dois momentos, e
//      quem nao tem perfil em modulo nenhum alcanca so a propria pagina --
//      que e justamente onde o nome do Centro precisa aparecer.
//   2. A ESCRITA E AUDITADA, na MESMA transacao. Trocar o nome muda a que Centro
//      o sistema inteiro se diz pertencer, e a pergunta seguinte e sempre "quem
//      trocou".
//   3. A SEGUNDA LINHA NAO ENTRA, e quem recusa e o CHECK `(id = 1)` do DDL, e
//      nao a aplicacao. Nao ha rota de criacao para exercitar isso: o caso vai
//      direto ao `INSERT`, que e por onde uma segunda linha entraria de verdade
//      (uma carga, um `psql` de plantao, um script de quem vier depois).
//
// A LINHA NAO ESTA NO `cleanTestData`, e nem deveria: ela e SEMENTE do
// `er/dgeo.sql`, como `pit.pit` e `acervo.volume_armazenamento`. Por isso o
// `afterEach` daqui a devolve ao estado da semente com as proprias maos -- sem
// isso, um `PUT` deste arquivo vazaria o nome trocado para todo teste que
// rodasse depois neste worker.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken, ADMIN_UUID } = require('../helpers/auth')

const SEMENTE = {
  nome: '1º Centro de Geoinformação',
  sigla: '1º CGEO',
  ug_code: '160382'
}

let app

beforeAll(async () => {
  app = await getApp()
})

const devolverASemente = () =>
  conn.none(
    `UPDATE dgeo.instituicao
        SET nome = $<nome>, sigla = $<sigla>, ug_code = $<ug_code>,
            data_modificacao = NULL, usuario_modificacao_uuid = NULL
      WHERE id = 1`,
    SEMENTE
  )

// O `beforeEach` defende ESTE arquivo de quem veio antes; o `afterEach` defende
// quem vem depois. So o primeiro protege do vazamento alheio.
beforeEach(devolverASemente)

afterEach(async () => {
  await devolverASemente()
  await cleanTestData()
})

describe('GET /api/instituicao', () => {
  it('exige token: sem ele, 401', async () => {
    const res = await request(app).get('/api/instituicao')

    expect(res.status).toBe(401)
  })

  // O CASO QUE DEFINE A GUARDA. `test_user` nao e administrador, e a resposta
  // tem de ser 200: cobrar `verifyAdmin` ou `verifyAcesso` aqui deixaria sem
  // nome de Centro a tela que existe para dizer a quem pedir acesso.
  it('quem apenas entrou no sistema LÊ a instituição', async () => {
    const res = await request(app)
      .get('/api/instituicao')
      .set('Authorization', generateUserToken())

    expect(res.status).toBe(200)
    expect(res.body.dados.nome).toBe(SEMENTE.nome)
    expect(res.body.dados.sigla).toBe(SEMENTE.sigla)
    expect(res.body.dados.ug_code).toBe(SEMENTE.ug_code)
  })

  // O nome da UG sai por LEFT JOIN em `dominio.ug`, para a tela e o rodape do
  // relatorio nao terem de pedir o catalogo inteiro so para traduzir um codigo.
  it('devolve o NOME da Unidade Gestora junto do código', async () => {
    const res = await request(app)
      .get('/api/instituicao')
      .set('Authorization', generateAdminToken())

    expect(res.body.dados.ug_nome).toBe('1 CGEO - Primeiro Centro de Geoinformação')
  })

  it('a instalação SEM Unidade Gestora continua respondendo 200, e não some no JOIN', async () => {
    await conn.none('UPDATE dgeo.instituicao SET ug_code = NULL WHERE id = 1')

    const res = await request(app)
      .get('/api/instituicao')
      .set('Authorization', generateUserToken())

    expect(res.status).toBe(200)
    expect(res.body.dados.ug_code).toBeNull()
    expect(res.body.dados.ug_nome).toBeNull()
  })
})

describe('PUT /api/instituicao', () => {
  it('recusa quem não é administrador global, mesmo entrando no sistema', async () => {
    const res = await request(app)
      .put('/api/instituicao')
      .set('Authorization', generateUserToken())
      .send({ nome: 'Outro Centro', sigla: 'OC' })

    expect(res.status).toBe(403)

    const linha = await conn.one('SELECT nome FROM dgeo.instituicao WHERE id = 1')
    expect(linha.nome).toBe(SEMENTE.nome)
  })

  it('o administrador troca os três campos', async () => {
    const res = await request(app)
      .put('/api/instituicao')
      .set('Authorization', generateAdminToken())
      .send({
        nome: '3º Centro de Geoinformação',
        sigla: '3º CGEO',
        ug_code: '160089'
      })

    expect(res.status).toBe(200)

    const linha = await conn.one(
      'SELECT nome, sigla, ug_code, usuario_modificacao_uuid, data_modificacao FROM dgeo.instituicao WHERE id = 1'
    )
    expect(linha.nome).toBe('3º Centro de Geoinformação')
    expect(linha.sigla).toBe('3º CGEO')
    expect(linha.ug_code).toBe('160089')
    expect(linha.usuario_modificacao_uuid).toBe(ADMIN_UUID)
    expect(linha.data_modificacao).not.toBeNull()
  })

  // LER, MUDAR UM CAMPO E REENVIAR e o fluxo mais banal do sistema, e o `GET`
  // devolve tres campos que o `PUT` nao aceita (`id`, `ug_nome`,
  // `data_modificacao`, `usuario_modificacao_uuid`). E por isso que a rota usa o
  // validador TOLERANTE: com o estrito, este caso responderia 400.
  it('o corpo lido pelo GET pode ser reenviado ao PUT sem 400', async () => {
    const lido = await request(app)
      .get('/api/instituicao')
      .set('Authorization', generateAdminToken())

    const res = await request(app)
      .put('/api/instituicao')
      .set('Authorization', generateAdminToken())
      .send({ ...lido.body.dados, sigla: '1 CGEO' })

    expect(res.status).toBe(200)

    const linha = await conn.one('SELECT nome, sigla, ug_code FROM dgeo.instituicao WHERE id = 1')
    expect(linha.sigla).toBe('1 CGEO')
    // O que nao se quis mudar continua igual: o reenvio nao apagou a UG.
    expect(linha.nome).toBe(SEMENTE.nome)
    expect(linha.ug_code).toBe(SEMENTE.ug_code)
  })

  it('apagar o campo de UG na tela grava NULL, e não cadeia vazia', async () => {
    const res = await request(app)
      .put('/api/instituicao')
      .set('Authorization', generateAdminToken())
      .send({ nome: SEMENTE.nome, sigla: SEMENTE.sigla, ug_code: '' })

    expect(res.status).toBe(200)

    const linha = await conn.one('SELECT ug_code FROM dgeo.instituicao WHERE id = 1')
    expect(linha.ug_code).toBeNull()
  })

  // O 23503 cru citaria 'instituicao_ug_code_fkey' num 500. O controlador o
  // traduz para 400 dizendo o que fazer.
  it('a UG inexistente vira 400, e não 500', async () => {
    const res = await request(app)
      .put('/api/instituicao')
      .set('Authorization', generateAdminToken())
      .send({ nome: SEMENTE.nome, sigla: SEMENTE.sigla, ug_code: '999999' })

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/Unidade Gestora/)

    const linha = await conn.one('SELECT ug_code FROM dgeo.instituicao WHERE id = 1')
    expect(linha.ug_code).toBe(SEMENTE.ug_code)
  })

  it('recusa o corpo sem nome com 400, e não grava nada', async () => {
    const res = await request(app)
      .put('/api/instituicao')
      .set('Authorization', generateAdminToken())
      .send({ sigla: 'XX' })

    expect(res.status).toBe(400)

    const linha = await conn.one('SELECT nome, sigla FROM dgeo.instituicao WHERE id = 1')
    expect(linha.sigla).toBe(SEMENTE.sigla)
  })

  // A AUDITORIA CAI NA MESMA TRANSACAO, e falhar ao auditar derruba a escrita.
  // Sem a entrada `dgeo.instituicao` no mapa de `auditoria/mapa/plataforma.js`,
  // `auditoriaCtrl.registrar` lanca ali dentro e o PUT inteiro responde 500 --
  // e o nome NAO muda. Este caso e o que pega isso.
  it('a troca deixa rastro em auditoria.evento, no agregado da instituição', async () => {
    await request(app)
      .put('/api/instituicao')
      .set('Authorization', generateAdminToken())
      .send({ nome: '2º Centro de Geoinformação', sigla: '2º CGEO', ug_code: null })

    const evento = await conn.one(
      `SELECT modulo, entidade, entidade_id, tabela, operacao, campos_alterados,
              dados_antes, dados_depois, usuario_uuid
         FROM auditoria.evento
        WHERE tabela = 'dgeo.instituicao'
        ORDER BY id DESC LIMIT 1`
    )

    expect(evento.modulo).toBe('plataforma')
    expect(evento.entidade).toBe('instituicao')
    expect(evento.entidade_id).toBe('1')
    expect(evento.operacao).toBe('U')
    expect(evento.usuario_uuid).toBe(ADMIN_UUID)
    expect(evento.campos_alterados.sort()).toEqual(['nome', 'sigla', 'ug_code'])
    expect(evento.dados_antes.nome).toBe(SEMENTE.nome)
    expect(evento.dados_depois.nome).toBe('2º Centro de Geoinformação')
  })
})

// --- A LINHA UNICA, e quem a garante ---------------------------------------
//
// NAO E A APLICACAO. Nao ha rota de criacao, entao o unico jeito de provar a
// regra e tentar o `INSERT` que uma carga ou um `psql` fariam.
//
// SAO DOIS CAMINHOS, e cada um bate numa tranca diferente:
//
//   - com `id` informado (2, 7, o que for), quem recusa e o CHECK
//     `instituicao_id_check`, avaliado durante o INSERT;
//   - com `id` OMITIDO, o DEFAULT repete o 1 e quem recusa e a chave primaria.
//
// A distincao importa porque o erro que aparece na tela e o da tranca que
// disparou primeiro, e e o mesmo raciocinio do CHECK
// `movimento_material_forma` da mapoteca, que aparece antes da chave estrangeira
// porque o CHECK e avaliado durante o INSERT e o gatilho da FK so depois.
describe('dgeo.instituicao é de LINHA ÚNICA, e quem garante é o banco', () => {
  it('a segunda linha com `id` próprio é recusada pelo CHECK (id = 1)', async () => {
    await expect(
      conn.none(
        `INSERT INTO dgeo.instituicao (id, nome, sigla, ug_code)
         VALUES (2, '2º Centro de Geoinformação', '2º CGEO', NULL)`
      )
    ).rejects.toMatchObject({
      // 23514 = check_violation
      code: '23514',
      constraint: 'instituicao_id_check'
    })

    const { total } = await conn.one('SELECT count(*)::int AS total FROM dgeo.instituicao')
    expect(total).toBe(1)
  })

  it('a segunda linha SEM `id` é recusada pela chave primária, porque o default repete o 1', async () => {
    await expect(
      conn.none(
        `INSERT INTO dgeo.instituicao (nome, sigla, ug_code)
         VALUES ('2º Centro de Geoinformação', '2º CGEO', NULL)`
      )
    ).rejects.toMatchObject({
      // 23505 = unique_violation
      code: '23505'
    })

    const { total } = await conn.one('SELECT count(*)::int AS total FROM dgeo.instituicao')
    expect(total).toBe(1)
  })
})
