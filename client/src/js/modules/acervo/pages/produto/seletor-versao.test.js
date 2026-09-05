import { describe, test, expect, vi, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  buscarProdutos: vi.fn(),
  getProdutoDetalhado: vi.fn(),
}));

import { abrirSeletorVersao } from './seletor-versao.js';
import * as svc from '@modules/acervo/services/acervo-service.js';

const PRODUTOS = {
  dados: [{ id: 55, nome: 'Garibaldi', mi: '2952-1-SO', inom: 'SH-22-V-D-II-3' }],
};

const FICHA = {
  id: 55,
  nome: 'Garibaldi',
  versoes: [
    { versao_id: 700, versao: '1ª Edição', versao_data_edicao: '2026-01-10' },
    { versao_id: 701, versao: '2ª Edição', versao_data_edicao: '2026-05-04' },
  ],
};

const botao = (texto) => [...document.querySelectorAll('.modal__footer .btn')]
  .find(b => b.textContent === texto);

const aviso = () => document.querySelector('.seletor-versao .form-field__error');

const versoes = () => [...document.querySelectorAll('.seletor-versao__versao')];

/** Digita no campo e deixa o debounce de 300 ms passar. */
async function buscar(termo) {
  const input = document.querySelector('.seletor-versao input[type="text"]');
  input.value = termo;
  input.dispatchEvent(new Event('input'));
  await vi.advanceTimersByTimeAsync(400);
}

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  vi.useRealTimers();
});

/**
 * O AVISO DO "ESCOLHER" SEM VERSAO MARCADA.
 *
 * O botao nao fecha sem uma versao escolhida, e ate a onda anterior ele nao
 * dizia nada: o clique nao fazia efeito nenhum, e a leitura possivel era "o
 * botao esta quebrado". Este arquivo nasceu porque a correcao tinha ido sem
 * teste nenhum atras dela.
 */
describe('seletor de versão: o "Escolher" sem versão marcada', () => {
  test('sem produto buscado, o aviso manda buscar um', async () => {
    abrirSeletorVersao();
    await flush();

    botao('Escolher').click();
    await flush();

    expect(aviso().classList.contains('hidden')).toBe(false);
    expect(aviso().textContent)
      .toBe('Busque um produto e escolha uma das versões dele.');
    // E o diálogo NAO fecha: fechar sem escolha resolveria com null e a pessoa
    // acharia que escolheu.
    expect(document.querySelector('.seletor-versao')).not.toBeNull();
  });

  test('com produto escolhido, o aviso aponta a lista de versões', async () => {
    vi.useFakeTimers();
    svc.buscarProdutos.mockResolvedValue(PRODUTOS);
    svc.getProdutoDetalhado.mockResolvedValue(FICHA);

    abrirSeletorVersao();
    await buscar('Garibaldi');

    document.querySelector('.seletor-versao__item')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);

    expect(versoes()).toHaveLength(2);

    botao('Escolher').click();
    await vi.advanceTimersByTimeAsync(0);

    expect(aviso().textContent).toBe('Escolha uma das versões acima.');
  });

  // O aviso nasce ESCONDIDO e so aparece depois do clique. Sem a regiao viva,
  // quem usa leitor de tela aperta "Escolher", nada acontece e nada e anunciado.
  test('o aviso e uma regiao viva, e por isso e anunciado quando aparece', async () => {
    abrirSeletorVersao();
    await flush();

    // O `role` esta no no que JA existe na arvore, e nao num no criado na hora:
    // uma regiao viva que nasce junto com o texto nao anuncia nada.
    expect(aviso().getAttribute('role')).toBe('alert');
    expect(aviso().classList.contains('hidden')).toBe(true);

    botao('Escolher').click();
    await flush();

    expect(aviso().classList.contains('hidden')).toBe(false);
  });

  test('escolher uma versão fecha e devolve o rótulo dela', async () => {
    vi.useFakeTimers();
    svc.buscarProdutos.mockResolvedValue(PRODUTOS);
    svc.getProdutoDetalhado.mockResolvedValue(FICHA);

    const promessa = abrirSeletorVersao();
    await buscar('Garibaldi');

    document.querySelector('.seletor-versao__item')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);

    versoes()[1].click();
    botao('Escolher').click();
    await vi.advanceTimersByTimeAsync(0);

    await expect(promessa).resolves.toEqual({
      versao_id: 701,
      rotulo: '2ª Edição',
      produto_nome: 'Garibaldi',
    });
  });

  // A versao EXCLUIDA aparece DESABILITADA, e nao some: some-la faria a ficha
  // parecer ter uma versao a menos.
  test('a versão excluída aparece, desabilitada', async () => {
    vi.useFakeTimers();
    svc.buscarProdutos.mockResolvedValue(PRODUTOS);
    svc.getProdutoDetalhado.mockResolvedValue(FICHA);

    abrirSeletorVersao({ versaoExcluida: 700 });
    await buscar('Garibaldi');

    document.querySelector('.seletor-versao__item')
      .dispatchEvent(new MouseEvent('mousedown', { bubbles: true, cancelable: true }));
    await vi.advanceTimersByTimeAsync(0);

    expect(versoes()).toHaveLength(2);
    expect(versoes()[0].disabled).toBe(true);
    expect(versoes()[1].disabled).toBe(false);
  });
});
