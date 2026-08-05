'use strict'

// Os comandos de EFETIVO, contra o schema REAL de server/src/efetivo, nunca
// contra mock: o valor do CLI e nao ter copia do contrato, e um teste com schema
// falso testaria justamente a copia.
//
// O alvo e a DECISAO: o que se recusa antes de sair da maquina, e o que o
// guardrail exige. A requisicao de escrita e trocada no proprio modulo http, que
// e um singleton CommonJS. Nada sobe servidor.

const { test } = require('node:test')
const assert = require('node:assert')

const { parse } = require('../lib/args')
const http = require('../lib/http')
const esquema = require('../lib/schema')
const { obter, obterOperacao } = require('../lib/recursos')
const efetivo = require('../comandos/efetivo')

const U1 = '3f2a1c88-0000-4000-8000-000000000001'
const CFG = { server: 'http://exemplo.invalido', cliente: 'sca_web' }

const rodar = argv => efetivo.executar(parse(argv), CFG)

/** Executa esperando recusa, e devolve o erro. */
async function recusa (argv) {
  try {
    await rodar(argv)
  } catch (err) {
    return err
  }
  throw new Error('esperava recusa, e o comando passou')
}

// ---------------------------------------------------------------------------
// A registry contra o servidor
// ---------------------------------------------------------------------------

// Este teste e o alarme: se o efetivo_schema.js do server/ renomear uma chave,
// ele quebra aqui em vez de quebrar num 500 no meio de um cadastro.
test('toda operacao de efetivo aponta uma chave que existe no schema vivo', () => {
  const recurso = obter('efetivo')
  const modulo = recurso.schema()
  for (const [acao, op] of Object.entries(recurso.operacoes)) {
    for (const campo of ['corpo', 'query', 'params']) {
      if (!op[campo]) continue
      assert.ok(modulo[op[campo]], `${acao}: ${campo} "${op[campo]}" nao existe no schema`)
      assert.strictEqual(
        typeof modulo[op[campo]].describe, 'function',
        `${acao}: ${op[campo]} nao e um schema Joi`
      )
    }
  }
})

// A guarda de /api/efetivo e verifyAdmin em TUDO, inclusive na leitura: a
// resposta traz licenca de saude e funcao acumulada, nominalmente. Anunciar
// "exige login" numa delas faria o agente concluir que um usuario comum le.
test('nenhuma rota de efetivo se anuncia com menos que administrador', () => {
  for (const [acao, op] of Object.entries(obter('efetivo').operacoes)) {
    assert.strictEqual(op.acesso, 'admin', `${acao} anuncia acesso ${op.acesso}`)
  }
})

test('efetivo e rota de PLATAFORMA: sem prefixo de modulo', () => {
  for (const [acao, op] of Object.entries(obter('efetivo').operacoes)) {
    assert.ok(
      op.caminho.startsWith('/efetivo/'),
      `${acao} aponta ${op.caminho}, fora de /efetivo`
    )
  }
})

// ---------------------------------------------------------------------------
// O verbo digitado vira operacao
// ---------------------------------------------------------------------------

test('o subverbo compoe a chave da operacao', () => {
  assert.strictEqual(efetivo.resolverOperacao(parse(['mapa'])), 'mapa')
  assert.strictEqual(efetivo.resolverOperacao(parse(['periodos'])), 'periodos')
  assert.strictEqual(efetivo.resolverOperacao(parse(['periodos', 'criar'])), 'periodos criar')
  assert.strictEqual(
    efetivo.resolverOperacao(parse(['impedimentos', 'excluir'])), 'impedimentos excluir'
  )
})

test('subverbo desconhecido ensina quais existem, sem tocar a rede', () => {
  assert.throws(
    () => efetivo.resolverOperacao(parse(['periodos', 'apagar'])),
    /Verbo desconhecido "apagar"[\s\S]*criar, editar, excluir/
  )
  assert.strictEqual(efetivo.precisaServidor(parse(['periodos', 'apagar'])), false)
})

test('o --dry-run de uma escrita nao exige servidor nem credencial', () => {
  const argv = ['periodos', 'criar', '--data', '{}', '--dry-run']
  assert.strictEqual(efetivo.precisaServidor(parse(argv)), false)
  assert.strictEqual(efetivo.precisaServidor(parse(['periodos', 'criar'])), true)
})

// ---------------------------------------------------------------------------
// Validacao local contra o Joi vivo
// ---------------------------------------------------------------------------

