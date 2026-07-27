import { describe, test, expect, vi } from 'vitest';

vi.mock('@services/api-client.js', () => ({
  apiDownload: vi.fn(() => Promise.resolve()),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { createExportBar } from './export-bar.js';
import { apiDownload } from '@services/api-client.js';
import { showSuccess, showError } from '@utils/toast.js';

const ITENS = [
  { label: 'Exportar planilha (CSV)', title: 'CSVs zipados', endpoint: '/acervo/export-planilha-csv', filename: 'planilha-acervo.zip' },
  { label: 'Exportar GeoJSON', endpoint: '/acervo/situacao-geral', filename: 'situacao-geral.zip' },
];

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

describe('createExportBar', () => {
  test('monta um botao por exportacao, com titulo e icone', () => {
    const barra = createExportBar({ items: ITENS });
    const botoes = barra.querySelectorAll('.export-bar__btn');

    expect(botoes).toHaveLength(2);
    expect(botoes[0].textContent).toContain('Exportar planilha (CSV)');
    expect(botoes[0].title).toBe('CSVs zipados');
    // Sem title, cai no proprio rotulo.
    expect(botoes[1].title).toBe('Exportar GeoJSON');
    expect(botoes[0].querySelector('svg')).not.toBeNull();
  });

  test('sem itens, a barra fica vazia em vez de quebrar', () => {
    const barra = createExportBar({});
    expect(barra.querySelectorAll('.export-bar__btn')).toHaveLength(0);
  });

  test('clicar baixa pelo endpoint e avisa o sucesso', async () => {
    const barra = createExportBar({ items: ITENS });
    const botao = barra.querySelector('.export-bar__btn');

    botao.click();
    await flush();

    expect(apiDownload).toHaveBeenCalledWith('/acervo/export-planilha-csv', 'planilha-acervo.zip');
    expect(showSuccess).toHaveBeenCalled();
    // O rotulo volta ao normal e o botao reabilita.
    expect(botao.disabled).toBe(false);
    expect(botao.textContent).toContain('Exportar planilha (CSV)');
  });

  test('falha do download vira toast de erro com a mensagem do servidor', async () => {
    apiDownload.mockRejectedValueOnce(new Error('Volume indisponível'));

    const barra = createExportBar({ items: ITENS });
    const botao = barra.querySelector('.export-bar__btn');

    botao.click();
    await flush();

    expect(showError).toHaveBeenCalledWith('Volume indisponível');
    expect(botao.disabled).toBe(false);
  });

  test('o botao trava enquanto a exportacao esta em curso', async () => {
    let liberar;
    apiDownload.mockImplementationOnce(() => new Promise(resolve => { liberar = resolve; }));

    const barra = createExportBar({ items: ITENS });
    const botao = barra.querySelector('.export-bar__btn');

    botao.click();
    await flush();
    expect(botao.disabled).toBe(true);
    expect(botao.textContent).toContain('Exportando...');

    // Um segundo clique no meio do caminho nao dispara outra exportacao.
    const chamadas = apiDownload.mock.calls.length;
    botao.click();
    await flush();
    expect(apiDownload.mock.calls.length).toBe(chamadas);

    liberar();
    await flush();
    expect(botao.disabled).toBe(false);
  });
});
