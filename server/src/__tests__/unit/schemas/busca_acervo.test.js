'use strict'

// O bbox chega como texto na query string, e o Joi e o unico ponto onde ele
// vira numero antes de tocar no SQL. Retangulo invertido ou degenerado passa
// pelo ST_MakeEnvelope sem erro e devolve ZERO resultado: a tela leria isso
// como "nao existe produto nessa area", que e a pior falha porque parece
// resposta legitima. Por isso a recusa acontece aqui.

const acervoSchema = require('../../../acervo/acervo_schema')

const valida = (query) => acervoSchema.buscaProdutos.validate(query)

describe('Schema da busca do acervo', () => {
  describe('bbox', () => {
    it('aceita e converte para quatro numeros', () => {
      const { error, value } = valida({ bbox: '-52.5,-31,-50,-29.25' })
      expect(error).toBeUndefined()
      expect(value.bbox).toEqual([-52.5, -31, -50, -29.25])
    })

    it('tolera espaco em volta da virgula', () => {
      const { error, value } = valida({ bbox: '-52, -31, -50, -29' })
      expect(error).toBeUndefined()
      expect(value.bbox).toEqual([-52, -31, -50, -29])
    })

    it('recusa quando nao sao quatro numeros', () => {
      expect(valida({ bbox: '-52,-31,-50' }).error).toBeDefined()
      expect(valida({ bbox: '-52,-31,-50,-29,0' }).error).toBeDefined()
      expect(valida({ bbox: 'a,b,c,d' }).error).toBeDefined()
    })

    // Invertido: o ST_MakeEnvelope nao reclama, so devolve vazio.
    it('recusa retangulo invertido', () => {
      const { error } = valida({ bbox: '-50,-29,-52,-31' })
      expect(error).toBeDefined()
      expect(error.message).toContain('minLon < maxLon')
    })

    it('recusa retangulo degenerado (area zero)', () => {
      expect(valida({ bbox: '-52,-31,-52,-29' }).error).toBeDefined()
      expect(valida({ bbox: '-52,-31,-50,-31' }).error).toBeDefined()
    })

    it('recusa coordenada fora do intervalo geografico', () => {
      expect(valida({ bbox: '-200,-31,-50,-29' }).error).toBeDefined()
      expect(valida({ bbox: '-52,-95,-50,-29' }).error).toBeDefined()
    })

    it('bbox ausente e valido: a busca sem recorte espacial continua existindo', () => {
      const { error, value } = valida({ termo: 'porto' })
      expect(error).toBeUndefined()
      expect(value.bbox).toBeUndefined()
    })
  })

  describe('demais campos', () => {
    it('com_geometria e false por padrao, para a lista nao carregar poligono', () => {
      const { value } = valida({})
      expect(value.com_geometria).toBe(false)
    })

    it('page e limit tem padrao, e limit tem teto', () => {
      const { value } = valida({})
      expect(value.page).toBe(1)
      expect(value.limit).toBe(20)
      expect(valida({ limit: 500 }).error).toBeDefined()
    })

    it('aceita palavra-chave e os filtros de dominio', () => {
      const { error, value } = valida({
        palavra_chave: 'Mapeamento Sistemático',
        tipo_produto_id: 9,
        tipo_escala_id: 2
      })
      expect(error).toBeUndefined()
      expect(value.palavra_chave).toBe('Mapeamento Sistemático')
      expect(value.tipo_produto_id).toBe(9)
    })
  })
})
