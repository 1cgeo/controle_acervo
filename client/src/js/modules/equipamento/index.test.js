import { describe, test, expect, beforeEach } from 'vitest';
import { logarComo, CONSULTA, OPERADOR, GERENTE } from '@/__tests__/helpers/sessao.js';
import { getModulo, getRota, podeAbrirRota, rotaInicial, modulosPortados } from '@modules/registry.js';
import { activeIdFromPath } from '@components/layout/sidebar.js';

import equipamento from './index.js';

// O MANIFESTO CONTRA O CONTRATO DE `modules/registry.js`.
//
// Nada aqui mede aparência: mede o que a interface toda lê do manifesto. O `id`
// é a mesma string que `verifyPerfil(nivel, 'equipamento')` compara por
// igualdade no servidor, que o prefixo '/api/equipamento' usa e que a chave do
// mapa `perfis` do POST /api/login carrega; trocá-la derruba a autorização sem
// erro de sintaxe. O `home`, o `menu` e as `rotas` são o que a sidebar e o
// router consomem.
//
// PERFIL DE ROTA AQUI É SÓ ERGONOMIA: quem barra escrita é o servidor. Por isso
// nenhum caso abaixo trata o client como guarda -- eles medem o que o MENU
// oferece, que é outra coisa.

beforeEach(() => localStorage.clear());

describe('manifesto do equipamento: o que o registry exige', () => {
  test('está registrado, e o id é o nome_abrev do módulo no servidor', () => {
    expect(equipamento.id).toBe('equipamento');
    expect(getModulo('equipamento')).toBe(equipamento);
    // Módulo sem rota é esqueleto e não abre tela nenhuma: este tem quatro.
    expect(modulosPortados().map(m => m.id)).toContain('equipamento');
  });

  test('a home NÃO é string vazia, e leva ao painel', () => {
    // `registry.rotaInicial` faz `mod.home || '/dashboard'`: o vazio, sendo
    // falso, cairia numa rota '/equipamento/dashboard' que não existe, e o
    // cabeçalho do módulo na sidebar levaria a 404.
    expect(equipamento.home).toBeTruthy();

    logarComo({ equipamento: CONSULTA });
    // O router parte o caminho e descarta segmento vazio, então '/equipamento/'
    // casa com a rota de caminho '' -- a mesma tela de '#/equipamento'.
    expect(rotaInicial('equipamento')).toBe('/equipamento/');
    expect(getRota('equipamento', '')).not.toBeNull();
  });

  test('as quatro telas estão declaradas, todas de consulta', () => {
    const rotas = equipamento.rotas.map(r => r.path);
    expect(rotas).toEqual(['', '/bens', '/bens/:id', '/tipos']);

    for (const rota of equipamento.rotas) {
      expect(typeof rota.render, `${rota.path} não aponta função de render`).toBe('function');
      // CONSULTA é o piso do módulo, e as quatro telas ficam nele de propósito:
      // a ficha do bem é a única visão completa do equipamento, e cobrar
      // operador ali a esconderia de quem só consulta. O que muda por perfil
      // são os BOTÕES de lançamento.
      expect(rota.perfil, `${rota.path} não é de consulta`).toBe('consulta');
      // Nem `admin`, nem lista NÃO hierárquica: as duas exceções do sistema são
      // da mapoteca e do efetivo, e nenhuma tela daqui pediu uma.
      expect(rota.admin).toBeUndefined();
      expect(rota.perfis).toBeUndefined();
    }
  });

  test('quem tem consulta abre as quatro, e o gerente não abre nenhuma a mais', () => {
    logarComo({ equipamento: CONSULTA });
    for (const rota of equipamento.rotas) {
      expect(podeAbrirRota('equipamento', rota.path), `consulta perdeu ${rota.path}`).toBe(true);
    }

    logarComo({ equipamento: GERENTE });
    for (const rota of equipamento.rotas) {
      expect(podeAbrirRota('equipamento', rota.path)).toBe(true);
    }
  });

  test('quem não tem perfil no módulo não abre tela nenhuma dele', () => {
    logarComo({ orcamento: GERENTE });
    for (const rota of equipamento.rotas) {
      expect(podeAbrirRota('equipamento', rota.path), `${rota.path} vazou`).toBe(false);
    }
  });
});