test('criar periodo recusa uuid invalido antes de sair da maquina', async () => {
  const err = await recusa([
    'periodos', 'criar', '--data', '{"usuario_uuid": "nao-e-uuid"}', '--dry-run'
  ])
  assert.ok(err.jaFormatado, 'a recusa sai formatada, sem o prefixo [erro]')
  assert.ok(err.message.includes('nada foi enviado'))
  assert.ok(/usuario_uuid/.test(err.message))
  assert.ok(/data_inicio/.test(err.message), 'o obrigatorio que falta precisa aparecer')
})

test('criar periodo aceita data_fim nula, que e "sem previsao de saida"', async () => {
  const r = await rodar([
    'periodos', 'criar', '--dry-run',
    '--data', `{"usuario_uuid": "${U1}", "data_inicio": "2026-01-05", "data_fim": null}`
  ])
  assert.ok(r.texto.includes('POST /api/efetivo/periodos'))
  assert.ok(r.texto.includes('[dry-run] nada foi enviado'))
})

// O militar nao entra no PUT: trocar de dono reescreveria de quem e o periodo.
// Se o schema passar a aceitar, o CLI para de avisar e o campo grava calado.
test('o PUT de periodo nao aceita trocar o militar', () => {
  const modulo = obter('efetivo').schema()
  const campos = esquema.camposDe(modulo.atualizarPeriodo).map(c => c.nome)
  assert.ok(!campos.includes('usuario_uuid'), 'o dono do periodo nao pode ser editavel')
  assert.ok(campos.includes('data_inicio'))
})

test('o percentual de impedimento nao aceita zero nem passa de 100', () => {
  const modulo = obter('efetivo').schema()
  // Zero seria um impedimento que nao impede; acima de 100 nao existe.
  assert.strictEqual(esquema.validarCorpo(modulo.atualizarImpedimento, {
    descricao: 'Licenca', percentual: 0, data_inicio: '2026-03-01'
  }).ok, false)
  assert.strictEqual(esquema.validarCorpo(modulo.atualizarImpedimento, {
    descricao: 'Licenca', percentual: 101, data_inicio: '2026-03-01'
  }).ok, false)
  assert.strictEqual(esquema.validarCorpo(modulo.atualizarImpedimento, {
    descricao: 'Licenca', percentual: 100, data_inicio: '2026-03-01'
  }).ok, true)
})

// O corpo entra por JSON na linha de comando, entao "50" (string) e um erro
// facil de cometer, e o .strict() do servidor o recusaria.
test('o percentual e strict: "50" nao vira 50', () => {
  const modulo = obter('efetivo').schema()
  const r = esquema.validarCorpo(modulo.atualizarImpedimento, {
    descricao: 'Licenca', percentual: '50', data_inicio: '2026-03-01'
  })
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.campo === 'percentual'))
})

test('campo com nome errado vira aviso, e o servidor o descartaria calado', async () => {
  const r = await rodar([
    'impedimentos', 'criar', '--dry-run', '--data',
    `{"usuario_uuid": "${U1}", "descricao": "Licenca", "percentual": 50, ` +
    '"data_inicio": "2026-03-01", "percentagem": 9}'
  ])
  assert.ok(r.avisos.some(a => a.includes('percentagem')))
  assert.ok(!r.texto.includes('percentagem'), 'o campo descartado nao pode ir no corpo')
})

// ---------------------------------------------------------------------------
// Query
// ---------------------------------------------------------------------------

test('o mes exige ano E mes, e a listagem so filtra por ano', () => {
  const modulo = obter('efetivo').schema()
  const doMes = esquema.camposDe(modulo.anoMesQuery)
  assert.deepStrictEqual(doMes.map(c => c.nome).sort(), ['ano', 'mes'])
  assert.ok(doMes.every(c => c.obrigatorio), 'os dois sao obrigatorios no schema')

  const doAno = esquema.camposDe(modulo.anoQuery)
  assert.deepStrictEqual(doAno.map(c => c.nome), ['ano'])
  assert.strictEqual(doAno[0].obrigatorio, false)
})

