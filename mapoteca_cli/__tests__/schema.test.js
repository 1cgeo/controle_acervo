// Path: __tests__\schema.test.js
'use strict'

// Testa o formatador de contrato e a validacao local CONTRA OS SCHEMAS REAIS do
// server/, nao contra mocks. E de proposito: o valor do CLI e nao ter copia do
// contrato, e um teste com schema falso testaria justamente a copia.
// Em troca, estes testes quebram quando o schema da mapoteca muda, que e o
// alarme que se quer ter.

const { test } = require('node:test')
const assert = require('node:assert')

const esquema = require('../lib/schema')
const { RECURSOS, obter, carregarSchema } = require('../lib/recursos')

const models = carregarSchema()

test('marca os obrigatorios e le os tipos do Joi vivo', () => {
  const campos = esquema.camposDe(models.pedido)
  const porNome = Object.fromEntries(campos.map(c => [c.nome, c]))

  assert.strictEqual(porNome.data_pedido.obrigatorio, true)
  assert.strictEqual(porNome.cliente_id.obrigatorio, true)
  assert.strictEqual(porNome.situacao_pedido_id.obrigatorio, true)
  assert.strictEqual(porNome.observacao.obrigatorio, false)
})

test('valid() vira lista exaustiva com = e allow() vira lista aditiva com |', () => {
  const porNome = Object.fromEntries(
    esquema.camposDe(models.pedido).map(c => [c.nome, c])
  )
  // .valid(...Object.values(SITUACAO_PEDIDO)): so estes sete codes.
  assert.strictEqual(porNome.situacao_pedido_id.tipo, 'int =1|2|3|4|5|6|7')
  // .allow(null, ''): alem do tipo base.
  assert.ok(porNome.ponto_contato.tipo.includes("|null|''"))
})

test('nao vaza o sentinela {override:true} do describe do Joi', () => {
  // Regressao: o Joi injeta {override:true} no allow do `is` de um when(), e sem
  // filtrar isso o agente leria `situacao_pedido_id={"override":true}|5` e
  // concluiria que ha um valor valido a mais.
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(!texto.includes('override'), `o sentinela vazou no contrato de ${chave}`)
  }
})

test('renderiza o Joi.when() de data_atendimento com a regra dos dois lados', () => {
  const campo = esquema.camposDe(models.pedido).find(c => c.nome === 'data_atendimento')

  assert.strictEqual(campo.tipo, 'condicional')
  const notas = campo.notas.join(' ')
  // 5 = CONCLUIDO. E a invariante que mais custa descobrir pelo 400.
  assert.ok(notas.includes('situacao_pedido_id=5'), 'falta a condicao')
  assert.ok(notas.includes('OBRIGATORIO'), 'falta dizer que ai o campo e exigido')
  assert.ok(notas.includes('senao'), 'falta o caso contrario')
})

test('renderiza o when() de motivo_cancelamento (situacao 6)', () => {
  const campo = esquema.camposDe(models.pedido).find(c => c.nome === 'motivo_cancelamento')
  const notas = campo.notas.join(' ')
  assert.ok(notas.includes('situacao_pedido_id=6'))
  assert.ok(notas.includes('OBRIGATORIO'))
})

test('mostra o min() de data que referencia outro campo, nao so "date"', () => {
  // data_atendimento >= data_pedido e uma regra entre campos: sem renderiza-la o
  // agente monta um corpo aparentemente correto e leva 400.
  const campo = esquema.camposDe(models.pedido).find(c => c.nome === 'data_atendimento')
  assert.ok(campo.notas.join(' ').includes('date>=data_pedido'))
})

test('anota o .raw() das datas, que muda o dia gravado', () => {
  const campo = esquema.camposDe(models.pedido).find(c => c.nome === 'data_pedido')
  assert.ok(campo.notas.some(n => n.includes('YYYY-MM-DD')))
})

test('reconhece guid, pattern e array com minimo', () => {
  const item = Object.fromEntries(
    esquema.camposDe(models.produtoPedido).map(c => [c.nome, c])
  )
  assert.strictEqual(item.uuid_versao.tipo, 'uuid')

  const loc = esquema.camposDe(models.pedidoLocalizador)[0]
  assert.ok(loc.tipo.includes('[A-Z0-9]{4}'))

  const ids = esquema.camposDe(models.pedidoIds)[0]
  assert.strictEqual(ids.tipo, 'array<int>, min 1')
})

test('mostra a description que o autor do schema escreveu', () => {
  // .description() e a unica prosa que o describe() alcanca; jogar fora seria
  // perder informacao de graca.
  const campo = esquema.camposDe(models.plotter).find(c => c.nome === 'vida_util')
  assert.ok(campo.notas.some(n => n.toLowerCase().includes('meses')))
})

