'use strict'

// OS DEZ DELETE DO METADADO, EXERCITADOS POR HTTP COM O BANCO DUBLADO.
//
// Ate 2026-08-09 este modulo tinha dez rotas de exclusao e UMA linha de teste
// que chegava a alguma delas (`metadado_escrita.test.js`, sobre
// `apagarCreditosQpt`, chamando o controlador direto). Nove nunca foram
// executadas, e nenhuma tinha a rota exercitada: o Joi da porta, a guarda de
// perfil e o nome do campo do corpo ficavam de fora, e sao justamente eles que
// falham em silencio. Um `req.body.creditos_qpt_ids` digitado com o nome errado
// entrega `undefined` ao controlador, que percorre `undefined` e responde 500
// onde a requisicao estava correta.
//
// O QUE CADA CASO PRENDE, e nenhum deles aparece num teste de varredura:
//
//   1. A GUARDA, com o modulo. O segundo argumento de `verifyPerfil` tem default
//      'acervo': uma rota daqui que o esquecesse cobraria perfil no ACERVO, sem
//      erro de sintaxe e sem tela quebrada. O duble abaixo repete a regra do
//      `login/verify_perfil.js` INCLUSIVE O DEFAULT, e por isso o caso "gerente
//      so no acervo" e o que pega o esquecimento: com o modulo certo ele tem de
//      responder 403.
//   2. O ALVO. A sentenca conferida e a FORMATADA pelo caminho do driver
//      (`db.pgp.as.format`), com o valor ja substituido: um DELETE que perdesse
//      o `WHERE` deixa de casar a igualdade e o caso fica vermelho.
//   3. A TRANSACAO E A AUDITORIA. Nada escreve fora de `db.conn.tx` -- os
//      metodos do `db.conn` de nivel de cima do duble LANCAM --, e o evento cai
//      na mesma transacao, com a entidade que `auditoria/mapa/metadado.js`
//      declara. Falhar ao auditar derruba a exclusao, e isso e medido.
//   4. O CAMINHO DE ERRO: alvo inexistente (404 com o nome do registro), lista
//      em que um id nao existe (a transacao inteira volta), violacao de chave
//      estrangeira e de unicidade (que ESTE modulo traduz para 400).
//   5. O MOTIVO DA RECUSA DO SCHEMA, por `recusaPor`, e nao so que houve recusa.
//
// E O ULTIMO BLOCO cobre o que a exclusao REMEDIA: `informacoes_edicao` e
// `informacoes_produto` nao tem UNIQUE por `lote_id` (`er/metadado.sql`), o POST
// aceita a segunda linha, e a partir dali `buscaUmComQueda` (que le por
// `oneOrNone`) derruba a geracao do XML de TODA versao daquele lote. Apagar a
// linha sobrando e o unico conserto que existe hoje.
//
// NADA AQUI ABRE CONEXAO, e por isso o arquivo roda no pacote `rapido`.

// O logger de verdade escreve em disco e no console a cada resposta, e aqui ele
// nao e o objeto de estudo.
jest.mock('../../../utils/logger', () => ({
  info: () => {},
  warn: () => {},
  error: () => {},
  debug: () => {}
}))

// O GUARDA DUBLADO, com a MESMA regra do `login/verify_perfil.js`: niveis
// hierarquicos, administrador global que atravessa qualquer modulo e -- o que
// mais importa aqui -- o default 'acervo' no segundo argumento.
jest.mock('../../../login', () => {
  const { AppError, httpCode } = require('../../../utils')

  const NIVEL = { consulta: 1, operador: 2, gerente: 3 }

  const usuario = {
    uuid: '3f1c2b5e-2f4a-4a3b-8d21-9c7e6a1b2c3d',
    administrador: false,
    perfis: {}
  }

  const verifyPerfil = (minimo, modulo = 'acervo') => (req, res, next) => {
    // O guarda de verdade tambem monta o contexto da rastreabilidade, e e dele
    // que sai a rota gravada no evento.
    req.usuarioUuid = usuario.uuid
    req.contexto = {
      origem: 'web',
      rota: `${req.method} ${req.baseUrl}${req.route ? req.route.path : req.path}`,
      loteId: 'a3bb189e-8bf9-3888-9912-ace4e6543002'
    }

    if (usuario.administrador) return next()

    const perfil = usuario.perfis[modulo]
    if (!perfil || NIVEL[perfil] < NIVEL[minimo]) {
      return next(
        new AppError(
          `Usuário necessita do perfil ${minimo} no módulo ${modulo}`,
          httpCode.Forbidden
        )
      )
    }
    return next()
  }

  return { verifyPerfil, __usuario: usuario }
})

