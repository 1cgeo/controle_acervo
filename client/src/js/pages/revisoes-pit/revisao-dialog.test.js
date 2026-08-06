import {
  describe, test, expect, vi, beforeEach,
} from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O CORPO DA REVISÃO: o que entra na criação e o que entra na edição NÃO são a
// mesma coisa, e o servidor cobra a diferença com 400.
//
// `ano` é IDENTIDADE da revisão: ela pertence a um exercício e nunca muda de
// ano. Por isso `pit_schema.atualizarRevisao` não o aceita, e a validação
// daquelas rotas é ESTRITA (campo desconhecido vira 400 com sugestão, em vez de
// sumir no stripUnknown como no resto da plataforma).
//
// Enquanto o diálogo montava um corpo só para os dois casos, editar QUALQUER
// revisão respondia `campo desconhecido "ano"`. O defeito apareceu em produção.

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock('@services/plataforma-service.js', () => ({
  criarRevisao: vi.fn(() => Promise.resolve({ id: 9 })),
  atualizarRevisao: vi.fn(() => Promise.resolve()),
}));

vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: () => ({ element: document.createElement('div'), recarregar: vi.fn() }),
}));

import { abrirDialogoRevisao } from '@pages/revisoes-pit/revisao-dialog.js';
import { criarRevisao, atualizarRevisao } from '@services/plataforma-service.js';

const REVISAO = {
  id: 8,
  ano: 2026,
  codigo: 'R1',
  data_documento: '2026-05-11',
  data_assinatura: '2026-05-14',
  assinante: 'Gen Div Alexandre Martins Castilho',
  observacao: null,
};

const salvar = () => {
  const botao = [...document.querySelectorAll('button')]
    .find((b) => b.textContent.trim() === 'Salvar');
  botao.click();
};

describe('diálogo da revisão do PIT: o corpo de criar e o de editar', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  // O CASO QUE REPROVA O DEFEITO. Sem a correção, o corpo levava `ano` e o
  // servidor devolvia 400.
  test('editar NÃO manda `ano`, que a rota de atualização recusa', async () => {
    abrirDialogoRevisao({ revisao: REVISAO });
    await flush();

    salvar();
    await flush();

    expect(atualizarRevisao).toHaveBeenCalledTimes(1);
    const [id, corpo] = atualizarRevisao.mock.calls[0];
    expect(id).toBe(8);
    expect('ano' in corpo).toBe(false);

    // Rede contra o falso verde: o corpo não pode estar vazio. Um diálogo que
    // não montasse nada também passaria na asserção acima.
    expect(corpo.codigo).toBe('R1');
    expect(corpo.assinante).toBe('Gen Div Alexandre Martins Castilho');

    expect(criarRevisao).not.toHaveBeenCalled();
  });

  // O CONTROLE POSITIVO. Na criação o ano é obrigatório: é ele que diz a que
  // exercício a revisão nova pertence.
  test('criar MANDA `ano`, que a rota de criação exige', async () => {
    abrirDialogoRevisao({ ano: 2027 });
    await flush();

    const codigo = [...document.querySelectorAll('input')]
      .find((i) => i.value === '' && i.type !== 'date');
    codigo.value = 'R0';
    codigo.dispatchEvent(new Event('input', { bubbles: true }));

    salvar();
    await flush();

    expect(criarRevisao).toHaveBeenCalledTimes(1);
    const [corpo] = criarRevisao.mock.calls[0];
    expect(corpo.ano).toBe(2027);
    expect(corpo.codigo).toBe('R0');

    expect(atualizarRevisao).not.toHaveBeenCalled();
  });
});
