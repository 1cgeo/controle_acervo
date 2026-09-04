// Config do `npm run test:relogio`. Ver src/__tests__/relogio-fixo.js para o
// que ela mede e por que ela existe.
//
// Herda a config normal e só acrescenta um setup: assim a suite que roda aqui é
// exatamente a que roda no `npm test`, e a única diferença é o dia.
import base from './vitest.config.js';

base.test.setupFiles = ['./src/__tests__/setup.js', './src/__tests__/relogio-fixo.js'];

export default base;
