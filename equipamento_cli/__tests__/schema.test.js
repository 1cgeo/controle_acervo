'use strict'

// O CONTRATO VEM DO JOI VIVO, e nao de uma lista escrita a mao.
//
// Testes com node:test (embutido no Node), nao jest: o CLI nao instala
// node_modules proprio, e depender do jest do server/ criaria o acoplamento que
// a dependencia zero existe para evitar.
//   Rodar: cd equipamento_cli && node --test
//
// Estes casos rodam contra os schemas REAIS de
// server/src/equipamento/equipamento_schema.js. E de proposito: o valor do CLI e
// nao ter copia do contrato, e um teste com schema falso testaria justamente a
// copia. Em troca, eles quebram quando o schema do modulo muda, que e o alarme
// que se quer ter.
//
// O caso que FECHA a questao e o ultimo bloco: ele MUDA o schema em memoria e
// exige que o CLI acompanhe. Se houvesse uma lista de campos escrita a mao em
// algum canto, ela nao acompanharia.

const { test } = require('node:test')
const assert = require('node:assert')

const esquema = require('../lib/schema')
const corpoLib = require('../lib/corpo')
const { obter, RECURSOS, carregarSchema, DOMINIOS, CAMINHOS } = require('../lib/recursos')

const models = carregarSchema()
const bem = obter('bem').schema()
const manutencao = obter('manutencao').schema()
const transferencia = obter('transferencia').schema()

const porNome = (schemaJoi) =>
  Object.fromEntries(esquema.camposDe(schemaJoi).map(c => [c.nome, c]))

// ---------------------------------------------------------------------------
// A leitura do describe()
// ---------------------------------------------------------------------------

test('le os obrigatorios e os tipos do Joi vivo', () => {
  const campos = porNome(bem.criar)

  assert.strictEqual(campos.nr_patrimonio.obrigatorio, true)
  assert.strictEqual(campos.nr_patrimonio.tipo, 'string(<=30)')
  assert.strictEqual(campos.modelo.obrigatorio, true)
  assert.strictEqual(campos.classe_id.obrigatorio, true)
  // Nulo NAO e zero: nulo quer dizer "vale a vida util do TIPO".
  assert.strictEqual(campos.vida_util_meses.obrigatorio, false)
  assert.strictEqual(campos.vida_util_meses.tipo, "int>0 |null")
})

test('anota o .trim() do patrimonio, que e a UNIQUE da tabela', () => {
  // 17 das 105 celulas de patrimonio da planilha sao texto, e algumas terminam
  // em '\n'. Sem o trim, dois cadastros do mesmo bem conviveriam.
  const campos = porNome(bem.criar)
  assert.ok(campos.nr_patrimonio.notas.some(n => n.includes('espaços das pontas')))
})

test("anota o .raw() das datas, que decide o DIA que o banco grava", () => {
  // Sem `.raw()` o Joi converte a string em Date de meia-noite UTC, e a coluna
  // DATE em UTC-3 guarda o dia ANTERIOR.
  const campos = porNome(bem.criar)
  assert.ok(campos.data_entrada_carga.notas.some(n => n.includes('AAAA-MM-DD')))
})

test('renderiza a referencia de data_fim >= data_inicio, e a mensagem em portugues', () => {
  // Sem renderizar a REFERENCIA, o agente monta um corpo aparentemente correto e
  // leva 400. E a mensagem em portugues e a regra em prosa, que o describe() so
  // enxerga porque o schema a escreveu com .messages().
  const campos = porNome(manutencao.criar)
  assert.strictEqual(campos.data_fim.tipo, 'date>=data_inicio |null')
  assert.ok(
    campos.data_fim.notas.some(n => n.includes('igual ou posterior')),
    'a mensagem do schema nao chegou ao contrato'
  )
})

