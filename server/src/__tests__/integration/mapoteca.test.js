'use strict'

// AS REGRAS DA MAPOTECA QUE MORAM NO BANCO, e só nele.
//
// O que este arquivo NÃO faz: exercitar CRUD por SQL cru. `INSERT ... RETURNING
// id` seguido de `expect(id).toBeDefined()` prova que o PostgreSQL devolve o
// que se mandou gravar, e não que o sistema funciona. O CRUD de cliente,
// pedido, plotter, manutenção e estoque passa por controller e tem prova em
// `routes/mapoteca.test.js`, pelas rotas de verdade.
//
// O que sobra aqui é o que só o banco decide, e que nenhum teste de rota
// alcança sem duplicar o cenário:
//
//   1. o gatilho que aplica o LIVRO DE MOVIMENTOS ao saldo, nos três sentidos
//      (lançar, alterar e apagar), e o saldo batendo com a soma do livro;
//   2. os dois CHECK que dizem a FORMA de cada tipo de movimento, inclusive a
//      RN01 ("consumo só da Seção"), que era um IF dentro do gatilho até
//      2026-08-08 e por isso valia só para quem passasse por ele;
//   3. a recusa de consumo sem saldo, com a mensagem que ENSINA o conserto;
//   4. a restrição que impede apagar cliente que tem pedido.

const { conn, cleanTestData, closeConnection } = require('../helpers/db')

afterEach(async () => {
  await cleanTestData()
})

afterAll(async () => {
  await closeConnection()
})

const criarCliente = () =>
  conn.one(
    `INSERT INTO mapoteca.cliente (nome, tipo_cliente_id)
     VALUES ('Cliente Teste', 1) RETURNING id`
  )

const criarPedido = (clienteId) =>
  conn.one(
    `INSERT INTO mapoteca.pedido
       (data_pedido, cliente_id, situacao_pedido_id, usuario_criacao_id, usuario_atualizacao_id)
     VALUES (NOW(), $1, 2, 1, 1) RETURNING id`,
    [clienteId]
  )

const criarMaterial = (nome) =>
  conn.one(
    'INSERT INTO mapoteca.tipo_material (nome) VALUES ($1) RETURNING id',
    [nome]
  )

// SECAO = 1, ALMOXARIFADO = 2, AQUISICAO_REALIZADA = 3 (mapoteca.tipo_localizacao)
// ENTRADA = 1, TRANSFERENCIA = 2, CONSUMO = 3, CONTAGEM = 4
const { TIPO_LOCALIZACAO: LOCAL, TIPO_MOVIMENTO_MATERIAL: MOV } =
  require('../../utils/domain_constants')

// SQL CRU DE PROPOSITO: o que se prova aqui e o que o BANCO recusa, e nao o que
// o Joi recusa. Pela rota, o schema barraria a linha antes de o CHECK ser
// consultado, e o caso passaria a verde sem exercitar a guarda do banco -- que e
// justamente a que vale para o CLI, para a carga e para o psql.
const lancar = ({ material, tipo, quantidade, data = '2026-08-08', origem = null, destino = null, motivo = null }) =>
  conn.one(
    `INSERT INTO mapoteca.movimento_material
       (tipo_material_id, tipo_movimento_id, quantidade, data_movimento,
        localizacao_origem_id, localizacao_destino_id, motivo,
        usuario_criacao_id, usuario_atualizacao_id)
     VALUES ($<material>, $<tipo>, $<quantidade>, $<data>,
             $<origem>, $<destino>, $<motivo>, 1, 1)
     RETURNING id`,
    { material, tipo, quantidade, data, origem, destino, motivo }
  )

const saldo = async (materialId, localizacaoId = LOCAL.SECAO) => {
  const linha = await conn.oneOrNone(
    `SELECT quantidade FROM mapoteca.estoque_material
      WHERE tipo_material_id = $1 AND localizacao_id = $2`,
    [materialId, localizacaoId]
  )
  return linha ? Number(linha.quantidade) : null
}

