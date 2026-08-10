'use strict'

// A PORTA PARA O BANCO DE EDICAO, PROVADA SEM REDE NENHUMA.
//
// O QUE SE PROVA AQUI, e por que nao da para provar em outro lugar:
//
//   1. A LISTA DE SERVIDORES PERMITIDOS E COBRADA NO PONTO DE DISCAGEM. O alvo
//      vem do DADO (`producao.dado_producao.configuracao_producao`), digitado
//      por um gerente do modulo producao, e o servico disca para la com o par de
//      SUPERUSUARIO de `PRODUCAO_DB_ADMIN_*`. Um schema de rota so alcanca a
//      PROXIMA escrita: o cadastro ja gravado continua no banco, e e por isso
//      que a conferencia mora em `conexaoAdmin.para()`, por onde tudo passa.
//   2. CHAVE AUSENTE RECUSA TUDO. A decisao segue o precedente de `SEM_CHAVES`:
//      configuracao que falta DESLIGA o subsistema, e nunca o afrouxa.
//   3. O ENDERECO NAO VAZA PARA O LOG. `errorHandler.log` grava o `errorTrace`,
//      e a mensagem do driver traz o host (`getaddrinfo EAI_AGAIN <host>`). Aqui
//      se prova pelo caminho inteiro: o erro sai de `noBanco` e passa pelo mesmo
//      tratador que o serve.
//
// ESTE ARQUIVO NAO ABRE CONEXAO e por isso cai no pacote `test:rapido`. O pool
// que `para()` monta e PREGUICOSO (o pg-promise so disca no primeiro `query`), e
// o `afterAll` o fecha.

const conexaoAdmin = require('../../database/conexao_admin')
const errorHandler = require('../../utils/error_handler')
const logger = require('../../utils/logger')
const { AppError } = require('../../utils')

// OSTENSIVAMENTE FALSOS. Este repositorio e publico: o que se prova e a FORMA
// que o codigo le, e nunca o endereco de instalacao nenhuma.
const SERVIDOR = 'servidor_de_edicao'
const CONFIGURACAO = `${SERVIDOR}:5432/banco_de_teste`
const INTRUSO = 'servidor_do_atacante'
const CONFIGURACAO_INTRUSA = `${INTRUSO}:5432/banco_qualquer`

const ligarCredencial = () => {
  process.env.PRODUCAO_DB_ADMIN_USER = 'papel-de-teste'
  process.env.PRODUCAO_DB_ADMIN_PASSWORD = 'valor-de-teste'
}

const listar = valor => {
  if (valor === undefined) delete process.env.PRODUCAO_DB_HOSTS
  else process.env.PRODUCAO_DB_HOSTS = valor
}

let logs

beforeEach(() => {
  delete process.env.PRODUCAO_DB_ADMIN_USER
  delete process.env.PRODUCAO_DB_ADMIN_PASSWORD
  delete process.env.PRODUCAO_DB_HOSTS

  logs = []
  for (const nivel of ['info', 'warn', 'error', 'debug']) {
    jest.spyOn(logger, nivel).mockImplementation((...args) => {
      logs.push(JSON.stringify(args))
    })
  }
})

afterEach(() => {
  delete process.env.PRODUCAO_DB_ADMIN_USER
  delete process.env.PRODUCAO_DB_ADMIN_PASSWORD
  delete process.env.PRODUCAO_DB_HOSTS
  jest.restoreAllMocks()
})

afterAll(async () => {
  await conexaoAdmin.encerrar()
})

// ---------------------------------------------------------------------------
// A LISTA
// ---------------------------------------------------------------------------

