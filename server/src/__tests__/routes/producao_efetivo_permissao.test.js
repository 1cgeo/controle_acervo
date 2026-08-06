'use strict'

// OS MODULOS PRODUCAO (4) E EFETIVO (5), contra o banco real e as rotas reais.
//
// O QUE ESTE ARQUIVO PROVA, e por que ele existe. Ate a 1.32.0 nao havia nivel
// intermediario para o trabalho de producao nem para o de efetivo: a execucao do
// PIT, o Extra-PIT, a capacitacao e o aproveitamento eram TODOS `verifyAdmin`.
// Medido na producao em 2026-08-06, das 28 contas ativas 7 conseguiam fazer
// alguma coisa, e 5 dessas 7 eram administradoras globais. A causa nao era
// descuido de quem concedeu: nao havia como dar menos.
//
// A 1.33.0 criou os dois modulos e trocou a guarda daquelas rotas. Este arquivo
// e a prova de que a troca fez o que devia, E SO ISSO. Um teste que so mostrasse
// o perfil novo PASSANDO provaria apenas que a guarda afrouxou. Por isso cada
// rota tem os DOIS lados:
//
//   POSITIVO   quem tem o perfil novo entra.
//   NEGATIVO   quem NAO tem e recusado com 403, e a mensagem NOMEIA o modulo
//              que faltou. Sem checar o nome, um 403 vindo de outro middleware
//              satisfaria o caso.
//
// E os dois CONTROLES que provam que nada foi afrouxado alem do decidido:
//
//   O QUE NAO ENTROU   a META e a REVISAO do PIT, e a EDICAO do RPCMTec,
//                      continuam recusando o operador de Producao. Alterar o
//                      PIT e ato da DSG, e o relatorio e o que o chefe assina.
//   A FRONTEIRA        operador de Producao nao entra no Efetivo, e vice-versa.
//                      A capacitacao e o caso duro: as duas saem da MESMA
//                      TABELA, e so o caminho as separa.
//
// A guarda le o perfil do BANCO a cada requisicao, nao do token: por isso aqui
// se GRAVA a concessao em `dgeo.usuario_perfil` e se usa o MESMO token.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn } = require('../helpers/db')
const { generateAdminToken, generateUserToken, USER_UUID } = require('../helpers/auth')

const MODULO = { acervo: 1, mapoteca: 2, orcamento: 3, producao: 4, efetivo: 5 }
const NIVEL = { consulta: 1, operador: 2, gerente: 3 }

const TIPO = { MINISTRADA: 1, RECEBIDA: 2 }

let app

beforeAll(async () => {
  app = await getApp()
})

const definePerfil = async (moduloId, perfilId) => {
  await conn.none(
    `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
     SELECT id, $2, $3 FROM dgeo.usuario WHERE uuid = $1
     ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
    [USER_UUID, moduloId, perfilId]
  )
}

const removePerfil = async moduloId => {
  await conn.none(
    `DELETE FROM dgeo.usuario_perfil
     WHERE modulo_id = $2 AND usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
    [USER_UUID, moduloId]
  )
}

// Devolve o usuario ao perfil semeado (consulta no acervo, operador na
// mapoteca), para um caso nao herdar a concessao do anterior.
afterEach(async () => {
  await definePerfil(MODULO.acervo, NIVEL.consulta)
  await definePerfil(MODULO.mapoteca, NIVEL.operador)
  await removePerfil(MODULO.orcamento)
  await removePerfil(MODULO.producao)
  await removePerfil(MODULO.efetivo)
})

const comoUsuario = (metodo, caminho, corpo) => {
  const req = request(app)[metodo](caminho).set('Authorization', generateUserToken())
  return corpo ? req.send(corpo) : req
}

