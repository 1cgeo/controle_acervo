'use strict'

// O CONSUMO DE MATERIAL: quem o declara, e quem NAO o declara.
//
// A REGRA, decidida pelo chefe em 2026-08-07: consumo e o que a Secao lanca na
// aba "Consumo de material". Vale igual para papel (7.2 do RPCMTec) e para
// tinta (7.3). A impressao NAO conta como consumo.
//
// O QUE ISSO DESFEZ, e por que. Entre 2026-08 e essa data o papel somava a
// impressao derivada da midia, e a tinta nao. A 7.2 de julho saiu com "consumo
// 802, estoque 64": os 802 vinham de 121 itens impressos, os 64 de uma
// contagem digitada, e nenhum consumo de papel fora lancado no ano inteiro.
// Uma coluna media o mundo, a outra media o cadastro, e a subtracao entre elas
// nao significava nada.
//
// A fonte unica e o que torna a conta fechavel: os gatilhos de
// `consumo_material` baixam `estoque_material`, entao lancar o consumo move o
// estoque junto. Derivando da impressao, o consumo andava e o estoque nao.
//
// O que este arquivo protege:
//
//  1. imprimir NAO gera consumo, por mais exemplares que saiam;
//  2. o consumo declarado aparece inteiro, sem nada somado por fora;
//  3. `quantidade_impressa` continua visivel AO LADO, para conferencia -- muita
//     impressao com pouco consumo declarado e lancamento em atraso;
//  4. a midia FORNECIDA manda sobre a pedida naquele numero de conferencia;
//  5. TINTA nao tem midia, e o banco recusa o cartucho que tentar apontar uma.

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

// REUSA o papel que já reivindica a mídia, em vez de inserir outro.
//
// `unique_material_por_midia` garante UM material por mídia, e desde 2026-08-06
// o seed do `er/` já entrega os papéis ligados (antes ele os deixava com a mídia
// nula e só a migração de 2026-08-04 os ligava, então instalação nova divergia
// da migrada). Inserir aqui colidia com o seed no PRIMEIRO teste do arquivo e
// passava nos demais, porque o `cleanTestData` trunca a tabela entre eles.
//
// Sem mídia, insere sempre: material de tinta não reivindica nada, e o teste do
// índice parcial precisa de duas linhas com a coluna nula.
const criarMaterial = async (nome, categoria, midia = null) => {
  if (midia !== null) {
    const existente = await conn.oneOrNone(
      'SELECT id FROM mapoteca.tipo_material WHERE tipo_midia_id = $1', [midia]
    )
    if (existente) return existente
  }
  return conn.one(
    `INSERT INTO mapoteca.tipo_material (nome, categoria_id, tipo_midia_id, ativo)
     VALUES ($1, $2, $3, TRUE) RETURNING id`,
    [nome, categoria, midia]
  )
}

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

// Lanca consumo declarado, que e a UNICA fonte do consumo desde 2026-08-07.
// Exige estoque na Secao: o gatilho recusa consumir o que nao foi transferido.
const declararConsumo = async (materialId, quantidade, data) =>
  conn.none(
    `INSERT INTO mapoteca.consumo_material
       (tipo_material_id, quantidade, data_consumo, usuario_criacao_id, usuario_atualizacao_id)
     VALUES ($1, $2, $3, 1, 1)`,
    [materialId, quantidade, data]
  )

