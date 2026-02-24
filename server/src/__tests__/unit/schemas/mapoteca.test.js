'use strict'

const mapotecaSchema = require('../../../mapoteca/mapoteca_schema')

describe('Mapoteca Schemas', () => {
  describe('cliente', () => {
    it('should validate correct client data', () => {
      const { error } = mapotecaSchema.cliente.validate({
        nome: 'OM Teste',
        tipo_cliente_id: 1
      })
      expect(error).toBeUndefined()
    })

    it('should require nome', () => {
      const { error } = mapotecaSchema.cliente.validate({
        tipo_cliente_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should require tipo_cliente_id', () => {
      const { error } = mapotecaSchema.cliente.validate({
        nome: 'OM Teste'
      })
      expect(error).toBeDefined()
    })

    it('should allow null ponto_contato_principal', () => {
      const { error } = mapotecaSchema.cliente.validate({
        nome: 'OM',
        tipo_cliente_id: 1,
        ponto_contato_principal: null
      })
      expect(error).toBeUndefined()
    })

    it('should allow empty string ponto_contato_principal', () => {
      const { error } = mapotecaSchema.cliente.validate({
        nome: 'OM',
        tipo_cliente_id: 1,
        ponto_contato_principal: ''
      })
      expect(error).toBeUndefined()
    })

    it('should allow null endereco_entrega_principal', () => {
      const { error } = mapotecaSchema.cliente.validate({
        nome: 'OM',
        tipo_cliente_id: 1,
        endereco_entrega_principal: null
      })
      expect(error).toBeUndefined()
    })
  })

  describe('clienteAtualizacao', () => {
    it('should require id for update', () => {
      const { error } = mapotecaSchema.clienteAtualizacao.validate({
        nome: 'OM',
        tipo_cliente_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should validate correct client update', () => {
      const { error } = mapotecaSchema.clienteAtualizacao.validate({
        id: 1,
        nome: 'OM Atualizada',
        tipo_cliente_id: 2
      })
      expect(error).toBeUndefined()
    })
  })

  describe('clienteIds', () => {
    it('should validate array of client ids', () => {
      const { error } = mapotecaSchema.clienteIds.validate({
        cliente_ids: [1, 2, 3]
      })
      expect(error).toBeUndefined()
    })

    it('should reject empty array', () => {
      const { error } = mapotecaSchema.clienteIds.validate({
        cliente_ids: []
      })
      expect(error).toBeDefined()
    })
  })

  describe('pedido', () => {
    it('should validate correct order data', () => {
      const { error } = mapotecaSchema.pedido.validate({
        data_pedido: new Date(),
        cliente_id: 1,
        situacao_pedido_id: 1
      })
      expect(error).toBeUndefined()
    })

    it('should require data_pedido', () => {
      const { error } = mapotecaSchema.pedido.validate({
        cliente_id: 1,
        situacao_pedido_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should require cliente_id', () => {
      const { error } = mapotecaSchema.pedido.validate({
        data_pedido: new Date(),
        situacao_pedido_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should require situacao_pedido_id', () => {
      const { error } = mapotecaSchema.pedido.validate({
        data_pedido: new Date(),
        cliente_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should allow null data_atendimento', () => {
      const { error } = mapotecaSchema.pedido.validate({
        data_pedido: new Date(),
        cliente_id: 1,
        situacao_pedido_id: 1,
        data_atendimento: null
      })
      expect(error).toBeUndefined()
    })

    it('should allow optional string fields as null', () => {
      const { error } = mapotecaSchema.pedido.validate({
        data_pedido: new Date(),
        cliente_id: 1,
        situacao_pedido_id: 1,
        ponto_contato: null,
        documento_solicitacao: null,
        endereco_entrega: null,
        operacao: null,
        observacao: null
      })
      expect(error).toBeUndefined()
    })

    it('should default palavras_chave to empty array', () => {
      const { error, value } = mapotecaSchema.pedido.validate({
        data_pedido: new Date(),
        cliente_id: 1,
        situacao_pedido_id: 1
      })
      expect(error).toBeUndefined()
      expect(value.palavras_chave).toEqual([])
    })
  })

  describe('pedidoAtualizacao', () => {
    it('should require id for update', () => {
      const { error } = mapotecaSchema.pedidoAtualizacao.validate({
        data_pedido: new Date(),
        cliente_id: 1,
        situacao_pedido_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should validate correct order update', () => {
      const { error } = mapotecaSchema.pedidoAtualizacao.validate({
        id: 1,
        data_pedido: new Date(),
        cliente_id: 1,
        situacao_pedido_id: 1
      })
      expect(error).toBeUndefined()
    })
  })

  describe('pedidoLocalizador', () => {
    it('should validate XXXX-XXXX-XXXX format with uppercase letters and digits', () => {
      const { error } = mapotecaSchema.pedidoLocalizador.validate({
        localizador: 'ABCD-1234-EFGH'
      })
      expect(error).toBeUndefined()
    })

    it('should validate all-digit localizador', () => {
      const { error } = mapotecaSchema.pedidoLocalizador.validate({
        localizador: '1234-5678-9012'
      })
      expect(error).toBeUndefined()
    })

    it('should reject lowercase letters', () => {
      const { error } = mapotecaSchema.pedidoLocalizador.validate({
        localizador: 'abcd-1234-efgh'
      })
      expect(error).toBeDefined()
    })

    it('should reject invalid format (too short segments)', () => {
      const { error } = mapotecaSchema.pedidoLocalizador.validate({
        localizador: 'abc-123'
      })
      expect(error).toBeDefined()
    })

    it('should reject missing localizador', () => {
      const { error } = mapotecaSchema.pedidoLocalizador.validate({})
      expect(error).toBeDefined()
    })
  })

  describe('produtoPedido', () => {
    it('should validate correct order product', () => {
      const { error } = mapotecaSchema.produtoPedido.validate({
        uuid_versao: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        pedido_id: 1,
        quantidade: 5,
        tipo_midia_id: 1
      })
      expect(error).toBeUndefined()
    })

    it('should require quantidade >= 1', () => {
      const { error } = mapotecaSchema.produtoPedido.validate({
        uuid_versao: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        pedido_id: 1,
        quantidade: 0,
        tipo_midia_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should default producao_especifica to false', () => {
      const { error, value } = mapotecaSchema.produtoPedido.validate({
        uuid_versao: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',
        pedido_id: 1,
        quantidade: 1,
        tipo_midia_id: 1
      })
      expect(error).toBeUndefined()
      expect(value.producao_especifica).toBe(false)
    })
  })

  describe('plotter', () => {
    it('should validate correct plotter data', () => {
      const { error } = mapotecaSchema.plotter.validate({
        nr_serie: 'SN-001',
        modelo: 'HP DesignJet'
      })
      expect(error).toBeUndefined()
    })

    it('should default ativo to true', () => {
      const { error, value } = mapotecaSchema.plotter.validate({
        nr_serie: 'SN-001',
        modelo: 'HP'
      })
      expect(error).toBeUndefined()
      expect(value.ativo).toBe(true)
    })

    it('should require nr_serie', () => {
      const { error } = mapotecaSchema.plotter.validate({
        modelo: 'HP'
      })
      expect(error).toBeDefined()
    })

    it('should require modelo', () => {
      const { error } = mapotecaSchema.plotter.validate({
        nr_serie: 'SN-001'
      })
      expect(error).toBeDefined()
    })

    it('should allow null data_aquisicao', () => {
      const { error } = mapotecaSchema.plotter.validate({
        nr_serie: 'SN-001',
        modelo: 'HP',
        data_aquisicao: null
      })
      expect(error).toBeUndefined()
    })

    it('should allow null vida_util', () => {
      const { error } = mapotecaSchema.plotter.validate({
        nr_serie: 'SN-001',
        modelo: 'HP',
        vida_util: null
      })
      expect(error).toBeUndefined()
    })
  })

  describe('plotterAtualizacao', () => {
    it('should require id and ativo for update', () => {
      const { error } = mapotecaSchema.plotterAtualizacao.validate({
        nr_serie: 'SN-001',
        modelo: 'HP'
      })
      expect(error).toBeDefined()
    })

    it('should validate correct plotter update', () => {
      const { error } = mapotecaSchema.plotterAtualizacao.validate({
        id: 1,
        ativo: false,
        nr_serie: 'SN-001',
        modelo: 'HP'
      })
      expect(error).toBeUndefined()
    })
  })

  describe('estoqueMaterial', () => {
    it('should validate stock entry', () => {
      const { error } = mapotecaSchema.estoqueMaterial.validate({
        tipo_material_id: 1,
        quantidade: 100.5,
        localizacao_id: 1
      })
      expect(error).toBeUndefined()
    })

    it('should require positive quantidade', () => {
      const { error } = mapotecaSchema.estoqueMaterial.validate({
        tipo_material_id: 1,
        quantidade: -5,
        localizacao_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should reject zero quantidade', () => {
      const { error } = mapotecaSchema.estoqueMaterial.validate({
        tipo_material_id: 1,
        quantidade: 0,
        localizacao_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should require tipo_material_id', () => {
      const { error } = mapotecaSchema.estoqueMaterial.validate({
        quantidade: 100,
        localizacao_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should require localizacao_id', () => {
      const { error } = mapotecaSchema.estoqueMaterial.validate({
        tipo_material_id: 1,
        quantidade: 100
      })
      expect(error).toBeDefined()
    })
  })

  describe('estoqueMaterialAtualizacao', () => {
    it('should require id for update', () => {
      const { error } = mapotecaSchema.estoqueMaterialAtualizacao.validate({
        tipo_material_id: 1,
        quantidade: 50,
        localizacao_id: 1
      })
      expect(error).toBeDefined()
    })

    it('should validate correct stock update', () => {
      const { error } = mapotecaSchema.estoqueMaterialAtualizacao.validate({
        id: 1,
        tipo_material_id: 1,
        quantidade: 50,
        localizacao_id: 1
      })
      expect(error).toBeUndefined()
    })
  })

  describe('manutencaoPlotter', () => {
    it('should validate maintenance entry', () => {
      const { error } = mapotecaSchema.manutencaoPlotter.validate({
        plotter_id: 1,
        data_manutencao: new Date(),
        valor: 500.00
      })
      expect(error).toBeUndefined()
    })

    it('should require positive valor', () => {
      const { error } = mapotecaSchema.manutencaoPlotter.validate({
        plotter_id: 1,
        data_manutencao: new Date(),
        valor: -100
      })
      expect(error).toBeDefined()
    })

    it('should reject zero valor', () => {
      const { error } = mapotecaSchema.manutencaoPlotter.validate({
        plotter_id: 1,
        data_manutencao: new Date(),
        valor: 0
      })
      expect(error).toBeDefined()
    })

    it('should require plotter_id', () => {
      const { error } = mapotecaSchema.manutencaoPlotter.validate({
        data_manutencao: new Date(),
        valor: 500
      })
      expect(error).toBeDefined()
    })

    it('should require data_manutencao', () => {
      const { error } = mapotecaSchema.manutencaoPlotter.validate({
        plotter_id: 1,
        valor: 500
      })
      expect(error).toBeDefined()
    })

    it('should allow null descricao', () => {
      const { error } = mapotecaSchema.manutencaoPlotter.validate({
        plotter_id: 1,
        data_manutencao: new Date(),
        valor: 500,
        descricao: null
      })
      expect(error).toBeUndefined()
    })
  })

  describe('manutencaoPlotterAtualizacao', () => {
    it('should require id for update', () => {
      const { error } = mapotecaSchema.manutencaoPlotterAtualizacao.validate({
        plotter_id: 1,
        data_manutencao: new Date(),
        valor: 500
      })
      expect(error).toBeDefined()
    })

    it('should validate correct maintenance update', () => {
      const { error } = mapotecaSchema.manutencaoPlotterAtualizacao.validate({
        id: 1,
        plotter_id: 1,
        data_manutencao: new Date(),
        valor: 500
      })
      expect(error).toBeUndefined()
    })
  })

  describe('tipoMaterial', () => {
    it('should validate correct material type', () => {
      const { error } = mapotecaSchema.tipoMaterial.validate({
        nome: 'Papel A0'
      })
      expect(error).toBeUndefined()
    })

    it('should require nome', () => {
      const { error } = mapotecaSchema.tipoMaterial.validate({})
      expect(error).toBeDefined()
    })

    it('should allow null descricao', () => {
      const { error } = mapotecaSchema.tipoMaterial.validate({
        nome: 'Papel A0',
        descricao: null
      })
      expect(error).toBeUndefined()
    })
  })

  describe('consumoMaterial', () => {
    it('should validate correct consumption entry', () => {
      const { error } = mapotecaSchema.consumoMaterial.validate({
        tipo_material_id: 1,
        quantidade: 10.5,
        data_consumo: new Date()
      })
      expect(error).toBeUndefined()
    })

    it('should require positive quantidade', () => {
      const { error } = mapotecaSchema.consumoMaterial.validate({
        tipo_material_id: 1,
        quantidade: -1,
        data_consumo: new Date()
      })
      expect(error).toBeDefined()
    })

    it('should require data_consumo', () => {
      const { error } = mapotecaSchema.consumoMaterial.validate({
        tipo_material_id: 1,
        quantidade: 10
      })
      expect(error).toBeDefined()
    })
  })

  describe('consumoMaterialFiltro', () => {
    it('should validate with all filter fields', () => {
      const { error } = mapotecaSchema.consumoMaterialFiltro.validate({
        data_inicio: new Date(),
        data_fim: new Date(),
        tipo_material_id: 1
      })
      expect(error).toBeUndefined()
    })

    it('should validate with no filter fields (all optional)', () => {
      const { error } = mapotecaSchema.consumoMaterialFiltro.validate({})
      expect(error).toBeUndefined()
    })
  })
})
