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

// O Anuario Estatistico vem de OUTRA rota, e a tela o pede junto do RPCMTec
// porque e a mesma tarefa mensal. Celula nula = "o SCA nao tem essa fonte".
const ANUARIO = {
  colunas: [],
  total_convencional: { rotulo: 'Total (Convencional)', exercito: 113, rm: null },
  convencional: [{ rotulo: 'Escala 1:50 000', exercito: 14, rm: null }],
  total_digital: { rotulo: 'Total (Digital)', exercito: 0, rm: null },
  digital: [{ rotulo: 'Imagem de Satélite / Fotografia aérea', exercito: 0, rm: null }],
  lacunas: ['RM e EE do Exército: o cadastro de cliente do SCA não separa.'],
};

describe('renderRpcMtec', () => {
  beforeEach(() => {
    svc.getRpcmtecAcervo.mockResolvedValue(DADOS);
    svc.getAnuario.mockResolvedValue(ANUARIO);
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
    // 8 do RPCMTec mais o Anuario Estatistico, que sobe para a DSG no mesmo mes.
    expect(titulos).toHaveLength(9);
    expect(titulos[0]).toContain('Estado do Acervo');
    expect(titulos[8]).toContain('Anuário Estatístico');
    expect(container.textContent).toContain('Carta Topográfica');
    expect(container.textContent).toContain('Papel A0');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o Anuario abre com o total de cada bloco e declara as lacunas', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRpcMtec(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getAnuario).toHaveBeenCalled();
    expect(container.textContent).toContain('Total (Convencional)');
    expect(container.textContent).toContain('Total (Digital)');
    expect(container.textContent).toContain('o cadastro de cliente do SCA não separa');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o botao do Anuario baixa o ODS pelo service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRpcMtec(container, { params: {}, query: new URLSearchParams() });
    await flush();

    [...container.querySelectorAll('button')].find(b => b.textContent.includes('Anuário')).click();
    await flush();

    expect(svc.downloadAnuarioOds).toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  // Sao duas rotas. Se o Anuario derrubasse as tabelas do RPCMTec, uma falha
  // num relatorio apagaria o outro da tela.
  test('erro no Anuario nao apaga as tabelas do RPCMTec', async () => {
    svc.getAnuario.mockRejectedValueOnce(new Error('Erro no Anuário'));
    const container = document.createElement('div');
    const cleanup = await renderRpcMtec(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('Carta Topográfica');
    expect(container.textContent).toContain('Sem entregas no mês');

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
