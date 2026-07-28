import { describe, test, expect, vi, beforeEach } from 'vitest';

// Tela UNICA de usuarios: uma coluna por modulo. Mocka o service de plataforma.
vi.mock('@services/plataforma-service.js', () => ({
  getUsuarios: vi.fn(() => Promise.resolve([])),
  getUsuariosAuthServer: vi.fn(() => Promise.resolve([])),
  importarUsuarios: vi.fn(() => Promise.resolve({})),
  atualizarUsuario: vi.fn(() => Promise.resolve({})),
  sincronizarUsuarios: vi.fn(() => Promise.resolve({})),
  getModulos: vi.fn(() => Promise.resolve([])),
  getTiposPerfil: vi.fn(() => Promise.resolve([])),
}));

import { renderUsuariosList } from '@pages/usuarios/list.js';
import {
  getUsuarios, getModulos, getTiposPerfil, atualizarUsuario,
} from '@services/plataforma-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const MODULOS = [
  { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Controle Orçamentário', nome_abrev: 'orcamento' },
];

const PERFIS = [
  { code: 1, nome: 'Consulta' },
  { code: 2, nome: 'Operador' },
  { code: 3, nome: 'Gerente' },
];

const USUARIO = {
  uuid: 'u-1',
  login: 'sgt.silva',
  nome: 'Silva',
  nome_guerra: 'Silva',
  tipo_posto_grad: '3 Sgt',
  administrador: false,
  ativo: true,
  perfis: { acervo: 1, orcamento: 2 },
};

beforeEach(() => {
  vi.clearAllMocks();
  // O modal vive no document.body, fora do container da pagina. Um teste que
  // falha no meio deixa o dele aberto, e o proximo passa a inspecionar o modal
  // ERRADO: as falhas viram cascata e escondem a causa real.
  document.body.innerHTML = '';
  getUsuarios.mockResolvedValue([]);
  getModulos.mockResolvedValue(MODULOS);
  getTiposPerfil.mockResolvedValue(PERFIS);
});

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderUsuariosList(container, { params: {}, query: new URLSearchParams() });
  await flush();
  await flush();
  return { container, cleanup };
}

