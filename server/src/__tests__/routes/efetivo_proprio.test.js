'use strict'

// O PRÓPRIO APROVEITAMENTO: `/efetivo/meu_periodo` e `/efetivo/meu_impedimento`.
//
// POR QUE ESTAS ROTAS EXISTEM. Em 2026-08-08 a escrita da passagem e do
// impedimento DOS OUTROS subiu para `verifyPerfil('gerente','efetivo')` e a tela
// `#/aproveitamento` deixou de abrir para o operador. Sem uma porta do PRÓPRIO,
// ninguém abaixo do gerente teria como declarar o próprio impedimento, e o
// aproveitamento da subseção 6.1 do RPCMTec depende de cada um declarar o seu.
//
// O QUE ESTE ARQUIVO PROVA, e é a razão de ele ser separado do
// `efetivo_guarda.test.js`: lá se prova QUEM entra; aqui se prova que quem entrou
// só alcança o registro DELE. As duas coisas falham de jeitos diferentes, e a
// segunda falha em silêncio -- uma rota que autorize pelo `:id` sozinho responde
// 200 e grava, e nada na resposta acusa de quem era a linha.
//
// AS TRÊS PROPRIEDADES, uma por bloco abaixo:
//
//   1. O DONO SAI DO TOKEN, nunca do pedido. `usuario_uuid` no corpo é chave
//      desconhecida, e o que vai para o INSERT é `req.usuarioUuid`.
//   2. O `:id` NÃO AUTORIZA SOZINHO. PUT e DELETE conferem que a linha é da
//      pessoa do token antes de tocá-la, dentro da mesma transação da escrita.
//   3. A RECUSA É 404, e não 403. O 403 confirmaria que a linha existe, e a
//      resposta viraria um oráculo de "quantas passagens a Divisão tem". A
//      mensagem é a mesma de um id inexistente, de propósito.
//
// POR QUE ESTE ARQUIVO NÃO MOCKA O LOGIN: o JWT é assinado e validado de
// verdade, e só o banco é dublê. Dublar a guarda provaria que a rota chama uma
// função, e não que a pessoa errada é barrada.
//
// O CONTROLE ESTÁ NO ÚLTIMO BLOCO: a rota de TERCEIRO continua autorizando pelo
// `:id` sozinho, e deve. Sem ele, apertar a conferência a ponto de quebrar o
// trabalho do gerente do efetivo passaria por aprovação.

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

// EU e O OUTRO. O uuid do token é sempre o primeiro; o segundo só aparece como
// dono de linha alheia ou como contrabando no corpo.
const EU = '11111111-1111-1111-1111-111111111111'
const OUTRO = '22222222-2222-2222-2222-222222222222'

const PERFIL = { consulta: 1, operador: 2, gerente: 3 }

const app = buildTestApp([{ path: '/efetivo', router: efetivoRoute }])

const token = () =>
  'Bearer ' + jwt.sign({ id: 1, uuid: EU }, JWT_SECRET, { expiresIn: '1h' })

/**
 * As DUAS leituras do `verifyAcesso`, na ordem em que ele as faz: a linha do
 * usuário ativo e o EXISTS de perfil em algum módulo.
 *
 * O administrador global curto-circuita a segunda, e por isso ela só é dublada
 * quando ele não é.
 */
const entra = ({ administrador = false, temAcesso = true } = {}) => {
  mockDb.conn.oneOrNone.mockResolvedValueOnce({ id: 1, administrador })
  if (!administrador) mockDb.conn.one.mockResolvedValueOnce({ temAcesso })
}

/** A linha que o `auditoriaCtrl.lerAntes` traz, com o dono que o caso quiser. */
const linhaDe = (dono, extra = {}) =>
  mockDb.conn.oneOrNone.mockResolvedValueOnce({
    id: 1,
    usuario_uuid: dono,
    data_inicio: '2026-03-01',
    data_fim: null,
    ...extra
  })

/**
 * O retorno do INSERT/UPDATE. Precisa carregar `usuario_uuid` porque o mapa de
 * auditoria resolve o agregado a partir dele: sem isso a escrita falharia por
 * "agregado nao resolvido", e o caso passaria a provar outra coisa.
 */
