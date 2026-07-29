'use strict'

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, generateUserToken } = require('../helpers/auth')
const { createProjeto, createLote, createProduto } = require('../helpers/fixtures')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

// --- Helpers locais ---------------------------------------------------------

const criaLote = async () => {
  const projeto = await createProjeto({ nome: 'Projeto Ponto de Controle' })
  const lote = await createLote(projeto.id, { nome: 'Missão Teste', pit: 'PIT-PC-1' })
  return { projeto, lote }
}

// Um ponto como o GeoPackage da missão o entrega: cod_ponto e posição fora,
// todo o resto num objeto solto.
const pontoDeTeste = (codPonto, extras = {}) => ({
  cod_ponto: codPonto,
  latitude: -15.5,
  longitude: -47.9,
  atributos: {
    data_rastreio: '2026-05-12',
    tipo_situacao: 2,
    medidor: '3º Sgt Silva',
    altitude_ortometrica: 1024.35,
    altura_antena: 1.62,
    modelo_gps: 'Trimble R10',
    materializado: true,
    // `lote` e `projeto` sao colunas de TEXTO LIVRE do plugin, e tem nome igual
    // ao das entidades do acervo. Valores propositalmente diferentes: e assim
    // que este teste pega a colisao de alias (ver o teste da ficha).
    lote: 'caderno de campo 3',
    projeto: 'MIF 2026 (digitado pelo medidor)',
    ...extras
  },
  arquivos: []
})

// A importação tem duas fases. Os testes de CONSULTA abaixo só precisam de
// pontos gravados, e não do caminho de arquivo; por isso o atalho passa pelas
// duas rotas sem nenhum arquivo. O caminho completo, com volume e checksum,
// está em ponto_controle_upload.test.js.
const importa = async (corpo, token = generateAdminToken()) => {
  const prep = await request(app)
    .post('/api/ponto_controle/prepare-upload/missao')
    .set('Authorization', token)
    .send(corpo)
  if (prep.status !== 201) return prep

  return request(app)
    .post('/api/ponto_controle/confirm-upload')
    .set('Authorization', token)
    .send({ session_uuid: prep.body.dados.session_uuid })
}

// --- Testes -----------------------------------------------------------------


