import { describe, test, expect } from 'vitest';
import {
  saveAuth, getToken, getUsername, getUserUuid,
  isAuthenticated, isAdmin, clearAuth,
  getPerfil, temPerfil, temAcessoModulo, getCatalogoModulos, nomeModulo,
} from './auth-store.js';

const CATALOGO = [
  { code: 1, nome: 'Controle do Acervo', nome_abrev: 'acervo' },
  { code: 2, nome: 'Mapoteca', nome_abrev: 'mapoteca' },
  { code: 3, nome: 'Controle Orçamentário', nome_abrev: 'orcamento' },
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

  // REGRESSAO 2026-07-27: a duracao da sessao estava escrita DUAS vezes, no
  // servidor (expiresIn) e aqui (agora + 1 hora, fixo). Quando o servidor passou
  // para 8h, o client continuaria deslogando em 1h, e o conserto pareceria
  // pronto enquanto a pessoa seguia caindo fora no meio do trabalho. Agora a
  // expiracao sai do claim `exp` do proprio token, e os dois lados nao divergem.
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
    expect(nomeModulo('orcamento')).toBe('Controle Orçamentário');
    expect(nomeModulo('acervo')).toBe('Controle do Acervo');
  });

  test('sem catalogo, cai no proprio nome_abrev em vez de quebrar', () => {
    saveAuth({ token: 't', administrador: true, uuid: 'u' }, 'x');
    expect(getCatalogoModulos()).toEqual([]);
    expect(nomeModulo('orcamento')).toBe('orcamento');
  });
});
