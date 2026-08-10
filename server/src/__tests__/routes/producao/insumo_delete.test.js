'use strict'

// OS TRES DELETE DO INSUMO, EXERCITADOS POR HTTP DE VERDADE.
//
// O BURACO QUE ISTO FECHA. Os 55 endpoints DELETE que o core trouxe eram
// conferidos so por VARREDURA DE TEXTO do fonte (`fs.readFileSync` mais
// `toContain`). Uma varredura prova que a linha existe; ela nao prova que a
// linha FAZ o que diz. Um `DELETE` que perdesse a clausula `WHERE`, um
// `verifyPerfil` sem o segundo argumento e uma auditoria movida para fora da
// transacao atravessam os tres inteiros.
//
// AQUI A ROTA E MONTADA NUM EXPRESS DE VERDADE e chamada por supertest. O que se
// afirma e o SQL FORMATADO que chegaria ao PostgreSQL -- pelo mesmo `as.format`
// do driver, que lanca em parametro que falta -- e os valores nomeados do evento
// de auditoria.
//
// COMO A TRANSACAO E PROVADA, ja que nao ha banco: o duble de `tx` entrega uma
// ALCA DIFERENTE da conexao e conta a profundidade. Cada consulta fica gravada
// com a alca por onde entrou e com "estava dentro da transacao". Um
// `auditoriaCtrl.registrar(db.conn, ...)` no lugar de `registrar(t, ...)`, ou um
// registrar movido para depois do `tx`, viram assercao vermelha. O que ele
// continua NAO provando e o ROLLBACK de verdade, que so a suite de banco mede.
//
// ELE NAO ABRE CONEXAO, e por isso cai no pacote `test:rapido`.

const request = require('supertest')

const { db } = require('../../../database')

// O GUARDA DUBLADO GUARDA O QUE RECEBEU.
//
// O DEFAULT AQUI E O MESMO DO `login/verify_perfil.js` DE VERDADE ('acervo'), e
// nao `undefined`: e essa igualdade que faz a rota que esquece o segundo
// argumento aparecer no teste dizendo que cobra perfil no ACERVO, que e
// exatamente o que aconteceria em producao, sem erro e sem nada na tela.
jest.mock('../../../login', () => {
  const { montarContexto } = require('../../../login/contexto')

  const verifyPerfil = (minimo, modulo = 'acervo') => {
    const middleware = (req, res, next) => {
      req.usuarioUuid = '3b241101-e2bb-4255-8caf-4136c566a962'
      // O CONTEXTO E O DE VERDADE, montado pelo mesmo modulo que os guardas
      // usam: assim `rota` no evento de auditoria sai do caminho REALMENTE
      // casado pelo Express, e nao de um texto digitado no teste.
      montarContexto(req, { cliente: 'sca_web' })
      return next()
    }
    middleware.guarda = { minimo, modulo }
    return middleware
  }

  return { verifyPerfil }
})

const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { recusaPor } = require('../../helpers/joi')

const insumoRoute = require('../../../producao/insumo_route')
const insumoSchema = require('../../../producao/insumo_schema')

const USUARIO = '3b241101-e2bb-4255-8caf-4136c566a962'

const app = buildTestApp([{ path: '/api/producao', router: insumoRoute }])

// --- O duble do banco --------------------------------------------------------

let registro = []
let connOriginal

/**
 * Monta a conexao dublada.
 *
 * @param {Array<[string, *]>} respostas pares (trecho do SQL, linhas). O
 *   PRIMEIRO trecho que casar responde, entao a ordem e do mais especifico para
 *   o mais geral. O que nao casa nada devolve lista vazia.
 */
