'use strict'

// OS CINCO `DELETE` DA ZONA DE PERIGO, EXERCITADOS POR HTTP.
//
// POR QUE ESTE ARQUIVO EXISTE, ao lado de `rotas.test.js`. Aquele le o fonte
// como TEXTO, e a conferencia da rota com alvo era `toContain('req.params.uuid')`:
// uma comparacao INVERTIDA (`===` no lugar de `!==`) continua contendo aquela
// string e passa verde, enquanto o servidor recusa a confirmacao certa e aceita
// a errada. Prova de presenca de caractere nao e prova de comportamento.
//
// O QUE SE PROVA AQUI, rota a rota:
//
//   1. A GUARDA, lida do MIDDLEWARE REGISTRADO e nao de uma expressao regular. O
//      `verifyPerfil` e dublado por uma funcao que carimba o par (minimo, modulo)
//      na propria middleware, INCLUSIVE o default 'acervo': uma rota que
//      esquecesse o segundo argumento apareceria aqui como `producao` trocado por
//      `acervo`, que e exatamente a armadilha do `CLAUDE.md`.
//   2. O ALVO, pelo SQL FORMATADO que chegaria ao PostgreSQL. A assercao e de
//      IGUALDADE com a lista inteira de `DELETE`/`UPDATE` emitidos, entao um
//      `WHERE` perdido, uma coluna trocada ou uma tabela a mais deixam o caso
//      vermelho.
//   3. A CONFIRMACAO das tres que varrem: sem ela, nenhuma escrita sai.
//   4. A TRANSACAO e a AUDITORIA, na mesma: cada consulta registrada guarda se
//      havia transacao aberta no momento em que foi emitida.
//   5. O CAMINHO DE ERRO, com o codigo HTTP e o motivo.
//
// ELE NAO ABRE CONEXAO: o banco e um duble que FORMATA cada consulta pelo caminho
// do driver de verdade (`pgp.as.format`, que lanca em parametro que falta), e o
// `/log` tem o sistema de arquivos dublado. Por isso cai no pacote `test:rapido`.

const express = require('express')
const fs = require('fs')
const request = require('supertest')

// A GUARDA DUBLADA REPETE O DEFAULT DA DE VERDADE ('acervo'). Sem repeti-lo, a
// rota que esquecesse o modulo apareceria com `modulo: undefined`, e o caso
// falharia dizendo a coisa errada -- em producao ela cobraria perfil no ACERVO.
jest.mock('../../../login', () => ({
  verifyPerfil: (minimo, modulo = 'acervo') => {
    const guarda = (req, res, next) => next()
    guarda.exigencia = { minimo, modulo }
    return guarda
  }
}))

const { db } = require('../../../database')

const { errorHandler } = require('../../../utils')

const rota = require('../../../perigo/perigo_route')
const perigoSchema = require('../../../perigo/perigo_schema')

const { recusaPor } = require('../../helpers/joi')

// O GERENTE QUE CLICOU e o OPERADOR cujo trabalho vai ser solto sao pessoas
// DIFERENTES, e a distincao e o que faz o caso do alvo significar alguma coisa.
const ATOR = '3b241101-e2bb-4255-8caf-4136c566a962'
const ALVO = '16fd2706-8baf-433b-82eb-8c7fada847da'
const OUTRO = 'c7b1a0de-1111-4222-8333-444455556666'

const CONTEXTO = { origem: 'web', rota: 'DELETE /api/perigo', loteId: null }

// --- O duble do banco ---------------------------------------------------------

let consultas
let profundidade

const registrar = (query, values) => {
  // `as.format` E O MESMO CAMINHO DO DRIVER: ele lanca em parametro que falta,
  // e e o que prende um `$<x>` esquecido na consulta.
  const texto = db.pgp.as.format(query, values)
  consultas.push({ texto, emTransacao: profundidade > 0 })
  return texto
}

// O duble responde por TEXTO da consulta, e nunca por ordem de chamada: ordem
// quebra a cada linha nova no controlador.
let respostas

const responder = (query, values, padrao) => {
  const texto = registrar(query, values)
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
  jest.restoreAllMocks()
})

const dublar = mapa => {
  respostas = mapa
}

const textos = () => consultas.map(c => c.texto)

const escritas = () =>
  textos().filter(t => /^\s*(DELETE|UPDATE|INSERT)/i.test(t.trim()))

const apagou = () => textos().filter(t => /^\s*DELETE/i.test(t.trim()))

const eventos = () => consultas.filter(c => c.texto.includes('INSERT INTO auditoria.evento'))

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
app.use('/api/perigo', rota)
// O MESMO tratador de `server/app.js`: e ele que traduz `AppError` em codigo.
app.use((err, req, res, next) => errorHandler.log(err, res))

// --- A guarda -----------------------------------------------------------------

const camadaDe = (metodo, caminho) =>
  rota.stack.find(
    c => c.route && c.route.path === caminho && c.route.methods[metodo]
  )