describe('a leitura de PRODUCAO_DB_HOSTS', () => {
  it('separa os itens, apara o espaco e desce para minusculas', () => {
    listar(` ${SERVIDOR} , OUTRO_SERVIDOR:5433 `)

    expect(conexaoAdmin.hostsPermitidos()).toEqual([
      { servidor: SERVIDOR, porta: null },
      { servidor: 'outro_servidor', porta: '5433' }
    ])
  })

  it.each([
    ['ausente', undefined],
    ['em branco', '   '],
    ['so virgulas', ',,,']
  ])('devolve lista vazia com a chave %s', (_nome, valor) => {
    listar(valor)
    expect(conexaoAdmin.hostsPermitidos()).toEqual([])
  })

  // ITEM SEM PORTA permite qualquer porta daquele servidor; item COM porta
  // permite so aquela.
  it('a porta do item restringe a porta do alvo', () => {
    listar(`${SERVIDOR}:5432`)

    expect(conexaoAdmin.permitido({ servidor: SERVIDOR, porta: '5432' })).toBe(true)
    expect(conexaoAdmin.permitido({ servidor: SERVIDOR, porta: '5433' })).toBe(false)
  })

  it('item sem porta vale para qualquer porta do mesmo servidor', () => {
    listar(SERVIDOR)

    expect(conexaoAdmin.permitido({ servidor: SERVIDOR, porta: '5432' })).toBe(true)
    expect(conexaoAdmin.permitido({ servidor: SERVIDOR, porta: '65000' })).toBe(true)
  })

  // A COMPARACAO E POR IGUALDADE, e nao por prefixo nem por sufixo: um
  // `startsWith` ou um `endsWith` entregariam o subsistema a quem registrasse um
  // dominio que TERMINA com o nome permitido.
  it.each([
    ['sufixo', `atacante.${SERVIDOR}`],
    ['prefixo', `${SERVIDOR}.atacante`],
    ['nome parecido', `${SERVIDOR}2`]
  ])('nao aceita servidor que so se PARECE com o da lista (%s)', (_nome, servidor) => {
    listar(SERVIDOR)
    expect(conexaoAdmin.permitido({ servidor, porta: '5432' })).toBe(false)
  })

  it('maiuscula e espaco no cadastro nao mudam a resposta', () => {
    listar(SERVIDOR)
    expect(conexaoAdmin.permitido({ servidor: ` ${SERVIDOR.toUpperCase()} `, porta: '5432' })).toBe(true)
  })
})

// ---------------------------------------------------------------------------
// A RECUSA, NO PONTO DE DISCAGEM
// ---------------------------------------------------------------------------

describe('a conferencia no ponto de discagem', () => {
  // O CASO QUE O Joi DA ROTA NAO ALCANCA: o cadastro ja esta gravado. Quem barra
  // e `para()`, e nao o schema de escrita.
  it('recusa o servidor fora da lista em para(), com a credencial completa', () => {
    ligarCredencial()
    listar(SERVIDOR)

    const alvo = conexaoAdmin.separar(CONFIGURACAO_INTRUSA)

    expect(() => conexaoAdmin.para(alvo)).toThrow(AppError)
    try {
      conexaoAdmin.para(alvo)
    } catch (e) {
      expect(e.statusCode).toBe(503)
      expect(e.message).toBe(conexaoAdmin.HOST_NAO_PERMITIDO)
    }
  })

  // A PROVA DE QUE A RECUSA E ANTES DA REDE: a tarefa e quem faria a consulta, e
  // ela nunca roda. Fosse a conferencia so no Joi, este caminho discaria.
  it('a tarefa de noBanco nunca roda para servidor fora da lista', async () => {
    ligarCredencial()
    listar(SERVIDOR)

    const tarefa = jest.fn(async () => 'nunca chega aqui')

    await expect(conexaoAdmin.noBanco(CONFIGURACAO_INTRUSA, tarefa)).rejects.toMatchObject({
      statusCode: 503,
      message: conexaoAdmin.HOST_NAO_PERMITIDO
    })
    expect(tarefa).not.toHaveBeenCalled()
  })

  // A FRASE NAO DIZ QUAL ERA O SERVIDOR, pela mesma razao de `FORA_DO_AR`: ela
  // viaja para o log e para o corpo da resposta.
  it('a recusa nao carrega o endereco recusado', async () => {
    ligarCredencial()
    listar(SERVIDOR)

    try {
      await conexaoAdmin.noBanco(CONFIGURACAO_INTRUSA, async () => null)
      throw new Error('deveria ter lançado')
    } catch (e) {
      expect(e).toBeInstanceOf(AppError)
      expect(e.message).not.toContain(INTRUSO)
      expect(e.errorTrace).toBeNull()

      errorHandler.log(e)
      expect(logs.join('\n')).not.toContain(INTRUSO)
    }
  })

  it('o servidor da lista atravessa, e a tarefa recebe o alvo', async () => {
    ligarCredencial()
    listar(SERVIDOR)

    const alvos = []
    const r = await conexaoAdmin.noBanco(CONFIGURACAO, async (conn, alvo) => {
      alvos.push(alvo)
      return 'passou'
    })

    expect(r).toBe('passou')
    expect(alvos).toEqual([{ servidor: SERVIDOR, porta: '5432', banco: 'banco_de_teste' }])
  })
})

