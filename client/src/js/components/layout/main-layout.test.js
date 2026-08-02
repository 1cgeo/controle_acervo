import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import { createMainLayout } from './main-layout.js';

// POR QUE ESTE ARQUIVO EXISTE: o layout autenticado (navbar + sidebar) nao
// tinha teste nenhum. Em 2026-07-27, ao remover o seletor de modulo da navbar,
// sobrou uma referencia orfa a ele na montagem, e o ReferenceError so apareceu
// no navegador, depois do build. Montar o layout inteiro num teste e o que pega
// esse tipo de erro antes.

function logar({ administrador = true, perfis = {} } = {}) {
  saveAuth({
    token: 't',
    administrador,
    uuid: 'u',
    perfis,
    modulos: [
      { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
      { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
      { code: 3, nome: 'Controle Orçamentário', nome_abrev: 'orcamento' },
    ],
  }, 'diniz');
}

let ctrl = null;

beforeEach(() => {
  localStorage.clear();
  location.hash = '';
});

afterEach(() => {
  if (ctrl && typeof ctrl.cleanup === 'function') ctrl.cleanup();
  ctrl = null;
});

describe('createMainLayout', () => {
  test('monta navbar, sidebar e area de conteudo sem estourar', () => {
    logar();
    ctrl = createMainLayout();

    expect(ctrl.layout.querySelector('.navbar')).not.toBeNull();
    expect(ctrl.layout.querySelector('.sidebar')).not.toBeNull();
    expect(ctrl.layout.querySelector('.main-content')).not.toBeNull();
    expect(ctrl.contentArea).not.toBeNull();
  });

  test('a navbar NAO tem mais seletor de modulo em dropdown', () => {
    logar();
    ctrl = createMainLayout();

    expect(ctrl.layout.querySelector('.navbar__modulo')).toBeNull();
    expect(ctrl.layout.querySelector('.navbar select')).toBeNull();
    // A troca de modulo mora na sidebar, uma seção por modulo. São CINCO
    // seções: os três módulos, mais Produção e Efetivo, que desde 2026-08-02 se
    // desenham como sistema sem ser módulo (ver sidebar.js).
    expect(ctrl.layout.querySelectorAll('.sidebar__module-header').length).toBe(5);
  });

  test('o nome do modulo vem do catalogo do servidor, nao decorado na tela', () => {
    logar();
    ctrl = createMainLayout();

    const rotulos = [...ctrl.layout.querySelectorAll('.sidebar__module-header .sidebar__item-label')]
      .map(e => e.textContent);
    // Os três primeiros são MÓDULOS, e o nome de cada um sai de `dominio.modulo`
    // (auth-store.nomeModulo): trocar o nome no banco troca o menu, sem deploy.
    expect(rotulos.slice(0, 3)).toEqual([
      'Controle do Acervo', 'Mapoteca', 'Controle Orçamentário',
    ]);
    // "Produção" e "Efetivo" são a exceção, e são declarados na tela porque NÃO
    // são módulos: não estão em `dominio.modulo`, não têm perfil e não entram no
    // registry.
    expect(rotulos.slice(3)).toEqual(['Produção', 'Efetivo']);
  });

  test('mudar o hash sincroniza o modulo aberto e o item ativo', () => {
    logar();
    location.hash = '#/orcamento/dfd';
    ctrl = createMainLayout();

    const abertas = () => [...ctrl.layout.querySelectorAll('.sidebar__module--open')].length;
    expect(abertas()).toBe(1);
    expect(ctrl.layout.querySelector('[data-id="orcamento:dfd"]')
      .classList.contains('sidebar__item--active')).toBe(true);
  });

  test('entrar em uma rota de plataforma nao apaga o menu dos modulos', () => {
    logar();
    location.hash = '#/acervo/dashboard';
    ctrl = createMainLayout();

    location.hash = '#/usuarios';
    window.dispatchEvent(new Event('hashchange'));

    // Era o defeito relatado: o menu do modulo sumia ao abrir Usuarios.
    expect(ctrl.layout.querySelectorAll('.sidebar__module-header').length).toBe(5);
    expect(ctrl.layout.querySelector('[data-id="acervo:dashboard"]')).not.toBeNull();
    expect(ctrl.layout.querySelector('[data-id="usuarios"]')
      .classList.contains('sidebar__item--active')).toBe(true);
  });

  test('cleanup solta o listener de hashchange', () => {
    logar();
    ctrl = createMainLayout();
    ctrl.cleanup();
    // Depois do cleanup, mudar o hash nao pode mais estourar.
    expect(() => {
      location.hash = '#/mapoteca/pedidos';
      window.dispatchEvent(new Event('hashchange'));
    }).not.toThrow();
    ctrl = null;
  });
});
