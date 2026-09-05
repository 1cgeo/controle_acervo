'use strict'

// O BLOCO E A UNIDADE DE TRABALHO SAO DO MESMO LOTE, e ninguem no banco cobra.
//
// O QUE ISTO PRENDE. `producao.bloco` aponta `acervo.lote`,
// `producao.unidade_trabalho` aponta o lote E o bloco, e nenhum CHECK amarra os
// dois: o `chk_bloco_status` olha so o status do lote DO BLOCO, e o
// `atividade_verifica_subfase` compara a etapa com a unidade de trabalho.
//
// O ESTRAGO DE UMA UT DO LOTE A NUM BLOCO DO LOTE B e silencioso e triplo:
// `distribuicao/sql/calcula_fila.sql` entrega aquela atividade a quem tem
// `producao.habilitacao_bloco` no bloco do lote B; `acompanhamento.bloco` soma a
// geometria dela na ficha do lote B; e `chk_lote_status` deixa o lote A ser
// encerrado sem enxergar aquele trabalho, porque o bloco que o seguraria e do
// outro lote.
//
// SAO TRES PORTAS, e as tres conferem: a criacao em massa (`POST
// /unidade_trabalho`), a mudanca de bloco (`PUT /unidade_trabalho/bloco`) e a
// mudanca de lote do proprio bloco (`PUT /bloco`), que arrastaria as unidades
// dele sem tocar nelas.
//
// A CONFERENCIA E SQL, E ISSO E PARTE DO CASO: `lote_id` e BIGINT e o driver o
// devolve como TEXTO. Comparar em JavaScript com o numero do corpo daria
// diferente SEMPRE, e a guarda recusaria tudo.
//
// A ROTA E MONTADA NUM EXPRESS DE VERDADE e chamada por supertest; o duble do
// banco devolve linhas por trecho de SQL. Ele nao abre conexao, e por isso este
// arquivo cai no pacote rapido.

const request = require('supertest')

const { db } = require('../../../database')

jest.mock('../../../login', () => {
  const { montarContexto } = require('../../../login/contexto')

  const verifyPerfil = (minimo, modulo = 'acervo') => {
    const middleware = (req, res, next) => {
      req.usuarioUuid = '3b241101-e2bb-4255-8caf-4136c566a962'
      montarContexto(req, { cliente: 'sca_web' })
      return next()
    }
    middleware.guarda = { minimo, modulo }
    return middleware
  }

  return { verifyPerfil }
})

const { buildTestApp } = require('../../helpers/orcamento/testApp')

const trabalhoRoute = require('../../../producao/trabalho_route')

const app = buildTestApp([{ path: '/api/producao', router: trabalhoRoute }])

// --- O duble do banco --------------------------------------------------------

let registro = []
let connOriginal

const dublar = (respostas = []) => {
  registro = []

  const responder = sql => {
    for (const [trecho, linhas] of respostas) {
      if (sql.includes(trecho)) return linhas
    }
    return []
  }

  const alca = () => {
    const anotar = (query, values) => {
      const sql = db.pgp.as.format(query, values)
      registro.push({ sql })
      return responder(sql)
    }

    return {
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
      tx: async cb => cb(alca()),
      task: async cb => cb(alca())
    }
  }

  db.conn = alca()
}

beforeEach(() => {
  connOriginal = db.conn
})

afterEach(() => {
  db.conn = connOriginal
})

const escreveu = trecho => registro.some(e => e.sql.includes(trecho))

// --- As peças do corpo -------------------------------------------------------

const GEOM = 'SRID=4674;POLYGON((-51 -30,-51 -29,-50 -29,-50 -30,-51 -30))'

const unidade = extra => ({
  nome: 'MI 2965-1-NE',
  epsg: '31982',
  geom: GEOM,
  dado_producao_id: 3,
  bloco_id: 8,
  prioridade: 1,
  ...extra
})

const UT_GRAVADA = {
  id: 71,
  nome: 'MI 2965-1-NE',
  epsg: '31982',
  lote_id: 55,
  bloco_id: 8,
  subfase_id: 4,
  geom: GEOM
}

