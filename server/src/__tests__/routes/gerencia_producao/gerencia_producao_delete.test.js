'use strict'

// OS NOVE `DELETE` DA GERENCIA DA PRODUCAO, EXERCITADOS POR HTTP.
//
// O QUE ELES APAGAM: a habilitacao (e, em cascata, as etapas dela), a pessoa
// habilitada, a habilitacao de bloco, as duas filas prioritarias, o relatorio de
// alteracao, o plugin e o atalho do QGIS. Nenhum deles pede confirmacao no
// corpo, e a razao e a mesma que `perigo_route.js` escreve para o `DELETE
// /propriedades_camada`: o corpo JA E a lista do que apagar, e o alvo e
// explicito.
//
// O QUE SE PROVA AQUI:
//
//   1. A GUARDA, lida do MIDDLEWARE REGISTRADO. O `verifyPerfil` e dublado por
//      uma funcao que carimba o par (minimo, modulo) na propria middleware,
//      INCLUSIVE o default 'acervo': uma rota que esquecesse o segundo argumento
//      apareceria aqui como `acervo`, e o gerente do acervo -- que nao responde
//      por producao nenhuma -- apagaria a fila prioritaria da Divisao.
//   2. O ALVO, pelo SQL FORMATADO. A assercao e de IGUALDADE com a lista inteira
//      de `DELETE` emitidos: um `WHERE` perdido, a tabela trocada ou uma exclusao
//      a mais deixam o caso vermelho.
//   3. A CONFERENCIA DE EXISTENCIA VEM ANTES de qualquer exclusao. Um id errado
//      no meio da lista nao apaga os anteriores.
//   4. A TRANSACAO e a AUDITORIA, na mesma: cada consulta guarda se havia
//      transacao aberta quando foi emitida.
//   5. O CAMINHO DE ERRO: id inexistente, lista vazia, id repetido, corpo ausente.
//
// ELE NAO ABRE CONEXAO: o banco e um duble que FORMATA cada consulta pelo caminho
// do driver de verdade (`pgp.as.format`, que lanca em parametro que falta). Por
// isso cai no pacote `test:rapido`.

const express = require('express')
const request = require('supertest')

jest.mock('../../../login', () => ({
  verifyPerfil: (minimo, modulo = 'acervo') => {
    const guarda = (req, res, next) => next()
    guarda.exigencia = { minimo, modulo }
    return guarda
  }
}))

const { db } = require('../../../database')

const { errorHandler } = require('../../../utils')

const rota = require('../../../gerencia_producao/gerencia_producao_route')
const gerenciaSchema = require('../../../gerencia_producao/gerencia_producao_schema')

const { recusaPor } = require('../../helpers/joi')

const ATOR = '3b241101-e2bb-4255-8caf-4136c566a962'
const PESSOA = '16fd2706-8baf-433b-82eb-8c7fada847da'

const CONTEXTO = {
  origem: 'web',
  rota: 'DELETE /api/gerencia_producao',
  loteId: null
}

// --- O duble do banco ---------------------------------------------------------

let consultas
let profundidade
let respostas

const responder = (query, values, padrao) => {
  // `as.format` E O MESMO CAMINHO DO DRIVER: ele lanca em parametro que falta.
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
  respostas = {}
})

afterEach(() => {
  db.conn = connOriginal
})

const dublar = mapa => {
  respostas = mapa
}

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
app.use('/api/gerencia_producao', rota)
app.use((err, req, res, next) => errorHandler.log(err, res))

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

const OS_NOVE = [
  ['/habilitacao', 'habilitacao_ids', 'producao.habilitacao'],
  ['/habilitacao_etapa', 'habilitacao_etapa_ids', 'producao.habilitacao_etapa'],
  ['/habilitacao_usuario', 'habilitacao_usuario_ids', 'producao.habilitacao_usuario'],
  ['/habilitacao_bloco', 'habilitacao_bloco_ids', 'producao.habilitacao_bloco'],
  ['/fila_prioritaria', 'fila_prioritaria_ids', 'producao.fila_prioritaria'],
  [
    '/fila_prioritaria_grupo',
    'fila_prioritaria_grupo_ids',
    'producao.fila_prioritaria_grupo'
  ],
  ['/relatorio_alteracao', 'relatorio_alteracao_ids', 'producao.relatorio_alteracao'],
  ['/plugins', 'plugins_ids', 'qgis.plugin'],
  ['/atalhos', 'atalhos_ids', 'qgis.qgis_shortcuts']
]

