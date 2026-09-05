'use strict'

// O MODO LOCAL SO ALCANCA A ATIVIDADE QUE AINDA NAO FOI ENCERRADA.
//
// O QUE ESTE ARQUIVO GUARDA sao dois UPDATE que escreviam por id CRU, sem olhar
// em que estado a atividade estava:
//
//   `/iniciar_modo_local`    punha em execucao QUALQUER atividade e trocava o
//                            `usuario_uuid` pelo do gerente. Sobre uma atividade
//                            EM EXECUCAO de outra pessoa, o operador perdia o
//                            `/verifica` e levava 400 no `/finaliza` sem nada
//                            explicando; sobre uma FINALIZADA, a entrega voltava
//                            a "Em execução" carregando a `data_fim` antiga.
//   `/finalizar_modo_local`  reescrevia dono, `data_inicio` e `data_fim` de uma
//                            atividade JA FINALIZADA. Uma segunda chamada -- o
//                            duplo clique, ou o id digitado errado -- mudava de
//                            mao e de data uma folha entregue.
//
// A regua e a mesma da zona de perigo, que solta as situacoes 1, 2 e 3 e NAO
// toca nas finalizadas: producao entregue nao se reescreve por rota de estado.
//
// Banco dublado: nada aqui abre conexao, e por isso os casos rodam no pacote
// `rapido`.

const { db } = require('../../../database')

const ctrl = require('../../../gerencia_producao/gerencia_producao_ctrl')

const UUID = '3b241101-e2bb-4255-8caf-4136c566a962'
const OUTRO_UUID = '9f8c2a10-1d3e-4b57-9d2a-6c1f0b7e4d51'
const CONTEXTO = {
  origem: 'web',
  rota: 'PUT /api/gerencia_producao/iniciar_modo_local',
  loteId: UUID
}

const LINHA = {
  id: 7,
  lote_id: 5,
  etapa_id: 11,
  unidade_trabalho_id: 13,
  usuario_uuid: UUID,
  tipo_situacao_atividade_id: 2,
  observacao: null
}

/**
 * O duble, com um interruptor: `casaOUpdate` decide se o UPDATE guardado acha
 * linha. Ele e o unico jeito de distinguir os dois desfechos, porque a diferenca
 * esta justamente no `WHERE` que ele carrega.
 */
const fabricarBanco = casaOUpdate => {
  const consultas = []

  const registrar = (query, values) => {
    consultas.push(db.pgp.as.format(query, values))
  }

  const conn = {
    any: async (query, values) => {
      registrar(query, values)
      return [{ ...LINHA }]
    },
    one: async (query, values) => {
      registrar(query, values)
      return { ...LINHA }
    },
    oneOrNone: async (query, values) => {
      registrar(query, values)
      // O `lerAntes` da auditoria e um SELECT e tem de ACHAR, senao o 404 dele
      // sai antes de o UPDATE existir.
      if (/^\s*UPDATE\s+producao\.atividade/i.test(String(query))) {
        return casaOUpdate ? { ...LINHA } : null
      }
      return { ...LINHA }
    },
    none: async (query, values) => {
      registrar(query, values)
      return null
    }
  }

  conn.tx = async cb => cb(conn)
  conn.task = async cb => cb(conn)

  return { consultas, conn }
}

let original

const comBanco = async (casaOUpdate, acao) => {
  const fabricado = fabricarBanco(casaOUpdate)
  original = db.conn
  db.conn = fabricado.conn
  try {
    const erro = await acao().then(() => null, e => e)
    return { erro, consultas: fabricado.consultas }
  } finally {
    db.conn = original
  }
}

const updateDaAtividade = consultas =>
  consultas.find(c => /^\s*UPDATE\s+producao\.atividade/i.test(c))