const dublar = (respostas = []) => {
  registro = []
  let profundidade = 0

  const responder = sql => {
    for (const [trecho, linhas] of respostas) {
      if (sql.includes(trecho)) return linhas
    }
    return []
  }

  const alca = via => {
    const anotar = (query, values) => {
      // `as.format` E O MESMO CAMINHO DO DRIVER: ele lanca em parametro que
      // falta, e e o que prende um `$<x>` esquecido na consulta.
      const sql = db.pgp.as.format(query, values)
      registro.push({ via, dentro: profundidade > 0, sql, valores: values })
      return responder(sql)
    }

    const alvo = {
      any: async (q, v) => anotar(q, v),
      one: async (q, v) => anotar(q, v)[0],
      oneOrNone: async (q, v) => {
        const linhas = anotar(q, v)
        return linhas.length > 0 ? linhas[0] : null
      },
      none: async (q, v) => {
        anotar(q, v)
        return null
      },
      map: async (q, v, cb) => anotar(q, v).map(cb),
      tx: async cb => {
        registro.push({ marca: 'tx:inicio' })
        profundidade += 1
        try {
          const r = await cb(alca('tx'))
          registro.push({ marca: 'tx:fim' })
          return r
        } catch (err) {
          registro.push({ marca: 'tx:rollback' })
          throw err
        } finally {
          profundidade -= 1
        }
      },
      task: async cb => cb(alca('task'))
    }

    return alvo
  }

  db.conn = alca('conn')
}

beforeEach(() => {
  connOriginal = db.conn
})

afterEach(() => {
  db.conn = connOriginal
})

// --- Leituras do registro ----------------------------------------------------

const consultas = () => registro.filter(e => e.sql)

const apagamentos = () =>
  consultas().filter(e => e.sql.includes('DELETE FROM'))

const eventos = () =>
  consultas().filter(e => e.sql.includes('INSERT INTO auditoria.evento'))

const normalizar = sql => sql.replace(/\s+/g, ' ').trim()

// --- A guarda ----------------------------------------------------------------

const deletesDoRouter = router =>
  router.stack
    .filter(l => l.route && l.route.methods.delete)
    .map(l => {
      const guarda = l.route.stack
        .map(h => h.handle && h.handle.guarda)
        .find(g => g)
      return { caminho: l.route.path, guarda }
    })

describe('a guarda dos DELETE do insumo', () => {
  // OS TRES DE UMA VEZ, e com o CAMINHO junto: um DELETE novo que nascesse sem
  // guarda, ou com a guarda de outro modulo, quebra esta igualdade em vez de
  // passar despercebido por nao estar em lista nenhuma.
  it('cobra gerente do módulo producao nos três, e são só três', () => {
    expect(deletesDoRouter(insumoRoute)).toEqual([
      { caminho: '/grupo_insumo', guarda: { minimo: 'gerente', modulo: 'producao' } },
      { caminho: '/insumo', guarda: { minimo: 'gerente', modulo: 'producao' } },
      {
        caminho: '/unidade_trabalho/insumos',
        guarda: { minimo: 'gerente', modulo: 'producao' }
      }
    ])
  })
})

// --- DELETE /grupo_insumo ----------------------------------------------------

const GRUPOS_APAGADOS = [
  { id: 7, nome: 'Ortoimagem 2025', disponivel: true },
  { id: 9, nome: 'MDS 2024', disponivel: false }
]

const dublarGrupo = ({ existentes = [{ id: 7 }, { id: 9 }], associado = [] } = {}) =>
  dublar([
    ['DELETE FROM producao.grupo_insumo', GRUPOS_APAGADOS],
    ['SELECT id FROM producao.grupo_insumo', existentes],
    ['WHERE grupo_insumo_id IN', associado]
  ])

