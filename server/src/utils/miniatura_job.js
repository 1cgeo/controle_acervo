'use strict'

const cron = require('node-cron')
const { db } = require('../database')
const logger = require('./logger')
const {
  SQL_CANDIDATOS,
  SQL_GRAVAR,
  processar,
  valoresParaGravar,
  ehFalhaDeAmbiente
} = require('./miniatura_fila')

/**
 * Varre a fila de miniaturas de hora em hora.
 *
 * A carga do acervo antigo e um script a parte, rodado uma vez. Este job cobre
 * o que ENTRA depois: versao nova por upload, por plugin ou por carga direta.
 * Sem ele, a miniatura viraria divida que alguem tem de lembrar de pagar.
 *
 * TETO POR PASSADA. Cada arquivo custa segundos e um processo externo, entao a
 * passada leva no maximo `LOTE` versoes. Com fila vazia nao faz nada, e com
 * fila cheia (o acervo inteiro, se ninguem rodar a carga) ela anda devagar sem
 * ocupar o servidor. Um acervo em ritmo normal cadastra poucas versoes por dia,
 * e o teto nunca e alcancado.
 *
 * SEM CONCORRENCIA. O lote usa quatro trabalhadores porque e uma carga
 * dedicada. Aqui o servidor esta atendendo gente, e uma miniatura por vez basta
 * para a fila normal.
 */

const LOTE = 20

// Uma passada por vez. `node-cron` dispara no relogio, e uma passada lenta
// (arquivo grande na rede) ainda pode estar correndo na hora seguinte: sem esta
// guarda, as duas escolheriam os MESMOS candidatos e renderizariam em dobro.
let rodando = false

const varrerFila = async () => {
  if (rodando) {
    logger.info('Miniaturas: passada anterior ainda em curso, pulando')
    return
  }

  rodando = true

  try {
    const candidatos = await db.conn.any(SQL_CANDIDATOS, [null, false])

    if (!candidatos.length) return

    const fatia = candidatos.slice(0, LOTE)
    let sucessos = 0
    let falhas = 0

    for (const candidato of fatia) {
      const { resultado, erro } = await processar(candidato)

      if (ehFalhaDeAmbiente(erro)) {
        logger.error('Miniaturas: binario de renderizacao ausente, passada abortada', {
          error: erro
        })
        return
      }

      await db.conn.none(SQL_GRAVAR, valoresParaGravar(candidato, resultado, erro))

      if (resultado) sucessos += 1
      else falhas += 1
    }

    // Registra o RESTANTE junto do feito: e o unico jeito de perceber, pelo
    // log, que a fila nao esta andando (falha que se repete e nunca esvazia).
    logger.info('Miniaturas geradas', {
      information: {
        sucessos,
        falhas,
        restante: candidatos.length - fatia.length
      }
    })
  } catch (error) {
    logger.error('Erro ao gerar miniaturas', { error })
  } finally {
    rodando = false
  }
}

const initMiniaturaJob = () => {
  // Na meia hora, e nao na hora cheia: a limpeza de downloads e uploads ja roda
  // em '0 * * * *', e as duas juntas disputariam o banco sem motivo.
  cron.schedule('30 * * * *', varrerFila)

  logger.info('Miniatura job scheduled')
}

module.exports = {
  initMiniaturaJob,
  varrerFila,
  LOTE
}