const guardaDe = (metodo, caminho) => {
  const camada = camadaDe(metodo, caminho)
  if (!camada) return null
  const guarda = camada.route.stack
    .map(s => s.handle)
    .find(h => h && h.exigencia)
  return guarda ? guarda.exigencia : null
}

const AS_ONZE = [
  ['get', '/propriedades_camada'],
  ['post', '/propriedades_camada'],
  ['put', '/propriedades_camada'],
  ['delete', '/propriedades_camada'],
  ['get', '/insumo'],
  ['post', '/insumo'],
  ['put', '/insumo'],
  ['delete', '/insumo'],
  ['delete', '/log'],
  ['delete', '/ut_sem_atividade'],
  ['delete', '/atividades/usuario/:uuid']
]

describe('a guarda das onze rotas, lida do middleware registrado', () => {
  it.each(AS_ONZE)('%s %s cobra gerente no módulo producao', (metodo, caminho) => {
    expect(`${metodo} ${caminho}: ${JSON.stringify(guardaDe(metodo, caminho))}`)
      .toBe(`${metodo} ${caminho}: {"minimo":"gerente","modulo":"producao"}`)
  })

  it('não há rota deste arquivo sem guarda nenhuma', () => {
    const semGuarda = rota.stack
      .filter(c => c.route)
      .filter(c => !c.route.stack.some(s => s.handle && s.handle.exigencia))
      .map(c => c.route.path)

    expect(semGuarda).toEqual([])
  })
})

// --- DELETE /propriedades_camada ----------------------------------------------

describe('DELETE /propriedades_camada', () => {
  const LINHA = { id: 4, camada_id: 55, subfase_id: 3, camada_incomum: false }

  it('apaga UMA linha por id, e nada além delas', async () => {
    dublar({ 'FROM producao.propriedades_camada AS t': LINHA })

    const r = await request(app)
      .delete('/api/perigo/propriedades_camada')
      .send({ propriedades_camada_ids: [4, 9] })

    expect(r.status).toBe(200)
    // IGUALDADE COM A LISTA INTEIRA: um `WHERE` perdido, uma tabela a mais ou a
    // coluna trocada por `camada_id` deixam este caso vermelho.
    expect(apagou()).toEqual([
      'DELETE FROM producao.propriedades_camada WHERE id = 4',
      'DELETE FROM producao.propriedades_camada WHERE id = 9'
    ])
  })

  it('grava um evento por linha, dentro da transação', async () => {
    dublar({ 'FROM producao.propriedades_camada AS t': LINHA })

    await request(app)
      .delete('/api/perigo/propriedades_camada')
      .send({ propriedades_camada_ids: [4, 9] })

    expect(eventos()).toHaveLength(2)
    expect(eventos().every(e => e.emTransacao)).toBe(true)
    expect(consultas.filter(c => /^\s*DELETE/i.test(c.texto)).every(c => c.emTransacao))
      .toBe(true)
    expect(eventos()[0].texto).toContain("'producao.propriedades_camada'")
    expect(eventos()[0].texto).toContain("'D'")
  })

  it('id inexistente vira 404 e NADA é apagado', async () => {
    // O primeiro id da lista e o que falta: `lerAntes` lanca antes de qualquer
    // `DELETE`, e por isso a lista de exclusoes fica vazia de verdade.
    dublar({ 'FROM producao.propriedades_camada AS t': null })

    const r = await request(app)
      .delete('/api/perigo/propriedades_camada')
      .send({ propriedades_camada_ids: [4, 9] })

    expect(r.status).toBe(404)
    expect(r.body.message).toContain('Propriedade de camada')
    expect(apagou()).toEqual([])
  })

  it('lista vazia é recusada com 400, e nada é apagado', async () => {
    dublar({ 'FROM producao.propriedades_camada AS t': LINHA })

    const r = await request(app)
      .delete('/api/perigo/propriedades_camada')
      .send({ propriedades_camada_ids: [] })

    expect(r.status).toBe(400)
    expect(escritas()).toEqual([])
  })
})

// --- DELETE /insumo -----------------------------------------------------------

