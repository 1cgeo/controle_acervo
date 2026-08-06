'use strict'

const projetoSchema = require('../../../projeto/projeto_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

// `data_fim_prevista` NAO EXISTE MAIS, nem no projeto nem no lote.
//
// A coluna nunca existiu em `acervo.projeto`, e saiu de `acervo.lote` na 1.35.0
// (2026-08-06). Ela virou copia de `data_fim`: nos 19 lotes que a tinham, as 19
// datas eram identicas, porque a previsao vinha sendo preenchida no fim, junto
// com o fato. A promessa hoje mora em `acervo.versao.data_prevista`, uma data
// por FOLHA.
//
// O PIOR DESFECHO, QUE ESTE ARQUIVO EXISTE PARA IMPEDIR. Ate 2026-08-06 os
// quatro modelos declaravam o campo por um helper `periodo()` compartilhado. No
// projeto isso dava o pior resultado possivel: o Joi aceitava, o middleware nao
// descartava nada (a chave era declarada), o ColumnSet do `criaProjeto` nao a
// tinha, e o INSERT seguia sem ela. Quem mandava recebia 201 e o valor sumia sem
// uma linha de log.
//
// AS OPCOES DO MIDDLEWARE ENTRAM NO TESTE. Estas rotas usam
// `utils/schema_validation.js`, que valida com `stripUnknown: true`. Apagar a
// chave do schema, so isso, trocaria o silencio total por um descarte avisado,
// nunca por um 400. Por isso os quatro modelos declaram o campo como
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

  // Os quatro modelos que carregam periodo, e o campo podado tem de ser recusado
  // nos quatro. Percorrer a tabela evita o teste que cobre so o modelo lembrado:
  // ate a 1.35.0 o lote ACEITAVA o campo, e so o projeto o recusava.
  const MODELOS = [
    ['projeto', () => projetoSchema.projeto, projetoValido],
    ['projetoAtualizacao', () => projetoSchema.projetoAtualizacao, { ...projetoValido, id: 1 }],
    ['lote', () => projetoSchema.lote, loteValido],
    ['loteAtualizacao', () => projetoSchema.loteAtualizacao, { ...loteValido, id: 1 }]
  ]

  describe('a coluna podada e recusada em TODOS os modelos', () => {
    it.each(MODELOS)('%s recusa data_fim_prevista', (_nome, modelo, corpoValido) => {
      recusaPor(
        modelo().validate(
          { ...corpoValido, data_fim_prevista: '2026-11-30' },
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
    it.each(MODELOS)(
      '%s recusa mesmo com stripUnknown, e nao descarta em silencio',
      (_nome, modelo, corpoValido) => {
        const { error, value } = modelo().validate(
          { ...corpoValido, data_fim_prevista: '2026-11-30' },
          OPCOES_DA_ROTA
        )
        expect(error).toBeDefined()
        expect(error.details[0].type).toBe('any.unknown')
        // Prova o contrario do descarte calado: a chave continua no valor, entao
        // a recusa veio de uma regra, e nao do `stripUnknown` que a apagaria.
        expect(value).toHaveProperty('data_fim_prevista')
      }
    )

    // A mensagem tem de dizer ONDE a data mora hoje. Recusar sem ensinar o
    // conserto so troca o silencio por um "nao".
    it.each(MODELOS)('%s aponta a versao planejada na mensagem', (_nome, modelo, corpoValido) => {
      const { error } = modelo().validate(
        { ...corpoValido, data_fim_prevista: '2026-11-30' },
        OPCOES_DA_ROTA
      )
      expect(error.details[0].message).toMatch(/data_prevista/)
    })
  })

  // VARIANCIA. Sem estes casos, um schema que recusasse o corpo INTEIRO
  // satisfaria tudo acima: o "recusa" so significa alguma coisa se o corpo sem o
  // campo ainda for aceito, com as datas intactas.
  describe('o corpo sem o campo continua valido', () => {
    it('aceita o projeto, com as duas datas do periodo', () => {
      const valor = aceita(projetoSchema.projeto.validate(projetoValido, OPCOES_DA_ROTA))
      expect(valor.data_inicio).toBe('2026-01-01')
      expect(valor.data_fim).toBe('2026-12-31')
    })

    it('aceita o lote, com as duas datas do periodo', () => {
      const valor = aceita(projetoSchema.lote.validate(loteValido, OPCOES_DA_ROTA))
      expect(valor.data_inicio).toBe('2026-01-01')
      expect(valor.data_fim).toBe('2026-12-31')
      expect(valor).not.toHaveProperty('data_fim_prevista')
    })
  })

  // O periodo em si nao mudou: `data_fim >= data_inicio` espelha o CHECK do
  // banco, e continua valendo nas duas entidades.
  describe('o CHECK do periodo continua espelhado', () => {
    it('o projeto recusa data_fim anterior a data_inicio', () => {
      recusaPor(
        projetoSchema.projeto.validate({ ...projetoValido, data_fim: '2025-12-31' }),
        'data_fim',
        'date.min'
      )
    })

    it('o lote recusa data_fim anterior a data_inicio', () => {
      recusaPor(
        projetoSchema.lote.validate({ ...loteValido, data_fim: '2025-12-31' }),
        'data_fim',
        'date.min'
      )
    })
  })
})
