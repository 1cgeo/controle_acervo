import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { montarListaPaginada } from '@modules/acervo/pages/administracao/lista-paginada.js';
import { showError } from '@utils/toast.js';

const flush = () => new Promise(r => setTimeout(r, 0));

const COLUNAS = [
  { key: 'id', label: 'Id' },
  { key: 'nome', label: 'Nome' },
];

const pagina = (n, tamanho, total) => ({
  dados: Array.from({ length: Math.min(tamanho, total - (n - 1) * tamanho) }, (_, i) => ({
    id: (n - 1) * tamanho + i + 1,
    nome: `registro ${(n - 1) * tamanho + i + 1}`,
  })),
  pagination: {
    totalItems: total,
    totalPages: Math.ceil(total / tamanho),
    currentPage: n,
    pageSize: tamanho,
  },
});

let container;

const montar = (carregar) => {
  container = document.createElement('div');
  return montarListaPaginada({
    container,
    intro: 'uma lista de teste',
    colunas: COLUNAS,
    carregar,
    vazio: 'Nada aqui',
    erro: 'Falhou',
  });
};

const rodape = () => container.querySelector('.pagination__info span')?.textContent;
const proxima = () => [...container.querySelectorAll('.pagination__btn')]
  .find(b => b.getAttribute('aria-label') === 'Próxima página');

describe('montarListaPaginada', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  test('pede a primeira pagina e mostra o rodape do servidor', async () => {
    const carregar = vi.fn(() => Promise.resolve(pagina(1, 20, 349)));
    const lista = await montar(carregar);

    expect(carregar).toHaveBeenCalledWith({ page: 1, limit: 20 });
    expect(container.textContent).toContain('registro 1');
    expect(rodape()).toBe('1-20 de 349');

    lista.cleanup();
  });

  test('virar pagina pede a pagina nova ao servidor', async () => {
    const carregar = vi.fn(({ page, limit }) => Promise.resolve(pagina(page, limit, 349)));
    const lista = await montar(carregar);

    proxima().click();
    await flush();

    expect(carregar).toHaveBeenLastCalledWith({ page: 2, limit: 20 });
    expect(container.textContent).toContain('registro 21');
    expect(rodape()).toBe('21-40 de 349');

    lista.cleanup();
  });

  // A tabela recebe SO a pagina atual. Com a paginacao do data-table ligada, ela
  // fatiaria 20 linhas em paginas de 10 e o rodape de baixo diria outra coisa.
  test('a tabela nao pagina de novo por cima do que o servidor ja paginou', async () => {
    const carregar = () => Promise.resolve(pagina(1, 20, 349));
    const lista = await montar(carregar);

    expect(container.querySelectorAll('tbody tr')).toHaveLength(20);
    // Um rodape so na tela: o do servidor.
    expect(container.querySelectorAll('.pagination__info')).toHaveLength(1);

    lista.cleanup();
  });

  // A busca do data-table filtra as linhas que ELE tem: sobre uma pagina de 20
  // ela diria "nenhum resultado" para um registro que existe na pagina 7.
  test('nao oferece busca de cliente', async () => {
    const lista = await montar(() => Promise.resolve(pagina(1, 20, 349)));

    expect(container.querySelector('.data-table-search')).toBeNull();
    expect(container.querySelector('input[type="search"]')).toBeNull();

    lista.cleanup();
  });

  // Virar pagina duas vezes depressa: a resposta que chega ATRASADA nao pode
  // pintar por cima da que chegou depois dela. Sem o descarte por token, a tela
  // acabaria mostrando a pagina que a pessoa ja tinha deixado para tras, com o
  // rodape dizendo outra.
  test('resposta atrasada nao pinta sobre a resposta mais recente', async () => {
    const pendentes = [];
    const carregar = vi.fn(({ page, limit }) => {
      // A montagem resolve na hora; as viradas ficam sob controle do teste.
      if (page === 1) return Promise.resolve(pagina(1, limit, 349));
      return new Promise(resolve => pendentes.push({ page, limit, resolve }));
    });
    const lista = await montar(carregar);

    proxima().click();   // pede a 2, fica pendurada
    await flush();
    proxima().click();   // pede de novo, tambem pendurada
    await flush();
    expect(pendentes).toHaveLength(2);

    // A SEGUNDA responde primeiro, com uma pagina distinguivel...
    pendentes[1].resolve(pagina(5, 20, 349));
    await flush();
    expect(rodape()).toBe('81-100 de 349');

    // ...e a PRIMEIRA chega atrasada, com outra. Ela e descartada.
    pendentes[0].resolve(pagina(2, 20, 349));
    await flush();
    expect(rodape()).toBe('81-100 de 349');
    expect(container.textContent).toContain('registro 81');
    expect(container.textContent).not.toContain('registro 21');

    lista.cleanup();
  });

  test('lista vazia mostra o texto proprio e nao desenha rodape', async () => {
    const lista = await montar(() => Promise.resolve({
      dados: [],
      pagination: { totalItems: 0, totalPages: 0, currentPage: 1, pageSize: 20 },
    }));

    expect(container.textContent).toContain('Nada aqui');
    expect(container.querySelector('.pagination__info')).toBeNull();

    lista.cleanup();
  });

  test('a falha vira aviso e limpa o rodape, em vez de tela em branco', async () => {
    const lista = await montar(() => Promise.reject(new Error('Acesso negado')));

    expect(showError).toHaveBeenCalledWith('Acesso negado');
    expect(container.querySelector('.pagination__info')).toBeNull();

    lista.cleanup();
  });

  // Quem estava na pagina 7 da lapide continua nela.
  test('refresh recarrega a pagina ATUAL, e nao a primeira', async () => {
    const carregar = vi.fn(({ page, limit }) => Promise.resolve(pagina(page, limit, 349)));
    const lista = await montar(carregar);

    proxima().click();
    await flush();

    await lista.refresh();
    expect(carregar).toHaveBeenLastCalledWith({ page: 2, limit: 20 });

    lista.cleanup();
  });
});
