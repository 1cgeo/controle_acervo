'use strict'

// O MÓDULO EQUIPAMENTO contra o banco de verdade.
//
// O que este arquivo protege, e por que cada coisa está aqui e não num teste
// mockado:
//
//  1. A ESCADA DA SITUAÇÃO. É a regra central do módulo, e ela vive numa FUNÇÃO
//     SQL (`equipamento.situacao_em(dia)`), não no JavaScript. Um dublê provaria
//     que o controlador chama a função; só o banco prova que a função responde
//     'Indisponível' para um bem que está afastado E indisponível.
//
//  2. O DIA PASSADO. A assinatura promete a situação de QUALQUER dia, e é essa
//     promessa que faz o RPCMTec de julho continuar certo em agosto. Uma view
//     `situacao_atual` passaria em todos os casos de hoje e falharia só neste.
//
//  3. A NÃO SOBREPOSIÇÃO, que é do `EXCLUDE USING gist` e de mais nada: não há
//     linha de JavaScript que a confira. Com `data_fim` nula dos dois lados, que
//     é o caso real das 12 indisponibilidades de produção.
//
//  4. A AUDITORIA NA MESMA TRANSAÇÃO. Falhar ao auditar derruba a escrita, e
//     isso é deliberado: o que se prova é que a LINHA NÃO SOBROU.
//
//  5. A ORDEM DAS ROTAS. `GET /tipo` não pode cair em `GET /:id`, e a prova é
//     uma requisição de verdade -- ler o fonte provaria a ordem do arquivo, e
//     não a do Express.
//
// O PERFIL DE CADA ROTA está em `routes/equipamento_perfil.test.js`. Aqui tudo
// corre como administrador, e o assunto é o DADO.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, ADMIN_UUID } = require('../helpers/auth')
const {
  CLASSE_SUPRIMENTO,
  SECAO_DETENTORA,
  SITUACAO_EQUIPAMENTO,
  SITUACAO_TRANSFERENCIA,
  TIPO_TRANSFERENCIA
} = require('../../utils/domain_constants')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')
// O Relatório DMT só tem porta binária (.ods): o caso que precisa das LINHAS
// dele chama o controlador, e não a rota.
const equipamentoCtrl = require('../../equipamento/equipamento_ctrl')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  jest.restoreAllMocks()
  await cleanTestData()
})

const admin = () => generateAdminToken()

// `equipamento.tipo_equipamento` ENTRA no `cleanTestData`, e é semeada pelo
// `er/equipamento.sql` com os 9 tipos do QDMP: depois do primeiro clean os 9 não
// estão mais lá. É deliberado (ver `helpers/db.js`), e a consequência é esta
// função: cada caso cria o tipo dele.
let contadorDeTipo = 0
const criarTipo = async (nome, vidaUtilMeses = 120) => {
  contadorDeTipo += 1
  const linha = await conn.one(
    `INSERT INTO equipamento.tipo_equipamento (nome, vida_util_meses)
     VALUES ($<nome>, $<vidaUtilMeses>) RETURNING id`,
    { nome: `${nome} ${contadorDeTipo}`, vidaUtilMeses }
  )
  return linha.id
}

let contadorDeBem = 0
const criarBem = async (extra = {}) => {
  contadorDeBem += 1
  const tipoId = extra.tipo_id || (await criarTipo('Estação Total'))
  const linha = await conn.one(
    `INSERT INTO equipamento.equipamento
       (nr_patrimonio, classe_id, tipo_id, modelo, secao_detentora_id, ativo,
        usuario_cadastramento_uuid)
     VALUES ($<nr_patrimonio>, $<classe_id>, $<tipo_id>, $<modelo>,
             $<secao_detentora_id>, $<ativo>, $<uuid>)
     RETURNING id`,
    {
      nr_patrimonio: extra.nr_patrimonio || `1048207000144${60 + contadorDeBem}`,
      classe_id: extra.classe_id || CLASSE_SUPRIMENTO.VI,
      tipo_id: tipoId,
      modelo: extra.modelo || 'TOPCON CTS-3007',
      secao_detentora_id: extra.secao_detentora_id || SECAO_DETENTORA.CIA_LEV,
      ativo: extra.ativo !== undefined ? extra.ativo : true,
      uuid: ADMIN_UUID
    }
  )
  return linha.id
}

const lancar = (tabela, colunas, valores) =>
  conn.one(
    `INSERT INTO equipamento.${tabela} (${colunas.join(', ')}, usuario_cadastramento_uuid)
     VALUES (${colunas.map(c => `$<${c}>`).join(', ')}, $<uuid>)
     RETURNING id`,
    { ...valores, uuid: ADMIN_UUID }
  )

const afastar = (bemId, dataInicio, dataFim = null) =>
  lancar('afastamento', ['equipamento_id', 'om', 'motivo', 'data_inicio', 'data_fim'], {
    equipamento_id: bemId, om: '3º BPE', motivo: 'Apoio', data_inicio: dataInicio,
    data_fim: dataFim
  })

const parar = (bemId, dataInicio, dataFim = null) =>
  lancar('indisponibilidade', ['equipamento_id', 'motivo', 'data_inicio', 'data_fim'], {
    equipamento_id: bemId, motivo: 'Erro de firmware', data_inicio: dataInicio,
    data_fim: dataFim
  })

