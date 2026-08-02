'use strict'

// Cadastro de usuario e senha, pela API.
//
// O SCA passou a ser o dono da identidade em 2026-08-02. Ate ali `dgeo.usuario`
// era um espelho do Auth Server e esta feature so sabia LER e conceder perfil;
// criar, editar, excluir e trocar senha nao existiam em lugar nenhum do SCA.
//
// O que cada bloco guarda:
//   - a senha nunca sai por rota nenhuma, em nenhum formato
//   - o PUT PARCIAL, que os botoes de alternar da tela usam: mandar so
//     `administrador` e `ativo` nao pode apagar o nome de ninguem
//   - a traducao dos dois erros do PostgreSQL (login repetido, e usuario que ja
//     tem registro e por isso nao se exclui)
//   - a trava do ultimo administrador, que e um lockout so recuperavel por SQL
//   - a troca da propria senha exigindo a vigente, e o login passando a valer
//     com a senha nova de verdade

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken, USER_UUID } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

const listar = () =>
  request(app).get('/api/usuarios').set('Authorization', admin())

const criar = body =>
  request(app).post('/api/usuarios').set('Authorization', admin()).send(body)

const atualizar = (uuid, body) =>
  request(app).put(`/api/usuarios/${uuid}`).set('Authorization', admin()).send(body)

const excluir = uuid =>
  request(app).delete(`/api/usuarios/${uuid}`).set('Authorization', admin())

const resetar = usuarios =>
  request(app)
    .post('/api/usuarios/senha/reset')
    .set('Authorization', admin())
    .send({ usuarios })

const NOVO = {
  login: 'ciclano',
  senha: 'senha-inicial',
  nome: 'Ciclano de Tal',
  nome_guerra: 'Ciclano',
  tipo_posto_grad_id: 6,
  administrador: false,
  ativo: true
}

const acharPorLogin = async login =>
  (await listar()).body.dados.find(u => u.login === login)

const hashNoBanco = login =>
  conn.one('SELECT senha FROM dgeo.usuario WHERE login = $<login>', { login })

describe('POST /api/usuarios', () => {
  test('cria a pessoa e devolve o uuid, sem devolver senha', async () => {
    const res = await criar(NOVO)

    expect(res.status).toBe(201)
    expect(res.body.dados.uuid).toEqual(expect.any(String))
    expect(JSON.stringify(res.body)).not.toContain('senha-inicial')
  })

  test('a senha vai para o banco como HASH, nunca em claro', async () => {
    await criar(NOVO)

    const { senha } = await hashNoBanco('ciclano')
    expect(senha).not.toBe('senha-inicial')
    // Prefixo do bcrypt. Sem esta asserção, qualquer transformação passaria.
    expect(senha).toMatch(/^\$2[aby]\$/)
  })

  test('criar NAO libera modulo nenhum: perfil e ato explicito', async () => {
    await criar(NOVO)

    const criado = await acharPorLogin('ciclano')
    expect(criado.perfis).toEqual({})
  })

  test('perfil informado no corpo e gravado', async () => {
    await criar({ ...NOVO, perfis: { acervo: 2 } })

    const criado = await acharPorLogin('ciclano')
    expect(criado.perfis).toEqual({ acervo: 2 })
  })

  test('login repetido vira 400 com o login na mensagem, e nao 500', async () => {
    await criar(NOVO)
    const res = await criar({ ...NOVO, nome: 'Outra Pessoa' })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('ciclano')
  })

  test('quem nao e administrador nao cria ninguem', async () => {
    const res = await request(app)
      .post('/api/usuarios')
      .set('Authorization', generateUserToken())
      .send(NOVO)

    expect(res.status).toBe(403)
  })
})

describe('GET /api/usuarios', () => {
  test('a listagem nao carrega a coluna senha', async () => {
    await criar(NOVO)

    const res = await listar()
    for (const usuario of res.body.dados) {
      expect(usuario).not.toHaveProperty('senha')
    }
  })

  test('marca quem esta sem senha, que e quem nao consegue entrar', async () => {
    // O estado de quem veio do Auth Server e nao teve o hash copiado. Ele so
    // existe porque a migracao deixou a coluna anulavel de proposito.
    await criar(NOVO)
    await conn.none(
      "UPDATE dgeo.usuario SET senha = NULL WHERE login = 'ciclano'"
    )

    const semSenha = await acharPorLogin('ciclano')
    expect(semSenha.senha_definida).toBe(false)

    const comSenha = await acharPorLogin('test_admin')
    expect(comSenha.senha_definida).toBe(true)
  })
})

