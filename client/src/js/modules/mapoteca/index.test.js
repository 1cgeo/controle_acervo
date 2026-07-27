import { describe, test, expect } from 'vitest';
import mapoteca from '@modules/mapoteca/index.js';
import { getModulo, modulosPortados, rotaInicial } from '@modules/registry.js';
import { mockMapotecaService } from '@modules/mapoteca/services/service-mocks.js';
import * as servicoReal from '@modules/mapoteca/services/mapoteca-service.js';

describe('manifesto do modulo mapoteca', () => {
  test('o id casa com o nome_abrev do servidor e com o prefixo da rota', () => {
    expect(mapoteca.id).toBe('mapoteca');
    expect(mapoteca.home).toBe('/dashboard');
    expect(rotaInicial('mapoteca')).toBe('/mapoteca/dashboard');
  });

  test('o registry ja conta a mapoteca como portada', () => {
    expect(getModulo('mapoteca')).toBe(mapoteca);
    expect(modulosPortados().map(m => m.id)).toContain('mapoteca');
  });

  test('as 14 telas estao registradas, cada uma com render e perfil', () => {
    expect(mapoteca.rotas).toHaveLength(14);
    for (const rota of mapoteca.rotas) {
      expect(rota.path.startsWith('/')).toBe(true);
      expect(typeof rota.render).toBe('function');
      expect(rota.perfil || (rota.admin ? 'admin' : null)).toBeTruthy();
    }
  });

  test('a rota estatica /pedidos/novo vem ANTES de /pedidos/:id', () => {
    // O router casa a primeira rota com o mesmo numero de segmentos. Invertida,
    // a ordem manda o wizard para o detalhe de um pedido chamado 'novo'.
    const caminhos = mapoteca.rotas.map(r => r.path);
    expect(caminhos.indexOf('/pedidos/novo')).toBeLessThan(caminhos.indexOf('/pedidos/:id'));
  });

  test('nenhuma rota repete caminho', () => {
    const caminhos = mapoteca.rotas.map(r => r.path);
    expect(new Set(caminhos).size).toBe(caminhos.length);
  });

  test('a consulta publica NAO e rota do modulo', () => {
    // Ela nao tem sessao, entao mora nas rotas de plataforma de src/js/index.js.
    const caminhos = mapoteca.rotas.map(r => r.path);
    expect(caminhos.some(p => p.includes('consultar'))).toBe(false);
  });

  test('usuarios NAO e rota do modulo: a tela unica e da plataforma', () => {
    const caminhos = mapoteca.rotas.map(r => r.path);
    expect(caminhos).not.toContain('/usuarios');
    expect(JSON.stringify(mapoteca.menu)).not.toContain('/usuarios');
  });

  test('todo item de menu aponta para uma rota registrada', () => {
    const caminhos = new Set(mapoteca.rotas.map(r => r.path));
    const itens = mapoteca.menu.flatMap(i => (i.children ? i.children : [i]));
    for (const item of itens) {
      expect(item.icon, `item ${item.id} sem icone`).toBeTruthy();
      expect(caminhos.has(item.path), `menu aponta para ${item.path}, que nao e rota`).toBe(true);
    }
  });
});

describe('mock do service acompanha o service', () => {
  test('a fabrica de mock cobre TODA funcao exportada', () => {
    // Sem isto, uma funcao nova no service quebraria os testes de pagina com
    // "No X export is defined on the mock", longe da causa.
    const mock = mockMapotecaService();
    const faltando = Object.keys(servicoReal).filter(nome => !(nome in mock));
    expect(faltando).toEqual([]);
  });
});
