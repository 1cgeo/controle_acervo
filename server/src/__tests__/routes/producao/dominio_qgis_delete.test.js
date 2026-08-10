'use strict'

// OS NOVE `DELETE` DO CATALOGO DO QGIS, EXERCITADOS POR HTTP.
//
// O QUE ISTO PRENDE, e por que nao e mais uma varredura de texto. Ate 2026-08-09
// as nove exclusoes de `producao/dominio_qgis_route.js` eram provadas so por
// `fs.readFileSync` mais `toContain`: um teste que le o FONTE nao distingue
// `WHERE id = $<id>` de `WHERE id = $<id> OR TRUE`, nao sabe se a auditoria caiu
// na mesma transacao e nao sabe qual modulo a guarda cobra de verdade. Aqui a
// requisicao entra pelo Express, passa pelo `verifyPerfil` REAL, pelo Joi REAL e
// pelo controlador REAL; o que e duble e o PostgreSQL, e cada consulta que
// chegaria nele e formatada pelo mesmo caminho do driver (`db.pgp.as.format`) e
// conferida letra por letra.
//
// AS QUATRO PERGUNTAS DE CADA ROTA:
//
//   1. A GUARDA. `verifyPerfil('gerente', 'producao')`, e o segundo argumento nao
//      e decorativo: o default dele e 'acervo'. Aqui o duble so devolve perfil
//      quando a consulta da guarda pergunta pelo modulo 7, entao uma rota que
//      esquecesse o argumento nao passaria nem no caso de SUCESSO.
//   2. O ALVO. A lista de `DELETE` formatados e comparada com a lista INTEIRA
//      esperada: tabela certa, `WHERE` presente, id certo, um por id pedido.
//      `DELETE` sem `WHERE` deixa este arquivo vermelho.
//   3. A TRANSACAO E O RASTRO. Toda escrita sai pelo `t` da transacao, e o
//      evento de auditoria sai pelo MESMO `t`, logo depois do `DELETE` que ele
//      descreve. Auditoria que falha derruba a escrita, e a transacao consta
//      como desfeita.
//   4. O ERRO. Id inexistente e 404, cadastro que aponta para a linha e 400 sem
//      apagar nada, chave estrangeira crua vira 409 com frase da casa, e o
//      contrato do corpo prova o MOTIVO da recusa.
//
// ELE NAO ABRE CONEXAO, e por isso cai no pacote `test:rapido`.

const jwt = require('jsonwebtoken')
const request = require('supertest')

const { buildTestApp } = require('../../helpers/orcamento/testApp')
const { recusaPor } = require('../../helpers/joi')

const { JWT_SECRET } = require('../../../config')
const { db } = require('../../../database')

const rotaDominioQgis = require('../../../producao/dominio_qgis_route')
const dominioQgisSchema = require('../../../producao/dominio_qgis_schema')

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'

const token = () =>
  'Bearer ' + jwt.sign({ id: 1, uuid: UUID, cliente: 'sca_web' }, JWT_SECRET, { expiresIn: '1h' })

const app = buildTestApp([{ path: '/api/producao', router: rotaDominioQgis }])

// O MODULO `producao` E O CODE 7 de `dominio.modulo`. Escrito aqui como NUMERO
// de proposito: e o que a consulta da guarda leva formatada, e e o unico jeito
// de um teste distinguir 'producao' de 'acervo' sem ler o fonte da rota.
const MODULO_PRODUCAO = 7

