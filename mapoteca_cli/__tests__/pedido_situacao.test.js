'use strict'

// Testes com node:test (embutido no Node), nao jest: ver args.test.js.
//   Rodar: cd mapoteca_cli && npm test
//
// O que estes testes trancam
// --------------------------
// `mapoteca pedido situacao` nasceu antes da rota estreita. Naquela epoca so
// existia o `PUT /mapoteca/pedido`, que vai na COLECAO e SUBSTITUI a linha
// inteira: campo que o corpo nao traz volta ao default, com 200 e sem aviso.
// Por isso o verbo lia o pedido, remontava as 24 chaves de `pedidoAtualizacao`
// e reenviava tudo.
//
// Desde 2026-08-24 existe `PUT /mapoteca/pedido/:id/situacao`, que escreve TRES
// colunas (situacao_pedido_id, data_atendimento, motivo_cancelamento) e nao
// toca em mais nada. Ela e o caminho certo para o caso simples: reescrever 24
// colunas para mudar uma e raio de explosao de graca, porque qualquer campo que
// o GET nao devolva volta a null.
//
// A rota estreita NAO cobre `localizador_envio` nem `observacao_envio`, que o
// verbo aceita por flag. Nesses dois casos o caminho largo continua sendo o
// unico que existe, e o teste tranca isso tambem.

const { test } = require('node:test')
const assert = require('node:assert')

const http = require('../lib/http')
const { VERBOS } = require('../comandos/pedido')

const CAMINHO = '/mapoteca/pedido'
const ID = 42

// Recorte do GET /mapoteca/pedido/:id, na forma que o servidor devolve: as
// datas chegam como timestamp ISO, e nao como dia de calendario.
function pedidoBase (extra) {
  return Object.assign({
    id: ID,
    data_pedido: '2026-07-01T03:00:00.000Z',
    data_atendimento: null,
    cliente_id: 146,
    cliente_nome: 'Comissão Regional de Obras da 3ª Região Militar',
    situacao_pedido_id: 3,
    situacao_pedido_nome: 'Em andamento',
    ponto_contato: 'Cap Silva',
    contato_mapoteca: null,
    documento_solicitacao: 'DIEx 123',
    documento_solicitacao_nup: null,
    endereco_entrega: null,
    forma_entrega_id: null,
    palavras_chave: [],
    operacao: null,
    prazo: null,
    demandante: null,
    previsto_pit: false,
    meta_pit_id: null,
    data_prevista: null,
    canal_recebimento_id: null,
    municipio: null,
    qtd_imagens: null,
    observacao: 'entregar em maos',
    localizador_envio: null,
    observacao_envio: null,
    // Os tres campos que o caminho largo apagaria se o GET nao os trouxesse.
    observacao_interna: 'conferido pelo sargenteante',
    motivo_cancelamento: null
  }, extra || {})
}

/**
 * Substitui a rede. O GET devolve o pedido (o segundo GET e a conferencia, e
 * devolve o pedido ja com a situacao nova), e toda escrita fica registrada.
 */
function comServidor (pedido, nova, fn) {
  const original = http.autenticada
  const originalPausa = http.pausa
  const escritas = []
  let gets = 0

  http.pausa = async () => {}
  http.autenticada = async (cfg, metodo, caminho, opcoes = {}) => {
    if (metodo === 'GET') {
      gets++
      const depois = gets > 1 && nova !== null
        ? Object.assign({}, pedido, { situacao_pedido_id: nova, situacao_pedido_nome: `code ${nova}` })
        : pedido
      return { dados: depois }
    }
    escritas.push({ metodo, caminho, corpo: opcoes.corpo })
    return { message: 'Situação do pedido atualizada com sucesso' }
  }

  return fn(escritas).finally(() => {
    http.autenticada = original
    http.pausa = originalPausa
  })
}

test('caso simples: escreve pela rota ESTREITA, e nao na colecao', async () => {
  await comServidor(pedidoBase(), 5, async escritas => {
    await VERBOS.situacao({
      _: ['pedido', 'situacao'],
      flags: { id: String(ID), situacao: '5', 'data-atendimento': '2026-08-25' }
    }, {})

    assert.strictEqual(escritas.length, 1)
    const put = escritas[0]
    assert.strictEqual(put.metodo, 'PUT')
    assert.strictEqual(put.caminho, `${CAMINHO}/${ID}/situacao`)
    assert.deepStrictEqual(Object.keys(put.corpo).sort(), ['data_atendimento', 'situacao_pedido_id'])
    assert.strictEqual(put.corpo.situacao_pedido_id, 5)
    assert.strictEqual(put.corpo.data_atendimento, '2026-08-25')
  })
})

