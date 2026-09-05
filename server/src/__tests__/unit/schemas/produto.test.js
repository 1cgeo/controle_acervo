'use strict'

const produtoSchema = require('../../../produto/produto_schema')
const { recusaPor, recusaRegraDeObjeto, aceita } = require('../../helpers/joi')

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

    // `mi` e `inom` seguem a MESMA regra, e o controlador os preserva com o
    // mesmo `preserveOmitted`. Sem estes dois casos, um corpo sem as duas
    // chaves apagava a identidade da folha e a rota respondia 200.
    it('produtoAtualizacao não inventa mi nem inom quando as chaves faltam', () => {
      const { error, value } = produtoSchema.produtoAtualizacao.validate({
        id: 1,
        nome: 'Carta',
        tipo_escala_id: 2,
        denominador_escala_especial: null,
        tipo_produto_id: 1,
        subtipo_produto_id: 3,
        descricao: ''
      })

      expect(error).toBeUndefined()
      expect('mi' in value).toBe(false)
      expect('inom' in value).toBe(false)
    })

    it('produtoAtualizacao continua aceitando mi e inom nulos explícitos', () => {
      const { error, value } = produtoSchema.produtoAtualizacao.validate({
        id: 1,
        nome: 'Carta',
        mi: null,
        inom: null,
        tipo_escala_id: 2,
        denominador_escala_especial: null,
        tipo_produto_id: 1,
        subtipo_produto_id: 3,
        descricao: ''
      })

      expect(error).toBeUndefined()
      expect(value.mi).toBeNull()
      expect(value.inom).toBeNull()
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

    // Quem barra o lote vazio é o `.min(1)`, e não o `.required()` do item: o
    // item de `correcoes` não é `.required()`, ao contrário de `produto_ids`.
    it('recusa lote vazio', () => {
      recusaPor(
        produtoSchema.versaoUuidCorrecao.validate({ ...valido, correcoes: [] }),
        'correcoes',
        'array.min'
      )
    })

    // As DUAS regras de unicidade dão `array.unique` no mesmo caminho, então o
    // campo e o tipo não separam uma da outra. Quem separa é o `context.path`,
    // que nomeia o comparador. Sem ele, trocar as duas fixturas de lugar
    // deixaria os dois casos verdes.
    it('recusa o mesmo uuid para duas versões (a UNIQUE do banco não permitiria)', () => {
      const mesmo = '4fe8d788-dc4b-2f73-22c8-8d5e6090f06d'
      const r = produtoSchema.versaoUuidCorrecao.validate({
        ...valido,
        correcoes: [
          { versao_id: 6653, uuid_versao: mesmo },
          { versao_id: 6654, uuid_versao: mesmo }
        ]
      })
      recusaPor(r, 'correcoes.1', 'array.unique')
      expect(r.error.details[0].context.path).toBe('uuid_versao')
    })

    it('recusa a mesma versão duas vezes no lote', () => {
      const r = produtoSchema.versaoUuidCorrecao.validate({
        ...valido,
        correcoes: [
          { versao_id: 6653, uuid_versao: '4fe8d788-dc4b-2f73-22c8-8d5e6090f06d' },
          { versao_id: 6653, uuid_versao: '02e6980b-c052-4f1a-91b8-a2e839565b39' }
        ]
      })
      recusaPor(r, 'correcoes.1', 'array.unique')
      expect(r.error.details[0].context.path).toBe('versao_id')
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
  // A rota GET /api/produtos/folha resolve a folha do SCN por INOM ou por MI. O
  // schema e onde mora a regra de que sao um OU outro, nunca os dois, e onde a
  // dica de escala fica presa ao MI.
  describe('folhaQuery', () => {
    it('aceita so o INOM', () => {
      expect(aceita(produtoSchema.folhaQuery.validate({ inom: 'SF-22-Y-D-II-4-NE' })))
        .toEqual({ inom: 'SF-22-Y-D-II-4-NE' })
    })

    it('aceita so o MI', () => {
      expect(aceita(produtoSchema.folhaQuery.validate({ mi: '2757-4-NE' })))
        .toEqual({ mi: '2757-4-NE' })
    })

    // Com os dois preenchidos a rota teria de escolher um em silencio.
    it('recusa INOM e MI juntos', () => {
      recusaRegraDeObjeto(
        produtoSchema.folhaQuery.validate({ inom: 'SF-22', mi: '2757' }),
        'object.xor',
        ['inom', 'mi']
      )
    })

    it('recusa a consulta sem nenhum dos dois', () => {
      recusaRegraDeObjeto(
        produtoSchema.folhaQuery.validate({}),
        'object.missing',
        ['inom', 'mi']
      )
    })

    // O acervo grava o MI sem zero a esquerda, e sem o preenchimento 549 dos 563
    // MIs de 250k colidem com um MI de 100k. A dica e o que alcanca a folha de
    // 250k, e por isso ela so vale 3 (100k) ou 4 (250k).
    it('aceita a dica de escala junto do MI', () => {
      aceita(produtoSchema.folhaQuery.validate({ mi: '1', tipo_escala_id: 4 }))
      aceita(produtoSchema.folhaQuery.validate({ mi: '1', tipo_escala_id: 3 }))
    })

    it('recusa dica de escala que nao desempata nada', () => {
      recusaPor(
        produtoSchema.folhaQuery.validate({ mi: '2757', tipo_escala_id: 1 }),
        'tipo_escala_id',
        'any.only'
      )
    })

    // Recusada, e nao ignorada: o INOM ja diz a escala pela profundidade, e
    // aceitar-e-descartar faria o cliente acreditar que pediu o que a rota nem
    // leu.
    it('recusa a dica de escala junto do INOM', () => {
      recusaRegraDeObjeto(
        produtoSchema.folhaQuery.validate({ inom: 'SF-22', tipo_escala_id: 3 }),
        'object.with',
        ['tipo_escala_id', 'mi']
      )
    })

    // A query NAO passa por stripUnknown no schemaValidation (so o corpo passa),
    // entao chave errada na URL e 400 e nao um filtro que sumiu.
    it('recusa parametro desconhecido', () => {
      recusaPor(
        produtoSchema.folhaQuery.validate({ inom: 'SF-22', escala: '50k' }),
        'escala',
        'object.unknown'
      )
    })
  })
})

// Dia de calendário: o valor tem de sair do Joi como a STRING que entrou.
//
// Sem `.raw()`, o Joi devolve um Date de meia-noite UTC, e a coluna
// TIMESTAMP WITH TIME ZONE guarda 21:00 do DIA ANTERIOR em America/Sao_Paulo.
// A interface web manda o formato do `<input type="date">`, então a edição
// pedida em 01/08 volta 31/07 na ficha.
//
// O custo real não é a tela: `acervo.versao.data_edicao` é o que conta produto
// entregue no MÊS, e por ele o RPCMTec. A carta editada no dia 1º entrava no
// relatório do mês anterior.
describe('data de versao e DIA DE CALENDARIO, e nao instante', () => {
  const versaoValida = {
    uuid_versao: null,
    versao: '1-DSG',
    nome: null,
    produto_id: 1,
    subtipo_produto_id: 2,
    lote_id: null,
    metadado: {},
    descricao: '',
    orgao_produtor: '1º CGEO',
    data_criacao: '2026-07-01',
    data_edicao: '2026-08-01'
  }

  it('versoesHistoricas devolve a string original, e nao um Date', () => {
    const value = aceita(produtoSchema.versoesHistoricas.validate([versaoValida]))
    expect(value[0].data_criacao).toBe('2026-07-01')
    expect(value[0].data_edicao).toBe('2026-08-01')
  })

  it('versaoAtualizacao devolve a string original', () => {
    const value = aceita(produtoSchema.versaoAtualizacao.validate({
      id: 1,
      versao: '1-DSG',
      nome: null,
      tipo_versao_id: 1,
      subtipo_produto_id: 2,
      descricao: '',
      metadado: {},
      lote_id: null,
      orgao_produtor: '1º CGEO',
      data_criacao: '2026-07-01',
      data_edicao: '2026-08-01'
    }))
    expect(value.data_edicao).toBe('2026-08-01')
  })

  // O `.raw()` devolve a string, mas a VALIDACAO continua sendo de data: sem
  // isso o schema aceitaria qualquer texto e o erro apareceria no INSERT.
  it('continua recusando texto que nao e data', () => {
    recusaPor(
      produtoSchema.versoesHistoricas.validate([
        { ...versaoValida, data_criacao: 'nao e data' }
      ]),
      '0.data_criacao',
      'date.format'
    )
  })

  // O par `.iso().raw()` e deliberado, e esta e a razao: com `.raw()` sozinho a
  // string seguiria CRUA para o Postgres, e '01/08/2026' viraria 8 de JANEIRO,
  // porque o DateStyle padrao e MDY. Um dia trocado por outro mes inteiro.
  it('recusa data fora do formato ISO, que o Postgres leria como outro mes', () => {
    recusaPor(
      produtoSchema.versoesHistoricas.validate([
        { ...versaoValida, data_edicao: '01/08/2026' }
      ]),
      '0.data_edicao',
      'date.format'
    )
  })

  // O caminho do upload web passa por OUTRO schema, e a mesma regra vale la. O
  // caso mora em unit/schemas/arquivo.test.js ('a data de versao volta como a
  // string original'), com o dono do schema.

  it('continua cobrando data_edicao >= data_criacao', () => {
    recusaPor(
      produtoSchema.versoesHistoricas.validate([
        { ...versaoValida, data_criacao: '2026-08-01', data_edicao: '2026-07-01' }
      ]),
      '0.data_edicao',
      'date.min'
    )
  })
})
