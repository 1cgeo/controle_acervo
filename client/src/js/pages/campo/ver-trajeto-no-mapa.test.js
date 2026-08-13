import {
  describe, test, expect, vi, beforeEach,
} from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O BOTAO "Ver no mapa" DO TRAJETO, pedido pelo chefe em 2026-08-13.
//
// Ate essa data a lista de trajetos da ficha dizia quantos pontos cada um tinha
// e nada mais: para VER o trajeto era preciso fechar a ficha, ir a aba Mapa,
// achar o campo entre os 54 e clicar nele -- e o clique so desenhava o trajeto
// por acidente do fluxo, sem nunca enquadra-lo.
//
// O jsdom nao tem WebGL, entao o MapLibre real nao sobe. O duble registra o que
// a PAGINA PEDE ao mapa (quais trajetos desenhar, qual campo destacar, o que
// enquadrar), que e o contrato de verdade entre os dois. O desenho em si nao e o
// que este arquivo protege.
// O DUBLE REGISTRA A ORDEM DOS PEDIDOS, e não só o último valor. Os dois
// defeitos de 2026-08-13 eram de SEQUÊNCIA, e um duble que guardasse só o
// estado final passaria por cima dos dois: o mapa acabava certo, e o que estava
// errado era o caminho até ele.
const mapaFalso = vi.hoisted(() => ({
  campos: null,
  tracks: null,
  selecionado: null,
  enquadrado: null,
  enquadradoMaxZoom: null,
  criado: 0,
  // Cada `setCampos`/`enquadrar`, em ordem de chamada.
  roteiro: [],
}));

vi.mock('@/js/pages/campo/campo-mapa.js', () => ({
  LEGENDA: [],
  criarMapaCampos: ({ onSelecionar }) => {
    mapaFalso.criado += 1;
    // O clique numa feicao do mapa, para o teste poder dispara-lo.
    mapaFalso.aoSelecionar = onSelecionar;
    return {
      element: document.createElement('div'),
      iniciar: () => Promise.resolve(),
      setCampos: (c, opcoes = {}) => {
        mapaFalso.campos = c;
        // O QUE IMPORTA É SE O AUTOMÁTICO IA DISPARAR. `manterEnquadramento`
        // falso com a aba já aberta é o zoom out no mundo antes do zoom in.
        mapaFalso.roteiro.push(
          opcoes.manterEnquadramento ? 'setCampos:mantendo' : 'setCampos:reenquadrando',
        );
      },
      setTracks: (t) => { mapaFalso.tracks = t; },
      focar: () => {},
      enquadrar: (g, maxZoom) => {
        mapaFalso.enquadrado = g;
        mapaFalso.enquadradoMaxZoom = maxZoom;
        mapaFalso.roteiro.push(`enquadrar:${g.type}`);
        return true;
      },
      selecionar: (id) => { mapaFalso.selecionado = id; },
      redimensionar: () => {},
      _cleanup: () => {},
    };
  },
}));

vi.mock('@services/campo-service.js', () => ({
  getDominioCampo: vi.fn(),
  listarCampos: vi.fn(),
  getCamposGeojson: vi.fn(),
  getCampo: vi.fn(),
  excluirCampo: vi.fn(),
  listarTracksCampo: vi.fn(),
  criarTrackCampo: vi.fn(),
  excluirTrackCampo: vi.fn(),
  listarImagensCampo: vi.fn(() => Promise.resolve([])),
  urlDaImagemCampo: vi.fn(),
}));

vi.mock('@services/plataforma-service.js', () => ({
  getUsuarios: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@store/auth-store.js', () => ({
  temPerfil: () => false,
  isAdmin: () => false,
  getToken: () => 'x',
}));

import { renderCampo } from '@/js/pages/campo/list.js';
import {
  getDominioCampo, listarCampos, getCamposGeojson, getCampo, listarTracksCampo,
} from '@services/campo-service.js';

