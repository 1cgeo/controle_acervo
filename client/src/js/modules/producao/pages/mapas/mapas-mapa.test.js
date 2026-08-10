import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { logarComo, CONSULTA } from '@/__tests__/helpers/sessao.js';

// O MAPA DOS ACOMPANHAMENTOS.
//
// O que estes casos prendem:
//  - a SITUAÇÃO da folha sai de colunas DINÂMICAS (`f_1_preparo_data_inicio`,
//    `f_2_extracao_data_fim`, ...), que mudam quando a linha de produção ganha
//    fase. Uma lista fixa de fases deixaria a fase nova invisível SEM ERRO;
//  - a fase PULADA vem com `'-'` nas duas datas, e não conta. Tratá-la como
//    pendente deixaria eternamente "em execução" toda folha que pula uma fase,
//    que é a maioria delas;
//  - a URL da tile leva um token na QUERY, e é a única do sistema que faz isso:
//    o MapLibre monta o pedido dentro do renderizador, onde não há cabeçalho.
//    O token dali NÃO é o da sessão desde 2026-08-09: é um token de audiência
//    `tile`, pedido a `POST /login/tile`, de vida curta e que nenhuma outra
//    guarda aceita. O bearer da sessão ficava escrito em `logs/combined.log`, que
//    a rota aberta `/logs` publica;
//  - montar a camada de tiles virou ASSÍNCRONO por causa disso, e duas coisas
//    passaram a poder acontecer no meio: trocar de linha de produção (quem chega
//    depois manda) e o token vencer (a fonte se refaz sozinha, uma vez por
//    minuto no máximo, antes de a tela acusar falha);
//  - o `source-layer` é contrato do servidor (`ST_AsMVT(q, 'linha_producao_<id>')`)
//    e errá-lo NÃO dá erro: a camada simplesmente não desenha;
//  - trocar de linha de produção REFAZ a fonte. Nenhum MapLibre troca a URL de
//    uma fonte viva, e escondê-la deixaria a antiga buscando tiles de uma linha
//    que já saiu da tela.

// O dublê da casa não tem `getLayer`, `removeLayer` nem `removeSource`, e
// guarda só o `data` da fonte. Esta subclasse acrescenta o que a troca de
// camada de tiles exige, sem tocar no dublê compartilhado.
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

// A CREDENCIAL DA TILE VEM DO SERVIDOR, e o serviço a pede por `apiPost`. O
// dublê guarda cada pedido: contar as chamadas é como se prova que a renovação
// aconteceu, e que ela acontece UMA vez por rajada de erro.
const api = vi.hoisted(() => ({
  chamadas: [],
  token: 'tk-tile-1',
  erro: null,
}));

vi.mock('@services/api-client.js', () => ({
  apiGet: () => Promise.resolve(null),
  apiPost: (endpoint) => {
    api.chamadas.push(endpoint);
    if (api.erro) return Promise.reject(api.erro);
    return Promise.resolve({ token: api.token });
  },
}));

import { instanciasMapa } from '@components/mapa/maplibre-stub.js';
import { urlTileLinhaProducao, camadaDaTile } from '@services/producao-service.js';
import { criarMapaAcompanhamento, situacaoDaFeicao, fasesDaFeicao } from './mapas-mapa.js';

const FEICAO_CONCLUIDA = {
  id: 1, nome: 'Santa Maria', mi: '2965-1',
  f_1_preparo_data_inicio: '2026-01-05', f_1_preparo_data_fim: '2026-01-20',
  f_2_extracao_data_inicio: '2026-02-01', f_2_extracao_data_fim: '2026-03-10',
};

const FEICAO_EM_EXECUCAO = {
  id: 2, nome: 'Rosário',
  f_1_preparo_data_inicio: '2026-01-05', f_1_preparo_data_fim: '2026-01-20',
  f_2_extracao_data_inicio: '2026-02-01', f_2_extracao_data_fim: null,
};

const FEICAO_NAO_INICIADA = {
  id: 3, nome: 'Cacequi',
  f_1_preparo_data_inicio: null, f_1_preparo_data_fim: null,
  f_2_extracao_data_inicio: null, f_2_extracao_data_fim: null,
};

// A folha que PULA a validação: as duas datas dela vêm com o traço do gerador.
const FEICAO_COM_FASE_PULADA = {
  id: 4, nome: 'Uruguaiana',
  f_1_preparo_data_inicio: '2026-01-05', f_1_preparo_data_fim: '2026-01-20',
  f_2_validacao_data_inicio: '-', f_2_validacao_data_fim: '-',
};

describe('fasesDaFeicao: as colunas são dinâmicas', () => {
  test('descobre as fases pelas chaves, na ordem do número', () => {
    const fases = fasesDaFeicao(FEICAO_CONCLUIDA);
    expect(fases.map(f => f.nome)).toEqual(['preparo', 'extracao']);
    expect(fases[1].fim).toBe('2026-03-10');
  });

  test('ignora as colunas que não são de fase', () => {
    expect(fasesDaFeicao({ nome: 'x', mi: 'y', escala: '25' })).toEqual([]);
  });

  test('marca a fase pulada', () => {
    const fases = fasesDaFeicao(FEICAO_COM_FASE_PULADA);
    expect(fases.find(f => f.nome === 'validacao').pulada).toBe(true);
    expect(fases.find(f => f.nome === 'preparo').pulada).toBe(false);
  });
});

