import { describe, test, expect, beforeEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import { createSidebar, activeIdFromPath } from './sidebar.js';

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: [] }, 'x');
}

const ids = (raiz) => [...raiz.querySelectorAll('[data-id]')].map(e => e.dataset.id);
const modulosNaTela = (raiz) => [...raiz.querySelectorAll('.sidebar__module-header')]
  .map(e => e.getAttribute('href'));

beforeEach(() => localStorage.clear());

describe('sidebar: os tres modulos convivem, cada um colapsavel', () => {
  test('lista TODOS os modulos acessiveis, mesmo numa rota de plataforma', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    // Era o defeito: em #/usuarios o menu inteiro sumia e sobrava a plataforma.
    expect(modulosNaTela(sidebar)).toEqual([
      '#/acervo/dashboard',
      '#/mapoteca/dashboard',
      '#/orcamento/dashboard',
    ]);
    expect(ids(sidebar)).toContain('acervo:dashboard');
    expect(ids(sidebar)).toContain('usuarios');
  });

  test('o item carrega o modulo na chave, porque dashboard existe nos tres', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });

    const lista = ids(sidebar);
    expect(lista).toContain('acervo:dashboard');
    expect(lista).toContain('mapoteca:dashboard');
    expect(lista).toContain('orcamento:dashboard');

    expect(sidebar.querySelector('[data-id="orcamento:dfd"]').getAttribute('href'))
      .toBe('#/orcamento/dfd');
  });

  test('trocar de modulo abre a seção dele e fecha as outras, sem apagar nada', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'orcamento' });
    const secoes = () => [...ctrl.sidebar.querySelectorAll('.sidebar__module')]
      .map(s => s.classList.contains('sidebar__module--open'));

    expect(secoes()).toEqual([false, false, true]);
    const antes = ids(ctrl.sidebar).length;

    ctrl.setModulo('acervo');
    expect(secoes()).toEqual([true, false, false]);

    // Nenhum item foi destruido: a sidebar so abriu e fechou seção.
    expect(ids(ctrl.sidebar).length).toBe(antes);
  });

  test('rota de plataforma nao fecha o que estava aberto', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'mapoteca' });
    const abertas = () => [...ctrl.sidebar.querySelectorAll('.sidebar__module--open')].length;

    expect(abertas()).toBe(1);
    ctrl.setModulo(null);
    expect(abertas()).toBe(1);
    expect(ids(ctrl.sidebar)).toContain('mapoteca:pedidos');
  });

  test('quem nao e admin ve so os modulos em que tem perfil', () => {
    logar({ perfis: { orcamento: 3 } });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });

    expect(modulosNaTela(sidebar)).toEqual(['#/orcamento/dashboard']);
    expect(ids(sidebar)).not.toContain('usuarios');
    expect(ids(sidebar)).toContain('orcamento:dfd');
  });

  test('o item de plataforma nao leva prefixo de modulo', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });
    expect(sidebar.querySelector('[data-id="usuarios"]').getAttribute('href')).toBe('#/usuarios');
  });

  test('setActive marca o item e abre o grupo que o contem', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'orcamento' });
    ctrl.setActive('orcamento:notas_empenho');

    const item = ctrl.sidebar.querySelector('[data-id="orcamento:notas_empenho"]');
    expect(item.classList.contains('sidebar__item--active')).toBe(true);
    expect(item.closest('.sidebar__group').classList.contains('sidebar__group--open')).toBe(true);
  });

  test('o mesmo id em modulos diferentes nao se confunde', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'acervo' });
    ctrl.setActive('acervo:dashboard');

    expect(ctrl.sidebar.querySelector('[data-id="acervo:dashboard"]')
      .classList.contains('sidebar__item--active')).toBe(true);
    expect(ctrl.sidebar.querySelector('[data-id="orcamento:dashboard"]')
      .classList.contains('sidebar__item--active')).toBe(false);
  });
});

describe('activeIdFromPath', () => {
  test('rota de modulo: a chave carrega o modulo e o item', () => {
    expect(activeIdFromPath('/orcamento/dfd')).toBe('orcamento:dfd');
    expect(activeIdFromPath('/orcamento/notas_empenho/3')).toBe('orcamento:notas_empenho');
    expect(activeIdFromPath('/orcamento/dfd?ano=2026')).toBe('orcamento:dfd');
    expect(activeIdFromPath('/acervo/dashboard')).toBe('acervo:dashboard');
  });

  test('rota de plataforma: o item e o primeiro segmento', () => {
    expect(activeIdFromPath('/usuarios')).toBe('usuarios');
  });

  test('rota vazia nao marca nada', () => {
    expect(activeIdFromPath('/')).toBeNull();
    expect(activeIdFromPath('')).toBeNull();
  });

  test('modulo sem item (so o prefixo) nao marca nada', () => {
    expect(activeIdFromPath('/orcamento')).toBeNull();
  });
});
