import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('maplibre-gl', async () => await import('@components/mapa/maplibre-stub.js'));

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderMapaTab } from '@modules/mapoteca/pages/dashboard/mapa-tab.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { instanciasMapa } from '@components/mapa/maplibre-stub.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// A aba NAO tem filtro proprio: ela recebe o ano da pagina do dashboard, que
// tem um filtro so para as cinco abas (chefe, 2026-08-04). Quem prova que a
// pagina abre no ano ATUAL e o teste do index. Aqui o ano e injetado, e por
// isso os anos abaixo sao fixos e nao dependem da data de hoje.
let ano = 2026;
const getAno = () => ano;

/** Monta a aba com o ano injetado, como o dashboard faz. */
const montar = (container) => renderMapaTab(container, getAno);

const CACEQUI = {
  id: 880,
  nome: 'Cacequi',
  mi: '2963-3',
  tipo_produto: 'Carta Topográfica',
  escala: '1:50.000',
  total_pedidos: 9,
  total_clientes: 9,
  total_produtos: 81,
  area: 0.25,
  geom: { type: 'Polygon', coordinates: [[[-55, -30], [-54.5, -30], [-54.5, -29.5], [-55, -29.5], [-55, -30]]] },
  ponto: { type: 'Point', coordinates: [-54.75, -29.75] },
};

/** Produto especial: sem MI, entao o rotulo tem de cair para o nome. */
const CAMPO_INSTRUCAO = {
  id: 91,
  nome: 'Campo de Instrução de Santa Maria',
  mi: null,
  tipo_produto: 'Carta Topográfica Especial',
  escala: '1:25.000',
  total_pedidos: 1,
  total_clientes: 1,
  total_produtos: 2,
  area: 0.01,
  geom: { type: 'Polygon', coordinates: [[[-54, -29.8], [-53.9, -29.8], [-53.9, -29.7], [-54, -29.7], [-54, -29.8]]] },
  ponto: { type: 'Point', coordinates: [-53.95, -29.75] },
};

function resposta(dados, extras = {}) {
  const total = dados.reduce((s, d) => s + d.total_produtos, 0);
  return {
    ano: 2026,
    filtrado: false,
    total_produtos: total,
    total_ano: total,
    sem_geometria: 0,
    dados,
    ...extras,
  };
}

const FILTROS = {
  ano: 2026,
  tipos_produto: [
    { code: 2, nome: 'Carta Topográfica', produtos: 302 },
    { code: 3, nome: 'Carta Ortoimagem', produtos: 23 },
  ],
  escalas: [
    { escala: '1:25.000', produtos: 47 },
    { escala: '1:50.000', produtos: 152 },
  ],
  clientes: [
    { id: 38, nome: '10º Batalhão Logístico', produtos: 75 },
    { id: 5, nome: '11ª Bateria de Artilharia Antiaérea', produtos: 13 },
  ],
};

/** Rotulos das opcoes de um dos tres selects de filtro, na ordem da tela. */
const opcoesDo = (container, indice) =>
  Array.from(container.querySelectorAll('.mapa-entregas__filtro select')[indice].options)
    .map(o => o.textContent);

const selectDe = (container, indice) =>
  container.querySelectorAll('.mapa-entregas__filtro select')[indice];

/** Troca um dos filtros e espera a recarga. */
async function escolher(container, indice, valor) {
  const select = selectDe(container, indice);
  select.value = valor;
  select.dispatchEvent(new Event('change'));
  await flush();
}

const SEM_FILTRO = { tipo_produto_id: null, escala: null, cliente_id: null };