const CAMPO = {
  id: 45,
  nome: 'Reambulação (EBGeo) Cascavel 2026',
  ano: 2026,
  situacao_id: 3,
  situacao: 'Finalizado',
  data_inicio: '2026-03-02',
  data_fim: '2026-03-20',
  categorias: [],
  militares: [],
  versoes: [],
  total_imagens: 0,
  total_tracks: 2,
};

// DOIS TRAJETOS, e o segundo SEM LINHA. A view `campo.track_linha` descarta o
// track de um ponto so, e ele chega com `geometria` nula: e o caso que nao pode
// ganhar botao, porque abriria o mapa em nada.
const TRACKS = [
  {
    id: 91,
    campo_id: 45,
    placa_vtr: 'EB-1234',
    dia: '2026-03-05',
    chefe_vtr: 'Cap Silva',
    motorista: 'Cb Souza',
    pontos: 6500,
    geometria: {
      type: 'LineString',
      coordinates: [[-53.5, -24.9], [-53.4, -24.8], [-53.3, -24.7]],
    },
  },
  {
    id: 92,
    campo_id: 45,
    placa_vtr: 'EB-5678',
    dia: '2026-03-06',
    chefe_vtr: 'Ten Costa',
    motorista: 'Sd Lima',
    pontos: 0,
    geometria: null,
  },
];

const montar = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const desmontar = await renderCampo(container, {});
  await flush();
  return { container, desmontar };
};

const botaoPorTexto = (raiz, texto) => [...raiz.querySelectorAll('button')]
  .find(b => b.textContent.includes(texto));

// A acao da tabela e um botao SO DE ICONE: o `textContent` dele e vazio, e quem
// o identifica e o `title`, que o data-table copia para o `aria-label`.
const abrirFichaDeTrajetos = async (container) => {
  container.querySelector('[title="Abrir a ficha"]').click();
  await flush();
  botaoPorTexto(document.body, 'Trajetos').click();
  await flush();
};

beforeEach(() => {
  document.body.innerHTML = '';
  mapaFalso.campos = null;
  mapaFalso.tracks = null;
  mapaFalso.selecionado = null;
  mapaFalso.enquadrado = null;
  mapaFalso.enquadradoMaxZoom = null;
  mapaFalso.criado = 0;
  mapaFalso.roteiro = [];

  getDominioCampo.mockResolvedValue({ situacoes: [], categorias: [], anos: [] });
  listarCampos.mockResolvedValue([CAMPO]);
  getCamposGeojson.mockResolvedValue({ type: 'FeatureCollection', features: [] });
  getCampo.mockResolvedValue(CAMPO);
  listarTracksCampo.mockResolvedValue(TRACKS);
});

// A ABA FICHA, que este arquivo achou quebrada ao montar a tela pela primeira
// vez. `el('dd', [no])` punha o no no lugar dos ATRIBUTOS, e o
// `setAttribute('0', ...)` que saia disso lancava InvalidCharacterError. Como a
// montagem da aba e uma promessa solta dentro de `createTabs`, o erro virava
// rejeicao nao tratada: a aba nascia VAZIA, sem mensagem nenhuma.
describe('a aba Ficha', () => {
  test('mostra a situacao, o periodo e o efetivo', async () => {
    const { container } = await montar();
    container.querySelector('[title="Abrir a ficha"]').click();
    await flush();

    const ficha = document.querySelector('.campo-detalhe__ficha');
    expect(ficha).not.toBeNull();
    // O CHIP E UM NO, e e ele que provava o defeito: as linhas de texto puro
    // sempre funcionaram.
    expect(ficha.querySelector('.chip').textContent).toBe('Finalizado');
    expect(ficha.textContent).toContain('02/03/2026 a 20/03/2026');
    expect(ficha.textContent).toContain('Ano do PIT');
  });
});

