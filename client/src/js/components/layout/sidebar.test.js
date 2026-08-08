import { describe, test, expect, beforeEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import { MODULOS, podeAbrirRota } from '@modules/registry.js';
import { createSidebar, activeIdFromPath } from './sidebar.js';

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: [] }, 'x');
}

/** Acha um item de menu pelo id, entrando nos grupos colapsaveis. */
function acharItem(itens, id) {
  for (const item of itens || []) {
    if (item.id === id) return item;
    const achado = acharItem(item.children, id);
    if (achado) return achado;
  }
  return null;
}

const ids = (raiz) => [...raiz.querySelectorAll('[data-id]')].map(e => e.dataset.id);
const modulosNaTela = (raiz) => [...raiz.querySelectorAll('.sidebar__module-header')]
  .map(e => e.getAttribute('href'));

beforeEach(() => localStorage.clear());

describe('sidebar: os tres modulos convivem, cada um colapsavel', () => {
  test('lista TODOS os modulos acessiveis, mesmo numa rota de plataforma', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    // Era o defeito: em #/usuarios o menu inteiro sumia e sobrava a plataforma.
    //
    // Depois dos três módulos vêm PRODUÇÃO e EFETIVO, que se desenham como
    // sistema sem ser módulo. A ordem é asserida inteira
    // de propósito: a posição é metade do que ela comunica. Produção antes de
    // Efetivo porque é a que fala do TRABALHO, e Efetivo é quem o faz.
    expect(modulosNaTela(sidebar)).toEqual([
      '#/acervo/dashboard',
      '#/mapoteca/dashboard',
      '#/orcamento/dashboard',
      '#/metas',
      '#/acessos',
    ]);
    expect(ids(sidebar)).toContain('acervo:dashboard');
    expect(ids(sidebar)).toContain('usuarios');
  });

  test('o item carrega o modulo na chave, porque dashboard existe nos tres', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });

    const lista = ids(sidebar);
    expect(lista).toContain('acervo:dashboard');
    expect(lista).toContain('mapoteca:dashboard');
    expect(lista).toContain('orcamento:dashboard');

    expect(sidebar.querySelector('[data-id="orcamento:dfd"]').getAttribute('href'))
      .toBe('#/orcamento/dfd');
  });

  test('trocar de modulo abre a seção dele e fecha as outras, sem apagar nada', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'orcamento' });
    const secoes = () => [...ctrl.sidebar.querySelectorAll('.sidebar__module')]
      .map(s => s.classList.contains('sidebar__module--open'));

    // Cinco seções: os três módulos, Produção e Efetivo, nesta ordem.
    expect(secoes()).toEqual([false, false, true, false, false]);
    const antes = ids(ctrl.sidebar).length;

    ctrl.setModulo('acervo');
    expect(secoes()).toEqual([true, false, false, false, false]);

    // Nenhum item foi destruido: a sidebar so abriu e fechou seção.
    expect(ids(ctrl.sidebar).length).toBe(antes);
  });

  test('rota de plataforma nao fecha o que estava aberto', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'mapoteca' });
    const abertas = () => [...ctrl.sidebar.querySelectorAll('.sidebar__module--open')].length;

    expect(abertas()).toBe(1);
    ctrl.setModulo(null);
    expect(abertas()).toBe(1);
    expect(ids(ctrl.sidebar)).toContain('mapoteca:pedidos');
  });

  test('quem nao e admin ve so os modulos em que tem perfil', () => {
    logar({ perfis: { orcamento: 3 } });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });

    // PRODUÇÃO aparece e EFETIVO não, e a diferença não é acidente: o plano
    // anual da Divisão se LÊ com qualquer conta (o servidor cobra o
    // administrador só na escrita), e o efetivo é verifyAdmin de ponta a ponta.
    expect(modulosNaTela(sidebar)).toEqual(['#/orcamento/dashboard', '#/metas']);
    expect(ids(sidebar)).not.toContain('usuarios');
    expect(ids(sidebar)).not.toContain('aproveitamento');
    expect(ids(sidebar)).toContain('orcamento:dfd');
  });
});

