'use strict'

// O CORPO AUSENTE, nos DOIS validadores.
//
// Sob Express 5, requisicao sem corpo deixa `req.body` como `undefined`, e
// `Joi.object().keys({ x: ...required() })` ACEITA `undefined`: o Joi so cobra as
// chaves do objeto PRESENTE. O schema passava limpo, e quem recusava era o
// `TypeError` de ler `.confirmar` de `undefined`, la dentro do controlador --
// que chega ao cliente como 500 "Erro no servidor", sem dizer o que faltou.
//
// ISSO MORDIA AS 15 ROTAS DESTRUTIVAS de `/perigo`, `/gerencia_producao` e
// `/microcontrole`, que sao justamente as que existem para EXIGIR confirmacao
// digitada. O cabecalho de `perigo/perigo_route.js` descreve o caso que o
// provoca: "um DELETE sem corpo, disparado por uma aba aberta ou por uma seta
// para cima no terminal". Quem o dispara tem de ler a frase da confirmacao, e
// nao "Erro no servidor".
//
// A CORRECAO E NO VALIDADOR, e nao nos 15 schemas: normalizar `undefined` para
// `{}` num lugar so vale para toda rota que declare `body`, inclusive as que
// ainda nao existem. Estes casos prendem isso nos dois irmaos, que tem contrato
// OPOSTO quanto a chave desconhecida e por isso precisam ser provados separados.

const Joi = require('joi')

const schemaValidation = require('../../../utils/schema_validation')
const schemaValidationEstrito = require('../../../utils/schema_validation_estrito')

const corpoExigido = Joi.object().keys({
  confirmar: Joi.string().required(),
  motivo: Joi.string().required()
})

// O minimo de uma requisicao para os dois validadores: eles leem `body`, `query`
// e `params`, e `defineProperty` sobre os dois ultimos.
const requisicaoSem = corpo => ({
  body: corpo,
  query: {},
  params: {}
})

const rodar = (validador, corpo) => {
  const req = requisicaoSem(corpo)
  const erros = []

  validador({ body: corpoExigido })(req, {}, err => {
    if (err) erros.push(err)
  })

  return { req, erro: erros[0] }
}

describe.each([
  ['tolerante', schemaValidation],
  ['estrito', schemaValidationEstrito]
])('validador %s', (_nome, validador) => {
  it('recusa o corpo AUSENTE cobrando as chaves obrigatórias', () => {
    const { erro } = rodar(validador, undefined)

    expect(erro).toBeDefined()
    // 400, e nao o 500 que o `TypeError` produzia la adiante.
    expect(erro.statusCode).toBe(400)
    // A frase nomeia o que faltou, que e o ponto todo da correcao.
    expect(erro.message).toContain('confirmar')
    expect(erro.message).toContain('motivo')
  })

  it('recusa o corpo VAZIO pelo mesmo motivo, e a mensagem é a mesma', () => {
    const semCorpo = rodar(validador, undefined)
    const corpoVazio = rodar(validador, {})

    expect(corpoVazio.erro).toBeDefined()
    expect(corpoVazio.erro.statusCode).toBe(400)
    // Corpo ausente e corpo vazio passam a ser a MESMA recusa. Se um dia se
    // quiser distinguir os dois, e aqui que a mudanca aparece.
    expect(semCorpo.erro.message).toBe(corpoVazio.erro.message)
  })

  it('não inventa corpo: o que chega completo passa intacto', () => {
    const { req, erro } = rodar(validador, {
      confirmar: 'APAGAR',
      motivo: 'unidades órfãs'
    })

    expect(erro).toBeUndefined()
    expect(req.body).toEqual({ confirmar: 'APAGAR', motivo: 'unidades órfãs' })
  })

  it('a normalização não engole a recusa de chave que falta sozinha', () => {
    const { erro } = rodar(validador, { confirmar: 'APAGAR' })

    expect(erro).toBeDefined()
    expect(erro.statusCode).toBe(400)
    expect(erro.message).toContain('motivo')
    // E nao reclama do que veio certo.
    expect(erro.message).not.toContain('"confirmar" is required')
  })
})

// O CONTRATO QUE SEPARA OS DOIS IRMAOS continua de pe depois da normalizacao: o
// estrito RECUSA a chave desconhecida, o tolerante a DESCARTA. Um corpo ausente
// nao pode ter apagado essa diferenca pelo caminho.
describe('a normalização preserva o contrato de chave desconhecida', () => {
  const comSobra = { confirmar: 'APAGAR', motivo: 'órfãs', sobra: 1 }

  it('o estrito recusa a chave desconhecida', () => {
    const { erro } = rodar(schemaValidationEstrito, comSobra)

    expect(erro).toBeDefined()
    expect(erro.statusCode).toBe(400)
    expect(erro.message).toContain('sobra')
  })

  it('o tolerante a descarta e segue', () => {
    const { req, erro } = rodar(schemaValidation, comSobra)

    expect(erro).toBeUndefined()
    expect(req.body).toEqual({ confirmar: 'APAGAR', motivo: 'órfãs' })
  })
})
