import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

const ehGerente = vi.fn(() => true);
const ehAdmin = vi.fn(() => false);

vi.mock('@store/auth-store.js', async (importarOriginal) => ({
  ...(await importarOriginal()),
  isAdmin: () => ehAdmin(),
  ehGerenteDeAlgumModulo: () => ehGerente(),
}));

vi.mock('@services/plataforma-service.js', async (importarOriginal) => ({
  ...(await importarOriginal()),
  getGradePit: vi.fn(),
  getDiagnosticoPit: vi.fn(),
  getAnosMetaPit: vi.fn(() => Promise.resolve([2026])),
}));

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getPlanoDoAno: vi.fn(),
}));

import { renderPlanoTab } from './plano-tab.js';
import * as acervoService from '@modules/acervo/services/acervo-service.js';
import * as plataforma from '@services/plataforma-service.js';

const PLANO_VAZIO = { a_produzir: [], lotes_em_execucao: [], extra_pit: [] };

const titulos = (c) => Array.from(c.querySelectorAll('.chart-card__title')).map(t => t.textContent);

beforeEach(() => {
  vi.clearAllMocks();
  ehGerente.mockReturnValue(true);
  ehAdmin.mockReturnValue(false);
  acervoService.getPlanoDoAno.mockResolvedValue(PLANO_VAZIO);
  plataforma.getGradePit.mockResolvedValue([]);
  plataforma.getDiagnosticoPit.mockResolvedValue([]);
  plataforma.getAnosMetaPit.mockResolvedValue([2026]);
});

