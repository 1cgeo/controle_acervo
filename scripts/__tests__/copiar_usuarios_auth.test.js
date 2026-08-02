// Path: scripts/__tests__/copiar_usuarios_auth.test.js

// Testes com node:test (embutido no Node), e nao Jest: o Jest do repositorio e
// do `server/`, com globalSetup que monta banco de teste, e um script de carga
// que nem importa o servidor nao tem por que arrastar isso.
//   Rodar: npm run test-scripts
//
// O que da para provar SEM banco e justamente o que decide a copia: como os
// argumentos sao lidos, que plano sai de duas listas de usuarios, e o que o
// relatorio diz. O SQL entra so como texto, para os testes de "isto nunca pode
// aparecer aqui".

import { test } from 'node:test'
import assert from 'node:assert'

import {
  parseArgumentos,
  montarPlano,
  formatarRelatorio,
  mascarar,
  SQL_ORIGEM,
  SQL_CRIAR,
  SQL_ATUALIZAR_SENHA,
  SQL_ATUALIZAR_SENHA_E_DADOS,
  SQL_ATUALIZAR_DADOS
} from '../copiar_usuarios_auth.js'

// Hashes bcrypt de mentira, com o formato de verdade ($2b$ + custo + 53).
const HASH_A = '$2b$10$abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXY12'
const HASH_B = '$2b$10$ZYXWVUTSRQPONMLKJIHGFEDCBAzyxwvutsrqponmlkjihgfedcb98'

const UUID_1 = '11111111-1111-1111-1111-111111111111'
const UUID_2 = '22222222-2222-2222-2222-222222222222'
const UUID_3 = '33333333-3333-3333-3333-333333333333'

const usuarioOrigem = (extra = {}) => ({
  uuid: UUID_1,
  login: 'fulano',
  senha: HASH_A,
  nome: 'Fulano de Tal',
  nome_guerra: 'Fulano',
  tipo_posto_grad_id: 13,
  ...extra
})

const usuarioDestino = (extra = {}) => ({
  uuid: UUID_1,
  login: 'fulano',
  senha: null,
  nome: 'Fulano de Tal',
  nome_guerra: 'Fulano',
  tipo_posto_grad_id: 13,
  ...extra
})

// --- Argumentos --------------------------------------------------------------

test('sem argumento nenhum, o padrao e ENSAIO', () => {
  const o = parseArgumentos([])
  assert.strictEqual(o.aplicar, false)
  assert.strictEqual(o.atualizarDados, false)
  assert.strictEqual(o.incluirNovos, false)
  assert.strictEqual(o.amostra, 10)
})

test('--aplicar, --atualizar-dados e --incluir-novos ligam o que dizem', () => {
  const o = parseArgumentos(['--aplicar', '--atualizar-dados', '--incluir-novos'])
  assert.strictEqual(o.aplicar, true)
  assert.strictEqual(o.atualizarDados, true)
  assert.strictEqual(o.incluirNovos, true)
})

test('--amostra aceita as duas formas e recusa lixo', () => {
  assert.strictEqual(parseArgumentos(['--amostra', '30']).amostra, 30)
  assert.strictEqual(parseArgumentos(['--amostra=0']).amostra, 0)
  assert.throws(() => parseArgumentos(['--amostra', 'muitas']), /inteiro/)
  assert.throws(() => parseArgumentos(['--amostra', '-1']), /inteiro/)
})

test('credencial por argumento e RECUSADA, com a razao', () => {
  // O modo de falha que este teste tranca: aceitar --senha poria a senha do
  // banco no historico do shell e no `ps` de quem estiver logado na maquina.
  for (const flag of ['--senha', '--password', '--db-url', '--conexao', '--auth-dsn']) {
    assert.throws(
      () => parseArgumentos([flag, 'seja-o-que-for']),
      /variaveis de ambiente/,
      `${flag} deveria ser recusada`
    )
  }
})

test('opcao desconhecida falha alto, em vez de ser ignorada', () => {
  assert.throws(() => parseArgumentos(['--aplicar-tudo']), /desconhecida/)
  assert.throws(() => parseArgumentos(['aplicar']), /Argumento solto/)
})

test('flag booleana nao aceita valor colado', () => {
  // `--aplicar=false` seria lido como "aplicar" e escreveria no banco.
  assert.throws(() => parseArgumentos(['--aplicar=false']), /nao recebe valor/)
})

// --- Plano -------------------------------------------------------------------

