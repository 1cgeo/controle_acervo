import { describe, test, expect, beforeEach } from 'vitest';
import { saveAuth, clearAuth } from '@store/auth-store.js';
import { perfilLoader, adminLoader } from '@js/router.js';
import { getModulo, modulosPortados, modulosAcessiveis, rotaInicial } from '@modules/registry.js';
import acervo from './index.js';

const CATALOGO = [
  { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Controle Orçamentário', nome_abrev: 'orcamento' },
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

  test('registra a rota do dashboard com render assincrono', () => {
    expect(acervo.rotas).toHaveLength(1);
    const dashboard = acervo.rotas.find(r => r.path === '/dashboard');
    expect(dashboard).toBeDefined();
    expect(typeof dashboard.render).toBe('function');
  });

  test('o menu leva ao dashboard e nao repete a tela de usuarios da plataforma', () => {
    expect(acervo.menu.map(i => i.path)).toEqual(['/dashboard']);
    expect(acervo.menu.some(i => i.path === '/usuarios')).toBe(false);
  });

  test('o registry passa a contar o acervo como portado', () => {
    expect(getModulo('acervo')).toBe(acervo);
    expect(modulosPortados().map(m => m.id)).toContain('acervo');
  });
});

describe('guardas das rotas do acervo', () => {
  test('toda rota exige ao menos o perfil de consulta NO ACERVO', () => {
    for (const rota of acervo.rotas) {
      expect(rota.admin).toBeUndefined();
      expect(rota.perfil).toBe('consulta');
    }
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
