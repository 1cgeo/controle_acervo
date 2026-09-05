// Path: scripts/__tests__/check_vazamento.test.js

// O guard anti-vazamento e o que separa este repositorio PUBLICO de um vazamento
// de credencial, e ate 2026-09-05 ele nao tinha teste nenhum. O custo caro dele e
// o FALSO NEGATIVO: um achado que ele deixa passar vira commit publico, e o
// commit publico nao se desfaz. Entao o que este arquivo prova, antes de tudo, e
// que as formas REAIS deste repositorio sao pegas -- as cinco chaves do
// `config.env`, o UNC, a letra de unidade e o IP interno.
//
// O guard e Python e nao tem runner Python no projeto (`scripts/README.md`: os
// testes daqui sao `node:test`, rodados por `npm run test-scripts`). Entao este
// arquivo CHAMA o interpretador e le a resposta em JSON. Sem Python na maquina os
// casos sao PULADOS, e nao reprovados: o guard e do pre-commit, e nao de quem so
// roda a suite.
//
// As linhas de fixture levam o marcador `path-ok` porque elas SAO o exemplo da
// propria regra, que e para isso que o marcador existe.

import { test } from 'node:test'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const GUARD = path.join(AQUI, '..', 'check_vazamento.py')

// Driver minimo: importa o guard pelo caminho e devolve o resultado de
// varrer_linha() de cada caso, em JSON.
const DRIVER = [
  'import importlib.util, json, sys',
  'spec = importlib.util.spec_from_file_location("cv", sys.argv[1])',
  'm = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(m)',
  'casos = json.loads(sys.stdin.read())',
  'json.dump([m.varrer_linha(c) for c in casos], sys.stdout)'
].join('\n')

function acharPython () {
  for (const exe of ['python', 'python3', 'py']) {
    const r = spawnSync(exe, ['-c', 'print(1)'], { encoding: 'utf8' })
    if (r.status === 0 && String(r.stdout).trim() === '1') return exe
  }
  return null
}

const PYTHON = acharPython()
const semPython = PYTHON ? false : 'Python nao encontrado nesta maquina'

