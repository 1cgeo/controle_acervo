'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const saida = require('../lib/saida')

// Amostra no formato que o /acervo/produto/detalhado devolve para as versoes de
// uma carta (colunas reais do SELECT do acervo_ctrl.js, inclusive as aliasadas e
// as resolvidas por JOIN).
const VERSOES = [
  {
    versao_id: 7244,
    produto_id: 4211,
    uuid_versao: '3f2a1c88-0000-4000-8000-000000000001',
    versao: '2-DSG',
    nome_versao: null,
    tipo_versao_id: 1,
    subtipo_produto_id: 12,
    lote_id: 88,
    versao_metadado: { fonte: 'RDG' },
    versao_descricao: '',
    versao_data_criacao: '2019-01-10T00:00:00.000Z',
    versao_data_edicao: '2019-05-01T00:00:00.000Z',
    orgao_produtor: 'DSG',
    palavras_chave: ['topografica', 'rdg'],
    lote_nome: 'Lote 3',
    lote_pit: '2019',
    projeto_nome: 'Copa',
    relacionamentos: [{ id: 1 }],
    arquivos: [{ id: 9001 }, { id: 9002 }]
  },
  {
    versao_id: 6100,
    produto_id: 4211,
    uuid_versao: null,
    versao: '1ª Edição',
    nome_versao: 'Serra Azul',
    tipo_versao_id: 2,
    subtipo_produto_id: 2,
    lote_id: null,
    versao_metadado: {},
    versao_descricao: '',
    versao_data_criacao: '1975-01-01T00:00:00.000Z',
    versao_data_edicao: '1975-06-01T00:00:00.000Z',
    orgao_produtor: 'DSG',
    palavras_chave: [],
    lote_nome: null,
    lote_pit: null,
    projeto_nome: null,
    relacionamentos: [],
    arquivos: []
  }
]

test('celula trata nulo, booleano, data ISO e tamanho', () => {
  assert.strictEqual(saida.celula('lote_id', null), '-')
  assert.strictEqual(saida.celula('primario', true), 'sim')
  assert.strictEqual(saida.celula('tamanho_mb', '1234.5'), '1.234,50')
  // Hora nao ajuda a ler acervo (o banco grava 00:00) e custa 14 caracteres.
  assert.strictEqual(saida.celula('versao_data_edicao', '2019-05-01T00:00:00.000Z'), '2019-05-01')
})

test('array de escalares cabe inteiro; array de objetos vira contagem', () => {
  // O detalhado aninha arquivos e relacionamentos dentro da versao: despejar
  // isso numa celula de TSV explodiria a linha.
  assert.strictEqual(saida.celula('palavras_chave', ['a', 'b']), 'a;b')
  assert.strictEqual(saida.celula('arquivos', [{ id: 1 }, { id: 2 }]), '[2]')
  assert.strictEqual(saida.celula('palavras_chave', []), '-')
  assert.strictEqual(saida.celula('versao_metadado', { fonte: 'RDG' }), '{1}')
})

test('sem --campos usa as colunas padrao do recurso, nao todas', () => {
  const padrao = ['versao_id', 'versao', 'versao_data_edicao']
  const { colunas } = saida.escolherColunas(VERSOES, null, padrao)
  assert.deepStrictEqual(colunas, padrao)
})

test('--campos tem precedencia sobre o padrao', () => {
  const { colunas } = saida.escolherColunas(VERSOES, ['versao', 'orgao_produtor'], ['versao_id'])
  assert.deepStrictEqual(colunas, ['versao', 'orgao_produtor'])
})

test('coluna inexistente vira aviso, nunca coluna vazia calada', () => {
  const { colunas, faltam } = saida.escolherColunas(VERSOES, ['versao', 'data_edicao'], null)
  assert.deepStrictEqual(colunas, ['versao'])
  assert.deepStrictEqual(faltam, ['data_edicao'])
})

test('o recorte reduz mesmo o tamanho da saida', () => {
  // A razao de ser do --campos: e o teste que falha se o recorte parar de valer.
  const completo = saida.lista(VERSOES, { formato: 'json' }).texto
  const recortado = saida.lista(VERSOES, {
    formato: 'tsv',
    campos: ['versao_id', 'versao', 'versao_data_edicao', 'lote_nome']
  }).texto

  assert.ok(
    recortado.length < completo.length / 5,
    `esperava recorte de pelo menos 5x, obtive ${completo.length} -> ${recortado.length}`
  )
})