// A SOMA DO LIVRO para um material numa localizacao: o que entrou menos o que
// saiu. E a conta que o saldo tem de reproduzir.
const somaDoLivro = async (materialId, localizacaoId) => {
  const { total } = await conn.one(
    `SELECT COALESCE(SUM(
              CASE WHEN localizacao_destino_id = $<local> THEN quantidade
                   ELSE -quantidade END), 0)::int AS total
       FROM mapoteca.movimento_material
      WHERE tipo_material_id = $<material>
        AND $<local> IN (localizacao_origem_id, localizacao_destino_id)`,
    { material: materialId, local: localizacaoId }
  )
  return total
}

describe('O livro de movimentos e o saldo', () => {
  it('o saldo bate com a soma do livro depois de entrada, transferencia e consumo', async () => {
    // A PROVA CENTRAL do desenho: `estoque_material` deixou de ter porta propria
    // de escrita, e passou a ser o acumulado do livro. Se algum caminho voltar a
    // escrever o saldo por fora, e aqui que a divergencia aparece.
    const papel = await criarMaterial('Papel Sulfite 120g (livro)')

    // 100 chegam no Almoxarifado.
    await lancar({ material: papel.id, tipo: MOV.ENTRADA, quantidade: 100, destino: LOCAL.ALMOXARIFADO })
    // 40 sobem para a Secao.
    await lancar({
      material: papel.id, tipo: MOV.TRANSFERENCIA, quantidade: 40,
      origem: LOCAL.ALMOXARIFADO, destino: LOCAL.SECAO
    })
    // 15 sao gastos.
    await lancar({ material: papel.id, tipo: MOV.CONSUMO, quantidade: 15, origem: LOCAL.SECAO })

    expect(await saldo(papel.id, LOCAL.ALMOXARIFADO)).toBe(60)
    expect(await saldo(papel.id, LOCAL.SECAO)).toBe(25)

    // E os dois saldos SAO a soma do livro, e nao apenas numeros plausiveis.
    expect(await saldo(papel.id, LOCAL.ALMOXARIFADO))
      .toBe(await somaDoLivro(papel.id, LOCAL.ALMOXARIFADO))
    expect(await saldo(papel.id, LOCAL.SECAO))
      .toBe(await somaDoLivro(papel.id, LOCAL.SECAO))
  })

  it('apagar o movimento desfaz o efeito dele no saldo', async () => {
    const tinta = await criarMaterial('Cartucho MK (livro)')
    await lancar({ material: tinta.id, tipo: MOV.ENTRADA, quantidade: 10, destino: LOCAL.SECAO })
    const consumo = await lancar({
      material: tinta.id, tipo: MOV.CONSUMO, quantidade: 4, origem: LOCAL.SECAO
    })

    expect(await saldo(tinta.id)).toBe(6)

    await conn.none('DELETE FROM mapoteca.movimento_material WHERE id = $1', [consumo.id])

    expect(await saldo(tinta.id)).toBe(10)
    expect(await saldo(tinta.id)).toBe(await somaDoLivro(tinta.id, LOCAL.SECAO))
  })

  it('alterar a quantidade acerta o saldo pela diferenca', async () => {
    const tinta = await criarMaterial('Cartucho CY (livro)')
    await lancar({ material: tinta.id, tipo: MOV.ENTRADA, quantidade: 10, destino: LOCAL.SECAO })
    const consumo = await lancar({
      material: tinta.id, tipo: MOV.CONSUMO, quantidade: 4, origem: LOCAL.SECAO
    })

    // Alterar e DESFAZER o antigo e APLICAR o novo. A ordem importa: fazendo o
    // contrario, subir de 4 para 9 seria recusado por falta de saldo, embora os
    // 9 caibam depois da devolucao dos 4.
    await conn.none(
      'UPDATE mapoteca.movimento_material SET quantidade = 9 WHERE id = $1',
      [consumo.id]
    )

    expect(await saldo(tinta.id)).toBe(1)
    expect(await saldo(tinta.id)).toBe(await somaDoLivro(tinta.id, LOCAL.SECAO))
  })
})

