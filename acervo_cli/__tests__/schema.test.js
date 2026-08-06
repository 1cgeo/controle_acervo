'use strict'

// Testa o formatador de contrato e a validacao local CONTRA OS SCHEMAS REAIS do
// server/, nao contra mocks. E de proposito: o valor do CLI e nao ter copia do
// contrato, e um teste com schema falso testaria justamente a copia.
// Em troca, estes testes quebram quando o schema do SCA muda, que e o alarme
// que se quer ter.

const { test } = require('node:test')
const assert = require('node:assert')

const esquema = require('../lib/schema')
const { RECURSOS, obter, RAIZ_SERVER } = require('../lib/recursos')

const schemaProduto = obter('produtos').schema()
const schemaArquivo = obter('arquivo').schema()
const schemaAcervo = obter('acervo').schema()

test('marca os obrigatorios e le os tipos do Joi vivo', () => {
  const campos = esquema.camposDe(schemaProduto.versaoAtualizacao)
  const porNome = Object.fromEntries(campos.map(c => [c.nome, c]))

  assert.strictEqual(porNome.id.obrigatorio, true)
  assert.strictEqual(porNome.versao.obrigatorio, true)
  assert.strictEqual(porNome.uuid_versao.obrigatorio, false)
  assert.strictEqual(porNome.uuid_versao.tipo, 'uuid')
  assert.ok(porNome.nome.tipo.includes('|null'))
})

test('anota o .strict(), que recusa "1" onde se espera 1', () => {
  // Corpo vem de JSON na linha de comando: string virando numero por engano e
  // um erro que so aparece no 400 do servidor se nao for dito aqui.
  const campos = esquema.camposDe(schemaProduto.versaoAtualizacao)
  const id = campos.find(c => c.nome === 'id')
  assert.ok(id.notas.some(n => n.includes('strict')))
})

// REGRESSAO: um `.default(null)` no subtipo faria o PUT apagar a identidade do
// produto em silencio, e a Carta Militar deixaria de ser militar pela tela.
test('o subtipo do produto NAO pode ter default no PUT', () => {
  const campos = esquema.camposDe(schemaProduto.produtoAtualizacao)
  const subtipo = campos.find(c => c.nome === 'subtipo_produto_id')
  assert.ok(subtipo, 'o campo tem que continuar existindo no PUT')
  assert.ok(
    !subtipo.notas.some(n => String(n).startsWith('default')),
    'default aqui apaga a identidade do produto: chave ausente significa "nao mexe"'
  )
})

// O mecanismo em si continua valendo: ainda ha rota com default (a carga em
// lote de arquivo). Aqui ele e exercitado sobre um schema Joi montado na hora,
// porque o alvo do teste e a FUNCAO, nao o contrato de nenhuma rota.
test('marca o campo com default, que e o que um PUT gravaria em silencio', () => {
  // O mesmo joi que o server usa; o CLI nao tem dependencia propria.
  const Joi = require(require('path').join(RAIZ_SERVER, '..', 'node_modules', 'joi'))
  const comDefault = Joi.object().keys({
    id: Joi.number().required(),
    rotulo: Joi.string().allow(null).default(null)
  })
  const ausentes = esquema.defaultsAusentes(comDefault, { id: 1 })
  assert.deepStrictEqual(ausentes.map(a => a.campo), ['rotulo'])
  assert.strictEqual(ausentes[0].padrao, 'null')
})

test('renderiza o min por referencia entre datas', () => {
  // data_edicao >= data_criacao vive no Joi como ref, e sem imprimir isso o
  // agente monta um corpo formalmente correto e leva 400 sem entender.
  const campos = esquema.camposDe(schemaProduto.versaoAtualizacao)
  const dataEdicao = campos.find(c => c.nome === 'data_edicao')
  assert.strictEqual(dataEdicao.tipo, 'date>=ref:data_criacao')
})

test('renderiza o pattern de rotulo de versao historica', () => {
  const campos = esquema.camposDe(schemaProduto.versoesHistoricas)
  const versao = campos.find(c => c.nome === 'versao')
  assert.ok(versao.tipo.includes('Edição'), 'o formato legado precisa aparecer')
  assert.ok(versao.tipo.includes('[A-Z]'), 'o formato novo precisa aparecer')
})

test('le schema com ARRAY no topo, que o SCA usa em versao_historica', () => {
  assert.strictEqual(esquema.ehArrayNoTopo(schemaProduto.versoesHistoricas), true)
  assert.strictEqual(esquema.ehArrayNoTopo(schemaProduto.produtoAtualizacao), false)
  const campos = esquema.camposDe(schemaProduto.versoesHistoricas)
  assert.ok(campos.some(c => c.nome === 'produto_id'))
})

test('desce em array de objetos, senao o contrato nao diz nada util', () => {
  const campos = esquema.camposDe(schemaProduto.versaoRelacionamento)
  const lista = campos.find(c => c.nome === 'versao_relacionamento')
  assert.ok(lista.tipo.startsWith('array<object>'))
  const filhos = lista.filhos.map(f => f.nome)
  assert.deepStrictEqual(filhos, ['versao_id_1', 'versao_id_2', 'tipo_relacionamento_id'])
})

