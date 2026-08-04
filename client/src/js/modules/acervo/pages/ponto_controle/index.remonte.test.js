import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// O que estes testes protegem: a tela de ponto de controle nao se remonta a
// cada consulta.
//
// O defeito medido em 2026-08-04: `pintar` fazia `lista.replaceChildren(...)`
// com vinte cartoes novos, e `pintarPaginacao` criava os botoes de novo. Cada
// tecla digitada, cada arrasto do mapa com "so na area do mapa" e cada virada de
// pagina trocavam TODOS os nos. O foco do teclado morria junto, e a rolagem da
// lista voltava ao topo.
//
// Arquivo SEPARADO do index.test.js: la se testa o que a tela FAZ (consulta,
// filtro, selecao, area); aqui, o que ela PRESERVA entre duas consultas. Os
// dubles sao os mesmos, e de proposito: o contrato com o mapa nao muda.

const mapaFalso = vi.hoisted(() => ({
  pontos: null,
  selecionados: null,
  apontado: undefined,
  enquadrado: null,
  enquadradoPonto: null,
  caixaVisivel: '-53,-31,-50,-29',
  onAlternarSelecao: null,
  onApontar: null,
  onMover: null,
  onAreaDesenhada: null,
  onAreaCancelada: null,
  areaMostrada: null,
  areaLimpa: 0,
  limiteDestacado: null,
  limiteEnquadrou: null,
  limiteLimpo: 0,
  // Quantas vezes o mapa foi criado e destruido. A reconciliacao da LISTA nao
  // pode encostar no mapa: recriar o canvas perderia camada e camera.
  criado: 0,
  destruido: 0,
}));

vi.mock('@modules/acervo/pages/ponto_controle/mapa.js', () => ({
  criarMapaPontos: ({
    onAlternarSelecao, onApontar, onMover, onAreaDesenhada, onAreaCancelada,
  }) => {
    mapaFalso.criado += 1;
    mapaFalso.onAlternarSelecao = onAlternarSelecao;
    mapaFalso.onApontar = onApontar;
    mapaFalso.onMover = onMover;
    mapaFalso.onAreaDesenhada = onAreaDesenhada;
    mapaFalso.onAreaCancelada = onAreaCancelada;
    return {
      elemento: document.createElement('div'),
      iniciar: () => Promise.resolve(),
      mostrar: (p) => { mapaFalso.pontos = p; },
      setSelecionados: (ids) => { mapaFalso.selecionados = [...ids]; },
      setApontado: (id) => { mapaFalso.apontado = id; },
      enquadrar: (c) => { mapaFalso.enquadrado = c; },
      enquadrarPonto: (id) => { mapaFalso.enquadradoPonto = id; return true; },
      caixaVisivel: () => mapaFalso.caixaVisivel,
      aviso: () => {},
      tratarTecla: () => false,
      mostrarArea: (g) => { mapaFalso.areaMostrada = g; },
      limparArea: () => { mapaFalso.areaLimpa += 1; },
      destacarLimite: (limite, opcoes) => {
        mapaFalso.limiteDestacado = limite;
        mapaFalso.limiteEnquadrou = !opcoes || opcoes.enquadrar !== false;
      },
      limparLimite: () => { mapaFalso.limiteLimpo += 1; },
      destruir: () => { mapaFalso.destruido += 1; },
    };
  },
}));

vi.mock('@modules/acervo/pages/ponto_controle/ponto-dialog.js', () => ({
  abrirPontoDialog: vi.fn(),
}));

vi.mock('@modules/acervo/services/ponto-controle-service.js', () => ({
  buscarPontos: vi.fn(),
  buscarPosicoes: vi.fn(),
  getFacetas: vi.fn(),
  baixarPontosCsv: vi.fn(() => Promise.resolve()),
}));

vi.mock('@modules/acervo/services/limites-service.js', () => ({
  getLimite: vi.fn(() => Promise.resolve(null)),
}));

import { renderPontoControle } from '@modules/acervo/pages/ponto_controle/index.js';
import {
  buscarPontos, buscarPosicoes, getFacetas,
} from '@modules/acervo/services/ponto-controle-service.js';
import { abrirPontoDialog } from '@modules/acervo/pages/ponto_controle/ponto-dialog.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));
/** A consulta por digitacao espera 350 ms; a do mapa, 500 ms. */
const esperar = (ms) => new Promise(resolve => setTimeout(resolve, ms));

