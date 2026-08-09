import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { logarComo, CONSULTA, GERENTE } from '@/__tests__/helpers/sessao.js';

// MAPAS DE ACOMPANHAMENTO (#/producao/mapas).
//
// O que estes casos prendem:
//  - VIEW QUE AINDA NÃO NASCEU É CASO NORMAL. As views do schema
//    `acompanhamento` são geradas em tempo de execução, e o par (lote, linha) só
//    vira view quando o lote recebe a primeira etapa. O servidor responde 404
//    com a frase que explica isso, e a tela mostra "ainda não há o que mostrar"
//    -- nunca uma caixa de erro, que mandaria alguém procurar defeito onde só
//    falta o lote começar;
//  - O CATÁLOGO DE CAMADAS É DE GERENTE e a tela é de CONSULTA. Ele carrega
//    sozinho, com o próprio `catch`: num `Promise.all` o 403 dele derrubaria a
//    tela inteira, e a mensagem que sobraria seria "necessita do perfil
//    gerente" numa tela que a pessoa TEM perfil para ver;
//  - a tile é OUTRA pergunta (a linha de produção inteira, sobre todos os
//    lotes), e por isso ela só se oferece quando a camada escolhida é de linha.

vi.mock('maplibre-gl', async () => {
  const stub = await import('@components/mapa/maplibre-stub.js');
  class Mapa extends stub.Map {
    addSource(id, config) {
      super.addSource(id, config);
      this.configs = this.configs || {};
      this.configs[id] = config;
    }

    getLayer(id) { return this.camadas[id]; }

    removeLayer(id) { delete this.camadas[id]; }

    removeSource(id) {
      delete this.fontes[id];
      if (this.configs) delete this.configs[id];
    }
  }
  return { ...stub, Map: Mapa, default: { ...stub.default, Map: Mapa } };
});

vi.mock('@services/producao-service.js', async () => {
  const real = await vi.importActual('@services/producao-service.js');
  return {
    ...real,
    getMapaAcompanhamento: vi.fn(() => Promise.resolve({ vazio: true, motivo: 'sem view' })),
    getCatalogoCamadas: vi.fn(() => Promise.resolve([])),
  };
});

import { instanciasMapa } from '@components/mapa/maplibre-stub.js';
import { renderMapas, rotuloDaCamada, linhaProducaoDoNome } from './index.js';
import {
  getMapaAcompanhamento,
  getCatalogoCamadas,
} from '@services/producao-service.js';

const poligono = {
  type: 'Polygon',
  coordinates: [[[-54, -30], [-53, -30], [-53, -29], [-54, -30]]],
};

const COLECAO = {
  type: 'FeatureCollection',
  features: [
    {
      type: 'Feature',
      geometry: poligono,
      properties: {
        id: 1, nome: 'Santa Maria',
        f_1_preparo_data_inicio: '2026-01-05', f_1_preparo_data_fim: '2026-01-20',
      },
    },
  ],
};

const CATALOGO = [
  { nome: 'lote_3_linha_1', tipo: 'lote', lote_id: 3, lote: 'Lote 1', projeto: 'Mapeamento RS' },
  { nome: 'lote_3_subfase_9', tipo: 'subfase', lote_id: 3, lote: 'Lote 1', projeto: 'Mapeamento RS' },
  { nome: 'bloco', tipo: 'bloco' },
];

async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = renderMapas(container);
  await flush();
  return { container, cleanup };
}

const seletorDeCamada = (c) => c.querySelector('.page__filters select');
const marcaDaTile = (c) => c.querySelector('.page__filters input[type="checkbox"]');
const situacao = (c) => c.querySelector('.mapas__situacao');

function escolher(container, nome) {
  const select = seletorDeCamada(container);
  select.value = nome;
  select.dispatchEvent(new Event('change'));
}

