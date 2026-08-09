import { describe, test, expect, beforeEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import {
  MODULOS, getModulo, modulosPortados, modulosAcessiveis,
  moduloDaRota, rotaInicial, primeiroModuloAcessivel,
  getRota, podeAbrirRota,
} from './registry.js';

const CATALOGO = [
  { code: 1, nome: 'Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Orçamento', nome_abrev: 'orcamento' },
  // `dominio.modulo` code 6, semeado em er/dominio.sql:367.
  { code: 6, nome: 'Equipamento', nome_abrev: 'equipamento' },
  // `dominio.modulo` code 7, o core de producao herdado do SAP 2.3.5, na 3.0.0.
  { code: 7, nome: 'Produção', nome_abrev: 'producao' },
];

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: CATALOGO }, 'x');
}

beforeEach(() => localStorage.clear());

describe('registry: manifestos', () => {
  test('os cinco modulos estao registrados, nesta ordem', () => {
    // A ORDEM E CONTEUDO, e nao arrumacao: quem tem perfil em mais de um modulo
    // entra pelo PRIMEIRO da lista (`primeiroModuloAcessivel`). Equipamento
    // entrou por ULTIMO na 1.46.0 pela mesma razao que PRODUCAO entra por
    // ultimo na 3.0.0: modulo novo nao vira a porta de entrada de quem ja
    // trabalha aqui.
    expect(MODULOS.map(m => m.id))
      .toEqual(['acervo', 'mapoteca', 'orcamento', 'equipamento', 'producao']);
  });

  test('o id do modulo casa com o nome_abrev do catalogo do servidor', () => {
    const abrevs = CATALOGO.map(m => m.nome_abrev);
    for (const modulo of MODULOS) {
      expect(abrevs).toContain(modulo.id);
    }
  });

  test('getModulo acha pelo id e devolve null no desconhecido', () => {
    expect(getModulo('orcamento').id).toBe('orcamento');
    expect(getModulo('pit')).toBeNull();
  });

  test('modulo esqueleto (sem rota) nao conta como portado', () => {
    // Generico de proposito: os modulos sao portados um a um, entao o teste
    // afere a REGRA (rotas vazias ficam de fora), nunca quem ja foi portado.
    const portados = modulosPortados().map(m => m.id);
    expect(portados).toContain('orcamento');
    for (const modulo of MODULOS) {
      const temRota = Array.isArray(modulo.rotas) && modulo.rotas.length > 0;
      expect(portados.includes(modulo.id)).toBe(temRota);
    }
  });
});

describe('registry: o que a pessoa ve', () => {
  test('so os modulos portados EM QUE ela tem perfil', () => {
    logar({ perfis: { orcamento: 1 } });
    expect(modulosAcessiveis().map(m => m.id)).toEqual(['orcamento']);
  });

  test('perfil em modulo sem rota registrada nao abre nada', () => {
    // Quem manda é a rota registrada, e não a linha de perfil. Um módulo sem
    // rota (esqueleto, ou nome que o registry não conhece) não abre tela.
    //
    // O caso não procura um esqueleto no MODULOS: quando não houvesse nenhum,
    // ele saía sem asserção nenhuma e passava sem provar coisa alguma.
    expect(MODULOS.map(m => m.id)).not.toContain('pit');
    logar({ perfis: { pit: 3 } });
    expect(modulosAcessiveis()).toEqual([]);
    expect(primeiroModuloAcessivel()).toBeNull();
  });

  test('sem perfil nenhum, nenhum modulo', () => {
    logar({ perfis: {} });
    expect(modulosAcessiveis()).toEqual([]);
  });

  test('administrador global ve todos os modulos PORTADOS', () => {
    logar({ administrador: true, perfis: {} });
    // Lista FIXA de propósito: comparar com `modulosPortados()` seria comparar
    // a função com ela mesma, e um módulo que sumisse dos dois lados passaria.
    expect(modulosAcessiveis().map(m => m.id))
      .toEqual(['acervo', 'mapoteca', 'orcamento', 'equipamento', 'producao']);
  });
});

describe('registry: rotas', () => {
  test('moduloDaRota le o primeiro segmento', () => {
    expect(moduloDaRota('/orcamento/dfd')).toBe('orcamento');
    expect(moduloDaRota('/orcamento/notas_empenho/3?x=1')).toBe('orcamento');
    expect(moduloDaRota('/acervo/dashboard')).toBe('acervo');
    // Rota de plataforma nao pertence a modulo nenhum
    expect(moduloDaRota('/usuarios')).toBeNull();
    expect(moduloDaRota('/login')).toBeNull();
    expect(moduloDaRota('/')).toBeNull();
  });

  test('rotaInicial monta prefixo + home do modulo', () => {
    expect(rotaInicial('orcamento')).toBe('/orcamento/dashboard');
    expect(rotaInicial(getModulo('orcamento'))).toBe('/orcamento/dashboard');
    expect(rotaInicial('inexistente')).toBe('/404');
  });

  test('a raiz aponta para o primeiro modulo acessivel', () => {
    logar({ perfis: { orcamento: 2 } });
    expect(rotaInicial(primeiroModuloAcessivel())).toBe('/orcamento/dashboard');
  });
});

