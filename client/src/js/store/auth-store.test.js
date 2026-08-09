import { describe, test, expect } from 'vitest';
import {
  saveAuth, getToken, getUsername, getUserUuid,
  isAuthenticated, isAdmin, clearAuth,
  getPerfil, temPerfil, temAcessoModulo, getCatalogoModulos, nomeModulo,
  permissoes, atualizarSessao, temAlgumAcesso, meusAcessos,
  instituicaoDaSessao, nomeInstituicao, siglaInstituicao,
} from './auth-store.js';

const CATALOGO = [
  { code: 1, nome: 'Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Orçamento', nome_abrev: 'orcamento' },
];

describe('auth-store: sessao', () => {
  test('saveAuth guarda token, papel e sessao valida', () => {
    saveAuth({ token: 'jwt-abc', administrador: true, uuid: 'u-1' }, 'fulano');
    expect(getToken()).toBe('jwt-abc');
    expect(getUsername()).toBe('fulano');
    expect(getUserUuid()).toBe('u-1');
    expect(isAuthenticated()).toBe(true);
    expect(isAdmin()).toBe(true);
  });

  // REGRESSAO: com a duracao da sessao escrita duas vezes, no servidor
  // (expiresIn) e aqui, os dois divergem e a pessoa cai fora no meio do
  // trabalho. A expiracao sai do claim `exp` do proprio token.
  test('a expiracao vem do claim exp do token, nao de um valor fixo', () => {
    const emOitoHoras = Math.floor(Date.now() / 1000) + 8 * 3600;
    const payload = btoa(JSON.stringify({ exp: emOitoHoras }));
    saveAuth({ token: `cabecalho.${payload}.assinatura`, administrador: false }, 'fulano');

    const guardado = new Date(localStorage.getItem('@sca-Token-Expiry')).getTime();
    const esperado = emOitoHoras * 1000;
    expect(Math.abs(guardado - esperado)).toBeLessThan(2000);

    // Sete horas a frente a sessao AINDA vale. Com o valor fixo de 1h, nao valeria.
    const seteHoras = Date.now() + 7 * 3600 * 1000;
    expect(guardado).toBeGreaterThan(seteHoras);
    expect(isAuthenticated()).toBe(true);
  });

  test('token sem exp legivel cai no padrao conservador de 1 hora', () => {
    // Fixture curta de proposito: o guard anti-vazamento trata `token: <valor>`
    // com 12 caracteres ou mais como possivel credencial de verdade.
    saveAuth({ token: 'nao-jwt', administrador: false }, 'fulano');
    const guardado = new Date(localStorage.getItem('@sca-Token-Expiry')).getTime();

    expect(isAuthenticated()).toBe(true);
    expect(guardado).toBeGreaterThan(Date.now() + 55 * 60 * 1000);
    expect(guardado).toBeLessThan(Date.now() + 65 * 60 * 1000);
  });

  test('usuario comum nao e admin', () => {
    saveAuth({ token: 'jwt-xyz', administrador: false, uuid: 'u-2' }, 'beltrano');
    expect(isAdmin()).toBe(false);
    expect(isAuthenticated()).toBe(true);
  });

  test('sessao expirada nao autentica', () => {
    saveAuth({ token: 't', administrador: true, uuid: 'u' }, 'x');
    localStorage.setItem('@sca-Token-Expiry', new Date(Date.now() - 1000).toISOString());
    expect(isAuthenticated()).toBe(false);
  });

  test('clearAuth limpa tudo', () => {
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: { acervo: 1 } }, 'x');
    clearAuth();
    expect(getToken()).toBeNull();
    expect(isAuthenticated()).toBe(false);
    expect(getPerfil('acervo')).toBe(0);
  });

  test('a sessao e UNICA: prefixo @sca-, sem chave por modulo', () => {
    saveAuth({ token: 'tk', administrador: false, uuid: 'u', perfis: { mapoteca: 2 } }, 'x');
    expect(localStorage.getItem('@sca-Token')).toBe('tk');
    // As chaves antigas, uma por client, nao podem voltar a existir
    expect(localStorage.getItem('@mapoteca-Token')).toBeNull();
    expect(localStorage.getItem('@orcamento-Token')).toBeNull();
  });
});