// A indisponibilidade que TERMINA HOJE, com as duas datas vindas do PROPRIO
// banco (`CURRENT_DATE`), e nao do relogio do Node: e `equipamento.situacao_em`
// que decide o dia, e uma data montada em JavaScript poderia cair no dia
// anterior por fuso e transformar o caso em outro caso.
const pararFechandoHoje = bemId =>
  conn.one(
    `INSERT INTO equipamento.indisponibilidade
       (equipamento_id, motivo, data_inicio, data_fim, usuario_cadastramento_uuid)
     VALUES ($<bemId>, $<motivo>, CURRENT_DATE - 3, CURRENT_DATE, $<uuid>)
     RETURNING id, data_inicio::text AS data_inicio`,
    { bemId, motivo: 'Erro de firmware', uuid: ADMIN_UUID }
  )

const consertar = (bemId, dataInicio, dataFim = null) =>
  lancar('manutencao', ['equipamento_id', 'data_inicio', 'data_fim'], {
    equipamento_id: bemId, data_inicio: dataInicio, data_fim: dataFim
  })

/**
 * A situação do bem no dia pedido, direto da FUNÇÃO SQL.
 *
 * Sem o dia, vale hoje: é a mesma chamada que a lista e o painel fazem, com
 * `CURRENT_DATE`.
 */
const situacaoEm = (bemId, dia = null) =>
  conn.one(
    `SELECT s.situacao_id, sit.nome
       FROM equipamento.situacao_em(COALESCE($<dia>::date, CURRENT_DATE)) AS s
       INNER JOIN equipamento.situacao AS sit ON sit.code = s.situacao_id
      WHERE s.equipamento_id = $<bemId>`,
    { dia, bemId }
  )

const ontem = () => {
  const d = new Date()
  d.setDate(d.getDate() - 1)
  return d.toISOString().slice(0, 10)
}

// ---------------------------------------------------------------------------
// 1. A ESCADA DA SITUAÇÃO
// ---------------------------------------------------------------------------

describe('a situação do bem é DERIVADA, e vale o degrau mais alto', () => {
  // OS CINCO DEGRAUS, um por caso. O `ontem()` é o início de todo lançamento
  // aberto: com a data de hoje o caso continuaria passando, mas um `<` no lugar
  // do `<=` da função sairia impune.
  test('sem lançamento nenhum, o bem está Disponível', async () => {
    const bem = await criarBem()

    expect(await situacaoEm(bem)).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.DISPONIVEL, nome: 'Disponível'
    })
  })

  test('com afastamento aberto, o bem está Afastado', async () => {
    const bem = await criarBem()
    await afastar(bem, ontem())

    expect(await situacaoEm(bem)).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.AFASTADO, nome: 'Afastado'
    })
  })

  test('com manutenção aberta, o bem está Em manutenção', async () => {
    const bem = await criarBem()
    await consertar(bem, ontem())

    expect(await situacaoEm(bem)).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.EM_MANUTENCAO, nome: 'Em manutenção'
    })
  })

  test('com indisponibilidade aberta, o bem está Indisponível', async () => {
    const bem = await criarBem()
    await parar(bem, ontem())

    expect(await situacaoEm(bem)).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.INDISPONIVEL, nome: 'Indisponível'
    })
  })

  test('com ativo = FALSE, o bem está Baixado', async () => {
    const bem = await criarBem({ ativo: false })

    expect(await situacaoEm(bem)).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.BAIXADO, nome: 'Baixado'
    })
  })

  // O CASO QUE A ESCADA EXISTE PARA RESOLVER, e o que o enunciado da regra pede
  // ao pé da letra: afastado E indisponível ao mesmo tempo sai Indisponível,
  // porque 40 vence 20. Sem a precedência, a resposta dependeria de qual EXISTS
  // o planejador avaliasse primeiro.
  test('afastado E indisponível no mesmo dia sai Indisponível (40 vence 20)', async () => {
    const bem = await criarBem()
    await afastar(bem, ontem())
    await parar(bem, ontem())

    expect(await situacaoEm(bem)).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.INDISPONIVEL, nome: 'Indisponível'
    })
  })

  // O MESMO BEM, baixado: agora o 50 vence os dois. Baixar não apaga os
  // lançamentos, e é por isso que este caso continua do anterior em vez de
  // montar um cenário novo.
  test('o MESMO bem com ativo = FALSE passa a sair Baixado (50 vence 40)', async () => {
    const bem = await criarBem()
    await afastar(bem, ontem())
    await parar(bem, ontem())

    await conn.none('UPDATE equipamento.equipamento SET ativo = FALSE WHERE id = $1', [bem])

    expect(await situacaoEm(bem)).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.BAIXADO, nome: 'Baixado'
    })
  })

  test('a função devolve UMA linha por bem, inclusive para quem não tem evento', async () => {
    // O `SELECT 10` do `UNION ALL` é o piso, e é ele que impede um bem sem
    // lançamento de sumir do relatório inteiro por um INNER JOIN.
    await criarBem()
    await criarBem()

    const linhas = await conn.any(
      'SELECT equipamento_id FROM equipamento.situacao_em(CURRENT_DATE)'
    )
    const bens = await conn.one(
      'SELECT COUNT(*)::integer AS total FROM equipamento.equipamento'
    )

    expect(linhas).toHaveLength(bens.total)
    expect(new Set(linhas.map(l => l.equipamento_id)).size).toBe(bens.total)
  })
})

// ---------------------------------------------------------------------------
// 2. O DIA PASSADO
// ---------------------------------------------------------------------------

