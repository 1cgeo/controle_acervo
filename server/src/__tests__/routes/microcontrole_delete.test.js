'use strict'

// O UNICO `DELETE` DO MICROCONTROLE, EXERCITADO POR HTTP.
//
// `DELETE /api/microcontrole/configuracao/perfil_monitoramento` desliga o
// monitoramento de uma subfase de um lote. Ele e a UNICA exclusao do modulo, e
// vive no BANCO PRINCIPAL: a telemetria (o outro banco) nao tem PUT nem DELETE,
// e o GRANT de la so da SELECT e INSERT.
//
// O QUE SE PROVA AQUI:
//
//   1. A GUARDA, lida do MIDDLEWARE REGISTRADO e nao de uma expressao regular. A
//      PASTA e `microcontrole` e o MODULO e `producao`, como `src/campo/` cobra
//      `pit`. O `verifyPerfil` dublado carimba o par (minimo, modulo) na propria
//      middleware, INCLUSIVE o default 'acervo': a rota que esquecesse o segundo
//      argumento apareceria aqui como `acervo`.
//   2. O ALVO, pelo SQL FORMATADO que chegaria ao PostgreSQL: um `WHERE` perdido
//      ou a coluna trocada por `lote_id` deixam o caso vermelho.
//   3. A TRANSACAO e a AUDITORIA, na mesma. O cadastro AUDITA (a telemetria nao,
//      e a assimetria e decidida): alguem DECIDIU desligar o monitoramento de um
//      lote, num dia, e responde por isso.
//   4. O CAMINHO DE ERRO: id inexistente, lista vazia, id repetido, corpo ausente.
//
// ELE NAO ABRE CONEXAO: o banco e um duble que FORMATA cada consulta pelo caminho
// do driver de verdade (`pgp.as.format`, que lanca em parametro que falta). Por
// isso cai no pacote `test:rapido`.

const express = require('express')
const request = require('supertest')

jest.mock('../../login', () => ({
  verifyPerfil: (minimo, modulo = 'acervo') => {
    const guarda = (req, res, next) => next()
    guarda.exigencia = { minimo, modulo }
    return guarda
  }
}))

const { db } = require('../../database')

const { errorHandler } = require('../../utils')

const rota = require('../../microcontrole/microcontrole_route')
const microcontroleSchema = require('../../microcontrole/microcontrole_schema')

const { recusaPor } = require('../helpers/joi')

const ATOR = '3b241101-e2bb-4255-8caf-4136c566a962'

const CONTEXTO = {
  origem: 'web',
  rota: 'DELETE /api/microcontrole/configuracao/perfil_monitoramento',
  loteId: 2
}

const CAMINHO = '/api/microcontrole/configuracao/perfil_monitoramento'

// A linha que `lerAntes` devolve. `lote_id` e o AGREGADO: sem ele o registro de
// auditoria recusa o evento ("o agregado dono nao foi resolvido").
const LINHA = { id: 3, tipo_monitoramento_id: 1, subfase_id: 4, lote_id: 2 }

// --- O duble do banco ---------------------------------------------------------

let consultas
let profundidade
let respostas

const responder = (query, values, padrao) => {
  const texto = db.pgp.as.format(query, values)
  consultas.push({ texto, emTransacao: profundidade > 0 })
  for (const [marca, valor] of Object.entries(respostas)) {
    if (texto.includes(marca)) {
      return typeof valor === 'function' ? valor(texto) : valor
    }
  }
  return padrao
}

const conn = {
  any: async (q, v) => responder(q, v, []),
  one: async (q, v) => responder(q, v, {}),
  oneOrNone: async (q, v) => responder(q, v, null),
  none: async (q, v) => {
    responder(q, v, null)
    return null
  },
  result: async (q, v) => responder(q, v, { rowCount: 0 }),
  tx: async cb => {
    profundidade += 1
    try {
      return await cb(conn)
    } finally {
      profundidade -= 1
    }
  },
  task: async cb => cb(conn)
}

let connOriginal

beforeEach(() => {
  connOriginal = db.conn
  db.conn = conn
  consultas = []
  profundidade = 0
  respostas = { 'FROM microcontrole.perfil_monitoramento AS t': { ...LINHA } }
})

afterEach(() => {
  db.conn = connOriginal
})

const textos = () => consultas.map(c => c.texto)

const escritas = () =>
  textos().filter(t => /^\s*(DELETE|UPDATE|INSERT)/i.test(t.trim()))

const apagou = () => textos().filter(t => /^\s*DELETE/i.test(t.trim()))

const eventos = () =>
  consultas.filter(c => c.texto.includes('INSERT INTO auditoria.evento'))

