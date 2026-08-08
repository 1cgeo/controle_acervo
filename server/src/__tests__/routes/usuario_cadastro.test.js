'use strict'

// Cadastro de usuario e senha, pela API.
//
// O SCA passou a ser o dono da identidade. Ate ali `dgeo.usuario`
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
const {
  generateAdminToken, generateUserToken, ADMIN_UUID, USER_UUID
} = require('../helpers/auth')

// Os TRES roteadores da plataforma entram na mesma varredura, no fim do arquivo.
const usuarioRouter = require('../../usuario/usuario_route')
const { pitRoute } = require('../../pit')
const rpcmtecRouter = require('../../rpcmtec/rpcmtec_route')
const { efetivoRoute } = require('../../efetivo')

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

// Le o que foi GRAVADO, e nao o que a rota de historico apresenta: o que estes
// casos guardam e a linha de rastro, e a formatacao dela tem teste proprio.
const eventos = (tabela, entidadeId) =>
  conn.any(
    `SELECT * FROM auditoria.evento
     WHERE tabela = $<tabela> AND entidade_id = $<entidadeId>
     ORDER BY id`,
    { tabela, entidadeId }
  )

const umEventoDe = async (tabela, entidadeId, operacao) => {
  const achados = (await eventos(tabela, entidadeId)).filter(
    e => e.operacao === operacao
  )
  expect(achados).toHaveLength(1)
  return achados[0]
}

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

// ---------------------------------------------------------------------------
// Rastreabilidade (auditoria.evento)
//
// E o grupo mais sensivel do sistema: promover alguem a administrador global
// sem rastro deixa "quem concedeu" sem resposta. O `req.usuarioUuid` existe em
// toda rota desta feature, e o que se cobra aqui e que ele CHEGUE ao
// controller.
// ---------------------------------------------------------------------------

describe('Rastreabilidade: a senha nunca entra no rastro', () => {
  // O caso mais importante do arquivo, e o unico que causa dano se falhar em
  // silencio: um vazamento aqui poria uma SEGUNDA copia do hash bcrypt numa
  // tabela que ninguem pensa como guardadora de credencial. Os TRES caminhos que
  // gravam hash sao cobrados um a um, porque cada um monta o evento por conta
  // propria e o `omitir` do mapa e a unica rede comum.
  test('POST /usuarios: o hash nao aparece no evento de criacao', async () => {
    const { body } = await criar(NOVO)
    const { senha } = await hashNoBanco('ciclano')

    const criacao = await umEventoDe('dgeo.usuario', body.dados.uuid, 'I')

    expect(criacao.dados_depois).toHaveProperty('senha')
    expect(criacao.dados_depois.senha).toBeNull()
    // A prova forte: o hash de verdade, procurado no evento inteiro. Uma
    // assercao so sobre a chave `senha` passaria se o valor vazasse por outra.
    expect(JSON.stringify(criacao)).not.toContain(senha)
    expect(JSON.stringify(criacao)).not.toContain('senha-inicial')
  })

  test('POST /senha/reset: o evento diz que mudou, e nao para que', async () => {
    const { body } = await criar(NOVO)
    const antes = await hashNoBanco('ciclano')

    await resetar([body.dados.uuid])
    const depois = await hashNoBanco('ciclano')

    const reset = await umEventoDe('dgeo.usuario', body.dados.uuid, 'U')

    // O diff roda sobre a linha CRUA e a sanitizacao vem depois: e isso que faz
    // a troca de senha aparecer como a mudanca que ela e, com os dois valores
    // nulos. Sanitizar antes apagaria a mudanca, porque nulo comparado a nulo
    // nao acusa nada.
    expect(reset.campos_alterados).toEqual(['senha'])
    expect(reset.dados_antes.senha).toBeNull()
    expect(reset.dados_depois.senha).toBeNull()
    expect(JSON.stringify(reset)).not.toContain(antes.senha)
    expect(JSON.stringify(reset)).not.toContain(depois.senha)
  })

  test('PUT /perfil/senha faz o mesmo, e o autor e o proprio', async () => {
    const res = await request(app)
      .put('/api/usuarios/perfil/senha')
      .set('Authorization', generateUserToken())
      .send({ senha_atual: 'test_user', senha_nova: 'senha-nova' })
    expect(res.status).toBe(200)

    const { senha } = await conn.one(
      'SELECT senha FROM dgeo.usuario WHERE uuid = $<uuid>', { uuid: USER_UUID }
    )

    const troca = await umEventoDe('dgeo.usuario', USER_UUID, 'U')

    expect(troca.campos_alterados).toEqual(['senha'])
    expect(troca.dados_antes.senha).toBeNull()
    expect(troca.dados_depois.senha).toBeNull()
    expect(JSON.stringify(troca)).not.toContain(senha)
    expect(JSON.stringify(troca)).not.toContain('senha-nova')
    // Trocar a PROPRIA senha e o unico caso em que autor e alvo sao a mesma
    // pessoa, e e o que separa "eu troquei" de "o administrador resetou".
    expect(troca.usuario_uuid).toBe(USER_UUID)
    expect(troca.entidade_id).toBe(USER_UUID)
  })
})

