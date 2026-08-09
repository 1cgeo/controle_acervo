import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Capacitação, em DUAS telas: a MINISTRADA no PIT (subseção 2.6 do
// RPCMTec) e a RECEBIDA em Efetivo (6.2).
//
// O que estes casos FIXAM: cada tela pede ao servidor SÓ o seu tipo, e a coluna
// da direita é a que interessa àquele tipo. Numa tela só, com filtro, metade da
// tabela ficaria vazia em qualquer escolha.
//
// O TIPO DEIXOU DE SER ARGUMENTO e virou a ROTA (1.33.0): cada tela chama uma
// FUNÇÃO DE SERVIÇO diferente, porque a permissão é por tipo e a guarda do
// servidor não enxerga um filtro na query. Os casos ficaram mais fortes: antes
// eles conferiam o segundo argumento de uma função só, agora conferem QUAL
// função a tela chamou, e que a do outro tipo não foi chamada.
vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getCapacitacoesMinistradas: vi.fn(() => Promise.resolve([])),
    getAnosCapacitacaoMinistrada: vi.fn(() => Promise.resolve([2026])),
    deleteCapacitacaoMinistrada: vi.fn(() => Promise.resolve()),
    getCapacitacoesRecebidas: vi.fn(() => Promise.resolve([])),
    getAnosCapacitacaoRecebida: vi.fn(() => Promise.resolve([2026])),
    deleteCapacitacaoRecebida: vi.fn(() => Promise.resolve()),
    getUsuarios: vi.fn(() => Promise.resolve([])),
  };
});

import {
  renderCapacitacaoMinistrada,
  renderCapacitacaoRecebida,
} from '@pages/capacitacao/list.js';
import {
  getCapacitacoesMinistradas,
  getCapacitacoesRecebidas,
} from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

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

// A coluna se acha pelo CABECALHO, e nao por posicao a partir do fim.
//
// A conta antiga (`slice(-3, -2)`) quebrou no dia em que a ministrada ganhou a
// coluna "Meta do PIT": ela nao dizia QUAL coluna se queria, so onde ela estava,
// e a proxima coluna quebra de novo.
const colunaPorRotulo = (container, rotulo) => {
  const cabecalhos = [...container.querySelectorAll('thead th')];
  const i = cabecalhos.findIndex(th => th.textContent.trim().startsWith(rotulo));
  if (i < 0) throw new Error(`coluna "${rotulo}" nao existe na tabela`);
  return [...container.querySelectorAll('tbody tr')]
    .map(tr => tr.querySelectorAll('td')[i]?.textContent);
};

const colunaDoTipo = (container) => {
  // O rotulo muda com a tela: "Efetivo capacitado" na ministrada, "Plano /
  // Codigo" na recebida.
  const th = [...container.querySelectorAll('thead th')]
    .find(t => /Efetivo capacitado|Plano/.test(t.textContent));
  return colunaPorRotulo(container, th.textContent.trim());
};
const colunaMilitares = (container) => {
  const th = [...container.querySelectorAll('thead th')]
    .find(t => /Instrutores|Militares/.test(t.textContent));
  return colunaPorRotulo(container, th.textContent.trim());
};
const colunaMeta = (container) => colunaPorRotulo(container, 'Meta do PIT');

describe('capacitação em duas telas', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
  });

  test('a tela de MINISTRADA pede só o tipo 1 e mostra o efetivo capacitado', async () => {
    getCapacitacoesMinistradas.mockResolvedValueOnce([MINISTRADA]);

    const { container, cleanup } = await montar(renderCapacitacaoMinistrada);

    expect(getCapacitacoesMinistradas).toHaveBeenCalledWith(new Date().getFullYear());
    // E a rota do OUTRO tipo nao foi tocada. Sem esta linha, uma tela que
    // chamasse as duas satisfaria o caso acima.
    expect(getCapacitacoesRecebidas).not.toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Capacitação ministrada');
    // Quantos de FORA nós treinamos, contra quem NOSSO ministrou. As duas coisas
    // coexistem numa ministrada, e o relatório pede as duas.
    expect(colunaDoTipo(container)).toEqual(['18']);
    expect(colunaMilitares(container)).toEqual(['Cap Fulano']);

    if (typeof cleanup === 'function') cleanup();
  });

  // A coluna responde "esta capacitação CONTA no PIT?". Com meta ligada, e daqui
  // que sai o numero da grade quando a meta declara origem Capacitação; sem
  // meta, e trabalho real que o plano nao promete. As duas leituras pedem acoes
  // diferentes, e por isso a ausencia sai por escrito e nao como um traco.
  test('a ministrada diz se a capacitação conta no PIT', async () => {
    getCapacitacoesMinistradas.mockResolvedValueOnce([
      { ...MINISTRADA, id: 1, meta_pit_id: 7, meta_pit_item: '5.1' },
      { ...MINISTRADA, id: 2, meta_pit_id: null, meta_pit_item: null },
    ]);
    const { container, cleanup } = await montar(renderCapacitacaoMinistrada);

    expect(colunaMeta(container)).toEqual(['Meta 5.1', 'Fora do PIT']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a tela de RECEBIDA pede só o tipo 2 e mostra os militares', async () => {
    getCapacitacoesRecebidas.mockResolvedValueOnce([RECEBIDA]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);

    expect(getCapacitacoesRecebidas).toHaveBeenCalledWith(new Date().getFullYear());
    expect(getCapacitacoesMinistradas).not.toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Capacitação recebida');
    expect(colunaDoTipo(container)).toEqual(['C25/DCT003']);
    // Os nomes saem do CADASTRO, e a célula os junta.
    expect(colunaMilitares(container)).toEqual(['Cap Fulano, 2º Sgt Beltrano']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o periodo sem termino sai como a data unica, e nao como intervalo aberto', async () => {
    getCapacitacoesRecebidas.mockResolvedValueOnce([RECEBIDA]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);

    // A coluna sai pelo RÓTULO, e não pela posição: a tela ganhou a coluna Ano,
    // e contar colunas quebra o caso a cada coluna nova.
    const indice = [...container.querySelectorAll('thead th')]
      .findIndex(th => th.textContent.replace(/[▲▼]/g, '').trim() === 'Período');
    const periodos = [...container.querySelectorAll('tbody tr')]
      .map(tr => tr.children[indice].textContent);
    expect(periodos).toEqual(['20/07/2026']);

    if (typeof cleanup === 'function') cleanup();
  });
});
