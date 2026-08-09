import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import { createMainLayout } from './main-layout.js';

// POR QUE ESTE ARQUIVO EXISTE: sem ele, uma referencia orfa deixada na montagem
// do layout autenticado (navbar + sidebar) so aparece como ReferenceError no
// navegador, depois do build. Montar o layout inteiro num teste pega isso antes.

function logar({ administrador = true, perfis = {} } = {}) {
  saveAuth({
    token: 't',
    administrador,
    uuid: 'u',
    perfis,
    modulos: [
      { code: 1, nome: 'Acervo', nome_abrev: 'acervo' },
      { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
      { code: 3, nome: 'Orçamento', nome_abrev: 'orcamento' },
      { code: 6, nome: 'Equipamento', nome_abrev: 'equipamento' },
      // `dominio.modulo` code 7, o core de producao herdado do SAP 2.3.5.
      { code: 7, nome: 'Produção', nome_abrev: 'producao' },
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

  test('a troca de modulo mora na sidebar, e nao num dropdown da navbar', () => {
    logar();
    ctrl = createMainLayout();

    expect(ctrl.layout.querySelector('.navbar__modulo')).toBeNull();
    expect(ctrl.layout.querySelector('.navbar select')).toBeNull();
    // A troca de modulo mora na sidebar, uma seção por modulo. São SETE
    // seções: os CINCO módulos do registry, mais PIT e Efetivo, que se
    // desenham como sistema sem ser módulo (ver sidebar.js). Eram seis até a
    // 3.0.0, quando `producao` entrou como quinto módulo.
    expect(ctrl.layout.querySelectorAll('.sidebar__module-header').length).toBe(7);
  });

  test('o nome do modulo vem do catalogo do servidor, nao decorado na tela', () => {
    logar();
    ctrl = createMainLayout();

    const rotulos = [...ctrl.layout.querySelectorAll('.sidebar__module-header .sidebar__item-label')]
      .map(e => e.textContent);
    // Os cinco primeiros são MÓDULOS, e o nome de cada um sai de
    // `dominio.modulo` (auth-store.nomeModulo): trocar o nome no banco troca o
    // menu, sem deploy. Nem o manifesto do equipamento nem o de produção
    // carregam rótulo, e por isso "Equipamento" e "Produção" aqui são o `nome`
    // do catálogo, e não o `id`. Se o catálogo não trouxesse o code 7, o rótulo
    // cairia para 'producao' em minúsculas, que é o `id`: é assim que este caso
    // pega o dia em que alguém decorar o nome na tela.
    expect(rotulos.slice(0, 5)).toEqual([
      'Acervo', 'Mapoteca', 'Orçamento', 'Equipamento', 'Produção',
    ]);
    // "PIT" e "Efetivo" são a exceção, e são declarados na tela porque NÃO são
    // módulos DO REGISTRY: eles existem em `dominio.modulo` (codes 4 e 5) e
    // guardam rotas do servidor, mas não têm manifesto nem prefixo de rota, e
    // por isso não passam por `nomeModulo`.
    //
    // O rótulo "PIT" bate com o nome do módulo desde 2026-08-09: o módulo de
    // permissão da seção é 'pit', `dominio.modulo` code 4, que se chamava
    // 'Produção'/'producao' até ali. O rótulo daqui continua sendo declarado na
    // tela, e não lido do catálogo, porque a seção não está no registry.
    expect(rotulos.slice(5)).toEqual(['PIT', 'Efetivo']);
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

    // Rota de plataforma não apaga o menu do módulo: as seis seções ficam.
    expect(ctrl.layout.querySelectorAll('.sidebar__module-header').length).toBe(7);
    expect(ctrl.layout.querySelector('[data-id="acervo:dashboard"]')).not.toBeNull();
    expect(ctrl.layout.querySelector('[data-id="usuarios"]')
      .classList.contains('sidebar__item--active')).toBe(true);
  });

  test('depois do cleanup, o hashchange nao mexe mais no item ativo da sidebar', () => {
    logar();
    location.hash = '#/acervo/dashboard';
    ctrl = createMainLayout();

    const ativo = (id) => ctrl.layout.querySelector(`[data-id="${id}"]`)
      .classList.contains('sidebar__item--active');

    expect(ativo('acervo:dashboard')).toBe(true);

    ctrl.cleanup();
    location.hash = '#/usuarios';
    window.dispatchEvent(new Event('hashchange'));

    // Solto o ouvinte, a sidebar para de acompanhar a rota. O caso acima, com o
    // ouvinte de pé, prova o contrário sobre o mesmo par de rotas: é essa
    // diferença que mostra que o cleanup fez algo.
    expect(ativo('usuarios')).toBe(false);
    expect(ativo('acervo:dashboard')).toBe(true);
    ctrl = null;
  });
});
