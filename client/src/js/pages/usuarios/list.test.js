import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Tela de GESTÃO de usuarios: uma coluna por modulo. Mocka o service de
// plataforma.
//
// O SCA CRIA a pessoa e define a senha dela. Não existe importar nem
// sincronizar, e se as duas voltarem ao service este mock não as devolve e a
// tela quebra.
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
  atualizarUsuario, criarUsuario, excluirUsuario, resetarSenhas,
} from '@services/plataforma-service.js';
import { showError } from '@utils/toast.js';

const MODULOS = [
  { code: 1, nome: 'Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Orçamento', nome_abrev: 'orcamento' },
];

const PERFIS = [
  { code: 1, nome: 'Consulta' },
  { code: 2, nome: 'Operador' },
  { code: 3, nome: 'Gerente' },
];

// Os codigos sao os do DDL (er/dominio.sql:11-30), e nao numeros inventados: a
// tela passou a ORDENAR por eles, entao um codigo falso aqui ensinaria errado.
const POSTOS = [
  { code: 6, nome: 'Terceiro Sargento', nome_abrev: '3º Sgt' },
  { code: 7, nome: 'Segundo Sargento', nome_abrev: '2º Sgt' },
];

const USUARIO = {
  uuid: 'u-1',
  login: 'sgt.silva',
  nome: 'Silva',
  nome_guerra: 'Silva',
  tipo_posto_grad_id: 6,
  tipo_posto_grad: '3º Sgt',
  administrador: false,
  ativo: true,
  senha_definida: true,
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
  getPostosGrad.mockResolvedValue(POSTOS);
});

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderUsuariosList(container, { params: {}, query: new URLSearchParams() });
  await flush();
  await flush();
  return { container, cleanup };
}

/** Botao de acao da linha pelo `title`, que e como a tela os distingue. */
const acao = (container, titulo) => [...container.querySelectorAll('.data-table__action-btn')]
  .find(b => b.getAttribute('title') === titulo);

const botaoModal = (rotulo) => [...document.querySelectorAll('.modal__footer button')]
  .find(b => b.textContent.startsWith(rotulo));

const campoModal = (rotulo) => {
  const label = [...document.querySelectorAll('.modal .form-field__label')]
    .find(l => l.textContent.replace('*', '').trim() === rotulo);
  return document.getElementById(label.getAttribute('for'));
};

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
    expect(cabecalhos).toContain('Acervo');
    expect(cabecalhos).toContain('Mapoteca');
    expect(cabecalhos).toContain('Orçamento');

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
    // A célula da situação do login é assunto do caso 'a coluna do booleano diz
    // que mede o LOGIN', em list.gestao.test.js.

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
    expect(criarUsuario).not.toHaveBeenCalled();
    if (typeof cleanup === 'function') cleanup();
  });
});

// ---------------------------------------------------------------------------
// A tela deixou de espelhar o Auth Server e passou a CADASTRAR
// ---------------------------------------------------------------------------
describe('usuarios: o cadastro e do SCA, e nao mais uma importacao', () => {
  test('o topo oferece "Novo usuário", e nenhum caminho de importar ou sincronizar', async () => {
    const { container, cleanup } = await montar();

    const rotulos = [...container.querySelectorAll('.page__actions button')]
      .map(b => b.textContent.trim());
    expect(rotulos).toEqual(['Novo usuário']);
    expect(rotulos.some(r => /Importar|Sincronizar/i.test(r))).toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });

  test('criar manda login, senha, identidade e as duas flags num corpo so', async () => {
    const { container, cleanup } = await montar();

    container.querySelector('.page__actions button').click();
    await flush();

    campoModal('Login').value = 'cb.souza';
    campoModal('Senha inicial').value = 'trocar123';
    campoModal('Nome completo').value = 'João de Souza';
    campoModal('Nome de guerra').value = 'Souza';
    campoModal('Posto/Graduação').value = '7';

    botaoModal('Salvar').click();
    await flush();

    expect(criarUsuario).toHaveBeenCalledWith({
      login: 'cb.souza',
      senha: 'trocar123',
      nome: 'João de Souza',
      nome_guerra: 'Souza',
      tipo_posto_grad_id: 7,
      administrador: false,
      // Quem nasce inativo nao entra: o padrao do formulario e ativo.
      ativo: true,
    });

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });

  test('a criacao pede senha; a edicao NAO, porque quem troca e o dono ou o reset', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    container.querySelector('.page__actions button').click();
    await flush();
    expect([...document.querySelectorAll('.modal input[type="password"]')]).toHaveLength(1);

    botaoModal('Cancelar').click();
    await flush();

    acao(container, 'Editar cadastro').click();
    await flush();
    expect([...document.querySelectorAll('.modal input[type="password"]')]).toHaveLength(0);

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });

  // Omitir um campo vale "nao mexe" no servidor (preserveOmitted). Mandar o
  // valor atual de volta funcionaria hoje e apagaria o campo no dia em que a
  // tela mandasse um vazio para preencher o corpo.
  test('editar manda as duas flags obrigatorias e SO o campo que mudou', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    acao(container, 'Editar cadastro').click();
    await flush();

    campoModal('Nome completo').value = 'Silva da Silva';

    botaoModal('Salvar').click();
    await flush();

    expect(atualizarUsuario).toHaveBeenCalledWith('u-1', {
      administrador: false,
      ativo: true,
      nome: 'Silva da Silva',
    });

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });

  test('campo obrigatorio vazio nao vira corpo com string vazia: recusa na tela', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    acao(container, 'Editar cadastro').click();
    await flush();

    campoModal('Nome de guerra').value = '';
    botaoModal('Salvar').click();
    await flush();

    expect(atualizarUsuario).not.toHaveBeenCalled();
    expect([...document.querySelectorAll('.modal .form-field__error')]
      .some(e => e.textContent === 'Informe o nome de guerra')).toBe(true);

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });
});

