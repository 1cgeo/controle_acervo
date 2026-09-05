'use strict'

// `GET /api/arquivo/upload-web/teto`: o teto do envio pelo navegador, publicado.
//
// POR QUE A ROTA EXISTE. A tela do assistente de upload dizia "arquivo muito
// grande continua entrando pelo plugin do QGIS" sem dizer o que e grande, porque
// o numero (`UPLOAD_WEB_MAX_GB`, default 2) morava so no servidor e nenhuma rota
// o publicava. Quem escolhia um arquivo de 6 GB via "1 arquivo, 6.00 GB" sem
// marca nenhuma, apertava Enviar e esperava a subida inteira para tomar a recusa
// -- no pior caso como "Falha de rede durante o envio", que manda tentar de novo
// exatamente o que nunca vai passar.
//
// O QUE ESTE ARQUIVO PRENDE, e as duas coisas juntas:
//
//   1. o CONTRATO, que a tela consome: `dados.max_gb`, NUMERO, dentro do
//      envelope do `sendJsonAndLog`. Trocar o nome do campo ou devolver texto
//      quebra a tela em silencio, porque a comparacao com o tamanho do arquivo
//      viraria comparacao com string.
//   2. que o numero e o MESMO que o multer aplica -- ele sai de `tetoEmGb()`,
//      do proprio `upload_web.js`, e nao de uma segunda leitura do `config`.
//      Duas leituras divergiriam e a tela prometeria um limite enquanto o
//      servidor recusaria por outro.
//
// PACOTE RAPIDO. A rota nao toca banco: `verifyPerfil` toca, e por isso o
// `../../login` entra dublado, no molde dos testes de rota do orcamento. A
// GUARDA EM SI NAO SE PROVA AQUI, e nem poderia: quem a prova contra o banco de
// verdade e o teste de rota do pacote lento.

const { createMockDb } = require('../helpers/orcamento/mockDb')

const mockDb = createMockDb()
jest.mock('../../database', () => ({
  db: mockDb,
  databaseVersion: { nome: '1.0.0', load: jest.fn() }
}))
jest.mock('../../login', () => require('../helpers/orcamento/mockLogin'))

const request = require('supertest')
const { buildTestApp } = require('../helpers/orcamento/testApp')

const config = require('../../config')
const arquivoRoute = require('../../arquivo/arquivo_route')
const { tetoEmGb } = require('../../arquivo/upload_web')

const app = buildTestApp([{ path: '/api/arquivo', router: arquivoRoute }])

const pedirTeto = () => request(app).get('/api/arquivo/upload-web/teto')

beforeEach(() => mockDb.reset())

describe('GET /api/arquivo/upload-web/teto', () => {
  it('devolve max_gb como NUMERO, no envelope de sempre', async () => {
    const res = await pedirTeto()

    expect(res.status).toBe(200)
    expect(res.body.success).toBe(true)
    // `typeof`, e nao `toBe(2)`: a instalacao pode ter outro
    // `UPLOAD_WEB_MAX_GB`, e o que a tela precisa e que de para comparar com o
    // tamanho do arquivo sem converter.
    expect(typeof res.body.dados.max_gb).toBe('number')
    expect(res.body.dados.max_gb).toBeGreaterThan(0)
  })

  it('publica o MESMO numero que o multer aplica', async () => {
    const res = await pedirTeto()

    expect(res.body.dados.max_gb).toBe(tetoEmGb())
    expect(res.body.dados.max_gb).toBe(Number(config.UPLOAD_WEB_MAX_GB))
  })

  // A mensagem carrega o numero: o log da requisicao e a resposta dizem a mesma
  // coisa, e quem depura pela mensagem nao precisa abrir o corpo.
  it('a mensagem cita o teto', async () => {
    const res = await pedirTeto()

    expect(res.body.message).toContain(String(tetoEmGb()))
  })

  // ROTA LITERAL, e ela vem ANTES das tres `/upload-web/*`. O Express casa na
  // ordem de declaracao: um `/upload-web/:algo` declarado antes engoliria
  // `teto`, e a leitura cairia no envio. Prende-se a ORDEM no fonte, porque com
  // as rotas de hoje (todas literais) nenhuma requisicao revela a inversao.
  it('e declarada antes de qualquer /upload-web com parametro', () => {
    const fonte = require('fs').readFileSync(
      require('path').join(__dirname, '../../arquivo/arquivo_route.js'), 'utf8'
    )

    const teto = fonte.indexOf("'/upload-web/teto'")
    expect(teto).toBeGreaterThan(-1)

    const comParametro = [...fonte.matchAll(/'\/upload-web\/:[^']*'/g)].map(m => m.index)
    for (const posicao of comParametro) {
      expect(posicao).toBeGreaterThan(teto)
    }

    // E antes das tres literais de envio tambem, que e onde ela esta escrita.
    expect(fonte.indexOf("'/upload-web/produto'")).toBeGreaterThan(teto)
  })
})
