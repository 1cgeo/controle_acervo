'use strict'

// Testa o formatador de contrato e a validacao local CONTRA OS SCHEMAS REAIS do
// server/, nao contra mocks. E de proposito: o valor do CLI e nao ter copia do
// contrato, e um teste com schema falso testaria justamente a copia.
// Em troca, estes testes quebram quando o contrato de identidade muda, que e o
// alarme que se quer ter.

const { test } = require('node:test')
const assert = require('node:assert')

const esquema = require('../lib/schema')
const { RECURSOS, obter } = require('../lib/recursos')
const { clientesAceitos } = require('../lib/config')

const schemaUsuario = obter('usuario').schema()
const schemaAcessos = obter('acessos').schema()
const schemaLogin = obter('login').schema()

test('marca os obrigatorios e le os tipos do Joi vivo', () => {
  const campos = esquema.camposDe(schemaUsuario.criaUsuario)
  const porNome = Object.fromEntries(campos.map(c => [c.nome, c]))

  assert.strictEqual(porNome.login.obrigatorio, true)
  assert.strictEqual(porNome.senha.obrigatorio, true)
  assert.strictEqual(porNome.administrador.obrigatorio, true)
  assert.strictEqual(porNome.perfis.obrigatorio, false)
  assert.strictEqual(porNome.tipo_posto_grad_id.tipo, 'int>0')
})

// A armadilha real de quem monta o corpo por JSON na linha de comando: mandar
// "true" (string) onde o schema quer true. O .strict() dos dois booleanos e o
// que faz o servidor recusar em vez de coagir.
test('anota o .strict() de administrador e ativo', () => {
  const campos = esquema.camposDe(schemaUsuario.updateUsuario)
  for (const nome of ['administrador', 'ativo']) {
    const campo = campos.find(c => c.nome === nome)
    assert.ok(campo.notas.some(n => n.includes('strict')), `${nome} perdeu a anotacao de strict`)
  }
  const r = esquema.validarCorpo(schemaUsuario.updateUsuario, { administrador: 'false', ativo: true })
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.campo === 'administrador'))
})

// `perfis` e declarado por PATTERN, e nao por chaves. Sem render proprio, o
// campo que concede e revoga acesso seria o unico do CLI sem forma anunciada.
test('renderiza o mapa `perfis`, que vem de .pattern() e nao de .keys()', () => {
  const campos = esquema.camposDe(schemaUsuario.criaUsuario)
  const perfis = campos.find(c => c.nome === 'perfis')
  assert.strictEqual(perfis.tipo, 'object')
  const nota = perfis.notas.join(' ')
  assert.ok(nota.includes('mapa'), 'falta o rotulo do mapa')
  assert.ok(nota.includes('int 1..3'), 'faltam os limites do nivel, que saem das rules do Joi')
  assert.ok(nota.includes('null'), 'falta o null, que e o que REMOVE o acesso ao modulo')
})

test('o PUT de identidade nao tem default nenhum: omitir vale "nao mexe"', () => {
  // Um .default() aqui injetaria a chave e apagaria o nome de quem so foi
  // ativado (quem preenche o valor atual e o preserveOmitted do controlador).
  // Se um default voltar, este teste cai antes de alguem perder um cadastro.
  const campos = esquema.camposDe(schemaUsuario.updateUsuario)
  for (const c of campos) {
    assert.ok(
      !c.notas.some(n => String(n).startsWith('default')),
      `${c.nome} ganhou default no PUT: chave ausente precisa continuar significando "nao mexe"`
    )
  }
})

test('a lista do reset e de uuid, com minimo 1 e sem repetidos', () => {
  const campos = esquema.camposDe(schemaUsuario.listaUsuario)
  const usuarios = campos.find(c => c.nome === 'usuarios')
  assert.ok(usuarios.tipo.startsWith('array<uuid>'), `tipo inesperado: ${usuarios.tipo}`)
  assert.ok(usuarios.tipo.includes('>=1'))
  assert.ok(usuarios.tipo.includes('unico'), 'o .unique() e o que impede resetar duas vezes a mesma pessoa')
})

test('desce no array de objetos do PUT em lote', () => {
  const campos = esquema.camposDe(schemaUsuario.updateUsuarioLista)
  const lista = campos.find(c => c.nome === 'usuarios')
  assert.ok(lista.tipo.startsWith('array<object>'))
  const filhos = lista.filhos.map(f => f.nome)
  assert.deepStrictEqual(filhos, ['uuid', 'administrador', 'ativo', 'perfis'])
})

test('os limites de acessos saem do Joi, e o CLI nao os repete', () => {
  const campos = esquema.camposDe(schemaAcessos.loginsUsuariosQuery)
  const porNome = Object.fromEntries(campos.map(c => [c.nome, c]))

  assert.ok(porNome.total.tipo.startsWith('int 1..'), `tipo inesperado: ${porNome.total.tipo}`)
  assert.ok(porNome.total.notas.some(n => n.startsWith('default ')))
  assert.ok(porNome.max.notas.some(n => n.startsWith('default ')))

  // O teto so existe no schema: se ele mudar la, muda aqui no mesmo commit.
  const r = esquema.validarQuery(schemaAcessos.loginsDiaQuery, { total: 100000 })
  assert.strictEqual(r.ok, false)
  assert.ok(r.erros.some(e => e.campo === 'total'))
})

test('o default da query e aplicado localmente igual ao servidor', () => {
  const r = esquema.validarQuery(schemaAcessos.loginsDiaQuery, {})
  assert.strictEqual(r.ok, true)
  assert.ok(Number.isInteger(r.valor.total), 'o default do Joi precisa chegar ao valor validado')
})