test('as tres colunas de dinheiro saem com a precisao e o sinal do CHECK', () => {
  const campos = porNome(manutencao.criar)
  for (const nome of ['valor', 'valor_orcado', 'valor_pdr']) {
    assert.strictEqual(campos[nome].tipo, 'number>0 |null', nome)
    assert.ok(campos[nome].notas.some(n => n.includes('2 casas decimais')), nome)
  }
})

test('nao vaza o sentinela {override:true} do describe do Joi', () => {
  // Regressao herdada dos CLIs irmaos: o Joi injeta {override:true} no allow de
  // um .valid(), e sem filtrar isso o agente le um valor valido a mais.
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(!texto.includes('override'), `o sentinela vazou no contrato de ${chave}`)
  }
})

test('marca *_id como FK, que e o que manda o agente ao dominio antes de chutar', () => {
  const campos = porNome(bem.criar)
  assert.ok(campos.classe_id.notas.includes('FK'))
  assert.ok(campos.secao_detentora_id.notas.includes('FK'))
})

// ---------------------------------------------------------------------------
// Os filtros, tambem do Joi
// ---------------------------------------------------------------------------

test('os filtros da lista de bens saem do proprio listarQuery', () => {
  assert.deepStrictEqual(
    esquema.filtrosDe(bem).map(f => f.nome).sort(),
    ['ativo', 'secao_detentora_id', 'situacao_id', 'tipo_id']
  )
})

test('os quatro historicos compartilham o MESMO schema de query', () => {
  // `equipamento_id` e `aberta`, e nada mais: um filtro anunciado que a rota nao
  // conhece vira query ignorada, e a lista volta inteira parecendo filtrada.
  for (const chave of ['indisponibilidade', 'afastamento', 'manutencao', 'transferencia']) {
    assert.deepStrictEqual(
      esquema.filtrosDe(obter(chave).schema()).map(f => f.nome).sort(),
      ['aberta', 'equipamento_id'],
      chave
    )
  }
})

test('o tipo de equipamento NAO tem filtro, e a ausencia e a regra', () => {
  // A lista inteira cabe numa resposta (nove tipos semeados), e o servidor nunca
  // expos filtro nenhum: anunciar um mandaria o agente a uma query ignorada.
  assert.deepStrictEqual(esquema.filtrosDe(obter('tipo').schema()), [])
})

// ---------------------------------------------------------------------------
// A validacao local
// ---------------------------------------------------------------------------

test('validarCorpo recusa corpo incompleto sem tocar a rede', () => {
  const r = esquema.validarCorpo(bem.criar, { modelo: 'TOPCON CTS-3007' })
  assert.strictEqual(r.ok, false)
  const campos = r.erros.map(e => e.campo)
  for (const esperado of ['nr_patrimonio', 'classe_id', 'tipo_id', 'secao_detentora_id']) {
    assert.ok(campos.includes(esperado), `faltou acusar ${esperado}`)
  }
})

test('RECUSA campo com nome errado, como o servidor ESTRITO do equipamento faz', () => {
  // As rotas deste modulo recebem o validador estrito: chave desconhecida vira
  // 400 com sugestao do nome mais parecido, e nao some calada. Ligar
  // stripUnknown aqui faria o --dry-run aprovar o que o envio real recusa.
  const r = esquema.validarCorpo(bem.criar, {
    nr_patrimonio: '104820700014462',
    classe_id: 6,
    tipo_id: 1,
    modelo: 'TOPCON CTS-3007',
    secao_detentora_id: 1,
    situacao_id: 4
  })
  assert.strictEqual(r.ok, false, 'o servidor recusaria: a validacao local tambem tem de recusar')
  assert.ok(
    r.erros.some(e => e.campo === 'situacao_id'),
    'o erro tem de NOMEAR a chave desconhecida'
  )
  assert.deepStrictEqual(r.descartados, [], 'chave desconhecida e ERRO, nao descarte')
})

