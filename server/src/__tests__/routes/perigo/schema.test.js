'use strict'

// O CONTRATO DE ENTRADA DA ZONA DE PERIGO.
//
// Toda recusa aqui prova o MOTIVO, e nao so que houve recusa: `recusaPor` do
// `helpers/joi.js` prende o CAMPO e a REGRA do primeiro erro do Joi. Num modulo
// que apaga, isso importa mais que em qualquer outro: um caso que so exige
// "houve erro" continuaria verde depois de alguem remover a exigencia de
// confirmacao, desde que a fixtura falhasse por outra coisa qualquer.

const schema = require('../../../perigo/perigo_schema')
const { recusaPor, aceita } = require('../../helpers/joi')

const POLIGONO = JSON.stringify({
  type: 'Polygon',
  coordinates: [[[-44, -22], [-43, -22], [-43, -23], [-44, -23], [-44, -22]]]
})

describe('a confirmação das três rotas que varrem', () => {
  // A FORMA E A DO `--confirmar` DOS CLIs DA CASA: repete-se o NOME DA ACAO, e
  // nao um booleano. `acervo_cli/comandos/editar.js` obriga a repetir o id pelo
  // mesmo motivo -- "a confirmacao repete o id, para que confirmar seja um ato, e
  // nao um enter".

  // SAO DOIS DESDE 2026-08-09: `produtosSemUtBody` e `loteSemProdutoBody` sairam
  // junto com as rotas que os usavam, e nenhum outro lugar os cita.
  const CASOS = [
    ['limpaLogBody', schema.TOKEN.LOG],
    ['utSemAtividadeBody', schema.TOKEN.UT_SEM_ATIVIDADE]
  ]

  it.each(CASOS)('%s aceita o token correto', (nome, token) => {
    expect(aceita(schema[nome].validate({ confirmar: token })))
      .toEqual({ confirmar: token })
  })

  it.each(CASOS)('%s recusa o corpo VAZIO', nome => {
    // O caso que a regra existe para pegar: `DELETE` sem corpo, disparado por uma
    // aba aberta ou por uma seta para cima no terminal.
    recusaPor(schema[nome].validate({}), 'confirmar', 'any.required')
  })

  it.each(CASOS)('%s recusa confirmacao booleana', nome => {
    // Um `true` se copia junto com a URL e sobrevive ao copiar e colar. Nao e um
    // ato. A recusa sai por `any.only`, e nao por `string.base`: o `valid()` do
    // Joi e conferido ANTES do tipo, e a mensagem que chega e a que ensina o
    // token -- que e justamente a util.
    recusaPor(schema[nome].validate({ confirmar: true }), 'confirmar', 'any.only')
  })

  it.each(CASOS)('%s recusa o token de OUTRA rota', (nome, token) => {
    const outro = CASOS.map(c => c[1]).find(t => t !== token)
    recusaPor(schema[nome].validate({ confirmar: outro }), 'confirmar', 'any.only')
  })

  it('a mensagem de recusa ENSINA o corpo certo', () => {
    // Quem levou 400 tem de descobrir o que mandar pela resposta, e nao lendo o
    // fonte da rota.
    const { error } = schema.utSemAtividadeBody.validate({})

    expect(error.message).toContain('"confirmar"')
    expect(error.message).toContain('"apagar_ut_sem_atividade"')
    expect(error.message).toContain('não tem desfazer')
  })

  it('os dois tokens sao DIFERENTES entre si', () => {
    // Tokens iguais fariam a confirmacao de uma rota valer para a outra, que e o
    // acidente inteiro de volta.
    const tokens = Object.values(schema.TOKEN)
    expect(new Set(tokens).size).toBe(tokens.length)
  })

  it('SAO DOIS, e os dois de 2026-08-09 nao voltaram', () => {
    // Rota cuja premissa morreu nao vira rota mais cuidadosa, vira rota que nao
    // existe -- e um token de confirmacao sobrevivente seria o convite para
    // propo-la de volta "agora com confirmacao mais forte".
    expect(Object.keys(schema.TOKEN)).toEqual(['LOG', 'UT_SEM_ATIVIDADE'])
    expect(schema.produtosSemUtBody).toBeUndefined()
    expect(schema.loteSemProdutoBody).toBeUndefined()
  })

  it('o motivo e opcional e vai junto', () => {
    const valor = aceita(schema.limpaLogBody.validate({
      confirmar: schema.TOKEN.LOG, motivo: 'log ocupando o disco'
    }))
    expect(valor.motivo).toBe('log ocupando o disco')
  })

  it('recusa chave desconhecida no corpo', () => {
    // O validador da rota e o ESTRITO, mas o schema tambem nao a declara: quem
    // escreveu `confirmo` no lugar de `confirmar` tem de saber.
    recusaPor(
      schema.limpaLogBody.validate({ confirmar: schema.TOKEN.LOG, confirmo: 'x' }),
      'confirmo',
      'object.unknown'
    )
  })
})

