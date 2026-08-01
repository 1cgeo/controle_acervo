'use strict'

// Um banco POR WORKER do Jest, escolhido antes de qualquer `require` do config.
//
// POR QUE. Todo teste de banco chama `cleanTestData()`, que faz TRUNCATE nas
// tabelas inteiras. Com um banco so, dois workers em paralelo apagariam os
// dados um do outro no meio da execucao, e a falha sairia intermitente e em
// arquivo que ninguem tocou. Era por isso que a suite rodava com `--runInBand`,
// e era o `--runInBand` que fazia ela levar seis minutos.
//
// Este arquivo entra como `setupFiles` (roda uma vez por worker, ANTES do
// framework de teste e de qualquer import do teste). Ele so reescreve
// `process.env.DB_NAME`; quem cria os bancos e o `setup.js`.
//
// O `dotenv` do config.js NAO sobrescreve variavel ja definida (esse e o
// comportamento padrao dele), entao o valor daqui vence o do
// config_testing.env. Se um dia alguem ligar `override: true` la, este arquivo
// para de ter efeito e a suite volta a colidir: e o unico acoplamento.

const fs = require('fs')
const path = require('path')
const dotenv = require('dotenv')

const ARQUIVO = path.join(__dirname, '..', '..', 'config_testing.env')

// Le o nome base direto do arquivo, sem depender de variavel herdada do
// processo do globalSetup: worker do Jest e processo separado, e o que
// atravessa entre eles nao e contrato estavel.
const base = dotenv.parse(fs.readFileSync(ARQUIVO)).DB_NAME || 'sca_test'

// JEST_WORKER_ID comeca em 1 e vale '1' tambem sob --runInBand.
const worker = process.env.JEST_WORKER_ID || '1'

process.env.DB_NAME = `${base}_${worker}`
