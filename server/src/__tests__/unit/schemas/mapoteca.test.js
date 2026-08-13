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
const {
  TIPO_MOVIMENTO_MATERIAL: TIPO_MOVIMENTO,
  TIPO_LOCALIZACAO: LOCAL
} = require('../../../utils/domain_constants')

const UUID = 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11'

describe('Schemas da mapoteca', () => {
  // -------------------------------------------------------------------------
  // Material se conta em UNIDADE
  // -------------------------------------------------------------------------
  // Decisao do chefe: as colunas de quantidade viraram INTEGER.
  // Aceitar 100,5 aqui produziria erro mais adiante, no banco, ou um
  // arredondamento silencioso -- que e pior, porque some do relatorio sem
  // avisar.
  describe('quantidade de material e inteira', () => {
    const entrada = {
      tipo_material_id: 1,
      tipo_movimento_id: TIPO_MOVIMENTO.ENTRADA,
      data_movimento: '2026-01-01',
      localizacao_destino_id: LOCAL.SECAO
    }

    it('movimento aceita quantidade inteira', () => {
      aceita(mapotecaSchema.movimentoMaterial.validate({ ...entrada, quantidade: 100 }))
    })

    it('movimento recusa quantidade fracionaria', () => {
      recusaPor(
        mapotecaSchema.movimentoMaterial.validate({ ...entrada, quantidade: 100.5 }),
        'quantidade',
        'number.integer'
      )
    })

    // ZERO NAO E MOVIMENTO. O saldo pode ser zero (o CHECK do banco e >= 0:
    // material que acabou continua cadastrado), mas movimentar zero nao move
    // nada -- e uma linha no livro que nao explica saldo nenhum.
    it('movimento recusa quantidade zero', () => {
      recusaPor(
        mapotecaSchema.movimentoMaterial.validate({ ...entrada, quantidade: 0 }),
        'quantidade',
        'number.positive'
      )
    })

    // NEGATIVO TAMBEM NAO, e a razao nao e so "quantidade nao e negativa": o
    // SENTIDO do movimento mora em qual dos dois lados esta preenchido, e nao
    // no sinal. Aceitar -5 daria um segundo jeito de dizer a mesma coisa, e
    // dois jeitos e o que faz duas consultas discordarem.
    it('movimento recusa quantidade negativa: o sentido nao mora no sinal', () => {
      recusaPor(
        mapotecaSchema.movimentoMaterial.validate({ ...entrada, quantidade: -5 }),
        'quantidade',
        'number.positive'
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
  // A PODA DO PEDIDO (2026-08-08)
  // -------------------------------------------------------------------------
  // Tres colunas sairam por MEDICAO contra a producao, e a prova de que sairam
  // e que elas nao voltam por acidente:
  //
  //   situacao_pedido code 1  'Pre cadastramento', ZERO pedidos em 166;
  //   pedido.omds             124 preenchidas, UM valor distinto em todas;
  //   produto_pedido.quantidade_fornecida
  //                           igual a `quantidade` em 1759 de 1759.
  //
  // A gemea `tipo_midia_fornecida_id` NAO saiu, e tem caso proprio abaixo: ela
  // tem 25 divergencias reais. O sufixo igual nao e argumento.
  describe('a poda do pedido', () => {
    const pedidoBase = {
      data_pedido: '2026-01-01',
      cliente_id: 1,
      situacao_pedido_id: 2
    }

    it('a situacao 1 nao existe mais, e o Joi diz que o valor nao esta na lista', () => {
      recusaPor(
        mapotecaSchema.pedido.validate({ ...pedidoBase, situacao_pedido_id: 1 }),
        'situacao_pedido_id',
        'any.only'
      )
    })

    it('a situacao 2 continua valendo: mudou o rotulo, nao o code', () => {
      const value = aceita(mapotecaSchema.pedido.validate(pedidoBase))
      expect(value.situacao_pedido_id).toBe(2)
    })

    it('as outras cinco situacoes continuam valendo', () => {
      for (const code of [3, 4, 7]) {
        aceita(mapotecaSchema.pedido.validate({ ...pedidoBase, situacao_pedido_id: code }))
      }
      // 5 exige data_atendimento e 6 exige motivo, pelas RN02 e RN03.
      aceita(mapotecaSchema.pedido.validate({
        ...pedidoBase, situacao_pedido_id: 5, data_atendimento: '2026-01-02'
      }))
      aceita(mapotecaSchema.pedido.validate({
        ...pedidoBase, situacao_pedido_id: 6, motivo_cancelamento: 'desistência'
      }))
    })

    // DESCARTA, e nao recusa: o schemaValidation roda com stripUnknown e devolve
    // o aviso no envelope. O que se prova e que a chave nao chega ao controller,
    // que e o que a faria virar coluna de novo.
    it('omds nao volta: a chave e descartada do corpo do pedido', () => {
      const value = aceita(mapotecaSchema.pedido.validate(
        { ...pedidoBase, omds: '1º CGEO' },
        { stripUnknown: true }
      ))
      expect(value).not.toHaveProperty('omds')
    })

    it('quantidade_fornecida nao volta: a chave e descartada do item', () => {
      const value = aceita(mapotecaSchema.produtoPedido.validate(
        { uuid_versao: UUID, pedido_id: 1, quantidade: 10, tipo_midia_id: 1, quantidade_fornecida: 10 },
        { stripUnknown: true }
      ))
      expect(value).not.toHaveProperty('quantidade_fornecida')
    })

    // A GEMEA QUE FICOU. Sem este caso, alguem lendo "fornecida saiu" apagaria
    // as duas, e as 25 divergencias de midia perderiam o unico registro delas.
    it('tipo_midia_fornecida_id FICA, e chega ao controller', () => {
      const value = aceita(mapotecaSchema.produtoPedido.validate({
        uuid_versao: UUID, pedido_id: 1, quantidade: 10,
        tipo_midia_id: 8, tipo_midia_fornecida_id: 5
      }))
      expect(value.tipo_midia_fornecida_id).toBe(5)
    })
  })

  // -------------------------------------------------------------------------
  // O filtro por palavra-chave da lista de pedidos
  // -------------------------------------------------------------------------
  // A etiqueta e casada INTEIRA, pelo indice GIN da coluna, e por isso o schema
  // cuida de duas bordas que fariam a lista voltar vazia sem dizer por que: o
  // espaco na ponta (que nunca casaria nada) e a string em branco (que pediria
  // "pedido com a etiqueta vazia", e e sempre engano).
  describe('filtro por palavra-chave da lista de pedidos', () => {
    it('a palavra-chave e opcional: sem ela a lista e a do ano inteiro', () => {
      const value = aceita(mapotecaSchema.pedidoListaQuery.validate({ ano: 2026 }))
      expect(value).not.toHaveProperty('palavra_chave')
    })

    it('apara o espaco da ponta, que nunca casaria etiqueta nenhuma', () => {
      const value = aceita(mapotecaSchema.pedidoListaQuery.validate({
        ano: 2026, palavra_chave: '  Extra-PIT  '
      }))
      expect(value.palavra_chave).toBe('Extra-PIT')
    })

    it('recusa a palavra-chave em branco', () => {
      recusaPor(
        mapotecaSchema.pedidoListaQuery.validate({ ano: 2026, palavra_chave: '   ' }),
        'palavra_chave',
        'string.empty'
      )
    })

    it('o ano continua caindo no corrente quando nao vem', () => {
      const value = aceita(mapotecaSchema.pedidoListaQuery.validate({ palavra_chave: '5ª DE' }))
      expect(value.ano).toBe(new Date().getFullYear())
    })
  })

  // -------------------------------------------------------------------------
  // Defaults que o controller assume
  // -------------------------------------------------------------------------
  // Cada um destes existe porque ALGUEM depende dele adiante: o array vazio
  // evita `null` chegando a coluna de texto[], e o `false` evita `undefined`
  // virando NULL num BOOLEAN NOT NULL.
  describe('defaults', () => {
    it('pedido nasce com palavras_chave vazia e fora do PIT', () => {
      const value = aceita(mapotecaSchema.pedido.validate({
        data_pedido: '2026-01-01', cliente_id: 1, situacao_pedido_id: 2
      }))
      expect(value.palavras_chave).toEqual([])
      expect(value.previsto_pit).toBe(false)
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

    // A manutencao do plotter saiu daqui em 2026-08-13, com o resto do plotter:
    // ela e `equipamento.manutencao`, e o CHECK de valor positivo dela tem
    // prova em `unit/schemas/equipamento.test.js`.
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
        situacao_pedido_id: 2,
        data_atendimento: null
      }))
    })

    it('filtro do livro sem nenhum campo e valido: e a listagem inteira', () => {
      const value = aceita(mapotecaSchema.movimentoMaterialFiltro.validate({}))
      expect(value).toEqual({})
    })
  })

  // -------------------------------------------------------------------------
  // A FORMA de cada tipo de movimento
  // -------------------------------------------------------------------------
  // A regra vive em DOIS lugares, e as duas cobrancas existem por razoes
  // diferentes: o Joi devolve um 400 limpo que NOMEIA o campo, e o CHECK do
  // banco garante que nenhuma outra porta (CLI, carga, psql) grave a combinacao
  // invalida. Aqui se prova o Joi; o CHECK tem prova propria contra o banco.
  describe('a forma de cada tipo de movimento', () => {
    const base = { tipo_material_id: 1, quantidade: 10, data_movimento: '2026-01-01' }

    it('Entrada nao tem origem: o material chega de fora', () => {
      aceita(mapotecaSchema.movimentoMaterial.validate({
        ...base,
        tipo_movimento_id: TIPO_MOVIMENTO.ENTRADA,
        localizacao_destino_id: LOCAL.ALMOXARIFADO
      }))

      recusaPor(
        mapotecaSchema.movimentoMaterial.validate({
          ...base,
          tipo_movimento_id: TIPO_MOVIMENTO.ENTRADA,
          localizacao_origem_id: LOCAL.SECAO,
          localizacao_destino_id: LOCAL.ALMOXARIFADO
        }),
        'localizacao_origem_id',
        'any.only'
      )
    })

    it('Transferencia recusa origem igual ao destino', () => {
      // Somaria e subtrairia o mesmo saldo, e passaria por lancamento valido.
      //
      // A recusa vem com caminho VAZIO porque e uma regra do PAR, e nao de um
      // campo. O `recusaPor` nao serve aqui, e o `recusaRegraDeObjeto` tambem
      // nao: `object.assert` nao traz `peers`. O que se prende e a REGRA e o
      // campo que ela nomeia na mensagem.
      const { error } = mapotecaSchema.movimentoMaterial.validate({
        ...base,
        tipo_movimento_id: TIPO_MOVIMENTO.TRANSFERENCIA,
        localizacao_origem_id: LOCAL.SECAO,
        localizacao_destino_id: LOCAL.SECAO
      })

      expect(error).toBeDefined()
      expect(error.details[0].type).toBe('object.assert')
      expect(error.details[0].message)
        .toBe('"value" is invalid because "localizacao_destino_id" failed to ser diferente da origem')
    })

    it('Transferencia aceita origem diferente do destino', () => {
      aceita(mapotecaSchema.movimentoMaterial.validate({
        ...base,
        tipo_movimento_id: TIPO_MOVIMENTO.TRANSFERENCIA,
        localizacao_origem_id: LOCAL.ALMOXARIFADO,
        localizacao_destino_id: LOCAL.SECAO
      }))
    })

    it('Consumo so sai da Secao, e nao tem destino', () => {
      aceita(mapotecaSchema.movimentoMaterial.validate({
        ...base,
        tipo_movimento_id: TIPO_MOVIMENTO.CONSUMO,
        localizacao_origem_id: LOCAL.SECAO
      }))

      // Consumir do Almoxarifado seria gastar material que ainda nao foi
      // trazido para onde se usa; do 'Saldo no empenho', material que ainda
      // esta com o fornecedor.
      recusaPor(
        mapotecaSchema.movimentoMaterial.validate({
          ...base,
          tipo_movimento_id: TIPO_MOVIMENTO.CONSUMO,
          localizacao_origem_id: LOCAL.ALMOXARIFADO
        }),
        'localizacao_origem_id',
        'any.only'
      )
    })

    // A CONTAGEM (tipo 4) FOI EXTINTA em 2026-08-08, e estes dois casos sao o
    // que impede a volta dela por descuido.
    //
    // O 4 nao sumiu do banco: a linha continua em
    // `mapoteca.tipo_movimento_material` para a auditoria antiga se traduzir. Um
    // corpo com tipo 4 e, portanto, uma FK VALIDA -- quem o recusa e este Joi,
    // e o `ELSE FALSE` do CHECK de forma atras dele.
    it('recusa o tipo 4, a Contagem extinta', () => {
      // Recusado ANTES da forma: nao importa quais lados o corpo traga, o valor
      // do tipo ja nao esta na lista.
      recusaPor(
        mapotecaSchema.movimentoMaterial.validate({
          ...base,
          tipo_movimento_id: 4,
          localizacao_destino_id: LOCAL.SECAO,
          motivo: 'Conferencia de prateleira'
        }),
        'tipo_movimento_id',
        'any.only'
      )
    })

    it('o motivo e opcional nos tres tipos', () => {
      // A exigencia que existia era da Contagem, e saiu com ela: os tres que
      // ficaram se explicam pelo proprio tipo. Sem esta prova, um `.required()`
      // que voltasse ao MOTIVO passaria despercebido ate a tela recusar.
      aceita(mapotecaSchema.movimentoMaterial.validate({
        ...base,
        tipo_movimento_id: TIPO_MOVIMENTO.ENTRADA,
        localizacao_destino_id: LOCAL.ALMOXARIFADO
      }))
      aceita(mapotecaSchema.movimentoMaterial.validate({
        ...base,
        tipo_movimento_id: TIPO_MOVIMENTO.TRANSFERENCIA,
        localizacao_origem_id: LOCAL.ALMOXARIFADO,
        localizacao_destino_id: LOCAL.SECAO
      }))
      aceita(mapotecaSchema.movimentoMaterial.validate({
        ...base,
        tipo_movimento_id: TIPO_MOVIMENTO.CONSUMO,
        localizacao_origem_id: LOCAL.SECAO
      }))
    })
  })

  // -------------------------------------------------------------------------
  // Atualizacao exige o id
  // -------------------------------------------------------------------------
  // Um caso por schema de atualizacao seria repeticao; a regra e a mesma e a
  // tabela abaixo cobre os dois de uma vez. Sem o id o controller montaria um
  // UPDATE sem WHERE, e o pg-promise recusaria o parametro faltando -- mas com
  // 500, e nao com 400 dizendo o campo.
  describe('atualizacao exige id', () => {
    const corpos = {
      clienteAtualizacao: { nome: '6 RCB', tipo_cliente_id: 1 },
      movimentoMaterialAtualizacao: {
        tipo_material_id: 1,
        tipo_movimento_id: 1,
        quantidade: 1,
        data_movimento: '2026-01-01',
        localizacao_destino_id: 1
      }
    }

    it.each(Object.keys(corpos))('%s recusa corpo sem id', (schema) => {
      recusaPor(mapotecaSchema[schema].validate(corpos[schema]), 'id', 'any.required')
    })
  })
})
