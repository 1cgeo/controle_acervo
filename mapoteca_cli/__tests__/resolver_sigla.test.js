'use strict'

// Testes com node:test (embutido no Node), nao jest: ver args.test.js.
//   Rodar: cd mapoteca_cli && npm test
//
// O que estes testes trancam
// --------------------------
// O documento assina a OM pela SIGLA ("CRO/3"), e a base guarda a sigla numa
// coluna propria (`mapoteca.cliente.sigla`) ao lado do nome por extenso. Ate
// 2026-08-25 o `casarClientes` pontuava so `c.nome`, entao a sigla nao entrava
// na conta e a busca pela forma que o documento usa nao achava ninguem.
//
// Medido contra a producao em 2026-08-25:
//   mapoteca cliente resolver "CRO 3"
//     -> Nenhum cliente casa com "CRO 3" entre os 179 cadastrados.
//   mapoteca cliente resolver "Comissao Regional de Obras"
//     -> 146 Comissao Regional de Obras da 3a Regiao Militar   (sigla CRO/3)
//
// O modo de falha nao e "nao achou": e que `acharOuCriarCliente` do verbo
// `cadastrar` casa por nome EXATO e CRIA quando nao acha. Um "nao achei" aqui
// vira OM duplicada na base, e o historico daquela OM racha em dois.
//
// A pontuacao da sigla precisa aguentar as tres formas que quem digita usa
// (barra, espaco, nada) sem virar ruido: sigla curta que por acaso aparece
// dentro de um nome por extenso nao pode entrar na lista.

const { test } = require('node:test')
const assert = require('node:assert')

const { casarClientes, chaveCompacta } = require('../comandos/resolver')

// Recorte da producao (ids reais), mais dois casos que so existem para provar
// que a sigla nao atropela o casamento por nome.
const CRO3 = {
  id: 146,
  nome: 'Comissão Regional de Obras da 3ª Região Militar',
  sigla: 'CRO/3'
}
const CRO5 = {
  id: 147,
  nome: 'Comissão Regional de Obras da 5ª Região Militar',
  sigla: 'CRO/5'
}
const RCB6 = {
  id: 12,
  nome: '6º Regimento de Cavalaria Blindado',
  sigla: '6º RCB'
}
// Cliente civil: nao e OM e nao tem sigla. A coluna e NULL na maioria da base.
const PREFEITURA = {
  id: 88,
  nome: 'Prefeitura Municipal de Alegrete',
  sigla: null
}
// Sigla CURTA que e substring do nome por extenso de outro cliente, ja
// compactado ("comissaoREGionaldeobras"). Se a pontuacao por sigla nao exigir
// que a sigla cubra metade do termo, este cliente entra em toda busca por nome
// longo, como ruido.
const RUIDO = {
  id: 200,
  nome: 'Batalhão de Engenharia',
  sigla: 'REG'
}

const BASE = [CRO3, CRO5, RCB6, PREFEITURA, RUIDO]

function ids (resultado) {
  return resultado.map(r => r.cliente.id)
}

test('chaveCompacta iguala as tres formas que quem digita usa', () => {
  assert.strictEqual(chaveCompacta('CRO/3'), 'cro3')
  assert.strictEqual(chaveCompacta('CRO 3'), 'cro3')
  assert.strictEqual(chaveCompacta('cro-3'), 'cro3')
  assert.strictEqual(chaveCompacta('cro3'), 'cro3')
  assert.strictEqual(chaveCompacta('C.R.O. 3'), 'cro3')
  assert.strictEqual(chaveCompacta('6º RCB'), '6rcb')
  assert.strictEqual(chaveCompacta(null), '')
})

test('a sigla acha a OM nas tres formas, e o topo e o 146', () => {
  for (const termo of ['CRO 3', 'CRO/3', 'cro3', 'cro-3', 'C.R.O./3']) {
    const r = casarClientes(BASE, termo)
    assert.ok(r.length, `"${termo}" nao casou com ninguem`)
    assert.strictEqual(r[0].cliente.id, 146, `"${termo}" nao trouxe o 146 no topo`)
  }
})

test('a sigla vizinha NAO entra: CRO/3 nao traz o CRO/5', () => {
  const r = casarClientes(BASE, 'CRO/3')
  assert.ok(!ids(r).includes(147), `o CRO/5 entrou na busca por CRO/3: ${ids(r)}`)
})

test('sigla curta nao vira ruido dentro de nome por extenso', () => {
  const r = casarClientes(BASE, 'Comissao Regional de Obras')
  assert.ok(
    !ids(r).includes(200),
    `a sigla "REG" casou dentro de "comissaoregionaldeobras": ${ids(r)}`
  )
})

test('o casamento por NOME que ja funcionava continua igual', () => {
  const porExtenso = casarClientes(BASE, 'Comissao Regional de Obras')
  assert.deepStrictEqual(ids(porExtenso).slice(0, 2).sort(), [146, 147])

  const porPalavra = casarClientes(BASE, 'Cavalaria Blindado')
  assert.strictEqual(porPalavra[0].cliente.id, 12)

  const exato = casarClientes(BASE, 'Prefeitura Municipal de Alegrete')
  assert.strictEqual(exato[0].cliente.id, 88)
})

test('cliente sem sigla nao quebra nem pontua', () => {
  const r = casarClientes(BASE, 'CRO 3')
  assert.ok(!ids(r).includes(88))
})

test('termo vazio continua devolvendo lista vazia', () => {
  assert.deepStrictEqual(casarClientes(BASE, '   '), [])
  assert.deepStrictEqual(casarClientes(BASE, '///'), [])
})
