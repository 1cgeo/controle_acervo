// Setup global dos testes do client (vitest + jsdom).
import { beforeEach, vi } from 'vitest';

// Limpa o localStorage e os mocks entre testes para isolar o estado de sessao.
beforeEach(() => {
  localStorage.clear();
  vi.clearAllMocks();
});

// navigator.clipboard pode nao existir no jsdom; alguns componentes (copiar
// Markdown) o usam. Stub minimo para nao quebrar nesses testes.
if (!navigator.clipboard) {
  Object.defineProperty(navigator, 'clipboard', {
    value: { writeText: vi.fn(() => Promise.resolve()) },
    configurable: true,
  });
}