test('a situacao nao e campo de corpo em lugar nenhum: ela e DERIVADA', () => {
  // `equipamento.situacao_em(dia)` responde pela situacao do bem. Um
  // `situacao_id` aceito no corpo do BEM seria a segunda fonte da mesma verdade.
  assert.ok(!('situacao_id' in models.equipamentoCriar.describe().keys))
  assert.ok(!('situacao_id' in models.equipamentoAtualizar.describe().keys))
  // Na TRANSFERENCIA ele existe e e outra coisa: o fluxo da movimentacao.
  assert.ok('situacao_id' in models.transferenciaCriar.describe().keys)
})

test('o corpo NAO valida com stripUnknown, porque o servidor e estrito', () => {
  assert.strictEqual(esquema.OPCOES_CORPO.stripUnknown, undefined)
  assert.strictEqual(esquema.OPCOES_CORPO.abortEarly, false)
})

test('explicarErro imprime o contrato so dos campos que falharam', () => {
  const r = esquema.validarCorpo(bem.criar, { modelo: 'TOPCON' })
  const texto = esquema.explicarErro(bem.criar, r.erros)

  assert.ok(texto.includes('nada foi enviado'))
  assert.ok(texto.includes('nr_patrimonio'), 'faltou o campo que falhou')
  assert.ok(texto.includes('string(<=30)'), 'faltou o tipo do campo que falhou')
  assert.ok(!texto.includes('observacao'), 'trouxe campo que nao falhou')
})

// ---------------------------------------------------------------------------
// A registry: o que NAO esta no schema
// ---------------------------------------------------------------------------

test('todo recurso renderiza contrato, com rotas e comandos', () => {
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(texto.length > 0, `${chave} devolveu contrato vazio`)
    assert.ok(texto.includes('rotas'), `${chave} nao listou rotas`)
    assert.ok(texto.includes('comandos'), `${chave} nao listou comandos`)
  }
})

test('todo recurso leva o prefixo /equipamento', () => {
  // Rota sem prefixo bate em 404, ou pior: /relatorio existe TAMBEM no acervo, e
  // sem o prefixo o CLI acertaria a rota errada e responderia com dados de outro
  // modulo.
  for (const [chave, recurso] of Object.entries(RECURSOS)) {
    assert.ok(
      recurso.caminho === '/equipamento' || recurso.caminho.startsWith('/equipamento/'),
      `${chave} aponta para ${recurso.caminho}, sem o prefixo /equipamento`
    )
  }
  for (const caminho of Object.values(CAMINHOS)) {
    assert.ok(caminho.startsWith('/equipamento/'), caminho)
  }
})

test('a transferencia declara que NAO tem data de fim, e o contrato diz o que fazer', () => {
  // A ausencia e a regra: transferencia nao dura, ela se resolve. Um `fechar`
  // inventado aqui mandaria um PUT com um campo que a tabela nao tem.
  assert.strictEqual(RECURSOS.transferencia.campoFim, null)
  const texto = esquema.contrato('transferencia', RECURSOS.transferencia)
  assert.ok(!/\bfechar\b/.test(texto.split('comandos')[1] || ''), 'anunciou um fechar que nao existe')
  assert.ok(texto.includes('lancar'), 'o verbo de criacao da transferencia e lancar')
})

test('o PUT do modulo e por id na URL, e o DELETE e um por vez', () => {
  // A forma do CRUD daqui NAO e a da mapoteca (id no corpo, array de ids no
  // delete): um CLI que assumisse aquela forma levaria 404 nos dois.
  const texto = esquema.contrato('bem', RECURSOS.bem)
  assert.ok(texto.includes('PUT    /api/equipamento/:id'))
  assert.ok(texto.includes('DELETE /api/equipamento/:id'))
})