const express = require('express')
const request = require('supertest')

const { db } = require('../../../database')

const { sendJsonAndLogMiddleware, errorHandler } = require('../../../utils')

const login = require('../../../login')
const metadadoRoute = require('../../../metadado/metadado_route')
const metadadoCtrl = require('../../../metadado/metadado_ctrl')
const metadadoSchema = require('../../../metadado/metadado_schema')

const { recusaPor } = require('../../helpers/joi')

const { SUBTIPO_PRODUTO } = metadadoCtrl._helpers

// --- O app minimo, com a mesma pilha do `server/app.js` ----------------------

const app = express()
app.use(sendJsonAndLogMiddleware)
app.use(express.json())
app.use('/api/metadados', metadadoRoute)
app.use((err, req, res, next) => errorHandler.log(err, res))

// --- As dez rotas de exclusao ------------------------------------------------
//
// `entidade` e `agregado` sao o que `auditoria/mapa/metadado.js` declara para a
// linha apagada, e nao uma copia de conveniencia: e a conferencia de que a
// exclusao cai na ficha que a pessoa abre. As seis tabelas com XOR caem na ficha
// do PRODUTO quando a linha traz `versao_id`, e o produto esta a um salto.

const ID = 5
const PRODUTO_DA_VERSAO = 99
const LOTE = 7

const ROTAS = [
  {
    rota: '/usuario',
    campo: 'usuarios_ids',
    schema: 'usuarioIds',
    tabela: 'metadado.usuario',
    nome: 'Metadado de usuário',
    entidade: 'usuario_metadado',
    agregado: String(ID)
  },
  {
    rota: '/informacoes_produto',
    campo: 'informacoes_produto_ids',
    schema: 'informacoesProdutoIds',
    tabela: 'metadado.informacoes_produto',
    nome: 'Informação do produto',
    entidade: 'produto',
    agregado: String(PRODUTO_DA_VERSAO)
  },
  {
    rota: '/responsavel_fase_produto',
    campo: 'responsavel_fase_produto_ids',
    schema: 'responsavelFaseProdutoIds',
    tabela: 'metadado.responsavel_fase_produto',
    nome: 'Responsável por fase',
    entidade: 'produto',
    agregado: String(PRODUTO_DA_VERSAO)
  },
  {
    rota: '/palavra_chave_produto',
    campo: 'palavras_chave_produto_ids',
    schema: 'palavraChaveProdutoIds',
    tabela: 'metadado.palavra_chave_produto',
    nome: 'Palavra-chave do produto',
    entidade: 'produto',
    agregado: String(PRODUTO_DA_VERSAO)
  },
  {
    rota: '/creditos_qpt',
    campo: 'creditos_qpt_ids',
    schema: 'creditosQptIds',
    tabela: 'metadado.creditos_qpt',
    nome: 'Crédito QPT',
    entidade: 'creditos_qpt',
    agregado: String(ID)
  },
  {
    rota: '/informacoes_edicao',
    campo: 'informacoes_edicao_ids',
    schema: 'informacoesEdicaoIds',
    tabela: 'metadado.informacoes_edicao',
    nome: 'Informação de edição',
    entidade: 'produto',
    agregado: String(PRODUTO_DA_VERSAO)
  },
  {
    rota: '/imagens_carta_ortoimagem',
    campo: 'imagens_carta_ortoimagem_ids',
    schema: 'imagensCartaOrtoimagemIds',
    tabela: 'metadado.imagens_carta_ortoimagem',
    nome: 'Imagem da carta ortoimagem',
    entidade: 'produto',
    agregado: String(PRODUTO_DA_VERSAO)
  },
  {
    rota: '/classes_complementares_orto',
    campo: 'classes_complementares_orto_ids',
    schema: 'classesComplementaresOrtoIds',
    tabela: 'metadado.classes_complementares_orto',
    nome: 'Lista de classes complementares',
    entidade: 'classes_complementares_orto',
    agregado: String(ID)
  },
  {
    rota: '/perfil_classes_complementares_orto',
    campo: 'perfil_classes_complementares_orto_ids',
    schema: 'perfilClassesComplementaresOrtoIds',
    tabela: 'metadado.perfil_classes_complementares_orto',
    nome: 'Perfil de classes complementares',
    entidade: 'produto',
    agregado: String(PRODUTO_DA_VERSAO)
  },
  {
    rota: '/sensor_carta_ortoimagem',
    campo: 'sensor_carta_ortoimagem_ids',
    schema: 'sensorCartaOrtoimagemIds',
    tabela: 'metadado.sensor_carta_ortoimagem',
    nome: 'Sensor da carta ortoimagem',
    entidade: 'produto',
    agregado: String(PRODUTO_DA_VERSAO)
  }
]

