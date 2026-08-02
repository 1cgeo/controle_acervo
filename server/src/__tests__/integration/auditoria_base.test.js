'use strict'

// A FUNDAÇÃO DA RASTREABILIDADE, contra banco de verdade.
//
// Os testes de unidade (`__tests__/auditoria/`) provam a REGRA: o diff, a
// sanitizacao, o mapa. Este arquivo prova o que só o banco prova, e que é
// justamente a promessa mais forte do desenho:
//
//   o rastro cai JUNTO com a mudança que ele descreve, ou não cai.
//
// Com conexão própria, um rollback da operação deixaria para trás o registro de
// uma alteração que nunca aconteceu, e quem lesse a tela acreditaria nele. Nenhum
// mock consegue provar isso: no `helpers/orcamento/mockDb` a "transação" é o
// próprio objeto de conexão (`conn.tx = cb => cb(conn)`), então uma auditoria
// colocada FORA da transação passaria verde ali.

const { db } = require('../../database')
const { conn, cleanTestData } = require('../helpers/db')
const { ADMIN_UUID } = require('../helpers/auth')

const auditoriaCtrl = require('../../auditoria/auditoria_ctrl')

beforeAll(async () => {
  await db.createConn()
})

afterEach(async () => {
  await cleanTestData()
})

const criaCliente = async (nome = 'OM de Teste') =>
  conn.one(
    `INSERT INTO mapoteca.cliente (nome, tipo_cliente_id)
     VALUES ($<nome>, 1) RETURNING *`,
    { nome }
  )

const eventosDe = entidadeId =>
  conn.any(
    `SELECT * FROM auditoria.evento
      WHERE modulo = 'mapoteca' AND entidade = 'cliente' AND entidade_id = $<entidadeId>
      ORDER BY id`,
    { entidadeId: String(entidadeId) }
  )

describe('registrar: o evento cai com a mudanca', () => {
  it('grava modulo, entidade e agregado a partir do MAPA, sem o chamador dizer', async () => {
    const cliente = await criaCliente()

    await db.conn.tx(async t => {
      await auditoriaCtrl.registrar(t, {
        tabela: 'mapoteca.cliente',
        registroId: cliente.id,
        operacao: 'I',
        depois: cliente,
        usuarioUuid: ADMIN_UUID,
        contexto: { origem: 'web', rota: 'POST /api/mapoteca/cliente', loteId: null }
      })
    })

    const [evento] = await eventosDe(cliente.id)

    // Nenhum dos tres foi passado na chamada: sairam do mapa de entidades.
    expect(evento.modulo).toBe('mapoteca')
    expect(evento.entidade).toBe('cliente')
    expect(evento.entidade_id).toBe(String(cliente.id))
    expect(evento.usuario_uuid).toBe(ADMIN_UUID)
    expect(evento.origem).toBe('web')
    expect(evento.dados_depois.nome).toBe('OM de Teste')
  })

  it('ROLLBACK da operacao derruba o evento junto', async () => {
    const cliente = await criaCliente()

    await expect(
      db.conn.tx(async t => {
        await t.none(
          'UPDATE mapoteca.cliente SET nome = $<nome> WHERE id = $<id>',
          { nome: 'Nome que nao vai sobreviver', id: cliente.id }
        )
        await auditoriaCtrl.registrar(t, {
          tabela: 'mapoteca.cliente',
          registroId: cliente.id,
          operacao: 'U',
          antes: cliente,
          depois: { ...cliente, nome: 'Nome que nao vai sobreviver' },
          usuarioUuid: ADMIN_UUID
        })
        // O que quer que derrube a transacao DEPOIS da auditoria: uma regra de
        // negocio, uma chave estrangeira, uma falha de disco.
        throw new Error('a operacao falhou depois de auditar')
      })
    ).rejects.toThrow('a operacao falhou depois de auditar')

    // A mudanca nao aconteceu...
    const depois = await conn.one(
      'SELECT nome FROM mapoteca.cliente WHERE id = $<id>',
      { id: cliente.id }
    )
    expect(depois.nome).toBe('OM de Teste')

    // ... e o rastro dela tambem nao existe. E a promessa inteira do desenho.
    expect(await eventosDe(cliente.id)).toHaveLength(0)
  })

  it('a exclusao registra o que se perdeu, e o rastro SOBREVIVE ao registro', async () => {
    const cliente = await criaCliente('OM que sera apagada')

    await db.conn.tx(async t => {
      const antes = await auditoriaCtrl.lerAntes(
        t, 'mapoteca.cliente', cliente.id, 'Cliente'
      )
      await t.none('DELETE FROM mapoteca.cliente WHERE id = $<id>', { id: cliente.id })
      await auditoriaCtrl.registrar(t, {
        tabela: 'mapoteca.cliente',
        registroId: cliente.id,
        operacao: 'D',
        antes,
        usuarioUuid: ADMIN_UUID
      })
    })

    const sumiu = await conn.oneOrNone(
      'SELECT id FROM mapoteca.cliente WHERE id = $<id>',
      { id: cliente.id }
    )
    expect(sumiu).toBeNull()

    // O evento que a tabela existe para guardar. E a razao de `entidade_id` nao
    // ser chave estrangeira: com FK, o DELETE levaria junto a prova.
    const [evento] = await eventosDe(cliente.id)
    expect(evento.operacao).toBe('D')
    expect(evento.dados_depois).toBeNull()
    expect(evento.dados_antes.nome).toBe('OM que sera apagada')
  })
})