// É O QUE A ASSINATURA PROMETE, e o que o RPCMTec vai usar: a 7.1 de julho
// pergunta quem estava parado no último dia de JULHO, e a resposta não pode
// mudar porque o conserto ficou pronto em agosto.
describe('situacao_em responde sobre um dia PASSADO, e não sobre hoje', () => {
  test('a parada de maio aparece em maio e some depois de fechada', async () => {
    const bem = await criarBem()
    await parar(bem, '2026-05-11', '2026-05-20')

    // Dentro do intervalo.
    expect(await situacaoEm(bem, '2026-05-15')).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.INDISPONIVEL
    })
    // Nas bordas: o DDL é `<=` e `>=`, e o dia de início e o de fim CONTAM.
    expect(await situacaoEm(bem, '2026-05-11')).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.INDISPONIVEL
    })
    expect(await situacaoEm(bem, '2026-05-20')).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.INDISPONIVEL
    })

    // Fora, dos dois lados.
    expect(await situacaoEm(bem, '2026-05-10')).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.DISPONIVEL
    })
    expect(await situacaoEm(bem, '2026-05-21')).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.DISPONIVEL
    })
  })

  // O CASO QUE UMA VIEW `situacao_atual` NÃO PASSARIA. Hoje o bem está
  // disponível (a parada terminou); em 15/05 ele estava parado. As duas respostas
  // saem da mesma função, e são diferentes.
  test('o mesmo bem responde Disponível hoje e Indisponível em maio', async () => {
    const bem = await criarBem()
    await parar(bem, '2026-05-11', '2026-05-20')

    const hoje = await situacaoEm(bem)
    const emMaio = await situacaoEm(bem, '2026-05-15')

    expect(hoje.situacao_id).toBe(SITUACAO_EQUIPAMENTO.DISPONIVEL)
    expect(emMaio.situacao_id).toBe(SITUACAO_EQUIPAMENTO.INDISPONIVEL)
  })

  test('a parada ABERTA vale de qualquer dia dela em diante, e não antes', async () => {
    // As 12 indisponibilidades de produção são assim: `data_fim` nula.
    const bem = await criarBem()
    await parar(bem, '2026-05-11')

    expect(await situacaoEm(bem, '2026-05-10')).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.DISPONIVEL
    })
    expect(await situacaoEm(bem, '2026-07-31')).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.INDISPONIVEL
    })
    expect(await situacaoEm(bem)).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.INDISPONIVEL
    })
  })

  test('a escada também desempata num dia passado', async () => {
    // Afastado o mês inteiro, parado só na segunda quinzena: o degrau muda no
    // meio do mês, e a mesma função responde as duas coisas.
    const bem = await criarBem()
    await afastar(bem, '2026-06-01', '2026-06-30')
    await parar(bem, '2026-06-16', '2026-06-30')

    expect(await situacaoEm(bem, '2026-06-10')).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.AFASTADO
    })
    expect(await situacaoEm(bem, '2026-06-20')).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.INDISPONIVEL
    })
  })
})

// ---------------------------------------------------------------------------
// 3. A NÃO SOBREPOSIÇÃO VEM DO BANCO
// ---------------------------------------------------------------------------

// NÃO HÁ LINHA DE JAVASCRIPT que confira isto: quem recusa é o
// `EXCLUDE USING gist (equipamento_id WITH =, daterange(...) WITH &&)`. O
// controlador só TRADUZ o 23P01 numa frase em português.
describe('duas paradas do mesmo bem não podem se cruzar', () => {
  const abrirParada = (bemId, dataInicio, dataFim = null) =>
    request(app)
      .post('/api/equipamento/indisponibilidade')
      .set('Authorization', admin())
      .send({
        equipamento_id: bemId,
        data_inicio: dataInicio,
        data_fim: dataFim,
        motivo: 'Erro de firmware'
      })

  test('recusa a segunda parada ABERTA, que é o caso real de produção', async () => {
    // AS 12 INDISPONIBILIDADES DE PRODUÇÃO TÊM `data_fim` NULA. Com nulo dos dois
    // lados o `daterange(inicio, NULL, '[]')` é infinito à direita, e duas delas
    // se cruzam sempre -- inclusive quando os inícios são meses distantes.
    const bem = await criarBem()

    const primeira = await abrirParada(bem, '2026-05-11')
    expect(primeira.status).toBe(201)

    const segunda = await abrirParada(bem, '2026-07-17')
    expect(segunda.status).toBe(409)
    expect(segunda.body.message).toMatch(/já tem uma indisponibilidade/i)

    // A LINHA NÃO ENTROU. Sem esta conferência, um 409 devolvido depois de o
    // INSERT ter passado deixaria o banco com as duas.
    const linhas = await conn.any(
      'SELECT id FROM equipamento.indisponibilidade WHERE equipamento_id = $1', [bem]
    )
    expect(linhas).toHaveLength(1)
  })

  test('recusa o intervalo que encosta pela borda', async () => {
    // `daterange(..., '[]')` é FECHADO nos dois lados: a parada que termina no
    // dia 20 e a que começa no dia 20 dividem aquele dia, e o bem não pode estar
    // parado duas vezes nele.
    const bem = await criarBem()

    expect((await abrirParada(bem, '2026-05-11', '2026-05-20')).status).toBe(201)

    const encostada = await abrirParada(bem, '2026-05-20', '2026-05-25')
    expect(encostada.status).toBe(409)
  })

  test('aceita o intervalo do dia seguinte', async () => {
    // VARIÂNCIA do caso acima: sem ela, um EXCLUDE que recusasse TUDO passaria
    // nos dois primeiros casos.
    const bem = await criarBem()

    expect((await abrirParada(bem, '2026-05-11', '2026-05-20')).status).toBe(201)
    expect((await abrirParada(bem, '2026-05-21', '2026-05-25')).status).toBe(201)
  })

  test('a restrição é POR BEM: dois bens param no mesmo dia', async () => {
    const um = await criarBem()
    const outro = await criarBem()

    expect((await abrirParada(um, '2026-05-11')).status).toBe(201)
    expect((await abrirParada(outro, '2026-05-11')).status).toBe(201)
  })

  test('o afastamento tem a mesma trava, e a frase é a dele', async () => {
    const bem = await criarBem()
    const afastarPorRota = (dataInicio) =>
      request(app)
        .post('/api/equipamento/afastamento')
        .set('Authorization', admin())
        .send({
          equipamento_id: bem, om: '3º BPE', motivo: 'Apoio', data_inicio: dataInicio
        })

    expect((await afastarPorRota('2026-04-09')).status).toBe(201)

    const segundo = await afastarPorRota('2026-06-01')
    expect(segundo.status).toBe(409)
    expect(segundo.body.message).toMatch(/já tem um afastamento/i)
  })

  // A MANUTENÇÃO NÃO TEM A TRAVA, e a ausência é modelagem: dois consertos
  // simultâneos no mesmo bem (a placa e a fonte, em oficinas diferentes) são
  // reais. Sem este caso, alguém acrescentaria o EXCLUDE lá "por simetria".
  test('a manutenção ACEITA sobreposição, e isso é deliberado', async () => {
    const bem = await criarBem()
    const consertarPorRota = (dataInicio) =>
      request(app)
        .post('/api/equipamento/manutencao')
        .set('Authorization', admin())
        .send({ equipamento_id: bem, data_inicio: dataInicio })

    expect((await consertarPorRota('2026-05-11')).status).toBe(201)
    expect((await consertarPorRota('2026-05-12')).status).toBe(201)
  })
})

