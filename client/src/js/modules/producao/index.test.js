import { describe, test, expect, beforeEach } from 'vitest';

import producao from './index.js';
import { podeAbrirRota } from '@modules/registry.js';
import { saveAuth } from '@store/auth-store.js';

// O RECORTE DE PERFIL DESTE MODULO NAO E HIERARQUICO, e este arquivo existe para
// que ele nao volte a ser por descuido.
//
// A regra do chefe, de 2026-08-09: a CONSULTA ve tudo e nao modifica nada, o
// OPERADOR ve duas telas (Dashboard e a propria atividade), e o GERENTE ve tudo e
// mexe em tudo. O visualizador NAO e um operador rebaixado.
//
// O QUE PODE QUEBRAR ISSO SEM ERRO NENHUM: trocar `perfis: [...]` por
// `perfil: 'consulta'` numa rota. O `perfil` e MINIMO e hierarquico, entao o
// operador -- um nivel acima da consulta -- passaria a ver a tela de novo, sem
// erro de sintaxe, sem excecao e sem nada na tela. Foi assim que o Aproveitamento
// do efetivo quase perdeu a mesma regra.

const CATALOGO = [
  { code: 1, nome: 'Acervo', nome_abrev: 'acervo' },
  { code: 7, nome: 'Produção', nome_abrev: 'producao' },
];

const logar = (perfilProducao) =>
  saveAuth(
    {
      token: 't',
      administrador: false,
      uuid: 'u',
      perfis: perfilProducao ? { producao: perfilProducao } : {},
      modulos: CATALOGO,
    },
    'x'
  );

// `dominio.tipo_perfil`: 1 consulta, 2 operador, 3 gerente.
const CONSULTA = 1;
const OPERADOR = 2;
const GERENTE = 3;

const DASHBOARD = '';
const MINHA_ATIVIDADE = '/atividade';

const ACOMPANHAMENTO = [
  '/grade',
  '/lote',
  '/atividade_subfase',
  '/atividade_usuario',
  '/situacao_subfase',
  '/atividades',
  '/pit',
  '/mapas',
  '/microcontrole',
];

beforeEach(() => localStorage.clear());

describe('producao: o recorte de perfil NAO e hierarquico', () => {
  // A VARIANCIA PRIMEIRO. Sem este caso, um manifesto vazio deixaria todos os
  // outros verdes por vacuidade: `podeAbrirRota` devolve `true` para caminho que
  // nao e rota registrada.
  test('as onze rotas estao registradas', () => {
    expect(producao.rotas).toHaveLength(11);
    const caminhos = producao.rotas.map((r) => r.path);
    expect(caminhos).toContain(DASHBOARD);
    expect(caminhos).toContain(MINHA_ATIVIDADE);
    for (const p of ACOMPANHAMENTO) expect(caminhos).toContain(p);
  });

  // ESTE E O CASO QUE PEGA A TROCA POR MINIMO. `perfil` e `perfis` sao campos
  // diferentes do manifesto, e `podeAbrirRota` prefere a lista quando ela existe:
  // uma rota que declare `perfil` volta a ser hierarquica em silencio.
  test('TODA rota declara `perfis` (lista), e NENHUMA declara `perfil`', () => {
    const comMinimo = producao.rotas
      .filter((r) => r.perfil !== undefined)
      .map((r) => r.path || '(raiz)');
    expect(comMinimo).toEqual([]);

    const semLista = producao.rotas
      .filter((r) => !Array.isArray(r.perfis))
      .map((r) => r.path || '(raiz)');
    expect(semLista).toEqual([]);
  });

  test('o OPERADOR ve o Dashboard e a propria atividade, e mais nada', () => {
    logar(OPERADOR);

    expect(podeAbrirRota('producao', DASHBOARD)).toBe(true);
    expect(podeAbrirRota('producao', MINHA_ATIVIDADE)).toBe(true);

    // A lista inteira de acompanhamento fica fora. Asserida como CONJUNTO, e nao
    // uma a uma, para a mensagem de falha dizer QUAL tela vazou.
    const vazaram = ACOMPANHAMENTO.filter((p) => podeAbrirRota('producao', p));
    expect(vazaram).toEqual([]);
  });

  test('a CONSULTA ve tudo, menos a tela que escreve', () => {
    logar(CONSULTA);

    expect(podeAbrirRota('producao', DASHBOARD)).toBe(true);

    const faltaram = ACOMPANHAMENTO.filter((p) => !podeAbrirRota('producao', p));
    expect(faltaram).toEqual([]);

    // A UNICA que ela nao ve: nao ha atividade propria de quem so acompanha, e a
    // tela abriria vazia com todos os botoes em 403.
    expect(podeAbrirRota('producao', MINHA_ATIVIDADE)).toBe(false);
  });

  test('o GERENTE ve as onze', () => {
    logar(GERENTE);

    const faltaram = producao.rotas
      .map((r) => r.path)
      .filter((p) => !podeAbrirRota('producao', p));
    expect(faltaram).toEqual([]);
  });

  // A ASSIMETRIA, DITA COM TODAS AS LETRAS. E o caso que documenta a regra: se
  // um dia alguem "consertar" a hierarquia, ele fica vermelho apontando para ca.
  test('o visualizador ve MAIS telas que o operador, e isso e a regra', () => {
    logar(CONSULTA);
    const daConsulta = producao.rotas
      .map((r) => r.path)
      .filter((p) => podeAbrirRota('producao', p));

    localStorage.clear();
    logar(OPERADOR);
    const doOperador = producao.rotas
      .map((r) => r.path)
      .filter((p) => podeAbrirRota('producao', p));

    expect(daConsulta.length).toBeGreaterThan(doOperador.length);
    expect(doOperador).toEqual([DASHBOARD, MINHA_ATIVIDADE]);
  });
});
