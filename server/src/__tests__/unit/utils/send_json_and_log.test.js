'use strict'

// O LOG DE RESPOSTA NÃO CARREGA O CORPO DA REQUISIÇÃO, e é isto que este
// arquivo prende.
//
// Até 2026-09-05 `sendJsonAndLog` passava `truncate(req.body)` ao logger no
// campo `information`. A função redigia a senha, cortava strings em 500
// caracteres... e caía no fim sem `return`, então nada disso chegava ao log. O
// conserto óbvio (devolver a cópia) é que era o defeito: `logs/combined.log` é
// publicado por `GET /logs` SEM autenticação, por decisão registrada, e o corpo
// de toda escrita do sistema ficaria legível numa rota anônima -- NUP, nome de
// OM, o texto do motivo de auditoria, endereço de entrega. Redigir três chaves
// de senha não cobre nada disso.
//
// Por isso o parâmetro saiu inteiro. Os casos abaixo provam as duas metades:
//
//   1. NENHUM campo do corpo chega ao objeto logado -- nem os três de senha, nem
//      os inocentes. A asserção é sobre o log INTEIRO serializado, e não sobre o
//      campo `information`, porque o dia em que alguém puser o corpo noutro
//      campo (`meta`, `body`, `dados`) o defeito é o mesmo.
//   2. O `req.body` sai INTACTO. O `truncate` mutava o corpo no lugar (senha
//      virava '*', string longa era cortada), e isso era inofensivo só por
//      acidente de ordem: ele rodava depois do controller. Registro não pode
//      alterar o registrado, e com a função apagada não pode mesmo.
//
// O DIA EM QUE `/logs` FOR FECHADO, esses casos são os que ficam vermelhos, e é
// para isso que eles existem: a volta do corpo ao log é decisão, e decisão se
// registra em `docs/decisoes.md`.

jest.mock('../../../utils/logger', () => ({
  info: jest.fn(),
  error: jest.fn()
}))

const logger = require('../../../utils/logger')
const sendJsonAndLogMiddleware = require('../../../utils/send_json_and_log')

const LONGA = 'x'.repeat(700)

/** Um `req` do Express com o mínimo que o middleware lê. */
const reqDeMentira = body => ({
  body,
  protocol: 'http',
  originalUrl: '/api/usuarios/perfil/senha',
  get: () => 'servidor'
})

/** Um `res` que só registra o que foi respondido. */
const resDeMentira = () => {
  const res = { statusRecebido: null, jsonRecebido: null }
  res.status = codigo => {
    res.statusRecebido = codigo
    return res
  }
  res.json = corpo => {
    res.jsonRecebido = corpo
    return res
  }
  return res
}

/** Monta o middleware e responde, devolvendo o `req` e o `res` usados. */
const responder = (body, status = 200) => {
  const req = reqDeMentira(body)
  const res = resDeMentira()
  sendJsonAndLogMiddleware(req, res, () => {})
  res.sendJsonAndLog(true, 'Senha atualizada', status)
  return { req, res }
}

/** O objeto de metadados que o `logger.info` recebeu na última chamada. */
const ultimoLog = () => {
  expect(logger.info).toHaveBeenCalledTimes(1)
  return logger.info.mock.calls[0][1]
}

beforeEach(() => logger.info.mockClear())

