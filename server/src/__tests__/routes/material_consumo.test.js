'use strict'

// O CONSUMO DE MATERIAL, e o defeito que ele existe para não deixar voltar.
//
// Medido em produção em 2026-08-04: as subseções 7.2 e 7.3 do RPCMTec saíam
// marcadas "Calculada", com a fonte declarada, e imprimiam "Consumo no mês = 0"
// nas dezessete linhas -- enquanto `mapoteca.impressao_item` guardava 1.753
// impressões e 6.493 exemplares. O número não estava faltando: estava ERRADO,
// e a etiqueta convidava a acreditar nele.
//
// A causa era que o consumo saía só de `mapoteca.consumo_material`, que tem
// zero linhas, e nada ligava a impressão ao insumo. O conserto é
// `tipo_material.tipo_midia_id`, e o que este arquivo protege é:
//
//  1. imprimir na mídia BAIXA o papel dela, sem ninguém lançar nada;
//  2. a mídia FORNECIDA manda sobre a pedida (quem pediu tyvek e recebeu
//     sulfite gastou sulfite);
//  3. TINTA continua fora da derivação, e o banco recusa o cartucho que tentar
//     apontar mídia -- quanto de cartucho uma folha gasta depende do que está
//     desenhado nela;
//  4. o consumo DECLARADO e o IMPRESSO se somam, em vez de um sobrescrever o
//     outro.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, ADMIN_UUID } = require('../helpers/auth')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

// Papel (1) e Tinta (2), de dominio.categoria_material.
const PAPEL = 1
const TINTA = 2

// Sulfite 120g é a mídia 6, e é a única com impressão em produção.
const MIDIA_SULFITE = 6
const MIDIA_TYVEK = 8

const criarMaterial = async (nome, categoria, midia = null) =>
  conn.one(
    `INSERT INTO mapoteca.tipo_material (nome, categoria_id, tipo_midia_id, ativo)
     VALUES ($1, $2, $3, TRUE) RETURNING id`,
    [nome, categoria, midia]
  )

// Um pedido com um item avulso, que é o caminho mais curto até a impressão:
// item de acervo exigiria produto, versão e arquivo, e o que se mede aqui é a
// mídia, não a carta.
const criarImpressao = async ({ midiaPedida, midiaFornecida = null, quantidade, data }) => {
  const cliente = await conn.one(
    `INSERT INTO mapoteca.cliente (nome, tipo_cliente_id) VALUES ('Cliente Teste', 1)
     RETURNING id`
  )
  const pedido = await conn.one(
    `INSERT INTO mapoteca.pedido
       (cliente_id, data_pedido, situacao_pedido_id, usuario_criacao_id, usuario_atualizacao_id)
     VALUES ($1, $2, 1, 1, 1) RETURNING id`,
    [cliente.id, data]
  )
  const item = await conn.one(
    `INSERT INTO mapoteca.produto_pedido
       (pedido_id, quantidade, tipo_midia_id, tipo_midia_fornecida_id, nome_avulso,
        usuario_criacao_id, usuario_atualizacao_id)
     VALUES ($1, $2, $3, $4, 'Papel quadriculado', 1, 1) RETURNING id`,
    [pedido.id, quantidade, midiaPedida, midiaFornecida]
  )
  await conn.none(
    `INSERT INTO mapoteca.impressao_item
       (produto_pedido_id, quantidade, usuario_uuid, data_impressao)
     VALUES ($1, $2, $3, $4)`,
    [item.id, quantidade, ADMIN_UUID, data]
  )
  return { pedido, item }
}

// Estoque na SEÇÃO (localização 1). É de lá que o gatilho baixa o consumo
// declarado, e sem linha ali o INSERT é recusado.
const semearEstoque = async (materialId, quantidade) =>
  conn.none(
    `INSERT INTO mapoteca.estoque_material
       (tipo_material_id, quantidade, localizacao_id, usuario_criacao_id, usuario_atualizacao_id)
     VALUES ($1, $2, 1, 1, 1)`,
    [materialId, quantidade]
  )