describe('DELETE /insumo', () => {
  const LINHA = {
    id: 7,
    nome: 'Ortoimagem de teste',
    caminho: 'pasta_de_teste',
    epsg: '4674',
    tipo_insumo_id: 1,
    grupo_insumo_id: 2,
    geom: null
  }

  it('desliga as unidades de trabalho pelo insumo_id, e só então apaga o insumo', async () => {
    dublar({
      'FROM producao.insumo AS t': LINHA,
      'DELETE FROM producao.insumo_unidade_trabalho': { rowCount: 3 }
    })

    const r = await request(app).delete('/api/perigo/insumo').send({ insumo_ids: [7] })

    expect(r.status).toBe(200)
    // A ORDEM IMPORTA e a COLUNA TAMBEM: a ligacao sai por `insumo_id`, e nao
    // por `id`. Trocar a coluna apagaria a ligacao de OUTRO insumo e deixaria a
    // deste em pe, e o `DELETE` seguinte morreria com 23503.
    expect(apagou()).toEqual([
      'DELETE FROM producao.insumo_unidade_trabalho WHERE insumo_id = 7',
      'DELETE FROM producao.insumo WHERE id = 7'
    ])
  })

  it('o rastro conta quantas ligações caíram junto', async () => {
    dublar({
      'FROM producao.insumo AS t': LINHA,
      'DELETE FROM producao.insumo_unidade_trabalho': { rowCount: 3 }
    })

    await request(app).delete('/api/perigo/insumo').send({ insumo_ids: [7] })

    expect(eventos()).toHaveLength(1)
    expect(eventos()[0].emTransacao).toBe(true)
    expect(eventos()[0].texto).toContain('"unidades_trabalho_desligadas":3')
  })

  it('insumo inexistente vira 404 e nem a ligação é tocada', async () => {
    dublar({ 'FROM producao.insumo AS t': null })

    const r = await request(app).delete('/api/perigo/insumo').send({ insumo_ids: [7] })

    expect(r.status).toBe(404)
    expect(r.body.message).toContain('Insumo')
    expect(apagou()).toEqual([])
  })

  it('id repetido é recusado com 400, e nada é apagado', async () => {
    dublar({ 'FROM producao.insumo AS t': LINHA })

    const r = await request(app)
      .delete('/api/perigo/insumo')
      .send({ insumo_ids: [7, 7] })

    expect(r.status).toBe(400)
    expect(escritas()).toEqual([])
  })
})

// --- DELETE /log --------------------------------------------------------------