test('a rota estreita nao carrega o id no corpo nem os campos do pedido', async () => {
  await comServidor(pedidoBase(), 4, async escritas => {
    await VERBOS.situacao({
      _: ['pedido', 'situacao'],
      flags: { id: String(ID), situacao: '4' }
    }, {})

    const corpo = escritas[0].corpo
    for (const campo of ['id', 'cliente_id', 'data_pedido', 'observacao_interna', 'ponto_contato']) {
      assert.ok(!(campo in corpo), `"${campo}" nao pertence ao corpo da rota estreita`)
    }
    assert.deepStrictEqual(corpo, { situacao_pedido_id: 4 })
  })
})

test('RN02: a data JA GRAVADA satisfaz o Concluido sem --data-atendimento', async () => {
  // Sem isto o Joi de `pedidoSituacao` recusaria o corpo, porque Concluido exige
  // data_atendimento e a flag nao veio. Reenviar a data que ja esta na linha e
  // gravacao identica, e vem recortada em 'AAAA-MM-DD': mandar o timestamp ISO
  // faria a coluna DATE guardar o dia anterior em UTC-3.
  const pedido = pedidoBase({ data_atendimento: '2026-07-30T03:00:00.000Z' })
  await comServidor(pedido, 5, async escritas => {
    await VERBOS.situacao({
      _: ['pedido', 'situacao'],
      flags: { id: String(ID), situacao: '5' }
    }, {})

    assert.strictEqual(escritas[0].caminho, `${CAMINHO}/${ID}/situacao`)
    assert.strictEqual(escritas[0].corpo.data_atendimento, '2026-07-30')
  })
})

test('RN03: o motivo ja gravado satisfaz o Cancelado sem --motivo', async () => {
  const pedido = pedidoBase({ motivo_cancelamento: 'pedido duplicado' })
  await comServidor(pedido, 6, async escritas => {
    await VERBOS.situacao({
      _: ['pedido', 'situacao'],
      flags: { id: String(ID), situacao: '6' }
    }, {})

    assert.strictEqual(escritas[0].corpo.motivo_cancelamento, 'pedido duplicado')
  })
})

test('--localizador-envio cai no caminho LARGO, que a rota estreita nao cobre', async () => {
  await comServidor(pedidoBase(), 4, async escritas => {
    await VERBOS.situacao({
      _: ['pedido', 'situacao'],
      flags: { id: String(ID), situacao: '4', 'localizador-envio': 'BR123456789BR' }
    }, {})

    const put = escritas[0]
    assert.strictEqual(put.caminho, CAMINHO, 'localizador_envio nao existe na rota estreita')
    assert.strictEqual(put.corpo.localizador_envio, 'BR123456789BR')
    assert.strictEqual(put.corpo.id, ID)
    // O caminho largo substitui a linha inteira: os campos que o GET trouxe tem
    // de voltar no corpo, ou voltam a null com 200 e sem aviso.
    assert.strictEqual(put.corpo.observacao_interna, 'conferido pelo sargenteante')
    assert.strictEqual(put.corpo.ponto_contato, 'Cap Silva')
  })
})

test('--observacao-envio tambem cai no caminho LARGO', async () => {
  await comServidor(pedidoBase(), 4, async escritas => {
    await VERBOS.situacao({
      _: ['pedido', 'situacao'],
      flags: { id: String(ID), situacao: '4', 'observacao-envio': 'seguiu pelos Correios' }
    }, {})

    assert.strictEqual(escritas[0].caminho, CAMINHO)
    assert.strictEqual(escritas[0].corpo.observacao_envio, 'seguiu pelos Correios')
  })
})

test('--dry-run nao escreve, e diz a rota que usaria', async () => {
  await comServidor(pedidoBase(), null, async escritas => {
    const r = await VERBOS.situacao({
      _: ['pedido', 'situacao'],
      flags: { id: String(ID), situacao: '5', 'data-atendimento': '2026-08-25', 'dry-run': true }
    }, {})

    assert.strictEqual(escritas.length, 0, 'o dry-run escreveu')
    assert.match(r.texto, /nada foi GRAVADO/)
    assert.match(r.texto, new RegExp(`PUT /api${CAMINHO}/${ID}/situacao`))
  })

  await comServidor(pedidoBase(), null, async escritas => {
    const r = await VERBOS.situacao({
      _: ['pedido', 'situacao'],
      flags: { id: String(ID), situacao: '4', 'localizador-envio': 'BR1', 'dry-run': true }
    }, {})

    assert.strictEqual(escritas.length, 0)
    assert.match(r.texto, new RegExp(`PUT /api${CAMINHO}$`, 'm'))
  })
})

test('a conferencia reprova quando o servidor nao gravou', async () => {
  // O `nova` do stub e 3, e nao 5: o GET de volta devolve a situacao ANTIGA.
  await comServidor(pedidoBase(), 3, async () => {
    const r = await VERBOS.situacao({
      _: ['pedido', 'situacao'],
      flags: { id: String(ID), situacao: '5', 'data-atendimento': '2026-08-25' }
    }, {})

    assert.ok(
      r.avisos.some(a => /CONFERENCIA FALHOU/.test(a)),
      `faltou o aviso de conferencia: ${JSON.stringify(r.avisos)}`
    )
  })
})
