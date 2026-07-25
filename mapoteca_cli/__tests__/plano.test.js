// Path: __tests__\plano.test.js
'use strict'

// Os guardrails do cadastro de pedido, testados offline contra os schemas REAIS
// do server/. Sao as regras que evitam o erro CARO (folha errada, dobro de
// impressao, OM duplicada), nao o erro barato (400 do servidor).

const { test } = require('node:test')
const assert = require('node:assert')
const fs = require('fs')
const os = require('os')
const path = require('path')

const planoLib = require('../lib/plano')
const mi = require('../lib/mi')
const { carregarSchema } = require('../lib/recursos')
const { escolherVersao, casarClientes } = require('../comandos/resolver')
const { camposQueSeriamZerados } = require('../comandos/crud')
const { escolherModulo } = require('../mapoteca')

const models = carregarSchema()

const UUID_A = '3f2b1a9c-4d5e-4f6a-8b7c-9d0e1f2a3b4c'

function planoBase (extra = {}) {
  return {
    cliente: { nome: '6 Regimento de Cavalaria Blindado', tipo_cliente_id: 1 },
    pedido: {
      data_pedido: '2026-07-24',
      situacao_pedido_id: 3,
      documento_solicitacao: 'DIEx 123-S/3',
      documento_solicitacao_nup: '64536.000123/2026-11'
    },
    itens: [
      { mi: '2962-4-NE', nome: 'Cerro da Gloria', uuid_versao: UUID_A, quantidade: 5, tipo_midia_id: 6 }
    ],
    ...extra
  }
}

// ---------------------------------------------------------------------------
// MI
// ---------------------------------------------------------------------------

test('normaliza o MI como o documento o escreve', () => {
  assert.strictEqual(mi.normalizar('2962-4-NE'), '2962-4-NE')
  assert.strictEqual(mi.normalizar('2962/4/ne'), '2962-4-NE')
  assert.strictEqual(mi.normalizar(' 02962 4 NE '), '2962-4-NE')
  // O sinal de menos unicode que o Word produz sozinho.
  assert.strictEqual(mi.normalizar('2962\u22124\u2212NE'), '2962-4-NE')
  assert.strictEqual(mi.normalizar('2962'), '2962')
})

test('recusa o que nao tem forma de MI, em vez de adivinhar', () => {
  assert.strictEqual(mi.normalizar('Cerro da Gloria'), null)
  assert.strictEqual(mi.normalizar('2962-9-NE'), null)
  assert.strictEqual(mi.normalizar(''), null)
  assert.strictEqual(mi.normalizar(null), null)
})

test('MI invalido nunca casa com nada', () => {
  assert.strictEqual(mi.iguais('02962-4', '2962-4'), true)
  assert.strictEqual(mi.iguais('lixo', 'lixo'), false)
})

// ---------------------------------------------------------------------------
// Duplicata de MI: a regra do dominio de 2026-07-24
// ---------------------------------------------------------------------------

test('duas linhas com o mesmo MI viram UM item, e a quantidade NAO e somada', () => {
  const r = planoLib.fundirDuplicatas([
    { mi: '2962-4-NE', quantidade: 5, tipo_midia_id: 6 },
    { mi: '2962/4/NE', quantidade: 3, tipo_midia_id: 6 }
  ])

  assert.strictEqual(r.itens.length, 1, 'as duas linhas tinham de colapsar em uma')
  assert.strictEqual(r.itens[0].quantidade, 5, 'somar 5 e 3 seria imprimir o dobro')
  assert.strictEqual(r.avisos.length, 1, 'a fusao nunca pode ser silenciosa')
  assert.ok(r.avisos[0].includes('nao somar'))
  // O rastro das duas linhas fica na observacao, para quem for conferir depois
  // nao ter que voltar ao PDF.
  assert.ok(r.itens[0].observacao.includes('linha repetida'))
})

test('duas folhas diferentes continuam sendo dois itens', () => {
  const r = planoLib.fundirDuplicatas([
    { mi: '2962-4-NE', quantidade: 5 },
    { mi: '2962-4-NO', quantidade: 5 }
  ])
  assert.strictEqual(r.itens.length, 2)
  assert.strictEqual(r.avisos.length, 0)
})

test('a duplicata tambem e detectada pelo uuid_versao, nao so pelo MI', () => {
  const r = planoLib.fundirDuplicatas([
    { uuid_versao: UUID_A, quantidade: 2 },
    { uuid_versao: UUID_A, quantidade: 7 }
  ])
  assert.strictEqual(r.itens.length, 1)
  assert.strictEqual(r.itens[0].quantidade, 7)
})