describe('auth-store: perfil POR MODULO', () => {
  test('o nivel e lido do mapa perfis, por modulo', () => {
    saveAuth({ token: 't', administrador: false, uuid: 'u', perfis: { acervo: 1, orcamento: 3 } }, 'x');
    expect(getPerfil('acervo')).toBe(1);
    expect(getPerfil('orcamento')).toBe(3);
    expect(getPerfil('mapoteca')).toBe(0);
  });

  test('temPerfil e hierarquico dentro do modulo', () => {
    saveAuth({ token: 't', administrador: false, uuid: 'u', perfis: { orcamento: 3 } }, 'x');
    expect(temPerfil('consulta', 'orcamento')).toBe(true);
    expect(temPerfil('operador', 'orcamento')).toBe(true);
    expect(temPerfil('gerente', 'orcamento')).toBe(true);
    // O nivel num modulo nao vaza para outro
    expect(temPerfil('consulta', 'acervo')).toBe(false);
  });

  test('gerente num modulo nao satisfaz gerente em outro', () => {
    saveAuth({ token: 't', administrador: false, uuid: 'u', perfis: { mapoteca: 2 } }, 'x');
    expect(temPerfil('gerente', 'mapoteca')).toBe(false);
    expect(temPerfil('operador', 'mapoteca')).toBe(true);
  });

  test('sem linha de perfil, sem acesso nenhum ao modulo', () => {
    saveAuth({ token: 't', administrador: false, uuid: 'u', perfis: { acervo: 2 } }, 'x');
    expect(temAcessoModulo('acervo')).toBe(true);
    expect(temAcessoModulo('mapoteca')).toBe(false);
    expect(temAcessoModulo('orcamento')).toBe(false);
  });

  test('administrador global entra em todo modulo, mesmo sem perfil nenhum', () => {
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {} }, 'x');
    expect(temAcessoModulo('acervo')).toBe(true);
    expect(temAcessoModulo('mapoteca')).toBe(true);
    expect(temAcessoModulo('orcamento')).toBe(true);
    expect(temPerfil('gerente', 'orcamento')).toBe(true);
  });
});

describe('auth-store: catalogo de modulos do servidor', () => {
  test('o NOME do modulo sai do catalogo, nao de rotulo decorado', () => {
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: CATALOGO }, 'x');
    expect(getCatalogoModulos()).toHaveLength(3);
    expect(nomeModulo('orcamento')).toBe('Orçamento');
    expect(nomeModulo('acervo')).toBe('Acervo');
  });

  test('sem catalogo, cai no proprio nome_abrev em vez de quebrar', () => {
    saveAuth({ token: 't', administrador: true, uuid: 'u' }, 'x');
    expect(getCatalogoModulos()).toEqual([]);
    expect(nomeModulo('orcamento')).toBe('orcamento');
  });
});

describe('auth-store: permissoes por modulo', () => {
  test('devolve os tres niveis do modulo, hierarquicos', () => {
    saveAuth({ token: 't', administrador: false, uuid: 'u', perfis: { mapoteca: 2 } }, 'x');

    const pode = permissoes('mapoteca');
    expect(pode.consulta).toBe(true);
    expect(pode.operador).toBe(true);
    expect(pode.gerente).toBe(false);
    expect(pode.admin).toBe(false);
  });

  test('modulo sem perfil nao libera nem consulta', () => {
    saveAuth({ token: 't', administrador: false, uuid: 'u', perfis: { mapoteca: 3 } }, 'x');

    const pode = permissoes('orcamento');
    expect(pode.consulta).toBe(false);
    expect(pode.operador).toBe(false);
    expect(pode.gerente).toBe(false);
  });

  test('administrador global satisfaz tudo, em qualquer modulo', () => {
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {} }, 'x');

    for (const modulo of ['acervo', 'mapoteca', 'orcamento']) {
      const pode = permissoes(modulo);
      expect(pode.gerente).toBe(true);
      expect(pode.admin).toBe(true);
    }
  });
});