// A meta do PIT e item de PLATAFORMA, e nao do modulo orcamento. O ponto do
// teste e o CONTRARIO do item de usuarios: este NAO leva `admin: true`, porque
// quem so tem perfil na mapoteca precisa ler o plano anual para amarrar o pedido
// a uma meta.
describe('sidebar: as metas do PIT sao de plataforma, e nao do orcamento', () => {
  test('quem so tem perfil na mapoteca ve Metas do PIT', () => {
    logar({ perfis: { mapoteca: 3 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });

    const lista = ids(sidebar);
    expect(lista).toContain('metas');
    // Sem perfil no orcamento, nenhuma tela daquele modulo aparece.
    expect(lista).not.toContain('orcamento:dfd');
    // E o item de usuarios continua so do administrador.
    expect(lista).not.toContain('usuarios');
  });

  test('o item aponta a rota sem prefixo de modulo', () => {
    logar({ perfis: { mapoteca: 3 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });
    expect(sidebar.querySelector('[data-id="metas"]').getAttribute('href')).toBe('#/metas');
  });

  test('o orcamento nao tem mais o item nem o grupo colapsavel "Orçamento"', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });

    expect(ids(sidebar)).not.toContain('orcamento:metas');
    // O grupo tinha dois filhos e ficou com um: o PDR subiu para o topo.
    expect(sidebar.querySelector('[data-id="orcamento:pdr"]').getAttribute('href'))
      .toBe('#/orcamento/pdr');
    const rotulos = [...sidebar.querySelectorAll('.sidebar__group-header')]
      .map(h => h.textContent);
    expect(rotulos.some(r => r.includes('Orçamento'))).toBe(false);
  });
});

// EFETIVO é uma SEÇÃO DE SISTEMA, logo depois do orçamento, e não um grupo
// colapsavel no meio das telas soltas de plataforma: ela tem dashboard, tem
// cadastro, e tem quem entre nela para trabalhar um turno inteiro.
//
// O grupo é sobre quem serve na Divisão, e não sobre CONTA de sistema. A rota
// `#/usuarios` NÃO acompanha o rótulo, e é o que os casos abaixo guardam.
describe('sidebar: Efetivo e uma seção de sistema, como os modulos', () => {
  test('o cabeçalho e um LINK para o dashboard, e nao so um botao que abre', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    const cabecalhos = [...sidebar.querySelectorAll('.sidebar__module-header')];
    const efetivo = cabecalhos.find(h => h.textContent.includes('Efetivo'));

    expect(efetivo).toBeTruthy();
    // Clicar no nome do sistema entra nele, como nos três módulos.
    expect(efetivo.getAttribute('href')).toBe('#/acessos');
    // E NÃO é um grupo daqueles que só abrem e fecham.
    expect(efetivo.tagName).toBe('A');
  });

  test('o DASHBOARD vem primeiro, a Gestão depois e o Aproveitamento por último', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    const itens = [...sidebar.querySelectorAll(
      '[data-id="acessos"], [data-id="usuarios"], [data-id="aproveitamento"], [data-id="capacitacao_recebida"]'
    )];
    expect(itens.map(i => i.dataset.id))
      .toEqual(['acessos', 'usuarios', 'aproveitamento', 'capacitacao_recebida']);
    // A rota não segue o rótulo: `#/acessos` é o que lê `dgeo.login`, e
    // renomear a URL quebraria link guardado.
    expect(itens[0].getAttribute('href')).toBe('#/acessos');
    expect(itens[0].textContent).toContain('Dashboard');
    expect(itens[1].getAttribute('href')).toBe('#/usuarios');
    // O retrato mensal do efetivo (6.1 do RPCMTec) mora aqui, e nao junto do
    // relatorio, porque quem o preenche vem procurar por PESSOA.
    expect(itens[2].getAttribute('href')).toBe('#/aproveitamento');
  });

  // A chave do item ativo sai do PRIMEIRO segmento da rota, entao o id da SEÇÃO
  // nao pode ser 'usuarios': ele roubaria a chave do filho que aponta /usuarios.
  test('setActive marca a Gestão e ABRE a seção que a contem', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: null });
    ctrl.setActive(activeIdFromPath('/usuarios'));

    const item = ctrl.sidebar.querySelector('[data-id="usuarios"]');
    expect(item.classList.contains('sidebar__item--active')).toBe(true);
    // `setModulo` recebe null numa rota de plataforma, entao quem abre a seção e
    // o proprio `setActive`: sem isso ela ficaria fechada justamente quando a
    // pessoa esta dentro dela.
    expect(item.closest('.sidebar__module').classList.contains('sidebar__module--open')).toBe(true);
  });

  test('sem perfil em Efetivo, a seção inteira some', () => {
    logar({ perfis: { mapoteca: 3 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });

    expect(ids(sidebar)).not.toContain('usuarios');
    expect(ids(sidebar)).not.toContain('acessos');
    expect(ids(sidebar)).not.toContain('aproveitamento');
    expect(ids(sidebar)).not.toContain('capacitacao_recebida');
  });

  // O QUE MUDOU NA 1.33.0. A seção era `admin: true` INTEIRA, então o operador
  // de Efetivo não veria nada, embora o servidor já o aceite em
  // `/api/efetivo/periodos` e em `/rpcmtec/capacitacao/recebida`. A marca desceu
  // para os dois itens que continuam sendo conta de sistema.
  test('operador de Efetivo ve o aproveitamento e a capacitação recebida', () => {
    logar({ perfis: { efetivo: 2 } });
    const { sidebar } = createSidebar({ modulo: null });

    const lista = ids(sidebar);
    expect(lista).toContain('aproveitamento');
    expect(lista).toContain('capacitacao_recebida');
    // E NAO ve o que e conta de sistema: quem entrou e quando, e quem tem
    // acesso a que. As duas sao verifyAdmin no servidor.
    expect(lista).not.toContain('acessos');
    expect(lista).not.toContain('usuarios');
  });

  // O cabeçalho é um LINK, e a home da seção é `#/acessos`, que é do
  // administrador. Sem calcular a home, clicar no nome da seção que é dele
  // jogaria o operador em /unauthorized.
  test('para o operador, o cabeçalho leva ao aproveitamento, e nao ao dashboard', () => {
    logar({ perfis: { efetivo: 2 } });
    const { sidebar } = createSidebar({ modulo: null });

    const efetivo = [...sidebar.querySelectorAll('.sidebar__module-header')]
      .find(h => h.textContent.includes('Efetivo'));
    expect(efetivo.getAttribute('href')).toBe('#/aproveitamento');
  });

  // A hierarquia vale: o GERENTE do efetivo satisfaz o operador. Sem este caso,
  // um `visivel` que comparasse o nível por igualdade passaria despercebido.
  test('gerente de Efetivo tambem ve as duas telas', () => {
    logar({ perfis: { efetivo: 3 } });
    const { sidebar } = createSidebar({ modulo: null });

    expect(ids(sidebar)).toContain('aproveitamento');
    expect(ids(sidebar)).toContain('capacitacao_recebida');
  });

  // CONSULTA em Efetivo não abre tela nenhuma da seção: a mais baixa dela é o
  // aproveitamento, que exige operador. A seção inteira some, e é a resposta
  // certa, e não um menu que abre para levar 403.
  test('consulta em Efetivo nao ve tela nenhuma da seção', () => {
    logar({ perfis: { efetivo: 1 } });
    const { sidebar } = createSidebar({ modulo: null });

    expect(ids(sidebar)).not.toContain('aproveitamento');
    expect(ids(sidebar)).not.toContain('capacitacao_recebida');
  });
});