describe('renderPlanoTab', () => {
  test('monta os blocos do plano e pede a grade quando o perfil e gerente', async () => {
    const c = document.createElement('div');
    await renderPlanoTab(c);

    expect(acervoService.getPlanoDoAno).toHaveBeenCalled();
    expect(plataforma.getGradePit).toHaveBeenCalled();
    expect(titulos(c)).toEqual(
      expect.arrayContaining(['A produzir', 'Lotes em andamento'])
    );
  });

  test('quem NAO e gerente nao pede a grade e recebe o aviso no lugar dela', async () => {
    ehGerente.mockReturnValue(false);
    const c = document.createElement('div');
    await renderPlanoTab(c);

    // Pedir sem o perfil traria 403 do verifyGerente e derrubaria o bloco.
    expect(plataforma.getGradePit).not.toHaveBeenCalled();
    expect(plataforma.getDiagnosticoPit).not.toHaveBeenCalled();
    expect(titulos(c)).not.toContain('Metas do PIT 2026');
    expect(c.textContent).toContain('aparecem para o perfil de gerente');
    // O plano do ACERVO continua na tela: ele cobra so consulta.
    expect(titulos(c)).toContain('A produzir');
  });

  test('o ADMINISTRADOR sem perfil de modulo ve a faixa de metas', async () => {
    // O `verifyGerente` do servidor passa o administrador global. Enquanto a
    // tela olhava so os perfis por modulo, o admin de producao (que tem `perfis`
    // vazio) recebia "as metas aparecem para o perfil de gerente" numa rota que
    // o servidor teria respondido.
    ehGerente.mockReturnValue(false);
    ehAdmin.mockReturnValue(true);
    const c = document.createElement('div');
    await renderPlanoTab(c);

    expect(plataforma.getGradePit).toHaveBeenCalled();
    expect(c.textContent).not.toContain('aparecem para o perfil de gerente');
  });

  test('a folha sem data prevista vira AVISO, e nao um traco', async () => {
    acervoService.getPlanoDoAno.mockResolvedValue({
      ...PLANO_VAZIO,
      a_produzir: [
        { id: 1, mi: '2758-3-NE', produto: 'Arapongas-NE', tipo_produto: 'Carta Ortoimagem',
          tipo_escala: '1:25.000', data_prevista: null, dias_atraso: null, meta: null, lote: null },
      ],
    });
    const c = document.createElement('div');
    await renderPlanoTab(c);

    // "-" leria como "nao se aplica"; a folha planejada SEM data e erro de
    // cadastro, e some do planejado do PIT sem erro nenhum.
    expect(c.textContent).toContain('Sem data prevista');
    expect(c.querySelector('.chip--error')).not.toBeNull();
  });

  test('o atraso em dias sai como erro e o que esta no prazo sai como sucesso', async () => {
    acervoService.getPlanoDoAno.mockResolvedValue({
      ...PLANO_VAZIO,
      a_produzir: [
        { id: 1, mi: 'A', produto: 'A', tipo_produto: 'T', tipo_escala: 'E',
          data_prevista: '2026-01-31', dias_atraso: 12, meta: '1.1', lote: 'x' },
        { id: 2, mi: 'B', produto: 'B', tipo_produto: 'T', tipo_escala: 'E',
          data_prevista: '2026-12-31', dias_atraso: 0, meta: '1.1', lote: 'x' },
      ],
    });
    const c = document.createElement('div');
    await renderPlanoTab(c);

    expect(c.textContent).toContain('12 dia(s)');
    expect(c.textContent).toContain('No prazo');
  });

  test('o diagnostico so aparece quando ha meta com problema', async () => {
    const c1 = document.createElement('div');
    await renderPlanoTab(c1);
    // Tudo em ordem: o bloco nao entra. Lista que sempre aparece treina quem
    // olha a ignora-la.
    expect(titulos(c1)).not.toContain('Cadastro incompleto do PIT');

    plataforma.getDiagnosticoPit.mockResolvedValue([
      { item: '1.3', descricao: 'Carta Ortoimagem', origem: 'Produção',
        quantidade_prevista: 72, cadastradas: 72, sem_data: 72, faltam: 0 },
      { item: '5.1', descricao: 'Capacitação', origem: 'Capacitação',
        quantidade_prevista: 1, cadastradas: 1, sem_data: 0, faltam: 0 },
    ]);
    const c2 = document.createElement('div');
    await renderPlanoTab(c2);
    expect(titulos(c2)).toContain('Cadastro incompleto do PIT');
    // So a linha com problema entra: a 5.1 esta completa.
    expect(c2.textContent).toContain('1.3');
    expect(c2.textContent).not.toContain('5.1');
  });

  test('a falha do plano toma a aba, e a falha da grade toma so o bloco dela', async () => {
    acervoService.getPlanoDoAno.mockRejectedValue(new Error('sem rede'));
    const c1 = document.createElement('div');
    await renderPlanoTab(c1);
    // Tabela vazia diria "nada a produzir", que e a leitura oposta.
    expect(titulos(c1)).not.toContain('A produzir');
    expect(c1.textContent).toContain('sem rede');

    acervoService.getPlanoDoAno.mockResolvedValue(PLANO_VAZIO);
    plataforma.getGradePit.mockRejectedValue(new Error('403 sem permissao'));
    const c2 = document.createElement('div');
    await renderPlanoTab(c2);
    expect(c2.textContent).toContain('403 sem permissao');
    expect(titulos(c2)).toContain('A produzir');
  });

  test('a meta com plano e realizado ZERO ainda mostra o estado na barra', async () => {
    // Visto na tela: com progresso 0% o `__fill` tem largura zero e some, e a
    // meta que prometia 4.200 e entregou nada ficava igual a que nao tem plano.
    // Quem carrega o estado agora e o TRILHO.
    plataforma.getGradePit.mockResolvedValue([
      { item: '6.1', descricao: 'Catalogação', quantidade_prevista: 4200,
        planejado: 4200, realizado: 0, cancelada: false },
    ]);
    const c = document.createElement('div');
    await renderPlanoTab(c);

    const barra = c.querySelector('.progress-bar');
    expect(barra.className).toContain('progress-bar--error');
    expect(barra.querySelector('.progress-bar__fill').style.width).toBe('0%');
  });

  test('a meta cancelada nao entra na faixa', async () => {
    plataforma.getGradePit.mockResolvedValue([
      { item: '5.1', descricao: 'Vale', quantidade_prevista: 1, planejado: 1, realizado: 1, cancelada: false },
      { item: '5.2', descricao: 'Cancelada pelo R1', quantidade_prevista: 1, planejado: 1, realizado: 0, cancelada: true },
    ]);
    const c = document.createElement('div');
    await renderPlanoTab(c);

    expect(c.textContent).toContain('Vale');
    expect(c.textContent).not.toContain('Cancelada pelo R1');
  });

  test('o refresh recarrega sem remontar a aba', async () => {
    const c = document.createElement('div');
    const { refresh } = await renderPlanoTab(c);
    const antes = acervoService.getPlanoDoAno.mock.calls.length;

    await refresh();
    await flush();

    expect(acervoService.getPlanoDoAno.mock.calls.length).toBe(antes + 1);
    expect(titulos(c)).toContain('A produzir');
  });
});
