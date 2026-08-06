'use strict'

const projetoSchema = require('../../../projeto/projeto_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

// `data_fim_prevista` E DO LOTE, E SO DO LOTE.
//
// A coluna existe em `acervo.lote` e NAO existe em `acervo.projeto` (ver o DDL
// em er/acervo.sql). Ate 2026-08-06 o schema declarava o campo nos quatro
// modelos, por um helper `periodo()` compartilhado. O efeito no projeto era o
// pior desfecho possivel: o Joi aceitava, o middleware nao descartava nada (a
// chave era declarada), o ColumnSet do `criaProjeto` nao a tinha, e o INSERT
// seguia sem ela. Quem mandava recebia 201 e o valor sumia sem uma linha de log.
//
// AS OPCOES DO MIDDLEWARE ENTRAM NO TESTE. A rota de projeto usa
// `utils/schema_validation.js`, que valida com `stripUnknown: true`. Apagar a
// chave do schema, so isso, trocaria o silencio total por um descarte avisado,
// nunca por um 400. Por isso os modelos de projeto declaram o campo como
// `forbidden()`: chave declarada nao e chave desconhecida, entao o
// `stripUnknown` nao a alcanca e a recusa vira 400. Validar aqui com as MESMAS
// opcoes da rota e o que prende essa diferenca.
const OPCOES_DA_ROTA = { stripUnknown: true, abortEarly: false }

describe('Schemas de projeto e lote', () => {
  const projetoValido = {
    nome: 'Projeto Teste',
    descricao: '',
    data_inicio: '2026-01-01',
    data_fim: '2026-12-31',
    status_execucao_id: 1
  }

  const loteValido = {
    projeto_id: 1,
    pit: 'PIT 2026',
    nome: 'Lote Teste',
    descricao: '',
    data_inicio: '2026-01-01',
    data_fim: '2026-12-31',
    status_execucao_id: 1
  }

  describe('projeto', () => {
    it('aceita o projeto sem data_fim_prevista', () => {
      const valor = aceita(projetoSchema.projeto.validate(projetoValido))
      expect(valor.data_inicio).toBe('2026-01-01')
      expect(valor.data_fim).toBe('2026-12-31')
    })

    it('recusa data_fim_prevista no POST, porque acervo.projeto nao tem a coluna', () => {
      recusaPor(
        projetoSchema.projeto.validate(
          { ...projetoValido, data_fim_prevista: '2026-11-30' },
          OPCOES_DA_ROTA
        ),
        'data_fim_prevista',
        'any.unknown'
      )
    })

    it('recusa data_fim_prevista no PUT, porque acervo.projeto nao tem a coluna', () => {
      recusaPor(
        projetoSchema.projetoAtualizacao.validate(
          { ...projetoValido, id: 1, data_fim_prevista: '2026-11-30' },
          OPCOES_DA_ROTA
        ),
        'data_fim_prevista',
        'any.unknown'
      )
    })

    // O `stripUnknown` da rota descarta chave DESCONHECIDA em silencio. A recusa
    // acima so vale se ela sobreviver a essa opcao: sem este caso, o teste
    // passaria tambem numa versao que apenas apagou a chave do schema, e o
    // servidor voltaria a responder sucesso descartando o valor.
    it('recusa mesmo com stripUnknown, e nao descarta em silencio', () => {
      const { error, value } = projetoSchema.projeto.validate(
        { ...projetoValido, data_fim_prevista: '2026-11-30' },
        OPCOES_DA_ROTA
      )
      expect(error).toBeDefined()
      expect(error.details[0].type).toBe('any.unknown')
      // Prova o contrario do descarte calado: a chave continua no valor, entao a
      // recusa veio de uma regra, e nao do `stripUnknown` que a apagaria.
      expect(value).toHaveProperty('data_fim_prevista')
    })

    it('recusa data_fim anterior a data_inicio', () => {
      recusaPor(
        projetoSchema.projeto.validate({ ...projetoValido, data_fim: '2025-12-31' }),
        'data_fim',
        'date.min'
      )
    })
  })

  describe('lote', () => {
    it('aceita data_fim_prevista no POST, porque acervo.lote tem a coluna', () => {
      const valor = aceita(
        projetoSchema.lote.validate(
          { ...loteValido, data_fim_prevista: '2026-11-30' },
          OPCOES_DA_ROTA
        )
      )
      expect(valor.data_fim_prevista).toBe('2026-11-30')
    })

    it('aceita data_fim_prevista no PUT, porque acervo.lote tem a coluna', () => {
      const valor = aceita(
        projetoSchema.loteAtualizacao.validate(
          { ...loteValido, id: 1, data_fim_prevista: '2026-11-30' },
          OPCOES_DA_ROTA
        )
      )
      expect(valor.data_fim_prevista).toBe('2026-11-30')
    })

    it('aceita o lote sem data_fim_prevista, porque o campo e opcional', () => {
      const valor = aceita(projetoSchema.lote.validate(loteValido))
      expect(valor).not.toHaveProperty('data_fim_prevista')
    })

    // Espelha a CONSTRAINT lote_data_fim_prevista_check do banco.
    it('recusa data_fim_prevista anterior a data_inicio', () => {
      recusaPor(
        projetoSchema.lote.validate({ ...loteValido, data_fim_prevista: '2025-12-31' }),
        'data_fim_prevista',
        'date.min'
      )
    })
  })
})
