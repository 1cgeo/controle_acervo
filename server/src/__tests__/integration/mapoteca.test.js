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
// ENTRADA = 1, TRANSFERENCIA = 2, CONSUMO = 3. O 4 era a Contagem, extinta em
// 2026-08-08: ele nao esta no mapa, e o caso que prova a recusa dele o escreve
// cru, de proposito.
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

  // O TIPO 4 FOI EXTINTO em 2026-08-08, e este caso e o que o mantem extinto NO
  // BANCO -- que e onde importa, porque a linha do dominio continua la.
  //
  // Ela ficou para a auditoria antiga se traduzir, entao a FK aceita o valor 4
  // sem reclamar: sem o `ELSE FALSE` do CHECK, um INSERT por psql, CLI ou carga
  // ressuscitaria a Contagem sem passar por tela nenhuma.
  it('o CHECK recusa o tipo 4, a Contagem extinta, com qualquer forma', async () => {
    const papel = await criarMaterial('Papel que ninguem conta mais')
    const CONTAGEM = 4

    // A forma que ela tinha: exatamente um lado, com motivo.
    await expect(
      lancar({
        material: papel.id, tipo: CONTAGEM, quantidade: 5,
        destino: LOCAL.SECAO, motivo: 'Conferência'
      })
    ).rejects.toThrow(/movimento_material_forma/)

    await expect(
      lancar({
        material: papel.id, tipo: CONTAGEM, quantidade: 5,
        origem: LOCAL.SECAO, motivo: 'Conferência'
      })
    ).rejects.toThrow(/movimento_material_forma/)
  })

  it('o dominio tem TRES tipos, e a linha 4 nao existe', async () => {
    // A 1.45.0 DEIXOU a linha 4, marcada como "Contagem (extinta)", para que um
    // evento antigo de `auditoria.evento` nao exibisse "Tipo de movimento: 4"
    // cru -- quem traduz e o catalogo VIVO desta tabela, lido por
    // `auditoria/renderizar.js`.
    //
    // A 1.48.0 a APAGOU, e o que mudou foi a medicao, nao o argumento: a janela
    // em que uma Contagem podia ser lancada foi da 1.41.0 a 1.45.0, ambas de
    // 2026-08-08, e nela nao houve UM movimento sequer. No dump de producao do
    // mesmo dia a tabela do livro nem estava criada. Guardar um valor de dominio
    // para um passado que nao aconteceu nao e prudencia: e um codigo que so pode
    // confundir quem ler a tabela.
    //
    // A migracao carrega as duas guardas que este teste nao pode carregar: ela
    // levanta excecao se achar linha do livro OU evento de auditoria com tipo 4.
    //
    // E NAO HA UM CASO PARA A CHAVE ESTRANGEIRA, de proposito. Sem a linha 4 a
    // FK tambem passou a recusar o tipo, e seria a recusa mais barata das tres
    // -- mas ela nao e OBSERVAVEL: o CHECK `movimento_material_forma` e avaliado
    // durante o INSERT e o gatilho da FK so depois, entao a excecao que chega
    // nomeia sempre o CHECK. Um caso que afirmasse a FK estaria medindo o teste
    // acima com outro nome.
    const linhas = await conn.any(
      'SELECT code, nome FROM mapoteca.tipo_movimento_material ORDER BY code'
    )

    expect(linhas.map(l => l.code)).toEqual([1, 2, 3])
    expect(linhas.map(l => l.nome)).toEqual(['Entrada', 'Transferência', 'Consumo'])
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

// O QUE SUBSTITUIU A CONTAGEM, e a razao de ela ter podido sair.
//
// Ate 2026-08-08 a prateleira que nao batia com o sistema se resolvia lancando a
// DIFERENCA, num tipo proprio. A decisao do chefe naquele dia foi que o saldo
// tem de estar certo por Entrada, Transferencia e Consumo -- e o argumento de
// engenharia e este describe: o livro ja sabia desfazer, entao lancamento errado
// nunca precisou de um lancamento a mais.
//
// Prova o GATILHO, com SQL cru. Pela rota, o Joi barraria primeiro e o caso
// passaria a verde sem exercitar o `TG_OP IN ('UPDATE','DELETE')`.
describe('O conserto de um lancamento errado, que e o que sobrou no lugar da Contagem', () => {
  it('corrigir a QUANTIDADE de um consumo devolve a diferenca ao saldo', async () => {
    const papel = await criarMaterial('Papel com consumo digitado errado')
    await lancar({ material: papel.id, tipo: MOV.ENTRADA, quantidade: 10, destino: LOCAL.SECAO })

    // Quem lancou digitou 8 onde saiu 3.
    const errado = await lancar({
      material: papel.id, tipo: MOV.CONSUMO, quantidade: 8, origem: LOCAL.SECAO
    })
    expect(await saldo(papel.id)).toBe(2)

    await conn.none(
      'UPDATE mapoteca.movimento_material SET quantidade = 3 WHERE id = $1',
      [errado.id]
    )

    // 10 - 3, e nao 2 + 5: o gatilho DESFAZ a linha antiga inteira e aplica a
    // nova. E o que faz o saldo voltar EXATO, sem somar ao livro um evento que
    // nunca aconteceu.
    expect(await saldo(papel.id)).toBe(7)
    expect(await somaDoLivro(papel.id, LOCAL.SECAO)).toBe(7)
  })

  it('apagar um movimento inteiro devolve o efeito dele', async () => {
    const papel = await criarMaterial('Papel com consumo que nunca houve')
    await lancar({ material: papel.id, tipo: MOV.ENTRADA, quantidade: 10, destino: LOCAL.SECAO })

    const inventado = await lancar({
      material: papel.id, tipo: MOV.CONSUMO, quantidade: 4, origem: LOCAL.SECAO
    })
    expect(await saldo(papel.id)).toBe(6)

    await conn.none('DELETE FROM mapoteca.movimento_material WHERE id = $1', [inventado.id])

    expect(await saldo(papel.id)).toBe(10)
    expect(await somaDoLivro(papel.id, LOCAL.SECAO)).toBe(10)
  })

  it('material que de fato SUMIU sai como Consumo, e nao ha outro caminho', async () => {
    // A consequencia aceita junto com a decisao: sem a Contagem, quebra e
    // extravio entram na 7.2 do RPCMTec como gasto, porque nao ha mais onde
    // separar um do outro. O motivo continua cabendo, e agora e opcional.
    const papel = await criarMaterial('Papel que molhou')
    await lancar({ material: papel.id, tipo: MOV.ENTRADA, quantidade: 10, destino: LOCAL.SECAO })

    await lancar({
      material: papel.id, tipo: MOV.CONSUMO, quantidade: 4, origem: LOCAL.SECAO,
      motivo: 'Bobina molhada na enchente'
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