test('o contrato do PUT AVISA dos campos com default, com o valor de cada um', () => {
  const texto = esquema.contrato('transferencia', RECURSOS.transferencia)
  assert.ok(texto.includes('ATENÇÃO, campos com default'))
  assert.ok(texto.includes('transferido_siafi=false'))
  assert.ok(texto.includes('apropriado_siafi=false'))
})

test('o contrato do PUT diz o que MUDA em relacao ao POST, e nao "os mesmos"', () => {
  // A diferenca entre POST e PUT nos historicos nao e a LISTA de campos, e sim a
  // obrigatoriedade de `equipamento_id`. Renderizar so "os mesmos do POST"
  // esconderia exatamente isso.
  const texto = esquema.contrato('indisponibilidade', RECURSOS.indisponibilidade)
  assert.ok(texto.includes('equipamento_id (deixa de ser obrigatório)'))
})

test('os cinco dominios sao os do servidor, e o tipo NAO e um deles', () => {
  assert.deepStrictEqual(DOMINIOS, [
    'classe_suprimento', 'secao_detentora', 'situacao',
    'situacao_transferencia', 'tipo_transferencia'
  ])
  // `tipo_equipamento` e CADASTRO, com id SERIAL: id de cadastro nunca vira
  // constante nem dominio.
  assert.ok(!DOMINIOS.includes('tipo_equipamento'))
  assert.ok(!DOMINIOS.includes('tipo'))
})

// ---------------------------------------------------------------------------
// O CASO QUE FECHA A QUESTAO: mudar o schema e ver o CLI acompanhar
// ---------------------------------------------------------------------------

/** Troca uma chave do modulo de schema VIVO e devolve tudo ao fim. */
function comSchema (chave, novo, fn) {
  const original = models[chave]
  models[chave] = novo
  try {
    return fn()
  } finally {
    models[chave] = original
  }
}

test('campo NOVO no schema vira flag aceita, sem tocar no CLI', () => {
  // A chave do teste: nao existe `require('joi')` aqui. O tipo do campo novo e
  // EMPRESTADO de outro campo do proprio schema vivo, o que mantem a dependencia
  // zero e ainda prova que a leitura e do describe().
  const tipoTexto = models.tipoCriar.extract('nome')
  const comCampoNovo = models.equipamentoCriar.append({ cor_do_case: tipoTexto })

  comSchema('equipamentoCriar', comCampoNovo, () => {
    const modulo = obter('bem').schema()

    // 1. Ele aparece no contrato impresso.
    assert.ok(esquema.camposDe(modulo.criar).some(c => c.nome === 'cor_do_case'))
    assert.ok(esquema.contrato('bem', RECURSOS.bem).includes('cor_do_case'))

    // 2. E, mais importante, `--cor_do_case` passa a ser aceita no corpo, sem
    //    nenhuma lista de campos ter sido editada em lugar nenhum.
    const { corpo, avisos } = corpoLib.montarCorpo(modulo.criar, { cor_do_case: 'laranja' })
    assert.strictEqual(corpo.cor_do_case, 'laranja')
    assert.deepStrictEqual(avisos, [], 'a flag do campo novo foi tratada como desconhecida')
  })
})