// --- POST /unidade_trabalho --------------------------------------------------

describe('POST /unidade_trabalho: o bloco de cada linha é do lote do corpo', () => {
  it('recusa quando o bloco informado é de outro lote, e não insere nada', async () => {
    dublar([
      ['b.lote_id <>', [{ id: 8, nome: 'Bloco Norte', lote_id: 99 }]]
    ])

    const res = await request(app)
      .post('/api/producao/unidade_trabalho')
      .send({
        unidades_trabalho: [unidade()],
        subfase_ids: [4],
        lote_id: 55
      })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('Bloco Norte')
    expect(res.body.message).toContain('mesmo lote')
    // A RECUSA VEM ANTES DA PRIMEIRA INSERCAO, e nao depende do ROLLBACK: a
    // carga de um lote inteiro escreve milhares de linhas antes de chegar la.
    expect(escreveu('INSERT INTO producao.unidade_trabalho')).toBe(false)
  })

  it('a conferência pergunta uma vez só, com a lista de blocos distintos', async () => {
    dublar([
      ['b.lote_id <>', [{ id: 8, nome: 'Bloco Norte', lote_id: 99 }]]
    ])

    await request(app)
      .post('/api/producao/unidade_trabalho')
      .send({
        unidades_trabalho: [unidade(), unidade({ bloco_id: 8 }), unidade({ bloco_id: 9 })],
        subfase_ids: [4],
        lote_id: 55
      })

    const guardas = registro.filter(e => e.sql.includes('b.lote_id <>'))
    expect(guardas).toHaveLength(1)
    expect(guardas[0].sql).toContain('b.id IN (8,9)')
    expect(guardas[0].sql).toContain('b.lote_id <> 55')
  })

  it('deixa passar quando todos os blocos são do lote', async () => {
    dublar([
      ['INSERT INTO producao.unidade_trabalho', [UT_GRAVADA]]
    ])

    const res = await request(app)
      .post('/api/producao/unidade_trabalho')
      .send({
        unidades_trabalho: [unidade()],
        subfase_ids: [4],
        lote_id: 55
      })

    expect(res.status).toBe(201)
    expect(res.body.dados).toEqual({ unidade_trabalho_ids: [71] })
    expect(escreveu('INSERT INTO auditoria.evento')).toBe(true)
  })
})

// --- PUT /unidade_trabalho/bloco ---------------------------------------------

describe('PUT /unidade_trabalho/bloco: o bloco de destino é do lote das unidades', () => {
  it('recusa quando alguma unidade é de outro lote, e não atualiza nada', async () => {
    dublar([
      ['ut.lote_id <> b.lote_id', [{ id: 71, lote_id: 55 }]]
    ])

    const res = await request(app)
      .put('/api/producao/unidade_trabalho/bloco')
      .send({ unidade_trabalho_ids: [71, 72], bloco_id: 8 })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('71 (lote 55)')
    expect(escreveu('UPDATE producao.unidade_trabalho')).toBe(false)
  })

  it('deixa passar quando lote e bloco concordam', async () => {
    dublar([
      ['FROM producao.unidade_trabalho AS t', [UT_GRAVADA]],
      ['UPDATE producao.unidade_trabalho', [UT_GRAVADA]]
    ])

    const res = await request(app)
      .put('/api/producao/unidade_trabalho/bloco')
      .send({ unidade_trabalho_ids: [71], bloco_id: 8 })

    expect(res.status).toBe(200)
    expect(escreveu('UPDATE producao.unidade_trabalho')).toBe(true)
  })
})

// --- PUT /bloco --------------------------------------------------------------

