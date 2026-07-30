import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Ficha do produto: identificacao, versoes e os arquivos de cada versao, cada um
// com botao de baixar. O download vai por stream do servidor, que le o volume: o
// navegador nunca ve caminho de rede.
vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getProdutoDetalhado: vi.fn(),
  baixarArquivoDoAcervo: vi.fn(() => Promise.resolve()),
}));

import { abrirProdutoDialog } from '@modules/acervo/pages/busca/produto-dialog.js';
import * as svc from '@modules/acervo/services/acervo-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const PRODUTO = { id: 12, nome: 'Porto Alegre', mi: '2987-2' };

// Um arquivo baixavel, um Tileserver (URL, sem byte em volume) e um com status de
// erro (byte possivelmente truncado no volume). Os dois ultimos o servidor recusa.
const FICHA = {
  id: 12,
  nome: 'Porto Alegre',
  mi: '2987-2',
  inom: 'SH-22-Y-B-VI-2',
  versoes: [
    {
      versao_id: 90,
      versao: '1',
      versao_data_edicao: '2026-01-10',
      arquivos: [
        {
          uuid_arquivo: 'aaaaaaaa-1111-2222-3333-444444444444',
          nome: 'Carta Topográfica 2987-2',
          nome_arquivo: 'ct_2987-2_ed1',
          extensao: 'tif',
          tamanho_mb: 42.5,
          tipo_arquivo_id: 1,
          tipo_status_id: 1,
        },
        {
          uuid_arquivo: 'bbbbbbbb-1111-2222-3333-444444444444',
          nome: 'Serviço de tiles',
          nome_arquivo: 'https://tiles.example/{z}/{x}/{y}.png',
          extensao: null,
          tamanho_mb: null,
          tipo_arquivo_id: 9,
          tipo_status_id: 1,
        },
        {
          uuid_arquivo: 'cccccccc-1111-2222-3333-444444444444',
          nome: 'Carta com erro de carregamento',
          nome_arquivo: 'ct_2987-2_ed1_erro',
          extensao: 'tif',
          tamanho_mb: 10,
          tipo_arquivo_id: 1,
          tipo_status_id: 2,
        },
      ],
    },
  ],
};

const botoesBaixar = () => [...document.querySelectorAll('.versao-bloco__baixar')];

beforeEach(() => {
  svc.getProdutoDetalhado.mockResolvedValue(FICHA);
  svc.baixarArquivoDoAcervo.mockResolvedValue();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('abrirProdutoDialog: download de arquivo', () => {
  test('cada arquivo da versao ganha um botao de baixar', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    expect(svc.getProdutoDetalhado).toHaveBeenCalledWith(12);
    expect(botoesBaixar()).toHaveLength(3);
  });

  // O nome salvo e o nome FISICO (nome_arquivo.extensao), derivado do cadastro. E
  // o mesmo nome que o plugin do QGIS recebe, e o que a pessoa espera no disco.
  test('baixa pelo uuid do arquivo, com o nome fisico', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    botoesBaixar()[0].click();
    await flush();

    expect(svc.baixarArquivoDoAcervo).toHaveBeenCalledWith(
      'aaaaaaaa-1111-2222-3333-444444444444',
      'ct_2987-2_ed1.tif'
    );
  });

  test('Tileserver e arquivo com status de erro ficam desabilitados', async () => {
    abrirProdutoDialog(PRODUTO);
    await flush();

    const [normal, tileserver, comErro] = botoesBaixar();
    expect(normal.disabled).toBe(false);
    // O servidor recusa os dois; a tela nao promete um download que vai dar erro.
    expect(tileserver.disabled).toBe(true);
    expect(comErro.disabled).toBe(true);

    tileserver.click();
    comErro.click();
    await flush();
    expect(svc.baixarArquivoDoAcervo).not.toHaveBeenCalled();
  });

  test('falha no download avisa e o botao volta a funcionar', async () => {
    svc.baixarArquivoDoAcervo.mockRejectedValueOnce(
      new Error('O arquivo está registrado mas não foi encontrado no volume: ct_2987-2_ed1.tif')
    );
    abrirProdutoDialog(PRODUTO);
    await flush();

    const botao = botoesBaixar()[0];
    botao.click();
    await flush();

    expect(document.body.textContent).toContain('não foi encontrado no volume');
    // Sem isto o botao ficaria travado depois da primeira falha, e a pessoa
    // precisaria fechar e reabrir a ficha para tentar de novo.
    expect(botao.disabled).toBe(false);
  });
});
