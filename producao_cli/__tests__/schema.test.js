'use strict'

// Testa o formatador de contrato, a registry e a validacao local CONTRA OS
// SCHEMAS REAIS do server/, nao contra mocks. E de proposito: o valor do CLI e
// nao ter copia do contrato, e um teste com schema falso testaria justamente a
// copia. Em troca, estes testes quebram quando o contrato do PIT ou do RPCMTec
// muda, que e o alarme que se quer ter.

const { test } = require('node:test')
const assert = require('node:assert')

const esquema = require('../lib/schema')
const recursos = require('../lib/recursos')
const { RECURSOS, VALIDACAO, obter } = recursos

const pit = obter('meta').schema()
const rpcmtec = obter('edicao').schema()

// ---------------------------------------------------------------------------
// O contrato lido do Joi vivo
// ---------------------------------------------------------------------------

test('marca os obrigatorios e le os tipos do Joi vivo', () => {
  const campos = esquema.camposDe(pit.salvarExecucao)
  const porNome = Object.fromEntries(campos.map(c => [c.nome, c]))

  assert.strictEqual(porNome.meta_id.obrigatorio, true)
  assert.strictEqual(porNome.mes.obrigatorio, true)
  assert.strictEqual(porNome.mes.tipo, 'int 1..12')
  assert.strictEqual(porNome.quantidade.obrigatorio, false)
})

test('anota o .strict(), que recusa "1" onde se espera 1', () => {
  // Vale porque o corpo entra por JSON na linha de comando, onde e facil citar
  // um numero. Sem a anotacao, o agente so descobre pelo 400.
  const campos = esquema.camposDe(pit.salvarExecucao)
  const metaId = campos.find(c => c.nome === 'meta_id')
  assert.ok(metaId.notas.some(n => n.includes('strict')))
})

test('anota o .raw() das datas, que muda o dia gravado', () => {
  const campos = esquema.camposDe(pit.criar)
  const prazo = campos.find(c => c.nome === 'prazo')
  assert.ok(prazo.notas.some(n => n.includes('AAAA-MM-DD')))
})

test('valid() vira lista exaustiva com =', () => {
  // origem_id do Extra-PIT aceita so Manual (1) e Producao (3), e o banco cobra
  // o mesmo por CHECK.
  const campos = esquema.camposDe(pit.criarDemandaExtra)
  const origem = campos.find(c => c.nome === 'origem_id')
  assert.strictEqual(origem.tipo, 'int =1|3')
})

test('nao vaza o sentinela {override:true} do describe do Joi', () => {
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(!texto.includes('override'), `o sentinela vazou no contrato de ${chave}`)
  }
})

test('renderiza o pattern do numero da subsecao, que e rotulo e nao inteiro', () => {
  const campos = esquema.camposDe(rpcmtec.subsecaoParams)
  const numero = campos.find(c => c.nome === 'numero')
  assert.ok(numero.tipo.includes('\\d'), `esperava o padrão, obtive ${numero.tipo}`)
})

test('desce no aninhado: as linhas da subsecao sao array de array de texto', () => {
  const campos = esquema.camposDe(rpcmtec.gravarSubsecao)
  const linhas = campos.find(c => c.nome === 'linhas')
  assert.strictEqual(linhas.tipo, 'array<array<string>>')
})

test('anota o default, que e o que apaga a lista de militares por omissao', () => {
  const campos = esquema.camposDe(rpcmtec.criarCapacitacao)
  const militares = campos.find(c => c.nome === 'militares')
  assert.ok(militares.notas.some(n => n.includes('default')))
  assert.ok(militares.tipo.includes('único'), 'falta o .unique() da lista')
})

// ---------------------------------------------------------------------------
// A validacao local, nos DOIS modos do servidor
// ---------------------------------------------------------------------------

test('validarCorpo recusa corpo incompleto sem tocar a rede', () => {
  const r = esquema.validarCorpo(pit.criar, { ano: 2026 }, VALIDACAO.ESTRITO)
  assert.strictEqual(r.ok, false)
  const campos = r.erros.map(e => e.campo)
  assert.ok(campos.includes('numero_meta'))
  assert.ok(campos.includes('descricao'))
})

