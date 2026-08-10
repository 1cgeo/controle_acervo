'use strict'

// `DELETE /api/producao/configuracao/camadas`, EXERCITADO POR HTTP.
//
// POR QUE ESTE ARQUIVO EXISTE. Numa revisao de 2026-08-09 esta rota nao aparecia
// em arquivo de teste NENHUM, nem como string: nem a guarda dela, nem o alvo do
// `DELETE`, nem a conferencia que a antecede tinham qualquer cobranca. Ela apaga
// linhas de `producao.camada`, que e o catalogo que toda `propriedades_camada`
// referencia -- o cadastro que diz quais camadas o QGIS abre em cada subfase.
//
// E ELA NAO E COMO AS NOVE DO CATALOGO DO QGIS, e as diferencas sao contrato:
//
//   - responde 200, e nao o 201 que `dominio_qgis_route.js` devolve por heranca
//     do SAP 2.3.5;
//   - a conferencia previa nao pergunta so "alguem usa": ela devolve QUAIS
//     camadas estao em uso, e a mensagem do 400 as nomeia;
//   - a lista de ids vai numa consulta so (`$<camadasIds:csv>`), e nao uma
//     pergunta por id.
//
// O QUE ELE PROVA, em vez de ler o fonte: a guarda cobra `gerente` no modulo
// `producao` (code 7, e nao o 'acervo' que e o default de `verifyPerfil`); o
// `DELETE` que chegaria ao PostgreSQL tem a tabela certa, o `WHERE` e o id
// pedido; a auditoria cai na MESMA transacao, logo depois da exclusao que ela
// descreve; e cada recusa responde o codigo e o motivo que anuncia.
//
// ELE NAO ABRE CONEXAO, e por isso cai no pacote `test:rapido`.

const jwt = require('jsonwebtoken')
const request = require('supertest')

const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { recusaPor, aceita } = require('../../helpers/joi')

const { JWT_SECRET } = require('../../../config')
const { db } = require('../../../database')

const rotaFluxo = require('../../../producao/fluxo_route')
const fluxoSchema = require('../../../producao/fluxo_schema')

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'

const CAMINHO = '/api/producao/configuracao/camadas'

const token = () =>
  'Bearer ' + jwt.sign({ id: 1, uuid: UUID, cliente: 'sca_web' }, JWT_SECRET, { expiresIn: '1h' })

const app = buildTestApp([{ path: '/api/producao', router: rotaFluxo }])

// O MODULO `producao` E O CODE 7 de `dominio.modulo`, e o 1 e o acervo.
const MODULO_PRODUCAO = 7

const EH_GUARDA = sql => sql.includes('dgeo.usuario_perfil')
const EH_EM_USO = sql => sql.includes('producao.propriedades_camada')
const EH_LER_ANTES = sql => sql.startsWith('SELECT t.*')

const idDoLerAntes = sql => Number(/WHERE t\.id = (\d+)/.exec(sql)[1])

const camadaDe = id => ({
  id,
  schema: 'edicao',
  nome: `camada_${id}`,
  usuario_cadastramento_uuid: UUID
})

/**
 * @param {object} opcoes
 * @param {number|null} opcoes.perfilId   1 consulta, 2 operador, 3 gerente
 * @param {boolean} opcoes.administrador
 * @param {number[]} opcoes.ausentes      ids que NAO existem (viram 404)
 * @param {Array} opcoes.emUso            camadas que alguma subfase usa
 * @param {boolean} opcoes.auditoriaFalha
 */
