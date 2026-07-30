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

  test('as 15 telas estao registradas, cada uma com render e perfil', () => {
    // 13 ate 2026-07-30, quando entrou a tela de atendimento (a fila de pedidos);
    // 15 no mesmo dia, com a tela de produtos avulsos (o que a mapoteca imprime
    // sem ser do acervo).
    expect(mapoteca.rotas).toHaveLength(15);
    for (const rota of mapoteca.rotas) {
      expect(rota.path.startsWith('/')).toBe(true);
      expect(typeof rota.render).toBe('function');
      // Toda rota diz quem entra: conjunto (`perfis`), nivel minimo (`perfil`) ou
      // `admin`. Rota sem nenhum dos tres cairia no default 'consulta' sem que
      // ninguem tivesse decidido isso.
      const quemEntra = rota.perfis || rota.perfil || (rota.admin ? 'admin' : null);
      expect(quemEntra).toBeTruthy();
    }
  });

  // O perfil de OPERADOR da mapoteca tem DUAS telas (chefe, 2026-07-30): atender
  // pedidos e consumo de material. As duas sao execucao; o resto do modulo e
  // consulta (ou gerente, no caso do wizard). O perfil na rota tambem decide o
  // menu, pelo registry.podeAbrirRota, entao este campo e o que esconde o item de
  // quem so consulta.
  test('as telas de operador sao exatamente atendimento e consumo', () => {
    const deOperador = mapoteca.rotas
      .filter(r => (r.perfis || []).includes('operador'))
      .map(r => r.path)
      .sort();
    expect(deOperador).toEqual(['/atendimento', '/consumo']);

    // E o operador NAO entra em mais nada: o resto do modulo e leitura, e o
    // conjunto (em vez de nivel minimo) e o que faz isso valer.
    const semOperador = mapoteca.rotas.filter(r => !(r.perfis || []).includes('operador'));
    expect(semOperador).toHaveLength(13);
    for (const rota of semOperador) {
      expect(rota.perfis).not.toContain('operador');
    }

    const menu = mapoteca.menu.find(i => i.path === '/atendimento');
    expect(menu.label).toBe('Atender pedidos');
    // A restricao NAO se repete no item de menu: repetir a mao foi o que deixou o
    // item "Configuracao" do orcamento visivel para todo mundo.
    expect(menu.perfil).toBeUndefined();
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