const casos = ROTAS.map(c => [c.rota, c])

// --- O banco dublado ---------------------------------------------------------
//
// Ele responde pelo CONTEUDO da consulta, e nunca pela ordem das chamadas: a
// ordem e detalhe do controlador e mudaria a cada refatoracao.

// A linha lida antes da exclusao. `versao_id` preenchido e o caso comum, e e o
// que manda o evento para a ficha do produto.
const linhaAntes = params => ({
  id: params.id,
  code: params.id,
  nome: 'estado anterior',
  versao_id: 10,
  lote_id: null
})

const criarBanco = (opcoes = {}) => {
  const antes = opcoes.antes || linhaAntes
  const falha = opcoes.falha || null

  const chamadas = []
  const estado = { transacoes: 0, rollback: false, commit: false }

  const registrar = (marca, sql, params, naTx) => {
    chamadas.push({
      marca,
      bruto: String(sql),
      // `as.format` E O MESMO CAMINHO DO DRIVER: ele lanca em parametro que
      // falta, e e o que prende um `$<x>` esquecido na consulta.
      sql: db.pgp.as.format(sql, params),
      params,
      naTx
    })
  }

  const talvezFalhar = sql => {
    if (falha && falha.casa.test(String(sql))) throw falha.erro
  }

  const marcaDe = sql => {
    const texto = String(sql)
    if (texto.includes('INSERT INTO auditoria.evento')) return 'EVENTO'
    if (texto.includes('DELETE FROM')) return 'DELETE'
    if (texto.includes('SELECT produto_id FROM acervo.versao')) return 'AGREGADO'
    return 'SELECT'
  }

  const t = {
    oneOrNone: async (sql, params) => {
      const marca = marcaDe(sql)
      registrar(marca, sql, params, true)
      talvezFalhar(sql)
      // O salto do mapa de auditoria: a linha guarda `versao_id`, e a ficha e a
      // do PRODUTO daquela versao.
      if (marca === 'AGREGADO') return { produto_id: PRODUTO_DA_VERSAO }
      return antes(params)
    },
    none: async (sql, params) => {
      registrar(marcaDe(sql), sql, params, true)
      talvezFalhar(sql)
      return null
    },
    one: async (sql, params) => {
      registrar(marcaDe(sql), sql, params, true)
      talvezFalhar(sql)
      return { id: params.id }
    },
    any: async (sql, params) => {
      registrar(marcaDe(sql), sql, params, true)
      talvezFalhar(sql)
      return []
    },
    batch: async promessas => Promise.all(promessas)
  }

  // ESCRITA FORA DA TRANSACAO LANCA, e nao passa despercebida: e a regra da casa
  // que este arquivo existe para prender.
  const foraDaTx = nome => async () => {
    throw new Error(`escrita fora da transação: db.conn.${nome} foi chamado direto`)
  }

  db.conn = {
    one: foraDaTx('one'),
    none: foraDaTx('none'),
    oneOrNone: foraDaTx('oneOrNone'),
    any: foraDaTx('any'),
    task: foraDaTx('task'),
    tx: async cb => {
      estado.transacoes += 1
      try {
        const r = await cb(t)
        estado.commit = true
        return r
      } catch (err) {
        estado.rollback = true
        throw err
      }
    }
  }

  return { chamadas, estado }
}

