import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Meu perfil (#/perfil): o proprio cadastro e a troca da PROPRIA senha, que so
// passaram a existir, com a autenticacao vindo para dentro do SCA. Desde
// 2026-08-08 tambem o PROPRIO aproveitamento.
//
// AS ROTAS DO GERENTE FICAM DUBLADAS E RECUSANDO. Elas sao `verifyPerfil('gerente',
// 'efetivo')`, e a secao "Meu aproveitamento" nunca pode alcanca-las: com um duble
// que resolvesse, a tela que voltasse a chama-las passaria despercebida.
vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  const doGerente = (nome) => vi.fn(() => Promise.reject(
    new Error(`Usuário necessita do perfil gerente no módulo efetivo (${nome})`)
  ));
  return {
    ...real,
    getMeuPerfil: vi.fn(() => Promise.resolve({})),
    atualizarMeuPerfil: vi.fn(() => Promise.resolve(null)),
    alterarMinhaSenha: vi.fn(() => Promise.resolve(null)),
    getPostosGrad: vi.fn(() => Promise.resolve([])),

    getMeuPeriodoEfetivo: vi.fn(() => Promise.resolve([])),
    getMeuImpedimento: vi.fn(() => Promise.resolve([])),
    // A GRADE DO PROPRIO ANO. `getMapaEfetivo` fica DUBLADO E RECUSANDO, logo
    // abaixo: ele e `verifyPerfil('consulta','efetivo')` e devolve a Divisao
    // inteira, e a secao que se enganasse de rota falharia no servidor de quem
    // trabalha so no acervo, e nao aqui.
    getMeuAproveitamento: vi.fn(() => Promise.resolve({ ano: 2026, semanas: [], anual: [] })),
    getMapaEfetivo: vi.fn(() => Promise.reject(
      new Error('Usuário necessita do perfil consulta no módulo efetivo (getMapaEfetivo)')
    )),
    createMeuPeriodoEfetivo: vi.fn(() => Promise.resolve({ id: 1 })),
    updateMeuPeriodoEfetivo: vi.fn(() => Promise.resolve({ id: 1 })),
    deleteMeuPeriodoEfetivo: vi.fn(() => Promise.resolve(null)),
    createMeuImpedimento: vi.fn(() => Promise.resolve({ id: 1 })),
    updateMeuImpedimento: vi.fn(() => Promise.resolve({ id: 1 })),
    deleteMeuImpedimento: vi.fn(() => Promise.resolve(null)),

    createPeriodoEfetivo: doGerente('createPeriodoEfetivo'),
    updatePeriodoEfetivo: doGerente('updatePeriodoEfetivo'),
    deletePeriodoEfetivo: doGerente('deletePeriodoEfetivo'),
    createImpedimento: doGerente('createImpedimento'),
    updateImpedimento: doGerente('updateImpedimento'),
    deleteImpedimento: doGerente('deleteImpedimento'),
  };
});

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
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
  getMeuPeriodoEfetivo, getMeuImpedimento, getMeuAproveitamento,
  createMeuPeriodoEfetivo, deleteMeuImpedimento,
  createPeriodoEfetivo, deleteImpedimento, getMapaEfetivo,
} from '@services/plataforma-service.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
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
  { code: 1, nome: 'Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
];

// O ANO CORRENTE e a regua da grade: "ano com passagem" e "ano futuro" so
// existem em relacao a ele, e fixar 2026 no arquivo faria os casos mentirem na
// virada do ano.
const ANO = new Date().getFullYear();

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
  getMeuPeriodoEfetivo.mockResolvedValue([]);
  getMeuImpedimento.mockResolvedValue([]);
  getMeuAproveitamento.mockResolvedValue({ ano: ANO, semanas: [], anual: [] });
  confirmDialog.mockResolvedValue(true);
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
    expect(linhas.join(' ')).toContain('Acervo');
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

