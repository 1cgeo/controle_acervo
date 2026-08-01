// Path: __tests__\schema.test.js
'use strict'

// Testa o formatador de contrato e a validacao local CONTRA OS SCHEMAS REAIS do
// server/, nao contra mocks. E de proposito: o valor do CLI e nao ter copia do
// contrato, e um teste com schema falso testaria justamente a copia.
// Em troca, estes testes quebram quando o schema do modulo orcamento muda, que
// e o alarme que se quer ter.

const { test } = require('node:test')
const assert = require('node:assert')

const esquema = require('../lib/schema')
const { obter } = require('../lib/recursos')

const schemaNc = obter('nc').schema()
const schemaRpnp = obter('rpnp').schema()

test('marca os obrigatorios e le os tipos do Joi vivo', () => {
  const campos = esquema.camposDe(schemaNc.criar)
  const porNome = Object.fromEntries(campos.map(c => [c.nome, c]))

  assert.strictEqual(porNome.numero.obrigatorio, true)
  assert.strictEqual(porNome.numero.tipo, 'string(<=20)')
  assert.strictEqual(porNome.valor_nc.obrigatorio, true)
  assert.strictEqual(porNome.valor_nc.tipo, 'number>0')
  assert.strictEqual(porNome.observacao.obrigatorio, false)
})

test('valid() vira lista exaustiva com = e allow() vira lista aditiva com |', () => {
  const campos = esquema.camposDe(schemaNc.criar)
  const porNome = Object.fromEntries(campos.map(c => [c.nome, c]))

  // .valid(1, 2): so estes dois valores.
  assert.strictEqual(porNome.classificacao_id.tipo, 'int =1|2')
  // .allow(null, ''): alem do tipo base.
  assert.ok(porNome.ptres.tipo.includes("|null|''"))
})

test('nao vaza o sentinela {override:true} do describe do Joi', () => {
  // Regressao: o Joi injeta {override:true} no allow de um .valid(), e sem
  // filtrar isso o agente lia `classificacao_id={"override":true}|1` e concluia
  // que havia dois valores validos.
  const texto = esquema.contrato('nc', obter('nc'))
  assert.ok(!texto.includes('override'), 'o sentinela vazou para o contrato')
})

test('renderiza o condicional pdr_item_id com a regra dos dois lados', () => {
  const campos = esquema.camposDe(schemaNc.criar)
  const pdrItem = campos.find(c => c.nome === 'pdr_item_id')

  assert.strictEqual(pdrItem.tipo, 'condicional')
  const notas = pdrItem.notas.join(' ')
  assert.ok(notas.includes('classificacao_id=1'), 'falta a condicao')
  assert.ok(notas.includes('DESCARTADO'), 'falta o descarte do caso contrario')
})

test('anota o .raw() das datas, que muda o dia gravado', () => {
  const campos = esquema.camposDe(schemaNc.criar)
  const data = campos.find(c => c.nome === 'data_emissao')
  assert.ok(data.notas.some(n => n.includes('YYYY-MM-DD')))
})

test('le as dependencias .or() do nivel do objeto', () => {
  const deps = esquema.dependenciasDe(schemaRpnp.criar)
  assert.strictEqual(deps.length, 1)
  assert.ok(deps[0].includes('pelo menos um de'))
  assert.ok(deps[0].includes('nota_empenho_id'))
  assert.ok(deps[0].includes('empenho_label'))
})

test('deriva os filtros de listagem do proprio listarQuery', () => {
  const filtros = esquema.filtrosDe(schemaNc).map(f => f.nome)
  assert.deepStrictEqual(filtros.sort(), ['ano', 'classificacao_id'])
})

test('validarCorpo recusa corpo incompleto sem tocar a rede', () => {
  const r = esquema.validarCorpo(schemaNc.criar, { numero: '2026NC000123' })
  assert.strictEqual(r.ok, false)
  const campos = r.erros.map(e => e.campo)
  assert.ok(campos.includes('ano'))
  assert.ok(campos.includes('valor_nc'))
})

test('validarCorpo aceita corpo completo', () => {
  const r = esquema.validarCorpo(schemaNc.criar, {
    numero: '2026NC000123',
    ano: 2026,
    cod_nd: '339040',
    valor_nc: 15000,
    classificacao_id: 1
  })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, [])
})

