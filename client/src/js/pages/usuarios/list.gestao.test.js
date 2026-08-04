import { describe, test, expect, vi, beforeEach } from 'vitest';

// A tela de GESTAO do efetivo (#/usuarios), depois da revisao de 2026-08-04.
//
// O defeito visto na producao: 54 pessoas e quatro colunas repetindo
// "Sem acesso / Sem acesso / Sem acesso / Nao". Sem filtro de situacao, com a
// busca que nao achava o perfil nem a palavra "Ativo", e com a lista em ordem
// alfabetica de nome completo, misturando quem serve com quem ja saiu.
//
// O que estes casos guardam:
//   - o filtro de situacao do login, com ATIVO por padrao
//   - a busca achando o que a tela MOSTRA (perfil de modulo, situacao)
//   - a ordem hierarquica, pelo CODIGO do posto e nunca pela abreviatura
//   - a identidade: posto mais nome de guerra
//   - as colunas que o banco ja tinha e a tela nao mostrava
//   - as acoes de linha, e o Excluir escondido de quem tem registro
//   - os saltos para as outras telas da pessoa
//   - o estado de erro do catalogo, que antes virava tabela sem colunas

vi.mock('@services/plataforma-service.js', () => ({
  getUsuarios: vi.fn(() => Promise.resolve([])),
  criarUsuario: vi.fn(() => Promise.resolve({ uuid: 'u-novo' })),
  atualizarUsuario: vi.fn(() => Promise.resolve({})),
  excluirUsuario: vi.fn(() => Promise.resolve({})),
  resetarSenhas: vi.fn(() => Promise.resolve({ total: 1 })),
  getModulos: vi.fn(() => Promise.resolve([])),
  getTiposPerfil: vi.fn(() => Promise.resolve([])),
  getPostosGrad: vi.fn(() => Promise.resolve([])),
}));

// O historico da pessoa vira acao de linha, e ele abre NAO RECOLHIDO: sem este
// duble a ficha bateria na rede durante o teste.
vi.mock('@services/rastreabilidade-service.js', () => ({
  getHistorico: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@utils/toast.js', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
  showToast: vi.fn(),
}));

import { renderUsuariosList } from '@pages/usuarios/list.js';
import {
  getUsuarios, getModulos, getTiposPerfil, getPostosGrad,
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

// Os codigos sao os do DDL (er/dominio.sql:11-30): 5 Cabo, 13 Capitao, 16 Coronel.
const POSTOS = [
  { code: 5, nome: 'Cabo', nome_abrev: 'Cb' },
  { code: 13, nome: 'Capitão', nome_abrev: 'Cap' },
  { code: 16, nome: 'Coronel', nome_abrev: 'Cel' },
];

const CABO = {
  uuid: 'u-cabo',
  login: 'cb.souza',
  nome: 'João de Souza',
  nome_guerra: 'Souza',
  tipo_posto_grad_id: 5,
  tipo_posto_grad: 'Cb',
  administrador: false,
  ativo: true,
  senha_definida: true,
  perfis: { acervo: 1 },
  na_dgeo_desde: '2025-03-10',
  ultimo_acesso: '2026-08-03T13:45:00.000Z',
  tem_registro: true,
};

// A abreviatura "Cap" vem ANTES de "Cel" no alfabeto, e o codigo 13 vem DEPOIS
// do 16 na hierarquia: e este par que separa ordem de verdade de ordem falsa.
const CAPITAO = {
  uuid: 'u-cap',
  login: 'cap.alves',
  nome: 'Ana Alves',
  nome_guerra: 'Alves',
  tipo_posto_grad_id: 13,
  tipo_posto_grad: 'Cap',
  administrador: false,
  ativo: true,
  senha_definida: true,
  perfis: { acervo: 2, mapoteca: 3 },
  na_dgeo_desde: '2024-01-15',
  ultimo_acesso: null,
  tem_registro: false,
};

const CORONEL_INATIVO = {
  uuid: 'u-cel',
  login: 'cel.dias',
  nome: 'Carlos Dias',
  nome_guerra: 'Dias',
  tipo_posto_grad_id: 16,
  tipo_posto_grad: 'Cel',
  administrador: true,
  ativo: false,
  senha_definida: true,
  perfis: {},
  na_dgeo_desde: null,
  ultimo_acesso: '2025-12-20T10:00:00.000Z',
  tem_registro: true,
};

const TODOS = [CABO, CAPITAO, CORONEL_INATIVO];

beforeEach(() => {
  vi.clearAllMocks();
  document.body.innerHTML = '';
  getUsuarios.mockResolvedValue(TODOS);
  getModulos.mockResolvedValue(MODULOS);
  getTiposPerfil.mockResolvedValue(PERFIS);
  getPostosGrad.mockResolvedValue(POSTOS);
});

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderUsuariosList(container, { params: {}, query: new URLSearchParams() });
  await flush();
  await flush();
  return { container, cleanup };
}

