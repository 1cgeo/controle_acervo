'use strict'

// O guardrail que so este CLI tem: operacao em LOTE (e a irreversivel) resolve
// os uuid para NOME antes de pedir confirmacao.
//
// O alvo destes testes e a DECISAO, nao o transporte: as listagens entram por
// dependencia injetada (o terceiro argumento de `executar`), e as duas
// requisicoes de ESCRITA que importam para a saida sao trocadas no proprio
// modulo http, que e um singleton CommonJS. Nada sobe servidor.

const { test } = require('node:test')
const assert = require('node:assert')

const { parse } = require('../lib/args')
const http = require('../lib/http')
const usuario = require('../comandos/usuario')

const U1 = '3f2a1c88-0000-4000-8000-000000000001'
const U2 = '3f2a1c88-0000-4000-8000-000000000002'
const U3 = '3f2a1c88-0000-4000-8000-000000000003'

const CFG = { server: 'http://exemplo.invalido', cliente: 'sca_web' }

const USUARIOS = [
  {
    uuid: U1,
    login: 'silva',
    nome: 'Joao da Silva',
    nome_guerra: 'Silva',
    tipo_posto_grad: '1º Ten',
    administrador: true,
    ativo: true,
    senha_definida: true,
    perfis: { acervo: 3, mapoteca: 2 }
  },
  {
    uuid: U2,
    login: 'souza',
    nome: 'Maria de Souza',
    nome_guerra: 'Souza',
    tipo_posto_grad: '3º Sgt',
    administrador: false,
    ativo: true,
    senha_definida: false,
    perfis: {}
  }
]

const MODULOS = [
  { code: 1, nome: 'Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Orçamento', nome_abrev: 'orcamento' }
]

const NIVEIS = [
  { code: 1, nome: 'Consulta' },
  { code: 2, nome: 'Operador' },
  { code: 3, nome: 'Gerente' }
]

const DEPS = {
  listarUsuarios: async () => USUARIOS,
  listarModulos: async () => MODULOS,
  listarNiveis: async () => NIVEIS
}

// Listagem que nao responde: e o caso em que o CLI NAO SABE de quem sao os uuid.
const DEPS_MUDAS = {
  ...DEPS,
  listarUsuarios: async () => { throw new Error('sem rede') }
}

const rodar = (argv, deps = DEPS) => usuario.executar(parse(argv), CFG, deps)

/** Executa esperando recusa, e devolve o texto da recusa. */
async function recusa (argv, deps = DEPS) {
  try {
    await rodar(argv, deps)
  } catch (err) {
    return err
  }
  throw new Error('esperava recusa, e o comando passou')
}

// ---------------------------------------------------------------------------
// Resolucao de quem sera atingido
// ---------------------------------------------------------------------------

test('o rotulo identifica a pessoa na ordem em que um humano le', () => {
  assert.strictEqual(usuario.rotuloPessoa(USUARIOS[0]), '1º Ten Silva (silva)')
  assert.strictEqual(usuario.rotuloPessoa({ nome: 'Sem Posto' }), 'Sem Posto')
})

test('resolverPessoas separa quem existe de quem nao foi encontrado', async () => {
  const r = await usuario.resolverPessoas(CFG, [U1, U3], DEPS)
  assert.strictEqual(r.indisponivel, false)
  assert.deepStrictEqual(r.conhecidos.map(p => p.rotulo), ['1º Ten Silva (silva)'])
  assert.deepStrictEqual(r.desconhecidos, [U3])
})

// Os dois casos que parecem iguais e nao sao. Confundi-los faria o CLI afirmar
// um fato que ele nao apurou.
test('listagem muda vira "nao verificado", nunca "nao encontrado"', async () => {
  const r = await usuario.resolverPessoas(CFG, [U1], DEPS_MUDAS)
  assert.strictEqual(r.indisponivel, true)
  assert.deepStrictEqual(r.desconhecidos, [U1])

  const texto = usuario.blocoAfetados('Alvo:', r).join('\n')
  assert.ok(texto.includes('(nao verificado)'))
  assert.ok(texto.includes('confirmando as cegas'))
  assert.ok(!texto.includes('NAO ENCONTRADO'))
})

test('o bloco marca administrador e quem ja esta inativo', () => {
  const pessoas = {
    conhecidos: [
      { uuid: U1, rotulo: 'A', administrador: true, ativo: true },
      { uuid: U2, rotulo: 'B', administrador: false, ativo: false }
    ],
    desconhecidos: [],
    indisponivel: false
  }
  const texto = usuario.blocoAfetados('Alvo:', pessoas).join('\n')
  assert.ok(texto.includes('ADMINISTRADOR'))
  assert.ok(texto.includes('ja inativo'))
})