test('quem ja existe no SCA recebe SO o hash', () => {
  const plano = montarPlano([usuarioOrigem()], [usuarioDestino()])
  assert.strictEqual(plano.atualizar.length, 1)
  assert.strictEqual(plano.atualizar[0].senha, HASH_A)
  assert.strictEqual(plano.atualizar[0].dados, null)
  assert.strictEqual(plano.criar.length, 0)
})

test('nenhum item do plano carrega administrador nem ativo', () => {
  const plano = montarPlano(
    [
      usuarioOrigem({ administrador: true, ativo: true }),
      usuarioOrigem({ uuid: UUID_2, login: 'novo', administrador: true, ativo: true })
    ],
    [usuarioDestino()],
    { incluirNovos: true, atualizarDados: true }
  )
  for (const item of [...plano.atualizar, ...plano.criar]) {
    assert.ok(!('administrador' in item), 'administrador vazou para o plano')
    assert.ok(!('ativo' in item), 'ativo vazou para o plano')
    if (item.dados) {
      assert.ok(!('administrador' in item.dados))
      assert.ok(!('ativo' in item.dados))
    }
  }
})

test('--atualizar-dados leva nome, nome de guerra e posto, e nada mais', () => {
  const plano = montarPlano(
    [usuarioOrigem({ nome: 'Fulano da Silva', nome_guerra: 'Silva', tipo_posto_grad_id: 14 })],
    [usuarioDestino({ senha: HASH_A })],
    { atualizarDados: true }
  )
  assert.strictEqual(plano.atualizar.length, 1)
  assert.strictEqual(plano.atualizar[0].senha, null, 'o hash ja estava em dia')
  assert.deepStrictEqual(plano.atualizar[0].dados, {
    nome: 'Fulano da Silva',
    nomeGuerra: 'Silva',
    tipoPostoGradId: 14
  })
})

test('sem --atualizar-dados, nome divergente nao vira escrita', () => {
  const plano = montarPlano(
    [usuarioOrigem({ nome: 'Outro Nome' })],
    [usuarioDestino({ senha: HASH_A })]
  )
  assert.strictEqual(plano.atualizar.length, 0)
  assert.strictEqual(plano.inalterados.length, 1)
})

test('rodar de novo nao escreve nada: hash igual e "ja em dia"', () => {
  const plano = montarPlano([usuarioOrigem()], [usuarioDestino({ senha: HASH_A })])
  assert.strictEqual(plano.atualizar.length, 0)
  assert.strictEqual(plano.inalterados.length, 1)
  assert.strictEqual(plano.semSenhaPrevisto.length, 0)
})

test('hash diferente no destino e sobrescrito pelo da origem', () => {
  const plano = montarPlano([usuarioOrigem()], [usuarioDestino({ senha: HASH_B })])
  assert.strictEqual(plano.atualizar.length, 1)
  assert.strictEqual(plano.atualizar[0].senha, HASH_A)
})

test('a correspondencia e por uuid, nunca por login', () => {
  const plano = montarPlano(
    [usuarioOrigem({ login: 'f.tal' })],
    [usuarioDestino({ login: 'fulano' })]
  )
  assert.strictEqual(plano.atualizar.length, 1)
  assert.strictEqual(plano.atualizar[0].uuid, UUID_1)
  assert.strictEqual(plano.loginDivergente.length, 1, 'e o login diferente vira aviso')
  assert.strictEqual(plano.conflitoLogin.length, 0)
})

test('quem so existe na origem NAO entra por padrao', () => {
  const plano = montarPlano([usuarioOrigem({ uuid: UUID_2, login: 'novato' })], [])
  assert.strictEqual(plano.criar.length, 0)
  assert.strictEqual(plano.novosIgnorados.length, 1)
  assert.strictEqual(plano.novosIgnorados[0].login, 'novato')
})

test('--incluir-novos cria sem perfil, sem administrador e inativo', () => {
  const plano = montarPlano(
    [usuarioOrigem({ uuid: UUID_2, login: 'novato' })],
    [],
    { incluirNovos: true }
  )
  assert.strictEqual(plano.criar.length, 1)
  assert.deepStrictEqual(plano.criar[0], {
    uuid: UUID_2,
    login: 'novato',
    senha: HASH_A,
    nome: 'Fulano de Tal',
    nomeGuerra: 'Fulano',
    tipoPostoGradId: 13
  })
  // Perfil e coisa da tela de perfis: o plano nao tem por onde conceder um.
  assert.ok(!('perfis' in plano.criar[0]))
})

