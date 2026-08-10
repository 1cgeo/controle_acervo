'use strict'

// OS DOZE DELETE QUE NASCEM DE UMA FABRICA SO, EXERCITADOS POR HTTP.
//
// O BURACO QUE ISTO FECHA, e ele e maior aqui do que em qualquer outra fatia:
// `perfil_route.js` declara as 49 rotas dos doze grupos por UMA funcao
// (`crudDePerfil`), e `perfil_ctrl.js` monta as quatro operacoes de cada grupo
// por OUTRA. Um defeito em qualquer das duas nao e um defeito, sao doze -- e a
// conferencia que existia era varredura de TEXTO do fonte, que prova que a linha
// esta escrita e nao que ela faz o que diz.
//
// TRES DEFEITOS DE FABRICA QUE ESTE ARQUIVO PRENDE:
//
//   1. O SEGUNDO ARGUMENTO DO `verifyPerfil`. O default dele e 'acervo': a
//      fabrica que o esquecesse faria as 49 rotas cobrarem perfil no ACERVO, sem
//      erro de sintaxe e sem nada na tela. Aqui as 49 sao lidas do STACK do
//      Express de verdade, e nao do texto do arquivo.
//   2. A CHAVE DO CORPO. Ela e irregular de nascenca (`perfil_fme_ids` mas
//      `perfis_alias_ids`), vem do SAP Gerente e nao pode ser uniformizada. A
//      fabrica recebe `chaveIds` por grupo, e trocar duas de lugar faria dois
//      grupos lerem `undefined` -- ou, pior, um deles apagar com a lista do
//      outro. Os doze sao chamados com a chave declarada, e depois com a chave
//      PARECIDA que alguem digitaria.
//   3. O ALVO DO `DELETE`. `sqlApagar` interpola o nome da tabela, e o caminho
//      da rota nao e o nome dela em 4 dos 12 (`perfil_modelo` ->
//      `producao.perfil_model_qgis`, `perfil_estilos` -> `perfil_estilo`,
//      `perfil_temas` -> `perfil_tema`, `perfil_dificuldade_operador` ->
//      `producao.habilitacao_dificuldade`). Cada grupo prova a SUA tabela.
//
// COMO A TRANSACAO E PROVADA, ja que nao ha banco: o duble de `tx` entrega uma
// ALCA DIFERENTE da conexao e conta a profundidade, e cada consulta fica gravada
// com a alca por onde entrou. Auditoria movida para fora da transacao vira
// assercao vermelha. O ROLLBACK de verdade so a suite de banco mede.
//
// ELE NAO ABRE CONEXAO, e por isso cai no pacote `test:rapido`.

const request = require('supertest')

const { db } = require('../../../database')

// O DEFAULT DO GUARDA DUBLADO E O MESMO DO `login/verify_perfil.js` DE VERDADE
// ('acervo'): e essa igualdade que faz a fabrica que esquece o segundo argumento
// aparecer aqui dizendo que cobra perfil no ACERVO.
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

const perfilRoute = require('../../../producao/perfil_route')
const perfilSchema = require('../../../producao/perfil_schema')

const app = buildTestApp([{ path: '/api/producao', router: perfilRoute }])