const fabricar = ({
  perfilId = 3,
  administrador = false,
  ausentes = [],
  emUso = [],
  auditoriaFalha = false
} = {}) => {
  // Cada consulta guarda QUEM a executou: `conn` e a conexao de fora, `tx#N` e a
  // transacao. E o que separa "auditou" de "auditou DENTRO da transacao".
  const consultas = []
  const transacoes = []

  const anotar = (dono, query, values) => {
    // `as.format` e o mesmo caminho do driver: parametro que falta lanca aqui.
    const sql = db.pgp.as.format(query, values)
    consultas.push({ dono, sql })
    return sql
  }

  const metodos = dono => ({
    any: async (query, values) => {
      const sql = anotar(dono, query, values)
      if (EH_EM_USO(sql)) return emUso
      return []
    },
    one: async (query, values) => {
      const sql = anotar(dono, query, values)
      return EH_LER_ANTES(sql) ? camadaDe(idDoLerAntes(sql)) : {}
    },
    oneOrNone: async (query, values) => {
      const sql = anotar(dono, query, values)
      if (EH_GUARDA(sql)) {
        // O PERFIL SO EXISTE NO MODULO QUE A CONSULTA PERGUNTA. Uma rota que
        // esquecesse o segundo argumento de `verifyPerfil` perguntaria pelo
        // acervo e sairia daqui sem perfil nenhum.
        const doModulo = sql.includes(`up.modulo_id = ${MODULO_PRODUCAO}`)
        return { id: 1, administrador, perfil_id: doModulo ? perfilId : null }
      }
      if (EH_LER_ANTES(sql)) {
        const id = idDoLerAntes(sql)
        return ausentes.includes(id) ? null : camadaDe(id)
      }
      return null
    },
    none: async (query, values) => {
      const sql = anotar(dono, query, values)
      if (auditoriaFalha && sql.includes('INSERT INTO auditoria.evento')) {
        // Mensagem NEUTRA de proposito: ela sai no envelope, e o repositorio e
        // publico.
        throw new Error('o rastro nao pode ser gravado')
      }
      return null
    }
  })

  const conn = {
    ...metodos('conn'),
    tx: async cb => {
      const marca = { dono: `tx#${transacoes.length + 1}`, concluida: false, desfeita: false }
      transacoes.push(marca)
      const t = { ...metodos(marca.dono), tx: async c => c(t), task: async c => c(t) }
      try {
        const r = await cb(t)
        marca.concluida = true
        return r
      } catch (err) {
        marca.desfeita = true
        throw err
      }
    },
    task: async cb => cb(conn)
  }

  return { consultas, transacoes, conn }
}

let fabricado
let connOriginal

const dublar = (opcoes = {}) => {
  fabricado = fabricar(opcoes)
  db.conn = fabricado.conn
}

beforeEach(() => {
  connOriginal = db.conn
})

afterEach(() => {
  db.conn = connOriginal
})

const apagar = corpo =>
  request(app).delete(CAMINHO).set('Authorization', token()).send(corpo)

const sqlDe = filtro => fabricado.consultas.filter(c => filtro(c.sql))
const deletes = () => sqlDe(s => s.startsWith('DELETE FROM'))
const eventos = () => sqlDe(s => s.includes('INSERT INTO auditoria.evento'))

describe('a guarda de DELETE /configuracao/camadas', () => {
  it('a consulta da guarda pergunta pelo módulo producao, e não pelo acervo', async () => {
    dublar()

    await apagar({ camadas_ids: [7] })

    const guarda = sqlDe(EH_GUARDA)
    expect(guarda).toHaveLength(1)
    expect(guarda[0].sql).toContain(`up.modulo_id = ${MODULO_PRODUCAO}`)
    expect(guarda[0].sql).not.toContain('up.modulo_id = 1')
  })

  it('o operador do módulo producao não apaga camada', async () => {
    dublar({ perfilId: 2 })

    const res = await apagar({ camadas_ids: [7] })

    expect(res.status).toBe(403)
    // A frase nomeia o piso E o modulo: com o argumento esquecido ela diria
    // 'acervo', e nenhum outro teste notaria.
    expect(res.body.message).toBe('Usuário necessita do perfil gerente no módulo producao')
    expect(deletes()).toEqual([])
  })

  it('quem só consulta não apaga camada', async () => {
    dublar({ perfilId: 1 })

    const res = await apagar({ camadas_ids: [7] })

    expect(res.status).toBe(403)
    expect(deletes()).toEqual([])
  })

  it('quem não tem perfil nenhum no módulo não apaga camada', async () => {
    dublar({ perfilId: null })

    const res = await apagar({ camadas_ids: [7] })

    expect(res.status).toBe(403)
    expect(deletes()).toEqual([])
  })

  it('o administrador global passa mesmo sem linha de perfil no módulo', async () => {
    dublar({ perfilId: null, administrador: true })

    const res = await apagar({ camadas_ids: [7] })

    expect(res.status).toBe(200)
  })

  it('sem token não se apaga nada', async () => {
    dublar()

    const res = await request(app).delete(CAMINHO).send({ camadas_ids: [7] })

    expect(res.status).toBe(401)
    expect(deletes()).toEqual([])
  })
})

