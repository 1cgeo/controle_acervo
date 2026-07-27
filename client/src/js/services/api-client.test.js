import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Testa o comportamento real do wrapper api-client contra um global.fetch
// mockado. Usa o auth-store REAL (saveAuth/getToken/clearAuth) para exercitar
// o cabecalho Authorization e a limpeza de sessao no 401/403. Verifica:
//  (a) sucesso -> devolve dados;
//  (b) !success -> lanca Error com a message do servidor;
//  (c) 401 -> limpa a sessao e manda para #/login (e lanca);
//  (d) 403 -> idem;
//  (e) apiPost -> method POST, Authorization Bearer (quando ha token) e JSON.

import { apiGet, apiPost } from './api-client.js';
import { saveAuth, getToken } from '@store/auth-store.js';

// Helper: monta uma Response falsa (status + corpo JSON) para o fetch mockado.
function fakeResponse({ status = 200, body = {} } = {}) {
  return {
    status,
    ok: status >= 200 && status < 300,
    json: () => Promise.resolve(body),
    headers: { get: () => null },
  };
}

beforeEach(() => {
  // location.hash limpo a cada teste (jsdom mantem entre testes).
  location.hash = '';
  global.fetch = vi.fn();
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('api-client: caminho de sucesso', () => {
  test('(a) resposta {success:true, dados} -> apiGet devolve dados', async () => {
    fetch.mockResolvedValueOnce(
      fakeResponse({ body: { success: true, dados: [{ id: 1 }, { id: 2 }] } })
    );

    const dados = await apiGet('/exercicios');

    expect(dados).toEqual([{ id: 1 }, { id: 2 }]);
    // chama /api + endpoint
    expect(fetch).toHaveBeenCalledTimes(1);
    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/exercicios');
    expect(options.method).toBe('GET');
  });

  test('apiGet sem token nao envia Authorization', async () => {
    fetch.mockResolvedValueOnce(fakeResponse({ body: { success: true, dados: null } }));

    await apiGet('/exercicios');

    const [, options] = fetch.mock.calls[0];
    expect(options.headers.Authorization).toBeUndefined();
    expect(options.headers['Content-Type']).toBe('application/json');
  });
});

describe('api-client: erro do servidor', () => {
  test('(b) success:false -> lanca Error com a message do servidor', async () => {
    fetch.mockResolvedValueOnce(
      fakeResponse({
        status: 200,
        body: { success: false, message: 'Ano ja cadastrado' },
      })
    );

    await expect(apiGet('/exercicios')).rejects.toThrow('Ano ja cadastrado');
  });

  test('HTTP 400 com message -> lanca Error com a message', async () => {
    fetch.mockResolvedValueOnce(
      fakeResponse({
        status: 400,
        body: { success: false, message: 'Erro de validacao dos Dados' },
      })
    );

    await expect(apiGet('/exercicios')).rejects.toThrow('Erro de validacao dos Dados');
  });
});

describe('api-client: 401/403 limpam a sessao e redirecionam', () => {
  test('(c) 401 -> limpa a sessao (localStorage) e ajusta location.hash para /login (e lanca)', async () => {
    saveAuth({ token: 'jwt-abc', administrador: true, uuid: 'u-1' }, 'fulano');
    expect(getToken()).toBe('jwt-abc');
    location.hash = '#/exercicios';

    fetch.mockResolvedValueOnce(
      fakeResponse({ status: 401, body: { message: 'Sessao expirada' } })
    );

    await expect(apiGet('/exercicios')).rejects.toThrow('Sessao expirada');

    // sessao limpa
    expect(getToken()).toBeNull();
    // redireciona para login, preservando a rota de origem
    expect(location.hash).toContain('/login');
    expect(location.hash).toContain('from=');
  });

  test('(d) 403 -> limpa a sessao e redireciona para /login (e lanca)', async () => {
    saveAuth({ token: 'jwt-xyz', administrador: false, uuid: 'u-2' }, 'beltrano');
    location.hash = '#/pdr';

    fetch.mockResolvedValueOnce(
      fakeResponse({ status: 403, body: { message: 'Acesso negado' } })
    );

    await expect(apiGet('/pdr')).rejects.toThrow('Acesso negado');

    expect(getToken()).toBeNull();
    expect(location.hash).toContain('/login');
  });

  test('401 sem corpo JSON -> usa a mensagem padrao e ainda limpa a sessao', async () => {
    saveAuth({ token: 't', administrador: true, uuid: 'u' }, 'x');

    fetch.mockResolvedValueOnce({
      status: 401,
      ok: false,
      json: () => Promise.reject(new Error('no body')),
      headers: { get: () => null },
    });

    await expect(apiGet('/exercicios')).rejects.toThrow(/Sess/);
    expect(getToken()).toBeNull();
  });
});

describe('api-client: apiPost', () => {
  test('(e) envia method POST, Authorization Bearer (com token) e Content-Type json', async () => {
    saveAuth({ token: 'tok-123', administrador: true, uuid: 'u-1' }, 'fulano');

    fetch.mockResolvedValueOnce(
      fakeResponse({ body: { success: true, dados: { id: 10 } } })
    );

    const payload = { ano: 2026, ativo: false };
    const dados = await apiPost('/exercicios', payload);

    expect(dados).toEqual({ id: 10 });

    const [url, options] = fetch.mock.calls[0];
    expect(url).toBe('/api/exercicios');
    expect(options.method).toBe('POST');
    expect(options.headers.Authorization).toBe('Bearer tok-123');
    expect(options.headers['Content-Type']).toBe('application/json');
    // corpo serializado em JSON
    expect(options.body).toBe(JSON.stringify(payload));
  });
});
