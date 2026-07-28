import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderRpcMtec } from '@modules/mapoteca/pages/rpcmtec/index.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { setAno } from '@modules/mapoteca/store/year-store.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const DADOS = {
  estadoAcervo: [{ escala: '1:25.000', total_catalogado: 120, catalogado_no_mes: 4, universo_asc: 300, percentual_asc: 40 }],
  produtosPorTipo: [{ tipo_produto: 'Carta Topográfica', quantidade_mes: 4, quantidade_ano: 30 }],
  mapotecaDetalhe: [],
  laiDetalhe: [],
  mapotecaLinhas: [{ indicador: 'Pedidos atendidos', mes: 3, ano: 22 }],
  insumos: [{ insumo: 'Papel A0', estoque_atual: 12, consumo_no_mes: 3, abaixo_minimo: true }],
  laiLinhas: [],
  totaisConsolidados: [{ indicador: 'Total geral', mes: 7, ano: 52 }],
};

describe('renderRpcMtec', () => {
  beforeEach(() => {
    svc.getRpcmtecAcervo.mockResolvedValue(DADOS);
  });

  test('gera o preview do mes/ano corrente ao abrir', async () => {
    const hoje = new Date();
    const container = document.createElement('div');
    const cleanup = await renderRpcMtec(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getRpcmtecAcervo).toHaveBeenCalledWith({
      ano: hoje.getFullYear(),
      mes: hoje.getMonth() + 1,
    });
    expect(container.querySelector('.page__title').textContent).toBe('RPCMTec - Seção Acervo');

    if (typeof cleanup === 'function') cleanup();
  });

  test('monta as 8 secoes e preenche as tabelas', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRpcMtec(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const titulos = [...container.querySelectorAll('.dashboard-section__title')].map(e => e.textContent);
    expect(titulos).toHaveLength(8);
    expect(titulos[0]).toContain('Estado do Acervo');
    expect(container.textContent).toContain('Carta Topográfica');
    expect(container.textContent).toContain('Papel A0');

    if (typeof cleanup === 'function') cleanup();
  });

  test('trocar o mes gera de novo com o novo parametro', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRpcMtec(container, { params: {}, query: new URLSearchParams() });
    await flush();
    svc.getRpcmtecAcervo.mockClear();

    const mes = container.querySelector('#rpcmtec-mes');
    mes.value = '3';
    mes.dispatchEvent(new Event('change'));
    await flush();

    expect(svc.getRpcmtecAcervo).toHaveBeenCalledWith(expect.objectContaining({ mes: 3 }));

    if (typeof cleanup === 'function') cleanup();
  });

  // O ANO vem do contexto do modulo (seletor da navbar); o MÊS continua sendo
  // desta tela, porque o RPCMTec e sempre de um mes especifico.
  test('trocar o ano de contexto gera de novo, e o mes escolhido nao se perde', async () => {
    setAno(2026);
    const container = document.createElement('div');
    const cleanup = await renderRpcMtec(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const mes = container.querySelector('#rpcmtec-mes');
    mes.value = '3';
    mes.dispatchEvent(new Event('change'));
    await flush();
    svc.getRpcmtecAcervo.mockClear();

    setAno(2025);
    await flush();

    expect(svc.getRpcmtecAcervo).toHaveBeenCalledWith({ ano: 2025, mes: 3 });

    if (typeof cleanup === 'function') cleanup();
  });

  test('o botao baixa o DOCX pelo service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRpcMtec(container, { params: {}, query: new URLSearchParams() });
    await flush();

    [...container.querySelectorAll('button')].find(b => b.textContent.includes('Baixar DOCX')).click();
    await flush();

    expect(svc.downloadRpcmtecDocx).toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  test('erro na geracao esvazia as tabelas sem derrubar a pagina', async () => {
    svc.getRpcmtecAcervo.mockRejectedValueOnce(new Error('Erro ao gerar'));
    const container = document.createElement('div');
    const cleanup = await renderRpcMtec(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Sem dados de acervo');

    if (typeof cleanup === 'function') cleanup();
  });
});