test('login ocupado por outro uuid nao vira INSERT nem UPDATE', () => {
  // Criar quebraria a UNIQUE do login e derrubaria a transacao inteira;
  // atualizar por login daria a senha de uma pessoa a outra.
  const plano = montarPlano(
    [usuarioOrigem({ uuid: UUID_2, login: 'fulano' })],
    [usuarioDestino({ uuid: UUID_3, login: 'fulano' })],
    { incluirNovos: true }
  )
  assert.strictEqual(plano.criar.length, 0)
  assert.strictEqual(plano.atualizar.length, 0)
  assert.strictEqual(plano.conflitoLogin.length, 1)
  assert.strictEqual(plano.conflitoLogin[0].login, 'fulano')
})

test('uuid repetido na origem e ERRO, e nenhum dos dois e copiado', () => {
  const plano = montarPlano(
    [usuarioOrigem({ login: 'a' }), usuarioOrigem({ login: 'b' })],
    [usuarioDestino()]
  )
  assert.strictEqual(plano.erros.length, 1)
  assert.match(plano.erros[0], /uuid repetido/)
  assert.strictEqual(plano.atualizar.length, 0)
})

test('posto que nao existe no destino e ERRO, e nao FK estourada na transacao', () => {
  const postosValidos = new Set([1, 13, 14])
  const plano = montarPlano(
    [usuarioOrigem({ uuid: UUID_2, login: 'novato', tipo_posto_grad_id: 99 })],
    [],
    { incluirNovos: true, postosValidos }
  )
  assert.strictEqual(plano.criar.length, 0)
  assert.strictEqual(plano.erros.length, 1)
  assert.match(plano.erros[0], /tipo_posto_grad_id 99/)
})

test('origem sem hash e contada, e a pessoa continua sem senha', () => {
  const plano = montarPlano([usuarioOrigem({ senha: null })], [usuarioDestino()])
  assert.strictEqual(plano.origemSemHash.length, 1)
  assert.strictEqual(plano.atualizar.length, 0)
  assert.strictEqual(plano.semSenhaPrevisto.length, 1)
  assert.match(plano.semSenhaPrevisto[0].motivo, /origem tambem nao tem hash/)
})

test('a lista de quem fica sem senha e o que o relatorio existe para dar', () => {
  const plano = montarPlano(
    [usuarioOrigem()],
    [
      usuarioDestino(),
      usuarioDestino({ uuid: UUID_2, login: 'so.no.sca', senha: null }),
      usuarioDestino({ uuid: UUID_3, login: 'ja.tem', senha: HASH_B })
    ]
  )
  assert.deepStrictEqual(
    plano.semSenhaPrevisto.map(s => s.login),
    ['so.no.sca']
  )
  assert.match(plano.semSenhaPrevisto[0].motivo, /nao existe na origem/)
  assert.strictEqual(plano.soNoDestino.length, 2)
})

test('quem esta so no SCA nao e tocado', () => {
  const plano = montarPlano(
    [],
    [usuarioDestino({ senha: HASH_B })],
    { atualizarDados: true, incluirNovos: true }
  )
  assert.strictEqual(plano.atualizar.length, 0)
  assert.strictEqual(plano.criar.length, 0)
  assert.strictEqual(plano.soNoDestino.length, 1)
})

// --- SQL ---------------------------------------------------------------------

test('nenhum SQL de escrita menciona administrador ou ativo como valor da origem', () => {
  for (const sql of [SQL_ATUALIZAR_SENHA, SQL_ATUALIZAR_SENHA_E_DADOS, SQL_ATUALIZAR_DADOS]) {
    assert.ok(!/administrador/i.test(sql), 'UPDATE nao pode tocar administrador')
    assert.ok(!/ativo/i.test(sql), 'UPDATE nao pode tocar ativo')
  }
  // No INSERT as duas colunas existem, mas com literal FALSE: nunca parametro.
  assert.match(SQL_CRIAR, /administrador, ativo/)
  assert.match(SQL_CRIAR, /FALSE, FALSE/)
  assert.ok(!/\$<administrador>/.test(SQL_CRIAR))
  assert.ok(!/\$<ativo>/.test(SQL_CRIAR))
})

test('a leitura da origem nem traz administrador e ativo', () => {
  // O que nao se le nao se copia por acidente.
  assert.ok(!/administrador/i.test(SQL_ORIGEM))
  assert.ok(!/ativo/i.test(SQL_ORIGEM))
})

