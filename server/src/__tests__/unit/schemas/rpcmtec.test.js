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