// ---------------------------------------------------------------------------
// A tabela do que MUDOU DE GUARDA.
//
// Uma linha por rota, com o modulo e o nivel que ela passou a cobrar. Os dois
// casos abaixo a percorrem inteira, nos dois sentidos: nenhuma rota entra num
// sentido so.
//
// O CORPO nao precisa ser valido: a guarda roda ANTES do `schemaValidation`,
// entao o caso NEGATIVO reprova no 403 sem chegar ao Joi. O caso POSITIVO
// cobra apenas "nao foi 403", porque o que se prova aqui e a AUTORIZACAO; que a
// escrita grava direito e assunto de `pit_extra.test.js` e irmaos, e o
// round-trip de verdade esta mais abaixo, na capacitacao.
// ---------------------------------------------------------------------------
const ROTAS = [
  // --- PRODUCAO: a execucao mensal do PIT (subsecao 2.1) ---
  ['post', '/api/metas/execucao', 'producao', 'operador', { meta_id: 1, mes: 3 }],
  ['delete', '/api/metas/execucao/1', 'producao', 'operador', null],

  // --- PRODUCAO: a demanda Extra-PIT (subsecao 3.3) ---
  ['post', '/api/metas/extra', 'producao', 'operador', {}],
  ['put', '/api/metas/extra/1', 'producao', 'operador', {}],
  ['delete', '/api/metas/extra/1', 'producao', 'operador', null],
  // O VINCULO com a folha do acervo entra AQUI desde 2026-08-06. A 1.33.0 o
  // deixou com o administrador global, e o resultado era meia tarefa: quem
  // cadastrava a demanda nao podia dizer quais folhas a cumprem, e demanda sem
  // folha ligada nao conta nada na grade do PIT.
  ['post', '/api/metas/extra/1/versoes', 'producao', 'operador', { versao_id: 1 }],
  ['delete', '/api/metas/extra/1/versoes/1', 'producao', 'operador', null],

  // --- PRODUCAO: a capacitacao MINISTRADA (subsecao 2.6) ---
  ['get', '/api/rpcmtec/capacitacao/ministrada', 'producao', 'operador', null],
  ['get', '/api/rpcmtec/capacitacao/ministrada/anos', 'producao', 'operador', null],
  ['get', '/api/rpcmtec/capacitacao/ministrada/1', 'producao', 'operador', null],
  ['post', '/api/rpcmtec/capacitacao/ministrada', 'producao', 'operador', {}],
  ['put', '/api/rpcmtec/capacitacao/ministrada/1', 'producao', 'operador', {}],
  ['delete', '/api/rpcmtec/capacitacao/ministrada/1', 'producao', 'operador', null],

  // --- EFETIVO: a capacitacao RECEBIDA (subsecao 6.2) ---
  ['get', '/api/rpcmtec/capacitacao/recebida', 'efetivo', 'operador', null],
  ['get', '/api/rpcmtec/capacitacao/recebida/anos', 'efetivo', 'operador', null],
  ['get', '/api/rpcmtec/capacitacao/recebida/1', 'efetivo', 'operador', null],
  ['post', '/api/rpcmtec/capacitacao/recebida', 'efetivo', 'operador', {}],
  ['put', '/api/rpcmtec/capacitacao/recebida/1', 'efetivo', 'operador', {}],
  ['delete', '/api/rpcmtec/capacitacao/recebida/1', 'efetivo', 'operador', null],

  // --- EFETIVO: o aproveitamento (subsecao 6.1) ---
  ['get', '/api/efetivo/periodos', 'efetivo', 'operador', null],
  ['post', '/api/efetivo/periodos', 'efetivo', 'operador', {}],
  ['put', '/api/efetivo/periodos/1', 'efetivo', 'operador', {}],
  ['delete', '/api/efetivo/periodos/1', 'efetivo', 'operador', null],
  ['get', '/api/efetivo/impedimentos', 'efetivo', 'operador', null],
  ['post', '/api/efetivo/impedimentos', 'efetivo', 'operador', {}],
  ['put', '/api/efetivo/impedimentos/1', 'efetivo', 'operador', {}],
  ['delete', '/api/efetivo/impedimentos/1', 'efetivo', 'operador', null],

  // --- EFETIVO: as duas leituras AGREGADAS, que sao do GERENTE ---
  // Elas resumem a Divisao inteira num quadro so, e responder "quem esteve
  // disponivel em cada semana do ano" e pergunta de quem responde pelo efetivo.
  ['get', '/api/efetivo/mapa?ano=2026', 'efetivo', 'gerente', null],
  ['get', '/api/efetivo/mes?ano=2026&mes=3', 'efetivo', 'gerente', null]
]

const rotulo = ([metodo, caminho, modulo, nivel]) =>
  `${metodo.toUpperCase()} ${caminho} (${nivel} em ${modulo})`