describe('PUT /bloco: mudar o lote do bloco não arrasta unidade de outro lote', () => {
  const BLOCO_ANTES = {
    id: 4,
    nome: 'Bloco Sul',
    lote_id: 55,
    prioridade: 1,
    status_execucao_id: 2
  }

  const corpo = loteId => ({
    blocos: [
      {
        id: 4,
        nome: 'Bloco Sul',
        prioridade: 1,
        lote_id: loteId,
        status_execucao_id: 2
      }
    ]
  })

  it('recusa quando o bloco tem unidade de trabalho de outro lote', async () => {
    dublar([
      ['FROM producao.bloco AS t', [BLOCO_ANTES]],
      ['ut.bloco_id = 4 AND ut.lote_id <> 99', [{ id: 71 }]]
    ])

    const res = await request(app).put('/api/producao/bloco').send(corpo(99))

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('71')
    expect(escreveu('UPDATE producao.bloco')).toBe(false)
  })

  // O CASO NEGATIVO, que é o que prende a guarda no lugar certo: `camposBloco`
  // exige `lote_id` sempre, então renomear ou repriorizar um bloco manda o
  // mesmo lote de sempre. Se a guarda não comparasse com o `antes`, um bloco
  // que já carrega unidade de outro lote (dado herdado da carga) ficaria
  // ineditável, e a recusa falaria de uma mudança de lote que não acontece.
  it('não pergunta nada quando o lote do bloco não muda', async () => {
    dublar([
      ['FROM producao.bloco AS t', [BLOCO_ANTES]],
      ['ut.bloco_id = 4 AND ut.lote_id <> 55', [{ id: 71 }]],
      ['UPDATE producao.bloco', [{ ...BLOCO_ANTES, nome: 'Bloco Sul II' }]]
    ])

    const res = await request(app)
      .put('/api/producao/bloco')
      .send({ blocos: [{ ...corpo(55).blocos[0], nome: 'Bloco Sul II' }] })

    expect(res.status).toBe(200)
    expect(escreveu('FROM producao.unidade_trabalho AS ut')).toBe(false)
    expect(escreveu('UPDATE producao.bloco')).toBe(true)
  })

  it('deixa passar quando as unidades já são do lote de destino', async () => {
    dublar([
      ['FROM producao.bloco AS t', [BLOCO_ANTES]],
      ['UPDATE producao.bloco', [{ ...BLOCO_ANTES, lote_id: 99 }]]
    ])

    const res = await request(app).put('/api/producao/bloco').send(corpo(99))

    expect(res.status).toBe(200)
    expect(escreveu('UPDATE producao.bloco')).toBe(true)
  })
})

// --- POST /atividades --------------------------------------------------------
//
// A MENSAGEM DE ZERO LINHAS NOMEIA AS DUAS CAUSAS. O `INNER JOIN ... ON
// e.subfase_id = ut.subfase_id AND e.lote_id = ut.lote_id` do INSERT descarta em
// silencio a etapa que nao e da subfase e do lote das unidades pedidas, e a
// origem descrevia isso como "ja existem" -- quem escolheu etapa de uma subfase
// e unidade de outra ia procurar atividade que nao ha.

describe('POST /atividades: o que a resposta diz quando nada foi criado', () => {
  it('404 com o id quando a unidade de trabalho não existe', async () => {
    dublar([])

    const res = await request(app)
      .post('/api/producao/atividades')
      .send({ unidade_trabalho_ids: [71], etapa_ids: [9] })

    expect(res.status).toBe(404)
    expect(res.body.message).toContain('71')
    expect(escreveu('INSERT INTO producao.atividade')).toBe(false)
  })

  it('400 dizendo que falta versão do acervo quando a unidade não tem nenhuma', async () => {
    dublar([
      ['LEFT JOIN producao.relacionamento_versao', [{ id: 71, versoes: 0 }]]
    ])

    const res = await request(app)
      .post('/api/producao/atividades')
      .send({ unidade_trabalho_ids: [71], etapa_ids: [9] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('versão do acervo')
  })

  it('400 nomeando as DUAS causas quando nada casou', async () => {
    dublar([
      ['LEFT JOIN producao.relacionamento_versao', [{ id: 71, versoes: 2 }]]
    ])

    const res = await request(app)
      .post('/api/producao/atividades')
      .send({ unidade_trabalho_ids: [71], etapa_ids: [9] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('já existem')
    expect(res.body.message).toContain('mesma subfase e do mesmo lote')
  })
})