// ---------------------------------------------------------------------------
// A CHAVE AUSENTE
// ---------------------------------------------------------------------------

describe('quando a lista nao esta configurada', () => {
  // AUSENTE RECUSA TUDO, e nao "permite qualquer servidor": o contrario deixaria
  // de pe, em toda instalacao ja existente, o defeito que a lista fecha.
  it.each([
    ['ausente', undefined],
    ['presente e em branco', '   '],
    ['so virgulas', ',,,']
  ])('a chave %s recusa ate o servidor que seria legitimo', async (_nome, valor) => {
    ligarCredencial()
    listar(valor)

    const tarefa = jest.fn(async () => 'nunca chega aqui')

    await expect(conexaoAdmin.noBanco(CONFIGURACAO, tarefa)).rejects.toMatchObject({
      statusCode: 503,
      message: conexaoAdmin.SEM_HOSTS
    })
    expect(tarefa).not.toHaveBeenCalled()
  })

  // A frase manda CONFIGURAR, e por isso nomeia a chave: e o mesmo desenho de
  // `SEM_CHAVES`, que nomeia as outras duas.
  it('a frase nomeia a chave que falta, e nao o servidor', async () => {
    ligarCredencial()
    listar(undefined)

    await expect(conexaoAdmin.noBanco(CONFIGURACAO, async () => null)).rejects.toThrow(
      /PRODUCAO_DB_HOSTS/
    )
    await expect(conexaoAdmin.noBanco(CONFIGURACAO, async () => null)).rejects.not.toThrow(
      new RegExp(SERVIDOR)
    )
  })

  // A CREDENCIAL RESPONDE PRIMEIRO: quem nunca ligou o subsistema (o estado
  // normal de uma instalacao sem banco de edicao controlado) continua lendo a
  // frase de sempre, e nao uma nova. E o "impacto zero" da entrega.
  it('sem as duas chaves de credencial, a frase continua sendo a de sempre', async () => {
    listar(undefined)

    expect(conexaoAdmin.configurado()).toBe(false)
    await expect(conexaoAdmin.noBanco(CONFIGURACAO, async () => null)).rejects.toMatchObject({
      statusCode: 503,
      message: conexaoAdmin.SEM_CHAVES
    })
  })
})

// ---------------------------------------------------------------------------
// O ENDERECO QUE NAO PODE SAIR DAQUI
// ---------------------------------------------------------------------------

