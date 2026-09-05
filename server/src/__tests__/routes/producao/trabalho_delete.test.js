'use strict'

// OS CINCO DELETE DO TRABALHO, EXERCITADOS POR HTTP DE VERDADE.
//
// O BURACO QUE ISTO FECHA. As 22 rotas desta fatia eram conferidas so por
// varredura de TEXTO do fonte (`fs.readFileSync` mais `toContain`), que prova
// que a linha existe e nao que ela faz o que diz. Nesta fatia o que uma
// varredura nao alcanca e caro:
//
//   1. `DELETE /atividades` so pode apagar o que esta 'Nao iniciada' (code 1).
//      Perdido o `AND tipo_situacao_atividade_id`, a rota apagaria trabalho em
//      execucao, pausado e FINALIZADO -- e responderia "excluidas com sucesso".
//   2. `DELETE /unidade_trabalho/atividades` alcanca DOIS codes (1 e 5), e nao
//      um: a 'Nao finalizada' e o registro de tentativa que nao vingou.
//   3. `DELETE /unidade_trabalho` apaga a associacao de insumo ANTES da unidade,
//      e as duas com o `WHERE` da unidade pedida.
//
// AQUI A ROTA E MONTADA NUM EXPRESS DE VERDADE e chamada por supertest. O que se
// afirma e o SQL FORMATADO que chegaria ao PostgreSQL -- pelo mesmo `as.format`
// do driver, que lanca em parametro que falta.
//
// COMO A TRANSACAO E PROVADA, ja que nao ha banco: o duble de `tx` entrega uma
// ALCA DIFERENTE da conexao e conta a profundidade, e cada consulta fica gravada
// com a alca por onde entrou. Auditoria movida para fora da transacao vira
// assercao vermelha. O ROLLBACK de verdade so a suite de banco mede.
//
// ELE NAO ABRE CONEXAO, e por isso cai no pacote `test:rapido`.

const request = require('supertest')

const { db } = require('../../../database')

const { SITUACAO_ATIVIDADE } = require('../../../utils/domain_constants')

// O DEFAULT DO GUARDA DUBLADO E O MESMO DO `login/verify_perfil.js` DE VERDADE
// ('acervo'): e essa igualdade que faz a rota que esquece o segundo argumento
// aparecer aqui dizendo que cobra perfil no ACERVO, como aconteceria em
// producao -- sem erro de sintaxe e sem nada na tela.
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
const { recusaPor } = require('../../helpers/joi')

const trabalhoRoute = require('../../../producao/trabalho_route')
const trabalhoSchema = require('../../../producao/trabalho_schema')

const app = buildTestApp([{ path: '/api/producao', router: trabalhoRoute }])

// --- O duble do banco --------------------------------------------------------

let registro = []
let connOriginal

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
      const sql = db.pgp.as.format(query, values)
      registro.push({ via, dentro: profundidade > 0, sql, valores: values })
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
  }

  db.conn = alca('conn')
}

beforeEach(() => {
  connOriginal = db.conn
})

afterEach(() => {
  db.conn = connOriginal
})

const consultas = () => registro.filter(e => e.sql)

const apagamentos = () => consultas().filter(e => e.sql.includes('DELETE FROM'))

const eventos = () =>
  consultas().filter(e => e.sql.includes('INSERT INTO auditoria.evento'))

const normalizar = sql => sql.replace(/\s+/g, ' ').trim()

const apagamentosNormalizados = () => apagamentos().map(e => normalizar(e.sql))

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

const GERENTE_PRODUCAO = { minimo: 'gerente', modulo: 'producao' }

