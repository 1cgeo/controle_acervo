'use strict'

// O PERFIL DE CADA ROTA DO EQUIPAMENTO, contra o banco e as rotas de verdade.
//
// A RÉGUA DA CASA, de 2026-08-08: `consulta` LÊ as telas do módulo, `operador`
// LANÇA, `gerente` responde pela área. No equipamento isso quer dizer:
//
//   consulta  vê o parque, a ficha, o painel e tira o Relatório DMT
//   operador  lança o que ACONTECE com o bem (indisponibilidade, afastamento,
//             manutenção) e cadastra tipo novo
//   gerente   mexe na CARGA: cria, altera e remove o BEM, remove tipo, e lança
//             transferência e descarga, que são movimentação de patrimônio
//
// POR QUE NÃO SE DUBLA O LOGIN AQUI: `verifyPerfil` lê o BANCO a cada
// requisição, e não o token. Dublá-lo provaria que a rota chama uma função;
// aqui o JWT é assinado de verdade e o perfil sai de `dgeo.usuario_perfil`.
//
// A ARMADILHA QUE ISTO GUARDA, e ela é do CLAUDE.md: o default de
// `verifyPerfil(minimo, modulo)` é 'acervo'. Uma rota daqui que esquecesse o
// segundo argumento passaria a cobrar perfil no ACERVO -- e o usuário semeado é
// `consulta` no acervo, então metade das leituras continuaria respondendo 200.
// `routes/modulo_em_toda_rota.test.js` varre o fonte; este arquivo mede o
// comportamento, e o caso do fim mede os dois juntos.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const {
  generateUserToken, generateAdminToken, USER_UUID, ADMIN_UUID
} = require('../helpers/auth')
const {
  CLASSE_SUPRIMENTO, SECAO_DETENTORA, SITUACAO_TRANSFERENCIA, TIPO_TRANSFERENCIA
} = require('../../utils/domain_constants')

const MODULO = { acervo: 1, mapoteca: 2, equipamento: 6 }
const NIVEL = { consulta: 1, operador: 2, gerente: 3 }

let app

beforeAll(async () => {
  app = await getApp()
})

// A CONCESSÃO SE DESFAZ AQUI, e nos dois lados.
//
// `cleanTestData` apaga `dgeo.usuario_perfil` só de quem está FORA da semente, e
// o usuário de teste está DENTRO: a linha de `equipamento` ficaria e vazaria
// para todo arquivo que rodasse depois neste worker. Já mordeu duas vezes neste
// projeto em 2026-08-08, e o sintoma aparece longe da causa -- um caso de outro
// arquivo esperando 403 e recebendo 200, ou 500.
//
// O `beforeEach` defende ESTE arquivo de quem veio antes; o `afterEach` defende
// quem vem depois. Só o primeiro protege do vazamento alheio.
const semPerfilNoEquipamento = () =>
  conn.none(
    `DELETE FROM dgeo.usuario_perfil
      WHERE modulo_id = $2 AND usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
    [USER_UUID, MODULO.equipamento]
  )

beforeEach(semPerfilNoEquipamento)

afterEach(async () => {
  await semPerfilNoEquipamento()
  await cleanTestData()
})

const daPerfil = (nivel) =>
  conn.none(
    `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
     SELECT id, $2, $3 FROM dgeo.usuario WHERE uuid = $1
     ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
    [USER_UUID, MODULO.equipamento, nivel]
  )

const usuario = () => generateUserToken()
const admin = () => generateAdminToken()

// --- Cenário mínimo ---------------------------------------------------------
//
// As rotas de escrita precisam de um bem e de um tipo que existam, senão a
// recusa por chave estrangeira (409) se confundiria com a recusa por perfil.