// OS DOZE GRUPOS, escritos a mao: esta lista e a SEGUNDA opiniao sobre o que a
// fabrica produziu. Deriva-la do proprio arquivo de rota faria o teste concordar
// com o defeito.
const GRUPOS = [
  ['fme', '/configuracao/perfil_fme', 'perfil_fme_ids', 'producao.perfil_fme', 'Perfis FME excluídos com sucesso'],
  ['menu', '/configuracao/perfil_menu', 'perfil_menu_ids', 'producao.perfil_menu', 'Perfis de menu QGIS excluídos com sucesso'],
  ['linhagem', '/configuracao/perfil_linhagem', 'perfil_linhagem_ids', 'producao.perfil_linhagem', 'Perfis de linhagem excluídos com sucesso'],
  ['modelo', '/configuracao/perfil_modelo', 'perfil_modelo_ids', 'producao.perfil_model_qgis', 'Perfis de modelo QGIS excluídos com sucesso'],
  ['regras', '/configuracao/perfil_regras', 'perfil_regras_ids', 'producao.perfil_regras', 'Perfis de regras excluídos com sucesso'],
  ['estilos', '/configuracao/perfil_estilos', 'perfil_estilos_ids', 'producao.perfil_estilo', 'Perfis de estilos excluídos com sucesso'],
  ['requisitoFinalizacao', '/configuracao/perfil_requisito_finalizacao', 'perfil_requisito_ids', 'producao.perfil_requisito_finalizacao', 'Requisitos de finalização excluídos com sucesso'],
  ['alias', '/configuracao/perfil_alias', 'perfis_alias_ids', 'producao.perfil_alias', 'Perfis de alias excluídos com sucesso'],
  ['temas', '/configuracao/perfil_temas', 'perfil_temas_ids', 'producao.perfil_tema', 'Perfis de tema excluídos com sucesso'],
  ['configuracaoQgis', '/configuracao/perfil_configuracao_qgis', 'perfis_configuracao_qgis_ids', 'producao.perfil_configuracao_qgis', 'Perfis de configuração do QGIS excluídos com sucesso'],
  ['workflowDsgtools', '/configuracao/perfil_workflow_dsgtools', 'perfil_workflow_dsgtools_ids', 'producao.perfil_workflow_dsgtools', 'Perfis de workflow DSGTools excluídos com sucesso'],
  // O UNICO FEMININO, e a unica que fala de PESSOAS. O caminho continua
  // `perfil_dificuldade_operador` porque e ele que o SAP Gerente chama; a tabela
  // e `habilitacao_dificuldade` porque no SCA "perfil" ja quer dizer
  // autorizacao.
  ['dificuldadeOperador', '/configuracao/perfil_dificuldade_operador', 'perfis_dificuldade_operador_ids', 'producao.habilitacao_dificuldade', 'Habilitações por dificuldade excluídas com sucesso']
]

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

// A LINHA QUE O `lerAntes` DEVOLVE. `lote_id` e obrigatorio: o agregado das doze
// e o LOTE, e sem ele a auditoria derruba a escrita com "o agregado dono nao foi
// resolvido" -- que e o comportamento desejado e nao um detalhe do duble.
const linhaDe = id => ({
  id,
  subfase_id: 3,
  lote_id: 55,
  nome: `linha ${id}`
})

// Responde a leitura anterior de QUALQUER das doze tabelas: o `lerAntes` monta
// sempre `SELECT t.* FROM <tabela> AS t WHERE t.id = <id>`.
const dublarLeitura = (ids = [7]) =>
  dublar(ids.map(id => [`AS t WHERE t.id = ${id}`, [linhaDe(id)]]))

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

// --- A guarda, nas 49 rotas de uma vez ---------------------------------------

const guardaDa = layer =>
  layer.route.stack.map(h => h.handle && h.handle.guarda).find(g => g)

const GERENTE_PRODUCAO = { minimo: 'gerente', modulo: 'producao' }

describe('a guarda que a fábrica põe', () => {
  // AS 49 DE UMA VEZ, e nao so os DELETE: a fabrica declara os quatro metodos, e
  // um `verifyPerfil` sem modulo em qualquer um deles e o mesmo defeito.
  it('cobra gerente do módulo producao em TODAS as rotas do arquivo', () => {
    const guardas = perfilRoute.stack
      .filter(l => l.route)
      .map(l => guardaDa(l))

    expect(guardas).toHaveLength(49)
    expect(guardas.every(g => g && g.minimo === 'gerente' && g.modulo === 'producao'))
      .toBe(true)
  })

  // OS DOZE CAMINHOS DE DELETE, e nao onze nem treze: um grupo que perdesse a
  // chamada da fabrica sumiria daqui, e um DELETE declarado a mao apareceria.
  it('produz exatamente doze caminhos de DELETE, e são os doze grupos', () => {
    const deletes = perfilRoute.stack
      .filter(l => l.route && l.route.methods.delete)
      .map(l => ({ caminho: l.route.path, guarda: guardaDa(l) }))

    expect(deletes).toEqual(
      GRUPOS.map(([, caminho]) => ({ caminho, guarda: GERENTE_PRODUCAO }))
    )
  })

  // A COPIA ENTRE LOTES E DECLARADA A MAO, e nao pela fabrica: ela e a unica
  // rota do arquivo que nao tem irmas de mesmo caminho.
  it('a cópia entre lotes é POST, e não ganhou um DELETE de brinde', () => {
    const copia = perfilRoute.stack.filter(
      l => l.route && l.route.path === '/configuracao/lote/copiar'
    )

    expect(copia).toHaveLength(1)
    expect(copia[0].route.methods).toEqual({ post: true })
  })
})