describe('a confirmação da rota que tem alvo', () => {
  // A TERCEIRA ROTA TEM UM ID A REPETIR, entao a regra do CLI vale ao pe da letra:
  // o que se confirma e o proprio uuid da pessoa.
  const UUID = '1e2f3a4b-5c6d-4e8f-9a0b-1c2d3e4f5a6b'

  it('aceita o uuid repetido', () => {
    expect(aceita(schema.limpaAtividadesBody.validate({ confirmar: UUID })))
      .toEqual({ confirmar: UUID })
  })

  it('exige a confirmacao', () => {
    recusaPor(schema.limpaAtividadesBody.validate({}), 'confirmar', 'any.required')
  })

  it('recusa confirmacao que nao e uuid', () => {
    recusaPor(
      schema.limpaAtividadesBody.validate({ confirmar: 'sim' }),
      'confirmar',
      'string.guid'
    )
  })

  it('o caminho exige um uuid, e nao um id inteiro', () => {
    // No SAP o alvo era `usuario_id` INTEGER. Aqui toda coluna de pessoa do
    // schema `producao` e `usuario_uuid`, e casar id com uuid seria silencioso.
    recusaPor(schema.limpaAtividadesParams.validate({ uuid: '17' }), 'uuid', 'string.guid')
    expect(aceita(schema.limpaAtividadesParams.validate({ uuid: UUID })).uuid).toBe(UUID)
  })
})