describe('o alvo do DELETE de camadas', () => {
  it('apaga exatamente os ids pedidos, em producao.camada, com WHERE', async () => {
    dublar()

    const res = await apagar({ camadas_ids: [7, 9] })

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Camadas excluídas com sucesso')
    // A LISTA INTEIRA, e nao um `toContain`: um `WHERE` que sumisse apagaria o
    // catalogo de camadas da instalacao inteira, e esta comparacao mudaria.
    expect(deletes().map(c => c.sql)).toEqual([
      'DELETE FROM producao.camada WHERE id = 7',
      'DELETE FROM producao.camada WHERE id = 9'
    ])
  })

  it('um id só apaga uma linha só', async () => {
    dublar()

    await apagar({ camadas_ids: [123] })

    expect(deletes().map(c => c.sql)).toEqual([
      'DELETE FROM producao.camada WHERE id = 123'
    ])
  })

  // A CAMADA E O CATALOGO, E A PROPRIEDADE E O USO DELA NUMA SUBFASE. Apagar a
  // segunda no lugar da primeira deixaria o cadastro em pe e sumiria com a
  // configuracao de quem trabalha.
  it('não toca em propriedades_camada', async () => {
    dublar()

    await apagar({ camadas_ids: [7] })

    for (const { sql } of deletes()) {
      expect(sql).not.toContain('propriedades_camada')
    }
  })

  // UMA CONSULTA PARA A LISTA INTEIRA, e nao uma por id: perguntar id a id daria
  // N idas ao banco para responder "alguma destas esta em uso".
  it('a conferência prévia pergunta por todos os ids de uma vez', async () => {
    dublar()

    await apagar({ camadas_ids: [7, 9] })

    const conferencia = sqlDe(EH_EM_USO)
    expect(conferencia).toHaveLength(1)
    expect(conferencia[0].sql).toContain('pc.camada_id IN (7,9)')
  })
})

