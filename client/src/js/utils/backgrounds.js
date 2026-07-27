// Imagens de fundo da tela de login (em public/backgrounds/), iguais as do
// controle_acervo. Servidas estaticamente pelo Vite/Express na raiz.
const BACKGROUNDS = [
  '/backgrounds/img-1.jpg',
  '/backgrounds/img-2.jpg',
  '/backgrounds/img-3.jpg',
  '/backgrounds/img-4.jpg',
  '/backgrounds/img-5.jpg',
];

/**
 * Sorteia uma imagem de fundo para a tela de login.
 * @returns {string}
 */
export function randomBackground() {
  return BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
}
