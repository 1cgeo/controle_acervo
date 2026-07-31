'use strict'

// Auditoria dos invariantes lógicos do acervo.
//
// Estes testes rodam as 33 consultas contra o PostGIS de teste. É o ponto: os
// invariantes vieram de um script do vault, onde nunca foram exercitados por
// teste nenhum, e onde uma coluna renomeada os quebraria em silêncio na próxima
// execução. Aqui, um `git mv` no schema derruba a suíte.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createProduto, createVersao, createArquivo, createVolume } = require('../helpers/fixtures')
const { INVARIANTES } = require('../../acervo/invariantes')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const auditar = (qs = '') =>
  request(app)
    .get('/api/acervo/auditoria' + qs)
    .set('Authorization', generateAdminToken())

describe('GET /api/acervo/auditoria', () => {
  it('should require admin', async () => {
    const semToken = await request(app).get('/api/acervo/auditoria')
    expect(semToken.status).toBe(401)

    const comum = await request(app)
      .get('/api/acervo/auditoria')
      .set('Authorization', generateUserToken())
    expect(comum.status).toBe(403)
  })

  // O teste que justifica ter trazido os invariantes para cá: cada um roda
  // contra o banco de verdade. SQL que não casa mais com o schema falha AQUI,
  // e não em produção seis meses depois.
  it('should run every invariant against the real database', async () => {
    const res = await auditar()

    expect(res.status).toBe(200)
    expect(res.body.dados).toHaveLength(INVARIANTES.length)

    const quebrados = res.body.dados.filter(d => d.erro)
    expect(quebrados.map(d => `${d.codigo}: ${d.erro}`)).toEqual([])
  })

  it('should return codigo, severidade, titulo and total for each', async () => {
    const res = await auditar()

    for (const d of res.body.dados) {
      expect(typeof d.codigo).toBe('string')
      expect(['DEFECT', 'REVISAR', 'INFO']).toContain(d.severidade)
      expect(typeof d.titulo).toBe('string')
      expect(typeof d.total).toBe('number')
    }
  })

  it('should filter by severidade', async () => {
    const res = await auditar('?severidade=DEFECT')

    expect(res.status).toBe(200)
    expect(res.body.dados.every(d => d.severidade === 'DEFECT')).toBe(true)
    expect(res.body.dados.length).toBeLessThan(INVARIANTES.length)
  })

  it('should filter by codigos', async () => {
    const res = await auditar('?codigos=2c,4a')

    expect(res.status).toBe(200)
    expect(res.body.dados.map(d => d.codigo).sort()).toEqual(['2c', '4a'])
  })

  // Código inventado que devolvesse 200 com lista vazia se leria como "nada a
  // auditar", que é o oposto de "você pediu um invariante que não existe".
  it('should reject an unknown codigo instead of returning nothing', async () => {
    const res = await auditar('?codigos=9z')
    expect(res.status).toBe(400)
  })

  it('should reject an unknown severidade', async () => {
    const res = await auditar('?severidade=GRAVE')
    expect(res.status).toBe(400)
  })

  // 2c = produto SEM nenhuma versão (órfão). É o invariante mais fácil de
  // provocar, e prova que a auditoria enxerga dado de verdade.
  it('should actually catch a defect (2c: produto sem versao)', async () => {
    const limpo = await auditar('?codigos=2c')
    const antes = limpo.body.dados[0].total

    const orfao = await createProduto({ mi: '9999-1', inom: 'ORFAO-TESTE' })

    const depois = await auditar('?codigos=2c')
    expect(depois.body.dados[0].total).toBe(antes + 1)
    expect(depois.body.dados[0].amostra.map(r => Number(r.id))).toContain(Number(orfao.id))
  })

  // 3c (data_edicao < data_criacao) NAO consegue ser provocado: acervo.versao
  // tem CHECK (data_edicao >= data_criacao). Descobrimos isso ao trazer os
  // invariantes do vault, tentando violar um deles pela primeira vez. O
  // invariante fica como rede caso a constraint caia numa migração, e este
  // teste documenta por que ele vive em zero.
  it('cannot be violated: the database itself refuses an inverted date pair (3c)', async () => {
    const p = await createProduto({ mi: '9999-2' })

    await expect(
      createVersao(p.id, {
        data_criacao: '2026-06-15T12:00:00-03:00',
        data_edicao: '2026-05-01T12:00:00-03:00'
      })
    ).rejects.toThrow(/versao_check/)

    const res = await auditar('?codigos=3c')
    expect(res.body.dados[0].total).toBe(0)
  })

  it('should cap the amostra and say when it truncated', async () => {
    for (let i = 0; i < 4; i++) await createProduto({ mi: `8888-${i}`, inom: `TRUNC-${i}` })

    const res = await auditar('?codigos=2c&amostra=2')
    const d = res.body.dados[0]

    expect(d.total).toBeGreaterThanOrEqual(4)
    expect(d.amostra).toHaveLength(2)
    expect(d.truncada).toBe(true)
  })

  it('should allow amostra=0 for the count alone', async () => {
    await createProduto({ mi: '7777-1', inom: 'SO-CONTAGEM' })

    const res = await auditar('?codigos=2c&amostra=0')
    expect(res.body.dados[0].total).toBeGreaterThan(0)
    expect(res.body.dados[0].amostra).toEqual([])
  })

  // 7a com layout_origem. O par de testes prova a exceção nos DOIS sentidos: o
  // mesmo arquivo, com o mesmo nome fora do padrão, conta num volume comum e não
  // conta num volume que guarda o layout do fornecedor. Um teste só do lado que
  // isenta passaria com o filtro escrito ao contrário.
  it('should count an off-pattern name on an ordinary volume (7a)', async () => {
    const antes = (await auditar('?codigos=7a')).body.dados[0].total

    const comum = await createVolume({
      nome: 'Volume Comum 7a',
      volume: '/data/comum-7a',
      layout_origem: false
    })
    const p = await createProduto({ mi: '5555-1', inom: 'PADRAO-COMUM' })
    const v = await createVersao(p.id)
    await createArquivo(v.id, {
      volume_armazenamento_id: comum.id,
      nome_arquivo: 'LOTE_1/IMAGENS/Ortoimagem_MI 5555-1',
      extensao: 'img'
    })

    expect((await auditar('?codigos=7a')).body.dados[0].total).toBe(antes + 1)
  })

  // O caso do Convênio RS: o .img do ERDAS guarda dentro de si o nome do .ige,
  // então renomear quebra o produto. O volume declara que guarda o layout de
  // origem e o invariante para de acusar. Ver
  // migrations/2026-07-31_volume_layout_origem.sql.
  it('should exempt a volume that keeps the supplier layout (7a)', async () => {
    const antes = (await auditar('?codigos=7a')).body.dados[0].total

    const origem = await createVolume({
      nome: 'Entregas Convenio',
      volume: '/data/entregas-convenio',
      layout_origem: true
    })
    const p = await createProduto({ mi: '5555-2', inom: 'LAYOUT-ORIGEM' })
    const v = await createVersao(p.id)
    await createArquivo(v.id, {
      volume_armazenamento_id: origem.id,
      nome_arquivo: 'LOTE_1/IMAGENS/Ortoimagem_MI 5555-2',
      extensao: 'img'
    })

    expect((await auditar('?codigos=7a')).body.dados[0].total).toBe(antes)
  })

  // A auditoria é leitura. Se algum invariante tentasse escrever, a transação
  // READ ONLY o derrubaria, e o teste acima ("nenhum quebrado") acusaria.
  it('should not change the data it audits', async () => {
    const p = await createProduto({ mi: '6666-1' })
    const v = await createVersao(p.id)
    await createArquivo(v.id)

    const antes = await request(app)
      .get(`/api/acervo/produto/${p.id}`)
      .set('Authorization', generateAdminToken())

    await auditar()

    const depois = await request(app)
      .get(`/api/acervo/produto/${p.id}`)
      .set('Authorization', generateAdminToken())

    expect(depois.body.dados).toEqual(antes.body.dados)
  })
})
