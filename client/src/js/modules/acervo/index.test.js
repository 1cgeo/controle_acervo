import { describe, test, expect, beforeEach } from 'vitest';
import { saveAuth, clearAuth } from '@store/auth-store.js';
import { perfilLoader, adminLoader } from '@js/router.js';
import {
  getModulo, modulosPortados, modulosAcessiveis, rotaInicial, podeAbrirRota,
} from '@modules/registry.js';
import acervo from './index.js';

const CATALOGO = [
  { code: 1, nome: 'Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Orçamento', nome_abrev: 'orcamento' },
];

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: CATALOGO }, 'x');
}

beforeEach(() => {
  localStorage.clear();
  location.hash = '';
});

describe('manifesto do modulo acervo', () => {
  test('o id casa com o nome_abrev do servidor e a home aponta para o dashboard', () => {
    expect(acervo.id).toBe('acervo');
    expect(acervo.home).toBe('/dashboard');
    expect(rotaInicial('acervo')).toBe('/acervo/dashboard');
  });

  test('registra as telas do modulo, com render assincrono', () => {
    expect(acervo.rotas.map(r => r.path)).toEqual([
      '/dashboard', '/busca', '/ponto_controle', '/administracao', '/auditoria',
    ]);
    for (const rota of acervo.rotas) {
      expect(typeof rota.render).toBe('function');
    }
  });

  test('o menu leva as telas do modulo, sem repetir a tela de usuarios da plataforma', () => {
    expect(acervo.menu.map(i => i.path)).toEqual([
      '/dashboard', '/busca', '/ponto_controle', '/administracao', '/auditoria',
    ]);
    expect(acervo.menu.some(i => i.path === '/usuarios')).toBe(false);
  });

  test('todo item de menu tem icone, senao a barra lateral mostra um buraco', () => {
    for (const item of acervo.menu) {
      expect(typeof item.icon).toBe('string');
      expect(item.icon.length).toBeGreaterThan(0);
    }
  });

  test('cada item de menu aponta para uma rota que existe', () => {
    const rotas = new Set(acervo.rotas.map(r => r.path));
    for (const item of acervo.menu) {
      expect(rotas.has(item.path)).toBe(true);
    }
  });

  test('o registry passa a contar o acervo como portado', () => {
    expect(getModulo('acervo')).toBe(acervo);
    expect(modulosPortados().map(m => m.id)).toContain('acervo');
  });
});

describe('guardas das rotas do acervo', () => {
  // O modulo se guarda por PERFIL, com UMA excecao: a Administracao, que o chefe
  // passou para o administrador global. Toda rota diz quem entra por um dos dois
  // campos, e nenhuma fica sem dizer.
  test('toda rota se guarda por perfil no ACERVO, salvo a Administracao', () => {
    for (const rota of acervo.rotas) {
      if (rota.path === '/administracao') {
        expect(rota.admin).toBe(true);
        expect(rota.perfil).toBeUndefined();
        continue;
      }
      expect(rota.admin).toBeUndefined();
      expect(['consulta', 'operador', 'gerente']).toContain(rota.perfil);
    }
  });

  // O nivel de cada tela de ESCRITA fica pinado: ele espelha o verifyPerfil da
  // rota correspondente no servidor, e afrouxa-lo aqui abriria uma tela que so
  // sabe mostrar 403. A auditoria e gerente porque GET /api/acervo/auditoria e
  // gerente.
  test('as telas de escrita pedem o nivel que o servidor cobra', () => {
    const nivel = p => acervo.rotas.find(r => r.path === p).perfil;
    expect(nivel('/auditoria')).toBe('gerente');
    expect(nivel('/dashboard')).toBe('consulta');
    expect(nivel('/busca')).toBe('consulta');
    expect(nivel('/ponto_controle')).toBe('consulta');
  });

  // O chefe separou "trabalhar no acervo" de "administrar o acervo", e a segunda
  // ficou com a flag global, como '/orcamento/configuracao'. E a UNICA excecao a
  // regra de que o gerente ve tudo da area dele, entao ela fica escrita aqui: nem
  // gerente nem operador do acervo enxergam a tela, e o item de menu some junto,
  // porque o sidebar deriva a visibilidade da rota (podeAbrirRota).
  test('a Administracao e do administrador global, e some para gerente e operador', () => {
    logar({ perfis: { acervo: 3 } });
    expect(podeAbrirRota('acervo', '/administracao')).toBe(false);
    expect(podeAbrirRota('acervo', '/auditoria')).toBe(true);

    logar({ perfis: { acervo: 2 } });
    expect(podeAbrirRota('acervo', '/administracao')).toBe(false);

    logar({ administrador: true, perfis: {} });
    expect(podeAbrirRota('acervo', '/administracao')).toBe(true);
  });

  test('quem tem consulta no acervo entra no dashboard', () => {
    logar({ perfis: { acervo: 1 } });
    expect(perfilLoader('acervo', 'consulta')()).toBe(true);
  });

  test('perfil em outro modulo nao abre o acervo', () => {
    logar({ perfis: { orcamento: 3 } });
    expect(perfilLoader('acervo', 'consulta')()).toBe('/unauthorized');
  });

  test('sem sessao, o guarda manda ao login guardando a rota de origem', () => {
    clearAuth();
    location.hash = '/acervo/dashboard';
    expect(perfilLoader('acervo', 'consulta')())
      .toBe(`/login?from=${encodeURIComponent('/acervo/dashboard')}`);
  });

  test('administrador global entra mesmo sem linha de perfil no acervo', () => {
    logar({ administrador: true, perfis: {} });
    expect(perfilLoader('acervo', 'consulta')()).toBe(true);
    expect(adminLoader()).toBe(true);
  });

  test('quem so tem perfil no acervo ve o acervo no seletor de modulos', () => {
    logar({ perfis: { acervo: 1 } });
    expect(modulosAcessiveis().map(m => m.id)).toEqual(['acervo']);
  });
});