describe('situacaoDaFeicao', () => {
  test('todas as fases fechadas: concluída', () => {
    expect(situacaoDaFeicao(FEICAO_CONCLUIDA)).toBe('concluido');
  });

  test('alguma fase aberta: em execução', () => {
    expect(situacaoDaFeicao(FEICAO_EM_EXECUCAO)).toBe('em_execucao');
  });

  test('nenhuma fase começada: não iniciada', () => {
    expect(situacaoDaFeicao(FEICAO_NAO_INICIADA)).toBe('nao_iniciado');
  });

  // O CASO QUE DECIDE A COR DA MAIORIA DAS FOLHAS.
  test('a fase pulada não segura a folha em execução', () => {
    expect(situacaoDaFeicao(FEICAO_COM_FASE_PULADA)).toBe('concluido');
  });

  test('feição sem coluna de fase nenhuma se declara sem fase', () => {
    expect(situacaoDaFeicao({ nome: 'x' })).toBe('sem_fase');
  });
});

describe('a URL da tile', () => {
  beforeEach(() => {
    logarComo({ producao: CONSULTA });
    api.chamadas = [];
    api.token = 'tk-tile-1';
    api.erro = null;
  });

  // A ÚNICA URL DO SISTEMA COM TOKEN NA QUERY, e ela existe porque uma camada
  // XYZ não tem onde pôr cabeçalho.
  test('leva o token na query e deixa {z}/{x}/{y} para o MapLibre', async () => {
    const url = await urlTileLinhaProducao(7);
    expect(url).toBe('/api/acompanhamento/linha_producao/7/{z}/{x}/{y}.pbf?token=tk-tile-1');
  });

  // O CASO QUE DÁ NOME AO CONSERTO. O token da sessão ('tk-teste', o que
  // `logarComo` guardou) abre TODAS as guardas e vive oito horas; ele ia inteiro
  // para a URL, e dali para o `logs/combined.log` que a rota aberta `/logs`
  // publica.
  test('NÃO leva o token da sessão: pede um token de tile ao servidor', async () => {
    const url = await urlTileLinhaProducao(7);

    expect(url).not.toContain('tk-teste');
    expect(api.chamadas).toEqual(['/login/tile']);
  });

  test('o nome da camada dentro da tile é o contrato do servidor', () => {
    expect(camadaDaTile(7)).toBe('linha_producao_7');
  });
});

