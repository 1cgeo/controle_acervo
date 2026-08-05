'use strict'

const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFile } = require('child_process')
const { promisify } = require('util')
const sharp = require('sharp')

const execFileAsync = promisify(execFile)

/**
 * Miniatura de uma versao do acervo: a imagem que a ficha do produto mostra.
 *
 * Ela serve para RECONHECER o produto de relance (o desenho da folha, a mancha
 * urbana, o relevo), nunca para ler o texto dele. Por isso a pagina inteira, e
 * nao um recorte da area do mapa.
 *
 * DOIS CAMINHOS, porque o acervo tem duas naturezas de arquivo.
 *
 *   PDF -> `pdftoppm` (poppler), que renderiza, reduz e codifica sozinho.
 *   RASTER -> `gdalinfo` + `gdal_translate` para ABRIR o formato, e `sharp`
 *             para reduzir e codificar.
 *
 * O GDAL NAO SAI: ele e a unica coisa que abre o que o acervo recebe. A
 * Ortoimagem chega em ERDAS `.img` de 43064x48311, com os pixels num `.ige` de
 * 7,4 GB ao lado, e o `sharp` sequer abre o formato.
 *
 * O POPPLER TAMBEM NAO SAI. Os substitutos permissivos (PDFium em WASM, pdf.js)
 * discordam do preenchimento da carta topografica em ambos os sentidos, arquivo
 * a arquivo, e sem visualizador de referencia nao da para dizer qual acerta.
 * (O mupdf, tecnicamente o melhor, e AGPL-3.0 e este repositorio e MIT.)
 *
 * O SHARP ENTRA MESMO ASSIM porque o `-outsize` do GDAL decima por vizinho mais
 * proximo, e ai o texto da legenda vira papa e a grade serrilha. O GDAL extrai
 * ao DOBRO do alvo e o `sharp` faz a reducao final com reamostragem de verdade.
 *
 * Os caminhos dos binarios saem do ambiente (`MINIATURA_PDFTOPPM`,
 * `MINIATURA_GDAL_TRANSLATE`, `MINIATURA_GDALINFO`), com o nome no PATH como
 * padrao. Em Linux e `apt install poppler-utils gdal-bin`; em Windows o GDAL vem
 * dentro do QGIS. Use BARRA NORMAL no caminho: ver a armadilha no `.env.example`.
 */

// Lado maior da miniatura, em pixels. Sai de onde a imagem e consumida: um
// painel de cerca de 300 px na ficha, dobrado para tela de alta densidade.
const LADO_MAX = 600

// O GDAL extrai ao dobro e o sharp reduz dai. Extrair ja no alvo desperdicaria
// a reamostragem boa; extrair muito acima so custaria leitura.
const FATOR_EXTRACAO = 2

const QUALIDADE_JPEG = 72
const FORMATO = 'jpeg'

// Tempo maximo por arquivo. Uma Ortoimagem de 7,4 GB leva cerca de 7 s lendo a
// piramide, e um PDF grande cerca de 3 s. O teto e generoso de proposito: ele
// existe para o lote nao travar para sempre num arquivo doente.
const TIMEOUT_MS = 300000

const binario = (chave, padrao) => process.env[chave] || padrao

/**
 * Extensoes que rendem miniatura, e por qual caminho.
 *
 * A lista existe para nao gastar um processo do GDAL em cada zip e sqlite do
 * acervo. Produto so vetorial simplesmente nao tem miniatura.
 */
const EXTENSOES_PDF = new Set(['pdf'])
const EXTENSOES_RASTER = new Set(['tif', 'tiff', 'img', 'ecw', 'jp2', 'png', 'jpg', 'jpeg'])

const podeGerar = (extensao) => {
  const e = String(extensao || '').toLowerCase()
  return EXTENSOES_PDF.has(e) || EXTENSOES_RASTER.has(e)
}

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
      maxBuffer: 64 * 1024 * 1024,
      env: {
        ...process.env,
        // O `-stats` do GDAL grava um `.aux.xml` ao lado do arquivo LIDO. Sem
        // isto, gerar miniatura encheria o volume do acervo de sidecars nossos,
        // dentro das pastas de entrega do fornecedor.
        GDAL_PAM_ENABLED: 'NO'
      }
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

/** Reducao final e codificacao. Unico ponto que produz os bytes gravados. */
const finalizar = async (entrada) => {
  const buffer = await sharp(entrada, { limitInputPixels: 4e9 })
    .resize(LADO_MAX, LADO_MAX, { fit: 'inside', withoutEnlargement: true })
    // JPEG nao tem canal alfa. Sem achatar contra branco, a transparencia da
    // Ortoimagem e do raster com alfa sairia PRETA.
    .flatten({ background: '#ffffff' })
    .jpeg({ quality: QUALIDADE_JPEG })
    .toBuffer({ resolveWithObject: true })

  return {
    conteudo: buffer.data,
    formato: FORMATO,
    largura: buffer.info.width,
    altura: buffer.info.height
  }
}

/** PDF: o poppler renderiza a primeira pagina ao dobro, o sharp reduz. */
const renderizarPdf = async (caminho, dir) => {
  const prefixo = path.join(dir, 'saida')

  // -singlefile faz o nome ser exatamente <prefixo>.png, sem o sufixo de pagina.
  // PNG, e nao JPEG: comprimir aqui e de novo no sharp somaria dois artefatos.
  await executar(binario('MINIATURA_PDFTOPPM', 'pdftoppm'), [
    '-png',
    '-scale-to', String(LADO_MAX * FATOR_EXTRACAO),
    '-f', '1', '-l', '1',
    '-singlefile',
    caminho,
    prefixo
  ])

  return finalizar(`${prefixo}.png`)
}