test('renderiza o condicional do Tileserver com os dois lados', () => {
  const campos = esquema.camposDe(schemaArquivo.arquivoAtualizacao)
  const volume = campos.find(c => c.nome === 'volume_armazenamento_id')
  assert.strictEqual(volume.tipo, 'condicional')
  const notas = volume.notas.join(' ')
  assert.ok(notas.includes('tipo_arquivo_id=9'), 'falta a condicao')
  assert.ok(notas.includes('senao'), 'falta o caso contrario')
})

test('nao vaza o sentinela {override:true} do describe do Joi', () => {
  // Regressao: o Joi injeta {override:true} no allow de um .valid(), e sem
  // filtrar isso o agente lia um valor a mais como se fosse aceito.
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(!texto.includes('override'), `o sentinela vazou em ${chave}`)
  }
})

test('todo recurso da registry renderiza contrato sem quebrar', () => {
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(texto.length > 0, `${chave} devolveu contrato vazio`)
    for (const acao of Object.keys(RECURSOS[chave].operacoes)) {
      assert.ok(texto.includes(`acervo ${chave} ${acao}`), `${chave} nao listou ${acao}`)
    }
  }
})

test('toda operacao da registry aponta uma chave que existe no schema', () => {
  // Este teste e o alarme: se o server/ renomear um schema, ele quebra aqui em
  // vez de quebrar num 500 no meio de uma carga.
  for (const [chave, recurso] of Object.entries(RECURSOS)) {
    const modulo = recurso.schema()
    for (const [acao, op] of Object.entries(recurso.operacoes)) {
      for (const campo of ['corpo', 'query', 'params']) {
        if (!op[campo]) continue
        assert.ok(modulo[op[campo]], `${chave} ${acao}: ${campo} "${op[campo]}" nao existe no schema`)
        assert.strictEqual(
          typeof modulo[op[campo]].describe, 'function',
          `${chave} ${acao}: ${op[campo]} nao e um schema Joi`
        )
      }
    }
  }
})

// O que se prova aqui e o CONTRATO do camposDe: ele devolve as chaves do proprio
// Joi, sem perder nem inventar. Comparar contra `describe().keys` mede isso e
// nunca envelhece; fixar uma lista de filtros seria copiar contrato, que e o que
// o acervo_cli existe para NAO fazer. O spot-check embaixo impede a versao
// degenerada do teste: uma implementacao que devolvesse [] passaria na
// comparacao (dois vazios sao iguais) se o schema tambem estivesse vazio.
test('deriva os filtros de listagem do proprio schema de query', () => {
  const filtros = esquema.camposDe(schemaAcervo.buscaProdutos).map(f => f.nome)
  const doJoi = Object.keys(schemaAcervo.buscaProdutos.describe().keys)

  assert.deepStrictEqual(filtros.sort(), doJoi.sort(),
    'camposDe deve devolver exatamente as chaves do schema')

  for (const esperado of ['termo', 'limit', 'page', 'tipo_produto_id']) {
    assert.ok(filtros.includes(esperado), `filtro "${esperado}" sumiu do schema de busca`)
  }
})

test('validarCorpo recusa corpo incompleto sem tocar a rede', () => {
  const r = esquema.validarCorpo(schemaProduto.produtoIds, { produto_ids: [1, 2] })
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.campo === 'motivo_exclusao'))
})

test('validarCorpo aceita corpo completo', () => {
  const r = esquema.validarCorpo(schemaProduto.produtoIds, {
    produto_ids: [1, 2],
    motivo_exclusao: 'duplicata byte-identica'
  })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, [])
})

test('acusa campo com nome errado, que o servidor descartaria calado', () => {
  const r = esquema.validarCorpo(schemaProduto.moverArquivos, {
    arquivo_ids: [9001],
    versao_id_destino: 6100,
    permitir_entre_produto: true
  })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, ['permitir_entre_produto'])
})

test('o .strict() dos ids barra numero em string', () => {
  // O acervo usa .strict() nos ids de proposito; "9001" nao vira 9001.
  const r = esquema.validarCorpo(schemaProduto.moverArquivos, {
    arquivo_ids: ['9001'],
    versao_id_destino: 6100
  })
  assert.strictEqual(r.ok, false)
})

// O GET de produto traz o subtipo e o PUT nao tem default nele: nao ha default
// silencioso a acusar. Se o guardrail voltar a acusar aqui, um dos dois lados
// regrediu e editar qualquer campo volta a despinar a Carta Militar com 200.
test('a leitura de produto satisfaz o PUT, e o guardrail fica quieto', () => {
  const base = {
    id: 4211,
    nome: 'Serra Azul',
    mi: '2965-2',
    inom: 'SF-23-Y-C-II-1',
    tipo_escala_id: 2,
    denominador_escala_especial: null,
    tipo_produto_id: 2,
    subtipo_produto_id: 24,
    descricao: '',
    geom: 'SRID=4674;POLYGON((0 0,1 0,1 1,0 0))'
  }
  assert.deepStrictEqual(esquema.defaultsAusentes(schemaProduto.produtoAtualizacao, base), [])
})