describe('renderUsuariosList', () => {
  test('monta titulo e carrega a lista do service', async () => {
    const { container, cleanup } = await montar();

    expect(getUsuarios).toHaveBeenCalled();
    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelector('.data-table-wrapper')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('cria UMA COLUNA por modulo, com o nome vindo do catalogo', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    expect(getModulos).toHaveBeenCalled();
    const cabecalhos = [...container.querySelectorAll('th')].map(th => th.textContent.trim());
    expect(cabecalhos).toContain('Controle do Acervo');
    expect(cabecalhos).toContain('Mapoteca');
    expect(cabecalhos).toContain('Controle Orçamentário');

    if (typeof cleanup === 'function') cleanup();
  });

  test('mostra o nivel pelo NOME em cada modulo, e Sem acesso onde nao ha', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    expect(getTiposPerfil).toHaveBeenCalled();
    const linha = container.querySelector('tbody tr');
    const celulas = [...linha.querySelectorAll('td')].map(td => td.textContent.trim());
    // Nome, Login, Posto/Grad, acervo, mapoteca, orcamento, admin, ativo, acoes
    expect(celulas).toContain('Consulta');   // acervo: 1
    expect(celulas).toContain('Sem acesso'); // mapoteca: sem linha
    expect(celulas).toContain('Operador');   // orcamento: 2

    if (typeof cleanup === 'function') cleanup();
  });

  // O administrador e GLOBAL e unico: e propriedade da PESSOA, nao de cada
  // modulo. Antes a palavra "Administrador" se repetia numa coluna por modulo
  // MAIS uma coluna propria, dando quatro colunas com a mesma informacao.
  test('administrador vira uma marca ao lado do nome, e nao uma coluna por modulo', async () => {
    getUsuarios.mockResolvedValue([{ ...USUARIO, administrador: true, perfis: {} }]);
    const { container, cleanup } = await montar();

    const linha = container.querySelector('tbody tr');
    const celulas = [...linha.querySelectorAll('td')].map(td => td.textContent.trim());

    expect(linha.querySelectorAll('.usuarios__chip-admin')).toHaveLength(1);
    expect(celulas.filter(c => c === 'Administrador')).toHaveLength(0);
    expect(celulas.filter(c => c === 'Sim')).toHaveLength(1); // so a coluna Ativo

    if (typeof cleanup === 'function') cleanup();
  });

  test('a coluna de cada modulo diz que o admin passa, sem repetir a palavra', async () => {
    getUsuarios.mockResolvedValue([{ ...USUARIO, administrador: true, perfis: {} }]);
    const { container, cleanup } = await montar();

    const linha = container.querySelector('tbody tr');
    expect(linha.querySelectorAll('.usuarios__acesso-total')).toHaveLength(MODULOS.length);

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem nao e admin mostra o perfil concedido em cada modulo', async () => {
    getUsuarios.mockResolvedValue([
      { ...USUARIO, administrador: false, perfis: { orcamento: 3 } },
    ]);
    const { container, cleanup } = await montar();

    const linha = container.querySelector('tbody tr');
    const celulas = [...linha.querySelectorAll('td')].map(td => td.textContent.trim());

    expect(linha.querySelectorAll('.usuarios__chip-admin')).toHaveLength(0);
    expect(linha.querySelectorAll('.usuarios__acesso-total')).toHaveLength(0);
    expect(celulas.filter(c => c === 'Sem acesso').length).toBe(MODULOS.length - 1);

    if (typeof cleanup === 'function') cleanup();
  });

  test('renderizar a lista nao escreve nada sozinho', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { cleanup } = await montar();
    expect(atualizarUsuario).not.toHaveBeenCalled();
    if (typeof cleanup === 'function') cleanup();
  });

  // O <select> por modulo virou um controle segmentado: os quatro niveis a
  // vista, na ordem da hierarquia, em vez de escondidos atras de um clique.
  const linhasPerfil = () => [...document.querySelectorAll('.modal .perfil-linha')];
  const nivelAtivo = (linha) => linha.querySelector('.seletor-nivel__item--ativo').textContent;
  const escolherNivel = (linha, rotulo) => {
    [...linha.querySelectorAll('.seletor-nivel__item')]
      .find(b => b.textContent === rotulo)
      .click();
  };
  const botaoSalvar = () => [...document.querySelectorAll('.modal__footer button')]
    .find(b => b.textContent.startsWith('Salvar'));

  test('o modal de perfis traz um seletor por modulo, marcando o nivel atual', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    container.querySelector('.data-table__action-btn').click();
    await flush();

    const linhas = linhasPerfil();
    expect(linhas).toHaveLength(MODULOS.length);
    expect(linhas.map(nivelAtivo)).toEqual(['Consulta', 'Sem acesso', 'Operador']);
    // Os quatro niveis ficam a vista em cada modulo, e nao atras de um dropdown.
    expect(linhas[0].querySelectorAll('.seletor-nivel__item')).toHaveLength(4);

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });

  // Salvar sem mudanca nenhuma so fechava o modal, o que era indistinguivel de
  // ter salvado. Agora o botao fica desativado ate existir o que salvar.
  test('o botao de salvar conta as alteracoes e nasce desativado', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    container.querySelector('.data-table__action-btn').click();
    await flush();

    expect(botaoSalvar().disabled).toBe(true);
    expect(botaoSalvar().textContent).toBe('Salvar');

    escolherNivel(linhasPerfil()[0], 'Gerente');
    expect(botaoSalvar().disabled).toBe(false);
    expect(botaoSalvar().textContent).toBe('Salvar 1 alteração');

    escolherNivel(linhasPerfil()[1], 'Consulta');
    expect(botaoSalvar().textContent).toBe('Salvar 2 alterações');

    // Voltar ao nivel original desfaz a contagem: nao ha o que mandar.
    escolherNivel(linhasPerfil()[0], 'Consulta');
    escolherNivel(linhasPerfil()[1], 'Sem acesso');
    expect(botaoSalvar().disabled).toBe(true);

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });

  test('a linha que muda se marca com o "de X para Y"', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    container.querySelector('.data-table__action-btn').click();
    await flush();

    const linha = linhasPerfil()[0]; // acervo, hoje Consulta
    expect(linha.classList.contains('perfil-linha--alterada')).toBe(false);

    escolherNivel(linha, 'Gerente');
    expect(linha.classList.contains('perfil-linha--alterada')).toBe(true);
    expect(linha.querySelector('.perfil-linha__marca').textContent)
      .toBe('Consulta para Gerente');

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });

  test('salvar manda so o que MUDOU, e 0 vira null para revogar', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    container.querySelector('.data-table__action-btn').click();
    await flush();

    const linhas = linhasPerfil();
    escolherNivel(linhas[0], 'Sem acesso'); // acervo: revoga
    escolherNivel(linhas[2], 'Gerente');    // orcamento: 2 -> 3
    // mapoteca fica como esta (0), entao nao pode ir no corpo

    botaoSalvar().click();
    await flush();

    expect(atualizarUsuario).toHaveBeenCalledWith('u-1', {
      administrador: false,
      ativo: true,
      perfis: { acervo: null, orcamento: 3 },
    });

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });
});
