'use strict'

// Perfil POR MODULO: prova, contra o banco real e as rotas reais, que acervo,
// mapoteca e orcamento sao compartimentos separados. E o teste que justifica a
// tabela dgeo.usuario_perfil existir em vez de uma coluna unica no usuario.
//
// O usuario semeado (test_user) e consulta no acervo e operador na mapoteca,
// que e exatamente o que ele podia antes do controle por perfil. No orcamento
// ele nasce SEM linha, que e como o modulo absorvido em 2026-07-27 entra: sem
// acesso ate alguem conceder.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn } = require('../helpers/db')
const { generateAdminToken, generateUserToken, USER_UUID } = require('../helpers/auth')

const MODULO = { acervo: 1, mapoteca: 2, orcamento: 3 }
const NIVEL = { consulta: 1, operador: 2, gerente: 3 }

let app

beforeAll(async () => {
  app = await getApp()
})

// Devolve o usuario de teste ao perfil semeado, para nao vazar entre testes
afterEach(async () => {
  await definePerfil(MODULO.acervo, NIVEL.consulta)
  await definePerfil(MODULO.mapoteca, NIVEL.operador)
  await removePerfil(MODULO.orcamento)
  await conn.none('UPDATE dgeo.usuario SET ativo = TRUE WHERE uuid = $1', [USER_UUID])
})

const definePerfil = async (moduloId, perfilId) => {
  await conn.none(
    `INSERT INTO dgeo.usuario_perfil (usuario_id, modulo_id, perfil_id)
     SELECT id, $2, $3 FROM dgeo.usuario WHERE uuid = $1
     ON CONFLICT (usuario_id, modulo_id) DO UPDATE SET perfil_id = EXCLUDED.perfil_id`,
    [USER_UUID, moduloId, perfilId]
  )
}

