'use strict'

const produtoSchema = require('../../../produto/produto_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

describe('Schemas de produto', () => {
  describe('produtoAtualizacao', () => {
    const valido = {
      id: 1,
      nome: 'Carta Teste',
      tipo_escala_id: 2,
      denominador_escala_especial: null,
      tipo_produto_id: 1,
      descricao: ''
    }

    it('aceita a atualizacao completa', () => {
      aceita(produtoSchema.produtoAtualizacao.validate(valido))
    })

    // `.strict()` no id: sem ele o Joi converteria '1' para 1, e um id vindo de
    // query string entraria no UPDATE parecendo validado.
    it('recusa id em texto, porque o schema e strict', () => {
      recusaPor(
        produtoSchema.produtoAtualizacao.validate({ ...valido, id: 'abc' }),
        'id',
        'number.base'
      )
    })

    it('aceita geom em EWKT e aceita geom nula', () => {
      const ewkt = 'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))'
      aceita(produtoSchema.produtoAtualizacao.validate({ ...valido, geom: ewkt }))
      aceita(produtoSchema.produtoAtualizacao.validate({ ...valido, geom: null }))
    })
  })

  // A exclusao em lote exige MOTIVO. Ele nao e enfeite: a linha vai para
  // acervo.produto_deletado, e sem motivo a exclusao vira um registro sumido
  // sem historia. Mesma regra do versaoUuidCorrecao, mais abaixo.
  describe('produtoIds (exclusao em lote)', () => {
    it('aceita a lista com motivo', () => {
      aceita(produtoSchema.produtoIds.validate({
        produto_ids: [1, 2, 3],
        motivo_exclusao: 'Dados incorretos'
      }))
    })

    it('exige o motivo: exclusao sem procedencia e registro sumido sem historia', () => {
      recusaPor(
        produtoSchema.produtoIds.validate({ produto_ids: [1] }),
        'motivo_exclusao',
        'any.required'
      )
    })

    it('recusa lista vazia', () => {
      recusaPor(
        produtoSchema.produtoIds.validate({ produto_ids: [], motivo_exclusao: 'm' }),
        'produto_ids',
        'array.includesRequiredUnknowns'
      )
    })

    it('recusa id repetido, que tentaria excluir duas vezes o mesmo produto', () => {
      recusaPor(
        produtoSchema.produtoIds.validate({ produto_ids: [1, 1], motivo_exclusao: 'm' }),
        'produto_ids.1',
        'array.unique'
      )
    })
  })

  describe('versaoRelacionamento', () => {
    it('aceita um relacionamento entre duas versoes', () => {
      aceita(produtoSchema.versaoRelacionamento.validate({
        versao_relacionamento: [
          { versao_id_1: 1, versao_id_2: 2, tipo_relacionamento_id: 1 }
        ]
      }))
    })

    // Aqui o tipo e `array.min`, e nao o `array.includesRequiredUnknowns` dos
    // outros lotes deste arquivo: este schema declara o item SEM `.required()`,
    // entao quem barra o vazio e o `.min(1)`. As duas construcoes recusam a
    // lista vazia; a diferenca so aparece na mensagem, e e ela que o cliente le.
    it('recusa lote vazio, que gravaria relacionamento nenhum com 200', () => {
      recusaPor(
        produtoSchema.versaoRelacionamento.validate({ versao_relacionamento: [] }),
        'versao_relacionamento',
        'array.min'
      )
    })
  })

  // O produto NASCE com geometria: ele e uma area no mapa, e sem `geom` a busca
  // espacial e as visoes materializadas simplesmente nao o alcancam.
  describe('produtos (criacao em lote)', () => {
    const produto = {
      nome: 'Carta 1',
      mi: 'MI-001',
      inom: 'SF-22',
      tipo_escala_id: 2,
      denominador_escala_especial: null,
      tipo_produto_id: 1,
      descricao: null,
      geom: 'SRID=4674;POLYGON((-50 -25, -49 -25, -49 -24, -50 -24, -50 -25))'
    }

    it('aceita a criacao com geometria', () => {
      aceita(produtoSchema.produtos.validate({ produtos: [produto] }))
    })

    it('exige geom em cada produto', () => {
      const { geom, ...semGeom } = produto
      recusaPor(
        produtoSchema.produtos.validate({ produtos: [semGeom] }),
        'produtos.0.geom',
        'any.required'
      )
    })
  })

  // `familia` entra no rotulo da versao ('1-DSG'), e o rotulo tem UNIQUE no
  // banco. Minuscula ou sigla longa produziriam rotulo que o trigger
  // acervo.validate_version recusa depois, ja dentro da transacao.
  describe('renumeraVersoes', () => {
    const valido = {
      produto_id: 1,
      subtipo_produto_id: 2,
      familia: 'EDICAO',
      nova_data_edicao: '1957-01-01'
    }

    it.each(['EDICAO', 'DSG'])('aceita a familia %s', (familia) => {
      aceita(produtoSchema.renumeraVersoes.validate({ ...valido, familia }))
    })

    it.each([
      ['minuscula', 'dsg'],
      ['com mais de 5 letras', 'ABCDEF']
    ])('recusa familia %s', (_rotulo, familia) => {
      recusaPor(
        produtoSchema.renumeraVersoes.validate({ ...valido, familia }),
        'familia',
        'string.pattern.base'
      )
    })

    it('exige nova_data_edicao em formato de data', () => {
      recusaPor(
        produtoSchema.renumeraVersoes.validate({ ...valido, nova_data_edicao: 'nao e uma data' }),
        'nova_data_edicao',
        'date.format'
      )
    })
  })

  // Numa atualização, default silencioso é perda de dado: a chave ausente passa
  // a valer o default e sobrescreve o que está gravado. A ausência tem que
  // chegar ao controller como ausência, para ele preservar o valor atual.
  describe('atualização sem default silencioso', () => {
    it('produtoAtualizacao não inventa subtipo_produto_id quando a chave falta', () => {
      const { error, value } = produtoSchema.produtoAtualizacao.validate({
        id: 1,
        nome: 'Carta',
        mi: 'MI-001',
        inom: 'SF-22',
        tipo_escala_id: 2,
        denominador_escala_especial: null,
        tipo_produto_id: 1,
        descricao: ''
      })

      expect(error).toBeUndefined()
      expect('subtipo_produto_id' in value).toBe(false)
    })

    it('produtoAtualizacao continua aceitando subtipo_produto_id null explícito', () => {
      const { error, value } = produtoSchema.produtoAtualizacao.validate({
        id: 1,
        nome: 'Carta',
        mi: 'MI-001',
        inom: 'SF-22',
        tipo_escala_id: 2,
        denominador_escala_especial: null,
        tipo_produto_id: 1,
        subtipo_produto_id: null,
        descricao: ''
      })

      expect(error).toBeUndefined()
      expect(value.subtipo_produto_id).toBeNull()
    })

    it('versaoAtualizacao não zera palavras_chave quando a chave falta', () => {
      const { error, value } = produtoSchema.versaoAtualizacao.validate({
        id: 1,
        versao: '1-DSG',
        nome: 'Folha',
        tipo_versao_id: 1,
        subtipo_produto_id: 2,
        descricao: '',
        metadado: {},
        lote_id: null,
        orgao_produtor: 'DSG',
        data_criacao: '2024-01-01',
        data_edicao: '2024-01-02'
      })

      expect(error).toBeUndefined()
      expect('palavras_chave' in value).toBe(false)
    })
  })

  // A correção do uuid_versao para o identificador que o BDGEx já publicou.
  // Vive numa rota própria porque no PUT de versão o uuid_versao é IMUTÁVEL.
  describe('versaoUuidCorrecao', () => {
    const valido = {
      correcoes: [
        { versao_id: 6653, uuid_versao: '4fe8d788-dc4b-2f73-22c8-8d5e6090f06d' },
        { versao_id: 6654, uuid_versao: '02e6980b-c052-4f1a-91b8-a2e839565b39' }
      ],
      motivo: 'Identificador lido do BDGEx Op'
    }

    it('aceita um lote de correções com motivo', () => {
      aceita(produtoSchema.versaoUuidCorrecao.validate(valido))
    })

    it('exige o motivo: correção sem procedência é número trocado sem história', () => {
      recusaPor(
        produtoSchema.versaoUuidCorrecao.validate({ ...valido, motivo: undefined }),
        'motivo',
        'any.required'
      )
    })

    it('recusa lote vazio', () => {
      recusaPor(
        produtoSchema.versaoUuidCorrecao.validate({ ...valido, correcoes: [] }),
        'correcoes'
      )
    })

    it('recusa o mesmo uuid para duas versões (a UNIQUE do banco não permitiria)', () => {
      const mesmo = '4fe8d788-dc4b-2f73-22c8-8d5e6090f06d'
      recusaPor(
        produtoSchema.versaoUuidCorrecao.validate({
          ...valido,
          correcoes: [
            { versao_id: 6653, uuid_versao: mesmo },
            { versao_id: 6654, uuid_versao: mesmo }
          ]
        }),
        'correcoes'
      )
    })

    it('recusa a mesma versão duas vezes no lote', () => {
      recusaPor(
        produtoSchema.versaoUuidCorrecao.validate({
          ...valido,
          correcoes: [
            { versao_id: 6653, uuid_versao: '4fe8d788-dc4b-2f73-22c8-8d5e6090f06d' },
            { versao_id: 6653, uuid_versao: '02e6980b-c052-4f1a-91b8-a2e839565b39' }
          ]
        }),
        'correcoes'
      )
    })

    it('recusa o que não é uuid', () => {
      recusaPor(
        produtoSchema.versaoUuidCorrecao.validate({
          ...valido,
          correcoes: [{ versao_id: 6653, uuid_versao: 'nao-e-uuid' }]
        }),
        'correcoes.0.uuid_versao',
        'string.guid'
      )
    })
  })
})
