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

test('lista vazia com --json sai como [], e nao como prosa', () => {
  // Quem encadeia faz JSON.parse da saida, e o caso mais comum e justamente a
  // consulta que nao achou nada: '(nenhum registro)' quebrava o parse ali.
  assert.strictEqual(saida.lista([], { formato: 'json' }).texto, '[]')
  assert.deepStrictEqual(JSON.parse(saida.lista([], { formato: 'json' }).texto), [])
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

// ---------------------------------------------------------------------------
// `--json` puro: quem encadeia faz JSON.parse do stdout INTEIRO
// ---------------------------------------------------------------------------
//
// Ate 2026-09-05 a escrita colava a mensagem do servidor ANTES do objeto
// gravado, e o envio de arquivo ainda colava o recibo de bytes DEPOIS dele. Os
// dois quebravam o JSON.parse de quem le o id para a chamada seguinte.

const http = require('../lib/http')
const operacao = require('../comandos/operacao')

/** Troca o transporte por uma resposta fixa, e o devolve ao fim. */
async function comResposta (resposta, fn) {
  const antes = http.autenticada
  http.autenticada = async () => resposta
  try {
    return await fn()
  } finally {
    http.autenticada = antes
  }
}

const CORPO_META = JSON.stringify({
  ano: 2026,
  numero_meta: 12,
  item: '1.1',
  descricao: 'Carta topografica 1:25.000',
  unidade_id: 1
})

test('meta criar --json devolve so o registro gravado', async () => {
  const r = await comResposta(
    { message: 'Meta criada com sucesso', dados: { id: 77, numero_meta: 12 } },
    () => operacao.executar({ _: ['meta', 'criar'], flags: { json: true, data: CORPO_META } }, {})
  )
  const voltou = JSON.parse(r.texto)
  assert.strictEqual(voltou.id, 77)
  assert.ok(
    r.avisos.some(a => a.includes('Meta criada')),
    'a mensagem do servidor nao pode sumir: ela so muda de stream (stderr)'
  )
})

test('meta criar sem --json continua mostrando a mensagem junto do registro', async () => {
  const r = await comResposta(
    { message: 'Meta criada com sucesso', dados: { id: 77, numero_meta: 12 } },
    () => operacao.executar({ _: ['meta', 'criar'], flags: { data: CORPO_META } }, {})
  )
  assert.ok(r.texto.includes('Meta criada'), r.texto)
  assert.ok(r.texto.includes('77'), r.texto)
})

test('registro ausente com --json sai como null, e nao como (vazio)', () => {
  assert.strictEqual(JSON.parse(saida.registro(null, { formato: 'json' })), null)
  assert.strictEqual(saida.registro(null, {}), '(vazio)')
})
