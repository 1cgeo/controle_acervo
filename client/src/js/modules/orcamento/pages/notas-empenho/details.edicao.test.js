import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O que estes testes protegem: EDITAR uma liquidacao ou um recebimento grava.
//
// O defeito: o corpo do PUT levava so os campos do
// formulario. O schema do servidor cobra nota_empenho_id no models.atualizar
// (liquidacao_schema.js:22,33 e recebimento_schema.js:19,33), entao o PUT
// devolvia 400 "nota_empenho_id is required" SEMPRE. O criar funcionava, porque
// createLiquidacao recebe { nota_empenho_id, ...body }. O botao de lapis das
// duas tabelas nunca gravou. Restava excluir e relancar, e excluir e do gerente.
//
// Arquivo SEPARADO do details.remonte.test.js: aqui se testa o CORPO enviado,
// e nao o que sobrevive a uma gravacao.

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotaEmpenho: vi.fn(),
  getLiquidacoes: vi.fn(),
  createLiquidacao: vi.fn(() => Promise.resolve({})),
  updateLiquidacao: vi.fn(() => Promise.resolve({})),
  deleteLiquidacao: vi.fn(() => Promise.resolve({})),
  getRecebimentos: vi.fn(),
  createRecebimento: vi.fn(() => Promise.resolve({})),
  updateRecebimento: vi.fn(() => Promise.resolve({})),
  deleteRecebimento: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@services/rastreabilidade-service.js', () => ({
  getHistorico: vi.fn(() => Promise.resolve([])),
  getRastreabilidade: vi.fn(() => Promise.resolve({ dados: [], pagination: null })),
  getFiltrosRastreabilidade: vi.fn(() => Promise.resolve({
    modulos: [], entidades: [], origens: [], usuarios: [],
  })),
}));

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
}));

import { renderNotaEmpenhoDetails } from '@modules/orcamento/pages/notas-empenho/details.js';
import {
  getNotaEmpenho, getLiquidacoes, getRecebimentos,
  updateLiquidacao, updateRecebimento,
} from '@modules/orcamento/services/orcamento-service.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';

const NOTA = {
  id: 10,
  numero: '2026NE000123',
  ano: 2026,
  nota_credito_id: 5,
  nota_credito_numero: '2026NC000045',
  notas_credito: [{ nota_credito_id: 5, nota_credito_numero: '2026NC000045', valor: 1000 }],
  cod_nd: '449052',
  nd_nome: 'Equipamentos de processamento de dados',
  valor_empenhado: 1000,
  valor_anulado: 0,
  saldo_a_liquidar: 400,
};

const LIQUIDACOES = [
  { id: 1, valor_liquidado: 600, data: '2026-03-10', documento_ns: '2026NS000001' },
];

const RECEBIMENTOS = [
  { id: 20, material: 'Plotter A0', prazo_entrega: '30 dias', situacao: 'Entregue' },
];

const acao = (c, titulo) => c.querySelector(`.data-table__action-btn[title="${titulo}"]`);

function botaoModal(rotulo) {
  return [...document.querySelectorAll('.modal__footer .btn')]
    .find(b => b.textContent.trim() === rotulo);
}

async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await renderNotaEmpenhoDetails(container, { params: { id: '10' } });
  await flush();
  return container;
}

beforeEach(() => {
  saveAuth({ token: 't', administrador: false, uuid: 'u-1', perfis: { orcamento: 3 } }, 'fulano');
  getNotaEmpenho.mockImplementation(() => Promise.resolve({ ...NOTA }));
  getLiquidacoes.mockImplementation(() => Promise.resolve([...LIQUIDACOES]));
  getRecebimentos.mockImplementation(() => Promise.resolve([...RECEBIMENTOS]));
});

afterEach(() => {
  clearAuth();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ficha da NE: o PUT leva o dono do lancamento', () => {
  test('editar liquidacao envia nota_empenho_id', async () => {
    const container = await montar();

    acao(container, 'Editar liquidação').click();
    await flush();

    botaoModal('Salvar').click();
    await flush();

    expect(updateLiquidacao).toHaveBeenCalledTimes(1);
    const [id, corpo] = updateLiquidacao.mock.calls[0];
    expect(id).toBe(1);
    expect(corpo.nota_empenho_id).toBe(10);
    expect(corpo.valor_liquidado).toBe(600);
  });

  test('editar recebimento envia nota_empenho_id', async () => {
    const container = await montar();

    acao(container, 'Editar recebimento').click();
    await flush();

    botaoModal('Salvar').click();
    await flush();

    expect(updateRecebimento).toHaveBeenCalledTimes(1);
    const [id, corpo] = updateRecebimento.mock.calls[0];
    expect(id).toBe(20);
    expect(corpo.nota_empenho_id).toBe(10);
  });
});