test('a lista de clientes de auth vem do .valid() do login, nunca copiada', () => {
  const doJoi = esquema.sufixoValores(schemaLogin.login.describe().keys.cliente)
  assert.ok(doJoi.startsWith(' ='), '.valid() precisa sair como lista exaustiva')
  for (const cliente of clientesAceitos()) {
    assert.ok(doJoi.includes(cliente), `${cliente} sumiu do contrato`)
  }
  assert.ok(clientesAceitos().length >= 1)
})

test('nao vaza o sentinela {override:true} do describe do Joi', () => {
  // Regressao: o Joi injeta {override:true} no allow de um .valid(), e sem
  // filtrar isso o agente lia um valor a mais como se fosse aceito.
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(!texto.includes('override'), `o sentinela vazou em ${chave}`)
  }
})

// O contrato tem de mostrar a linha que se DIGITA. O recurso `efetivo` tem o
// mesmo nome do programa e verbos de primeiro nivel, entao ali a chave nao se
// repete: `efetivo periodos criar`, nunca `efetivo efetivo periodos criar`.
test('todo recurso da registry renderiza contrato sem quebrar', () => {
  for (const chave of Object.keys(RECURSOS)) {
    const texto = esquema.contrato(chave, RECURSOS[chave])
    assert.ok(texto.length > 0, `${chave} devolveu contrato vazio`)
    for (const acao of Object.keys(RECURSOS[chave].operacoes)) {
      assert.ok(
        texto.includes(esquema.invocacao(chave, acao)),
        `${chave} nao listou ${acao}`
      )
    }
  }
})

test('a invocacao nao repete o nome do programa', () => {
  assert.strictEqual(esquema.invocacao('efetivo', 'periodos criar'), 'efetivo periodos criar')
  assert.strictEqual(esquema.invocacao('usuario', 'listar'), 'efetivo usuario listar')

  const texto = esquema.contrato('efetivo', RECURSOS.efetivo)
  assert.ok(!texto.includes('efetivo efetivo'), 'a linha impressa precisa ser um comando de verdade')
})

test('toda operacao da registry aponta uma chave que existe no schema', () => {
  // Este teste e o alarme: se o server/ renomear um schema, ele quebra aqui em
  // vez de quebrar num 500 no meio de uma alteracao de acesso.
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

// Identidade e PLATAFORMA: nenhuma rota daqui leva prefixo de modulo. Se alguma
// ganhar /acervo, /mapoteca ou /orcamento na frente, foi engano de classificacao
// (ja aconteceu uma vez neste repositorio, noutra feature).
test('nenhuma rota de identidade leva prefixo de modulo', () => {
  for (const [chave, recurso] of Object.entries(RECURSOS)) {
    for (const [acao, op] of Object.entries(recurso.operacoes)) {
      assert.ok(
        !/^\/(acervo|mapoteca|orcamento)\b/.test(op.caminho),
        `${chave} ${acao} aponta ${op.caminho}, que tem prefixo de modulo`
      )
    }
  }
})

// Nao ha catalogo de aplicacao no SCA: um recurso `aplicacao` aqui seria
// contrato inventado.
test('nao existe recurso de aplicacao', () => {
  assert.ok(!('aplicacao' in RECURSOS))
  assert.ok(!('aplicacoes' in RECURSOS))
})

test('validarCorpo recusa corpo incompleto sem tocar a rede', () => {
  const r = esquema.validarCorpo(schemaUsuario.updateUsuario, { ativo: false })
  assert.strictEqual(r.ok, false)
  assert.ok(
    r.erros.some(e => e.campo === 'administrador'),
    'mandar so {"ativo": false} e 400: administrador tambem e obrigatorio'
  )
})

test('validarCorpo aceita corpo completo e nao inventa campo', () => {
  const r = esquema.validarCorpo(schemaUsuario.updateUsuario, {
    administrador: false,
    ativo: true
  })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, [])
  assert.ok(!('nome' in r.valor), 'chave ausente tem de continuar ausente: quem preserva e o servidor')
})

test('acusa campo com nome errado, que o servidor descartaria calado', () => {
  const r = esquema.validarCorpo(schemaUsuario.criaUsuario, {
    login: 'fulano',
    senha: 'x',
    nome: 'Fulano de Tal',
    nome_guerra: 'Fulano',
    tipo_posto_grad_id: 5,
    administrador: false,
    ativo: true,
    perfil: { acervo: 1 }
  })
  assert.strictEqual(r.ok, true)
  assert.deepStrictEqual(r.descartados, ['perfil'],
    'o nome certo e `perfis`; sem este aviso a pessoa nasceria sem acesso nenhum e ninguem saberia')
})

test('explicarErro imprime o contrato so dos campos que falharam', () => {
  const r = esquema.validarCorpo(schemaUsuario.criaUsuario, {
    login: 'fulano',
    nome: 'Fulano de Tal',
    nome_guerra: 'Fulano',
    tipo_posto_grad_id: 5,
    administrador: false,
    ativo: true
  })
  const texto = esquema.explicarErro(schemaUsuario.criaUsuario, r.erros)

  assert.ok(texto.includes('nada foi enviado'))
  assert.ok(texto.includes('senha'), 'falta o obrigatorio que falta')
  assert.ok(!texto.includes('nome_guerra'), 'trouxe campo que nao falhou')
})

test('explicarErro acha o campo dentro do array do PUT em lote', () => {
  const r = esquema.validarCorpo(schemaUsuario.updateUsuarioLista, {
    usuarios: [{ uuid: 'nao-e-uuid', administrador: false, ativo: true }]
  })
  assert.strictEqual(r.ok, false)
  const texto = esquema.explicarErro(schemaUsuario.updateUsuarioLista, r.erros)
  assert.ok(texto.includes('contrato dos campos citados'), 'nao casou o path "usuarios.0.uuid"')
})
