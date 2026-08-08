import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O que a tela do aproveitamento AFIRMA:
//
//  - `dgeo.usuario.ativo` e `dgeo.efetivo_periodo` respondem à mesma pergunta,
//    e a tela AVISA da divergência sem nunca corrigi-la: `data_fim` nula é
//    desenho (er/dgeo.sql:104), e quem fecha passagem é o chefe;
//  - o ano à frente do corrente é projeção de impedimento em aberto, e não
//    medida;
//  - a média da Divisão é ponderada pelo tempo de cada um, e não média simples
//    de percentuais, senão quem ficou uma semana pesaria igual a quem ficou o ano;
//  - a semana separa "não estava" de "estava e não rendeu": o denominador é a
//    semana inteira, e quem chega na quarta sai 71,4%;
//  - trocar o ano preserva a rolagem, troca o mapa junto, e no erro não deixa o
//    resumo do ano anterior escrito na tela;
//  - o seletor de ano sai de quem tem passagem, e não de uma janela fixa.

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getMapaEfetivo: vi.fn(() => Promise.resolve({ ano: 2026, semanas: [], anual: [] })),
    getPeriodosEfetivo: vi.fn(() => Promise.resolve([])),
    getImpedimentos: vi.fn(() => Promise.resolve([])),
    // `getMilitaresEfetivo`, e nao `getUsuarios`: a lista de gente desta tela sai
    // de `GET /efetivo/militares` desde 2026-08-08. Ver o caso do irmao
    // `index.test.js` que guarda a troca.
    getMilitaresEfetivo: vi.fn(() => Promise.resolve([])),
  };
});

import { renderAproveitamento } from '@pages/aproveitamento/index.js';
import {
  getMapaEfetivo,
  getPeriodosEfetivo,
  getMilitaresEfetivo,
} from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

// O ano corrente e a regua de tudo aqui: "ano futuro" e "ano com passagem" so
// existem em relacao a ele. Fixar 2026 no arquivo faria os casos passarem a
// mentir na virada do ano.
const CORRENTE = new Date().getFullYear();

// u1 passou pela DGEO ha dois anos e saiu. u2 esta com passagem ABERTA e
// desativado no cadastro, que e a divergencia (a). u3 esta ativo no cadastro e
// nunca teve passagem, que e a divergencia (b).
const PERIODOS = [
  {
    id: 1, usuario_uuid: 'u1', data_inicio: `${CORRENTE - 2}-05-01`,
    data_fim: `${CORRENTE - 2}-12-31`, observacao: null,
    nome_guerra: 'Antigo', posto_abrev: 'Cap', ativo: true,
  },
  {
    id: 2, usuario_uuid: 'u2', data_inicio: `${CORRENTE}-03-01`,
    data_fim: null, observacao: null,
    nome_guerra: 'Beltrano', posto_abrev: '2º Sgt', ativo: false,
  },
];

// O que `GET /efetivo/militares` devolve: seis colunas, e nenhuma de plataforma.
const MILITARES = [
  { uuid: 'u1', nome_guerra: 'Antigo', tipo_posto_grad: 'Cap', tipo_posto_grad_id: 10, ativo: true },
  { uuid: 'u2', nome_guerra: 'Beltrano', tipo_posto_grad: '2º Sgt', tipo_posto_grad_id: 5, ativo: false },
  { uuid: 'u3', nome_guerra: 'Ciclano', tipo_posto_grad: '1º Ten', tipo_posto_grad_id: 9, ativo: true },
];

// Fulano esteve o ano inteiro e rendeu 50%. Beltrano esteve 301 dias e rendeu
// tudo o que pode: 82,5% do ANO. A media simples dos dois e 66,25%; a ponderada
// por dias na DGEO e 72,6%, e a diferenca entre as duas e o caso deste arquivo.
const ANUAL = [
  {
    usuario_uuid: 'u1', nome_guerra: 'Fulano', ativo: true, posto_abrev: 'Cap',
    dias_do_ano: 365, dias_na_dgeo: 365, aproveitamento: '50.0',
  },
  {
    usuario_uuid: 'u2', nome_guerra: 'Beltrano', ativo: false, posto_abrev: '2º Sgt',
    dias_do_ano: 365, dias_na_dgeo: 301, aproveitamento: '82.5',
  },
];