const cabecalhos = (container) =>
  [...container.querySelectorAll('thead th')].map(th => th.textContent.trim());

const linhas = (container) => [...container.querySelectorAll('tbody tr')];

const textoDaLinha = (linha) =>
  [...linha.querySelectorAll('td')].map(td => td.textContent.trim());

const acao = (container, titulo) => [...container.querySelectorAll('.data-table__action-btn')]
  .find(b => b.getAttribute('title') === titulo);

const buscar = (container, texto) => {
  const input = container.querySelector('.data-table-toolbar__search-input');
  input.value = texto;
  input.dispatchEvent(new Event('input'));
};

const filtroSituacao = (container) => container.querySelector('.page__filters select');

const escolherSituacao = (container, valor) => {
  const select = filtroSituacao(container);
  select.value = valor;
  select.dispatchEvent(new Event('change'));
};

// ---------------------------------------------------------------------------
// 1. Filtro por situacao, com os ativos por padrao
// ---------------------------------------------------------------------------
describe('usuarios: filtro de situacao', () => {
  test('a tela abre so com quem tem o login ativo', async () => {
    const { container, cleanup } = await montar();

    expect(filtroSituacao(container)).not.toBeNull();
    const logins = linhas(container).map(l => textoDaLinha(l).join(' '));
    expect(logins.some(t => t.includes('cb.souza'))).toBe(true);
    expect(logins.some(t => t.includes('cap.alves'))).toBe(true);
    expect(logins.some(t => t.includes('cel.dias'))).toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o filtro traz os inativos e volta a lista inteira', async () => {
    const { container, cleanup } = await montar();

    escolherSituacao(container, 'inativos');
    expect(linhas(container)).toHaveLength(1);
    expect(textoDaLinha(linhas(container)[0]).join(' ')).toContain('cel.dias');

    // A opcao vazia do seletor e "Todos", como no filtro de ano da capacitacao.
    escolherSituacao(container, '');
    expect(linhas(container)).toHaveLength(3);

    if (typeof cleanup === 'function') cleanup();
  });
});

// ---------------------------------------------------------------------------
// 2. A busca acha o que a tela MOSTRA
// ---------------------------------------------------------------------------
describe('usuarios: busca', () => {
  test('acha pelo perfil que a coluna de modulo mostra', async () => {
    const { container, cleanup } = await montar();

    buscar(container, 'Operador');
    const achadas = linhas(container);
    expect(achadas).toHaveLength(1);
    expect(textoDaLinha(achadas[0]).join(' ')).toContain('cap.alves');

    if (typeof cleanup === 'function') cleanup();
  });

  test('acha "Sem acesso", que e o que a celula do modulo diz', async () => {
    const { container, cleanup } = await montar();

    buscar(container, 'Sem acesso');
    expect(linhas(container).length).toBeGreaterThan(0);

    if (typeof cleanup === 'function') cleanup();
  });

  test('acha pela situacao do login, pela palavra que a coluna mostra', async () => {
    const { container, cleanup } = await montar();

    escolherSituacao(container, '');
    buscar(container, 'Inativo');
    const achadas = linhas(container);
    expect(achadas).toHaveLength(1);
    expect(textoDaLinha(achadas[0]).join(' ')).toContain('cel.dias');

    if (typeof cleanup === 'function') cleanup();
  });

  test('acha pelo nome de guerra e tambem pelo nome completo', async () => {
    const { container, cleanup } = await montar();

    buscar(container, 'Souza');
    expect(linhas(container)).toHaveLength(1);

    buscar(container, 'Ana Alves');
    expect(linhas(container)).toHaveLength(1);

    if (typeof cleanup === 'function') cleanup();
  });
});