describe('Rastreabilidade: o cadastro do usuario', () => {
  test('promover a administrador registra o AUTOR, e nao o alvo', async () => {
    const { body } = await criar(NOVO)
    const uuid = body.dados.uuid

    const res = await atualizar(uuid, { administrador: true, ativo: true })
    expect(res.status).toBe(200)

    const promocao = await umEventoDe('dgeo.usuario', uuid, 'U')

    // A pergunta que so o evento responde: quem promoveu.
    expect(promocao.usuario_uuid).toBe(ADMIN_UUID)
    expect(promocao.entidade_id).toBe(uuid)
    expect(promocao.modulo).toBe('plataforma')
    expect(promocao.entidade).toBe('usuario')
    expect(promocao.campos_alterados).toEqual(['administrador'])
    expect(promocao.dados_antes.administrador).toBe(false)
    expect(promocao.dados_depois.administrador).toBe(true)
  })

  test('a rota diz por onde a mudanca entrou', async () => {
    const { body } = await criar(NOVO)

    const criacao = await umEventoDe('dgeo.usuario', body.dados.uuid, 'I')

    expect(criacao.rota).toBe('POST /api/usuarios/')
    expect(criacao.lote_id).toEqual(expect.any(String))
  })

  test('a exclusao registra o que se perdeu, e sobrevive a pessoa', async () => {
    const { body } = await criar({ ...NOVO, perfis: { acervo: 2 } })
    const uuid = body.dados.uuid

    expect((await excluir(uuid)).status).toBe(200)

    const exclusao = await umEventoDe('dgeo.usuario', uuid, 'D')

    // A tabela nao tem chave estrangeira para dgeo.usuario justamente para isto:
    // a exclusao e o evento que o rastro existe para guardar, e ele nao pode
    // cair junto com a pessoa.
    expect(exclusao.dados_depois).toBeNull()
    expect(exclusao.dados_antes.login).toBe('ciclano')
    expect(exclusao.dados_antes.senha).toBeNull()
    expect(exclusao.usuario_uuid).toBe(ADMIN_UUID)

    // O perfil cai por CASCADE, sem DELETE explicito: sem evento proprio,
    // "era operador do acervo quando foi apagada" sumiria sem deixar nada.
    const doPerfil = await umEventoDe('dgeo.usuario_perfil', uuid, 'D')
    expect(doPerfil.dados_antes.perfil_id).toBe(2)
  })

  test('a alteracao em lote grava um evento por pessoa, com lote_id comum', async () => {
    const primeiro = (await criar(NOVO)).body.dados.uuid
    const segundo = (await criar({ ...NOVO, login: 'beltrano' })).body.dados.uuid

    const res = await request(app)
      .put('/api/usuarios')
      .set('Authorization', admin())
      .send({
        usuarios: [
          { uuid: primeiro, administrador: false, ativo: false },
          { uuid: segundo, administrador: false, ativo: false }
        ]
      })
    expect(res.status).toBe(200)

    const um = await umEventoDe('dgeo.usuario', primeiro, 'U')
    const outro = await umEventoDe('dgeo.usuario', segundo, 'U')

    expect(um.campos_alterados).toEqual(['ativo'])
    expect(outro.campos_alterados).toEqual(['ativo'])
    // Sem o lote, N eventos soltos: ninguem saberia que foram um ato so.
    expect(um.lote_id).toBe(outro.lote_id)
    expect(um.lote_id).not.toBeNull()
  })

  test('quando a escrita falha, o rastro cai junto', async () => {
    await criar(NOVO)
    const contagem = async () => {
      const { n } = await conn.one(
        "SELECT COUNT(*)::integer AS n FROM auditoria.evento WHERE tabela = 'dgeo.usuario'"
      )
      return n
    }
    expect(await contagem()).toBe(1)

    // Login repetido: o INSERT falha depois de a transacao ter comecado.
    expect((await criar({ ...NOVO, nome: 'Outra Pessoa' })).status).toBe(400)

    // Uma trilha que sobrevive a operacao desfeita e pior do que trilha nenhuma,
    // porque quem a le acredita nela.
    expect(await contagem()).toBe(1)
  })

  test('editar o proprio cadastro registra o proprio como autor', async () => {
    const res = await request(app)
      .put('/api/usuarios/perfil')
      .set('Authorization', generateUserToken())
      .send({ nome: 'User Corrigido', nome_guerra: 'User', tipo_posto_grad_id: 7 })
    expect(res.status).toBe(200)

    const evento = await umEventoDe('dgeo.usuario', USER_UUID, 'U')

    expect(evento.usuario_uuid).toBe(USER_UUID)
    expect(evento.campos_alterados.sort()).toEqual(['nome', 'tipo_posto_grad_id'])
  })
})