describe('DELETE /grupo_insumo', () => {
  it('apaga SÓ os ids pedidos, e a cláusula WHERE é a que foi pedida', async () => {
    dublarGrupo()

    const res = await request(app)
      .delete('/api/producao/grupo_insumo')
      .send({ grupo_insumos_ids: [7, 9] })

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Grupos de insumo excluídos com sucesso')

    // IGUALDADE, e nao `toContain`: um `DELETE` sem `WHERE`, com a lista errada
    // ou contra outra tabela deixa esta linha vermelha.
    expect(apagamentos()).toHaveLength(1)
    expect(normalizar(apagamentos()[0].sql)).toBe(
      'DELETE FROM producao.grupo_insumo WHERE id IN (7,9) RETURNING *'
    )
  })

  it('audita cada linha apagada, DENTRO da transação', async () => {
    dublarGrupo()

    await request(app)
      .delete('/api/producao/grupo_insumo')
      .send({ grupo_insumos_ids: [7, 9] })

    expect(eventos()).toHaveLength(2)

    // A ALCA E A DA TRANSACAO, e nao a conexao: `registrar(db.conn, ...)` no
    // lugar de `registrar(t, ...)` gravaria o rastro por fora, e o rollback da
    // escrita deixaria para tras o evento de uma exclusao que nao aconteceu.
    for (const evento of eventos()) {
      expect(evento.via).toBe('tx')
      expect(evento.dentro).toBe(true)
    }

    expect(eventos().map(e => e.valores.registroId)).toEqual(['7', '9'])

    const primeiro = eventos()[0].valores
    expect(primeiro.operacao).toBe('D')
    expect(primeiro.tabela).toBe('producao.grupo_insumo')
    expect(primeiro.modulo).toBe('producao')
    expect(primeiro.entidadeId).toBe('7')
    expect(primeiro.usuarioUuid).toBe(USUARIO)
    expect(primeiro.origem).toBe('web')
    expect(primeiro.rota).toBe('DELETE /api/producao/grupo_insumo')
    expect(primeiro.dadosDepois).toBeNull()
    expect(JSON.parse(primeiro.dadosAntes).nome).toBe('Ortoimagem 2025')
  })

  it('nenhuma consulta da operação escapa da transação', async () => {
    dublarGrupo()

    await request(app)
      .delete('/api/producao/grupo_insumo')
      .send({ grupo_insumos_ids: [7, 9] })

    expect(consultas().every(e => e.via === 'tx' && e.dentro)).toBe(true)
  })

  // O ALVO INEXISTENTE E RECUSADO ANTES DE QUALQUER ESCRITA: apagar "os que
  // existirem" de uma lista de quatro devolveria sucesso tendo apagado dois.
  it('recusa com 400 quando um id não corresponde a grupo nenhum', async () => {
    dublarGrupo({ existentes: [{ id: 7 }] })

    const res = await request(app)
      .delete('/api/producao/grupo_insumo')
      .send({ grupo_insumos_ids: [7, 9] })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe(
      'Um dos ids informados não corresponde a um grupo de insumo'
    )
    expect(apagamentos()).toEqual([])
    expect(eventos()).toEqual([])
    expect(registro.some(e => e.marca === 'tx:rollback')).toBe(true)
  })

  it('recusa com 400 o grupo que ainda tem insumo dentro', async () => {
    dublarGrupo({ associado: [{ id: 41 }] })

    const res = await request(app)
      .delete('/api/producao/grupo_insumo')
      .send({ grupo_insumos_ids: [7, 9] })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Um dos grupos de insumo possui insumos associados')
    expect(apagamentos()).toEqual([])
  })
})

// --- DELETE /insumo ----------------------------------------------------------

const INSUMOS_APAGADOS = [
  { id: 31, nome: 'Folha SF-23-Y-C', grupo_insumo_id: 7, caminho: null, geom: null },
  { id: 32, nome: 'Folha SF-23-Y-D', grupo_insumo_id: 7, caminho: null, geom: null }
]

const dublarInsumo = ({
  existentes = [{ id: 31 }, { id: 32 }],
  associado = []
} = {}) =>
  dublar([
    ['DELETE FROM producao.insumo', INSUMOS_APAGADOS],
    ['FROM producao.insumo_unidade_trabalho', associado],
    ['SELECT id FROM producao.insumo', existentes]
  ])