// ---------------------------------------------------------------------------
// Reset de senha: o lote de maior raio de explosao
// ---------------------------------------------------------------------------

test('resetar-senha sem --confirmar recusa MOSTRANDO os nomes, nao os uuid', async () => {
  const err = await recusa(['usuario', 'resetar-senha', '--uuids', `${U1},${U2}`])

  assert.ok(err.jaFormatado, 'a recusa sai formatada, sem o prefixo [erro]')
  assert.ok(err.message.includes('1º Ten Silva (silva)'), 'falta o nome da primeira pessoa')
  assert.ok(err.message.includes('3º Sgt Souza (souza)'), 'falta o nome da segunda pessoa')
  assert.ok(err.message.includes('2 pessoa(s)'))
  assert.ok(err.message.includes('--confirmar 2'), 'a confirmacao e pela CONTAGEM')
})

// A exigencia do enunciado, e o motivo de o verbo existir: quem confirma precisa
// saber o que a senha vira.
test('resetar-senha diz, com todas as letras, que a senha vira o LOGIN', async () => {
  const err = await recusa(['usuario', 'resetar-senha', '--uuids', U1])
  assert.ok(/senha de cada uma passa a ser o LOGIN dela/.test(err.message))
  assert.ok(err.message.includes('quem souber o login'))
  assert.ok(err.message.includes('Avise cada uma'))
})

test('resetar-senha nao aceita confirmacao copiada de outro comando', async () => {
  // --confirmar com o uuid (a forma do `excluir`) nao passa aqui: a confirmacao
  // de lote e a quantidade, justamente para obrigar a olhar quantos sao.
  const err = await recusa(['usuario', 'resetar-senha', '--uuids', `${U1},${U2}`, '--confirmar', U1])
  assert.ok(err.message.includes('Nao confirmado'))
})

test('resetar-senha avisa quando um uuid nao esta na listagem', async () => {
  const err = await recusa(['usuario', 'resetar-senha', '--uuids', `${U1},${U3}`])
  assert.ok(err.message.includes('NAO ENCONTRADO'))
  assert.ok(err.message.includes('uuid errado atinge a pessoa errada'))
})

test('resetar-senha recusa uuid invalido pelo schema vivo, antes da rede', async () => {
  const err = await recusa(['usuario', 'resetar-senha', '--uuids', 'nao-e-uuid', '--confirmar', '1'])
  assert.ok(err.message.includes('nada foi enviado'))
})

test('resetar-senha confirmado e com --dry-run mostra a requisicao e nao envia', async () => {
  const r = await rodar([
    'usuario', 'resetar-senha', '--uuids', `${U1},${U2}`, '--confirmar', '2', '--dry-run'
  ])
  assert.ok(r.texto.includes('[dry-run] nada foi enviado'))
  assert.ok(r.texto.includes('POST /api/usuarios/senha/reset'))
  assert.ok(r.texto.includes('1º Ten Silva (silva)'), 'o bloco de afetados continua na saida')
})

// ---------------------------------------------------------------------------
// Exclusao: a recusa do servidor tem de chegar inteira
// ---------------------------------------------------------------------------

test('excluir sem --confirmar recusa e ensina a DESATIVAR', async () => {
  const err = await recusa(['usuario', 'excluir', '--uuid', U1])
  assert.ok(err.message.includes('1º Ten Silva (silva)'))
  assert.ok(err.message.includes('se desativa'))
  assert.ok(err.message.includes(`--confirmar ${U1}`))
})

// A armadilha do enunciado: o DELETE quase sempre volta 400 dizendo para
// desativar. Trocar essa frase por uma generica seria substituir a instrucao
// pelo codigo de status.
test('a mensagem do servidor no 400 do DELETE sai INTEIRA', async () => {
  const original = http.autenticada
  const doServidor = 'Usuário já possui registros no sistema e não pode ser excluído. Desative-o.'
  http.autenticada = async () => { throw new http.ErroHttp(400, doServidor) }
  try {
    const err = await recusa(['usuario', 'excluir', '--uuid', U1, '--confirmar', U1])
    assert.ok(err.message.includes(doServidor), 'a frase do servidor precisa aparecer literal')
    assert.ok(err.message.includes('HTTP 400'))
    assert.ok(err.message.includes('normalmente e o esperado'))
    assert.ok(err.message.includes('"ativo": false'), 'falta o comando de desativar, que e a saida')
  } finally {
    http.autenticada = original
  }
})

