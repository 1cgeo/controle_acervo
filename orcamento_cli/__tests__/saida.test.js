// Path: __tests__\saida.test.js
'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const saida = require('../lib/saida')

// Amostra no formato que o listar de NC devolve (colunas reais do SELECT do
// nota_credito_ctrl.js, inclusive as resolvidas por JOIN).
const NCS = [
  {
    id: 42,
    numero: '2026NC000123',
    ano: 2026,
    data_emissao: '2026-06-12T00:00:00.000Z',
    cod_nd: '339040',
    nd_nome: 'Servicos de Tecnologia da Informacao',
    valor_nc: '15000.00',
    valor_recolhido: '0.00',
    classificacao_id: 1,
    classificacao_nome: 'PDR',
    pdr_item_id: 3,
    meta_pit_id: 7,
    numero_meta: 2,
    marcador: null,
    nc_complementada_id: null,
    arquivo_id: 11,
    arquivo_nome: 'nc123.pdf'
  },
  {
    id: 43,
    numero: '2026NC000124',
    ano: 2026,
    data_emissao: '2026-07-01T00:00:00.000Z',
    cod_nd: '449052',
    nd_nome: 'Equipamentos e Material Permanente',
    valor_nc: '1234567.89',
    valor_recolhido: null,
    classificacao_id: 2,
    classificacao_nome: 'Extra-PDR',
    pdr_item_id: null,
    meta_pit_id: null,
    numero_meta: null,
    marcador: null,
    nc_complementada_id: null,
    arquivo_id: null,
    arquivo_nome: null
  }
]

test('moeda formata no padrao pt-BR', () => {
  assert.strictEqual(saida.moeda('1234567.89'), '1.234.567,89')
  assert.strictEqual(saida.moeda(15000), '15.000,00')
  assert.strictEqual(saida.moeda(-250.5), '-250,50')
  assert.strictEqual(saida.moeda(null), '-')
})

test('celula trata nulo, booleano, valor monetario e data ISO', () => {
  assert.strictEqual(saida.celula('marcador', null), '-')
  assert.strictEqual(saida.celula('ativo', true), 'sim')
  assert.strictEqual(saida.celula('valor_nc', '15000.00'), '15.000,00')
  // Hora nao ajuda a ler orcamento e custa caracteres: cai fora.
  assert.strictEqual(saida.celula('data_emissao', '2026-06-12T00:00:00.000Z'), '2026-06-12')
})

test('sem --campos usa as colunas padrao do recurso, nao todas', () => {
  const padrao = ['id', 'numero', 'cod_nd', 'valor_nc']
  const { colunas } = saida.escolherColunas(NCS, null, padrao)
  assert.deepStrictEqual(colunas, padrao)
})

test('--campos tem precedencia sobre o padrao', () => {
  const { colunas } = saida.escolherColunas(NCS, ['numero', 'valor_nc'], ['id', 'numero'])
  assert.deepStrictEqual(colunas, ['numero', 'valor_nc'])
})

test('coluna inexistente vira aviso, nunca coluna vazia calada', () => {
  const { colunas, faltam } = saida.escolherColunas(NCS, ['numero', 'valor_total'], null)
  assert.deepStrictEqual(colunas, ['numero'])
  assert.deepStrictEqual(faltam, ['valor_total'])
})

test('o recorte reduz mesmo o tamanho da saida', () => {
  // A razao de ser do --campos: e o teste que falha se o recorte parar de valer.
  const completo = saida.lista(NCS, { formato: 'json' }).texto
  const recortado = saida.lista(NCS, {
    formato: 'tsv',
    campos: ['numero', 'cod_nd', 'valor_nc', 'classificacao_nome']
  }).texto

  assert.ok(
    recortado.length < completo.length / 3,
    `esperava recorte de pelo menos 3x, obtive ${completo.length} -> ${recortado.length}`
  )
})

test('tsv poe uma linha de cabecalho e uma por registro', () => {
  const { texto } = saida.lista(NCS, { formato: 'tsv', campos: ['numero', 'valor_nc'] })
  const linhas = texto.split('\n').filter(l => l && !l.startsWith('('))
  assert.strictEqual(linhas[0], 'numero\tvalor_nc')
  assert.strictEqual(linhas.length, 3)
  assert.ok(linhas[1].includes('15.000,00'))
})

test('lista vazia diz que esta vazia, em vez de sair em branco', () => {
  assert.strictEqual(saida.lista([], {}).texto, '(nenhum registro)')
})

test('o rodape conta registros e quantas colunas foram omitidas', () => {
  const { texto } = saida.lista(NCS, { formato: 'tsv', campos: ['numero'] })
  assert.ok(texto.includes('2 registros'))
  assert.ok(/1 de \d+ colunas/.test(texto))
})

test('--json devolve tudo, sem recorte', () => {
  const { texto } = saida.lista(NCS, { formato: 'json', campos: ['numero'] })
  const voltou = JSON.parse(texto)
  assert.strictEqual(voltou.length, 2)
  assert.ok('arquivo_nome' in voltou[0], 'o --json precisa manter todas as colunas')
})

test('registro unico sai como pares chave e valor', () => {
  const texto = saida.registro(NCS[0], { campos: ['numero', 'valor_nc'] })
  assert.ok(texto.includes('numero'))
  assert.ok(texto.includes('15.000,00'))
  assert.ok(!texto.includes('arquivo_nome'))
})
