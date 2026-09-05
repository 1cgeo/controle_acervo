'use strict'

const { test } = require('node:test')
const assert = require('node:assert')

const saida = require('../lib/saida')

// Amostra no formato que o GET /usuarios devolve (colunas reais do SELECT de
// usuario_ctrl.js, inclusive `perfis` como mapa e `senha_definida` derivado).
const USUARIOS = [
  {
    uuid: '3f2a1c88-0000-4000-8000-000000000001',
    login: 'silva',
    nome: 'Joao da Silva',
    tipo_posto_grad_id: 5,
    tipo_posto_grad: '1º Ten',
    nome_guerra: 'Silva',
    administrador: true,
    ativo: true,
    senha_definida: true,
    perfis: { acervo: 3, mapoteca: 2 }
  },
  {
    uuid: '3f2a1c88-0000-4000-8000-000000000002',
    login: 'souza',
    nome: 'Maria de Souza',
    tipo_posto_grad_id: 9,
    tipo_posto_grad: '3º Sgt',
    nome_guerra: 'Souza',
    administrador: false,
    ativo: true,
    senha_definida: false,
    perfis: {}
  }
]

test('celula trata nulo, booleano e instante ISO', () => {
  assert.strictEqual(saida.celula('nome_guerra', null), '-')
  assert.strictEqual(saida.celula('administrador', true), 'sim')
  assert.strictEqual(saida.celula('ativo', false), 'nao')
  // Aqui a HORA e a informacao (ao contrario do acervo): `ultimo_login` responde
  // "quem esta no sistema agora".
  assert.strictEqual(saida.celula('ultimo_login', '2026-08-02T14:35:10.000Z'), '2026-08-02 14:35')
})

test('perfis sai com o NOME do modulo, nunca so a contagem', () => {
  // O mapa modulo -> nivel e a resposta da pergunta "o que essa pessoa alcanca".
  // Renderizado como "{2}" ele diria quantos modulos e nenhum dos nomes.
  assert.strictEqual(saida.celula('perfis', { acervo: 3, mapoteca: 2 }), 'acervo=3;mapoteca=2')
  assert.strictEqual(saida.celula('perfis', {}), '-')
  assert.strictEqual(saida.celula('perfis', { acervo: null }), 'acervo=null')
})

test('objeto aninhado continua virando contagem, para nao explodir a linha', () => {
  assert.strictEqual(saida.objetoRaso({ a: { b: 1 }, c: 2 }), '{2}')
})

// O unico CLI cujas respostas encostam em credencial. Se este teste cair, a
// senha ou o token de alguem passou a sair em transcricao e em log.
test('senha e token NUNCA saem na saida, nem truncados', () => {
  assert.strictEqual(saida.celula('senha', 'segredo123'), '***')
  assert.strictEqual(saida.celula('senha_nova', 'outra'), '***')
  assert.strictEqual(saida.celula('token', 'eyJhbGciOi...'), '***')
  assert.strictEqual(saida.celula('senha_definida', true), 'sim',
    'senha_definida e um booleano derivado, nao um segredo: precisa continuar visivel')
  assert.strictEqual(saida.celula('senha', null), '-')
})

test('sem --campos usa as colunas padrao do recurso, nao todas', () => {
  const padrao = ['uuid', 'login', 'ativo']
  const { colunas } = saida.escolherColunas(USUARIOS, null, padrao)
  assert.deepStrictEqual(colunas, padrao)
})

test('--campos tem precedencia sobre o padrao', () => {
  const { colunas } = saida.escolherColunas(USUARIOS, ['login', 'perfis'], ['uuid'])
  assert.deepStrictEqual(colunas, ['login', 'perfis'])
})

test('coluna inexistente vira aviso, nunca coluna vazia calada', () => {
  const { colunas, faltam } = saida.escolherColunas(USUARIOS, ['login', 'turno'], null)
  assert.deepStrictEqual(colunas, ['login'])
  assert.deepStrictEqual(faltam, ['turno'])
})

test('o recorte reduz mesmo o tamanho da saida', () => {
  // A razao de ser do --campos: e o teste que falha se o recorte parar de valer.
  const completo = saida.lista(USUARIOS, { formato: 'json' }).texto
  const recortado = saida.lista(USUARIOS, {
    formato: 'tsv',
    campos: ['login', 'ativo', 'perfis']
  }).texto

  assert.ok(
    recortado.length < completo.length / 3,
    `esperava recorte de pelo menos 3x, obtive ${completo.length} -> ${recortado.length}`
  )
})

