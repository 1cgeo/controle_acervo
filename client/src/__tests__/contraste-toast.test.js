import { describe, test, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

// ---------------------------------------------------------------------------
// A PALETA DO TOAST NAO REGRIDE SEM TESTE VERMELHO
// ---------------------------------------------------------------------------
//
// O toast e a unica superficie do sistema que pinta TEXTO BRANCO sobre a cor
// cheia do aviso (`.toast { color: #fff }` em `base.css`), e no tema claro duas
// das quatro cores da paleta ficavam abaixo do 4,5:1 que a WCAG 2.1 exige para
// texto de 14 px: `--color-warning` (#ed6c02) em 3,11:1 e `--color-info`
// (#0288d1) em 3,86:1. O toast some sozinho em 4 a 6 segundos; ilegivel, ele nao
// e lido depois.
//
// O conserto foi dar ao toast tokens PROPRIOS de fundo, para nao arrastar borda,
// icone e chip do sistema inteiro (que estao sobre fundo claro e nao tem esse
// problema). Como o valor agora e uma escolha de desenho isolada, qualquer um
// pode "alinhar de volta com a paleta" sem perceber o que quebra. Este arquivo
// le a folha como TEXTO e refaz a conta: nao ha como abrir a cor de novo em
// silencio.
//
// Nao ha CSSOM aqui de proposito. O vitest roda com `css: false` e nenhuma folha
// e aplicada; ler o arquivo e o unico jeito de medir o que vai para o navegador.

const AQUI = dirname(fileURLToPath(import.meta.url));
const TOKENS = readFileSync(resolve(AQUI, '../css/design-tokens.css'), 'utf8');
const BASE = readFileSync(resolve(AQUI, '../css/base.css'), 'utf8');

/** Razao minima da WCAG 2.1 (criterio 1.4.3) para texto normal. */
const MINIMO = 4.5;

const TOKENS_DO_TOAST = [
  '--toast-info-bg',
  '--toast-success-bg',
  '--toast-warning-bg',
  '--toast-error-bg',
];

/**
 * O bloco `:root { ... }` do tema CLARO, que e o primeiro da folha e vai ate o
 * `[data-theme="dark"]`. Recortar antes de procurar o token e o que impede o
 * caso de medir sem querer o valor do tema escuro.
 */
function blocoDoTemaClaro(css) {
  const inicio = css.indexOf(':root {');
  const fim = css.indexOf('[data-theme="dark"]');
  expect(inicio).toBeGreaterThanOrEqual(0);
  expect(fim).toBeGreaterThan(inicio);
  return css.slice(inicio, fim);
}

/** Le `--nome: #rrggbb;` dentro de um trecho de CSS. */
function corDoToken(css, nome) {
  const achado = new RegExp(`${nome}\\s*:\\s*(#[0-9a-fA-F]{6})\\s*;`).exec(css);
  return achado ? achado[1].toLowerCase() : null;
}

/** Luminancia relativa da WCAG 2.1, a partir de '#rrggbb'. */
function luminancia(hex) {
  const canais = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
  const linear = canais.map((c) => (c <= 0.03928 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4));
  return 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2];
}

/** Razao de contraste entre duas cores '#rrggbb'. */
function contraste(a, b) {
  const la = luminancia(a);
  const lb = luminancia(b);
  const claro = Math.max(la, lb);
  const escuro = Math.min(la, lb);
  return (claro + 0.05) / (escuro + 0.05);
}

describe('contraste dos toasts no tema claro', () => {
  const claro = blocoDoTemaClaro(TOKENS);

  // A conta tem de estar certa antes de servir de regua: dois valores de
  // referencia publicados pela propria WCAG.
  test('a conta bate com os valores de referencia da WCAG', () => {
    expect(contraste('#ffffff', '#000000')).toBeCloseTo(21, 5);
    expect(contraste('#ffffff', '#ffffff')).toBeCloseTo(1, 5);
  });

  test.each(TOKENS_DO_TOAST)('%s alcanca 4,5:1 contra o texto branco', (nome) => {
    const cor = corDoToken(claro, nome);
    expect(cor, `${nome} nao esta declarado com um #rrggbb no tema claro`).toBeTruthy();
    expect(contraste(cor, '#ffffff')).toBeGreaterThanOrEqual(MINIMO);
  });

  // O tema escuro nao tem o problema (a tinta ali e escura), mas o token PRECISA
  // existir nos dois: sem a redeclaracao, o escuro herdaria o marrom do claro e
  // o aviso mudaria de cor sem ninguem pedir.
  test('os quatro tokens tambem sao redeclarados no tema escuro', () => {
    const escuro = TOKENS.slice(TOKENS.indexOf('[data-theme="dark"]'));
    for (const nome of TOKENS_DO_TOAST) {
      expect(escuro, `${nome} falta no tema escuro`).toContain(`${nome}:`);
    }
  });

  // De nada adianta a paleta passar se `.toast--*` voltar a pintar pela
  // `--color-*`: e o que estava la antes, e e a regressao mais provavel.
  test.each([
    ['.toast--info', '--toast-info-bg'],
    ['.toast--success', '--toast-success-bg'],
    ['.toast--warning', '--toast-warning-bg'],
    ['.toast--error', '--toast-error-bg'],
  ])('%s pinta o fundo por %s', (classe, token) => {
    const regra = new RegExp(`\\${classe}\\s*\\{[^}]*background-color:\\s*var\\(${token}\\)`);
    expect(BASE).toMatch(regra);
  });
});