let cenario = 0
const semear = async () => {
  cenario += 1
  const tipo = await conn.one(
    `INSERT INTO equipamento.tipo_equipamento (nome, vida_util_meses)
     VALUES ($1, 120) RETURNING id`,
    [`Estação Total ${cenario}`]
  )
  const bem = await conn.one(
    `INSERT INTO equipamento.equipamento
       (nr_patrimonio, classe_id, tipo_id, modelo, secao_detentora_id,
        usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, 'TOPCON CTS-3007', $4, $5) RETURNING id`,
    [
      `10482070001${4460 + cenario}`, CLASSE_SUPRIMENTO.VI, tipo.id,
      SECAO_DETENTORA.CIA_LEV, ADMIN_UUID
    ]
  )
  // A PARADA DO CENÁRIO NASCE FECHADA, e isso não é detalhe: o `EXCLUDE` do DDL
  // recusa duas paradas abertas do mesmo bem (um `daterange` sem fim é infinito
  // à direita e cruza qualquer outro), e o 409 dele se confundiria com a recusa
  // por perfil que este arquivo mede.
  const parada = await conn.one(
    `INSERT INTO equipamento.indisponibilidade
       (equipamento_id, motivo, data_inicio, data_fim, usuario_cadastramento_uuid)
     VALUES ($1, 'Erro de firmware', '2026-05-11', '2026-05-20', $2) RETURNING id`,
    [bem.id, ADMIN_UUID]
  )
  return { tipoId: tipo.id, bemId: bem.id, paradaId: parada.id }
}

/**
 * As rotas do módulo, com o piso de perfil de cada uma.
 *
 * A LISTA É ESCRITA À MÃO, e não derivada do roteador: derivá-la faria o teste
 * concordar com qualquer troca de piso. Ela é a tabela do contrato, e o `%s` do
 * `test.each` põe o nome de cada rota no relatório.
 *
 * O corpo é uma função de `cenario` porque os ids só existem depois do semear.
 */
const ROTAS = [
  // --- consulta LÊ ---------------------------------------------------------
  ['consulta', 'get', () => '/api/equipamento/dominio', null],
  ['consulta', 'get', () => '/api/equipamento/tipo', null],
  ['consulta', 'get', () => '/api/equipamento/dashboard', null],
  ['consulta', 'get', () => '/api/equipamento/relatorio/dmt_ods', null],
  ['consulta', 'get', () => '/api/equipamento/indisponibilidade', null],
  ['consulta', 'get', () => '/api/equipamento/afastamento', null],
  ['consulta', 'get', () => '/api/equipamento/manutencao', null],
  ['consulta', 'get', () => '/api/equipamento/transferencia', null],
  ['consulta', 'get', () => '/api/equipamento', null],
  ['consulta', 'get', c => `/api/equipamento/${c.bemId}`, null],

  // --- operador LANÇA ------------------------------------------------------
  ['operador', 'post', () => '/api/equipamento/tipo', () => ({ nome: 'Teodolito' })],
  ['operador', 'put', c => `/api/equipamento/tipo/${c.tipoId}`,
    () => ({ nome: 'Teodolito renomeado' })],
  ['operador', 'post', () => '/api/equipamento/indisponibilidade',
    c => ({ equipamento_id: c.bemId, data_inicio: '2026-09-01', motivo: 'Fonte' })],
  ['operador', 'put', c => `/api/equipamento/indisponibilidade/${c.paradaId}`,
    c => ({
      equipamento_id: c.bemId, data_inicio: '2026-05-11', data_fim: '2026-05-20',
      motivo: 'Placa'
    })],
  ['operador', 'delete', c => `/api/equipamento/indisponibilidade/${c.paradaId}`, null],
  ['operador', 'post', () => '/api/equipamento/afastamento',
    c => ({
      equipamento_id: c.bemId, om: '3º BPE', motivo: 'Apoio', data_inicio: '2026-04-09'
    })],
  ['operador', 'post', () => '/api/equipamento/manutencao',
    c => ({ equipamento_id: c.bemId, data_inicio: '2026-05-11' })],

  // --- gerente MEXE NA CARGA ----------------------------------------------
  ['gerente', 'post', () => '/api/equipamento',
    c => ({
      nr_patrimonio: `99${c.bemId}`,
      classe_id: CLASSE_SUPRIMENTO.VI,
      tipo_id: c.tipoId,
      modelo: 'Spectra SP 60',
      secao_detentora_id: SECAO_DETENTORA.CIA_LEV
    })],
  ['gerente', 'put', c => `/api/equipamento/${c.bemId}`,
    c => ({
      nr_patrimonio: `88${c.bemId}`,
      classe_id: CLASSE_SUPRIMENTO.VI,
      tipo_id: c.tipoId,
      modelo: 'TOPCON CTS-3007',
      secao_detentora_id: SECAO_DETENTORA.CIA_PROD
    })],
  ['gerente', 'delete', c => `/api/equipamento/${c.bemId}`, null],
  ['gerente', 'delete', c => `/api/equipamento/tipo/${c.tipoId}`, null],
  ['gerente', 'post', () => '/api/equipamento/transferencia',
    c => ({
      equipamento_id: c.bemId,
      tipo_id: TIPO_TRANSFERENCIA.DESCARGA,
      situacao_id: SITUACAO_TRANSFERENCIA.SOLICITADA
    })]
]