const marcas = banco => banco.chamadas.map(c => c.marca)
const das = (banco, marca) => banco.chamadas.filter(c => c.marca === marca)

let connOriginal
let banco

beforeEach(() => {
  connOriginal = db.conn
  login.__usuario.administrador = false
  login.__usuario.perfis = { producao: 'gerente' }
  banco = criarBanco()
})

afterEach(() => {
  db.conn = connOriginal
})

const apagar = (caso, ids = [ID]) =>
  request(app).delete(`/api/metadados${caso.rota}`).send({ [caso.campo]: ids })

// =============================================================================
// 1. A GUARDA
// =============================================================================

describe('A guarda de cada DELETE é gerente NO MÓDULO producao', () => {
  it.each(casos)('DELETE %s exige gerente, e não consulta', async (_rota, caso) => {
    login.__usuario.perfis = { producao: 'consulta' }

    const r = await apagar(caso)

    expect(r.status).toBe(403)
    expect(r.body.message).toContain('perfil gerente')
    expect(banco.chamadas).toHaveLength(0)
  })

  // O CASO QUE PEGA O ESQUECIMENTO DO SEGUNDO ARGUMENTO. Gerente do ACERVO e
  // exatamente quem entraria numa rota que chamasse `verifyPerfil('gerente')`
  // sem o modulo -- e a exclusao aconteceria sem nada acusar.
  it.each(casos)('DELETE %s não abre para o gerente do acervo', async (_rota, caso) => {
    login.__usuario.perfis = { acervo: 'gerente' }

    const r = await apagar(caso)

    expect(r.status).toBe(403)
    expect(r.body.message).toContain('no módulo producao')
    expect(banco.chamadas).toHaveLength(0)
  })

  it.each(casos)('DELETE %s abre para o gerente da produção', async (_rota, caso) => {
    const r = await apagar(caso)

    expect(r.status).toBe(200)
    expect(r.body.success).toBe(true)
  })

  // Quem nao tem linha para modulo nenhum nao alcanca a rota, e o administrador
  // global atravessa qualquer modulo.
  it('sem perfil em módulo nenhum, ninguém apaga', async () => {
    login.__usuario.perfis = {}

    const r = await apagar(ROTAS[0])

    expect(r.status).toBe(403)
    expect(banco.chamadas).toHaveLength(0)
  })

  it('o administrador global atravessa', async () => {
    login.__usuario.perfis = {}
    login.__usuario.administrador = true

    const r = await apagar(ROTAS[0])

    expect(r.status).toBe(200)
  })
})

// =============================================================================
// 2. O ALVO
// =============================================================================

describe('O DELETE apaga a linha pedida, e só ela', () => {
  // A SENTENCA FORMATADA, com o valor ja substituido pelo caminho do driver.
  // Perdido o `WHERE`, a igualdade abaixo deixa de casar.
  it.each(casos)('DELETE %s apaga por id, na tabela certa', async (_rota, caso) => {
    const r = await apagar(caso)

    expect(r.status).toBe(200)
    expect(das(banco, 'DELETE').map(c => c.sql)).toEqual([
      `DELETE FROM ${caso.tabela} WHERE id = ${ID}`
    ])
  })

  // NENHUMA OUTRA TABELA E TOCADA: a exclusao de uma linha do catalogo nao pode
  // alcancar a declaracao que aponta para ela por conta propria.
  it.each(casos)('DELETE %s não escreve em outra tabela', async (_rota, caso) => {
    await apagar(caso)

    const escritas = banco.chamadas.filter(c => c.marca === 'DELETE' || c.marca === 'EVENTO')
    for (const c of escritas) {
      const alvo = c.marca === 'EVENTO' ? 'auditoria.evento' : caso.tabela
      expect(c.bruto).toContain(alvo)
    }
    expect(banco.chamadas.some(c => /INSERT INTO metadado\.|UPDATE metadado\./.test(c.bruto)))
      .toBe(false)
  })

  // O CAMPO DO CORPO E O QUE O CONTROLADOR RECEBE. Um nome trocado na rota
  // entregaria `undefined` ao controlador, que responderia 500 a uma requisicao
  // correta.
  it.each(casos)('DELETE %s lê a lista do campo declarado no schema', async (_rota, caso) => {
    const r = await apagar(caso, [11, 12])

    expect(r.status).toBe(200)
    expect(das(banco, 'DELETE').map(c => c.sql)).toEqual([
      `DELETE FROM ${caso.tabela} WHERE id = 11`,
      `DELETE FROM ${caso.tabela} WHERE id = 12`
    ])
  })
})

