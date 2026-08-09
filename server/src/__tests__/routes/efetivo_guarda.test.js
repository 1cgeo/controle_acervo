'use strict'

// A GUARDA DO APROVEITAMENTO DO EFETIVO, depois da régua de 2026-08-08.
//
// A REGRA NOVA, que vale igual nos módulos: quem tem CONSULTA no módulo LÊ
// as telas do módulo, quem tem OPERADOR lança o que é dele, quem tem GERENTE
// responde pela área toda. Aqui ela moveu as rotas nos DOIS sentidos:
//
//   LEITURA DESCEU  `/mapa`, `/mes` e `/divergencias` eram de GERENTE;
//                   `/periodos` e `/impedimentos` eram de OPERADOR. Todas passam
//                   a pedir CONSULTA. Sem isso, ninguém conseguia OLHAR o
//                   aproveitamento da Divisão sem poder também escrevê-lo.
//   ESCRITA SUBIU   POST, PUT e DELETE de `/periodos` e `/impedimentos` eram de
//                   OPERADOR e passam a pedir GERENTE. Lançar a passagem e o
//                   impedimento DOS OUTROS é dado de pessoal alheio, nominal, e
//                   vira número assinado na 6.1 do RPCMTec.
//
// E A ROTA NOVA, `/militares`: o cadastro MÍNIMO de gente para a tela montar o
// seletor e nomear a divergência. Ela existe porque a tela pedia isso a
// `GET /api/usuarios`, que é `verifyAdmin`, no MESMO `Promise.all` das rotas
// daqui: o gerente do efetivo tomava 403 e a tela inteira morria dizendo que é
// preciso ser administrador.
//
// POR QUE ESTE ARQUIVO NÃO MOCKA O LOGIN: quem decide é o `verifyPerfil`, e ele
// lê o perfil do BANCO a cada requisição, e não do token. Dublar o login
// provaria que a rota chama uma função, e não que quem não tem o nível é
// barrado. Aqui o JWT é assinado e validado de verdade, e só o banco é dublê.
//
// O RECORTE DE CAMPO de `/militares` NÃO se prova aqui, e é de propósito: com o
// banco dublê a rota devolveria o que o dublê inventasse. Quem prova qual coluna
// sai é `pit_efetivo_permissao.test.js`, contra o banco de verdade.

const jwt = require('jsonwebtoken')
const request = require('supertest')

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))

const { buildTestApp } = require('../helpers/orcamento/testApp')
const { JWT_SECRET } = require('../../config')
const { efetivoRoute } = require('../../efetivo')

const UUID = '11111111-1111-1111-1111-111111111111'

// dominio.modulo: 5 é efetivo. O número está escrito aqui, e não importado de
// `verify_perfil.js`, porque importá-lo faria o teste concordar com o fonte
// mesmo se o fonte trocasse de módulo.
const MODULO_EFETIVO = 5

const PERFIL = { consulta: 1, operador: 2, gerente: 3 }

const app = buildTestApp([{ path: '/efetivo', router: efetivoRoute }])

const token = () =>
  'Bearer ' + jwt.sign({ id: 1, uuid: UUID }, JWT_SECRET, { expiresIn: '1h' })

// A ÚNICA leitura que o `verifyPerfil` faz: a linha do usuário ativo com o
// `perfil_id` daquele módulo (LEFT JOIN, então NULO é "não tem linha lá").
const quemEntra = ({ administrador = false, perfil = null } = {}) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce({
    id: 1,
    administrador,
    perfil_id: perfil
  })
}

// Todas as leituras da tela, com uma query que o Joi de cada uma aceita.
const LEITURAS = [
  ['/efetivo/militares'],
  ['/efetivo/mapa?ano=2026'],
  ['/efetivo/mes?ano=2026&mes=3'],
  ['/efetivo/divergencias?ano=2026&mes=3'],
  ['/efetivo/periodos?ano=2026'],
  ['/efetivo/impedimentos?ano=2026']
]