const gravou = (dono) =>
  mockDb.conn.one.mockResolvedValueOnce({ id: 1, usuario_uuid: dono })

/** Os parâmetros nomeados do INSERT/UPDATE que o controlador executou. */
const paramsDaEscrita = () => {
  const chamada = mockDb.conn.one.mock.calls.find(
    ([sql]) => typeof sql === 'string' && /INSERT INTO|UPDATE/.test(sql)
  )
  return chamada ? chamada[1] : null
}

const houveEscrita = () =>
  mockDb.conn.one.mock.calls.some(
    ([sql]) => typeof sql === 'string' && /INSERT INTO|UPDATE/.test(sql)
  )

const houveDelete = () =>
  mockDb.conn.none.mock.calls.some(
    ([sql]) => typeof sql === 'string' && /^DELETE FROM/.test(String(sql).trim())
  )

beforeEach(() => mockDb.reset())

// ---------------------------------------------------------------------------
// A GUARDA: `verifyAcesso`, e não `verifyPerfil` no módulo Efetivo.
//
// Declarar a própria passagem não é trabalho DO MÓDULO Efetivo: é obrigação de
// quem está na Divisão. Quem trabalha só no acervo tem de cumpri-la sem ganhar
// linha em `dgeo.usuario_perfil` de um módulo em que não mexe.
// ---------------------------------------------------------------------------
const ROTAS_DO_PROPRIO = [
  // SEM `?ano=`, e de propósito: a guarda corre ANTES do `schemaValidation`, e é
  // isso que estes casos leem. Se a ordem dos middlewares se invertesse, a rota
  // passaria a responder 400 a quem nem entrou, e o 403 sumiria daqui.
  ['get', '/efetivo/meu_aproveitamento'],
  ['get', '/efetivo/meu_periodo'],
  ['post', '/efetivo/meu_periodo'],
  ['put', '/efetivo/meu_periodo/1'],
  ['delete', '/efetivo/meu_periodo/1'],
  ['get', '/efetivo/meu_impedimento'],
  ['post', '/efetivo/meu_impedimento'],
  ['put', '/efetivo/meu_impedimento/1'],
  ['delete', '/efetivo/meu_impedimento/1']
]

describe('As rotas do próprio pedem ACESSO ao sistema, e não perfil em Efetivo', () => {
  test.each(ROTAS_DO_PROPRIO)('%s %s sem token vira 401', async (metodo, caminho) => {
    const res = await request(app)[metodo](caminho)

    expect(res.status).toBe(401)
  })

  test.each(ROTAS_DO_PROPRIO)(
    '%s %s recusa quem não tem perfil em módulo NENHUM',
    async (metodo, caminho) => {
      entra({ temAcesso: false })

      const res = await request(app)[metodo](caminho).set('Authorization', token())

      expect(res.status).toBe(403)
      // A mensagem NOMEIA o que fazer. Um 403 de outro middleware (o do
      // `verifyPerfil`, por exemplo) satisfaria o caso sem ela.
      expect(res.body.message).toMatch(/sem acesso a nenhum módulo/i)
    }
  )

  // O caso que a escolha da guarda existe para permitir: perfil em OUTRO módulo
  // basta. Com `verifyPerfil('...','efetivo')` aqui, quem trabalha só no acervo
  // não teria como declarar o próprio impedimento.
  it('quem só tem perfil no acervo declara o próprio impedimento', async () => {
    entra({ temAcesso: true })
    gravou(EU)

    const res = await request(app)
      .post('/efetivo/meu_impedimento')
      .set('Authorization', token())
      .send({ descricao: 'Chefe do S5', percentual: 50, data_inicio: '2026-03-01' })

    expect(res.status).toBe(201)
  })

  it('a leitura filtra pelo uuid do TOKEN, e não pela lista inteira da Divisão', async () => {
    entra()

    const res = await request(app)
      .get('/efetivo/meu_periodo')
      .set('Authorization', token())

    expect(res.status).toBe(200)
    const [sql, params] = mockDb.conn.any.mock.calls[0]
    expect(sql).toMatch(/p\.usuario_uuid = \$<usuarioUuid>/)
    expect(params.usuarioUuid).toBe(EU)
  })

  it('a leitura do impedimento filtra do mesmo jeito', async () => {
    entra()

    await request(app).get('/efetivo/meu_impedimento').set('Authorization', token())

    const [sql, params] = mockDb.conn.any.mock.calls[0]
    expect(sql).toMatch(/i\.usuario_uuid = \$<usuarioUuid>/)
    expect(params.usuarioUuid).toBe(EU)
  })
})

