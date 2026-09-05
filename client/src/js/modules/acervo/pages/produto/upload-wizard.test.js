import { describe, test, expect, vi, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getTiposArquivo: vi.fn(() => Promise.resolve([{ code: 1, nome: 'Arquivo principal' }])),
  getSituacoesCarregamento: vi.fn(() => Promise.resolve([{ code: 1, nome: 'Não carregado' }])),
  enviarVersaoComArquivos: vi.fn(() => Promise.resolve()),
  enviarProdutoComArquivos: vi.fn(() => Promise.resolve()),
  enviarArquivosEmVersao: vi.fn(() => Promise.resolve()),
  // O padrao do servidor (`UPLOAD_WEB_MAX_GB`). Os arquivos dos casos abaixo tem
  // dezenas de bytes, entao o teto so pesa onde o caso o traz para o centro.
  getTetoUploadWeb: vi.fn(() => Promise.resolve({ max_gb: 2 })),
}));

import {
  abrirAssistenteUpload,
  extensoesRepetidas,
  extensoesJaNaVersao,
  arquivosAcimaDoTeto,
} from './upload-wizard.js';
import { getTetoUploadWeb } from '@modules/acervo/services/acervo-service.js';

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

/**
 * O NOME NO VOLUME E UM SO POR VERSAO (`acervo.nome_arquivo_padrao` nao recebe o
 * tipo de arquivo), e quem separa os arquivos la e a EXTENSAO. A conferencia da
 * tela olhava so a lista nova: acrescentar um `.tif` a uma versao que ja tem
 * `.tif` passava sem aviso, e a recusa do servidor chegava quando a parte
 * daquele arquivo comecava a subir -- com o arquivo grande em terceiro lugar,
 * os dois primeiros ja tinham subido inteiros, e o envio e tudo ou nada.
 */
describe('assistente de envio: a extensao que a versao JA tem', () => {
  const arquivo = (nome, bytes = 10) =>
    new File([new Uint8Array(bytes)], nome, { type: 'application/octet-stream' });

  const soltar = (arquivos) => {
    const zona = document.querySelector('.envio-zona');
    zona.dispatchEvent(Object.assign(new Event('drop'), {
      preventDefault: () => {},
      dataTransfer: { files: arquivos },
    }));
  };

  const avancar = () => [...document.querySelectorAll('.envio-assistente__rodape .btn')]
    .find(b => b.textContent === 'Continuar para o envio');

  const erros = () => [...document.querySelectorAll('.envio-assistente__erro')]
    .map(p => p.textContent);

  test('extensoesJaNaVersao acha a coincidencia, sem olhar a caixa da letra', () => {
    const itens = [{ extensao: 'tif' }, { extensao: 'pdf' }, { extensao: 'xml' }];

    expect(extensoesJaNaVersao(itens, ['TIF', 'shp'])).toEqual(['tif']);
    expect(extensoesJaNaVersao(itens, [])).toEqual([]);
    expect(extensoesJaNaVersao(itens, undefined)).toEqual([]);
  });

  test('extensoesRepetidas continua olhando so a lista nova', () => {
    expect(extensoesRepetidas([{ extensao: 'tif' }, { extensao: 'tif' }])).toEqual(['tif']);
    expect(extensoesRepetidas([{ extensao: 'tif' }, { extensao: 'pdf' }])).toEqual([]);
  });

  test('soltar um .tif numa versao que ja tem .tif trava o avanco e diz por que', async () => {
    abrirAssistenteUpload({
      modo: 'arquivos',
      versaoId: 90,
      rotuloVersao: '1ª Edição',
      produtoNome: 'Porto Alegre',
      extensoesExistentes: ['tif', 'pdf'],
    });
    await flush();

    soltar([arquivo('ct_2987-2_ed1.tif')]);
    await flush();

    expect(avancar().disabled).toBe(true);
    expect(erros().join(' ')).toContain('Esta versão já tem arquivo com a extensão .tif');
  });

  test('extensao que a versao nao tem passa, e o avanco libera', async () => {
    abrirAssistenteUpload({
      modo: 'arquivos',
      versaoId: 90,
      rotuloVersao: '1ª Edição',
      produtoNome: 'Porto Alegre',
      extensoesExistentes: ['tif', 'pdf'],
    });
    await flush();

    soltar([arquivo('ct_2987-2_ed1.xml')]);
    await flush();

    expect(avancar().disabled).toBe(false);
    expect(erros()).toEqual([]);
  });

  // Sem a lista, o assistente nao tem como saber: e o caso dos modos 'produto' e
  // 'versao', onde a versao ainda nao existe.
  test('sem extensoesExistentes o assistente segue como antes', async () => {
    abrirAssistenteUpload({ modo: 'versao', produtoId: 12, versao: { versao: '2ª Edição' } });
    await flush();

    soltar([arquivo('a.tif')]);
    await flush();

    expect(avancar().disabled).toBe(false);
    expect(erros()).toEqual([]);
  });

  test('duas vezes a mesma extensao NA LISTA continua sendo recusada', async () => {
    abrirAssistenteUpload({ modo: 'versao', produtoId: 12, versao: { versao: '2ª Edição' } });
    await flush();

    soltar([arquivo('a.tif'), arquivo('b.tif')]);
    await flush();

    expect(avancar().disabled).toBe(true);
    expect(erros().join(' ')).toContain('Dois arquivos com a extensão .tif');
  });
});

