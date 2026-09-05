'use strict'

// O ARQUIVO DE 0 BYTE, E POR QUE ELE PRECISA MORRER ANTES DO PRIMEIRO CABECALHO.
//
// `enviarArquivoDoVolume` escreve `Content-Type`, `Content-Disposition:
// attachment`, `Accept-Ranges` e `Content-Length` e SO DEPOIS abre o fluxo. Sem
// cabecalho `Range`, o fim da faixa e `tamanho - 1`; num arquivo vazio isso e
// `-1`, e `fs.createReadStream(caminho, { end: -1 })` lanca SINCRONO
// (`ERR_OUT_OF_RANGE`). O lanco acontece dentro do executor da Promise, entao
// ela rejeita, o `asyncHandler` entrega ao `errorHandler`, e como
// `res.headersSent` ainda e falso o Express responde o JSON de 500 -- COM o
// `Content-Disposition: attachment` que ja estava no `res`. O navegador salva o
// texto do erro num arquivo com o nome do arquivo do acervo, e quem baixou
// acredita ter o produto.
//
// Um stub de 0 byte nasce de copia SMB interrompida ou de envio de arquivo
// vazio, e o registro no banco nao sabe disso: quem sabe e o volume.
//
// Teste do pacote rapido: arquivo temporario de verdade, `res` de mentira,
// nenhum banco.

const fs = require('fs')
const os = require('os')
const path = require('path')
const { PassThrough } = require('stream')

const { enviarArquivoDoVolume } = require('../../../utils/enviar_arquivo')
const AppError = require('../../../utils/app_error')

let pasta

beforeAll(() => {
  pasta = fs.mkdtempSync(path.join(os.tmpdir(), 'sap-envio-'))
})

afterAll(() => {
  fs.rmSync(pasta, { recursive: true, force: true })
})

/** Um `res` que registra cabecalho e ainda assim aceita `pipe`. */
const resDeMentira = () => {
  const res = new PassThrough()
  res.setHeader = jest.fn()
  res.status = jest.fn()
  return res
}

const cabecalhosPostos = res => res.setHeader.mock.calls.map(([nome]) => nome)

describe('enviarArquivoDoVolume: arquivo vazio no volume', () => {
  test('recusa com 404 e a frase que diz que o arquivo está VAZIO', async () => {
    const caminho = path.join(pasta, 'carta_vazia.tif')
    fs.writeFileSync(caminho, '')

    const res = resDeMentira()
    const alvo = enviarArquivoDoVolume(
      { headers: {} },
      res,
      { caminho, nome: 'carta_vazia.tif' }
    )

    await expect(alvo).rejects.toThrow(AppError)
    // A frase separa este caso do "não foi encontrado no volume": o arquivo
    // ESTÁ lá, e é isso que confunde quem for procurar o defeito.
    await expect(alvo).rejects.toThrow(
      'O arquivo está registrado mas está vazio no volume: carta_vazia.tif'
    )
    await alvo.catch(erro => expect(erro.statusCode).toBe(404))
  })

  test('nenhum cabeçalho foi escrito, então o erro sai como JSON e não como anexo', async () => {
    const caminho = path.join(pasta, 'outra_vazia.tif')
    fs.writeFileSync(caminho, '')

    const res = resDeMentira()
    await expect(
      enviarArquivoDoVolume({ headers: {} }, res, { caminho, nome: 'outra_vazia.tif' })
    ).rejects.toThrow(AppError)

    // Esta é a asserção que guarda a POSIÇÃO da guarda, e não só a existência
    // dela: movida para depois dos `setHeader`, o caso fica vermelho aqui.
    expect(res.setHeader).not.toHaveBeenCalled()
    expect(cabecalhosPostos(res)).not.toContain('Content-Disposition')
  })

  // O contraste: a guarda recusa o VAZIO, e não o arquivo pequeno.
  test('o arquivo de 1 byte continua saindo como anexo, inteiro', async () => {
    const caminho = path.join(pasta, 'minima.txt')
    fs.writeFileSync(caminho, 'x')

    const res = resDeMentira()
    const pedacos = []
    res.on('data', p => pedacos.push(p))

    const resultado = await enviarArquivoDoVolume(
      { headers: {} },
      res,
      { caminho, nome: 'minima.txt' }
    )

    expect(resultado).toEqual({ bytes: 1, parcial: false })
    expect(Buffer.concat(pedacos).toString()).toBe('x')
    expect(cabecalhosPostos(res)).toContain('Content-Disposition')
    expect(res.setHeader).toHaveBeenCalledWith('Content-Length', '1')
  })
})