// ---------------------------------------------------------------------------
// 4. A AUDITORIA NA MESMA TRANSAÇÃO
// ---------------------------------------------------------------------------

// FALHAR AO AUDITAR DERRUBA A ESCRITA, e é deliberado: um sistema em que o
// rastro é opcional tem escrita sem rastro no primeiro erro transitório. O que
// se prova aqui é que a LINHA NÃO SOBROU.
describe('a auditoria vive na mesma transação da escrita', () => {
  const derrubarAuditoria = () =>
    jest.spyOn(auditoriaCtrl, 'registrar').mockRejectedValue(
      new Error('auditoria indisponível')
    )

  test('o bem não é criado quando o rastro falha', async () => {
    const tipoId = await criarTipo('Estação Total')
    derrubarAuditoria()

    const res = await request(app)
      .post('/api/equipamento')
      .set('Authorization', admin())
      .send({
        nr_patrimonio: '104821500017429',
        classe_id: CLASSE_SUPRIMENTO.VI,
        tipo_id: tipoId,
        modelo: 'Spectra SP 60',
        secao_detentora_id: SECAO_DETENTORA.CIA_LEV
      })

    expect(res.status).toBe(500)

    const linhas = await conn.any(
      "SELECT id FROM equipamento.equipamento WHERE nr_patrimonio = '104821500017429'"
    )
    expect(linhas).toHaveLength(0)
  })

  test('a indisponibilidade não é criada quando o rastro falha', async () => {
    const bem = await criarBem()
    derrubarAuditoria()

    const res = await request(app)
      .post('/api/equipamento/indisponibilidade')
      .set('Authorization', admin())
      .send({ equipamento_id: bem, data_inicio: '2026-05-11', motivo: 'Erro de firmware' })

    expect(res.status).toBe(500)
    expect(await conn.any(
      'SELECT id FROM equipamento.indisponibilidade WHERE equipamento_id = $1', [bem]
    )).toHaveLength(0)
  })

  test('a exclusão do bem é desfeita quando o rastro falha', async () => {
    // A ESCRITA QUE APAGA também está na regra, e é onde ela custa mais: um
    // DELETE que passasse com o rastro caído deixaria o registro sumido e sem
    // nenhuma linha dizendo quem o apagou.
    const bem = await criarBem()
    derrubarAuditoria()

    const res = await request(app)
      .delete(`/api/equipamento/${bem}`)
      .set('Authorization', admin())

    expect(res.status).toBe(500)
    expect(await conn.oneOrNone(
      'SELECT id FROM equipamento.equipamento WHERE id = $1', [bem]
    )).not.toBeNull()
  })

  test('com o rastro de pé, a criação grava o evento no agregado do BEM', async () => {
    // VARIÂNCIA dos três casos acima: sem ela, um controlador que nunca gravasse
    // nada passaria em todos eles.
    const bem = await criarBem()

    const res = await request(app)
      .post('/api/equipamento/indisponibilidade')
      .set('Authorization', admin())
      .send({ equipamento_id: bem, data_inicio: '2026-05-11', motivo: 'Erro de firmware' })
    expect(res.status).toBe(201)

    const eventos = await conn.any(
      `SELECT modulo, entidade, entidade_id, tabela, operacao
         FROM auditoria.evento WHERE tabela = 'equipamento.indisponibilidade'`
    )

    expect(eventos).toHaveLength(1)
    expect(eventos[0]).toMatchObject({
      modulo: 'equipamento',
      // O AGREGADO É O BEM, e não a indisponibilidade: ninguém abre a ficha da
      // parada n.o 12, abre a do equipamento e olha por que ele está parado.
      entidade: 'equipamento',
      entidade_id: String(bem),
      operacao: 'I'
    })
  })
})

// ---------------------------------------------------------------------------
// 5. A ORDEM DAS ROTAS
// ---------------------------------------------------------------------------