describe('propriedades de camada', () => {
  const base = {
    camada_id: 3,
    subfase_id: 5,
    camada_incomum: false,
    camada_apontamento: false
  }

  it('aceita a camada comum', () => {
    const valor = aceita(schema.propriedadesCamadaCriar.validate({
      propriedades_camada: [base]
    }))
    expect(valor.propriedades_camada[0].camada_id).toBe(3)
  })

  it('aceita a camada de apontamento com os dois atributos', () => {
    aceita(schema.propriedadesCamadaCriar.validate({
      propriedades_camada: [{
        ...base,
        camada_apontamento: true,
        atributo_situacao_correcao: 'situacao_correcao',
        atributo_justificativa_apontamento: 'justificativa'
      }]
    }))
  })

  it('recusa camada de apontamento SEM os atributos', () => {
    // Espelha o CHECK `propriedades_camada_apontamento_completo` do DDL. Sem esta
    // regra aqui, o erro que chega na tela e o texto cru do PostgreSQL citando o
    // nome da constraint, em ingles.
    const { error } = schema.propriedadesCamadaCriar.validate({
      propriedades_camada: [{ ...base, camada_apontamento: true }]
    })
    expect(error).toBeDefined()
    expect(error.details[0].path.join('.')).toBe('propriedades_camada.0')
    expect(error.message).toContain('atributo_situacao_correcao')
  })

  it('recusa camada COMUM que declara atributo de apontamento', () => {
    // A outra metade do CHECK: camada comum com os atributos preenchidos afirma
    // o que ela nao e.
    const { error } = schema.propriedadesCamadaCriar.validate({
      propriedades_camada: [{ ...base, atributo_situacao_correcao: 'x' }]
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('não é de apontamento')
  })

  it('a atualizacao exige o id de cada linha', () => {
    recusaPor(
      schema.propriedadesCamadaAtualizar.validate({ propriedades_camada: [base] }),
      ['propriedades_camada', 0, 'id'],
      'any.required'
    )
  })

  it('a exclusao exige ao menos um id', () => {
    recusaPor(
      schema.propriedadesCamadaIds.validate({ propriedades_camada_ids: [] }),
      'propriedades_camada_ids',
      'array.min'
    )
  })

  it('a exclusao recusa id repetido', () => {
    // Id repetido faria a segunda passada procurar uma linha que a primeira ja
    // apagou, e o 404 sairia como se o id nunca tivesse existido.
    recusaPor(
      schema.propriedadesCamadaIds.validate({ propriedades_camada_ids: [3, 3] }),
      ['propriedades_camada_ids', 1],
      'array.unique'
    )
  })
})

describe('insumo', () => {
  const base = {
    nome: 'Ortoimagem 2025',
    caminho: 'ortos/2025',
    tipo_insumo_id: 1,
    grupo_insumo_id: 2
  }

  it('aceita insumo sem geometria', () => {
    // NULA QUER DIZER INSUMO NAO ESPACIAL, e a ausencia e uma afirmacao: uma
    // tabela, um servico ou um documento vale para toda a area.
    const valor = aceita(schema.insumoCriar.validate({ insumo: [base] }))
    expect(valor.insumo[0].geom).toBeUndefined()
  })

  it('aceita insumo com poligono', () => {
    aceita(schema.insumoCriar.validate({ insumo: [{ ...base, geom: POLIGONO }] }))
  })

  it('recusa MultiPolygon', () => {
    // A coluna `producao.insumo.geom` e `geometry(POLYGON, 4674)`: aceitar mais
    // na porta produziria uma recusa do PostGIS falando de tipo de geometria,
    // longe de quem cadastrou.
    const multi = JSON.stringify({
      type: 'MultiPolygon',
      coordinates: [[[[-44, -22], [-43, -22], [-43, -23], [-44, -22]]]]
    })
    const { error } = schema.insumoCriar.validate({ insumo: [{ ...base, geom: multi }] })
    expect(error).toBeDefined()
    expect(error.message).toContain('Polygon')
  })

  it('recusa anel aberto', () => {
    // Anel aberto entra no PostGIS como geometria invalida, e a mensagem de la
    // fala de "IllegalArgumentException".
    const aberto = JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-44, -22], [-43, -22], [-43, -23], [-44, -23]]]
    })
    const { error } = schema.insumoCriar.validate({ insumo: [{ ...base, geom: aberto }] })
    expect(error).toBeDefined()
    expect(error.message).toContain('fechado')
  })

  it('recusa coordenada fora do mundo', () => {
    const fora = JSON.stringify({
      type: 'Polygon',
      coordinates: [[[-999, -22], [-43, -22], [-43, -23], [-999, -22]]]
    })
    const { error } = schema.insumoCriar.validate({ insumo: [{ ...base, geom: fora }] })
    expect(error).toBeDefined()
    expect(error.message).toContain('coordenada inválida')
  })

  it('recusa GeoJSON que nao e JSON', () => {
    const { error } = schema.insumoCriar.validate({
      insumo: [{ ...base, geom: 'POLYGON((-44 -22))' }]
    })
    expect(error).toBeDefined()
    expect(error.message).toContain('GeoJSON válido')
  })

  it('recusa epsg com mais de cinco caracteres', () => {
    // VARCHAR(5) no DDL. Sem a regra a recusa viria do PostgreSQL, citando o
    // tamanho da coluna.
    recusaPor(
      schema.insumoCriar.validate({ insumo: [{ ...base, epsg: '319784' }] }),
      ['insumo', 0, 'epsg'],
      'string.max'
    )
  })

  it('exige o caminho', () => {
    const { caminho, ...semCaminho } = base
    recusaPor(
      schema.insumoCriar.validate({ insumo: [semCaminho] }),
      ['insumo', 0, 'caminho'],
      'any.required'
    )
  })

  it('a atualizacao exige o id de cada linha', () => {
    recusaPor(
      schema.insumoAtualizar.validate({ insumo: [base] }),
      ['insumo', 0, 'id'],
      'any.required'
    )
  })

  it('a exclusao recusa lista vazia', () => {
    recusaPor(schema.insumoIds.validate({ insumo_ids: [] }), 'insumo_ids', 'array.min')
  })
})