test('RECUSA campo com nome errado, espelhando o 400 do servidor', () => {
  // Ate 2026-07-25 o servidor descartava (stripUnknown) e este teste fixava o
  // aviso. O servidor passou a recusar com 400, e o CLI acompanhou no mesmo
  // gesto: a validacao local tem que reprovar o que o servidor reprovaria,
  // senao o --dry-run aprova e o envio real leva 400.
  const r = esquema.validarCorpo(schemaNc.criar, {
    numero: '2026NC000123',
    ano: 2026,
    cod_nd: '339040',
    valor_nc: 15000,
    classificacao_id: 1,
    valor: 999
  })
  assert.strictEqual(r.ok, false)
  assert.ok(
    r.erros.some(e => /valor/.test(e.mensagem) && /not allowed/.test(e.mensagem)),
    'o erro precisa NOMEAR a chave sobrando'
  )
})

test('acusa o pdr_item_id descartado por regra quando a NC e Extra-PDR', () => {
  const r = esquema.validarCorpo(schemaNc.criar, {
    numero: '2026NC000999',
    ano: 2026,
    cod_nd: '339040',
    valor_nc: 500,
    classificacao_id: 2,
    pdr_item_id: 3
  })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, ['pdr_item_id'])
})

test('explicarErro imprime o contrato so dos campos que falharam', () => {
  const r = esquema.validarCorpo(schemaNc.criar, { numero: '2026NC000123' })
  const texto = esquema.explicarErro(schemaNc.criar, r.erros)

  assert.ok(texto.includes('nada foi enviado'))
  assert.ok(texto.includes('valor_nc'), 'falta o campo que falhou')
  assert.ok(texto.includes('number>0'), 'falta o tipo do campo que falhou')
  assert.ok(!texto.includes('observacao'), 'trouxe campo que nao falhou')
})

test('todo recurso da registry renderiza contrato sem quebrar', () => {
  const { RECURSOS } = require('../lib/recursos')
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(texto.length > 0, `${chave} devolveu contrato vazio`)
    assert.ok(texto.includes('rotas'), `${chave} nao listou rotas`)
  }
})

test('todo recurso do modulo leva o prefixo /orcamento; usuarios nao', () => {
  // Regressao da fusao de 2026-07-27. Rota sem prefixo bate em 404, ou pior:
  // /arquivo e /relatorio existem TAMBEM no acervo, e sem o prefixo o CLI
  // acertaria a rota errada e responderia com dados de outro modulo.
  const { RECURSOS } = require('../lib/recursos')
  // Recurso de PLATAFORMA: mora fora dos tres modulos, entao NAO leva prefixo.
  //
  // `meta` entrou nesta lista em 2026-08-01. As metas do PIT sairam do modulo
  // orcamento em 2026-07-31 (viraram /api/metas, schema `pit`), o
  // lib/recursos.js acompanhou e este teste nao: ele vinha falhando desde
  // entao, sozinho, porque a suite dos CLIs nao entra no `npm test` do servidor
  // nem no do client -- so roda por `node --test`, a mao.
  const PLATAFORMA = new Set(['usuario', 'meta'])

  for (const [chave, recurso] of Object.entries(RECURSOS)) {
    if (PLATAFORMA.has(chave)) {
      assert.ok(
        !recurso.caminho.startsWith('/orcamento/'),
        `${chave} e rota de plataforma e nao pode levar prefixo`
      )
    } else {
      assert.ok(
        recurso.caminho.startsWith('/orcamento/'),
        `${chave} aponta para ${recurso.caminho}, sem o prefixo /orcamento`
      )
    }
  }
})

test('o cliente de auth padrao e aceito pelo login vivo do SCA', () => {
  // Nao copia a lista: le o .valid() do login_schema.js do server/. O valor
  // antigo do SCO ('c_orcamentario') nao passa mais.
  const { clientesAceitos, CLIENTE_PADRAO } = require('../lib/config')
  const aceitos = clientesAceitos()

  assert.ok(aceitos.length > 0, 'nao consegui ler o login_schema do server/')
  assert.ok(aceitos.includes(CLIENTE_PADRAO), `${CLIENTE_PADRAO} nao esta em ${aceitos.join(', ')}`)
  assert.ok(!aceitos.includes('c_orcamentario'), 'o cliente antigo do SCO reapareceu')
})
