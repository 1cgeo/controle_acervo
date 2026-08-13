'use strict'

// Testa o formatador de contrato e a validacao local CONTRA OS SCHEMAS REAIS do
// server/, nao contra mocks. E de proposito: o valor do CLI e nao ter copia do
// contrato, e um teste com schema falso testaria justamente a copia.
// Em troca, estes testes quebram quando o schema da mapoteca muda, que e o
// alarme que se quer ter.

const { test } = require('node:test')
const assert = require('node:assert')

const esquema = require('../lib/schema')
const { RECURSOS, obter, carregarSchema } = require('../lib/recursos')

const models = carregarSchema()

test('marca os obrigatorios e le os tipos do Joi vivo', () => {
  const campos = esquema.camposDe(models.pedido)
  const porNome = Object.fromEntries(campos.map(c => [c.nome, c]))

  assert.strictEqual(porNome.data_pedido.obrigatorio, true)
  assert.strictEqual(porNome.cliente_id.obrigatorio, true)
  assert.strictEqual(porNome.situacao_pedido_id.obrigatorio, true)
  assert.strictEqual(porNome.observacao.obrigatorio, false)
})

test('valid() vira lista exaustiva com = e allow() vira lista aditiva com |', () => {
  const porNome = Object.fromEntries(
    esquema.camposDe(models.pedido).map(c => [c.nome, c])
  )
  // .valid(...Object.values(SITUACAO_PEDIDO)): so estes SEIS codes. Eram sete
  // ate 2026-08-08, quando o code 1 saiu do dominio; este teste le a constante
  // viva, entao foi ele que acusou.
  assert.strictEqual(porNome.situacao_pedido_id.tipo, 'int =2|3|4|5|6|7')
  // .allow(null, ''): alem do tipo base.
  assert.ok(porNome.ponto_contato.tipo.includes("|null|''"))
})

test('nao vaza o sentinela {override:true} do describe do Joi', () => {
  // Regressao: o Joi injeta {override:true} no allow do `is` de um when(), e sem
  // filtrar isso o agente leria `situacao_pedido_id={"override":true}|5` e
  // concluiria que ha um valor valido a mais.
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(!texto.includes('override'), `o sentinela vazou no contrato de ${chave}`)
  }
})

test('renderiza o Joi.when() de data_atendimento com a regra dos dois lados', () => {
  const campo = esquema.camposDe(models.pedido).find(c => c.nome === 'data_atendimento')

  assert.strictEqual(campo.tipo, 'condicional')
  const notas = campo.notas.join(' ')
  // 5 = CONCLUIDO. E a invariante que mais custa descobrir pelo 400.
  assert.ok(notas.includes('situacao_pedido_id=5'), 'falta a condicao')
  assert.ok(notas.includes('OBRIGATORIO'), 'falta dizer que ai o campo e exigido')
  assert.ok(notas.includes('senao'), 'falta o caso contrario')
})

test('renderiza o when() de motivo_cancelamento (situacao 6)', () => {
  const campo = esquema.camposDe(models.pedido).find(c => c.nome === 'motivo_cancelamento')
  const notas = campo.notas.join(' ')
  assert.ok(notas.includes('situacao_pedido_id=6'))
  assert.ok(notas.includes('OBRIGATORIO'))
})

test('mostra o min() de data que referencia outro campo, nao so "date"', () => {
  // data_atendimento >= data_pedido e uma regra entre campos: sem renderiza-la o
  // agente monta um corpo aparentemente correto e leva 400.
  const campo = esquema.camposDe(models.pedido).find(c => c.nome === 'data_atendimento')
  assert.ok(campo.notas.join(' ').includes('date>=data_pedido'))
})

test('anota o .raw() das datas, que muda o dia gravado', () => {
  const campo = esquema.camposDe(models.pedido).find(c => c.nome === 'data_pedido')
  assert.ok(campo.notas.some(n => n.includes('YYYY-MM-DD')))
})

