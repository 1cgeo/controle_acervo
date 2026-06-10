'use strict'
/**
 * Title case para nomes de cartas em português.
 *
 * Regras (ver regras_carga_produtos.md, seção 2.4):
 *  - Primeira letra de cada palavra em maiúscula, demais minúsculas;
 *  - Partículas ficam minúsculas (de, da, do, e, em...), exceto se forem a
 *    primeira palavra;
 *  - Sufixos direcionais (N, S, L, O, NE, NO, SE, SO) e numerais romanos
 *    permanecem em maiúsculas;
 *  - Segmentos separados por hífen são tratados individualmente
 *    (ex.: "ROSÁRIO DO SUL-N" -> "Rosário do Sul-N").
 */

const PARTICULAS = new Set([
  'a', 'as', 'à', 'às', 'o', 'os', 'ao', 'aos',
  'de', 'da', 'das', 'do', 'dos', 'd',
  'e', 'em', 'na', 'nas', 'no', 'nos', 'num', 'numa',
  'com', 'para', 'por', 'pela', 'pelas', 'pelo', 'pelos',
  'sem', 'sob', 'sobre', 'entre', 'até', 'desde'
])

const DIRECIONAIS = new Set(['N', 'S', 'L', 'O', 'NE', 'NO', 'SE', 'SO'])

const ROMANO = /^[IVXLCDM]+$/

function capitaliza (palavra) {
  if (!palavra) return palavra
  return palavra.charAt(0).toUpperCase() + palavra.slice(1).toLowerCase()
}

function trataSegmento (segmento, ehPrimeiraPalavra, ehSufixoHifen) {
  const upper = segmento.toUpperCase()

  // Sufixos direcionais e numerais romanos ficam em maiúsculas
  if (DIRECIONAIS.has(upper) && (ehSufixoHifen || upper.length > 1)) return upper
  if (ROMANO.test(upper) && upper.length > 1) return upper
  if (ROMANO.test(upper) && ehSufixoHifen) return upper

  const lower = segmento.toLowerCase()
  if (!ehPrimeiraPalavra && PARTICULAS.has(lower)) return lower

  return capitaliza(segmento)
}

function titleCasePt (texto) {
  if (!texto) return texto

  return texto
    .trim()
    .split(/\s+/)
    .map((palavra, idxPalavra) =>
      palavra
        .split('-')
        .map((seg, idxSeg) => trataSegmento(seg, idxPalavra === 0 && idxSeg === 0, idxSeg > 0))
        .join('-')
    )
    .join(' ')
}

module.exports = { titleCasePt }