describe('manifesto do equipamento: o menu', () => {
  test('são TRÊS itens, e o quarto caminho é a ficha, que não vira item', () => {
    expect(equipamento.menu.map(i => i.id)).toEqual(['painel', 'bens', 'tipos']);

    // Item de menu apontando para caminho com parâmetro levaria a /404: não há
    // id na mão para montar o href. É a mesma razão de `registry.rotaInicial`
    // filtrar rota com ':' antes de escolher porta de entrada.
    for (const item of equipamento.menu) {
      expect(item.path, `o item ${item.id} aponta rota com parâmetro`).not.toContain(':');
    }
    expect(equipamento.rotas.some(r => r.path.includes(':'))).toBe(true);
  });

  test('todo item de menu aponta uma rota que EXISTE no manifesto', () => {
    // Item apontando caminho não registrado não é barrado por `podeAbrirRota`
    // (que devolve true no desconhecido, para o guarda decidir): ele vira um
    // link para o /404, e o menu é o último lugar onde isso se percebe.
    for (const item of equipamento.menu) {
      expect(getRota('equipamento', item.path), `${item.id} -> ${item.path} não é rota`)
        .not.toBeNull();
    }
  });

  test('o menu é PLANO: nenhum item declara `children`', () => {
    // Os dois grupos colapsáveis que existiram no sistema foram podados em
    // 2026-08-08: dentro de uma seção que já abre e fecha, o grupo era um
    // segundo clique e escondia tela de quem não sabia que ela existia.
    for (const item of equipamento.menu) {
      expect(item.children, `${item.id} voltou a ser grupo`).toBeUndefined();
      expect(typeof item.path, `${item.id} não navega`).toBe('string');
      expect(item.label, `${item.id} não tem rótulo`).toBeTruthy();
      expect(item.icon, `${item.id} não tem ícone`).toBeTruthy();
    }
  });

  test('o rótulo da pessoa NÃO sai do manifesto: só o dos itens', () => {
    // O nome do módulo na sidebar vem do catálogo do servidor
    // (`auth-store.nomeModulo`, lendo `dominio.modulo.nome`). Um `label` aqui
    // congelaria na tela um nome que o banco pode trocar sem deploy.
    expect(equipamento.label).toBeUndefined();
    expect(equipamento.nome).toBeUndefined();
  });

  test('o item "Equipamentos" fica marcado enquanto a ficha do bem está aberta', () => {
    // A chave do item ativo sai do SEGUNDO segmento da rota, então a ficha
    // ('/bens/3') marca o mesmo item que a lista ('/bens').
    expect(activeIdFromPath('/equipamento/bens')).toBe('equipamento:bens');
    expect(activeIdFromPath('/equipamento/bens/3')).toBe('equipamento:bens');
    expect(activeIdFromPath('/equipamento/tipos')).toBe('equipamento:tipos');
  });
});

describe('manifesto do equipamento: o menu não esconde tela de ninguém', () => {
  test('os três itens aparecem para consulta, operador e gerente', () => {
    // As quatro telas são de consulta, que é o piso do módulo: quem entra vê
    // as três entradas do menu, e o recorte por perfil fica nos botões.
    for (const nivel of [CONSULTA, OPERADOR, GERENTE]) {
      localStorage.clear();
      logarComo({ equipamento: nivel });
      for (const item of equipamento.menu) {
        expect(
          podeAbrirRota('equipamento', item.path),
          `o nível ${nivel} não alcança o item ${item.id}`
        ).toBe(true);
      }
    }
  });
});