test('reconhece guid, pattern e array com minimo', () => {
  const item = Object.fromEntries(
    esquema.camposDe(models.produtoPedido).map(c => [c.nome, c])
  )
  // Os dois sao anulaveis: o item aponta o acervo OU um produto avulso, e quem
  // garante o "exatamente um" e o .xor() do schema, nao o required.
  assert.strictEqual(item.uuid_versao.tipo, 'uuid |null')
  assert.strictEqual(item.nome_avulso.tipo, "string(<=255) |null|''")

  const loc = esquema.camposDe(models.pedidoLocalizador)[0]
  assert.ok(loc.tipo.includes('[A-Z0-9]{4}'))

  const ids = esquema.camposDe(models.pedidoIds)[0]
  assert.strictEqual(ids.tipo, 'array<int>, min 1')
})

test('mostra a description que o autor do schema escreveu', () => {
  // .description() e a unica prosa que o describe() alcanca; jogar fora seria
  // perder informacao de graca.
  //
  // ESTE E O UNICO TESTE DO ARQUIVO COM SCHEMA MONTADO AQUI, e a excecao esta
  // justificada. O unico `.description()` que o server tinha era o
  // `vida_util` de `models.plotter`, e o plotter saiu da mapoteca em
  // 2026-08-13 (ele e bem do modulo Equipamento). Hoje nenhum schema do server
  // usa `.description()`, entao nao ha schema real com que exercitar esta
  // leitura. A regra da casa que este arquivo declara no topo proibe copiar o
  // CONTRATO -- e o contrato e que nao pode ter copia. Aqui nao ha contrato
  // nenhum: o que se testa e o FORMATADOR, com tres linhas de Joi que nao
  // descrevem recurso algum. No dia em que um schema real voltar a usar
  // `.description()`, troque este por ele.
  const path = require('node:path')
  const raizServer = path.join(__dirname, '..', '..', 'server')
  const Joi = require(require.resolve('joi', { paths: [raizServer] }))
  const local = Joi.object().keys({
    vida_util: Joi.number().integer().description('Vida útil em meses')
  })
  const campo = esquema.camposDe(local).find(c => c.nome === 'vida_util')
  assert.ok(campo.notas.some(n => n.toLowerCase().includes('meses')))
})

test('nao ha .custom() de objeto na mapoteca, e o aviso so sai quando houver', () => {
  // O aviso de "contrato nao exaustivo" existe para o dia em que alguem escrever
  // um .custom() no nivel do objeto. Hoje nenhum schema tem, e emiti-lo a toa
  // ensinaria o agente a desconfiar de um contrato que esta completo.
  assert.strictEqual(esquema.customDe(models.pedido), false)
  assert.strictEqual(esquema.customDe(models.movimentoMaterial), false)
})

test('renderiza o switch do livro: qual lado cada tipo de movimento exige', () => {
  // A regra da FORMA mora num Joi.when({switch:[...]}), que chega ao describe
  // como UM when com varios ramos. Lido como um when comum, o campo saia como
  // "condicional" e nenhum caso, e a regra que mais custa (Consumo so da Secao)
  // sumia do contrato.
  const campos = Object.fromEntries(
    esquema.camposDe(models.movimentoMaterial).map(c => [c.nome, c])
  )

  const origem = campos.localizacao_origem_id
  assert.strictEqual(origem.tipo, 'condicional')
  const notasOrigem = origem.notas.join(' ')
  // 1 Entrada vem de fora: sem origem.
  assert.ok(notasOrigem.includes('tipo_movimento_id=1: any =null'), notasOrigem)
  // 3 Consumo: SO da Secao (code 1), e obrigatorio.
  assert.ok(/tipo_movimento_id=3: int =1 OBRIGATORIO/.test(notasOrigem), notasOrigem)

  const destino = campos.localizacao_destino_id
  // 3 Consumo vai para fora do controle: sem destino.
  assert.ok(destino.notas.join(' ').includes('tipo_movimento_id=3: any =null'))

  // O MOTIVO NAO E CONDICIONAL, e a ausencia e a prova: quem o exigia era a
  // Contagem (tipo 4), extinta em 2026-08-08. Um `.when` que voltasse ao motivo
  // faria o campo virar 'condicional' e cairia aqui.
  assert.strictEqual(campos.motivo.obrigatorio, false)
  assert.strictEqual(campos.motivo.tipo, "string |null|''")
  assert.deepStrictEqual(
    campos.motivo.notas, [],
    `o motivo voltou a depender do tipo: ${campos.motivo.notas.join(' | ')}`
  )
})

