import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Testa o comportamento real do wrapper api-client contra um global.fetch
// mockado. Usa o auth-store REAL (saveAuth/getToken/clearAuth) para exercitar
// o cabecalho Authorization e a limpeza de sessao. Verifica:
//  (a) sucesso -> devolve dados;
//  (b) !success -> lanca Error com a message do servidor;
//  (c) 401 -> limpa a sessao e manda para #/login (e lanca);
//  (d) 403 -> MANTEM a sessao e so lanca a mensagem do servidor;
//  (e) apiPost -> method POST, Authorization Bearer (quando ha token) e JSON.

import {
  apiGet, apiGetPaginado, apiPost, apiPostComFalhaParcial, apiDownload,
} from './api-client.js';
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

  // 403 NAO e sessao expirada: e a pessoa sem perfil para AQUELA acao. Deslogar
  // aqui expulsa do sistema quem so clicou num botao que a tela nao devia ter
  // mostrado.
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

// O PRAZO DA REQUISICAO, e por que ele passou a existir.
//
// O router virou FILA (uma navegacao por vez). Sem teto, um servidor pendurado
// prende a fila e a tela inteira para de navegar; antes prendia so a pagina que
// pediu. Estes casos guardam as duas metades: o sinal SAI na requisicao, e o
// aborto vira frase que diz o que fazer.
describe('api-client: o prazo da requisicao', () => {
  test('toda leitura leva um AbortSignal', async () => {
    global.fetch.mockResolvedValueOnce({
      ok: true, status: 200,
      json: async () => ({ success: true, dados: [] }),
    });

    await apiGet('/gerencia/arquivos_deletados');

    const [, opcoes] = global.fetch.mock.calls[0];
    expect(opcoes.signal).toBeInstanceOf(AbortSignal);
  });

  test('estourado o prazo, a mensagem diz o que houve e o que fazer', async () => {
    const estouro = new Error('The operation was aborted due to timeout');
    estouro.name = 'TimeoutError';
    global.fetch.mockRejectedValueOnce(estouro);

    await expect(apiGet('/gerencia/arquivos_deletados')).rejects.toThrow(
      'O servidor demorou demais para responder'
    );
  });

  // A falha de REDE tem frase propria, e nao a do prazo: sao dois problemas
  // diferentes e a acao de quem le e diferente em cada um. O que ela nao pode
  // mais ser e o "Failed to fetch" cru, em ingles, que nao diz nem que o
  // problema e a rede -- e e essa a mensagem que aparece no estado de erro de
  // tela inteira, ou seja, justamente quando o servidor esta fora do ar.
  test('falha de rede vira frase em portugues, e nao a do prazo', async () => {
    global.fetch.mockRejectedValueOnce(new TypeError('Failed to fetch'));

    await expect(apiGet('/gerencia/arquivos_deletados')).rejects.toThrow(
      'Não foi possível falar com o servidor'
    );
  });

  // O Firefox usa outra frase para o mesmo defeito; a traducao e por TIPO, e
  // nao por texto, entao vale nos dois navegadores.
  test('a frase do Firefox cai na mesma traducao', async () => {
    global.fetch.mockRejectedValueOnce(
      new TypeError('NetworkError when attempting to fetch resource.')
    );

    await expect(apiGet('/gerencia/arquivos_deletados')).rejects.toThrow(
      'Não foi possível falar com o servidor'
    );
  });

  // CONTROLE: o que nao e prazo nem rede continua subindo como veio. Traduzir
  // tudo esconderia o defeito de programacao atras de uma frase de rede.
  test('erro que nao e de rede sobe com a propria mensagem', async () => {
    global.fetch.mockRejectedValueOnce(new RangeError('offset fora do intervalo'));

    await expect(apiGet('/gerencia/arquivos_deletados')).rejects.toThrow(
      'offset fora do intervalo'
    );
  });
});

