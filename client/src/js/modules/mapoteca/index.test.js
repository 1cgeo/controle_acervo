import { describe, test, expect } from 'vitest';
import mapoteca, { PERFIS_DA_LISTA_DE_PEDIDOS } from '@modules/mapoteca/index.js';
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

  test('as 9 telas estao registradas, cada uma com render e perfil', () => {
    // O RPCMTec não é tela da mapoteca: o relatório é da Divisão inteira, e
    // este módulo gerava só a metade dele. Ele é rota de plataforma
    // (#/rpcmtec), fora desta contagem.
    //
    // Eram 13 até 2026-08-08: as três telas de material (`/materiais`,
    // `/materiais/:id`, `/estoque` e `/consumo`) viraram duas (`/insumos` e
    // `/insumos/:id`).
    //
    // E eram 11 até 2026-08-13: `/plotters` e `/plotters/:id` sairam, porque o
    // plotter é bem do módulo Equipamento e a tabela que elas liam estava vazia
    // na produção.
    expect(mapoteca.rotas).toHaveLength(9);
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

  // O perfil de OPERADOR da mapoteca tem TRES telas por LISTA: o dashboard,
  // atender pedidos e a ficha do insumo -- esta ultima por NIVEL MINIMO, e por
  // isso fora deste caso. O perfil na rota tambem decide o menu, pelo
  // registry.podeAbrirRota, entao este campo e o que esconde o item de quem so
  // consulta.
  test('as telas de operador POR LISTA sao dashboard e atendimento', () => {
    const deOperador = mapoteca.rotas
      .filter(r => (r.perfis || []).includes('operador'))
      .map(r => r.path)
      .sort();
    expect(deOperador).toEqual(['/atendimento', '/dashboard']);

    const menu = mapoteca.menu.find(i => i.path === '/atendimento');
    expect(menu.label).toBe('Atender pedidos');
    // A restricao NAO se repete no item de menu: repetir a mao foi o que deixou o
    // item "Configuracao" do orcamento visivel para todo mundo.
    expect(menu.perfil).toBeUndefined();
  });

  // O dashboard e dos TRES perfis: quem atende o pedido precisa ver a fila e o
  // que esta pendente.
  test('o dashboard abre para os tres perfis do modulo', () => {
    const perfisDe = (path) => mapoteca.rotas.find(r => r.path === path).perfis;
    expect(perfisDe('/dashboard')).toEqual(['consulta', 'operador', 'gerente']);
    // O que NAO mudou: cliente e pedido seguem sem operador, e o atendimento
    // segue sem consulta.
    expect(perfisDe('/clientes')).toEqual(['consulta', 'gerente']);
    expect(perfisDe('/pedidos')).toEqual(['consulta', 'gerente']);
    expect(perfisDe('/atendimento')).toEqual(['operador', 'gerente']);
  });

  // AS TELAS SO OFERECEM O QUE A ROTA ACEITA.
  //
  // A fila de atendimento e do operador e do gerente, e o dashboard e dos tres
  // perfis; as duas levam para '/pedidos', '/pedidos/:id' e '/clientes/:id', que
  // sao de consulta e gerente. Para o operador aqueles caminhos terminavam em
  // '#/unauthorized'. As telas passaram a esconde-los de quem nao os abre, e a
  // lista que elas usam para decidir e esta. Divergir em silencio devolveria o
  // link morto ou esconderia o link de quem pode.
  test('o recorte que as telas usam e o mesmo das rotas de leitura', () => {
    const daRota = mapoteca.rotas.find(r => r.path === '/pedidos').perfis;
    expect(PERFIS_DA_LISTA_DE_PEDIDOS).toEqual(daRota);
    // As quatro rotas para as quais ha link no atendimento e no dashboard.
    for (const path of ['/pedidos/:id', '/clientes', '/clientes/:id']) {
      expect(mapoteca.rotas.find(r => r.path === path).perfis).toEqual(daRota);
    }
    // E a prova de que o operador esta MESMO fora: sem isto o teste passaria
    // igual num dia em que a rota o incluisse e a tela deixasse de esconder.
    expect(PERFIS_DA_LISTA_DE_PEDIDOS).not.toContain('operador');
  });

  // A LISTA NAO HIERARQUICA MORREU NA TELA DE MATERIAL, em 2026-08-08.
  //
  // `perfis: ['consulta','gerente']` PULAVA o operador, e existia porque a tela
  // era cadastro. Com a tela unica do livro, o operador e justamente quem mais a
  // usa: e ele que consome, transfere e conta a prateleira. `perfil` (nivel
  // MINIMO) e o que devolve o operador para dentro.
  test('/insumos declara nivel MINIMO, e nao lista de perfis', () => {
    for (const path of ['/insumos', '/insumos/:id']) {
      const rota = mapoteca.rotas.find(r => r.path === path);
      expect(rota.perfil).toBe('consulta');
      expect(rota.perfis).toBeUndefined();
    }
  });

  // As tres telas de material sumiram, e nenhuma rota antiga sobrou para cair em
  // 404 pelo bookmark de quem ja usava.
  test('as rotas velhas de material nao existem mais', () => {
    const caminhos = mapoteca.rotas.map(r => r.path);
    for (const morta of ['/materiais', '/materiais/:id', '/estoque', '/consumo']) {
      expect(caminhos).not.toContain(morta);
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

  // A ordem do menu e decisao do chefe, nao acidente de edicao: Dashboard abre,
  // Atender pedidos vem logo depois, e Insumos fecha, onde o trio de material
  // ficava. Sem este teste, um item novo inserido no meio da lista desfaz a
  // ordem sem ninguem notar.
  //
  // PLOTTERS ERA O SEXTO, e saiu em 2026-08-13: o plotter e bem do modulo
  // Equipamento, e a tabela que a tela lia estava vazia na producao.
  test('a ordem do menu e a que o chefe pediu, do Dashboard aos Insumos', () => {
    expect(mapoteca.menu.map(i => i.id)).toEqual([
      'dashboard', 'atendimento', 'clientes', 'pedidos', 'insumos',
    ]);
    // Produtos avulsos nao e categoria de pedido: mora DENTRO de Pedidos.
    expect(mapoteca.menu.map(i => i.id)).not.toContain('avulsos');
  });

  // UM ITEM DE MATERIAL, E NAO TRES. "Tipos de Material", "Estoque" e "Consumo
  // de material" eram tres entradas para a mesma pergunta, e quem quisesse a
  // resposta inteira atravessava as tres. Este teste guarda a fusao: um item
  // novo de material aqui e a volta do problema, nao uma adicao.
  test('o menu tem UM item de material, e ele se chama Insumos', () => {
    const deMaterial = mapoteca.menu.filter(i => /insumo|material|estoque|consumo/i.test(i.label));
    expect(deMaterial.map(i => i.label)).toEqual(['Insumos']);
    expect(deMaterial[0].path).toBe('/insumos');
  });

  // NAO existe "pedido avulso", nem tela de produto avulso. O que existe e um
  // ITEM cujo produto nao vem do acervo, descrito no proprio item, dentro da
  // tela do pedido. Pedidos e item solto, sem grupo.
  test('Pedidos e item solto: nao ha grupo nem tela de produto avulso', () => {
    expect(mapoteca.menu.find(i => i.id === 'pedidos-group')).toBeUndefined();
    const pedidos = mapoteca.menu.find(i => i.id === 'pedidos');
    expect(pedidos.path).toBe('/pedidos');
    expect(pedidos.children).toBeUndefined();
    expect(mapoteca.rotas.some(r => r.path.includes('avulso'))).toBe(false);
  });

  // O menu e PLANO. O grupo colapsavel "Materiais" saiu porque cobrava um clique
  // a mais para chegar a uma tela que ja cabia na lista, e o sidebar nem sabe
  // mais abrir grupo: um `children` esquecido aqui viraria item mudo.
  test('nenhum item de menu tem children: o menu e plano', () => {
    expect(mapoteca.menu.find(i => i.id === 'materiais-group')).toBeUndefined();
    for (const item of mapoteca.menu) {
      expect(item.children, `item ${item.id} ainda tem children`).toBeUndefined();
      expect(item.path, `item ${item.id} sem path`).toBeTruthy();
    }
  });

  test('todo item de menu aponta para uma rota registrada', () => {
    const caminhos = new Set(mapoteca.rotas.map(r => r.path));
    for (const item of mapoteca.menu) {
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
