// Path: scripts/__tests__/carga_saida.test.js

// As duas cargas (`carregar_campo_sap.py` e `carregar_equipamento_dmt.py`) geram
// SQL com dado real e RECUSAM `--saida` apontando para dentro do repositorio, que
// e publico. A recusa e uma comparacao de caminho, e no Windows ela tem uma
// armadilha: `os.path.commonpath` LEVANTA ValueError quando os dois caminhos
// estao em unidades diferentes. Ou seja, o caminho CERTO (a saida numa unidade
// e o repositorio em outra) era o que quebrava, com traceback e sem carga.
//
// Sem Python na maquina os casos sao PULADOS, e nao reprovados: a carga roda por
// fora do servico, e nao na suite de quem so mexe no client.

import { test } from 'node:test'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))

const SCRIPTS = [
  { arquivo: 'carregar_campo_sap.py', funcao: 'dentro_do_repositorio' },
  { arquivo: 'carregar_equipamento_dmt.py', funcao: 'caminho_dentro_do_repositorio' }
]

const DRIVER = [
  'import importlib.util, json, sys',
  'spec = importlib.util.spec_from_file_location("carga", sys.argv[1])',
  'm = importlib.util.module_from_spec(spec)',
  'spec.loader.exec_module(m)',
  'f = getattr(m, sys.argv[2])',
  'caminhos = json.loads(sys.stdin.read())',
  'json.dump([bool(f(c)) for c in caminhos], sys.stdout)'
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

function dentro (script, caminhos) {
  const r = spawnSync(
    PYTHON,
    ['-c', DRIVER, path.join(AQUI, '..', script.arquivo), script.funcao],
    // O CWD e a RAIZ do repositorio: os casos passam caminho relativo, e o
    // Python o resolve contra o diretorio herdado. Sem isto, rodar de dentro de
    // `scripts/` invertia o resultado dos casos.
    { input: JSON.stringify(caminhos), encoding: 'utf8', cwd: path.join(AQUI, '..', '..') }
  )
  assert.strictEqual(r.status, 0, `${script.arquivo} falhou: ${r.stderr}`)
  return JSON.parse(r.stdout)
}

for (const script of SCRIPTS) {
  test(`${script.arquivo}: --saida em OUTRA unidade responde, e nao explode`, { skip: semPython }, () => {
    // O caminho de uso normal no Windows: repositorio em C:, entrega em D: ou
    // numa unidade mapeada. Antes do conserto o campo_sap morria aqui com
    // ValueError, e o operador via traceback no lugar do relatorio.
    const alvos = ['D:' + '\\' + 'cargas' + '\\' + 'campo.sql', 'Y:' + '\\' + 'entrega' + '\\' + 'x.sql']
    assert.deepStrictEqual(dentro(script, alvos), [false, false])
  })

  test(`${script.arquivo}: --saida dentro do repositorio e recusada`, { skip: semPython }, () => {
    assert.deepStrictEqual(
      dentro(script, ['scripts/x.sql', 'x.sql', 'server/src/x.sql']),
      [true, true, true]
    )
  })

  test(`${script.arquivo}: irmao de nome parecido NAO conta como dentro`, { skip: semPython }, () => {
    // `commonpath` compara COMPONENTE, e nao prefixo de texto: uma pasta irma
    // chamada `controle_acervo_saida` fica de fora, e tem de ficar.
    assert.deepStrictEqual(dentro(script, ['../fora.sql', '../controle_acervo_saida/x.sql']), [false, false])
  })
}