describe('o erro de rede', () => {
  const erroDeRede = (mensagem, extra = {}) =>
    Object.assign(new Error(mensagem), extra)

  const cair = async err => {
    ligarCredencial()
    listar(SERVIDOR)
    try {
      await conexaoAdmin.noBanco(CONFIGURACAO, async () => {
        throw err
      })
      throw new Error('deveria ter lançado')
    } catch (e) {
      return e
    }
  }

  // O QUE ESCAPAVA. `INDISPONIVEL` era uma lista FECHADA, e `EAI_AGAIN` -- o
  // resolvedor de nomes que nao respondeu, que e o erro mais comum de rede
  // interna com DNS lento -- nao estava nela. O erro subia cru e o
  // `res.sendJsonAndLog` gravava `getaddrinfo EAI_AGAIN <host>` no log.
  it('EAI_AGAIN vira 503 sem endereco e sem causa', async () => {
    const e = await cair(
      erroDeRede(`getaddrinfo EAI_AGAIN ${SERVIDOR}`, {
        code: 'EAI_AGAIN',
        hostname: SERVIDOR
      })
    )

    expect(e).toBeInstanceOf(AppError)
    expect(e.statusCode).toBe(503)
    expect(e.message).toBe(conexaoAdmin.FORA_DO_AR)
    expect(e.message).not.toContain(SERVIDOR)
    expect(e.errorTrace).toBeNull()

    errorHandler.log(e)
    expect(logs.join('\n')).not.toContain(SERVIDOR)
  })

  // O OUTRO QUE ESCAPAVA: o pool desiste sem `code` nenhum, e a lista fechada
  // nao tinha o que perguntar.
  it.each([
    ['pool sem code', 'Connection terminated unexpectedly'],
    ['espera do pool', 'timeout exceeded when trying to connect'],
    ['cliente derrubado', 'Client has encountered a connection error and is not queryable']
  ])('erro de %s vira 503 mesmo sem code', async (_nome, mensagem) => {
    const e = await cair(erroDeRede(mensagem))

    expect(e).toBeInstanceOf(AppError)
    expect(e.statusCode).toBe(503)
    expect(e.message).toBe(conexaoAdmin.FORA_DO_AR)
  })

  // A VARIANCIA DO TESTE DE LOG: sem ela, os `not.toContain` acima passariam por
  // vacuidade no dia em que o logger deixasse de ser chamado.
  it('o logger realmente grava o que recebe', () => {
    logger.error('sonda', { valor: SERVIDOR })
    expect(logs.join('\n')).toContain(SERVIDOR)
  })

  // ERRO QUE NAO E DE CONEXAO CONTINUA SUBINDO INTEIRO -- sintaxe de DDL errada
  // e defeito nosso, e virar 503 mandaria procurar o servidor do outro lado por
  // um bug daqui. O que ele NAO leva junto e o endereco.
  it('o erro que nao e de conexao sobe como veio, sem o endereco', async () => {
    const err = erroDeRede(
      `syntax error at or near "GRANT" (${SERVIDOR}:5432/banco_de_teste)`,
      { code: '42601' }
    )

    const e = await cair(err)

    // O MESMO OBJETO, com o tipo, o `code` e a pilha de origem.
    expect(e).toBe(err)
    expect(e).not.toBeInstanceOf(AppError)
    expect(e.code).toBe('42601')
    expect(e.message).toContain('syntax error at or near')

    expect(e.message).not.toContain(SERVIDOR)
    expect(e.message).not.toContain('banco_de_teste')
    expect(e.stack).not.toContain(SERVIDOR)

    errorHandler.log(e)
    expect(logs.join('\n')).not.toContain(SERVIDOR)
    expect(logs.join('\n')).not.toContain('banco_de_teste')
  })

  // `serialize-error` copia TODA propriedade propria para o `errorTrace`, e erro
  // de socket do Node carrega `address` ao lado da mensagem.
  it('a propriedade propria com o endereco tambem e apagada', async () => {
    const e = await cair(
      erroDeRede('erro sem familia conhecida', { address: SERVIDOR, port: 5432 })
    )

    expect(e.address).not.toBe(SERVIDOR)
    expect(e.port).toBe(5432)
  })
})