// Sem este aviso, um --mes que a rota nao le sai como "listou o ano inteiro" e
// quem chamou conclui coisa errada sobre o efetivo.
test('filtro que a operacao nao aceita vira aviso, nunca silencio', async () => {
  const r = await rodar(['periodos', '--ano', '2026', '--mes', '7', '--dry-run'])
  assert.ok(r.avisos.some(a => a.includes('Filtros ignorados') && a.includes('mes')))
  assert.ok(r.texto.includes('/api/efetivo/periodos?ano=2026'))
})

test('o mapa recusa localmente a falta do ano, que e obrigatorio', async () => {
  const err = await recusa(['mapa', '--dry-run'])
  assert.ok(err.message.includes('ano'))
})

// ---------------------------------------------------------------------------
// Guardrail da exclusao
// ---------------------------------------------------------------------------

test('excluir periodo sem --confirmar recusa e diz o que se perde', async () => {
  const err = await recusa(['periodos', 'excluir', '--id', '12'])
  assert.ok(err.jaFormatado)
  assert.ok(err.message.includes('nao ha tabela de deletados'))
  assert.ok(err.message.includes('--confirmar 12'))
  assert.ok(err.message.includes('--dry-run'), 'a recusa precisa oferecer o modo de olhar')
})

test('excluir nao aceita --confirmar de outro registro', async () => {
  const err = await recusa(['periodos', 'excluir', '--id', '12', '--confirmar', '99'])
  assert.ok(err.message.includes('Operacao irreversivel'))
})

// Exigir --confirmar para poder OLHAR inverte o guardrail: confirmar as cegas
// e exatamente o que ele existe para impedir.
test('o --dry-run do excluir NAO exige confirmacao', async () => {
  const r = await rodar(['impedimentos', 'excluir', '--id', '30', '--dry-run'])
  assert.ok(r.texto.includes('DELETE /api/efetivo/impedimentos/30'))
  assert.ok(r.texto.includes('nada foi enviado'))
})

test('editar sem --id recusa nomeando a rota, em vez de montar /undefined', async () => {
  const err = await recusa([
    'impedimentos', 'editar', '--dry-run',
    '--data', '{"descricao": "Licenca", "percentual": 50, "data_inicio": "2026-03-01"}'
  ])
  assert.ok(err.message.includes('exige --id'))
  assert.ok(!err.message.includes('undefined'))
})

// O :id entra por encodeURIComponent, e nao por concatenacao.
test('o id vai codificado no caminho', () => {
  const { operacao } = obterOperacao('efetivo', 'periodos excluir')
  const { montarCaminho } = require('../lib/recursos')
  assert.strictEqual(montarCaminho(operacao, { id: 12 }), '/efetivo/periodos/12')
  assert.strictEqual(montarCaminho(operacao, { id: 'a b' }), '/efetivo/periodos/a%20b')
})

// ---------------------------------------------------------------------------
// Saida
// ---------------------------------------------------------------------------

test('excluir confirmado envia o DELETE e devolve a mensagem do servidor', async () => {
  const original = http.autenticada
  let enviado = null
  http.autenticada = async (cfg, metodo, caminho) => {
    enviado = { metodo, caminho }
    return { message: 'Passagem excluída com sucesso' }
  }
  try {
    const r = await rodar(['periodos', 'excluir', '--id', '12', '--confirmar', '12'])
    assert.deepStrictEqual(enviado, { metodo: 'DELETE', caminho: '/efetivo/periodos/12' })
    assert.strictEqual(r.texto, 'Passagem excluída com sucesso')
  } finally {
    http.autenticada = original
  }
})

// O mapa devolve { ano, semanas, anual }: despejar a grade semana a semana
// gastaria a janela do agente com o que nao responde "como foi o ano".
test('o mapa mostra o fechamento anual e deixa a grade para o --json', () => {
  const dados = {
    ano: 2026,
    semanas: [{ semana: 1 }, { semana: 2 }, { semana: 3 }],
    anual: [{ nome_guerra: 'Silva', dias: 300, aproveitamento: 82 }]
  }
  const out = efetivo.formatarMapa(dados, { formato: 'tsv' })
  assert.ok(out.texto.includes('Silva'))
  assert.ok(out.texto.includes('3 semana(s)'))
  assert.ok(!out.texto.includes('"semana"'), 'a grade nao entra na saida legivel')
})

test('ano sem passagem nenhuma diz isso, em vez de sair em branco', () => {
  const out = efetivo.formatarMapa({ ano: 2026, semanas: [], anual: [] }, { formato: 'tsv' })
  assert.ok(out.texto.includes('nenhuma passagem cadastrada'))
})
