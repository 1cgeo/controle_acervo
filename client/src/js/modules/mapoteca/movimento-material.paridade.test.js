import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

import { TIPO_MOVIMENTO, TIPO_LOCALIZACAO } from './movimento-material.js';

// A CÓPIA DOS CÓDIGOS DE DOMÍNIO NO CLIENT, e o teste que a mantém honesta.
//
// `movimento-material.js` repete os códigos de `mapoteca.tipo_movimento_material`
// e de `mapoteca.tipo_localizacao` porque a tela precisa deles para ESCREVER: a
// regra "consumo só sai da Seção" compara contra o 1, e a Contagem escolhe entre
// origem e destino pelo código. Nenhum dos dois chega pronto do servidor, porque
// `tipo_movimento_material` não tem rota de domínio.
//
// O PROBLEMA QUE ISSO CRIA, e que o próprio arquivo declara: trocar um código em
// `server/src/utils/domain_constants.js` sem trocar aqui não quebra o boot, não
// quebra teste de servidor e não quebra teste de client. Quebra a TELA, calada, e
// do pior jeito -- um consumo gravado com o tipo errado é dado sujo que ninguém
// vê até o RPCMTec do mês seguinte sair torto.
//
// Este teste LÊ O FONTE do servidor e compara. É a mesma técnica de
// `server/src/__tests__/routes/modulo_em_toda_rota.test.js` e do guard de poda ao
// lado: varredura de texto de propósito, porque o client não importa CommonJS do
// servidor e um `require` cruzado entre os dois pacotes seria pior que a leitura.
//
// Se este teste falhar, NÃO ajuste a expectativa: ajuste a cópia do client, ou
// crie a rota de domínio e apague a cópia. A expectativa aqui é o servidor.

const FONTE_DO_SERVIDOR = resolve(
  __dirname, '..', '..', '..', '..', '..', 'server', 'src', 'utils', 'domain_constants.js'
);

/**
 * Lê um objeto de constantes do fonte do servidor, pelo nome.
 *
 * O bloco tem a forma `const NOME = { CHAVE: 1, OUTRA: 2 }`, com comentário no
 * meio. A leitura ignora o comentário e devolve o mapa.
 *
 * @param {string} nome
 * @returns {Object<string, number>}
 */
function constantesDoServidor(nome) {
  const fonte = readFileSync(FONTE_DO_SERVIDOR, 'utf8').replace(/\r\n?/g, '\n');
  const inicio = fonte.indexOf(`const ${nome} = {`);
  expect(inicio, `${nome} não existe em domain_constants.js`).toBeGreaterThanOrEqual(0);

  const fim = fonte.indexOf('\n}', inicio);
  expect(fim, `${nome} não fecha em domain_constants.js`).toBeGreaterThan(inicio);

  const corpo = fonte.slice(inicio, fim);
  const mapa = {};
  for (const [, chave, valor] of corpo.matchAll(/^\s*([A-Z_]+):\s*(\d+)/gm)) {
    mapa[chave] = Number(valor);
  }
  return mapa;
}

describe('os códigos de domínio do livro batem com os do servidor', () => {
  test('TIPO_MOVIMENTO é igual ao TIPO_MOVIMENTO_MATERIAL do servidor', () => {
    expect(TIPO_MOVIMENTO).toEqual(constantesDoServidor('TIPO_MOVIMENTO_MATERIAL'));
  });

  test('TIPO_LOCALIZACAO é igual ao do servidor', () => {
    expect(TIPO_LOCALIZACAO).toEqual(constantesDoServidor('TIPO_LOCALIZACAO'));
  });

  // CONTROLE da leitura. Sem ele, um `constantesDoServidor` que devolvesse mapa
  // vazio faria os dois casos acima passarem por vacuidade, comparando nada com
  // nada -- e o teste inteiro viraria enfeite no dia em que o formato do arquivo
  // do servidor mudasse.
  test('a leitura do fonte do servidor não devolve mapa vazio', () => {
    const movimento = constantesDoServidor('TIPO_MOVIMENTO_MATERIAL');
    const localizacao = constantesDoServidor('TIPO_LOCALIZACAO');

    expect(Object.keys(movimento).length).toBeGreaterThanOrEqual(4);
    expect(Object.keys(localizacao).length).toBeGreaterThanOrEqual(4);
    expect(movimento.CONSUMO).toBe(3);
    expect(localizacao.SECAO).toBe(1);
  });
});
