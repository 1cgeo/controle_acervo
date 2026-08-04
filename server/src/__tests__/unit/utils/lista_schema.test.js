'use strict'

const { listaDeInteiros, temValor } = require('../../../utils/lista_schema')

// O filtro de dominio passou a aceitar VARIOS codigos em 2026-08-04, com a
// marcacao multipla na tela. O que estes testes protegem e o contrato com quem
// ja consome a rota: link antigo colado em documento, `acervo_cli` e plugin do
// QGIS mandam UM valor solto, e tem de continuar funcionando.

describe('listaDeInteiros', () => {
  const validar = (schema, valor) => schema.validate(valor)

  test('a lista da tela vira array de inteiros', () => {
    const { value, error } = validar(listaDeInteiros(), '1,3,9')
    expect(error).toBeUndefined()
    expect(value).toEqual([1, 3, 9])
  })

  test('UM valor solto continua valendo, e vira lista de um', () => {
    // E o que mantem de pe o link antigo e o CLI. Sem isto, toda URL ja colada
    // em DIEx passaria a devolver erro de validacao.
    expect(validar(listaDeInteiros(), '9').value).toEqual([9])
    expect(validar(listaDeInteiros(), 9).value).toEqual([9])
  })

  test('o array que o Express monta com o parametro repetido tambem entra', () => {
    expect(validar(listaDeInteiros(), ['1', '3']).value).toEqual([1, 3])
  })

  test('codigo repetido entra uma vez so', () => {
    expect(validar(listaDeInteiros(), '3,3,1,3').value).toEqual([3, 1])
  })

  test('virgula sobrando nao e erro', () => {
    // E o que sobra de juntar uma lista na tela, e o que ela quer dizer e claro.
    expect(validar(listaDeInteiros(), '1,,3,').value).toEqual([1, 3])
  })

  test('lista vazia vira filtro NAO aplicado', () => {
    // Desmarcar a ultima opcao tem de tirar o filtro, e nao virar um filtro que
    // nao casa com nada.
    const { value, error } = validar(listaDeInteiros(), ',')
    expect(error).toBeUndefined()
    expect(value).toBeUndefined()
  })

  test('UM item invalido recusa a lista INTEIRA', () => {
    // Descartar so o item ruim devolveria um resultado a mais, plausivel e
    // errado, para quem nao teria como perceber.
    expect(validar(listaDeInteiros(), '1,abc,3').error).toBeDefined()
    expect(validar(listaDeInteiros(), '1,2.5').error).toBeDefined()
  })

  test('o limite por item vale item a item', () => {
    const estado = listaDeInteiros({ min: 10, max: 99 })
    expect(validar(estado, '43,42').value).toEqual([43, 42])
    expect(validar(estado, '43,9').error).toBeDefined()
    expect(validar(estado, '43,100').error).toBeDefined()
  })

  test('o teto de itens impede uma URL de montar um IN gigante', () => {
    const curto = listaDeInteiros({ maxItens: 3 })
    expect(validar(curto, '1,2,3').error).toBeUndefined()
    expect(validar(curto, '1,2,3,4').error).toBeDefined()
  })
})

describe('temValor', () => {
  test('array VAZIO nao tem valor, ao contrario da verdade do JavaScript', () => {
    // E a razao de a funcao existir: `if ([])` e verdadeiro, e montaria `IN ()`,
    // que derruba a consulta.
    expect(temValor([])).toBe(false)
    expect(temValor([1])).toBe(true)
  })

  test('nulo, indefinido e texto vazio nao tem valor', () => {
    expect(temValor(null)).toBe(false)
    expect(temValor(undefined)).toBe(false)
    expect(temValor('')).toBe(false)
  })

  test('zero TEM valor: e um codigo de dominio legitimo', () => {
    expect(temValor(0)).toBe(true)
  })
})