test('a trava do ultimo administrador tambem chega inteira', async () => {
  const original = http.autenticada
  const doServidor = 'Operação bloqueada: este é o último administrador ativo do sistema'
  http.autenticada = async () => { throw new http.ErroHttp(400, doServidor) }
  try {
    const err = await recusa(['usuario', 'excluir', '--uuid', U1, '--confirmar', U1])
    assert.ok(err.message.includes(doServidor))
  } finally {
    http.autenticada = original
  }
})

// ---------------------------------------------------------------------------
// Perfil por modulo
// ---------------------------------------------------------------------------

test('montarPerfis aceita o nivel por numero e por nome do dominio vivo', () => {
  assert.deepStrictEqual(
    usuario.montarPerfis(['acervo=2', 'mapoteca=Gerente'], [], NIVEIS, MODULOS),
    { acervo: 2, mapoteca: 3 }
  )
})

test('montarPerfis revoga com null, que e o que REMOVE o acesso', () => {
  assert.deepStrictEqual(
    usuario.montarPerfis([], ['orcamento'], NIVEIS, MODULOS),
    { orcamento: null }
  )
})

test('montarPerfis recusa modulo e nivel que nao existem no dominio', () => {
  assert.throws(() => usuario.montarPerfis(['producao=1'], [], NIVEIS, MODULOS), /Modulo desconhecido/)
  assert.throws(() => usuario.montarPerfis(['acervo=chefe'], [], NIVEIS, MODULOS), /Nivel de perfil desconhecido/)
  assert.throws(() => usuario.montarPerfis(['acervo'], [], NIVEIS, MODULOS), /modulo=nivel/)
})

// O corpo tem uma chave so por modulo: sem esta recusa, a ultima venceria em
// silencio e metade do que se pediu nao aconteceria.
test('montarPerfis recusa o mesmo modulo em conceder e revogar', () => {
  assert.throws(
    () => usuario.montarPerfis(['acervo=1'], ['acervo'], NIVEIS, MODULOS),
    /ao mesmo tempo/
  )
})

test('diffPerfis classifica conceder, subir, descer e revogar', () => {
  const diff = usuario.diffPerfis(
    { acervo: 3, mapoteca: 2, orcamento: 1 },
    { acervo: 3, mapoteca: 1, orcamento: null, producao: 2 }
  )
  const porModulo = Object.fromEntries(diff.map(d => [d.modulo, d.tipo]))
  assert.strictEqual(porModulo.acervo, 'igual')
  assert.strictEqual(porModulo.mapoteca, 'desce')
  assert.strictEqual(porModulo.orcamento, 'revoga')
  assert.strictEqual(porModulo.producao, 'concede')
  assert.deepStrictEqual(usuario.tiraAcesso(diff).map(d => d.modulo), ['mapoteca', 'orcamento'])
})

test('conceder acesso nao pede confirmacao e reenvia administrador/ativo intactos', async () => {
  const original = http.autenticada
  let enviado = null
  http.autenticada = async (cfg, metodo, caminho, opcoes) => {
    enviado = { metodo, caminho, corpo: opcoes.corpo }
    return { message: 'Usuário atualizado com sucesso' }
  }
  try {
    const r = await rodar(['usuario', 'perfis', '--uuid', U2, '--conceder', 'acervo=consulta'])
    assert.ok(r.texto.includes('concede'))
    assert.strictEqual(enviado.metodo, 'PUT')
    assert.strictEqual(enviado.caminho, `/usuarios/${U2}`)
    assert.deepStrictEqual(enviado.corpo, {
      administrador: false,
      ativo: true,
      perfis: { acervo: 1 }
    })
  } finally {
    http.autenticada = original
  }
})

// Sem reenviar os dois booleanos lidos da listagem, "conceder consulta no
// acervo" viraria 400 (eles sao obrigatorios) ou, pior, desativaria a pessoa.
test('o corpo do perfis carrega administrador de quem E administrador', async () => {
  const original = http.autenticada
  let enviado = null
  http.autenticada = async (cfg, metodo, caminho, opcoes) => {
    enviado = opcoes.corpo
    return { message: 'ok' }
  }
  try {
    await rodar(['usuario', 'perfis', '--uuid', U1, '--conceder', 'orcamento=1'])
    assert.strictEqual(enviado.administrador, true)
    assert.strictEqual(enviado.ativo, true)
  } finally {
    http.autenticada = original
  }
})

