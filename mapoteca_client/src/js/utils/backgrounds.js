const BACKGROUNDS = [
  '/backgrounds/img-1.jpg',
  '/backgrounds/img-2.jpg',
  '/backgrounds/img-3.jpg',
  '/backgrounds/img-4.jpg',
  '/backgrounds/img-5.jpg',
];

/**
 * Pick a random login/consulta background image URL.
 * @returns {string}
 */
export function randomBackground() {
  return BACKGROUNDS[Math.floor(Math.random() * BACKGROUNDS.length)];
}
