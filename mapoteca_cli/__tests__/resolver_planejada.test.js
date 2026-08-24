'use strict'

// Testes com node:test (embutido no Node), nao jest: ver args.test.js.
//   Rodar: cd mapoteca_cli && npm test
//
// O que estes testes trancam
// --------------------------
// O acervo guarda, no MESMO MI, produtos que a mapoteca NAO imprime: a folha
// PLANEJADA do PIT (rota `produto_versao_planejada`, producao prometida, zero
// arquivo) e o registro historico de edicao antiga. Antes deste conserto, achar
// dois produtos bastava para o comando recusar escolher e mandar "fixe o
// uuid_versao a mao no plano". O uuid da folha planejada passa no dry-run e no
// servidor sem um aviso, porque a validacao do item e so
// `SELECT uuid_versao FROM acervo.versao`: nasceria item apontando carta que
// ainda nao existe, e o erro so apareceria na impressao.
//
// Caso real que originou os testes (medido em 2026-08-24): MI 2867-1, produtos
// 2884 (Canoinhas, 1a Edicao de 2006, com PDF e TIF) e 6651 (planejada, lote
// 2026_1m_CT_Tres_Barras_50k, meta 1.2 do PIT 2026, zero arquivo, nome nulo). O
// lote deixou 44 MI nesse estado, e os 44 ja tinham sido pedidos alguma vez.

const { test } = require('node:test')
const assert = require('node:assert')

const http = require('../lib/http')
const { resolverUmMi, produtoImprimivel } = require('../comandos/resolver')

const REAL = { id: '2884', mi: '2867-1', nome: 'Canoinhas', escala: '1:50.000' }
const PLANEJADA = { id: '6651', mi: '2867-1', nome: null, escala: '1:50.000' }
const OUTRA_REAL = { id: '1912', mi: '2867-1', nome: 'Canoinhas', escala: '1:50.000' }

const VERSAO_COM_ARQUIVO = {
  uuid_versao: 'c9ba8d2f-514d-4086-b1e6-39e451e57583',
  versao: '1a Edicao',
  versao_data_edicao: '2006-01-01',
  arquivos: [{ extensao: 'pdf' }, { extensao: 'tif' }]
}
const VERSAO_PLANEJADA = {
  uuid_versao: '5b0acdac-98a9-4421-9e90-ab96b95cce93',
  versao: '1-DSG',
  versao_data_edicao: '2026-08-07',
  tipo_versao_id: 3,
  arquivos: []
}
const VERSAO_COM_ARQUIVO_2 = {
  uuid_versao: '11111111-2222-3333-4444-555555555555',
  versao: '2-DSG',
  versao_data_edicao: '2024-05-01',
  arquivos: [{ extensao: 'pdf' }]
}

// Substitui a rede: a busca devolve os produtos, e cada `produto/detalhado/<id>`
// devolve as versoes daquele id.
function comAcervo (produtos, versoesPorId, fn) {
  const original = http.autenticada
  const originalPausa = http.pausa
  http.pausa = async () => {}
  http.autenticada = async (cfg, metodo, caminho) => {
    if (caminho.startsWith('/acervo/busca')) {
      return { dados: { dados: produtos } }
    }
    const id = caminho.split('/').pop()
    return { dados: { versoes: versoesPorId[id] || [] } }
  }
  return fn().finally(() => {
    http.autenticada = original
    http.pausa = originalPausa
  })
}

test('produtoImprimivel: so e imprimivel quem tem versao COM arquivo', () => {
  assert.strictEqual(produtoImprimivel({ versoes: [VERSAO_COM_ARQUIVO] }), true)
  assert.strictEqual(produtoImprimivel({ versoes: [VERSAO_PLANEJADA] }), false)
  assert.strictEqual(produtoImprimivel({ versoes: [] }), false)
  assert.strictEqual(produtoImprimivel({}), false)
  assert.strictEqual(produtoImprimivel(null), false)
})