// =============================================================================
// 3. A TRANSACAO E A AUDITORIA
// =============================================================================

describe('A exclusão vive em uma transação, com a auditoria dentro dela', () => {
  it.each(casos)('DELETE %s lê, apaga e audita na mesma transação', async (_rota, caso) => {
    await apagar(caso)

    expect(banco.estado.transacoes).toBe(1)
    expect(banco.estado.commit).toBe(true)
    // TODAS as consultas saem do `t` da transacao. O `db.conn` de nivel de cima
    // do duble lanca, entao uma escrita solta nem chegaria aqui.
    expect(banco.chamadas.every(c => c.naTx)).toBe(true)

    // A ORDEM IMPORTA: ler depois de apagar guardaria o rastro de uma linha que
    // ja nao existe, e auditar antes de apagar registraria o que talvez nao
    // aconteca.
    const semAgregado = marcas(banco).filter(m => m !== 'AGREGADO')
    expect(semAgregado).toEqual(['SELECT', 'DELETE', 'EVENTO'])
  })

  it.each(casos)('DELETE %s grava o evento que o mapa declara', async (_rota, caso) => {
    await apagar(caso)

    const [evento] = das(banco, 'EVENTO')
    expect(evento).toBeDefined()

    const p = evento.params
    expect(p.operacao).toBe('D')
    expect(p.tabela).toBe(caso.tabela)
    expect(p.registroId).toBe(String(ID))
    expect(p.modulo).toBe('producao')
    // A ENTIDADE E O AGREGADO SAO OS DE `auditoria/mapa/metadado.js`: e a ficha
    // em que a exclusao vai aparecer.
    expect(p.entidade).toBe(caso.entidade)
    expect(p.entidadeId).toBe(caso.agregado)
    expect(p.usuarioUuid).toBe(login.__usuario.uuid)
    expect(p.rota).toBe(`DELETE /api/metadados${caso.rota}`)
    // Na exclusao nao ha "depois", e por isso o `antes` e obrigatorio: sem ele o
    // evento diria que algo sumiu sem dizer o que era.
    expect(p.dadosAntes).not.toBeNull()
    expect(p.dadosDepois).toBeNull()
  })

  // AS SEIS TABELAS COM XOR MUDAM DE FICHA conforme o nivel da declaracao. A do
  // lote nao tem versao para saltar, e o agregado e o proprio lote.
  it.each(
    ROTAS.filter(c => c.entidade === 'produto' && c.rota !== '/palavra_chave_produto')
      .map(c => [c.rota, c])
  )('DELETE %s de nível LOTE cai na ficha do lote', async (_rota, caso) => {
    banco = criarBanco({
      antes: params => ({ id: params.id, nome: 'do lote', versao_id: null, lote_id: LOTE })
    })

    await apagar(caso)

    const [evento] = das(banco, 'EVENTO')
    expect(evento.params.entidade).toBe('lote')
    expect(evento.params.entidadeId).toBe(String(LOTE))
  })

  // FALHAR AO AUDITAR DERRUBA A EXCLUSAO, e e deliberado: uma trilha que se
  // perde em silencio e pior que trilha nenhuma, porque quem a le acredita nela.
  it('a auditoria que falha derruba a exclusão', async () => {
    banco = criarBanco({
      falha: {
        casa: /INSERT INTO auditoria\.evento/,
        erro: new Error('auditoria indisponível')
      }
    })

    const r = await apagar(ROTAS[4])

    expect(r.status).toBe(500)
    expect(banco.estado.rollback).toBe(true)
    expect(banco.estado.commit).toBe(false)
    // O DELETE chegou a ser emitido, e voltou com a transacao.
    expect(das(banco, 'DELETE')).toHaveLength(1)
  })
})

// =============================================================================
// 4. O CAMINHO DE ERRO
// =============================================================================

