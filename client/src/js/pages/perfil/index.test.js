import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Meu perfil (#/perfil): o proprio cadastro e a troca da PROPRIA senha, que so
// passaram a existir, com a autenticacao vindo para dentro do SCA.
vi.mock('@services/plataforma-service.js', () => ({
  getMeuPerfil: vi.fn(() => Promise.resolve({})),
  atualizarMeuPerfil: vi.fn(() => Promise.resolve(null)),
  alterarMinhaSenha: vi.fn(() => Promise.resolve(null)),
  getPostosGrad: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@utils/toast.js', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
  showToast: vi.fn(),
}));

import { renderPerfil } from '@pages/perfil/index.js';
import { saveAuth } from '@store/auth-store.js';
import {
  getMeuPerfil, atualizarMeuPerfil, alterarMinhaSenha, getPostosGrad,
} from '@services/plataforma-service.js';
import { showError } from '@utils/toast.js';

const POSTOS = [
  { code: 11, nome: 'Terceiro Sargento', nome_abrev: '3 Sgt' },
  { code: 12, nome: 'Segundo Sargento', nome_abrev: '2 Sgt' },
];

const PERFIL = {
  uuid: 'u-1',
  login: 'sgt.silva',
  nome: 'Silva',
  nome_guerra: 'Silva',
  tipo_posto_grad_id: 11,
  tipo_posto_grad: '3 Sgt',
  administrador: false,
  ativo: true,
};

const CATALOGO = [
  { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
];

/** Sessao com os perfis dados, que e de onde a secao "Meus acessos" le. */
function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u-1', perfis, modulos: CATALOGO }, 'sgt.silva');
}

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  localStorage.clear();
  logar({ perfis: { mapoteca: 2 } });
  getMeuPerfil.mockResolvedValue(PERFIL);
  getPostosGrad.mockResolvedValue(POSTOS);
});

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderPerfil(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

/** Campo pelo rotulo, como quem preenche a tela o encontra. */
const campo = (container, rotulo) => {
  const label = [...container.querySelectorAll('.form-field__label')]
    .find(l => l.textContent.replace('*', '').trim() === rotulo);
  return container.querySelector(`#${label.getAttribute('for')}`);
};

describe('renderPerfil', () => {
  test('mostra o login sem deixar edita-lo', async () => {
    const { container, cleanup } = await montar();

    const login = campo(container, 'Login');
    expect(login.value).toBe('sgt.silva');
    // Quem muda quem a pessoa E e o administrador. Fosse editavel aqui, "editar
    // meu perfil" seria o caminho para tomar o login de outra conta.
    expect(login.disabled).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  test('salva nome, nome de guerra e posto, e nada mais', async () => {
    const { container, cleanup } = await montar();

    campo(container, 'Nome completo').value = 'Silva da Silva';
    campo(container, 'Nome de guerra').value = 'Silvinha';
    campo(container, 'Posto/Graduação').value = '12';

    container.querySelectorAll('form')[0].dispatchEvent(new Event('submit'));
    await flush();

    expect(atualizarMeuPerfil).toHaveBeenCalledWith({
      nome: 'Silva da Silva',
      nome_guerra: 'Silvinha',
      tipo_posto_grad_id: 12,
    });

    if (typeof cleanup === 'function') cleanup();
  });

  test('nome vazio nao vira corpo: a tela recusa antes de chamar o servidor', async () => {
    const { container, cleanup } = await montar();

    campo(container, 'Nome completo').value = '';
    container.querySelectorAll('form')[0].dispatchEvent(new Event('submit'));
    await flush();

    expect(atualizarMeuPerfil).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('perfil: troca de senha', () => {
  const preencherSenhas = (container, atual, nova, confirmacao) => {
    campo(container, 'Senha atual').value = atual;
    campo(container, 'Nova senha').value = nova;
    campo(container, 'Repita a nova senha').value = confirmacao;
  };

  const enviarSenha = async (container) => {
    container.querySelectorAll('form')[1].dispatchEvent(new Event('submit'));
    await flush();
  };

  test('manda a senha atual e a nova, e a confirmacao FICA na tela', async () => {
    const { container, cleanup } = await montar();

    preencherSenhas(container, 'velha', 'nova', 'nova');
    await enviarSenha(container);

    // O servidor exige a vigente (e o que impede uma sessao esquecida aberta de
    // virar uma conta tomada) e nao recebe a confirmacao, que e so daqui.
    expect(alterarMinhaSenha).toHaveBeenCalledWith({
      senha_atual: 'velha',
      senha_nova: 'nova',
    });

    if (typeof cleanup === 'function') cleanup();
  });

  test('confirmacao diferente nao chega ao servidor', async () => {
    const { container, cleanup } = await montar();

    preencherSenhas(container, 'velha', 'nova', 'nov4');
    await enviarSenha(container);

    expect(alterarMinhaSenha).not.toHaveBeenCalled();
    expect([...container.querySelectorAll('.form-field__error')]
      .some(e => e.textContent === 'As duas senhas não são iguais')).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  test('os tres campos de senha sao do tipo password', async () => {
    const { container, cleanup } = await montar();
    expect(container.querySelectorAll('input[type="password"]')).toHaveLength(3);
    if (typeof cleanup === 'function') cleanup();
  });

  test('a senha limpa os campos depois de trocada, para nao ficar na tela', async () => {
    const { container, cleanup } = await montar();

    preencherSenhas(container, 'velha', 'nova', 'nova');
    await enviarSenha(container);

    expect(campo(container, 'Senha atual').value).toBe('');
    expect(campo(container, 'Nova senha').value).toBe('');
    expect(campo(container, 'Repita a nova senha').value).toBe('');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a recusa do servidor sobe para a tela como ela veio', async () => {
    alterarMinhaSenha.mockRejectedValueOnce(new Error('Senha atual incorreta'));
    const { container, cleanup } = await montar();

    preencherSenhas(container, 'errada', 'nova', 'nova');
    await enviarSenha(container);

    expect(showError).toHaveBeenCalledWith('Senha atual incorreta');

    if (typeof cleanup === 'function') cleanup();
  });
});

// ---------------------------------------------------------------------------
// Meus acessos
//
// A tela e a PORTA DE ENTRADA de quem ainda nao tem perfil nenhum: e o unico
// lugar em que essa pessoa descobre o que pode e o que fazer a respeito.
// ---------------------------------------------------------------------------
describe('perfil: meus acessos', () => {
  const acessos = (container) => [...container.querySelectorAll('.perfil__acesso')]
    .map(li => li.textContent);

  test('lista um modulo por linha, com o nome do modulo e o do perfil', async () => {
    logar({ perfis: { mapoteca: 2, acervo: 3 } });
    const { container, cleanup } = await montar();

    const linhas = acessos(container);
    expect(linhas).toHaveLength(2);
    expect(linhas.join(' ')).toContain('Controle do Acervo');
    expect(linhas.join(' ')).toContain('Gerente');
    expect(linhas.join(' ')).toContain('Mapoteca');
    expect(linhas.join(' ')).toContain('Operador');
    expect(container.querySelector('.perfil__sem-acesso')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('sem perfil nenhum, a tela pede o acesso a um gerente', async () => {
    logar({ perfis: {} });
    const { container, cleanup } = await montar();

    expect(acessos(container)).toHaveLength(0);
    const aviso = container.querySelector('.perfil__sem-acesso');
    expect(aviso).not.toBeNull();
    expect(aviso.textContent).toContain('administrador do sistema');

    if (typeof cleanup === 'function') cleanup();
  });

  // Quem nao tem acesso a nada continua dono desta tela: os dois formularios
  // seguem la, porque corrigir o proprio cadastro e trocar a propria senha e
  // exatamente o que essa pessoa PODE fazer enquanto espera.
  test('sem acesso nenhum, os dois formularios continuam na tela', async () => {
    logar({ perfis: {} });
    const { container, cleanup } = await montar();

    expect(container.querySelectorAll('.perfil__form')).toHaveLength(2);
    expect(campo(container, 'Senha atual')).not.toBeUndefined();

    if (typeof cleanup === 'function') cleanup();
  });

  // O administrador global nao tem linha de perfil nenhuma. Sem este caso, a
  // tela diria a quem administra o sistema que ele precisa pedir acesso.
  test('o administrador global ve os modulos todos, e nao o pedido de acesso', async () => {
    logar({ administrador: true, perfis: {} });
    const { container, cleanup } = await montar();

    expect(acessos(container)).toHaveLength(CATALOGO.length);
    expect(container.querySelector('.perfil__sem-acesso')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