// ---------------------------------------------------------------------------
// apiDownload: QUEM NOMEIA O ARQUIVO E O SERVIDOR
// ---------------------------------------------------------------------------
//
// O nome do Anuario era montado nos DOIS lados -- aqui e no
// `rpcmtec_route.js` -- e duas montagens do mesmo nome divergem no primeiro dia
// em que uma delas muda. Foi o que a instituicao como dado provocou: o '1CGEO'
// do servidor passou a sair da sigla, e o daqui continuaria escrito no codigo.
//
// O acordo: o servidor manda o nome pronto no `Content-Disposition`, e o client
// USA o que veio. O `fallbackFilename` de quem chama so aparece quando o
// cabecalho nao traz nome nenhum.
describe('api-client: o nome do arquivo baixado', () => {
  let baixado;

  /** Resposta de download com o `Content-Disposition` pedido (ou nenhum). */
  function respostaDeArquivo(disposition) {
    return {
      status: 200,
      ok: true,
      headers: { get: (nome) => (nome === 'Content-Disposition' ? disposition : null) },
      blob: async () => new Blob(['conteudo']),
      json: async () => ({}),
    };
  }

  beforeEach(() => {
    baixado = null;
    // jsdom nao tem createObjectURL, e o clique num ancora com href tentaria
    // navegar. Os dois viram duble, e o que se observa e o `download`.
    global.URL.createObjectURL = vi.fn(() => 'blob:falso');
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      baixado = this.download;
    });
  });

  test('o nome do cabecalho GANHA do que quem chamou sugeriu', async () => {
    global.fetch.mockResolvedValueOnce(
      respostaDeArquivo('attachment; filename="Anuario_Estatistico_4CGEO_06_Junho_2026.ods"')
    );

    await apiDownload('/rpcmtec/anuario/ods?ano=2026&mes=6', 'queda.ods');

    expect(baixado).toBe('Anuario_Estatistico_4CGEO_06_Junho_2026.ods');
  });

  test('sem cabecalho, vale a queda de quem chamou', async () => {
    global.fetch.mockResolvedValueOnce(respostaDeArquivo(null));

    await apiDownload('/rpcmtec/anuario/ods?ano=2026&mes=6', 'queda.ods');

    expect(baixado).toBe('queda.ods');
  });

  // O `filename*` (RFC 5987) e o que carrega charset, entao ele ganha do
  // `filename` ao lado, que existe para cliente antigo e costuma ser a versao
  // degradada do nome.
  test('quando os dois vem, o filename* percent-encoded e o que vale', async () => {
    global.fetch.mockResolvedValueOnce(
      respostaDeArquivo(
        'attachment; filename="Anuario_1CGEO.ods"; '
        + "filename*=UTF-8''Anu%C3%A1rio_1%C2%BA%20CGEO.ods"
      )
    );

    await apiDownload('/rpcmtec/anuario/ods?ano=2026&mes=6', 'queda.ods');

    expect(baixado).toBe('Anuário_1º CGEO.ods');
  });

  // REGRESSAO: o `decodeURIComponent` sobre o `filename` SIMPLES lancava
  // URIError num nome com `%` solto, e derrubava um download que estava indo
  // bem. Nome literal nao se decodifica.
  test('o filename simples e literal, e um % nele nao derruba o download', async () => {
    global.fetch.mockResolvedValueOnce(
      respostaDeArquivo('attachment; filename="Cobertura_100%_2026.ods"')
    );

    await apiDownload('/relatorio/cobertura', 'queda.ods');

    expect(baixado).toBe('Cobertura_100%_2026.ods');
  });
});

