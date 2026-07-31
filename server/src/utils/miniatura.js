// Path: utils/miniatura.js
'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { randomUUID } = require('crypto')
const { execFile } = require('child_process')
const { promisify } = require('util')

const execFileAsync = promisify(execFile)

/**
 * Miniatura de uma versao do acervo: a imagem que a ficha do produto mostra.
 *
 * Renderiza a PAGINA INTEIRA do PDF, ou o TIF inteiro quando nao ha PDF. A
 * miniatura serve para RECONHECER a carta de relance (o desenho da folha, a
 * mancha urbana, o layout com legenda e articulacao), nunca para ler o texto
 * dela. Por isso a pagina toda, e nao um recorte da area do mapa: e o conjunto
 * que identifica o produto (chefe, 2026-07-31).
 *
 * DOIS BINARIOS EXTERNOS, E NENHUMA DEPENDENCIA NATIVA NOVA NO NODE.
 *   - PDF  -> `pdftoppm` (poppler). Ele sozinho renderiza, redimensiona e
 *             codifica o JPEG, entao nao entra biblioteca de imagem nenhuma.
 *   - TIF  -> `gdal_translate`. Ler um GeoTIFF de centenas de MB e o que o GDAL
 *             faz melhor que qualquer biblioteca de imagem generica, e ele ja e
 *             ferramenta de casa.
 * Os caminhos saem do ambiente (`MINIATURA_PDFTOPPM`, `MINIATURA_GDAL_TRANSLATE`
 * e `MINIATURA_GDALINFO`), com o nome no PATH como padrao. Sao configuracao, e
 * nao constante: em Windows o GDAL vive dentro do QGIS, e caminho de maquina
 * nao entra em arquivo versionado.
 *
 * O FORMATO E JPEG, e nao WebP ou PNG. O PNG de uma carta a 600 px passa de
 * 400 KB, porque a folha e cheia de detalhe fino e nao tem area chapada. O WebP
 * economizaria cerca de 30%, mas custaria um terceiro binario no caminho: nem o
 * poppler nem o driver JPEG do GDAL o escrevem direto. A conta nao paga.
 *
 * 600 px no lado maior sai de onde a imagem e consumida: um painel de cerca de
 * 300 px na ficha, dobrado para tela de alta densidade. Medido numa carta
 * topografica tipica: 82 KB por miniatura.
 */

// Lado maior da miniatura, em pixels. Ver o cabecalho para a origem do numero.
const LADO_MAX = 600
const QUALIDADE_JPEG = 72
const FORMATO = 'jpeg'

// Tempo maximo por arquivo. Um PDF tipico leva cerca de 2,5 s (leitura pela
// rede inclusa) e um GeoTIFF grande leva mais, entao o teto e generoso: ele
// existe para o lote nao travar para sempre num arquivo doente, nao para
// apertar o caso normal.
const TIMEOUT_MS = 180000

const binario = (chave, padrao) => process.env[chave] || padrao

/**
 * Largura e altura de um JPEG, lidas do proprio cabecalho.
 *
 * Existe para nao arrastar uma biblioteca de imagem so para descobrir dois
 * numeros que os binarios acima nao devolvem. Percorre os marcadores ate um
 * SOF, que e onde JPEG guarda as dimensoes.
 * @param {Buffer} buffer
 * @returns {{largura: number, altura: number}}
 */
const dimensoesJpeg = (buffer) => {
  if (buffer.length < 4 || buffer[0] !== 0xff || buffer[1] !== 0xd8) {
    throw new Error('A saida nao e um JPEG valido')
  }

  let i = 2
  while (i < buffer.length - 9) {
    if (buffer[i] !== 0xff) { i += 1; continue }

    const marcador = buffer[i + 1]

    // SOF0..SOF15 carregam as dimensoes. Fora da faixa ficam DHT (0xc4), JPG
    // (0xc8) e DAC (0xcc), que compartilham o prefixo e nao servem.
    const ehSOF = marcador >= 0xc0 && marcador <= 0xcf
      && marcador !== 0xc4 && marcador !== 0xc8 && marcador !== 0xcc

    if (ehSOF) {
      return {
        altura: buffer.readUInt16BE(i + 5),
        largura: buffer.readUInt16BE(i + 7)
      }
    }

    // Marcador sem carga (RSTn, SOI, EOI): anda dois bytes. Os demais trazem o
    // tamanho do segmento nos dois bytes seguintes.
    if ((marcador >= 0xd0 && marcador <= 0xd9) || marcador === 0x01) {
      i += 2
    } else {
      i += 2 + buffer.readUInt16BE(i + 2)
    }
  }

  throw new Error('JPEG sem marcador de dimensao')
}

/** Diretorio temporario proprio, para o lote poder rodar em paralelo. */
const criarTemporario = async () =>
  fs.promises.mkdtemp(path.join(os.tmpdir(), 'sca-miniatura-'))

const removerTemporario = async (dir) => {
  try {
    await fs.promises.rm(dir, { recursive: true, force: true })
  } catch {
    // Limpeza que falha nao invalida a miniatura ja gerada.
  }
}

