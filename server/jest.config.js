'use strict'

const fs = require('fs')
const path = require('path')

const TESTES = path.join(__dirname, 'src', '__tests__')

const listar = (dir, acc = []) => {
  for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, e.name)
    if (e.isDirectory()) listar(p, acc)
    else if (e.name.endsWith('.test.js')) acc.push(p.replace(/\\/g, '/'))
  }
  return acc
}

// QUEM PRECISA DE PostgreSQL, decidido LENDO O FONTE e nao por uma lista.
//
// A lista seria copia, e copia apodrece: bastaria um teste novo em routes/
// esquecer de entrar nela para cair no pacote rapido e falhar sem banco, ou
// (pior) um teste mockado ficar no pacote lento para sempre. Quem abre conexao
// e quem faz `require` de `helpers/db`, entao e isso que se pergunta. Mesmo
// remedio do setup.js, que le a ordem dos `er/` do create_config.js.
//
// Nao da para separar por PASTA: `routes/` tem os dois (as rotas do orcamento
// montam um app mockado por `helpers/orcamento/testApp`), e `unit/` e todo
// mockado.
//
// SAO DOIS SINAIS, e o segundo custou uma depuracao: alem do `helpers/db`, vale
// o `helpers/app`, porque o `getApp()` dele chama `db.createConn()`. O
// `routes/auth.test.js` usa SO o segundo -- ele nao semeia dado, so exercita o
// middleware de token -- e por isso caiu no pacote rapido na primeira versao
// desta regra, onde morreu derrubando o worker em vez de falhar com assercao.
const ABRE_CONEXAO = /helpers\/(db|app)/
const usaBanco = arquivo => ABRE_CONEXAO.test(fs.readFileSync(arquivo, 'utf8'))

const todos = listar(TESTES)
const comBanco = todos.filter(usaBanco)
const semBanco = todos.filter(f => !usaBanco(f))

const comum = {
  testEnvironment: 'node',
  rootDir: './src',
  testTimeout: 30000,
  // Pacote ESM puro nao entra no runtime CommonJS do Jest, entao cada um deles
  // aponta para um duble CJS. Em producao valem os pacotes de verdade.
  //
  // O `serialize-error` foi o que impedia a suite INTEIRA de rodar: pelo
  // `import()` dinamico ele exige NODE_OPTIONS=--experimental-vm-modules, e com
  // a flag o Jest 30 no Node 24 quebra antes, em ERR_VM_MODULE_NOT_MODULE.
  // Como utils/app_error.js o alcanca, todo teste morria no primeiro require.
  moduleNameMapper: {
    '^uuid$': '<rootDir>/__tests__/helpers/uuid-shim.js',
    '^serialize-error$': '<rootDir>/__tests__/helpers/serialize-error-shim.js'
  }
  // Sem `transformIgnorePatterns` para o serialize-error: ele so teria efeito
  // com um transform de ESM para CJS configurado, e este projeto nao tem babel.
  // Ficava dando a impressao de resolver o problema sem resolver nada.
}

module.exports = {
  // DOIS PACOTES, para nem toda mudanca cobrar a suite inteira.
  //
  //   npm run test:rapido  -> so o que nao toca o banco (segundos, em paralelo)
  //   npm run test:banco   -> so o que precisa do PostgreSQL
  //   npm test             -> os dois
  //
  // O `globalSetup` mora SO no pacote de banco: assim o `test:rapido` nao paga
  // a criacao de bancos que ele nao usaria.
  projects: [
    {
      ...comum,
      displayName: 'rapido',
      testMatch: semBanco
    },
    {
      ...comum,
      displayName: 'banco',
      testMatch: comBanco,
      globalSetup: '<rootDir>/__tests__/setup.js',
      globalTeardown: '<rootDir>/__tests__/teardown.js',
      // Escolhe o banco DESTE worker antes de qualquer require do config.
      setupFiles: ['<rootDir>/__tests__/worker_db.js']
    }
  ],
  coverageDirectory: '../coverage',
  collectCoverageFrom: [
    '**/*.js',
    '!__tests__/**',
    '!build/**',
    '!logs/**',
    '!index.js'
  ]
}
