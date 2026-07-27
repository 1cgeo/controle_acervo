import { describe, test, expect, beforeEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import { createSidebar, activeIdFromPath } from './sidebar.js';

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: [] }, 'x');
}

beforeEach(() => localStorage.clear());

describe('sidebar: menu do modulo ativo', () => {
  test('sem modulo, so a secao de plataforma', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });
    const ids = [...sidebar.querySelectorAll('[data-id]')].map(e => e.dataset.id);
    expect(ids).toEqual(['usuarios']);
  });

  test('o menu do orcamento traz as telas do modulo, com o prefixo na URL', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });
    const ids = [...sidebar.querySelectorAll('[data-id]')].map(e => e.dataset.id);
    expect(ids).toContain('dashboard');
    expect(ids).toContain('dfd');
    expect(ids).toContain('notas_empenho');

    const dfd = sidebar.querySelector('[data-id="dfd"]');
    expect(dfd.getAttribute('href')).toBe('#/orcamento/dfd');
  });

  test('trocar de modulo remonta o menu, sem recriar a sidebar', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'orcamento' });
    const antes = ctrl.sidebar.querySelectorAll('[data-id]').length;
    expect(antes).toBeGreaterThan(1);

    // O menu do acervo entra no lugar do menu do orcamento, e a plataforma fica.
    ctrl.setModulo('acervo');
    const ids = [...ctrl.sidebar.querySelectorAll('[data-id]')].map(e => e.dataset.id);
    expect(ids).toEqual(['dashboard', 'usuarios']);
    expect(ctrl.sidebar.querySelector('[data-id="dashboard"]').getAttribute('href'))
      .toBe('#/acervo/dashboard');

    // Modulo nenhum: sobra so a secao de plataforma.
    ctrl.setModulo(null);
    const soPlataforma = [...ctrl.sidebar.querySelectorAll('[data-id]')].map(e => e.dataset.id);
    expect(soPlataforma).toEqual(['usuarios']);
  });

  test('Usuarios so aparece para o administrador global', () => {
    logar({ perfis: { orcamento: 3 } });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });
    const ids = [...sidebar.querySelectorAll('[data-id]')].map(e => e.dataset.id);
    expect(ids).not.toContain('usuarios');
    expect(ids).toContain('dfd');
  });

  test('o item de plataforma nao leva prefixo de modulo', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });
    expect(sidebar.querySelector('[data-id="usuarios"]').getAttribute('href')).toBe('#/usuarios');
  });

  test('setActive marca o item e abre o grupo que o contem', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'orcamento' });
    ctrl.setActive('notas_empenho');
    const item = ctrl.sidebar.querySelector('[data-id="notas_empenho"]');
    expect(item.classList.contains('sidebar__item--active')).toBe(true);
    expect(item.closest('.sidebar__group').classList.contains('sidebar__group--open')).toBe(true);
  });
});

describe('activeIdFromPath', () => {
  test('rota de modulo: o item e o segundo segmento', () => {
    expect(activeIdFromPath('/orcamento/dfd')).toBe('dfd');
    expect(activeIdFromPath('/orcamento/notas_empenho/3')).toBe('notas_empenho');
    expect(activeIdFromPath('/orcamento/dfd?ano=2026')).toBe('dfd');
  });

  test('rota de plataforma: o item e o primeiro segmento', () => {
    expect(activeIdFromPath('/usuarios')).toBe('usuarios');
  });

  test('rota vazia nao marca nada', () => {
    expect(activeIdFromPath('/')).toBeNull();
    expect(activeIdFromPath('')).toBeNull();
  });
});
