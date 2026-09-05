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

// ---------------------------------------------------------------------------
// `--json` puro: quem encadeia faz JSON.parse do stdout INTEIRO
// ---------------------------------------------------------------------------
//
// Ate 2026-09-05 a escrita colava a mensagem do servidor ANTES do objeto
// criado. Quem le o id recem-criado para anexar o PDF na chamada seguinte fazia
// JSON.parse dessa saida e levava `Unexpected token`.

const http = require('../lib/http')
const crud = require('../comandos/crud')

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

const CORPO_NC = JSON.stringify({
  numero: '2026NC000123',
  ano: 2026,
  cod_nd: '339040',
  valor_nc: 1500,
  classificacao_id: 1
})

test('criar com --json devolve so o registro criado', async () => {
  const r = await comResposta(
    { message: 'Nota de credito criada com sucesso', dados: { id: 91, numero: '2026NC000123' } },
    () => crud.executar({ _: ['nc', 'criar'], flags: { json: true, data: CORPO_NC } }, {})
  )
  const voltou = JSON.parse(r.texto)
  assert.strictEqual(voltou.id, 91)
  assert.ok(
    r.avisos.some(a => a.includes('Nota de credito criada')),
    'a mensagem do servidor nao pode sumir: ela so muda de stream (stderr)'
  )
})

test('criar sem --json continua mostrando a mensagem junto do registro', async () => {
  const r = await comResposta(
    { message: 'Nota de credito criada com sucesso', dados: { id: 91, numero: '2026NC000123' } },
    () => crud.executar({ _: ['nc', 'criar'], flags: { data: CORPO_NC } }, {})
  )
  assert.ok(r.texto.includes('Nota de credito criada'), r.texto)
  assert.ok(r.texto.includes('91'), r.texto)
})

test('registro ausente com --json sai como null, e nao como (vazio)', () => {
  assert.strictEqual(JSON.parse(saida.registro(null, { formato: 'json' })), null)
  assert.strictEqual(saida.registro(null, {}), '(vazio)')
})