describe('registry: podeAbrirRota espelha o guarda de index.js', () => {
  test('rota admin so abre para o administrador global', () => {
    logar({ perfis: { orcamento: 3 } });
    expect(podeAbrirRota('orcamento', '/configuracao')).toBe(false);

    logar({ administrador: true });
    expect(podeAbrirRota('orcamento', '/configuracao')).toBe(true);
  });

  test('rota de consulta abre para qualquer nivel do modulo', () => {
    logar({ perfis: { orcamento: 1 } });
    expect(podeAbrirRota('orcamento', '/dfd')).toBe(true);
  });

  // Nivel MINIMO (`perfil`) e o modelo do acervo e do orcamento: gerente satisfaz
  // operador, que satisfaz consulta.
  test('rota com nivel minimo respeita a hierarquia dentro do modulo', () => {
    logar({ perfis: { orcamento: 1 } });
    expect(podeAbrirRota('orcamento', '/dfd')).toBe(true);

    logar({ perfis: { orcamento: 3 } });
    expect(podeAbrirRota('orcamento', '/dfd')).toBe(true);
  });

  // CONJUNTO de perfis (`perfis`) e o modelo da MAPOTECA: la o
  // operador nao e "consulta com mais poder", e um papel com telas proprias. Com
  // nivel minimo ele veria clientes e pedidos, que e o que o chefe recusou.
  //
  // O EXEMPLO MUDOU DUAS VEZES, e a regra nao. O Dashboard e o Consumo eram a
  // prova de que a lista nao e hierarquica; o dashboard virou TERRENO COMUM (o
  // operador precisa ver a fila que vai atender), e em 2026-08-08 as telas de
  // material sairam da lista de vez: a tela unica de Insumos declara nivel
  // MINIMO, porque ali os tres perfis se ordenam de verdade. Quem prova a regra
  // agora sao Clientes, Pedidos e Plotters, que o operador continua sem ver
  // embora esteja um nivel acima de quem as ve.
  test('rota com CONJUNTO de perfis nao e hierarquica', () => {
    logar({ perfis: { mapoteca: 2 } });  // operador
    expect(podeAbrirRota('mapoteca', '/atendimento')).toBe(true);
    expect(podeAbrirRota('mapoteca', '/dashboard')).toBe(true);
    // E a tela de nivel minimo, que o operador alcanca justamente por estar
    // acima da consulta.
    expect(podeAbrirRota('mapoteca', '/insumos')).toBe(true);
    // O operador esta ACIMA da consulta e mesmo assim nao alcanca estas: e
    // exatamente isto que uma hierarquia nao consegue descrever.
    expect(podeAbrirRota('mapoteca', '/pedidos')).toBe(false);
    expect(podeAbrirRota('mapoteca', '/clientes')).toBe(false);
    expect(podeAbrirRota('mapoteca', '/plotters')).toBe(false);
    expect(podeAbrirRota('mapoteca', '/pedidos/novo')).toBe(false);

    logar({ perfis: { mapoteca: 1 } });  // consulta
    expect(podeAbrirRota('mapoteca', '/pedidos')).toBe(true);
    expect(podeAbrirRota('mapoteca', '/dashboard')).toBe(true);
    expect(podeAbrirRota('mapoteca', '/insumos')).toBe(true);
    // Ler os insumos, sim; atender o pedido, nao.
    expect(podeAbrirRota('mapoteca', '/atendimento')).toBe(false);

    logar({ perfis: { mapoteca: 3 } });  // gerente: executa E gerencia
    for (const rota of ['/dashboard', '/pedidos', '/pedidos/novo', '/atendimento', '/insumos']) {
      expect(podeAbrirRota('mapoteca', rota)).toBe(true);
    }
  });

  test('administrador global abre rota de conjunto sem ter linha de perfil', () => {
    logar({ perfis: {}, administrador: true });
    expect(podeAbrirRota('mapoteca', '/atendimento')).toBe(true);
    expect(podeAbrirRota('mapoteca', '/dashboard')).toBe(true);
  });

  test('perfil em OUTRO modulo nao abre a rota deste', () => {
    logar({ perfis: { acervo: 3 } });
    expect(podeAbrirRota('orcamento', '/dfd')).toBe(false);
  });

  test('caminho que nao e rota registrada fica para o guarda decidir', () => {
    logar({ perfis: { orcamento: 1 } });
    expect(getRota('orcamento', '/nao-existe')).toBeNull();
    expect(podeAbrirRota('orcamento', '/nao-existe')).toBe(true);
  });
});
