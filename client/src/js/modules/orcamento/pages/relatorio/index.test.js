import { describe, test, expect, vi, beforeEach } from 'vitest';

// Smoke test do gerador da Secao 3 do RPCMTec. O ano vem do contexto global
// (fixado em 2026 no localStorage). Ao abrir, a pagina gera automaticamente o
// relatorio (chama getSecao3); ha um botao "Baixar DOCX" que exporta o documento.
vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getSecao3: vi.fn(() => Promise.resolve({
    tabela_31: [
      { cod_nd: '339030', nd_nome: 'Material', previsto: 100, recebido: 50, recebido_pdr: 35, recebido_extra: 15, empenhado: 40, empenhado_pdr: 25, empenhado_extra: 15, liquidado: 30, liquidado_pdr: 18, liquidado_extra: 12 },
      { cod_nd: 'TOTAL', nd_nome: 'TOTAL', previsto: 100, recebido: 50, recebido_pdr: 35, recebido_extra: 15, empenhado: 40, empenhado_pdr: 25, empenhado_extra: 15, liquidado: 30, liquidado_pdr: 18, liquidado_extra: 12 },
    ],
    tabela_32: [],
    tabela_33: [],
    tabela_34: [],
    tabela_35: [],
    tabela_36: [],
    tabela_37: [],
  })),
  downloadSecao3Docx: vi.fn(() => Promise.resolve()),
}));

import { renderRelatorio } from '@modules/orcamento/pages/relatorio/index.js';
import { getSecao3, downloadSecao3Docx } from '@modules/orcamento/services/orcamento-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('renderRelatorio', () => {
  beforeEach(() => {
    localStorage.setItem('@sca-orcamento-ano', '2026');
  });

  test('monta a pagina com titulo e botao Baixar DOCX', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRelatorio(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.querySelector('.page__title')).not.toBeNull();

    const botoes = Array.from(container.querySelectorAll('button'));
    const baixar = botoes.find(b => b.textContent.includes('Baixar DOCX'));
    expect(baixar).toBeTruthy();

    if (typeof cleanup === 'function') cleanup();
  });

  test('gera a secao 3 automaticamente ao abrir (sem clicar)', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRelatorio(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(getSecao3).toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  test('o botao Baixar DOCX chama downloadSecao3Docx', async () => {
    const container = document.createElement('div');
    const cleanup = await renderRelatorio(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const baixar = Array.from(container.querySelectorAll('button')).find(b => b.textContent.includes('Baixar DOCX'));
    baixar.click();
    await flush();

    expect(downloadSecao3Docx).toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });
});
