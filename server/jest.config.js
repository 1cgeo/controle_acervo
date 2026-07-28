'use strict'

module.exports = {
  testEnvironment: 'node',
  rootDir: './src',
  globalSetup: './__tests__/setup.js',
  globalTeardown: './__tests__/teardown.js',
  testMatch: ['**/__tests__/**/*.test.js'],
  coverageDirectory: '../coverage',
  collectCoverageFrom: [
    '**/*.js',
    '!__tests__/**',
    '!build/**',
    '!logs/**',
    '!index.js'
  ],
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
