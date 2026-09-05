// Path: scripts/__tests__/gerar_miniaturas_args.test.js

// A carga de miniatura GRAVA em `acervo.miniatura_versao`, e ate 2026-09-05 o
// parser dela guardava qualquer `--chave` sem reclamar. O custo era silencioso e
// grande: quem digitava `--dryrun` (ou `--dry_run`, ou `--dry-run=1`, que vira a
// chave `dry-run=1`) acreditava estar ensaiando e gravava de verdade, e
// `--limit 50` sem o `e` deixava o teto em null e processava o acervo INTEIRO.
// `--limite abc` dava NaN, que e falsy, com o mesmo efeito.
//
// Os casos rodam o script de verdade e olham o CODIGO DE SAIDA. Nenhum deles
// pode chegar ao banco: ou o parser recusa antes, ou o `--ajuda` responde e sai.
// Sem as dependencias do server/ instaladas eles sao PULADOS, e nao reprovados.

import { test } from 'node:test'
import assert from 'node:assert'
import { spawnSync } from 'node:child_process'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const AQUI = path.dirname(fileURLToPath(import.meta.url))
const RAIZ = path.join(AQUI, '..', '..')
const SCRIPT = path.join(RAIZ, 'scripts', 'gerar_miniaturas.cjs')

const temDeps = fs.existsSync(path.join(RAIZ, 'server', 'node_modules', 'pg'))
const semDeps = temDeps ? false : 'server/node_modules ausente (npm install em server/)'

function rodar (...args) {
  return spawnSync(process.execPath, [SCRIPT, ...args], { encoding: 'utf8', cwd: RAIZ })
}

test('--ajuda responde e sai, sem abrir conexao com o banco', { skip: semDeps }, () => {
  const r = rodar('--ajuda')
  assert.strictEqual(r.status, 0, r.stdout + r.stderr)
  assert.ok(r.stdout.includes('--dry-run'), r.stdout)
  assert.ok(!/candidatas:/.test(r.stdout), 'a ajuda nao pode ter consultado o banco')
})

test('opcao desconhecida PARA o script, em vez de virar gravacao', { skip: semDeps }, () => {
  for (const errada of ['--dryrun', '--dry_run', '--limit']) {
    const r = rodar(errada, '50')
    assert.strictEqual(r.status, 1, `${errada} passou batido: ${r.stdout}${r.stderr}`)
    assert.ok(r.stderr.includes('Opcao desconhecida'), r.stderr)
    assert.ok(!/candidatas:/.test(r.stdout), `${errada} chegou a consultar o banco`)
  }
})

test('numero que nao converte PARA o script, em vez de virar "sem teto"', { skip: semDeps }, () => {
  for (const args of [['--limite', 'abc'], ['--concorrencia', '0'], ['--versao', '-1']]) {
    const r = rodar(...args)
    assert.strictEqual(r.status, 1, `${args.join(' ')} passou batido: ${r.stdout}${r.stderr}`)
    assert.ok(r.stderr.includes('inteiro maior que zero'), r.stderr)
  }
  // `--limite` sem valor tambem: ele virava `true`, e parseInt(true) e NaN.
  const semValor = rodar('--limite')
  assert.strictEqual(semValor.status, 1, semValor.stdout + semValor.stderr)
  assert.ok(semValor.stderr.includes('exige um numero'), semValor.stderr)
})
