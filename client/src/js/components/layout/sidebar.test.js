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
    // A quarta seção é a de USUÁRIOS, que desde 2026-08-02 se desenha como
    // sistema e vem LOGO DEPOIS do orçamento (chefe). A ordem é asserida
    // inteira de propósito: a posição é metade do que ela comunica.
    expect(modulosNaTela(sidebar)).toEqual([
      '#/acervo/dashboard',
      '#/mapoteca/dashboard',
      '#/orcamento/dashboard',
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

    // Quatro seções: os três módulos e a área de Usuários, que é a última.
    expect(secoes()).toEqual([false, false, true, false]);
    const antes = ids(ctrl.sidebar).length;

    ctrl.setModulo('acervo');
    expect(secoes()).toEqual([true, false, false, false]);

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

    expect(modulosNaTela(sidebar)).toEqual(['#/orcamento/dashboard']);
    expect(ids(sidebar)).not.toContain('usuarios');
    expect(ids(sidebar)).toContain('orcamento:dfd');
  });
});

// A meta do PIT saiu do modulo orcamento em 2026-07-31 e virou item de
// plataforma. O ponto do teste e o CONTRARIO do item de usuarios: este NAO leva
// `admin: true`, porque quem so tem perfil na mapoteca precisa ler o plano
// anual para amarrar o pedido a uma meta. Era exatamente isso que a tela dentro
// do orcamento impedia.
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

// Em 2026-08-02 a autenticacao veio para dentro do SCA e administrar gente
// deixou de ser UMA tela. No mesmo dia, a pedido do chefe, "Usuários" deixou de
// ser um grupo colapsavel no meio das telas soltas de plataforma e virou uma
// SEÇÃO DE SISTEMA, logo depois do orçamento: ela tem dashboard, tem cadastro, e
// tem quem entre nela para trabalhar um turno inteiro.
describe('sidebar: Usuários e uma seção de sistema, como os modulos', () => {
  test('o cabeçalho e um LINK para o dashboard, e nao so um botao que abre', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    const cabecalhos = [...sidebar.querySelectorAll('.sidebar__module-header')];
    const usuarios = cabecalhos.find(h => h.textContent.includes('Usuários'));

    expect(usuarios).toBeTruthy();
    // Clicar no nome do sistema entra nele, como nos três módulos.
    expect(usuarios.getAttribute('href')).toBe('#/acessos');
    // E NÃO é um grupo daqueles que só abrem e fecham.
    expect(usuarios.tagName).toBe('A');
  });

  test('o DASHBOARD vem primeiro, e a Gestão depois', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    const itens = [...sidebar.querySelectorAll('[data-id="acessos"], [data-id="usuarios"]')];
    expect(itens.map(i => i.dataset.id)).toEqual(['acessos', 'usuarios']);
    // A rota nao mudou de nome junto com o rotulo: `#/acessos` e o que le
    // `dgeo.login`, e renomear a URL quebraria link guardado.
    expect(itens[0].getAttribute('href')).toBe('#/acessos');
    expect(itens[0].textContent).toContain('Dashboard');
    expect(itens[1].getAttribute('href')).toBe('#/usuarios');
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

  test('a seção inteira e do administrador global', () => {
    logar({ perfis: { mapoteca: 3 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });

    expect(ids(sidebar)).not.toContain('usuarios');
    expect(ids(sidebar)).not.toContain('acessos');
  });
});

// A Rastreabilidade (2026-08-02) e o TERCEIRO estado de visibilidade que a
// sidebar passou a ter. Ate ela, um item de plataforma era "de todo mundo"
// (Metas do PIT) ou "so do administrador" (RPCMTec, Usuários); esta e do
// administrador global E do gerente de qualquer modulo, porque cada gerente ve o
// recorte do modulo dele. O recorte de verdade e do servidor
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