// COMPLETO quer dizer os CINCO obrigatórios do `criar`, e não os que bastavam
// quando este teste foi escrito. `item` e `unidade_id` entraram na 1.30.0, com
// as colunas `pit.meta_item.item` e `.unidade_id` NOT NULL: a meta se separou
// entre a identidade (o cabeçalho, hoje `pit.meta.nome`) e o item, e quem
// entrega é o item. O fixture ficou para trás e este teste passou a provar o
// contrário do nome dele.
test('validarCorpo aceita corpo completo', () => {
  const r = esquema.validarCorpo(pit.criar, {
    ano: 2026,
    numero_meta: 1,
    item: '1.1',
    descricao: 'Carta Topográfica 1:25.000. COTER, 24',
    quantidade_prevista: 24,
    unidade_id: 1
  }, VALIDACAO.ESTRITO)
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, [])
})

test('MODO ESTRITO: /api/metas RECUSA chave desconhecida, como a rota faz', () => {
  // O servidor monta /api/metas com utils/schema_validation_estrito.js: chave
  // fora do schema vira 400 com sugestao de nome. O CLI tem de reprovar o mesmo,
  // senao o --dry-run aprova e o envio real leva 400.
  const r = esquema.validarCorpo(pit.criar, {
    ano: 2026,
    numero_meta: 1,
    descricao: 'x',
    quantidade: 24
  }, VALIDACAO.ESTRITO)

  assert.strictEqual(r.ok, false)
  assert.ok(
    r.erros.some(e => /quantidade/.test(e.mensagem) && /not allowed/.test(e.mensagem)),
    'o erro precisa NOMEAR a chave sobrando'
  )
})

test('MODO STRIP: /api/rpcmtec DESCARTA a chave desconhecida, e o CLI acusa', () => {
  // O RPCMTec monta com utils/schema_validation.js, que usa stripUnknown: a
  // chave some sem erro nenhum, e o campo simplesmente nao grava. Os dois modos
  // precisam continuar DIFERENTES aqui; se convergirem, um dos dois grupos passa
  // a ser validado pela regra do outro.
  const r = esquema.validarCorpo(rpcmtec.criar, {
    ano: 2026,
    mes: 7,
    assinante: 'fulano'
  }, VALIDACAO.STRIP)

  assert.strictEqual(r.ok, true, 'no modo strip a chave desconhecida nao e erro')
  assert.deepStrictEqual(r.descartados, ['assinante'])
})

test('os dois modos discordam do MESMO corpo, e e por isso que sao dois', () => {
  const corpo = { ano: 2026, mes: 7, campo_que_nao_existe: 1 }
  const estrito = esquema.validarCorpo(rpcmtec.criar, corpo, VALIDACAO.ESTRITO)
  const strip = esquema.validarCorpo(rpcmtec.criar, corpo, VALIDACAO.STRIP)

  assert.strictEqual(estrito.ok, false)
  assert.strictEqual(strip.ok, true)
})

test('validarQuery cobra o filtro obrigatorio da grade', () => {
  const r = esquema.validarQuery(pit.gradeQuery, {})
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.campo === 'ano'))
})

test('explicarErro imprime o contrato so dos campos que falharam', () => {
  const r = esquema.validarCorpo(pit.criar, { ano: 2026 }, VALIDACAO.ESTRITO)
  const texto = esquema.explicarErro(pit.criar, r.erros)

  assert.ok(texto.includes('nada foi enviado'))
  assert.ok(texto.includes('descricao'), 'falta o campo que falhou')
  assert.ok(!texto.includes('quantidade_prevista'), 'trouxe campo que nao falhou')
})

// ---------------------------------------------------------------------------
// A registry, conferida contra o server/
// ---------------------------------------------------------------------------

test('todo recurso renderiza contrato sem quebrar, com rota e guarda', () => {
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(texto.length > 0, `${chave} devolveu contrato vazio`)
    assert.ok(texto.includes('/api/'), `${chave} nao imprimiu rota nenhuma`)
    // As guardas em maiusculas, como o mapa ACESSO de lib/schema.js as escreve.
    // OPERADOR entrou na 1.33.0, com os modulos Producao e Efetivo: sem ele, os
    // dois recursos de capacitacao passariam a nao imprimir guarda nenhuma e o
    // caso reprovaria por um motivo que nao e o dele.
    assert.ok(
      /exige (LOGIN|GERENTE|OPERADOR|ADMINISTRADOR)/.test(texto),
      `${chave} nao imprimiu a guarda de nenhuma operacao`
    )
  }
})