describe('iniciar em modo local', () => {
  const iniciar = () => ctrl.iniciaAtividadeModoLocal(7, UUID, CONTEXTO)

  it('cobra a situação no próprio UPDATE, e aceita só Não iniciada e Pausada', async () => {
    const { erro, consultas } = await comBanco(true, iniciar)

    expect(erro).toBeNull()
    // 1 e 'Não iniciada', 3 e 'Pausada'. Sao os mesmos dois que o `/inicia` do
    // operador aceita, e nao ha um terceiro.
    const update = updateDaAtividade(consultas)
    expect(update).toContain('tipo_situacao_atividade_id = 1')
    expect(update).toContain('tipo_situacao_atividade_id = 3')
  })

  // A PAUSADA COM DONO NAO ENTRA, e e o resto da mesma regra. O `SET` grava
  // `usuario_uuid` com o uuid de quem PEDIU, e quem pede aqui e o gerente: a
  // rota passa `req.usuarioUuid` e o corpo nao tem campo de executor. Sobre a
  // pausada de outra pessoa -- o desfecho NORMAL de um `/problema_atividade` ou
  // de um `POST /atividade/pausar` --, aceitar o code 3 sem olhar o dono
  // trocaria o dono em silencio, e `calcula_fila_pausada.sql` (que filtra por
  // `a.usuario_uuid`) nunca mais devolveria ao operador a folha em que ele
  // parou no meio.
  it('a Pausada só entra se não tiver executor, para não roubar a folha de ninguém', async () => {
    const { consultas } = await comBanco(true, iniciar)
    const update = updateDaAtividade(consultas)

    expect(update).toContain(
      '(tipo_situacao_atividade_id = 3 AND usuario_uuid IS NULL)'
    )
    // Controle negativo do texto exato que estava la antes: o `IN` solta a
    // pausada de qualquer dono.
    expect(update).not.toContain('tipo_situacao_atividade_id IN (1, 3)')
  })

  // A OUTRA METADE DA PROVA: o UPDATE escreve o uuid de quem PEDIU, e por isso
  // e o `WHERE` que tem de barrar a linha de outra pessoa -- nao ha nada no
  // `SET` que preserve o dono.
  it('e o SET continua gravando o uuid de quem pediu, que é o do gerente', async () => {
    const { consultas } = await comBanco(true, iniciar)
    const update = updateDaAtividade(consultas)

    expect(update).toContain(`usuario_uuid = '${UUID}'`)
  })

  it('a atividade que não está nesses dois estados recusa com 400, e não com 500', async () => {
    const { erro } = await comBanco(false, iniciar)

    expect(erro).not.toBeNull()
    expect(erro.statusCode).toBe(400)
    expect(erro.message).toContain('Não iniciada')
    expect(erro.message).toContain('Pausada que ainda não tem executor')
  })
})

describe('finalizar em modo local', () => {
  const finalizar = () =>
    ctrl.finalizaAtividadeModoLocal(
      7,
      OUTRO_UUID,
      '2026-08-01T08:00:00-03:00',
      '2026-08-01T17:00:00-03:00',
      UUID,
      CONTEXTO
    )

  it('cobra a situação no próprio UPDATE, e deixa de fora a finalizada e a descartada', async () => {
    const { erro, consultas } = await comBanco(true, finalizar)

    expect(erro).toBeNull()
    // 1, 2 e 3: o que ainda nao foi encerrado. O 4 ('Finalizada') e o 5 ('Não
    // finalizada') ficam de fora, e e essa a linha inteira do conserto.
    const update = updateDaAtividade(consultas)
    expect(update).toContain('AND tipo_situacao_atividade_id IN (1, 2, 3)')
    expect(update).not.toContain('IN (1, 2, 3, 4)')
  })

  it('finalizar de novo o que já está finalizado recusa com 400', async () => {
    const { erro } = await comBanco(false, finalizar)

    expect(erro).not.toBeNull()
    expect(erro.statusCode).toBe(400)
    expect(erro.message).toContain('já está finalizada')
  })
})
