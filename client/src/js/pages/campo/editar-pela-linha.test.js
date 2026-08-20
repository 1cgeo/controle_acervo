import {
  describe, test, expect, vi, beforeEach,
} from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O BOTAO "Editar" DA TABELA, e a area que sumia nele.
//
// A linha da lista NAO TEM GEOMETRIA: o `SELECT_LISTA` do servidor deixa `geom`
// de fora de proposito, porque a tabela nao desenha nada. O formulario le a
// area de `campo.geometria`, entao aberto com a linha crua ele dizia "Nenhuma
// area definida" num campo que TEM area, e o Salvar travava pedindo o GeoJSON
// de novo -- nao havia como mudar a situacao de um campo ja cadastrado sem
// reimportar o arquivo da area. Pego em 2026-08-20, no campo de Porto Uniao.
//
// O que este arquivo protege e o CONTRATO entre a tabela e o formulario: quem
// clica em "Editar" na linha recebe a FICHA (`GET /campo/:id`), e nunca a linha.

const dialogo = vi.hoisted(() => ({ chamadas: [] }));

vi.mock('@/js/pages/campo/campo-dialog.js', () => ({
  openCampoDialog: (opcoes) => { dialogo.chamadas.push(opcoes); },
}));

vi.mock('@/js/pages/campo/campo-mapa.js', () => ({
  LEGENDA: [],
  criarMapaCampos: () => ({
    element: document.createElement('div'),
    iniciar: () => Promise.resolve(),
    setCampos: () => {},
    setTracks: () => {},
    focar: () => {},
    enquadrar: () => true,
    selecionar: () => {},
    redimensionar: () => {},
    _cleanup: () => {},
  }),
}));

vi.mock('@services/campo-service.js', () => ({
  getDominioCampo: vi.fn(),
  listarCampos: vi.fn(),
  getCamposGeojson: vi.fn(),
  getCampo: vi.fn(),
  excluirCampo: vi.fn(),
  listarTracksCampo: vi.fn(() => Promise.resolve([])),
  listarImagensCampo: vi.fn(() => Promise.resolve([])),
  urlDaImagemCampo: vi.fn(),
}));

vi.mock('@services/plataforma-service.js', () => ({
  getUsuarios: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@store/auth-store.js', () => ({
  temPerfil: () => true,
  isAdmin: () => false,
  getToken: () => 'x',
}));

import { renderCampo } from '@/js/pages/campo/list.js';
import {
  getDominioCampo, listarCampos, getCamposGeojson, getCampo,
} from '@services/campo-service.js';

// A LINHA, como o servidor a serve: tudo menos a geometria.
const LINHA = {
  id: 46,
  nome: 'Reambulação (EBGeo) Porto União 2026',
  ano: 2026,
  situacao_id: 2,
  situacao: 'Em execução',
  data_inicio: '2026-08-10',
  data_fim: '2026-08-21',
  categorias: [{ id: 1, nome: 'Reambulação' }],
  militares: [],
  versoes: [],
  total_imagens: 0,
  total_tracks: 0,
};

const AREA = {
  type: 'MultiPolygon',
  coordinates: [[[[-51.1, -26.3], [-51.0, -26.3], [-51.0, -26.2], [-51.1, -26.3]]]],
};

// A FICHA e a linha MAIS a geometria, que so `GET /campo/:id` traz.
const FICHA = { ...LINHA, geometria: AREA };

const montar = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  await renderCampo(container, {});
  await flush();
  return container;
};

beforeEach(() => {
  document.body.innerHTML = '';
  dialogo.chamadas = [];

  getDominioCampo.mockResolvedValue({ situacoes: [], categorias: [], anos: [] });
  listarCampos.mockResolvedValue([LINHA]);
  getCamposGeojson.mockResolvedValue({ type: 'FeatureCollection', features: [] });
  getCampo.mockResolvedValue(FICHA);
});

describe('o botao "Editar" da linha da tabela', () => {
  test('abre o formulario com a AREA, e nao com a linha sem geometria', async () => {
    const container = await montar();

    container.querySelector('[title="Editar o campo"]').click();
    await flush();

    expect(getCampo).toHaveBeenCalledWith(46);
    expect(dialogo.chamadas).toHaveLength(1);
    // A ASSERCAO QUE REPROVA O ESTADO ANTERIOR: antes do conserto o formulario
    // recebia `LINHA`, cujo `geometria` e `undefined`.
    expect(dialogo.chamadas[0].campo.geometria).toEqual(AREA);
  });

  test('nao abre o formulario quando a ficha nao carrega', async () => {
    getCampo.mockRejectedValue(new Error('Campo não encontrado'));
    const container = await montar();

    container.querySelector('[title="Editar o campo"]').click();
    await flush();

    // Melhor nenhum formulario do que um formulario que perdeu a area: salvar
    // dali gravaria o campo sem o que a tela nao carregou.
    expect(dialogo.chamadas).toHaveLength(0);
  });
});

describe('o botao "Editar" da ficha', () => {
  test('continua abrindo o formulario com a area que a ficha ja carregou', async () => {
    const container = await montar();

    container.querySelector('[title="Abrir a ficha"]').click();
    await flush();
    [...document.body.querySelectorAll('button')]
      .find(b => b.textContent.includes('Editar'))
      .click();
    await flush();

    expect(dialogo.chamadas).toHaveLength(1);
    expect(dialogo.chamadas[0].campo.geometria).toEqual(AREA);
  });
});