const consumoDoMes = async (materialId, mes, ano = 2026) => {
  const res = await request(app)
    .get(`/api/mapoteca/consumo_mensal?ano=${ano}`)
    .set('Authorization', admin())
  expect(res.status).toBe(200)
  const linha = res.body.dados.find(
    l => Number(l.tipo_material_id) === Number(materialId) && Number(l.mes) === mes
  )
  return linha || null
}

describe('Consumo de material: a impressão baixa o papel', () => {
  test('imprimir na mídia conta como consumo do papel dela', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 40, data: '2026-03-10' })

    const linha = await consumoDoMes(papel.id, 3)
    expect(Number(linha.quantidade)).toBe(40)
    expect(Number(linha.quantidade_impressa)).toBe(40)
    // Nada foi lançado à mão, e o número existe assim mesmo. É a diferença
    // entre o antes e o depois deste conserto.
    expect(Number(linha.quantidade_declarada)).toBe(0)
  })

  test('a mídia FORNECIDA manda sobre a pedida', async () => {
    // Quem pediu tyvek e recebeu sulfite gastou sulfite, e é o estoque do
    // sulfite que baixou.
    const tyvek = await criarMaterial('Tyvek', PAPEL, MIDIA_TYVEK)
    const sulfite = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)

    await criarImpressao({
      midiaPedida: MIDIA_TYVEK,
      midiaFornecida: MIDIA_SULFITE,
      quantidade: 12,
      data: '2026-04-05'
    })

    expect(Number((await consumoDoMes(sulfite.id, 4)).quantidade)).toBe(12)
    expect(Number((await consumoDoMes(tyvek.id, 4)).quantidade)).toBe(0)
  })

  test('o declarado e o impresso se SOMAM', async () => {
    // O declarado é o que a impressão não explica: a folha perdida, o material
    // transferido. Um sobrescrevendo o outro esconderia metade do gasto.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 30, data: '2026-05-02' })
    // Lançar consumo EXIGE estoque na Seção (localização 1): é gatilho de
    // banco, e ele existe para ninguém consumir o que não foi transferido.
    await semearEstoque(papel.id, 50)
    await conn.none(
      `INSERT INTO mapoteca.consumo_material
         (tipo_material_id, quantidade, data_consumo, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($1, 7, '2026-05-20', 1, 1)`,
      [papel.id]
    )

    const linha = await consumoDoMes(papel.id, 5)
    expect(Number(linha.quantidade)).toBe(37)
    expect(Number(linha.quantidade_impressa)).toBe(30)
    expect(Number(linha.quantidade_declarada)).toBe(7)
  })

  test('impressão de mês diferente não entra no mês', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 25, data: '2026-06-15' })

    expect(Number((await consumoDoMes(papel.id, 6)).quantidade)).toBe(25)
    expect(Number((await consumoDoMes(papel.id, 7)).quantidade)).toBe(0)
  })

  test('papel SEM mídia não recebe consumo de impressão nenhuma', async () => {
    // Couchê e Vergê são mídia sem papel cadastrado, e papel sem mídia existe
    // pelo caminho inverso. Nos dois casos o consumo fica zerado, e é o certo:
    // inventar a ligação por semelhança de nome erraria calado.
    const papel = await criarMaterial('Papel Vergê', PAPEL, null)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 10, data: '2026-03-01' })

    expect(Number((await consumoDoMes(papel.id, 3)).quantidade)).toBe(0)
  })
})