/** O que o GDAL sabe do arquivo, e que decide como extrair. */
const lerInfo = async (caminho, comEstatistica) => {
  const args = ['-json']
  // `-approx_stats` calcula a estatistica pelas piramides em vez de varrer o
  // raster inteiro. Para esticar um modelo de elevacao numa miniatura, a
  // aproximacao basta, e evita ler 150 MB. Ele SUBSTITUI o `-stats`; os dois
  // juntos o gdalinfo recusa ("not allowed with").
  if (comEstatistica) args.push('-approx_stats')
  args.push(caminho)

  const { stdout } = await executar(binario('MINIATURA_GDALINFO', 'gdalinfo'), args)
  return JSON.parse(stdout)
}

/**
 * Uma banda que NAO e de 8 bits guarda medida, e nao intensidade de pixel.
 *
 * E o caso do modelo de elevacao (MDS, MDT), onde o valor e a ALTITUDE. Sem
 * esticar, toda cota acima de 255 m vira branco: medido num MDT do acervo,
 * altitude de 193 a 735 m produzia miniatura de 2 KB, o tamanho de uma imagem
 * vazia. Por isso a estatistica so e pedida ao GDAL quando este teste passa.
 */
const precisaEsticar = (info) => {
  const bandas = info.bands || []
  return bandas.length === 1
    && Boolean(bandas[0].type)
    && bandas[0].type !== 'Byte'
}

/**
 * Como converter as bandas para uma imagem de 8 bits. Funcao PURA, para a
 * decisao poder ser testada sem GDAL e sem rede.
 *
 * @param {Object} info saida do `gdalinfo -json`
 * @param {Object} [stats] estatistica da banda 1, quando `precisaEsticar`
 * @returns {string[]} argumentos do gdal_translate
 */
const argumentosDeCor = (info, stats) => {
  const bandas = info.bands || []
  const primeira = bandas[0] || {}

  if (precisaEsticar(info)) {
    const { minimum, maximum, mean, stdDev } = stats || {}

    if ([minimum, maximum, mean, stdDev].every(v => typeof v === 'number') && stdDev > 0) {
      // Media +- 2,5 desvios, presa ao intervalo real. O recorte existe para um
      // pico isolado (ou um valor de "sem dado") nao achatar todo o relevo.
      const menor = Math.max(minimum, mean - 2.5 * stdDev)
      const maior = Math.min(maximum, mean + 2.5 * stdDev)
      if (maior > menor) {
        return ['-ot', 'Byte', '-scale', String(menor), String(maior), '0', '255']
      }
    }
    // Sem estatistica utilizavel, o -scale sozinho manda o GDAL usar o minimo e
    // o maximo do proprio raster. Continua melhor que cortar em 255.
    return ['-ot', 'Byte', '-scale']
  }

  // Raster paletado: uma banda com tabela de cor. Sem -expand ele sai em tom de
  // cinza, com as cores da carta viradas em cinza sem sentido.
  if (bandas.length === 1 && primeira.colorInterpretation === 'Palette') {
    return ['-expand', 'rgb']
  }

  // RGB, RGBA ou multiespectral: as tres primeiras bandas. O JPEG aceita 1 ou 3.
  if (bandas.length >= 3) return ['-b', '1', '-b', '2', '-b', '3']

  return []
}

/** Raster: o GDAL abre o formato e extrai ao dobro, o sharp reduz. */
const renderizarRaster = async (caminho, dir) => {
  const info = await lerInfo(caminho, false)
  const [largura, altura] = info.size || []
  if (!largura || !altura) throw new Error('gdalinfo nao devolveu o tamanho do raster')

  // `-outsize` nao tem "ajuste ao maior lado": passar `600 0` fixa a LARGURA, e
  // um raster em retrato sairia com 600 de largura e altura muito maior.
  const alvo = String(LADO_MAX * FATOR_EXTRACAO)
  const escala = largura >= altura ? [alvo, '0'] : ['0', alvo]

  // A estatistica so e pedida quando muda a decisao: ela custa uma segunda
  // chamada ao GDAL, e so o raster de medida (elevacao) precisa dela.
  const stats = precisaEsticar(info)
    ? ((await lerInfo(caminho, true)).bands || [])[0]
    : null

  const cor = argumentosDeCor(info, stats)
  const saida = path.join(dir, 'saida.png')

  await executar(binario('MINIATURA_GDAL_TRANSLATE', 'gdal_translate'), [
    '-q',
    '-of', 'PNG',
    '-outsize', ...escala,
    // Media, e nao vizinho mais proximo: sem isto o GDAL joga fora a maior parte
    // dos pixels e a carta serrilha antes mesmo de chegar ao sharp.
    '-r', 'average',
    ...cor,
    caminho,
    saida
  ])

  return finalizar(saida)
}

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
    const resultado = EXTENSOES_PDF.has(ext)
      ? await renderizarPdf(caminho, dir)
      : await renderizarRaster(caminho, dir)

    if (!resultado.conteudo || !resultado.conteudo.length) {
      throw new Error('Renderizacao devolveu arquivo vazio')
    }

    return resultado
  } finally {
    await removerTemporario(dir)
  }
}

module.exports = {
  gerarMiniatura,
  podeGerar,
  // Exportados para teste: sao a decisao que produzia miniatura em branco.
  argumentosDeCor,
  precisaEsticar,
  EXTENSOES_PDF,
  EXTENSOES_RASTER,
  LADO_MAX,
  QUALIDADE_JPEG,
  FORMATO
}
