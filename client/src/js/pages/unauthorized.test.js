import { describe, test, expect, beforeEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import { renderUnauthorized } from '@pages/unauthorized.js';

// A 403 fala com DUAS pessoas diferentes, e a diferença muda o que ela oferece:
// quem tem acesso a algum módulo e bateu na porta errada, e quem ainda não tem
// acesso a nada. Para a segunda, a saída é a própria página, e não sair da
// sessão: a conta existe e a senha funciona, e o que falta é a concessão.
const CATALOGO = [
  { code: 1, nome: 'Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
];

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: CATALOGO }, 'x');
}

async function montar() {
  const container = document.createElement('div');
  await renderUnauthorized(container);
  return container;
}

beforeEach(() => {
  localStorage.clear();
  location.hash = '';
});

describe('pagina 403', () => {
  test('quem nao tem acesso a nada e mandado ao proprio perfil, e nao expulso', async () => {
    logar({ perfis: {} });
    const container = await montar();

    const link = container.querySelector('.error-page__link');
    expect(link.tagName).toBe('A');
    expect(link.getAttribute('href')).toBe('#/perfil');
    expect(container.querySelector('.error-page__message').textContent)
      .toContain('administrador do sistema');
  });

  test('quem tem acesso a algum modulo volta ao inicio dele', async () => {
    logar({ perfis: { mapoteca: 1 } });
    const container = await montar();

    const link = container.querySelector('.error-page__link');
    expect(link.getAttribute('href')).toBe('#/mapoteca/dashboard');
    expect(link.textContent).toBe('Voltar ao início');
  });

  // A mensagem diz ao que pedir: o acesso ao MÓDULO, e a quem, o gerente. Sem
  // isso a tela dizia só "acesso negado", e a pessoa não tinha passo seguinte.
  test('a mensagem separa "nenhum modulo" de "este modulo"', async () => {
    logar({ perfis: {} });
    expect((await montar()).querySelector('.error-page__message').textContent)
      .toContain('nenhum módulo');

    logar({ perfis: { mapoteca: 1 } });
    expect((await montar()).querySelector('.error-page__message').textContent)
      .toContain('neste módulo');
  });
});