describe('o botao "Ver no mapa" da aba Trajetos', () => {
  test('desenha SO o trajeto escolhido, destaca o campo e enquadra a linha', async () => {
    const { container } = await montar();
    await abrirFichaDeTrajetos(container);

    const ver = botaoPorTexto(document.body, 'Ver no mapa');
    expect(ver).toBeDefined();
    ver.click();
    await flush();

    // O QUE FOI DESENHADO E UM SO, e nao os dois do campo: quem clicou apontou
    // um dia de viatura, e nao a semana inteira.
    expect(mapaFalso.tracks).toHaveLength(1);
    expect(mapaFalso.tracks[0].id).toBe(91);

    // O CAMPO FICA DESTACADO. Sem isso, a linha aparece solta e nada no mapa
    // diz de qual dos 54 campos ela e.
    expect(mapaFalso.selecionado).toBe(45);

    // O ENQUADRAMENTO E DA LINHA, e nao da area do campo: a linha de um dia
    // cobre uma fracao da reambulacao, e enquadrar o campo a deixaria um risco
    // no meio da tela. E a geometria DAQUELE trajeto, sem embrulho.
    expect(mapaFalso.enquadrado).toEqual(TRACKS[0].geometria);
    expect(mapaFalso.enquadradoMaxZoom).toBe(13);
  });

  // A FICHA E UM MODAL POR CIMA DA PAGINA, e o mapa e uma aba DELA. Deixar o
  // modal aberto esconderia exatamente o que a pessoa pediu para ver.
  test('fecha a ficha e troca para a aba Mapa', async () => {
    const { container } = await montar();
    await abrirFichaDeTrajetos(container);

    expect(document.querySelector('.modal, [role="dialog"]')).not.toBeNull();

    botaoPorTexto(document.body, 'Ver no mapa').click();
    await flush();

    expect(document.querySelector('.modal, [role="dialog"]')).toBeNull();
    expect(mapaFalso.criado).toBe(1);
    // A aba trocou de verdade: o mapa so nasce quando ela abre.
    expect(getCamposGeojson).toHaveBeenCalled();
  });

  // O DESENHO E O ULTIMO PASSO, e nao o primeiro. `setActive('mapa')` monta a
  // aba e chama `desenharMapa()`, que ZERA os trajetos: desenhar antes de
  // esperar por ela apagaria o que se acabou de pedir.
  test('o trajeto sobrevive a montagem da aba', async () => {
    const { container } = await montar();
    await abrirFichaDeTrajetos(container);
    botaoPorTexto(document.body, 'Ver no mapa').click();
    await flush();
    await flush();

    expect(mapaFalso.tracks).toHaveLength(1);
  });

  // OS DOIS DEFEITOS DE 2026-08-13, os dois de SEQUENCIA.
  //
  // 1. Aberto A PARTIR DA TABELA, o mapa nascia junto com o pedido: a aba
  //    montava, `desenharMapa()` re-enquadrava TUDO, e o alvo se perdia. O
  //    "Ver no mapa" terminava mostrando o mundo inteiro.
  // 2. Com a aba do mapa JA ABERTA, o re-enquadramento disparava mesmo assim, e
  //    dava um zoom out no mundo um instante antes do zoom in no trajeto.
  //
  // A prova de ambos e a mesma: `setCampos` nunca pode pedir re-enquadramento
  // dentro do fluxo do "Ver no mapa".
  test('vindo da TABELA, nao re-enquadra tudo antes de ir ao trajeto', async () => {
    const { container } = await montar();
    // A aba do mapa NUNCA foi aberta: o mapa nasce dentro deste fluxo.
    expect(mapaFalso.criado).toBe(0);

    await abrirFichaDeTrajetos(container);
    botaoPorTexto(document.body, 'Ver no mapa').click();
    await flush();

    expect(mapaFalso.roteiro).toEqual(['setCampos:mantendo', 'enquadrar:LineString']);
  });

  test('com a aba do mapa JA aberta, tambem nao re-enquadra tudo no caminho', async () => {
    const { container } = await montar();

    // Abre a aba Mapa primeiro, como quem estava olhando o mapa.
    botaoPorTexto(container, 'Mapa').click();
    await flush();
    expect(mapaFalso.criado).toBe(1);
    // Esta primeira montagem re-enquadra, e DEVE: ninguem pediu alvo nenhum.
    expect(mapaFalso.roteiro).toEqual(['setCampos:reenquadrando']);
    mapaFalso.roteiro = [];

    botaoPorTexto(container, 'Tabela').click();
    await flush();
    await abrirFichaDeTrajetos(container);
    botaoPorTexto(document.body, 'Ver no mapa').click();
    await flush();

    // O mapa NAO foi reconstruido, e o caminho ate o trajeto nao passou pelo
    // enquadramento de todos os campos.
    expect(mapaFalso.criado).toBe(1);
    expect(mapaFalso.roteiro).toEqual(['setCampos:mantendo', 'enquadrar:LineString']);
  });

  // A BANDEIRA TEM DE BAIXAR. Presa levantada, o filtro seguinte nunca mais
  // re-enquadraria, e o defeito trocaria de lugar em vez de sumir.
  test('depois do "Ver no mapa", a troca de filtro volta a re-enquadrar', async () => {
    const { container } = await montar();
    await abrirFichaDeTrajetos(container);
    botaoPorTexto(document.body, 'Ver no mapa').click();
    await flush();
    mapaFalso.roteiro = [];

    const busca = container.querySelector('.page__filters input[type="text"]');
    busca.value = 'Cascavel';
    busca.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise(r => { setTimeout(r, 400); });
    await flush();

    expect(mapaFalso.roteiro).toEqual(['setCampos:reenquadrando']);
  });

  test('trajeto sem linha nao ganha botao, e diz por que', async () => {
    const { container } = await montar();
    await abrirFichaDeTrajetos(container);

    const itens = [...document.querySelectorAll('.campo-tracks__item')];
    expect(itens).toHaveLength(2);
    expect(botaoPorTexto(itens[0], 'Ver no mapa')).toBeDefined();
    expect(botaoPorTexto(itens[1], 'Ver no mapa')).toBeUndefined();
    expect(itens[1].textContent).toContain('sem linha para desenhar');
  });

  // UM POR VEZ, E NAO EXISTE BOTAO DE LOTE (chefe, 2026-08-13). Eu havia posto
  // um "Ver os N no mapa" por iniciativa propria, e ele foi cortado: com os 17
  // trajetos de Cascavel, o lote desenhava 30.338 pontos de linha sobrepostos,
  // que nao respondem "por onde a viatura andou".
  test('nao existe botao de lote, nem com varios trajetos desenhaveis', async () => {
    listarTracksCampo.mockResolvedValue([
      TRACKS[0],
      { ...TRACKS[1], geometria: { type: 'LineString', coordinates: [[-53.9, -25.1], [-53.8, -25.0]] } },
    ]);

    const { container } = await montar();
    await abrirFichaDeTrajetos(container);

    expect(botaoPorTexto(document.body, 'Ver os')).toBeUndefined();
    // Um botao por trajeto, e cada um desenha o SEU.
    const itens = [...document.querySelectorAll('.campo-tracks__item')];
    expect(itens).toHaveLength(2);

    botaoPorTexto(itens[1], 'Ver no mapa').click();
    await flush();
    expect(mapaFalso.tracks).toHaveLength(1);
    expect(mapaFalso.tracks[0].id).toBe(92);
  });

  // O CLIQUE NO CAMPO ABRE A FICHA, E SO. Ate 2026-08-13 ele carregava TODOS os
  // trajetos daquele campo e os despejava no mapa.
  test('clicar num campo no mapa nao desenha trajeto nenhum', async () => {
    const { container } = await montar();
    botaoPorTexto(container, 'Mapa').click();
    await flush();

    listarTracksCampo.mockClear();
    mapaFalso.aoSelecionar(45);
    await flush();

    expect(listarTracksCampo).not.toHaveBeenCalled();
    expect(document.querySelector('.campo-detalhe')).not.toBeNull();
  });
});
