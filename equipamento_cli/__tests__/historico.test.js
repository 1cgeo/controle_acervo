'use strict'

// `equipamento_id` TEM DOIS SIGNIFICADOS nos quatro historicos, e a diferenca
// custa um lancamento perdido:
//
//   listar --equipamento_id 5   FILTRO: "os lancamentos DO bem 5"
//   editar --equipamento_id 9   CAMPO DO CORPO: "passe este lancamento PARA o 9"
//
// Como nenhum historico tem GET por id, toda alteracao le o registro na LISTA
// antes de reenvia-lo inteiro. Se essa leitura usasse `equipamento_id` como
// filtro, `editar --equipamento_id 9` procuraria o lancamento no bem de DESTINO,
// onde ele ainda nao esta -- e o comando responderia "nao encontrado" para um
// registro que existe. Por isso a leitura e SEM FILTRO, de proposito.

const { test } = require('node:test')
const assert = require('node:assert')

const http = require('../lib/http')
const comandoHistorico = require('../comandos/historico')

const CFG = { server: 'http://servidor-de-teste', token: 'tk' }

async function comRede (respostas, fn) {
  const original = http.autenticada
  const chamadas = []
  http.autenticada = async (cfg, metodo, caminho, opcoes = {}) => {
    chamadas.push({ metodo, caminho, corpo: opcoes.corpo })
    const chave = `${metodo} ${caminho}`
    if (!(chave in respostas)) throw new Error(`chamada inesperada: ${chave}`)
    return respostas[chave]
  }
  try {
    return await fn(chamadas)
  } finally {
    http.autenticada = original
  }
}

const executar = (posicionais, flags = {}) =>
  comandoHistorico.executar({ _: posicionais, flags }, CFG)

const corpoDoPut = (chamadas) => chamadas.find(c => c.metodo === 'PUT').corpo
const gets = (chamadas) => chamadas.filter(c => c.metodo === 'GET').map(c => c.caminho)

// A indisponibilidade 11, lancada no bem 5 por engano: ela e do bem 9.
const LANCAMENTO = {
  id: 11,
  equipamento_id: 5,
  nr_patrimonio: '104820700014462',
  modelo: 'TOPCON CTS-3007',
  data_inicio: '2026-05-11T03:00:00.000Z',
  data_fim: null,
  motivo: 'Cabeçote danificado',
  previsao_retorno: '2026-12-31T03:00:00.000Z'
}

// ---------------------------------------------------------------------------
// Os dois significados
// ---------------------------------------------------------------------------

test('listar --equipamento_id manda o FILTRO na query', () => {
  return comRede({
    'GET /equipamento/indisponibilidade?equipamento_id=5': { dados: [LANCAMENTO] }
  }, async (chamadas) => {
    await executar(['indisponibilidade', 'listar'], { equipamento_id: '5' })
    assert.deepStrictEqual(gets(chamadas), ['/equipamento/indisponibilidade?equipamento_id=5'])
  })
})

test('editar --equipamento_id MOVE o lancamento, e o procura sem filtro', () => {
  return comRede({
    // A leitura e da colecao INTEIRA. Um `?equipamento_id=9` aqui procuraria o
    // lancamento no bem de destino, onde ele ainda nao esta.
    'GET /equipamento/indisponibilidade': { dados: [LANCAMENTO] },
    'PUT /equipamento/indisponibilidade/11': { message: 'ok' }
  }, async (chamadas) => {
    const r = await executar(['indisponibilidade', 'editar'], { id: '11', equipamento_id: '9' })

    // 1. A LEITURA foi sem filtro nenhum.
    assert.deepStrictEqual(gets(chamadas), ['/equipamento/indisponibilidade'])

    // 2. E o corpo do PUT MOVE o lancamento para o bem 9, com o resto inteiro.
    const corpo = corpoDoPut(chamadas)
    assert.strictEqual(corpo.equipamento_id, 9)
    assert.strictEqual(corpo.motivo, 'Cabeçote danificado')
    assert.strictEqual(corpo.data_inicio, '2026-05-11')
    assert.strictEqual(corpo.previsao_retorno, '2026-12-31')
    assert.strictEqual(corpo.data_fim, null)

    // 3. E o antes/depois nomeia a mudanca de dono, que e o ato caro aqui.
    assert.ok(r.texto.includes('equipamento_id: 5 -> 9'), r.texto)
  })
})

