'use strict'

// O CONSUMO DE MATERIAL: quem o declara, e quem NAO o declara.
//
// A REGRA, decidida pelo chefe em 2026-08-07: consumo e o que a Secao LANCA.
// A impressao NAO conta como consumo.
//
// O QUE ISSO DESFEZ, e por que. Entre 2026-08 e essa data o papel somava a
// impressao derivada da midia, e a tinta nao. A 7.2 de julho saiu com "consumo
// 802, estoque 64": os 802 vinham de 121 itens impressos, os 64 de uma contagem
// digitada, e nenhum consumo de papel fora lancado no ano inteiro. Uma coluna
// media o mundo, a outra media o cadastro, e a subtracao entre elas nao
// significava nada.
//
// EM 2026-08-08 A PONTE MORREU DE VEZ. `tipo_material.tipo_midia_id`, que ligava
// a impressao ao papel, saiu do banco, e com ela a coluna de conferencia
// `quantidade_impressa`. Produto impresso e rolo de papel sao coisas separadas:
// quanto de rolo uma folha gasta depende do tamanho da folha, e o sistema nunca
// soube isso. O numero de conferencia parecia apurado e nao era.
//
// A fonte unica e o que torna a conta fechavel: o gatilho do LIVRO baixa
// `estoque_material`, entao lancar o consumo move o estoque junto.
//
// O que este arquivo protege:
//
//  1. imprimir NAO gera consumo, por mais exemplares que saiam, e nao gera nem
//     numero de conferencia;
//  2. o consumo declarado aparece inteiro, sem nada somado por fora;
//  3. a 7.2 FUNDIDA lista papel e tinta JUNTOS, e nao existe mais 7.3;
//  4. o "Estoque atual" da 7.2 conta so Secao + Almoxarifado;
//  5. a previsao de falta atravessa a virada do ano.

const request = require('supertest')
const { getApp } = require('../helpers/app')
const { conn, cleanTestData } = require('../helpers/db')
const { generateAdminToken, ADMIN_UUID } = require('../helpers/auth')
const {
  TIPO_LOCALIZACAO: LOCAL,
  TIPO_MOVIMENTO_MATERIAL: MOV
} = require('../../utils/domain_constants')

let app

beforeAll(async () => {
  app = await getApp()
})

afterEach(async () => {
  await cleanTestData()
})

const admin = () => generateAdminToken()

// Sulfite 120g e a midia 6, e e a unica com impressao em producao. Ela continua
// existindo em `mapoteca.tipo_midia`, que FICA: `produto_pedido` a referencia
// por duas FKs, e o atendimento do pedido nao mudou. O que morreu foi o vinculo
// dela com o MATERIAL.
const MIDIA_SULFITE = 6
const MIDIA_TYVEK = 8

// SEM categoria e SEM midia: as duas colunas sairam em 2026-08-08. O nome e
// UNICO, e por isso cada caso usa o seu.
const criarMaterial = async (nome) =>
  conn.one(
    `INSERT INTO mapoteca.tipo_material (nome, ativo)
     VALUES ($1, TRUE) RETURNING id`,
    [nome]
  )

