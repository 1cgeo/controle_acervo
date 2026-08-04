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
    getUsuarios: vi.fn(() => Promise.resolve([])),
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
  efetivo_capacitado: 18, plano_codigo: null,
  // Quem MINISTROU e gente nossa, e nao se confunde com o efetivo capacitado,
  // que e a contagem de gente de fora.
  militares: [{ usuario_uuid: 'u1', nome: 'Fulano de Tal', nome_guerra: 'Fulano', posto_abrev: 'Cap' }],
};

const RECEBIDA = {
  id: '2', ano: 2026, nome: 'PCE-EECN',
  tipo_id: 2, tipo: 'Recebida', situacao_id: 2, situacao: 'Em execução',
  instituicoes: 'EsIME', local_realizacao: null,
  data_inicio: '2026-07-20', data_fim: null,
  efetivo_capacitado: null, plano_codigo: 'C25/DCT003',
  militares: [
    { usuario_uuid: 'u1', nome: 'Fulano de Tal', nome_guerra: 'Fulano', posto_abrev: 'Cap' },
    { usuario_uuid: 'u2', nome: 'Beltrano', nome_guerra: 'Beltrano', posto_abrev: '2º Sgt' },
  ],
};

// [Capacitacao, Situacao, Periodo, Instituicoes, Local, <do tipo>, Militares, acoes]
const colunaDoTipo = (container) => [...container.querySelectorAll('tbody tr')]
  .map(tr => [...tr.querySelectorAll('td')].slice(-3, -2)[0]?.textContent);
const colunaMilitares = (container) => [...container.querySelectorAll('tbody tr')]
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
    // Quantos de FORA nós treinamos, contra quem NOSSO ministrou. As duas coisas
    // coexistem numa ministrada, e o relatório pede as duas.
    expect(colunaDoTipo(container)).toEqual(['18']);
    expect(colunaMilitares(container)).toEqual(['Cap Fulano']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a tela de RECEBIDA pede só o tipo 2 e mostra os militares', async () => {
    getCapacitacoes.mockResolvedValueOnce([RECEBIDA]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);

    expect(getCapacitacoes).toHaveBeenCalledWith(new Date().getFullYear(), 2);
    expect(container.querySelector('.page__title').textContent).toBe('Capacitação recebida');
    expect(colunaDoTipo(container)).toEqual(['C25/DCT003']);
    // Os nomes saem do CADASTRO, e a célula os junta.
    expect(colunaMilitares(container)).toEqual(['Cap Fulano, 2º Sgt Beltrano']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o periodo sem termino sai como a data unica, e nao como intervalo aberto', async () => {
    getCapacitacoes.mockResolvedValueOnce([RECEBIDA]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);

    // A coluna sai pelo RÓTULO, e não pela posição: a tela ganhou a coluna Ano
    // em 2026-08-04, e contar colunas quebra o caso a cada coluna nova.
    const indice = [...container.querySelectorAll('thead th')]
      .findIndex(th => th.textContent.replace(/[▲▼]/g, '').trim() === 'Período');
    const periodos = [...container.querySelectorAll('tbody tr')]
      .map(tr => tr.children[indice].textContent);
    expect(periodos).toEqual(['20/07/2026']);

    if (typeof cleanup === 'function') cleanup();
  });
});
