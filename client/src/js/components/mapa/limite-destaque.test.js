import { describe, test, expect, vi } from 'vitest';

/**
 * Destaque do lugar filtrado.
 *
 * O módulo é compartilhado pela busca do acervo e pelo ponto de controle, e as
 * duas telas testam o mapa por dublê: sem estas provas, o destaque ficaria sem
 * nenhuma. O que elas guardam é o contrato que as duas passaram a depender.
 */

import { criarDestaqueDeLimite } from './limite-destaque.js';

const LIMITE = {
  tipo: 'estado',
  id: 43,
  nome: 'Rio Grande do Sul',
  bbox: [-57.6, -33.7, -49.6, -27.0],
  geometria: {
    type: 'Polygon',
    coordinates: [[[-57.6, -33.7], [-49.6, -33.7], [-49.6, -27], [-57.6, -27], [-57.6, -33.7]]],
  },
};

function mapaFalso() {
  const estado = { fontes: {}, camadas: [], dados: null, enquadrado: null };
  const mapa = {
    addSource: vi.fn((nome, opcoes) => { estado.fontes[nome] = opcoes; }),
    addLayer: vi.fn(l => estado.camadas.push(l)),
    getSource: vi.fn(() => ({ setData: vi.fn(d => { estado.dados = d; }) })),
    fitBounds: vi.fn((caixa, opcoes) => { estado.enquadrado = { caixa, opcoes }; }),
  };
  return { mapa, estado };
}

const feicoes = (estado) => (estado.dados ? estado.dados.features : null);

describe('destaque de limite', () => {
  test('monta uma fonte e UMA camada, de linha', () => {
    const { mapa, estado } = mapaFalso();
    criarDestaqueDeLimite().montar(mapa);

    expect(Object.keys(estado.fontes)).toHaveLength(1);
    expect(estado.camadas).toHaveLength(1);
    // Só a borda, sem preenchimento (chefe): uma mancha por cima competiria com
    // o produto e com o ponto, que são o conteúdo do mapa.
    expect(estado.camadas[0].type).toBe('line');
    expect(estado.camadas[0].paint['line-color']).toBe('#d32f2f');
  });

  test('mostrar pinta o contorno e enquadra a caixa', () => {
    const { mapa, estado } = mapaFalso();
    const destaque = criarDestaqueDeLimite();
    destaque.montar(mapa);

    destaque.mostrar(LIMITE);

    expect(feicoes(estado)).toHaveLength(1);
    expect(feicoes(estado)[0].geometry).toEqual(LIMITE.geometria);
    // A caixa vira dois cantos, na ordem que o MapLibre espera. Trocar a ordem
    // manda a câmera para o outro lado do mundo, sem erro nenhum.
    expect(estado.enquadrado.caixa).toEqual([[-57.6, -33.7], [-49.6, -27.0]]);
  });

  test('`enquadrar: false` pinta a borda e deixa a câmera onde está', () => {
    const { mapa, estado } = mapaFalso();
    const destaque = criarDestaqueDeLimite();
    destaque.montar(mapa);

    destaque.mostrar(LIMITE, { enquadrar: false });

    expect(feicoes(estado)).toHaveLength(1);
    // É o caso do link que já trouxe área desenhada: mover a câmera jogaria o
    // recorte que a pessoa mandou para fora da tela.
    expect(mapa.fitBounds).not.toHaveBeenCalled();
  });

  test('o limite que chega ANTES do mapa carregar não se perde', () => {
    const { mapa, estado } = mapaFalso();
    const destaque = criarDestaqueDeLimite();

    // A geometria vem da API, e a resposta pode chegar antes do evento `load`.
    // Sem a espera, o destaque do lugar que veio no link sumiria em silêncio.
    destaque.mostrar(LIMITE);
    expect(destaque.montado()).toBe(false);

    destaque.montar(mapa);
    expect(feicoes(estado)).toHaveLength(1);
    expect(estado.enquadrado).not.toBeNull();
  });

  test('limpar apaga a borda e NÃO mexe na câmera', () => {
    const { mapa, estado } = mapaFalso();
    const destaque = criarDestaqueDeLimite();
    destaque.montar(mapa);
    destaque.mostrar(LIMITE);
    mapa.fitBounds.mockClear();

    destaque.limpar();

    expect(feicoes(estado)).toHaveLength(0);
    // Tirar o filtro não é pedir zoom: devolver a câmera para algum lugar seria
    // um movimento que ninguém pediu.
    expect(mapa.fitBounds).not.toHaveBeenCalled();
  });

  test('limpar antes de montar cancela o que estava esperando', () => {
    const { mapa, estado } = mapaFalso();
    const destaque = criarDestaqueDeLimite();

    destaque.mostrar(LIMITE);
    destaque.limpar();
    destaque.montar(mapa);

    // Trocar o filtro enquanto o mapa ainda carrega: sem isto, o lugar
    // abandonado apareceria pintado assim que o mapa ficasse pronto. Nada foi
    // pintado, nem sequer a coleção vazia.
    expect(estado.dados).toBeNull();
    expect(mapa.fitBounds).not.toHaveBeenCalled();
  });

  test('resposta sem geometria não apaga o que está na tela', () => {
    const { mapa, estado } = mapaFalso();
    const destaque = criarDestaqueDeLimite();
    destaque.montar(mapa);
    destaque.mostrar(LIMITE);

    destaque.mostrar(null);
    destaque.mostrar({ bbox: [1, 2, 3, 4] });

    expect(feicoes(estado)).toHaveLength(1);
  });
});