// Semana 10 do Beltrano: ele chegou no meio dela, entao esteve 5 dos 7 dias e a
// celula sai 71,4%. Sem o denominador no `title`, essa celula tem a mesma cor de
// quem esteve a semana toda a 71%.
const SEMANAS = [
  { usuario_uuid: 'u1', semana: 10, dias: 7, dias_na_dgeo: 7, disponibilidade: '50.0' },
  { usuario_uuid: 'u2', semana: 10, dias: 7, dias_na_dgeo: 5, disponibilidade: '71.4' },
];

const MAPA = { ano: CORRENTE, semanas: SEMANAS, anual: ANUAL };

function comDadosDeSempre() {
  getMapaEfetivo.mockResolvedValue(MAPA);
  getPeriodosEfetivo.mockResolvedValue(PERIODOS);
  getMilitaresEfetivo.mockResolvedValue(MILITARES);
}

async function montar(query = new URLSearchParams()) {
  const container = document.createElement('div');
  const cleanup = await renderAproveitamento(container, { params: {}, query });
  await flush();
  return { container, cleanup };
}

const seletorDeAno = (container) => container.querySelector('.form-field__select');

const anosOferecidos = (container) => [...seletorDeAno(container).options]
  .map(o => o.value)
  .filter(Boolean);

async function trocarAno(container, ano) {
  const select = seletorDeAno(container);
  select.value = String(ano);
  select.dispatchEvent(new Event('change'));
  await flush();
}

const linhas = (container) => [...container.querySelectorAll('.mapa-efetivo__linha')];
const celulas = (tr) => [...tr.querySelectorAll('.mapa-efetivo__celula')];

