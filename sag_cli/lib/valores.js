'use strict'

// Conversao entre o jeito do SAG e o jeito do SCA.
//
// Existe porque `conferir` compara NUMERO com NUMERO e DIA com DIA. Comparar as
// duas representacoes como texto ("20.710,00" contra "20710.00") acusaria
// divergencia em toda linha, e o relatorio inteiro viraria ruido.

/**
 * Le uma quantia nas DUAS convencoes que este CLI cruza, e nao numa so.
 *
 *   SAG  "20.710,00"   ponto de milhar, virgula decimal
 *   SCA  "20710.00"    NUMERIC do Postgres, serializado com ponto decimal
 *
 * TRATAR TODO PONTO COMO MILHAR QUEBRA O LADO DO SCA: "20710.00" viraria
 * 2071000, e a conferencia acusaria divergencia em TODA linha, inclusive nas
 * corretas. Foi o que aconteceu na primeira execucao real, em 2026-08-07.
 *
 * A regra que separa os dois casos:
 *   - tem virgula  -> pt-BR: ponto e milhar, virgula e decimal;
 *   - sem virgula  -> o ultimo grupo depois do ponto decide. Duas casas e
 *     decimal ("20710.00"); tres casas e milhar ("1.234"). Quantia com tres
 *     decimais nao ocorre em orcamento, e e por isso que a regra fecha.
 *
 * Devolve null para o que nao e numero. NUNCA zero: zero e uma afirmacao
 * ("nao houve movimento") e null e ausencia, e trocar um pelo outro faz
 * documento sem valor somar como se valesse zero.
 */
function numero (texto) {
  if (texto === null || texto === undefined || texto === '') return null
  if (typeof texto === 'number') return Number.isFinite(texto) ? texto : null

  const limpo = String(texto).trim().replace(/^R\$\s*/, '').replace(/\s/g, '')
  if (!/^-?\d{1,3}(\.\d{3})*(,\d+)?$|^-?\d+([.,]\d+)?$/.test(limpo)) {
    const direto = Number(limpo)
    return Number.isFinite(direto) ? direto : null
  }

  let normalizado
  if (limpo.includes(',')) {
    normalizado = limpo.replace(/\./g, '').replace(',', '.')
  } else {
    const ultimo = limpo.lastIndexOf('.')
    const casas = ultimo === -1 ? 0 : limpo.length - ultimo - 1
    // Tres casas no ultimo grupo so pode ser milhar; qualquer outra coisa e
    // decimal. Sem ponto nenhum, o texto ja e o numero.
    normalizado = casas === 3 ? limpo.replace(/\./g, '') : limpo
  }

  const n = Number(normalizado)
  return Number.isFinite(n) ? n : null
}

/**
 * Data do SAG para ISO. O SAG devolve "05/02/26" na consulta e aceita
 * "05/02/2026" no filtro: os dois entram.
 *
 * O ANO DE DOIS DIGITOS E O PONTO PERIGOSO. "26" so pode ser 2026 num sistema
 * que comecou nos anos 2000, e e o que assumimos, com o limite explicito: 70 a
 * 99 viram 19xx. Sem essa regra, "05/02/26" viraria o ano 26 depois de Cristo e
 * o registro cairia fora de qualquer recorte, calado.
 */
function paraIso (texto) {
  if (!texto) return null
  const m = /^(\d{2})\/(\d{2})\/(\d{2}|\d{4})$/.exec(String(texto).trim())
  if (!m) {
    const iso = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(texto).trim())
    return iso ? `${iso[1]}-${iso[2]}-${iso[3]}` : null
  }
  const [, dia, mes, anoBruto] = m
  let ano = Number(anoBruto)
  if (anoBruto.length === 2) ano = ano >= 70 ? 1900 + ano : 2000 + ano
  return `${ano}-${mes}-${dia}`
}

/** ISO para o formato que o filtro do SAG espera (dd/mm/aaaa). */
function paraSag (iso) {
  if (!iso) return null
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(String(iso).trim())
  if (m) return `${m[3]}/${m[2]}/${m[1]}`
  if (/^\d{2}\/\d{2}\/\d{4}$/.test(String(iso).trim())) return String(iso).trim()
  throw new Error(`Data em formato desconhecido: "${iso}". Use aaaa-mm-dd ou dd/mm/aaaa.`)
}

/**
 * Numero de documento SIAFI sem o prefixo de UG e gestao.
 * "160382000012026NE000153" -> "2026NE000153". Deixa intacto o que ja e curto.
 *
 * O SCA guarda o numero curto (medido em orcamento.nota_credito.numero, ex.:
 * "2026NC400134"), e algumas telas do SAG devolvem o longo. Comparar os dois
 * sem normalizar nao casaria NENHUM registro, e o `conferir` diria que o SCA
 * esta inteiro vazio.
 */
function documentoCurto (numero) {
  if (!numero) return null
  const texto = String(numero).trim()
  const m = /(\d{4}[A-Z]{2}\d{6})$/.exec(texto)
  return m ? m[1] : texto
}

/** Duas quantias sao iguais ate um centavo. */
function mesmoValor (a, b) {
  const x = numero(a)
  const y = numero(b)
  if (x === null || y === null) return x === y
  return Math.abs(x - y) < 0.005
}

module.exports = { numero, paraIso, paraSag, documentoCurto, mesmoValor }