// O Express casa na ORDEM DE DECLARAÇÃO. Com `/:id` declarada antes, `/tipo`
// cairia nela e morreria no Joi de `idParams` com um 400 dizendo que 'tipo' não
// é número -- e a tela de cadastro nunca abriria.
//
// LER O FONTE não provaria isto: provaria a ordem do ARQUIVO. Só a requisição
// prova a ordem do roteador.
describe('a rota literal vem antes da rota com parâmetro', () => {
  const literais = [
    ['/api/equipamento/tipo', 'listarTipo'],
    ['/api/equipamento/dominio', 'getDominio'],
    ['/api/equipamento/dashboard', 'getDashboard'],
    ['/api/equipamento/indisponibilidade', 'lista solta'],
    ['/api/equipamento/afastamento', 'lista solta'],
    ['/api/equipamento/manutencao', 'lista solta'],
    ['/api/equipamento/transferencia', 'lista solta']
  ]

  test.each(literais)('GET %s não cai em GET /:id', async (rota) => {
    const res = await request(app).get(rota).set('Authorization', admin())

    expect(res.status).toBe(200)
    // Um 400 aqui seria o `idParams` reclamando que o texto não é número, que é
    // exatamente o sintoma da ordem invertida.
    expect(res.body.success).toBe(true)
  })

  test('GET /tipo devolve a lista de tipos, e não a ficha de um bem', async () => {
    // O status sozinho não bastaria: uma rota `/:id` que respondesse 200 com
    // outra coisa passaria no caso acima.
    await criarTipo('Impressora de Grande Formato (Plotter)')

    const res = await request(app)
      .get('/api/equipamento/tipo').set('Authorization', admin())

    expect(Array.isArray(res.body.dados)).toBe(true)
    expect(res.body.dados[0]).toHaveProperty('vida_util_meses')
    expect(res.body.dados[0]).not.toHaveProperty('nr_patrimonio')
  })

  test('GET /:id continua atendendo o número', async () => {
    // VARIÂNCIA: sem ela, uma `/:id` apagada faria todos os casos acima passarem.
    const bem = await criarBem()

    const res = await request(app)
      .get(`/api/equipamento/${bem}`).set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados.id).toBe(bem)
  })

  test('GET /:id com id que não existe responde 404', async () => {
    const res = await request(app)
      .get('/api/equipamento/999999').set('Authorization', admin())

    expect(res.status).toBe(404)
  })

  test('GET /:id com id que não é número responde 400, e não 500', async () => {
    const res = await request(app)
      .get('/api/equipamento/abacaxi').set('Authorization', admin())

    expect(res.status).toBe(400)
  })
})

// ---------------------------------------------------------------------------
// 6. O QUE AS ROTAS DEVOLVEM
// ---------------------------------------------------------------------------

describe('a lista de bens', () => {
  test('traz a situação derivada resolvida, com o nome', async () => {
    const bem = await criarBem()
    await parar(bem, ontem())

    const res = await request(app)
      .get('/api/equipamento').set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados).toHaveLength(1)
    expect(res.body.dados[0]).toMatchObject({
      id: bem,
      situacao_id: SITUACAO_EQUIPAMENTO.INDISPONIVEL,
      situacao: 'Indisponível',
      classe: 'VI',
      secao_detentora: 'Cia Lev'
    })
  })

  test('a vida útil vem do TIPO quando o bem não declara a dele', async () => {
    const tipoId = await criarTipo('Aeronave Remotamente Pilotada (Drone)', 60)
    const bem = await criarBem({ tipo_id: tipoId })

    const res = await request(app)
      .get('/api/equipamento').set('Authorization', admin())

    expect(res.body.dados[0]).toMatchObject({
      id: bem, vida_util_meses: 60, vida_util_herdada: true
    })
  })

  test('a vida útil do BEM manda sobre a do tipo', async () => {
    const tipoId = await criarTipo('Aeronave Remotamente Pilotada (Drone)', 60)
    const bem = await criarBem({ tipo_id: tipoId })
    await conn.none(
      'UPDATE equipamento.equipamento SET vida_util_meses = 36 WHERE id = $1', [bem]
    )

    const res = await request(app)
      .get('/api/equipamento').set('Authorization', admin())

    expect(res.body.dados[0]).toMatchObject({
      vida_util_meses: 36, vida_util_herdada: false
    })
  })

  test('filtra pela situação DERIVADA, que não é coluna de tabela nenhuma', async () => {
    const parado = await criarBem()
    await parar(parado, ontem())
    await criarBem()

    const res = await request(app)
      .get(`/api/equipamento?situacao_id=${SITUACAO_EQUIPAMENTO.INDISPONIVEL}`)
      .set('Authorization', admin())

    expect(res.body.dados.map(b => b.id)).toEqual([parado])
  })
})

describe('a ficha do bem', () => {
  test('traz os quatro históricos, cada um com o nome do domínio resolvido', async () => {
    const bem = await criarBem()
    await parar(bem, '2026-05-11')
    await afastar(bem, '2026-04-01', '2026-04-30')
    await consertar(bem, '2026-05-11')
    await lancar(
      'transferencia',
      ['equipamento_id', 'tipo_id', 'situacao_id'],
      {
        equipamento_id: bem,
        tipo_id: TIPO_TRANSFERENCIA.DESCARGA,
        situacao_id: SITUACAO_TRANSFERENCIA.SOLICITADA
      }
    )

    const res = await request(app)
      .get(`/api/equipamento/${bem}`).set('Authorization', admin())

    expect(res.status).toBe(200)
    const ficha = res.body.dados
    expect(ficha.indisponibilidades).toHaveLength(1)
    expect(ficha.afastamentos).toHaveLength(1)
    expect(ficha.manutencoes).toHaveLength(1)
    expect(ficha.transferencias).toHaveLength(1)
    expect(ficha.transferencias[0]).toMatchObject({
      tipo: 'Descarga', situacao: 'Solicitada'
    })
  })
})