// ---------------------------------------------------------------------------
// A GRADE DO PRÓPRIO ANO: `GET /efetivo/meu_aproveitamento`
//
// A tela `#/perfil` desenha o próprio ano com a MESMA grade de
// `#/aproveitamento`, e por isso esta rota chama as MESMAS duas funções do
// controlador (`mapaAnual` e `resumoAnual`), recortadas por pessoa. Um par de
// consultas próprio calcularia aproveitamento de novo, e a primeira correção
// aplicada a um lado só faria a pessoa ler um número na própria página e outro
// no mapa da Divisão.
//
// O QUE ESTE BLOCO PROVA: as duas consultas saem com o uuid do TOKEN, e o uuid
// que vier no pedido não é lido nem como filtro nem como campo.
// ---------------------------------------------------------------------------
describe('O mapa do próprio é o da pessoa do TOKEN', () => {
  /** As chamadas de leitura que a rota disparou, na ordem. */
  const consultas = () => mockDb.conn.any.mock.calls

  it('as DUAS consultas saem recortadas pelo uuid do token', async () => {
    entra()

    const res = await request(app)
      .get('/efetivo/meu_aproveitamento?ano=2026')
      .set('Authorization', token())

    expect(res.status).toBe(200)
    // O mapa por semana e o fechamento anual, os dois. Recortar um só devolveria
    // a grade de uma pessoa ao lado do total da Divisão.
    expect(consultas()).toHaveLength(2)
    for (const [sql, params] of consultas()) {
      expect(sql).toMatch(/AND p\.usuario_uuid = \$<usuarioUuid>/)
      expect(params.usuarioUuid).toBe(EU)
    }
  })

  it('o envelope traz o ano, as semanas e o anual, como a tela desenha', async () => {
    entra()
    mockDb.conn.any
      .mockResolvedValueOnce([{ usuario_uuid: EU, semana: 1 }])
      .mockResolvedValueOnce([{ usuario_uuid: EU, aproveitamento: '82.5' }])

    const res = await request(app)
      .get('/efetivo/meu_aproveitamento?ano=2026')
      .set('Authorization', token())

    // NÚMERO, e não a string da query: a tela compara o ano com o corrente para
    // decidir se o mapa é projeção, e '2026' > 2026 é falso em JavaScript.
    expect(res.body.dados.ano).toBe(2026)
    expect(res.body.dados.semanas).toHaveLength(1)
    expect(res.body.dados.anual).toHaveLength(1)
  })

  // O CAMINHO DE FUGA ÓBVIO: pedir o ano de outra pessoa pela query. A validação
  // de query do SCA não descarta chave desconhecida como faz a do corpo, ela
  // RECUSA -- e é melhor assim: o pedido volta dizendo o que não existe, em vez
  // de responder 200 com um mapa que não é o que se pediu.
  it('`usuario_uuid` na query é recusado, e nenhuma consulta acontece', async () => {
    entra()

    const res = await request(app)
      .get(`/efetivo/meu_aproveitamento?ano=2026&usuario_uuid=${OUTRO}`)
      .set('Authorization', token())

    expect(res.status).toBe(400)
    expect(res.body.message).toMatch(/usuario_uuid/)
    expect(mockDb.conn.any).not.toHaveBeenCalled()
  })

  it('o uuid no CORPO não muda nada: a rota nem lê corpo', async () => {
    entra()

    const res = await request(app)
      .get('/efetivo/meu_aproveitamento?ano=2026')
      .set('Authorization', token())
      .send({ usuario_uuid: OUTRO })

    expect(res.status).toBe(200)
    for (const [, params] of consultas()) expect(params.usuarioUuid).toBe(EU)
  })

  it('o ano é obrigatório: sem ele não há as 53 colunas', async () => {
    entra()

    const res = await request(app)
      .get('/efetivo/meu_aproveitamento')
      .set('Authorization', token())

    expect(res.status).toBe(400)
    expect(mockDb.conn.any).not.toHaveBeenCalled()
  })

  // O CONTROLE. Sem ele, um controlador que recortasse SEMPRE por pessoa
  // deixaria o bloco acima verde e esvaziaria o mapa da Divisão.
  it('a rota da Divisão continua SEM recorte de pessoa', async () => {
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 1, administrador: false, perfil_id: PERFIL.consulta
    })

    const res = await request(app)
      .get('/efetivo/mapa?ano=2026')
      .set('Authorization', token())

    expect(res.status).toBe(200)
    for (const [sql, params] of consultas()) {
      expect(sql).not.toMatch(/AND p\.usuario_uuid = \$<usuarioUuid>/)
      expect(params.usuarioUuid).toBeNull()
    }
  })
})

