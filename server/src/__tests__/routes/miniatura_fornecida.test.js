'use strict'

/**
 * A MINIATURA QUE NÃO SE RENDERIZA ENTRA PELA PORTA, e sai pelo mesmo funil da
 * renderizada.
 *
 * O CASO REAL, medido em 2026-08-31. O acervo tinha 4.905 miniaturas e ZERO em
 * Modelo 3D e Panorâmica 360, e não era falha da varredura: ela renderiza `pdf`,
 * `tif`, `tiff`, `img` e `ecw`, e os arquivos desses dois tipos são `.3dtiles`,
 * `.db` e `.zip`. Nenhum se renderiza, então as 140 versões nunca foram
 * candidatas. A imagem deles só pode vir de captura feita por gente, e não havia
 * por onde entrar.
 *
 * O QUE ESTES TESTES FIXAM, e cada um existe por uma decisão:
 *
 * - a imagem enviada passa pelo `finalizar` do `utils/miniatura`, o mesmo da
 *   renderizada. Guardar o byte como veio deixaria a tabela com dois padrões de
 *   imagem, um por porta de entrada, e a ficha mostraria formatos diferentes sem
 *   que nada acusasse. O teste cobra o formato de SAÍDA, não o de entrada;
 * - `arquivo_id` fica NULO e o `checksum_origem` é o da imagem enviada. É o que
 *   distingue a linha fornecida da gerada, e a varredura não disputa a linha
 *   porque ela só escolhe versão com arquivo renderizável;
 * - reenviar SUBSTITUI, pelo `ON CONFLICT (versao_id)`;
 * - o que não é imagem é recusado pela ASSINATURA dos bytes, e não pela
 *   extensão: as duas coisas que o cliente manda (extensão e mimetype) não
 *   provam nada.
 */

const request = require('supertest')
const sharp = require('sharp')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData, closeConnection } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createProduto, createVersao } = require('../helpers/fixtures')
// O lado máximo e o formato saem do PRÓPRIO módulo, e não de um número
// digitado aqui: mudá-los lá é decisão legítima, e o teste tem de acompanhar
// em vez de virar falso alarme.
const { LADO_MAX, FORMATO } = require('../../utils/miniatura')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const admin = () => generateAdminToken()

/**
 * Um PNG de verdade, GERADO na hora, e não um base64 colado.
 *
 * A primeira versão deste teste trazia um blob base64, e ele abria no
 * `metadata()` do sharp e MORRIA na decodificação ("vipspng: libpng read
 * error"): cabeçalho válido, corpo truncado. O teste falhava por um motivo que
 * não era o testado, e o 400 legítimo escondia o defeito da fixtura. Gerar a
 * imagem com o mesmo sharp que o servidor usa remove a classe inteira de
 * engano.
 *
 * 900x600, e não 2x2: o `finalizar` REDUZ para o lado máximo do acervo, e uma
 * imagem menor que o alvo passaria pela redução sem mudar de tamanho, deixando
 * o teste incapaz de notar se a redução rodou.
 */
let PNG_GRANDE

beforeAll(async () => {
  PNG_GRANDE = await sharp({
    create: {
      width: 900, height: 600, channels: 3, background: { r: 20, g: 90, b: 160 }
    }
  }).png().toBuffer()
})

const versaoDeTeste = async () => {
  const produto = await createProduto()
  return createVersao(produto.id)
}

const enviar = (versaoId, buffer, nome = 'capa.png', tipo = 'image/png', token = admin()) =>
  request(app)
    .post(`/api/acervo/versao/${versaoId}/miniatura`)
    .set('Authorization', `Bearer ${token}`)
    .attach('arquivo', buffer, { filename: nome, contentType: tipo })

const linhaDe = versaoId => conn.oneOrNone(
  `SELECT versao_id, arquivo_id, checksum_origem, formato, largura, altura,
          erro, length(conteudo) AS bytes
     FROM acervo.miniatura_versao WHERE versao_id = $1`,
  [versaoId]
)

