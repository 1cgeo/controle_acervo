'use strict'

const zlib = require('zlib')

/**
 * ZIP de propósito único: abrir um .ods que já existe e reescrevê-lo com uma
 * entrada trocada.
 *
 * É o que permite gerar o Anuário Estatístico e o RTM a partir da
 * planilha-SEMENTE (`rpcmtec/modelos/`) em vez de redesenhá-los: o estilo, a
 * largura de coluna, a célula mesclada e o painel congelado continuam sendo os
 * do arquivo original, byte a byte. Quem monta o `content.xml` novo é cada
 * gerador, em `rpcmtec/anuario_ods.js` e `rpcmtec/rtm_ods.js`.
 *
 * NÃO monte a planilha do zero aqui: o arquivo desenhado por nós tem os números
 * certos sem ser o arquivo que a DSG confere linha a linha.
 *
 * O `archiver` do projeto não serve aqui: ele é stream de arquivo, e o que se
 * precisa é buffer em memória com controle da ORDEM e da compressão de cada
 * entrada, que é o que o ODF exige do `mimetype`.
 */

// --- ZIP -------------------------------------------------------------------
// ZIP mínimo (deflate cru pelo zlib do Node). O ODF exige que a entrada
// `mimetype` seja a PRIMEIRA e fique SEM compressão: é por ela que o
// descompactador identifica o tipo do documento sem abrir o XML.

const TABELA_CRC = (() => {
  const tabela = new Int32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    }
    tabela[n] = c
  }
  return tabela
})()

const crc32 = buffer => {
  let c = 0 ^ -1
  for (let i = 0; i < buffer.length; i++) {
    c = (c >>> 8) ^ TABELA_CRC[(c ^ buffer[i]) & 0xff]
  }
  return (c ^ -1) >>> 0
}

// Data/hora no formato DOS que o cabeçalho do ZIP usa (resolução de 2 segundos).
const dataDos = data => {
  const dia = ((data.getFullYear() - 1980) << 9) | ((data.getMonth() + 1) << 5) | data.getDate()
  const hora = (data.getHours() << 11) | (data.getMinutes() << 5) | (data.getSeconds() >> 1)
  return { dia, hora }
}

/**
 * Monta um ZIP a partir de uma lista de entradas.
 * @param {Array<{nome: string, conteudo: Buffer, comprimir?: boolean}>} entradas
 * @param {Date} [data] - carimbo de tempo das entradas
 * @returns {Buffer}
 */
const zipar = (entradas, data = new Date()) => {
  const { dia, hora } = dataDos(data)
  const locais = []
  const centrais = []
  let deslocamento = 0

  for (const entrada of entradas) {
    const nome = Buffer.from(entrada.nome, 'utf8')
    const cru = entrada.conteudo
    const comprimir = entrada.comprimir !== false
    const dados = comprimir ? zlib.deflateRawSync(cru, { level: 9 }) : cru
    const metodo = comprimir ? 8 : 0
    const crc = crc32(cru)

    const local = Buffer.alloc(30 + nome.length)
    local.writeUInt32LE(0x04034b50, 0)
    local.writeUInt16LE(20, 4) // versão necessária
    local.writeUInt16LE(0, 6) // flags
    local.writeUInt16LE(metodo, 8)
    local.writeUInt16LE(hora, 10)
    local.writeUInt16LE(dia, 12)
    local.writeUInt32LE(crc, 14)
    local.writeUInt32LE(dados.length, 18)
    local.writeUInt32LE(cru.length, 22)
    local.writeUInt16LE(nome.length, 26)
    local.writeUInt16LE(0, 28) // sem campo extra
    nome.copy(local, 30)

    const central = Buffer.alloc(46 + nome.length)
    central.writeUInt32LE(0x02014b50, 0)
    central.writeUInt16LE(20, 4) // versão de quem escreveu
    central.writeUInt16LE(20, 6)
    central.writeUInt16LE(0, 8)
    central.writeUInt16LE(metodo, 10)
    central.writeUInt16LE(hora, 12)
    central.writeUInt16LE(dia, 14)
    central.writeUInt32LE(crc, 16)
    central.writeUInt32LE(dados.length, 20)
    central.writeUInt32LE(cru.length, 24)
    central.writeUInt16LE(nome.length, 28)
    central.writeUInt16LE(0, 30)
    central.writeUInt16LE(0, 32)
    central.writeUInt16LE(0, 34)
    central.writeUInt16LE(0, 36)
    central.writeUInt32LE(0, 38)
    central.writeUInt32LE(deslocamento, 42)
    nome.copy(central, 46)

    locais.push(local, dados)
    centrais.push(central)
    deslocamento += local.length + dados.length
  }

  const diretorio = Buffer.concat(centrais)
  const fim = Buffer.alloc(22)
  fim.writeUInt32LE(0x06054b50, 0)
  fim.writeUInt16LE(0, 4)
  fim.writeUInt16LE(0, 6)
  fim.writeUInt16LE(entradas.length, 8)
  fim.writeUInt16LE(entradas.length, 10)
  fim.writeUInt32LE(diretorio.length, 12)
  fim.writeUInt32LE(deslocamento, 16)
  fim.writeUInt16LE(0, 20)

  return Buffer.concat([...locais, diretorio, fim])
}

