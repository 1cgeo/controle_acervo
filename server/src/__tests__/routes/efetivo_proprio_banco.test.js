'use strict'

// O PRÓPRIO APROVEITAMENTO, contra o banco de verdade.
//
// O IRMÃO MOCKADO É `efetivo_proprio.test.js`, e os dois não se repetem. Lá o
// banco é dublê, e o que se prova é a DECISÃO: qual uuid o controlador manda ao
// INSERT, e que ele recusa antes de escrever. Aqui a decisão já está provada, e o
// que se prova é o EFEITO, que nenhum dublê alcança:
//
//   O FILTRO DA LISTAGEM devolve MESMO só as linhas da pessoa. O dublê só
//   confirmaria que o SQL contém a cláusula e recebe o parâmetro; se a coluna
//   estivesse errada, ele passaria igual.
//
//   O 404 DEIXA A LINHA ALHEIA INTACTA. O eco da rota não prova isso: um
//   controlador que gravasse e depois reclamasse responderia o mesmo 404. Aqui a
//   linha é RELIDA no destino, depois da recusa.
//
//   O RASTRO CAI NA FICHA DA PESSOA. `auditoria.evento` é gravada na MESMA
//   transação, e o agregado sai do mapa (`dgeo.efetivo_periodo` -> a PESSOA). Com
//   o banco dublê, "o agregado não foi resolvido" seria um erro do dublê.
//
// POR QUE ESTAS ROTAS EXISTEM: em 2026-08-08 a escrita da passagem e do
// impedimento DOS OUTROS subiu para `verifyPerfil('gerente','efetivo')`, e a tela
// `#/aproveitamento` deixou de abrir para o operador. Sem uma porta do PRÓPRIO,
// ninguém abaixo do gerente declararia o próprio impedimento, e o aproveitamento
// da subseção 6.1 do RPCMTec depende de cada um declarar o seu.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const {
  generateAdminToken, generateUserToken, USER_UUID, ADMIN_UUID
} = require('../helpers/auth')

let app
let usuario
let admin

beforeAll(async () => {
  app = await getApp()
  usuario = generateUserToken()
  admin = generateAdminToken()
})

// `dgeo.efetivo_periodo` tem EXCLUDE de sobreposição por pessoa, e cada caso aqui
// lança passagem para os mesmos dois militares da semente: sem zerar antes, o
// segundo INSERT leva 23P01.
beforeEach(cleanTestData)

// O `test_user` da semente tem consulta no acervo e operador na mapoteca, e
// NENHUMA linha em Efetivo. É de propósito: é isso que faz destes casos a prova
// de que a guarda destas rotas é `verifyAcesso`, e não perfil no módulo.
const semearPassagem = (dono, inicio, fim = null) =>
  conn.one(
    `INSERT INTO dgeo.efetivo_periodo
       (usuario_uuid, data_inicio, data_fim, usuario_cadastramento_uuid)
     VALUES ($1, $2, $3, $1) RETURNING id`,
    [dono, inicio, fim]
  )

const semearImpedimento = (dono, descricao, inicio, fim = null) =>
  conn.one(
    `INSERT INTO dgeo.impedimento
       (usuario_uuid, descricao, percentual, data_inicio, data_fim, usuario_cadastramento_uuid)
     VALUES ($1, $2, 50, $3, $4, $1) RETURNING id`,
    [dono, descricao, inicio, fim]
  )

const lerPassagem = id =>
  conn.oneOrNone(
    `SELECT usuario_uuid, data_inicio::text AS data_inicio, observacao
     FROM dgeo.efetivo_periodo WHERE id = $1`,
    [id]
  )

const lerImpedimento = id =>
  conn.oneOrNone(
    'SELECT usuario_uuid, descricao FROM dgeo.impedimento WHERE id = $1',
    [id]
  )