// --- Os nove catalogos, na ordem em que o roteador os declara -----------------
//
// `assoc` e a tabela que a conferencia previa consulta ANTES de apagar. Os
// estilos nao tem nenhuma (a chave estrangeira responde sozinha por eles), e por
// isso `assoc: null` la.
const CATALOGOS = [
  {
    nome: 'grupo de estilos',
    caminho: '/grupo_estilos',
    chave: 'grupo_estilos_ids',
    schema: 'grupoEstilosIds',
    tabela: 'qgis.group_styles',
    rotulo: 'Grupo de estilos',
    linha: id => ({ id, nome: `grupo ${id}` }),
    assoc: 'producao.perfil_estilo',
    mensagemEmUso: 'O grupo de estilos possui perfil de estilos associados',
    mensagemOk: 'Grupo de estilos deletados com sucesso'
  },
  {
    nome: 'regras',
    caminho: '/regras',
    chave: 'regras_ids',
    schema: 'regrasIds',
    tabela: 'qgis.layer_rules',
    rotulo: 'Regra',
    linha: id => ({ id, nome: `regra ${id}`, regra: 'attr IS NOT NULL' }),
    assoc: 'producao.perfil_regras',
    mensagemEmUso: 'O grupo de regras possui perfil de regras associadas',
    mensagemOk: 'Regras deletadas com sucesso'
  },
  {
    nome: 'menus',
    caminho: '/menus',
    chave: 'menus_ids',
    schema: 'menusIds',
    tabela: 'qgis.qgis_menus',
    rotulo: 'Menu',
    linha: id => ({ id, nome: `menu ${id}`, definicao_menu: '{}' }),
    assoc: 'producao.perfil_menu',
    mensagemEmUso: 'O menu possui perfis associados',
    mensagemOk: 'Menus deletados com sucesso'
  },
  {
    nome: 'estilos',
    caminho: '/estilos',
    chave: 'estilos_ids',
    schema: 'estilosIds',
    tabela: 'qgis.layer_styles',
    rotulo: 'Estilo',
    // O DONO DO ESTILO E O GRUPO, e nao ele mesmo: `grupo_estilo_id` e o
    // agregado no mapa de auditoria. Sem a coluna aqui, a auditoria recusaria o
    // evento por agregado nao resolvido -- que e justamente a rede que ela e.
    linha: id => ({
      id,
      grupo_estilo_id: 42,
      f_table_schema: 'edicao',
      f_table_name: `camada_${id}`
    }),
    assoc: null,
    mensagemEmUso: null,
    mensagemOk: 'Estilos deletados com sucesso'
  },
  {
    nome: 'modelos',
    caminho: '/modelos',
    chave: 'modelos_ids',
    schema: 'modelosIds',
    tabela: 'qgis.qgis_models',
    rotulo: 'Modelo do QGIS',
    linha: id => ({ id, nome: `modelo ${id}`, descricao: 'd', model_xml: '<x/>' }),
    assoc: 'producao.perfil_model_qgis',
    mensagemEmUso: 'O modelo possui perfis associados',
    mensagemOk: 'Modelos deletados com sucesso'
  },
  {
    nome: 'alias',
    caminho: '/alias',
    chave: 'alias_ids',
    schema: 'aliasIds',
    tabela: 'qgis.layer_alias',
    rotulo: 'Alias',
    linha: id => ({ id, nome: `alias ${id}`, definicao_alias: '{}' }),
    assoc: 'producao.perfil_alias',
    mensagemEmUso: 'O alias possui perfis associados',
    mensagemOk: 'Alias deletados com sucesso'
  },
  {
    nome: 'temas',
    caminho: '/temas',
    chave: 'temas_ids',
    schema: 'temasIds',
    tabela: 'qgis.qgis_themes',
    rotulo: 'Tema',
    linha: id => ({ id, nome: `tema ${id}`, definicao_tema: '{}' }),
    assoc: 'producao.perfil_tema',
    mensagemEmUso: 'O tema possui perfis associados',
    mensagemOk: 'Temas deletados com sucesso'
  },
  {
    // O CAMINHO E SINGULAR E A CHAVE DO CORPO E PLURAL, e as duas coisas sao
    // contrato do SAP 2.3.5: quem manda o corpo e o SAP Gerente, compilado fora
    // deste repositorio.
    nome: 'workflows do DSGTools',
    caminho: '/workflow',
    chave: 'workflows_ids',
    schema: 'workflowsIds',
    tabela: 'qgis.workflow_dsgtools',
    rotulo: 'Workflow do DSGTools',
    linha: id => ({ id, nome: `workflow ${id}`, descricao: 'd', workflow_json: '{}' }),
    assoc: 'producao.perfil_workflow_dsgtools',
    mensagemEmUso: 'O workflow possui perfis associados',
    mensagemOk: 'Workflows deletados com sucesso'
  },
  {
    // `servidores_id`, no SINGULAR, e o unico fora do padrao `<coisa>_ids`. Fica
    // assim porque e o nome que o cliente compilado manda.
    nome: 'gerenciador do FME',
    caminho: '/configuracao/gerenciador_fme',
    chave: 'servidores_id',
    schema: 'gerenciadorFmeIds',
    tabela: 'qgis.gerenciador_fme',
    rotulo: 'Servidor do Gerenciador do FME',
    // O ENDERECO E OSTENSIVAMENTE FALSO: este repositorio e publico, e o que se
    // prova aqui e a FORMA da linha, nunca um valor de instalacao nenhuma.
    linha: id => ({ id, url: `http://servidor_de_teste/fmerest/${id}` }),
    assoc: 'producao.perfil_fme',
    mensagemEmUso: 'O servidor possui rotinas do FME associadas em perfil_fme',
    mensagemOk: 'Informações dos serviços do Gerenciador do FME deletadas com sucesso'
  }
]