describe('aba Mapa do dashboard da mapoteca', () => {
  beforeEach(() => {
    // O ano volta ao padrao a cada teste: sem isto, o teste que o troca
    // decidiria o ano do proximo, pela ordem de execucao.
    ano = 2026;
    instanciasMapa.length = 0;
    document.body.innerHTML = '';
    svc.getEntregasGeo.mockResolvedValue(resposta([CACEQUI, CAMPO_INSTRUCAO]));
    svc.getEntregasFiltros.mockResolvedValue(FILTROS);
  });

  test('busca as entregas do ano recebido da pagina e leva as feicoes para o mapa', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    expect(svc.getEntregasGeo).toHaveBeenCalledWith(2026, SEM_FILTRO);

    const mapa = instanciasMapa[0];
    const colecao = mapa.getSource('entregas').dados;
    expect(colecao.features).toHaveLength(2);
    // O `id` no TOPO da feature e o que permite o realce (feature-state); so em
    // properties, o mouseover nao acenderia nada.
    expect(colecao.features[0].id).toBe(880);
    expect(colecao.features[0].properties.total_produtos).toBe(81);

    cleanup();
  });

  test('o rotulo usa o MI, e cai para o nome no produto sem MI', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    const rotulo = instanciasMapa[0].camadas['entregas-rotulo'];
    expect(rotulo.layout['text-field']).toEqual(['coalesce', ['get', 'mi'], ['get', 'nome']]);
    // Sem `glyphs` no estilo, camada de simbolo simplesmente nao aparece.
    expect(instanciasMapa[0].opcoes.style.glyphs).toContain('{fontstack}');

    cleanup();
  });

  // A mesma carta aparecia DUAS vezes no mapa: rotulando o poligono, o MapLibre
  // corta o GeoJSON em ladrilhos e ancora o texto por pedaco, entao a folha que
  // cruza a borda de um ladrilho ganha um rotulo de cada lado. Um ponto cabe num
  // ladrilho so.
  test('o rotulo sai de uma fonte de PONTOS, e nao do poligono', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    const mapa = instanciasMapa[0];
    expect(mapa.camadas['entregas-rotulo'].source).toBe('entregas-pontos');
    expect(mapa.camadas['entregas-preenchimento'].source).toBe('entregas');

    const pontos = mapa.getSource('entregas-pontos').dados.features;
    expect(pontos).toHaveLength(2);
    expect(pontos.every(f => f.geometry.type === 'Point')).toBe(true);
    // Um ponto por produto: se sobrar, o rotulo volta a repetir.
    expect(new Set(pontos.map(f => f.id)).size).toBe(2);

    cleanup();
  });

  // O mapeamento e aninhado por escala (a folha 1:25.000 fica dentro da
  // 1:100.000), entao sem ordem a folha grande engole a pequena, inclusive para
  // o clique.
  test('a folha menor fica por cima da maior', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    const preenchimento = instanciasMapa[0].camadas['entregas-preenchimento'];
    expect(preenchimento.layout['fill-sort-key']).toEqual(['-', 0, ['get', 'area']]);

    const feicoes = instanciasMapa[0].getSource('entregas').dados.features;
    expect(feicoes.map(f => f.properties.area)).toEqual([0.25, 0.01]);

    cleanup();
  });

  test('resume quantos exemplares e quantos produtos entraram no mapa', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    const resumo = container.querySelector('.mapa-entregas__resumo').textContent;
    expect(resumo).toContain('83');
    expect(resumo).toContain('2 produtos');

    cleanup();
  });

  // Silenciar isto faria o mapa mostrar menos do que o cartao "Produtos
  // entregues" do resumo anual, sem explicar a diferenca.
  test('avisa quando alguma entrega ficou fora por falta de geometria', async () => {
    svc.getEntregasGeo.mockResolvedValue(resposta([CACEQUI], { sem_geometria: 7 }));
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    const aviso = container.querySelector('.mapa-entregas__resumo-aviso');
    expect(aviso).toBeTruthy();
    expect(aviso.textContent).toContain('7');

    cleanup();
  });

  test('sem entrega no ano, diz isso em vez de deixar a tela muda', async () => {
    ano = 2019;
    svc.getEntregasGeo.mockResolvedValue(resposta([]));
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    expect(container.querySelector('.mapa-entregas__resumo').textContent)
      .toContain('Nenhuma entrega registrada em 2019');

    cleanup();
  });

  test('o refresh reenquadra ao trocar o ano, e nao reenquadra no auto-refresh', async () => {
    ano = 2026;
    const container = document.createElement('div');
    const { cleanup, refresh } = await montar(container);
    await flush();

    const mapa = instanciasMapa[0];
    const enquadramentosIniciais = mapa.enquadramentos.length;
    expect(enquadramentosIniciais).toBe(1);

    // Auto-refresh de 60 s: mesmo ano, entao o mapa NAO pode pular de volta
    // enquanto a pessoa esta olhando uma regiao.
    await refresh();
    await flush();
    expect(mapa.enquadramentos).toHaveLength(enquadramentosIniciais);

    // Troca de ano: agora reenquadra, porque a area coberta e outra.
    ano = 2025;
    await refresh();
    await flush();
    expect(svc.getEntregasGeo).toHaveBeenLastCalledWith(2025, SEM_FILTRO);
    expect(mapa.enquadramentos).toHaveLength(enquadramentosIniciais + 1);

    cleanup();
  });

  // ---------------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------------

  test('as opcoes de filtro sao as do ano, e trazem quantos produtos cada uma tem', async () => {
    ano = 2026;
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    expect(svc.getEntregasFiltros).toHaveBeenCalledWith(2026, SEM_FILTRO);
    // "Todos" primeiro, senao nao ha como desfazer o filtro.
    expect(opcoesDo(container, 0)).toEqual([
      'Todos', 'Carta Topográfica (302)', 'Carta Ortoimagem (23)',
    ]);
    expect(opcoesDo(container, 1)).toEqual(['Todos', '1:25.000 (47)', '1:50.000 (152)']);
    expect(opcoesDo(container, 2)[2]).toContain('11ª Bateria');

    cleanup();
  });

  test('escolher um filtro refaz a busca com ele e reenquadra', async () => {
    ano = 2026;
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();
    const mapa = instanciasMapa[0];
    const antes = mapa.enquadramentos.length;

    await escolher(container, 2, '38');

    expect(svc.getEntregasGeo).toHaveBeenLastCalledWith(2026, {
      tipo_produto_id: null, escala: null, cliente_id: 38,
    });
    // Filtrar por uma OM tem de levar o mapa ate o que aquela OM recebeu.
    expect(mapa.enquadramentos.length).toBe(antes + 1);

    cleanup();
  });

  // Um filtro filtra o quantitativo do outro: escolher uma OM tem de mudar o
  // numero ao lado de cada escala e de cada tipo.
  test('um filtro cruza o quantitativo dos outros', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    svc.getEntregasFiltros.mockResolvedValue({
      ano: 2026,
      tipos_produto: [{ code: 2, nome: 'Carta Topográfica', produtos: 75 }],
      escalas: [
        { escala: '1:50.000', produtos: 63 },
        { escala: '1:100.000', produtos: 12 },
      ],
      // A lista do PROPRIO filtro nao encolhe: sem isso nao haveria como trocar
      // de OM sem antes limpar.
      clientes: FILTROS.clientes,
    });
    await escolher(container, 2, '38');

    expect(svc.getEntregasFiltros).toHaveBeenLastCalledWith(2026, {
      tipo_produto_id: null, escala: null, cliente_id: 38,
    });
    expect(opcoesDo(container, 1)).toEqual(['Todos', '1:50.000 (63)', '1:100.000 (12)']);
    expect(opcoesDo(container, 0)).toEqual(['Todos', 'Carta Topográfica (75)']);
    expect(opcoesDo(container, 2)).toHaveLength(3);
    expect(selectDe(container, 2).value).toBe('38');

    cleanup();
  });

  // Descartar seria desfazer em silencio o que a pessoa pediu, e ela veria o
  // mapa mudar sem entender. Com "(0)" na lista, o mapa vazio tem explicacao.
  test('a escolha que zera com o cruzamento fica na lista, marcada com (0)', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    await escolher(container, 1, '1:25.000');

    // A OM 38 nao tem nada em 1:25.000: a escala some da lista cruzada.
    svc.getEntregasFiltros.mockResolvedValue({
      ano: 2026,
      tipos_produto: FILTROS.tipos_produto,
      escalas: [{ escala: '1:50.000', produtos: 63 }],
      clientes: FILTROS.clientes,
    });
    svc.getEntregasGeo.mockResolvedValue(resposta([], { filtrado: true, total_ano: 3119 }));
    await escolher(container, 2, '38');

    expect(opcoesDo(container, 1)).toEqual(['Todos', '1:50.000 (63)', '1:25.000 (0)']);
    expect(selectDe(container, 1).value).toBe('1:25.000');
    expect(svc.getEntregasGeo).toHaveBeenLastCalledWith(2026, {
      tipo_produto_id: null, escala: '1:25.000', cliente_id: 38,
    });

    cleanup();
  });

  test('os tres filtros se combinam, e o id vai como numero', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    await escolher(container, 0, '2');
    await escolher(container, 1, '1:50.000');
    await escolher(container, 2, '38');

    expect(svc.getEntregasGeo).toHaveBeenLastCalledWith(2026, {
      tipo_produto_id: 2, escala: '1:50.000', cliente_id: 38,
    });

    cleanup();
  });

  test('o botao de limpar so aparece com filtro, e devolve tudo', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    const limpar = [...container.querySelectorAll('button')]
      .find(b => b.textContent === 'Limpar filtros');
    expect(limpar.classList.contains('hidden')).toBe(true);

    await escolher(container, 1, '1:25.000');
    expect(limpar.classList.contains('hidden')).toBe(false);

    limpar.click();
    await flush();

    expect(svc.getEntregasGeo).toHaveBeenLastCalledWith(2026, SEM_FILTRO);
    expect(selectDe(container, 1).value).toBe('');
    expect(limpar.classList.contains('hidden')).toBe(true);

    cleanup();
  });

  // Com filtro, o numero sozinho nao diz nada: 318 e muito ou pouco depende de
  // o ano ter 3.119.
  test('com filtro, o resumo mostra o recorte contra o total do ano', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    svc.getEntregasGeo.mockResolvedValue(
      resposta([CACEQUI], { filtrado: true, total_ano: 3119 })
    );
    await escolher(container, 1, '1:50.000');

    expect(container.querySelector('.mapa-entregas__resumo').textContent)
      .toContain('81 de 3.119 exemplares');

    cleanup();
  });

  test('combinacao de filtros sem resultado diz que foi o filtro', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    svc.getEntregasGeo.mockResolvedValue(resposta([], { filtrado: true, total_ano: 3119 }));
    await escolher(container, 0, '3');

    expect(container.querySelector('.mapa-entregas__resumo').textContent)
      .toContain('Nenhuma entrega com esta combinação de filtros');

    cleanup();
  });

  // A OM que nao entregou nada no ano novo nao existe mais como opcao. Manter a
  // selecao faria o mapa nascer vazio sem a pessoa entender por que.
  test('trocar o ano descarta o filtro que sumiu da lista, e mantem o que ficou', async () => {
    ano = 2026;
    const container = document.createElement('div');
    const { cleanup, refresh } = await montar(container);
    await flush();

    await escolher(container, 2, '38');
    await escolher(container, 1, '1:25.000');

    // Em 2025 a OM 38 nao tem entrega, mas a escala 1:25.000 continua.
    svc.getEntregasFiltros.mockResolvedValue({
      ano: 2025,
      tipos_produto: FILTROS.tipos_produto,
      escalas: [{ escala: '1:25.000', produtos: 4 }],
      clientes: [{ id: 5, nome: '11ª Bateria de Artilharia Antiaérea', produtos: 2 }],
    });
    ano = 2025;
    await refresh();
    await flush();

    expect(svc.getEntregasGeo).toHaveBeenLastCalledWith(2025, {
      tipo_produto_id: null, escala: '1:25.000', cliente_id: null,
    });
    expect(selectDe(container, 2).value).toBe('');

    cleanup();
  });

  test('a lista de opcoes que falha nao derruba o mapa', async () => {
    svc.getEntregasFiltros.mockRejectedValue(new Error('rede fora'));
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    expect(svc.getEntregasGeo).toHaveBeenCalledWith(2026, SEM_FILTRO);
    expect(instanciasMapa[0].getSource('entregas').dados.features).toHaveLength(2);

    cleanup();
  });

  test('o cleanup remove o mapa', async () => {
    const container = document.createElement('div');
    const { cleanup } = await montar(container);
    await flush();

    const mapa = instanciasMapa[0];
    cleanup();
    expect(mapa.removido).toBe(true);
  });
});
