import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O EXERCÍCIO É O PRIMEIRO PASSO do fluxo do PIT, e a tela precisa oferecê-lo:
// `pit.meta`, `pit.revisao` e `pit.demanda_extra` referenciam
// `pit.exercicio(ano)`, e o `criarRevisao` recusa com "o exercício de AAAA não
// existe". Sem o botão, um ano novo é um beco sem saída pela interface.

const servico = vi.hoisted(() => ({
  listarExercicios: vi.fn(),
  listarRevisoes: vi.fn(),
  excluirRevisao: vi.fn(),
  listarAnexosRevisao: vi.fn(),
  enviarAnexoRevisao: vi.fn(),
  excluirAnexoRevisao: vi.fn(),
  baixarAnexoRevisao: vi.fn(),
  criarExercicio: vi.fn(),
  atualizarExercicio: vi.fn(),
  criarRevisao: vi.fn(),
  atualizarRevisao: vi.fn(),
}));

vi.mock('@services/plataforma-service.js', () => servico);
vi.mock('@utils/toast.js', () => ({
  showError: vi.fn(), showSuccess: vi.fn(), showWarning: vi.fn(),
}));
vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: () => ({ element: document.createElement('div'), recarregar: vi.fn() }),
}));

const auth = vi.hoisted(() => ({ admin: true }));
vi.mock('@store/auth-store.js', () => ({ isAdmin: () => auth.admin }));

const { renderRevisoesPit } = await import('./index.js');

const botao = (texto) => [...document.querySelectorAll('button')]
  .find((b) => b.textContent.includes(texto));

describe('revisões do PIT: o exercício do ano', () => {
  let container;

  beforeEach(() => {
    document.body.innerHTML = '';
    container = document.createElement('div');
    document.body.appendChild(container);
    auth.admin = true;
    servico.listarRevisoes.mockResolvedValue([]);
    servico.criarExercicio.mockResolvedValue({ ano: 2026 });
  });

  afterEach(() => {
    vi.clearAllMocks();
    document.body.innerHTML = '';
  });

  test('sem exercício no ano, a tela ABRE o exercício e barra a revisão nova', async () => {
    const ano = new Date().getFullYear();
    servico.listarExercicios.mockResolvedValue([]);

    await renderRevisoesPit(container);
    await flush();

    // A revisão sem exercício só levaria 400: o botão sai do caminho e o motivo
    // aparece no title, em vez de a pessoa descobrir pelo erro.
    const nova = botao('Nova revisão');
    expect(nova.disabled).toBe(true);
    expect(nova.title).toMatch(/exerc[íi]cio/i);

    expect(container.textContent).toMatch(/ainda n[ãa]o tem exerc[íi]cio/i);

    // O botão não fica só na tela: apertá-lo abre o diálogo e grava o exercício
    // do ANO CORRENTE. Sem o clique, "existe o botão" não diz nada.
    botao('Abrir exercício').click();
    await flush();

    const salvar = [...document.querySelectorAll('.modal__footer button')]
      .find(b => b.textContent.includes('Salvar'));
    salvar.click();
    await flush();

    expect(servico.criarExercicio).toHaveBeenCalledWith(
      expect.objectContaining({ ano, situacao_id: 2 }),
    );
  });

  test('com exercício no ano, o botão vira Editar e a revisão libera', async () => {
    const ano = new Date().getFullYear();
    servico.listarExercicios.mockResolvedValue([
      { ano, situacao_id: 2, situacao: 'Vigente', observacao: null },
    ]);

    await renderRevisoesPit(container);
    await flush();

    expect(botao('Editar exercício')).toBeTruthy();
    expect(botao('Nova revisão').disabled).toBe(false);
    expect(container.textContent).toContain('Vigente');
  });

  test('quem não é administrador não vê nenhum dos dois botões', async () => {
    auth.admin = false;
    servico.listarExercicios.mockResolvedValue([]);

    await renderRevisoesPit(container);
    await flush();

    expect(botao('Abrir exercício')).toBeFalsy();
    expect(botao('Nova revisão')).toBeFalsy();
  });
});