describe('a guarda das rotas deste arquivo', () => {
  it('são exatamente NOVE rotas DELETE, e não uma a mais', () => {
    const deletes = camadas()
      .filter(c => c.route.methods.delete)
      .map(c => c.route.path)
      .sort()

    expect(deletes).toEqual(OS_NOVE.map(([caminho]) => caminho).sort())
  })

  it.each(OS_NOVE)('DELETE %s cobra gerente no módulo producao', caminho => {
    expect(`${caminho}: ${JSON.stringify(guardaDe('delete', caminho))}`)
      .toBe(`${caminho}: {"minimo":"gerente","modulo":"producao"}`)
  })

  // NAO SO OS NOVE: o arquivo inteiro e gerente em `producao`, e a leitura
  // tambem, porque nao ha leitura inocente aqui.
  it('TODA rota do arquivo cobra gerente no módulo producao', () => {
    const fora = camadas()
      .map(c => {
        const guarda = c.route.stack.map(s => s.handle).find(h => h && h.exigencia)
        const exigencia = guarda ? guarda.exigencia : null
        return { caminho: c.route.path, exigencia }
      })
      .filter(
        r =>
          !r.exigencia ||
          r.exigencia.minimo !== 'gerente' ||
          r.exigencia.modulo !== 'producao'
      )

    expect(fora).toEqual([])
  })
})

// --- Os oito que passam pelo mesmo laço ---------------------------------------

// A LINHA QUE `lerAntes` DEVOLVE precisa trazer a coluna do agregado, senao o
// registro de auditoria recusa o evento ("o agregado dono nao foi resolvido").
const LINHA_DE = {
  'producao.habilitacao': { id: 3, nome: 'Restituidor' },
  'producao.habilitacao_etapa': {
    id: 3,
    habilitacao_id: 5,
    subfase_id: 1,
    tipo_etapa_id: 1,
    prioridade: 1
  },
  'producao.habilitacao_usuario': { id: 3, habilitacao_id: 5, usuario_uuid: PESSOA },
  'producao.habilitacao_bloco': { id: 3, bloco_id: 8, usuario_uuid: PESSOA },
  'producao.fila_prioritaria': {
    id: 3,
    atividade_id: 21,
    usuario_uuid: PESSOA,
    prioridade: 1
  },
  'producao.fila_prioritaria_grupo': {
    id: 3,
    atividade_id: 21,
    habilitacao_id: 5,
    prioridade: 1
  },
  'producao.relatorio_alteracao': {
    id: 3,
    data: '2026-08-09',
    descricao: 'mudou o fluxo'
  },
  'qgis.plugin': { id: 3, nome: 'ferramentas_edicao', versao_minima: '1.2' },
  'qgis.qgis_shortcuts': {
    id: 3,
    ferramenta: 'Mesclar feições selecionadas',
    idioma: 'pt-BR',
    atalho: 'Ctrl+M',
    owner: 'fulano',
    update_time: null
  }
}

const dublarTabela = (tabela, { existem = [3, 4], linha } = {}) =>
  dublar({
    // O AGREGADO DE `habilitacao_bloco` esta a um salto, pelo bloco.
    'FROM producao.bloco WHERE id': { lote_id: 2 },
    [`SELECT id FROM ${tabela} WHERE id IN`]: existem.map(id => ({ id })),
    [`FROM ${tabela} AS t`]: linha !== undefined ? linha : { ...LINHA_DE[tabela] }
  })

// Os OITO que caem direto no laço comum. `/habilitacao` fica de fora porque tem
// cascata e duas barreiras próprias, e ganha um bloco só dela mais abaixo.
const OS_OITO = OS_NOVE.filter(([caminho]) => caminho !== '/habilitacao')