// ---------------------------------------------------------------------------
// apiDownload: O ARQUIVO GRANDE VAI POR STREAM, E NAO PELA MEMORIA
// ---------------------------------------------------------------------------
//
// `await response.blob()` monta o arquivo INTEIRO na memoria da aba antes de
// salvar. O acervo tem arquivo de gigabytes, e por esse caminho passa o botao
// "Baixar" da ficha do produto: uma exportacao grande derruba a aba.
//
// Onde ha `showSaveFilePicker` (Chrome e Edge, o navegador da casa) os bytes vao
// do socket para o disco por `pipeTo`, e o `blob()` nao e nem chamado. Onde nao
// ha, o caminho da memoria continua sendo a queda -- ele nao sumiu.
describe('api-client: o download por stream', () => {
  let baixado;
  let blobChamado;

  /**
   * Resposta de download com corpo de stream (`body.pipeTo`) e `blob()`
   * instrumentado, para o caso poder afirmar QUAL dos dois foi usado.
   */
  function respostaComCorpo(disposition, canos) {
    return {
      status: 200,
      ok: true,
      headers: { get: (nome) => (nome === 'Content-Disposition' ? disposition : null) },
      body: { pipeTo: vi.fn(async (destino) => { canos.push(destino); }) },
      blob: async () => {
        blobChamado = true;
        return new Blob(['conteudo']);
      },
      json: async () => ({}),
    };
  }

  beforeEach(() => {
    baixado = null;
    blobChamado = false;
    global.URL.createObjectURL = vi.fn(() => 'blob:falso');
    global.URL.revokeObjectURL = vi.fn();
    vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function () {
      baixado = this.download;
    });
  });

  afterEach(() => {
    delete window.showSaveFilePicker;
  });

  test('com o seletor do navegador, os bytes vao por pipeTo e o blob nem e montado', async () => {
    const canos = [];
    const escrita = { marca: 'writable' };
    const criarEscrita = vi.fn(async () => escrita);
    window.showSaveFilePicker = vi.fn(async () => ({ createWritable: criarEscrita }));
    const resposta = respostaComCorpo(
      'attachment; filename="Anuario_Estatistico_4CGEO_06_Junho_2026.ods"',
      canos
    );
    global.fetch.mockResolvedValueOnce(resposta);

    await apiDownload('/rpcmtec/anuario/ods?ano=2026&mes=6', 'queda.ods');

    // O nome sugerido continua saindo do `Content-Disposition`: quem nomeia o
    // arquivo e o servidor, nos dois caminhos.
    expect(window.showSaveFilePicker).toHaveBeenCalledWith({
      suggestedName: 'Anuario_Estatistico_4CGEO_06_Junho_2026.ods',
    });
    expect(resposta.body.pipeTo).toHaveBeenCalledTimes(1);
    expect(canos).toEqual([escrita]);
    // O que este caso existe para provar: a memoria NAO foi usada.
    expect(blobChamado).toBe(false);
    expect(baixado).toBeNull();
  });

  test('sem cabecalho, o seletor recebe a queda de quem chamou', async () => {
    const canos = [];
    window.showSaveFilePicker = vi.fn(async () => ({
      createWritable: async () => ({}),
    }));
    global.fetch.mockResolvedValueOnce(respostaComCorpo(null, canos));

    await apiDownload('/rpcmtec/anuario/ods?ano=2026&mes=6', 'queda.ods');

    expect(window.showSaveFilePicker).toHaveBeenCalledWith({ suggestedName: 'queda.ods' });
  });

  // Quem fecha o seletor sem escolher pasta nao errou nada. O `AbortError` que a
  // API lanca ali viraria um toast vermelho dizendo "The user aborted a
  // request", em ingles, para quem so mudou de ideia.
  test('cancelar o seletor volta em silencio, sem lancar', async () => {
    const canos = [];
    const cancelou = new Error('The user aborted a request.');
    cancelou.name = 'AbortError';
    window.showSaveFilePicker = vi.fn(async () => { throw cancelou; });
    const resposta = respostaComCorpo('attachment; filename="a.ods"', canos);
    global.fetch.mockResolvedValueOnce(resposta);

    await expect(apiDownload('/relatorio/cobertura', 'queda.ods')).resolves.toBeUndefined();

    expect(resposta.body.pipeTo).not.toHaveBeenCalled();
    expect(blobChamado).toBe(false);
  });

  // CONTROLE do caso acima: so o cancelamento e silencioso. Uma pasta sem
  // permissao de escrita sobe, porque ali o download realmente falhou.
  test('outro erro do seletor sobe para quem chamou', async () => {
    const canos = [];
    const negado = new Error('Permissão negada na pasta escolhida.');
    negado.name = 'NotAllowedError';
    window.showSaveFilePicker = vi.fn(async () => { throw negado; });
    global.fetch.mockResolvedValueOnce(respostaComCorpo('attachment; filename="a.ods"', canos));

    await expect(apiDownload('/relatorio/cobertura', 'queda.ods')).rejects.toThrow(
      'Permissão negada na pasta escolhida.'
    );
  });

  // O Firefox e o Safari nao tem `showSaveFilePicker`. A queda pela memoria fica
  // de pe para eles, com o ancora e a revogacao adiada de sempre.
  test('sem o seletor, o caminho do blob e do ancora continua valendo', async () => {
    const canos = [];
    const resposta = respostaComCorpo('attachment; filename="Cobertura.ods"', canos);
    global.fetch.mockResolvedValueOnce(resposta);

    await apiDownload('/relatorio/cobertura', 'queda.ods');

    expect(blobChamado).toBe(true);
    expect(resposta.body.pipeTo).not.toHaveBeenCalled();
    expect(baixado).toBe('Cobertura.ods');
    expect(global.URL.createObjectURL).toHaveBeenCalledTimes(1);
  });
});