// ---------------------------------------------------------------------------
// 3. Ordem hierarquica, pelo CODIGO do posto
// ---------------------------------------------------------------------------
describe('usuarios: ordem', () => {
  test('a lista nasce do posto mais alto para o mais baixo', async () => {
    const { container, cleanup } = await montar();

    escolherSituacao(container, '');
    const logins = linhas(container).map(l => textoDaLinha(l).join(' '));
    expect(logins[0]).toContain('cel.dias');
    expect(logins[1]).toContain('cap.alves');
    expect(logins[2]).toContain('cb.souza');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a coluna Posto/Grad ordena pelo codigo, e nunca pela abreviatura', async () => {
    const { container, cleanup } = await montar();

    escolherSituacao(container, '');
    const th = [...container.querySelectorAll('thead th')]
      .find(c => c.textContent.trim().startsWith('Posto/Grad'));
    expect(th.className).toContain('data-table__th--sortable');

    th.click();
    const logins = linhas(container).map(l => textoDaLinha(l).join(' '));
    // Crescente pelo codigo: Cb (5), Cap (13), Cel (16). Pela abreviatura, o
    // alfabeto poria Cap antes de Cb e de Cel.
    expect(logins[0]).toContain('cb.souza');
    expect(logins[1]).toContain('cap.alves');
    expect(logins[2]).toContain('cel.dias');

    if (typeof cleanup === 'function') cleanup();
  });
});

// ---------------------------------------------------------------------------
// 4, 5 e 6. Identidade, colunas novas e o rotulo do booleano
// ---------------------------------------------------------------------------
describe('usuarios: colunas', () => {
  test('identifica por posto e nome de guerra, e nao pelo nome completo', async () => {
    const { container, cleanup } = await montar();

    const primeira = textoDaLinha(linhas(container)[0]);
    expect(primeira[0]).toBe('Cap');
    expect(primeira[1]).toContain('Alves');

    if (typeof cleanup === 'function') cleanup();
  });

  test('mostra "Na DGEO desde" e "Último acesso"', async () => {
    const { container, cleanup } = await montar();

    const titulos = cabecalhos(container);
    expect(titulos).toContain('Na DGEO desde');
    expect(titulos).toContain('Último acesso');

    const doCabo = linhas(container)
      .map(textoDaLinha)
      .find(celulas => celulas.join(' ').includes('cb.souza'));
    expect(doCabo).toContain('10/03/2025');
    expect(doCabo.join(' ')).toContain('03/08/2026');

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem nunca entrou diz que nunca entrou, e nao um traco', async () => {
    const { container, cleanup } = await montar();

    const doCapitao = linhas(container)
      .map(textoDaLinha)
      .find(celulas => celulas.join(' ').includes('cap.alves'));
    expect(doCapitao).toContain('Nunca entrou');

    if (typeof cleanup === 'function') cleanup();
  });

  // O DDL so tem o booleano `ativo` (er/dgeo.sql:39), que governa o LOGIN. Nao
  // existe dominio de situacao de militar, e a coluna nao pode dizer que existe.
  test('a coluna do booleano diz que mede o LOGIN', async () => {
    const { container, cleanup } = await montar();

    const titulos = cabecalhos(container);
    expect(titulos).toContain('Situação do login');
    expect(titulos).not.toContain('Ativo');

    if (typeof cleanup === 'function') cleanup();
  });
});

