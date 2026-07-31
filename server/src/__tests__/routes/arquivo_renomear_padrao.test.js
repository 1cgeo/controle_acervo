'use strict'

// Renome para o nome fisico padrao.
//
// Estes testes cobrem so o dry_run, de proposito: e o modo que nao toca disco, e
// o que precisa ser provado aqui e a SELECAO dos arquivos, nao o `fs.rename`. A
// selecao e a mesma consulta do invariante 7a, e as duas tem de concordar. Um
// arquivo que o 7a isenta e o renome move seria a pior combinacao possivel: o
// auditor calado enquanto o escritor quebra o byte.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createProduto, createVersao, createArquivo, createVolume } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const planejar = (body = {}) =>
  request(app)
    .post('/api/arquivo/renomear-padrao')
    .set('Authorization', generateAdminToken())
    .send({ dry_run: true, motivo: 'teste de selecao', ...body })

// Cria um arquivo com nome fora do padrao derivado, no volume indicado.
const arquivoForaDoPadrao = async (volumeId, mi) => {
  const produto = await createProduto({ mi, inom: `INOM-${mi}` })
  const versao = await createVersao(produto.id)
  return createArquivo(versao.id, {
    volume_armazenamento_id: volumeId,
    nome_arquivo: `LOTE_1/IMAGENS/Ortoimagem_MI ${mi}`,
    extensao: 'img'
  })
}

describe('POST /api/arquivo/renomear-padrao', () => {
  it('should require admin', async () => {
    const semToken = await request(app)
      .post('/api/arquivo/renomear-padrao')
      .send({ dry_run: true, motivo: 'sem token' })
    expect(semToken.status).toBe(401)

    const comum = await request(app)
      .post('/api/arquivo/renomear-padrao')
      .set('Authorization', generateUserToken())
      .send({ dry_run: true, motivo: 'sem permissao' })
    expect(comum.status).toBe(403)
  })

  it('should plan the rename of an off-pattern name on an ordinary volume', async () => {
    const antes = (await planejar()).body.dados.divergentes_total

    const comum = await createVolume({
      nome: 'Volume Comum Renome',
      volume: '/data/comum-renome',
      layout_origem: false
    })
    const arquivo = await arquivoForaDoPadrao(comum.id, '4444-1')

    const res = await planejar()

    expect(res.status).toBe(200)
    expect(res.body.dados.dry_run).toBe(true)
    expect(res.body.dados.divergentes_total).toBe(antes + 1)
    expect(res.body.dados.amostra.map(a => Number(a.id))).toContain(Number(arquivo.id))
  })

  // O caso do Convenio RS. Renomear o .img quebra a referencia interna ao .ige,
  // onde estao todos os pixels, e nenhuma auditoria posterior pega isso. O volume
  // declara que guarda o layout do fornecedor e a rota passa longe dele.
  it('should never touch a volume that keeps the supplier layout', async () => {
    const antes = (await planejar()).body.dados.divergentes_total

    const origem = await createVolume({
      nome: 'Entregas Convenio Renome',
      volume: '/data/entregas-renome',
      layout_origem: true
    })
    const arquivo = await arquivoForaDoPadrao(origem.id, '4444-2')

    const res = await planejar()

    expect(res.body.dados.divergentes_total).toBe(antes)
    expect(res.body.dados.amostra.map(a => Number(a.id))).not.toContain(Number(arquivo.id))
  })

  // Pedir o arquivo pelo id NAO fura a excecao. Sem isto, a marca protegeria a
  // varredura em massa e deixaria passar a chamada dirigida, que e justamente a
  // que alguem faz "para resolver aquele arquivo ali".
  it('should keep the exemption even when the file is asked for by id', async () => {
    const origem = await createVolume({
      nome: 'Entregas Convenio Por Id',
      volume: '/data/entregas-por-id',
      layout_origem: true
    })
    const arquivo = await arquivoForaDoPadrao(origem.id, '4444-3')

    const res = await planejar({ arquivo_ids: [Number(arquivo.id)] })

    expect(res.status).toBe(200)
    expect(res.body.dados.divergentes_total).toBe(0)
    expect(res.body.dados.nesta_chamada).toBe(0)
  })
})