// --- Cada grupo apaga na SUA tabela ------------------------------------------

describe('o alvo de cada um dos doze DELETE', () => {
  it.each(GRUPOS)(
    'o grupo %s apaga em %s → %s',
    async (_nome, caminho, chaveIds, tabela, mensagem) => {
      dublarLeitura([7])

      const res = await request(app)
        .delete(`/api/producao${caminho}`)
        .send({ [chaveIds]: [7] })

      expect(res.status).toBe(200)
      expect(res.body.message).toBe(mensagem)

      // IGUALDADE: um `DELETE` sem `WHERE`, contra a tabela do grupo vizinho ou
      // com o id de outro lugar deixa esta linha vermelha.
      expect(apagamentos().map(e => normalizar(e.sql))).toEqual([
        `DELETE FROM ${tabela} WHERE id = 7`
      ])

      // E O DELETE NAO ESCREVE: um `ctrl.criar` no lugar do `ctrl.deletar` na
      // fabrica passaria por qualquer assercao sobre o codigo HTTP.
      expect(consultas().filter(e => /INSERT INTO producao\./.test(e.sql))).toEqual([])
    }
  )

  it.each(GRUPOS)(
    'o grupo %s audita a exclusão em %s, dentro da transação',
    async (_nome, caminho, chaveIds, tabela) => {
      dublarLeitura([7])

      await request(app)
        .delete(`/api/producao${caminho}`)
        .send({ [chaveIds]: [7] })

      expect(eventos()).toHaveLength(1)

      const evento = eventos()[0]
      expect(evento.via).toBe('tx')
      expect(evento.dentro).toBe(true)
      expect(evento.valores.tabela).toBe(tabela)
      expect(evento.valores.operacao).toBe('D')
      expect(evento.valores.registroId).toBe('7')
      expect(evento.valores.modulo).toBe('producao')
      // O AGREGADO DAS DOZE E O LOTE: ninguem abre "perfil de menu n.o 812",
      // abre O LOTE e olha como a subfase dele esta configurada.
      expect(evento.valores.entidadeId).toBe('55')
      expect(evento.valores.entidade).toBe('lote')
      expect(evento.valores.rota).toBe(`DELETE /api/producao${caminho}`)
      expect(evento.valores.dadosDepois).toBeNull()
    }
  )
})

// --- A chave do corpo, que é irregular de nascença ---------------------------

const chaveParecida = chave =>
  chave.startsWith('perfis_')
    ? chave.replace('perfis_', 'perfil_')
    : chave.replace('perfil_', 'perfis_')

describe('a chave do corpo de cada grupo', () => {
  // O VALIDADOR ESTRITO RECUSA A CHAVE PARECIDA, e sugere a certa. Descartada em
  // silencio, a exclusao responderia 400 por lista ausente -- ou, se a chave
  // fosse trocada entre dois grupos, apagaria a linha errada com 200.
  it.each(GRUPOS)(
    'o grupo %s recusa %s com a chave parecida',
    async (_nome, caminho, chaveIds) => {
      dublarLeitura([7])

      const errada = chaveParecida(chaveIds)

      const res = await request(app)
        .delete(`/api/producao${caminho}`)
        .send({ [errada]: [7] })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('campo desconhecido')
      expect(res.body.message).toContain(errada)
      expect(apagamentos()).toEqual([])
    }
  )

  it.each(GRUPOS)(
    'o grupo %s recusa a lista vazia em %s com 400',
    async (_nome, caminho, chaveIds) => {
      dublarLeitura([7])

      const res = await request(app)
        .delete(`/api/producao${caminho}`)
        .send({ [chaveIds]: [] })

      expect(res.status).toBe(400)
      expect(apagamentos()).toEqual([])
      expect(eventos()).toEqual([])
    }
  )
})

