'use strict'

// Este arquivo tinha 60 casos, e 57 deles provavam apenas que "houve erro":
// `should require nome`, `should require id for update`, `should allow null X`,
// repetidos por schema. Eram o `.required()` e o `.allow(null)` do Joi, nao
// regra do SCA -- e, por afirmarem so `toBeDefined()`, passavam mesmo quando o
// fixture quebrava por outro campo.
//
// A reescrita organiza por REGRA, e nao por schema: e a regra que se quer
// guardar, e ela costuma valer em mais de um schema ao mesmo tempo. Cada recusa
// prova campo e motivo, pelo helper __tests__/helpers/joi.js.

const mapotecaSchema = require('../../../mapoteca/mapoteca_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

describe('Schemas da mapoteca', () => {
  // -------------------------------------------------------------------------
  // Material se conta em UNIDADE
  // -------------------------------------------------------------------------
  // Decisao do chefe em 2026-07-30: as colunas de quantidade viraram INTEGER.
  // Aceitar 100,5 aqui produziria erro mais adiante, no banco, ou um
  // arredondamento silencioso -- que e pior, porque some do relatorio sem
  // avisar. Vale para o estoque e para o consumo, entao os dois entram juntos.
  describe('quantidade de material e inteira', () => {
    const entrada = {
      estoqueMaterial: { tipo_material_id: 1, localizacao_id: 1 },
      consumoMaterial: { tipo_material_id: 1, data_consumo: '2026-01-01' }
    }

    it.each(Object.keys(entrada))('%s aceita quantidade inteira', (schema) => {
      aceita(mapotecaSchema[schema].validate({ ...entrada[schema], quantidade: 100 }))
    })

    it.each(Object.keys(entrada))('%s recusa quantidade fracionaria', (schema) => {
      recusaPor(
        mapotecaSchema[schema].validate({ ...entrada[schema], quantidade: 100.5 }),
        'quantidade',
        'number.integer'
      )
    })

    // O estoque aceita ZERO (o CHECK do banco e >= 0: material que acabou
    // continua cadastrado com saldo zero), mas nao aceita negativo.
    it('estoque aceita zero, que e o material que acabou', () => {
      const value = aceita(mapotecaSchema.estoqueMaterial.validate({
        ...entrada.estoqueMaterial, quantidade: 0
      }))
      expect(value.quantidade).toBe(0)
    })

    it('estoque recusa saldo negativo', () => {
      recusaPor(
        mapotecaSchema.estoqueMaterial.validate({ ...entrada.estoqueMaterial, quantidade: -1 }),
        'quantidade',
        'number.min'
      )
    })
  })

  // -------------------------------------------------------------------------
  // O localizador do pedido
  // -------------------------------------------------------------------------
  // Ele e a chave da UNICA rota da mapoteca sem autenticacao
  // (GET /pedido/localizador/:localizador, o acompanhamento pelo proprio
  // cliente). O formato fechado e o que impede a rota de virar sonda: sem ele,
  // qualquer texto entraria na consulta.
  describe('pedidoLocalizador', () => {
    it.each(['ABCD-1234-EFGH', '1234-5678-9012'])('aceita %s', (localizador) => {
      aceita(mapotecaSchema.pedidoLocalizador.validate({ localizador }))
    })

    it.each([
      ['minuscula', 'abcd-1234-efgh'],
      ['segmento curto', 'ABC-123-EFG'],
      ['sem separador', 'ABCD1234EFGH']
    ])('recusa %s', (_rotulo, localizador) => {
      recusaPor(
        mapotecaSchema.pedidoLocalizador.validate({ localizador }),
        'localizador',
        'string.pattern.base'
      )
    })
  })

  // -------------------------------------------------------------------------
  // Defaults que o controller assume
  // -------------------------------------------------------------------------
  // Cada um destes existe porque ALGUEM depende dele adiante: o array vazio
  // evita `null` chegando a coluna de texto[], o `false` evita `undefined`
  // virando NULL num BOOLEAN NOT NULL, e o `ativo: true` faz o plotter recem
  // cadastrado aparecer na lista sem ninguem marcar nada.
  describe('defaults', () => {
    it('pedido nasce com palavras_chave vazia e fora do PIT', () => {
      const value = aceita(mapotecaSchema.pedido.validate({
        data_pedido: '2026-01-01', cliente_id: 1, situacao_pedido_id: 1
      }))
      expect(value.palavras_chave).toEqual([])
      expect(value.previsto_pit).toBe(false)
    })

    it('plotter nasce ativo', () => {
      const value = aceita(mapotecaSchema.plotter.validate({ nr_serie: 'X1', modelo: 'HP' }))
      expect(value.ativo).toBe(true)
    })

    it('item de pedido nasce sem producao especifica', () => {
      const value = aceita(mapotecaSchema.produtoPedido.validate({
        uuid_versao: UUID, pedido_id: 1, quantidade: 1, tipo_midia_id: 1
      }))
      expect(value.producao_especifica).toBe(false)
    })
  })

  // -------------------------------------------------------------------------
  // Quantidade e valor que nao fazem sentido em zero
  // -------------------------------------------------------------------------
  describe('minimos de negocio', () => {
    it('item de pedido exige ao menos uma copia', () => {
      recusaPor(
        mapotecaSchema.produtoPedido.validate({
          uuid_versao: UUID, pedido_id: 1, quantidade: 0, tipo_midia_id: 1
        }),
        'quantidade',
        'number.min'
      )
    })

    // Manutencao de plotter sem valor nao e manutencao de graca: e registro
    // incompleto. Zero passaria para o RPCMTec como custo real.
    it('manutencao de plotter recusa valor zero', () => {
      recusaPor(
        mapotecaSchema.manutencaoPlotter.validate({
          plotter_id: 1, data_manutencao: '2026-01-01', valor: 0
        }),
        'valor',
        'number.positive'
      )
    })

    it('manutencao de plotter aceita valor positivo', () => {
      aceita(mapotecaSchema.manutencaoPlotter.validate({
        plotter_id: 1, data_manutencao: '2026-01-01', valor: 500
      }))
    })
  })

  // -------------------------------------------------------------------------
  // O que PODE faltar
  // -------------------------------------------------------------------------
  // Cliente cadastrado por telefone costuma vir sem contato e sem endereco, e
  // o pedido so ganha data de atendimento quando e atendido. Sao ausencias
  // legitimas: se o schema as recusasse, o cadastro pararia na tela.
  describe('campos que aceitam ausencia', () => {
    it('cliente sem ponto de contato e sem endereco de entrega', () => {
      aceita(mapotecaSchema.cliente.validate({
        nome: '6 RCB',
        tipo_cliente_id: 1,
        ponto_contato_principal: null,
        endereco_entrega_principal: null
      }))
    })

    it('pedido ainda nao atendido nao tem data_atendimento', () => {
      aceita(mapotecaSchema.pedido.validate({
        data_pedido: '2026-01-01',
        cliente_id: 1,
        situacao_pedido_id: 1,
        data_atendimento: null
      }))
    })

    it('filtro de consumo sem nenhum campo e valido: e a listagem inteira', () => {
      const value = aceita(mapotecaSchema.consumoMaterialFiltro.validate({}))
      expect(value).toEqual({})
    })
  })

  // -------------------------------------------------------------------------
  // Atualizacao exige o id
  // -------------------------------------------------------------------------
  // Um caso por schema de atualizacao seria repeticao; a regra e a mesma e a
  // tabela abaixo cobre os quatro de uma vez. Sem o id o controller montaria um
  // UPDATE sem WHERE, e o pg-promise recusaria o parametro faltando -- mas com
  // 500, e nao com 400 dizendo o campo.
  describe('atualizacao exige id', () => {
    const corpos = {
      clienteAtualizacao: { nome: '6 RCB', tipo_cliente_id: 1 },
      plotterAtualizacao: { nr_serie: 'X1', modelo: 'HP', ativo: true },
      estoqueMaterialAtualizacao: { tipo_material_id: 1, quantidade: 1, localizacao_id: 1 },
      manutencaoPlotterAtualizacao: { plotter_id: 1, data_manutencao: '2026-01-01', valor: 1 }
    }

    it.each(Object.keys(corpos))('%s recusa corpo sem id', (schema) => {
      recusaPor(mapotecaSchema[schema].validate(corpos[schema]), 'id', 'any.required')
    })
  })
})