// ---------------------------------------------------------------------------
// 1. O DONO SAI DO TOKEN
//
// O corpo não declara `usuario_uuid` (o Joi o descarta), e o controlador recebe
// `req.usuarioUuid`. Este bloco manda o uuid alheio de propósito: é o caminho de
// fuga óbvio, e o que ele tem de produzir é uma linha da PRÓPRIA pessoa.
// ---------------------------------------------------------------------------
describe('O dono do registro é o do TOKEN, mesmo quando o corpo manda outro', () => {
  it('POST /meu_periodo grava o uuid do token, e ignora o do corpo', async () => {
    entra()
    gravou(EU)

    const res = await request(app)
      .post('/efetivo/meu_periodo')
      .set('Authorization', token())
      .send({ usuario_uuid: OUTRO, data_inicio: '2026-03-01' })

    expect(res.status).toBe(201)
    expect(paramsDaEscrita().usuarioAlvo).toBe(EU)
  })

  it('POST /meu_impedimento grava o uuid do token, e ignora o do corpo', async () => {
    entra()
    gravou(EU)

    const res = await request(app)
      .post('/efetivo/meu_impedimento')
      .set('Authorization', token())
      .send({
        usuario_uuid: OUTRO,
        descricao: 'LTSP',
        percentual: 100,
        data_inicio: '2026-03-01'
      })

    expect(res.status).toBe(201)
    expect(paramsDaEscrita().usuarioAlvo).toBe(EU)
  })

  // O contrabando não passa nem como CAMPO: `usuario_uuid` é chave desconhecida
  // no schema do próprio, e o `schemaValidation` a descarta com aviso. Sem este
  // caso, um schema que voltasse a declarar o campo continuaria verde acima só
  // porque a rota o sobrescreve depois.
  it('`usuario_uuid` é chave desconhecida no corpo, e volta avisada no envelope', async () => {
    entra()
    gravou(EU)

    const res = await request(app)
      .post('/efetivo/meu_periodo')
      .set('Authorization', token())
      .send({ usuario_uuid: OUTRO, data_inicio: '2026-03-01' })

    expect(res.body.avisos).toBeDefined()
    expect(JSON.stringify(res.body.avisos)).toMatch(/usuario_uuid/)
  })
})

// ---------------------------------------------------------------------------
// 2 e 3. O `:id` NÃO AUTORIZA SOZINHO, e a recusa é 404
//
// É o coração destas rotas. `PUT /efetivo/periodos/:id` autoriza pelo `:id` e
// pronto, e pode: para chegar lá é preciso ser gerente do Efetivo, cujo trabalho
// é justamente mexer no registro alheio. Aqui a guarda só diz "esta pessoa entrou
// no sistema", então quem confere de quem é a linha é o controlador.
// ---------------------------------------------------------------------------
const ALHEIAS = [
  ['put', '/efetivo/meu_periodo/1', 'Passagem pela DGEO', { data_inicio: '2026-03-01' }],
  ['delete', '/efetivo/meu_periodo/1', 'Passagem pela DGEO', null],
  [
    'put', '/efetivo/meu_impedimento/1', 'Impedimento',
    { descricao: 'LTSP', percentual: 100, data_inicio: '2026-03-01' }
  ],
  ['delete', '/efetivo/meu_impedimento/1', 'Impedimento', null]
]