// --- Dois grupos ponta a ponta -----------------------------------------------
//
// O MENU e a HABILITACAO POR DIFICULDADE, escolhidos de proposito: o primeiro e
// o caso regular (caminho igual a tabela, rotulo masculino) e o segundo e o que
// diverge em TUDO (caminho `perfil_dificuldade_operador`, tabela
// `habilitacao_dificuldade`, chave `perfis_...`, rotulo feminino).

describe('DELETE /configuracao/perfil_menu, ponta a ponta', () => {
  it('lê o estado anterior, apaga e audita, nesta ordem e uma vez por id', async () => {
    dublarLeitura([7, 9])

    const res = await request(app)
      .delete('/api/producao/configuracao/perfil_menu')
      .send({ perfil_menu_ids: [7, 9] })

    expect(res.status).toBe(200)

    const passos = consultas().map(e => {
      if (e.sql.includes('INSERT INTO auditoria.evento')) return 'audita'
      if (e.sql.includes('DELETE FROM')) return 'apaga'
      return 'lê'
    })

    expect(passos).toEqual(['lê', 'apaga', 'audita', 'lê', 'apaga', 'audita'])
    expect(consultas().every(e => e.via === 'tx' && e.dentro)).toBe(true)
    expect(apagamentos().map(e => normalizar(e.sql))).toEqual([
      'DELETE FROM producao.perfil_menu WHERE id = 7',
      'DELETE FROM producao.perfil_menu WHERE id = 9'
    ])
    expect(eventos().map(e => e.valores.registroId)).toEqual(['7', '9'])
  })

  // O ESTADO ANTERIOR VAI INTEIRO PARA O RASTRO: sem ele, a exclusao seria a
  // unica operacao do sistema que nao diz o que foi apagado.
  it('grava no rastro a linha que foi apagada', async () => {
    dublarLeitura([7])

    await request(app)
      .delete('/api/producao/configuracao/perfil_menu')
      .send({ perfil_menu_ids: [7] })

    const antes = JSON.parse(eventos()[0].valores.dadosAntes)
    expect(antes.id).toBe(7)
    expect(antes.subfase_id).toBe(3)
    expect(antes.lote_id).toBe(55)
  })

  // O 404 ACONTECE DENTRO DA TRANSACAO, e e o que garante que o primeiro id ja
  // apagado volte atras: e o `lerAntes` que faz as duas coisas numa consulta.
  it('responde 404 quando um id não existe, e para ali', async () => {
    dublarLeitura([7])

    const res = await request(app)
      .delete('/api/producao/configuracao/perfil_menu')
      .send({ perfil_menu_ids: [7, 9] })

    expect(res.status).toBe(404)
    expect(res.body.message).toBe('um perfil de menu não encontrado(a)')

    // O SEGUNDO NAO FOI APAGADO, e o primeiro so sobrevive ao rollback.
    expect(apagamentos().map(e => normalizar(e.sql))).toEqual([
      'DELETE FROM producao.perfil_menu WHERE id = 7'
    ])
    expect(registro.some(e => e.marca === 'tx:rollback')).toBe(true)
    expect(registro.some(e => e.marca === 'tx:fim')).toBe(false)
  })
})