describe('lerAntes', () => {
  it('devolve a linha INTEIRA, e nao so o id', async () => {
    const cliente = await criaCliente('OM completa')

    const linha = await db.conn.task(t =>
      auditoriaCtrl.lerAntes(t, 'mapoteca.cliente', cliente.id, 'Cliente')
    )

    expect(linha.nome).toBe('OM completa')
    expect(linha.tipo_cliente_id).toBe(1)
  })

  it('lanca o 404 com a mensagem que a funcao ja lancava', async () => {
    // Ela SUBSTITUI o `SELECT id` que so existia para produzir esta mensagem: se
    // fosse uma consulta ao lado daquela, o rastro custaria uma ida a mais ao
    // banco em cada uma das ~20 funcoes que seguem o padrao.
    await expect(
      db.conn.task(t => auditoriaCtrl.lerAntes(t, 'mapoteca.cliente', 999999, 'Cliente'))
    ).rejects.toThrow(/Cliente não encontrado/)
  })

  it('recusa tabela que nao esta no mapa, em vez de gravar evento sem dono', async () => {
    await expect(
      db.conn.task(t => auditoriaCtrl.lerAntes(t, 'mapoteca.tipo_midia', 1, 'Mídia'))
    ).rejects.toThrow(/mapa de auditoria/i)
  })

  it('recusa identificador que nao e identificador, antes de tocar o banco', async () => {
    // A tabela e as geometrias vem do mapa, que e codigo; a COLUNA e parametro
    // de funcao, e um chamador futuro pode passar algo do corpo da requisicao
    // sem perceber. Confiar em "o chamador nao faria isso" e o que produz
    // injecao.
    await expect(
      db.conn.task(t =>
        auditoriaCtrl.lerAntes(t, 'mapoteca.cliente', 1, 'Cliente', 'id = 1 OR 1=1 --')
      )
    ).rejects.toThrow(/coluna invalido/i)
  })
})

describe('o hash da senha nunca chega ao rastro', () => {
  // O unico caso do trabalho inteiro que causa dano se falhar em silencio: uma
  // SEGUNDA copia da credencial, numa tabela que ninguem pensa como guardadora
  // de senha e que so administrador le.
  it('a linha de dgeo.usuario entra com senha NULA nos dois lados', async () => {
    const usuario = await conn.one(
      'SELECT * FROM dgeo.usuario WHERE uuid = $<uuid>',
      { uuid: ADMIN_UUID }
    )
    // A semente tem hash de verdade: sem isto o caso passaria por acidente.
    expect(usuario.senha).toMatch(/^\$2[aby]\$/)

    await db.conn.tx(async t => {
      await auditoriaCtrl.registrar(t, {
        tabela: 'dgeo.usuario',
        registroId: usuario.uuid,
        operacao: 'U',
        antes: usuario,
        depois: { ...usuario, senha: 'outro-hash-qualquer' }, // path-ok: fixture
        usuarioUuid: ADMIN_UUID
      })
    })

    const [evento] = await conn.any(
      `SELECT * FROM auditoria.evento
        WHERE tabela = 'dgeo.usuario' AND entidade_id = $<uuid>`,
      { uuid: ADMIN_UUID }
    )

    expect(evento.dados_antes.senha).toBeNull()
    expect(evento.dados_depois.senha).toBeNull()
    // E o diff CONTINUA acusando que a senha mudou: e o que se quer saber.
    expect(evento.campos_alterados).toContain('senha')
    // Em canto nenhum do JSON, nem por acidente.
    expect(JSON.stringify(evento)).not.toContain(usuario.senha)
  })
})

describe('listarPorEntidade', () => {
  it('devolve do mais novo para o mais antigo, com o nome de quem fez', async () => {
    const cliente = await criaCliente()

    for (const operacao of ['I', 'U']) {
      await db.conn.tx(t =>
        auditoriaCtrl.registrar(t, {
          tabela: 'mapoteca.cliente',
          registroId: cliente.id,
          operacao,
          depois: cliente,
          usuarioUuid: ADMIN_UUID
        })
      )
    }

    const linhas = await auditoriaCtrl.listarPorEntidade('mapoteca', 'cliente', cliente.id)

    expect(linhas).toHaveLength(2)
    expect(linhas[0].operacao).toBe('U')
    expect(linhas[1].operacao).toBe('I')
    // O nome sai da juncao com dgeo.usuario, que e LEFT: evento de migracao e do
    // sistema nao tem dono, e nem por isso some da lista.
    expect(linhas[0].usuario_nome).toBe('Test Admin')
  })

  it('NAO exige que o registro ainda exista', async () => {
    // A exclusao e justamente o evento que este rastro guarda; um 404 aqui
    // esconderia o unico registro de que o cliente existiu.
    const linhas = await auditoriaCtrl.listarPorEntidade('mapoteca', 'cliente', 999999)
    expect(linhas).toEqual([])
  })
})