test('todo schema citado pela registry EXISTE no modulo do server/', () => {
  // O modo de falha que este teste tranca: um nome errado em `corpo`, `query` ou
  // `params` nao quebra nada na hora, e a validacao local vira uma peneira que
  // aprova tudo. O corpo torto so seria pego pelo 400 do servidor.
  for (const [chave, recurso] of Object.entries(RECURSOS)) {
    const modulo = recurso.schema()
    for (const [acao, op] of Object.entries(recurso.operacoes)) {
      for (const papel of ['query', 'params', 'corpo']) {
        if (!op[papel]) continue
        const alvo = modulo[op[papel]]
        assert.ok(
          alvo && typeof alvo.describe === 'function',
          `${chave} ${acao}: ${papel} aponta "${op[papel]}", que nao existe no schema`
        )
      }
    }
  }
})

test('toda rota com :param declara o schema de params', () => {
  // Sem isso o valor iria cru para a URL, e um "sete" em vez de 7 chegaria ao
  // servidor em vez de morrer aqui.
  for (const [chave, recurso] of Object.entries(RECURSOS)) {
    for (const [acao, op] of Object.entries(recurso.operacoes)) {
      const pars = recursos.paramsDaRota(op.caminho)
      if (!pars.length) continue
      assert.ok(op.params, `${chave} ${acao} tem :param na rota e nao declara params`)

      const declarados = esquema.camposDe(recurso.schema()[op.params]).map(c => c.nome)
      for (const p of pars) {
        assert.ok(
          declarados.includes(p),
          `${chave} ${acao}: a rota pede :${p}, que nao esta em ${op.params}`
        )
      }
    }
  }
})

test('todo --confirmar aponta um parametro que a rota realmente tem', () => {
  for (const [chave, recurso] of Object.entries(RECURSOS)) {
    for (const [acao, op] of Object.entries(recurso.operacoes)) {
      if (!op.confirmar) continue
      const flags = recursos.paramsDaRota(op.caminho).map(recursos.flagDoParam)
      assert.ok(
        flags.includes(op.confirmar.param),
        `${chave} ${acao}: --confirmar espera --${op.confirmar.param}, ` +
        `mas a rota so tem ${flags.join(', ') || 'nenhum parametro'}`
      )
      assert.ok(op.confirmar.motivo, `${chave} ${acao}: --confirmar sem motivo escrito`)
    }
  }
})

test('toda escrita irreversivel do PIT e do RPCMTec exige --confirmar', () => {
  // O guardrail mora na INTERFACE, e nao na skill que a chama. DELETE sempre
  // pede; fechar e reabrir pedem porque congelam e descongelam o documento
  // assinado; publicar pede porque muda a grade que os relatorios publicam.
  const ATOS = new Set(['fechar', 'reabrir', 'publicar'])
  for (const [chave, recurso] of Object.entries(RECURSOS)) {
    for (const [acao, op] of Object.entries(recurso.operacoes)) {
      if (op.metodo !== 'DELETE' && !ATOS.has(acao)) continue
      assert.ok(op.confirmar, `${chave} ${acao} muda o mundo e nao pede --confirmar`)
    }
  }
})

test('nenhuma rota leva prefixo de modulo: as duas sao de PLATAFORMA', () => {
  // Regressao. /api/metas e /api/rpcmtec ficam FORA de /acervo, /mapoteca e
  // /orcamento porque nenhum modulo e dono delas. Um prefixo aqui bateria em
  // 404, ou pior: /arquivo e /dashboard existem em mais de um lugar.
  for (const [chave, recurso] of Object.entries(RECURSOS)) {
    for (const [acao, op] of Object.entries(recurso.operacoes)) {
      assert.ok(
        /^\/(metas|rpcmtec)(\/|$)/.test(op.caminho),
        `${chave} ${acao} aponta para ${op.caminho}, fora de /metas e /rpcmtec`
      )
    }
  }
})

test('o modo de validacao de cada grupo bate com o middleware do server/', () => {
  // /api/metas usa schema_validation_estrito.js; /api/rpcmtec usa o padrao.
  for (const [chave, recurso] of Object.entries(RECURSOS)) {
    const rota = Object.values(recurso.operacoes)[0].caminho
    const esperado = rota.startsWith('/metas') ? VALIDACAO.ESTRITO : VALIDACAO.STRIP
    assert.strictEqual(
      recurso.validacao, esperado,
      `${chave} declara validacao ${recurso.validacao} para ${rota}`
    )
  }
})