describe('A listagem do próprio traz só as linhas da pessoa', () => {
  it('GET /meu_periodo não mostra a passagem de outra pessoa', async () => {
    await semearPassagem(USER_UUID, '2026-03-01')
    await semearPassagem(ADMIN_UUID, '2026-04-01')

    const res = await request(app)
      .get('/api/efetivo/meu_periodo')
      .set('Authorization', usuario)

    expect(res.status).toBe(200)
    // A VARIÂNCIA primeiro: uma lista vazia satisfaria sozinha o resto.
    expect(res.body.dados).toHaveLength(1)
    expect(res.body.dados[0].usuario_uuid).toBe(USER_UUID)

    // O CONTROLE: a linha do outro existe, e é a rota da Divisão que a mostra.
    // Sem ele, "não veio" poderia ser "não foi cadastrada".
    const daDivisao = await request(app)
      .get('/api/efetivo/periodos')
      .set('Authorization', admin)
    expect(daDivisao.body.dados).toHaveLength(2)
  })

  it('GET /meu_impedimento não mostra o impedimento de outra pessoa', async () => {
    await semearImpedimento(USER_UUID, 'Chefe do S5', '2026-03-01')
    await semearImpedimento(ADMIN_UUID, 'LTSP', '2026-03-01')

    const res = await request(app)
      .get('/api/efetivo/meu_impedimento')
      .set('Authorization', usuario)

    expect(res.status).toBe(200)
    expect(res.body.dados).toHaveLength(1)
    expect(res.body.dados[0].descricao).toBe('Chefe do S5')
  })

  // SEM RECORTE DE ANO, ao contrário das listas da Divisão: uma pessoa tem poucas
  // linhas, e a tela `#/perfil` não tem seletor de ano. Recortar faria a passagem
  // antiga sumir da própria ficha sem nada explicando o sumiço.
  it('a lista do próprio cobre todos os anos, e não só o corrente', async () => {
    await semearPassagem(USER_UUID, '2019-01-01', '2019-12-31')
    await semearPassagem(USER_UUID, '2026-03-01')

    const res = await request(app)
      .get('/api/efetivo/meu_periodo')
      .set('Authorization', usuario)

    expect(res.body.dados).toHaveLength(2)
  })
})

describe('O dono gravado é o do TOKEN', () => {
  it('POST /meu_periodo grava a linha da própria pessoa, e ignora o uuid do corpo', async () => {
    const res = await request(app)
      .post('/api/efetivo/meu_periodo')
      .set('Authorization', usuario)
      .send({
        // O caminho de fuga óbvio: mandar o uuid de outra pessoa no corpo.
        usuario_uuid: ADMIN_UUID,
        data_inicio: '2026-03-01',
        observacao: 'Vinda do 5º CGEO'
      })

    expect(res.status).toBe(201)

    // RELÊ O DESTINO. A resposta é eco dela mesma; a prova é a linha no banco.
    const linha = await lerPassagem(res.body.dados.id)
    expect(linha.usuario_uuid).toBe(USER_UUID)
    expect(linha.data_inicio).toBe('2026-03-01')
    expect(linha.observacao).toBe('Vinda do 5º CGEO')
  })

  // O campo nem chega ao controlador: ele é chave desconhecida no schema do
  // próprio, e o `schemaValidation` o descarta avisando no envelope. Sem este
  // caso, um schema que voltasse a declará-lo continuaria verde acima, só porque
  // a rota o sobrescreve depois.
  it('`usuario_uuid` volta na lista de campos ignorados', async () => {
    const res = await request(app)
      .post('/api/efetivo/meu_impedimento')
      .set('Authorization', usuario)
      .send({
        usuario_uuid: ADMIN_UUID,
        descricao: 'Curso PCE-EECN',
        percentual: 100,
        data_inicio: '2026-03-01'
      })

    expect(res.status).toBe(201)
    expect(JSON.stringify(res.body.avisos)).toMatch(/usuario_uuid/)

    const linha = await lerImpedimento(res.body.dados.id)
    expect(linha.usuario_uuid).toBe(USER_UUID)
  })

  // O RASTRO CAI NA FICHA DA PESSOA, e não numa ficha de "passagem": as duas
  // tabelas são auditadas no agregado `usuario`, e é por isso que a ficha de
  // alguém responde "quando chegou" e "o que a impediu" no mesmo painel.
  it('a escrita do próprio deixa rastro no agregado da pessoa', async () => {
    const res = await request(app)
      .post('/api/efetivo/meu_periodo')
      .set('Authorization', usuario)
      .send({ data_inicio: '2026-03-01' })

    expect(res.status).toBe(201)

    const evento = await conn.one(
      `SELECT entidade, entidade_id, operacao, usuario_uuid
       FROM auditoria.evento
       WHERE tabela = 'dgeo.efetivo_periodo' AND registro_id = $1`,
      [String(res.body.dados.id)]
    )

    expect(evento.entidade).toBe('usuario')
    expect(evento.entidade_id).toBe(USER_UUID)
    expect(evento.operacao).toBe('I')
    // O AUTOR é quem digitou. Aqui autor e dono coincidem; pela rota da Divisão
    // não coincidem, e é essa a diferença que o rastro guarda.
    expect(evento.usuario_uuid).toBe(USER_UUID)
  })
})