describe('usuarios: senha', () => {
  // `senha_definida: false` é quem NÃO CONSEGUE ENTRAR. Sem marca na tela, essa
  // gente só apareceria ao reclamar que o login não funciona.
  test('quem esta sem senha leva marca na linha e entra na contagem do aviso', async () => {
    getUsuarios.mockResolvedValue([
      { ...USUARIO, senha_definida: false },
      { ...USUARIO, uuid: 'u-2', login: 'cb.souza', nome: 'Souza', senha_definida: false },
      { ...USUARIO, uuid: 'u-3', login: 'ten.lima', nome: 'Lima', senha_definida: true },
    ]);
    const { container, cleanup } = await montar();

    expect(container.querySelectorAll('.usuarios__chip-sem-senha')).toHaveLength(2);
    const aviso = container.querySelector('.usuarios__aviso');
    expect(aviso.classList.contains('hidden')).toBe(false);
    expect(aviso.textContent).toContain('2 pessoas');

    if (typeof cleanup === 'function') cleanup();
  });

  test('com todo mundo com senha, o aviso nao aparece', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    expect(container.querySelectorAll('.usuarios__chip-sem-senha')).toHaveLength(0);
    expect(container.querySelector('.usuarios__aviso').classList.contains('hidden')).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  // A senha vira o LOGIN, que qualquer um adivinha. A confirmacao tem de dizer
  // isso com todas as letras, e dizer o login: e o que separa "resetei a senha"
  // de "abri a conta desta pessoa para quem souber o login dela".
  test('resetar senha confirma dizendo que a senha passa a ser o login', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    acao(container, 'Resetar senha').click();
    await flush();

    expect(document.querySelector('.modal__message').textContent).toContain('sgt.silva');
    expect(resetarSenhas).not.toHaveBeenCalled();

    botaoModal('Resetar senha').click();
    await flush();

    expect(resetarSenhas).toHaveBeenCalledWith(['u-1']);

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });
});

describe('usuarios: excluir', () => {
  test('exclui depois de confirmar', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    acao(container, 'Excluir').click();
    await flush();
    botaoModal('Excluir').click();
    await flush();

    expect(excluirUsuario).toHaveBeenCalledWith('u-1');

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });

  // O servidor quase sempre RECUSA, e a frase dele diz o que fazer em seguida
  // ("Desative-o."). Uma mensagem generica aqui esconderia justamente isso.
  test('a recusa do servidor sobe para a tela COMO ELA VEIO', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    excluirUsuario.mockRejectedValueOnce(
      new Error('Usuário já possui registros no sistema e não pode ser excluído. Desative-o.')
    );
    const { container, cleanup } = await montar();

    acao(container, 'Excluir').click();
    await flush();
    botaoModal('Excluir').click();
    await flush();

    expect(showError).toHaveBeenCalledWith(
      'Usuário já possui registros no sistema e não pode ser excluído. Desative-o.'
    );

    if (typeof cleanup === 'function') cleanup();
    document.body.innerHTML = '';
  });
});

describe('usuarios: perfis por modulo', () => {
  // O <select> por modulo virou um controle segmentado: os quatro niveis a
  // vista, na ordem da hierarquia, em vez de escondidos atras de um clique.
  const linhasPerfil = () => [...document.querySelectorAll('.modal .perfil-linha')];
  const nivelAtivo = (linha) => linha.querySelector('.seletor-nivel__item--ativo').textContent;
  const escolherNivel = (linha, rotulo) => {
    [...linha.querySelectorAll('.seletor-nivel__item')]
      .find(b => b.textContent === rotulo)
      .click();
  };
  const botaoSalvar = () => botaoModal('Salvar');

  test('o modal de perfis traz um seletor por modulo, marcando o nivel atual', async () => {
    getUsuarios.mockResolvedValue([USUARIO]);
    const { container, cleanup } = await montar();

    acao(container, 'Definir perfis por módulo').click();
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

    acao(container, 'Definir perfis por módulo').click();
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

    acao(container, 'Definir perfis por módulo').click();
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

    acao(container, 'Definir perfis por módulo').click();
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