describe('a guarda dos DELETE do trabalho', () => {
  // OS CINCO DE UMA VEZ, com o CAMINHO junto e na ORDEM DE DECLARACAO: um DELETE
  // novo que nascesse sem guarda, com a guarda de outro modulo ou depois de uma
  // rota com parametro quebra esta igualdade em vez de passar despercebido.
  it('cobra gerente do módulo producao nos cinco, e são só cinco', () => {
    expect(deletesDoRouter(trabalhoRoute)).toEqual([
      { caminho: '/bloco', guarda: GERENTE_PRODUCAO },
      { caminho: '/unidade_trabalho/atividades', guarda: GERENTE_PRODUCAO },
      { caminho: '/unidade_trabalho', guarda: GERENTE_PRODUCAO },
      { caminho: '/atividades', guarda: GERENTE_PRODUCAO },
      { caminho: '/dado_producao', guarda: GERENTE_PRODUCAO }
    ])
  })

  // O CAMINHO DE DOIS SEGMENTOS VEM ANTES DO DE UM, e isto e o contrato do
  // arquivo de rota: `/unidade_trabalho/atividades` declarado depois de
  // `/unidade_trabalho` cairia nele no dia em que a segunda ganhasse um `/:id`.
  it('declara /unidade_trabalho/atividades antes de /unidade_trabalho', () => {
    const caminhos = deletesDoRouter(trabalhoRoute).map(d => d.caminho)
    expect(caminhos.indexOf('/unidade_trabalho/atividades')).toBeLessThan(
      caminhos.indexOf('/unidade_trabalho')
    )
  })
})

// --- DELETE /bloco -----------------------------------------------------------

const BLOCO = { id: 4, nome: 'Bloco Sul', lote_id: 55, prioridade: 1 }

const dublarBloco = ({ comUnidade = [], bloco = [BLOCO] } = {}) =>
  dublar([
    ['DELETE FROM producao.bloco', []],
    ['INNER JOIN producao.bloco AS b', comUnidade],
    ['FROM producao.bloco AS t', bloco]
  ])

describe('DELETE /bloco', () => {
  it('apaga um por id, com o WHERE do id pedido', async () => {
    dublarBloco()

    const res = await request(app)
      .delete('/api/producao/bloco')
      .send({ bloco_ids: [4] })

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Blocos excluídos com sucesso')
    expect(apagamentosNormalizados()).toEqual([
      'DELETE FROM producao.bloco WHERE id = 4'
    ])
  })

  it('audita a exclusão dentro da transação, na ficha do LOTE', async () => {
    dublarBloco()

    await request(app).delete('/api/producao/bloco').send({ bloco_ids: [4] })

    expect(eventos()).toHaveLength(1)
    const evento = eventos()[0]
    expect(evento.via).toBe('tx')
    expect(evento.dentro).toBe(true)
    expect(evento.valores.operacao).toBe('D')
    expect(evento.valores.tabela).toBe('producao.bloco')
    expect(evento.valores.registroId).toBe('4')
    // O AGREGADO E O LOTE, e nao o bloco: a ficha que alguem abre e a do lote.
    expect(evento.valores.entidadeId).toBe('55')
    expect(evento.valores.rota).toBe('DELETE /api/producao/bloco')
    expect(evento.valores.dadosDepois).toBeNull()
    expect(JSON.parse(evento.valores.dadosAntes).nome).toBe('Bloco Sul')
  })

  // A CONFERENCIA VEM ANTES DO DELETE de proposito: a chave estrangeira tambem
  // recusaria, mas com o nome da restricao no meio de um 500.
  it('recusa com 400 o bloco que ainda tem unidade de trabalho, e diz qual', async () => {
    dublarBloco({ comUnidade: [{ nome: 'Bloco Sul' }] })

    const res = await request(app)
      .delete('/api/producao/bloco')
      .send({ bloco_ids: [4] })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe(
      'O bloco "Bloco Sul" possui unidades de trabalho associadas'
    )
    expect(apagamentos()).toEqual([])
    expect(registro.some(e => e.marca === 'tx:rollback')).toBe(true)
  })

  it('responde 404 quando o bloco não existe', async () => {
    dublarBloco({ bloco: [] })

    const res = await request(app)
      .delete('/api/producao/bloco')
      .send({ bloco_ids: [4] })

    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Bloco não encontrado(a)')
    expect(apagamentos()).toEqual([])
    expect(eventos()).toEqual([])
  })
})

// --- DELETE /unidade_trabalho ------------------------------------------------

const UT = { id: 101, nome: 'SF-23-Y-C-I', lote_id: 55, subfase_id: 3 }

const dublarUt = ({ comAtividade = [], unidade = [UT] } = {}) =>
  dublar([
    ['DELETE FROM producao.insumo_unidade_trabalho', []],
    ['DELETE FROM producao.unidade_trabalho', []],
    ['FROM producao.atividade AS a', comAtividade],
    ['FROM producao.unidade_trabalho AS t', unidade]
  ])

