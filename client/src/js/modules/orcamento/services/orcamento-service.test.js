import { describe, test, expect, vi, beforeEach } from 'vitest';

// Mocka o api-client: cada wrapper do service deve chamar apiGet/Post/Put/Delete
// com o metodo HTTP e a URL corretos (incluindo a query string).
//
// Depois da fusao com o SCA (2026-07-27) TODA rota deste modulo carrega o
// prefixo '/orcamento'. Estes testes fazem isso cumprir: um caminho sem prefixo
// baterisa em outro modulo (ex.: '/relatorio' e o RPCMTec do acervo) ou em 404.
vi.mock('@services/api-client.js', () => ({
  apiGet: vi.fn(() => Promise.resolve(null)),
  apiPost: vi.fn(() => Promise.resolve(null)),
  apiPut: vi.fn(() => Promise.resolve(null)),
  apiDelete: vi.fn(() => Promise.resolve(null)),
  apiDownload: vi.fn(() => Promise.resolve(null)),
  apiUpload: vi.fn(() => Promise.resolve(null)),
}));

import { apiGet, apiPost, apiPut, apiDelete, apiDownload } from '@services/api-client.js';
import * as svc from '@modules/orcamento/services/orcamento-service.js';

beforeEach(() => vi.clearAllMocks());

describe('orcamento-service: GET com query string', () => {
  test('getMetas(ano) monta ?ano=', () => {
    svc.getMetas(2026);
    expect(apiGet).toHaveBeenCalledWith('/orcamento/metas?ano=2026');
  });

  test('getMetas() sem ano nao adiciona query', () => {
    svc.getMetas();
    expect(apiGet).toHaveBeenCalledWith('/orcamento/metas');
  });

  test('getNotasCredito filtra por ano e classificacao', () => {
    svc.getNotasCredito({ ano: 2026, classificacao_id: 1 });
    expect(apiGet).toHaveBeenCalledWith('/orcamento/notas_credito?ano=2026&classificacao_id=1');
  });

  test('getSecao3 monta a query do relatorio', () => {
    svc.getSecao3({ ano: 2026, mes: 6, cumulativo: true });
    expect(apiGet).toHaveBeenCalledWith('/orcamento/relatorio/secao3?ano=2026&mes=6&cumulativo=true');
  });

  test('getDfds(ano) monta ?ano=', () => {
    svc.getDfds(2026);
    expect(apiGet).toHaveBeenCalledWith('/orcamento/dfd?ano=2026');
  });

  test('getRpnps(ano) monta ?ano=', () => {
    svc.getRpnps(2026);
    expect(apiGet).toHaveBeenCalledWith('/orcamento/rpnp?ano=2026');
  });

  test('getPdrItens(ano) monta ?ano=', () => {
    svc.getPdrItens(2026);
    expect(apiGet).toHaveBeenCalledWith('/orcamento/pdr?ano=2026');
  });
});

describe('orcamento-service: configuracao e anos', () => {
  test('getConfig faz GET /orcamento/configuracao', () => {
    svc.getConfig();
    expect(apiGet).toHaveBeenCalledWith('/orcamento/configuracao');
  });

  test('updateConfig faz PUT /orcamento/configuracao com o corpo', () => {
    svc.updateConfig({ uasg: '160382', codom: '12345', ano_referencia: 2026 });
    expect(apiPut).toHaveBeenCalledWith('/orcamento/configuracao', { uasg: '160382', codom: '12345', ano_referencia: 2026 });
  });

  test('getAnos faz GET /orcamento/configuracao/anos', () => {
    svc.getAnos();
    expect(apiGet).toHaveBeenCalledWith('/orcamento/configuracao/anos');
  });
});

describe('orcamento-service: mutacoes', () => {
  test('deleteNotaCredito faz DELETE por id', () => {
    svc.deleteNotaCredito(7);
    expect(apiDelete).toHaveBeenCalledWith('/orcamento/notas_credito/7');
  });

  test('createPdrItem faz POST /orcamento/pdr com o corpo', () => {
    svc.createPdrItem({ ano: 2026, cod_nd: '339015' });
    expect(apiPost).toHaveBeenCalledWith('/orcamento/pdr', { ano: 2026, cod_nd: '339015' });
  });

  test('updatePdrItem faz PUT /orcamento/pdr/:id com o corpo', () => {
    svc.updatePdrItem(3, { valor_autorizado: 1000 });
    expect(apiPut).toHaveBeenCalledWith('/orcamento/pdr/3', { valor_autorizado: 1000 });
  });

  test('deletePdrItem faz DELETE /orcamento/pdr/:id', () => {
    svc.deletePdrItem(3);
    expect(apiDelete).toHaveBeenCalledWith('/orcamento/pdr/3');
  });
});

describe('orcamento-service: o prefixo do modulo esta em TODA rota', () => {
  test('dominio, licitacoes, empenhos, liquidacoes e recebimentos', () => {
    svc.getNaturezaDespesa();
    expect(apiGet).toHaveBeenCalledWith('/orcamento/dominio/natureza_despesa');

    svc.getLicitacoes({ ano: 2026 });
    expect(apiGet).toHaveBeenCalledWith('/orcamento/licitacoes?ano=2026');

    svc.getNotasEmpenho({ ano: 2026 });
    expect(apiGet).toHaveBeenCalledWith('/orcamento/notas_empenho?ano=2026');

    svc.getLiquidacoes(5);
    expect(apiGet).toHaveBeenCalledWith('/orcamento/liquidacoes?nota_empenho_id=5');

    svc.getRecebimentos(5);
    expect(apiGet).toHaveBeenCalledWith('/orcamento/recebimentos?nota_empenho_id=5');
  });

  test('arquivo e download do RPCMTec tambem levam o prefixo', () => {
    svc.getArquivos({ nota_credito_id: 9 });
    expect(apiGet).toHaveBeenCalledWith('/orcamento/arquivo?nota_credito_id=9');

    svc.downloadArquivo(4, 'nc.pdf');
    expect(apiDownload).toHaveBeenCalledWith('/orcamento/arquivo/4/download', 'nc.pdf');

    svc.downloadSecao3Docx({ ano: 2026, mes: 6 });
    expect(apiDownload).toHaveBeenCalledWith(
      '/orcamento/relatorio/secao3/docx?ano=2026&mes=6',
      'RPCMTec-secao3-2026-6.docx'
    );
  });

  test('nenhum caminho do service escapa do prefixo do modulo', () => {
    // Toda funcao exportada e chamada com argumentos inofensivos; o api-client
    // esta mockado, entao nada sai para a rede. O que importa e o 1o argumento.
    for (const [nome, fn] of Object.entries(svc)) {
      if (typeof fn !== 'function') continue;
      try {
        fn(1, {});
      } catch {
        continue;
      }
    }
    const chamadas = [apiGet, apiPost, apiPut, apiDelete, apiDownload]
      .flatMap(spy => spy.mock.calls.map(args => args[0]));

    expect(chamadas.length).toBeGreaterThan(20);
    for (const caminho of chamadas) {
      expect(caminho.startsWith('/orcamento/')).toBe(true);
    }
  });
});