describe('Consumo de material: a tinta fica fora da derivação', () => {
  test('o banco RECUSA cartucho apontando mídia', async () => {
    // É o CHECK `midia_so_para_papel`. Sem ele, um cartucho reivindicando
    // 'Sulfite 120g' faria o consumo de tinta ser derivado de folha impressa,
    // que é um número inventado.
    await expect(
      criarMaterial('Cartucho MK - T730', TINTA, MIDIA_SULFITE)
    ).rejects.toThrow(/midia_so_para_papel/)
  })

  test('a rota recusa o mesmo, com mensagem, em vez de 500', async () => {
    const res = await request(app)
      .post('/api/mapoteca/tipo_material')
      .set('Authorization', admin())
      .send({
        nome: 'Cartucho de teste',
        categoria_id: TINTA,
        tipo_midia_id: MIDIA_SULFITE,
        ativo: true
      })

    expect(res.status).toBeGreaterThanOrEqual(400)
    expect(res.status).toBeLessThan(500)
  })

  test('tinta sem mídia continua contando o consumo DECLARADO', async () => {
    // Zero ali quer dizer "ninguém declarou troca de cartucho", que é diferente
    // de errado. Declarada a troca, o número aparece.
    const tinta = await criarMaterial('Cartucho MK - T730', TINTA, null)
    await semearEstoque(tinta.id, 10)
    await conn.none(
      `INSERT INTO mapoteca.consumo_material
         (tipo_material_id, quantidade, data_consumo, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($1, 2, '2026-07-11', 1, 1)`,
      [tinta.id]
    )

    const linha = await consumoDoMes(tinta.id, 7)
    expect(Number(linha.quantidade)).toBe(2)
    expect(Number(linha.quantidade_impressa)).toBe(0)
  })
})

describe('Consumo de material: um material por mídia', () => {
  test('duas linhas na mesma mídia são recusadas', async () => {
    // Duas fariam a mesma folha baixar dois estoques.
    await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)

    await expect(
      criarMaterial('Sulfite 120g importado', PAPEL, MIDIA_SULFITE)
    ).rejects.toThrow(/unique_material_por_midia/)
  })

  test('vários materiais SEM mídia convivem', async () => {
    // O índice é parcial (WHERE tipo_midia_id IS NOT NULL): sem isso, o segundo
    // material sem mídia seria recusado, e a maioria do catálogo não tem mídia.
    await criarMaterial('Cartucho A', TINTA, null)
    await criarMaterial('Cartucho B', TINTA, null)

    const { count } = await conn.one(
      "SELECT count(*)::int AS count FROM mapoteca.tipo_material WHERE tipo_midia_id IS NULL"
    )
    expect(count).toBeGreaterThanOrEqual(2)
  })
})

describe('Consumo de material: o RPCMTec passa a dizer a verdade', () => {
  test('a 7.2 traz o consumo da impressão do mês', async () => {
    // É o defeito medido em produção, do lado de fora: a subseção inteira.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 100)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 64, data: '2026-03-18' })

    const edicao = await request(app)
      .post('/api/rpcmtec')
      .set('Authorization', admin())
      .send({ ano: 2026, mes: 3 })
    expect(edicao.status).toBe(201)

    const doc = await request(app)
      .get(`/api/rpcmtec/${edicao.body.dados.id}/documento`)
      .set('Authorization', admin())

    const bloco = doc.body.dados.secoes
      .flatMap(s => s.subsecoes).find(b => b.numero === '7.2')
    const linha = bloco.linhas.find(l => l[0] === 'Papel Sulfite 120g')

    // Insumo | Estoque atual | Estoque mês anterior | Consumo no mês | Previsão
    expect(linha[1]).toBe('100')
    // A coluna que dizia 0 com impressão registrada.
    expect(linha[3]).toBe('64')
    // As duas que continuam sem fonte, e a fonte declara isso.
    expect(linha[2]).toBe('-')
    expect(linha[4]).toBe('-')
  })
})

// ---------------------------------------------------------------------------
// A DATA da impressão, e por que ela virou rota
//
// Medido em produção em 2026-08-04: 1.751 das 1.753 impressões guardavam a data
// da CARGA (três dias de julho) e cobriam pedidos de novembro de 2025 a julho de
// 2026. Com o consumo derivado da impressão, o RPCMTec de julho reportaria a
// impressão de sete meses -- um número errado no lugar de outro, com a mesma
// etiqueta "Calculada".
//
// Duas coisas faltavam ao sistema, e as duas são o que este bloco protege:
// registrar impressão com a data em que ela ACONTECEU, e corrigir a data de um
// registro já gravado sem apagá-lo.
// ---------------------------------------------------------------------------