describe('DELETE /insumo', () => {
  it('apaga só os ids pedidos e devolve a geometria em EWKT no rastro', async () => {
    dublarInsumo()

    const res = await request(app)
      .delete('/api/producao/insumo')
      .send({ insumo_ids: [31, 32] })

    expect(res.status).toBe(200)
    expect(apagamentos()).toHaveLength(1)

    const sql = normalizar(apagamentos()[0].sql)
    expect(sql).toContain('DELETE FROM producao.insumo WHERE id IN (31,32)')
    // `RETURNING *` numa tabela com coluna geometrica devolveria WKB
    // hexadecimal, e e ele que iria parar no rastro.
    expect(sql).toContain('ST_AsEWKT(geom)::text AS geom')
  })

  // O AGREGADO DO INSUMO E O GRUPO, e nao o proprio insumo: a ficha que alguem
  // abre e a do grupo. Trocar isso manda o evento para uma ficha que ninguem le.
  it('aponta o evento para o GRUPO do insumo, e não para o insumo', async () => {
    dublarInsumo()

    await request(app).delete('/api/producao/insumo').send({ insumo_ids: [31, 32] })

    expect(eventos()).toHaveLength(2)
    expect(eventos().map(e => e.valores.entidadeId)).toEqual(['7', '7'])
    expect(eventos().map(e => e.valores.registroId)).toEqual(['31', '32'])
    expect(eventos().every(e => e.via === 'tx' && e.dentro)).toBe(true)
  })

  it('recusa com 400 quando um id não corresponde a insumo nenhum', async () => {
    dublarInsumo({ existentes: [{ id: 31 }] })

    const res = await request(app)
      .delete('/api/producao/insumo')
      .send({ insumo_ids: [31, 32] })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('Um dos ids informados não corresponde a um insumo')
    expect(apagamentos()).toEqual([])
  })

  // APAGAR O INSUMO NAO DESFAZ A ASSOCIACAO EM SILENCIO: quem quer tira-lo da
  // unidade de trabalho usa a rota propria, que tem evento proprio.
  it('recusa com 400 o insumo que está associado a unidade de trabalho', async () => {
    dublarInsumo({ associado: [{ id: 900 }] })

    const res = await request(app)
      .delete('/api/producao/insumo')
      .send({ insumo_ids: [31, 32] })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe(
      'Um dos insumos está associado a unidades de trabalho'
    )
    expect(apagamentos()).toEqual([])
  })
})

// --- DELETE /unidade_trabalho/insumos ----------------------------------------

const dublarAssociacao = ({
  lotes = [{ lote_id: 55 }],
  contagem = [{ lote_id: 55, associacoes: 7 }]
} = {}) =>
  dublar([
    ['DELETE FROM producao.insumo_unidade_trabalho', contagem],
    ['SELECT DISTINCT ut.lote_id', lotes]
  ])