describe('o componente do mapa', () => {
  beforeEach(() => {
    logarComo({ producao: CONSULTA });
    instanciasMapa.length = 0;
    api.chamadas = [];
    api.token = 'tk-tile-1';
    api.erro = null;
  });

  async function montarMapa() {
    const mapa = criarMapaAcompanhamento();
    document.body.appendChild(mapa.element);
    await mapa.iniciar();
    await flush();
    return { mapa, instancia: instanciasMapa[instanciasMapa.length - 1] };
  }

  test('as feições chegam ao mapa com a situação calculada', async () => {
    const { mapa, instancia } = await montarMapa();

    mapa.setFeicoes({
      type: 'FeatureCollection',
      features: [
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-54, -30], [-53, -30], [-53, -29], [-54, -30]]] }, properties: FEICAO_CONCLUIDA },
        { type: 'Feature', geometry: { type: 'Polygon', coordinates: [[[-54, -30], [-53, -30], [-53, -29], [-54, -30]]] }, properties: FEICAO_EM_EXECUCAO },
      ],
    });

    const dados = instancia.getSource('acompanhamento').dados;
    expect(dados.features.map(f => f.properties.situacao_acompanhamento))
      .toEqual(['concluido', 'em_execucao']);
    mapa._cleanup();
  });

  // O `await flush()` DEPOIS DO setTile é a parte nova: a camada só entra quando
  // o token de tile chega do servidor.
  test('a camada de tiles entra com a URL do token e o source-layer certo', async () => {
    const { mapa, instancia } = await montarMapa();

    mapa.setTile(2);
    await flush();

    expect(instancia.configs['linha-producao-tile'].tiles).toEqual([
      '/api/acompanhamento/linha_producao/2/{z}/{x}/{y}.pbf?token=tk-tile-1',
    ]);
    expect(instancia.camadas['linha-producao-contorno']['source-layer'])
      .toBe('linha_producao_2');
    mapa._cleanup();
  });

  test('trocar de linha de produção REFAZ a fonte, e não acumula duas', async () => {
    const { mapa, instancia } = await montarMapa();

    mapa.setTile(2);
    await flush();
    mapa.setTile(5);
    await flush();

    expect(instancia.configs['linha-producao-tile'].tiles[0]).toContain('/linha_producao/5/');
    expect(instancia.camadas['linha-producao-contorno']['source-layer'])
      .toBe('linha_producao_5');
    mapa._cleanup();
  });

  // A CORRIDA QUE A BUSCA DO TOKEN CRIOU: duas trocas antes de a primeira
  // resposta chegar. Sem a conferência de `linhaTile` depois do `await`, a
  // camada montada seria a da resposta que chegasse por último, e não a da linha
  // que está na tela.
  test('duas trocas seguidas montam a ÚLTIMA linha, e só ela', async () => {
    const { mapa, instancia } = await montarMapa();

    mapa.setTile(2);
    mapa.setTile(5);
    await flush();

    expect(instancia.configs['linha-producao-tile'].tiles[0]).toContain('/linha_producao/5/');
    expect(instancia.camadas['linha-producao-contorno']['source-layer'])
      .toBe('linha_producao_5');
    mapa._cleanup();
  });

  test('desligar a tile tira a camada e a fonte', async () => {
    const { mapa, instancia } = await montarMapa();

    mapa.setTile(2);
    await flush();
    mapa.setTile(null);
    await flush();

    expect(instancia.getSource('linha-producao-tile')).toBeUndefined();
    expect(instancia.camadas['linha-producao-contorno']).toBeUndefined();
    mapa._cleanup();
  });

  // A CREDENCIAL É OUTRA ROTA, e a falha dela fica na tile: a camada de situação
  // e o resto da tela não dependem dela.
  test('sem credencial de tile, o aviso é da tile e a tela continua de pé', async () => {
    const { mapa, instancia } = await montarMapa();
    api.erro = new Error('Sessão expirada. Faça login novamente.');

    mapa.setTile(2);
    await flush();

    const aviso = mapa.element.querySelector('.producao-mapa__aviso');
    expect(aviso.classList.contains('hidden')).toBe(false);
    expect(aviso.textContent).toMatch(/credencial dos tiles/);
    expect(instancia.getSource('linha-producao-tile')).toBeUndefined();
    mapa._cleanup();
  });

  // A FALHA DA TILE FICA NA TILE. O fundo do OSM vem da internet e cai nesta
  // rede: sem o filtro por `sourceId`, a queda dele seria anunciada como
  // problema da produção.
  test('o erro do fundo não vira aviso da produção', async () => {
    const { mapa, instancia } = await montarMapa();

    instancia.emitir('error', { sourceId: 'osm', error: new Error('sem internet') });
    expect(mapa.element.querySelector('.producao-mapa__aviso').classList.contains('hidden')).toBe(true);

    instancia.emitir('error', { sourceId: 'linha-producao-tile', error: new Error('401') });
    const aviso = mapa.element.querySelector('.producao-mapa__aviso');
    expect(aviso.classList.contains('hidden')).toBe(false);
    expect(aviso.textContent).toMatch(/tiles da linha de produção/);
    mapa._cleanup();
  });

  // O TOKEN DA TILE VENCE COM O MAPA ABERTO, e é para isso que ele é curto. Sem
  // esta renovação, passar do prazo obrigaria a recarregar a página no meio de
  // uma consulta.
  test('a tile recusada depois do prazo renova o token, e não acusa falha', async () => {
    const { mapa, instancia } = await montarMapa();

    mapa.setTile(2);
    await flush();
    expect(api.chamadas).toEqual(['/login/tile']);

    // Mais de um minuto depois da montagem, que é a trava contra o laço.
    const relogio = vi.spyOn(Date, 'now').mockReturnValue(Date.now() + 61000);
    api.token = 'tk-tile-2';

    // A RAJADA: o MapLibre dispara um erro por tile que falha, e as três viram
    // UMA renovação.
    instancia.emitir('error', { sourceId: 'linha-producao-tile', error: new Error('401') });
    instancia.emitir('error', { sourceId: 'linha-producao-tile', error: new Error('401') });
    instancia.emitir('error', { sourceId: 'linha-producao-tile', error: new Error('401') });
    await flush();

    expect(api.chamadas).toEqual(['/login/tile', '/login/tile']);
    expect(instancia.configs['linha-producao-tile'].tiles[0]).toContain('tk-tile-2');
    expect(mapa.element.querySelector('.producao-mapa__aviso').classList.contains('hidden'))
      .toBe(true);

    // E A FONTE QUEBRADA DE VERDADE AINDA ACUSA: o erro seguinte chega com o
    // token recém-nascido, então ele não é prazo vencido, e vira aviso.
    instancia.emitir('error', { sourceId: 'linha-producao-tile', error: new Error('500') });
    await flush();

    expect(api.chamadas).toHaveLength(2);
    const aviso = mapa.element.querySelector('.producao-mapa__aviso');
    expect(aviso.classList.contains('hidden')).toBe(false);
    expect(aviso.textContent).toMatch(/tiles da linha de produção/);

    relogio.mockRestore();
    mapa._cleanup();
  });
});
