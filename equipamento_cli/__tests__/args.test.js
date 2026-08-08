'use strict'

// O parser proprio, sem dependencia externa, e o roteamento do comando.
//   Rodar: cd equipamento_cli && node --test

const { test } = require('node:test')
const assert = require('node:assert')

const { parse, exigir, lista, texto, valorDeFlag, BOOLEANAS } = require('../lib/args')
const esquema = require('../lib/schema')
const { obter, historicos, listarChaves } = require('../lib/recursos')
const { ROTEADOR, VERBOS_BEM } = require('../equipamento')

test('separa posicionais de flags com valor', () => {
  const r = parse(['indisponibilidade', 'listar', '--equipamento_id', '5'])
  assert.deepStrictEqual(r._, ['indisponibilidade', 'listar'])
  assert.strictEqual(r.flags.equipamento_id, '5')
})

test('aceita a forma --flag=valor, sem consumir o proximo argumento', () => {
  const r = parse(['listar', '--tipo_id=6', '--campos=id,modelo'])
  assert.strictEqual(r.flags.tipo_id, '6')
  assert.strictEqual(r.flags.campos, 'id,modelo')
})

test('flag booleana de verdade nao engole o proximo argumento', () => {
  const r = parse(['cadastrar', '--dry-run', '--data', '{}'])
  assert.strictEqual(r.flags['dry-run'], true)
  assert.strictEqual(r.flags.data, '{}')
})

test('flag desconhecida sem valor vira booleana em vez de engolir a proxima', () => {
  const r = parse(['listar', '--ativo', '--json'])
  assert.strictEqual(r.flags.ativo, true)
  assert.strictEqual(r.flags.json, true)
})

test('`--` encerra as flags', () => {
  const r = parse(['ver', '--id', '1', '--', '--nao-e-flag'])
  assert.deepStrictEqual(r._, ['ver', '--nao-e-flag'])
})

test('exigir recusa flag sem valor em vez de deixar `true` vazar para a URL', () => {
  assert.throws(() => exigir({ id: true }, 'id', 'id do bem'), /Falta --id/)
  assert.throws(() => exigir({}, 'id'), /Falta --id/)
  assert.strictEqual(exigir({ id: '7' }, 'id'), '7')
})

test('lista e texto tratam a flag sozinha como ausente', () => {
  assert.deepStrictEqual(lista('id, modelo ,'), ['id', 'modelo'])
  assert.strictEqual(lista(true), null)
  assert.strictEqual(texto({ patrimonio: true }, 'patrimonio'), null)
  assert.strictEqual(texto({ patrimonio: '104820700014462' }, 'patrimonio'), '104820700014462')
})

// ---------------------------------------------------------------------------
// O TIPO vem do Joi, e nao de uma lista de booleanas escrita no CLI
// ---------------------------------------------------------------------------

test('as booleanas do SCHEMA ficam fora da lista fixa do parser, de proposito', () => {
  // Elas aceitam valor (`--ativo false`), entao nao podem ser booleanas do
  // parser. Quem decide o que `--ativo` sozinha significa e o TIPO declarado no
  // Joi, lido em tempo de execucao.
  for (const campo of ['ativo', 'aberta', 'transferido_siafi', 'apropriado_siafi']) {
    assert.ok(!BOOLEANAS.has(campo), `${campo} virou booleana fixa do parser`)
  }
})

test('flag sozinha vira `true` no campo booleano, e some no campo que nao e', () => {
  const filtros = Object.fromEntries(
    esquema.filtrosDe(obter('bem').schema()).map(f => [f.nome, f.tipo])
  )
  assert.strictEqual(filtros.ativo, 'bool')

  assert.strictEqual(valorDeFlag(true, filtros.ativo), true)
  // `--situacao_id` sozinha nao quer dizer nada: deixar passar poria um `true`
  // dentro da query, e a lista voltaria filtrada por um valor que ninguem pediu.
  assert.strictEqual(valorDeFlag(true, filtros.situacao_id), undefined)
  assert.strictEqual(valorDeFlag('4', filtros.situacao_id), '4')
})

// ---------------------------------------------------------------------------
// O roteamento
// ---------------------------------------------------------------------------

test('os verbos do BEM sao comandos de primeiro nivel', () => {
  // `equipamento listar` le melhor que `equipamento bem listar`, e o bem e o
  // assunto do modulo.
  assert.deepStrictEqual(VERBOS_BEM, ['listar', 'ver', 'cadastrar', 'alterar', 'baixar', 'apagar'])
  for (const verbo of VERBOS_BEM) {
    assert.strictEqual(ROTEADOR[verbo], './comandos/bem', verbo)
  }
})

test('os quatro historicos roteiam para o MESMO comando', () => {
  assert.deepStrictEqual(historicos(), [
    'indisponibilidade', 'afastamento', 'manutencao', 'transferencia'
  ])
  for (const chave of historicos()) {
    assert.strictEqual(ROTEADOR[chave], './comandos/historico', chave)
  }
})

test('todo recurso da registry tem porta de entrada no roteador', () => {
  // Recurso sem rota no roteador e recurso que aparece no `schema` e nao se
  // deixa usar: o agente le o contrato e leva "comando desconhecido".
  for (const chave of listarChaves()) {
    const alcancavel = chave === 'bem'
      ? VERBOS_BEM.every(v => ROTEADOR[v])
      : Boolean(ROTEADOR[chave])
    assert.ok(alcancavel, `o recurso ${chave} nao tem comando`)
  }
})

test('todo modulo do roteador existe e exporta executar', () => {
  for (const [comando, caminho] of Object.entries(ROTEADOR)) {
    const cmd = require('../' + caminho.replace('./', ''))
    assert.strictEqual(typeof cmd.executar, 'function', comando)
  }
})

test('o `schema` NAO exige servidor: o contrato e conhecimento local', () => {
  // Cobrar SCA_URL para imprimir o contrato tiraria do agente o jeito mais
  // barato de conferir um corpo antes de tentar de verdade.
  assert.ok(!require('../comandos/schema').precisaServidor)
})
