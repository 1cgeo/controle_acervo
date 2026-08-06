'use strict'

const { AppError, httpCode } = require('../utils')

/**
 * O MOTIVO que uma revisão PUBLICADA cobra de quem a corrige.
 *
 * O motivo é o que separa "transcrevi errado" de "a DSG mudou". Sem ele a porta
 * viraria o caminho fácil para reescrever o passado sem deixar rastro do porquê.
 *
 * Devolve o motivo limpo para o rastro, ou nulo quando a revisão é rascunho.
 *
 * MORA AQUI, e não dentro de um controlador, porque as TRÊS correções da
 * transcrição usam a mesma regra: acrescentar a meta que a cópia esqueceu,
 * editar a que ela copiou errado, e remover a que ela inventou. Regra em três
 * lugares diverge.
 */
const motivoDaCorrecao = (revisao, motivo) => {
  // `== null` cobre nulo E ausente. A vigência nula é o que define o rascunho, e
  // uma leitura que não trouxesse a coluna cobraria motivo do rascunho inteiro.
  if (revisao.data_vigencia == null) return null

  const texto = motivo === undefined || motivo === null ? '' : String(motivo).trim()
  if (texto.length >= 5) return texto

  throw new AppError(
    `A revisão ${revisao.codigo} já foi publicada. Mexer aqui conserta a ` +
    'TRANSCRIÇÃO do texto assinado, e não muda o que o PIT promete: a revisão ' +
    'continua a mesma, com a mesma vigência. Escreva o motivo, com pelo menos 5 ' +
    'caracteres, dizendo em que a cópia diverge do documento. Se foi a DSG que ' +
    'mudou o plano, abra a revisão seguinte.',
    httpCode.BadRequest
  )
}

module.exports = { motivoDaCorrecao }