describe('DELETE /unidade_trabalho/insumos', () => {
  // AS DUAS CONDICOES JUNTAS. Sem a do grupo, a rota apagaria TODA associacao
  // das unidades informadas -- e a resposta seria a mesma.
  it('apaga só as associações do grupo pedido nas unidades pedidas', async () => {
    dublarAssociacao()

    const res = await request(app)
      .delete('/api/producao/unidade_trabalho/insumos')
      .send({ unidade_trabalho_ids: [101, 102], grupo_insumo_id: 3 })

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual({ associacoes: 7 })

    expect(apagamentos()).toHaveLength(1)
    const sql = normalizar(apagamentos()[0].sql)
    expect(sql).toContain('DELETE FROM producao.insumo_unidade_trabalho AS iut')
    expect(sql).toContain('USING producao.insumo AS i')
    expect(sql).toContain('WHERE i.id = iut.insumo_id')
    expect(sql).toContain('AND i.grupo_insumo_id = 3')
    expect(sql).toContain('AND iut.unidade_trabalho_id IN (101,102)')
  })

  it('grava um evento por lote, com o lote como entidade e dentro da transação', async () => {
    dublarAssociacao()

    await request(app)
      .delete('/api/producao/unidade_trabalho/insumos')
      .send({ unidade_trabalho_ids: [101, 102], grupo_insumo_id: 3 })

    expect(eventos()).toHaveLength(1)

    const evento = eventos()[0]
    expect(evento.via).toBe('tx')
    expect(evento.dentro).toBe(true)
    expect(evento.valores.operacao).toBe('D')
    expect(evento.valores.tabela).toBe('producao.insumo_unidade_trabalho')
    // SEM `registro_id`: a operacao nao tem uma linha, tem milhares.
    expect(evento.valores.registroId).toBeNull()
    expect(evento.valores.entidadeId).toBe('55')
    expect(evento.valores.dadosDepois).toBeNull()

    const antes = JSON.parse(evento.valores.dadosAntes)
    expect(antes.grupo_insumo_id).toBe(3)
    expect(antes.associacoes).toBe(7)
    expect(antes.alvo).toBe('2 unidade(s) de trabalho: 101, 102')
  })

  // O TETO DE 20 IDS NO EVENTO (`TETO_IDS_NO_EVENTO`, `insumo_ctrl.js`). Uma
  // desassociacao de bloco alcanca milhares de unidades, e a lista crua dentro
  // de `auditoria.evento` seria maior que a operacao que ela descreve.
  it('resume a lista de unidades no evento quando ela passa de vinte', async () => {
    dublarAssociacao()

    const ids = Array.from({ length: 25 }, (_v, i) => 101 + i)

    await request(app)
      .delete('/api/producao/unidade_trabalho/insumos')
      .send({ unidade_trabalho_ids: ids, grupo_insumo_id: 3 })

    const alvo = JSON.parse(eventos()[0].valores.dadosAntes).alvo

    expect(alvo).toContain('25 unidade(s) de trabalho:')
    // O VIGESIMO ENTRA E O VIGESIMO PRIMEIRO NAO, e o resto vira contagem.
    expect(alvo).toContain('120')
    expect(alvo).not.toContain('121')
    expect(alvo.endsWith('e mais 5')).toBe(true)
  })

  // O TETO E DO EVENTO, E NAO DA OPERACAO: as 25 unidades continuam no `WHERE`.
  it('o teto do evento não encolhe o DELETE', async () => {
    dublarAssociacao()

    const ids = Array.from({ length: 25 }, (_v, i) => 101 + i)

    await request(app)
      .delete('/api/producao/unidade_trabalho/insumos')
      .send({ unidade_trabalho_ids: ids, grupo_insumo_id: 3 })

    expect(apagamentos()[0].sql).toContain(ids.join(','))
  })

  // A CONTAGEM VEM DO BANCO, e nao do tamanho da lista pedida: as unidades sem
  // associacao daquele grupo nao entram na conta.
  it('a contagem do evento é a do banco, e não o tamanho da lista', async () => {
    dublarAssociacao({ contagem: [{ lote_id: 55, associacoes: 2 }] })

    const res = await request(app)
      .delete('/api/producao/unidade_trabalho/insumos')
      .send({ unidade_trabalho_ids: [101, 102, 103], grupo_insumo_id: 3 })

    expect(res.body.dados).toEqual({ associacoes: 2 })
    expect(JSON.parse(eventos()[0].valores.dadosAntes).associacoes).toBe(2)
  })

  // A LEITURA DOS LOTES VEM ANTES DO DELETE, de proposito: depois nao haveria
  // lote a que apontar o evento.
  it('lê os lotes alvo antes de apagar', async () => {
    dublarAssociacao()

    await request(app)
      .delete('/api/producao/unidade_trabalho/insumos')
      .send({ unidade_trabalho_ids: [101], grupo_insumo_id: 3 })

    const ordem = consultas().map(e =>
      e.sql.includes('DELETE FROM') ? 'apaga' : e.sql.includes('SELECT DISTINCT ut.lote_id') ? 'lotes' : 'outra'
    )
    expect(ordem.indexOf('lotes')).toBeLessThan(ordem.indexOf('apaga'))
  })

  it('não inventa evento quando as unidades não pertencem a lote nenhum', async () => {
    dublarAssociacao({ lotes: [], contagem: [] })

    const res = await request(app)
      .delete('/api/producao/unidade_trabalho/insumos')
      .send({ unidade_trabalho_ids: [101], grupo_insumo_id: 3 })

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual({ associacoes: 0 })
    expect(eventos()).toEqual([])
  })
})

