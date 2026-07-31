'use strict'

const {
  argumentosDeCor,
  precisaEsticar,
  podeGerar
} = require('../../../utils/miniatura')

// As sete formas de raster medidas no acervo em 2026-07-31, sobre os 292
// arquivos que o gerador escolhe. Testar sobre elas, e nao sobre um caso
// inventado, e o que faz o teste valer alguma coisa.
const RGB_JPEG = { bands: [
  { type: 'Byte', colorInterpretation: 'Red' },
  { type: 'Byte', colorInterpretation: 'Green' },
  { type: 'Byte', colorInterpretation: 'Blue' }
] }
const PALETA = { bands: [{ type: 'Byte', colorInterpretation: 'Palette' }] }
const RGBA = { bands: [
  { type: 'Byte', colorInterpretation: 'Red' },
  { type: 'Byte', colorInterpretation: 'Green' },
  { type: 'Byte', colorInterpretation: 'Blue' },
  { type: 'Byte', colorInterpretation: 'Alpha' }
] }
const CINZA = { bands: [{ type: 'Byte', colorInterpretation: 'Gray' }] }
const ELEVACAO = { bands: [{ type: 'Float32', colorInterpretation: 'Gray' }] }

describe('miniatura: que extensões rendem imagem', () => {
  it('aceita PDF e os rasters que o GDAL abre', () => {
    for (const e of ['pdf', 'PDF', 'tif', 'tiff', 'img', 'ecw']) {
      expect(podeGerar(e)).toBe(true)
    }
  })

  // Produto só vetorial não tem raster para renderizar, e por decisão do chefe
  // não entra. A lista existe para não gastar um processo do GDAL em cada um.
  it('recusa o vetorial e o que não é imagem', () => {
    for (const e of ['zip', 'sqlite', 'xml', 'json', 'qpt', '', null, undefined]) {
      expect(podeGerar(e)).toBe(false)
    }
  })

  // O `.tif.ovr` é a pirâmide do GDAL, cadastrada como arquivo próprio. Ela não
  // pode ser escolhida como fonte: o GDAL a encontra sozinha ao lado do `.tif`.
  it('recusa a pirâmide .tif.ovr', () => {
    expect(podeGerar('tif.ovr')).toBe(false)
  })
})

describe('miniatura: quando o raster precisa ser esticado', () => {
  it('uma banda que não é de 8 bits guarda medida, não intensidade', () => {
    expect(precisaEsticar(ELEVACAO)).toBe(true)
  })

  it('banda de 8 bits já é intensidade de pixel', () => {
    expect(precisaEsticar(CINZA)).toBe(false)
    expect(precisaEsticar(PALETA)).toBe(false)
    expect(precisaEsticar(RGB_JPEG)).toBe(false)
  })
})

describe('miniatura: argumentos de cor do gdal_translate', () => {
  it('RGB e RGBA tomam as três primeiras bandas', () => {
    expect(argumentosDeCor(RGB_JPEG)).toEqual(['-b', '1', '-b', '2', '-b', '3'])
    expect(argumentosDeCor(RGBA)).toEqual(['-b', '1', '-b', '2', '-b', '3'])
  })

  // Sem -expand, a carta paletada sai em tom de cinza, com as cores viradas em
  // cinza sem sentido.
  it('paletado expande para RGB', () => {
    expect(argumentosDeCor(PALETA)).toEqual(['-expand', 'rgb'])
  })

  it('cinza de 8 bits vai como está', () => {
    expect(argumentosDeCor(CINZA)).toEqual([])
  })

  // O DEFEITO que este teste fixa: um MDT com altitude de 193 a 735 m, sem
  // esticamento, tinha toda cota acima de 255 cortada em branco, e a miniatura
  // saía vazia (2 KB). O intervalo é média ± 2,5 desvios, preso ao mínimo e ao
  // máximo reais.
  it('elevação estica pela média mais ou menos 2,5 desvios', () => {
    const stats = { minimum: 193.5, maximum: 735.2, mean: 571.8, stdDev: 90 }
    const args = argumentosDeCor(ELEVACAO, stats)

    expect(args.slice(0, 3)).toEqual(['-ot', 'Byte', '-scale'])
    const [menor, maior] = [Number(args[3]), Number(args[4])]
    expect(menor).toBeCloseTo(346.8, 1)   // média - 2,5 desvios
    expect(maior).toBeCloseTo(735.2, 1)   // presa ao máximo real
    expect(args.slice(5)).toEqual(['0', '255'])
  })

  // O recorte por desvio existe para um pico isolado não achatar todo o relevo:
  // aqui o máximo é um valor absurdo, e o esticamento tem de ignorá-lo.
  it('um pico isolado não achata o resto do relevo', () => {
    const stats = { minimum: 200, maximum: 9999, mean: 400, stdDev: 50 }
    const args = argumentosDeCor(ELEVACAO, stats)

    expect(Number(args[4])).toBe(525)   // média + 2,5 desvios, e não 9999
  })

  // Terreno plano (desvio zero) ou estatística ausente: o -scale sem números
  // manda o GDAL usar o mínimo e o máximo do próprio raster. Continua melhor
  // que cortar em 255.
  it('sem estatística utilizável, deixa o GDAL decidir o intervalo', () => {
    expect(argumentosDeCor(ELEVACAO, null)).toEqual(['-ot', 'Byte', '-scale'])
    expect(argumentosDeCor(ELEVACAO, { minimum: 5, maximum: 5, mean: 5, stdDev: 0 }))
      .toEqual(['-ot', 'Byte', '-scale'])
  })
})
