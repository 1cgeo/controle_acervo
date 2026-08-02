import { describe, test, expect, vi } from 'vitest';
import { criarPaginacao } from '@components/paginacao/paginacao.js';

const info = (p) => p.element.querySelector('.pagination__info span')?.textContent;
const botao = (p, rotulo) =>
  [...p.element.querySelectorAll('.pagination__btn')]
    .find(b => b.getAttribute('aria-label') === rotulo);

describe('criarPaginacao', () => {
  test('diz o intervalo e o TOTAL do servidor, e nao o tamanho da pagina', () => {
    const p = criarPaginacao({ onMudar: () => {} });
    p.atualizar({ totalItems: 349, totalPages: 18, currentPage: 1, pageSize: 20 });

    expect(info(p)).toBe('1-20 de 349');
  });

  test('a ultima pagina mostra o intervalo curto', () => {
    const p = criarPaginacao({ onMudar: () => {} });
    p.atualizar({ totalItems: 349, totalPages: 18, currentPage: 18, pageSize: 20 });

    expect(info(p)).toBe('341-349 de 349');
  });

  test('desabilita anterior na primeira pagina e proxima na ultima', () => {
    const p = criarPaginacao({ onMudar: () => {} });

    p.atualizar({ totalItems: 100, totalPages: 5, currentPage: 1, pageSize: 20 });
    expect(botao(p, 'Página anterior').disabled).toBe(true);
    expect(botao(p, 'Próxima página').disabled).toBe(false);

    p.atualizar({ totalItems: 100, totalPages: 5, currentPage: 5, pageSize: 20 });
    expect(botao(p, 'Página anterior').disabled).toBe(false);
    expect(botao(p, 'Próxima página').disabled).toBe(true);
  });

  test('virar pagina avisa quem chamou, com a pagina e o tamanho', () => {
    const onMudar = vi.fn();
    const p = criarPaginacao({ onMudar });
    p.atualizar({ totalItems: 100, totalPages: 5, currentPage: 3, pageSize: 20 });

    botao(p, 'Próxima página').click();
    expect(onMudar).toHaveBeenCalledWith(4, 20);

    botao(p, 'Página anterior').click();
    expect(onMudar).toHaveBeenCalledWith(2, 20);
  });

  // Manter a pagina 7 ao passar de 20 para 100 por pagina pularia o registro que
  // a pessoa estava lendo.
  test('trocar o tamanho volta para a primeira pagina', () => {
    const onMudar = vi.fn();
    const p = criarPaginacao({ onMudar });
    p.atualizar({ totalItems: 1000, totalPages: 50, currentPage: 7, pageSize: 20 });

    const select = p.element.querySelector('.pagination__select');
    select.value = '100';
    select.dispatchEvent(new Event('change'));

    expect(onMudar).toHaveBeenCalledWith(1, 100);
  });

  // O teto do servidor e 100 (gerencia_schema.paginationParams). Oferecer mais
  // produziria um 400 do Joi a partir de um combo de interface.
  test('nao oferece tamanho acima do teto do servidor', () => {
    const p = criarPaginacao({ onMudar: () => {} });
    p.atualizar({ totalItems: 1000, totalPages: 50, currentPage: 1, pageSize: 20 });

    const opcoes = [...p.element.querySelectorAll('.pagination__select option')]
      .map(o => Number(o.value));
    expect(Math.max(...opcoes)).toBe(100);
  });

  test('lista vazia nao desenha rodape nenhum', () => {
    const p = criarPaginacao({ onMudar: () => {} });
    p.atualizar({ totalItems: 0, totalPages: 0, currentPage: 1, pageSize: 20 });

    expect(p.element.children).toHaveLength(0);
  });

  test('falha na carga limpa o rodape em vez de deixar o anterior', () => {
    const p = criarPaginacao({ onMudar: () => {} });
    p.atualizar({ totalItems: 349, totalPages: 18, currentPage: 1, pageSize: 20 });
    expect(p.element.children.length).toBeGreaterThan(0);

    p.atualizar(null);
    expect(p.element.children).toHaveLength(0);
  });
});