// --- O duble do PostgreSQL ----------------------------------------------------

// A consulta da GUARDA e a unica que fala de `usuario_perfil`.
const EH_GUARDA = sql => sql.includes('dgeo.usuario_perfil')

// A conferencia previa de quem ainda aponta para a linha.
const EH_ASSOCIACAO = sql => /^SELECT 1 FROM /.test(sql)

// `auditoriaCtrl.lerAntes` monta sempre `SELECT t.* FROM <tabela> AS t WHERE
// t.id = <id>`, e e dele que sai o 404 de id inexistente.
const EH_LER_ANTES = sql => sql.startsWith('SELECT t.*')

const idDoLerAntes = sql => Number(/WHERE t\.id = (\d+)/.exec(sql)[1])

/**
 * @param {object} opcoes
 * @param {number|null} opcoes.perfilId  1 consulta, 2 operador, 3 gerente
 * @param {boolean} opcoes.administrador
 * @param {function} opcoes.linha        a linha que `lerAntes` devolve
 * @param {number[]} opcoes.ausentes     ids que NAO existem (viram 404)
 * @param {string|null} opcoes.emUso     tabela cuja conferencia acusa uso
 * @param {boolean} opcoes.auditoriaFalha
 * @param {string|null} opcoes.erroNoDelete  code do PostgreSQL a lancar
 */