// Deixa o saldo da Secao no valor pedido, DEPOIS dos lancamentos. Os gatilhos do
// consumo ja baixaram o estoque, e a previsao de falta se mede contra um saldo
// escolhido: sem isto, cada teste teria de somar de cabeca o que o gatilho tirou.
const fixarEstoque = async (materialId, quantidade) =>
  conn.none(
    `UPDATE mapoteca.estoque_material SET quantidade = $2
     WHERE tipo_material_id = $1 AND localizacao_id = 1`,
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

describe('Consumo de material: a impressao NAO e consumo', () => {
  test('imprimir na midia nao gera consumo nenhum do papel dela', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 40, data: '2026-03-10' })

    const linha = await consumoDoMes(papel.id, 3)
    // ZERO, com 40 exemplares impressos. Consumo e o que se declara, e ninguem
    // declarou: o zero e honesto e a Secao o conserta lancando.
    expect(Number(linha.quantidade)).toBe(0)
    // E o impresso continua a vista, para a conferencia.
    expect(Number(linha.quantidade_impressa)).toBe(40)
  })

  test('o declarado aparece inteiro, sem a impressao somada por fora', async () => {
    // Era aqui que os dois se somavam. Hoje a coluna traz os 7 lancados, e nao
    // 37: e a diferenca entre o antes e o depois desta decisao.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 30, data: '2026-05-02' })
    // Lancar consumo EXIGE estoque na Secao (localizacao 1): e gatilho de
    // banco, e ele existe para ninguem consumir o que nao foi transferido.
    await semearEstoque(papel.id, 50)
    await conn.none(
      `INSERT INTO mapoteca.consumo_material
         (tipo_material_id, quantidade, data_consumo, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($1, 7, '2026-05-20', 1, 1)`,
      [papel.id]
    )

    const linha = await consumoDoMes(papel.id, 5)
    expect(Number(linha.quantidade)).toBe(7)
    expect(Number(linha.quantidade_impressa)).toBe(30)
  })

  test('lancar consumo BAIXA o estoque, que e o que fecha a conta', async () => {
    // A razao de a fonte ser unica. Com o consumo derivado da impressao, o
    // numero andava e o estoque ficava parado, e as duas colunas da 7.2
    // deixavam de se subtrair.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 50)
    await conn.none(
      `INSERT INTO mapoteca.consumo_material
         (tipo_material_id, quantidade, data_consumo, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($1, 12, '2026-05-20', 1, 1)`,
      [papel.id]
    )

    const saldo = await conn.one(
      `SELECT quantidade FROM mapoteca.estoque_material
       WHERE tipo_material_id = $1 AND localizacao_id = 1`,
      [papel.id]
    )
    expect(Number(saldo.quantidade)).toBe(38)
    expect(Number((await consumoDoMes(papel.id, 5)).quantidade)).toBe(12)
  })

  test('na conferencia, a midia FORNECIDA manda sobre a pedida', async () => {
    // Quem pediu tyvek e recebeu sulfite imprimiu em sulfite. Isso nao e
    // consumo, mas o numero de conferencia tem de cair no papel certo.
    const tyvek = await criarMaterial('Tyvek', PAPEL, MIDIA_TYVEK)
    const sulfite = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await criarImpressao({
      midiaPedida: MIDIA_TYVEK, midiaFornecida: MIDIA_SULFITE,
      quantidade: 15, data: '2026-04-08'
    })

    expect(Number((await consumoDoMes(sulfite.id, 4)).quantidade_impressa)).toBe(15)
    expect(Number((await consumoDoMes(tyvek.id, 4)).quantidade_impressa)).toBe(0)
    // E nenhum dos dois teve CONSUMO, porque ninguem declarou.
    expect(Number((await consumoDoMes(sulfite.id, 4)).quantidade)).toBe(0)
  })

  test('consumo declarado em outro mes nao entra no mes', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 50)
    await conn.none(
      `INSERT INTO mapoteca.consumo_material
         (tipo_material_id, quantidade, data_consumo, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($1, 25, '2026-06-15', 1, 1)`,
      [papel.id]
    )

    expect(Number((await consumoDoMes(papel.id, 6)).quantidade)).toBe(25)
    expect(Number((await consumoDoMes(papel.id, 7)).quantidade)).toBe(0)
  })
})