describe('PUT /api/usuarios/:uuid', () => {
  test('mandar so administrador e ativo NAO apaga os demais campos', async () => {
    const { body } = await criar(NOVO)
    const uuid = body.dados.uuid

    // Exatamente o que os botoes de alternar da tela mandam.
    const res = await atualizar(uuid, { administrador: false, ativo: false })
    expect(res.status).toBe(200)

    const depois = await acharPorLogin('ciclano')
    expect(depois.nome).toBe('Ciclano de Tal')
    expect(depois.nome_guerra).toBe('Ciclano')
    expect(depois.tipo_posto_grad_id).toBe(6)
    expect(depois.ativo).toBe(false)
  })

  test('edita os campos informados', async () => {
    const { body } = await criar(NOVO)

    await atualizar(body.dados.uuid, {
      administrador: false,
      ativo: true,
      nome: 'Ciclano Corrigido',
      tipo_posto_grad_id: 13
    })

    const depois = await acharPorLogin('ciclano')
    expect(depois.nome).toBe('Ciclano Corrigido')
    expect(depois.tipo_posto_grad_id).toBe(13)
  })

  test('editar cadastro nao troca a senha', async () => {
    const { body } = await criar(NOVO)
    const antes = await hashNoBanco('ciclano')

    await atualizar(body.dados.uuid, {
      administrador: false,
      ativo: true,
      nome: 'Ciclano Corrigido'
    })

    const depois = await hashNoBanco('ciclano')
    expect(depois.senha).toBe(antes.senha)
  })

  test('login repetido na edicao vira 400', async () => {
    const { body } = await criar(NOVO)

    const res = await atualizar(body.dados.uuid, {
      administrador: false,
      ativo: true,
      login: 'test_admin'
    })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('test_admin')
  })

  // O lockout aqui nao tem tela de recuperacao: sem administrador ativo,
  // ninguem alcanca esta rota para desfazer, e so o SQL direto no banco resolve.
  test('nao deixa desativar o ultimo administrador ativo', async () => {
    const admins = await conn.one(
      'SELECT COUNT(*)::integer AS n FROM dgeo.usuario WHERE administrador IS TRUE AND ativo IS TRUE'
    )
    expect(admins.n).toBe(1)

    const res = await request(app)
      .put('/api/usuarios/a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11')
      .set('Authorization', admin())
      .send({ administrador: true, ativo: false })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('último administrador')
  })

  // Rebaixa o administrador RECEM-CRIADO, e nao o `test_admin` da semente, de
  // proposito: rebaixar o da semente derrubaria com 403 todo teste seguinte que
  // usasse o token de admin. O `cleanTestData` hoje restaura a semente, mas
  // depender disso para nao quebrar o arquivo inteiro seria fragil a toa.
  test('com outro administrador ativo, rebaixar passa', async () => {
    const { body } = await criar({ ...NOVO, login: 'outro_admin', administrador: true })

    const res = await atualizar(body.dados.uuid, {
      administrador: false,
      ativo: true
    })

    expect(res.status).toBe(200)
    const depois = await acharPorLogin('outro_admin')
    expect(depois.administrador).toBe(false)
  })
})

describe('DELETE /api/usuarios/:uuid', () => {
  test('exclui quem ainda nao encostou em nada', async () => {
    const { body } = await criar(NOVO)

    const res = await excluir(body.dados.uuid)
    expect(res.status).toBe(200)
    expect(await acharPorLogin('ciclano')).toBeUndefined()
  })

  test('o perfil cai junto, por CASCADE', async () => {
    const { body } = await criar({ ...NOVO, perfis: { acervo: 1 } })
    const { id } = await conn.one(
      "SELECT id FROM dgeo.usuario WHERE login = 'ciclano'"
    )

    await excluir(body.dados.uuid)

    const perfis = await conn.any(
      'SELECT id FROM dgeo.usuario_perfil WHERE usuario_id = $<id>',
      { id }
    )
    expect(perfis).toHaveLength(0)
  })

  // A FK e RESTRICT de propósito: quem ja trabalhou no sistema se DESATIVA, e
  // apagar reescreveria a autoria do que a pessoa cadastrou. O que este teste
  // guarda e a TRADUCAO: sem ela a tela mostraria um 500 e a mensagem generica.
  test('quem ja tem registro no sistema vira 400 mandando desativar', async () => {
    await criar(NOVO)
    const { id, uuid } = await conn.one(
      "SELECT id, uuid FROM dgeo.usuario WHERE login = 'ciclano'"
    )
    await conn.none(
      `INSERT INTO dgeo.login (usuario_id, cliente) VALUES ($<id>, 'sca_web')`,
      { id }
    )
    // dgeo.login e ON DELETE SET NULL, entao ele nao barra: quem barra e uma FK
    // RESTRICT de verdade, como a da edicao do RPCMTec.
    await conn.none(
      `INSERT INTO rpcmtec.edicao (ano, mes, usuario_cadastramento_uuid)
       VALUES (2026, 8, $<uuid>)`,
      { uuid }
    )

    const res = await excluir(uuid)

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('Desative')
  })

  test('uuid inexistente vira 404', async () => {
    const res = await excluir('c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33')
    expect(res.status).toBe(404)
  })
})

