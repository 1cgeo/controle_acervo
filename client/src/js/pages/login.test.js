import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@services/api-client.js', () => ({
  apiPost: vi.fn(),
  apiGet: vi.fn(),
}));

vi.mock('@utils/backgrounds.js', () => ({
  randomBackground: () => 'data:image/gif;base64,R0lGODlhAQABAAAAACw=',
}));

import { renderLogin } from './login.js';
import { apiPost } from '@services/api-client.js';

/** Monta a tela e devolve o container. */
async function montar() {
  const container = document.createElement('div');
  await renderLogin(container);
  await flush();
  return container;
}

const caminhos = (c) => [...c.querySelectorAll('.login-caminho')];
const botao = (c, texto) => [...c.querySelectorAll('button')].find(b => b.textContent === texto);

describe('tela de entrada da plataforma', () => {
  beforeEach(() => {
    location.hash = '';
    vi.clearAllMocks();
  });

  afterEach(() => {
    location.hash = '';
  });

  // O pedido do chefe: quem chega tem que reconhecer o seu caminho
  // sem ler instrucao. Por isso os dois ficam visiveis DE UMA VEZ, e cada um diz
  // para quem serve. Se um deles voltar a se esconder atras de aba ou clique,
  // este teste reprova.
  test('os DOIS caminhos aparecem juntos, cada um dizendo para quem e', async () => {
    const container = await montar();

    expect(caminhos(container)).toHaveLength(2);

    const texto = container.textContent;
    expect(texto).toContain('Entrar no sistema');
    expect(texto).toContain('Para quem trabalha no 1º CGEO');
    expect(texto).toContain('Acompanhar um pedido');
    expect(texto).toContain('Para quem solicitou cartas à Mapoteca');

    // Nenhum dos dois nasce escondido.
    for (const c of caminhos(container)) {
      expect(c.classList.contains('hidden')).toBe(false);
    }
  });

  test('diz que a consulta NAO exige conta, que e a duvida de quem pediu carta', async () => {
    const container = await montar();
    expect(container.textContent).toContain('Não é preciso ter conta');
    expect(container.textContent).toContain('comprovante do pedido');
  });

  test('a chave valida leva para a consulta publica, sem passar pelo login', async () => {
    const container = await montar();
    const campo = container.querySelector('#localizador');

    campo.value = 'AB12-CD34-EF56';
    botao(container, 'Acompanhar pedido').closest('form').requestSubmit();
    await flush();

    expect(location.hash).toBe('#/consultar-pedido/AB12-CD34-EF56');
    expect(apiPost).not.toHaveBeenCalled();  // consulta publica nao faz login
  });

  test('aceita a chave colada SEM hifen, porque o comprovante varia', async () => {
    const container = await montar();
    const campo = container.querySelector('#localizador');

    campo.value = 'ab12cd34ef56';
    campo.dispatchEvent(new Event('input'));
    expect(campo.value).toBe('AB12-CD34-EF56');   // formata e sobe a caixa

    botao(container, 'Acompanhar pedido').closest('form').requestSubmit();
    await flush();
    expect(location.hash).toBe('#/consultar-pedido/AB12-CD34-EF56');
  });

  test('chave curta nao navega, e explica o que fazer', async () => {
    const container = await montar();
    const campo = container.querySelector('#localizador');

    campo.value = 'AB12';
    botao(container, 'Acompanhar pedido').closest('form').requestSubmit();
    await flush();

    expect(location.hash).toBe('');
    const erro = container.querySelectorAll('.login-form__error');
    const visivel = [...erro].find(e => !e.classList.contains('hidden'));
    expect(visivel).toBeTruthy();
    expect(visivel.textContent).toContain('12 letras e números');
  });

  test('o login continua funcionando e usa o cliente sca_web', async () => {
    apiPost.mockResolvedValue({ token: 'jwt', administrador: true, perfis: {}, modulos: [] });
    const container = await montar();

    container.querySelector('#usuario').value = 'fulano';
    container.querySelector('#senha').value = 'senha-de-teste';
    botao(container, 'Entrar').closest('form').requestSubmit();
    await flush();

    expect(apiPost).toHaveBeenCalledWith('/login', {
      usuario: 'fulano', senha: 'senha-de-teste', cliente: 'sca_web',
    });
  });

  test('o foco comeca no campo de usuario, e nao no localizador do pedido', async () => {
    // `focus()` só pega com o nó na árvore, então o container entra no
    // documento ANTES do render, e não depois.
    const container = document.createElement('div');
    document.body.appendChild(container);
    await renderLogin(container);
    await flush();

    expect(document.activeElement).toBe(container.querySelector('#usuario'));
    expect(document.activeElement).not.toBe(container.querySelector('#localizador'));

    document.body.removeChild(container);
  });
});
