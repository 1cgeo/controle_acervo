import { describe, test, expect, vi, beforeEach } from 'vitest';

// Capacitacao, em DUAS telas desde 2026-08-02 (chefe): a MINISTRADA em Producao
// (subsecao 2.6 do RPCMTec) e a RECEBIDA em Efetivo (6.2).
//
// O que estes casos FIXAM: cada tela pede ao servidor SO o seu tipo, e a coluna
// da direita e a que interessa aquele tipo. Numa tela so, com filtro, metade da
// tabela ficava vazia em qualquer escolha.
vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getCapacitacoes: vi.fn(() => Promise.resolve([])),
    getAnosCapacitacao: vi.fn(() => Promise.resolve([2026])),
    deleteCapacitacao: vi.fn(() => Promise.resolve()),
  };
});

import {
  renderCapacitacaoMinistrada,
  renderCapacitacaoRecebida,
} from '@pages/capacitacao/list.js';
import { getCapacitacoes } from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function montar(render) {
  const container = document.createElement('div');
  const cleanup = await render(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

const MINISTRADA = {
  id: '1', ano: 2026, nome: 'Estágio de Geoinformação',
  tipo_id: 1, tipo: 'Ministrada', situacao_id: 3, situacao: 'Concluída',
  instituicoes: 'CMS', local_realizacao: '1 CGEO',
  data_inicio: '2026-07-06', data_fim: '2026-07-10',
  efetivo_capacitado: 18, militares: null, plano_codigo: null,
};

const RECEBIDA = {
  id: '2', ano: 2026, nome: 'PCE-EECN',
  tipo_id: 2, tipo: 'Recebida', situacao_id: 2, situacao: 'Em execução',
  instituicoes: 'EsIME', local_realizacao: null,
  data_inicio: '2026-07-20', data_fim: null,
  efetivo_capacitado: null, militares: 'Cap Fulano', plano_codigo: 'C25/DCT003',
};

const ultimaColuna = (container) => [...container.querySelectorAll('tbody tr')]
  .map(tr => [...tr.querySelectorAll('td')].slice(-2, -1)[0]?.textContent);

describe('capacitação em duas telas', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
  });

  test('a tela de MINISTRADA pede só o tipo 1 e mostra o efetivo capacitado', async () => {
    getCapacitacoes.mockResolvedValueOnce([MINISTRADA]);

    const { container, cleanup } = await montar(renderCapacitacaoMinistrada);

    expect(getCapacitacoes).toHaveBeenCalledWith(new Date().getFullYear(), 1);
    expect(container.querySelector('.page__title').textContent).toBe('Capacitação ministrada');
    // Quantos de FORA nós treinamos.
    expect(ultimaColuna(container)).toEqual(['18']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a tela de RECEBIDA pede só o tipo 2 e mostra os militares', async () => {
    getCapacitacoes.mockResolvedValueOnce([RECEBIDA]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);

    expect(getCapacitacoes).toHaveBeenCalledWith(new Date().getFullYear(), 2);
    expect(container.querySelector('.page__title').textContent).toBe('Capacitação recebida');
    // Quem da Divisão foi.
    expect(ultimaColuna(container)).toEqual(['Cap Fulano']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o periodo sem termino sai como a data unica, e nao como intervalo aberto', async () => {
    getCapacitacoes.mockResolvedValueOnce([RECEBIDA]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);

    const periodos = [...container.querySelectorAll('tbody tr td:nth-child(3)')]
      .map(td => td.textContent);
    expect(periodos).toEqual(['20/07/2026']);

    if (typeof cleanup === 'function') cleanup();
  });
});