beforeEach(() => {
  logarComo({ producao: CONSULTA });
  instanciasMapa.length = 0;
  getMapaAcompanhamento.mockResolvedValue({ vazio: false, geojson: COLECAO });
  getCatalogoCamadas.mockResolvedValue([]);
});

describe('rotuloDaCamada e linhaProducaoDoNome', () => {
  test('o nome da view vira frase, com projeto e lote quando há', () => {
    expect(rotuloDaCamada(CATALOGO[0])).toBe('Mapeamento RS / Lote 1 — linha de produção 1');
    expect(rotuloDaCamada(CATALOGO[1])).toBe('Mapeamento RS / Lote 1 — subfase 9');
    expect(rotuloDaCamada({ nome: 'bloco' })).toBe('Blocos (todos os lotes)');
  });

  test('sem catálogo, o nome cru ainda vira frase legível', () => {
    expect(rotuloDaCamada({ nome: 'lote_7_linha_2' })).toBe('lote 7 — linha de produção 2');
  });

  // O `_linha_` ancorado no FIM: sem a âncora, `lote_1_subfase_1` casaria.
  test('só a camada de LINHA carrega id de linha de produção', () => {
    expect(linhaProducaoDoNome('lote_3_linha_1')).toBe(1);
    expect(linhaProducaoDoNome('lote_3_subfase_9')).toBeNull();
    expect(linhaProducaoDoNome('bloco')).toBeNull();
  });
});

describe('a tela', () => {
  test('abre na camada de blocos, que é a única que existe sempre', async () => {
    const { container, cleanup } = await montar();

    expect(getMapaAcompanhamento).toHaveBeenCalledWith('bloco');
    expect(situacao(container).textContent).toMatch(/1 feição\(ões\)/);
    cleanup();
  });

  // O CASO QUE DECIDE A TELA.
  test('camada que ainda não nasceu não é erro: é "ainda não há o que mostrar"', async () => {
    getMapaAcompanhamento.mockResolvedValue({
      vazio: true,
      causa: 'camada-inexistente',
      motivo: 'A camada de acompanhamento "bloco" ainda não existe. Ela é criada quando o lote recebe a primeira etapa da linha de produção ou da subfase.',
    });
    const { container, cleanup } = await montar();

    expect(situacao(container).textContent).toMatch(/Ainda não há o que mostrar/);
    expect(situacao(container).className).toMatch(/--ausente/);
    // E NÃO uma caixa de erro: a diferença é entre "não há" e "não consegui
    // perguntar", e só uma delas pede ação.
    expect(container.querySelector('.dashboard-erro')).toBeNull();
    cleanup();
  });

  test('403 de verdade continua sendo erro, com o caminho de volta', async () => {
    getMapaAcompanhamento.mockRejectedValue(
      new Error('Usuário necessita do perfil consulta no módulo producao')
    );
    const { container, cleanup } = await montar();

    const erro = container.querySelector('.dashboard-erro');
    expect(erro).toBeTruthy();
    expect(erro.textContent).toContain('necessita do perfil consulta');
    cleanup();
  });

  test('o catálogo que recusa vira NOTA, e a tela continua de pé', async () => {
    getCatalogoCamadas.mockRejectedValue(
      new Error('Usuário necessita do perfil gerente no módulo producao')
    );
    const { container, cleanup } = await montar();

    const nota = container.querySelector('.mapas__catalogo');
    expect(nota.classList.contains('hidden')).toBe(false);
    expect(nota.textContent).toMatch(/rota de GERENTE/);
    // A camada de blocos carregou do mesmo jeito, e não há caixa de erro.
    expect(situacao(container).textContent).toMatch(/1 feição\(ões\)/);
    expect(container.querySelector('.dashboard-erro')).toBeNull();
    cleanup();
  });

  test('com catálogo, o seletor lista as camadas com nome de gente', async () => {
    logarComo({ producao: GERENTE });
    getCatalogoCamadas.mockResolvedValue(CATALOGO);
    const { container, cleanup } = await montar();

    const rotulos = [...seletorDeCamada(container).options].map(o => o.textContent);
    expect(rotulos).toContain('Blocos (todos os lotes)');
    expect(rotulos).toContain('Mapeamento RS / Lote 1 — linha de produção 1');
    // A `bloco` do catálogo não entra duas vezes.
    expect(rotulos.filter(r => r === 'Blocos (todos os lotes)')).toHaveLength(1);
    cleanup();
  });

  test('trocar de camada busca a nova', async () => {
    getCatalogoCamadas.mockResolvedValue(CATALOGO);
    const { container, cleanup } = await montar();

    escolher(container, 'lote_3_subfase_9');
    await flush();

    expect(getMapaAcompanhamento).toHaveBeenLastCalledWith('lote_3_subfase_9');
    cleanup();
  });
});

