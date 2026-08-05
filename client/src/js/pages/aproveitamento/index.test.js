import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Aproveitamento do efetivo (#/aproveitamento), por INTERVALO.
//
// O que estes casos FIXAM, e que nao se ve olhando a tela:
//  - celula SEM cor e "fora da DGEO", e e diferente de celula vermelha, que e
//    "estava e nao rendeu". Com as duas em cinza, a chegada em marco se leria
//    como quatro meses de licenca;
//  - o mapa tem 53 colunas de semana, sempre, mesmo para quem chegou em marco:
//    a grade e o ANO, e nao o periodo da pessoa;
//  - o `title` de cada celula explica a cor, e e por onde os impedimentos
//    aparecem sem ocupar espaco na tabela;
//  - o aproveitamento da Divisao e PONDERADO por dias na DGEO.
//    Media simples de percentuais dava a quem ficou uma semana o mesmo peso de
//    quem ficou o ano. As duas ficam a vista, cada uma com o seu nome.
vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getMapaEfetivo: vi.fn(() => Promise.resolve({ ano: 2026, semanas: [], anual: [] })),
    getPeriodosEfetivo: vi.fn(() => Promise.resolve([])),
    getImpedimentos: vi.fn(() => Promise.resolve([])),
    getUsuarios: vi.fn(() => Promise.resolve([])),
  };
});

import { renderAproveitamento } from '@pages/aproveitamento/index.js';
import {
  getMapaEfetivo,
  getImpedimentos,
} from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderAproveitamento(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

const ANUAL = [
  {
    usuario_uuid: 'u1', nome: 'Fulano de Tal', nome_guerra: 'Fulano', login: 'fulano',
    ativo: true, posto_abrev: 'Cap', posto: 'Capitão',
    dias_do_ano: 365, dias_na_dgeo: 365, aproveitamento: '50.0',
  },
  {
    // Chegou em marco: 301 dias de 365, e as semanas de janeiro e fevereiro nao
    // existem no resultado do servidor.
    usuario_uuid: 'u2', nome: 'Beltrano', nome_guerra: 'Beltrano', login: 'beltrano',
    ativo: true, posto_abrev: '2º Sgt', posto: 'Segundo Sargento',
    dias_do_ano: 365, dias_na_dgeo: 301, aproveitamento: '82.5',
  },
];

// Semana 1: o Fulano a 50% (impedido) e o Beltrano fora da Divisao.
const SEMANAS = [
  { usuario_uuid: 'u1', semana: 1, dias: 7, dias_na_dgeo: 7, disponibilidade: '50.0' },
  { usuario_uuid: 'u2', semana: 1, dias: 7, dias_na_dgeo: 0, disponibilidade: '0.0' },
  { usuario_uuid: 'u1', semana: 20, dias: 7, dias_na_dgeo: 7, disponibilidade: '50.0' },
  { usuario_uuid: 'u2', semana: 20, dias: 7, dias_na_dgeo: 7, disponibilidade: '100.0' },
];

const IMPEDIMENTOS = [
  {
    id: '1', usuario_uuid: 'u1', descricao: 'Chefe do S5', percentual: 50,
    data_inicio: '2026-01-01', data_fim: null,
  },
];

const linhas = (container) => [...container.querySelectorAll('.mapa-efetivo__linha')];
const celulas = (tr) => [...tr.querySelectorAll('.mapa-efetivo__celula')];

describe('renderAproveitamento', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
  });

  test('uma linha por militar, e 53 colunas de semana em todas', async () => {
    getMapaEfetivo.mockResolvedValueOnce({ ano: 2026, semanas: SEMANAS, anual: ANUAL });

    const { container, cleanup } = await montar();

    expect(linhas(container).length).toBe(2);
    // A grade é o ANO. Quem chegou em março tem as mesmas 53 células, com as
    // primeiras vazias.
    for (const tr of linhas(container)) {
      expect(celulas(tr).length).toBe(53);
    }

    if (typeof cleanup === 'function') cleanup();
  });

  test('fora da DGEO NAO se confunde com impedido: sao classes diferentes', async () => {
    getMapaEfetivo.mockResolvedValueOnce({ ano: 2026, semanas: SEMANAS, anual: ANUAL });

    const { container, cleanup } = await montar();

    const [fulano, beltrano] = linhas(container);

    // Semana 1: o Fulano estava e rendeu 50%; o Beltrano não estava.
    expect(celulas(fulano)[0].className).toContain('mapa-efetivo__celula--f50');
    expect(celulas(beltrano)[0].className).toContain('mapa-efetivo__celula--fora');
    expect(celulas(beltrano)[0].title).toBe('Fora da DGEO');

    // Semana 20: os dois estavam, e a cor os separa pelo aproveitamento.
    expect(celulas(beltrano)[19].className).toContain('mapa-efetivo__celula--f100');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o title da celula explica a cor, com os impedimentos da semana', async () => {
    getMapaEfetivo.mockResolvedValueOnce({ ano: 2026, semanas: SEMANAS, anual: ANUAL });
    getImpedimentos.mockResolvedValueOnce(IMPEDIMENTOS);

    const { container, cleanup } = await montar();

    const [fulano] = linhas(container);
    expect(celulas(fulano)[0].title).toContain('50%');
    expect(celulas(fulano)[0].title).toContain('Chefe do S5 (50%)');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a coluna da direita e o aproveitamento do ANO, com o denominador no title', async () => {
    getMapaEfetivo.mockResolvedValueOnce({ ano: 2026, semanas: SEMANAS, anual: ANUAL });

    const { container, cleanup } = await montar();

    const totais = [...container.querySelectorAll('tbody .mapa-efetivo__total')];
    expect(totais.map(t => t.textContent)).toEqual(['50%', '82,5%']);
    // O denominador é o ano INTEIRO, e é o que faz 301 dias darem 82,5%.
    expect(totais[1].title).toBe('301 de 365 dias na DGEO');

    if (typeof cleanup === 'function') cleanup();
  });

  // O resumo ponderado da Divisão (72,6% contra 66,3%, e o plural de "2
  // militares") é dos casos 'a media da Divisao e ponderada por dias na DGEO' e
  // 'plural tratado' em conciliacao.test.js, sobre a MESMA fixture anual. Lá as
  // asserções ainda checam os rótulos "ponderad" e "simples", e ficam escopadas
  // ao `.efetivo-resumo` em vez do texto da página inteira.

  test('ano sem ninguem convida ao primeiro cadastro, e nao mostra tabela vazia', async () => {
    const { container, cleanup } = await montar();

    expect(container.querySelector('.mapa-efetivo__tabela')).toBeNull();
    expect(container.textContent).toContain('Nova passagem');

    if (typeof cleanup === 'function') cleanup();
  });
});