test('acusa a validacao .custom() que o describe nao consegue detalhar', () => {
  // A transferencia de estoque recusa origem igual ao destino num .custom(): o
  // contrato impresso NAO e exaustivo ali, e isso precisa ser dito.
  assert.strictEqual(esquema.customDe(models.transferenciaEstoque), true)
  assert.strictEqual(esquema.customDe(models.pedido), false)
})

test('camposDataDe acha as datas, inclusive dentro de um when()', () => {
  const datas = esquema.camposDataDe(models.pedidoAtualizacao)
  assert.ok(datas.includes('data_pedido'))
  assert.ok(datas.includes('prazo'))
  // data_atendimento so vira date dentro do when: e justamente a que estraga o
  // dia gravado se for reenviada como timestamp ISO.
  assert.ok(datas.includes('data_atendimento'))
})

test('soData recorta o timestamp ISO que o servidor devolve', () => {
  assert.strictEqual(esquema.soData('2026-07-24T00:00:00.000Z'), '2026-07-24')
  assert.strictEqual(esquema.soData('2026-07-24'), '2026-07-24')
  assert.strictEqual(esquema.soData(null), null)
})

test('deriva os filtros de listagem do proprio schema de query', () => {
  const filtros = esquema.filtrosDe(obter('consumo').schema()).map(f => f.nome)
  assert.deepStrictEqual(filtros.sort(), ['data_fim', 'data_inicio', 'tipo_material_id'])
  // Pedido nao tem filtro no servidor: dizer "nenhum" e melhor que inventar um.
  assert.deepStrictEqual(esquema.filtrosDe(obter('pedido').schema()), [])
})

test('validarCorpo recusa corpo incompleto sem tocar a rede', () => {
  const r = esquema.validarCorpo(models.pedido, { data_pedido: '2026-07-24' })
  assert.strictEqual(r.ok, false)
  const campos = r.erros.map(e => e.campo)
  assert.ok(campos.includes('cliente_id'))
  assert.ok(campos.includes('situacao_pedido_id'))
})

test('validarCorpo aceita corpo completo e aplica os defaults', () => {
  const r = esquema.validarCorpo(models.pedido, {
    data_pedido: '2026-07-24',
    cliente_id: 3,
    situacao_pedido_id: 3
  })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, [])
  assert.deepStrictEqual(r.valor.palavras_chave, [])
  assert.strictEqual(r.valor.previsto_pit, false)
})

test('exige data_atendimento quando a situacao e concluido', () => {
  const r = esquema.validarCorpo(models.pedido, {
    data_pedido: '2026-07-24',
    cliente_id: 3,
    situacao_pedido_id: 5
  })
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.campo === 'data_atendimento'))
})

test('recusa data_atendimento anterior a data_pedido', () => {
  const r = esquema.validarCorpo(models.pedido, {
    data_pedido: '2026-07-24',
    data_atendimento: '2026-07-01',
    cliente_id: 3,
    situacao_pedido_id: 5
  })
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.campo === 'data_atendimento'))
})

test('acusa campo com nome errado, que o servidor descartaria calado', () => {
  const r = esquema.validarCorpo(models.pedido, {
    data_pedido: '2026-07-24',
    cliente_id: 3,
    situacao_pedido_id: 3,
    prazo_entrega: '2026-08-30'
  })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, ['prazo_entrega'])
})

test('explicarErro imprime o contrato so dos campos que falharam', () => {
  const r = esquema.validarCorpo(models.produtoPedido, { quantidade: 5 })
  const texto = esquema.explicarErro(models.produtoPedido, r.erros)

  assert.ok(texto.includes('nada foi enviado'))
  assert.ok(texto.includes('uuid_versao'), 'falta o campo que falhou')
  assert.ok(texto.includes('uuid'), 'falta o tipo do campo que falhou')
  assert.ok(!texto.includes('producao_especifica'), 'trouxe campo que nao falhou')
})

test('todo recurso da registry renderiza contrato sem quebrar', () => {
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(texto.length > 0, `${chave} devolveu contrato vazio`)
    assert.ok(texto.includes('rotas'), `${chave} nao listou rotas`)
    // A forma do CRUD da mapoteca precisa aparecer em TODO recurso: e o que
    // impede o agente de tentar PUT /recurso/:id e levar 404.
    assert.ok(texto.includes('o id vai no CORPO'), `${chave} nao avisou do PUT`)
    assert.ok(texto.includes('sempre em LOTE'), `${chave} nao avisou do DELETE em lote`)
  }
})

test('a chave de ids do delete bate com a que o schema exige', () => {
  // Se a registry e o schema divergirem, o DELETE monta um corpo que o servidor
  // recusa. Este teste amarra os dois.
  for (const chave of Object.keys(RECURSOS)) {
    const recurso = RECURSOS[chave]
    const doSchema = esquema.camposDe(recurso.schema().ids).map(c => c.nome)
    assert.deepStrictEqual(
      doSchema, [recurso.chaveIds],
      `${chave}: registry diz "${recurso.chaveIds}", schema diz "${doSchema.join(',')}"`
    )
  }
})