describe('O que o banco recusa no livro', () => {
  // A regra "consumo so da Secao" era um IF DENTRO DO GATILHO ate 2026-08-08: o
  // gatilho recusava e o banco aceitava a linha por qualquer outra porta. Ela
  // subiu para o CHECK, e e o CHECK que este caso prova.
  it('o CHECK recusa consumo fora da Secao', async () => {
    const papel = await criarMaterial('Papel no almoxarifado')
    await lancar({ material: papel.id, tipo: MOV.ENTRADA, quantidade: 50, destino: LOCAL.ALMOXARIFADO })

    await expect(
      lancar({ material: papel.id, tipo: MOV.CONSUMO, quantidade: 5, origem: LOCAL.ALMOXARIFADO })
    ).rejects.toThrow(/movimento_material_forma/)

    // O saldo do Almoxarifado nao foi tocado: recusar sem mexer e o contrato.
    expect(await saldo(papel.id, LOCAL.ALMOXARIFADO)).toBe(50)
  })

  it('o CHECK recusa consumo com destino, que seria transferencia disfarcada', async () => {
    const papel = await criarMaterial('Papel com destino')

    await expect(
      lancar({
        material: papel.id, tipo: MOV.CONSUMO, quantidade: 5,
        origem: LOCAL.SECAO, destino: LOCAL.ALMOXARIFADO
      })
    ).rejects.toThrow(/movimento_material_forma/)
  })

  it('o CHECK recusa transferencia de uma localizacao para ela mesma', async () => {
    // Somaria e subtrairia o mesmo saldo, e passaria por lancamento valido.
    const papel = await criarMaterial('Papel que nao sai do lugar')

    await expect(
      lancar({
        material: papel.id, tipo: MOV.TRANSFERENCIA, quantidade: 5,
        origem: LOCAL.SECAO, destino: LOCAL.SECAO
      })
    ).rejects.toThrow(/movimento_material_forma/)
  })

  it('o CHECK recusa entrada com origem: o material chega de fora', async () => {
    const papel = await criarMaterial('Papel que chega de lugar nenhum')

    await expect(
      lancar({
        material: papel.id, tipo: MOV.ENTRADA, quantidade: 5,
        origem: LOCAL.ALMOXARIFADO, destino: LOCAL.SECAO
      })
    ).rejects.toThrow(/movimento_material_forma/)
  })

  it('a CONTAGEM exige motivo', async () => {
    // Ela e o unico movimento que ninguem viu acontecer: a Entrada tem nota, a
    // Transferencia tem quem carregou e o Consumo tem o trabalho que o gastou.
    // Sem o porque, o ajuste do saldo fica sem explicacao.
    const papel = await criarMaterial('Papel contado sem motivo')

    await expect(
      lancar({ material: papel.id, tipo: MOV.CONTAGEM, quantidade: 5, destino: LOCAL.SECAO })
    ).rejects.toThrow(/movimento_material_contagem_exige_motivo/)
  })

  it('a CONTAGEM recusa os dois lados, e recusa nenhum', async () => {
    const papel = await criarMaterial('Papel contado dos dois lados')

    await expect(
      lancar({
        material: papel.id, tipo: MOV.CONTAGEM, quantidade: 5, motivo: 'Conferência',
        origem: LOCAL.SECAO, destino: LOCAL.ALMOXARIFADO
      })
    ).rejects.toThrow(/movimento_material_forma/)

    await expect(
      lancar({ material: papel.id, tipo: MOV.CONTAGEM, quantidade: 5, motivo: 'Conferência' })
    ).rejects.toThrow(/movimento_material_forma/)
  })

  // RN01: consumo so sai da Secao, e o material tem de ter sido transferido para
  // la antes. Sem esta recusa, o estoque ficaria negativo em silencio.
  it('recusa o consumo sem saldo nenhum, e a mensagem ENSINA o conserto', async () => {
    const tinta = await criarMaterial('Tinta sem estoque')

    // A frase tem de dizer O QUE FAZER, e nao so que houve recusa: quem lanca
    // consumo de material que esta no Almoxarifado precisa ler que o caminho e
    // transferir para a Secao antes.
    await expect(
      lancar({ material: tinta.id, tipo: MOV.CONSUMO, quantidade: 10, origem: LOCAL.SECAO })
    ).rejects.toThrow(/Transfira o material para lá antes de lançar esta saída/)
  })

  it('recusa o consumo maior que o saldo, dizendo quanto ha', async () => {
    const tinta = await criarMaterial('Tinta com pouco estoque')
    await lancar({ material: tinta.id, tipo: MOV.ENTRADA, quantidade: 3, destino: LOCAL.SECAO })

    await expect(
      lancar({ material: tinta.id, tipo: MOV.CONSUMO, quantidade: 10, origem: LOCAL.SECAO })
    ).rejects.toThrow(/Estoque insuficiente.*Disponível: 3, solicitado: 10/s)

    // E o saldo continua intacto.
    expect(await saldo(tinta.id)).toBe(3)
  })

  // O CHECK (quantidade >= 0) e a UNIQUE de `estoque_material` sao a ULTIMA
  // guarda, e e por elas que aquela tabela nao virou view. Este caso prova que a
  // guarda existe mesmo quando a conferencia do gatilho e contornada.
  it('o CHECK do estoque impede saldo negativo mesmo por UPDATE direto', async () => {
    const tinta = await criarMaterial('Tinta que nao fica negativa')
    await lancar({ material: tinta.id, tipo: MOV.ENTRADA, quantidade: 2, destino: LOCAL.SECAO })

    await expect(
      conn.none(
        `UPDATE mapoteca.estoque_material SET quantidade = -1
          WHERE tipo_material_id = $1 AND localizacao_id = $2`,
        [tinta.id, LOCAL.SECAO]
      )
    ).rejects.toThrow(/quantidade/)
  })
})

