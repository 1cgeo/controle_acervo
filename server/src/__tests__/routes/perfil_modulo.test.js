'use strict'

// Perfil POR MODULO: prova, contra o banco real e as rotas reais, que acervo,
// mapoteca e orcamento sao compartimentos separados. E o teste que justifica a
// tabela dgeo.usuario_perfil existir em vez de uma coluna unica no usuario.
//
// O usuario semeado (test_user) e consulta no acervo e operador na mapoteca. No
// orcamento ele nasce SEM linha, e e assim que todo modulo entra: sem acesso
// nenhum ate alguem conceder, nem de leitura.

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

// Devolve o usuario de teste ao estado semeado, para nao vazar entre testes.
//
// `administrador = FALSE` entrou aqui em 2026-08-08, e nao e zelo: a flag
// CURTO-CIRCUITA o `verifyPerfil` inteiro, entao um teste de OUTRO arquivo que a
// ligue no mesmo usuario e nao a desligue faz TODO caso deste arquivo passar a
// medir outra coisa. Os arquivos do pacote `banco` dividem o banco do worker, e
// nada aqui pode depender da ordem em que eles rodaram.
//
// O sintoma nao e um 403 virando 200, que se leria facil: e o caso que espera
// 403 recebendo 500, porque o administrador ATRAVESSA a guarda e morre depois,
// na chave estrangeira de um dado que o TRUNCATE levou.
const devolverAoSemeado = async () => {
  // APAGA TODAS as linhas e recria as DUAS semeadas, em vez de devolver modulo a
  // modulo. A versao anterior listava acervo, mapoteca e orcamento, e por isso
  // nao limpava `producao` nem `efetivo`: os dois nasceram na 1.33.0, e as
  // suites que os concedem a este mesmo usuario semeado chegaram depois. O
  // sintoma foi o caso `GET /api/usuarios devolve o perfil por modulo`, que
  // compara o mapa INTEIRO com `{ acervo: 1, mapoteca: 2 }` e passou a ver um
  // terceiro modulo que ninguem deste arquivo concedeu.
  //
  // A lista nomeada tambem envelheceria de novo no proximo modulo. O DELETE sem
  // filtro de modulo nao envelhece.
  await conn.none(
    `DELETE FROM dgeo.usuario_perfil
      WHERE usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
    [USER_UUID]
  )
  await definePerfil(MODULO.acervo, NIVEL.consulta)
  await definePerfil(MODULO.mapoteca, NIVEL.operador)
  await conn.none(
    'UPDATE dgeo.usuario SET ativo = TRUE, administrador = FALSE WHERE uuid = $1',
    [USER_UUID]
  )
}

// ANTES e DEPOIS: o `afterEach` protege quem vem a seguir, e o `beforeEach`
// protege este arquivo de quem veio antes. So o segundo defende do vazamento de
// outro arquivo, que e o que de fato aconteceu.
beforeEach(devolverAoSemeado)
afterEach(devolverAoSemeado)

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

  // A FILA de atendimento e do OPERADOR da mapoteca, e a fronteira se guarda nos
  // dois sentidos: esconder o item no menu nao barra nada, porque o perfil do
  // client e ergonomia e quem barra leitura e o verifyPerfil.
  //
  // O CONSUMO SAIU DESTA LISTA em 2026-08-08, e a mudanca e a regua nova: quem
  // tem CONSULTA no modulo LE as telas dele, e so LANCAR e do operador. Ele
  // continua aqui, do outro lado da fronteira, porque a lista de lancamentos
  // deixar de abrir para a consulta seria regressao -- e porque ela ja abria pela
  // rota do client, que ganhou `consulta` no mesmo dia e passou meia hora
  // levando 403 na tabela enquanto mostrava o grafico do agregado.
  it('operador da mapoteca tem a fila de atendimento; consulta nao tem', async () => {
    const ler = rota => request(app).get(rota).set('Authorization', generateUserToken())

    await definePerfil(MODULO.mapoteca, NIVEL.consulta)
    const negado = await ler('/api/mapoteca/pedido/em_aberto')
    expect(negado.status).toBe(403)
    expect(negado.body.message).toMatch(/perfil operador no módulo mapoteca/i)

    // O que a CONSULTA alcanca: o livro de movimentos (onde o consumo virou um
    // tipo, em 2026-08-08), o agregado mensal dele, e a lista de pedidos. Ver o
    // pedido, sim; a fila, nao.
    expect((await ler('/api/mapoteca/movimento_material')).status).toBe(200)
    expect((await ler('/api/mapoteca/consumo_mensal?ano=2026')).status).toBe(200)
    expect((await ler('/api/mapoteca/pedido?ano=2026')).status).toBe(200)

    await definePerfil(MODULO.mapoteca, NIVEL.operador)
    expect((await ler('/api/mapoteca/pedido/em_aberto')).status).toBe(200)
    expect((await ler('/api/mapoteca/movimento_material')).status).toBe(200)
  })

  // LANCAR continua sendo do OPERADOR: o que baixou para consulta foi a LEITURA.
  // Sem este caso, baixar a escrita junto passaria despercebido.
  //
  // O ENDERECO MUDOU em 2026-08-08, e a regra nao: `consumo_material` virou o
  // TIPO 3 do livro de movimentos, e a rota de consumo deixou de existir. O
  // corpo abaixo e um consumo: origem na Secao (1), sem destino.
  it('consulta da mapoteca LE o movimento, e nao LANCA', async () => {
    await definePerfil(MODULO.mapoteca, NIVEL.consulta)

    const res = await request(app)
      .post('/api/mapoteca/movimento_material')
      .set('Authorization', generateUserToken())
      .send({
        tipo_material_id: 1,
        tipo_movimento_id: 3,
        quantidade: 1,
        data_movimento: '2026-08-08',
        localizacao_origem_id: 1
      })

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/perfil operador no módulo mapoteca/i)
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
      .get('/api/orcamento/dfd?ano=2026')
      .set('Authorization', generateAdminToken())
    expect(orcamentoLeitura.status).toBe(200)

    // E escrita, para nao provar so o nivel mais baixo
    const orcamentoEscrita = await request(app)
      .post('/api/orcamento/dfd')
      .set('Authorization', generateAdminToken())
      .send({ ano: 2026, numero: 'DFD-ADM', objeto: 'DFD do admin' })
    expect(orcamentoEscrita.status).toBe(201)
    await conn.none("DELETE FROM orcamento.dfd WHERE numero = 'DFD-ADM'")
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
      .post('/api/orcamento/dfd')
      .set('Authorization', generateUserToken())
      .send({ ano: 2026, numero: 'DFD-OPER', objeto: 'DFD do operador' })
    expect(proprio.status).toBe(201)
    await conn.none("DELETE FROM orcamento.dfd WHERE numero = 'DFD-OPER'")

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
      .get('/api/orcamento/dfd?ano=2026')
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

    // 'producao' era o exemplo de modulo inexistente aqui, e virou modulo de
    // verdade na 1.33.0. O exemplo passa a ser um nome que nao descreve trabalho
    // nenhum da Divisao, para nao virar modulo amanha e apagar este caso.
    const moduloInvalido = await request(app)
      .put(`/api/usuarios/${USER_UUID}`)
      .set('Authorization', generateAdminToken())
      .send({ administrador: false, ativo: true, perfis: { jabuticaba: 2 } })
    expect(moduloInvalido.status).toBe(400)
  })

  it('os dominios de modulo e perfil alimentam a tela', async () => {
    const modulos = await request(app)
      .get('/api/usuarios/dominio/modulo')
      .set('Authorization', generateAdminToken())
    expect(modulos.status).toBe(200)
    // CINCO desde a 1.33.0. A tela de usuarios monta uma coluna por linha deste
    // catalogo, entao os dois modulos novos aparecem la sozinhos.
    expect(modulos.body.dados.map(m => m.nome_abrev)).toEqual([
      'acervo',
      'mapoteca',
      'orcamento',
      'producao',
      'efetivo'
    ])

    const perfis = await request(app)
      .get('/api/usuarios/dominio/tipo_perfil')
      .set('Authorization', generateAdminToken())
    expect(perfis.status).toBe(200)
    expect(perfis.body.dados).toHaveLength(3)
  })
})