// ---------------------------------------------------------------------------
// Validacao do plano
// ---------------------------------------------------------------------------

test('plano completo passa, e os defaults do Joi sao aplicados', () => {
  const r = planoLib.validar(planoBase(), models)
  assert.strictEqual(r.ok, true, r.erros.join(' | '))
  assert.strictEqual(r.pedido.previsto_pit, false)
  assert.strictEqual(r.itens[0].corpo.producao_especifica, false)
  assert.strictEqual(r.itens[0].corpo.uuid_versao, UUID_A)
})

test('item sem uuid_versao e recusado, com o comando do conserto junto', () => {
  const plano = planoBase()
  delete plano.itens[0].uuid_versao

  const r = planoLib.validar(plano, models)
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.includes('mapoteca resolver 2962-4-NE')))
})

test('mi e nome sao chaves LOCAIS: nao viram corpo nem aviso de descarte', () => {
  // O nome no plano e o que o DOCUMENTO escreveu (e o que permite detectar a
  // divergencia contra o acervo). Se ele fosse ao servidor, o stripUnknown o
  // descartaria e o CLI gritaria um falso alarme a cada item.
  const r = planoLib.validar(planoBase(), models)
  assert.ok(!('mi' in r.itens[0].corpo))
  assert.ok(!('nome' in r.itens[0].corpo))
  assert.strictEqual(r.itens[0].local.nome, 'Cerro da Gloria')
  assert.ok(!r.avisos.some(a => a.includes('mi')), 'mi virou falso alarme de descarte')
})

test('campo com nome errado no pedido vira aviso, porque o servidor o descarta calado', () => {
  const plano = planoBase()
  plano.pedido.prazo_entrega = '2026-08-30'

  const r = planoLib.validar(plano, models)
  assert.ok(r.avisos.some(a => a.includes('prazo_entrega')))
})

test('pedido concluido sem data_atendimento e recusado offline', () => {
  const plano = planoBase()
  plano.pedido.situacao_pedido_id = 5

  const r = planoLib.validar(plano, models)
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.includes('data_atendimento')))
})

test('plano sem cliente e sem cliente_id e recusado', () => {
  const plano = planoBase()
  delete plano.cliente

  const r = planoLib.validar(plano, models)
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.includes('cliente')))
})

test('cliente_id fixado no plano dispensa o bloco cliente', () => {
  const plano = planoBase()
  delete plano.cliente
  plano.pedido.cliente_id = 41

  const r = planoLib.validar(plano, models)
  assert.strictEqual(r.ok, true, r.erros.join(' | '))
  assert.strictEqual(r.pedido.cliente_id, 41)
})

test('anexo inexistente no disco e recusado antes de qualquer chamada', () => {
  const plano = planoBase({ anexos: [{ arquivo: 'nao_existe_em_lugar_nenhum.pdf' }] })
  const r = planoLib.validar(plano, models)
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.includes('nao encontrado')))
})

test('anexo com extensao fora da lista do multer e recusado localmente', () => {
  const arquivo = path.join(os.tmpdir(), `mapoteca-cli-teste-${process.pid}.exe`)
  fs.writeFileSync(arquivo, 'x')
  try {
    const r = planoLib.validar(planoBase({ anexos: [{ arquivo }] }), models)
    assert.strictEqual(r.ok, false)
    assert.ok(r.erros.some(e => e.includes('.exe')))
  } finally {
    fs.unlinkSync(arquivo)
  }
})

test('anexo valido passa e recebe o tipo padrao do proprio Joi', () => {
  const arquivo = path.join(os.tmpdir(), `mapoteca-cli-teste-${process.pid}.pdf`)
  fs.writeFileSync(arquivo, 'conteudo')
  try {
    const r = planoLib.validar(planoBase({ anexos: [{ arquivo }] }), models)
    assert.strictEqual(r.ok, true, r.erros.join(' | '))
    assert.strictEqual(r.anexos.length, 1)
    assert.strictEqual(r.anexos[0].meta.tipo_anexo_id, 4)
  } finally {
    fs.unlinkSync(arquivo)
  }
})

// ---------------------------------------------------------------------------
// Escolha de versao no acervo
// ---------------------------------------------------------------------------