// ---------------------------------------------------------------------------
// 7 e 9. As acoes de linha
// ---------------------------------------------------------------------------
describe('usuarios: acoes de linha', () => {
  test('sobram cinco acoes, sem as duas que o dialogo de edicao ja faz', async () => {
    const { container, cleanup } = await montar();

    const titulos = [...linhas(container)[0].querySelectorAll('.data-table__action-btn')]
      .map(b => b.getAttribute('title'));

    expect(titulos).toContain('Editar cadastro');
    expect(titulos).toContain('Definir perfis por módulo');
    expect(titulos).toContain('Resetar senha');
    expect(titulos.some(t => /Alternar/i.test(t))).toBe(false);
    expect(titulos.length).toBeLessThanOrEqual(5);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o Excluir some de quem ja tem registro no sistema', async () => {
    const { container, cleanup } = await montar();

    escolherSituacao(container, '');
    const porLogin = (login) => linhas(container)
      .find(l => textoDaLinha(l).join(' ').includes(login));

    const doCabo = [...porLogin('cb.souza').querySelectorAll('.data-table__action-btn')]
      .map(b => b.getAttribute('title'));
    const doCapitao = [...porLogin('cap.alves').querySelectorAll('.data-table__action-btn')]
      .map(b => b.getAttribute('title'));

    expect(doCabo).not.toContain('Excluir');
    expect(doCapitao).toContain('Excluir');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o historico ganha acao propria, e declara passagens e impedimentos', async () => {
    const { container, cleanup } = await montar();

    const btn = acao(container, 'Histórico e telas da pessoa');
    expect(btn).not.toBeUndefined();

    btn.click();
    await flush();

    const subtitulo = document.querySelector('.historico__subtitulo, .historico__sub');
    const texto = (subtitulo || document.querySelector('.modal')).textContent;
    expect(texto).toContain('passagens');
    expect(texto).toContain('impedimentos');

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });
});

// ---------------------------------------------------------------------------
// 8. Os saltos para as outras telas da pessoa
// ---------------------------------------------------------------------------
describe('usuarios: saltos para as outras telas', () => {
  test('a ficha leva ao aproveitamento, a capacitacao e a rastreabilidade, pelo uuid', async () => {
    const { container, cleanup } = await montar();

    acao(container, 'Histórico e telas da pessoa').click();
    await flush();

    const hrefs = [...document.querySelectorAll('.modal a')].map(a => a.getAttribute('href'));
    expect(hrefs).toContain('#/aproveitamento?usuario_uuid=u-cap');
    expect(hrefs).toContain('#/capacitacao_recebida?usuario_uuid=u-cap');
    expect(hrefs).toContain('#/rastreabilidade?usuario_uuid=u-cap');

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });
});

// ---------------------------------------------------------------------------
// 11 e 12. Erro do catalogo e acessibilidade do aviso
// ---------------------------------------------------------------------------
describe('usuarios: erro e acessibilidade', () => {
  // Sem o catalogo de modulos a tabela perdia TODAS as colunas de modulo e
  // seguia em frente: a tela dizia, em silencio, que ninguem tem acesso a nada.
  test('falha do catalogo mostra erro com "Tentar de novo", e nao a tabela vazia', async () => {
    getModulos.mockRejectedValueOnce(new Error('Erro ao carregar o catálogo'));
    const { container, cleanup } = await montar();

    const erro = container.querySelector('[role="alert"]');
    expect(erro).not.toBeNull();
    expect(container.querySelector('table')).toBeNull();

    const botao = [...container.querySelectorAll('button')]
      .find(b => /Tentar de novo/i.test(b.textContent));
    expect(botao).not.toBeUndefined();

    // O retry refaz a tela inteira, com as colunas de modulo de volta.
    botao.click();
    await flush();
    await flush();
    expect(cabecalhos(container)).toContain('Mapoteca');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o aviso de quem esta sem senha se anuncia para o leitor de tela', async () => {
    getUsuarios.mockResolvedValue([{ ...CABO, senha_definida: false }]);
    const { container, cleanup } = await montar();

    const aviso = container.querySelector('.usuarios__aviso');
    expect(aviso.getAttribute('role')).toBe('status');
    // Uma frase curta: o texto longo era o que ninguem lia.
    expect(aviso.textContent.length).toBeLessThanOrEqual(90);

    if (typeof cleanup === 'function') cleanup();
  });
});