// --- Os contratos dos três corpos --------------------------------------------

describe('o corpo dos três DELETE', () => {
  it('recusa a lista vazia com 400, e diz que faltou alvo', async () => {
    dublarGrupo()

    const res = await request(app)
      .delete('/api/producao/grupo_insumo')
      .send({ grupo_insumos_ids: [] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('at least 1 items')
    expect(apagamentos()).toEqual([])
  })

  it('recusa o corpo sem a chave, com 400', async () => {
    dublarInsumo()

    const res = await request(app).delete('/api/producao/insumo').send({})

    expect(res.status).toBe(400)
    expect(apagamentos()).toEqual([])
  })

  // O VALIDADOR E O ESTRITO: chave desconhecida vira 400 com sugestao, em vez de
  // ser descartada em silencio.
  it('recusa a chave desconhecida com 400 e sugere a declarada', async () => {
    dublarInsumo()

    const res = await request(app)
      .delete('/api/producao/insumo')
      .send({ insumo_ids: [31], insumos_ids: [32] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('campo desconhecido')
    expect(res.body.message).toContain('insumo_ids')
    expect(apagamentos()).toEqual([])
  })

  it.each([
    ['a lista vazia', { grupo_insumos_ids: [] }, 'grupo_insumos_ids', 'array.min'],
    ['a chave ausente', {}, 'grupo_insumos_ids', 'any.required'],
    ['o id repetido', { grupo_insumos_ids: [7, 7] }, ['grupo_insumos_ids', 1], 'array.unique'],
    ['o id zero', { grupo_insumos_ids: [0] }, ['grupo_insumos_ids', 0], 'number.positive'],
    ['o id negativo', { grupo_insumos_ids: [-3] }, ['grupo_insumos_ids', 0], 'number.positive']
  ])('o schema do grupo recusa %s pelo motivo certo', (_caso, corpo, campo, tipo) => {
    recusaPor(insumoSchema.grupoInsumoIds.validate(corpo), campo, tipo)
  })

  it.each([
    ['a lista vazia', { insumo_ids: [] }, 'insumo_ids', 'array.min'],
    ['o id fracionário', { insumo_ids: [1.5] }, ['insumo_ids', 0], 'number.integer']
  ])('o schema do insumo recusa %s pelo motivo certo', (_caso, corpo, campo, tipo) => {
    recusaPor(insumoSchema.insumoIds.validate(corpo), campo, tipo)
  })

  // `grupo_insumo_id` E OBRIGATORIO: sem ele a rota apagaria TODA associacao das
  // unidades informadas, e o ramo que fazia isso no SAP era inalcancavel.
  it.each([
    [
      'o grupo ausente',
      { unidade_trabalho_ids: [101] },
      'grupo_insumo_id',
      'any.required'
    ],
    [
      'a lista de unidades vazia',
      { unidade_trabalho_ids: [], grupo_insumo_id: 3 },
      'unidade_trabalho_ids',
      'array.min'
    ]
  ])('o schema da desassociação recusa %s pelo motivo certo', (_caso, corpo, campo, tipo) => {
    recusaPor(insumoSchema.deletaInsumosAssociados.validate(corpo), campo, tipo)
  })
})