describe('As rotas que trocaram de guarda: sem o perfil novo, 403', () => {
  test.each(ROTAS.map(r => [rotulo(r), r]))('%s', async (_nome, rota) => {
    const [metodo, caminho, modulo, nivel, corpo] = rota

    // Sem NENHUMA linha nos dois modulos novos: e o estado de toda conta hoje.
    await removePerfil(MODULO.producao)
    await removePerfil(MODULO.efetivo)

    const res = await comoUsuario(metodo, caminho, corpo)

    expect(res.status).toBe(403)
    // A mensagem NOMEIA o nivel e o modulo que faltaram. Sem isto, um 403 de
    // outro middleware (ou do modulo errado, que e a armadilha do default
    // 'acervo' do verifyPerfil) passaria por aprovacao.
    expect(res.body.message).toMatch(
      new RegExp(`perfil ${nivel} no módulo ${modulo}`, 'i')
    )
  })
})

describe('As rotas que trocaram de guarda: com o perfil novo, entra', () => {
  test.each(ROTAS.map(r => [rotulo(r), r]))('%s', async (_nome, rota) => {
    const [metodo, caminho, modulo, nivel, corpo] = rota

    await definePerfil(MODULO[modulo], NIVEL[nivel])

    const res = await comoUsuario(metodo, caminho, corpo)

    expect(res.status).not.toBe(403)
  })
})

// ---------------------------------------------------------------------------
// A FRONTEIRA entre os dois modulos novos.
//
// Este e o bloco que a separacao das rotas de capacitacao existe para tornar
// possivel: ate a 1.32.0 as duas saiam do MESMO `POST /capacitacao`, com o tipo
// no corpo, e nenhuma guarda de rota conseguia distinguir uma da outra.
// ---------------------------------------------------------------------------
describe('Producao e Efetivo sao compartimentos', () => {
  it('operador de Producao NAO entra na capacitacao recebida nem no efetivo', async () => {
    await definePerfil(MODULO.producao, NIVEL.operador)

    // Controle positivo: no que e dele, ele entra. Sem esta linha, um 403 em
    // toda parte passaria por aprovacao.
    const proprio = await comoUsuario('get', '/api/rpcmtec/capacitacao/ministrada')
    expect(proprio.status).toBe(200)

    const recebida = await comoUsuario('get', '/api/rpcmtec/capacitacao/recebida')
    expect(recebida.status).toBe(403)
    expect(recebida.body.message).toMatch(/módulo efetivo/i)

    const periodos = await comoUsuario('get', '/api/efetivo/periodos')
    expect(periodos.status).toBe(403)
    expect(periodos.body.message).toMatch(/módulo efetivo/i)
  })

  it('operador de Efetivo NAO entra na capacitacao ministrada nem no PIT', async () => {
    await definePerfil(MODULO.efetivo, NIVEL.operador)

    const proprio = await comoUsuario('get', '/api/rpcmtec/capacitacao/recebida')
    expect(proprio.status).toBe(200)

    const ministrada = await comoUsuario('get', '/api/rpcmtec/capacitacao/ministrada')
    expect(ministrada.status).toBe(403)
    expect(ministrada.body.message).toMatch(/módulo producao/i)

    const execucao = await comoUsuario('post', '/api/metas/execucao', { meta_id: 1, mes: 3 })
    expect(execucao.status).toBe(403)
    expect(execucao.body.message).toMatch(/módulo producao/i)
  })

  // O GERENTE do efetivo satisfaz o OPERADOR (a hierarquia), mas o operador NAO
  // satisfaz o gerente. E o que separa o cadastro do aproveitamento da leitura
  // agregada da Divisao.
  it('operador de Efetivo cadastra, e nao le o mapa anual', async () => {
    await definePerfil(MODULO.efetivo, NIVEL.operador)

    expect((await comoUsuario('get', '/api/efetivo/periodos')).status).toBe(200)

    const mapa = await comoUsuario('get', '/api/efetivo/mapa?ano=2026')
    expect(mapa.status).toBe(403)
    expect(mapa.body.message).toMatch(/perfil gerente no módulo efetivo/i)

    await definePerfil(MODULO.efetivo, NIVEL.gerente)
    expect((await comoUsuario('get', '/api/efetivo/mapa?ano=2026')).status).toBe(200)
  })

  // Requisito de sempre, e o que o `verifyPerfil` promete: a flag global vale
  // nos CINCO modulos, sem nenhuma linha de perfil.
  it('o administrador global continua entrando nos dois modulos novos', async () => {
    const admin = (caminho) =>
      request(app).get(caminho).set('Authorization', generateAdminToken())

    expect((await admin('/api/rpcmtec/capacitacao/ministrada')).status).toBe(200)
    expect((await admin('/api/rpcmtec/capacitacao/recebida')).status).toBe(200)
    expect((await admin('/api/efetivo/periodos')).status).toBe(200)
    expect((await admin('/api/efetivo/mapa?ano=2026')).status).toBe(200)
  })
})