// PRODUÇÃO reúne metas, execução mensal, Extra-PIT e capacitação. "Metas do
// PIT" é a primeira tela da seção, e não um item solto de plataforma, porque as
// quatro se leem JUNTAS.
describe('sidebar: Produção reúne o plano anual e o que acontece com ele', () => {
  test('as quatro telas estão na seção, e o cabeçalho leva às metas', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    const producao = [...sidebar.querySelectorAll('.sidebar__module-header')]
      .find(h => h.textContent.includes('Produção'));
    expect(producao).toBeTruthy();
    expect(producao.getAttribute('href')).toBe('#/metas');

    const itens = [...sidebar.querySelectorAll(
      '[data-id="metas"], [data-id="execucao_pit"], [data-id="extra_pit"], [data-id="capacitacao_ministrada"]'
    )];
    expect(itens.map(i => i.dataset.id))
      .toEqual(['metas', 'execucao_pit', 'extra_pit', 'capacitacao_ministrada']);
    expect(itens[1].getAttribute('href')).toBe('#/execucao_pit');
  });

  // A seção NÃO se restringe, e o item de capacitação sim. A diferença não é
  // descuido: metas e Extra-PIT são `authLoader` (o servidor cobra o perfil só
  // na escrita), e a capacitação ministrada é rota própria, guardada por
  // `verifyPerfil('operador', 'producao')` desde a 1.33.0. Oferecê-la a quem
  // levaria 403 é o desencontro que o `podeAbrirRota` existe para evitar do lado
  // dos módulos.
  test('quem nao tem perfil em Producao ve o plano, e nao ve a capacitação', () => {
    logar({ perfis: { mapoteca: 3 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });

    const lista = ids(sidebar);
    expect(lista).toContain('metas');
    expect(lista).toContain('execucao_pit');
    expect(lista).toContain('extra_pit');
    expect(lista).not.toContain('capacitacao_ministrada');
  });

  // O QUE MUDOU NA 1.33.0. O item era `admin: true`, e agora ele segue o módulo
  // PRODUÇÃO. Sem este caso, a mudança poderia ter apenas escondido o item de
  // todo mundo e os casos acima continuariam verdes.
  test('operador de Producao ve a capacitação ministrada', () => {
    logar({ perfis: { producao: 2 } });
    const { sidebar } = createSidebar({ modulo: null });

    expect(ids(sidebar)).toContain('capacitacao_ministrada');
    // E NAO a recebida, que e do modulo Efetivo: as duas saem da mesma tabela e
    // so o modulo as separa.
    expect(ids(sidebar)).not.toContain('capacitacao_recebida');
  });

  test('consulta em Producao nao ve a capacitação ministrada', () => {
    logar({ perfis: { producao: 1 } });
    const { sidebar } = createSidebar({ modulo: null });

    expect(ids(sidebar)).not.toContain('capacitacao_ministrada');
    // Mas ve o plano anual, que e de qualquer pessoa logada.
    expect(ids(sidebar)).toContain('metas');
  });

  test('setActive marca a execução e ABRE a seção que a contem', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: null });
    ctrl.setActive(activeIdFromPath('/execucao_pit'));

    const item = ctrl.sidebar.querySelector('[data-id="execucao_pit"]');
    expect(item.classList.contains('sidebar__item--active')).toBe(true);
    expect(item.closest('.sidebar__module').classList.contains('sidebar__module--open')).toBe(true);
  });
});