describe('O registro alheio não existe para quem não é dono dele', () => {
  it('PUT /meu_periodo/:id de outra pessoa dá 404 e NÃO altera a linha', async () => {
    const { id } = await semearPassagem(ADMIN_UUID, '2026-04-01')

    const res = await request(app)
      .put(`/api/efetivo/meu_periodo/${id}`)
      .set('Authorization', usuario)
      .send({ data_inicio: '2020-01-01', observacao: 'reescrita indevida' })

    // 404, e NÃO 403: o 403 confirmaria que a linha existe, e a resposta viraria
    // um oráculo de "quantas passagens a Divisão tem".
    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Passagem pela DGEO não encontrado(a)')

    const linha = await lerPassagem(id)
    expect(linha.usuario_uuid).toBe(ADMIN_UUID)
    expect(linha.data_inicio).toBe('2026-04-01')
    expect(linha.observacao).toBeNull()
  })

  it('DELETE /meu_periodo/:id de outra pessoa dá 404 e a linha continua lá', async () => {
    const { id } = await semearPassagem(ADMIN_UUID, '2026-04-01')

    const res = await request(app)
      .delete(`/api/efetivo/meu_periodo/${id}`)
      .set('Authorization', usuario)

    expect(res.status).toBe(404)
    expect(await lerPassagem(id)).not.toBeNull()
  })

  it('PUT /meu_impedimento/:id de outra pessoa dá 404 e NÃO altera a linha', async () => {
    const { id } = await semearImpedimento(ADMIN_UUID, 'LTSP', '2026-04-01')

    const res = await request(app)
      .put(`/api/efetivo/meu_impedimento/${id}`)
      .set('Authorization', usuario)
      .send({ descricao: 'reescrito', percentual: 10, data_inicio: '2026-04-01' })

    expect(res.status).toBe(404)
    expect(res.body.message).toBe('Impedimento não encontrado(a)')
    expect((await lerImpedimento(id)).descricao).toBe('LTSP')
  })

  it('DELETE /meu_impedimento/:id de outra pessoa dá 404 e a linha continua lá', async () => {
    const { id } = await semearImpedimento(ADMIN_UUID, 'LTSP', '2026-04-01')

    const res = await request(app)
      .delete(`/api/efetivo/meu_impedimento/${id}`)
      .set('Authorization', usuario)

    expect(res.status).toBe(404)
    expect(await lerImpedimento(id)).not.toBeNull()
  })

  // O 404 DE ID INEXISTENTE E O DE ID ALHEIO SÃO INDISTINGUÍVEIS, e é o ponto:
  // uma frase própria ("não é seu") devolveria pela porta dos fundos o que o 404
  // fecha pela da frente.
  it('id alheio e id inexistente respondem a MESMA coisa', async () => {
    const { id } = await semearPassagem(ADMIN_UUID, '2026-04-01')

    const alheio = await request(app)
      .delete(`/api/efetivo/meu_periodo/${id}`)
      .set('Authorization', usuario)

    const inexistente = await request(app)
      .delete('/api/efetivo/meu_periodo/999999')
      .set('Authorization', usuario)

    expect(alheio.status).toBe(inexistente.status)
    expect(alheio.body.message).toBe(inexistente.body.message)
  })

  // A VARIÂNCIA de tudo acima: sem estes dois, um controlador que recusasse TUDO
  // com 404 deixaria o bloco inteiro verde.
  it('a própria passagem se edita e se exclui', async () => {
    const { id } = await semearPassagem(USER_UUID, '2026-03-01')

    const editada = await request(app)
      .put(`/api/efetivo/meu_periodo/${id}`)
      .set('Authorization', usuario)
      .send({ data_inicio: '2026-03-01', data_fim: '2026-11-30' })
    expect(editada.status).toBe(200)

    const excluida = await request(app)
      .delete(`/api/efetivo/meu_periodo/${id}`)
      .set('Authorization', usuario)
    expect(excluida.status).toBe(200)
    expect(await lerPassagem(id)).toBeNull()
  })

  it('o próprio impedimento se edita e se exclui', async () => {
    const { id } = await semearImpedimento(USER_UUID, 'Chefe do S5', '2026-03-01')

    const editado = await request(app)
      .put(`/api/efetivo/meu_impedimento/${id}`)
      .set('Authorization', usuario)
      .send({ descricao: 'Chefe do S5', percentual: 80, data_inicio: '2026-03-01' })
    expect(editado.status).toBe(200)
    expect((await lerImpedimento(id)).descricao).toBe('Chefe do S5')

    const excluido = await request(app)
      .delete(`/api/efetivo/meu_impedimento/${id}`)
      .set('Authorization', usuario)
    expect(excluido.status).toBe(200)
    expect(await lerImpedimento(id)).toBeNull()
  })
})