test('escolhe a versao mais recente QUE TENHA arquivo, nao a mais recente', () => {
  // O caso real: uma folha 25k com quatro edicoes historicas cadastradas sem
  // arquivo nenhum, mais a edicao moderna. Escolher pela data pura pegaria um
  // registro que a mapoteca nunca consegue imprimir.
  const { versao, motivo } = escolherVersao([
    { uuid_versao: 'velha', versao_data_edicao: '1978-01-01', arquivos: [{ id: 1 }] },
    { uuid_versao: 'nova-sem-arquivo', versao_data_edicao: '2024-05-01', arquivos: [] }
  ])
  assert.strictEqual(versao.uuid_versao, 'velha')
  assert.strictEqual(motivo, null)
})

test('entre versoes com arquivo, ganha a de data de edicao mais recente', () => {
  const { versao } = escolherVersao([
    { uuid_versao: 'a', versao_data_edicao: '2019-01-01', arquivos: [{ id: 1 }] },
    { uuid_versao: 'b', versao_data_edicao: '2024-05-01', arquivos: [{ id: 2 }] }
  ])
  assert.strictEqual(versao.uuid_versao, 'b')
})

test('quando NENHUMA versao tem arquivo, escolhe mas avisa', () => {
  const { versao, motivo } = escolherVersao([
    { uuid_versao: 'so-historico', versao_data_edicao: '1978-01-01', arquivos: [] }
  ])
  assert.strictEqual(versao.uuid_versao, 'so-historico')
  assert.ok(motivo && motivo.includes('nao serve para imprimir'))
})

test('produto sem versao nenhuma nao devolve versao', () => {
  assert.strictEqual(escolherVersao([]).versao, null)
})

// ---------------------------------------------------------------------------
// Casamento de cliente (a OM que o documento assina pela sigla)
// ---------------------------------------------------------------------------

const CLIENTES = [
  { id: 41, nome: '6 Regimento de Cavalaria Blindado' },
  { id: 12, nome: 'Prefeitura Municipal de Alegrete' },
  { id: 7, nome: '3 Regimento de Cavalaria Mecanizado' }
]

test('acha a OM pela palavra-chave do nome por extenso', () => {
  const r = casarClientes(CLIENTES, 'Cavalaria Blindado')
  assert.strictEqual(r[0].cliente.id, 41)
})

test('o nome exato ganha de qualquer casamento parcial', () => {
  const r = casarClientes(CLIENTES, '6 Regimento de Cavalaria Blindado')
  assert.strictEqual(r[0].cliente.id, 41)
  assert.ok(r[0].pontos >= 1000)
})

test('termo sem relacao nenhuma nao inventa um casamento', () => {
  assert.deepStrictEqual(casarClientes(CLIENTES, 'Hospital Naval'), [])
})

// ---------------------------------------------------------------------------
// Guardrails do CRUD
// ---------------------------------------------------------------------------

test('avisa exatamente quais campos o PUT parcial zeraria', () => {
  // O PUT da mapoteca substitui a linha: o servidor monta o UPDATE com default
  // null, entao campo ausente do corpo vira NULL sem erro nenhum.
  const modulo = require('../lib/recursos').obter('pedido').schema()
  const zerados = camposQueSeriamZerados(modulo, {
    id: 42, data_pedido: '2026-07-24', cliente_id: 3, situacao_pedido_id: 3
  })
  assert.ok(zerados.includes('prazo'))
  assert.ok(zerados.includes('ponto_contato'))
  assert.ok(zerados.includes('documento_solicitacao'))
  // Campo obrigatorio nunca entra na lista: ele nao pode faltar.
  assert.ok(!zerados.includes('cliente_id'))
})

test('o roteador manda o verbo de intencao para o modulo certo', () => {
  // O CRUD generico e os verbos de intencao convivem sob o mesmo nome de
  // recurso; errar aqui faria "pedido cadastrar" cair no CRUD e virar 404.
  assert.strictEqual(escolherModulo('pedido', 'cadastrar'), './comandos/pedido')
  assert.strictEqual(escolherModulo('pedido', 'situacao'), './comandos/pedido')
  assert.strictEqual(escolherModulo('pedido', 'listar'), './comandos/crud')
  assert.strictEqual(escolherModulo('cliente', 'resolver'), './comandos/resolver')
  assert.strictEqual(escolherModulo('cliente', 'listar'), './comandos/crud')
  assert.strictEqual(escolherModulo('imprimir', undefined), './comandos/pedido')
  assert.strictEqual(escolherModulo('inexistente', undefined), null)
})
