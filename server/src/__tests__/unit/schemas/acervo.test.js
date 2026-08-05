'use strict'

// Os filtros da busca de produtos NAO sao testados aqui: eles tem arquivo
// proprio (busca_acervo.test.js), que cobre defaults, teto do limit e o bbox.

const acervoSchema = require('../../../acervo/acervo_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

describe('Schemas do acervo', () => {
  // As rotas de download em lote recebem lista de id. O `unique()` nao e
  // capricho: id repetido geraria dois tokens para o mesmo arquivo, e o segundo
  // download confirmaria uma transferencia que ja tinha sido confirmada.
  describe('arquivosIds', () => {
    it('aceita lista de ids inteiros e distintos', () => {
      aceita(acervoSchema.arquivosIds.validate({ arquivos_ids: [1, 2, 3] }))
    })

    // O tipo NÃO é `array.min`, apesar do `.min(1)` estar no schema: o item
    // declarado com `.required()` faz o Joi cobrar "pelo menos um item" antes
    // de chegar ao min. Anotado para o próximo leitor não "corrigir".
    it('recusa lista vazia, que pediria download de nada', () => {
      recusaPor(
        acervoSchema.arquivosIds.validate({ arquivos_ids: [] }),
        'arquivos_ids',
        'array.includesRequiredUnknowns'
      )
    })

    it('recusa id repetido, que geraria dois tokens para o mesmo arquivo', () => {
      recusaPor(
        acervoSchema.arquivosIds.validate({ arquivos_ids: [1, 1] }),
        'arquivos_ids.1',
        'array.unique'
      )
    })
  })

  describe('produtosIdsComTipos', () => {
    it('aceita as duas listas juntas', () => {
      aceita(acervoSchema.produtosIdsComTipos.validate({
        produtos_ids: [1, 2],
        tipos_arquivo: [1, 3]
      }))
    })

    it('exige tipos_arquivo: sem ele o download nao sabe o que levar', () => {
      recusaPor(
        acervoSchema.produtosIdsComTipos.validate({ produtos_ids: [1] }),
        'tipos_arquivo',
        'any.required'
      )
    })
  })

  // O token de download e a chave que autoriza a copia: ele TEM de ser uuid,
  // porque o controller o procura por igualdade, e texto qualquer viraria busca
  // que nunca casa, devolvendo 404 onde o certo e 400.
  describe('downloadConfirmations', () => {
    it('aceita a confirmacao com token uuid', () => {
      aceita(acervoSchema.downloadConfirmations.validate({
        confirmations: [{
          download_token: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
          success: true,
          error_message: null
        }]
      }))
    })

    it('recusa token que nao e uuid', () => {
      recusaPor(
        acervoSchema.downloadConfirmations.validate({
          confirmations: [{ download_token: 'not-a-uuid', success: true }]
        }),
        'confirmations.0.download_token',
        'string.guid'
      )
    })
  })

  // A situacao geral e consumida pelo plugin e pela rota publica de integracao.
  // As escalas nascem FALSE: sem default, `undefined` entraria no SQL como
  // "escala nao pedida" num caminho e como "todas" noutro.
  describe('situacaoGeralQuery', () => {
    // AS QUATRO, e não duas: o schema declara scale25k, scale50k, scale100k e
    // scale250k, e provar só as duas primeiras deixa o default das outras duas
    // livre para sumir.
    it('toda escala nasce false quando nada e pedido', () => {
      expect(aceita(acervoSchema.situacaoGeralQuery.validate({}))).toEqual({
        scale25k: false,
        scale50k: false,
        scale100k: false,
        scale250k: false
      })
    })

    it('a escala ligada explicitamente chega ligada, e as outras seguem false', () => {
      const value = aceita(acervoSchema.situacaoGeralQuery.validate({
        scale25k: true
      }))
      expect(value.scale25k).toBe(true)
      expect(value.scale50k).toBe(false)
    })
  })
})