describe('DELETE /unidade_trabalho', () => {
  // DOIS APAGAMENTOS, NESTA ORDEM: a associacao de insumo cai junto e sem evento
  // proprio, e ela tem de sair antes da unidade que ela aponta.
  it('apaga a associação de insumo e depois a unidade, cada uma pelo seu id', async () => {
    dublarUt()

    const res = await request(app)
      .delete('/api/producao/unidade_trabalho')
      .send({ unidade_trabalho_ids: [101] })

    expect(res.status).toBe(200)
    expect(apagamentosNormalizados()).toEqual([
      'DELETE FROM producao.insumo_unidade_trabalho WHERE unidade_trabalho_id = 101',
      'DELETE FROM producao.unidade_trabalho WHERE id = 101'
    ])
  })

  it('apaga uma por vez, sem alcançar as que não foram pedidas', async () => {
    dublarUt()

    await request(app)
      .delete('/api/producao/unidade_trabalho')
      .send({ unidade_trabalho_ids: [101, 102] })

    expect(apagamentosNormalizados()).toEqual([
      'DELETE FROM producao.insumo_unidade_trabalho WHERE unidade_trabalho_id = 101',
      'DELETE FROM producao.unidade_trabalho WHERE id = 101',
      'DELETE FROM producao.insumo_unidade_trabalho WHERE unidade_trabalho_id = 102',
      'DELETE FROM producao.unidade_trabalho WHERE id = 102'
    ])
    expect(eventos()).toHaveLength(2)
    expect(eventos().every(e => e.via === 'tx' && e.dentro)).toBe(true)
  })

  it('recusa com 400 a unidade que tem atividade, e diz qual', async () => {
    dublarUt({ comAtividade: [{ unidade_trabalho_id: 101 }] })

    const res = await request(app)
      .delete('/api/producao/unidade_trabalho')
      .send({ unidade_trabalho_ids: [101] })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe(
      'A unidade de trabalho 101 possui atividades associadas'
    )
    expect(apagamentos()).toEqual([])
  })

  it('responde 404 quando a unidade não existe', async () => {
    dublarUt({ unidade: [] })

    const res = await request(app)
      .delete('/api/producao/unidade_trabalho')
      .send({ unidade_trabalho_ids: [101] })

    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Unidade de trabalho não encontrado(a)')
    expect(apagamentos()).toEqual([])
  })
})

// --- DELETE /unidade_trabalho/atividades -------------------------------------

const ATIVIDADES_LIMPAS = [
  { id: 71, unidade_trabalho_id: 101, etapa_id: 9, tipo_situacao_atividade_id: 1 },
  { id: 72, unidade_trabalho_id: 102, etapa_id: 9, tipo_situacao_atividade_id: 5 }
]

const dublarLimpeza = (apagadas = ATIVIDADES_LIMPAS) =>
  dublar([
    ['DELETE FROM producao.atividade', apagadas],
    // O agregado de `producao.atividade` sai da unidade de trabalho.
    ['FROM producao.unidade_trabalho WHERE id', [{ lote_id: 55 }]]
  ])