describe('a lista solta de lançamentos', () => {
  test('aberta=true traz só o que não terminou', async () => {
    const bem = await criarBem()
    await parar(bem, '2026-05-11')
    await parar(bem, '2026-01-02', '2026-01-10')

    const abertas = await request(app)
      .get('/api/equipamento/indisponibilidade?aberta=true')
      .set('Authorization', admin())
    const todas = await request(app)
      .get('/api/equipamento/indisponibilidade')
      .set('Authorization', admin())

    expect(abertas.body.dados).toHaveLength(1)
    expect(abertas.body.dados[0].data_fim).toBeNull()
    // VARIÂNCIA: as duas estão lá quando ninguém filtra.
    expect(todas.body.dados).toHaveLength(2)
  })

  test('traz o patrimônio e o modelo do bem junto, e não só o id', async () => {
    const bem = await criarBem({ nr_patrimonio: '104821500016511', modelo: 'HP DesignJet' })
    await parar(bem, '2026-07-17')

    const res = await request(app)
      .get('/api/equipamento/indisponibilidade').set('Authorization', admin())

    expect(res.body.dados[0]).toMatchObject({
      equipamento_id: bem, nr_patrimonio: '104821500016511', modelo: 'HP DesignJet'
    })
  })

  // EM `transferencia` NÃO HÁ `data_fim`, e 'aberta' ali quer dizer outra coisa:
  // a situação que não terminou (nem Concluída nem Cancelada). É o filtro que a
  // tela usa para achar as descargas que esperam autorização.
  test('em transferencia, aberta=true lê a SITUAÇÃO e não a data', async () => {
    const bem = await criarBem()
    const nova = (situacaoId) => lancar(
      'transferencia', ['equipamento_id', 'tipo_id', 'situacao_id'],
      {
        equipamento_id: bem,
        tipo_id: TIPO_TRANSFERENCIA.DESCARGA,
        situacao_id: situacaoId
      }
    )
    await nova(SITUACAO_TRANSFERENCIA.SOLICITADA)
    await nova(SITUACAO_TRANSFERENCIA.AUTORIZADA)
    await nova(SITUACAO_TRANSFERENCIA.CONCLUIDA)
    await nova(SITUACAO_TRANSFERENCIA.CANCELADA)

    const abertas = await request(app)
      .get('/api/equipamento/transferencia?aberta=true').set('Authorization', admin())

    expect(abertas.body.dados.map(t => t.situacao).sort())
      .toEqual(['Autorizada', 'Solicitada'])
  })
})

describe('o painel', () => {
  test('mostra a situação com ZERO bem, e não some com a coluna', async () => {
    // LEFT JOIN a partir do domínio: um painel que sumisse com 'Em manutenção'
    // no dia em que nada está em manutenção faria quem lê achar que a coluna
    // nunca existiu.
    const bem = await criarBem()
    await parar(bem, ontem())

    const res = await request(app)
      .get('/api/equipamento/dashboard').set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados.porSituacao).toHaveLength(5)
    const porNome = Object.fromEntries(
      res.body.dados.porSituacao.map(s => [s.situacao, s.quantidade])
    )
    expect(porNome['Indisponível']).toBe(1)
    expect(porNome['Em manutenção']).toBe(0)
    expect(porNome.Disponível).toBe(0)
  })

  test('conta as descargas SOLICITADAS, e não as concluídas', async () => {
    const bem = await criarBem()
    const nova = (tipoId, situacaoId) => lancar(
      'transferencia', ['equipamento_id', 'tipo_id', 'situacao_id'],
      { equipamento_id: bem, tipo_id: tipoId, situacao_id: situacaoId }
    )
    await nova(TIPO_TRANSFERENCIA.DESCARGA, SITUACAO_TRANSFERENCIA.SOLICITADA)
    await nova(TIPO_TRANSFERENCIA.DESCARGA, SITUACAO_TRANSFERENCIA.CONCLUIDA)
    await nova(TIPO_TRANSFERENCIA.CESSAO, SITUACAO_TRANSFERENCIA.SOLICITADA)

    const res = await request(app)
      .get('/api/equipamento/dashboard').set('Authorization', admin())

    expect(res.body.dados.descargasSolicitadas).toBe(1)
  })

  test('o parado há mais tempo vem primeiro, com os dias contados', async () => {
    const antigo = await criarBem()
    const recente = await criarBem()
    await parar(antigo, '2019-07-22')
    await parar(recente, '2026-07-17')

    const res = await request(app)
      .get('/api/equipamento/dashboard').set('Authorization', admin())

    const lista = res.body.dados.indisponiveisHa
    expect(lista.map(i => i.id)).toEqual([antigo, recente])
    expect(lista[0].dias).toBeGreaterThan(lista[1].dias)
  })
})

/**
 * O QUE TERMINA HOJE AINDA CONTA HOJE.
 *
 * `equipamento.situacao_em(p_dia)` conta o evento quando
 * `data_inicio <= p_dia AND (data_fim IS NULL OR data_fim >= p_dia)`. As
 * leituras do painel e do Relatório DMT liam "sem data_fim", que é uma janela
 * MENOR: no único dia em que a diferença aparece, a coluna 9 do relatório dizia
 * 'Indisponível' e as colunas 14 e 15 (Motivo e Início) saíam em branco, e o
 * cartão do painel contava um bem que a lista logo abaixo não mostrava.
 *
 * AS DUAS DATAS VÊM DO BANCO, e o caso não congela relógio nenhum: quem decide
 * o dia aqui é o CURRENT_DATE do Postgres, e um `jest.setSystemTime` mudaria só
 * o lado do Node, criando a divergência que o caso existe para negar.
 */
