'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const consulta = require('../lib/consulta')
const args = require('../lib/args')
const conferir = require('../comandos/conferir')

test('montar casa a matriz de celulas com os nomes pedidos', () => {
  const campos = ['NUMERO_NC', 'VALOR_NC', 'OBS']
  const linha = ['<button>2026NC400134</button>', '20.710,00', 'DSG-Pagamento de diarias']
  assert.deepStrictEqual(consulta.montar(campos, linha), {
    NUMERO_NC: '2026NC400134',
    VALOR_NC: '20.710,00',
    OBS: 'DSG-Pagamento de diarias'
  })
})

test('montar preenche vazio quando a linha vem mais curta que os campos', () => {
  // Coluna faltante nao pode deslocar as seguintes: o valor de uma iria para o
  // nome de outra, e a linha inteira ficaria plausivel e errada.
  assert.deepStrictEqual(consulta.montar(['A', 'B', 'C'], ['x']), { A: 'x', B: '', C: '' })
})

test('fase reproduz a regra da tela: load com UG favorecida, change sem ela', () => {
  assert.strictEqual(consulta.faseDa({ 'UG_FAV[]': ['160382'] }), 'load')
  assert.strictEqual(consulta.faseDa({ 'UG_FAV[]': [] }), 'change')
  assert.strictEqual(consulta.faseDa({}), 'change')
})

test('parametros mandam as colunas na ordem pedida', () => {
  const p = consulta.parametros(['A', 'B'], { DATAINI: '01/01/2026' }, 0, 500)
  assert.deepStrictEqual(p['coluna[]'], ['A', 'B'])
  assert.strictEqual(p.metodo, 'tela')
  assert.strictEqual(p.iDisplayStart, '0')
  assert.strictEqual(p.DATAINI, '01/01/2026')
})

test('paraQuery repete a chave para cada valor da lista', () => {
  // O backend espera ND[]=x&ND[]=y. Um objeto plano perderia metade do filtro.
  const q = consulta.paraQuery({ 'ND[]': ['339015', '339030'], metodo: 'tela' })
  assert.strictEqual(q, 'ND%5B%5D=339015&ND%5B%5D=339030&metodo=tela')
})

test('--filtro acumula o mesmo campo em vez de sobrescrever', () => {
  const parsed = args.parse(['nc', 'listar', '--filtro', 'ND=339015', '--filtro', 'ND=339030'])
  assert.deepStrictEqual(args.filtros(parsed.flags), { ND: ['339015', '339030'] })
})

test('--filtro aceita lista separada por virgula', () => {
  const parsed = args.parse(['nc', 'listar', '--filtro', 'ND=339015,339030'])
  assert.deepStrictEqual(args.filtros(parsed.flags), { ND: ['339015', '339030'] })
})

test('--filtro sem sinal de igual falha com a sintaxe na mensagem', () => {
  const parsed = args.parse(['nc', 'listar', '--filtro', 'ND'])
  assert.throws(() => args.filtros(parsed.flags), /CAMPO=valor/)
})

test('a chave de conferencia usa a identidade do SCA, e nao so o numero', () => {
  // A unicidade da NC no SCA e (ano, numero, cod_nd, ug_emitente): duas NCs com
  // o mesmo numero e UGs emitentes diferentes existem de verdade (medido na
  // 2026NC400412). Casar so pelo numero e sorteio.
  const a = { numero: '2026NC400412', cod_nd: '339039', ug_emitente: '160035' }
  const b = { numero: '2026NC400412', cod_nd: '339039', ug_emitente: '167035' }
  assert.notStrictEqual(
    conferir.chaveDe(a, ['numero', 'cod_nd', 'ug_emitente']),
    conferir.chaveDe(b, ['numero', 'cod_nd', 'ug_emitente'])
  )
})

test('a chave normaliza o numero longo do SAG contra o curto do SCA', () => {
  const doSag = { numero: '160382000012026NE000153', cod_nd: '', ug_emitente: '' }
  const doSca = { numero: '2026NE000153', cod_nd: '', ug_emitente: '' }
  assert.strictEqual(conferir.chaveDe(doSag), conferir.chaveDe(doSca))
})