describe('aproveitamento: conciliacao, projecao e media ponderada', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    document.body.innerHTML = '';
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // 1. Conciliar as duas respostas para "esta na DGEO"
  //
  // ESTAR NA DGEO SEM ACESSO AO SCA NÃO É DIVERGÊNCIA: `dgeo.usuario.ativo` é
  // flag de LOGIN, e a maioria do efetivo não usa o sistema. Avisar disso
  // listaria quase a Divisão inteira e esconderia a linha que importa.
  test('nao avisa de quem esta na DGEO com o acesso desativado', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar();

    expect(container.querySelector('.efetivo-divergencia--passagem-aberta-inativo'))
      .toBeNull();
    // Beltrano tem passagem aberta e cadastro inativo. E o caso comum, e nao
    // aparece mais como divergencia.
    const rodape = container.querySelector('.efetivo-divergencias');
    if (rodape) expect(rodape.textContent).not.toContain('Beltrano');

    if (typeof cleanup === 'function') cleanup();
  });

  test('avisa quem esta ativo no cadastro e sem passagem no ano', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar();

    const aviso = container.querySelector('.efetivo-divergencia--ativo-sem-passagem');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('Ciclano');
    // O Antigo tambem esta ativo e a passagem dele acabou ha dois anos.
    expect(aviso.textContent).toContain('Antigo');
    // O Beltrano tem passagem no ano: ele e o outro caso, e nao este.
    expect(aviso.textContent).not.toContain('Beltrano');

    if (typeof cleanup === 'function') cleanup();
  });

  // 2. Ano futuro e projecao
  test('o ano a frente do corrente sai marcado como projecao', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar();

    expect(container.querySelector('.efetivo-projecao')).toBeNull();

    await trocarAno(container, CORRENTE + 1);

    const aviso = container.querySelector('.efetivo-projecao');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('projeção');

    if (typeof cleanup === 'function') cleanup();
  });

  // 3. Media ponderada por dias na Divisao
  test('a media da Divisao e ponderada por dias na DGEO, e o rotulo diz qual e', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar();

    const resumo = container.querySelector('.efetivo-resumo');
    // (0,50 x 365 + 0,825 x 365) / (365 + 301) = 72,6%
    expect(resumo.textContent).toContain('72,6%');
    expect(resumo.textContent).toContain('ponderad');
    // A media simples continua a mesa, dita pelo nome.
    expect(resumo.textContent).toContain('66,3%');
    expect(resumo.textContent).toContain('simples');

    if (typeof cleanup === 'function') cleanup();
  });

  test('plural tratado, sem "militar(es)"', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('2 militares');
    expect(container.textContent).not.toContain('militar(es)');

    if (typeof cleanup === 'function') cleanup();
  });

  // 4. A semana diz quantos dias ela mediu
  test('o title da celula da semana traz dias_na_dgeo de dias', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar();

    const [, beltrano] = linhas(container);
    const celula = celulas(beltrano)[9];
    expect(celula.title).toContain('71,4%');
    expect(celula.title).toContain('5 de 7 dias na DGEO');

    if (typeof cleanup === 'function') cleanup();
  });

  // 7. A rolagem sobrevive ao remonte
  test('trocar o ano preserva a posicao da rolagem', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar();

    const scrollTo = vi.fn();
    Object.defineProperty(window, 'scrollTo', { value: scrollTo, configurable: true, writable: true });
    Object.defineProperty(window, 'scrollY', { value: 304, configurable: true, writable: true });

    await trocarAno(container, CORRENTE - 2);

    expect(scrollTo).toHaveBeenCalledWith(0, 304);

    if (typeof cleanup === 'function') cleanup();
  });

  // 8. Carregando, e o erro que nao deixa numero velho na tela
  test('enquanto carrega, o mapa velho sai da tela', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar();
    expect(container.querySelector('.mapa-efetivo__tabela')).not.toBeNull();

    let liberar;
    getMapaEfetivo.mockImplementationOnce(() => new Promise(r => { liberar = r; }));

    const select = seletorDeAno(container);
    select.value = String(CORRENTE - 2);
    select.dispatchEvent(new Event('change'));
    await flush();

    // O mapa do ano anterior NAO fica na tela fingindo ser o do ano novo.
    expect(container.querySelector('.mapa-efetivo__tabela')).toBeNull();
    expect(container.querySelector('.mapa-efetivo__carregando')).not.toBeNull();
    expect(container.querySelector('.efetivo-resumo').textContent).toBe('');

    liberar(MAPA);
    await flush();
    expect(container.querySelector('.mapa-efetivo__carregando')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('no erro, o resumo do ano anterior nao continua escrito', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar();
    expect(container.querySelector('.efetivo-resumo').textContent).toContain('%');

    getMapaEfetivo.mockRejectedValueOnce(new Error('falha de rede'));
    await trocarAno(container, CORRENTE - 2);

    expect(container.querySelector('.efetivo-resumo').textContent).toBe('');
    expect(container.querySelector('.mapa-efetivo__tabela')).toBeNull();
    expect(container.querySelector('.efetivo-divergencias')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // 11. O seletor sai das passagens, e nao de quatro anos fixos
  test('o seletor de ano vem dos anos que tem passagem', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar();

    const anos = anosOferecidos(container);
    // u1 passou em CORRENTE-2; u2 esta em passagem ABERTA desde CORRENTE, e
    // passagem aberta chega ao ano que vem.
    expect(anos).toContain(String(CORRENTE - 2));
    expect(anos).toContain(String(CORRENTE));
    expect(anos).toContain(String(CORRENTE + 1));
    // Ninguem passou pela DGEO em CORRENTE-1, e a lista fixa oferecia esse ano.
    expect(anos).not.toContain(String(CORRENTE - 1));

    if (typeof cleanup === 'function') cleanup();
  });

  // 12. `?usuario_uuid=` da rota
  test('usuario_uuid na rota destaca a linha e abre a ficha', async () => {
    comDadosDeSempre();

    const { container, cleanup } = await montar(new URLSearchParams('usuario_uuid=u2'));

    const destacadas = container.querySelectorAll('.mapa-efetivo__linha--destaque');
    expect(destacadas.length).toBe(1);
    expect(destacadas[0].textContent).toContain('Beltrano');

    const modal = document.querySelector('.modal');
    expect(modal).not.toBeNull();
    expect(modal.getAttribute('aria-label')).toContain('Beltrano');

    if (typeof cleanup === 'function') cleanup();
  });

  test('sem usuario_uuid na rota, nenhuma ficha abre sozinha', async () => {
    comDadosDeSempre();

    const { cleanup } = await montar();

    expect(document.querySelector('.modal')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