describe('a transação e a auditoria da exclusão de camadas', () => {
  it('o DELETE e o evento saem da MESMA transação, nessa ordem', async () => {
    dublar()

    await apagar({ camadas_ids: [7, 9] })

    expect(fabricado.transacoes).toHaveLength(1)
    expect(fabricado.transacoes[0].concluida).toBe(true)

    const dono = fabricado.transacoes[0].dono
    const escritas = sqlDe(
      s => s.startsWith('DELETE FROM') || s.includes('INSERT INTO auditoria.evento')
    )

    expect(escritas.map(c => c.dono)).toEqual([dono, dono, dono, dono])
    expect(escritas.map(c => (c.sql.startsWith('DELETE') ? 'apaga' : 'audita')))
      .toEqual(['apaga', 'audita', 'apaga', 'audita'])
  })

  // A CONFERENCIA TAMBEM E DA TRANSACAO: fora dela, outra requisicao poderia
  // criar a propriedade de camada entre a pergunta e o `DELETE`.
  it('a conferência prévia roda dentro da mesma transação', async () => {
    dublar()

    await apagar({ camadas_ids: [7] })

    expect(sqlDe(EH_EM_USO)[0].dono).toBe(fabricado.transacoes[0].dono)
  })

  it('o evento diz a tabela, o registro e que a operação foi exclusão', async () => {
    dublar()

    await apagar({ camadas_ids: [7] })

    expect(eventos()).toHaveLength(1)
    const sql = eventos()[0].sql
    expect(sql).toContain("'producao'")
    expect(sql).toContain("'camada'")
    expect(sql).toContain("'producao.camada'")
    expect(sql).toContain("'D'")
    expect(sql).toContain(`'${UUID}'`)
    // O `dados_antes` e a linha lida ANTES de apagar: sem ele, a exclusao
    // levaria junto o que o registro dizia.
    expect(sql).toContain('"schema":"edicao"')
    expect(sql).toContain('"nome":"camada_7"')
    expect(sql).toContain(`DELETE ${CAMINHO}`)
  })

  // FALHAR AO AUDITAR DERRUBA A ESCRITA, e e deliberado.
  it('auditoria que falha desfaz a exclusão', async () => {
    dublar({ auditoriaFalha: true })

    const res = await apagar({ camadas_ids: [7] })

    expect(res.status).toBe(500)
    expect(fabricado.transacoes[0].desfeita).toBe(true)
    expect(fabricado.transacoes[0].concluida).toBe(false)
  })
})