test('o mesmo vale nos quatro historicos, e nao so na indisponibilidade', () => {
  // Quatro copias do comando divergiriam: bastaria uma esquecer a leitura sem
  // filtro para o defeito existir num canto e nao no outro.
  const CASOS = [
    ['indisponibilidade', LANCAMENTO],
    ['afastamento', {
      id: 3, equipamento_id: 5, nr_patrimonio: '1', modelo: 'x',
      om: '3º BPE', motivo: 'Apoio', data_inicio: '2026-04-09',
      previsao_termino: null, data_fim: null
    }],
    ['manutencao', {
      id: 1, equipamento_id: 5, nr_patrimonio: '1', modelo: 'x',
      indisponibilidade_id: 11, data_inicio: '2026-05-11', data_fim: null,
      descricao: null, valor: null, valor_orcado: '600.00', valor_pdr: '600.00',
      certame: 'Contrata+Brasil'
    }],
    ['transferencia', {
      id: 8, equipamento_id: 5, nr_patrimonio: '1', modelo: 'x',
      tipo_id: 3, tipo: 'Descarga', situacao_id: 1, situacao: 'Solicitada',
      om: null, documento_solicitacao: null, data_solicitacao: null,
      data_transferencia: null, transferido_siafi: false, apropriado_siafi: false,
      publicacao_autorizacao: null, descricao: null
    }]
  ]

  return CASOS.reduce((cadeia, [chave, registro]) => cadeia.then(() => comRede({
    [`GET /equipamento/${chave}`]: { dados: [registro] },
    [`PUT /equipamento/${chave}/${registro.id}`]: { message: 'ok' }
  }, async (chamadas) => {
    await executar([chave, 'editar'], { id: String(registro.id), equipamento_id: '9' })

    assert.deepStrictEqual(gets(chamadas), [`/equipamento/${chave}`], chave)
    assert.strictEqual(corpoDoPut(chamadas).equipamento_id, 9, chave)
  })), Promise.resolve())
})

test('id que nao esta na lista erra explicando que nao ha GET por id', () => {
  return comRede({
    'GET /equipamento/indisponibilidade': { dados: [LANCAMENTO] }
  }, async () => {
    await assert.rejects(
      () => executar(['indisponibilidade', 'editar'], { id: '999', motivo: 'x' }),
      (err) => {
        assert.ok(err.message.includes('999 não foi encontrado'))
        assert.ok(err.message.includes('não tem GET por id'))
        // O numero de linhas lidas: sem ele, "nao encontrado" nao distingue
        // "id errado" de "a lista veio vazia".
        assert.ok(err.message.includes('1 linha(s)'), err.message)
        return true
      }
    )
  })
})

// ---------------------------------------------------------------------------
// `fechar`: gravar data_fim sem apagar o resto
// ---------------------------------------------------------------------------

test('fechar reenvia o corpo INTEIRO, e nao so a data', () => {
  // Mandar so {"data_fim": "..."} apagaria motivo, previsao e data de inicio,
  // calado, porque o PUT deste modulo SUBSTITUI a linha.
  return comRede({
    'GET /equipamento/indisponibilidade': { dados: [LANCAMENTO] },
    'PUT /equipamento/indisponibilidade/11': { message: 'ok' }
  }, async (chamadas) => {
    await executar(['indisponibilidade', 'fechar'], { id: '11', data_fim: '2026-08-01' })

    const corpo = corpoDoPut(chamadas)
    assert.strictEqual(corpo.data_fim, '2026-08-01')
    assert.strictEqual(corpo.motivo, 'Cabeçote danificado')
    assert.strictEqual(corpo.previsao_retorno, '2026-12-31')
    assert.strictEqual(corpo.equipamento_id, 5, 'o dono nao podia mudar num fechar')
  })
})