describe('O caminho de erro', () => {
  it.each(casos)('DELETE %s responde 404 com o nome do registro', async (_rota, caso) => {
    banco = criarBanco({ antes: () => null })

    const r = await apagar(caso)

    expect(r.status).toBe(404)
    expect(r.body.message).toBe(`${caso.nome} não encontrado(a)`)
    // NADA FOI APAGADO: o 404 sai do `lerAntes`, antes do DELETE.
    expect(das(banco, 'DELETE')).toHaveLength(0)
    expect(banco.estado.rollback).toBe(true)
  })

  // A LISTA E UM ATO SO. Um id inexistente no meio nao deixa metade apagada.
  it('um id inexistente no meio da lista volta a transação inteira', async () => {
    banco = criarBanco({ antes: params => (params.id === 6 ? null : linhaAntes(params)) })

    const r = await apagar(ROTAS[4], [5, 6, 7])

    expect(r.status).toBe(404)
    expect(das(banco, 'DELETE').map(c => c.params.id)).toEqual([5])
    expect(banco.estado.rollback).toBe(true)
    expect(banco.estado.commit).toBe(false)
  })

  // A CHAVE ESTRANGEIRA NA EXCLUSAO: alguem ainda aponta a linha. ESTE MODULO
  // RESPONDE 400 (`metadado_ctrl.js:87`), enquanto `microcontrole_ctrl.js:250`
  // traduz o MESMO codigo para 409. A divergencia esta medida aqui; o que este
  // caso prende e o comportamento real do metadado.
  it('violação de chave estrangeira vira 400, com frase de gente', async () => {
    const erro = new Error('update or delete on table violates foreign key constraint')
    erro.code = '23503'
    banco = criarBanco({ falha: { casa: /DELETE FROM/, erro } })

    const r = await apagar(ROTAS[4])

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('Referência inexistente')
    expect(r.body.message).toContain('ainda aponta para esta linha')
    // A MENSAGEM QUE A TELA MOSTRA e a frase escrita aqui, e nao a do driver.
    expect(r.body.message).not.toContain('foreign key constraint')
    // O TEXTO CRU DO POSTGRES CONTINUA VIAJANDO no campo `error` do envelope, que
    // e o caminho que `AppError(frase, status, err)` mais `sendJsonAndLog` abrem
    // para todo erro que nao e 500. Nao e defeito deste modulo -- e a forma da
    // casa --, mas esta escrito aqui para a mudanca aparecer se um dia ela vier.
    expect(r.body.error).toContain('foreign key constraint')
    expect(banco.estado.rollback).toBe(true)
  })

  it('violação de unicidade também vira 400', async () => {
    const erro = new Error('duplicate key value violates unique constraint')
    erro.code = '23505'
    banco = criarBanco({ falha: { casa: /DELETE FROM/, erro } })

    const r = await apagar(ROTAS[4])

    expect(r.status).toBe(400)
    expect(r.body.message).toBe('Já existe um registro com esta chave')
  })

  // O QUE NAO ESTA NA LISTA DE TRADUCAO CONTINUA SENDO 500, e a causa nao vaza
  // para o cliente: o envelope do 500 troca a mensagem por "Erro no servidor".
  it('erro de banco não traduzido continua 500, e não vaza a causa', async () => {
    const erro = new Error('relation "metadado.creditos_qpt" does not exist')
    erro.code = '42P01'
    banco = criarBanco({ falha: { casa: /DELETE FROM/, erro } })

    const r = await apagar(ROTAS[4])

    expect(r.status).toBe(500)
    expect(r.body.message).toBe('Erro no servidor')
    expect(JSON.stringify(r.body)).not.toContain('does not exist')
  })
})

// =============================================================================
// 5. O CONTRATO DE ENTRADA
// =============================================================================