test('mostra a regra do par de lados do movimento', () => {
  // Ela nao e de um campo so, e nao aparece em `dependencies` do topo: e um
  // .assert. Era um par de regras ate 2026-08-08, quando o xor da Contagem saiu
  // com ela.
  const assercoes = esquema.assercoesDe(models.movimentoMaterial)
  assert.ok(
    assercoes.some(a =>
      a.includes('localizacao_destino_id') &&
      a.includes('ser diferente da origem') &&
      a.includes('tipo_movimento_id=2')
    ),
    `faltou a assercao da Transferencia: ${assercoes.join(' | ')}`
  )
})

test('o contrato do movimento imprime as regras entre campos', () => {
  const texto = esquema.contrato('movimento', RECURSOS.movimento)
  assert.ok(texto.includes('regras entre campos'))
  assert.ok(texto.includes('ser diferente da origem'))
  // Era DUAS ate 2026-08-08: o 'exatamente um de' era o xor da Contagem, e saiu
  // com ela. Sobrou a assercao da Transferencia, e ela basta para provar que a
  // secao ainda e impressa -- que e o que este caso guarda.
})

test('o contrato do estoque diz que ele e so leitura e onde se escreve', () => {
  // O saldo e derivado do livro desde 2026-08-08: anunciar POST, PUT e DELETE
  // que nao existem renderia 404 depois de o agente montar o corpo inteiro.
  const texto = esquema.contrato('estoque', RECURSOS.estoque)
  assert.ok(texto.includes('SO LEITURA'))
  assert.ok(texto.includes('mapoteca schema movimento'))
  assert.ok(!texto.includes('POST   /api/mapoteca/estoque_material'))
})

test('camposDataDe acha as datas, inclusive dentro de um when()', () => {
  const datas = esquema.camposDataDe(models.pedidoAtualizacao)
  assert.ok(datas.includes('data_pedido'))
  assert.ok(datas.includes('prazo'))
  // data_atendimento so vira date dentro do when: e justamente a que estraga o
  // dia gravado se for reenviada como timestamp ISO.
  assert.ok(datas.includes('data_atendimento'))
})

test('soData recorta o timestamp ISO que o servidor devolve', () => {
  assert.strictEqual(esquema.soData('2026-07-24T00:00:00.000Z'), '2026-07-24')
  assert.strictEqual(esquema.soData('2026-07-24'), '2026-07-24')
  assert.strictEqual(esquema.soData(null), null)
})

test('deriva os filtros de listagem do proprio schema de query', () => {
  // A tela do material e UMA: quem quer so o consumo filtra tipo_movimento_id 3,
  // em vez de existir uma segunda rota so para ele.
  const filtros = esquema.filtrosDe(obter('movimento').schema()).map(f => f.nome)
  assert.deepStrictEqual(
    filtros.sort(),
    ['data_fim', 'data_inicio', 'tipo_material_id', 'tipo_movimento_id']
  )
  // A listagem de pedidos e de UM ano so, e o servidor cai no ano corrente
  // quando a query nao traz `ano`. Sem declarar o filtro, o --ano do agente
  // virava aviso de "filtro ignorado" e a resposta vinha do ano errado. O
  // `palavra_chave` entrou em 2026-08-08 e chega aqui de graca, porque a
  // registry aponta o schema de query e nao uma lista escrita a mao.
  assert.deepStrictEqual(
    esquema.filtrosDe(obter('pedido').schema()).map(f => f.nome),
    ['ano', 'palavra_chave']
  )
})

test('validarCorpo recusa corpo incompleto sem tocar a rede', () => {
  const r = esquema.validarCorpo(models.pedido, { data_pedido: '2026-07-24' })
  assert.strictEqual(r.ok, false)
  const campos = r.erros.map(e => e.campo)
  assert.ok(campos.includes('cliente_id'))
  assert.ok(campos.includes('situacao_pedido_id'))
})