// --- O app --------------------------------------------------------------------

const app = express()
app.use(express.json())
app.use((req, res, next) => {
  req.usuarioUuid = ATOR
  req.contexto = CONTEXTO
  res.sendJsonAndLog = (sucesso, mensagem, status, dados = null) =>
    res.status(status).json({ success: sucesso, message: mensagem, dados })
  next()
})
app.use('/api/microcontrole', rota)
app.use((err, req, res, next) => errorHandler.log(err, res))

const pedir = corpo => request(app).delete(CAMINHO).send(corpo)

// --- A guarda -----------------------------------------------------------------

const camadas = () => rota.stack.filter(c => c.route)

const guardaDe = (metodo, caminho) => {
  const camada = camadas().find(
    c => c.route.path === caminho && c.route.methods[metodo]
  )
  if (!camada) return null
  const guarda = camada.route.stack.map(s => s.handle).find(h => h && h.exigencia)
  return guarda ? guarda.exigencia : null
}

describe('a guarda do único DELETE do microcontrole', () => {
  it('é o único DELETE do arquivo', () => {
    const deletes = camadas().filter(c => c.route.methods.delete).map(c => c.route.path)
    expect(deletes).toEqual(['/configuracao/perfil_monitoramento'])
  })

  it('cobra gerente no módulo producao, e não no acervo', () => {
    expect(JSON.stringify(guardaDe('delete', '/configuracao/perfil_monitoramento')))
      .toBe('{"minimo":"gerente","modulo":"producao"}')
  })

  // A LEITURA IRMA E `consulta`, e a assimetria e decidida (chefe, 2026-08-09):
  // no modulo `producao` o visualizador VE TUDO e nao modifica nada. Se as duas
  // fossem iguais, uma delas estaria errada.
  it('a leitura irmã continua em consulta, e a escrita não desceu com ela', () => {
    expect(guardaDe('get', '/configuracao/perfil_monitoramento'))
      .toEqual({ minimo: 'consulta', modulo: 'producao' })
  })

  // A ARMADILHA DO `CLAUDE.md`: o default de `verifyPerfil` e 'acervo'. A PASTA
  // e `microcontrole` e o MODULO e `producao`, e nenhuma rota do arquivo pode
  // cair no default.
  it('NENHUMA rota do arquivo caiu no default acervo', () => {
    const fora = camadas()
      .map(c => {
        const guarda = c.route.stack.map(s => s.handle).find(h => h && h.exigencia)
        return { caminho: c.route.path, modulo: guarda && guarda.exigencia.modulo }
      })
      .filter(r => r.modulo !== 'producao')

    expect(fora).toEqual([])
  })
})

// --- O alvo -------------------------------------------------------------------

describe('DELETE /configuracao/perfil_monitoramento', () => {
  it('apaga uma linha por id, e nada além delas', async () => {
    const r = await pedir({ perfis_monitoramento_ids: [3, 8] })

    expect(r.status).toBe(200)
    // IGUALDADE COM A LISTA INTEIRA: o `WHERE` perdido apagaria o monitoramento
    // da Divisao inteira, e a coluna trocada por `lote_id` apagaria o lote errado.
    expect(apagou()).toEqual([
      'DELETE FROM microcontrole.perfil_monitoramento WHERE id = 3',
      'DELETE FROM microcontrole.perfil_monitoramento WHERE id = 8'
    ])
  })

  it('lê o estado anterior antes de apagar cada linha', async () => {
    await pedir({ perfis_monitoramento_ids: [3] })

    // A leitura vem PRIMEIRO: ela e o unico registro que sobra da linha apagada.
    expect(textos()[0]).toContain('FROM microcontrole.perfil_monitoramento AS t')
    expect(textos()[0]).toContain('WHERE t.id = 3')
    expect(textos()[1]).toBe(
      'DELETE FROM microcontrole.perfil_monitoramento WHERE id = 3'
    )
  })

  it('grava um evento por id, dentro da transação', async () => {
    await pedir({ perfis_monitoramento_ids: [3, 8] })

    expect(eventos()).toHaveLength(2)
    expect(eventos().every(e => e.emTransacao)).toBe(true)
    expect(consultas.filter(c => /^\s*DELETE/i.test(c.texto)).every(c => c.emTransacao))
      .toBe(true)
    expect(eventos()[0].texto).toContain("'microcontrole.perfil_monitoramento'")
    expect(eventos()[0].texto).toContain("'D'")
    // O AGREGADO E O LOTE: o rastro cai na ficha do lote, e nao numa ficha de
    // configuracao que ninguem abre.
    expect(eventos()[0].texto).toContain("'lote'")
  })

  it('id inexistente vira 404 e NADA é apagado', async () => {
    respostas = { 'FROM microcontrole.perfil_monitoramento AS t': null }

    const r = await pedir({ perfis_monitoramento_ids: [3, 8] })

    expect(r.status).toBe(404)
    expect(r.body.message).toContain('perfil de monitoramento')
    expect(apagou()).toEqual([])
    expect(eventos()).toEqual([])
  })

  it('lista vazia é recusada com 400, antes de qualquer consulta', async () => {
    const r = await pedir({ perfis_monitoramento_ids: [] })

    expect(r.status).toBe(400)
    expect(consultas).toEqual([])
  })

  it('id repetido é recusado com 400, antes de qualquer consulta', async () => {
    const r = await pedir({ perfis_monitoramento_ids: [3, 3] })

    expect(r.status).toBe(400)
    expect(consultas).toEqual([])
  })

  it('id como texto é recusado, porque o número é ESTRITO', async () => {
    const r = await pedir({ perfis_monitoramento_ids: ['3'] })

    expect(r.status).toBe(400)
    expect(consultas).toEqual([])
  })

  it('chave desconhecida no corpo é recusada, e nada é apagado', async () => {
    const r = await pedir({ perfil_monitoramento_ids: [3] })

    expect(r.status).toBe(400)
    expect(consultas).toEqual([])
  })

  it('requisição SEM CORPO nenhum não apaga nada', async () => {
    const r = await request(app).delete(CAMINHO)

    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(escritas()).toEqual([])
  })
})