describe('Rastreabilidade: a concessao de perfil', () => {
  // `gravaPerfis` e a unica funcao que escreve dgeo.usuario_perfil, e ela e um
  // upsert com DELETE no ramo do nulo: nos dois caminhos o valor anterior era
  // destruido sem nunca ser lido. Um RETURNING nao resolveria, porque o upsert
  // devolve o valor NOVO. O `test_user` da semente nasce com acervo=consulta(1)
  // e mapoteca=operador(2).
  const comoPerfis = perfis =>
    atualizar(USER_UUID, { administrador: false, ativo: true, perfis })

  test('subir o perfil registra o valor ANTERIOR', async () => {
    expect((await comoPerfis({ acervo: 3 })).status).toBe(200)

    const evento = await umEventoDe('dgeo.usuario_perfil', USER_UUID, 'U')

    expect(evento.dados_antes.perfil_id).toBe(1)
    expect(evento.dados_depois.perfil_id).toBe(3)
    expect(evento.campos_alterados).toEqual(['perfil_id'])
    // O agregado do perfil e o USUARIO, e o salto e de tipo: a tabela aponta o
    // `id` serial e a ficha e pelo uuid. Sem a resolucao, o evento nao apareceria
    // em ficha nenhuma.
    expect(evento.entidade).toBe('usuario')
    expect(evento.entidade_id).toBe(USER_UUID)
    expect(evento.usuario_uuid).toBe(ADMIN_UUID)
  })

  test('revogar o modulo registra o que a pessoa tinha', async () => {
    expect((await comoPerfis({ mapoteca: null })).status).toBe(200)

    const evento = await umEventoDe('dgeo.usuario_perfil', USER_UUID, 'D')

    expect(evento.dados_antes.perfil_id).toBe(2)
    expect(evento.dados_antes.modulo_id).toBe(2)
    // Revogar e o caso em que o rastro e a UNICA memoria: a linha some, e sem
    // ela nada no banco diz que a pessoa ja teve acesso ao modulo.
    expect(evento.dados_depois).toBeNull()
  })

  // Este caso NAO usa o `test_user` da semente, e a razao e a rede do
  // `cleanTestData`: ela restaura os DOIS modulos que a semente tem (acervo e
  // mapoteca) e nao sabe apagar um terceiro. Concedendo orcamento ao usuario da
  // semente, a linha sobreviveria a limpeza e o caso seguinte revogaria um
  // perfil que ele acreditava nao existir. Num usuario criado aqui, o perfil cai
  // junto com a pessoa.
  test('conceder modulo novo registra a concessao', async () => {
    const { body } = await criar(NOVO)
    const uuid = body.dados.uuid

    const res = await atualizar(uuid, {
      administrador: false, ativo: true, perfis: { orcamento: 2 }
    })
    expect(res.status).toBe(200)

    const evento = await umEventoDe('dgeo.usuario_perfil', uuid, 'I')

    expect(evento.dados_antes).toBeNull()
    expect(evento.dados_depois.perfil_id).toBe(2)
    expect(evento.dados_depois.modulo_id).toBe(3)
  })

  test('a AUSENCIA do modulo no corpo nao e revogacao', async () => {
    // `gravaPerfis` e incremental: mexer no acervo nao pode virar um evento de
    // revogacao da mapoteca, que o corpo nem mencionou.
    expect((await comoPerfis({ acervo: 3 })).status).toBe(200)

    const todos = await eventos('dgeo.usuario_perfil', USER_UUID)
    expect(todos).toHaveLength(1)
    expect(todos[0].dados_antes.modulo_id).toBe(1)
  })

  test('reenviar o MESMO nivel nao inventa evento', async () => {
    // A tela manda o mapa inteiro de perfis a cada "Salvar". Sem esta regra,
    // cada salvamento deixaria uma linha por modulo com o diff vazio dentro, e a
    // ficha viraria ruido.
    expect((await comoPerfis({ acervo: 1, mapoteca: 2 })).status).toBe(200)

    expect(await eventos('dgeo.usuario_perfil', USER_UUID)).toHaveLength(0)
  })

  test('revogar o que a pessoa nao tem nao inventa evento', async () => {
    expect((await comoPerfis({ orcamento: null })).status).toBe(200)

    expect(await eventos('dgeo.usuario_perfil', USER_UUID)).toHaveLength(0)
  })
})