// ---------------------------------------------------------------------------
// A GUARDA, contra o banco: `verifyAcesso`, e não perfil no módulo Efetivo.
//
// O `test_user` da semente NÃO tem linha em Efetivo, e mesmo assim declara o
// próprio. É o requisito: quem trabalha só no acervo tem de conseguir cumprir a
// obrigação sem ganhar perfil de um módulo em que não mexe.
// ---------------------------------------------------------------------------
describe('Quem não tem perfil em Efetivo cuida do próprio aproveitamento', () => {
  it('entra no próprio, e continua barrado no da Divisão', async () => {
    const proprio = await request(app)
      .get('/api/efetivo/meu_periodo')
      .set('Authorization', usuario)
    expect(proprio.status).toBe(200)

    const daDivisao = await request(app)
      .get('/api/efetivo/periodos')
      .set('Authorization', usuario)
    expect(daDivisao.status).toBe(403)
    expect(daDivisao.body.message).toMatch(/perfil consulta no módulo efetivo/i)
  })

  it('sem perfil em módulo NENHUM, nem o próprio se alcança', async () => {
    // `verifyAcesso` exige perfil em ALGUM módulo: a conta recém-criada, ainda
    // sem concessão, não é ninguém no sistema e também não conta para o efetivo
    // da Divisão.
    await conn.none(
      `DELETE FROM dgeo.usuario_perfil
       WHERE usuario_id = (SELECT id FROM dgeo.usuario WHERE uuid = $1)`,
      [USER_UUID]
    )

    const res = await request(app)
      .get('/api/efetivo/meu_periodo')
      .set('Authorization', usuario)

    expect(res.status).toBe(403)
    expect(res.body.message).toMatch(/sem acesso a nenhum módulo/i)
  })
})
