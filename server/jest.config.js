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
  // Map ESM-only packages to CJS shims for Jest compatibility
  moduleNameMapper: {
    '^uuid$': '<rootDir>/__tests__/helpers/uuid-shim.js'
  },
  // Transform ESM-only packages (serialize-error) to CJS for Jest
  transformIgnorePatterns: [
    'node_modules/(?!(serialize-error)/)'
  ]
}