test('tsv poe uma linha de cabecalho e uma por registro', () => {
  const { texto } = saida.lista(VERSOES, { formato: 'tsv', campos: ['versao', 'versao_data_edicao'] })
  const linhas = texto.split('\n').filter(l => l && !l.startsWith('('))
  assert.strictEqual(linhas[0], 'versao\tversao_data_edicao')
  assert.strictEqual(linhas.length, 3)
  assert.ok(linhas[1].includes('2019-05-01'))
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

test('o rodape conta registros e quantas colunas foram omitidas', () => {
  const { texto } = saida.lista(VERSOES, { formato: 'tsv', campos: ['versao'] })
  assert.ok(texto.includes('2 registros'))
  assert.ok(/1 de \d+ colunas/.test(texto))
})

test('--json devolve tudo, sem recorte', () => {
  const { texto } = saida.lista(VERSOES, { formato: 'json', campos: ['versao'] })
  const voltou = JSON.parse(texto)
  assert.strictEqual(voltou.length, 2)
  assert.ok('uuid_versao' in voltou[0], 'o --json precisa manter todas as colunas')
  assert.ok(Array.isArray(voltou[0].arquivos), 'o --json precisa manter o aninhamento')
})

test('registro unico sai como pares chave e valor', () => {
  const texto = saida.registro(VERSOES[0], { campos: ['versao', 'orgao_produtor'] })
  assert.ok(texto.includes('versao'))
  assert.ok(texto.includes('DSG'))
  assert.ok(!texto.includes('uuid_versao'))
})

// ---------------------------------------------------------------------------
// `--json` puro: quem encadeia faz JSON.parse do stdout INTEIRO
// ---------------------------------------------------------------------------
//
// A ajuda anuncia `--json  saida crua e completa (para encadear)`. Ate
// 2026-09-05 tres caminhos colavam prosa em volta do JSON e o parse quebrava: o
// rodape de paginacao (na rota mais usada do CLI), a mensagem do servidor na
// escrita e o `(vazio)` do registro ausente.

const { formatar } = require('../comandos/api')

const ENVELOPE_PAGINADO = {
  message: 'ok',
  dados: {
    total: 42,
    page: 1,
    limit: 20,
    dados: [{ id: 1, mi: '2965-2' }, { id: 2, mi: '2965-3' }]
  }
}

test('busca paginada com --json devolve o envelope inteiro, e so ele', () => {
  const texto = formatar(ENVELOPE_PAGINADO, { envelope: 'paginado' }, { formato: 'json' }, [])
  const voltou = JSON.parse(texto)
  assert.strictEqual(voltou.total, 42)
  assert.strictEqual(voltou.page, 1)
  assert.strictEqual(voltou.limit, 20)
  assert.strictEqual(voltou.dados.length, 2, 'a pagina de dados vem junto do envelope')
})

test('a paginacao continua visivel no formato legivel', () => {
  const texto = formatar(ENVELOPE_PAGINADO, { envelope: 'paginado' }, { formato: 'tsv' }, [])
  assert.ok(texto.includes('pagina 1 de 3'), texto)
  assert.ok(texto.includes('42 no total'), texto)
})

test('a escrita com --json sai como JSON, e nao como a prosa do servidor', () => {
  const texto = formatar(
    { message: 'Produto atualizado com sucesso', dados: null },
    { envelope: 'mensagem' },
    { formato: 'json' },
    []
  )
  const voltou = JSON.parse(texto)
  assert.strictEqual(voltou.message, 'Produto atualizado com sucesso')
  assert.strictEqual(voltou.dados, null)
})

test('a escrita sem --json continua respondendo a prosa do servidor', () => {
  const texto = formatar(
    { message: 'Produto atualizado com sucesso', dados: null },
    { envelope: 'mensagem' },
    { formato: 'tsv' },
    []
  )
  assert.strictEqual(texto, 'Produto atualizado com sucesso')
})

test('registro ausente com --json sai como null, e nao como (vazio)', () => {
  assert.strictEqual(JSON.parse(saida.registro(null, { formato: 'json' })), null)
  assert.strictEqual(JSON.parse(saida.registro(undefined, { formato: 'json' })), null)
  // Sem --json a resposta legivel nao muda.
  assert.strictEqual(saida.registro(null, {}), '(vazio)')
})