describe('DELETE /log', () => {
  const agora = Date.now()
  const antiga = new Date(agora - 10 * 24 * 60 * 60 * 1000).toISOString()
  const recente = new Date(agora - 60 * 1000).toISOString()

  // ENTRADA MULTILINHA: a linha sem data e a continuacao do stack trace da
  // anterior, e a decisao de manter e da ENTRADA INTEIRA.
  const CONTEUDO = [
    `${antiga}|entrada velha|{}`,
    '    at Object.velho (arquivo.js:1:1)',
    `${recente}|entrada nova|{}`,
    '    at Object.novo (arquivo.js:2:2)'
  ].join('\n')

  const dublarArquivo = ({ existe = true, conteudo = CONTEUDO } = {}) => {
    jest.spyOn(fs, 'existsSync').mockReturnValue(existe)
    jest.spyOn(fs.promises, 'readFile').mockResolvedValue(conteudo)
    return jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)
  }

  it('sem confirmação nada é escrito, e a recusa ensina o corpo certo', async () => {
    const escrever = dublarArquivo()

    const r = await request(app).delete('/api/perigo/log').send({ motivo: 'faxina' })

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('confirmar')
    expect(escrever).not.toHaveBeenCalled()
    expect(escritas()).toEqual([])
  })

  it('o token de OUTRA rota é recusado', async () => {
    const escrever = dublarArquivo()

    const r = await request(app)
      .delete('/api/perigo/log')
      .send({ confirmar: perigoSchema.TOKEN.UT_SEM_ATIVIDADE })

    expect(r.status).toBe(400)
    expect(escrever).not.toHaveBeenCalled()
  })

  it('guarda a entrada nova com a continuação dela, e apaga a velha com a sua', async () => {
    const escrever = dublarArquivo()

    const r = await request(app)
      .delete('/api/perigo/log')
      .send({ confirmar: perigoSchema.TOKEN.LOG, motivo: 'faxina de agosto' })

    expect(r.status).toBe(200)
    // CONTA ENTRADA, E NAO LINHA: sao DUAS entradas de duas linhas cada, uma
    // antiga e uma nova. O `alvo` diz "entradas", e a trilha e append-only --
    // registrar 2 removidas para 1 entrada removida deixaria o numero errado
    // para sempre. As linhas continuam contadas ao lado, com o nome delas.
    // CONTRATO MUDADO EM 2026-09-05 (S6-03): `removidos`/`preservados` contavam
    // LINHAS (2 e 2).
    expect(r.body.dados).toEqual({
      operacao: 'log_combinado',
      alvo: 'entradas anteriores a 3 dias',
      removidos: 1,
      preservados: 1,
      linhas_removidas: 2,
      linhas_preservadas: 2
    })
    expect(escrever).toHaveBeenCalledTimes(1)
    // A QUEBRA DE LINHA FINAL VOLTA. Sem ela a proxima linha do winston gruda
    // na ultima que sobrou.
    expect(escrever.mock.calls[0][1]).toBe(
      `${recente}|entrada nova|{}\n    at Object.novo (arquivo.js:2:2)\n`
    )
  })

  // O ARQUIVO DE VERDADE TERMINA EM QUEBRA DE LINHA, e o `split` produz um ''
  // no fim. Ele sai antes do laco: sem isso, ou a quebra final some (quando a
  // ultima entrada e antiga) ou ela dobra.
  it('o log que já termina em quebra de linha não ganha uma segunda', async () => {
    const escrever = dublarArquivo({ conteudo: `${CONTEUDO}\n` })

    await request(app)
      .delete('/api/perigo/log')
      .send({ confirmar: perigoSchema.TOKEN.LOG })

    expect(escrever.mock.calls[0][1]).toBe(
      `${recente}|entrada nova|{}\n    at Object.novo (arquivo.js:2:2)\n`
    )
  })

  it('o log em que tudo é antigo vira arquivo vazio, e não uma quebra solta', async () => {
    const escrever = dublarArquivo({
      conteudo: [`${antiga}|entrada velha|{}`, '    at Object.velho (a.js:1:1)'].join('\n')
    })

    const r = await request(app)
      .delete('/api/perigo/log')
      .send({ confirmar: perigoSchema.TOKEN.LOG })

    expect(r.body.dados.removidos).toBe(1)
    expect(r.body.dados.linhas_removidas).toBe(2)
    expect(escrever.mock.calls[0][1]).toBe('')
  })

  it('a trilha vem ANTES do disco, e as duas dentro da transação', async () => {
    const ordem = []
    jest.spyOn(fs, 'existsSync').mockReturnValue(true)
    // A LEITURA TAMBEM E DENTRO DA TRANSACAO (2026-09-05, S6-03): tudo o que o
    // winston escrever entre o `readFile` e o `writeFile` e truncado junto,
    // porque a escrita substitui o arquivo pelo conteudo lido antes. Ler fora da
    // transacao punha a espera pela conexao do pool dentro dessa janela.
    jest.spyOn(fs.promises, 'readFile').mockImplementation(async () => {
      ordem.push(`leitura(transacao=${profundidade > 0})`)
      return CONTEUDO
    })
    jest.spyOn(fs.promises, 'writeFile').mockImplementation(async () => {
      ordem.push(`disco(transacao=${profundidade > 0})`)
    })

    const original = conn.none
    conn.none = async (q, v) => {
      const texto = db.pgp.as.format(q, v)
      if (texto.includes('INSERT INTO auditoria.evento')) {
        ordem.push(`trilha(transacao=${profundidade > 0})`)
      }
      return original(q, v)
    }

    try {
      await request(app)
        .delete('/api/perigo/log')
        .send({ confirmar: perigoSchema.TOKEN.LOG, motivo: 'faxina' })
    } finally {
      conn.none = original
    }

    // Gravar o evento e falhar na escrita derruba a transacao e a trilha nao
    // afirma o que nao houve. A ordem inversa deixaria o log truncado sem rastro.
    expect(ordem).toEqual([
      'leitura(transacao=true)',
      'trilha(transacao=true)',
      'disco(transacao=true)'
    ])
  })

  it('o motivo do corpo vai para a coluna motivo do evento', async () => {
    dublarArquivo()

    await request(app)
      .delete('/api/perigo/log')
      .send({ confirmar: perigoSchema.TOKEN.LOG, motivo: 'faxina de agosto' })

    expect(eventos()).toHaveLength(1)
    expect(eventos()[0].texto).toContain("'faxina de agosto'")
  })

  it('arquivo inexistente vira 404, e nada é escrito', async () => {
    const escrever = dublarArquivo({ existe: false })

    const r = await request(app)
      .delete('/api/perigo/log')
      .send({ confirmar: perigoSchema.TOKEN.LOG })

    expect(r.status).toBe(404)
    expect(r.body.message).toContain('log combinado')
    expect(escrever).not.toHaveBeenCalled()
    expect(escritas()).toEqual([])
  })
})

// --- DELETE /ut_sem_atividade -------------------------------------------------