// ---------------------------------------------------------------------------
// O QUE NAO ENTROU NOS MODULOS NOVOS.
//
// Sem este bloco, a mudanca inteira poderia ter afrouxado tudo e os casos acima
// continuariam verdes.
// ---------------------------------------------------------------------------
describe('O operador de Producao NAO alcanca o que continua sendo do administrador', () => {
  const PROIBIDAS = [
    // A META e a REVISAO do PIT. Alterar o PIT e ato da DSG, e o que esta no
    // sistema e TRANSCRICAO do documento assinado.
    ['post', '/api/metas', {}],
    ['put', '/api/metas/1', {}],
    ['delete', '/api/metas/1', null],
    ['put', '/api/metas/1/transcricao', {}],
    ['post', '/api/metas/revisoes', {}],
    ['put', '/api/metas/revisoes/1', {}],
    ['post', '/api/metas/revisoes/1/publicar', {}],
    ['put', '/api/metas/revisoes/1/meta/1', {}],
    ['post', '/api/metas/exercicios', {}],
    // A EDICAO do RPCMTec: o relatorio que o chefe assina.
    ['post', '/api/rpcmtec', {}],
    ['put', '/api/rpcmtec/1', {}],
    ['post', '/api/rpcmtec/1/fechar', null],
    ['put', '/api/rpcmtec/1/subsecao/2.1', {}],
    // O cadastro de usuarios, que e a porta que da a flag global a alguem.
    ['put', `/api/usuarios/${USER_UUID}`, { administrador: true, ativo: true }]
  ]

  test.each(PROIBIDAS.map(p => [`${p[0].toUpperCase()} ${p[1]}`, p]))(
    '%s',
    async (_nome, [metodo, caminho, corpo]) => {
      // GERENTE em Producao, e nao operador: o nivel mais alto do modulo novo.
      // Provar com o mais baixo deixaria a pergunta em aberto.
      await definePerfil(MODULO.producao, NIVEL.gerente)

      const res = await comoUsuario(metodo, caminho, corpo)

      expect(res.status).toBe(403)
    }
  )
})