describe('A data da impressão', () => {
  const criarItem = async () => {
    const cliente = await conn.one(
      `INSERT INTO mapoteca.cliente (nome, tipo_cliente_id)
       VALUES ('Cliente Teste', 1) RETURNING id`
    )
    const pedido = await conn.one(
      `INSERT INTO mapoteca.pedido
         (cliente_id, data_pedido, situacao_pedido_id, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($1, '2026-03-01', 1, 1, 1) RETURNING id`,
      [cliente.id]
    )
    return conn.one(
      `INSERT INTO mapoteca.produto_pedido
         (pedido_id, quantidade, tipo_midia_id, nome_avulso,
          usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($1, 10, $2, 'Papel quadriculado', 1, 1) RETURNING id, pedido_id`,
      [pedido.id, MIDIA_SULFITE]
    )
  }

  test('registrar com data respeita a data informada', async () => {
    // Registrar na segunda o que se imprimiu na sexta tem de contar na sexta.
    const item = await criarItem()

    const res = await request(app)
      .post('/api/mapoteca/impressao')
      .set('Authorization', admin())
      .send({
        registros: [{
          produto_pedido_id: Number(item.id),
          quantidade: 8,
          data_impressao: '2026-03-14T10:00:00.000Z'
        }]
      })
    expect(res.status).toBe(201)

    const { data_impressao: gravada } = await conn.one(
      'SELECT data_impressao FROM mapoteca.impressao_item WHERE produto_pedido_id = $1',
      [item.id]
    )
    expect(new Date(gravada).toISOString()).toBe('2026-03-14T10:00:00.000Z')
  })

  test('registrar SEM data continua carimbando agora', async () => {
    // É o caminho do plugin, que registra o que acabou de sair da plotter.
    const item = await criarItem()

    await request(app)
      .post('/api/mapoteca/impressao')
      .set('Authorization', admin())
      .send({ registros: [{ produto_pedido_id: Number(item.id), quantidade: 3 }] })

    const { data_impressao: gravada } = await conn.one(
      'SELECT data_impressao FROM mapoteca.impressao_item WHERE produto_pedido_id = $1',
      [item.id]
    )
    expect(Date.now() - new Date(gravada).getTime()).toBeLessThan(60_000)
  })

  test('corrigir a data MOVE o consumo de mês, sem apagar o registro', async () => {
    // É o defeito de produção, do lado de fora: a impressão de março tinha sido
    // gravada com a data da carga, em julho.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    const item = await criarItem()
    await conn.none(
      `INSERT INTO mapoteca.impressao_item
         (produto_pedido_id, quantidade, usuario_uuid, data_impressao)
       VALUES ($1, 20, $2, '2026-07-23T12:00:00.000Z')`,
      [item.id, ADMIN_UUID]
    )
    const { id: impressaoId } = await conn.one(
      'SELECT id FROM mapoteca.impressao_item WHERE produto_pedido_id = $1', [item.id]
    )

    expect(Number((await consumoDoMes(papel.id, 7)).quantidade)).toBe(20)
    expect(Number((await consumoDoMes(papel.id, 3)).quantidade)).toBe(0)

    const res = await request(app)
      .put(`/api/mapoteca/impressao/${impressaoId}/data`)
      .set('Authorization', admin())
      .send({
        data_impressao: '2026-03-20T09:00:00.000Z',
        motivo: 'A data era a da carga, e o pedido foi atendido em março'
      })
    expect(res.status).toBe(200)

    // O registro CONTINUA sendo o mesmo: corrigir não é apagar e recriar.
    const { count } = await conn.one(
      'SELECT count(*)::int AS count FROM mapoteca.impressao_item WHERE id = $1',
      [impressaoId]
    )
    expect(count).toBe(1)

    expect(Number((await consumoDoMes(papel.id, 3)).quantidade)).toBe(20)
    expect(Number((await consumoDoMes(papel.id, 7)).quantidade)).toBe(0)
  })

  test('a correção exige MOTIVO', async () => {
    // Mudar quando um gasto aconteceu muda o número que o relatório reporta
    // naquele mês, e quem lê o histórico depois precisa saber por quê.
    const item = await criarItem()
    await conn.none(
      `INSERT INTO mapoteca.impressao_item
         (produto_pedido_id, quantidade, usuario_uuid, data_impressao)
       VALUES ($1, 5, $2, '2026-07-23T12:00:00.000Z')`,
      [item.id, ADMIN_UUID]
    )
    const { id } = await conn.one(
      'SELECT id FROM mapoteca.impressao_item WHERE produto_pedido_id = $1', [item.id]
    )

    const res = await request(app)
      .put(`/api/mapoteca/impressao/${id}/data`)
      .set('Authorization', admin())
      .send({ data_impressao: '2026-03-20T09:00:00.000Z' })

    expect(res.status).toBe(400)
  })

  test('a correção deixa rastro com os dois lados e o motivo, na ficha do PEDIDO', async () => {
    const item = await criarItem()
    await conn.none(
      `INSERT INTO mapoteca.impressao_item
         (produto_pedido_id, quantidade, usuario_uuid, data_impressao)
       VALUES ($1, 5, $2, '2026-07-23T12:00:00.000Z')`,
      [item.id, ADMIN_UUID]
    )
    const { id } = await conn.one(
      'SELECT id FROM mapoteca.impressao_item WHERE produto_pedido_id = $1', [item.id]
    )

    await request(app)
      .put(`/api/mapoteca/impressao/${id}/data`)
      .set('Authorization', admin())
      .send({
        data_impressao: '2026-03-20T09:00:00.000Z',
        motivo: 'Data da carga'
      })

    const evento = await conn.one(
      `SELECT * FROM auditoria.evento
       WHERE tabela = 'mapoteca.impressao_item' AND operacao = 'U'`
    )
    expect(evento.motivo).toBe('Data da carga')
    expect(evento.campos_alterados).toEqual(['data_impressao'])
    // O agregado é o PEDIDO: é onde quem lê o histórico vai procurar.
    expect(evento.entidade).toBe('pedido')
    expect(evento.entidade_id).toBe(String(item.pedido_id))
  })

  test('registro inexistente responde 404', async () => {
    const res = await request(app)
      .put('/api/mapoteca/impressao/999999/data')
      .set('Authorization', admin())
      .send({ data_impressao: '2026-03-20T09:00:00.000Z', motivo: 'teste' })

    expect(res.status).toBe(404)
  })
})

