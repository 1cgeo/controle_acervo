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