// As seis escritas. O corpo vai VAZIO de propósito: a guarda roda ANTES do
// `schemaValidation`, então o caso negativo reprova no 403 sem chegar ao Joi, e
// o positivo se contenta com "não foi 403".
const ESCRITAS = [
  ['post', '/efetivo/periodos'],
  ['put', '/efetivo/periodos/1'],
  ['delete', '/efetivo/periodos/1'],
  ['post', '/efetivo/impedimentos'],
  ['put', '/efetivo/impedimentos/1'],
  ['delete', '/efetivo/impedimentos/1']
]

beforeEach(() => mockDb.reset())

describe('Leitura do efetivo: CONSULTA basta', () => {
  test.each(LEITURAS)('GET %s aceita quem tem consulta', async (caminho) => {
    quemEntra({ administrador: false, perfil: PERFIL.consulta })

    const res = await request(app).get(caminho).set('Authorization', token())

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
  })

  test.each(LEITURAS)(
    'GET %s recusa quem está logado e não tem linha em Efetivo',
    async (caminho) => {
      quemEntra({ administrador: false, perfil: null })

      const res = await request(app).get(caminho).set('Authorization', token())

      expect(res.status).toBe(403)
      // A mensagem NOMEIA o nível e o módulo que faltaram. Sem checar o nome, um
      // 403 de outro middleware (ou do módulo errado, que é a armadilha do
      // default 'acervo' do verifyPerfil) satisfaria o caso.
      expect(res.body.message).toMatch(/perfil consulta no módulo efetivo/i)
    }
  )

  test.each(LEITURAS)(
    'GET %s aceita o administrador global, sem perfil de módulo nenhum',
    async (caminho) => {
      quemEntra({ administrador: true, perfil: null })

      const res = await request(app).get(caminho).set('Authorization', token())

      expect(res.status).toBe(200)
    }
  )

  test.each(LEITURAS)('GET %s sem token vira 401', async (caminho) => {
    const res = await request(app).get(caminho)

    expect(res.status).toBe(401)
  })

  // O COMPARTIMENTO é EFETIVO, e o 403 sozinho não prova isso: quem não tem
  // linha nenhuma e quem é gerente de outro módulo dão a MESMA resposta, porque
  // o LEFT JOIN por `modulo_id` devolve `perfil_id` nulo nos dois casos. O que
  // separa um do outro é o módulo que a consulta pergunta.
  test.each(LEITURAS)('GET %s pergunta pelo modulo_id 5', async (caminho) => {
    quemEntra({ administrador: false, perfil: PERFIL.consulta })

    await request(app).get(caminho).set('Authorization', token())

    expect(mockDb.conn.oneOrNone).toHaveBeenCalledWith(
      expect.stringContaining('dgeo.usuario_perfil'),
      { uuid: UUID, moduloId: MODULO_EFETIVO }
    )
  })
})

describe('Escrita do efetivo: o OPERADOR não lança mais o dos outros', () => {
  test.each(ESCRITAS)('%s %s recusa o operador', async (metodo, caminho) => {
    quemEntra({ administrador: false, perfil: PERFIL.operador })

    const res = await request(app)[metodo](caminho).set('Authorization', token())

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/perfil gerente no módulo efetivo/i)
  })

  test.each(ESCRITAS)('%s %s aceita o gerente', async (metodo, caminho) => {
    quemEntra({ administrador: false, perfil: PERFIL.gerente })

    const res = await request(app)[metodo](caminho).set('Authorization', token())

    expect(res.status).not.toBe(403)
  })
})

// A recusa acontece ANTES do controller tocar o banco. Provar pelo 403 não
// basta: um 403 vindo de outro middleware satisfaria o caso.
describe('A guarda barra antes de tocar o banco', () => {
  it('o operador não chega ao INSERT da passagem', async () => {
    quemEntra({ administrador: false, perfil: PERFIL.operador })

    const res = await request(app)
      .post('/efetivo/periodos')
      .set('Authorization', token())
      .send({ usuario_uuid: UUID, data_inicio: '2026-03-01' })

    expect(res.status).toBe(403)
    // `conn.tx` é como `criarPeriodo` abre a escrita. Nenhuma chamada significa
    // que a guarda parou a requisição antes dele.
    expect(mockDb.conn.tx).not.toHaveBeenCalled()
  })

  it('quem não tem perfil em Efetivo não chega à consulta dos militares', async () => {
    quemEntra({ administrador: false, perfil: null })

    const res = await request(app)
      .get('/efetivo/militares')
      .set('Authorization', token())

    expect(res.status).toBe(403)
    expect(mockDb.conn.any).not.toHaveBeenCalled()
  })
})

