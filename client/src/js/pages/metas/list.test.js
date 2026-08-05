import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Tela de PLATAFORMA das metas do PIT (#/metas), que saiu do modulo orcamento.
// O que ela fixa: LER e de qualquer pessoa logada, ESCREVER e do
// administrador global, e o codigo da meta sai da mesma regra do resto do
// sistema ('4.1' no sub-item, o numero na meta indivisa).
vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getMetasPit: vi.fn(() => Promise.resolve([])),
    getAnosMetaPit: vi.fn(() => Promise.resolve([2026, 2025])),
    deleteMetaPit: vi.fn(() => Promise.resolve()),
  };
});

import { renderMetasList } from '@pages/metas/list.js';
import { getMetasPit, getAnosMetaPit } from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: [] }, 'x');
}

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderMetasList(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

const METAS = [
  { id: 1, ano: 2026, numero_meta: 4, item: '4.1', descricao: 'Impressão em sulfite' },
  { id: 2, ano: 2026, numero_meta: 4, item: '4.2', descricao: 'Impressão em Tyvek' },
  // Meta indivisa: o cadastro de 2026 usa '-' no nível da meta.
  { id: 3, ano: 2026, numero_meta: 1, item: '-', descricao: 'Produção de Geoinformação' },
];

describe('renderMetasList', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('carrega as metas e mostra o código de cada uma', async () => {
    logar({ perfis: { mapoteca: 3 } });
    getMetasPit.mockResolvedValueOnce(METAS);

    const { container, cleanup } = await montar();

    expect(getMetasPit).toHaveBeenCalled();
    const codigos = [...container.querySelectorAll('tbody tr td:nth-child(2)')]
      .map(td => td.textContent);
    // Sub-item sai como '4.1'; meta indivisa sai como o número dela.
    expect(codigos).toEqual(['4.1', '4.2', '1']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem não é administrador não recebe botão de criar nem ações de linha', async () => {
    logar({ perfis: { mapoteca: 3 } });
    getMetasPit.mockResolvedValueOnce(METAS);

    const { container, cleanup } = await montar();

    expect(container.querySelector('.btn--primary')).toBeNull();
    expect(container.querySelector('.data-table__action-btn')).toBeNull();
    // Mas a lista aparece: ler é de qualquer pessoa logada.
    expect(container.querySelectorAll('tbody tr').length).toBe(3);

    if (typeof cleanup === 'function') cleanup();
  });

  // A meta de METAS não tem `revisao_id`: revisão nenhuma a declarou, então o
  // servidor recusaria a correção de transcrição com "não há transcrição a
  // corrigir". Sobram editar e excluir.
  test('o administrador recebe criar, editar e excluir', async () => {
    logar({ administrador: true });
    getMetasPit.mockResolvedValueOnce(METAS);

    const { container, cleanup } = await montar();

    expect(container.querySelector('.btn--primary')).not.toBeNull();
    expect(container.querySelectorAll('tbody tr:first-child .data-table__action-btn').length)
      .toBe(2);
    expect(container.querySelector('[title="Corrigir transcrição"]')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // A CORREÇÃO DE TRANSCRIÇÃO, que a mensagem de erro do servidor promete.
  //
  // Editar exige revisão ABERTA; a recusa do servidor manda usar esta correção,
  // e até agora ela não existia em tela nenhuma. Ela só aparece na meta que já
  // TEM declaração (`pit.meta_vigente.revisao_id`), porque é essa linha que ela
  // reescreve.
  test('a meta com declaração em vigor ganha a ação de corrigir transcrição', async () => {
    logar({ administrador: true });
    getMetasPit.mockResolvedValueOnce([
      { ...METAS[0], revisao_id: 7, revisao: 'R1' },
      METAS[1],
    ]);

    const { container, cleanup } = await montar();

    const linhas = [...container.querySelectorAll('tbody tr')];
    expect(linhas[0].querySelector('[title="Corrigir transcrição"]')).not.toBeNull();
    // CONTROLE NEGATIVO: a linha sem `revisao_id` não oferece a ação, senão o
    // botão levaria direto ao 400 do servidor.
    expect(linhas[1].querySelector('[title="Corrigir transcrição"]')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem não é administrador não recebe a correção de transcrição', async () => {
    logar({ perfis: { mapoteca: 3 } });
    getMetasPit.mockResolvedValueOnce([{ ...METAS[0], revisao_id: 7, revisao: 'R1' }]);

    const { container, cleanup } = await montar();

    // A rota é `verifyAdmin` (pit_route.js). Oferecer o botão a quem o servidor
    // vai recusar entrega um 403 no lugar de uma tela.
    expect(container.querySelector('[title="Corrigir transcrição"]')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // A tela é de plataforma e usa o filtro de ano compartilhado
  // (@components/filtro-ano.js), o mesmo das telas do orçamento. Ele nasce no
  // ano corrente e não guarda a escolha em lugar nenhum.
  test('filtra por ano com filtro próprio, no ano corrente', async () => {
    logar({ administrador: true });
    getMetasPit.mockResolvedValueOnce(METAS);

    const { container, cleanup } = await montar();

    expect(getMetasPit).toHaveBeenCalledWith(new Date().getFullYear());
    const select = container.querySelector('.page__filters select');
    expect(select).not.toBeNull();
    expect(select.value).toBe(String(new Date().getFullYear()));

    if (typeof cleanup === 'function') cleanup();
  });

  // O `codigo` NÃO vem do servidor. A busca e a ordenação do data-table leem
  // `row[col.key]`, então enquanto ele só existia no `render` a coluna "Meta"
  // não ordenava (todo valor era `undefined`) e a busca por "4.1" não achava
  // nada do que estava na tela.
  //
  // CONTROLE NEGATIVO: a lista chega fora de ordem de código (4.1, 4.2, 1) e o
  // esperado é a ordem crescente. Com a coluna sem valor, `getFilteredRows`
  // devolve a ordem de entrada e a asserção reprova.
  test('a coluna Meta ordena pelo código', async () => {
    logar({ administrador: true });
    getMetasPit.mockResolvedValueOnce(METAS);

    const { container, cleanup } = await montar();

    const th = [...container.querySelectorAll('th')]
      .find(c => c.textContent.includes('Meta'));
    expect(th).not.toBeUndefined();
    th.click();

    const codigos = [...container.querySelectorAll('tbody tr td:nth-child(2)')]
      .map(td => td.textContent);
    expect(codigos).toEqual(['1', '4.1', '4.2']);

    if (typeof cleanup === 'function') cleanup();
  });

  // A busca do data-table varre `row[col.key]`. Sem o `codigo` na linha, digitar
  // o código da meta não filtrava nada.
  test('a busca acha a meta pelo código', async () => {
    logar({ administrador: true });
    getMetasPit.mockResolvedValueOnce(METAS);

    const { container, cleanup } = await montar();

    const busca = container.querySelector('.data-table-toolbar__search-input');
    expect(busca).not.toBeNull();
    busca.value = '4.2';
    busca.dispatchEvent(new Event('input'));

    const linhas = [...container.querySelectorAll('tbody tr')];
    expect(linhas.length).toBe(1);
    expect(linhas[0].textContent).toContain('Impressão em Tyvek');

    if (typeof cleanup === 'function') cleanup();
  });

  test('as opções do ano vêm de GET /metas/anos, sem a opção de outro ano', async () => {
    logar({ administrador: true });
    getMetasPit.mockResolvedValueOnce(METAS);

    const { container, cleanup } = await montar();

    expect(getAnosMetaPit).toHaveBeenCalled();
    const opcoes = [...container.querySelectorAll('.page__filters select option')]
      .map(o => o.textContent);
    expect(opcoes).toContain('2025');
    // `permitirOutroAno: false`: no PIT o ano só filtra o que já existe, e um
    // ano vazio abriria uma tela em branco.
    expect(opcoes.some(o => o.includes('Outro ano'))).toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });
});
