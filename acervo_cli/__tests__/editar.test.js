'use strict'

// O `editar` faz read-modify-write contra um acervo de PRODUCAO. O que se testa
// aqui e a parte que nao depende de rede: o parser do --set (que decide se 24 e
// numero ou string, e os ids sao .strict()) e a coerencia entre a leitura de
// cada entidade e o schema do PUT correspondente.

const { test } = require('node:test')
const assert = require('node:assert')

const { ALVOS, parSet } = require('../comandos/editar')
const esquema = require('../lib/schema')

test('--set le o valor como JSON quando da, e como texto quando nao da', () => {
  // 24 precisa virar numero: os ids sao .strict() e recusam "24".
  assert.deepStrictEqual(parSet('subtipo_produto_id=24'), ['subtipo_produto_id', 24])
  assert.deepStrictEqual(parSet('lote_id=null'), ['lote_id', null])
  assert.deepStrictEqual(parSet('palavras_chave=["a","b"]'), ['palavras_chave', ['a', 'b']])
  // Data nao e JSON valido, e tem que sobreviver como texto ate o Joi.
  assert.deepStrictEqual(parSet('data_edicao=2019-05-01'), ['data_edicao', '2019-05-01'])
  assert.deepStrictEqual(parSet('nome=Serra do Mar'), ['nome', 'Serra do Mar'])
})

test('--set aceita "=" dentro do valor', () => {
  assert.deepStrictEqual(parSet('geom=SRID=4674;POINT(0 0)'), ['geom', 'SRID=4674;POINT(0 0)'])
})

test('--set sem "=" recusa em vez de virar flag vazia', () => {
  assert.throws(() => parSet('data_edicao'), /campo=valor/)
})

test('cada alvo do editar aponta um schema Joi de verdade', () => {
  for (const [nome, alvo] of Object.entries(ALVOS)) {
    const s = alvo.schema()
    assert.strictEqual(typeof s.describe, 'function', `${nome} nao devolveu schema Joi`)
    assert.ok(alvo.rota.startsWith('/'), `${nome} sem rota`)
  }
})

test('o alias nome_versao -> nome cobre a diferenca entre o GET e o PUT', () => {
  // O GET /acervo/versao/:id devolve nome_versao; o PUT /produtos/versao espera
  // nome. Sem o renomear, o campo obrigatorio some e o PUT volta 400.
  assert.strictEqual(ALVOS.versao.renomear.nome_versao, 'nome')
  const campos = esquema.camposDe(ALVOS.versao.schema()).map(c => c.nome)
  assert.ok(campos.includes('nome'), 'o PUT de versao espera nome')
  assert.ok(!campos.includes('nome_versao'), 'o PUT de versao nao conhece nome_versao')
})

test('a leitura de versao cobre todos os campos com default do PUT', () => {
  // Se este teste falhar, o editar de versao passou a exigir --set a mais: o
  // guardrail de default silencioso vai recusar a edicao ate o campo ser dito.
  const base = {
    // exatamente o SELECT de acervo_ctrl.getVersaoById, ja renomeado
    id: 7244,
    uuid_versao: null,
    versao: '2-DSG',
    nome: null,
    tipo_versao_id: 1,
    subtipo_produto_id: 12,
    lote_id: 88,
    metadado: {},
    descricao: '',
    orgao_produtor: 'DSG',
    palavras_chave: [],
    data_criacao: '2019-01-10',
    data_edicao: '2019-05-01'
  }
  assert.deepStrictEqual(esquema.defaultsAusentes(ALVOS.versao.schema(), base), [])
})

// O GET de produto devolve subtipo_produto_id e o PUT nao tem default nele, os
// dois lados do mesmo modo de falha: sem qualquer um deles, QUALQUER edicao
// despinaria a Carta Militar com 200. Se o guardrail voltar a acusar aqui, o
// servidor regrediu.
test('a leitura de produto cobre o subtipo, e o guardrail se cala', () => {
  const base = {
    // exatamente o SELECT de acervo_ctrl.getProdutoById, ja com o subtipo
    id: 4211,
    nome: 'Serra Azul',
    mi: '2965-2',
    inom: 'SF-23-Y-C-II-1',
    tipo_escala_id: 2,
    denominador_escala_especial: null,
    tipo_produto_id: 2,
    subtipo_produto_id: 24,
    descricao: '',
    geom: 'SRID=4674;POLYGON((0 0,1 0,1 1,0 0))'
  }
  assert.deepStrictEqual(
    esquema.defaultsAusentes(ALVOS.produto.schema(), base), [],
    'com o campo lido e sem default no PUT, nao ha default silencioso a acusar'
  )
})

test('a leitura de arquivo (do detalhado) satisfaz o PUT de arquivo', () => {
  const base = {
    // colunas do SELECT de arquivos dentro de getProdutoDetailedById
    id: 9001,
    uuid_arquivo: '3f2a1c88-0000-4000-8000-000000000002',
    nome: 'carta',
    nome_arquivo: '2965-2_serra_azul',
    tipo_arquivo_id: 1,
    volume_armazenamento_id: 3,
    extensao: 'pdf',
    tamanho_mb: 120.5,
    checksum: 'abc',
    metadado: {},
    tipo_status_id: 1,
    situacao_carregamento_id: 1,
    descricao: '',
    crs_original: 'EPSG:4674'
  }
  assert.deepStrictEqual(esquema.defaultsAusentes(ALVOS.arquivo.schema(), base), [])

  const r = esquema.validarCorpo(ALVOS.arquivo.schema(), base)
  assert.strictEqual(r.ok, true, JSON.stringify(r.erros))
  // As colunas de leitura caem no stripUnknown, e o CLI diz quais foram.
  assert.ok(r.descartados.includes('checksum'))
  assert.ok(r.descartados.includes('extensao'))
})
