import { caminhoPublico } from '@utils/base-path.js';

// Imagens de fundo da tela de login (em public/backgrounds/), iguais as do
// controle_acervo. Servidas estaticamente pelo Vite/Express, sob o prefixo em
// que a interface foi publicada (`caminhoPublico`, de PUBLIC_PATH).
const BACKGROUNDS = [
  caminhoPublico('backgrounds/img-1.jpg'),
  caminhoPublico('backgrounds/img-2.jpg'),
  caminhoPublico('backgrounds/img-3.jpg'),
  caminhoPublico('backgrounds/img-4.jpg'),
  caminhoPublico('backgrounds/img-5.jpg'),
];

/**
 * Sorteia uma imagem de fundo para a tela de login.
 * @returns {string}
 */
export function randomBackground() {
  return BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
}