describe('a indisponibilidade que fecha HOJE ainda vale hoje', () => {
  test('o bem continua Indisponível pela função', async () => {
    const bem = await criarBem()
    await pararFechandoHoje(bem)

    // VARIÂNCIA: se a própria função ignorasse o último dia, todo o resto do
    // describe passaria por vacuidade.
    expect(await situacaoEm(bem)).toMatchObject({
      situacao_id: SITUACAO_EQUIPAMENTO.INDISPONIVEL, nome: 'Indisponível'
    })
  })

  test('ele aparece na lista indisponiveisHa do painel, e não só no cartão', async () => {
    const bem = await criarBem()
    await pararFechandoHoje(bem)

    const res = await request(app)
      .get('/api/equipamento/dashboard').set('Authorization', admin())
    expect(res.status).toBe(200)

    const porNome = Object.fromEntries(
      res.body.dados.porSituacao.map(x => [x.situacao, x.quantidade])
    )
    expect(porNome['Indisponível']).toBe(1)

    const linha = res.body.dados.indisponiveisHa.find(i => i.id === bem)
    // O cartão e a lista TÊM de concordar: era aqui que o bem sumia.
    expect(linha).toBeDefined()
    expect(linha.motivo).toBe('Erro de firmware')
    expect(linha.dias).toBe(3)
  })

  test('o Relatório DMT traz Motivo e Início, e não uma linha que se contradiz', async () => {
    const bem = await criarBem()
    const lancamento = await pararFechandoHoje(bem)

    const linhas = await equipamentoCtrl.linhasDoRelatorioDmt()
    const linha = linhas.find(l => l.id === bem)

    expect(linha).toBeDefined()
    expect(linha.situacao).toBe('Indisponível')
    // As colunas 14 e 15 da planilha, que saíam vazias sob a situação
    // 'Indisponível' da coluna 9.
    expect(linha.indisponibilidade_motivo).toBe('Erro de firmware')
    expect(String(linha.indisponibilidade_data_inicio)).toContain(lancamento.data_inicio)
  })
})

/**
 * O PUT REESCREVE A LINHA INTEIRA, e default não é ausência: ele GRAVA.
 *
 * Os schemas de atualização herdavam os defaults da criação, e um PUT com só os
 * campos obrigatórios reativava o bem baixado (`ativo` voltava a true), apagava
 * a marca de patrimônio por conferir e devolvia ao trânsito contábil os dois
 * SIAFI da transferência, tudo com 200 e sem aviso. As duas pontas de hoje
 * mandam os campos sempre, então nada disso quebrava em produção: quebraria na
 * primeira ponta nova (carga, integração, curl), que é o que estes casos fecham.
 */
describe('a chave ausente no PUT não reverte o que estava gravado', () => {
  const soOsObrigatorios = (bem) => ({
    nr_patrimonio: bem.nr_patrimonio,
    classe_id: CLASSE_SUPRIMENTO.VI,
    tipo_id: bem.tipo_id,
    modelo: 'TOPCON CTS-3007',
    secao_detentora_id: SECAO_DETENTORA.CIA_LEV
  })

  const lerBem = (bemId) =>
    conn.one(
      'SELECT nr_patrimonio, tipo_id FROM equipamento.equipamento WHERE id = $1',
      [bemId]
    )

  test('o bem BAIXADO não volta ao parque', async () => {
    const bemId = await criarBem({ ativo: false })
    const bem = await lerBem(bemId)

    const res = await request(app)
      .put(`/api/equipamento/${bemId}`)
      .set('Authorization', admin())
      .send(soOsObrigatorios(bem))
    expect(res.status).toBe(200)

    const depois = await request(app)
      .get(`/api/equipamento/${bemId}`).set('Authorization', admin())
    expect(depois.body.dados.ativo).toBe(false)
    expect(depois.body.dados.situacao).toBe('Baixado')
  })

  test('a marca de patrimônio por conferir continua de pé', async () => {
    const tipoId = await criarTipo('Estação Total')
    const corpo = {
      nr_patrimonio: '104821500017430',
      classe_id: CLASSE_SUPRIMENTO.VI,
      tipo_id: tipoId,
      modelo: 'Spectra SP 60',
      secao_detentora_id: SECAO_DETENTORA.CIA_LEV
    }

    const criado = await request(app)
      .post('/api/equipamento')
      .set('Authorization', admin())
      .send({ ...corpo, patrimonio_pendente: true })
    expect(criado.status).toBe(201)
    const bemId = criado.body.dados.id

    const res = await request(app)
      .put(`/api/equipamento/${bemId}`)
      .set('Authorization', admin())
      .send(corpo)
    expect(res.status).toBe(200)

    const depois = await request(app)
      .get(`/api/equipamento/${bemId}`).set('Authorization', admin())
    expect(depois.body.dados.patrimonio_pendente).toBe(true)
  })

  test('o campo que VEM continua valendo: mandar false baixa o bem', async () => {
    const bemId = await criarBem()
    const bem = await lerBem(bemId)

    const res = await request(app)
      .put(`/api/equipamento/${bemId}`)
      .set('Authorization', admin())
      .send({ ...soOsObrigatorios(bem), ativo: false })
    expect(res.status).toBe(200)

    const depois = await request(app)
      .get(`/api/equipamento/${bemId}`).set('Authorization', admin())
    expect(depois.body.dados.situacao).toBe('Baixado')
  })

  test('os dois SIAFI da transferência não voltam a false', async () => {
    const bemId = await criarBem()
    const criada = await request(app)
      .post('/api/equipamento/transferencia')
      .set('Authorization', admin())
      .send({
        equipamento_id: bemId,
        tipo_id: TIPO_TRANSFERENCIA.DESCARGA,
        situacao_id: SITUACAO_TRANSFERENCIA.CONCLUIDA,
        transferido_siafi: true,
        apropriado_siafi: true
      })
    expect(criada.status).toBe(201)
    const id = criada.body.dados.id

    const res = await request(app)
      .put(`/api/equipamento/transferencia/${id}`)
      .set('Authorization', admin())
      .send({
        tipo_id: TIPO_TRANSFERENCIA.DESCARGA,
        situacao_id: SITUACAO_TRANSFERENCIA.CONCLUIDA,
        descricao: 'Publicado no BI'
      })
    expect(res.status).toBe(200)

    const linha = await conn.one(
      `SELECT transferido_siafi, apropriado_siafi, descricao
         FROM equipamento.transferencia WHERE id = $1`,
      [id]
    )
    expect(linha.transferido_siafi).toBe(true)
    expect(linha.apropriado_siafi).toBe(true)
    // E o que VEIO no corpo continua sendo gravado.
    expect(linha.descricao).toBe('Publicado no BI')
  })

  test('o tipo INATIVO não volta a ativo', async () => {
    const nome = `Nível óptico ${Date.now()}`
    const criado = await request(app)
      .post('/api/equipamento/tipo')
      .set('Authorization', admin())
      .send({ nome, ativo: false })
    expect(criado.status).toBe(201)
    const id = criado.body.dados.id

    const res = await request(app)
      .put(`/api/equipamento/tipo/${id}`)
      .set('Authorization', admin())
      .send({ nome })
    expect(res.status).toBe(200)

    const linha = await conn.one(
      'SELECT ativo FROM equipamento.tipo_equipamento WHERE id = $1', [id]
    )
    expect(linha.ativo).toBe(false)
  })
})