test('fechar sem a data NAO assume hoje', () => {
  // Quem fecha um lancamento sabe o dia em que ele terminou, e o dia de hoje
  // raramente e o dia em que o bem voltou.
  return comRede({
    'GET /equipamento/indisponibilidade': { dados: [LANCAMENTO] }
  }, async (chamadas) => {
    await assert.rejects(
      () => executar(['indisponibilidade', 'fechar'], { id: '11' }),
      (err) => {
        assert.ok(err.message.includes('fechar precisa da data'))
        assert.ok(err.message.includes('--data_fim'))
        return true
      }
    )
    assert.ok(!chamadas.some(c => c.metodo === 'PUT'))
  })
})

test('fechar um lancamento JA fechado avisa que a data substitui a anterior', () => {
  const fechado = { ...LANCAMENTO, data_fim: '2026-07-01T03:00:00.000Z' }
  return comRede({
    'GET /equipamento/indisponibilidade': { dados: [fechado] },
    'PUT /equipamento/indisponibilidade/11': { message: 'ok' }
  }, async () => {
    const r = await executar(['indisponibilidade', 'fechar'], { id: '11', data_fim: '2026-08-01' })
    assert.ok(r.avisos.join(' ').includes('JÁ estava fechado em 2026-07-01'), r.avisos.join(' '))
  })
})

test('a data de fim ANTERIOR ao inicio e recusada LOCALMENTE, com a frase do schema', () => {
  // O schema cobra `data_fim >= data_inicio` com Joi.ref, espelhando o CHECK
  // `*_fim_apos_inicio` do DDL. Recusar aqui poupa a requisicao e a mensagem sai
  // em portugues, que e a que o servidor tambem devolveria.
  return comRede({
    'GET /equipamento/indisponibilidade': { dados: [LANCAMENTO] }
  }, async (chamadas) => {
    await assert.rejects(
      () => executar(['indisponibilidade', 'fechar'], { id: '11', data_fim: '2026-01-01' }),
      (err) => {
        assert.ok(err.jaFormatado, 'o erro tinha de vir com o contrato junto')
        assert.ok(err.message.includes('igual ou posterior'), err.message)
        assert.ok(err.message.includes('nada foi enviado'))
        return true
      }
    )
    assert.ok(!chamadas.some(c => c.metodo === 'PUT'))
  })
})

test('transferencia NAO tem fechar, e o erro diz o que fazer no lugar', () => {
  // A ausencia e a regra: ela nao dura, ela se resolve. Encerrar uma e mudar a
  // SITUACAO.
  return comRede({}, async (chamadas) => {
    await assert.rejects(
      () => executar(['transferencia', 'fechar'], { id: '8', data_fim: '2026-08-01' }),
      (err) => {
        assert.ok(err.message.includes('não dura'))
        assert.ok(err.message.includes('situacao_id'))
        return true
      }
    )
    assert.deepStrictEqual(chamadas, [], 'nao podia ter tocado a rede')
  })
})

// ---------------------------------------------------------------------------
// `--aberta`: a mesma flag, tres significados
// ---------------------------------------------------------------------------

test('--aberta sozinha vira `true` porque o SCHEMA diz que ela e booleana', () => {
  // O parser devolve `true` para a flag sem valor, e quem traduz isso e o TIPO
  // lido do Joi -- nao uma lista de booleanas escrita no CLI. Um campo booleano
  // novo no schema passa a se comportar assim sem tocar em arquivo nenhum.
  return comRede({
    'GET /equipamento/afastamento?aberta=true': { dados: [] }
  }, async (chamadas) => {
    const r = await executar(['afastamento', 'listar'], { aberta: true })
    assert.deepStrictEqual(gets(chamadas), ['/equipamento/afastamento?aberta=true'])
    assert.ok(r.avisos.join(' ').includes('sem data_fim'), r.avisos.join(' '))
  })
})