describe('DELETE /ut_sem_atividade', () => {
  const ALVOS = [
    { id: 7, nome: 'Folha A', lote_id: 2 },
    { id: 9, nome: null, lote_id: 2 }
  ]

  const dublarAlvos = alvos =>
    dublar({
      'FROM producao.unidade_trabalho AS ut': alvos,
      'DELETE FROM producao.unidade_trabalho': alvos.map(a => ({ id: a.id }))
    })

  it('sem confirmação nada é apagado', async () => {
    dublarAlvos(ALVOS)

    const r = await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({ motivo: 'faxina' })

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('confirmar')
    expect(escritas()).toEqual([])
  })

  it('o token de OUTRA rota é recusado, e nada é apagado', async () => {
    dublarAlvos(ALVOS)

    const r = await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({ confirmar: perigoSchema.TOKEN.LOG })

    expect(r.status).toBe(400)
    expect(escritas()).toEqual([])
  })

  it('apaga SÓ os ids que a varredura encontrou, e a ligação primeiro', async () => {
    dublarAlvos(ALVOS)

    const r = await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({ confirmar: perigoSchema.TOKEN.UT_SEM_ATIVIDADE, motivo: 'órfãs' })

    expect(r.status).toBe(200)
    // OS DOIS `IN` CARREGAM A LISTA, e o segundo filtra por `id`. Perder o
    // `WHERE` aqui apagaria a producao inteira do schema.
    expect(apagou()).toEqual([
      'DELETE FROM producao.insumo_unidade_trabalho\n        WHERE unidade_trabalho_id IN (7,9)',
      'DELETE FROM producao.unidade_trabalho WHERE id IN (7,9) RETURNING id'
    ])
  })

  it('a varredura procura unidade SEM atividade, e não o contrário', async () => {
    dublarAlvos(ALVOS)

    await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({ confirmar: perigoSchema.TOKEN.UT_SEM_ATIVIDADE })

    const selecao = textos().find(t => t.includes('FROM producao.unidade_trabalho AS ut'))
    expect(selecao).toContain('WHERE NOT EXISTS')
    expect(selecao).toContain('a.unidade_trabalho_id = ut.id')
  })

  it('o resumo e o evento contam o que caiu, dentro da transação', async () => {
    dublarAlvos(ALVOS)

    const r = await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({ confirmar: perigoSchema.TOKEN.UT_SEM_ATIVIDADE, motivo: 'órfãs' })

    expect(r.body.dados.removidos).toBe(2)
    expect(r.body.dados.detalhe).toEqual([
      '7 (Folha A, lote 2)',
      '9 (sem nome, lote 2)'
    ])
    expect(eventos()).toHaveLength(1)
    expect(eventos()[0].emTransacao).toBe(true)
    expect(eventos()[0].texto).toContain("'órfãs'")
  })

  // DEFEITO RELATADO E CORRIGIDO EM 2026-08-09. A versao anterior de
  // `perigo_ctrl.js` saia por um `return` antes de `auditoriaCtrl.registrar`
  // quando a varredura nao encontrava alvo, e este caso PRENDIA a ausencia para
  // ficar vermelho no dia da correcao. Foi o que aconteceu, e agora ele afirma o
  // comportamento certo: varredura sem alvo TAMBEM deixa rastro.
  //
  // POR QUE ISSO IMPORTA NUMA ROTA DESTRUTIVA: alguem digitou a confirmacao e
  // escreveu o motivo. "Rodei e nao havia nada" e informacao, e e exatamente a
  // que responde "entao quem apagou?" depois. O irmao `producao/insumo_ctrl.js`
  // ja fazia assim, e `limpaLog` com zero removidos tambem registra.
  it('sem alvo não apaga nada, e ainda assim deixa rastro', async () => {
    dublarAlvos([])

    const r = await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({ confirmar: perigoSchema.TOKEN.UT_SEM_ATIVIDADE, motivo: 'órfãs' })

    expect(r.status).toBe(200)
    expect(r.body.dados).toEqual({
      operacao: 'unidade_trabalho_sem_atividade',
      alvo: 'unidades de trabalho sem atividade',
      removidos: 0,
      detalhe: []
    })
    expect(apagou()).toEqual([])

    expect(eventos()).toHaveLength(1)
    expect(eventos()[0].emTransacao).toBe(true)
    expect(eventos()[0].texto).toContain("'órfãs'")
  })

  // DEFEITO RELATADO E CORRIGIDO EM 2026-08-09: `detalhe` nao tinha teto, e este
  // caso prendia o crescimento sem limite para ficar vermelho na correcao. O
  // teto agora e o mesmo do irmao `producao/insumo_ctrl.js`
  // (`TETO_IDS_NO_EVENTO = 20`), e pelo mesmo motivo: a varredura alcanca a
  // instalacao inteira, e uma lista com milhares de linhas dentro de UM
  // `auditoria.evento` fica maior que a operacao que ela descreve. A trilha e
  // append-only, entao inchar o evento e decisao sem volta.
  //
  // O TETO NAO ENCOLHE O QUE SE APAGA, e o caso afirma isso: `removidos` conta as
  // 500. Cortar a lista do rastro e cortar a lista do DELETE seriam defeitos bem
  // diferentes, e trocar um pelo outro e o engano que este `expect` impede.
  it('a lista do evento tem teto, e o teto não encolhe o que se apaga', async () => {
    const muitas = Array.from({ length: 500 }, (_v, i) => ({
      id: i + 1,
      nome: `Folha ${i + 1}`,
      lote_id: 2
    }))
    dublarAlvos(muitas)

    const r = await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({ confirmar: perigoSchema.TOKEN.UT_SEM_ATIVIDADE })

    // Os 20 primeiros mais a linha de contagem, e nao as 500.
    expect(r.body.dados.detalhe).toHaveLength(21)
    expect(r.body.dados.detalhe[0]).toBe('1 (Folha 1, lote 2)')
    expect(r.body.dados.detalhe[19]).toBe('20 (Folha 20, lote 2)')
    expect(r.body.dados.detalhe[20]).toBe('e mais 480')
    expect(eventos()[0].texto).not.toContain('Folha 500')

    // O DELETE continua alcancando as 500.
    expect(r.body.dados.removidos).toBe(500)
  })

  // O ALVO, ACRESCENTADO EM 2026-09-05. O fluxo normal de carga e `POST
  // /producao/unidade_trabalho` e SO DEPOIS `POST /producao/atividades` -- duas
  // telas que podem ficar dias uma da outra. Entre elas, toda unidade
  // recem-carregada e "sem atividade": sem filtro de lote, limpar quatro sobras
  // de um lote antigo leva junto os milhares de recortes que outro gerente
  // carregou de manha, e a confirmacao por token nao ajuda, porque ela confirma
  // a ACAO e nunca o ALVO.
  it('o lote_id do corpo entra na varredura, e a resposta o nomeia', async () => {
    dublarAlvos([{ id: 7, nome: 'Folha A', lote_id: 61 }])

    const r = await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({
        confirmar: perigoSchema.TOKEN.UT_SEM_ATIVIDADE,
        lote_id: 61,
        motivo: 'sobras do 61'
      })

    expect(r.status).toBe(200)

    // O FILTRO ESTA NA CONSULTA, e nao num `filter` de JS: trazer a instalacao
    // inteira para a memoria so para descartar quase tudo tem custo real.
    const selecao = textos().find(t => t.includes('FROM producao.unidade_trabalho AS ut'))
    expect(selecao).toContain('AND ut.lote_id = 61')

    expect(r.body.dados.alvo).toBe('unidades de trabalho sem atividade do lote 61')
    expect(r.body.message).toContain('lote 61')
    // Com alvo declarado, a contagem por lote nao acrescenta nada.
    expect(r.body.dados.por_lote).toBeUndefined()
  })

  it('sem lote_id a varredura continua global, e o SQL não ganha filtro', async () => {
    dublarAlvos(ALVOS)

    await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({ confirmar: perigoSchema.TOKEN.UT_SEM_ATIVIDADE })

    const selecao = textos().find(t => t.includes('FROM producao.unidade_trabalho AS ut'))
    expect(selecao).not.toContain('ut.lote_id =')
  })

  // A CONTAGEM POR LOTE E O QUE TORNA A VARREDURA SEM ALVO AUDITAVEL: o
  // `detalhe` para nos vinte primeiros e o resto vira "e mais N", entao quem le
  // o evento depois nao consegue dizer de ONDE saiu o que sumiu.
  it('sem lote_id o resumo conta por lote, e é isso que denuncia o acidente', async () => {
    dublarAlvos([
      { id: 7, nome: 'Folha A', lote_id: 55 },
      { id: 9, nome: 'Folha B', lote_id: 61 },
      { id: 11, nome: 'Folha C', lote_id: 61 }
    ])

    const r = await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({ confirmar: perigoSchema.TOKEN.UT_SEM_ATIVIDADE, motivo: 'faxina' })

    expect(r.status).toBe(200)
    expect(r.body.dados.por_lote).toEqual({ 55: 1, 61: 2 })
    // E vai para a trilha junto, que e onde ele serve.
    expect(eventos()[0].texto).toContain('por_lote')
  })

  it('lote_id que não é inteiro positivo é recusado antes do banco', async () => {
    dublarAlvos(ALVOS)

    const r = await request(app)
      .delete('/api/perigo/ut_sem_atividade')
      .send({ confirmar: perigoSchema.TOKEN.UT_SEM_ATIVIDADE, lote_id: 0 })

    expect(r.status).toBe(400)
    expect(escritas()).toEqual([])
  })
})