// A ORDEM da lista é a HIERARQUIA, e ela sai da consulta, não do cliente: o
// seletor de militar fica ao lado do mapa, que já vem ordenado assim, e duas
// ordens diferentes na mesma tela leem-se como lista errada.
describe('A lista de militares sai na ordem do posto', () => {
  it('ordena por posto decrescente e depois por nome de guerra', async () => {
    quemEntra({ administrador: false, perfil: PERFIL.consulta })

    await request(app).get('/efetivo/militares').set('Authorization', token())

    const [sql] = mockDb.conn.any.mock.calls[0]
    expect(sql).toMatch(/ORDER BY u\.tipo_posto_grad_id DESC, u\.nome_guerra/)
  })
})

// ---------------------------------------------------------------------------
// LANÇAR PELO OUTRO: o caso que a régua nova põe no gerente, e que uma trava de
// plataforma barrava desde antes dela.
//
// `login/verify_perfil.js` recusava com 401 quem não fosse administrador global
// e mandasse um `usuario_uuid` diferente do próprio, em params, body ou query.
// A trava lia um NOME DE CAMPO e concluía "isto é o registro dele"; nas duas
// rotas que carregam esse campo, ele é o MILITAR ALVO. O efeito era que só o
// administrador global lançava passagem e impedimento de terceiro -- ou seja,
// justamente o trabalho que passou a ser do gerente do efetivo.
//
// A trava saiu em 2026-08-08. Estes casos existem para ela não voltar: os do
// bloco de escrita acima mandam corpo VAZIO, e por isso nunca a exercitaram (a
// guarda reprovava antes do Joi, e o 403 do perfil escondia o 401 dela).
// ---------------------------------------------------------------------------
describe('O gerente lança a passagem de OUTRA pessoa', () => {
  const OUTRO = '22222222-2222-2222-2222-222222222222'

  it('não leva 401 de "própria informação" ao mandar o uuid alheio', async () => {
    quemEntra({ administrador: false, perfil: PERFIL.gerente })

    const res = await request(app)
      .post('/efetivo/periodos')
      .set('Authorization', token())
      .send({ usuario_uuid: OUTRO, data_inicio: '2026-03-01' })

    // O que se prova é a AUSÊNCIA da recusa da trava. O 201 não se exige aqui:
    // o banco é dublê, e o INSERT devolveria o que o dublê inventasse.
    expect(res.status).not.toBe(401)
    expect(String(res.body.message || '')).not.toMatch(/própria informação/i)
  })

  it('o mesmo vale para o impedimento', async () => {
    quemEntra({ administrador: false, perfil: PERFIL.gerente })

    const res = await request(app)
      .post('/efetivo/impedimentos')
      .set('Authorization', token())
      .send({
        usuario_uuid: OUTRO,
        descricao: 'Curso fora da Divisão',
        percentual: 50,
        data_inicio: '2026-03-01'
      })

    expect(res.status).not.toBe(401)
    expect(String(res.body.message || '')).not.toMatch(/própria informação/i)
  })

  // O outro lado: sem o perfil, o uuid alheio continua barrado -- só que pelo
  // PERFIL, que é quem tem de barrar, e com 403 em vez de 401.
  it('quem não é gerente continua barrado, pelo perfil e não pela trava', async () => {
    quemEntra({ administrador: false, perfil: PERFIL.operador })

    const res = await request(app)
      .post('/efetivo/periodos')
      .set('Authorization', token())
      .send({ usuario_uuid: OUTRO, data_inicio: '2026-03-01' })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/perfil gerente no módulo efetivo/i)
  })
})