describe('a camada de tiles', () => {
  test('só se oferece quando a camada escolhida é de linha de produção', async () => {
    getCatalogoCamadas.mockResolvedValue(CATALOGO);
    const { container, cleanup } = await montar();

    // Em blocos não há id de linha de onde tirar a tile.
    expect(marcaDaTile(container).closest('.form-field').classList.contains('hidden')).toBe(true);

    escolher(container, 'lote_3_linha_1');
    await flush();
    expect(marcaDaTile(container).closest('.form-field').classList.contains('hidden')).toBe(false);
    cleanup();
  });

  test('marcada, ela entra no mapa com a URL do token e o source-layer do servidor', async () => {
    getCatalogoCamadas.mockResolvedValue(CATALOGO);
    const { container, cleanup } = await montar();

    escolher(container, 'lote_3_linha_1');
    await flush();

    const marca = marcaDaTile(container);
    marca.checked = true;
    marca.dispatchEvent(new Event('change'));

    const instancia = instanciasMapa[instanciasMapa.length - 1];
    expect(instancia.configs['linha-producao-tile'].tiles[0])
      .toBe('/api/acompanhamento/linha_producao/1/{z}/{x}/{y}.pbf?token=tk-teste');
    expect(instancia.camadas['linha-producao-contorno']['source-layer'])
      .toBe('linha_producao_1');
    cleanup();
  });

  test('voltar para uma camada sem linha desliga a tile', async () => {
    getCatalogoCamadas.mockResolvedValue(CATALOGO);
    const { container, cleanup } = await montar();

    escolher(container, 'lote_3_linha_1');
    await flush();
    const marca = marcaDaTile(container);
    marca.checked = true;
    marca.dispatchEvent(new Event('change'));

    escolher(container, 'bloco');
    await flush();

    const instancia = instanciasMapa[instanciasMapa.length - 1];
    expect(instancia.getSource('linha-producao-tile')).toBeUndefined();
    expect(marca.checked).toBe(false);
    cleanup();
  });
});

describe('abrir camada pelo nome', () => {
  test('recusa a forma inválida sem ir ao servidor', async () => {
    const { container, cleanup } = await montar();
    getMapaAcompanhamento.mockClear();

    const campo = container.querySelector('.mapas__manual input');
    campo.value = 'lote_3';
    container.querySelector('.mapas__manual button').click();
    await flush();

    expect(getMapaAcompanhamento).not.toHaveBeenCalled();
    expect(container.querySelector('.mapas__manual .form-field__error').textContent)
      .toMatch(/Nome de camada de acompanhamento inválido/);
    cleanup();
  });

  test('aceita a forma válida e passa a mostrá-la no seletor', async () => {
    const { container, cleanup } = await montar();

    const campo = container.querySelector('.mapas__manual input');
    campo.value = 'lote_12_linha_4';
    container.querySelector('.mapas__manual button').click();
    await flush();

    expect(getMapaAcompanhamento).toHaveBeenLastCalledWith('lote_12_linha_4');
    expect(seletorDeCamada(container).value).toBe('lote_12_linha_4');
    cleanup();
  });
});
