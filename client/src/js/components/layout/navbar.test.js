import { describe, test, expect, beforeEach, afterEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import { createNavbar } from './navbar.js';

/**
 * O MENU DO USUARIO TEM DE SER ALCANCAVEL PELO TECLADO.
 *
 * O gatilho era uma `<div>` com `onClick`: nao entra na ordem de tabulacao e nao
 * responde a tecla nenhuma. Atras dele moram os DOIS unicos caminhos que a
 * pessoa tem sobre a propria conta -- "Meu perfil", que e por onde ela troca a
 * PROPRIA senha, e "Sair". Quem navega pelo teclado nao chegava a nenhum dos
 * dois, e dependia do administrador para resetar a senha.
 */

let navbar = null;

beforeEach(() => {
  localStorage.clear();
  document.body.innerHTML = '';
  saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'diniz');
});

afterEach(() => {
  if (navbar && navbar._cleanup) navbar._cleanup();
  navbar = null;
});

function montar() {
  navbar = createNavbar({ onToggleSidebar: () => {} });
  document.body.appendChild(navbar);
  return navbar;
}

const gatilho = () => navbar.querySelector('.navbar__user-gatilho');
const dropdown = () => navbar.querySelector('.navbar__dropdown');

describe('navbar: o menu do usuario', () => {
  test('o gatilho e um botao de verdade, com o estado do menu declarado', () => {
    montar();

    expect(gatilho()).not.toBeNull();
    expect(gatilho().tagName).toBe('BUTTON');
    expect(gatilho().getAttribute('aria-haspopup')).toBe('true');
    expect(gatilho().getAttribute('aria-expanded')).toBe('false');
    expect(dropdown().classList.contains('hidden')).toBe(true);
  });

  test('abrir pelo teclado revela "Meu perfil" e "Sair"', () => {
    montar();

    // O `click` e o que a barra de espaco e o Enter disparam num `<button>`.
    gatilho().focus();
    gatilho().click();

    expect(dropdown().classList.contains('hidden')).toBe(false);
    expect(gatilho().getAttribute('aria-expanded')).toBe('true');

    const itens = [...dropdown().querySelectorAll('.navbar__dropdown-item')]
      .map(i => i.textContent);
    expect(itens).toEqual(['Meu perfil', 'Sair']);
    // O caminho da PROPRIA senha e um link de verdade, e nao um clique perdido.
    expect(dropdown().querySelector('a').getAttribute('href')).toBe('#/perfil');
  });

  test('Escape fecha e devolve o foco ao gatilho', () => {
    montar();
    gatilho().click();
    expect(dropdown().classList.contains('hidden')).toBe(false);

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));

    expect(dropdown().classList.contains('hidden')).toBe(true);
    expect(gatilho().getAttribute('aria-expanded')).toBe('false');
    expect(document.activeElement).toBe(gatilho());
  });

  // ACIONAR UM ITEM tambem fecha. O ouvinte de "clique fora" nao alcanca o
  // dropdown, que e filho da caixa: sem isto, "Meu perfil" navegava e o menu
  // ficava aberto sobre a pagina nova. Quem ja esta em '#/perfil' clicava, nao
  // via nada acontecer, e ainda ficava com o menu aberto.
  test('clicar em "Meu perfil" fecha o menu', () => {
    montar();
    gatilho().click();
    expect(dropdown().classList.contains('hidden')).toBe(false);

    [...dropdown().querySelectorAll('.navbar__dropdown-item')]
      .find(i => i.textContent === 'Meu perfil')
      .click();

    expect(dropdown().classList.contains('hidden')).toBe(true);
    expect(gatilho().getAttribute('aria-expanded')).toBe('false');
  });

  test('clique fora fecha o menu', () => {
    montar();
    gatilho().click();

    document.body.dispatchEvent(new MouseEvent('click', { bubbles: true }));

    expect(dropdown().classList.contains('hidden')).toBe(true);
    expect(gatilho().getAttribute('aria-expanded')).toBe('false');
  });

  // O ouvinte vive no `document`: sem a retirada, a navbar de uma sessao morta
  // continuaria respondendo a tecla e ao clique da tela seguinte.
  test('o cleanup solta os ouvintes do documento', () => {
    montar();
    gatilho().click();
    navbar._cleanup();

    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(dropdown().classList.contains('hidden')).toBe(false);

    navbar = null;
  });
});