describe('Rastreabilidade: o historico chega pela rota', () => {
  const historico = (uuid, token = admin()) =>
    request(app)
      .get(`/api/auditoria/plataforma/usuario/${uuid}`)
      .set('Authorization', token)

  test('a ficha do usuario junta o cadastro e o perfil', async () => {
    const { body } = await criar({ ...NOVO, perfis: { acervo: 1 } })
    const uuid = body.dados.uuid
    await atualizar(uuid, { administrador: true, ativo: true, perfis: { acervo: 3 } })

    const res = await historico(uuid)
    expect(res.status).toBe(200)

    const tabelas = res.body.dados.map(e => e.tabela)
    expect(tabelas).toContain('dgeo.usuario')
    expect(tabelas).toContain('dgeo.usuario_perfil')

    // O diff sai PRONTO do servidor, com o dominio traduzido: o cliente nao
    // carrega catalogo nenhum.
    const doPerfil = res.body.dados.find(e => e.tabela === 'dgeo.usuario_perfil')
    const mudanca = doPerfil.mudancas.find(m => m.campo === 'perfil_id')
    expect(mudanca.rotulo).toBe('Perfil')
    expect(mudanca.antes_texto).toContain('(1)')
    expect(mudanca.depois_texto).toContain('(3)')
  })

  test('o historico da plataforma e do administrador global', async () => {
    // Aqui moram os eventos de usuario, de perfil e de senha. Quem ve a tela que
    // os origina (#/usuarios) e o administrador, e so ele ve o historico deles.
    const res = await historico(USER_UUID, generateUserToken())
    expect(res.status).toBe(403)
  })
})