// ---------------------------------------------------------------------------
// "Estoque mês anterior" e "Previsão de falta", as duas colunas que saíam '-'
//
// `mapoteca.estoque_material` guarda só o saldo de HOJE, atualizado no lugar: o
// saldo de maio não existe mais lá, e derivá-lo de "estoque atual mais consumo"
// ignoraria as ENTRADAS e erraria em silêncio todo mês com reposição.
//
// A resposta vem da EDIÇÃO FECHADA do mês anterior, que congelou a própria 7.2
// no instante do fechamento. É a comparação que o relatório quer: "o que
// reportamos no mês passado".
// ---------------------------------------------------------------------------

describe('Estoque do mês anterior e previsão de falta', () => {
  const estrutura = require('../../rpcmtec/rpcmtec_estrutura')

  const abrirEdicao = async (mes) => {
    const res = await request(app)
      .post('/api/rpcmtec')
      .set('Authorization', admin())
      .send({ ano: 2026, mes, assinante_uuid: ADMIN_UUID })
    expect(res.status).toBe(201)
    return res.body.dados.id
  }

  const fechar = async (id) => {
    for (const numero of estrutura.NUMEROS_DIGITADOS) {
      await request(app)
        .put(`/api/rpcmtec/${id}/subsecao/${numero}`)
        .set('Authorization', admin())
        .send({ sem_ocorrencia: true })
    }
    const res = await request(app)
      .post(`/api/rpcmtec/${id}/fechar`)
      .set('Authorization', admin())
    expect(res.status).toBe(200)
  }

  const linha72 = async (edicaoId, nome) => {
    const doc = await request(app)
      .get(`/api/rpcmtec/${edicaoId}/documento`)
      .set('Authorization', admin())
    const bloco = doc.body.dados.secoes
      .flatMap(s => s.subsecoes).find(b => b.numero === '7.2')
    return bloco.linhas.find(l => l[0] === nome)
  }

  test('sem edição fechada no mês anterior, a coluna sai traço', async () => {
    // Inventar o número a partir do saldo de hoje daria uma coluna que parece
    // apurada e não é. O traço é a resposta honesta.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 100)

    const abril = await abrirEdicao(4)
    const l = await linha72(abril, 'Papel Sulfite 120g')

    expect(l[1]).toBe('100')
    expect(l[2]).toBe('-')
  })

  test('com o mês anterior FECHADO, traz o que aquela edição reportou', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 100)

    // Março fecha com 100 no estoque.
    const marco = await abrirEdicao(3)
    await fechar(marco)

    // O saldo de HOJE muda: alguém consumiu 40 folhas depois do fechamento.
    await conn.none(
      'UPDATE mapoteca.estoque_material SET quantidade = 60 WHERE tipo_material_id = $1',
      [papel.id]
    )

    const abril = await abrirEdicao(4)
    const l = await linha72(abril, 'Papel Sulfite 120g')

    expect(l[1]).toBe('60')
    // O congelado de março, e não o saldo de hoje.
    expect(l[2]).toBe('100')
  })

  test('edição do mês anterior ABERTA não conta', async () => {
    // Só o fechamento congela. Uma edição aberta ainda vai mudar, e ler dela
    // daria um "mês anterior" que muda depois de publicado.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 100)

    await abrirEdicao(3)
    const abril = await abrirEdicao(4)

    expect((await linha72(abril, 'Papel Sulfite 120g'))[2]).toBe('-')
  })

  test('em janeiro, procura dezembro do ano anterior', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 70)

    const dez = await request(app)
      .post('/api/rpcmtec').set('Authorization', admin())
      .send({ ano: 2025, mes: 12, assinante_uuid: ADMIN_UUID })
    await fechar(dez.body.dados.id)

    const jan = await abrirEdicao(1)
    expect((await linha72(jan, 'Papel Sulfite 120g'))[2]).toBe('70')
  })

  test('com menos de três meses de consumo, não projeta', async () => {
    // Média sobre dois meses diz mais sobre o acaso do que sobre o ritmo.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 100)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 10, data: '2026-01-10' })
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 10, data: '2026-02-10' })

    const abril = await abrirEdicao(4)
    expect((await linha72(abril, 'Papel Sulfite 120g'))[4]).toBe('-')
  })

  test('com três meses fechados, projeta o mês da falta', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 100)
    for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 20, data: dia })
    }

    // Média 20/mês, 100 em estoque: cinco meses a partir de abril = setembro.
    const abril = await abrirEdicao(4)
    expect((await linha72(abril, 'Papel Sulfite 120g'))[4]).toBe('SET 26')
  })

  test('estoque zerado com consumo acontecendo sai como "Sem estoque"', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 0)
    for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 20, data: dia })
    }

    const abril = await abrirEdicao(4)
    expect((await linha72(abril, 'Papel Sulfite 120g'))[4]).toBe('Sem estoque')
  })

  test('o mês CORRENTE não entra na média', async () => {
    // Ele ainda está andando, e entrar pela metade puxa a média para baixo,
    // empurrando a falta para longe.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 100)
    for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 20, data: dia })
    }
    // Abril mal começou: 2 folhas. Se entrasse, a média cairia de 20 para 15,5.
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 2, data: '2026-04-01' })

    const abril = await abrirEdicao(4)
    expect((await linha72(abril, 'Papel Sulfite 120g'))[4]).toBe('SET 26')
  })
})