describe('O registro alheio não existe para quem não é dono dele', () => {
  test.each(ALHEIAS)(
    '%s %s responde 404 quando a linha é de outra pessoa',
    async (metodo, caminho, nome, corpo) => {
      entra()
      linhaDe(OUTRO)

      const req = request(app)[metodo](caminho).set('Authorization', token())
      const res = corpo ? await req.send(corpo) : await req

      // 404, e NÃO 403: o 403 confirmaria que a linha existe.
      expect(res.status).toBe(404)
      // A MESMA mensagem de um id inexistente. Uma frase própria ("não é seu")
      // devolveria pela porta dos fundos o que o 404 fecha pela da frente.
      expect(res.body.message).toBe(`${nome} não encontrado(a)`)
    }
  )

  test.each(ALHEIAS)(
    '%s %s não toca no banco quando a linha é de outra pessoa',
    async (metodo, caminho, _nome, corpo) => {
      entra()
      linhaDe(OUTRO)

      const req = request(app)[metodo](caminho).set('Authorization', token())
      if (corpo) await req.send(corpo)
      else await req

      // O 404 sozinho não prova nada: um controlador que gravasse e DEPOIS
      // reclamasse responderia igual. O que se lê aqui é a ausência da escrita.
      expect(houveEscrita()).toBe(false)
      expect(houveDelete()).toBe(false)
    }
  )

  // A VARIÂNCIA. Sem estes dois casos, um controlador que recusasse TUDO com 404
  // deixaria o bloco inteiro verde.
  it('a passagem PRÓPRIA se edita, e o UPDATE acontece', async () => {
    entra()
    linhaDe(EU)
    gravou(EU)

    const res = await request(app)
      .put('/efetivo/meu_periodo/1')
      .set('Authorization', token())
      .send({ data_inicio: '2026-03-01', data_fim: '2026-11-30' })

    expect(res.status).toBe(200)
    expect(houveEscrita()).toBe(true)
  })

  it('o impedimento PRÓPRIO se exclui, e o DELETE acontece', async () => {
    entra()
    linhaDe(EU, { descricao: 'LTSP', percentual: 100 })

    const res = await request(app)
      .delete('/efetivo/meu_impedimento/1')
      .set('Authorization', token())

    expect(res.status).toBe(200)
    expect(houveDelete()).toBe(true)
  })

  // O ADMINISTRADOR GLOBAL NÃO É EXCEÇÃO AQUI. Ele curto-circuita a GUARDA, que
  // é sobre entrar; a conferência do dono é do controlador e vale para todo
  // mundo. Quem administra o sistema e quer mexer no registro alheio tem a rota
  // de terceiro, que é onde esse ato fica auditado como o que é.
  it('nem o administrador global edita a linha alheia por esta porta', async () => {
    entra({ administrador: true })
    linhaDe(OUTRO)

    const res = await request(app)
      .put('/efetivo/meu_periodo/1')
      .set('Authorization', token())
      .send({ data_inicio: '2026-03-01' })

    expect(res.status).toBe(404)
    expect(houveEscrita()).toBe(false)
  })
})

// ---------------------------------------------------------------------------
// O CONTROLE: a rota de TERCEIRO continua fazendo o trabalho dela.
//
// A conferência de dono é do caminho `/meu_*`, e apertá-la em `/periodos/:id`
// tiraria do gerente do efetivo exatamente o que a régua de 2026-08-08 pôs nele.
// ---------------------------------------------------------------------------
describe('O gerente do efetivo continua editando o registro dos OUTROS', () => {
  it('PUT /efetivo/periodos/:id aceita a linha de outra pessoa', async () => {
    // `verifyPerfil` faz UMA leitura: a linha do usuário com o perfil do módulo.
    mockDb.conn.oneOrNone.mockResolvedValueOnce({
      id: 1, administrador: false, perfil_id: PERFIL.gerente
    })
    linhaDe(OUTRO)
    gravou(OUTRO)

    const res = await request(app)
      .put('/efetivo/periodos/1')
      .set('Authorization', token())
      .send({ data_inicio: '2026-03-01' })

    expect(res.status).toBe(200)
    expect(houveEscrita()).toBe(true)
  })
})