test('trocado o schema INTEIRO, o CLI passa a falar do schema novo', () => {
  // O caso mais duro: um schema que nao tem NENHUM campo do equipamento. Se
  // existisse uma lista de campos escrita a mao em qualquer canto do CLI, ela
  // sobreviveria a esta troca -- e e exatamente isso que se prova nao existir.
  //
  // O Joi vem de onde o proprio schema do server o pega. Nao e dependencia do
  // CLI: e o mesmo modulo que `equipamento_schema.js` carrega, resolvido a
  // partir do server/.
  const Joi = require(require.resolve('joi', { paths: [require('../lib/config').RAIZ_SERVER] }))
  const inventado = Joi.object().keys({
    cor_do_case: Joi.string().max(20).required(),
    lacrado: Joi.boolean().default(true)
  })

  comSchema('equipamentoCriar', inventado, () => {
    const modulo = obter('bem').schema()

    assert.deepStrictEqual(
      esquema.camposDe(modulo.criar).map(c => c.nome),
      ['cor_do_case', 'lacrado']
    )
    assert.deepStrictEqual(
      esquema.camposComDefault(modulo.criar),
      [{ nome: 'lacrado', valor: true }]
    )

    // E `--nr_patrimonio`, que e campo de verdade do schema de verdade, passa a
    // ser flag DESCONHECIDA. Sem este aviso ela sumiria sem gravar nada, que e o
    // modo de falha registrado como "a ferramenta disse OK e nada foi gravado".
    const { corpo, avisos } = corpoLib.montarCorpo(modulo.criar, {
      nr_patrimonio: '104820700014462',
      cor_do_case: 'laranja'
    })
    assert.deepStrictEqual(corpo, { cor_do_case: 'laranja' })
    assert.ok(avisos.some(a => a.includes('nr_patrimonio')))
    assert.ok(avisos.some(a => a.includes('Campos aceitos: cor_do_case, lacrado')))
  })
})

test('filtro NOVO no schema de query vira filtro aceito na listagem', () => {
  const tipoTexto = models.tipoCriar.extract('nome')
  const comFiltroNovo = models.listarQuery.append({ modelo: tipoTexto })

  comSchema('listarQuery', comFiltroNovo, () => {
    const modulo = obter('bem').schema()
    assert.ok(esquema.filtrosDe(modulo).some(f => f.nome === 'modelo'))

    const { params, avisos } = corpoLib.montarFiltros(modulo, { modelo: 'HP' })
    assert.strictEqual(params.modelo, 'HP')
    assert.deepStrictEqual(avisos, [])
  })
})

test('obrigatoriedade que MUDA no schema muda o contrato impresso', () => {
  const semModeloObrigatorio = models.equipamentoCriar.fork(['modelo'], s => s.optional())

  comSchema('equipamentoCriar', semModeloObrigatorio, () => {
    const campos = porNome(obter('bem').schema().criar)
    assert.strictEqual(campos.modelo.obrigatorio, false)
    // E a validacao local acompanha: o corpo sem modelo passa a ser aceito.
    const r = esquema.validarCorpo(obter('bem').schema().criar, {
      nr_patrimonio: '1', classe_id: 6, tipo_id: 1, secao_detentora_id: 1
    })
    assert.strictEqual(r.ok, true)
  })

  // E volta ao que era: o schema real continua cobrando o modelo.
  assert.strictEqual(porNome(obter('bem').schema().criar).modelo.obrigatorio, true)
})

test('dependencia declarada no schema apareceria no contrato sem tocar no CLI', () => {
  // O equipamento nao usa `.or()`/`.xor()` hoje, e imprimir isso continua
  // valendo: o dia em que uma entrar, ela aparece sozinha.
  assert.deepStrictEqual(esquema.dependenciasDe(transferencia.criar), [])

  const comOu = models.transferenciaCriar.or('om', 'documento_solicitacao')
  comSchema('transferenciaCriar', comOu, () => {
    const deps = esquema.dependenciasDe(obter('transferencia').schema().criar)
    assert.strictEqual(deps.length, 1)
    assert.ok(deps[0].includes('pelo menos um de'))
    assert.ok(deps[0].includes('om'))
  })
})

test('o cliente de auth padrao e aceito pelo login vivo do SCA', () => {
  // Nao copia a lista: le o .valid() do login_schema.js do server/.
  const { clientesAceitos, CLIENTE_PADRAO } = require('../lib/config')
  const aceitos = clientesAceitos()

  assert.ok(aceitos.length > 0, 'nao consegui ler o login_schema do server/')
  assert.ok(aceitos.includes(CLIENTE_PADRAO), `${CLIENTE_PADRAO} nao esta em ${aceitos.join(', ')}`)
})