describe('DELETE /unidade_trabalho/atividades', () => {
  // OS DOIS CODES, e nao um: 1 ('Nao iniciada') e 5 ('Nao finalizada'). O que
  // estiver em execucao, pausado ou finalizado FICA, e e o filtro que garante
  // isso.
  it('alcança só as não iniciadas e as não finalizadas das unidades pedidas', async () => {
    dublarLimpeza()

    const res = await request(app)
      .delete('/api/producao/unidade_trabalho/atividades')
      .send({ unidade_trabalho_ids: [101, 102] })

    expect(res.status).toBe(200)
    // As duas unidades pedidas tinham atividade apagavel: nada ficou de fora.
    expect(res.body.dados).toEqual({ apagadas: 2, ignoradas: [] })
    expect(apagamentosNormalizados()).toEqual([
      'DELETE FROM producao.atividade WHERE unidade_trabalho_id IN (101,102) ' +
        'AND tipo_situacao_atividade_id IN (1, 5) RETURNING *'
    ])
  })

  // OS CODES SAO OS DO DOMINIO, e nao numero digitado no teste: se `dominio`
  // renumerar, esta linha e que tem de acusar.
  it('os dois codes do filtro são os do domínio', () => {
    expect(SITUACAO_ATIVIDADE.NAO_INICIADA).toBe(1)
    expect(SITUACAO_ATIVIDADE.NAO_FINALIZADA).toBe(5)
  })

  it('audita cada atividade apagada, dentro da transação e na ficha do lote', async () => {
    dublarLimpeza()

    await request(app)
      .delete('/api/producao/unidade_trabalho/atividades')
      .send({ unidade_trabalho_ids: [101, 102] })

    expect(eventos()).toHaveLength(2)
    expect(eventos().map(e => e.valores.registroId)).toEqual(['71', '72'])
    expect(eventos().every(e => e.via === 'tx' && e.dentro)).toBe(true)
    expect(eventos().every(e => e.valores.operacao === 'D')).toBe(true)
    expect(eventos().every(e => e.valores.entidadeId === '55')).toBe(true)
  })

  // ZERO APAGADAS E RECUSA, e nao um 200 com `apagadas: 0`. O filtro por
  // situacao pode nao alcancar nada, e a mensagem de sucesso mandava a pessoa
  // de volta para a grade com as mesmas linhas e nada explicando por que.
  // CONTRATO MUDADO EM 2026-09-05 (S6-04): antes eram 200 e `{ apagadas: 0 }`.
  it('recusa com 400 quando não havia o que limpar, e não audita nada', async () => {
    dublarLimpeza([])

    const res = await request(app)
      .delete('/api/producao/unidade_trabalho/atividades')
      .send({ unidade_trabalho_ids: [101] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('Nenhuma atividade foi apagada')
    expect(res.body.message).toContain('Não finalizada')
    expect(eventos()).toEqual([])
  })

  // A EXCLUSAO PARCIAL NOMEIA O QUE FICOU: pediu duas unidades, so uma tinha
  // atividade apagavel, e a outra precisa aparecer para a tela poder dizer.
  it('a exclusão parcial devolve as unidades que ficaram de fora', async () => {
    dublarLimpeza([ATIVIDADES_LIMPAS[0]])

    const res = await request(app)
      .delete('/api/producao/unidade_trabalho/atividades')
      .send({ unidade_trabalho_ids: [101, 102] })

    expect(res.status).toBe(200)
    expect(res.body.dados).toEqual({ apagadas: 1, ignoradas: [102] })
  })
})

// --- DELETE /atividades ------------------------------------------------------

const ATIVIDADES = [
  { id: 11, unidade_trabalho_id: 101, etapa_id: 9, tipo_situacao_atividade_id: 1 }
]

const dublarAtividades = ({
  quebraPar = [],
  lotes = [{ lote_id: 55 }],
  apagadas = ATIVIDADES
} = {}) =>
  dublar([
    ['DELETE FROM producao.atividade', apagadas],
    ['WITH par AS', quebraPar],
    ['SELECT DISTINCT ut.lote_id', lotes],
    ['FROM producao.unidade_trabalho WHERE id', [{ lote_id: 55 }]]
  ])

describe('DELETE /atividades', () => {
  // A GUARDA QUE MAIS IMPORTA DESTA FATIA: sem o `AND
  // tipo_situacao_atividade_id`, a rota apagaria trabalho em execucao, pausado e
  // finalizado, e responderia "excluidas com sucesso" do mesmo jeito.
  it('só apaga o que está NÃO INICIADA, e só os ids pedidos', async () => {
    dublarAtividades()

    const res = await request(app)
      .delete('/api/producao/atividades')
      .send({ atividades_ids: [11, 12] })

    expect(res.status).toBe(200)
    expect(apagamentosNormalizados()).toEqual([
      'DELETE FROM producao.atividade WHERE id IN (11,12) ' +
        'AND tipo_situacao_atividade_id = 1 RETURNING *'
    ])
    // DOIS PEDIDOS, UMA APAGADA: a 12 ja tinha comecado, e a resposta a nomeia
    // em vez de sumir com ela em silencio.
    expect(res.body.dados).toEqual({ apagadas: 1, ignoradas: [12] })
  })

  // ZERO APAGADAS E RECUSA. Marcar tres linhas Finalizadas e mandar apagar
  // respondia 200 com `Atividades nao iniciadas excluidas com sucesso` e
  // `apagadas: 0`: a pessoa voltava para a grade com as tres no lugar. A irma
  // `criarAtividades` ja lancava 400 quando nada era criado.
  // CONTRATO MUDADO EM 2026-09-05 (S6-04): antes eram 200 e `{ apagadas: 0 }`.
  it('recusa com 400 quando nenhuma das informadas está Não iniciada', async () => {
    dublarAtividades({ apagadas: [] })

    const res = await request(app)
      .delete('/api/producao/atividades')
      .send({ atividades_ids: [11, 12] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('Nenhuma atividade foi apagada')
    expect(res.body.message).toContain('Não iniciada')
    expect(eventos()).toEqual([])
  })

  // A REVISAO E A CORRECAO CAEM JUNTAS OU NAO CAEM: uma revisao sem a correcao
  // seguinte nao tem onde apontar o que achou.
  it('recusa com 400 quando a lista quebra o par revisão/correção', async () => {
    dublarAtividades({
      quebraPar: [{ atividade_revisao: 11, atividade_correcao: 12 }]
    })

    const res = await request(app)
      .delete('/api/producao/atividades')
      .send({ atividades_ids: [11] })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe(
      'Atividade de correção não deve ser deletada separadamente da revisão'
    )
    expect(apagamentos()).toEqual([])
    expect(registro.some(e => e.marca === 'tx:rollback')).toBe(true)
  })

  it('recusa com 400 a lista que mistura lotes', async () => {
    dublarAtividades({ lotes: [{ lote_id: 55 }, { lote_id: 56 }] })

    const res = await request(app)
      .delete('/api/producao/atividades')
      .send({ atividades_ids: [11, 12] })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe('As atividades informadas são de lotes distintos')
    expect(apagamentos()).toEqual([])
  })

  // AS DUAS CONFERENCIAS VEM ANTES DO DELETE, e nao ao lado dele.
  it('confere o par e o lote antes de apagar', async () => {
    dublarAtividades()

    await request(app)
      .delete('/api/producao/atividades')
      .send({ atividades_ids: [11] })

    const ordem = consultas().map(e => e.sql)
    const indice = trecho => ordem.findIndex(s => s.includes(trecho))

    expect(indice('WITH par AS')).toBeLessThan(indice('DELETE FROM producao.atividade'))
    expect(indice('SELECT DISTINCT ut.lote_id')).toBeLessThan(
      indice('DELETE FROM producao.atividade')
    )
  })

  it('audita só o que o banco disse ter apagado', async () => {
    dublarAtividades()

    await request(app)
      .delete('/api/producao/atividades')
      .send({ atividades_ids: [11, 12] })

    // DOIS IDS PEDIDOS, UMA LINHA APAGADA (a outra ja tinha comecado): o rastro
    // segue o `RETURNING`, e nao a lista do corpo.
    expect(eventos()).toHaveLength(1)
    expect(eventos()[0].valores.registroId).toBe('11')
    expect(eventos()[0].via).toBe('tx')
    expect(eventos()[0].dentro).toBe(true)
  })
})

// --- DELETE /dado_producao ---------------------------------------------------

const DADO = { id: 2, tipo_dado_producao_id: 2, configuracao_producao: 'x' }

const dublarDado = ({ emUso = [], dado = [DADO] } = {}) =>
  dublar([
    ['DELETE FROM producao.dado_producao', []],
    ['WHERE ut.dado_producao_id IN', emUso],
    ['FROM producao.dado_producao AS t', dado]
  ])

describe('DELETE /dado_producao', () => {
  it('apaga um por id, com o WHERE do id pedido', async () => {
    dublarDado()

    const res = await request(app)
      .delete('/api/producao/dado_producao')
      .send({ dado_producao_ids: [2] })

    expect(res.status).toBe(200)
    expect(apagamentosNormalizados()).toEqual([
      'DELETE FROM producao.dado_producao WHERE id = 2'
    ])
    expect(eventos()).toHaveLength(1)
    expect(eventos()[0].valores.entidadeId).toBe('2')
    expect(eventos()[0].via).toBe('tx')
  })

  it('recusa com 400 o dado de produção que ainda tem unidade de trabalho', async () => {
    dublarDado({ emUso: [{ dado_producao_id: 2 }] })

    const res = await request(app)
      .delete('/api/producao/dado_producao')
      .send({ dado_producao_ids: [2] })

    expect(res.status).toBe(400)
    expect(res.body.message).toBe(
      'O dado de produção 2 possui unidades de trabalho associadas'
    )
    expect(apagamentos()).toEqual([])
  })

  it('responde 404 quando o dado de produção não existe', async () => {
    dublarDado({ dado: [] })

    const res = await request(app)
      .delete('/api/producao/dado_producao')
      .send({ dado_producao_ids: [2] })

    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Dado de produção não encontrado(a)')
    expect(apagamentos()).toEqual([])
  })

  // O ENDERECO DO BANCO DE EDICAO NAO SAI NEM PELO RASTRO DE ERRO: este
  // repositorio e publico e `er/producao.sql` proibe a coluna em resposta de API
  // e em log. Aqui o que se prende e a resposta da EXCLUSAO.
  it('não devolve a configuração do dado de produção na resposta', async () => {
    dublarDado()

    const res = await request(app)
      .delete('/api/producao/dado_producao')
      .send({ dado_producao_ids: [2] })

    expect(JSON.stringify(res.body)).not.toContain('configuracao_producao')
  })
})

// --- Os contratos dos cinco corpos -------------------------------------------

describe('o corpo dos cinco DELETE', () => {
  it.each([
    ['/bloco', { bloco_ids: [] }],
    ['/unidade_trabalho', { unidade_trabalho_ids: [] }],
    ['/unidade_trabalho/atividades', { unidade_trabalho_ids: [] }],
    ['/atividades', { atividades_ids: [] }],
    ['/dado_producao', { dado_producao_ids: [] }]
  ])('DELETE %s recusa a lista vazia com 400 e não apaga nada', async (caminho, corpo) => {
    dublar([])

    const res = await request(app).delete(`/api/producao${caminho}`).send(corpo)

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('at least 1 items')
    expect(apagamentos()).toEqual([])
  })

  it.each([
    ['/bloco', {}],
    ['/unidade_trabalho', {}],
    ['/atividades', {}],
    ['/dado_producao', {}]
  ])('DELETE %s recusa o corpo sem a chave, com 400', async (caminho, corpo) => {
    dublar([])

    const res = await request(app).delete(`/api/producao${caminho}`).send(corpo)

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('is required')
    expect(apagamentos()).toEqual([])
  })

  // `.strict()` NO ID: a string '3' NAO vira 3 nesta fatia, e um corpo com aspas
  // sobrando nao apaga a linha 3 sem ninguem perceber.
  it.each([
    ['a lista vazia', { bloco_ids: [] }, 'bloco_ids', 'array.min'],
    ['a chave ausente', {}, 'bloco_ids', 'any.required'],
    ['o id repetido', { bloco_ids: [4, 4] }, ['bloco_ids', 1], 'array.unique'],
    ['o id como texto', { bloco_ids: ['4'] }, ['bloco_ids', 0], 'number.base'],
    ['o id zero', { bloco_ids: [0] }, ['bloco_ids', 0], 'number.positive']
  ])('o schema do bloco recusa %s pelo motivo certo', (_caso, corpo, campo, tipo) => {
    recusaPor(trabalhoSchema.blocoIds.validate(corpo), campo, tipo)
  })

  it.each([
    ['a lista vazia', { atividades_ids: [] }, 'atividades_ids', 'array.min'],
    ['o id fracionário', { atividades_ids: [1.5] }, ['atividades_ids', 0], 'number.integer']
  ])('o schema da atividade recusa %s pelo motivo certo', (_caso, corpo, campo, tipo) => {
    recusaPor(trabalhoSchema.atividadesIds.validate(corpo), campo, tipo)
  })

  it.each([
    [
      'a lista vazia',
      { unidade_trabalho_ids: [] },
      'unidade_trabalho_ids',
      'array.min'
    ],
    [
      'o id como texto',
      { unidade_trabalho_ids: ['101'] },
      ['unidade_trabalho_ids', 0],
      'number.base'
    ]
  ])('o schema da unidade de trabalho recusa %s pelo motivo certo', (_caso, corpo, campo, tipo) => {
    recusaPor(trabalhoSchema.unidadeTrabalhoIds.validate(corpo), campo, tipo)
  })

  it.each([
    ['a lista vazia', { dado_producao_ids: [] }, 'dado_producao_ids', 'array.min'],
    ['a chave ausente', {}, 'dado_producao_ids', 'any.required']
  ])('o schema do dado de produção recusa %s pelo motivo certo', (_caso, corpo, campo, tipo) => {
    recusaPor(trabalhoSchema.dadoProducaoIds.validate(corpo), campo, tipo)
  })
})