// ---------------------------------------------------------------------------
// A varredura das rotas de escrita da PLATAFORMA
//
// Este arquivo e a troca por nao usar gatilho de banco: a insercao do rastro
// mora no backend, porque o gatilho nao conhece o usuario da sessao HTTP. O
// preco dessa escolha e a rota nova que esquece de auditar, e quem cobra o preco
// e esta varredura, que le o router DE VERDADE.
//
// Os TRES roteadores entram juntos porque a plataforma e um grupo so: usuario,
// meta do PIT e edicao do RPCMTec nao sao de modulo nenhum, e todos gravam sob
// `modulo = 'plataforma'`. Uma varredura por arquivo seriam tres copias do mesmo
// laco, e a terceira copia e onde a divergencia nasce.
// ---------------------------------------------------------------------------

const METODOS_DE_ESCRITA = ['post', 'put', 'patch', 'delete']

const rotasDeEscrita = (prefixo, router) => {
  expect(Array.isArray(router.stack)).toBe(true)

  const chaves = []
  for (const camada of router.stack) {
    if (!camada.route) continue
    for (const metodo of METODOS_DE_ESCRITA) {
      if (camada.route.methods[metodo]) {
        chaves.push(`${metodo.toUpperCase()} ${prefixo}${camada.route.path}`)
      }
    }
  }
  return chaves
}