test('traduzir converte valor e data ao passar do SAG para o SCA', () => {
  const mapa = {
    NUMERO_NC: 'numero',
    DATA_EMISSAO: 'data_emissao',
    VALOR_NC: 'valor_nc',
    OBS: 'finalidade_historico'
  }
  const linha = {
    NUMERO_NC: '2026NC400134',
    DATA_EMISSAO: '03/02/26',
    VALOR_NC: '20.710,00',
    OBS: 'DSG-Pagamento de diarias'
  }
  assert.deepStrictEqual(conferir.traduzir(linha, mapa), {
    numero: '2026NC400134',
    data_emissao: '2026-02-03',
    valor_nc: 20710,
    finalidade_historico: 'DSG-Pagamento de diarias'
  })
})

test('agrupar soma os itens de uma NC na chave do SCA', () => {
  // Medido na 2026NC420174 em 2026-08-07: duas linhas, itens de 18.023,14 e
  // 399,00, que somam o total 18.422,14 que VALOR_NC repete nas duas.
  const doc = require('../lib/documentos').DOCUMENTOS.nc
  const linhas = [
    { NUMERO_NC: '2026NC420174', UG_EMITENTE: '160505', DESTINO_ND: '339093', DESTINO_VALOR_ITEM: '18.023,14' },
    { NUMERO_NC: '2026NC420174', UG_EMITENTE: '160505', DESTINO_ND: '339093', DESTINO_VALOR_ITEM: '399,00' }
  ]
  const { mapa, agrupadas } = conferir.agrupar(linhas, doc)
  assert.strictEqual(mapa.size, 1)
  assert.strictEqual(agrupadas, 1)
  assert.strictEqual([...mapa.values()][0].traduzida.valor_nc, 18422.14)
})

test('agrupar mantem separadas as NDs distintas da mesma NC', () => {
  // A 2026NC000758 do vault tem 339015 (7.125,00) e 339033 (2.178,00). Elas sao
  // DUAS linhas no SCA, e somar as duas numa so daria 9.303,00 em cada.
  const doc = require('../lib/documentos').DOCUMENTOS.nc
  const linhas = [
    { NUMERO_NC: '2026NC000758', UG_EMITENTE: '160507', DESTINO_ND: '339015', DESTINO_VALOR_ITEM: '7.125,00' },
    { NUMERO_NC: '2026NC000758', UG_EMITENTE: '160507', DESTINO_ND: '339033', DESTINO_VALOR_ITEM: '2.178,00' }
  ]
  const { mapa, agrupadas } = conferir.agrupar(linhas, doc)
  assert.strictEqual(mapa.size, 2)
  assert.strictEqual(agrupadas, 0)
  const porNd = Object.fromEntries(
    [...mapa.values()].map(v => [v.traduzida.cod_nd, v.traduzida.valor_nc])
  )
  assert.deepStrictEqual(porNd, { 339015: 7125, 339033: 2178 })
})

test('documento sem regra de soma e deduplicado, nunca somado', () => {
  // A NE nao teve o caso de varios itens medido. Somar o total repetido
  // multiplicaria o empenho; a escolha segura erra para menos.
  const doc = require('../lib/documentos').DOCUMENTOS.ne
  const linhas = [
    { NR: '2026NE000153', VALOR_NE: '20.710,00' },
    { NR: '2026NE000153', VALOR_NE: '20.710,00' }
  ]
  const { mapa, agrupadas } = conferir.agrupar(linhas, doc)
  assert.strictEqual(mapa.size, 1)
  assert.strictEqual(agrupadas, 1)
  assert.strictEqual([...mapa.values()][0].traduzida.valor_empenhado, 20710)
})

test('a chave sai do documento: a NE casa so pelo numero', () => {
  // Com a chave da NC aplicada a NE, o lado do SAG entra sem ND e o lado do SCA
  // com a ND herdada da NC: nenhum empenho casaria, e o relatorio diria que o
  // SCA esta vazio.
  const doc = require('../lib/documentos').DOCUMENTOS.ne
  const doSag = { numero: '160382000012026NE000153' }
  const doSca = { numero: '2026NE000153', cod_nd: '339015', ug_emitente: '160035' }
  assert.strictEqual(conferir.chaveDe(doSag, doc.chave), conferir.chaveDe(doSca, doc.chave))
})
