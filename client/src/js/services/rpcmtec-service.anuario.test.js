import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// O NOME DO ARQUIVO DO ANUARIO, do lado do cliente (2026-08-09).
//
// Ele era montado nos DOIS lados -- aqui e no `rpcmtec_route.js` -- com o
// '1CGEO' escrito no codigo das duas pontas. Duas montagens do mesmo nome
// divergem no primeiro dia em que uma delas muda, e a instituicao como dado
// provocou exatamente isso.
//
// O acordo: o SERVIDOR manda o nome pronto no `Content-Disposition` e o client
// usa o que veio (provado em `api-client.test.js`). O que este arquivo guarda e
// a QUEDA: o nome que o client passa para o caso de o cabecalho nao chegar. Ela
// nao tenta reproduzir o nome de la; so precisa ser sensata e trazer a sigla
// DESTA instalacao, e nao a nossa escrita no codigo.
//
// Fica em arquivo proprio porque `rpcmtec-service.test.js` carrega o servico
// SEM MOCK NENHUM de proposito, e aqui o `api-client` precisa entrar dublado.
vi.mock('@services/api-client.js', () => ({
  apiGet: vi.fn(),
  apiPost: vi.fn(),
  apiPut: vi.fn(),
  apiDelete: vi.fn(),
  apiUpload: vi.fn(),
  apiDownload: vi.fn(() => Promise.resolve()),
}));

import { downloadAnuarioOds, downloadRtmOds } from '@services/rpcmtec-service.js';
import { apiDownload } from '@services/api-client.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';

/** Entra na sessao como o Centro informado. */
const entrarComo = (instituicao) =>
  saveAuth({ token: 'nao-jwt', administrador: false, uuid: 'u-1', instituicao }, 'fulano');

/** A queda que o servico passou para o `apiDownload` na ultima chamada. */
const quedaUsada = () => apiDownload.mock.calls[apiDownload.mock.calls.length - 1][1];

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => {
  clearAuth();
});

describe('downloadAnuarioOds: a queda para quando o cabecalho nao vem', () => {
  test('leva a sigla desta instalacao, o mes com dois digitos e o ano', async () => {
    entrarComo({ nome: '1º Centro de Geoinformação', sigla: '1º CGEO' });

    await downloadAnuarioOds({ ano: 2026, mes: 6 });

    expect(apiDownload).toHaveBeenCalledWith(
      '/rpcmtec/anuario/ods?ano=2026&mes=6',
      'Anuario_Estatistico_1CGEO_06_2026.ods'
    );
  });

  // A prova que interessa: com o nome no codigo, este teste reprovaria.
  test('OUTRO Centro na sessao nomeia o arquivo com a sigla DELE', async () => {
    entrarComo({ nome: '4º Centro de Geoinformação', sigla: '4º CGEO' });

    await downloadAnuarioOds({ ano: 2026, mes: 11 });

    expect(quedaUsada()).toBe('Anuario_Estatistico_4CGEO_11_2026.ods');
  });

  // Nome de arquivo atravessa anexo de e-mail, pasta compartilhada e a mao de
  // quem digita. O que sobra da sigla e [A-Za-z0-9].
  test('o que nao cabe em nome de arquivo sai da sigla', async () => {
    entrarComo({ nome: 'Centro de Geoinformação de Teste', sigla: 'CGEO-T (Sul)' });

    await downloadAnuarioOds({ ano: 2026, mes: 1 });

    expect(quedaUsada()).toBe('Anuario_Estatistico_CGEOTSul_01_2026.ods');
  });

  // Sem sigla o pedaco some inteiro, e nao vira sublinhado solto
  // ('Anuario_Estatistico__01_2026.ods').
  test('sem instituicao na sessao, o nome fica sem o pedaco da sigla', async () => {
    clearAuth();

    await downloadAnuarioOds({ ano: 2026, mes: 1 });

    expect(quedaUsada()).toBe('Anuario_Estatistico_01_2026.ods');
  });
});

// CONTROLE: o RTM nao leva sigla nenhuma, e nao passou a levar. O nome dele
// carrega o mes porque o CONTEUDO e acumulado ate ele, e mexer nisso mandaria
// para a DSG dois arquivos de mesmo nome com conteudo diferente.
describe('downloadRtmOds: o nome do RTM nao mudou', () => {
  test('continua sem sigla, com o ano e o mes ate onde acumula', async () => {
    entrarComo({ nome: '4º Centro de Geoinformação', sigla: '4º CGEO' });

    await downloadRtmOds({ ano: 2026, mes: 7 });

    expect(quedaUsada()).toBe('META4_DETALHADA_2026_ate_07.ods');
  });
});
