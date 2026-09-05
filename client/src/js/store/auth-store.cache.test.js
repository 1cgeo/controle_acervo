import { describe, test, expect, beforeEach, vi } from 'vitest';
import { saveAuth, clearAuth } from './auth-store.js';
import { cachedFetch, clearCache } from '@services/cache.js';

// REGRESSAO: encerrar a sessao tem de apagar o CACHE em memoria, e nao so o
// localStorage.
//
// O defeito: as chaves do cache ('pedidos:list', 'dominio:*') nao levam o dono, e
// as entradas duram ate 30 minutos. So o botao "Sair" da navbar chamava
// `clearCache()`, e ele e uma das TRES portas de saida. As outras duas -- o 401
// (`handleSessaoExpirada` do api-client) e a tela de acesso negado -- chamavam
// `clearAuth()` sozinho. Quem entrasse como OUTRA pessoa na mesma aba recebia a
// lista da anterior, sem nenhuma chamada ao servidor.

beforeEach(() => {
  localStorage.clear();
  clearCache();
});

describe('clearAuth: a sessao inteira sai junto', () => {
  test('o dado guardado em cache NAO sobrevive ao fim da sessao', async () => {
    const buscar = vi.fn(() => Promise.resolve(['pedido da pessoa A']));

    saveAuth({ token: 't', administrador: false, uuid: 'a', perfis: { mapoteca: 1 } }, 'pessoa-a');
    expect(await cachedFetch('pedidos:list', buscar)).toEqual(['pedido da pessoa A']);

    // CONTROLE POSITIVO: dentro da MESMA sessao o cache tem de valer, senao o
    // teste passaria com um cache que simplesmente nunca guarda nada.
    await cachedFetch('pedidos:list', buscar);
    expect(buscar).toHaveBeenCalledTimes(1);

    clearAuth();

    // A pessoa seguinte pergunta de novo ao servidor, em vez de herdar a lista.
    const buscarB = vi.fn(() => Promise.resolve(['pedido da pessoa B']));
    saveAuth({ token: 't2', administrador: false, uuid: 'b', perfis: { mapoteca: 1 } }, 'pessoa-b');
    expect(await cachedFetch('pedidos:list', buscarB)).toEqual(['pedido da pessoa B']);
    expect(buscarB).toHaveBeenCalledTimes(1);
  });

  test('clearAuth continua limpando o localStorage', () => {
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: { acervo: 3 } }, 'x');
    clearAuth();
    expect(localStorage.getItem('@sca-Token')).toBeNull();
    expect(localStorage.getItem('@sca-perfis')).toBeNull();
  });
});

// A OUTRA METADE, e ela e a que faltava: SESSAO NOVA COMECA COM CACHE VAZIO.
//
// `clearAuth` cobre as portas de SAIDA (o botao Sair, o 401, a tela de acesso
// negado). Havia um caminho que nao passa por nenhuma delas: quando o token
// vence pelo RELOGIO, quem barra e o `authLoader` do router, que devolve
// '/login?from=...' sem limpar nada. A aba nao recarrega, entao o Map em memoria
// de `services/cache.js` atravessa a troca inteira -- e as tabelas de dominio
// duram 30 minutos ali. A pessoa seguinte na mesma maquina recebia o que a
// anterior tinha carregado, sem uma chamada ao servidor e sem nada na tela
// dizendo isso.
describe('saveAuth: sessao nova nao herda o cache da anterior', () => {
  test('o dado da pessoa A nao chega a pessoa B quando ninguem chamou clearAuth', async () => {
    const buscarA = vi.fn(() => Promise.resolve(['pedido da pessoa A']));

    saveAuth({ token: 't', administrador: false, uuid: 'a', perfis: { mapoteca: 1 } }, 'pessoa-a');
    expect(await cachedFetch('pedidos:list', buscarA)).toEqual(['pedido da pessoa A']);

    // A sessao de A vence pelo relogio: nada e chamado, so o proximo login.
    const buscarB = vi.fn(() => Promise.resolve(['pedido da pessoa B']));
    saveAuth({ token: 't2', administrador: false, uuid: 'b', perfis: { mapoteca: 1 } }, 'pessoa-b');

    expect(await cachedFetch('pedidos:list', buscarB)).toEqual(['pedido da pessoa B']);
    expect(buscarB).toHaveBeenCalledTimes(1);
  });

  test('dentro da MESMA sessao o cache continua valendo', async () => {
    const buscar = vi.fn(() => Promise.resolve(['dominio']));
    saveAuth({ token: 't', administrador: false, uuid: 'a', perfis: { acervo: 1 } }, 'pessoa-a');

    await cachedFetch('dominio:tipo_produto', buscar);
    await cachedFetch('dominio:tipo_produto', buscar);

    expect(buscar).toHaveBeenCalledTimes(1);
  });
});
