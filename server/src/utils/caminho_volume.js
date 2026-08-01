// Path: utils/caminho_volume.js
'use strict'

const path = require('path')

/**
 * Monta o caminho FÍSICO de um arquivo dentro de um volume de armazenamento.
 *
 * O PROBLEMA QUE ISTO RESOLVE. `acervo.volume_armazenamento.volume` guarda um
 * caminho UNC do Windows (`\\host\share\...`), porque foi de máquina Windows que
 * o acervo nasceu. Quinze pontos do servidor montavam o caminho com
 * `path.join(volume, nome)`, e isso funciona no Windows e SILENCIOSAMENTE FALHA
 * no Linux: o `path` do Node é o da plataforma corrente, e no POSIX ele trata
 * `\\host\share` como um nome de arquivo único, com barras invertidas literais.
 * O `fs.access` não acha nada e a rota responde 404 dizendo que o arquivo está
 * registrado mas não está no volume. Foi o que derrubou TODO download pelo
 * navegador quando o servidor subiu em Linux (chefe, 2026-07-30).
 *
 * Detectar a plataforma, sozinho, NÃO resolve. Um caminho UNC não existe em
 * forma nenhuma no Linux: o share precisa estar montado, e o ponto de montagem
 * não se deduz da UNC. Por isso a tradução precisa de configuração.
 *
 * COMO TRADUZ, em Linux:
 *   1. Se houver `VOLUME_<id>_CAMINHO` no ambiente, ele MANDA. É o escape para
 *      o volume que não segue convenção nenhuma.
 *   2. Senão, e havendo `VOLUMES_RAIZ`, a UNC `\\host\share\sub` vira
 *      `<VOLUMES_RAIZ>/share/sub`. É a convenção do mount por share.
 *   3. Sem nenhum dos dois, devolve o valor cru. Vai falhar, e deve mesmo: o
 *      404 com o caminho no log diz o que configurar, e adivinhar um `/mnt`
 *      qualquer produziria erro mais difícil de ler.
 *
 * Em Windows devolve `path.win32.join`, que é o comportamento de sempre.
 *
 * O caminho NUNCA vai para a resposta HTTP do navegador: quem baixa pela web
 * recebe bytes. Ele sai no prepare-download, que serve o plugin do QGIS, e aí a
 * máquina que consome monta o share por conta.
 */

const ehUNC = (v) => typeof v === 'string' && v.startsWith('\\\\')

/**
 * Converte `\\host\share\sub\...` em `<raiz>/share/sub/...`.
 * Devolve null quando não há raiz configurada ou o valor não é UNC.
 */
const uncParaPosix = (volume, raiz) => {
  if (!ehUNC(volume) || !raiz) return null
  // Fora os dois primeiros vazios da UNC, o primeiro pedaço é o HOST e o
  // segundo é o SHARE. O host se descarta: no Linux quem resolve o host é a
  // montagem, não o caminho.
  const partes = volume.split('\\').filter(Boolean)
  if (partes.length < 2) return null
  return path.posix.join(raiz, ...partes.slice(1))
}

/** Nome do share da UNC, normalizado para virar chave de ambiente. */
const chaveDoShare = (volume) => {
  if (!ehUNC(volume)) return null
  const partes = volume.split('\\').filter(Boolean)
  if (partes.length < 2) return null
  return `VOLUME_${partes[1].toUpperCase().replace(/[^A-Z0-9]/g, '_')}_CAMINHO`
}

/**
 * Raiz física do volume, já traduzida para a plataforma corrente.
 * @param {string} volume valor de acervo.volume_armazenamento.volume
 */
const raizDoVolume = (volume) => {
  if (process.platform === 'win32') return volume

  const chave = chaveDoShare(volume)
  if (chave && process.env[chave]) return process.env[chave]

  const traduzido = uncParaPosix(volume, process.env.VOLUMES_RAIZ)
  return traduzido || volume
}

/**
 * Caminho completo do arquivo no volume. Aceita quantos segmentos precisar
 * (o ponto de controle usa <volume>/<cod_ponto>/<nome>).
 */
const caminhoNoVolume = (volume, ...segmentos) => {
  const raiz = raizDoVolume(volume)
  const juntar = process.platform === 'win32' ? path.win32.join : path.posix.join
  return juntar(raiz, ...segmentos.filter(s => s !== undefined && s !== null && s !== ''))
}

/**
 * Valida um caminho RELATIVO que veio do cliente e vai ser juntado à raiz de um
 * volume.
 *
 * O `caminhoNoVolume` é um `path.join` puro, e `join` NÃO protege contra
 * travessia: `LOTE_1/../../../etc/passwd` sai do volume sem reclamar. Enquanto o
 * nome físico era um identificador plano derivado do padrão, isso não aparecia.
 * A catalogação in-place torna a SUBPASTA o caso normal (o layout do fornecedor
 * é `LOTE_1/IMAGENS/...`), então a validação passa a ser obrigatória.
 *
 * A recusa é por SEGMENTO, e não por busca de substring: sem nenhum segmento
 * `..` e sem raiz absoluta não existe caminho que escape, e `..` no meio de um
 * nome legítimo (`MDS..2021.img`) não é travessia e não deve ser recusado.
 *
 * @param {string} relativo caminho relativo com barra normal
 * @returns {string|null} o motivo da recusa, ou null quando o caminho é seguro
 */
const motivoCaminhoInseguro = (relativo) => {
  if (typeof relativo !== 'string' || relativo.trim() === '') {
    return 'está vazio'
  }
  if (relativo.includes('\\')) {
    return 'usa contrabarra; escreva a subpasta com barra normal (/), que o servidor traduz para o separador da plataforma'
  }
  if (relativo.startsWith('/')) {
    return 'é absoluto; o caminho tem de ser relativo à raiz do volume'
  }
  if (/^[A-Za-z]:/.test(relativo)) {
    return 'traz letra de unidade; mapeamento de unidade é local de cada máquina e não descreve o volume'
  }
  if (/[\u0000-\u001f]/.test(relativo)) {
    return 'contém caractere de controle'
  }
  for (const segmento of relativo.split('/')) {
    if (segmento === '' || segmento === '.' || segmento === '..') {
      return `contém o segmento "${segmento}", que sairia da raiz do volume`
    }
  }
  return null
}

module.exports = {
  caminhoNoVolume,
  raizDoVolume,
  uncParaPosix,
  ehUNC,
  chaveDoShare,
  motivoCaminhoInseguro
}