// --- O veredito sobre a lista VAZIA e o `IN ()` -------------------------------

describe('a lista de ids vazia nunca chega ao banco', () => {
  // A LISTA VAZIA E RECUSADA PELO `array.min`, que e o motivo certo. Ate
  // 2026-08-09 nao era: o item levava `.required()`, e com ele a lista vazia
  // reprovava por `array.includesRequiredUnknowns` ("does not contain 1 required
  // value(s)") ANTES de o `array.min` ser avaliado -- uma mensagem que falava de
  // um valor obrigatorio que ninguem declarou. Este caso pinava o motivo errado
  // para ficar vermelho no dia do conserto, e foi o que aconteceu.
  //
  // `gerencia_producao_schema.js` documenta a armadilha no `listaDeIds()` e
  // `perigo_schema.js` tambem a evita; esta era a ultima que faltava. Tirar o
  // `.required()` do item nao muda o que se ACEITA: `Joi.number()` ja recusa nulo
  // por si, e o caso abaixo prova isso.
  it('recusa a lista vazia por array.min, que é o motivo certo', () => {
    recusaPor(
      microcontroleSchema.perfilMonitoramentoIds.validate({
        perfis_monitoramento_ids: []
      }),
      'perfis_monitoramento_ids',
      'array.min'
    )
  })

  // O QUE A RETIRADA DO `.required()` NAO AFROUXOU: nulo dentro da lista continua
  // recusado, e pelo motivo do TIPO. Sem este caso, "tirar o `.required()`"
  // pareceria ter aberto a porta para `[null]`.
  it('nulo dentro da lista continua recusado', () => {
    recusaPor(
      microcontroleSchema.perfilMonitoramentoIds.validate({
        perfis_monitoramento_ids: [null]
      }),
      ['perfis_monitoramento_ids', 0],
      'number.base'
    )
  })

  // O CONTROLADOR DESTA ROTA NEM MONTA `IN`: ele apaga id a id. Mesmo assim a
  // afirmacao da revisao vale para o modulo inteiro, e ela e verificavel: `IN ()`
  // e erro de sintaxe do PostgreSQL, e NUNCA um `WHERE` verdadeiro que apagasse
  // a tabela toda.
  it('$<ids:csv> vazio produz IN (), que é erro de sintaxe e não WHERE true', () => {
    const sql = db.pgp.as.format(
      'DELETE FROM microcontrole.perfil_monitoramento WHERE id IN ($<ids:csv>)',
      { ids: [] }
    )

    expect(sql).toBe('DELETE FROM microcontrole.perfil_monitoramento WHERE id IN ()')
    expect(sql).not.toMatch(/WHERE\s+true/i)
    expect(sql).not.toBe('DELETE FROM microcontrole.perfil_monitoramento')
  })

  it('o controlador apaga id a id, e não por lista', async () => {
    await pedir({ perfis_monitoramento_ids: [3, 8] })

    expect(textos().filter(t => t.includes('IN ('))).toEqual([])
  })
})