const executar = async (comando, argumentos) => {
  try {
    return await execFileAsync(comando, argumentos, {
      timeout: TIMEOUT_MS,
      windowsHide: true,
      maxBuffer: 16 * 1024 * 1024
    })
  } catch (erro) {
    if (erro.code === 'ENOENT') {
      throw new Error(`Binario nao encontrado: ${comando}`)
    }
    if (erro.killed) {
      throw new Error(`${path.basename(comando)} estourou ${TIMEOUT_MS} ms`)
    }
    const detalhe = (erro.stderr || erro.message || '').toString().trim().slice(0, 400)
    throw new Error(`${path.basename(comando)} falhou: ${detalhe}`)
  }
}

/** Renderiza a primeira pagina do PDF. */
const renderizarPdf = async (caminho, dir) => {
  const prefixo = path.join(dir, 'saida')

  // -singlefile faz o nome ser exatamente <prefixo>.jpg, sem o sufixo de pagina
  // que o poppler acrescenta quando renderiza um intervalo.
  await executar(binario('MINIATURA_PDFTOPPM', 'pdftoppm'), [
    '-jpeg',
    '-jpegopt', `quality=${QUALIDADE_JPEG}`,
    '-scale-to', String(LADO_MAX),
    '-f', '1', '-l', '1',
    '-singlefile',
    caminho,
    prefixo
  ])

  return fs.promises.readFile(`${prefixo}.jpg`)
}

/**
 * Renderiza o TIF.
 *
 * Pergunta as dimensoes antes porque `-outsize` do GDAL nao tem "ajuste ao
 * maior lado": passar `600 0` fixa a LARGURA, e um TIF em retrato sairia com
 * 600 de largura e altura muito maior que isso.
 */
const renderizarTif = async (caminho, dir) => {
  const { stdout } = await executar(
    binario('MINIATURA_GDALINFO', 'gdalinfo'),
    ['-json', caminho]
  )

  const info = JSON.parse(stdout)
  const [largura, altura] = info.size || []
  if (!largura || !altura) throw new Error('gdalinfo nao devolveu o tamanho do raster')

  const bandas = info.bands || []
  const paleta = bandas.length === 1 && bandas[0].colorInterpretation === 'Palette'

  // Ajuste pelo maior lado, com zero deixando o GDAL calcular o outro.
  const escala = largura >= altura ? [String(LADO_MAX), '0'] : ['0', String(LADO_MAX)]

  // O driver JPEG aceita 1 banda (cinza) ou 3 (RGB). Raster paletado tem uma
  // banda com tabela de cor, e sem -expand sairia em cinza, com as cores da
  // carta viradas em tom de cinza sem sentido. Acima de 3 bandas (RGBA, ou
  // multiespectral) tomam-se as tres primeiras.
  const cor = paleta
    ? ['-expand', 'rgb']
    : bandas.length >= 3 ? ['-b', '1', '-b', '2', '-b', '3'] : []

  const saida = path.join(dir, 'saida.jpg')

  await executar(binario('MINIATURA_GDAL_TRANSLATE', 'gdal_translate'), [
    '-q',
    '-of', 'JPEG',
    '-outsize', ...escala,
    ...cor,
    '-co', `QUALITY=${QUALIDADE_JPEG}`,
    caminho,
    saida
  ])

  return fs.promises.readFile(saida)
}

/** Extensoes que rendem miniatura. Produto so vetorial nao entra. */
const EXTENSOES = new Set(['pdf', 'tif', 'tiff'])

const podeGerar = (extensao) =>
  EXTENSOES.has(String(extensao || '').toLowerCase())

/**
 * Gera a miniatura de UM arquivo do volume.
 *
 * Lanca quando nao consegue. Quem chama decide o que fazer com a falha; no
 * lote, ela vira linha de erro em `acervo.miniatura_versao`, para o arquivo
 * doente nao ser tentado de novo a cada execucao.
 *
 * @param {string} caminho caminho fisico ja resolvido (ver caminho_volume.js)
 * @param {string} extensao extensao do arquivo, sem ponto
 * @returns {Promise<{conteudo: Buffer, formato: string, largura: number, altura: number}>}
 */
const gerarMiniatura = async (caminho, extensao) => {
  const ext = String(extensao || '').toLowerCase()
  if (!podeGerar(ext)) {
    throw new Error(`Extensao sem miniatura: ${extensao}`)
  }

  // Checar a existencia antes de chamar o binario troca uma mensagem de erro de
  // ferramenta por uma que diz o que houve. Arquivo ausente no volume e o caso
  // esperado, nao a excecao.
  await fs.promises.access(caminho, fs.constants.R_OK)
    .catch(() => { throw new Error('Arquivo ausente ou ilegivel no volume') })

  const dir = await criarTemporario()
  try {
    const conteudo = ext === 'pdf'
      ? await renderizarPdf(caminho, dir)
      : await renderizarTif(caminho, dir)

    if (!conteudo || !conteudo.length) {
      throw new Error('Renderizacao devolveu arquivo vazio')
    }

    const { largura, altura } = dimensoesJpeg(conteudo)
    return { conteudo, formato: FORMATO, largura, altura }
  } finally {
    await removerTemporario(dir)
  }
}

module.exports = {
  gerarMiniatura,
  podeGerar,
  dimensoesJpeg,
  LADO_MAX,
  QUALIDADE_JPEG,
  FORMATO
}
