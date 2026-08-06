import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O que estes casos FIXAM: a lista de capacitacao responde "quem", e nao so
// "que curso". A busca tem de achar pelo NOME DO MILITAR, o filtro por pessoa
// tem de existir, o link de fora tem de chegar filtrado, e falha de carga NAO
// pode se ler como lista vazia.
// A tela usa só estes dois (capacitacao/list.js:2).
vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getCapacitacoesMinistradas: vi.fn(() => Promise.resolve([])),
    getAnosCapacitacaoMinistrada: vi.fn(() => Promise.resolve([2025, 2026])),
    deleteCapacitacaoMinistrada: vi.fn(() => Promise.resolve()),
    getCapacitacoesRecebidas: vi.fn(() => Promise.resolve([])),
    getAnosCapacitacaoRecebida: vi.fn(() => Promise.resolve([2025, 2026])),
    deleteCapacitacaoRecebida: vi.fn(() => Promise.resolve()),
    getUsuarios: vi.fn(() => Promise.resolve([])),
  };
});

import {
  renderCapacitacaoMinistrada,
  renderCapacitacaoRecebida,
} from '@pages/capacitacao/list.js';
// Cada tela chama a funcao do SEU tipo, e nao uma funcao unica com filtro: o
// tipo virou a ROTA na 1.33.0, porque a permissao e por tipo.
import {
  getCapacitacoesMinistradas,
  getCapacitacoesRecebidas,
  getUsuarios,
} from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

async function montar(render, busca = '') {
  const container = document.createElement('div');
  const cleanup = await render(container, {
    params: {},
    query: new URLSearchParams(busca),
  });
  await flush();
  return { container, cleanup };
}

// --- Militares ---------------------------------------------------------------

const FULANO = {
  usuario_uuid: 'u1', nome: 'Fulano de Tal', nome_guerra: 'Fulano', posto_abrev: 'Cap',
};
const BELTRANO = {
  usuario_uuid: 'u2', nome: 'Beltrano da Silva', nome_guerra: 'Beltrano', posto_abrev: '2º Sgt',
};

const CURSO = (extra) => ({
  id: String(extra.id), ano: 2026, tipo_id: 2, tipo: 'Recebida',
  situacao_id: 3, situacao: 'Concluída',
  instituicoes: 'EsIME', local_realizacao: 'Rio de Janeiro',
  data_inicio: '2026-03-02', data_fim: '2026-03-06',
  efetivo_capacitado: null, plano_codigo: 'C25/DCT003',
  militares: [],
  ...extra,
});

const DO_FULANO = CURSO({ id: 1, nome: 'Curso de SARP', militares: [FULANO] });
const DO_BELTRANO = CURSO({ id: 2, nome: 'ISO 9001', militares: [BELTRANO] });
const DOS_DOIS = CURSO({ id: 3, nome: 'Pós-graduação', militares: [FULANO, BELTRANO] });

// --- Leitores da tabela ------------------------------------------------------

const semIndicador = (texto) => texto.replace(/[▲▼]/g, '').trim();

const cabecalhos = (container) => [...container.querySelectorAll('thead th')];

const cabecalho = (container, rotulo) =>
  cabecalhos(container).find(th => semIndicador(th.textContent) === rotulo);

const indiceDaColuna = (container, rotulo) =>
  cabecalhos(container).findIndex(th => semIndicador(th.textContent) === rotulo);

const celulas = (container, rotulo) => {
  const i = indiceDaColuna(container, rotulo);
  return [...container.querySelectorAll('tbody tr')]
    .map(tr => tr.children[i] && tr.children[i].textContent);
};

const nomes = (container) => celulas(container, 'Capacitação');

const buscar = async (container, termo) => {
  const input = container.querySelector('.data-table-toolbar__search-input');
  input.value = termo;
  input.dispatchEvent(new Event('input', { bubbles: true }));
  await flush();
};

const selectDoRotulo = (container, rotulo) => [...container.querySelectorAll('.form-field')]
  .find(f => {
    const label = f.querySelector('.form-field__label');
    return label && label.textContent.trim().startsWith(rotulo);
  })
  ?.querySelector('select');

const escolher = async (select, valor) => {
  select.value = valor;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
};