describe.each(OS_OITO)('DELETE %s', (caminho, chave, tabela) => {
  const pedir = corpo =>
    request(app).delete(`/api/gerencia_producao${caminho}`).send(corpo)

  it(`apaga uma linha por id de ${tabela}, e nada além`, async () => {
    dublarTabela(tabela)

    const r = await pedir({ [chave]: [3, 4] })

    expect(r.status).toBe(200)
    // IGUALDADE COM A LISTA INTEIRA: o `WHERE` perdido, a tabela trocada ou uma
    // exclusao a mais deixam este caso vermelho.
    expect(apagou()).toEqual([
      `DELETE FROM ${tabela} WHERE id = 3`,
      `DELETE FROM ${tabela} WHERE id = 4`
    ])
  })

  it('confere que TODOS os ids existem ANTES de apagar qualquer um', async () => {
    dublarTabela(tabela)

    await pedir({ [chave]: [3, 4] })

    expect(textos()[0]).toBe(`SELECT id FROM ${tabela} WHERE id IN (3,4)`)
    // A conferencia e a PRIMEIRA consulta, e vem antes do primeiro DELETE.
    expect(textos().indexOf(`DELETE FROM ${tabela} WHERE id = 3`)).toBeGreaterThan(0)
  })

  it('grava um evento por id, dentro da transação', async () => {
    dublarTabela(tabela)

    await pedir({ [chave]: [3, 4] })

    expect(eventos()).toHaveLength(2)
    expect(eventos().every(e => e.emTransacao)).toBe(true)
    expect(consultas.filter(c => /^\s*DELETE/i.test(c.texto)).every(c => c.emTransacao))
      .toBe(true)
    expect(eventos()[0].texto).toContain(`'${tabela}'`)
    expect(eventos()[0].texto).toContain("'D'")
  })

  it('id que não existe vira 400 dizendo QUAL, e nada é apagado', async () => {
    // O 4 esta na lista pedida e nao volta da conferencia.
    dublarTabela(tabela, { existem: [3] })

    const r = await pedir({ [chave]: [3, 4] })

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('id não encontrado (4)')
    expect(apagou()).toEqual([])
    expect(eventos()).toEqual([])
  })

  it('lista vazia é recusada com 400, antes de qualquer consulta', async () => {
    dublarTabela(tabela)

    const r = await pedir({ [chave]: [] })

    expect(r.status).toBe(400)
    expect(consultas).toEqual([])
  })

  it('id repetido é recusado com 400, antes de qualquer consulta', async () => {
    dublarTabela(tabela)

    const r = await pedir({ [chave]: [3, 3] })

    expect(r.status).toBe(400)
    expect(consultas).toEqual([])
  })

  it('chave desconhecida no corpo é recusada, e nada é apagado', async () => {
    dublarTabela(tabela)

    // O validador e o ESTRITO: o singular no lugar do plural nao e descartado em
    // silencio, e a recusa sugere o nome certo.
    const r = await pedir({ [chave.replace(/_ids$/, '_id')]: [3] })

    expect(r.status).toBe(400)
    expect(consultas).toEqual([])
  })

  it('requisição SEM CORPO nenhum não apaga nada', async () => {
    dublarTabela(tabela)

    const r = await request(app).delete(`/api/gerencia_producao${caminho}`)

    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(escritas()).toEqual([])
  })
})

// --- DELETE /habilitacao: a cascata e as duas barreiras -----------------------