// Um pedido com um item avulso, que e o caminho mais curto ate a impressao:
// item de acervo exigiria produto, versao e arquivo.
const criarImpressao = async ({ midiaPedida, midiaFornecida = null, quantidade, data }) => {
  const cliente = await conn.one(
    `INSERT INTO mapoteca.cliente (nome, tipo_cliente_id) VALUES ('Cliente Teste', 1)
     RETURNING id`
  )
  const pedido = await conn.one(
    `INSERT INTO mapoteca.pedido
       (cliente_id, data_pedido, situacao_pedido_id, usuario_criacao_id, usuario_atualizacao_id)
     VALUES ($1, $2, 2, 1, 1) RETURNING id`,
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

// SQL CRU no livro: os casos abaixo montam CENARIO, e o que se mede sai da 7.2
// e do agregado mensal. Pelas rotas, cada semeadura custaria uma requisicao e o
// arquivo mediria o Joi em vez do relatorio.
const lancar = ({ material, tipo, quantidade, data, origem = null, destino = null, motivo = null }) =>
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

// Estoque na SECAO, pela porta de verdade: uma ENTRADA no livro.
const semearEstoque = (materialId, quantidade, localizacao = LOCAL.SECAO) =>
  lancar({
    material: materialId, tipo: MOV.ENTRADA, quantidade,
    data: '2026-01-02', destino: localizacao
  })

const declararConsumo = (materialId, quantidade, data) =>
  lancar({
    material: materialId, tipo: MOV.CONSUMO, quantidade, data, origem: LOCAL.SECAO
  })

// Deixa o disponivel no valor pedido, DEPOIS dos lancamentos: os consumos ja
// baixaram o estoque, e a previsao de falta se mede contra um saldo escolhido.
//
// SOBE POR ENTRADA, DESCE POR TRANSFERENCIA, e nenhum dos dois e consumo. A
// porta era a CONTAGEM ate 2026-08-08, quando ela foi extinta -- e o substituto
// obvio, um Consumo, seria justamente o errado aqui: ele entraria na media
// mensal que estes casos medem, e o cenario passaria a mentir sobre o proprio
// numero que prova.
//
// A transferencia vai para 'Aquisicao realizada' porque o DISPONIVEL da 7.2 e
// Secao + Almoxarifado: mandar para o Almoxarifado tiraria da Secao sem tirar do
// disponivel, e o saldo medido nao mudaria.
const fixarEstoque = async (materialId, quantidade) => {
  const linha = await conn.oneOrNone(
    `SELECT quantidade FROM mapoteca.estoque_material
      WHERE tipo_material_id = $1 AND localizacao_id = $2`,
    [materialId, LOCAL.SECAO]
  )
  const atual = linha ? Number(linha.quantidade) : 0
  const diferenca = quantidade - atual
  if (diferenca === 0) return

  await lancar({
    material: materialId,
    quantidade: Math.abs(diferenca),
    data: '2026-03-31',
    motivo: 'Ajuste do cenario de teste',
    ...(diferenca > 0
      ? { tipo: MOV.ENTRADA, destino: LOCAL.SECAO }
      : {
          tipo: MOV.TRANSFERENCIA,
          origem: LOCAL.SECAO,
          destino: LOCAL.AQUISICAO_REALIZADA
        })
  })
}

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
  test('imprimir na midia nao gera consumo nenhum, nem numero de conferencia', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g (impressao)')
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 40, data: '2026-03-10' })

    const linha = await consumoDoMes(papel.id, 3)
    // ZERO, com 40 exemplares impressos. Consumo e o que se declara, e ninguem
    // declarou: o zero e honesto e a Secao o conserta lancando.
    expect(Number(linha.quantidade)).toBe(0)
    // E NAO HA MAIS `quantidade_impressa`: ela dependia de `tipo_midia_id`, que
    // saiu do material em 2026-08-08. Sem a coluna nao ha como dizer qual papel
    // uma impressao gastou, e essa era justamente a afirmacao que a ponte fazia
    // e nao podia sustentar.
    expect(linha.quantidade_impressa).toBeUndefined()
  })

  test('o declarado aparece inteiro, sem a impressao somada por fora', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g (declarado)')
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 30, data: '2026-05-02' })
    // Lancar consumo EXIGE estoque na Secao: e gatilho de banco, e ele existe
    // para ninguem consumir o que nao foi transferido.
    await semearEstoque(papel.id, 50)
    await declararConsumo(papel.id, 7, '2026-05-20')

    const linha = await consumoDoMes(papel.id, 5)
    expect(Number(linha.quantidade)).toBe(7)
  })

  test('lancar consumo BAIXA o estoque, que e o que fecha a conta', async () => {
    // A razao de a fonte ser unica. Com o consumo derivado da impressao, o
    // numero andava e o estoque ficava parado, e as duas colunas da 7.2
    // deixavam de se subtrair.
    const papel = await criarMaterial('Papel Sulfite 120g (saldo)')
    await semearEstoque(papel.id, 50)
    await declararConsumo(papel.id, 12, '2026-05-20')

    const saldo = await conn.one(
      `SELECT quantidade FROM mapoteca.estoque_material
       WHERE tipo_material_id = $1 AND localizacao_id = $2`,
      [papel.id, LOCAL.SECAO]
    )
    expect(Number(saldo.quantidade)).toBe(38)
    expect(Number((await consumoDoMes(papel.id, 5)).quantidade)).toBe(12)
  })

  test('a midia fornecida tambem nao gera nada: a ponte morreu inteira', async () => {
    // Quem pediu tyvek e recebeu sulfite imprimiu em sulfite, e isso continua
    // sendo verdade do PEDIDO. So nao diz mais nada sobre o estoque de material.
    const tyvek = await criarMaterial('Tyvek (fornecida)')
    const sulfite = await criarMaterial('Papel Sulfite 120g (fornecida)')
    await criarImpressao({
      midiaPedida: MIDIA_TYVEK, midiaFornecida: MIDIA_SULFITE,
      quantidade: 15, data: '2026-04-08'
    })

    expect(Number((await consumoDoMes(sulfite.id, 4)).quantidade)).toBe(0)
    expect(Number((await consumoDoMes(tyvek.id, 4)).quantidade)).toBe(0)
  })

  test('consumo declarado em outro mes nao entra no mes', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g (mes)')
    await semearEstoque(papel.id, 50)
    await declararConsumo(papel.id, 25, '2026-06-15')

    expect(Number((await consumoDoMes(papel.id, 6)).quantidade)).toBe(25)
    expect(Number((await consumoDoMes(papel.id, 7)).quantidade)).toBe(0)
  })

  test('so o tipo CONSUMO conta: entrada e transferencia nao gastam', async () => {
    // Os tres moram na mesma tabela. Sem o filtro, o agregado somaria a
    // reposicao junto com o gasto e o grafico subiria justamente no mes em que o
    // material chegou.
    const papel = await criarMaterial('Papel Sulfite 120g (tipos)')
    await lancar({
      material: papel.id, tipo: MOV.ENTRADA, quantidade: 100,
      data: '2026-02-05', destino: LOCAL.ALMOXARIFADO
    })
    await lancar({
      material: papel.id, tipo: MOV.TRANSFERENCIA, quantidade: 60,
      data: '2026-02-06', origem: LOCAL.ALMOXARIFADO, destino: LOCAL.SECAO
    })
    await declararConsumo(papel.id, 8, '2026-02-10')

    expect(Number((await consumoDoMes(papel.id, 2)).quantidade)).toBe(8)
  })
})