test('folha planejada NAO disputa com a folha real: escolhe a que tem arquivo', async () => {
  const r = await comAcervo(
    [REAL, PLANEJADA],
    { 2884: [VERSAO_COM_ARQUIVO], 6651: [VERSAO_PLANEJADA] },
    () => resolverUmMi({}, '2867-1', {})
  )
  assert.strictEqual(r.linha.situacao, 'ok')
  assert.strictEqual(r.linha.produto_id, '2884')
  assert.strictEqual(r.linha.uuid_versao, VERSAO_COM_ARQUIVO.uuid_versao)
  // O descarte nao e silencioso: quem le a saida fica sabendo o que saiu e por que.
  assert.match(r.avisos.join(' '), /6651/)
  assert.match(r.avisos.join(' '), /planejada/)
})

test('a ordem dos candidatos nao muda a escolha', async () => {
  const r = await comAcervo(
    [PLANEJADA, REAL],
    { 2884: [VERSAO_COM_ARQUIVO], 6651: [VERSAO_PLANEJADA] },
    () => resolverUmMi({}, '2867-1', {})
  )
  assert.strictEqual(r.linha.produto_id, '2884')
})

// O ALARME VERDADEIRO CONTINUA TOCANDO. Este e o teste que impede o conserto de
// virar chute silencioso: com DOIS produtos de verdade, o comando tem de seguir
// recusando, porque so o chefe decide qual folha a OM quer.
test('dois produtos COM arquivo continuam AMBIGUO, e nenhum e escolhido', async () => {
  const r = await comAcervo(
    [REAL, OUTRA_REAL],
    { 2884: [VERSAO_COM_ARQUIVO], 1912: [VERSAO_COM_ARQUIVO_2] },
    () => resolverUmMi({}, '2867-1', {})
  )
  assert.match(r.linha.situacao, /^AMBIGUO/)
  assert.strictEqual(r.linha.uuid_versao, undefined)
  assert.match(r.aviso, /2884/)
  assert.match(r.aviso, /1912/)
})

test('nenhum candidato com arquivo: AMBIGUO e diz que a folha nao vira item', async () => {
  const r = await comAcervo(
    [REAL, PLANEJADA],
    { 2884: [], 6651: [VERSAO_PLANEJADA] },
    () => resolverUmMi({}, '2867-1', {})
  )
  assert.match(r.linha.situacao, /^AMBIGUO/)
  assert.strictEqual(r.linha.uuid_versao, undefined)
  assert.match(r.aviso, /NENHUM tem arquivo/)
})

test('candidato unico segue pelo caminho de sempre, sem aviso de descarte', async () => {
  const r = await comAcervo(
    [REAL],
    { 2884: [VERSAO_COM_ARQUIVO] },
    () => resolverUmMi({}, '2867-1', {})
  )
  assert.strictEqual(r.linha.situacao, 'ok')
  assert.strictEqual(r.linha.produto_id, '2884')
  assert.deepStrictEqual(r.avisos, [])
})

test('candidato unico SEM arquivo continua reportando "sem arquivo"', async () => {
  const r = await comAcervo(
    [PLANEJADA],
    { 6651: [VERSAO_PLANEJADA] },
    () => resolverUmMi({}, '2867-1', {})
  )
  assert.strictEqual(r.linha.situacao, 'sem arquivo')
  assert.match(r.avisos.join(' '), /nao serve para imprimir/)
})

test('a divergencia de nome continua sendo acusada depois do descarte', async () => {
  const r = await comAcervo(
    [REAL, PLANEJADA],
    { 2884: [VERSAO_COM_ARQUIVO], 6651: [VERSAO_PLANEJADA] },
    () => resolverUmMi({}, '2867-1', { nomes: { '2867-1': 'Canoinhas-Norte' } })
  )
  assert.strictEqual(r.linha.produto_id, '2884')
  assert.match(r.avisos.join(' '), /DIVERGENCIA DE NOME/)
})