describe('DELETE /habilitacao', () => {
  const pedir = corpo =>
    request(app).delete('/api/gerencia_producao/habilitacao').send(corpo)

  const dublarHabilitacao = ({
    existem = [3],
    comUsuario = [],
    comFila = [],
    etapas = []
  } = {}) =>
    dublar({
      // As TRES dependencias, cada uma com a sua consulta.
      'FROM producao.habilitacao_usuario WHERE habilitacao_id IN': comUsuario,
      'FROM producao.fila_prioritaria_grupo WHERE habilitacao_id IN': comFila,
      'FROM producao.habilitacao_etapa WHERE habilitacao_id IN': etapas,
      'SELECT id FROM producao.habilitacao_etapa WHERE id IN': etapas,
      'SELECT id FROM producao.habilitacao WHERE id IN': existem.map(id => ({ id })),
      'FROM producao.habilitacao_etapa AS t': {
        id: 9,
        habilitacao_id: 3,
        subfase_id: 1,
        tipo_etapa_id: 1,
        prioridade: 1
      },
      'FROM producao.habilitacao AS t': { id: 3, nome: 'Restituidor' }
    })

  // A PESSOA VINCULADA BARRA, e nao cai em cascata: apagar em cascata tiraria
  // gente de trabalho sem aviso nenhum na tela.
  it('a habilitação com pessoa vinculada é recusada, e nada é apagado', async () => {
    dublarHabilitacao({ comUsuario: [{ id: 1 }] })

    const r = await pedir({ habilitacao_ids: [3] })

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('pessoa vinculada')
    expect(apagou()).toEqual([])
    expect(eventos()).toEqual([])
  })

  // A FILA DE GRUPO BARRA pelo mesmo motivo: desfaria furo de fila que alguem
  // decidiu.
  it('a habilitação com fila prioritária de grupo é recusada, e nada é apagado', async () => {
    dublarHabilitacao({ comFila: [{ id: 1 }] })

    const r = await pedir({ habilitacao_ids: [3] })

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('fila prioritária de grupo')
    expect(apagou()).toEqual([])
  })

  // A ETAPA CAI JUNTO, e ANTES: ela e configuracao da propria habilitacao, e a
  // ordem inversa morreria na chave estrangeira.
  it('as etapas caem em cascata, e antes da habilitação', async () => {
    dublarHabilitacao({ etapas: [{ id: 9 }, { id: 10 }] })

    const r = await pedir({ habilitacao_ids: [3] })

    expect(r.status).toBe(200)
    expect(apagou()).toEqual([
      'DELETE FROM producao.habilitacao_etapa WHERE id = 9',
      'DELETE FROM producao.habilitacao_etapa WHERE id = 10',
      'DELETE FROM producao.habilitacao WHERE id = 3'
    ])
    // TRES eventos: as duas etapas e a habilitacao, todos na mesma transacao.
    expect(eventos()).toHaveLength(3)
    expect(eventos().every(e => e.emTransacao)).toBe(true)
  })

  // A CASCATA VAZIA E O CASO COMUM, e e ela que o `ids.length === 0` de
  // `apagarVarios` protege: sem a saida antecipada, `$<ids:csv>` de uma lista
  // vazia viraria `IN ()`, que e erro de sintaxe do Postgres e chegaria como 500
  // numa exclusao que estava certa.
  it('habilitação sem etapa nenhuma apaga só ela, sem montar IN ()', async () => {
    dublarHabilitacao({ etapas: [] })

    const r = await pedir({ habilitacao_ids: [3] })

    expect(r.status).toBe(200)
    expect(apagou()).toEqual(['DELETE FROM producao.habilitacao WHERE id = 3'])
    // A CONSULTA QUE NAO EXISTE: nenhuma consulta do pedido carrega `IN ()`.
    expect(textos().filter(t => t.includes('IN ()'))).toEqual([])
  })

  it('a conferência de existência vem antes das três dependências', async () => {
    dublarHabilitacao({ etapas: [] })

    await pedir({ habilitacao_ids: [3] })

    expect(textos()[0]).toBe('SELECT id FROM producao.habilitacao WHERE id IN (3)')
  })

  it('id que não existe vira 400, e nem a dependência é consultada', async () => {
    dublarHabilitacao({ existem: [] })

    const r = await pedir({ habilitacao_ids: [3] })

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('Habilitação: id não encontrado (3)')
    expect(apagou()).toEqual([])
  })
})

// --- O veredito sobre a lista VAZIA e o `IN ()` -------------------------------

describe('a lista de ids vazia nunca chega ao banco', () => {
  // A REVISAO AFIRMOU: "todas as listas de ids tem `.min(1)`, e `$<ids:csv>`
  // vazio gera `IN ()`, que e erro de sintaxe e nunca `WHERE true`". Os dois
  // lados sao verificaveis, e este bloco os verifica.

  const AS_LISTAS = OS_NOVE.map(([caminho, chave]) => [
    chave,
    // `habilitacao_ids` -> `habilitacaoIds`, o nome do schema.
    chave.replace(/_ids$/, '').replace(/_(\w)/g, (_m, c) => c.toUpperCase()) + 'Ids',
    caminho
  ])

  it.each(AS_LISTAS)('%s recusa a lista vazia por array.min', (chave, schema) => {
    recusaPor(gerenciaSchema[schema].validate({ [chave]: [] }), chave, 'array.min')
  })

  it.each(AS_LISTAS)('%s recusa o id repetido por array.unique', (chave, schema) => {
    recusaPor(
      gerenciaSchema[schema].validate({ [chave]: [3, 3] }),
      [chave, 1],
      'array.unique'
    )
  })

  // O SEGUNDO LADO DA AFIRMACAO. `IN ()` e erro de sintaxe do PostgreSQL: uma
  // lista vazia que passasse produziria 500, e NUNCA um `WHERE` verdadeiro que
  // apagasse a tabela inteira. E a diferenca entre um susto e uma perda total.
  it('$<ids:csv> vazio produz IN (), que é erro de sintaxe e não WHERE true', () => {
    const sql = db.pgp.as.format(
      'SELECT id FROM producao.habilitacao WHERE id IN ($<ids:csv>)',
      { ids: [] }
    )

    expect(sql).toBe('SELECT id FROM producao.habilitacao WHERE id IN ()')
    expect(sql).not.toMatch(/WHERE\s+true/i)
    expect(sql).not.toBe('SELECT id FROM producao.habilitacao')
  })
})