describe('Ponto de controle - consulta', () => {
  it('lista, filtra e pagina', async () => {
    const { projeto, lote } = await criaLote()
    const outro = await criaLote()

    await importa({
      lote_id: lote.id,
      pontos: [
        pontoDeTeste('RJ-HV-1'),
        pontoDeTeste('RJ-HV-2', { tipo_situacao: 4 })
      ]
    })
    await importa({
      lote_id: outro.lote.id,
      pontos: [pontoDeTeste('SP-BASE-1')]
    })

    const todos = await request(app)
      .get('/api/ponto_controle')
      .set('Authorization', generateAdminToken())
    expect(todos.status).toBe(200)
    expect(todos.body.dados.total).toBe(3)
    expect(todos.body.dados.pontos.map(p => p.cod_ponto)).toEqual([
      'RJ-HV-1',
      'RJ-HV-2',
      'SP-BASE-1'
    ])
    // Sem arquivo transferido, a contagem é zero. O caminho com arquivo de
    // verdade está em ponto_controle_upload.test.js.
    expect(todos.body.dados.pontos[0].total_arquivos).toBe(0)
    expect(todos.body.dados.pontos[0].lote).toBe('Missão Teste')

    const porLote = await request(app)
      .get(`/api/ponto_controle?lote_id=${lote.id}`)
      .set('Authorization', generateAdminToken())
    expect(porLote.body.dados.total).toBe(2)

    const porProjeto = await request(app)
      .get(`/api/ponto_controle?projeto_id=${projeto.id}`)
      .set('Authorization', generateAdminToken())
    expect(porProjeto.body.dados.total).toBe(2)

    const porSituacao = await request(app)
      .get('/api/ponto_controle?tipo_situacao=4')
      .set('Authorization', generateAdminToken())
    expect(porSituacao.body.dados.total).toBe(1)
    expect(porSituacao.body.dados.pontos[0].cod_ponto).toBe('RJ-HV-2')
    expect(porSituacao.body.dados.pontos[0].tipo_situacao_nome).toBe('Reprovado')

    const porCodigo = await request(app)
      .get('/api/ponto_controle?cod_ponto=BASE')
      .set('Authorization', generateAdminToken())
    expect(porCodigo.body.dados.total).toBe(1)

    const paginado = await request(app)
      .get('/api/ponto_controle?pagina=2&por_pagina=2')
      .set('Authorization', generateAdminToken())
    expect(paginado.body.dados.total).toBe(3)
    expect(paginado.body.dados.pontos).toHaveLength(1)
    expect(paginado.body.dados.pontos[0].cod_ponto).toBe('SP-BASE-1')
  })

  it('filtra pelo recorte do mapa', async () => {
    const { lote } = await criaLote()
    await importa({
      lote_id: lote.id,
      pontos: [
        pontoDeTeste('RJ-HV-1'),
        { ...pontoDeTeste('RJ-HV-2'), latitude: -3.1, longitude: -60.0 }
      ]
    })

    const dentro = await request(app)
      .get('/api/ponto_controle?bbox=-48.5,-16,-47.5,-15')
      .set('Authorization', generateAdminToken())
    expect(dentro.body.dados.total).toBe(1)
    expect(dentro.body.dados.pontos[0].cod_ponto).toBe('RJ-HV-1')

    const bboxTorto = await request(app)
      .get('/api/ponto_controle?bbox=-48.5,-16,-47.5')
      .set('Authorization', generateAdminToken())
    expect(bboxTorto.status).toBe(400)
  })

  it('devolve a ficha do ponto, e 404 para código que não existe', async () => {
    const { lote } = await criaLote()
    await importa({ lote_id: lote.id, pontos: [pontoDeTeste('RJ-HV-1')] })

    const res = await request(app)
      .get('/api/ponto_controle/RJ-HV-1')
      .set('Authorization', generateAdminToken())
    expect(res.status).toBe(200)
    expect(res.body.dados.cod_ponto).toBe('RJ-HV-1')
    // O campo derivado leva sufixo: `p.*` ja tem colunas `lote` e `projeto`,
    // que sao texto livre do plugin. Colidir os nomes deixaria o driver decidir
    // qual sobrevive.
    expect(res.body.dados.projeto_nome).toBe('Projeto Ponto de Controle')
    expect(res.body.dados.lote_nome).toBe('Missão Teste')

    // E o texto do plugin CHEGA INTEIRO, com os nomes originais. Este par de
    // asserções é a verificação que substitui a nota: colidir os aliases de
    // novo apaga um dos dois lados, e o teste fica vermelho na hora.
    expect(res.body.dados.lote).toBe('caderno de campo 3')
    expect(res.body.dados.projeto).toBe('MIF 2026 (digitado pelo medidor)')
    // O dominio resolvido sai como `<dominio>_nome` em TODA rota, e nao com um
    // apelido por consulta: a lista chamava de `situacao` e a ficha de outra
    // coisa, e a divergencia morderia o client.
    expect(res.body.dados.tipo_situacao).toBe(2)
    expect(res.body.dados.tipo_situacao_nome).toBe('Aguardando revisão')
    expect(res.body.dados.geom).toBeUndefined()

    // A posição sai da GEOMETRIA com nome próprio. Chamá-la de `latitude`
    // colidiria com a coluna REAL do plugin, que o `p.*` já traz, e qual das
    // duas sobreviveria seria detalhe do driver.
    expect(Number(res.body.dados.geom_latitude)).toBeCloseTo(-15.5, 6)
    expect(Number(res.body.dados.geom_longitude)).toBeCloseTo(-47.9, 6)
    // A coluna do plugin veio vazia neste ponto (o `atributos` não a mandou), e
    // é justamente por isso que ela não pode ser a fonte da ficha.
    expect(res.body.dados.latitude).toBeNull()
    expect(res.body.dados.arquivos).toEqual([])

    const ausente = await request(app)
      .get('/api/ponto_controle/RJ-HV-999')
      .set('Authorization', generateAdminToken())
    expect(ausente.status).toBe(404)
  })

  // Este teste é um CONTRATO com o client, e não uma cópia do DDL. A tela pinta
  // o mapa e os chips por CÓDIGO (verde = aprovado, vermelho = reprovado), e o
  // código vem daqui. Trocar 3 com 4 numa atualização do plugin faria o mapa
  // mentir sem erro nenhum, e este é o único lugar que percebe.
  it('os códigos de tipo_situacao são os que o client assume', async () => {
    const res = await request(app)
      .get('/api/ponto_controle/dominios')
      .set('Authorization', generateAdminToken())

    expect(res.body.dados.tipo_situacao).toEqual([
      { code: 1, nome: 'Não medido' },
      { code: 2, nome: 'Aguardando revisão' },
      { code: 3, nome: 'Aprovado' },
      { code: 4, nome: 'Reprovado' },
      { code: 9999, nome: 'A SER PREENCHIDO' }
    ])
  })

  it('devolve todos os domínios para a tela', async () => {
    const res = await request(app)
      .get('/api/ponto_controle/dominios')
      .set('Authorization', generateAdminToken())
    expect(res.status).toBe(200)

    // A rota /dominios tem de ganhar de /:cod_ponto, senão cairia no detalhe.
    expect(res.body.dados.tipo_situacao.length).toBeGreaterThan(0)
    expect(res.body.dados.tipo_arquivo.length).toBe(9)
    for (const dominio of Object.values(res.body.dados)) {
      for (const item of dominio) {
        expect(typeof item.code).toBe('number')
        expect(item.nome).toBeTruthy()
      }
    }
  })
})

describe('Ponto de controle - perfil', () => {
  it('exige token', async () => {
    const res = await request(app).get('/api/ponto_controle')
    expect(res.status).toBe(401)
  })

  it('quem tem consulta no acervo lê, mas não importa', async () => {
    const { lote } = await criaLote()

    const leitura = await request(app)
      .get('/api/ponto_controle')
      .set('Authorization', generateUserToken())
    expect(leitura.status).toBe(200)

    const escrita = await importa(
      { lote_id: lote.id, pontos: [pontoDeTeste('RJ-HV-1')] },
      generateUserToken()
    )
    expect(escrita.status).toBe(403)

    const total = await conn.one(
      'SELECT COUNT(*)::int AS n FROM ponto_controle.ponto'
    )
    expect(total.n).toBe(0)
  })
})

describe('Ponto de controle - fronteira com acervo.produto', () => {
  it('o tipo 10 não entra mais em acervo.produto', async () => {
    await expect(createProduto({ tipo_produto_id: 10 })).rejects.toThrow(
      /produto_nao_e_ponto_controle/
    )
  })

  it('os outros tipos de produto seguem entrando', async () => {
    const produto = await createProduto({ tipo_produto_id: 2 })
    expect(produto.id).toBeTruthy()
  })
})