describe('assistente de envio: o teto do caminho web', () => {
  // O teto e do SERVIDOR (`UPLOAD_WEB_MAX_GB`, 2 GB por padrao) e passar dele
  // nao e um envio lento: e um 413 depois de a pessoa esperar os bytes subirem,
  // e o envio e tudo ou nada. Ate a rota `GET /arquivo/upload-web/teto` existir,
  // a tela so podia falar em "alguns GB"; agora ela diz o numero, marca o
  // arquivo grande e trava o avanco ANTES do primeiro byte.
  const arquivoDe = (nome, bytes) => {
    const f = new File([new Uint8Array(1)], nome, { type: 'application/octet-stream' });
    // `File` nao deixa escrever `size`, e um File de 3 GiB de verdade nao cabe
    // na memoria do teste. O tamanho DECLARADO e o que o assistente le.
    Object.defineProperty(f, 'size', { value: bytes });
    return f;
  };

  const soltar = (arquivos) => {
    const zona = document.querySelector('.envio-zona');
    zona.dispatchEvent(Object.assign(new Event('drop'), {
      preventDefault: () => {},
      dataTransfer: { files: arquivos },
    }));
  };

  const avancar = () => [...document.querySelectorAll('.envio-assistente__rodape .btn')]
    .find(b => b.textContent === 'Continuar para o envio');

  const erros = () => [...document.querySelectorAll('.envio-assistente__erro')]
    .map(p => p.textContent);

  const GiB = 1024 * 1024 * 1024;

  test('arquivosAcimaDoTeto conta em 1024^3, e sem teto nao acusa ninguem', () => {
    const grande = { arquivo: { name: 'g.tif', size: 3 * GiB } };
    const justo = { arquivo: { name: 'j.tif', size: 2 * GiB } };

    expect(arquivosAcimaDoTeto([grande, justo], 2)).toEqual([grande]);
    // Exatamente no teto NAO passa do teto: o servidor recusa o que EXCEDE.
    expect(arquivosAcimaDoTeto([justo], 2)).toEqual([]);
    // Sem teto (rota fora do ar, valor sem sentido) ninguem e barrado.
    expect(arquivosAcimaDoTeto([grande], null)).toEqual([]);
    expect(arquivosAcimaDoTeto([grande], 0)).toEqual([]);
    expect(arquivosAcimaDoTeto([grande], 'dois')).toEqual([]);
  });

  test('com o teto em 2 GB, um arquivo de 3 GiB trava o avanco e a frase cita o numero',
    async () => {
      abrirAssistenteUpload({ modo: 'versao', produtoId: 12, versao: { versao: '2ª Edição' } });
      await flush();

      soltar([arquivoDe('ct_2987-2_ed1.tif', 3 * GiB)]);
      await flush();

      expect(avancar().disabled).toBe(true);
      expect(erros().join(' ')).toContain('1 arquivo passa do teto de 2 GB');
      expect(erros().join(' ')).toContain('ct_2987-2_ed1.tif');
      // A linha do arquivo fica marcada, para a frase geral nao deixar duvida
      // sobre QUAL dos arquivos e o grande.
      expect(document.querySelectorAll('.envio-item--acima-do-teto').length).toBe(1);
      expect(document.querySelector('.envio-item__tamanho--acima').textContent).toBe('3.00 GB');
      // E a frase da zona passa a dizer o numero.
      expect(document.querySelector('.envio-zona__nota').textContent).toContain(
        'Arquivo acima de 2 GB entra pelo plugin do QGIS: o servidor recusa o envio pelo navegador'
      );
    });

  test('abaixo do teto nada muda: sem marca, sem frase de erro e o avanco libera', async () => {
    abrirAssistenteUpload({ modo: 'versao', produtoId: 12, versao: { versao: '2ª Edição' } });
    await flush();

    soltar([arquivoDe('ct_2987-2_ed1.tif', 1.5 * GiB)]);
    await flush();

    expect(avancar().disabled).toBe(false);
    expect(erros()).toEqual([]);
    expect(document.querySelectorAll('.envio-item--acima-do-teto').length).toBe(0);
  });

  // A rota tem guarda de perfil e pode simplesmente nao existir num servidor
  // antigo. Nesse caso o assistente NAO pode fechar a porta: ele abre normal,
  // volta a falar em ordem de grandeza e deixa o servidor recusar, como fazia.
  test('com a rota do teto falhando, o assistente abre normal', async () => {
    getTetoUploadWeb.mockRejectedValueOnce(new Error('Erro 404: rota nao encontrada'));

    abrirAssistenteUpload({ modo: 'versao', produtoId: 12, versao: { versao: '2ª Edição' } });
    await flush();

    soltar([arquivoDe('gigante.tif', 6 * GiB)]);
    await flush();

    expect(avancar().disabled).toBe(false);
    expect(erros()).toEqual([]);
    expect(document.querySelectorAll('.envio-item--acima-do-teto').length).toBe(0);
    const nota = document.querySelector('.envio-zona__nota').textContent;
    expect(nota).toContain('Acima de alguns GB o caminho é o plugin do QGIS');
    expect(nota).toContain('o servidor recusa o envio pelo navegador');
  });

  // Um `max_gb` que nao e numero (envelope trocado, rota devolvendo outra coisa)
  // nao pode virar `NaN * 1024^3` e barrar todo mundo -- nem liberar em silencio
  // com um teto de zero.
  test('max_gb sem sentido e tratado como teto ausente', async () => {
    getTetoUploadWeb.mockResolvedValueOnce({ max_gb: null });

    abrirAssistenteUpload({ modo: 'versao', produtoId: 12, versao: { versao: '2ª Edição' } });
    await flush();

    soltar([arquivoDe('gigante.tif', 6 * GiB)]);
    await flush();

    expect(avancar().disabled).toBe(false);
    expect(document.querySelector('.envio-zona__nota').textContent).toContain('alguns GB');
  });
});