// --- DELETE /atividades/usuario/:uuid -----------------------------------------

describe('DELETE /atividades/usuario/:uuid', () => {
  const PESSOA = { uuid: ALVO, ativo: false, usuario: '3º Sgt Fulano' }

  const dublarPessoa = ({
    pessoa = PESSOA,
    soltas = [{ id: 11 }, { id: 12 }],
    preservadas = 4,
    indisponiveis = 0
  } = {}) =>
    dublar({
      'FROM dgeo.usuario AS u': pessoa,
      'SELECT COUNT(DISTINCT ut.id)::int AS total': { total: indisponiveis },
      'SELECT COUNT(*)::int AS total': { total: preservadas },
      'UPDATE producao.atividade': soltas
    })

  it('a confirmação que NÃO repete o uuid é recusada, e nada é escrito', async () => {
    dublarPessoa()

    const r = await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: OUTRO })

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('repetir o uuid')
    expect(escritas()).toEqual([])
  })

  it('a confirmação que repete o uuid é aceita', async () => {
    dublarPessoa()

    const r = await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: ALVO })

    expect(r.status).toBe(200)
    expect(r.body.dados.removidos).toBe(2)
  })

  // A CAIXA NAO DESEMPATA: um uuid e o mesmo uuid em qualquer caixa.
  it('a confirmação em MAIÚSCULA continua valendo', async () => {
    dublarPessoa()

    const r = await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: ALVO.toUpperCase() })

    expect(r.status).toBe(200)
  })

  // O CASO CENTRAL. O alvo do `UPDATE` e o uuid do CAMINHO DA ROTA, e nunca o
  // do corpo nem o de quem clicou. Aqui os tres sao diferentes entre si: o
  // caminho vem minusculo, a confirmacao vem MAIUSCULA e o ator e outra pessoa.
  // Trocar `req.params.uuid` por `req.body.confirmar` ou por `req.usuarioUuid`
  // deixa este caso vermelho.
  it('solta a atividade de QUEM ESTÁ NO CAMINHO, e não de quem clicou', async () => {
    dublarPessoa()

    await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: ALVO.toUpperCase() })

    const update = textos().find(t => t.includes('UPDATE producao.atividade'))

    expect(update).toContain(`WHERE usuario_uuid = '${ALVO}'`)
    expect(update).not.toContain(ALVO.toUpperCase())
    expect(update).not.toContain(ATOR)
  })

  // AS TRES SITUACOES SOLTAVEIS, e so elas: a finalizada (4) e a nao finalizada
  // (5) ficam onde estao. O SAP 2.3.5 nao filtrava, e o efeito era apagar
  // producao entregue.
  it('só toca as situações 1, 2 e 3, e devolve todas à 1', async () => {
    dublarPessoa()

    await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: ALVO })

    const update = textos().find(t => t.includes('UPDATE producao.atividade'))

    expect(update).toContain('tipo_situacao_atividade_id IN (1,2,3)')
    expect(update).toContain('tipo_situacao_atividade_id = 1')
    expect(update).toContain('usuario_uuid = NULL')
    expect(update).toContain('data_inicio = NULL')
    expect(update).toContain('data_fim = NULL')

    // E A CONTAGEM DO QUE FICA usa o complemento exato do mesmo conjunto.
    const contagem = textos().find(t => t.includes('SELECT COUNT(*)::int AS total'))
    expect(contagem).toContain('NOT IN (1,2,3)')
    expect(contagem).toContain(`usuario_uuid = '${ALVO}'`)
  })

  it('o evento é da zona de perigo, com o alvo e o motivo, dentro da transação', async () => {
    dublarPessoa()

    const r = await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: ALVO, motivo: 'saiu da Divisão' })

    expect(r.body.dados.preservados).toBe(4)
    expect(eventos()).toHaveLength(1)
    expect(eventos()[0].emTransacao).toBe(true)
    expect(eventos()[0].texto).toContain("'producao.zona_perigo'")
    expect(eventos()[0].texto).toContain(ALVO)
    expect(eventos()[0].texto).toContain("'saiu da Divisão'")
  })

  it('pessoa inexistente vira 404, e nada é escrito', async () => {
    dublarPessoa({ pessoa: null })

    const r = await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: ALVO })

    expect(r.status).toBe(404)
    expect(r.body.message).toBe('Usuário não encontrado')
    expect(escritas()).toEqual([])
  })

  // A RECUSA CONTA O QUE NAO FOI TOCADO, e o numero existe para que a ausencia
  // das finalizadas se leia como escolha, e nao como falha.
  it('quem não segura nada produz 400 que cita as preservadas', async () => {
    dublarPessoa({ soltas: [], preservadas: 12 })

    const r = await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: ALVO })

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('3º Sgt Fulano')
    expect(r.body.message).toContain('12 atividades finalizadas ou descartadas')
    expect(eventos()).toEqual([])
  })

  it('uuid inválido no caminho é recusado com 400, antes de ir ao banco', async () => {
    dublarPessoa()

    const r = await request(app)
      .delete('/api/perigo/atividades/usuario/nao-e-uuid')
      .send({ confirmar: ALVO })

    expect(r.status).toBe(400)
    expect(r.body.message).toContain('uuid')
    expect(consultas).toEqual([])
  })

  // SOLTAR A ATIVIDADE NAO DEVOLVE A UNIDADE A FILA. `POST
  // /distribuicao/problema_atividade` poe `unidade_trabalho.disponivel = FALSE`
  // junto com a pausa, e `distribuicao/sql/calcula_fila.sql` cobra
  // `ut.disponivel IS TRUE`. Esta rota existe para "a fila voltar a andar":
  // responder so `soltas com sucesso` deixa a unidade fora da fila para sempre,
  // sem nada dizer que sobrou um passo. Religar a coluna aqui seria desfazer a
  // decisao de quem apontou o problema -- o que faltava era DIZER.
  it('conta as unidades indisponíveis e a resposta diz o passo que falta', async () => {
    dublarPessoa({ indisponiveis: 1 })

    const r = await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: ALVO })

    expect(r.status).toBe(200)
    expect(r.body.dados.unidades_indisponiveis).toBe(1)
    expect(r.body.message).toContain('indisponíveis')
    expect(r.body.message).toContain('Gerência da Produção')

    // A contagem sai da MESMA transacao, e olha as unidades das atividades soltas.
    const contagem = consultas.find(c => c.texto.includes('COUNT(DISTINCT ut.id)'))
    expect(contagem.emTransacao).toBe(true)
    expect(contagem.texto).toContain('a.id IN (11,12)')
    expect(contagem.texto).toContain('ut.disponivel IS FALSE')

    // E nada RELIGA a coluna: isso e da Gerencia da Producao.
    expect(escritas().some(t => t.includes('SET disponivel'))).toBe(false)
  })

  it('sem unidade indisponível a mensagem continua a de sempre', async () => {
    dublarPessoa()

    const r = await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: ALVO })

    expect(r.body.dados.unidades_indisponiveis).toBe(0)
    expect(r.body.message).toBe('Atividades do usuário soltas com sucesso')
  })

  it('confirmação que não é uuid é recusada pelo schema, antes do banco', async () => {
    dublarPessoa()

    const r = await request(app)
      .delete(`/api/perigo/atividades/usuario/${ALVO}`)
      .send({ confirmar: 'sim' })

    expect(r.status).toBe(400)
    expect(consultas).toEqual([])
  })
})