describe('a miniatura fornecida de uma versão', () => {
  test('grava, e sai no formato da miniatura renderizada, não no de entrada', async () => {
    const versao = await versaoDeTeste()

    const res = await enviar(versao.id, PNG_GRANDE)
    expect(res.status).toBe(200)

    const linha = await linhaDe(versao.id)
    expect(linha).not.toBeNull()
    // Entrou PNG e saiu no formato único do funil: quem decide é `finalizar`.
    expect(linha.formato).toBe(FORMATO)
    expect(linha.formato).not.toBe('png')
    expect(Number(linha.bytes)).toBeGreaterThan(0)
    // A REDUÇÃO RODOU: entrou 900x600 e saiu no lado máximo do acervo. Sem
    // isto o teste passaria mesmo que o `finalizar` fosse trocado por uma cópia
    // dos bytes de entrada.
    expect(linha.largura).toBe(LADO_MAX)
    expect(linha.largura).toBeLessThan(900)
    expect(linha.altura).toBeGreaterThan(0)
    expect(linha.erro).toBeNull()
  })

  test('arquivo_id fica NULO: é o que separa a fornecida da gerada', async () => {
    const versao = await versaoDeTeste()
    await enviar(versao.id, PNG_GRANDE)

    const linha = await linhaDe(versao.id)
    expect(linha.arquivo_id).toBeNull()
    // O checksum é o da IMAGEM ENVIADA, e não o de um arquivo do acervo.
    expect(linha.checksum_origem).toMatch(/^[0-9a-f]{64}$/)
  })

  test('a imagem volta pelo GET, e é a que ficou gravada', async () => {
    const versao = await versaoDeTeste()
    await enviar(versao.id, PNG_GRANDE)

    const res = await request(app)
      .get(`/api/acervo/versao/${versao.id}/miniatura`)
      .set('Authorization', `Bearer ${admin()}`)
      .buffer(true)
      .parse((r, cb) => {
        const pedacos = []
        r.on('data', p => pedacos.push(p))
        r.on('end', () => cb(null, Buffer.concat(pedacos)))
      })

    expect(res.status).toBe(200)
    const linha = await linhaDe(versao.id)
    expect(res.body.length).toBe(Number(linha.bytes))
  })

  test('reenviar SUBSTITUI, e não cria segunda linha', async () => {
    const versao = await versaoDeTeste()
    await enviar(versao.id, PNG_GRANDE)
    const primeira = await linhaDe(versao.id)

    await enviar(versao.id, PNG_GRANDE, 'outra.png')

    const { count } = await conn.one(
      'SELECT count(*)::int AS count FROM acervo.miniatura_versao WHERE versao_id = $1',
      [versao.id]
    )
    expect(count).toBe(1)
    const segunda = await linhaDe(versao.id)
    expect(segunda.checksum_origem).toBe(primeira.checksum_origem)
  })

  test('o que NÃO é imagem é recusado pela assinatura, mesmo com extensão de imagem', async () => {
    const versao = await versaoDeTeste()

    // Extensão e mimetype de imagem, conteúdo de texto: os dois campos que o
    // cliente controla dizem "png", e só o byte desmente.
    const res = await enviar(versao.id, Buffer.from('isto aqui nao e uma imagem'))

    expect(res.status).toBe(400)
    expect(await linhaDe(versao.id)).toBeNull()
  })

  test('extensão fora da lista nem chega ao controller', async () => {
    const versao = await versaoDeTeste()

    const res = await enviar(versao.id, PNG_GRANDE, 'capa.svg', 'image/svg+xml')

    expect(res.status).toBe(400)
    expect(await linhaDe(versao.id)).toBeNull()
  })

  test('versão inexistente responde 404 e não grava nada', async () => {
    const res = await enviar(999999999, PNG_GRANDE)
    expect(res.status).toBe(404)
  })

  test('sem perfil de operador o envio é recusado', async () => {
    const versao = await versaoDeTeste()

    const res = await enviar(
      versao.id, PNG_GRANDE, 'capa.png', 'image/png', generateUserToken()
    )

    expect([401, 403]).toContain(res.status)
    expect(await linhaDe(versao.id)).toBeNull()
  })
})
