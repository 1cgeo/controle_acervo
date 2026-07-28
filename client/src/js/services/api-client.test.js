import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Testa o comportamento real do wrapper api-client contra um global.fetch
// mockado. Usa o auth-store REAL (saveAuth/getToken/clearAuth) para exercitar
// o cabecalho Authorization e a limpeza de sessao. Verifica:
//  (a) sucesso -> devolve dados;
//  (b) !success -> lanca Error com a message do servidor;
//  (c) 401 -> limpa a sessao e manda para #/login (e lanca);
//  (d) 403 -> MANTEM a sessao e so lanca a mensagem do servidor;
//  (e) apiPost -> method POST, Authorization Bearer (quando ha token) e JSON.

import { apiGet, apiPost } from './api-client.js';
import { saveAuth, getToken, getPerfil } from '@store/auth-store.js';

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

describe('api-client: 401 encerra a sessao, 403 nao', () => {
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

  // 403 NAO e sessao expirada: e a pessoa sem perfil para AQUELA acao. Ate
  // 2026-07-28 os dois casos deslogavam, e clicar num botao que a tela nao
  // devia ter mostrado expulsava a pessoa do sistema no meio do trabalho.
  test('(d) 403 -> MANTEM a sessao, nao redireciona, e lanca a mensagem do servidor', async () => {
    saveAuth(
      { token: 'jwt-xyz', administrador: false, uuid: 'u-2', perfis: { orcamento: 1 } },
      'beltrano'
    );
    location.hash = '#/orcamento/pdr';

    fetch
      // a acao recusada
      .mockResolvedValueOnce(
        fakeResponse({
          status: 403,
          body: { message: 'Usuário necessita do perfil gerente no módulo orcamento' },
        })
      )
      // a reconferencia de perfil que o 403 dispara, devolvendo o MESMO perfil
      .mockResolvedValueOnce(
        fakeResponse({
          body: {
            success: true,
            dados: { administrador: false, perfis: { orcamento: 1 }, modulos: [] },
          },
        })
      );

    await expect(apiGet('/orcamento/pdr')).rejects.toThrow(
      'Usuário necessita do perfil gerente no módulo orcamento'
    );

    expect(getToken()).toBe('jwt-xyz');
    expect(location.hash).toBe('#/orcamento/pdr');
  });

  test('403 reconfere o perfil no servidor e guarda o que voltou', async () => {
    saveAuth(
      { token: 'jwt-xyz', administrador: false, uuid: 'u-2', perfis: { orcamento: 3 } },
      'beltrano'
    );
    expect(getPerfil('orcamento')).toBe(3);

    fetch
      .mockResolvedValueOnce(fakeResponse({ status: 403, body: { message: 'Sem perfil' } }))
      // Foi rebaixado de gerente para consulta enquanto estava logado.
      .mockResolvedValueOnce(
        fakeResponse({
          body: {
            success: true,
            dados: { administrador: false, perfis: { orcamento: 1 }, modulos: [] },
          },
        })
      );

    await expect(apiGet('/orcamento/pdr')).rejects.toThrow('Sem perfil');

    // A foto do login foi corrigida, e a sessao continua de pe.
    expect(getPerfil('orcamento')).toBe(1);
    expect(getToken()).toBe('jwt-xyz');
  });

  test('403 com a reconferencia falhando nao derruba a sessao', async () => {
    saveAuth({ token: 'jwt-xyz', administrador: false, uuid: 'u-2' }, 'beltrano');

    fetch
      .mockResolvedValueOnce(fakeResponse({ status: 403, body: { message: 'Sem perfil' } }))
      .mockRejectedValueOnce(new Error('rede caiu'));

    await expect(apiGet('/orcamento/pdr')).rejects.toThrow('Sem perfil');
    expect(getToken()).toBe('jwt-xyz');
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