const chamar = (metodo, caminho, corpo, token) => {
  const req = request(app)[metodo](caminho).set('Authorization', token)
  return corpo ? req.send(corpo) : req
}

const rotulo = ([piso, metodo, caminho]) =>
  `${piso}: ${metodo.toUpperCase()} ${caminho({ bemId: ':id', tipoId: ':id', paradaId: ':id' })}`

const casos = ROTAS.map(r => [rotulo(r), r])

// O nível IMEDIATAMENTE ABAIXO do piso, que é o que separa "a guarda existe" de
// "a guarda cobra o nível certo". Uma rota de gerente protegida por `operador`
// passaria num teste que só experimentasse `consulta`.
const ABAIXO = { operador: 'consulta', gerente: 'operador' }

describe('quem tem o perfil do piso passa', () => {
  test.each(casos)('%s', async (_nome, [piso, metodo, caminho, corpo]) => {
    const c = await semear()
    await daPerfil(NIVEL[piso])

    const res = await chamar(metodo, caminho(c), corpo && corpo(c), usuario())

    expect(res.status).not.toBe(403)
  })
})

describe('quem tem UM nível abaixo do piso leva 403', () => {
  const comPiso = casos.filter(([, r]) => ABAIXO[r[0]])

  test.each(comPiso)('%s', async (_nome, [piso, metodo, caminho, corpo]) => {
    const c = await semear()
    await daPerfil(NIVEL[ABAIXO[piso]])

    const res = await chamar(metodo, caminho(c), corpo && corpo(c), usuario())

    expect(res.status).toBe(403)
    // A MENSAGEM NOMEIA O MÓDULO, e é ela que pega a armadilha do default: com
    // o segundo argumento esquecido, a frase diria 'no módulo acervo'.
    expect(res.body.message).toMatch(
      new RegExp(`perfil ${piso} no módulo equipamento`, 'i')
    )
  })
})

describe('quem não tem linha nenhuma no módulo não entra, nem para ler', () => {
  test.each(casos)('%s', async (_nome, [, metodo, caminho, corpo]) => {
    // O usuário semeado é `consulta` no ACERVO e `operador` na MAPOTECA, e nada
    // no equipamento. Conceder é ato explícito, e sem linha não se lê nem a
    // lista de domínios.
    const c = await semear()

    const res = await chamar(metodo, caminho(c), corpo && corpo(c), usuario())

    expect(res.status).toBe(403)
  })
})

describe('sem token, tudo é 401', () => {
  test.each(casos)('%s', async (_nome, [, metodo, caminho, corpo]) => {
    const c = await semear()

    const req = request(app)[metodo](caminho(c))
    const res = await (corpo ? req.send(corpo(c)) : req)

    expect(res.status).toBe(401)
  })
})

// ---------------------------------------------------------------------------
// AS DUAS FRONTEIRAS QUE O CONTRATO NOMEIA
// ---------------------------------------------------------------------------