test('o INSERT e idempotente', () => {
  assert.match(SQL_CRIAR, /ON CONFLICT \(uuid\) DO NOTHING/)
})

// --- Saida -------------------------------------------------------------------

test('mascarar esconde hash bcrypt em qualquer texto', () => {
  const texto = `erro ao gravar senha = '${HASH_A}' na linha 3`
  assert.ok(!mascarar(texto).includes(HASH_A))
  assert.match(mascarar(texto), /<hash>/)
})

test('o relatorio nunca imprime hash nenhum', () => {
  const plano = montarPlano(
    [usuarioOrigem(), usuarioOrigem({ uuid: UUID_2, login: 'novato', senha: HASH_B })],
    [usuarioDestino()],
    { incluirNovos: true }
  )
  const saida = formatarRelatorio(plano, { amostra: 10 }, { aplicado: false })
  assert.ok(!saida.includes(HASH_A))
  assert.ok(!saida.includes(HASH_B))
  assert.ok(saida.includes('fulano'), 'mas o login aparece, que e o que se confere')
})

test('o relatorio do ensaio diz que nada foi escrito', () => {
  const plano = montarPlano([usuarioOrigem()], [usuarioDestino()])
  const saida = formatarRelatorio(plano, {}, { aplicado: false })
  assert.match(saida, /ENSAIO/)
  assert.match(saida, /Nada foi escrito/)
  assert.match(saida, /a atualizar:\s+1/)
})

test('o relatorio conta atualizados, criados e ignorados', () => {
  const plano = montarPlano(
    [
      usuarioOrigem(),
      usuarioOrigem({ uuid: UUID_2, login: 'novato' }),
      usuarioOrigem({ uuid: UUID_3, login: 'outro' })
    ],
    [usuarioDestino()]
  )
  const saida = formatarRelatorio(plano, { amostra: 10 }, { aplicado: false })
  assert.match(saida, /a atualizar:\s+1/)
  assert.match(saida, /a criar:\s+0/)
  assert.match(saida, /so na origem:\s+2/)
  assert.match(saida, /--incluir-novos/)
})

test('com alguem sem senha, o relatorio diz que ainda nao acabou e como resolver', () => {
  const plano = montarPlano([], [usuarioDestino({ login: 'orfao' })])
  const saida = formatarRelatorio(plano, {}, { aplicado: true, semSenhaReal: [{ login: 'orfao' }] })
  assert.match(saida, /orfao/)
  assert.match(saida, /AINDA NAO ACABOU/)
  // Nao basta dizer que falta: tem de dizer ONDE se resolve. Nao ha
  // `ALTER ... SET NOT NULL` a rodar -- a coluna e anulavel nos dois caminhos,
  // para `er/` e `migrations/` convergirem (ver o cabecalho do script).
  assert.match(saida, /Resetar senha/)
})

test('sem ninguem sem senha, o relatorio diz que todo mundo consegue entrar', () => {
  const plano = montarPlano([usuarioOrigem()], [usuarioDestino()])
  const saida = formatarRelatorio(plano, {}, { aplicado: true, semSenhaReal: [] })
  assert.match(saida, /Ninguem\. Todo mundo consegue entrar/)
  assert.match(saida, /Todo usuario do SCA consegue entrar/)
})

test('o relatorio prefere a lista lida do BANCO a lista prevista', () => {
  const plano = montarPlano([], [usuarioDestino({ login: 'previsto' })])
  const saida = formatarRelatorio(plano, {}, {
    aplicado: true,
    semSenhaReal: [{ login: 'lido.do.banco' }]
  })
  assert.match(saida, /lido do banco depois da copia/)
  assert.match(saida, /lido\.do\.banco/)
  assert.ok(!saida.includes('previsto'))
})

test('a amostra respeita o teto e avisa quantos ficaram de fora', () => {
  const origem = []
  const destino = []
  for (let i = 0; i < 12; i += 1) {
    const uuid = `0000000${i}-0000-0000-0000-00000000000${i}`
    origem.push(usuarioOrigem({ uuid, login: `pessoa${i}` }))
    destino.push(usuarioDestino({ uuid, login: `pessoa${i}` }))
  }
  const plano = montarPlano(origem, destino)
  const saida = formatarRelatorio(plano, { amostra: 3 }, { aplicado: false })
  assert.match(saida, /e mais 9/)
  assert.ok(!saida.includes('pessoa5'))
})
