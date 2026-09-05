'use strict'

// A DATA DE ASSINATURA DA EDIÇÃO É DIA DE CALENDÁRIO.
//
// `data_assinatura` é a data que sai impressa no bloco de assinatura do
// documento que o chefe assina, e a coluna é dia puro. O par `.iso().raw()` é o
// que a mantém assim, e cada metade guarda uma coisa diferente:
//
//   `.raw()`  devolve a STRING que entrou. Sem ele o Joi entrega um Date de
//             meia-noite UTC, e a coluna grava o dia ANTERIOR em UTC-3.
//   `.iso()`  cobra o formato AAAA-MM-DD. Sem ele a string segue crua para o
//             Postgres, que lê '01/08/2026' como 8 de JANEIRO pelo DateStyle
//             MDY: um dia trocado por outro mês inteiro, sem erro nenhum.
//
// O caso que separa as duas metades é o '01/08/2026'. Uma data já em ISO passa
// com `.raw()` sozinho e não distingue nada.

const rpcmtecSchema = require('../../../rpcmtec/rpcmtec_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

// A criação e a atualização partem do mesmo `camposBase`: o que vale numa vale
// na outra, e provar só uma deixaria a irmã livre para divergir.
const EDICOES = [['criar'], ['atualizar']]

const corpo = (extra = {}) => ({ ano: 2026, mes: 8, ...extra })

describe('Edição do RPCMTec: data_assinatura é dia de calendário', () => {
  it.each(EDICOES)('%s devolve a data como a string ISO que entrou', (schema) => {
    const value = aceita(
      rpcmtecSchema[schema].validate(corpo({ data_assinatura: '2026-08-01' }))
    )
    expect(value.data_assinatura).toBe('2026-08-01')
  })

  // O caso que o `.iso()` existe para pegar. Fora do ISO, o Postgres leria
  // '01/08/2026' como 8 de janeiro, e o documento sairia com a data errada.
  it.each(EDICOES)('%s recusa a data fora do formato ISO', (schema) => {
    recusaPor(
      rpcmtecSchema[schema].validate(corpo({ data_assinatura: '01/08/2026' })),
      'data_assinatura',
      'date.format'
    )
  })

  it.each(EDICOES)('%s recusa texto que não é data', (schema) => {
    recusaPor(
      rpcmtecSchema[schema].validate(corpo({ data_assinatura: 'quinta-feira' })),
      'data_assinatura',
      'date.format'
    )
  })

  // Anulável de propósito: no dia 1º nem sempre se sabe quem assina, e o
  // fechamento é que cobra a assinatura.
  it.each(EDICOES)('%s aceita a data nula, que é a edição ainda aberta', (schema) => {
    const value = aceita(
      rpcmtecSchema[schema].validate(corpo({ data_assinatura: null }))
    )
    expect(value.data_assinatura).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// O ANO CONTRA O SMALLINT
//
// `rpcmtec.edicao.ano` e `rpcmtec.capacitacao.ano` são `SMALLINT` (`er/rpcmtec.sql`),
// e o Joi não tinha teto: `{ ano: 40000, mes: 7 }` passava, chegava ao INSERT e
// o Postgres devolvia `22003 smallint out of range`. O `tratarErroEdicao` só
// traduz o `23505` da UNIQUE, então o erro cru subia e a pessoa recebia 500 pelo
// que era entrada dela. A tela já cobrava 2000 a 2100 no diálogo; o servidor
// não, e é ele quem vale para o CLI.
//
// Os casos abaixo provam o MOTIVO da recusa (`number.max`, `number.min`), e não
// só que houve recusa: um erro em `mes` ou em `nome` deixaria a régua do ano
// sumir sem que nada ficasse vermelho.
// ---------------------------------------------------------------------------
describe('RPCMTec: o ano cabe no SMALLINT', () => {
  it.each(EDICOES)('%s recusa o ano acima de 2100', (schema) => {
    recusaPor(rpcmtecSchema[schema].validate(corpo({ ano: 40000 })), 'ano', 'number.max')
  })

  it.each(EDICOES)('%s recusa o ano abaixo de 2000', (schema) => {
    // O piso pega o dígito a menos ('202' por '2026'), que é o erro de digitação
    // que a tela deixa passar tão fácil quanto o teto.
    recusaPor(rpcmtecSchema[schema].validate(corpo({ ano: 202 })), 'ano', 'number.min')
  })

  it.each(EDICOES)('%s aceita as duas bordas', (schema) => {
    expect(aceita(rpcmtecSchema[schema].validate(corpo({ ano: 2000 }))).ano).toBe(2000)
    expect(aceita(rpcmtecSchema[schema].validate(corpo({ ano: 2100 }))).ano).toBe(2100)
  })
})

// A capacitação tem coluna `ano` própria, e o mesmo SMALLINT. Ela é outro
// schema: sem estes casos, a régua da edição não diria nada sobre ela.
const CAPACITACOES = [['criarCapacitacao'], ['atualizarCapacitacao']]

const capacitacao = (extra = {}) => ({
  ano: 2026, nome: 'Curso de Cartografia', situacao_id: 1, ...extra
})

describe('Capacitação do RPCMTec: o ano cabe no SMALLINT', () => {
  it.each(CAPACITACOES)('%s recusa o ano acima de 2100', (schema) => {
    recusaPor(
      rpcmtecSchema[schema].validate(capacitacao({ ano: 40000 })), 'ano', 'number.max'
    )
  })

  it.each(CAPACITACOES)('%s recusa o ano abaixo de 2000', (schema) => {
    recusaPor(
      rpcmtecSchema[schema].validate(capacitacao({ ano: 202 })), 'ano', 'number.min'
    )
  })
})

// ---------------------------------------------------------------------------
// `militares` SEM `.default([])`
//
// A chave AUSENTE preserva a lista gravada, e a lista VAZIA a apaga. São coisas
// diferentes, e o default matava a distinção: ele injetava `[]`, "ausente" nunca
// chegava ao controlador, e o `gravarMilitares` (DELETE mais INSERT) apagava a
// lista de quem só quis corrigir o nome da capacitação pelo CLI. É a mesma regra
// que `meta_pit_id` e `data_prevista` já cobravam do schema, e que este campo
// não cumpria.
// ---------------------------------------------------------------------------
describe('Capacitação do RPCMTec: militares preserva por ausência', () => {
  it.each(CAPACITACOES)('%s NÃO injeta a lista quando a chave falta', (schema) => {
    const value = aceita(rpcmtecSchema[schema].validate(capacitacao()))
    expect(value.militares).toBeUndefined()
    expect('militares' in value).toBe(false)
  })

  it.each(CAPACITACOES)('%s aceita a lista VAZIA, que é "tirei todo mundo"', (schema) => {
    const value = aceita(rpcmtecSchema[schema].validate(capacitacao({ militares: [] })))
    expect(value.militares).toEqual([])
  })

  it.each(CAPACITACOES)('%s continua recusando o uuid repetido', (schema) => {
    // A UNIQUE (capacitacao, usuario) do banco recusaria com 409; o Joi recusa
    // antes, e tirar o default não podia afrouxar isso.
    const uuid = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'
    recusaPor(
      rpcmtecSchema[schema].validate(capacitacao({ militares: [uuid, uuid] })),
      ['militares', 1],
      'array.unique'
    )
  })
})
