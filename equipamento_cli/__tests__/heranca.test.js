'use strict'

// A HERANCA DE VIDA UTIL NO `alterar`, e por que um ciclo ingenuo a rompe EM
// SILENCIO.
//
// `GET /api/equipamento/:id` devolve `vida_util_meses` JA RESOLVIDO por
// `COALESCE(e.vida_util_meses, t.vida_util_meses)`, e `vida_util_herdada` diz
// quando o numero veio do TIPO, com a coluna do bem em NULO.
//
// Um ciclo ler-mesclar-reenviar ingenuo gravaria esse numero na coluna do BEM.
// A partir dali o bem passa a declarar a propria vida util e mudar a do tipo
// deixa de alcanca-lo -- e NADA acusa, porque o valor gravado e igual ao que a
// tela ja mostrava.
//
// Entao a heranca e preservada como NULO, e so um `--vida_util_meses` explicito
// a rompe.

const { test } = require('node:test')
const assert = require('node:assert')

const http = require('../lib/http')
const comandoBem = require('../comandos/bem')

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
  comandoBem.executar({ _: posicionais, flags }, CFG)

const corpoDoPut = (chamadas) => chamadas.find(c => c.metodo === 'PUT').corpo

// A estacao total do patrimonio 104820700014462: 120 meses que vieram do TIPO
// 'Estação Total'. A coluna `equipamento.vida_util_meses` dela esta NULA.
const BEM_HERDADO = {
  id: 1,
  nr_patrimonio: '104820700014462',
  classe_id: 6, classe: 'VI',
  tipo_id: 1, tipo: 'Estação Total',
  modelo: 'TOPCON CTS-3007',
  nr_serie: null,
  data_entrada_carga: '2014-07-29',
  vida_util_meses: 120,
  vida_util_herdada: true,
  secao_detentora_id: 1, secao_detentora: 'Cia Lev',
  ativo: true,
  situacao_id: 1, situacao: 'Disponível',
  observacao: null
}

/** O mesmo bem, mas com vida util PROPRIA gravada na coluna dele. */
const BEM_PROPRIO = { ...BEM_HERDADO, vida_util_meses: 96, vida_util_herdada: false }

const respostasDe = (bem) => ({
  'GET /equipamento/1': { dados: bem },
  'PUT /equipamento/1': { message: 'Equipamento atualizado.' }
})

test('alterar OUTRA COISA num bem que herda nao materializa a heranca', () => {
  return comRede(respostasDe(BEM_HERDADO), async (chamadas) => {
    await executar(['alterar'], { id: '1', nr_serie: 'CT3007-77' })

    const corpo = corpoDoPut(chamadas)
    assert.strictEqual(corpo.nr_serie, 'CT3007-77')
    // ESTA e a linha que importa: NULO, e nao 120. Com 120 aqui, o bem pararia
    // de acompanhar o tipo sem que nada mudasse na tela.
    assert.strictEqual(corpo.vida_util_meses, null)
  })
})

test('e o comando DIZ que reenviou nulo, com o numero herdado no aviso', () => {
  return comRede(respostasDe(BEM_HERDADO), async () => {
    const r = await executar(['alterar'], { id: '1', nr_serie: 'CT3007-77' })
    const avisos = r.avisos.join(' | ')
    assert.ok(avisos.includes('HERDADA do tipo (120 meses)'), avisos)
    assert.ok(avisos.includes('--vida_util_meses'), avisos)
  })
})

test('so --vida_util_meses EXPLICITO rompe a heranca', () => {
  return comRede(respostasDe(BEM_HERDADO), async (chamadas) => {
    const r = await executar(['alterar'], { id: '1', vida_util_meses: '84' })

    assert.strictEqual(corpoDoPut(chamadas).vida_util_meses, 84)
    // E aqui o aviso da heranca NAO aparece: ninguem esta preservando nada, a
    // pessoa pediu a mudanca.
    assert.ok(!r.avisos.join(' ').includes('HERDADA do tipo'))
    assert.ok(r.texto.includes('vida_util_meses: 120 -> 84'), r.texto)
  })
})

test('--vida_util_meses null DEVOLVE a heranca de um bem que declarava a propria', () => {
  return comRede(respostasDe(BEM_PROPRIO), async (chamadas) => {
    await executar(['alterar'], { id: '1', vida_util_meses: 'null' })
    // Em branco NAO e zero: e "volta a valer a do tipo". O token `null` na linha
    // de comando e a unica porta para limpar um campo num PUT que substitui.
    assert.strictEqual(corpoDoPut(chamadas).vida_util_meses, null)
  })
})

test('bem com vida util PROPRIA a mantem quando se altera outra coisa', () => {
  // O outro lado da regra: o cuidado com a heranca nao pode apagar o valor de
  // quem declarou o proprio.
  return comRede(respostasDe(BEM_PROPRIO), async (chamadas) => {
    const r = await executar(['alterar'], { id: '1', nr_serie: 'CT3007-77' })
    assert.strictEqual(corpoDoPut(chamadas).vida_util_meses, 96)
    assert.ok(!r.avisos.join(' ').includes('HERDADA do tipo'))
  })
})

test('`baixar` um bem que herda tambem preserva a heranca', () => {
  // `baixar` monta o corpo pelo mesmo caminho de `alterar`: se a preservacao
  // valesse so num dos dois, dar baixa congelaria a vida util do bem.
  return comRede(respostasDe(BEM_HERDADO), async (chamadas) => {
    await executar(['baixar'], { id: '1' })
    const corpo = corpoDoPut(chamadas)
    assert.strictEqual(corpo.ativo, false)
    assert.strictEqual(corpo.vida_util_meses, null)
  })
})