test('validarCorpo aceita corpo completo e aplica os defaults', () => {
  const r = esquema.validarCorpo(models.pedido, {
    data_pedido: '2026-07-24',
    cliente_id: 3,
    situacao_pedido_id: 3
  })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, [])
  assert.deepStrictEqual(r.valor.palavras_chave, [])
  assert.strictEqual(r.valor.previsto_pit, false)
})

test('exige data_atendimento quando a situacao e concluido', () => {
  const r = esquema.validarCorpo(models.pedido, {
    data_pedido: '2026-07-24',
    cliente_id: 3,
    situacao_pedido_id: 5
  })
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.campo === 'data_atendimento'))
})

test('recusa data_atendimento anterior a data_pedido', () => {
  const r = esquema.validarCorpo(models.pedido, {
    data_pedido: '2026-07-24',
    data_atendimento: '2026-07-01',
    cliente_id: 3,
    situacao_pedido_id: 5
  })
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.campo === 'data_atendimento'))
})

test('acusa campo com nome errado, que o servidor descartaria calado', () => {
  const r = esquema.validarCorpo(models.pedido, {
    data_pedido: '2026-07-24',
    cliente_id: 3,
    situacao_pedido_id: 3,
    prazo_entrega: '2026-08-30'
  })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, ['prazo_entrega'])
})

test('explicarErro imprime o contrato so dos campos que falharam', () => {
  const r = esquema.validarCorpo(models.produtoPedido, { quantidade: 5 })
  const texto = esquema.explicarErro(models.produtoPedido, r.erros)

  assert.ok(texto.includes('nada foi enviado'))
  assert.ok(texto.includes('uuid_versao'), 'falta o campo que falhou')
  assert.ok(texto.includes('uuid'), 'falta o tipo do campo que falhou')
  assert.ok(!texto.includes('producao_especifica'), 'trouxe campo que nao falhou')
})

test('todo recurso da registry renderiza contrato sem quebrar', () => {
  for (const chave of Object.keys(RECURSOS)) {
    const recurso = RECURSOS[chave]
    const texto = esquema.contrato(chave, recurso)
    assert.ok(texto.length > 0, `${chave} devolveu contrato vazio`)
    assert.ok(texto.includes('rotas'), `${chave} nao listou rotas`)
    if (recurso.somenteLeitura) {
      assert.ok(texto.includes('SO LEITURA'), `${chave} nao avisou que nao se escreve nele`)
      continue
    }
    // A forma do CRUD da mapoteca precisa aparecer em TODO recurso que escreve:
    // e o que impede o agente de tentar PUT /recurso/:id e levar 404.
    assert.ok(texto.includes('o id vai no CORPO'), `${chave} nao avisou do PUT`)
    assert.ok(texto.includes('sempre em LOTE'), `${chave} nao avisou do DELETE em lote`)
  }
})

test('todo recurso citado na registry existe no schema vivo do server', () => {
  // O CLI le o Joi vivo: recurso que aponte uma chave que o schema nao tem mais
  // (o `consumoMaterial`, ate 2026-08-08) so falharia no comando daquele
  // recurso, em producao, e nao aqui.
  for (const chave of Object.keys(RECURSOS)) {
    const recurso = RECURSOS[chave]
    const modulo = recurso.schema()
    if (recurso.somenteLeitura) {
      assert.strictEqual(
        modulo.criar, null,
        `${chave} e so leitura e nao devia ter schema de criacao`
      )
      continue
    }
    for (const papel of ['criar', 'atualizar', 'ids']) {
      assert.ok(
        modulo[papel] && typeof modulo[papel].describe === 'function',
        `${chave}: o schema de "${papel}" nao existe no mapoteca_schema.js`
      )
    }
  }
})

test('a chave de ids do delete bate com a que o schema exige', () => {
  // Se a registry e o schema divergirem, o DELETE monta um corpo que o servidor
  // recusa. Este teste amarra os dois.
  for (const chave of Object.keys(RECURSOS)) {
    const recurso = RECURSOS[chave]
    if (recurso.somenteLeitura) continue
    const doSchema = esquema.camposDe(recurso.schema().ids).map(c => c.nome)
    assert.deepStrictEqual(
      doSchema, [recurso.chaveIds],
      `${chave}: registry diz "${recurso.chaveIds}", schema diz "${doSchema.join(',')}"`
    )
  }
})