const removePerfil = async moduloId => {
  await conn.none(
    `DELETE FROM dgeo.usuario_perfil
     WHERE modulo_id = $2 AND usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
    [USER_UUID, moduloId]
  )
}

describe('Perfil por modulo: acervo, mapoteca e orcamento sao compartimentos', () => {
  it('operador da mapoteca NAO escreve no acervo', async () => {
    await definePerfil(MODULO.mapoteca, NIVEL.operador)
    await definePerfil(MODULO.acervo, NIVEL.consulta)

    const res = await request(app)
      .post('/api/projetos/projeto')
      .set('Authorization', generateUserToken())
      .send({ projetos: [{ nome: 'Projeto Indevido', descricao: 'x', status_id: 1 }] })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/perfil operador no módulo acervo/i)
  })

  // As DUAS telas do perfil de OPERADOR da mapoteca (chefe, 2026-07-30): atender
  // pedidos e consumo de material. Este teste guarda a fronteira nos dois
  // sentidos, porque esconder o item no menu nao barra nada: o perfil do client e
  // ergonomia, e quem barra leitura e o verifyPerfil.
  it('operador da mapoteca tem atendimento e consumo de material; consulta nao tem', async () => {
    const AS_DUAS = [
      '/api/mapoteca/pedido/em_aberto',
      '/api/mapoteca/consumo_material'
    ]
    const ler = rota => request(app).get(rota).set('Authorization', generateUserToken())

    await definePerfil(MODULO.mapoteca, NIVEL.consulta)
    for (const rota of AS_DUAS) {
      const res = await ler(rota)
      expect(res.status).toBe(403)
      expect(res.body.message).toMatch(/perfil operador no módulo mapoteca/i)
    }
    // O AGREGADO do consumo fica em consulta de propósito: o total do mês é
    // informação de gestão, a lista de lançamentos é trabalho de quem opera.
    expect((await ler('/api/mapoteca/consumo_mensal?ano=2026')).status).toBe(200)
    // E a lista de pedidos também: quem consulta vê o pedido, não a fila.
    expect((await ler('/api/mapoteca/pedido?ano=2026')).status).toBe(200)

    await definePerfil(MODULO.mapoteca, NIVEL.operador)
    for (const rota of AS_DUAS) {
      expect((await ler(rota)).status).toBe(200)
    }
  })

  it('gerente do acervo NAO cadastra pedido na mapoteca', async () => {
    await definePerfil(MODULO.acervo, NIVEL.gerente)
    await definePerfil(MODULO.mapoteca, NIVEL.consulta)

    const res = await request(app)
      .post('/api/mapoteca/pedido')
      .set('Authorization', generateUserToken())
      .send({ cliente_id: 1, situacao_pedido_id: 1 })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/perfil gerente no módulo mapoteca/i)
  })

  it('perfil num modulo nao da acesso nenhum ao outro', async () => {
    await definePerfil(MODULO.mapoteca, NIVEL.gerente)
    await removePerfil(MODULO.acervo)

    const leituraAcervo = await request(app)
      .get('/api/acervo/busca?termo=teste')
      .set('Authorization', generateUserToken())
    expect(leituraAcervo.status).toBe(403)

    const leituraMapoteca = await request(app)
      .get('/api/mapoteca/cliente')
      .set('Authorization', generateUserToken())
    expect(leituraMapoteca.status).toBe(200)
  })

  // Requisito da fusao: o administrador global vale nos TRES modulos, e sem
  // nenhuma linha em dgeo.usuario_perfil. Se um dia alguem trocar a flag global
  // por perfil por modulo, este teste cai primeiro.
  it('administrador passa nos tres modulos sem ter linha de perfil', async () => {
    const linhas = await conn.any(
      `SELECT up.id FROM dgeo.usuario_perfil AS up
       INNER JOIN dgeo.usuario AS u ON u.id = up.usuario_id
       WHERE u.administrador IS TRUE`
    )
    expect(linhas).toHaveLength(0)

    const acervo = await request(app)
      .get('/api/acervo/busca?termo=teste')
      .set('Authorization', generateAdminToken())
    expect(acervo.status).toBe(200)

    const mapoteca = await request(app)
      .get('/api/mapoteca/cliente')
      .set('Authorization', generateAdminToken())
    expect(mapoteca.status).toBe(200)

    // Leitura do orcamento
    const orcamentoLeitura = await request(app)
      .get('/api/orcamento/metas?ano=2026')
      .set('Authorization', generateAdminToken())
    expect(orcamentoLeitura.status).toBe(200)

    // E escrita, para nao provar so o nivel mais baixo
    const orcamentoEscrita = await request(app)
      .post('/api/orcamento/metas')
      .set('Authorization', generateAdminToken())
      .send({ ano: 2026, numero_meta: 1, descricao: 'Meta do admin' })
    expect(orcamentoEscrita.status).toBe(201)
    await conn.none('DELETE FROM orcamento.meta_pit WHERE ano = 2026')
  })

  it('desativar o usuario derruba o acesso na hora, com o mesmo token', async () => {
    await conn.none('UPDATE dgeo.usuario SET ativo = FALSE WHERE uuid = $1', [USER_UUID])

    const res = await request(app)
      .get('/api/mapoteca/cliente')
      .set('Authorization', generateUserToken())

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/inativo/i)
  })

  // Requisito da fusao: quem entrou pelo modulo absorvido nao herda nada dos
  // modulos que ja existiam. O risco concreto era esquecer o 2o argumento de
  // verifyPerfil numa rota do orcamento: o default do middleware e 'acervo',
  // entao a rota passaria a cobrar perfil no modulo errado, e o operador do
  // orcamento passaria a escrever onde nao devia.
  it('operador do orcamento NAO escreve no acervo nem na mapoteca', async () => {
    await definePerfil(MODULO.orcamento, NIVEL.operador)
    await removePerfil(MODULO.acervo)
    await removePerfil(MODULO.mapoteca)

    // Escreve no proprio modulo: e o controle positivo, sem o qual um 403 em
    // toda parte passaria por aprovacao.
    const proprio = await request(app)
      .post('/api/orcamento/metas')
      .set('Authorization', generateUserToken())
      .send({ ano: 2026, numero_meta: 9, descricao: 'Meta do operador' })
    expect(proprio.status).toBe(201)
    await conn.none('DELETE FROM orcamento.meta_pit WHERE ano = 2026')

    const escritaAcervo = await request(app)
      .post('/api/projetos/projeto')
      .set('Authorization', generateUserToken())
      .send({ projetos: [{ nome: 'Projeto Indevido', descricao: 'x', status_id: 1 }] })
    expect(escritaAcervo.status).toBe(403)
    expect(escritaAcervo.body.message).toMatch(/módulo acervo/i)

    const escritaMapoteca = await request(app)
      .post('/api/mapoteca/pedido')
      .set('Authorization', generateUserToken())
      .send({ cliente_id: 1, situacao_pedido_id: 1 })
    expect(escritaMapoteca.status).toBe(403)
    expect(escritaMapoteca.body.message).toMatch(/módulo mapoteca/i)

    // Nem a leitura dos outros dois, ja que sem linha nao ha acesso nenhum
    const leituraAcervo = await request(app)
      .get('/api/acervo/busca?termo=teste')
      .set('Authorization', generateUserToken())
    expect(leituraAcervo.status).toBe(403)

    const leituraMapoteca = await request(app)
      .get('/api/mapoteca/cliente')
      .set('Authorization', generateUserToken())
    expect(leituraMapoteca.status).toBe(403)
  })

  it('sem linha no orcamento, nem o gerente do acervo le o orcamento', async () => {
    await definePerfil(MODULO.acervo, NIVEL.gerente)
    await removePerfil(MODULO.orcamento)

    const res = await request(app)
      .get('/api/orcamento/metas?ano=2026')
      .set('Authorization', generateUserToken())

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/módulo orcamento/i)
  })

  it('a consulta pelo localizador continua publica (cliente sem conta)', async () => {
    const res = await request(app).get('/api/mapoteca/pedido/localizador/ABCD-1234-EFGH')
    // 404 (nao existe) e nao 401: a rota nao pede autenticacao
    expect(res.status).toBe(404)
  })
})

// E a concessao pela tela de usuarios: o chefe escolhe o nivel por modulo e o
// efeito tem que aparecer na proxima requisicao da pessoa.
describe('Concessao de perfil pela API de usuarios', () => {
  it('GET /api/usuarios devolve o perfil por modulo', async () => {
    const res = await request(app)
      .get('/api/usuarios')
      .set('Authorization', generateAdminToken())

    expect(res.status).toBe(200)
    const alvo = res.body.dados.find(u => u.uuid === USER_UUID)
    expect(alvo.perfis).toEqual({ acervo: 1, mapoteca: 2 })
  })

  it('PUT /api/usuarios/:uuid grava o perfil e o acesso muda na hora', async () => {
    // antes: consulta no acervo nao cria projeto
    const antes = await request(app)
      .post('/api/projetos/projeto')
      .set('Authorization', generateUserToken())
      .send({ projetos: [{ nome: 'Projeto Perfil', descricao: 'x', status_id: 1 }] })
    expect(antes.status).toBe(403)

    const concessao = await request(app)
      .put(`/api/usuarios/${USER_UUID}`)
      .set('Authorization', generateAdminToken())
      .send({ administrador: false, ativo: true, perfis: { acervo: 2 } })
    expect(concessao.status).toBe(200)

    // depois: operador cria (o middleware le o banco, sem novo login)
    const depois = await request(app)
      .post('/api/projetos/projeto')
      .set('Authorization', generateUserToken())
      .send({ projetos: [{ nome: 'Projeto Perfil', descricao: 'x', status_id: 1 }] })
    expect(depois.status).not.toBe(403)
  })

  it('perfil nulo REMOVE o acesso da pessoa ao modulo', async () => {
    const revogacao = await request(app)
      .put(`/api/usuarios/${USER_UUID}`)
      .set('Authorization', generateAdminToken())
      .send({ administrador: false, ativo: true, perfis: { mapoteca: null } })
    expect(revogacao.status).toBe(200)

    const res = await request(app)
      .get('/api/mapoteca/cliente')
      .set('Authorization', generateUserToken())
    expect(res.status).toBe(403)

    const lista = await request(app)
      .get('/api/usuarios')
      .set('Authorization', generateAdminToken())
    const alvo = lista.body.dados.find(u => u.uuid === USER_UUID)
    expect(alvo.perfis.mapoteca).toBeUndefined()
  })

  it('nivel invalido e modulo desconhecido sao recusados', async () => {
    const nivelInvalido = await request(app)
      .put(`/api/usuarios/${USER_UUID}`)
      .set('Authorization', generateAdminToken())
      .send({ administrador: false, ativo: true, perfis: { acervo: 9 } })
    expect(nivelInvalido.status).toBe(400)

    const moduloInvalido = await request(app)
      .put(`/api/usuarios/${USER_UUID}`)
      .set('Authorization', generateAdminToken())
      .send({ administrador: false, ativo: true, perfis: { producao: 2 } })
    expect(moduloInvalido.status).toBe(400)
  })

  it('os dominios de modulo e perfil alimentam a tela', async () => {
    const modulos = await request(app)
      .get('/api/usuarios/dominio/modulo')
      .set('Authorization', generateAdminToken())
    expect(modulos.status).toBe(200)
    expect(modulos.body.dados.map(m => m.nome_abrev)).toEqual([
      'acervo',
      'mapoteca',
      'orcamento'
    ])

    const perfis = await request(app)
      .get('/api/usuarios/dominio/tipo_perfil')
      .set('Authorization', generateAdminToken())
    expect(perfis.status).toBe(200)
    expect(perfis.body.dados).toHaveLength(3)
  })
})