const fabricar = ({
  perfilId = 3,
  administrador = false,
  linha = id => ({ id, nome: `linha ${id}` }),
  ausentes = [],
  emUso = null,
  auditoriaFalha = false,
  erroNoDelete = null
} = {}) => {
  // Cada consulta guarda QUEM a executou: `conn` e a conexao de fora, `tx#N` e a
  // transacao. E o que separa "auditou" de "auditou DENTRO da transacao".
  const consultas = []
  const transacoes = []

  const anotar = (dono, query, values) => {
    // `as.format` e o mesmo caminho do driver: parametro que falta lanca aqui, e
    // e o que prende um `$<x>` esquecido na consulta.
    const sql = db.pgp.as.format(query, values)
    consultas.push({ dono, sql })
    return sql
  }

  const responder = sql => {
    if (EH_GUARDA(sql)) {
      // O PERFIL SO EXISTE NO MODULO QUE A CONSULTA PERGUNTA. Uma rota que
      // esquecesse o segundo argumento de `verifyPerfil` perguntaria pelo
      // modulo 1 (acervo) e sairia daqui sem perfil nenhum.
      const doModulo = sql.includes(`up.modulo_id = ${MODULO_PRODUCAO}`)
      return { id: 1, administrador, perfil_id: doModulo ? perfilId : null }
    }
    if (EH_ASSOCIACAO(sql)) {
      return emUso && sql.includes(emUso) ? { '?column?': 1 } : null
    }
    if (EH_LER_ANTES(sql)) {
      const id = idDoLerAntes(sql)
      return ausentes.includes(id) ? null : linha(id)
    }
    return null
  }

  const metodos = dono => ({
    any: async (query, values) => {
      const r = responder(anotar(dono, query, values))
      return r ? [r] : []
    },
    one: async (query, values) => responder(anotar(dono, query, values)),
    oneOrNone: async (query, values) => responder(anotar(dono, query, values)),
    none: async (query, values) => {
      const sql = anotar(dono, query, values)
      if (auditoriaFalha && sql.includes('INSERT INTO auditoria.evento')) {
        // Mensagem NEUTRA de proposito: ela sai no envelope da resposta, e o
        // repositorio e publico.
        throw new Error('o rastro nao pode ser gravado')
      }
      if (erroNoDelete && sql.startsWith('DELETE FROM')) {
        const err = new Error('violacao de chave estrangeira')
        err.code = erroNoDelete
        throw err
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

const dublar = opcoes => {
  fabricado = fabricar(opcoes)
  db.conn = fabricado.conn
}

beforeEach(() => {
  connOriginal = db.conn
})

afterEach(() => {
  db.conn = connOriginal
})

const apagar = (caminho, corpo) =>
  request(app).delete(`/api/producao${caminho}`).set('Authorization', token()).send(corpo)

const sqlDe = filtro => fabricado.consultas.filter(c => filtro(c.sql))
const deletes = () => sqlDe(s => s.startsWith('DELETE FROM'))
const eventos = () => sqlDe(s => s.includes('INSERT INTO auditoria.evento'))

// --- A guarda -----------------------------------------------------------------

describe('a guarda dos DELETE do catálogo do QGIS', () => {
  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: a consulta da guarda pergunta pelo módulo producao, e não pelo acervo',
    async (_nome, cat) => {
      dublar({ perfilId: 3, linha: cat.linha })

      await apagar(cat.caminho, { [cat.chave]: [7] })

      const guarda = sqlDe(EH_GUARDA)
      expect(guarda).toHaveLength(1)
      expect(guarda[0].sql).toContain(`up.modulo_id = ${MODULO_PRODUCAO}`)
      // O 1 e o acervo, que e o default de `verifyPerfil`.
      expect(guarda[0].sql).not.toContain('up.modulo_id = 1')
    }
  )

  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: o operador do módulo producao não apaga catálogo',
    async (_nome, cat) => {
      dublar({ perfilId: 2, linha: cat.linha })

      const res = await apagar(cat.caminho, { [cat.chave]: [7] })

      expect(res.status).toBe(403)
      // A frase nomeia o piso E o modulo, e e ela que denuncia o argumento
      // esquecido: com o default, ela diria 'acervo'.
      expect(res.body.message).toBe('Usuário necessita do perfil gerente no módulo producao')
      expect(deletes()).toEqual([])
    }
  )

  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: quem só consulta não apaga',
    async (_nome, cat) => {
      dublar({ perfilId: 1, linha: cat.linha })

      const res = await apagar(cat.caminho, { [cat.chave]: [7] })

      expect(res.status).toBe(403)
      expect(deletes()).toEqual([])
    }
  )

  it('o administrador global passa mesmo sem linha de perfil no módulo', async () => {
    dublar({ perfilId: null, administrador: true, linha: CATALOGOS[0].linha })

    const res = await apagar(CATALOGOS[0].caminho, { [CATALOGOS[0].chave]: [7] })

    expect(res.status).toBe(201)
  })

  it('sem token não se apaga nada', async () => {
    dublar({})

    const res = await request(app)
      .delete('/api/producao/grupo_estilos')
      .send({ grupo_estilos_ids: [7] })

    expect(res.status).toBe(401)
    expect(deletes()).toEqual([])
  })
})

// --- O alvo -------------------------------------------------------------------

describe('o alvo do DELETE', () => {
  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: apaga exatamente os ids pedidos, na tabela do catálogo, com WHERE',
    async (_nome, cat) => {
      dublar({ linha: cat.linha })

      const res = await apagar(cat.caminho, { [cat.chave]: [7, 9] })

      expect(res.status).toBe(201)
      expect(res.body.message).toBe(cat.mensagemOk)
      // A LISTA INTEIRA, e nao um `toContain`: um `DELETE` a mais, um `WHERE`
      // que sumisse ou uma tabela trocada mudam esta comparacao.
      expect(deletes().map(c => c.sql)).toEqual([
        `DELETE FROM ${cat.tabela} WHERE id = 7`,
        `DELETE FROM ${cat.tabela} WHERE id = 9`
      ])
    }
  )

  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: um id só apaga uma linha só',
    async (_nome, cat) => {
      dublar({ linha: cat.linha })

      await apagar(cat.caminho, { [cat.chave]: [123] })

      expect(deletes().map(c => c.sql)).toEqual([
        `DELETE FROM ${cat.tabela} WHERE id = 123`
      ])
    }
  )

  // NENHUM DELETE ESCAPA PARA OUTRA TABELA. As nove exclusoes saem da mesma
  // fabrica (`operacoesDe`), e uma chave trocada no mapa `CATALOGOS` do
  // controlador faria a rota de temas apagar workflow sem erro nenhum.
  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: nenhuma outra tabela do catálogo é tocada',
    async (_nome, cat) => {
      dublar({ linha: cat.linha })

      await apagar(cat.caminho, { [cat.chave]: [7] })

      const outras = CATALOGOS.map(c => c.tabela).filter(t => t !== cat.tabela)
      for (const { sql } of deletes()) {
        for (const outra of outras) expect(sql).not.toContain(outra)
      }
    }
  )
})

