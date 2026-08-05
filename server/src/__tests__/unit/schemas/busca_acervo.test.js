'use strict'

// O bbox chega como texto na query string, e o Joi e o unico ponto onde ele
// vira numero antes de tocar no SQL. Retangulo invertido ou degenerado passa
// pelo ST_MakeEnvelope sem erro e devolve ZERO resultado: a tela leria isso
// como "nao existe produto nessa area", que e a pior falha porque parece
// resposta legitima. Por isso a recusa acontece aqui.

const acervoSchema = require('../../../acervo/acervo_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

const valida = (query) => acervoSchema.buscaProdutos.validate(query)

// AS TRES REGRAS DO BBOX SAO O MESMO `custom`, e por isso saem todas com
// `type: 'custom'` no mesmo campo. Só a MENSAGEM separa uma da outra, então é
// ela que cada caso prende: sem isso, uma recusa por contagem de números
// passaria no caso do retângulo invertido, e apagar um dos ramos não derrubaria
// teste nenhum.
const recusaBbox = (bbox, trechoDaMensagem) => {
  const resultado = valida({ bbox })
  recusaPor(resultado, 'bbox', 'custom')
  expect(resultado.error.details[0].message).toContain(trechoDaMensagem)
}

describe('Schema da busca do acervo', () => {
  describe('bbox', () => {
    it('aceita e converte para quatro numeros', () => {
      const value = aceita(valida({ bbox: '-52.5,-31,-50,-29.25' }))
      expect(value.bbox).toEqual([-52.5, -31, -50, -29.25])
    })

    it('tolera espaco em volta da virgula', () => {
      const value = aceita(valida({ bbox: '-52, -31, -50, -29' }))
      expect(value.bbox).toEqual([-52, -31, -50, -29])
    })

    it('recusa quando nao sao quatro numeros', () => {
      recusaBbox('-52,-31,-50', 'quatro números')
      recusaBbox('-52,-31,-50,-29,0', 'quatro números')
      recusaBbox('a,b,c,d', 'quatro números')
    })

    // Invertido: o ST_MakeEnvelope nao reclama, so devolve vazio.
    it('recusa retangulo invertido', () => {
      recusaBbox('-50,-29,-52,-31', 'minLon < maxLon')
    })

    // O degenerado guarda a IGUALDADE do `>=`. Trocado por `>`, o retângulo
    // invertido continuaria recusado e só este caso cairia.
    it('recusa retangulo degenerado (area zero)', () => {
      recusaBbox('-52,-31,-52,-29', 'minLon < maxLon')
      recusaBbox('-52,-31,-50,-31', 'minLon < maxLon')
    })

    it('recusa coordenada fora do intervalo geografico', () => {
      recusaBbox('-200,-31,-50,-29', 'fora do intervalo')
      recusaBbox('-52,-95,-50,-29', 'fora do intervalo')
    })

    it('bbox ausente e valido: a busca sem recorte espacial continua existindo', () => {
      const value = aceita(valida({ termo: 'porto' }))
      expect(value.bbox).toBeUndefined()
    })
  })

  describe('demais campos', () => {
    it('com_geometria e false por padrao, para a lista nao carregar poligono', () => {
      const value = aceita(valida({}))
      expect(value.com_geometria).toBe(false)
    })

    it('page e limit nascem em 1 e 20', () => {
      const value = aceita(valida({}))
      expect(value.page).toBe(1)
      expect(value.limit).toBe(20)
    })

    // O teto protege o banco de um `limit=100000` colado na query string.
    it('limit tem teto de 100, e o 101 ja e recusado', () => {
      aceita(valida({ limit: 100 }))
      recusaPor(valida({ limit: 101 }), 'limit', 'number.max')
    })

    it('aceita palavra-chave e os filtros de dominio', () => {
      const value = aceita(valida({
        palavra_chave: 'Mapeamento Sistemático',
        tipo_produto_id: 9,
        tipo_escala_id: 2
      }))
      expect(value.palavra_chave).toBe('Mapeamento Sistemático')
      // O filtro de dominio e uma LISTA, e o valor solto vira lista de um: e o
      // que mantem de pe o link antigo e o CLI.
      expect(value.tipo_produto_id).toEqual([9])
      expect(value.tipo_escala_id).toEqual([2])
    })

    it('o filtro de dominio aceita VARIOS codigos', () => {
      const value = aceita(valida({ tipo_escala_id: '2,3' }))
      expect(value.tipo_escala_id).toEqual([2, 3])
    })
  })
})