describe('o domínio', () => {
  test('devolve as cinco listas numa resposta só', async () => {
    const res = await request(app)
      .get('/api/equipamento/dominio').set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(Object.keys(res.body.dados).sort()).toEqual([
      'classe_suprimento', 'secao_detentora', 'situacao',
      'situacao_transferencia', 'tipo_transferencia'
    ])
    // A `precedencia` SAI JUNTO na situação, e é o dado: é por ela que a tela
    // ordena os degraus do painel.
    expect(res.body.dados.situacao.map(s => s.precedencia)).toEqual([10, 20, 30, 40, 50])
  })
})

describe('as recusas amigáveis do banco', () => {
  test('o patrimônio repetido vira 409 com frase, e não 500', async () => {
    const tipoId = await criarTipo('Estação Total')
    const bem = {
      nr_patrimonio: '104821500017429',
      classe_id: CLASSE_SUPRIMENTO.VI,
      tipo_id: tipoId,
      modelo: 'Spectra SP 60',
      secao_detentora_id: SECAO_DETENTORA.CIA_LEV
    }

    expect((await request(app).post('/api/equipamento')
      .set('Authorization', admin()).send(bem)).status).toBe(201)

    const repetido = await request(app).post('/api/equipamento')
      .set('Authorization', admin()).send({ ...bem, modelo: 'RUIDE RTK QUASAR R93I' })

    expect(repetido.status).toBe(409)
    expect(repetido.body.message).toMatch(/número de patrimônio/i)
  })

  test('o tipo com bem cadastrado não é removido, e a frase diz o que fazer', async () => {
    const tipoId = await criarTipo('Estação Total')
    await criarBem({ tipo_id: tipoId })

    const res = await request(app)
      .delete(`/api/equipamento/tipo/${tipoId}`).set('Authorization', admin())

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/inativo/i)
  })

  test('o bem com lançamento não é removido', async () => {
    const bem = await criarBem()
    await parar(bem, '2026-05-11')

    const res = await request(app)
      .delete(`/api/equipamento/${bem}`).set('Authorization', admin())

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/indisponibilidade, afastamento/i)
  })

  test('lançar num bem que não existe vira 409, e não 500', async () => {
    const res = await request(app)
      .post('/api/equipamento/indisponibilidade')
      .set('Authorization', admin())
      .send({ equipamento_id: 999999, data_inicio: '2026-05-11', motivo: 'x' })

    expect(res.status).toBe(409)
    expect(res.body.message).toMatch(/Equipamento inexistente/i)
  })
})

// A COLUNA DATE GUARDA O DIA QUE FOI DIGITADO, e não o anterior. É o que o
// `.raw()` do Joi compra, e o único jeito de provar é ir ao banco: o schema
// sozinho prova que a string sai string, e não que o Postgres a gravou inteira.
describe('o dia digitado é o dia gravado', () => {
  test('a data de início chega ao banco sem perder um dia por fuso', async () => {
    const bem = await criarBem()

    await request(app)
      .post('/api/equipamento/indisponibilidade')
      .set('Authorization', admin())
      .send({
        equipamento_id: bem,
        data_inicio: '2026-05-11',
        previsao_retorno: '2026-12-31',
        motivo: 'Erro de firmware'
      })

    const linha = await conn.one(
      `SELECT data_inicio::text AS data_inicio,
              previsao_retorno::text AS previsao_retorno
         FROM equipamento.indisponibilidade WHERE equipamento_id = $1`,
      [bem]
    )

    expect(linha.data_inicio).toBe('2026-05-11')
    expect(linha.previsao_retorno).toBe('2026-12-31')
  })

  test('a data de entrada em carga do bem também', async () => {
    const tipoId = await criarTipo('Estação Total')

    await request(app)
      .post('/api/equipamento')
      .set('Authorization', admin())
      .send({
        nr_patrimonio: '104820700014462',
        classe_id: CLASSE_SUPRIMENTO.VI,
        tipo_id: tipoId,
        modelo: 'TOPCON CTS-3007',
        secao_detentora_id: SECAO_DETENTORA.CIA_LEV,
        data_entrada_carga: '2014-07-29'
      })

    const linha = await conn.one(
      `SELECT data_entrada_carga::text AS data
         FROM equipamento.equipamento WHERE nr_patrimonio = '104820700014462'`
    )
    expect(linha.data).toBe('2014-07-29')
  })
})
