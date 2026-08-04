// O painel de historico e recarregado por fora depois de toda gravacao: seis
// fichas chamam `recarregar()` no `onSaved`. Se cada chamada refizesse a tabela,
// a pessoa perderia a ordenacao e a pagina em que estava, e a secao mudaria de
// altura debaixo do cursor. Este arquivo prova que a tabela SOBREVIVE.
//
// Nasceu em 2026-08-04, quando tres agentes independentes apontaram o mesmo
// ponto ao consertar o re-render das telas que consomem este componente.

import { describe, test, expect, vi, beforeEach } from 'vitest';

const getHistorico = vi.fn();

vi.mock('@services/rastreabilidade-service.js', () => ({
  getHistorico: (...args) => getHistorico(...args),
}));

const { criarHistorico } = await import('./historico.js');

// Dois eventos, e a cada chamada eles voltam como OBJETOS NOVOS, que e o que o
// servidor devolve. Reaproveitar o no por identidade de referencia passaria no
// teste e falharia na tela.
function eventos(sufixo = '') {
  return [
    {
      id: 1,
      data_evento: '2026-08-01T10:00:00Z',
      usuario_nome: `Cap Fulano${sufixo}`,
      operacao: 'I',
      mudancas: [],
    },
    {
      id: 2,
      data_evento: '2026-08-02T10:00:00Z',
      usuario_nome: `Maj Beltrano${sufixo}`,
      operacao: 'U',
      mudancas: [],
    },
  ];
}

async function esperar() {
  await new Promise((r) => setTimeout(r, 0));
}

describe('criarHistorico: recarregar nao remonta a tabela', () => {
  beforeEach(() => {
    getHistorico.mockReset();
    getHistorico.mockImplementation(() => Promise.resolve(eventos()));
  });

  test('a tabela e a MESMA depois de recarregar', async () => {
    const painel = criarHistorico({ modulo: 'plataforma', entidade: 'usuario', id: 'u1' });
    document.body.appendChild(painel.element);
    await esperar();

    const antes = painel.element.querySelector('.data-table-wrapper');
    expect(antes).not.toBeNull();

    await painel.recarregar();
    await esperar();

    const depois = painel.element.querySelector('.data-table-wrapper');
    expect(depois).toBe(antes);
  });

  test('a linha do mesmo evento mantem o mesmo <tr>', async () => {
    const painel = criarHistorico({ modulo: 'plataforma', entidade: 'usuario', id: 'u1' });
    document.body.appendChild(painel.element);
    await esperar();

    const antes = painel.element.querySelector('tbody tr');

    getHistorico.mockImplementation(() => Promise.resolve(eventos(' II')));
    await painel.recarregar();
    await esperar();

    const depois = painel.element.querySelector('tbody tr');
    expect(depois).toBe(antes);
    // E o dado novo chegou ao no que sobreviveu.
    expect(painel.element.textContent).toContain('Fulano II');
  });

  test('a ordenacao escolhida sobrevive a recarga', async () => {
    const painel = criarHistorico({ modulo: 'plataforma', entidade: 'usuario', id: 'u1' });
    document.body.appendChild(painel.element);
    await esperar();

    painel.element.querySelector('th.data-table__th--sortable').click();
    // O clique repinta o cabecalho, entao o `th` tem de ser lido DE NOVO. Ler o
    // no guardado antes do clique mede o nó velho, que ficou em 'none'.
    const ordemEscolhida = painel.element
      .querySelector('th.data-table__th--sortable')
      .getAttribute('aria-sort');
    expect(ordemEscolhida).not.toBe('none');

    await painel.recarregar();
    await esperar();

    const depois = painel.element.querySelector('th.data-table__th--sortable');
    expect(depois.getAttribute('aria-sort')).toBe(ordemEscolhida);
  });

  test('o erro na recarga nao apaga a tabela que ja esta na tela', async () => {
    const painel = criarHistorico({ modulo: 'plataforma', entidade: 'usuario', id: 'u1' });
    document.body.appendChild(painel.element);
    await esperar();

    const antes = painel.element.querySelector('.data-table-wrapper');

    getHistorico.mockImplementation(() => Promise.reject(new Error('falhou')));
    await painel.recarregar();
    await esperar();

    // A tabela continua, e o aviso de falha aparece ao lado dela. Trocar a
    // tabela pela mensagem faria a recarga que falha apagar o que ja se sabia.
    expect(painel.element.querySelector('.data-table-wrapper')).toBe(antes);
    expect(painel.element.textContent).toContain('falhou');
  });

  test('a primeira carga ainda monta a tabela do zero', async () => {
    const painel = criarHistorico({ modulo: 'plataforma', entidade: 'usuario', id: 'u1' });
    document.body.appendChild(painel.element);

    // Antes da resposta nao ha tabela nenhuma: e o unico momento em que a
    // montagem e correta.
    expect(painel.element.querySelector('.data-table-wrapper')).toBeNull();

    await esperar();
    expect(painel.element.querySelector('.data-table-wrapper')).not.toBeNull();
  });
});

// O HISTORICO VAZIO NAO PODE DIZER "NADA MUDOU" (2026-08-04).
//
// O registro unificado de alteracoes so passou a existir em 2026-07-30, e o
// acervo e muito mais velho: 92,8% das versoes e 91,0% dos produtos foram
// cadastrados antes do corte (medido no banco de producao em 2026-08-04). A
// frase "Nenhuma alteracao registrada", sozinha, aparecia em mais de nove de
// cada dez fichas e se lia como "este registro nunca mudou".
describe('historico sem eventos', () => {
  test('a mensagem de vazio diz quando o registro comecou', async () => {
    getHistorico.mockImplementation(() => Promise.resolve([]));

    const painel = criarHistorico({ modulo: 'acervo', entidade: 'produto', id: 42 });
    document.body.appendChild(painel.element);
    await esperar();

    const vazio = painel.element.querySelector('.data-table__empty');
    expect(vazio).not.toBeNull();
    // A data vem formatada em pt-BR, que e como o resto do sistema a mostra.
    expect(vazio.textContent).toContain('30/07/2026');
    // E a frase nao para na afirmacao que enganava.
    expect(vazio.textContent).not.toBe('Nenhuma alteração registrada');
  });

  test('havendo eventos, a mensagem de vazio nao aparece', async () => {
    getHistorico.mockImplementation(() => Promise.resolve(eventos()));

    const painel = criarHistorico({ modulo: 'acervo', entidade: 'produto', id: 42 });
    document.body.appendChild(painel.element);
    await esperar();

    expect(painel.element.textContent).not.toContain('30/07/2026');
  });
});