// --- A transacao e o rastro ----------------------------------------------------

describe('a transação e a auditoria', () => {
  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: o DELETE e o evento saem da MESMA transação, nessa ordem',
    async (_nome, cat) => {
      dublar({ linha: cat.linha })

      await apagar(cat.caminho, { [cat.chave]: [7, 9] })

      expect(fabricado.transacoes).toHaveLength(1)
      expect(fabricado.transacoes[0].concluida).toBe(true)

      const dono = fabricado.transacoes[0].dono
      const escritas = sqlDe(s => s.startsWith('DELETE FROM') || s.includes('INSERT INTO auditoria.evento'))

      // Nenhuma das quatro escritas saiu pela conexao de fora da transacao.
      expect(escritas.map(c => c.dono)).toEqual([dono, dono, dono, dono])
      // E a ordem e apagar, registrar, apagar, registrar: o rastro de cada id
      // vem depois do DELETE que ele descreve.
      expect(escritas.map(c => (c.sql.startsWith('DELETE') ? 'apaga' : 'audita')))
        .toEqual(['apaga', 'audita', 'apaga', 'audita'])
    }
  )

  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: o evento diz a tabela, o registro e que a operação foi exclusão',
    async (_nome, cat) => {
      dublar({ linha: cat.linha })

      await apagar(cat.caminho, { [cat.chave]: [7] })

      expect(eventos()).toHaveLength(1)
      const sql = eventos()[0].sql
      expect(sql).toContain(`'${cat.tabela}'`)
      expect(sql).toContain("'D'")
      expect(sql).toContain(`'${UUID}'`)
      // O `dados_antes` e a linha lida do banco ANTES de apagar: exclusao sem
      // ele apagaria o registro e o que ele dizia junto.
      expect(sql).toContain('"id":7')
      expect(sql).toContain('DELETE /api/producao')
    }
  )

  // O DONO DO EVENTO DO ESTILO E O GRUPO, e nao o estilo: e o `entidade_id` que
  // faz a exclusao aparecer na ficha que alguem abre.
  it('o evento do estilo aponta o GRUPO como agregado', async () => {
    const estilos = CATALOGOS.find(c => c.caminho === '/estilos')
    dublar({ linha: estilos.linha })

    await apagar(estilos.caminho, { [estilos.chave]: [7] })

    expect(eventos()[0].sql).toContain("'catalogo_qgis', '42'")
  })

  // FALHAR AO AUDITAR DERRUBA A ESCRITA, e e deliberado: trilha que se perde em
  // silencio e pior que trilha nenhuma.
  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: auditoria que falha desfaz a exclusão',
    async (_nome, cat) => {
      dublar({ linha: cat.linha, auditoriaFalha: true })

      const res = await apagar(cat.caminho, { [cat.chave]: [7] })

      expect(res.status).toBe(500)
      expect(fabricado.transacoes[0].desfeita).toBe(true)
      expect(fabricado.transacoes[0].concluida).toBe(false)
    }
  )
})

// --- Os caminhos de erro -------------------------------------------------------