describe('o operador LANÇA, mas não mexe na carga', () => {
  test('operador NÃO cadastra bem', async () => {
    const c = await semear()
    await daPerfil(NIVEL.operador)

    const res = await request(app)
      .post('/api/equipamento')
      .set('Authorization', usuario())
      .send({
        nr_patrimonio: '104821500017429',
        classe_id: CLASSE_SUPRIMENTO.VI,
        tipo_id: c.tipoId,
        modelo: 'Spectra SP 60',
        secao_detentora_id: SECAO_DETENTORA.CIA_LEV
      })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/perfil gerente no módulo equipamento/i)

    // A LINHA NÃO ENTROU. O 403 sozinho provaria que a resposta é 403, e não que
    // a escrita foi barrada: um middleware que respondesse depois de o
    // controlador rodar passaria naquele caso e falharia neste.
    expect(await conn.any(
      "SELECT id FROM equipamento.equipamento WHERE nr_patrimonio = '104821500017429'"
    )).toHaveLength(0)
  })

  test('operador NÃO lança transferência, que é movimentação de patrimônio', async () => {
    const c = await semear()
    await daPerfil(NIVEL.operador)

    const res = await request(app)
      .post('/api/equipamento/transferencia')
      .set('Authorization', usuario())
      .send({
        equipamento_id: c.bemId,
        tipo_id: TIPO_TRANSFERENCIA.DESCARGA,
        situacao_id: SITUACAO_TRANSFERENCIA.SOLICITADA
      })

    expect(res.status).toBe(403)
    expect(await conn.any(
      'SELECT id FROM equipamento.transferencia WHERE equipamento_id = $1', [c.bemId]
    )).toHaveLength(0)
  })

  test('operador LANÇA indisponibilidade, e a linha entra', async () => {
    // VARIÂNCIA dos dois acima: sem ela, um `verifyPerfil('gerente')` colado em
    // toda rota passaria nos dois e quebraria o trabalho de quem lança.
    const c = await semear()
    await daPerfil(NIVEL.operador)

    const res = await request(app)
      .post('/api/equipamento/indisponibilidade')
      .set('Authorization', usuario())
      .send({ equipamento_id: c.bemId, data_inicio: '2026-09-01', motivo: 'Fonte' })

    expect(res.status).toBe(201)
    expect(await conn.any(
      'SELECT id FROM equipamento.indisponibilidade WHERE equipamento_id = $1', [c.bemId]
    )).toHaveLength(2)
  })
})

describe('a consulta LÊ, e não lança nada', () => {
  const LANCAMENTOS = [
    ['indisponibilidade', c => ({
      equipamento_id: c.bemId, data_inicio: '2026-09-01', motivo: 'Fonte'
    })],
    ['afastamento', c => ({
      equipamento_id: c.bemId, om: '3º BPE', motivo: 'Apoio', data_inicio: '2026-04-09'
    })],
    ['manutencao', c => ({ equipamento_id: c.bemId, data_inicio: '2026-05-11' })]
  ]

  test.each(LANCAMENTOS)('consulta NÃO lança %s', async (tabela, corpo) => {
    const c = await semear()
    await daPerfil(NIVEL.consulta)

    const res = await request(app)
      .post(`/api/equipamento/${tabela}`)
      .set('Authorization', usuario())
      .send(corpo(c))

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/perfil operador no módulo equipamento/i)
  })

  test('consulta LÊ o parque, a ficha e o painel', async () => {
    const c = await semear()
    await daPerfil(NIVEL.consulta)

    const ler = rota => request(app).get(rota).set('Authorization', usuario())

    expect((await ler('/api/equipamento')).status).toBe(200)
    expect((await ler(`/api/equipamento/${c.bemId}`)).status).toBe(200)
    expect((await ler('/api/equipamento/dashboard')).status).toBe(200)
    expect((await ler('/api/equipamento/dominio')).status).toBe(200)
  })

  test('consulta tira o Relatório DMT, e ele sai binário', async () => {
    // O RELATÓRIO É DE CONSULTA porque é o documento que a Seção JÁ entrega
    // hoje: prendê-lo ao operador tiraria de quem só confere o número o único
    // jeito de conferi-lo.
    await semear()
    await daPerfil(NIVEL.consulta)

    const res = await request(app)
      .get('/api/equipamento/relatorio/dmt_ods')
      .set('Authorization', usuario())
      .buffer()
      .parse((r, cb) => {
        const partes = []
        r.on('data', p => partes.push(p))
        r.on('end', () => cb(null, Buffer.concat(partes)))
      })

    expect(res.status).toBe(200)
    expect(res.headers['content-type'])
      .toContain('application/vnd.oasis.opendocument.spreadsheet')
    expect(res.headers['content-disposition']).toContain('relatorio_dmt.ods')
    // Todo .ods é um ZIP, e todo ZIP começa em 'PK'. Sem esta linha, um envelope
    // JSON com o Buffer serializado dentro passaria no caso acima.
    expect(res.body.subarray(0, 2).toString()).toBe('PK')
  })
})

