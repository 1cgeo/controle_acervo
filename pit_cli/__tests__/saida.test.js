'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const saida = require('../lib/saida')

// Amostra no formato que a GRADE do PIT devolve (colunas reais do SELECT de
// pit_execucao_ctrl.js, inclusive o campo `meses`, que e json agregado).
const GRADE = [
  {
    meta_id: 12,
    ano: 2026,
    numero_meta: 1,
    item: '1D',
    descricao: 'Carta Topográfica 1:25.000',
    unidade: 'Folha',
    demandante: 'COTER',
    quantidade_prevista: 24,
    prazo: '2026-12-20',
    origem_id: 3,
    origem: 'Produção',
    cancelada: false,
    revisao: 'R1',
    revisao_id: 4,
    folha: true,
    meses: [
      // Quatro chaves, e nao seis: `data_conclusao` e `observacao` sairam da
      // celula na 1.44.0. A amostra imita a resposta de hoje.
      { id: 90, mes: 3, planejada: 2, realizada: 2 },
      { id: 91, mes: 4, planejada: 3, realizada: 0 }
    ],
    realizado: 2,
    planejado: 5
  },
  {
    meta_id: 13,
    ano: 2026,
    numero_meta: 2,
    item: null,
    descricao: 'Marco geodésico implantado',
    unidade: 'Marco',
    demandante: null,
    quantidade_prevista: null,
    prazo: null,
    origem_id: 1,
    origem: 'Manual',
    cancelada: true,
    revisao: 'R0',
    revisao_id: 3,
    folha: true,
    meses: [],
    realizado: 0,
    planejado: 0
  }
]

test('numero formata com separador de milhar pt-BR', () => {
  assert.strictEqual(saida.numero(1234567), '1.234.567')
  assert.strictEqual(saida.numero(24), '24')
  assert.strictEqual(saida.numero(-250), '-250')
  assert.strictEqual(saida.numero(null), '-')
  assert.strictEqual(saida.numero(87.5, 1), '87,5')
})

test('celula trata nulo, booleano, contagem, lista e data ISO', () => {
  assert.strictEqual(saida.celula('prazo', null), '-')
  assert.strictEqual(saida.celula('cancelada', true), 'sim')
  assert.strictEqual(saida.celula('folha', false), 'não')
  assert.strictEqual(saida.celula('quantidade_prevista', 1500), '1.500')
  // Hora nao ajuda a ler plano anual e custa caracteres: cai fora.
  assert.strictEqual(saida.celula('data_cadastramento', '2026-06-12T09:30:00.000Z'), '2026-06-12')
})

test('array de objetos vira contagem, e array de escalares cabe inteiro', () => {
  // A grade traz doze meses por linha. Despejados no TSV, eles sozinhos passam
  // do resto da linha inteira; a contagem diz que ha dado sem gastar a janela.
  assert.strictEqual(saida.celula('meses', GRADE[0].meses), '[2]')
  assert.strictEqual(saida.celula('meses', []), '-')
  assert.strictEqual(saida.celula('militares', ['a', 'b']), 'a;b')
})

test('objeto raso de escalares sai legivel, e nao como contagem', () => {
  assert.strictEqual(
    saida.objetoRaso({ planejado: 5, realizado: 2 }),
    'planejado=5;realizado=2'
  )
})

test('sem --campos usa as colunas padrao da operacao, nao todas', () => {
  const padrao = ['meta_id', 'numero_meta', 'item', 'realizado']
  const { colunas } = saida.escolherColunas(GRADE, null, padrao)
  assert.deepStrictEqual(colunas, padrao)
})

test('--campos tem precedencia sobre o padrao', () => {
  const { colunas } = saida.escolherColunas(GRADE, ['descricao', 'realizado'], ['meta_id'])
  assert.deepStrictEqual(colunas, ['descricao', 'realizado'])
})

test('coluna inexistente vira aviso, nunca coluna vazia calada', () => {
  const { colunas, faltam } = saida.escolherColunas(GRADE, ['descricao', 'valor_total'], null)
  assert.deepStrictEqual(colunas, ['descricao'])
  assert.deepStrictEqual(faltam, ['valor_total'])
})

test('o recorte reduz mesmo o tamanho da saida', () => {
  // A razao de ser do --campos: e o teste que falha se o recorte parar de valer.
  const completo = saida.lista(GRADE, { formato: 'json' }).texto
  const recortado = saida.lista(GRADE, {
    formato: 'tsv',
    campos: ['numero_meta', 'item', 'quantidade_prevista', 'realizado']
  }).texto

  assert.ok(
    recortado.length < completo.length / 3,
    `esperava recorte de pelo menos 3x, obtive ${completo.length} -> ${recortado.length}`
  )
})

test('tsv poe uma linha de cabecalho e uma por registro', () => {
  const { texto } = saida.lista(GRADE, { formato: 'tsv', campos: ['numero_meta', 'realizado'] })
  const linhas = texto.split('\n').filter(l => l && !l.startsWith('('))
  assert.strictEqual(linhas[0], 'numero_meta\trealizado')
  assert.strictEqual(linhas.length, 3)
})

test('lista vazia diz que esta vazia, em vez de sair em branco', () => {
  assert.strictEqual(saida.lista([], {}).texto, '(nenhum registro)')
})

test('lista de ESCALARES sai como valores, e nao em branco', () => {
  // O que as rotas /anos devolvem. Sem este ramo, escolherColunas nao acharia
  // chave nenhuma e a saida viria vazia, dizendo "nao tem" onde tem.
  const { texto } = saida.lista([2026, 2025, 2024], {})
  assert.ok(texto.startsWith('2026\n2025\n2024'))
  assert.ok(texto.includes('3 valores'))
})

test('o rodape conta registros e quantas colunas foram omitidas', () => {
  const { texto } = saida.lista(GRADE, { formato: 'tsv', campos: ['numero_meta'] })
  assert.ok(texto.includes('2 registros'))
  assert.ok(/1 de \d+ colunas/.test(texto))
})

test('--json devolve tudo, sem recorte', () => {
  const { texto } = saida.lista(GRADE, { formato: 'json', campos: ['numero_meta'] })
  const voltou = JSON.parse(texto)
  assert.strictEqual(voltou.length, 2)
  assert.ok('meses' in voltou[0], 'o --json precisa manter todas as colunas')
  assert.strictEqual(voltou[0].meses.length, 2, 'o --json nao pode resumir o aninhado')
})

test('registro unico sai como pares chave e valor', () => {
  const texto = saida.registro(GRADE[0], { campos: ['numero_meta', 'quantidade_prevista'] })
  assert.ok(texto.includes('numero_meta'))
  assert.ok(texto.includes('24'))
  assert.ok(!texto.includes('descricao'))
})