const PONTOS = [
  {
    id: 1, cod_ponto: 'RS-HV-1', lote_id: 70, lote: 'Missão 1', pit: 'PIT-01',
    projeto_id: 7, projeto: 'Copa Verde', data_rastreio: '2026-05-12',
    tipo_situacao: 3, tipo_situacao_nome: 'Aprovado', medidor: '3º Sgt Silva',
    altitude_ortometrica: 1024.35, longitude: -51.2, latitude: -30.1,
    total_arquivos: 3, total_mb: 42.5,
  },
  {
    id: 2, cod_ponto: 'RS-HV-2', lote_id: 70, lote: 'Missão 1', pit: 'PIT-01',
    projeto_id: 7, projeto: 'Copa Verde', data_rastreio: '2026-05-13',
    tipo_situacao: 2, tipo_situacao_nome: 'Aguardando revisão', medidor: 'Cb Souza',
    altitude_ortometrica: null, longitude: -50.4, latitude: -29.3,
    total_arquivos: 1, total_mb: 3.2,
  },
];

const FACETAS = {
  projetos: [{ code: 7, nome: 'Copa Verde', pontos: 2 }],
  lotes: [{ code: 70, nome: 'Missão 1', pit: 'PIT-01', projeto_id: 7, pontos: 2 }],
  estados: [{ code: 43, sigla: 'RS', nome: 'Rio Grande do Sul', pontos: 2 }],
  municipios: [],
};

const resposta = ({ pontos = PONTOS, total = 2, pagina = 1 } = {}) =>
  Promise.resolve({ total, pagina, pontos });

const cartoes = (c) => [...c.querySelectorAll('.busca-cartao')];
const paginacaoBtns = (c) => [...c.querySelectorAll('.busca-paginacao button')];

/** Refaz a consulta pelo mesmo gesto de quem usa a tela: digitar no campo. */
async function reconsultar(container, texto = 'RS') {
  const campo = container.querySelector('.busca-campo__input');
  campo.value = texto;
  campo.dispatchEvent(new Event('input'));
  await esperar(400);
  await flush();
}

async function montar(ctx = {}) {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderPontoControle(container, {
    params: {},
    query: new URLSearchParams(ctx.query || ''),
  });
  await flush();
  return { container, cleanup };
}

beforeEach(() => {
  location.hash = '';
  buscarPontos.mockImplementation(() => resposta());
  buscarPosicoes.mockImplementation(() =>
    Promise.resolve({ total: PONTOS.length, pontos: PONTOS }));
  getFacetas.mockImplementation(() => Promise.resolve(FACETAS));
  Object.assign(mapaFalso, {
    pontos: null, selecionados: null, apontado: undefined,
    enquadrado: null, enquadradoPonto: null,
    caixaVisivel: '-53,-31,-50,-29', criado: 0, destruido: 0,
    areaMostrada: null, areaLimpa: 0,
    limiteDestacado: null, limiteEnquadrou: null, limiteLimpo: 0,
  });
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ponto de controle: a consulta nova nao remonta a lista', () => {
  test('o cartao do ponto que continua no resultado e o MESMO no', async () => {
    const { container, cleanup } = await montar();
    const [primeiro, segundo] = cartoes(container);

    await reconsultar(container);

    expect(cartoes(container)[0]).toBe(primeiro);
    expect(cartoes(container)[1]).toBe(segundo);
    cleanup();
  });

  test('o cartao reaproveitado mostra o dado NOVO', async () => {
    const { container, cleanup } = await montar();
    const primeiro = cartoes(container)[0];
    expect(primeiro.textContent).toContain('Aprovado');
    expect(primeiro.textContent).toContain('3 arquivos');

    // O mesmo ponto, revisado e com mais arquivos: e o que uma consulta depois
    // de uma gravacao no plugin traz.
    const revisado = {
      ...PONTOS[0], tipo_situacao: 4, tipo_situacao_nome: 'Reprovado',
      total_arquivos: 9, total_mb: 90.5,
    };
    buscarPontos.mockImplementation(() => resposta({ pontos: [revisado, PONTOS[1]] }));
    await reconsultar(container);

    // Reaproveitar o no sem repintar deixaria a tela mostrando o estado velho,
    // que e pior que remontar: a tela mentiria a situacao do ponto.
    expect(cartoes(container)[0]).toBe(primeiro);
    expect(primeiro.textContent).toContain('Reprovado');
    expect(primeiro.textContent).not.toContain('Aprovado');
    expect(primeiro.textContent).toContain('9 arquivos');
    cleanup();
  });

  test('clicar no cartao reaproveitado usa o dado novo, e nao o da consulta anterior', async () => {
    const { container, cleanup } = await montar();
    const primeiro = cartoes(container)[0];

    // Codigo corrigido pelo operador, com o mesmo id. E a prova do closure
    // velho: quem guarda o ponto na criacao do no dispara a ficha do codigo que
    // saiu da tela.
    buscarPontos.mockImplementation(() =>
      resposta({ pontos: [{ ...PONTOS[0], cod_ponto: 'RS-HV-9' }, PONTOS[1]] }));
    await reconsultar(container);

    cartoes(container)[0].click();
    expect(cartoes(container)[0]).toBe(primeiro);
    expect(abrirPontoDialog).toHaveBeenCalledWith(['RS-HV-9'], 0);
    cleanup();
  });

  test('o foco no cartao sobrevive a consulta disparada pelo mapa', async () => {
    const { container, cleanup } = await montar();
    const seguir = container.querySelector('#pc-seguir-mapa');
    seguir.checked = true;
    seguir.dispatchEvent(new Event('change'));
    await flush();

    const segundo = cartoes(container)[1];
    segundo.focus();
    expect(document.activeElement).toBe(segundo);

    // Arrastar o mapa reconsulta sozinho. Com a lista remontada, o foco de quem
    // navegava pelo teclado caia no body a cada meio segundo de arrasto.
    mapaFalso.onMover();
    await esperar(600);
    await flush();

    expect(document.activeElement).toBe(segundo);
    cleanup();
  });

  test('o ponto que saiu do resultado sai da lista, e a ordem segue a resposta', async () => {
    const { container, cleanup } = await montar();
    const segundo = cartoes(container)[1];

    buscarPontos.mockImplementation(() => resposta({ pontos: [PONTOS[1]], total: 1 }));
    await reconsultar(container);

    expect(cartoes(container)).toHaveLength(1);
    expect(cartoes(container)[0]).toBe(segundo);

    // E volta a crescer, na ordem invertida: o no que ficou muda de lugar sem
    // ser recriado.
    buscarPontos.mockImplementation(() => resposta({ pontos: [PONTOS[1], PONTOS[0]] }));
    await reconsultar(container, 'RS-HV');

    expect(cartoes(container)[0]).toBe(segundo);
    expect(cartoes(container).map(c => c.dataset.id)).toEqual(['2', '1']);
    cleanup();
  });

  test('o vazio entra e sai sem deixar cartao para tras', async () => {
    const { container, cleanup } = await montar();

    buscarPontos.mockImplementation(() => resposta({ pontos: [], total: 0 }));
    buscarPosicoes.mockImplementation(() => Promise.resolve({ total: 0, pontos: [] }));
    await reconsultar(container, 'ZZZ');

    expect(cartoes(container)).toHaveLength(0);
    expect(container.textContent).toContain('Nenhum ponto de controle com esses filtros.');

    buscarPontos.mockImplementation(() => resposta());
    buscarPosicoes.mockImplementation(() =>
      Promise.resolve({ total: PONTOS.length, pontos: PONTOS }));
    await reconsultar(container, 'RS');

    expect(cartoes(container)).toHaveLength(2);
    // O aviso de vazio tem de SAIR quando o resultado volta.
    expect(container.textContent).not.toContain('Nenhum ponto de controle com esses filtros.');
    cleanup();
  });

  test('o mapa nao e recriado por uma consulta nova', async () => {
    const { container, cleanup } = await montar();
    expect(mapaFalso.criado).toBe(1);

    await reconsultar(container);

    // Recriar o mapa perderia camada e camera. A reconciliacao mexe so na lista.
    expect(mapaFalso.criado).toBe(1);
    expect(mapaFalso.destruido).toBe(0);
    cleanup();
  });
});