describe('A contagem de prateleira', () => {
  it('sobrou material: a diferenca ENTRA na localizacao', async () => {
    const papel = await criarMaterial('Papel que sobrou')
    await lancar({ material: papel.id, tipo: MOV.ENTRADA, quantidade: 10, destino: LOCAL.SECAO })

    await lancar({
      material: papel.id, tipo: MOV.CONTAGEM, quantidade: 3, destino: LOCAL.SECAO,
      motivo: 'Conferência de prateleira: havia três rolos a mais'
    })

    expect(await saldo(papel.id)).toBe(13)
  })

  it('faltou material: a diferenca SAI da localizacao', async () => {
    const papel = await criarMaterial('Papel que faltou')
    await lancar({ material: papel.id, tipo: MOV.ENTRADA, quantidade: 10, destino: LOCAL.SECAO })

    await lancar({
      material: papel.id, tipo: MOV.CONTAGEM, quantidade: 4, origem: LOCAL.SECAO,
      motivo: 'Conferência de prateleira: faltavam quatro rolos'
    })

    expect(await saldo(papel.id)).toBe(6)
  })
})

describe('A restrição entre cliente e pedido', () => {
  it('impede apagar o cliente que tem pedido', async () => {
    const cliente = await criarCliente()
    await criarPedido(cliente.id)

    // A MENSAGEM entra na asserção: `rejects.toThrow()` nu aceitaria qualquer
    // erro, inclusive um de sintaxe no SQL do próprio caso.
    await expect(
      conn.none('DELETE FROM mapoteca.cliente WHERE id = $1', [cliente.id])
    ).rejects.toThrow(/pedido/)

    // E o cliente continua lá: recusar sem apagar é o contrato inteiro.
    const { total } = await conn.one(
      'SELECT COUNT(*)::int AS total FROM mapoteca.cliente WHERE id = $1',
      [cliente.id]
    )
    expect(total).toBe(1)
  })

  it('deixa apagar o cliente que não tem pedido', async () => {
    const cliente = await criarCliente()

    await conn.none('DELETE FROM mapoteca.cliente WHERE id = $1', [cliente.id])

    const { total } = await conn.one(
      'SELECT COUNT(*)::int AS total FROM mapoteca.cliente WHERE id = $1',
      [cliente.id]
    )
    expect(total).toBe(0)
  })
})