test('a guarda declarada bate com a do fonte nas rotas que destoam', () => {
  // Afirmacoes que o CLI faz e que valem trancar, porque nao se deduzem do
  // vizinho: ler a meta e de qualquer pessoa logada; ler a EXECUCAO e do
  // gerente; LANCAR a execucao e do operador de PRODUCAO; alterar a META e do
  // administrador; e a EDICAO do RPCMTec, ate a leitura, e do administrador.
  //
  // A LINHA ENTRE LANCAR E ALTERAR e a decisao da 1.33.0, e e a que este caso
  // existe para trancar: a meta e o que a DSG PROMETEU (transcricao de documento
  // assinado), a execucao e o que a Divisao ENTREGOU.
  assert.strictEqual(RECURSOS.meta.operacoes.listar.acesso, 'login')
  assert.strictEqual(RECURSOS.meta.operacoes.criar.acesso, 'admin')
  assert.strictEqual(RECURSOS.execucao.operacoes.grade.acesso, 'gerente')
  assert.strictEqual(RECURSOS.execucao.operacoes.lancar.acesso, 'producao_operador')
  assert.strictEqual(RECURSOS.extra.operacoes.criar.acesso, 'producao_operador')
  for (const op of Object.values(RECURSOS.edicao.operacoes)) {
    assert.strictEqual(op.acesso, 'admin', 'a EDICAO do RPCMTec e do administrador')
  }
})

// A CAPACITACAO e a excecao dentro de /api/rpcmtec, e o CLI tem de dizer isso:
// ela e cadastro, e nao relatorio, e a permissao e por TIPO. Um recurso so, com
// o tipo numa flag, faria o `producao schema` mentir sobre quem entra em que.
test('as duas capacitacoes sao recursos distintos, com guardas distintas', () => {
  const m = RECURSOS['capacitacao-ministrada']
  const r = RECURSOS['capacitacao-recebida']

  assert.ok(m && r, 'faltou um dos dois recursos de capacitacao')

  // A VARIANCIA primeiro: os dois tem as seis operacoes. Um objeto vazio
  // satisfaria os lacos abaixo sem provar nada.
  const SEIS = ['listar', 'anos', 'obter', 'criar', 'atualizar', 'excluir']
  assert.deepStrictEqual(Object.keys(m.operacoes).sort(), [...SEIS].sort())
  assert.deepStrictEqual(Object.keys(r.operacoes).sort(), [...SEIS].sort())

  for (const op of Object.values(m.operacoes)) {
    assert.strictEqual(op.acesso, 'producao_operador')
    assert.ok(op.caminho.startsWith('/rpcmtec/capacitacao/ministrada'), op.caminho)
  }
  for (const op of Object.values(r.operacoes)) {
    assert.strictEqual(op.acesso, 'efetivo_operador')
    assert.ok(op.caminho.startsWith('/rpcmtec/capacitacao/recebida'), op.caminho)
  }

  // E `tipo_id` NAO esta mais no corpo: quem fixa o tipo e a rota, no servidor.
  const corpo = m.schema().criarCapacitacao.describe().keys
  assert.ok(!('tipo_id' in corpo), 'tipo_id voltou ao corpo da capacitacao')
})

test('o cliente de auth padrao e aceito pelo login vivo do SCA', () => {
  // Nao copia a lista: le o .valid() do login_schema.js do server/.
  const { clientesAceitos, CLIENTE_PADRAO } = require('../lib/config')
  const aceitos = clientesAceitos()

  assert.ok(aceitos.length > 0, 'nao consegui ler o login_schema do server/')
  assert.ok(aceitos.includes(CLIENTE_PADRAO), `${CLIENTE_PADRAO} nao esta em ${aceitos.join(', ')}`)
})

test('lerParams aceita a flag curta e a exige quando falta', () => {
  const op = RECURSOS.revisao.operacoes.alteracoes
  assert.deepStrictEqual(recursos.lerParams(op, { revisao: '3' }), { revisaoId: '3' })
  assert.deepStrictEqual(recursos.lerParams(op, { revisaoId: '3' }), { revisaoId: '3' })
  assert.throws(() => recursos.lerParams(op, {}), /--revisao/)
})

test('montarCaminho substitui os dois parametros da declaracao', () => {
  const op = RECURSOS.revisao.operacoes['remover-meta']
  assert.strictEqual(
    recursos.montarCaminho(op, { revisaoId: 3, metaId: 12 }),
    '/metas/revisoes/3/meta/12'
  )
})