describe('Consumo de material: a tinta nunca teve midia, e continua sem', () => {
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

  test('tinta conta o consumo declarado, como o papel', async () => {
    // Zero ali quer dizer "ninguem declarou troca de cartucho", que e diferente
    // de errado. Declarada a troca, o numero aparece. Desde 2026-08-07 o papel
    // segue exatamente esta regra.
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
    // INSERT DIRETO, e não `criarMaterial`: aquele REUSA o papel que já
    // reivindica a mídia, e reusar nunca colide. O que se prova aqui é a recusa
    // do índice, então o segundo INSERT tem de ser um INSERT de verdade.
    const inserir = (nome) => conn.one(
      `INSERT INTO mapoteca.tipo_material (nome, categoria_id, tipo_midia_id, ativo)
       VALUES ($1, $2, $3, TRUE) RETURNING id`,
      [nome, PAPEL, MIDIA_SULFITE]
    )

    // Duas fariam a mesma folha baixar dois estoques. A primeira só entra se o
    // seed já não tiver ocupado a mídia, e é indiferente qual delas ocupou: o
    // que importa é que a SEGUNDA seja recusada.
    const jaOcupada = await conn.oneOrNone(
      'SELECT id FROM mapoteca.tipo_material WHERE tipo_midia_id = $1', [MIDIA_SULFITE]
    )
    if (!jaOcupada) await inserir('Papel Sulfite 120g')

    await expect(inserir('Sulfite 120g importado'))
      .rejects.toThrow(/unique_material_por_midia/)
  })

  test('vários materiais SEM mídia convivem', async () => {
    // O índice é parcial (WHERE tipo_midia_id IS NOT NULL): sem isso, o segundo
    // material sem mídia seria recusado, e a maioria do catálogo não tem mídia.
    const a = await criarMaterial('Cartucho A', TINTA, null)
    const b = await criarMaterial('Cartucho B', TINTA, null)

    // OS DOIS QUE ESTE CASO CRIOU, e nao a contagem da tabela inteira: contar
    // tudo satisfaz o caso com qualquer par de linhas ja existente, e a
    // asserçao passa a valer mesmo se os dois INSERTs nao tivessem entrado.
    const linhas = await conn.any(
      `SELECT id FROM mapoteca.tipo_material
        WHERE id IN ($1, $2) AND tipo_midia_id IS NULL`,
      [a.id, b.id]
    )
    expect(linhas).toHaveLength(2)
  })
})

describe('Consumo de material: a 7.2 do RPCMTec', () => {
  test('a 7.2 traz o consumo DECLARADO, e ignora a impressao do mes', async () => {
    // A subsecao inteira, do lado de fora. Sao 64 exemplares impressos e 9
    // lancados: a coluna traz os 9.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 100)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 64, data: '2026-03-18' })
    await conn.none(
      `INSERT INTO mapoteca.consumo_material
         (tipo_material_id, quantidade, data_consumo, usuario_criacao_id, usuario_atualizacao_id)
       VALUES ($1, 9, '2026-03-20', 1, 1)`,
      [papel.id]
    )

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

    // Insumo | Estoque atual | Estoque mes anterior | Consumo no mes | Previsao
    //
    // O ESTOQUE JA VEM BAIXADO pelo gatilho do consumo: 100 semeados menos os 9
    // lancados. E o que a fonte unica compra -- as duas colunas se subtraem.
    expect(linha[1]).toBe('91')
    // NOVE, e nao 64 nem 73. Consumo e o declarado.
    expect(linha[3]).toBe('9')
    // As duas que continuam sem fonte, e a fonte declara isso.
    expect(linha[2]).toBe('-')
    expect(linha[4]).toBe('-')
  })

  test('imprimir sem lancar deixa a 7.2 em ZERO, e isso e o certo', async () => {
    // O caso de julho de 2026, que motivou a decisao: 121 itens impressos e
    // nenhum lancamento. A coluna sai zerada, e o zero e o recado para a Secao
    // lancar, nao um numero para o relatorio inventar.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 100)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 64, data: '2026-03-18' })

    const edicao = await request(app)
      .post('/api/rpcmtec')
      .set('Authorization', admin())
      .send({ ano: 2026, mes: 3 })

    const doc = await request(app)
      .get(`/api/rpcmtec/${edicao.body.dados.id}/documento`)
      .set('Authorization', admin())

    const bloco = doc.body.dados.secoes
      .flatMap(s => s.subsecoes).find(b => b.numero === '7.2')
    const linha = bloco.linhas.find(l => l[0] === 'Papel Sulfite 120g')

    expect(linha[1]).toBe('100')
    expect(linha[3]).toBe('0')
  })
})