// ---------------------------------------------------------------------------
// O TIPO VEM DA ROTA, e o dado no banco tem de provar isso.
//
// Aqui a verificacao RELE O DESTINO, e nao o retorno da rota: a resposta do POST
// e eco dela mesma. O que se confere e a linha em `rpcmtec.capacitacao`.
// ---------------------------------------------------------------------------
describe('O caminho fixa o tipo da capacitacao, e o banco confirma', () => {
  const corpo = (nome) => ({
    ano: 2026,
    nome,
    situacao_id: 1,
    militares: []
  })

  const lerTipo = async id =>
    conn.oneOrNone('SELECT tipo_id FROM rpcmtec.capacitacao WHERE id = $1', [id])

  const apagar = async id =>
    conn.none('DELETE FROM rpcmtec.capacitacao WHERE id = $1', [id])

  it('POST /ministrada grava tipo 1, sem tipo_id no corpo', async () => {
    await definePerfil(MODULO.producao, NIVEL.operador)

    const res = await comoUsuario(
      'post', '/api/rpcmtec/capacitacao/ministrada', corpo('Curso da rota ministrada')
    )
    expect(res.status).toBe(201)

    const linha = await lerTipo(res.body.dados.id)
    expect(linha).not.toBeNull()
    expect(Number(linha.tipo_id)).toBe(TIPO.MINISTRADA)

    await apagar(res.body.dados.id)
  })

  it('POST /recebida grava tipo 2, e IGNORA um tipo_id contrabandeado no corpo', async () => {
    await definePerfil(MODULO.efetivo, NIVEL.operador)

    const res = await comoUsuario('post', '/api/rpcmtec/capacitacao/recebida', {
      ...corpo('Curso da rota recebida'),
      // O caminho de fuga que a separacao fecha: mandar o tipo do OUTRO lado.
      // O `stripUnknown` do /api/rpcmtec o descarta, e o servidor grava o tipo
      // da ROTA.
      tipo_id: TIPO.MINISTRADA
    })
    expect(res.status).toBe(201)

    const linha = await lerTipo(res.body.dados.id)
    expect(Number(linha.tipo_id)).toBe(TIPO.RECEBIDA)

    await apagar(res.body.dados.id)
  })

  // O CASO QUE MOTIVA O RECORTE NO CONTROLADOR. A guarda da rota aprovaria: a
  // rota e a dele. Quem tem de recusar e o controlador, olhando o tipo da LINHA.
  it('operador de Efetivo nao apaga nem edita capacitacao MINISTRADA pelo caminho da recebida', async () => {
    // Semeada pelo administrador, para o caso nao depender da rota que ele testa.
    const criada = await request(app)
      .post('/api/rpcmtec/capacitacao/ministrada')
      .set('Authorization', generateAdminToken())
      .send(corpo('Ministrada alheia'))
    expect(criada.status).toBe(201)
    const id = criada.body.dados.id

    await definePerfil(MODULO.efetivo, NIVEL.operador)

    // A variancia primeiro: a linha existe e e do tipo 1. Sem isto, o "ainda
    // esta la" do fim seria verdade sobre uma linha que nunca esteve.
    expect(Number((await lerTipo(id)).tipo_id)).toBe(TIPO.MINISTRADA)

    const lida = await comoUsuario('get', `/api/rpcmtec/capacitacao/recebida/${id}`)
    expect(lida.status).toBe(404)

    const editada = await comoUsuario(
      'put', `/api/rpcmtec/capacitacao/recebida/${id}`, corpo('Renomeada indevidamente')
    )
    expect(editada.status).toBe(404)

    const apagada = await comoUsuario('delete', `/api/rpcmtec/capacitacao/recebida/${id}`)
    expect(apagada.status).toBe(404)

    // RELE O DESTINO: a linha continua la, com o nome e o tipo originais. O 404
    // acima e o eco da rota; isto e a prova.
    const depois = await conn.oneOrNone(
      'SELECT tipo_id, nome FROM rpcmtec.capacitacao WHERE id = $1', [id]
    )
    expect(depois).not.toBeNull()
    expect(Number(depois.tipo_id)).toBe(TIPO.MINISTRADA)
    expect(depois.nome).toBe('Ministrada alheia')

    await apagar(id)
  })

  // A listagem tambem se separa, e nao so a escrita: `GET /capacitacao` sem
  // `tipo_id` devolvia os DOIS tipos, e uma guarda por tipo numa rota que
  // responde os dois nao guarda nada.
  it('a listagem de um tipo nao mostra o outro', async () => {
    const semear = async (caminho, nome) => {
      const res = await request(app)
        .post(caminho)
        .set('Authorization', generateAdminToken())
        .send(corpo(nome))
      expect(res.status).toBe(201)
      return res.body.dados.id
    }

    const idM = await semear('/api/rpcmtec/capacitacao/ministrada', 'So na ministrada')
    const idR = await semear('/api/rpcmtec/capacitacao/recebida', 'So na recebida')

    await definePerfil(MODULO.producao, NIVEL.operador)
    const lista = await comoUsuario('get', '/api/rpcmtec/capacitacao/ministrada?ano=2026')
    expect(lista.status).toBe(200)

    const nomes = lista.body.dados.map(c => c.nome)
    // A VARIANCIA: a lista traz de fato a ministrada semeada. Uma lista vazia
    // satisfaria sozinha o `not.toContain` abaixo.
    expect(nomes).toContain('So na ministrada')
    expect(nomes).not.toContain('So na recebida')

    await apagar(idM)
    await apagar(idR)
  })
})