describe('O corpo do DELETE, na porta', () => {
  it.each(casos)('DELETE %s recusa corpo vazio antes de tocar o banco', async (_rota, caso) => {
    const r = await request(app).delete(`/api/metadados${caso.rota}`).send({})

    expect(r.status).toBe(400)
    expect(r.body.message).toContain(caso.campo)
    expect(banco.chamadas).toHaveLength(0)
  })

  it.each(casos)('DELETE %s recusa lista vazia', async (_rota, caso) => {
    const r = await apagar(caso, [])

    expect(r.status).toBe(400)
    expect(banco.chamadas).toHaveLength(0)
  })

  it.each(casos)('DELETE %s recusa id que não é inteiro', async (_rota, caso) => {
    const r = await apagar(caso, ['5'])

    expect(r.status).toBe(400)
    expect(banco.chamadas).toHaveLength(0)
  })

  // O VALIDADOR ESTRITO: a chave desconhecida vira 400 com a sugestao, em vez de
  // ser descartada em silencio -- e o descarte calado aqui apagaria NADA
  // respondendo 200.
  it.each(casos)('DELETE %s recusa o campo com nome parecido', async (_rota, caso) => {
    const errado = caso.campo.replace(/_ids$/, '_id')

    const r = await request(app)
      .delete(`/api/metadados${caso.rota}`)
      .send({ [errado]: [ID] })

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('campo desconhecido')
    expect(r.body.message).toContain(caso.campo)
    expect(banco.chamadas).toHaveLength(0)
  })

  // O MOTIVO DA RECUSA, e nao so que houve recusa: um schema que passasse a
  // reprovar por outra regra continuaria "vermelho onde deve", e o caso acima
  // sozinho nao veria a troca.
  describe('o motivo de cada recusa', () => {
    it.each(casos)('%s', (_rota, caso) => {
      const schema = metadadoSchema[caso.schema]
      const campo = caso.campo

      recusaPor(schema.validate({}), campo, 'any.required')
      // A LISTA VAZIA CAI PELO `.items(...required())`, e nao pelo `.min(1)`: os
      // dois estao no schema, e quem responde primeiro e o item obrigatorio que
      // faltou. O motivo real e este, e prende-lo pelo nome errado deixaria o
      // caso verde por acidente no dia em que o `.min(1)` saisse.
      recusaPor(schema.validate({ [campo]: [] }), campo, 'array.includesRequiredUnknowns')
      recusaPor(schema.validate({ [campo]: ['5'] }), [campo, 0], 'number.base')
      recusaPor(schema.validate({ [campo]: [1.5] }), [campo, 0], 'number.integer')
      recusaPor(schema.validate({ [campo]: [ID, ID] }), [campo, 1], 'array.unique')
    })
  })
})

// =============================================================================
// 6. O QUE A EXCLUSAO REMEDIA: a segunda linha do mesmo lote
// =============================================================================
//
// `metadado.informacoes_edicao` e `metadado.informacoes_produto` so tem
// `CREATE INDEX` por `lote_id` (`er/metadado.sql`), sem UNIQUE, e o POST aceita
// a segunda linha sem reclamar. A partir dali `buscaUmComQueda`
// (`metadado_ctrl.js:853`, e as duas leituras de `:1144` e `:1160`) le por
// `oneOrNone` e derruba a geracao do XML de TODA versao daquele lote com
// "Multiple rows were not expected" -- um 500 sem explicacao, numa rota que nao
// escreve nada.
//
// O DELETE DESTE ESCOPO E O UNICO CONSERTO QUE EXISTE HOJE, e este bloco mostra
// os tres tempos: quebrado, a exclusao, e de pe outra vez.