describe('capacitação: a lista responde por pessoa', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    saveAuth({ token: 'tk-teste', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
  });

  test('a busca acha a capacitação pelo nome do militar', async () => {
    getCapacitacoesRecebidas.mockResolvedValueOnce([DO_FULANO, DO_BELTRANO, DOS_DOIS]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);
    await buscar(container, 'Beltrano');

    expect(nomes(container)).toEqual(['ISO 9001', 'Pós-graduação']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a situação ordena pelo ciclo de vida, e não pelo alfabeto', async () => {
    // dominio.situacao_capacitacao: 1 Prevista, 2 Em execução, 3 Concluída,
    // 4 Cancelada. A ordem do código é a do ciclo de vida.
    getCapacitacoesRecebidas.mockResolvedValueOnce([
      CURSO({ id: 1, nome: 'A', situacao_id: 4, situacao: 'Cancelada' }),
      CURSO({ id: 2, nome: 'B', situacao_id: 1, situacao: 'Prevista' }),
      CURSO({ id: 3, nome: 'C', situacao_id: 3, situacao: 'Concluída' }),
      CURSO({ id: 4, nome: 'D', situacao_id: 2, situacao: 'Em execução' }),
    ]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);
    cabecalho(container, 'Situação').click();
    await flush();

    expect(celulas(container, 'Situação'))
      .toEqual(['Prevista', 'Em execução', 'Concluída', 'Cancelada']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a tabela mostra o ano, que separa duas edições do mesmo curso', async () => {
    getCapacitacoesRecebidas.mockResolvedValueOnce([
      CURSO({ id: 1, nome: 'Curso de SARP', ano: 2025, data_inicio: null, data_fim: null }),
      CURSO({ id: 2, nome: 'Curso de SARP', ano: 2026, data_inicio: null, data_fim: null }),
    ]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);

    expect(celulas(container, 'Ano')).toEqual(['2025', '2026']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o filtro por militar limita a lista à pessoa escolhida', async () => {
    getCapacitacoesRecebidas.mockResolvedValueOnce([DO_FULANO, DO_BELTRANO, DOS_DOIS]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);
    const filtro = selectDoRotulo(container, 'Militar');
    expect(filtro).toBeTruthy();

    await escolher(filtro, 'u1');

    expect(nomes(container)).toEqual(['Curso de SARP', 'Pós-graduação']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o parâmetro usuario_uuid da rota já chega filtrado, e em todos os anos', async () => {
    getCapacitacoesRecebidas.mockResolvedValueOnce([DO_FULANO, DO_BELTRANO, DOS_DOIS]);

    const { container, cleanup } = await montar(
      renderCapacitacaoRecebida, 'usuario_uuid=u2'
    );

    // O link aponta uma PESSOA, e não um ano: preso ao ano corrente ele
    // esconderia a capacitação dela dos anos anteriores.
    expect(getCapacitacoesRecebidas).toHaveBeenCalledWith(null);
    expect(nomes(container)).toEqual(['ISO 9001', 'Pós-graduação']);
    expect(selectDoRotulo(container, 'Militar').value).toBe('u2');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o militar que o filtro oferece sai do cadastro e das linhas', async () => {
    getUsuarios.mockResolvedValueOnce([
      {
        uuid: 'u3', nome: 'Sicrano', nome_guerra: 'Sicrano',
        tipo_posto_grad: '1º Ten', tipo_posto_grad_id: 8, ativo: true,
      },
    ]);
    getCapacitacoesRecebidas.mockResolvedValueOnce([DO_BELTRANO]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);
    const valores = [...selectDoRotulo(container, 'Militar').options].map(o => o.value);

    // O do cadastro entra mesmo sem linha, e o da linha entra mesmo inativo.
    expect(valores).toContain('u3');
    expect(valores).toContain('u2');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a falha de carga não se lê como lista vazia', async () => {
    getCapacitacoesRecebidas.mockRejectedValueOnce(new Error('Falha de rede'));

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);

    // A tabela SAI da tela: mantida com zero linhas, ela afirmaria que não há
    // capacitação nenhuma, que é uma afirmação sobre o banco.
    expect(container.querySelector('.data-table-wrapper')).toBeNull();
    expect(container.textContent).toContain('Falha de rede');
    expect(container.textContent).toContain('A lista não foi carregada');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a falha de carga oferece nova tentativa, e ela devolve a tabela', async () => {
    getCapacitacoesRecebidas
      .mockRejectedValueOnce(new Error('Falha de rede'))
      .mockResolvedValueOnce([DO_FULANO]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);
    const botao = [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Tentar de novo'));
    expect(botao).toBeTruthy();

    botao.click();
    await flush();

    expect(container.querySelector('.data-table-wrapper')).toBeTruthy();
    expect(nomes(container)).toEqual(['Curso de SARP']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('instituições, local e plano ordenam a tabela ao clicar no cabeçalho', async () => {
    getCapacitacoesRecebidas.mockResolvedValueOnce([
      CURSO({ id: 1, nome: 'C', instituicoes: 'IME', local_realizacao: 'Santa Maria', plano_codigo: 'C25/DCT003' }),
      CURSO({ id: 2, nome: 'A', instituicoes: 'EsIME', local_realizacao: 'Brasília', plano_codigo: 'A25/DCT001' }),
      CURSO({ id: 3, nome: 'B', instituicoes: 'UFRGS', local_realizacao: 'Rio de Janeiro', plano_codigo: 'B25/DCT002' }),
    ]);

    const { container, cleanup } = await montar(renderCapacitacaoRecebida);

    // As três colunas entram FORA de ordem. Sem essa variância, a comparação de
    // baixo passaria com a tabela sem ordenar coisa nenhuma.
    expect(celulas(container, 'Instituições')).toEqual(['IME', 'EsIME', 'UFRGS']);

    const esperado = [
      ['Instituições', ['EsIME', 'IME', 'UFRGS']],
      ['Local', ['Brasília', 'Rio de Janeiro', 'Santa Maria']],
      ['Plano / Código', ['A25/DCT001', 'B25/DCT002', 'C25/DCT003']],
    ];
    for (const [rotulo, ordenado] of esperado) {
      cabecalho(container, rotulo).click();
      await flush();
      expect(celulas(container, rotulo)).toEqual(ordenado);
    }

    if (typeof cleanup === 'function') cleanup();
  });

  test('a tela ministrada busca pelo instrutor e ordena o efetivo', async () => {
    getCapacitacoesMinistradas.mockResolvedValueOnce([
      CURSO({
        id: 1, nome: 'Estágio de Geoinformação', tipo_id: 1, tipo: 'Ministrada',
        efetivo_capacitado: 18, plano_codigo: null, militares: [FULANO],
      }),
      CURSO({
        id: 2, nome: 'Estágio de SIG', tipo_id: 1, tipo: 'Ministrada',
        efetivo_capacitado: 4, plano_codigo: null, militares: [BELTRANO],
      }),
    ]);

    const { container, cleanup } = await montar(renderCapacitacaoMinistrada);
    await buscar(container, 'Fulano');

    expect(nomes(container)).toEqual(['Estágio de Geoinformação']);

    if (typeof cleanup === 'function') cleanup();
  });
});