// O caso que importa de verdade: omitir o subtipo nao pode silenciar.
test('omitir o subtipo nao inventa valor, porque nao ha mais default', () => {
  const semSubtipo = {
    id: 4211,
    nome: 'Serra Azul',
    mi: '2965-2',
    inom: 'SF-23-Y-C-II-1',
    tipo_escala_id: 2,
    denominador_escala_especial: null,
    tipo_produto_id: 2,
    descricao: '',
    geom: 'SRID=4674;POLYGON((0 0,1 0,1 1,0 0))'
  }
  assert.deepStrictEqual(esquema.defaultsAusentes(schemaProduto.produtoAtualizacao, semSubtipo), [])
  const { valor } = esquema.validarCorpo(schemaProduto.produtoAtualizacao, semSubtipo)
  assert.ok(!('subtipo_produto_id' in valor),
    'o Joi nao pode injetar o campo: chave ausente significa "nao mexe" e quem preserva e o controller')
})

test('defaultsAusentes fica quieto quando a leitura traz tudo', () => {
  const base = {
    id: 7244,
    versao: '2-DSG',
    nome: null,
    tipo_versao_id: 1,
    subtipo_produto_id: 12,
    descricao: '',
    metadado: {},
    lote_id: 88,
    orgao_produtor: 'DSG',
    palavras_chave: [],
    data_criacao: '2019-01-10',
    data_edicao: '2019-05-01'
  }
  assert.deepStrictEqual(esquema.defaultsAusentes(schemaProduto.versaoAtualizacao, base), [])
})

test('explicarErro imprime o contrato so dos campos que falharam', () => {
  const r = esquema.validarCorpo(schemaProduto.renumeraVersoes, {
    produto_id: 4211,
    subtipo_produto_id: 24,
    familia: 'edicao'
  })
  const texto = esquema.explicarErro(schemaProduto.renumeraVersoes, r.erros)

  assert.ok(texto.includes('nada foi enviado'))
  assert.ok(texto.includes('familia'), 'falta o campo que falhou')
  assert.ok(texto.includes('nova_data_edicao'), 'falta o obrigatorio que falta')
  assert.ok(!texto.includes('subtipo_produto_id'), 'trouxe campo que nao falhou')
})

test('explicarErro acha o campo mesmo com array no topo (path com indice)', () => {
  const r = esquema.validarCorpo(schemaProduto.versoesHistoricas, [{
    uuid_versao: null,
    versao: 'formato errado',
    nome: null,
    produto_id: 1,
    subtipo_produto_id: 2,
    lote_id: null,
    metadado: {},
    descricao: '',
    orgao_produtor: 'DSG',
    data_criacao: '1975-01-01',
    data_edicao: '1975-06-01'
  }])
  assert.strictEqual(r.ok, false)
  const texto = esquema.explicarErro(schemaProduto.versoesHistoricas, r.erros)
  assert.ok(texto.includes('contrato dos campos citados'), 'nao casou o path "0.versao" com o campo')
  assert.ok(texto.includes('versao'))
})

// O campo RECUSADO tem que APARECER como recusado, e nao sumir nem passar por
// opcional. `data_fim_prevista` e do lote: a coluna existe em `acervo.lote` e
// nao em `acervo.projeto`. Ate 06/08/2026 o schema de projeto a aceitava e o
// INSERT a descartava calado.
//
// O Joi entrega `.forbidden()` como `type: 'any'` sem regra nenhuma. Sem o ramo
// que o traduz, o contrato imprimiria `data_fim_prevista  any`, que o agente le
// como "campo opcional que aceita qualquer coisa": a leitura OPOSTA da verdade.
test('o contrato de projeto marca data_fim_prevista como RECUSADO', () => {
  const texto = esquema.contrato('projetos', RECURSOS.projetos)
  const linhas = texto.split('\n').filter(l => l.includes('data_fim_prevista'))

  // Variancia primeiro: sem as linhas do lote a comparacao abaixo nao discrimina
  // nada, porque um contrato que marcasse TUDO como recusado passaria igual.
  const recusadas = linhas.filter(l => l.includes('RECUSADO (400)'))
  const aceitas = linhas.filter(l => l.includes('date'))
  assert.ok(recusadas.length > 0, 'o projeto nao marcou a recusa')
  assert.ok(aceitas.length > 0, 'o lote perdeu o campo, e ele e valido la')

  assert.ok(
    recusadas.every(l => /acervo\.lote/.test(l)),
    'a recusa nao diz ONDE o campo vale, entao nao ensina o conserto'
  )
})

test('o campo recusado nao e anunciado como aceitando qualquer coisa', () => {
  const texto = esquema.contrato('projetos', RECURSOS.projetos)
  for (const linha of texto.split('\n')) {
    if (!linha.includes('data_fim_prevista')) continue
    if (linha.includes('RECUSADO (400)')) continue
    assert.ok(
      !/\bany\b/.test(linha),
      `o campo recusado saiu como "any": ${linha.trim()}`
    )
  }
})
