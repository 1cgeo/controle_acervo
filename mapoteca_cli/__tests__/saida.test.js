'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const saida = require('../lib/saida')

// Amostra no formato que o listar de pedido devolve (colunas reais do SELECT do
// mapoteca_ctrl.js, inclusive as resolvidas por JOIN).
const PEDIDOS = [
  {
    id: 116,
    data_pedido: '2026-07-24T00:00:00.000Z',
    data_atendimento: null,
    cliente_id: 41,
    cliente_nome: '6 Regimento de Cavalaria Blindado',
    situacao_pedido_id: 3,
    situacao_pedido_nome: 'Em andamento',
    documento_solicitacao: 'DIEx 123-S/3',
    documento_solicitacao_nup: '64536.000123/2026-11',
    prazo: '2026-08-30T00:00:00.000Z',
    demandante: '6 RCB / 3a Secao',
    palavras_chave: ['Extra-PIT', 'fronteira'],
    previsto_pit: false,
    operacao: null,
    localizador_pedido: 'A1B2-C3D4-E5F6',
    localizador_envio: null,
    observacao_envio: null,
    usuario_criacao_nome: 'Fulano',
    data_criacao: '2026-07-24T13:02:11.000Z',
    quantidade_produtos: '12',
    itens_impressos: '0'
  },
  {
    id: 117,
    data_pedido: '2026-07-25T00:00:00.000Z',
    data_atendimento: '2026-07-25T00:00:00.000Z',
    cliente_id: 12,
    cliente_nome: 'Prefeitura Municipal de Alegrete',
    situacao_pedido_id: 5,
    situacao_pedido_nome: 'Concluido',
    documento_solicitacao: 'Oficio 9/2026',
    documento_solicitacao_nup: null,
    prazo: null,
    demandante: null,
    palavras_chave: [],
    previsto_pit: true,
    operacao: null,
    localizador_pedido: 'G7H8-I9J0-K1L2',
    localizador_envio: null,
    observacao_envio: null,
    usuario_criacao_nome: 'Fulano',
    data_criacao: '2026-07-25T09:00:00.000Z',
    quantidade_produtos: '3',
    itens_impressos: '3'
  }
]

test('moeda formata no padrao pt-BR', () => {
  assert.strictEqual(saida.moeda('1234567.89'), '1.234.567,89')
  assert.strictEqual(saida.moeda(15000), '15.000,00')
  assert.strictEqual(saida.moeda(-250.5), '-250,50')
  assert.strictEqual(saida.moeda(null), '-')
})

test('celula trata nulo, booleano e data ISO', () => {
  assert.strictEqual(saida.celula('prazo', null), '-')
  assert.strictEqual(saida.celula('previsto_pit', true), 'sim')
  assert.strictEqual(saida.celula('previsto_pit', false), 'nao')
  // Hora nao responde nenhuma pergunta da mapoteca e custa caracteres.
  assert.strictEqual(saida.celula('data_pedido', '2026-07-24T00:00:00.000Z'), '2026-07-24')
})

test('quantidade NAO e formatada como dinheiro', () => {
  // O modo de falha que este teste tranca: tratar toda coluna numerica como
  // moeda faria "5 folhas" virar "5,00" e a leitura da fila ficar ambigua.
  assert.strictEqual(saida.celula('quantidade', 5), '5')
  assert.strictEqual(saida.celula('quantidade_produtos', '12'), '12')
  assert.strictEqual(saida.celula('valor', '1500'), '1.500,00')
  assert.strictEqual(saida.celula('custo_manutencao_total', 2300), '2.300,00')
})

test('array vira lista separada por ponto e virgula, nao JSON', () => {
  assert.strictEqual(saida.celula('palavras_chave', ['fronteira', 'op']), 'fronteira;op')
  assert.strictEqual(saida.celula('palavras_chave', []), '-')
})

test('sem --campos usa as colunas padrao do recurso, nao todas', () => {
  const padrao = ['id', 'data_pedido', 'cliente_nome', 'prazo']
  const { colunas } = saida.escolherColunas(PEDIDOS, null, padrao)
  assert.deepStrictEqual(colunas, padrao)
})

test('--campos tem precedencia sobre o padrao', () => {
  const { colunas } = saida.escolherColunas(PEDIDOS, ['id', 'prazo'], ['id', 'cliente_nome'])
  assert.deepStrictEqual(colunas, ['id', 'prazo'])
})

test('coluna inexistente vira aviso, nunca coluna vazia calada', () => {
  const { colunas, faltam } = saida.escolherColunas(PEDIDOS, ['id', 'data_limite'], null)
  assert.deepStrictEqual(colunas, ['id'])
  assert.deepStrictEqual(faltam, ['data_limite'])
})

test('o recorte reduz mesmo o tamanho da saida', () => {
  // A razao de ser do --campos: e o teste que falha se o recorte parar de valer.
  const completo = saida.lista(PEDIDOS, { formato: 'json' }).texto
  const recortado = saida.lista(PEDIDOS, {
    formato: 'tsv',
    campos: ['id', 'cliente_nome', 'situacao_pedido_nome', 'prazo']
  }).texto

  assert.ok(
    recortado.length < completo.length / 3,
    `esperava recorte de pelo menos 3x, obtive ${completo.length} -> ${recortado.length}`
  )
})

test('tsv poe uma linha de cabecalho e uma por registro', () => {
  const { texto } = saida.lista(PEDIDOS, { formato: 'tsv', campos: ['id', 'cliente_nome'] })
  const linhas = texto.split('\n').filter(l => l && !l.startsWith('('))
  assert.strictEqual(linhas[0], 'id\tcliente_nome')
  assert.strictEqual(linhas.length, 3)
  assert.ok(linhas[1].includes('6 Regimento de Cavalaria Blindado'))
})

test('lista vazia diz que esta vazia, em vez de sair em branco', () => {
  assert.strictEqual(saida.lista([], {}).texto, '(nenhum registro)')
})

// Quem le com os olhos quer a frase; quem processa em lote quer JSON valido. A
// lista vazia respondia a frase nos DOIS casos, e o `JSON.parse` de quem
// automatiza quebrava justamente na consulta que nao achou nada.
test('lista vazia em --json sai como [], e nao como frase', () => {
  const { texto } = saida.lista([], { formato: 'json' })
  assert.strictEqual(texto, '[]')
  assert.deepStrictEqual(JSON.parse(texto), [])
})

test('o rodape conta registros e quantas colunas foram omitidas', () => {
  const { texto } = saida.lista(PEDIDOS, { formato: 'tsv', campos: ['id'] })
  assert.ok(texto.includes('2 registros'))
  assert.ok(/1 de \d+ colunas/.test(texto))
})

test('--json devolve tudo, sem recorte', () => {
  const { texto } = saida.lista(PEDIDOS, { formato: 'json', campos: ['id'] })
  const voltou = JSON.parse(texto)
  assert.strictEqual(voltou.length, 2)
  assert.ok('localizador_pedido' in voltou[0], 'o --json precisa manter todas as colunas')
})

test('registro unico sai como pares chave e valor', () => {
  const texto = saida.registro(PEDIDOS[0], { campos: ['id', 'cliente_nome'] })
  assert.ok(texto.includes('cliente_nome'))
  assert.ok(!texto.includes('localizador_pedido'))
})