// A Rastreabilidade e o TERCEIRO estado de visibilidade da sidebar. Os outros
// dois sao "de todo mundo" (Metas do PIT) e "so do administrador" (RPCMTec);
// esta e do administrador global E do gerente de qualquer modulo, porque cada
// gerente ve o recorte do modulo dele. O recorte de verdade e do servidor
// (verifyRastreabilidade); o que se prova aqui e que o MENU nao oferece a tela a
// quem levaria 403, nem a esconde de quem pode abri-la.
describe('sidebar: Rastreabilidade e do administrador E do gerente', () => {
  test('o administrador global ve o item', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    expect(sidebar.querySelector('[data-id="rastreabilidade"]').getAttribute('href'))
      .toBe('#/rastreabilidade');
  });

  test('gerente de UM modulo ve o item, mesmo sem ser administrador', () => {
    logar({ perfis: { mapoteca: 3 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });

    expect(ids(sidebar)).toContain('rastreabilidade');
    // E continua sem ver o que e so do administrador, na mesma seção.
    expect(ids(sidebar)).not.toContain('usuarios');
  });

  test('operador nao ve: para ele a tela seria uma varredura que responde 403', () => {
    logar({ perfis: { mapoteca: 2, acervo: 1 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });

    expect(ids(sidebar)).not.toContain('rastreabilidade');
  });

  test('fica FORA do grupo Usuários: aquele grupo e sobre pessoas, este item e sobre dados', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    const item = sidebar.querySelector('[data-id="rastreabilidade"]');
    expect(item.closest('.sidebar__group')).toBeNull();
  });
});