// --- Leitura de ZIP --------------------------------------------------------
//
// O contrário do `zipar`: abre um .ods que já existe para trocar o conteúdo de
// uma entrada e reescrever o resto INTACTO.
//
// Lê pelo DIRETÓRIO CENTRAL, e não varrendo cabeçalhos locais: só o diretório
// central é autoritativo sobre onde cada entrada começa, e é dele que sai o
// tamanho comprimido quando a entrada usa descritor de dados.
//
// Não trata ZIP64 nem entrada cifrada, de propósito: a semente é um arquivo
// nosso, versionado, de dezenas de KB. Se um dia deixar de sê-lo, o erro
// abaixo diz isso em vez de devolver bytes truncados.

const FIM_DIRETORIO = 0x06054b50
const ENTRADA_CENTRAL = 0x02014b50

/**
 * Abre um ZIP e devolve o conteúdo já descomprimido de cada entrada.
 * @param {Buffer} buffer
 * @returns {Map<string, Buffer>} nome da entrada para conteúdo
 */
const desziparParaMapa = buffer => {
  // O fim do diretório central tem tamanho variável (comentário no fim), então
  // procura-se a assinatura de trás para frente.
  let fim = -1
  for (let i = buffer.length - 22; i >= 0; i--) {
    if (buffer.readUInt32LE(i) === FIM_DIRETORIO) {
      fim = i
      break
    }
  }
  if (fim < 0) {
    throw new Error('ODS inválido: não achei o fim do diretório central do ZIP')
  }

  const total = buffer.readUInt16LE(fim + 10)
  let posicao = buffer.readUInt32LE(fim + 16)
  const entradas = new Map()

  for (let i = 0; i < total; i++) {
    if (buffer.readUInt32LE(posicao) !== ENTRADA_CENTRAL) {
      throw new Error('ODS inválido: entrada do diretório central fora de lugar')
    }
    const metodo = buffer.readUInt16LE(posicao + 10)
    const tamanhoComprimido = buffer.readUInt32LE(posicao + 20)
    const tamanhoCru = buffer.readUInt32LE(posicao + 24)
    const tamanhoNome = buffer.readUInt16LE(posicao + 28)
    const tamanhoExtra = buffer.readUInt16LE(posicao + 30)
    const tamanhoComentario = buffer.readUInt16LE(posicao + 32)
    const deslocamentoLocal = buffer.readUInt32LE(posicao + 42)
    const nome = buffer.toString('utf8', posicao + 46, posicao + 46 + tamanhoNome)

    // O cabeçalho local repete nome e extra, e os tamanhos dele podem diferir
    // dos do diretório central: os dados começam depois DESTE extra.
    const nomeLocal = buffer.readUInt16LE(deslocamentoLocal + 26)
    const extraLocal = buffer.readUInt16LE(deslocamentoLocal + 28)
    const inicio = deslocamentoLocal + 30 + nomeLocal + extraLocal
    const dados = buffer.subarray(inicio, inicio + tamanhoComprimido)

    if (metodo === 0) {
      entradas.set(nome, Buffer.from(dados))
    } else if (metodo === 8) {
      entradas.set(nome, zlib.inflateRawSync(dados))
    } else {
      throw new Error(`ODS inválido: método de compressão ${metodo} não suportado em "${nome}"`)
    }

    if (entradas.get(nome).length !== tamanhoCru) {
      throw new Error(`ODS inválido: "${nome}" descomprimiu com tamanho inesperado`)
    }

    posicao += 46 + tamanhoNome + tamanhoExtra + tamanhoComentario
  }

  return entradas
}

/**
 * Reescreve um .ods trocando o conteúdo de algumas entradas e copiando o resto.
 *
 * A entrada `mimetype` volta PRIMEIRO e SEM compressão, que é o que o ODF exige
 * para o descompactador reconhecer o tipo do documento sem abrir o XML. Sem
 * isso o LibreOffice ainda abre, mas o arquivo deixa de ser um ODF válido e o
 * `file`/`xdg-mime` passa a chamá-lo de "Zip archive".
 *
 * @param {Buffer} original
 * @param {Object<string, Buffer|string>} substituicoes - nome da entrada para conteúdo novo
 * @param {Date} [data]
 * @returns {Buffer}
 */
const reescreverOds = (original, substituicoes, data = new Date()) => {
  const entradas = desziparParaMapa(original)

  for (const nome of Object.keys(substituicoes)) {
    if (!entradas.has(nome)) {
      throw new Error(`ODS-semente não tem a entrada "${nome}"`)
    }
  }

  const conteudo = nome => {
    const novo = substituicoes[nome]
    if (novo == null) return entradas.get(nome)
    return Buffer.isBuffer(novo) ? novo : Buffer.from(novo, 'utf8')
  }

  const nomes = [...entradas.keys()]
  const ordenados = ['mimetype', ...nomes.filter(n => n !== 'mimetype')]

  return zipar(
    ordenados.map(nome => ({
      nome,
      conteudo: conteudo(nome),
      comprimir: nome !== 'mimetype'
    })),
    data
  )
}

module.exports = {
  desziparParaMapa,
  reescreverOds
}