describe('POST /api/usuarios/senha/reset', () => {
  test('a senha passa a ser o proprio login, e o login com ela funciona', async () => {
    const { body } = await criar(NOVO)
    const antes = await hashNoBanco('ciclano')

    const res = await resetar([body.dados.uuid])
    expect(res.status).toBe(200)
    expect(res.body.dados.total).toBe(1)

    const depois = await hashNoBanco('ciclano')
    expect(depois.senha).not.toBe(antes.senha)

    // A prova de que o reset serve para alguma coisa: entrar com ela.
    const login = await request(app)
      .post('/api/login')
      .send({ usuario: 'ciclano', senha: 'ciclano', cliente: 'sca_web' }) // path-ok: fixture

    expect(login.status).toBe(201)
  })

  test('uuid inexistente na lista aborta o lote inteiro', async () => {
    const { body } = await criar(NOVO)
    const antes = await hashNoBanco('ciclano')

    const res = await resetar([
      body.dados.uuid,
      'c2eebc99-9c0b-4ef8-bb6d-6bb9bd380a33'
    ])

    expect(res.status).toBe(400)
    const depois = await hashNoBanco('ciclano')
    expect(depois.senha).toBe(antes.senha)
  })
})

describe('/api/usuarios/perfil (o proprio cadastro)', () => {
  const comoUsuario = () => generateUserToken()

  test('GET devolve os proprios dados, sem a senha', async () => {
    const res = await request(app)
      .get('/api/usuarios/perfil')
      .set('Authorization', comoUsuario())

    expect(res.status).toBe(200)
    expect(res.body.dados.uuid).toBe(USER_UUID)
    expect(res.body.dados).not.toHaveProperty('senha')
  })

  // '/perfil' e declarado ANTES de '/:uuid'. Sem essa ordem o Express casaria a
  // rota de administrador com 'perfil' no lugar do uuid, e quem nao e admin
  // levaria 403 numa tela que e dele.
  test('a rota nao e confundida com /:uuid, e nao exige administrador', async () => {
    const res = await request(app)
      .put('/api/usuarios/perfil')
      .set('Authorization', comoUsuario())
      .send({ nome: 'User Corrigido', nome_guerra: 'User', tipo_posto_grad_id: 7 })

    expect(res.status).toBe(200)

    const depois = await conn.one(
      'SELECT nome, tipo_posto_grad_id FROM dgeo.usuario WHERE uuid = $<uuid>',
      { uuid: USER_UUID }
    )
    expect(depois.nome).toBe('User Corrigido')
    expect(depois.tipo_posto_grad_id).toBe(7)
  })

  test('editar o proprio perfil nao promove ninguem a administrador', async () => {
    const res = await request(app)
      .put('/api/usuarios/perfil')
      .set('Authorization', comoUsuario())
      .send({
        nome: 'User',
        nome_guerra: 'User',
        tipo_posto_grad_id: 1,
        administrador: true
      })

    // 200, e nao 400: o `schema_validation` do SCA DESCARTA chave desconhecida
    // (o do modulo orcamento e que recusa, e a diferenca esta registrada no
    // CLAUDE.md). O que este teste guarda, entao, nao e a recusa: e que a chave
    // descartada nao chega ao UPDATE. O schema de `/perfil` nao tem
    // `administrador`, e e isso que impede a tela do proprio cadastro de virar
    // o caminho para alguem se promover.
    expect(res.status).toBe(200)

    const depois = await conn.one(
      'SELECT administrador FROM dgeo.usuario WHERE uuid = $<uuid>',
      { uuid: USER_UUID }
    )
    expect(depois.administrador).toBe(false)
  })

  test('trocar a senha exige a VIGENTE', async () => {
    const res = await request(app)
      .put('/api/usuarios/perfil/senha')
      .set('Authorization', comoUsuario())
      .send({ senha_atual: 'nao-e-essa', senha_nova: 'senha-nova' })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('Senha atual')
  })

  test('com a senha vigente certa, a nova passa a valer no login', async () => {
    // A semente nasce com a senha igual ao login (ver __tests__/setup.js).
    const res = await request(app)
      .put('/api/usuarios/perfil/senha')
      .set('Authorization', comoUsuario())
      .send({ senha_atual: 'test_user', senha_nova: 'senha-nova' })

    expect(res.status).toBe(200)

    const nova = await request(app)
      .post('/api/login')
      .send({ usuario: 'test_user', senha: 'senha-nova', cliente: 'sca_web' })
    expect(nova.status).toBe(201)

    const velha = await request(app)
      .post('/api/login')
      .send({ usuario: 'test_user', senha: 'test_user', cliente: 'sca_web' }) // path-ok: fixture
    expect(velha.status).toBe(400)
  })
})
