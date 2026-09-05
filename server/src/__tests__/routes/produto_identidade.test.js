'use strict'

/**
 * A identidade do produto é (mi, escala, tipo, subtipo), e a REGRA não pode
 * depender do botão que a pessoa apertou.
 *
 * Quem garante a unicidade de verdade é o índice `unique_produto_identidade`
 * (er/acervo.sql), então nunca houve duplicata silenciosa: o banco recusa. O que
 * havia era divergência de MENSAGEM. Só o assistente de carregamento conferia
 * antes e devolvia 409 dizendo qual produto já ocupa a identidade e o que fazer;
 * os outros dois caminhos de criação deixavam o índice estourar, o que não diz
 * nada ao operador e, no lote, derruba a transação inteira depois de tudo
 * preenchido.
 *
 * A conferência mora em utils/identidade_produto.js, e os três caminhos a
 * chamam: regra em três lugares diverge.
 */

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createProduto } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const token = () => generateAdminToken()

const GEOM = 'SRID=4674;POLYGON((-51 -30, -51 -29, -50 -29, -50 -30, -51 -30))'

/** Corpo de um produto que colide com o `base` em MI, escala, tipo e subtipo. */
const colidente = (base) => ({
  nome: 'Tentativa duplicada',
  mi: base.mi,
  inom: 'INOM-OUTRO',
  tipo_escala_id: base.tipo_escala_id,
  // Obrigatório como `null` fora da escala personalizada: o schema o cobra.
  denominador_escala_especial: null,
  tipo_produto_id: base.tipo_produto_id,
  subtipo_produto_id: null,
  descricao: 'produto que repete a identidade',
  geom: GEOM
})

describe('Identidade do produto - a regra vale nos dois caminhos de criação', () => {
  it('"Novo produto" recusa a identidade repetida, com 409 e o id do existente', async () => {
    const base = await createProduto({ mi: 'MI-IDENT-1', inom: 'INOM-IDENT-1' })

    const res = await request(app)
      .post('/api/produtos/produtos')
      .set('Authorization', token())
      .send({ produtos: [colidente(base)] })

    expect(res.status).toBe(409)
    // A mensagem diz QUAL produto ocupa a identidade e o que fazer em seguida.
    expect(res.body.message).toContain(String(base.id))
    expect(res.body.message).toContain('envio de versão')
  })

  it('produto com versão histórica recusa pela MESMA regra', async () => {
    const base = await createProduto({ mi: 'MI-IDENT-2', inom: 'INOM-IDENT-2' })

    const res = await request(app)
      .post('/api/produtos/produto_versao_historica')
      .set('Authorization', token())
      // O corpo desta rota é um ARRAY na raiz, e a versão vai aninhada.
      .send([{
        ...colidente(base),
        versoes: [{
          uuid_versao: null,
          versao: '1ª Edição',
          nome: 'Histórica',
          subtipo_produto_id: 2,
          lote_id: null,
          metadado: {},
          descricao: 'teste',
          orgao_produtor: '1º CGEO',
          palavras_chave: [],
          data_criacao: '2020-01-01',
          data_edicao: '2020-01-01'
        }]
      }])

    // O que importa é NÃO ser o estouro cru do índice: a identidade é recusada
    // com o mesmo 409 do outro caminho.
    expect(res.status).toBe(409)
    expect(res.body.message).toContain(String(base.id))
  })

  // A ATUALIZACAO tambem move um produto para a identidade de outro, e por ali
  // nao havia conferencia nenhuma: o indice estourava com `23505`, o unico
  // codigo que este controlador traduz e `P0001`, e o erro subia cru como 500
  // com o nome interno da constraint.
  it('a ATUALIZACAO recusa mover um produto para a identidade de outro', async () => {
    const a = await createProduto({ mi: 'MI-IDENT-PUT', inom: 'INOM-PUT-A' })
    const b = await createProduto({ mi: 'MI-IDENT-OUTRO', inom: 'INOM-PUT-B' })

    const res = await request(app)
      .put('/api/produtos/produto')
      .set('Authorization', token())
      .send({
        // `acervo.produto.id` e BIGSERIAL e chega como STRING; o schema o cobra
        // com `Joi.number().integer().strict()`. Sem o cast o PUT toma 400 do
        // Joi e o teste provaria a validacao de tipo, e nao a identidade.
        id: Number(b.id),
        nome: b.nome,
        mi: a.mi,
        inom: b.inom,
        tipo_escala_id: a.tipo_escala_id,
        denominador_escala_especial: null,
        tipo_produto_id: a.tipo_produto_id,
        subtipo_produto_id: null,
        descricao: 'tentando roubar a identidade'
      })

    expect(res.status).toBe(409)
    // A mensagem NOMEIA o produto que ja ocupa a identidade, como na criacao.
    expect(res.body.message).toContain(String(a.id))
    expect(res.body.message).not.toMatch(/unique_produto_identidade/)
  })

  // CONTROLE POSITIVO, e o caso comum: reenviar o proprio produto sem mudar a
  // identidade nao pode 409. A conferencia procura a identidade sem excluir o
  // proprio produto, entao ela so roda quando a identidade MUDOU.
  it('reenviar o proprio produto sem mudar a identidade continua gravando', async () => {
    const p = await createProduto({ mi: 'MI-IDENT-NOOP', inom: 'INOM-NOOP' })

    const res = await request(app)
      .put('/api/produtos/produto')
      .set('Authorization', token())
      .send({
        id: Number(p.id),
        nome: 'Nome novo, identidade igual',
        mi: p.mi,
        inom: p.inom,
        tipo_escala_id: p.tipo_escala_id,
        denominador_escala_especial: null,
        tipo_produto_id: p.tipo_produto_id,
        subtipo_produto_id: null,
        descricao: 'so o nome mudou'
      })

    expect(res.status).toBe(200)
  })

  it('MI nulo fica FORA da regra, como o índice parcial', async () => {
    // Carta especial e campo de instrução têm moldura própria e MI nulo. O
    // índice é parcial (WHERE mi IS NOT NULL), e a conferência tem de respeitar
    // isso: dois produtos sem MI convivem.
    await createProduto({ mi: null, inom: null, nome: 'Especial A' })

    const res = await request(app)
      .post('/api/produtos/produtos')
      .set('Authorization', token())
      .send({
        produtos: [{
          nome: 'Especial B',
          mi: null,
          inom: null,
          tipo_escala_id: 2,
          denominador_escala_especial: null,
          tipo_produto_id: 1,
          subtipo_produto_id: null,
          descricao: 'outra especial',
          geom: GEOM
        }]
      })

    expect(res.status).toBe(201)
  })
})