/** Roda o guard sobre cada linha e devolve um array de arrays de achados. */
function varrer (linhas) {
  const r = spawnSync(PYTHON, ['-c', DRIVER, GUARD], {
    input: JSON.stringify(linhas),
    encoding: 'utf8'
  })
  assert.strictEqual(r.status, 0, `o driver falhou: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

const pegou = linha => varrer([linha])[0].length > 0

// Senha de mentira, com cara de senha de verdade: nenhuma palavra dentro dela,
// para nao cair em nenhum dos filtros de placeholder.
const VALOR_FALSO = 'Xg7kQm2pLw9z'

test('as chaves de credencial DESTE repositorio sao pegas com valor', { skip: semPython }, () => {
  // Era o buraco: o `\b` do nome nao casa depois de `_` nem no meio de camelCase,
  // entao `password=x` era barrado e `DB_PASSWORD=x` passava -- e `DB_PASSWORD` e
  // justamente o nome real da chave (`.env.example`).
  const casos = [
    'DB_PASSWORD=' + VALOR_FALSO, // path-ok
    'AUTH_DB_PASSWORD=' + VALOR_FALSO, // path-ok
    'SCA_SENHA=' + VALOR_FALSO, // path-ok
    'JWT_SECRET=' + VALOR_FALSO, // path-ok
    'PGPASSWORD=' + VALOR_FALSO, // path-ok
    'export DB_PASSWORD=' + VALOR_FALSO, // path-ok
    'db_password: ' + VALOR_FALSO, // path-ok
    'const dbPassword = "' + VALOR_FALSO + '"' // path-ok
  ]
  const achados = varrer(casos)
  casos.forEach((c, i) => assert.ok(achados[i].length > 0, `passou batido: ${c}`))
})

test('o nome sem prefixo continua pego', { skip: semPython }, () => {
  assert.ok(pegou('password=' + VALOR_FALSO)) // path-ok
  assert.ok(pegou('senha: ' + VALOR_FALSO)) // path-ok
  assert.ok(pegou('MY_API_KEY=' + VALOR_FALSO + 'Abcd')) // path-ok
})

test('o guard nunca ecoa o segredo, so o nome dele', { skip: semPython }, () => {
  const [achados] = varrer(['DB_PASSWORD=' + VALOR_FALSO]) // path-ok
  assert.ok(achados.length > 0)
  assert.ok(!achados.join(' ').includes(VALOR_FALSO), achados.join(' '))
})

test('caminho de maquina, UNC e IP interno', { skip: semPython }, () => {
  assert.ok(pegou('o volume fica em C:' + '\\' + 'Users' + '\\' + 'fulano'))
  assert.ok(pegou('o volume fica em Y:/acervo/producao')) // path-ok
  assert.ok(pegou('a pasta e ' + '\\\\' + 'fileserver' + '\\' + 'acervo'))
  assert.ok(pegou('o SCA responde em 10.1.2.3')) // path-ok
  assert.ok(pegou('o SCA responde em 192.168.0.10')) // path-ok
  assert.ok(pegou('o SCA responde em 172.20.5.4')) // path-ok
})

test('credencial embutida em URL', { skip: semPython }, () => {
  assert.ok(pegou('postgres://sca:' + VALOR_FALSO + '@dbhost:5432/sca')) // path-ok
  // Interpolacao a partir do config.env e o jeito CERTO, e nao pode ser achado.
  assert.ok(!pegou('postgres://${dbUser}:${dbPassword}@${dbHost}/${dbName}'))
})

test('prosa em portugues terminada em "senha" nao vira achado', { skip: semPython }, () => {
  // "desenha:" tem `senha` dentro, e o `\b` que faltava abriu essa porta. Um
  // guard que barra comentario ensina `--no-verify`, que e o contrario de guardar.
  assert.ok(!pegou('// O createDataTable aceita `title` e nao o desenha: quem titula e a aba.'))
  assert.ok(!pegou('// as tres listas saem da MESMA populacao que o mapa desenha: entrega do'))
})

test('codigo no lugar do valor nao vira achado', { skip: semPython }, () => {
  assert.ok(!pegou('const meuToken = ++requisicao;'))
  assert.ok(!pegou('const trocarSenha = async (conn, login, senha) => {'))
  assert.ok(!pegou('const senha = process.env.SCA_SENHA'))
  assert.ok(!pegou('.send({ confirmations: [{ download_token: downloadToken, success: true }] })'))
})

test('uuid e identificador neste sistema, e nao credencial', { skip: semPython }, () => {
  // uuid_versao, usuario_uuid e download_token viajam em resposta de API e em
  // fixture de schema; trata-los como segredo bloquearia todo commit de fixture.
  assert.ok(!pegou("  download_token: 'a0eebc99-9c0b-4ef8-bb6d-6bb9bd380a11',"))
})

test('o marcador path-ok libera a linha inteira', { skip: semPython }, () => {
  assert.ok(!pegou('DB_PASSWORD=' + VALOR_FALSO + '   # path-ok'))
})

test('placeholder de documentacao nao vira achado', { skip: semPython }, () => {
  assert.ok(!pegou('SCA_SENHA=<sua senha>'))
  assert.ok(!pegou('DB_PASSWORD=CHANGEME'))
  assert.ok(!pegou('senha: exemplo'))
})

test('o que o guard pegava continua pego', { skip: semPython }, () => {
  // O silenciador de falso positivo e onde nasce o falso negativo, que e o custo
  // caro deste guard. Estas cinco formas eram pegas antes dos filtros de
  // 2026-09-05 e voltaram a ser depois deles; cada uma nomeia o filtro que quase
  // a engoliu.
  const casos = [
    'senha = "!Str0ngP@ssWord"', // operador de codigo: senha forte comeca em `!` // path-ok
    'token = "tokenABC123XYZ456"', // identificador nu: o valor carrega o nome // path-ok
    'api_key = "apikeyLive9f8a7b6c5d"', // idem // path-ok
    'senha: valorReal9f8a', // `valor` era placeholder por SUBSTRING // path-ok
    'senha: testeReal9f8a' // `teste` era placeholder por SUBSTRING // path-ok
  ]
  const achados = varrer(casos)
  casos.forEach((c, i) => assert.ok(achados[i].length > 0, `passou batido: ${c}`))
  // E o `++requisicao`, que e o motivo de o filtro existir, segue calado.
  assert.ok(!pegou('const meuToken = ++requisicao;'))
})

test('a grafia real da chave e pega mesmo em caixa baixa', { skip: semPython }, () => {
  // A regra generica recusa nome precedido de minuscula (e o que a faz nao
  // acusar `nao o desenha:`), e por isso `dbpassword=` passava. A segunda regra
  // casa o nome INTEIRO das chaves do `.env.example`, onde nao ha prosa possivel.
  assert.ok(pegou('dbpassword=' + VALOR_FALSO)) // path-ok
  assert.ok(pegou('"dbpassword": "' + VALOR_FALSO + '"')) // path-ok
  assert.ok(pegou('scasenha=' + VALOR_FALSO)) // path-ok
  // O catalogo sem valor continua sendo catalogo.
  assert.ok(!pegou('DB_PASSWORD='))
  assert.ok(!pegou('SCA_SENHA=<sua senha>'))
})

test('a fixture do repositorio sai por igualdade, e nao por substring', { skip: semPython }, () => {
  assert.ok(!pegou("process.env.PRODUCAO_DB_ADMIN_PASSWORD = 'valor-de-teste'"))
})

test('o repositorio inteiro passa no guard hoje', { skip: semPython }, () => {
  // A regressao que importa: se um ajuste no guard passar a acusar arquivo que
  // ja esta versionado, o pre-commit trava para todo mundo e o proximo commit sai
  // com --no-verify.
  const r = spawnSync(PYTHON, [GUARD], {
    encoding: 'utf8',
    cwd: path.join(AQUI, '..', '..')
  })
  assert.strictEqual(r.status, 0, r.stdout + r.stderr)
})