describe('o administrador global atravessa, e o gerente de OUTRO módulo não', () => {
  test('o administrador cria o bem sem ter linha no módulo', async () => {
    const c = await semear()

    const res = await request(app)
      .post('/api/equipamento')
      .set('Authorization', admin())
      .send({
        nr_patrimonio: '104821500017688',
        classe_id: CLASSE_SUPRIMENTO.VI,
        tipo_id: c.tipoId,
        modelo: 'HP Latex 335',
        secao_detentora_id: SECAO_DETENTORA.CIA_LEV
      })

    expect(res.status).toBe(201)
  })

  // A ARMADILHA DO DEFAULT, medida pelo comportamento. O usuário semeado é
  // `consulta` no ACERVO: se uma rota daqui esquecesse o segundo argumento do
  // `verifyPerfil`, ela passaria a cobrar perfil no acervo e esta leitura
  // responderia 200 em vez de 403.
  test('consulta no ACERVO e operador na MAPOTECA não abrem o equipamento', async () => {
    await semear()

    const res = await request(app)
      .get('/api/equipamento').set('Authorization', usuario())

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/módulo equipamento/i)
  })

  test('gerente na MAPOTECA continua fora do equipamento', async () => {
    await semear()
    await conn.none(
      `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
       SELECT id, $2, $3 FROM dgeo.usuario WHERE uuid = $1
       ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
      [USER_UUID, MODULO.mapoteca, NIVEL.gerente]
    )

    const res = await request(app)
      .get('/api/equipamento/dashboard').set('Authorization', usuario())

    expect(res.status).toBe(403)

    // A concessão de mapoteca volta ao nível da semente aqui, e não no
    // `afterEach`: `cleanTestData` não desfaz o que se muda em usuário da
    // semente, e um `gerente` na mapoteca vazando mudaria o que os outros
    // arquivos medem.
    await conn.none(
      `UPDATE dgeo.usuario_perfil SET perfil_id = $3
        WHERE modulo_id = $2
          AND usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
      [USER_UUID, MODULO.mapoteca, NIVEL.operador]
    )
  })

  // REBAIXAR VALE NA HORA, porque `verifyPerfil` lê o BANCO a cada requisição e
  // não o token. É o que faz tirar acesso de alguém não depender de o token
  // dele expirar.
  test('rebaixar de gerente para operador barra a rota de gerente na hora', async () => {
    const c = await semear()
    await daPerfil(NIVEL.gerente)

    const mesmoToken = usuario()

    const antes = await request(app)
      .delete(`/api/equipamento/tipo/${c.tipoId}`).set('Authorization', mesmoToken)
    expect(antes.status).not.toBe(403)

    await daPerfil(NIVEL.operador)

    const depois = await request(app)
      .delete('/api/equipamento/tipo/999999').set('Authorization', mesmoToken)
    expect(depois.status).toBe(403)
  })
})
