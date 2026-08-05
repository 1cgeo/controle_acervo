'use strict'

/**
 * O hpp saiu do app.js, e este arquivo é o que impede ele de voltar.
 *
 * São duas provas independentes:
 *
 * 1. INÉRCIA. Sob Express 5 o req.query é getter sem cache. Quem escreve nele
 *    escreve num objeto descartável, e era exatamente isso que o hpp fazia. O
 *    teste reproduz o mecanismo do hpp SEM depender do pacote, que já não está
 *    mais instalado.
 * 2. ARMADILHA. Se o hpp voltasse a funcionar, ele colapsaria o filtro de
 *    vários códigos para o último valor, e a busca do acervo passaria a mentir
 *    em silêncio.
 *
 * Não carrega o app de verdade nem o banco: é teste do pacote rápido.
 */

const fs = require('fs')
const path = require('path')
const express = require('express')
const request = require('supertest')
const Joi = require('joi')

const { listaDeInteiros } = require('../../../utils/lista_schema')

const RAIZ_SERVER = path.join(__dirname, '..', '..', '..')
const APP_JS = path.join(RAIZ_SERVER, 'server', 'app.js')
const PACKAGE_JSON = path.join(RAIZ_SERVER, '..', 'package.json')

const schemaFiltro = Joi.object({ tipo_produto_id: listaDeInteiros() })

describe('req.query no Express 5', () => {
  test('é getter sem setter, e devolve um objeto novo a cada acesso', async () => {
    const descritor = Object.getOwnPropertyDescriptor(
      require('express/lib/request'),
      'query'
    )

    expect(typeof descritor.get).toBe('function')
    expect(descritor.set).toBeUndefined()
    expect('value' in descritor).toBe(false)

    let mesmoObjeto = null
    const app = express()
    app.get('/id', (req, res) => {
      mesmoObjeto = req.query === req.query
      res.json({})
    })

    await request(app).get('/id?a=1')
    expect(mesmoObjeto).toBe(false)
  })
})

describe('controle negativo: a escrita que o hpp fazia não sobrevive', () => {
  // Este middleware é o hpp em miniatura: lê o req.query, guarda o array de
  // lado e deixa só o último valor. É o mesmo gesto do pacote.
  const hppEmMiniatura = (req, res, next) => {
    const q = req.query
    for (const chave of Object.keys(q)) {
      if (Array.isArray(q[chave])) q[chave] = q[chave][q[chave].length - 1]
    }
    return next()
  }

  test('com o middleware montado, o handler ainda recebe o ARRANJO', async () => {
    const app = express()
    app.use(hppEmMiniatura)
    app.get('/eco', (req, res) => res.json({ valor: req.query.a }))

    const resposta = await request(app).get('/eco?a=1&a=2')

    expect(Array.isArray(resposta.body.valor)).toBe(true)
    expect(resposta.body.valor).toEqual(['1', '2'])
  })

  test('o mesmo gesto sobre um objeto comum COLAPSA, e é essa a diferença', () => {
    // Semântica do Express 4, onde o req.query era propriedade comum. Aqui a
    // escrita pega. A comparação com o teste acima é o que prova que o Express 5
    // neutraliza o hpp, e não que o gesto do hpp seja inofensivo.
    const falso = { query: { a: ['1', '2'] } }
    hppEmMiniatura(falso, {}, () => {})

    expect(falso.query.a).toBe('2')
  })
})

describe('armadilha: o filtro de vários códigos depende do arranjo', () => {
  test('a URL com o código repetido vira lista de inteiros', async () => {
    const app = express()
    app.get('/busca', (req, res) => {
      const { error, value } = schemaFiltro.validate(req.query)
      res.json({ erro: error ? error.message : null, filtro: value })
    })

    const resposta = await request(app)
      .get('/busca?tipo_produto_id=1&tipo_produto_id=3')

    expect(resposta.body.erro).toBeNull()
    expect(resposta.body.filtro.tipo_produto_id).toEqual([1, 3])
  })

  test('o hpp efetivo perderia o primeiro código, sem erro nenhum', () => {
    const inteiro = schemaFiltro.validate({ tipo_produto_id: ['1', '3'] })
    const colapsado = schemaFiltro.validate({ tipo_produto_id: '3' })

    expect(inteiro.error).toBeUndefined()
    expect(colapsado.error).toBeUndefined()
    // A busca devolveria produto do tipo 3 e nenhum do tipo 1, e a tela não
    // teria como perceber a diferença.
    expect(inteiro.value.tipo_produto_id).toEqual([1, 3])
    expect(colapsado.value.tipo_produto_id).toEqual([3])
    expect(colapsado.value.tipo_produto_id).not.toEqual(inteiro.value.tipo_produto_id)
  })
})

describe('a proteção real vem do Joi, e não do hpp', () => {
  test('campo escalar recusa o valor repetido com erro de validação', async () => {
    const schemaTermo = Joi.object({ termo: Joi.string().allow('') })

    const app = express()
    app.get('/busca', (req, res) => {
      const { error } = schemaTermo.validate(req.query)
      res.json({ erro: error ? error.message : null })
    })

    const repetido = await request(app).get('/busca?termo=a&termo=b')
    const simples = await request(app).get('/busca?termo=a')

    expect(repetido.body.erro).toMatch(/must be a string/)
    expect(simples.body.erro).toBeNull()
  })
})

describe('o hpp não pode voltar', () => {
  const app = fs.readFileSync(APP_JS, 'utf8')

  test('o app.js não requer nem monta o hpp', () => {
    expect(app).not.toMatch(/require\(['"]hpp['"]\)/)
    expect(app).not.toMatch(/app\.use\(\s*hpp\(/)
  })

  test('o app.js explica por que ele não volta', () => {
    expect(app).toMatch(/SEM hpp/)
  })

  test('o hpp não está mais nas dependências', () => {
    const pacote = JSON.parse(fs.readFileSync(PACKAGE_JSON, 'utf8'))

    expect(pacote.dependencies).not.toHaveProperty('hpp')
    expect(pacote.devDependencies || {}).not.toHaveProperty('hpp')
    // Guarda de variância: o objeto lido é o certo, e não um vazio que
    // satisfaria as duas asserções acima sozinho.
    expect(pacote.dependencies).toHaveProperty('express')
  })
})
