'use strict'

// O RPCMTec de ponta a ponta, contra o banco de teste.
//
// O que este arquivo protege:
//
//  1. A GUARDA. O relatório cruza os três módulos e traz valor de crédito, de
//     empenho e de liquidação. Ele é admin-only, e já houve no repositório o
//     caso oposto -- uma rota fechada por engano numa classificação automática.
//     Aqui o risco é o inverso: alguém trocar `verifyAdmin` por um
//     `verifyPerfil('consulta', 'acervo')` e entregar o orçamento a quem só
//     cataloga carta.
//
//  2. A NUMERAÇÃO. Cada tabela é colável na subseção de mesmo número do
//     documento da Divisão. Uma subseção que muda de número, ou some, quebra o
//     encaixe sem dar erro nenhum.
//
//  3. QUE A TELA E O ARQUIVO SAEM DO MESMO LUGAR. A prévia JSON e o DOCX
//     chamam o mesmo `gerar()`; se um dia divergirem, quem confere o arquivo
//     contra a tela vê diferença onde não há.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

// O supertest NAO acumula corpo binario sozinho: sem isto, `res.body` chega
// como objeto vazio e a assercao de "e um ZIP" passa a testar nada.
const comoBinario = (req) => req
  .buffer()
  .parse((res, cb) => {
    const partes = []
    res.on('data', (p) => partes.push(p))
    res.on('end', () => cb(null, Buffer.concat(partes)))
  })

// A numeração do documento da Divisão, medida em "RPCM Técnico Julho_2026.docx".
// Só entram as subseções que o SCA preenche INTEIRAS; o que fica de fora está
// listado em server/src/rpcmtec/rpcmtec_ctrl.js, com o motivo de cada uma.
const SUBSECOES_ESPERADAS = [
  '2.2', '2.4', '2.7',
  '3.1', '3.2', '3.3', '3.4',
  '4.1', '4.2', '4.3', '4.4', '4.5', '4.6', '4.7',
  '7.2', '7.3'
]