test('revogar acesso EXIGE --confirmar com o uuid', async () => {
  const err = await recusa(['usuario', 'perfis', '--uuid', U1, '--revogar', 'mapoteca'])
  assert.ok(err.message.includes('REVOGA'))
  assert.ok(err.message.includes('TIRAM acesso'))
  assert.ok(err.message.includes(`--confirmar ${U1}`))
})

test('rebaixar tambem exige --confirmar: perder nivel e perder acesso', async () => {
  const err = await recusa(['usuario', 'perfis', '--uuid', U1, '--conceder', 'acervo=1'])
  assert.ok(err.message.includes('DESCE'))
  assert.ok(err.message.includes('TIRAM acesso'))
})

test('perfis sem --conceder nem --revogar so MOSTRA o que a pessoa alcanca', async () => {
  const r = await rodar(['usuario', 'perfis', '--uuid', U1])
  assert.ok(r.texto.includes('acervo'))
  assert.ok(r.texto.includes('3 (Gerente)'), 'o nivel sai com o nome do dominio vivo')
  const semNada = await rodar(['usuario', 'perfis', '--uuid', U2])
  assert.ok(semNada.texto.includes('entra e nao ve nada'))
})

test('perfis recusa agir quando nao conseguiu identificar a pessoa', async () => {
  const err = await recusa(['usuario', 'perfis', '--uuid', U1, '--conceder', 'acervo=1'], DEPS_MUDAS)
  assert.ok(err.message.includes('nao verificado'))
  assert.ok(err.message.includes('chutar qualquer um deles'))
})

// ---------------------------------------------------------------------------
// Lote de edicao e higiene da saida
// ---------------------------------------------------------------------------

test('editar-lista resolve os nomes e confirma pela contagem', async () => {
  const corpo = JSON.stringify({
    usuarios: [
      { uuid: U1, administrador: true, ativo: true },
      { uuid: U2, administrador: false, ativo: false }
    ]
  })
  const err = await recusa(['usuario', 'editar-lista', '--data', corpo])
  assert.ok(err.message.includes('1º Ten Silva (silva)'))
  assert.ok(err.message.includes('3º Sgt Souza (souza)'))
  assert.ok(err.message.includes('1 delas ficam INATIVAS'))
  assert.ok(err.message.includes('--confirmar 2'))
})

test('ecoSeguro tira a senha do eco, inclusive dentro de lista', () => {
  const eco = usuario.ecoSeguro({
    login: 'fulano',
    senha: 'segredo123', // path-ok: fixture
    usuarios: [{ uuid: U1, senha_nova: 'outra' }]
  })
  assert.strictEqual(eco.senha, '***')
  assert.strictEqual(eco.usuarios[0].senha_nova, '***')
  assert.strictEqual(eco.login, 'fulano')
})

test('criar avisa que sem `perfis` a pessoa entra e nao ve nada', async () => {
  const corpo = JSON.stringify({
    login: 'fulano',
    senha: 'segredo123', // path-ok: fixture
    nome: 'Fulano de Tal',
    nome_guerra: 'Fulano',
    tipo_posto_grad_id: 5,
    administrador: false,
    ativo: true
  })
  const r = await rodar(['usuario', 'criar', '--data', corpo, '--dry-run'])
  assert.ok(r.avisos.some(a => a.includes('SEM acesso a modulo nenhum')))
  assert.ok(r.texto.includes('"senha": "***"'), 'a senha nao pode sair no eco do dry-run')
  assert.ok(!r.texto.includes('segredo123'))
})

test('editar avisa que ativo=false corta o login em todos os modulos', async () => {
  const r = await rodar([
    'usuario', 'editar', '--uuid', U1,
    '--data', '{"administrador": false, "ativo": false}', '--dry-run'
  ])
  assert.ok(r.avisos.some(a => a.includes('TODOS os modulos')))
  assert.ok(r.texto.includes(`PUT /api/usuarios/${U1}`))
})

test('obter recorta da listagem e diz que o fez', async () => {
  const r = await rodar(['usuario', 'obter', '--uuid', U2])
  assert.ok(r.texto.includes('souza'))
  assert.ok(r.avisos.some(a => a.includes('nao tem rota de usuario por uuid')))
})

test('listar filtra no cliente e ANUNCIA que o filtro nao e do servidor', async () => {
  const r = await rodar(['usuario', 'listar', '--sem-senha'])
  assert.ok(r.texto.includes('souza'))
  assert.ok(!r.texto.includes('silva'))
  assert.ok(r.avisos.some(a => a.includes('no CLIENTE')))
})
