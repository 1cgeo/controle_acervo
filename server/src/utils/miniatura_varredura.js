'use strict'

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
 * Varre a fila de miniaturas, sob comando.
 *
 * Era um cron de meia em meia hora ate 2026-08-04, quando o chefe tirou todo
 * agendamento da aplicacao. Agora quem varre e o administrador, pela rota
 * POST /api/produtos/varrer-miniaturas, ou o script de lote no servidor.
 *
 * A carga do acervo antigo e um script a parte, rodado uma vez. Esta varredura
 * cobre o que ENTRA depois: versao nova por upload, por plugin ou por carga
 * direta. A miniatura NAO e gerada no `confirmUpload` de proposito (ver
 * miniatura_fila.js): renderizar custa segundos e roda processo externo, e a
 * confirmacao acontece dentro de uma transacao.
 *
 * Por isso a fila e DIVIDA VISIVEL, e nao automatica: `contarPendentes` existe
 * para a tela mostrar quantas versoes esperam, em vez de o acervo acumular
 * buraco que ninguem ve.
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

// Uma passada por vez. Duas varreduras disparadas juntas (dois cliques, duas
// abas) escolheriam os MESMOS candidatos e renderizariam em dobro. A guarda
// nasceu no tempo do cron, quando o relogio disparava sobre uma passada lenta
// ainda em curso, e continua valendo pelo mesmo motivo.
let rodando = false

/**
 * Gera a miniatura das versoes informadas, EM SEGUNDO PLANO.
 *
 * Chame DEPOIS do commit e SEM `await`: renderizar custa segundos e roda um
 * processo externo, entao nao pode acontecer dentro da transacao que confirma o
 * upload nem segurar a resposta de quem enviou o arquivo. Foi por isso que a
 * geracao vivia num cron; sem cron, ela passa a ser disparada pelo proprio
 * evento que a torna necessaria.
 *
 * NUNCA lanca. A promessa nao volta para o caminho da requisicao, entao uma
 * rejeicao aqui derrubaria o processo como `unhandledRejection`. Falha vira
 * linha de erro na tabela (o `processar` ja trata) ou log.
 *
 * @param {Array<number|string>} versaoIds
 * @returns {Promise<void>} resolvida sempre
 */
const gerarParaVersoes = async (versaoIds) => {
  const ids = [...new Set((versaoIds || []).filter(v => v !== null && v !== undefined))]
  if (!ids.length) return

  for (const versaoId of ids) {
    try {
      // Uma versao por vez, com o MESMO SQL da varredura: a politica de qual
      // arquivo vira miniatura mora num lugar so (miniatura_fila.js).
      const candidatos = await db.conn.any(SQL_CANDIDATOS, [versaoId, false])
      if (!candidatos.length) continue

      const { resultado, erro } = await processar(candidatos[0])

      if (ehFalhaDeAmbiente(erro)) {
        logger.error('Miniaturas: binario de renderizacao ausente, geracao adiada', {
          error: erro,
          information: { versao_id: versaoId }
        })
        // Sem gravar: a versao continua na fila e a varredura manual a pega
        // quando o binario voltar. Gravar erro aqui a tiraria da fila por um
        // problema do SERVIDOR, e nao do arquivo.
        return
      }

      await db.conn.none(SQL_GRAVAR, valoresParaGravar(candidatos[0], resultado, erro))
      logger.info('Miniatura gerada apos o upload', {
        information: { versao_id: versaoId, sucesso: Boolean(resultado) }
      })
    } catch (error) {
      logger.error('Erro ao gerar miniatura apos o upload', {
        error,
        information: { versao_id: versaoId }
      })
    }
  }
}

/** Quantas versoes esperam miniatura. E a divida, para a tela poder mostra-la. */
const contarPendentes = async () => {
  const candidatos = await db.conn.any(SQL_CANDIDATOS, [null, false])
  return candidatos.length
}

/**
 * Uma passada da fila, com teto de LOTE.
 * @returns {Promise<{sucessos:number, falhas:number, restante:number, pulada:boolean}>}
 */
const varrerFila = async () => {
  if (rodando) {
    logger.info('Miniaturas: passada anterior ainda em curso, pulando')
    // A guarda continua valendo: duas rotas disparadas juntas escolheriam os
    // MESMOS candidatos e renderizariam em dobro. Quem chamou precisa SABER que
    // nao rodou, senao a tela anuncia trabalho que nao aconteceu.
    return { sucessos: 0, falhas: 0, restante: null, pulada: true }
  }

  rodando = true

  try {
    const candidatos = await db.conn.any(SQL_CANDIDATOS, [null, false])

    if (!candidatos.length) return { sucessos: 0, falhas: 0, restante: 0, pulada: false }

    const fatia = candidatos.slice(0, LOTE)
    let sucessos = 0
    let falhas = 0

    for (const candidato of fatia) {
      const { resultado, erro } = await processar(candidato)

      if (ehFalhaDeAmbiente(erro)) {
        logger.error('Miniaturas: binario de renderizacao ausente, passada abortada', {
          error: erro
        })
        // O chamador precisa distinguir "abortei por falta de binario" de
        // "terminei". Quando era cron, ninguem lia o retorno e o `return` seco
        // bastava; a rota anuncia o resultado a uma pessoa.
        return {
          sucessos,
          falhas,
          restante: candidatos.length - sucessos - falhas,
          pulada: false,
          abortada: 'binário de renderização ausente no servidor'
        }
      }

      await db.conn.none(SQL_GRAVAR, valoresParaGravar(candidato, resultado, erro))

      if (resultado) sucessos += 1
      else falhas += 1
    }

    // Registra o RESTANTE junto do feito: e o unico jeito de perceber, pelo
    // log, que a fila nao esta andando (falha que se repete e nunca esvazia).
    const restante = candidatos.length - fatia.length
    logger.info('Miniaturas geradas', {
      information: { sucessos, falhas, restante }
    })
    return { sucessos, falhas, restante, pulada: false }
  } catch (error) {
    logger.error('Erro ao gerar miniaturas', { error })
    throw error
  } finally {
    rodando = false
  }
}

module.exports = {
  varrerFila,
  gerarParaVersoes,
  contarPendentes,
  LOTE
}