describe('ponto de controle: paginacao e chip de area', () => {
  test('o foco no botao "Proxima" sobrevive ao clique que vira a pagina', async () => {
    buscarPontos.mockImplementation(() => resposta({ total: 50 }));
    const { container, cleanup } = await montar();

    const [, proxima] = paginacaoBtns(container);
    expect(container.textContent).toContain('Página 1 de 3');
    proxima.focus();
    proxima.click();
    await flush();

    // Recriar os botoes a cada consulta obrigava a pessoa a achar o "Proxima"
    // de novo com o mouse, a cada pagina.
    expect(paginacaoBtns(container)[1]).toBe(proxima);
    expect(document.activeElement).toBe(proxima);
    expect(container.textContent).toContain('Página 2 de 3');
    cleanup();
  });

  test('a paginacao repinta os estados no proprio no', async () => {
    buscarPontos.mockImplementation(() => resposta({ total: 50 }));
    const { container, cleanup } = await montar();

    const [anterior, proxima] = paginacaoBtns(container);
    expect(anterior.disabled).toBe(true);

    proxima.click();
    await flush();

    expect(paginacaoBtns(container)[0]).toBe(anterior);
    expect(anterior.disabled).toBe(false);
    expect(proxima.disabled).toBe(false);
    cleanup();
  });

  test('o chip da area desenhada nao se refaz a cada desenho', async () => {
    const { container, cleanup } = await montar();
    const area = (x) => ({
      type: 'Polygon',
      coordinates: [[[x, -31], [-50, -31], [-50, -29], [x, -29], [x, -31]]],
    });

    mapaFalso.onAreaDesenhada(area(-53));
    await flush();
    const remover = container.querySelector('.busca-area-chip__remover');
    expect(remover).toBeTruthy();

    mapaFalso.onAreaDesenhada(area(-54));
    await flush();

    expect(container.querySelector('.busca-area-chip__remover')).toBe(remover);
    cleanup();
  });
});