test('tsv poe uma linha de cabecalho e uma por registro', () => {
  const { texto } = saida.lista(USUARIOS, { formato: 'tsv', campos: ['login', 'perfis'] })
  const linhas = texto.split('\n').filter(l => l && !l.startsWith('('))
  assert.strictEqual(linhas[0], 'login\tperfis')
  assert.strictEqual(linhas.length, 3)
  assert.ok(linhas[1].includes('acervo=3'))
})

test('lista vazia diz que esta vazia, em vez de sair em branco', () => {
  assert.strictEqual(saida.lista([], {}).texto, '(nenhum registro)')
})

test('lista vazia com --json sai como [], e nao como prosa', () => {
  // Quem encadeia faz JSON.parse da saida, e o caso mais comum e justamente a
  // consulta que nao achou nada: '(nenhum registro)' quebrava o parse ali.
  assert.strictEqual(saida.lista([], { formato: 'json' }).texto, '[]')
  assert.deepStrictEqual(JSON.parse(saida.lista([], { formato: 'json' }).texto), [])
})

test('o rodape conta registros e quantas colunas foram omitidas', () => {
  const { texto } = saida.lista(USUARIOS, { formato: 'tsv', campos: ['login'] })
  assert.ok(texto.includes('2 registros'))
  assert.ok(/1 de \d+ colunas/.test(texto))
})

test('--json devolve tudo, sem recorte', () => {
  const { texto } = saida.lista(USUARIOS, { formato: 'json', campos: ['login'] })
  const voltou = JSON.parse(texto)
  assert.strictEqual(voltou.length, 2)
  assert.ok('uuid' in voltou[0], 'o --json precisa manter todas as colunas')
  assert.deepStrictEqual(voltou[0].perfis, { acervo: 3, mapoteca: 2 })
})

test('registro unico sai como pares chave e valor', () => {
  const texto = saida.registro(USUARIOS[0], { campos: ['login', 'perfis'] })
  assert.ok(texto.includes('login'))
  assert.ok(texto.includes('acervo=3'))
  assert.ok(!texto.includes('uuid'))
})

test('contagem de acesso sai com separador de milhar', () => {
  assert.strictEqual(saida.celula('logins', 1234), '1.234')
  assert.strictEqual(saida.celula('usuarios_ativos', 12), '12')
})

// ---------------------------------------------------------------------------
// `--json` puro: quem encadeia faz JSON.parse do stdout INTEIRO
// ---------------------------------------------------------------------------
//
// Ate 2026-09-05 `usuario dominios --json` imprimia TRES arrays JSON separados
// por rotulos em prosa, e a saida inteira nao era JSON nenhum. Agora os tres
// saem num objeto so, com a chave de cada um sendo o nome da tabela de dominio.

const http = require('../lib/http')
const usuario = require('../comandos/usuario')

test('usuario dominios --json sai como um objeto so, com os tres dominios', async () => {
  const antes = http.autenticada
  http.autenticada = async (cfg, metodo, caminho) => {
    if (caminho.endsWith('tipo_posto_grad')) return { dados: [{ code: 1, nome_abrev: 'Cel', nome: 'Coronel' }] }
    if (caminho.endsWith('modulo')) return { dados: [{ code: 1, nome_abrev: 'acervo', nome: 'Acervo' }] }
    return { dados: [{ code: 2, nome: 'Operador' }] }
  }
  try {
    const r = await usuario.executar({ _: ['usuario', 'dominios'], flags: { json: true } }, {})
    const voltou = JSON.parse(r.texto)
    assert.strictEqual(voltou.tipo_posto_grad[0].nome_abrev, 'Cel')
    assert.strictEqual(voltou.modulo[0].nome_abrev, 'acervo')
    assert.strictEqual(voltou.tipo_perfil[0].code, 2)
  } finally {
    http.autenticada = antes
  }
})

test('registro ausente com --json sai como null, e nao como (vazio)', () => {
  assert.strictEqual(JSON.parse(saida.registro(null, { formato: 'json' })), null)
  assert.strictEqual(saida.registro(null, {}), '(vazio)')
})