describe('os caminhos de erro da exclusão de camadas', () => {
  // A GUARDA DE `propriedades_camada` VEM ANTES DA CHAVE ESTRANGEIRA: sem ela o
  // `DELETE` morreria com 23503 citando o nome da restricao, que nao diz a
  // ninguem o que desfazer primeiro.
  it('camada em uso por alguma subfase é 400, nomeando as camadas', async () => {
    dublar({
      emUso: [
        { id: 7, schema: 'edicao', nome: 'camada_7' },
        { id: 9, schema: 'edicao', nome: 'camada_9' }
      ]
    })

    const res = await apagar({ camadas_ids: [7, 9] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('edicao.camada_7, edicao.camada_9')
    expect(res.body.message).toContain('Remova as propriedades de camada dessas subfases antes')
  })

  // A RECUSA E ANTES DO PRIMEIRO DELETE, e nao um rollback depois: com a
  // conferencia no meio do laco, a camada 7 ja teria sido apagada quando a 9
  // esbarrasse na subfase.
  it('nada é apagado quando alguma camada está em uso', async () => {
    dublar({ emUso: [{ id: 9, schema: 'edicao', nome: 'camada_9' }] })

    await apagar({ camadas_ids: [7, 9] })

    expect(deletes()).toEqual([])
    expect(eventos()).toEqual([])
    expect(fabricado.transacoes[0].desfeita).toBe(true)
  })

  it('id inexistente é 404 e desfaz o que já tinha apagado', async () => {
    dublar({ ausentes: [9] })

    const res = await apagar({ camadas_ids: [7, 9] })

    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Camada não encontrado(a)')
    expect(deletes().map(c => c.sql)).toEqual([
      'DELETE FROM producao.camada WHERE id = 7'
    ])
    expect(fabricado.transacoes[0].desfeita).toBe(true)
  })

  // A GUARDA VEM ANTES DO Joi (e a ordem e a de declaracao na rota), entao a
  // consulta do perfil acontece. O que NAO pode acontecer e o controlador rodar:
  // sem `.min(1)`, `camadas_ids IN ()` seria erro de sintaxe no PostgreSQL.
  it('lista vazia é 400 e não chega ao controlador', async () => {
    dublar()

    const res = await apagar({ camadas_ids: [] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('must contain at least 1 items')
    expect(deletes()).toEqual([])
    expect(sqlDe(EH_EM_USO)).toEqual([])
  })

  it('chave desconhecida no corpo é 400 com a sugestão do nome certo', async () => {
    dublar()

    const res = await apagar({ camadas_id: [7] })

    expect(res.status).toBe(400)
    expect(res.body.message).toContain('campo desconhecido "camadas_id"')
    expect(res.body.message).toContain('camadas_ids')
    expect(deletes()).toEqual([])
  })

  // DIVERGENCIA MEDIDA E FECHADA EM 2026-08-09. `fluxo_schema.idSerial()` era
  // `Joi.number().integer().positive()`, SEM o `.strict()` que
  // `dominio_qgis_schema.id()` tem nas nove listas do catalogo do QGIS ao lado:
  // `['7']` era aceito aqui e recusado com 400 la, e nas duas rotas quem manda o
  // corpo e o mesmo SAP Gerente. Este caso pinava a coercao para ficar vermelho
  // no dia do conserto, e foi o que aconteceu.
  //
  // AGORA AS DUAS RECUSAM, e o motivo e o mesmo nas duas. O `.strict()` protege o
  // CORPO; a query continua tolerante, porque `req.query` chega sempre como
  // texto, e a varredura-guarda de `__tests__/routes/query_de_texto.test.js`
  // cobra esse outro lado.
  it('id como texto é recusado, como no catálogo do QGIS', async () => {
    dublar()

    const res = await apagar({ camadas_ids: ['7'] })

    expect(res.status).toBe(400)
    // NADA foi apagado: a recusa acontece antes do controlador.
    expect(deletes()).toEqual([])
  })
})

// --- O contrato do corpo -------------------------------------------------------
//
// O MOTIVO DA RECUSA, e nao so que houve recusa.

describe('o contrato de camadas_ids', () => {
  it('a lista é obrigatória', () => {
    recusaPor(fluxoSchema.camadasIds.validate({}), 'camadas_ids', 'any.required')
  })

  // `.min(1)`, e nao o `array.includesRequiredUnknowns` do SAP 2.3.5: quem manda
  // `[]` le que a lista precisa de pelo menos um item, e nao uma frase sobre
  // itens desconhecidos.
  it('a lista vazia recusa pelo mínimo, e não por item desconhecido', () => {
    recusaPor(fluxoSchema.camadasIds.validate({ camadas_ids: [] }), 'camadas_ids', 'array.min')
  })

  it('o mesmo id duas vezes é pedido ambíguo', () => {
    recusaPor(
      fluxoSchema.camadasIds.validate({ camadas_ids: [7, 7] }),
      ['camadas_ids', 1],
      'array.unique'
    )
  })

  // O `.strict()` ENTROU AQUI EM 2026-08-09, alinhando com as nove listas de
  // `dominio_qgis_schema.js`. Ver a nota do caso de rota equivalente: o texto
  // deixou de ser aceito, e o motivo da recusa e o mesmo dos dois lados.
  it('id como texto recusa por number.base, como no catálogo do QGIS', () => {
    recusaPor(
      fluxoSchema.camadasIds.validate({ camadas_ids: ['7'] }),
      ['camadas_ids', 0],
      'number.base'
    )
  })

  // O QUE JA NAO PASSAVA NEM ANTES DO `.strict()`: '7a' nao e numero por
  // conversao nenhuma. O caso fica porque separa as duas recusas.
  it('texto que não é número recusa', () => {
    recusaPor(
      fluxoSchema.camadasIds.validate({ camadas_ids: ['7a'] }),
      ['camadas_ids', 0],
      'number.base'
    )
  })

  it('id zero recusa antes do banco', () => {
    recusaPor(
      fluxoSchema.camadasIds.validate({ camadas_ids: [0] }),
      ['camadas_ids', 0],
      'number.positive'
    )
  })

  it('id fracionário recusa', () => {
    recusaPor(
      fluxoSchema.camadasIds.validate({ camadas_ids: [1.5] }),
      ['camadas_ids', 0],
      'number.integer'
    )
  })

  it('chave desconhecida recusa', () => {
    recusaPor(
      fluxoSchema.camadasIds.validate({ camadas_ids: [7], camadas: [] }),
      'camadas',
      'object.unknown'
    )
  })
})