// ---------------------------------------------------------------------------
// A 7.2 FUNDIDA
//
// Havia duas tabelas de insumo no RPCMTec, 7.2 (Papel) e 7.3 (Tintas), e o que
// as separava era `mapoteca.tipo_material.categoria_id` -- uma coluna cuja unica
// funcao era escolher o lado. As duas tinham as mesmas cinco colunas, a mesma
// grade e a mesma fonte. O chefe fundiu, a 7.3 sumiu e nada foi renumerado.
// ---------------------------------------------------------------------------

const abrirEdicao = async (mes, ano = 2026) => {
  const res = await request(app)
    .post('/api/rpcmtec')
    .set('Authorization', admin())
    .send({ ano, mes, assinante_uuid: ADMIN_UUID })
  expect(res.status).toBe(201)
  return res.body.dados.id
}

const bloco72 = async (edicaoId) => {
  const doc = await request(app)
    .get(`/api/rpcmtec/${edicaoId}/documento`)
    .set('Authorization', admin())
  return doc.body.dados.secoes.flatMap(s => s.subsecoes).find(b => b.numero === '7.2')
}

const linha72 = async (edicaoId, nome) => {
  const bloco = await bloco72(edicaoId)
  return bloco.linhas.find(l => l[0] === nome)
}

describe('A 7.2 fundida do RPCMTec', () => {
  test('nao existe mais a 7.3, e a 7.2 lista papel e tinta JUNTOS', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g')
    const tinta = await criarMaterial('Cartucho MK - T730')
    await semearEstoque(papel.id, 100)
    await semearEstoque(tinta.id, 8)

    const marco = await abrirEdicao(3)
    const doc = await request(app)
      .get(`/api/rpcmtec/${marco}/documento`)
      .set('Authorization', admin())

    const numeros = doc.body.dados.secoes.flatMap(s => s.subsecoes).map(b => b.numero)
    expect(numeros).toContain('7.2')
    expect(numeros).not.toContain('7.3')

    const insumos = (await bloco72(marco)).linhas.map(l => l[0])
    expect(insumos).toContain('Papel Sulfite 120g')
    expect(insumos).toContain('Cartucho MK - T730')
  })

  test('entra TODO material ativo, e o desativado fica de fora', async () => {
    // Ate 2026-08-08 o cabecote (categoria "Outro") nao saia em tabela nenhuma:
    // ele acaba do mesmo jeito que o cartucho, e ficar de fora por ser "peca"
    // era decisao que se tomava no cadastro e se descobria no relatorio.
    const cabecote = await criarMaterial('Cabeçote Universal')
    const aposentado = await criarMaterial('Cartucho de plotter aposentada')
    await semearEstoque(cabecote.id, 2)
    await conn.none(
      'UPDATE mapoteca.tipo_material SET ativo = FALSE WHERE id = $1',
      [aposentado.id]
    )

    const insumos = (await bloco72(await abrirEdicao(3))).linhas.map(l => l[0])
    expect(insumos).toContain('Cabeçote Universal')
    expect(insumos).not.toContain('Cartucho de plotter aposentada')
  })

  test('"Estoque atual" conta so Secao + Almoxarifado', async () => {
    // 'Aquisicao realizada' (3) e 'Saldo no empenho' (4) sao material comprado e
    // ainda nao entregue. Reporta-los como estoque faria a Divisao contar, no
    // papel, a resma que esta com o fornecedor.
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 30, LOCAL.SECAO)
    await semearEstoque(papel.id, 20, LOCAL.ALMOXARIFADO)
    await semearEstoque(papel.id, 500, LOCAL.AQUISICAO_REALIZADA)
    await semearEstoque(papel.id, 700, LOCAL.SALDO_NO_EMPENHO)

    const linha = await linha72(await abrirEdicao(3), 'Papel Sulfite 120g')
    expect(linha[1]).toBe('50')
  })

  test('a 7.2 traz o consumo DECLARADO, e ignora a impressao do mes', async () => {
    // Sao 64 exemplares impressos e 9 lancados: a coluna traz os 9.
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 100)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 64, data: '2026-03-18' })
    await declararConsumo(papel.id, 9, '2026-03-20')

    const linha = await linha72(await abrirEdicao(3), 'Papel Sulfite 120g')

    // Insumo | Estoque atual | Estoque mes anterior | Consumo no mes | Previsao
    //
    // O ESTOQUE JA VEM BAIXADO pelo gatilho do consumo: 100 semeados menos os 9
    // lancados. E o que a fonte unica compra -- as duas colunas se subtraem.
    expect(linha[1]).toBe('91')
    // NOVE, e nao 64 nem 73. Consumo e o declarado.
    expect(linha[3]).toBe('9')
    // O estoque do mes anterior continua sem fonte: fevereiro nao foi fechado.
    expect(linha[2]).toBe('-')
    // A PREVISAO SAI DOS MESMOS NOVE, e e a coluna que fecha a conta da linha.
    // Ate 2026-09-01 ela saia '-' aqui, porque o mes da edicao ficava FORA da
    // janela e o minimo era de tres meses com consumo: a tabela imprimia
    // "Consumo no mes: 9" e, na coluna seguinte, um traco. O chefe decidiu o
    // contrario em 2026-09-01 (commit aac3705), e o traco ao lado de um consumo
    // declarado deixou de ser resposta possivel.
    //
    // Media 9/mes sobre os 91 que restam: dez meses a partir de marco/2026.
    expect(linha[4]).toBe('JAN 27')
  })

  test('imprimir sem lancar deixa a 7.2 em ZERO, e isso e o certo', async () => {
    // O caso de julho de 2026, que motivou a decisao: 121 itens impressos e
    // nenhum lancamento. A coluna sai zerada, e o zero e o recado para a Secao
    // lancar, nao um numero para o relatorio inventar.
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 100)
    await criarImpressao({ midiaPedida: MIDIA_SULFITE, quantidade: 64, data: '2026-03-18' })

    const linha = await linha72(await abrirEdicao(3), 'Papel Sulfite 120g')
    expect(linha[1]).toBe('100')
    expect(linha[3]).toBe('0')
    // E A PREVISAO SAI EM TRACO, que desde 2026-09-01 tem uma causa so: nenhum
    // mes da janela teve consumo. Com o minimo em UM, este e o unico traco que
    // sobrou, e por isso ele mora aqui, ao lado do zero que o explica.
    expect(linha[4]).toBe('-')
  })
})