describe('auth-store: atualizarSessao', () => {
  test('reescreve o perfil sem derrubar a sessao', () => {
    saveAuth(
      { token: 'jwt', administrador: false, uuid: 'u', perfis: { orcamento: 3 }, modulos: CATALOGO },
      'fulano'
    );

    const mudou = atualizarSessao({
      administrador: false,
      perfis: { orcamento: 1 },
      modulos: CATALOGO,
    });

    expect(mudou).toBe(true);
    expect(getPerfil('orcamento')).toBe(1);
    // O que identifica a sessao continua intacto: so a autorizacao foi refeita.
    expect(getToken()).toBe('jwt');
    expect(getUsername()).toBe('fulano');
    expect(isAuthenticated()).toBe(true);
  });

  test('sem mudanca nenhuma devolve false, para nao recarregar a tela a toa', () => {
    saveAuth(
      { token: 'jwt', administrador: false, uuid: 'u', perfis: { orcamento: 2 }, modulos: CATALOGO },
      'x'
    );

    const mudou = atualizarSessao({
      administrador: false,
      perfis: { orcamento: 2 },
      modulos: CATALOGO,
    });

    expect(mudou).toBe(false);
    expect(getPerfil('orcamento')).toBe(2);
  });

  test('promover a administrador tambem conta como mudanca', () => {
    saveAuth({ token: 'jwt', administrador: false, uuid: 'u', perfis: {}, modulos: [] }, 'x');

    expect(atualizarSessao({ administrador: true, perfis: {}, modulos: [] })).toBe(true);
    expect(isAdmin()).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Acesso ao sistema: estar logado e ter acesso sao dois momentos.
//
// A conta que o administrador acaba de criar nasce SEM linha em
// `dgeo.usuario_perfil`. Ela entra, e nao ha nada la dentro que seja dela: o que
// ela ve e a propria pagina, com o pedido de acesso. Espelha o `verifyAcesso` do
// servidor, que faz a mesma pergunta ao BANCO.
// ---------------------------------------------------------------------------
describe('auth-store: acesso ao sistema', () => {
  test('sem perfil em modulo nenhum, nao tem acesso', () => {
    saveAuth({ token: 'jwt', administrador: false, uuid: 'u', perfis: {}, modulos: CATALOGO }, 'x');
    expect(temAlgumAcesso()).toBe(false);
    expect(meusAcessos()).toEqual([]);
  });

  test('qualquer perfil em qualquer modulo ja e acesso', () => {
    saveAuth(
      { token: 'jwt', administrador: false, uuid: 'u', perfis: { mapoteca: 1 }, modulos: CATALOGO },
      'x'
    );
    expect(temAlgumAcesso()).toBe(true);
  });

  // O administrador global nao tem linha de perfil nenhuma. Uma lista vazia
  // diria a quem administra o sistema que ele nao tem acesso a nada.
  test('o administrador global tem acesso, e a lista traz os modulos todos', () => {
    saveAuth({ token: 'jwt', administrador: true, uuid: 'u', perfis: {}, modulos: CATALOGO }, 'x');

    expect(temAlgumAcesso()).toBe(true);
    const acessos = meusAcessos();
    expect(acessos).toHaveLength(CATALOGO.length);
    expect(acessos.every(a => a.perfil === 'Administrador')).toBe(true);
  });

  test('a lista traz o NOME do modulo e o do nivel, e nao os codigos', () => {
    saveAuth(
      {
        token: 'jwt',
        administrador: false,
        uuid: 'u',
        perfis: { orcamento: 3, mapoteca: 2 },
        modulos: CATALOGO,
      },
      'x'
    );

    // A ORDEM E ALFABETICA PELO NOME, e nao a de insercao do mapa `perfis`: a
    // lista se le, e quem le procura pelo nome do modulo. Mapoteca vem antes de
    // Orcamento. Quando os rotulos eram "Controle Orcamentario" e "Mapoteca",
    // esta mesma asercao saia na ordem inversa -- por isso ela pina a ordem, e
    // nao so o conteudo.
    expect(meusAcessos()).toEqual([
      { modulo: 'mapoteca', nome: 'Mapoteca', nivel: 2, perfil: 'Operador' },
      { modulo: 'orcamento', nome: 'Orçamento', nivel: 3, perfil: 'Gerente' },
    ]);
  });
});

// ---------------------------------------------------------------------------
// A INSTITUICAO que opera esta instalacao (2026-08-09)
// ---------------------------------------------------------------------------
//
// Ela chega pelo LOGIN, ao lado de `perfis` e `modulos`, e nao por uma chamada
// propria: o client precisa dela para DESENHAR (o remetente da etiqueta de
// envio, o orgao produtor sugerido, o nome de arquivo do Anuario quando o
// cabecalho nao vem), e uma volta a mais no boot custaria caro por um dado que
// muda uma vez por instalacao.
//
// Ate aqui o "1º CGEO" estava escrito em quatro lugares do client, e outro CGEO
// veria o nome do nosso Centro depois de configurar o proprio. Por isso os
// testes abaixo usam OUTRA instituicao: confirmar a nossa passaria igual com o
// nome no codigo.
describe('auth-store: a instituicao da sessao', () => {
  const NOSSA = { nome: '1º Centro de Geoinformação', sigla: '1º CGEO' };
  const OUTRA = { nome: '4º Centro de Geoinformação', sigla: '4º CGEO' };

  test('saveAuth guarda o nome e a sigla que vieram no login', () => {
    saveAuth({ token: 'jwt', administrador: false, uuid: 'u', instituicao: NOSSA }, 'x');

    expect(nomeInstituicao()).toBe('1º Centro de Geoinformação');
    expect(siglaInstituicao()).toBe('1º CGEO');
    expect(instituicaoDaSessao()).toEqual(NOSSA);
  });

  test('OUTRA instalacao devolve o nome DELA', () => {
    saveAuth({ token: 'jwt', administrador: false, uuid: 'u', instituicao: OUTRA }, 'x');

    expect(nomeInstituicao()).toBe('4º Centro de Geoinformação');
    expect(siglaInstituicao()).toBe('4º CGEO');
  });

  // Banco sem a linha de `dgeo.instituicao` responde `null`, e entrar continua
  // valendo: a pessoa nao pode ficar trancada do lado de fora por causa de um
  // rotulo. Quem le trata a cadeia vazia.
  test('login sem instituicao devolve cadeia vazia, e nunca undefined', () => {
    saveAuth({ token: 'jwt', administrador: false, uuid: 'u' }, 'x');

    expect(nomeInstituicao()).toBe('');
    expect(siglaInstituicao()).toBe('');
    expect(instituicaoDaSessao()).toEqual({ nome: '', sigla: '' });
  });

  test('sessao encerrada leva a instituicao junto', () => {
    saveAuth({ token: 'jwt', administrador: false, uuid: 'u', instituicao: NOSSA }, 'x');
    clearAuth();

    expect(nomeInstituicao()).toBe('');
    expect(localStorage.getItem('@sca-instituicao')).toBeNull();
  });

  // O administrador corrige a sigla em `#/instituicao` no meio do expediente. O
  // retrato seguinte chega diferente, e `mudou` e o que faz o client recarregar
  // a tela: sem ele o nome novo so apareceria na sessao seguinte.
  test('atualizarSessao troca a instituicao e ACUSA a mudanca', () => {
    saveAuth(
      { token: 'jwt', administrador: false, uuid: 'u', perfis: {}, modulos: CATALOGO, instituicao: NOSSA },
      'x'
    );

    const mudou = atualizarSessao({
      administrador: false, perfis: {}, modulos: CATALOGO, instituicao: OUTRA,
    });

    expect(mudou).toBe(true);
    expect(nomeInstituicao()).toBe('4º Centro de Geoinformação');
  });

  test('o mesmo retrato de novo nao acusa mudanca', () => {
    saveAuth(
      { token: 'jwt', administrador: false, uuid: 'u', perfis: {}, modulos: CATALOGO, instituicao: NOSSA },
      'x'
    );

    const mudou = atualizarSessao({
      administrador: false, perfis: {}, modulos: CATALOGO, instituicao: NOSSA,
    });

    expect(mudou).toBe(false);
  });
});