describe('DELETE /configuracao/perfil_dificuldade_operador, ponta a ponta', () => {
  it('apaga na habilitacao_dificuldade e responde no feminino', async () => {
    dublarLeitura([7])

    const res = await request(app)
      .delete('/api/producao/configuracao/perfil_dificuldade_operador')
      .send({ perfis_dificuldade_operador_ids: [7] })

    expect(res.status).toBe(200)
    expect(res.body.message).toBe('Habilitações por dificuldade excluídas com sucesso')
    expect(apagamentos().map(e => normalizar(e.sql))).toEqual([
      'DELETE FROM producao.habilitacao_dificuldade WHERE id = 7'
    ])
    // O CAMINHO DA ROTA NAO E O NOME DA TABELA, e as duas coisas convivem: o
    // caminho e do SAP Gerente e a tabela e do SCA.
    expect(apagamentos()[0].sql).not.toContain('perfil_dificuldade_operador')
  })

  it('responde 404 com o rótulo próprio do grupo', async () => {
    dublarLeitura([])

    const res = await request(app)
      .delete('/api/producao/configuracao/perfil_dificuldade_operador')
      .send({ perfis_dificuldade_operador_ids: [7] })

    expect(res.status).toBe(404)
    expect(res.body.message).toBe('uma habilitação por dificuldade não encontrado(a)')
    expect(apagamentos()).toEqual([])
  })
})

// --- O contrato dos ids ------------------------------------------------------

describe('o schema de ids que a fábrica dá aos doze', () => {
  // A LISTA VAZIA E RECUSADA, e o codigo HTTP e 400: e o que os casos por HTTP
  // acima medem. AQUI FICA O MOTIVO, e ele merece nota.
  //
  // PENDENCIA DE MENSAGEM (nao e defeito de comportamento): `grupoDePerfil` poe
  // o `.required()` NO ITEM (`items(inteiro().required())`), e por isso a lista
  // vazia recusa por `array.includesRequiredUnknowns` ("does not contain 1
  // required value(s)"), e nao por `array.min`. Os dois schemas irmaos desta
  // mesma fatia -- `insumo_schema.js` e `trabalho_schema.js` -- documentam com
  // todas as letras que o `.required()` fica NO ARRAY justamente para evitar
  // essa mensagem, que anuncia a quem le um requisito que ninguem escreveu. A
  // assercao abaixo aceita as duas regras de proposito: ela prende o CAMPO, e
  // continua verde no dia em que a fabrica for corrigida.
  it.each(GRUPOS)(
    'o grupo %s recusa a lista vazia, e a recusa é no campo dele',
    (nome, _caminho, chaveIds) => {
      const resultado = perfilSchema.grupos[nome].ids.validate({ [chaveIds]: [] })

      recusaPor(resultado, chaveIds)
      expect(['array.min', 'array.includesRequiredUnknowns'])
        .toContain(resultado.error.details[0].type)
    }
  )

  it.each(GRUPOS)(
    'o grupo %s recusa a chave ausente',
    (nome, _caminho, chaveIds) => {
      recusaPor(
        perfilSchema.grupos[nome].ids.validate({}),
        chaveIds,
        'any.required'
      )
    }
  )

  // `.strict()` EM TODO NUMERO, como no SAP: sem ele a string '7' vira 7, e um
  // corpo com aspas sobrando apaga a linha 7 sem ninguem perceber.
  it.each(GRUPOS)(
    'o grupo %s recusa o id como texto',
    (nome, _caminho, chaveIds) => {
      recusaPor(
        perfilSchema.grupos[nome].ids.validate({ [chaveIds]: ['7'] }),
        [chaveIds, 0],
        'number.base'
      )
    }
  )

  // O ID REPETIDO INFLARIA A CONTAGEM DO RASTRO sem mudar nada no banco: o
  // segundo `DELETE` do mesmo id nao apaga linha nenhuma, e o `lerAntes` dele
  // e que produziria um 404 confuso.
  it.each(GRUPOS)(
    'o grupo %s recusa o id repetido',
    (nome, _caminho, chaveIds) => {
      recusaPor(
        perfilSchema.grupos[nome].ids.validate({ [chaveIds]: [7, 7] }),
        [chaveIds, 1],
        'array.unique'
      )
    }
  )
})
