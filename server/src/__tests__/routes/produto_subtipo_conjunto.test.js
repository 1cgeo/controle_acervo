'use strict'

/**
 * CORRIGIR O SUBTIPO DE UM PRODUTO JÁ CADASTRADO, junto com as versões dele.
 *
 * O IMPASSE QUE ISTO RESOLVE, medido em 2026-08-06 num produto real: a
 * "Porto Alegre - S" está cadastrada como Carta Topográfica e é Carta
 * Ortoimagem. Corrigir era IMPOSSÍVEL pela API, e o impasse era circular:
 *
 *   mudar o PRODUTO  -> a guarda de `atualizaProduto` recusa, porque as versões
 *                       existentes têm outro subtipo;
 *   mudar a VERSÃO   -> o gatilho `acervo.validate_version` recusa, porque o
 *                       produto tem outro subtipo.
 *
 * Nenhum dos dois podia ir primeiro. O conserto é a troca CONJUNTA, na mesma
 * transação, pedida explicitamente com `migrar_subtipo_das_versoes`.
 *
 * O PADRÃO CONTINUA RECUSANDO, e é deliberado: mudar o subtipo do produto
 * reescreve a identidade de toda versão dele, e isso não pode acontecer por
 * descuido de quem só queria corrigir o nome.
 */

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken } = require('../helpers/auth')
const { createProduto, createVersao } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

/** Produto com UMA versão, os dois no subtipo 1. */
const comVersao = async () => {
  const produto = await createProduto({ subtipo_produto_id: 1 })
  const versao = await createVersao(produto.id, { subtipo_produto_id: 1 })
  return { produto, versao }
}

const corpoDoProduto = (produto, extra = {}) => ({
  id: Number(produto.id),
  nome: produto.nome,
  mi: produto.mi,
  inom: produto.inom,
  tipo_escala_id: produto.tipo_escala_id,
  denominador_escala_especial: produto.denominador_escala_especial,
  tipo_produto_id: produto.tipo_produto_id,
  descricao: produto.descricao || '',
  ...extra
})

const atualizar = body =>
  request(app).put('/api/produtos/produto').set('Authorization', admin()).send(body)

const subtipoDe = async (tabela, id) =>
  (await conn.one(
    `SELECT subtipo_produto_id FROM acervo.${tabela} WHERE id = $<id>`, { id }
  )).subtipo_produto_id

describe('trocar o subtipo do produto e das versões de uma vez', () => {
  test('SEM o pedido explícito, a guarda recusa e não muda nada', async () => {
    const { produto, versao } = await comVersao()

    const res = await atualizar(corpoDoProduto(produto, { subtipo_produto_id: 2 }))

    expect(res.status).toBe(400)
    // A mensagem ENSINA a saída, em vez de só dizer não.
    expect(res.body.message).toMatch(/migrar_subtipo_das_versoes/)

    // E nada foi gravado: recusa que grava metade é pior que recusa.
    expect(await subtipoDe('produto', produto.id)).toBe(1)
    expect(await subtipoDe('versao', versao.id)).toBe(1)
  })

  test('COM o pedido, o produto e a versão trocam juntos', async () => {
    const { produto, versao } = await comVersao()

    const res = await atualizar(corpoDoProduto(produto, {
      subtipo_produto_id: 2,
      migrar_subtipo_das_versoes: true
    }))

    expect(res.status).toBe(200)
    expect(await subtipoDe('produto', produto.id)).toBe(2)
    expect(await subtipoDe('versao', versao.id)).toBe(2)
  })

  test('a versão migrada deixa o PRÓPRIO rastro', async () => {
    const { produto, versao } = await comVersao()

    await atualizar(corpoDoProduto(produto, {
      subtipo_produto_id: 2,
      migrar_subtipo_das_versoes: true
    }))

    // Registrar só o produto esconderia que a identidade da versão mudou junto.
    const eventos = await conn.any(
      `SELECT campos_alterados FROM auditoria.evento
       WHERE tabela = 'acervo.versao' AND registro_id = $<id> AND operacao = 'U'`,
      { id: String(versao.id) }
    )
    expect(eventos.length).toBeGreaterThanOrEqual(1)
    expect(eventos.some(e => (e.campos_alterados || []).includes('subtipo_produto_id')))
      .toBe(true)
  })

  // VARIÂNCIA: sem este caso, os de cima passariam numa implementação que
  // migrasse SEMPRE, e aí a flag seria enfeite.
  test('o produto SEM versão conflitante não precisa da flag', async () => {
    const produto = await createProduto({ subtipo_produto_id: 1 })

    const res = await atualizar(corpoDoProduto(produto, { subtipo_produto_id: 2 }))

    expect(res.status).toBe(200)
    expect(await subtipoDe('produto', produto.id)).toBe(2)
  })
})

/**
 * A RECUSA DO GATILHO VIRA 400, e não 500.
 *
 * O gatilho `acervo.validate_version` recusa com `RAISE EXCEPTION`, e a exceção
 * subia crua: o cliente via "Erro no servidor". 500 diz "o sistema quebrou", e o
 * que houve foi o sistema RECUSAR, com o motivo já escrito na mensagem.
 */
describe('a recusa do gatilho chega como 400 com a razão', () => {
  test('versão com subtipo divergente do produto responde 400, e não 500', async () => {
    const { produto, versao } = await comVersao()

    const res = await request(app)
      .put('/api/produtos/versao')
      .set('Authorization', admin())
      .send({
        id: Number(versao.id),
        versao: versao.versao,
        nome: versao.nome,
        tipo_versao_id: versao.tipo_versao_id,
        // O produto está no subtipo 1: este 2 é o que o gatilho recusa.
        subtipo_produto_id: 2,
        descricao: versao.descricao || '',
        metadado: {},
        lote_id: null,
        orgao_produtor: versao.orgao_produtor,
        data_criacao: '2026-01-01',
        data_edicao: '2026-01-02'
      })

    expect(res.status).toBe(400)
    // A frase do gatilho chega inteira: ela nomeia os dois subtipos.
    expect(res.body.message).toMatch(/subtipo/i)

    // E o banco não mudou.
    expect(await subtipoDe('versao', versao.id)).toBe(1)
  })
})