describe('nenhum campo do corpo chega ao log', () => {
  // As TRÊS chaves de senha do sistema: `senha` (cadastro e reset) e
  // `senha_atual`/`senha_nova` (`PUT /usuarios/perfil/senha`).
  test.each([
    ['senha', 'segredo-do-cadastro'],
    ['senha_atual', 'segredo-vigente'],
    ['senha_nova', 'segredo-novo']
  ])('a chave `%s` não aparece em lugar nenhum do log', (chave, valor) => {
    responder({ [chave]: valor }) // path-ok

    const serializado = JSON.stringify(ultimoLog())
    expect(serializado).not.toContain(valor)
    // A chave ENTRE ASPAS, e não o nome solto: a própria URL da rota de troca
    // de senha termina em `/perfil/senha`, e ela continua no log de propósito.
    expect(serializado).not.toContain(`"${chave}"`)
  })

  test('o campo `information` não existe mais no objeto logado', () => {
    responder({ senha: 'segredo' }) // path-ok

    const dados = ultimoLog()
    expect(dados).not.toHaveProperty('information')
  })

  test('o log carrega só url, status, success e error', () => {
    responder({ nup: '64536.001234/2026-11', motivo: LONGA })

    expect(Object.keys(ultimoLog()).sort()).toEqual([
      'error',
      'status',
      'success',
      'url'
    ])
  })

  test('campo inocente do corpo também fica de fora', () => {
    // O NUP e o nome da OM não são segredo de senha, e são exatamente o que
    // tornava o corpo no log um problema: quem abre `/logs` não tem conta.
    responder({ nup: '64536.001234/2026-11', om: '1º Centro de Geoinformação' })

    const serializado = JSON.stringify(ultimoLog())
    expect(serializado).not.toContain('64536.001234/2026-11')
    expect(serializado).not.toContain('Geoinformação')
  })

  test('corpo aninhado não vaza por dentro de um objeto', () => {
    responder({ usuario: { senha: 'segredo', login: 'fulano' } }) // path-ok

    const serializado = JSON.stringify(ultimoLog())
    expect(serializado).not.toContain('segredo')
    expect(serializado).not.toContain('fulano')
  })
})

describe('o corpo da requisição sai intacto da resposta', () => {
  test('a senha NÃO é trocada por asterisco dentro do req.body', () => {
    const { req } = responder({ senha_atual: 'antiga', senha_nova: 'nova' })

    expect(req.body).toEqual({ senha_atual: 'antiga', senha_nova: 'nova' })
  })

  test('a string longa NÃO é cortada dentro do req.body', () => {
    const { req } = responder({ motivo: LONGA })

    expect(req.body.motivo).toHaveLength(700)
    expect(req.body.motivo).toBe(LONGA)
  })

  test('nenhuma chave é acrescentada nem removida do req.body', () => {
    const corpo = { nome: 'Silva', senha: 'segredo', ativo: true } // path-ok
    const { req } = responder(corpo)

    expect(Object.keys(req.body)).toEqual(['nome', 'senha', 'ativo'])
    expect(req.body.senha).toBe('segredo')
  })

  test('requisição sem corpo nenhum não derruba a resposta', () => {
    const req = { protocol: 'http', originalUrl: '/api/login', get: () => 'servidor' }
    const res = resDeMentira()
    sendJsonAndLogMiddleware(req, res, () => {})
    res.sendJsonAndLog(true, 'Login efetuado', 201)

    expect(res.statusRecebido).toBe(201)
    expect(ultimoLog().status).toBe(201)
  })
})

describe('o envelope da resposta não mudou', () => {
  test('o 500 mascara a mensagem e zera o campo error', () => {
    const req = reqDeMentira({})
    const res = resDeMentira()
    sendJsonAndLogMiddleware(req, res, () => {})
    res.sendJsonAndLog(false, 'relation "dgeo.usuario" does not exist', 500, null, {
      message: 'relation "dgeo.usuario" does not exist'
    })

    expect(res.jsonRecebido.message).toBe('Erro no servidor')
    expect(res.jsonRecebido.error).toBeNull()
  })

  test('o que não é 500 entrega a frase e o erro', () => {
    const req = reqDeMentira({})
    const res = resDeMentira()
    sendJsonAndLogMiddleware(req, res, () => {})
    res.sendJsonAndLog(false, 'Usuário não encontrado', 404, null, {
      message: 'Usuário não encontrado'
    })

    expect(res.statusRecebido).toBe(404)
    expect(res.jsonRecebido.message).toBe('Usuário não encontrado')
    expect(res.jsonRecebido.error).toBe('Usuário não encontrado')
  })
})
