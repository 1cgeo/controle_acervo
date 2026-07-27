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

  test('administrador aparece como tal em todas as colunas de modulo', async () => {
    getUsuarios.mockResolvedValue([{ ...USUARIO, administrador: true, perfis: {} }]);
    const { container, cleanup } = await montar();

    const linha = container.querySelector('tbody tr');
    const celulas = [...linha.querySelectorAll('td')].map(td => td.textContent.trim());
    expect(celulas.filter(c => c === 'Administrador')).toHaveLength(MODULOS.length);

    if (typeof cleanup === 'function') cleanup();
  });

  test('renderizar a lista nao escreve nada sozinho', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { cleanup } = await montar();
    expect(atualizarUsuario).not.toHaveBeenCalled();
    if (typeof cleanup === 'function') cleanup();
  });

  test('o modal de perfis traz um select por modulo, com o nivel atual', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    container.querySelector('.data-table__action-btn').click();
    await flush();

    const selects = [...document.querySelectorAll('.modal select')];
    expect(selects).toHaveLength(MODULOS.length);
    expect(selects.map(s => s.value)).toEqual(['1', '0', '2']);

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });

  test('salvar manda so o que MUDOU, e 0 vira null para revogar', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    container.querySelector('.data-table__action-btn').click();
    await flush();

    const selects = [...document.querySelectorAll('.modal select')];
    selects[0].value = '0'; // acervo: revoga
    selects[2].value = '3'; // orcamento: 2 -> 3
    // mapoteca fica como esta (0), entao nao pode ir no corpo

    const salvar = [...document.querySelectorAll('.modal button')]
      .find(b => b.textContent.trim() === 'Salvar');
    salvar.click();
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