// ---------------------------------------------------------------------------
// Meu aproveitamento
//
// POR QUE ESTA SECAO EXISTE. Em 2026-08-08 a escrita da passagem e do impedimento
// DOS OUTROS subiu para o gerente do modulo Efetivo, e `#/aproveitamento` deixou
// de abrir para o operador. Sem esta secao, ninguem abaixo do gerente teria como
// declarar o PROPRIO impedimento -- e o aproveitamento da 6.1 do RPCMTec depende
// de cada um declarar o seu.
//
// O QUE OS CASOS FIXAM, e que nao se ve olhando a tela:
//  - a secao grava pelas rotas do PROPRIO (`/efetivo/meu_*`), e NUNCA pelas do
//    gerente. Os dubles das do gerente RECUSAM, entao a tela que se enganar de
//    rota falha aqui em vez de falhar no servidor de quem usa;
//  - `usuario_uuid` NAO viaja no corpo: quem decide o dono e o token;
//  - quem nao tem perfil em modulo nenhum nao ve a secao, porque a rota e
//    `verifyAcesso` e responderia 403;
//  - a falha ao carregar fica DENTRO da secao. Junta-la ao `getMeuPerfil` num
//    `Promise.all` repetiria o defeito que derrubava `#/aproveitamento` inteira.
// ---------------------------------------------------------------------------
describe('perfil: meu aproveitamento', () => {
  const PASSAGEM = {
    id: 7, usuario_uuid: 'u-1', data_inicio: '2026-03-01', data_fim: null,
    observacao: 'Vindo do 5 CGEO',
  };

  const IMPEDIMENTO = {
    id: 9, usuario_uuid: 'u-1', descricao: 'Chefe do S5', percentual: 50,
    data_inicio: '2026-04-01', data_fim: null,
  };

  const secoes = (container) => [...container.querySelectorAll('.perfil__secao-titulo')]
    .map(h => h.textContent);

  // Dentro do CONTAINER, e não do documento: a página de perfil é montada num nó
  // solto, e só os modais vão para o `body`.
  const linhaDa = (container, texto) =>
    [...container.querySelectorAll('.ficha-militar__linha')]
      .find(d => d.textContent.includes(texto));

  const botao = (raiz, titulo) => [...raiz.querySelectorAll('button')]
    .find(b => b.title === titulo);

  test('a secao fica entre "Meus acessos" e "Meus dados"', async () => {
    const { container, cleanup } = await montar();

    // A ORDEM E A DECISAO: quem abre esta pagina abre pelo que pode e pelo que
    // precisa declarar. Corrigir o nome de guerra e ato raro, e vem depois.
    expect(secoes(container)).toEqual([
      'Meus acessos', 'Meu aproveitamento', 'Meus dados', 'Trocar senha',
    ]);

    if (typeof cleanup === 'function') cleanup();
  });

  test('lista a propria passagem e o proprio impedimento', async () => {
    getMeuPeriodoEfetivo.mockResolvedValue([PASSAGEM]);
    getMeuImpedimento.mockResolvedValue([IMPEDIMENTO]);

    const { container, cleanup } = await montar();

    expect(getMeuPeriodoEfetivo).toHaveBeenCalled();
    expect(getMeuImpedimento).toHaveBeenCalled();

    const ficha = container.querySelector('.ficha-militar');
    expect(ficha).not.toBeNull();
    // A passagem em aberto se le como "Atual", e nao como campo em branco.
    expect(ficha.textContent).toContain('Atual');
    expect(ficha.textContent).toContain('Chefe do S5 (50%)');

    if (typeof cleanup === 'function') cleanup();
  });

  test('cadastrar passagem vai pela rota do PROPRIO, sem usuario_uuid no corpo', async () => {
    const { container, cleanup } = await montar();

    const secaoPassagens = [...container.querySelectorAll('.ficha-militar__secao')]
      .find(s => s.textContent.includes('Passagens pela DGEO'));
    [...secaoPassagens.querySelectorAll('button')]
      .find(b => b.textContent === 'Nova')
      .click();
    await flush();

    const modal = document.querySelector('.modal');
    expect(modal).not.toBeNull();
    // O SELETOR DE MILITAR NAO EXISTE aqui: a pessoa ja e conhecida, e um
    // controle com uma opcao so seria a pergunta que a pagina ja respondeu.
    expect(modal.textContent).not.toContain('Militar');

    modal.querySelector('input[type="date"]').value = '2026-03-01';

    [...document.querySelectorAll('button')]
      .find(b => b.textContent === 'Salvar')
      .click();
    await flush();
    await flush();

    // O CORPO NAO LEVA O DONO. O servidor o toma de `req.usuarioUuid`, e mandar
    // o campo aqui seria uma chave desconhecida, descartada com aviso.
    expect(createMeuPeriodoEfetivo).toHaveBeenCalledWith({
      data_inicio: '2026-03-01',
      data_fim: null,
      observacao: null,
    });
    // E a rota do GERENTE nao foi tocada. O duble dela RECUSA: sem esta linha, a
    // tela que se enganasse de rota so falharia no servidor de quem usa.
    expect(createPeriodoEfetivo).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  test('excluir impedimento vai pela rota do PROPRIO', async () => {
    getMeuImpedimento.mockResolvedValue([IMPEDIMENTO]);

    const { container, cleanup } = await montar();

    botao(linhaDa(container, 'Chefe do S5'), 'Excluir').click();
    await flush();
    await flush();

    expect(deleteMeuImpedimento).toHaveBeenCalledWith(9);
    expect(deleteImpedimento).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  // A rota e `verifyAcesso`: quem nao tem perfil em modulo NENHUM leva 403 dela.
  // Oferecer o botao seria prometer o que a conta ainda nao pode.
  test('sem acesso a modulo nenhum, a secao nao aparece e as rotas nao sao chamadas', async () => {
    logar({ perfis: {} });
    const { container, cleanup } = await montar();

    expect(secoes(container)).not.toContain('Meu aproveitamento');
    expect(getMeuPeriodoEfetivo).not.toHaveBeenCalled();
    expect(getMeuImpedimento).not.toHaveBeenCalled();
    expect(getMeuAproveitamento).not.toHaveBeenCalled();
    // E a pagina continua sendo dela: os dois formularios seguem la.
    expect(container.querySelectorAll('.perfil__form')).toHaveLength(2);

    if (typeof cleanup === 'function') cleanup();
  });

  // O DEFEITO QUE ISTO FECHA e o mesmo que derrubava `#/aproveitamento`: uma
  // chamada que pode recusar dentro do `Promise.all` da pagina mata a pagina
  // inteira. Aqui a falha fica dentro da secao.
  test('a falha do aproveitamento nao derruba a pagina', async () => {
    getMeuImpedimento.mockRejectedValueOnce(new Error('Falha de rede'));

    const { container, cleanup } = await montar();

    const erro = container.querySelector('.perfil__erro');
    expect(erro).not.toBeNull();
    expect(erro.textContent).toBe('Falha de rede');
    // Os dois formularios continuam de pe, e o cadastro tambem.
    expect(container.querySelectorAll('.perfil__form')).toHaveLength(2);
    expect(campo(container, 'Login').value).toBe('sgt.silva');
    // E A GRADE CONTINUA LA: ela vem de outra rota, e a falha das listas nao
    // pode apaga-la. (A fixture nao tem passagem, entao o que se le e o vazio
    // dela, e nao a tabela.)
    expect(getMeuAproveitamento).toHaveBeenCalled();
    expect(container.querySelector('.mapa-efetivo__legenda')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});

// ---------------------------------------------------------------------------
// A GRADE do proprio ano, dentro de "Meu aproveitamento"
//
// POR QUE ELA EXISTE. Ate 2026-08-08 a secao listava as passagens e os
// impedimentos em texto e deixava cadastra-los, e o que faltava era VER: 53
// celulas dizem de relance onde estao os buracos do ano, e a lista abaixo diz
// por que. E a mesma visualizacao de `#/aproveitamento`, com UMA linha.
//
// O QUE OS CASOS FIXAM, e que nao se ve olhando a tela:
//  - a grade vem de `getMeuAproveitamento` (`verifyAcesso`), e NUNCA de
//    `getMapaEfetivo`, que e do modulo Efetivo e devolve a Divisao inteira. O
//    duble daquela RECUSA, entao a secao que se enganar de rota falha aqui;
//  - o desenho e o COMPONENTE COMPARTILHADO: 53 colunas, a coluna "Ano" e as
//    classes de faixa sao as mesmas que `#/aproveitamento` desenha;
//  - a LEGENDA fica junto. Quem ve a propria linha sozinha nao tem as outras
//    para comparar, e sem ela a cor nao diz nada;
//  - trocar o ano refaz a carga da grade, e SO dela: as duas listas nao tem
//    recorte de ano, porque as rotas do proprio devolvem a vida inteira.
// ---------------------------------------------------------------------------
describe('perfil: a grade do proprio ano', () => {
  // Chegou em marco: as semanas de janeiro e fevereiro nao existem na resposta
  // do servidor, e a grade as desenha vazias assim mesmo.
  const ANUAL = [{
    usuario_uuid: 'u-1', nome_guerra: 'Silva', ativo: true, posto_abrev: '3 Sgt',
    dias_do_ano: 365, dias_na_dgeo: 301, aproveitamento: '82.5',
  }];

  const SEMANAS = [
    { usuario_uuid: 'u-1', semana: 1, dias: 7, dias_na_dgeo: 0, disponibilidade: '0.0' },
    { usuario_uuid: 'u-1', semana: 20, dias: 7, dias_na_dgeo: 7, disponibilidade: '50.0' },
  ];

  const comGrade = () =>
    getMeuAproveitamento.mockResolvedValue({ ano: ANO, semanas: SEMANAS, anual: ANUAL });

  const linhas = (container) => [...container.querySelectorAll('.mapa-efetivo__linha')];
  const celulas = (tr) => [...tr.querySelectorAll('.mapa-efetivo__celula')];

  const seletorDeAno = (container) => {
    const label = [...container.querySelectorAll('.form-field__label')]
      .find(l => l.textContent.replace('*', '').trim() === 'Ano');
    return container.querySelector(`#${label.getAttribute('for')}`);
  };

  test('desenha UMA linha, com as 53 semanas do ano e a coluna do total', async () => {
    comGrade();
    const { container, cleanup } = await montar();

    expect(getMeuAproveitamento).toHaveBeenCalledWith(ANO);
    // E NUNCA a rota da Divisao, que e do modulo Efetivo: o duble dela RECUSA.
    expect(getMapaEfetivo).not.toHaveBeenCalled();

    expect(linhas(container)).toHaveLength(1);
    // A grade e o ANO, e nao o periodo da pessoa: quem chegou em marco tem as
    // mesmas 53 celulas, com as primeiras vazias.
    expect(celulas(linhas(container)[0])).toHaveLength(53);

    const total = container.querySelector('tbody .mapa-efetivo__total');
    // O denominador e o ano INTEIRO, e e o que faz 301 dias darem 82,5%.
    expect(total.textContent).toBe('82,5%');
    expect(total.title).toBe('301 de 365 dias na DGEO');

    if (typeof cleanup === 'function') cleanup();
  });

  // O CORACAO DA LEITURA, e o que a extracao do componente nao pode perder:
  // celula SEM cor e "nao estava na Divisao", e e diferente de vermelha, que e
  // "estava e nao rendeu".
  test('fora da DGEO nao se confunde com impedido, e o title explica a cor', async () => {
    comGrade();
    getMeuImpedimento.mockResolvedValue([{
      id: 9, usuario_uuid: 'u-1', descricao: 'Chefe do S5', percentual: 50,
      data_inicio: `${ANO}-01-01`, data_fim: null,
    }]);

    const { container, cleanup } = await montar();

    const [minha] = linhas(container);
    expect(celulas(minha)[0].className).toContain('mapa-efetivo__celula--fora');
    expect(celulas(minha)[0].title).toBe('Fora da DGEO');

    expect(celulas(minha)[19].className).toContain('mapa-efetivo__celula--f50');
    expect(celulas(minha)[19].title).toContain('7 de 7 dias na DGEO');
    // O impedimento explica a cor sem ocupar espaco na tabela.
    expect(celulas(minha)[19].title).toContain('Chefe do S5 (50%)');

    if (typeof cleanup === 'function') cleanup();
  });

  // A LEGENDA E OBRIGATORIA AQUI. No mapa da Divisao a escala se adivinha
  // comparando as linhas umas com as outras; com uma linha so, nao ha com o que
  // comparar.
  test('a legenda das cores fica na tela, e nomeia "fora da DGEO"', async () => {
    comGrade();
    const { container, cleanup } = await montar();

    const legenda = container.querySelector('.mapa-efetivo__legenda');
    expect(legenda).not.toBeNull();
    expect(legenda.textContent).toContain('fora da DGEO');
    expect(legenda.textContent).toContain('abaixo de 25%');
    expect(legenda.querySelectorAll('.mapa-efetivo__amostra')).toHaveLength(6);

    if (typeof cleanup === 'function') cleanup();
  });

  // OS DOIS DENOMINADORES, e nao um numero so: 82,5% e o ano inteiro (o numero
  // que o fechamento publica) e 100% sao os dias em que a pessoa esteve aqui.
  test('o resumo diz os DOIS denominadores, com o nome de cada um', async () => {
    comGrade();
    const { container, cleanup } = await montar();

    const resumo = container.querySelector('.efetivo-resumo');
    expect(resumo.textContent).toContain('sobre o ano inteiro');
    expect(resumo.textContent).toContain('82,5%');
    // (0,825 x 365) / 301 = 100%
    expect(resumo.textContent).toContain('301 dias');
    expect(resumo.textContent).toContain('100%');

    if (typeof cleanup === 'function') cleanup();
  });

  test('trocar o ano refaz a carga da grade, e so dela', async () => {
    comGrade();
    getMeuPeriodoEfetivo.mockResolvedValue([{
      id: 7, usuario_uuid: 'u-1', data_inicio: `${ANO - 2}-03-01`,
      data_fim: `${ANO - 2}-12-31`, observacao: null,
    }]);

    const { container, cleanup } = await montar();

    expect(getMeuAproveitamento).toHaveBeenCalledTimes(1);
    const chamadasDaLista = getMeuPeriodoEfetivo.mock.calls.length;

    const select = seletorDeAno(container);
    // O seletor oferece o ano da passagem, e nao uma janela fixa.
    expect([...select.options].map(o => o.value)).toContain(String(ANO - 2));

    select.value = String(ANO - 2);
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(getMeuAproveitamento).toHaveBeenCalledTimes(2);
    expect(getMeuAproveitamento).toHaveBeenLastCalledWith(ANO - 2);
    // AS LISTAS NAO SE REFAZEM: as rotas do proprio nao tem recorte de ano, e
    // pedi-las de novo seria a mesma resposta.
    expect(getMeuPeriodoEfetivo).toHaveBeenCalledTimes(chamadasDaLista);

    if (typeof cleanup === 'function') cleanup();
  });

  // Cadastrar o impedimento e ver a lista crescer sem a cor da semana mudar
  // faria a grade parecer um retrato velho, e a pessoa duvidaria de qual dos
  // dois vale.
  test('cadastrar uma passagem repinta a grade', async () => {
    comGrade();
    const { container, cleanup } = await montar();

    expect(getMeuAproveitamento).toHaveBeenCalledTimes(1);

    const secaoPassagens = [...container.querySelectorAll('.ficha-militar__secao')]
      .find(s => s.textContent.includes('Passagens pela DGEO'));
    [...secaoPassagens.querySelectorAll('button')]
      .find(b => b.textContent === 'Nova')
      .click();
    await flush();

    document.querySelector('.modal').querySelector('input[type="date"]').value =
      `${ANO}-03-01`;
    [...document.querySelectorAll('button')]
      .find(b => b.textContent === 'Salvar')
      .click();
    await flush();
    await flush();

    expect(getMeuAproveitamento).toHaveBeenCalledTimes(2);

    if (typeof cleanup === 'function') cleanup();
  });

  // Sem passagem no ano nao ha grade, e a frase diz de QUE ano se fala: a tabela
  // vazia se leria como defeito da tela.
  test('sem passagem no ano, a grade explica o vazio em vez de sumir', async () => {
    const { container, cleanup } = await montar();

    expect(container.querySelector('.mapa-efetivo__tabela')).toBeNull();
    expect(container.querySelector('.mapa-efetivo__vazio').textContent)
      .toContain(`em ${ANO}`);
    // A legenda continua la: ela explica a grade do ano que a pessoa escolher em
    // seguida, e some-la faria a tela piscar duas caras diferentes.
    expect(container.querySelector('.mapa-efetivo__legenda')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  // A FALHA DA GRADE FICA NA GRADE. Ela vem de outra rota que as duas listas, e
  // derrubar a secao inteira repetiria o defeito que matava `#/aproveitamento`.
  test('a falha da grade nao apaga as listas do proprio', async () => {
    getMeuAproveitamento.mockRejectedValueOnce(new Error('Falha ao ler o ano'));
    getMeuImpedimento.mockResolvedValue([{
      id: 9, usuario_uuid: 'u-1', descricao: 'Chefe do S5', percentual: 50,
      data_inicio: `${ANO}-04-01`, data_fim: null,
    }]);

    const { container, cleanup } = await montar();

    expect(container.querySelector('.mapa-efetivo').textContent)
      .toContain('Falha ao ler o ano');
    // A ficha continua de pe, com o impedimento que a pessoa declarou.
    expect(container.querySelector('.ficha-militar').textContent)
      .toContain('Chefe do S5 (50%)');

    if (typeof cleanup === 'function') cleanup();
  });
});