test('--aberta na transferencia significa a SITUACAO, e o comando avisa', () => {
  // A diferenca e invisivel na resposta: sem dizer qual regra valeu, uma lista
  // curta se le errado.
  return comRede({
    'GET /equipamento/transferencia?aberta=true': { dados: [] }
  }, async () => {
    const r = await executar(['transferencia', 'listar'], { aberta: true })
    const avisos = r.avisos.join(' ')
    assert.ok(avisos.includes('SITUAÇÃO que não terminou'), avisos)
    assert.ok(avisos.includes('não tem data_fim'), avisos)
  })
})

test('flag que nao e filtro deste recurso vira aviso, e nao vai na query', () => {
  return comRede({
    'GET /equipamento/manutencao': { dados: [] }
  }, async (chamadas) => {
    const r = await executar(['manutencao', 'listar'], { certame: 'Contrata+Brasil' })
    assert.deepStrictEqual(gets(chamadas), ['/equipamento/manutencao'])
    assert.ok(r.avisos.join(' ').includes('certame'))
  })
})

// ---------------------------------------------------------------------------
// Criacao e exclusao
// ---------------------------------------------------------------------------

test('abrir um lancamento sem campo nenhum ensina onde esta o contrato', () => {
  return comRede({}, async (chamadas) => {
    await assert.rejects(
      () => executar(['manutencao', 'abrir'], {}),
      (err) => {
        assert.ok(err.message.includes('equipamento schema manutencao'))
        return true
      }
    )
    assert.deepStrictEqual(chamadas, [])
  })
})

test('abrir sem o dono e recusado LOCALMENTE: equipamento_id e obrigatorio no POST', () => {
  return comRede({}, async (chamadas) => {
    await assert.rejects(
      () => executar(['indisponibilidade', 'abrir'], {
        data_inicio: '2026-05-11', motivo: 'Cabeçote danificado'
      }),
      (err) => {
        assert.ok(err.message.includes('equipamento_id'), err.message)
        assert.ok(err.message.includes('nada foi enviado'))
        return true
      }
    )
    assert.deepStrictEqual(chamadas, [])
  })
})

test('o verbo de criacao da transferencia e `lancar`, e a acao errada ensina os verbos', () => {
  return comRede({}, async () => {
    await assert.rejects(
      () => executar(['transferencia', 'inventar'], {}),
      (err) => {
        assert.ok(err.message.includes('listar, lancar, editar, apagar'), err.message)
        return true
      }
    )
    await assert.rejects(
      () => executar(['manutencao', 'inventar'], {}),
      (err) => {
        assert.ok(err.message.includes('listar, abrir, fechar, editar, apagar'), err.message)
        return true
      }
    )
  })
})

test('apagar um lancamento exige confirmacao e AVISA que a situacao do bem muda', () => {
  return comRede({
    'DELETE /equipamento/indisponibilidade/11': { message: 'Lançamento excluído.' }
  }, async (chamadas) => {
    await assert.rejects(
      () => executar(['indisponibilidade', 'apagar'], { id: '11' }),
      (err) => {
        assert.ok(err.message.includes('--confirmar 11'))
        return true
      }
    )
    assert.deepStrictEqual(chamadas, [])

    const r = await executar(['indisponibilidade', 'apagar'], { id: '11', confirmar: '11' })
    // Apagar muda a situacao DERIVADA do bem: o degrau que aquela linha
    // sustentava deixa de valer.
    assert.ok(r.avisos.join(' ').includes('situação derivada'), r.avisos.join(' '))
  })
})