// --- O DELETE SEM CORPO NENHUM ------------------------------------------------

describe('o DELETE disparado sem corpo', () => {
  // DEFEITO ENCONTRADO EM 2026-08-09. Sob Express 5, requisicao sem corpo deixa
  // `req.body` UNDEFINED, e o Joi ACEITA `undefined` contra um
  // `Joi.object().keys({...required})` -- so o objeto presente e cobrado. A
  // recusa que o cabecalho de `perigo_route.js` promete ("um DELETE sem corpo,
  // disparado por uma aba aberta, e acidente esperando acontecer") nao acontece
  // no schema: quem barra e o `TypeError` de ler `.motivo` de `undefined`, que
  // chega ao cliente como 500 "Erro no servidor", sem dizer o que faltou.
  //
  // O QUE ESTE BLOCO GARANTE, e por isso ele nao prende o codigo 500: nenhuma
  // escrita sai por esse caminho. O codigo continua sendo 4xx ou 5xx, e a
  // correcao (exigir o corpo, ou `Joi.object().required()`) o deixa verde.
  const SEM_CORPO = [
    ['/api/perigo/propriedades_camada'],
    ['/api/perigo/insumo'],
    ['/api/perigo/log'],
    ['/api/perigo/ut_sem_atividade'],
    [`/api/perigo/atividades/usuario/${ALVO}`]
  ]

  it.each(SEM_CORPO)('%s não escreve nada', async caminho => {
    dublar({})
    jest.spyOn(fs, 'existsSync').mockReturnValue(true)
    jest.spyOn(fs.promises, 'readFile').mockResolvedValue('')
    const escrever = jest.spyOn(fs.promises, 'writeFile').mockResolvedValue(undefined)

    const r = await request(app).delete(caminho)

    expect(r.status).toBeGreaterThanOrEqual(400)
    expect(escritas()).toEqual([])
    expect(escrever).not.toHaveBeenCalled()
  })
})

