import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Testa o comportamento real do wrapper api-client contra um global.fetch
// mockado. Usa o auth-store REAL (saveAuth/getToken/clearAuth) para exercitar
// o cabecalho Authorization e a limpeza de sessao. Verifica:
//  (a) sucesso -> devolve dados;
//  (b) !success -> lanca Error com a message do servidor;
//  (c) 401 -> limpa a sessao e manda para #/login (e lanca);
//  (d) 403 -> MANTEM a sessao e so lanca a mensagem do servidor;
//  (e) apiPost -> method POST, Authorization Bearer (quando ha token) e JSON.

import { apiGet, apiGetPaginado, apiPost, apiPostComFalhaParcial } from './api-client.js';
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

// As rotas paginadas do /gerencia poem `pagination` AO LADO de `dados`, no topo
// do envelope. Lidas por `apiGet`, que devolve so o `dados`, a contagem total e
// o numero de paginas se perderiam, e a tela nao teria como desenhar o rodape
// nem dizer "1-20 de 349".
describe('api-client: rota paginada no servidor', () => {
  test('apiGetPaginado devolve dados E pagination', async () => {
    fetch.mockResolvedValueOnce(fakeResponse({
      body: {
        success: true,
        dados: [{ id: 1 }],
        pagination: { totalItems: 349, totalPages: 18, currentPage: 1, pageSize: 20 },
      },
    }));

    const resposta = await apiGetPaginado('/gerencia/arquivos_deletados?page=1&limit=20');

    expect(resposta.dados).toEqual([{ id: 1 }]);
    expect(resposta.pagination.totalItems).toBe(349);
  });

  test('apiGet continua devolvendo SO os dados, sem mudar de forma', async () => {
    fetch.mockResolvedValueOnce(fakeResponse({
      body: { success: true, dados: [{ id: 1 }], pagination: { totalItems: 349 } },
    }));

    const dados = await apiGet('/gerencia/arquivos_deletados');

    expect(dados).toEqual([{ id: 1 }]);
  });

  test('o erro do servidor continua virando Error, e nao envelope', async () => {
    fetch.mockResolvedValueOnce(fakeResponse({
      status: 400, body: { success: false, message: 'page deve ser inteiro' },
    }));

    await expect(apiGetPaginado('/gerencia/arquivos_deletados?page=x'))
      .rejects.toThrow('page deve ser inteiro');
  });
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

// FALHA PARCIAL de rota em LOTE. `POST /arquivo/renomear-padrao` responde HTTP
// 200 com `success: false` quando parte do lote falhou, e poe o resultado
// inteiro em `dados` -- inclusive o `detalhe`, que diz QUAL arquivo travou.
//
// Lida por `apiPost`, essa resposta virava excecao e o `dados` era descartado:
// a tela de manutencao tinha um ramo de falha que nunca rodava, e um lote com
// uma falha em quinhentos anunciava "0 renomeado(s)". O teste da tela nao pegava
// porque mockava o SERVICO, e o duble resolvia onde o real rejeitava. Por isso
// este teste mocka o FETCH: e a unica altura em que o envelope existe.
describe('api-client: falha parcial em rota de lote', () => {
  test('apiPostComFalhaParcial devolve dados mesmo com success false', async () => {
    fetch.mockResolvedValueOnce(fakeResponse({
      body: {
        success: false,
        message: 'Renome aplicado: 3 arquivo(s), 1 falha(s), 496 restante(s)',
        dados: {
          renomeados: 3,
          falhas: 1,
          restantes: 496,
          detalhe: [{ id: 7, erro: 'o nome alvo JA EXISTE no volume' }],
        },
      },
    }));

    const d = await apiPostComFalhaParcial('/arquivo/renomear-padrao', { motivo: 'x' });

    expect(d.renomeados).toBe(3);
    expect(d.falhas).toBe(1);
    expect(d.detalhe[0].erro).toContain('JA EXISTE');
  });

  test('apiPost comum continua lancando no mesmo corpo', async () => {
    fetch.mockResolvedValueOnce(fakeResponse({
      body: { success: false, message: 'nao deu', dados: { falhas: 1 } },
    }));

    await expect(apiPost('/arquivo/renomear-padrao', {})).rejects.toThrow('nao deu');
  });

  // A tolerancia vale SO para o `success` de uma resposta 200 com corpo. Erro de
  // HTTP continua sendo erro, senao um 500 passaria por resultado.
  test('erro de HTTP continua lancando, mesmo com a tolerancia ligada', async () => {
    fetch.mockResolvedValueOnce(fakeResponse({
      status: 500,
      body: { success: false, message: 'Erro interno' },
    }));

    await expect(
      apiPostComFalhaParcial('/arquivo/renomear-padrao', {})
    ).rejects.toThrow('Erro interno');
  });
});