describe('GET /api/rpcmtec/gerar', () => {
  test('devolve as seções na numeração do documento da Divisão', async () => {
    const res = await request(app)
      .get('/api/rpcmtec/gerar?ano=2026&mes=7')
      .set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    expect(res.body.dados).toMatchObject({ ano: 2026, mes: 7 })

    const numeros = res.body.dados.secoes.flatMap(s => s.subsecoes.map(x => x.numero))
    expect(numeros).toEqual(SUBSECOES_ESPERADAS)
  })

  test('os títulos de seção são os do documento, em maiúsculas', async () => {
    const res = await request(app)
      .get('/api/rpcmtec/gerar?ano=2026&mes=7')
      .set('Authorization', admin())

    expect(res.body.dados.secoes.map(s => s.titulo)).toEqual([
      '2. EXECUÇÃO DO PIT',
      '3. MAPOTECA',
      '4. EXECUÇÃO DO PDR',
      '7. EQUIPAMENTO E MATERIAL'
    ])
  })

  test('cada subseção tem cabeçalho, e toda linha tem uma célula por coluna', async () => {
    // Linha com menos células que colunas sai desalinhada no DOCX, e o Word
    // não reclama: a última coluna simplesmente fica vazia na tabela colada.
    const res = await request(app)
      .get('/api/rpcmtec/gerar?ano=2026&mes=7')
      .set('Authorization', admin())

    for (const secao of res.body.dados.secoes) {
      for (const sub of secao.subsecoes) {
        expect(sub.cabecalhos.length).toBeGreaterThan(0)
        expect(Array.isArray(sub.linhas)).toBe(true)
        for (const linha of sub.linhas) {
          expect(linha).toHaveLength(sub.cabecalhos.length)
        }
      }
    }
  })

  test('a 2.7 traz as quatro escalas nos dois tipos de produto', async () => {
    // Oito linhas: 1:25.000, 1:50.000, 1:100.000 e 1:250.000, para Carta
    // Topográfica e Carta Ortoimagem. É a forma da tabela no documento, e ela
    // não depende de haver produto cadastrado.
    const res = await request(app)
      .get('/api/rpcmtec/gerar?ano=2026&mes=7')
      .set('Authorization', admin())

    const estadoAcervo = res.body.dados.secoes
      .flatMap(s => s.subsecoes)
      .find(s => s.numero === '2.7')

    expect(estadoAcervo.linhas).toHaveLength(8)
    expect(estadoAcervo.linhas.map(l => l[1])).toEqual([
      ...Array(4).fill('Carta Topográfica'),
      ...Array(4).fill('Carta Ortoimagem')
    ])
    // A escala sai SEM o "1:", como o documento escreve.
    expect(estadoAcervo.linhas.map(l => l[0])).toEqual([
      '25.000', '50.000', '100.000', '250.000',
      '25.000', '50.000', '100.000', '250.000'
    ])
  })

  test('a 3.1 traz os sete indicadores do documento, na ordem dele', async () => {
    const res = await request(app)
      .get('/api/rpcmtec/gerar?ano=2026&mes=7')
      .set('Authorization', admin())

    const totais = res.body.dados.secoes
      .flatMap(s => s.subsecoes)
      .find(s => s.numero === '3.1')

    expect(totais.linhas.map(l => l[0])).toEqual([
      'Mapoteca - produtos entregues',
      'Mapoteca - quantidade de pedidos',
      'Mapoteca - OM atendidas',
      'LAI e órgãos públicos - produtos entregues',
      'LAI e órgãos públicos - quantidade de pedidos',
      'Extra-PIT - produtos entregues',
      'Extra-PIT - número de solicitações'
    ])
  })

  test('a 4.1 tem uma linha por natureza de despesa, e nenhuma de TOTAL', async () => {
    // O documento da Divisão NÃO tem linha de total na 4.1. Quem precisa dela é
    // o painel do orçamento, que tem rota própria por causa disso.
    const res = await request(app)
      .get('/api/rpcmtec/gerar?ano=2026&mes=7')
      .set('Authorization', admin())

    const execucao = res.body.dados.secoes
      .flatMap(s => s.subsecoes)
      .find(s => s.numero === '4.1')

    const { rows } = await conn.result('SELECT code FROM dominio.natureza_despesa')
    expect(execucao.linhas).toHaveLength(rows.length)
    expect(execucao.linhas.map(l => l[0])).not.toContain('TOTAL')
  })

  test('valor sem nenhum documento sai como traço, e não como zero', async () => {
    // Na 4.1, '-' quer dizer "não há documento nenhum nesta ND" e '0,00' quer
    // dizer "há, e somam zero". Com o banco de teste vazio, tudo é traço --
    // menos o previsto, que vem do PDR e é zero de verdade.
    const res = await request(app)
      .get('/api/rpcmtec/gerar?ano=2026&mes=7')
      .set('Authorization', admin())

    const execucao = res.body.dados.secoes
      .flatMap(s => s.subsecoes)
      .find(s => s.numero === '4.1')

    const primeira = execucao.linhas[0]
    expect(primeira[1]).toBe('0,00')
    expect(primeira.slice(2)).toEqual(['-', '-', '-', '-'])
  })

  test('exige ano e mês, e recusa mês fora de 1..12', async () => {
    const semNada = await request(app)
      .get('/api/rpcmtec/gerar')
      .set('Authorization', admin())
    expect(semNada.status).toBe(400)

    const mesInvalido = await request(app)
      .get('/api/rpcmtec/gerar?ano=2026&mes=13')
      .set('Authorization', admin())
    expect(mesInvalido.status).toBe(400)
  })
})

describe('GET /api/rpcmtec/gerar/docx', () => {
  test('devolve o .docx como anexo, e não o envelope JSON', async () => {
    const res = await comoBinario(request(app)
      .get('/api/rpcmtec/gerar/docx?ano=2026&mes=7')
      .set('Authorization', admin()))

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('wordprocessingml.document')
    expect(res.headers['content-disposition']).toContain('RPCMTec-2026-07.docx')
    // Um .docx é um ZIP: começa com 'PK'.
    expect(res.body.subarray(0, 2).toString()).toBe('PK')
  })
})

describe('GET /api/rpcmtec/anuario', () => {
  test('devolve os dois blocos com as linhas de total', async () => {
    const res = await request(app)
      .get('/api/rpcmtec/anuario?ano=2026&mes=7')
      .set('Authorization', admin())

    expect(res.status).toBe(200)
    expect(res.body.dados.total_convencional.rotulo).toBe('Total (Convencional)')
    expect(res.body.dados.total_digital.rotulo).toBe('Total (Digital)')
    expect(res.body.dados.convencional).toHaveLength(18)
    expect(res.body.dados.digital).toHaveLength(16)
    // As lacunas viajam com o dado: o rodapé do arquivo e a tela as declaram.
    expect(res.body.dados.lacunas.length).toBeGreaterThan(0)
  })

  test('o .ods sai da planilha-semente, com o nome que a DSG recebe', async () => {
    const res = await comoBinario(request(app)
      .get('/api/rpcmtec/anuario/ods?ano=2026&mes=7')
      .set('Authorization', admin()))

    expect(res.status).toBe(200)
    expect(res.headers['content-type']).toContain('opendocument.spreadsheet')
    expect(res.headers['content-disposition'])
      .toContain('Anuario_Estatistico_1CGEO_07_Julho_2026.ods')
    expect(res.body.subarray(0, 2).toString()).toBe('PK')
  })
})