// Chave igual a que o laco acima monta. Rota nova sem auditoria cai no teste
// abaixo: para consertar, audite a rota e acrescente a chave aqui.
const COBERTAS = new Set([
  'POST /usuarios/',
  'PUT /usuarios/',
  'PUT /usuarios/:uuid',
  'DELETE /usuarios/:uuid',
  'POST /usuarios/senha/reset',
  'PUT /usuarios/perfil',
  'PUT /usuarios/perfil/senha',
  'POST /metas/',
  'PUT /metas/:id',
  'DELETE /metas/:id',
  // Execucao mensal e Extra-PIT, absorvidos do SAP. O POST de
  // execucao e UMA rota para criar e alterar, porque o par (meta, mes) e uma
  // CELULA de grade; quem separa a insercao da alteracao e o controller, e so
  // para o rastro dizer "lancou 12" contra "trocou 12 por 30".
  'POST /metas/execucao',
  'DELETE /metas/execucao/:id',
  'POST /metas/extra',
  'PUT /metas/extra/:id',
  'DELETE /metas/extra/:id',
  // De-para da MIDIA impressa para a meta, por ano. E a fonte da
  // meta 4 quando ela for automatica. Auditado no agregado da META, e nao no
  // dele proprio: a pergunta que se faz deste dado e "por que a 4.1 passou a
  // contar sulfite", e ela se faz na ficha da meta.
  // Exercicio e REVISAO do PIT. A DSG revisa o plano durante a
  // execucao, e alterar o PIT e cancelar, alterar e adicionar meta: as tres
  // caem em `pit.meta_item_revisao`, dentro da revisao aberta.
  //
  // O exercicio e a revisao sao auditados no agregado do EXERCICIO, e a linha de
  // declaracao no da META: a pergunta "o que mudou no PIT de 2026" e diferente
  // de "por que a 4.2 virou 252", e cada uma se faz numa tela.
  'POST /metas/exercicios',
  'PUT /metas/exercicios/:ano',
  'POST /metas/revisoes',
  'PUT /metas/revisoes/:revisaoId',
  'DELETE /metas/revisoes/:revisaoId',
  // PUBLICAR e o ato que faz a revisao passar a reger, e por isso e rota
  // propria: ele nao muda o que a revisao diz, muda desde quando ela vale.
  'POST /metas/revisoes/:revisaoId/publicar',
  // REMOVER a declaracao de uma meta do RASCUNHO. Rota propria porque nao e
  // alterar a revisao: e desfazer o acrescimo de uma meta a ela. So no
  // rascunho, e o evento cai no agregado da META.
  'DELETE /metas/revisoes/:revisaoId/meta/:metaId',
  'POST /metas/revisoes/:revisaoId/anexos',
  'DELETE /metas/revisoes/anexo/:anexoId',
  // CORRIGIR TRANSCRICAO, e nao alterar o PIT. Rota separada de propósito: quem
  // digitou 53 onde o documento diz 35 nao pode precisar inventar uma revisao
  // que a DSG nao emitiu, e o motivo e obrigatorio para separar as duas.
  'PUT /metas/:id/transcricao',
  'POST /rpcmtec/',
  'PUT /rpcmtec/:id',
  'DELETE /rpcmtec/:id',
  // FECHAR e REABRIR sao rotas proprias porque sao ATOS, e nao a gravacao de um
  // campo: fechar congela os blocos do documento que o chefe assina, e reabrir
  // descongela. Os dois caem no agregado da EDICAO, que e onde se pergunta
  // "quem reabriu a de julho".
  'POST /rpcmtec/:id/fechar',
  'POST /rpcmtec/:id/reabrir',
  // O conteudo digitado. Auditado tambem no agregado da EDICAO: a pergunta e
  // "quem mudou a 7.1 de julho", e ela se faz na ficha da edicao.
  'PUT /rpcmtec/:id/subsecao/:numero',
  'DELETE /rpcmtec/:id/subsecao/:numero',
  // A CONFERENCIA por subsecao (1.36.0). Ela e auditada no mesmo agregado da
  // edicao, e o rastro aqui e o que sobrevive ao DESMARCAR: a marca e uma linha
  // so, e desmarcar a APAGA. Sem o evento, "conferido e depois desconferido"
  // ficaria indistinguivel de "nunca conferido".
  'PUT /rpcmtec/:id/subsecao/:numero/revisao',
  // A IMPORTACAO do CSV do github_dashboard para a 5.1. Ela nao grava o corpo
  // que recebeu: le o CSV, cruza com a tabela e decide o que muda, preservando
  // o Resumo escrito a mao. Auditada no agregado da EDICAO, como o resto do
  // conteudo digitado, e o rastro guarda a linha ANTERIOR inteira -- que e o
  // unico lugar onde o Resumo de um repositorio removido sobrevive.
  'POST /rpcmtec/:id/subsecao/5.1/importar',
  // ESTA LISTA CAIU DE 51 PARA 50 CHAVES EM 2026-08-06, e voltou a 51 no mesmo
  // dia com a importacao do CSV acima. A troca nao e simetria: saiu a rota que
  // trazia o mes ANTERIOR e entrou a que traz o mes CORRENTE de uma fonte
  // primaria. Saiu daqui a rota que
  // trazia o digitado da edicao anterior, junto com a rota, o schema e o
  // controlador que a serviam. O RPCMTec e o relatorio DAQUELE mes: a linha que
  // chega pronta nao e relida, e o documento assinado passava a afirmar sobre
  // agosto o que aconteceu em julho. Quem prova a ausencia e
  // routes/rpcmtec_sem_copia.test.js, que exercita o 404.
  // O RPCMTec ASSINADO, em PDF. E a fonte primaria da edicao: o congelado tem
  // de dizer o que ele diz.
  'POST /rpcmtec/:id/anexos',
  'DELETE /rpcmtec/anexo/:anexoId',
  // Capacitacao (2.6 e 6.2), absorvida do SAP. DUAS rotas desde a 1.33.0, uma
  // por tipo: a MINISTRADA e do operador de Producao e a RECEBIDA e do operador
  // de Efetivo, e a guarda de rota nao enxerga o `tipo_id` no corpo. A tabela
  // continua uma, e as seis escritas caem no agregado da CAPACITACAO.
  'POST /rpcmtec/capacitacao/ministrada',
  'PUT /rpcmtec/capacitacao/ministrada/:id',
  'DELETE /rpcmtec/capacitacao/ministrada/:id',
  'POST /rpcmtec/capacitacao/recebida',
  'PUT /rpcmtec/capacitacao/recebida/:id',
  'DELETE /rpcmtec/capacitacao/recebida/:id',
  // Efetivo por INTERVALO. Ele nasceu sob /rpcmtec como retrato mensal e mudou
  // para /efetivo no mesmo dia: "quem esteve na Divisao" nao existe por causa do
  // relatorio, e o relatorio e um leitor. As duas tabelas sao auditadas no
  // agregado da PESSOA, entao a passagem e o impedimento aparecem na ficha dela.
  'POST /efetivo/periodos',
  'PUT /efetivo/periodos/:id',
  'DELETE /efetivo/periodos/:id',
  'POST /efetivo/impedimentos',
  'PUT /efetivo/impedimentos/:id',
  'DELETE /efetivo/impedimentos/:id',
  // O PROPRIO aproveitamento, desde 2026-08-08. Mesmas duas tabelas, mesmo
  // agregado (a PESSOA) e mesmo controlador: o que muda e a guarda
  // (`verifyAcesso`, e nao gerente no modulo Efetivo) e de onde sai o dono, que
  // aqui e SEMPRE o token. Elas existem porque a escrita das seis de cima subiu
  // para o gerente, e sem uma porta do proprio ninguem abaixo dele declararia o
  // proprio impedimento.
  //
  // O RASTRO E O MESMO, e e de proposito: a ficha da pessoa nao distingue "o
  // gerente lancou por mim" de "eu lancei", e quem lancou esta no
  // `usuario_uuid` do evento.
  'POST /efetivo/meu_periodo',
  'PUT /efetivo/meu_periodo/:id',
  'DELETE /efetivo/meu_periodo/:id',
  'POST /efetivo/meu_impedimento',
  'PUT /efetivo/meu_impedimento/:id',
  'DELETE /efetivo/meu_impedimento/:id',

  // O vinculo Extra-PIT x acervo. As duas gravam em acervo.versao
  // (demanda_extra_id) e registram o evento, cada uma no seu controlador.
  'POST /metas/extra/:id/versoes',
  'DELETE /metas/extra/:id/versoes/:versao_id',

  // A DECLARACAO da meta dentro de uma revisao, que e por onde o PIT passa a
  // ser alterado. O rastro sai de gravarDeclaracao, e nao da funcao de rota:
  // a que a rota chama delega, e o registro mora no gravador comum.
  'PUT /metas/revisoes/:revisaoId/meta/:metaId'
])

describe('Rastreabilidade: varredura das rotas de escrita da plataforma', () => {
  test('toda rota de escrita de usuario, meta, edicao e efetivo esta coberta', () => {
    const encontradas = [
      ...rotasDeEscrita('/usuarios', usuarioRouter),
      ...rotasDeEscrita('/metas', pitRoute),
      ...rotasDeEscrita('/rpcmtec', rpcmtecRouter),
      ...rotasDeEscrita('/efetivo', efetivoRoute)
    ]

    // Rede contra o falso verde: se o formato do router mudar e a extracao
    // devolver lista vazia, o teste passaria sem cobrar nada.
    expect(encontradas.length).toBe(COBERTAS.size)

    const descobertas = encontradas.filter(r => !COBERTAS.has(r))
    expect(descobertas).toEqual([])

    // O caminho inverso: chave que nao existe mais no router.
    const orfas = [...COBERTAS].filter(r => !encontradas.includes(r))
    expect(orfas).toEqual([])
  })
})