// --- O veredito sobre a lista VAZIA e o `IN ()` -------------------------------

describe('a lista de ids vazia nunca chega ao banco', () => {
  // A REVISAO AFIRMOU: "todas as listas de ids tem `.min(1)`, e `$<ids:csv>`
  // vazio gera `IN ()`, que e erro de sintaxe e nunca `WHERE true`". Os dois
  // lados sao verificaveis, e este bloco os verifica.

  it('os dois schemas de lista deste módulo recusam a lista vazia por array.min', () => {
    recusaPor(
      perigoSchema.propriedadesCamadaIds.validate({ propriedades_camada_ids: [] }),
      'propriedades_camada_ids',
      'array.min'
    )
    recusaPor(
      perigoSchema.insumoIds.validate({ insumo_ids: [] }),
      'insumo_ids',
      'array.min'
    )
  })

  // O SEGUNDO LADO DA AFIRMACAO. `IN ()` e erro de sintaxe do PostgreSQL: uma
  // lista vazia que passasse produziria 500, e NUNCA um `WHERE` verdadeiro que
  // apagasse a tabela inteira. E a diferenca entre um susto e uma perda total.
  it('$<ids:csv> vazio produz IN (), que é erro de sintaxe e não WHERE true', () => {
    const sql = db.pgp.as.format(
      'DELETE FROM producao.unidade_trabalho WHERE id IN ($<ids:csv>)',
      { ids: [] }
    )

    expect(sql).toBe('DELETE FROM producao.unidade_trabalho WHERE id IN ()')
    expect(sql).not.toMatch(/WHERE\s+true/i)
    // E nem uma condicao que se satisfaca sozinha por outro caminho.
    expect(sql).not.toBe('DELETE FROM producao.unidade_trabalho')
  })

  // O LACO POR ID DAS DUAS ROTAS DE LISTA nao chega a montar `IN` nenhum: ele
  // simplesmente nao roda. Mesmo assim a lista vazia e recusada na porta, e as
  // duas defesas se somam.
  it('a rota recusa antes de o controlador ver a lista', async () => {
    dublar({})

    const r = await request(app).delete('/api/perigo/insumo').send({ insumo_ids: [] })

    expect(r.status).toBe(400)
    expect(consultas).toEqual([])
  })
})