describe('RPCMTec: a guarda', () => {
  // O relatório traz valor de crédito, de empenho e de liquidação dos três
  // módulos. Não existe "perfil de RPCMTec" porque não existe módulo RPCMTec:
  // ele é rota de PLATAFORMA, como usuários. Quem o gera administra o sistema.
  const rotas = [
    '/api/rpcmtec/gerar?ano=2026&mes=7',
    '/api/rpcmtec/gerar/docx?ano=2026&mes=7',
    '/api/rpcmtec/anuario?ano=2026&mes=7',
    '/api/rpcmtec/anuario/ods?ano=2026&mes=7',
    '/api/rpcmtec'
  ]

  test.each(rotas)('%s recusa quem não é administrador', async (rota) => {
    const res = await request(app).get(rota).set('Authorization', generateUserToken())
    expect(res.status).toBe(403)
  })

  test.each(rotas)('%s recusa quem não está logado', async (rota) => {
    const res = await request(app).get(rota)
    expect(res.status).toBe(401)
  })
})

describe('RPCMTec: a edição mensal', () => {
  test('cria, lê, atualiza e apaga', async () => {
    const criada = await request(app)
      .post('/api/rpcmtec')
      .set('Authorization', admin())
      .send({ ano: 2026, mes: 7, assinante: 'Maj Diniz', data_assinatura: '2026-08-01' })
    expect(criada.status).toBe(201)

    const id = criada.body.dados.id

    const lida = await request(app)
      .get(`/api/rpcmtec/${id}`)
      .set('Authorization', admin())
    expect(lida.status).toBe(200)
    expect(lida.body.dados).toMatchObject({ ano: 2026, mes: 7, assinante: 'Maj Diniz' })

    const atualizada = await request(app)
      .put(`/api/rpcmtec/${id}`)
      .set('Authorization', admin())
      .send({ ano: 2026, mes: 7, assinante: 'Ten Cel Fulano', data_assinatura: null })
    expect(atualizada.status).toBe(200)

    const apagada = await request(app)
      .delete(`/api/rpcmtec/${id}`)
      .set('Authorization', admin())
    expect(apagada.status).toBe(200)

    const sumiu = await request(app)
      .get(`/api/rpcmtec/${id}`)
      .set('Authorization', admin())
    expect(sumiu.status).toBe(404)
  })

  test('recusa duas edições do mesmo mês com 409, e não com 500', async () => {
    // Duas edições do mesmo mês seriam duas verdades sobre o mesmo mês, e nada
    // diria qual foi a assinada. Quem barra é a UNIQUE (ano, mes); o que este
    // teste protege é a TRADUÇÃO dela numa mensagem que diz o que houve.
    const corpo = { ano: 2026, mes: 8, assinante: 'Maj Diniz' }

    const primeira = await request(app)
      .post('/api/rpcmtec').set('Authorization', admin()).send(corpo)
    expect(primeira.status).toBe(201)

    const segunda = await request(app)
      .post('/api/rpcmtec').set('Authorization', admin()).send(corpo)
    expect(segunda.status).toBe(409)
    expect(segunda.body.message).toMatch(/já existe/i)
  })

  test('a listagem aceita filtro por ano', async () => {
    await request(app).post('/api/rpcmtec').set('Authorization', admin())
      .send({ ano: 2025, mes: 1 })
    await request(app).post('/api/rpcmtec').set('Authorization', admin())
      .send({ ano: 2026, mes: 1 })

    const todas = await request(app).get('/api/rpcmtec').set('Authorization', admin())
    expect(todas.body.dados).toHaveLength(2)

    const de2026 = await request(app).get('/api/rpcmtec?ano=2026').set('Authorization', admin())
    expect(de2026.body.dados).toHaveLength(1)
    expect(de2026.body.dados[0].ano).toBe(2026)
  })
})