describe('sidebar: o menu nunca oferece tela que o guarda recusa', () => {
  // O item "Configuração" do orcamento aponta para uma rota `admin: true` e
  // NAO repetia a marca no proprio item: aparecia para gerente e o clique caia
  // direto no 403. Agora a visibilidade sai da rota, entao os dois nao tem como
  // divergir de novo.
  test('gerente do orcamento nao ve Configuração, que e rota de administrador', () => {
    logar({ perfis: { orcamento: 3 } });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });

    expect(ids(sidebar)).toContain('orcamento:dfd');
    expect(ids(sidebar)).not.toContain('orcamento:configuracao');
  });

  test('administrador continua vendo Configuração', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });

    expect(ids(sidebar)).toContain('orcamento:configuracao');
  });

  // Invariante geral, e nao um caso: para CADA item de menu de CADA modulo, o
  // item so pode estar na tela se podeAbrirRota() aprovar. Item novo apontando
  // para rota restrita quebra este teste, sem ninguem precisar lembrar.
  test('todo item visivel passa pelo guarda da propria rota, em todo perfil', () => {
    const cenarios = [
      { nome: 'consulta em tudo', auth: { perfis: { acervo: 1, mapoteca: 1, orcamento: 1 } } },
      { nome: 'operador em tudo', auth: { perfis: { acervo: 2, mapoteca: 2, orcamento: 2 } } },
      { nome: 'gerente em tudo', auth: { perfis: { acervo: 3, mapoteca: 3, orcamento: 3 } } },
      { nome: 'administrador', auth: { administrador: true } },
    ];

    for (const cenario of cenarios) {
      localStorage.clear();
      logar(cenario.auth);
      const { sidebar } = createSidebar({ modulo: null });

      for (const chave of ids(sidebar)) {
        const [moduloId, itemId] = chave.split(':');
        if (!itemId) continue; // item de plataforma, sem rota de modulo
        const modulo = MODULOS.find(m => m.id === moduloId);
        const item = acharItem(modulo.menu, itemId);
        expect(
          podeAbrirRota(moduloId, item.path),
          `${cenario.nome}: o menu mostra ${chave}, que o guarda recusaria`
        ).toBe(true);
      }
    }
  });

  test('o item de plataforma nao leva prefixo de modulo', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: 'orcamento' });
    expect(sidebar.querySelector('[data-id="usuarios"]').getAttribute('href')).toBe('#/usuarios');
  });

  test('setActive marca o item e abre o grupo que o contem', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'orcamento' });
    ctrl.setActive('orcamento:notas_empenho');

    const item = ctrl.sidebar.querySelector('[data-id="orcamento:notas_empenho"]');
    expect(item.classList.contains('sidebar__item--active')).toBe(true);
    expect(item.closest('.sidebar__group').classList.contains('sidebar__group--open')).toBe(true);
  });

  test('o mesmo id em modulos diferentes nao se confunde', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'acervo' });
    ctrl.setActive('acervo:dashboard');

    expect(ctrl.sidebar.querySelector('[data-id="acervo:dashboard"]')
      .classList.contains('sidebar__item--active')).toBe(true);
    expect(ctrl.sidebar.querySelector('[data-id="orcamento:dashboard"]')
      .classList.contains('sidebar__item--active')).toBe(false);
  });
});

describe('activeIdFromPath', () => {
  test('rota de modulo: a chave carrega o modulo e o item', () => {
    expect(activeIdFromPath('/orcamento/dfd')).toBe('orcamento:dfd');
    expect(activeIdFromPath('/orcamento/notas_empenho/3')).toBe('orcamento:notas_empenho');
    expect(activeIdFromPath('/orcamento/dfd?ano=2026')).toBe('orcamento:dfd');
    expect(activeIdFromPath('/acervo/dashboard')).toBe('acervo:dashboard');
  });

  test('rota de plataforma: o item e o primeiro segmento', () => {
    expect(activeIdFromPath('/usuarios')).toBe('usuarios');
  });

  test('rota vazia nao marca nada', () => {
    expect(activeIdFromPath('/')).toBeNull();
    expect(activeIdFromPath('')).toBeNull();
  });

  test('modulo sem item (so o prefixo) nao marca nada', () => {
    expect(activeIdFromPath('/orcamento')).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// A conta SEM CONCESSAO NENHUMA.
//
// Ela esta logada e nao esta no sistema: o menu inteiro e dela e nao tem nada.
// A tela dela e '#/perfil', que mora no menu da pessoa na navbar, e nao aqui.
// Antes disto, "Produção" continuava desenhada, e era a unica coisa na sidebar
// de quem nao tinha acesso a nada -- um sistema oferecido a quem levaria 403.
// ---------------------------------------------------------------------------
describe('sidebar: quem ainda nao tem acesso a nada', () => {
  test('nao ve seção nenhuma, nem a de Produção', () => {
    logar({ perfis: {} });
    const { sidebar } = createSidebar({ modulo: null });

    expect(modulosNaTela(sidebar)).toEqual([]);
    expect(ids(sidebar)).toEqual([]);
  });

  // Um perfil qualquer, em qualquer modulo, ja devolve Produção: o PIT do ano e
  // o plano da Divisao inteira, e nao pede perfil no modulo Produção.
  test('com qualquer perfil, a seção de Produção volta', () => {
    logar({ perfis: { mapoteca: 1 } });
    const { sidebar } = createSidebar({ modulo: null });

    expect(modulosNaTela(sidebar)).toContain('#/metas');
  });
});