test('o --dry-run faz o GET e NAO faz o PUT, e ja mostra o nulo', () => {
  // Nao ha como montar o corpo completo sem ler o bem, e o comando diz isso em
  // vez de fingir que nada saiu da maquina.
  return comRede({ 'GET /equipamento/1': { dados: BEM_HERDADO } }, async (chamadas) => {
    const r = await executar(['alterar'], { id: '1', modelo: 'TOPCON X', 'dry-run': true })

    assert.ok(!chamadas.some(c => c.metodo === 'PUT'))
    assert.ok(r.texto.includes('[dry-run]'))
    assert.ok(r.texto.includes('o GET do bem FOI feito'))
    assert.ok(r.texto.includes('"vida_util_meses": null'), r.texto)
  })
})

test('`ver` explica de onde veio o numero, em MESES', () => {
  // Sem a marca, um 120 na tela nao diz se o bem declarou a propria ou se pegou
  // a do tipo, e quem for editar acha que o campo esta preenchido.
  return comRede({ 'GET /equipamento/1': { dados: BEM_HERDADO } }, async () => {
    const r = await executar(['ver'], { id: '1' })
    assert.ok(r.texto.includes('vida útil: 120 MESES'), r.texto)
    assert.ok(r.texto.includes('herdada do tipo'), r.texto)
  })
})

test('`ver` de um bem com vida util propria nao promete heranca nenhuma', () => {
  return comRede({ 'GET /equipamento/1': { dados: BEM_PROPRIO } }, async () => {
    const r = await executar(['ver'], { id: '1' })
    assert.ok(r.texto.includes('vida útil: 96 MESES'), r.texto)
    assert.ok(!r.texto.includes('herdada do tipo'), r.texto)
  })
})

test('`ver --patrimonio` casa por igualdade EXATA, e nao chuta o parecido', () => {
  // Nao ha filtro por patrimonio na rota de listagem: o casamento e feito aqui,
  // sobre a lista inteira. Patrimonio que nao casa vira aviso com os parecidos.
  const lista = [BEM_HERDADO, { ...BEM_HERDADO, id: 2, nr_patrimonio: '1048207000144620' }]
  return comRede({
    'GET /equipamento': { dados: lista },
    'GET /equipamento/1': { dados: BEM_HERDADO }
  }, async () => {
    const r = await executar(['ver'], { patrimonio: '104820700014462' })
    assert.ok(r.texto.includes('TOPCON CTS-3007'))
  })
})

test('patrimonio que nao existe erra NOMEANDO os parecidos, sem chutar', () => {
  return comRede({ 'GET /equipamento': { dados: [BEM_HERDADO] } }, async () => {
    await assert.rejects(
      () => executar(['ver'], { patrimonio: '1048207' }),
      (err) => {
        assert.ok(err.message.includes('Nenhum bem com o patrimônio 1048207'))
        assert.ok(err.message.includes('Contêm esse trecho'))
        return true
      }
    )
  })
})

test('patrimonio DUPLICADO recusa em vez de escolher um dos dois', () => {
  // A planilha tem o caso real: `104821500017429` em duas linhas, dois bens
  // diferentes. Escolher um deles em silencio alteraria o bem errado.
  const duplicado = [
    { ...BEM_HERDADO, id: 53, nr_patrimonio: '104821500017429', modelo: 'Spectra SP 60' },
    { ...BEM_HERDADO, id: 57, nr_patrimonio: '104821500017429', modelo: 'RUIDE RTK QUASAR R93I' }
  ]
  return comRede({ 'GET /equipamento': { dados: duplicado } }, async () => {
    await assert.rejects(
      () => executar(['ver'], { patrimonio: '104821500017429' }),
      (err) => {
        assert.ok(err.message.includes('ids 53, 57'), err.message)
        assert.ok(err.message.includes('escolha pelo id'))
        return true
      }
    )
  })
})

test('`baixar --para` nao se confunde com baixar ARQUIVO', () => {
  // `baixar` aqui e dar BAIXA no bem. Quem digitou `--para` queria o download do
  // relatorio, e sem esta checagem daria baixa num equipamento por engano.
  return comRede({}, async () => {
    await assert.rejects(
      () => executar(['baixar'], { id: '1', para: 'relatorio.ods' }),
      (err) => {
        assert.ok(err.message.includes('dar BAIXA no bem'))
        assert.ok(err.message.includes('equipamento relatorio dmt'))
        return true
      }
    )
  })
})

test('apagar exige a confirmacao repetindo o id', () => {
  return comRede({}, async (chamadas) => {
    await assert.rejects(
      () => executar(['apagar'], { id: '1' }),
      (err) => {
        assert.ok(err.message.includes('irreversível'))
        assert.ok(err.message.includes('--confirmar 1'))
        return true
      }
    )
    assert.deepStrictEqual(chamadas, [], 'nada podia ter saido pela rede')
  })
})

test('apagar com a confirmacao certa segue, e AVISA que baixar seria melhor', () => {
  return comRede({ 'DELETE /equipamento/1': { message: 'Bem excluído.' } }, async () => {
    const r = await executar(['apagar'], { id: '1', confirmar: '1' })
    assert.ok(r.avisos.join(' ').includes('se BAIXA'))
  })
})