// ---------------------------------------------------------------------------
// A DATA da impressao, e por que ela virou rota
//
// REGRESSAO: a impressao herdava a data da CARGA, e nao a data em que foi
// impressa, entao a carga de julho empilhava ali a impressao de varios meses.
//
// A data continua importando depois de 2026-08-08, quando a ponte impressao ->
// consumo morreu de vez: ela e o que poe cada impressao no mes certo do
// HISTORICO DO PEDIDO, que e onde a informacao sempre valeu.
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
       VALUES ($1, '2026-03-01', 2, 1, 1) RETURNING id`,
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

  test('corrigir a data MOVE o registro de mês, sem apagá-lo', async () => {
    // E o defeito de producao, do lado de fora: a impressao de marco tinha sido
    // gravada com a data da carga, em julho.
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

    const res = await request(app)
      .put(`/api/mapoteca/impressao/${impressaoId}/data`)
      .set('Authorization', admin())
      .send({
        data_impressao: '2026-03-20T09:00:00.000Z',
        motivo: 'A data era a da carga, e o pedido foi atendido em março'
      })
    expect(res.status).toBe(200)

    // O registro CONTINUA sendo o mesmo: corrigir não é apagar e recriar.
    const gravado = await conn.one(
      'SELECT data_impressao FROM mapoteca.impressao_item WHERE id = $1',
      [impressaoId]
    )
    expect(new Date(gravado.data_impressao).toISOString())
      .toBe('2026-03-20T09:00:00.000Z')

    const { count } = await conn.one(
      'SELECT count(*)::int AS count FROM mapoteca.impressao_item WHERE produto_pedido_id = $1',
      [item.id]
    )
    expect(count).toBe(1)
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
// "Estoque mes anterior" e "Previsao de falta", as duas colunas que saiam '-'
//
// `mapoteca.estoque_material` guarda so o saldo de HOJE, atualizado no lugar: o
// saldo de maio nao existe mais la, e deriva-lo de "estoque atual mais consumo"
// ignoraria as ENTRADAS e erraria em silencio todo mes com reposicao.
//
// A resposta vem da EDICAO FECHADA do mes anterior, que congelou a propria 7.2
// no instante do fechamento.
// ---------------------------------------------------------------------------

describe('Estoque do mês anterior e previsão de falta', () => {
  const estrutura = require('../../rpcmtec/rpcmtec_estrutura')

  const fechar = async (id) => {
    for (const numero of estrutura.NUMEROS_DIGITADOS) {
      await request(app)
        .put(`/api/rpcmtec/${id}/subsecao/${numero}`)
        .set('Authorization', admin())
        .send({ sem_ocorrencia: true })
    }
    // `ciente_revisao`: desde a 1.36.0 o fechamento AVISA quando ha subsecao sem
    // conferencia e pede confirmacao (409).
    const res = await request(app)
      .post(`/api/rpcmtec/${id}/fechar`)
      .set('Authorization', admin())
      .send({ ciente_revisao: true })
    expect(res.status).toBe(200)
  }

  test('sem edição fechada no mês anterior, a coluna sai traço', async () => {
    // Inventar o número a partir do saldo de hoje daria uma coluna que parece
    // apurada e não é. O traço é a resposta honesta.
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 100)

    const l = await linha72(await abrirEdicao(4), 'Papel Sulfite 120g')

    expect(l[1]).toBe('100')
    expect(l[2]).toBe('-')
  })

  test('com o mês anterior FECHADO, traz o que aquela edição reportou', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 100)

    // Março fecha com 100 no estoque.
    await fechar(await abrirEdicao(3))

    // O saldo de HOJE muda: alguém consumiu 40 folhas depois do fechamento.
    await declararConsumo(papel.id, 40, '2026-04-05')

    const l = await linha72(await abrirEdicao(4), 'Papel Sulfite 120g')

    expect(l[1]).toBe('60')
    // O congelado de março, e não o saldo de hoje.
    expect(l[2]).toBe('100')
  })

  test('a TINTA congelada na 7.3 do mês anterior continua sendo achada', async () => {
    // O mes seguinte a fusao e o caso: a edicao fechada de marco ainda tem as
    // tintas gravadas na 7.3. Lendo so a 7.2, metade da tabela sairia '-'
    // exatamente uma vez, sem que nada tivesse acontecido com aqueles materiais.
    const tinta = await criarMaterial('Cartucho MK - T730')
    await semearEstoque(tinta.id, 12)

    const marco = await abrirEdicao(3)
    await fechar(marco)

    // A edicao de marco foi fechada com a 7.2 fundida. Aqui se simula o banco de
    // ANTES da fusao: a linha da tinta morava na 7.3, e a 7.2 nao a tinha.
    const gravadas = await conn.one(
      `SELECT linhas FROM rpcmtec.subsecao
        WHERE edicao_id = $1 AND numero = '7.2'`,
      [marco]
    )
    const daTinta = gravadas.linhas.filter(l => l[0] === 'Cartucho MK - T730')
    const oResto = gravadas.linhas.filter(l => l[0] !== 'Cartucho MK - T730')
    await conn.none(
      `UPDATE rpcmtec.subsecao SET linhas = $2::jsonb
        WHERE edicao_id = $1 AND numero = '7.2'`,
      [marco, JSON.stringify(oResto)]
    )
    await conn.none(
      `INSERT INTO rpcmtec.subsecao
         (edicao_id, numero, titulo, ordem, secao_titulo, origem_id,
          cabecalhos, linhas, usuario_cadastramento_uuid)
       SELECT edicao_id, '7.3', 'Estoque de Insumos de Impressão - Tintas',
              ordem + 1, secao_titulo, origem_id, cabecalhos, $2::jsonb,
              usuario_cadastramento_uuid
         FROM rpcmtec.subsecao WHERE edicao_id = $1 AND numero = '7.2'`,
      [marco, JSON.stringify(daTinta)]
    )

    const l = await linha72(await abrirEdicao(4), 'Cartucho MK - T730')
    expect(l[2]).toBe('12')
  })

  test('edição do mês anterior ABERTA não conta', async () => {
    // Só o fechamento congela. Uma edição aberta ainda vai mudar, e ler dela
    // daria um "mês anterior" que muda depois de publicado.
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 100)

    await abrirEdicao(3)
    expect((await linha72(await abrirEdicao(4), 'Papel Sulfite 120g'))[2]).toBe('-')
  })

  test('em janeiro, procura dezembro do ano anterior', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 70)

    await fechar(await abrirEdicao(12, 2025))

    expect((await linha72(await abrirEdicao(1), 'Papel Sulfite 120g'))[2]).toBe('70')
  })

  test('com DOIS meses de consumo já projeta: o mínimo é UM', async () => {
    // O mínimo era TRÊS, e este caso provava a recusa. Ele passou a UM em
    // 2026-09-01 (commit aac3705), por decisão do chefe: o livro
    // `mapoteca.movimento_material` nasceu em julho/2026, e com o mínimo em três
    // a coluna ficaria em traço até a edição de novembro, esperando um histórico
    // que ninguém tinha enquanto o cartucho acabava na prateleira.
    //
    // O que se perde é deliberado, e está escrito na constante: um mês de acaso
    // agora vira data com cara de apurada. A defesa deixou de ser a régua e
    // passou a ser a tabela, que imprime a previsão na MESMA LINHA do consumo
    // que a gerou.
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 100)
    await declararConsumo(papel.id, 10, '2026-01-10')
    await declararConsumo(papel.id, 10, '2026-02-10')

    // Média 10/mês sobre os 80 que restam: oito meses a partir de abril/2026.
    expect((await linha72(await abrirEdicao(4), 'Papel Sulfite 120g'))[4]).toBe('DEZ 26')
  })

  test('com três meses fechados, projeta o mês da falta', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 500)
    for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      await declararConsumo(papel.id, 20, dia)
    }
    await fixarEstoque(papel.id, 100)

    // Média 20/mês, 100 em estoque: cinco meses a partir de abril = setembro.
    expect((await linha72(await abrirEdicao(4), 'Papel Sulfite 120g'))[4]).toBe('SET 26')
  })

  test('estoque zerado com consumo acontecendo sai como "Sem estoque"', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 500)
    for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      await declararConsumo(papel.id, 20, dia)
    }
    await fixarEstoque(papel.id, 0)

    expect((await linha72(await abrirEdicao(4), 'Papel Sulfite 120g'))[4]).toBe('Sem estoque')
  })

  test('o MÊS DA EDIÇÃO entra na média', async () => {
    // Ele ficava de FORA até 2026-09-01, sob o argumento de que o mês corrente
    // ainda está andando e entraria pela metade. O argumento não vale aqui, e o
    // commit aac3705 o desfez: o RPCMTec de abril se escreve em maio, com abril
    // fechado, e o mês da edição é sempre um mês inteiro. O efeito do recorte
    // antigo era a tabela imprimir o consumo do mês numa coluna e a projeção da
    // coluna seguinte ignorar justamente esse número.
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 500)
    for (const dia of ['2026-01-10', '2026-02-10', '2026-03-10']) {
      await declararConsumo(papel.id, 20, dia)
    }
    await fixarEstoque(papel.id, 102)
    // Abril foi de 2 folhas, e ele CONTA: a média cai de 20 para 15,5.
    await declararConsumo(papel.id, 2, '2026-04-01')

    // 100 em estoque (102 menos as 2 de abril) sobre média 15,5: seis meses a
    // partir de abril/2026. Pelo recorte antigo esta linha saía 'SET 26', um mês
    // depois, e a diferença é exatamente o mês da edição.
    expect((await linha72(await abrirEdicao(4), 'Papel Sulfite 120g'))[4]).toBe('OUT 26')
  })

  // -------------------------------------------------------------------------
  // A JANELA DE DOZE MESES, e o defeito de calendário que ela conserta
  //
  // A projeção olhava o ANO CIVIL até o mês do corte, e exigia três meses
  // fechados. Em janeiro a série ZERAVA, e a coluna só voltava a existir em
  // abril: a previsão de falta sumia de janeiro a março, TODO ANO, sem que nada
  // tivesse mudado no consumo. A janela deslizante atravessa a virada.
  // -------------------------------------------------------------------------
  test('em fevereiro, a previsão sai do ritmo do ANO PASSADO', async () => {
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 500)
    // Três meses de 2025, e nenhum mês fechado de 2026 com consumo.
    for (const dia of ['2025-09-10', '2025-10-10', '2025-11-10']) {
      await declararConsumo(papel.id, 20, dia)
    }
    await fixarEstoque(papel.id, 100)

    // Média 20/mês, 100 em estoque: cinco meses a partir de fevereiro = julho.
    // Pelo recorte antigo, esta coluna sairia '-'.
    expect((await linha72(await abrirEdicao(2), 'Papel Sulfite 120g'))[4]).toBe('JUL 26')
  })

  test('o que caiu FORA dos doze meses não entra na média', async () => {
    // A janela é DESLIZANTE, e não "tudo o que já houve". Para a edição de
    // fevereiro/2026 ela vai de MARÇO/2025 a fevereiro/2026: são doze meses que
    // TERMINAM no mês da edição, e fevereiro/2025 fica um mês para trás.
    //
    // O DESENHO DO CASO MUDOU EM 2026-09-01. Com o mínimo de três meses ele
    // provava a borda pela AUSÊNCIA de projeção: três meses com consumo, um caía
    // fora, sobravam dois e a coluna saía '-'. Com o mínimo em UM (commit
    // aac3705) essa prova morreu -- dois meses projetam --, então a borda passa a
    // se provar pela MÉDIA: o mês de fora é um OUTLIER de 100, e ele mudaria a
    // data se entrasse.
    const papel = await criarMaterial('Papel Sulfite 120g')
    await semearEstoque(papel.id, 500)
    // Fevereiro/2025 é o mês imediatamente ANTERIOR ao começo da janela.
    await declararConsumo(papel.id, 100, '2025-02-10')
    for (const dia of ['2025-11-10', '2025-12-10']) {
      await declararConsumo(papel.id, 20, dia)
    }
    await fixarEstoque(papel.id, 100)

    // A MESMA edição nas duas leituras: ela está ABERTA, e o calculado de
    // edição aberta sai do banco a cada requisição. Abrir de novo daria 409.
    const fevereiro = await abrirEdicao(2)
    // Média 20/mês sobre os dois meses de dentro: cinco meses a partir de
    // fevereiro/2026. Se a borda escorregasse um mês para trás, o 100 de
    // fevereiro/2025 entraria, a média subiria para 46,6 e esta linha viraria
    // 'ABR 26'.
    expect((await linha72(fevereiro, 'Papel Sulfite 120g'))[4]).toBe('JUL 26')

    // A OUTRA BORDA, com o mesmo outlier: março/2025 é o PRIMEIRO mês que conta,
    // e um mês depois do que acabou de ficar de fora. Agora ele entra na média,
    // e a data anda.
    await declararConsumo(papel.id, 100, '2025-03-10')
    await fixarEstoque(papel.id, 100)
    expect((await linha72(fevereiro, 'Papel Sulfite 120g'))[4]).toBe('ABR 26')
  })
})