describe('os caminhos de erro', () => {
  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: id inexistente é 404 e desfaz o que já tinha apagado',
    async (_nome, cat) => {
      dublar({ linha: cat.linha, ausentes: [9] })

      const res = await apagar(cat.caminho, { [cat.chave]: [7, 9] })

      expect(res.status).toBe(404)
      expect(res.body.message).toBe(`${cat.rotulo} não encontrado(a)`)
      // O 7 chegou a ser apagado DENTRO da transacao, e a transacao caiu.
      expect(deletes().map(c => c.sql)).toEqual([
        `DELETE FROM ${cat.tabela} WHERE id = 7`
      ])
      expect(fabricado.transacoes[0].desfeita).toBe(true)
    }
  )

  it.each(CATALOGOS.filter(c => c.assoc).map(c => [c.nome, c]))(
    '%s: cadastro que ainda aponta para a linha é 400, e nada é apagado',
    async (_nome, cat) => {
      dublar({ linha: cat.linha, emUso: cat.assoc })

      const res = await apagar(cat.caminho, { [cat.chave]: [7, 9] })

      expect(res.status).toBe(400)
      expect(res.body.message).toBe(cat.mensagemEmUso)
      // A CONFERENCIA VEM ANTES DO PRIMEIRO DELETE: com ela no meio do laco, a
      // linha 7 ja teria sido apagada quando a 9 esbarrasse no perfil.
      expect(deletes()).toEqual([])
      expect(eventos()).toEqual([])
    }
  )

  // OS ESTILOS NAO TEM CONFERENCIA PREVIA, e a ausencia e a modelagem: quem
  // responde por eles e a chave estrangeira. O 23503 cru citaria o nome da
  // restricao, e a traducao o transforma em 409 com frase da casa.
  it('chave estrangeira que ninguém declarou vira 409 com frase da casa', async () => {
    const estilos = CATALOGOS.find(c => c.caminho === '/estilos')
    dublar({ linha: estilos.linha, erroNoDelete: '23503' })

    const res = await apagar(estilos.caminho, { [estilos.chave]: [7] })

    expect(res.status).toBe(409)
    expect(res.body.message).toBe(
      'Não é possível remover: existe cadastro que ainda aponta para este registro'
    )
    expect(fabricado.transacoes[0].desfeita).toBe(true)
  })

  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: lista vazia é 400 e nem chega ao banco',
    async (_nome, cat) => {
      dublar({ linha: cat.linha })

      const res = await apagar(cat.caminho, { [cat.chave]: [] })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('must contain at least 1 items')
      expect(deletes()).toEqual([])
    }
  )

  it.each(CATALOGOS.map(c => [c.nome, c]))(
    '%s: chave desconhecida no corpo é 400 com o nome que faltou',
    async (_nome, cat) => {
      dublar({ linha: cat.linha })

      const res = await apagar(cat.caminho, { ids: [7] })

      expect(res.status).toBe(400)
      expect(res.body.message).toContain('campo desconhecido "ids"')
      expect(deletes()).toEqual([])
    }
  )
})

// --- O contrato do corpo -------------------------------------------------------
//
// O MOTIVO DA RECUSA, e nao so que houve recusa: `recusaPor` prende o campo E a
// regra do Joi, porque um caso que so exige `error` definido continua verde
// depois que a regra que ele anuncia for removida.

describe('o contrato da lista de ids', () => {
  it.each(CATALOGOS.map(c => [c.nome, c]))('%s: a lista é obrigatória', (_nome, cat) => {
    recusaPor(dominioQgisSchema[cat.schema].validate({}), cat.chave, 'any.required')
  })

  it.each(CATALOGOS.map(c => [c.nome, c]))('%s: a lista vazia recusa pelo mínimo', (_nome, cat) => {
    recusaPor(dominioQgisSchema[cat.schema].validate({ [cat.chave]: [] }), cat.chave, 'array.min')
  })

  it.each(CATALOGOS.map(c => [c.nome, c]))('%s: o mesmo id duas vezes é pedido ambíguo', (_nome, cat) => {
    recusaPor(
      dominioQgisSchema[cat.schema].validate({ [cat.chave]: [7, 7] }),
      [cat.chave, 1],
      'array.unique'
    )
  })

  // `.strict()`: o id como TEXTO nao e convertido, senao um cliente que mandasse
  // '3' passaria a funcionar por acidente ate o dia em que mandasse '3a'.
  it.each(CATALOGOS.map(c => [c.nome, c]))('%s: id como texto não é convertido', (_nome, cat) => {
    recusaPor(
      dominioQgisSchema[cat.schema].validate({ [cat.chave]: ['7'] }),
      [cat.chave, 0],
      'number.base'
    )
  })

  // SERIAL COMECA EM 1: o 0 e o negativo sao erro de quem chamou, e nao um 404
  // depois de ir ao banco.
  it.each(CATALOGOS.map(c => [c.nome, c]))('%s: id zero recusa antes do banco', (_nome, cat) => {
    recusaPor(
      dominioQgisSchema[cat.schema].validate({ [cat.chave]: [0] }),
      [cat.chave, 0],
      'number.positive'
    )
  })

  it.each(CATALOGOS.map(c => [c.nome, c]))('%s: id fracionário recusa', (_nome, cat) => {
    recusaPor(
      dominioQgisSchema[cat.schema].validate({ [cat.chave]: [1.5] }),
      [cat.chave, 0],
      'number.integer'
    )
  })

  it.each(CATALOGOS.map(c => [c.nome, c]))('%s: chave desconhecida recusa', (_nome, cat) => {
    recusaPor(
      dominioQgisSchema[cat.schema].validate({ [cat.chave]: [7], ids: [8] }),
      'ids',
      'object.unknown'
    )
  })
})