describe('a segunda linha de informacoes_edicao no mesmo lote', () => {
  const UUID_VERSAO = 'b1eebc99-9c0b-4ef8-bb6d-6bb9bd380a22'

  const VERSAO = {
    id: 77,
    uuid_versao: UUID_VERSAO,
    edicao: '1ª Edição',
    lote_id: LOTE,
    subtipo_produto_id: SUBTIPO_PRODUTO.CARTA_TOPOGRAFICA_ET_RDG,
    nome: 'Porto Alegre',
    mi: null,
    inom: 'SH-22-V-D-IV-1',
    denominador_escala: 25000,
    bbox_w: -51.5,
    bbox_e: -51.25,
    bbox_s: -30.125,
    bbox_n: -30
  }

  const INFO_PRODUTO = {
    projeto_bdgex: 'Mapeamento Sistemático',
    datum_vertical: 'Datum de Imbituba - SC',
    especificacao: 'ET-RDG',
    responsavel: 'Fulano de Tal',
    classificacao: 'ostensivo',
    org_nome: 'Diretoria de Serviço Geográfico',
    org_site: 'https://exemplo.invalido',
    org_endereco: 'Quartel-General',
    org_telefone: '0000-0000'
  }

  // A TABELA EM MEMORIA, com as duas linhas do MESMO lote que o POST aceitou.
  let tabela

  // O erro que o pg-promise lanca quando `oneOrNone` acha mais de uma linha.
  const multiplas = () => {
    const err = new Error('Multiple rows were not expected.')
    err.name = 'QueryResultError'
    return err
  }

  const responder = async (sql, params) => {
    const texto = String(sql)

    // A QUEDA DE NIVEL se reconhece pelo parametro `$<alvo>`, e nao pelo nome da
    // tabela: o `lerAntes` da exclusao le a MESMA tabela, e distinguir os dois
    // pelo nome faria a exclusao procurar a linha pelo id errado.
    if (texto.includes('$<alvo>')) {
      if (texto.includes('informacoes_produto')) return INFO_PRODUTO
      const porVersao = texto.includes('WHERE versao_id')
      const linhas = tabela.filter(l =>
        porVersao ? l.versao_id === params.alvo : l.lote_id === params.alvo
      )
      // E AQUI QUE O `oneOrNone` DERRUBA: duas linhas para o mesmo lote.
      if (linhas.length > 1) throw multiplas()
      return linhas[0] || null
    }

    if (texto.includes('uuid_versao')) return VERSAO
    if (texto.includes('SELECT produto_id FROM acervo.versao')) {
      return { produto_id: PRODUTO_DA_VERSAO }
    }

    // `lerAntes` da exclusao.
    return tabela.find(l => l.id === params.id) || null
  }

  const t = {
    oneOrNone: responder,
    any: async () => [],
    none: async (sql, params) => {
      if (String(sql).includes('DELETE FROM metadado.informacoes_edicao')) {
        // A exclusao aplicada mesmo, e pelo id que chegou ao driver.
        tabela = tabela.filter(l => l.id !== params.id)
      }
      return null
    },
    one: async () => ({}),
    batch: async p => Promise.all(p)
  }

  beforeEach(() => {
    tabela = [
      { id: 41, versao_id: null, lote_id: LOTE, data_criacao: '2024', nome: 'primeira' },
      { id: 42, versao_id: null, lote_id: LOTE, data_criacao: '2025', nome: 'a duplicada' }
    ]
    db.conn = { task: async cb => cb(t), tx: async cb => cb(t) }
  })

  it('derruba o XML de toda versão do lote enquanto as duas existirem', async () => {
    const r = await request(app).get(`/api/metadados/xml/produto/${UUID_VERSAO}`)

    expect(r.status).toBe(500)
    // A causa nao chega ao cliente, e por isso a tela mostra um 500 sem pista.
    expect(r.body.message).toBe('Erro no servidor')
  })

  it('a exclusão da linha sobrando devolve o XML, e a outra fica', async () => {
    const excluiu = await request(app)
      .delete('/api/metadados/informacoes_edicao')
      .send({ informacoes_edicao_ids: [42] })

    expect(excluiu.status).toBe(200)
    // SO A LINHA PEDIDA SAIU. Perdido o `WHERE`, as duas sairiam e a rota abaixo
    // passaria a responder 400 por falta de `informacoes_edicao`.
    expect(tabela.map(l => l.id)).toEqual([41])

    const r = await request(app).get(`/api/metadados/xml/produto/${UUID_VERSAO}`)

    expect(r.status).toBe(200)
    // O XML SAI INTEIRO, com a folha que ele descreve: e a mesma rota que, um
    // caso acima, respondia 500 so porque havia uma linha a mais no lote.
    expect(r.body.dados.xml).toContain('MD_Metadata')
    expect(r.body.dados.xml).toContain(UUID_VERSAO)
    expect(r.body.dados.uuid_versao).toBe(UUID_VERSAO)
  })

  // E O OUTRO LADO: apagadas as duas, a geracao volta a falhar -- por falta, e
  // com a frase que diz o que fazer.
  it('apagadas as duas, a saída acusa a falta em vez de calar', async () => {
    await request(app)
      .delete('/api/metadados/informacoes_edicao')
      .send({ informacoes_edicao_ids: [41, 42] })

    expect(tabela).toHaveLength(0)

    const r = await request(app).get(`/api/metadados/json_edicao/produto/${UUID_VERSAO}`)

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('sem metadado.informacoes_edicao')
  })
})