// ---------------------------------------------------------------------------
// A DATA da impressão, e por que ela virou rota
//
// REGRESSÃO: a impressão herdava a data da CARGA, e não a data em que foi
// impressa, então a carga de julho empilhava ali a impressão de vários meses.
//
// A data continua importando depois de 2026-08-07, quando a impressão deixou de
// contar como consumo. Ela é o que põe cada impressão no mês certo do histórico
// do pedido e da coluna de CONFERÊNCIA, aquela que denuncia o mês com muita
// impressão e pouco consumo lançado.
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
    // E o defeito de producao, do lado de fora: a impressao de marco tinha sido
    // gravada com a data da carga, em julho.
    //
    // O OBSERVAVEL E `quantidade_impressa`, e nao o consumo: desde 2026-08-07 a
    // impressao nao e consumo. A rota continua importando, porque e ela que
    // coloca a impressao no mes certo da CONFERENCIA e do historico do pedido.
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

    expect(Number((await consumoDoMes(papel.id, 7)).quantidade_impressa)).toBe(20)
    expect(Number((await consumoDoMes(papel.id, 3)).quantidade_impressa)).toBe(0)

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

    expect(Number((await consumoDoMes(papel.id, 3)).quantidade_impressa)).toBe(20)
    expect(Number((await consumoDoMes(papel.id, 7)).quantidade_impressa)).toBe(0)
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
    // `ciente_revisao`: desde a 1.36.0 o fechamento AVISA quando ha subsecao sem
    // conferencia e pede confirmacao (409). Aqui a edicao e cenario, e o que se
    // testa e o estoque do mes anterior.
    const res = await request(app)
      .post(`/api/rpcmtec/${id}/fechar`)
      .set('Authorization', admin())
      .send({ ciente_revisao: true })
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
    await semearEstoque(papel.id, 500)
    for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      await declararConsumo(papel.id, 20, dia)
    }
    await fixarEstoque(papel.id, 100)

    // Média 20/mês, 100 em estoque: cinco meses a partir de abril = setembro.
    const abril = await abrirEdicao(4)
    expect((await linha72(abril, 'Papel Sulfite 120g'))[4]).toBe('SET 26')
  })

  test('estoque zerado com consumo acontecendo sai como "Sem estoque"', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 500)
    for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      await declararConsumo(papel.id, 20, dia)
    }
    await fixarEstoque(papel.id, 0)

    const abril = await abrirEdicao(4)
    expect((await linha72(abril, 'Papel Sulfite 120g'))[4]).toBe('Sem estoque')
  })

  test('o mês CORRENTE não entra na média', async () => {
    // Ele ainda está andando, e entrar pela metade puxa a média para baixo,
    // empurrando a falta para longe.
    const papel = await criarMaterial('Papel Sulfite 120g', PAPEL, MIDIA_SULFITE)
    await semearEstoque(papel.id, 500)
    for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      await declararConsumo(papel.id, 20, dia)
    }
    await fixarEstoque(papel.id, 100)
    // Abril mal começou: 2 folhas. Se entrasse, a média cairia de 20 para 15,5.
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 2, data: '2026-04-01' })

    const abril = await abrirEdicao(4)
    expect((await linha72(abril, 'Papel Sulfite 120g'))[4]).toBe('SET 26')
  })
})
