import { describe, test, expect, beforeEach } from 'vitest';
import { saveAuth } from '@store/auth-store.js';
import { MODULOS, podeAbrirRota } from '@modules/registry.js';
import {
  acessoLoader, adminLoader, gerenteLoader, perfilLoader,
} from '../../router.js';
import { createSidebar, activeIdFromPath } from './sidebar.js';

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: [] }, 'x');
}

/** Acha um item de menu pelo id. O menu e plano: nao ha grupo para entrar. */
function acharItem(itens, id) {
  return (itens || []).find(item => item.id === id) || null;
}

const ids = (raiz) => [...raiz.querySelectorAll('[data-id]')].map(e => e.dataset.id);
const modulosNaTela = (raiz) => [...raiz.querySelectorAll('.sidebar__module-header')]
  .map(e => e.getAttribute('href'));

beforeEach(() => localStorage.clear());

describe('sidebar: os cinco modulos convivem, cada um colapsavel', () => {
  test('lista TODOS os modulos acessiveis, mesmo numa rota de plataforma', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    // Era o defeito: em #/usuarios o menu inteiro sumia e sobrava a plataforma.
    //
    // Depois dos cinco módulos vêm PIT e EFETIVO, que se desenham como
    // sistema sem ser módulo. A ordem é asserida inteira
    // de propósito: a posição é metade do que ela comunica. PIT antes de
    // Efetivo porque é a seção que fala do TRABALHO, e Efetivo é quem o faz.
    //
    // EQUIPAMENTO fecha a fila dos módulos, e a home dele sai com a barra no
    // fim: o manifesto declara `home: '/'` porque o Dashboard mora em
    // '#/equipamento', sem sufixo, e `rotaInicial` concatena prefixo e home. O
    // router parte o caminho e descarta segmento vazio, então '#/equipamento/'
    // abre a mesma tela que '#/equipamento'.
    expect(modulosNaTela(sidebar)).toEqual([
      '#/acervo/dashboard',
      '#/mapoteca/dashboard',
      '#/orcamento/dashboard',
      '#/equipamento/',
      // `producao` entrou na 3.0.0, e a home dele é '/' como a do equipamento:
      // o painel mora na raiz do módulo.
      '#/producao/',
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

    // Sete seções: os CINCO módulos, PIT e Efetivo, nesta ordem.
    expect(secoes()).toEqual([false, false, true, false, false, false, false]);
    const antes = ids(ctrl.sidebar).length;

    ctrl.setModulo('acervo');
    expect(secoes()).toEqual([true, false, false, false, false, false, false]);

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

    // PIT aparece e EFETIVO não, e a diferença não é acidente: o plano
    // anual da Divisão se LÊ com qualquer conta (o servidor cobra o
    // administrador só na escrita), e a seção Efetivo pede perfil no módulo
    // Efetivo, que esta conta não tem.
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
    // O grupo tinha dois filhos, ficou com um, e depois nem grupo e mais: o PDR
    // esta no topo do menu do modulo, como qualquer outra tela.
    expect(sidebar.querySelector('[data-id="orcamento:pdr"]').getAttribute('href'))
      .toBe('#/orcamento/pdr');
    // Nao ha cabeçalho de grupo nenhum na sidebar, com "Orçamento" ou sem.
    expect(sidebar.querySelectorAll('.sidebar__group-header').length).toBe(0);
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
    // Clicar no nome do sistema entra nele, como nos módulos de tela.
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

  // O OPERADOR É O CASO QUE MAIS CONFUNDE: ele vê o dashboard e a capacitação
  // recebida, que são LEITURA e pedem consulta, e NÃO vê o aproveitamento,
  // embora seja um nível acima de consulta. A régua daquela tela é uma LISTA
  // (consulta e gerente), e não um mínimo hierárquico: o operador ficou com o
  // PRÓPRIO aproveitamento, em '#/perfil', e quem lança pelos outros é o
  // gerente. A rota cobra o mesmo em `perfilLoader('efetivo', ['consulta',
  // 'gerente'])`, então o menu não esconde nada que ele possa abrir.
  test('operador de Efetivo ve as telas de leitura, e NAO o aproveitamento', () => {
    logar({ perfis: { efetivo: 2 } });
    const { sidebar } = createSidebar({ modulo: null });

    const lista = ids(sidebar);
    expect(lista).toContain('acessos');
    expect(lista).toContain('capacitacao_recebida');
    expect(lista).not.toContain('aproveitamento');
    // E NAO ve o que e conta de sistema: quem tem acesso a que. E verifyAdmin no
    // servidor.
    expect(lista).not.toContain('usuarios');
  });

  // O cabeçalho é um LINK, e a home da seção é `#/acessos` para TODO MUNDO que
  // enxerga a seção. Ela já foi calculada, e desviava o operador para
  // '#/aproveitamento' porque o dashboard era do gerente; com o dashboard aberto
  // à consulta, não sobrou ninguém para desviar.
  test('o cabeçalho leva ao dashboard tambem para o operador, sem desvio', () => {
    logar({ perfis: { efetivo: 2 } });
    const { sidebar } = createSidebar({ modulo: null });

    const efetivo = [...sidebar.querySelectorAll('.sidebar__module-header')]
      .find(h => h.textContent.includes('Efetivo'));
    expect(efetivo.getAttribute('href')).toBe('#/acessos');
  });

  // O GERENTE vê TUDO o que é do módulo, inclusive o aproveitamento, que o
  // operador não vê. É o outro lado da lista não hierárquica: quem lança pelos
  // outros é ele.
  test('gerente de Efetivo ve as telas do modulo, inclusive o aproveitamento', () => {
    logar({ perfis: { efetivo: 3 } });
    const { sidebar } = createSidebar({ modulo: null });

    const lista = ids(sidebar);
    expect(lista).toContain('acessos');
    expect(lista).toContain('aproveitamento');
    expect(lista).toContain('capacitacao_recebida');
    // E continua sem a Gestão, que e conta de sistema e so do administrador.
    expect(lista).not.toContain('usuarios');
  });

  // CONSULTA em Efetivo passou a VER a seção INTEIRA. Antes ela sumia, porque a
  // tela mais baixa exigia operador; pela régua nova, quem tem consulta no
  // módulo LÊ as telas do módulo, e as três rotas desceram para consulta em
  // `index.js`.
  test('consulta em Efetivo ve a seção e as tres telas do modulo', () => {
    logar({ perfis: { efetivo: 1 } });
    const { sidebar } = createSidebar({ modulo: null });

    const efetivo = [...sidebar.querySelectorAll('.sidebar__module-header')]
      .find(h => h.textContent.includes('Efetivo'));
    expect(efetivo).toBeTruthy();
    expect(efetivo.getAttribute('href')).toBe('#/acessos');

    const lista = ids(sidebar);
    expect(lista).toContain('acessos');
    expect(lista).toContain('aproveitamento');
    expect(lista).toContain('capacitacao_recebida');
    // E NAO ve a Gestão, que e conta de sistema: continua so do administrador.
    expect(lista).not.toContain('usuarios');
  });
});

// A seção PIT reúne metas, execução mensal, Extra-PIT e capacitação. "PIT do
// ano" é a primeira tela dela, e não um item solto de plataforma, porque as
// quatro se leem JUNTAS.
//
// O RÓTULO é "PIT" e o MÓDULO de permissão é 'pit': o módulo é `dominio.modulo`
// code 4, que se chamava 'producao' até 2026-08-09 e hoje se chama PIT no banco
// também. Os casos abaixo asserem os dois lados de propósito, para o rótulo não
// arrastar o módulo junto.
describe('sidebar: a seção PIT reúne o plano anual e o que acontece com ele', () => {
  test('as quatro telas estão na seção, e o cabeçalho leva às metas', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    const secaoPit = [...sidebar.querySelectorAll('.sidebar__module-header')]
      .find(h => h.textContent.includes('PIT'));
    expect(secaoPit).toBeTruthy();
    // O rótulo é EXATAMENTE "PIT", e a rota da home NÃO acompanhou: '#/metas' é
    // o endereço que a execução e a rastreabilidade apontam.
    expect(secaoPit.querySelector('.sidebar__item-label').textContent).toBe('PIT');
    expect(secaoPit.getAttribute('href')).toBe('#/metas');

    const itens = [...sidebar.querySelectorAll(
      '[data-id="metas"], [data-id="execucao_pit"], [data-id="extra_pit"], '
      + '[data-id="campo"], [data-id="capacitacao_ministrada"]'
    )];
    expect(itens.map(i => i.dataset.id))
      .toEqual(['metas', 'execucao_pit', 'extra_pit', 'campo', 'capacitacao_ministrada']);
    expect(itens[1].getAttribute('href')).toBe('#/execucao_pit');
  });

  // A seção NÃO se restringe, e DUAS das quatro telas sim. A diferença não é
  // descuido: as metas e o Extra-PIT são `acessoLoader`, porque cadastrar NC,
  // item de PDR ou pedido de impressão obriga a escolher a meta que financia ou
  // cumpre, e quem trabalha na mapoteca precisa ler o plano sem ter perfil no
  // PIT. A execução e a capacitação ministrada são do MÓDULO. Oferecê-las a
  // quem levaria 403 é o desencontro que o `podeAbrirRota` existe para evitar do
  // lado dos módulos.
  test('quem nao tem perfil em Producao ve o plano, e nao ve a execução nem a capacitação', () => {
    logar({ perfis: { mapoteca: 3 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });

    const lista = ids(sidebar);
    expect(lista).toContain('metas');
    expect(lista).toContain('extra_pit');
    expect(lista).not.toContain('execucao_pit');
    expect(lista).not.toContain('capacitacao_ministrada');
    expect(lista).not.toContain('campo');
  });

  // A EXECUÇÃO deixou de ser "administrador ou gerente de qualquer módulo" e
  // passou a ser do MÓDULO PIT, na consulta. Sem este caso, a mudança
  // poderia ter apenas escondido a grade de todo mundo e o caso acima
  // continuaria verde.
  test('consulta em Producao ve a execução e a capacitação ministrada', () => {
    logar({ perfis: { pit: 1 } });
    const { sidebar } = createSidebar({ modulo: null });

    const lista = ids(sidebar);
    expect(lista).toContain('execucao_pit');
    expect(lista).toContain('capacitacao_ministrada');
    // E as atividades de campo, que entraram na secao em 2026-08-08 com a mesma
    // regua: consulta LE a lista e o mapa.
    expect(lista).toContain('campo');
    // E NAO a recebida, que e do modulo Efetivo: as duas saem da mesma tabela e
    // so o modulo as separa.
    expect(lista).not.toContain('capacitacao_recebida');
    // E o plano anual, que e de qualquer conta com acesso.
    expect(lista).toContain('metas');
  });

  // O GERENTE de outro módulo perdeu a grade: ela seguia `ehGerenteDeAlgumModulo`
  // e agora segue o módulo PIT. Quem responde pela mapoteca não lê mais a
  // execução do PIT, e a rota diz o mesmo.
  test('gerente de outro modulo nao ve mais a execução do PIT', () => {
    logar({ perfis: { mapoteca: 3 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });

    expect(ids(sidebar)).not.toContain('execucao_pit');
    // Mas continua vendo a Rastreabilidade, que ESSA segue sendo do gerente de
    // qualquer modulo: as duas reguas sao diferentes de proposito.
    expect(ids(sidebar)).toContain('rastreabilidade');
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

// Os DOIS itens soltos de plataforma seguem a MESMA regua: administrador global
// OU gerente de qualquer modulo, porque cada gerente ve o recorte do modulo
// dele. O RPCMTec chegou aqui depois: era so do administrador, porque o
// relatorio traz valor de credito, de empenho e de liquidacao. O recorte de
// verdade e do servidor; o que se prova aqui e que o MENU nao oferece a tela a
// quem levaria 403, nem a esconde de quem pode abri-la.
describe('sidebar: Rastreabilidade e RPCMTec sao do administrador E do gerente', () => {
  test('o administrador global ve os dois itens', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    expect(sidebar.querySelector('[data-id="rastreabilidade"]').getAttribute('href'))
      .toBe('#/rastreabilidade');
    expect(sidebar.querySelector('[data-id="rpcmtec"]').getAttribute('href'))
      .toBe('#/rpcmtec');
  });

  test('gerente de UM modulo ve os dois, mesmo sem ser administrador', () => {
    logar({ perfis: { mapoteca: 3 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });

    expect(ids(sidebar)).toContain('rastreabilidade');
    // O RPCMTec deixou de ser admin-only: gerente responde pela area inteira, e
    // le o relatorio inteiro. A ESCRITA continua recortada no servidor.
    expect(ids(sidebar)).toContain('rpcmtec');
    // E continua sem ver o que e so do administrador.
    expect(ids(sidebar)).not.toContain('usuarios');
  });

  test('operador nao ve: para ele as telas seriam uma varredura que responde 403', () => {
    logar({ perfis: { mapoteca: 2, acervo: 1 } });
    const { sidebar } = createSidebar({ modulo: 'mapoteca' });

    expect(ids(sidebar)).not.toContain('rastreabilidade');
    expect(ids(sidebar)).not.toContain('rpcmtec');
  });

  // Ela e ITEM SOLTO de plataforma, ao lado do RPCMTec, e nao mora dentro da
  // seção Efetivo: aquela seção e sobre PESSOAS, e este item e sobre o que
  // aconteceu com os DADOS.
  test('fica FORA da seção Efetivo, que e sobre pessoas, e este item e sobre dados', () => {
    logar({ administrador: true });
    const { sidebar } = createSidebar({ modulo: null });

    const item = sidebar.querySelector('[data-id="rastreabilidade"]');
    expect(item.closest('.sidebar__module')).toBeNull();
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

  // A nota de empenho MORAVA num grupo colapsavel ("Execução"), e este caso
  // provava que setActive abria o grupo. O grupo acabou, e a intencao continua a
  // mesma: marcar o item ativo nao basta se ele ficar escondido dentro de uma
  // seção fechada. Quem abre agora e a SEÇÃO do modulo, um nivel acima.
  test('setActive marca o item e abre a seção que o contem', () => {
    logar({ administrador: true });
    const ctrl = createSidebar({ modulo: 'orcamento' });
    ctrl.setActive('orcamento:notas_empenho');

    const item = ctrl.sidebar.querySelector('[data-id="orcamento:notas_empenho"]');
    expect(item.classList.contains('sidebar__item--active')).toBe(true);
    // O item esta DIRETO na lista da seção, sem nivel intermediario.
    expect(item.closest('.sidebar__group')).toBeNull();
    expect(item.parentElement.classList.contains('sidebar__module-items')).toBe(true);
    expect(item.closest('.sidebar__module').classList.contains('sidebar__module--open')).toBe(true);
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

// ---------------------------------------------------------------------------
// O MENU DE CADA SEÇÃO E PLANO.
//
// Existiram dois grupos colapsaveis ("Materiais" na mapoteca e "Execução" no
// orcamento), e os dois foram achatados. Dentro de uma seção que ja abre e
// fecha, o grupo era um segundo clique para chegar a uma tela e escondia telas
// de quem nao sabia que elas existiam. A maquina de grupo saiu de sidebar.js, e
// estes casos existem para o grupo nao voltar por descuido: um `children` novo
// num manifesto nao desenharia grupo nenhum -- desenharia um link quebrado,
// porque o item de grupo nao tem `path`.
// ---------------------------------------------------------------------------
describe('sidebar: o menu de cada seção e plano, sem grupo colapsavel', () => {
  test('nenhum item de menu de nenhum modulo declara `children`', () => {
    for (const modulo of MODULOS) {
      for (const item of modulo.menu || []) {
        expect(item.children, `${modulo.id}: o item "${item.id}" voltou a ser grupo`)
          .toBeUndefined();
        // O corolario: todo item navega, porque so o cabeçalho de grupo nao
        // tinha rota. O que separa um do outro e a rota estar DECLARADA, e nao
        // ela ser um texto nao vazio: o item "Dashboard" do equipamento declara
        // `path: ''`, que e a raiz do modulo ('#/equipamento'), e uma tela de
        // verdade. Cobrar `toBeTruthy` aqui confundia "sem rota" com "rota na
        // raiz" e reprovava um menu correto.
        expect(typeof item.path, `${modulo.id}: o item "${item.id}" nao aponta rota nenhuma`)
          .toBe('string');
        // E o item continua apontando para dentro do modulo: caminho absoluto
        // aqui viraria '#/orcamento//dfd' na hora de montar o href.
        expect(item.path === '' || item.path.startsWith('/'),
          `${modulo.id}: o item "${item.id}" tem caminho "${item.path}"`).toBe(true);
      }
    }
  });

  test('a sidebar nao desenha grupo nenhum, em perfil nenhum', () => {
    for (const cenario of [
      { administrador: true },
      { perfis: { acervo: 3, mapoteca: 3, orcamento: 3, pit: 3, efetivo: 3 } },
      { perfis: { acervo: 2, mapoteca: 2, orcamento: 2, pit: 2, efetivo: 2 } },
      { perfis: { acervo: 1, mapoteca: 1, orcamento: 1, pit: 1, efetivo: 1 } },
    ]) {
      localStorage.clear();
      logar(cenario);
      const { sidebar } = createSidebar({ modulo: null });

      expect(sidebar.querySelectorAll('.sidebar__group').length).toBe(0);
      expect(sidebar.querySelectorAll('.sidebar__group-header').length).toBe(0);
      expect(sidebar.querySelectorAll('.sidebar__subitem').length).toBe(0);
      // E os itens continuam la: o achatamento promoveu, nao apagou.
      expect(ids(sidebar).length).toBeGreaterThan(0);
    }
  });
});

// ---------------------------------------------------------------------------
// O MENU DE PLATAFORMA E A GUARDA DA ROTA NAO PODEM DIVERGIR.
//
// Nos modulos quem impede a divergencia e `podeAbrirRota`, que le o manifesto: o
// teste la em cima cobra isso. As telas de PLATAFORMA nao tem manifesto, e a
// regua delas mora em dois lugares -- o `visivel` do item, aqui na sidebar, e o
// `guard` da rota, em index.js. Ja aconteceu de um mudar sem o outro, e o
// sintoma e mudo dos dois lados: o menu esconde tela permitida, ou oferece tela
// que responde /unauthorized.
//
// A TABELA ABAIXO ESPELHA index.js, e e a unica copia aceitavel: ela usa os
// MESMOS guardas do router, entao so o par (rota, guarda) esta repetido. Item de
// plataforma novo sem entrada aqui reprova, de proposito.
// ---------------------------------------------------------------------------
const GUARDA_DA_ROTA = {
  '/usuarios': adminLoader,
  // A instituição entrou em 2026-08-09, ao lado da Gestão: as duas são do
  // administrador global e as duas dizem como esta instalação está montada.
  '/instituicao': adminLoader,
  '/acessos': perfilLoader('efetivo', 'consulta'),
  '/rastreabilidade': gerenteLoader,
  '/rpcmtec': gerenteLoader,
  '/metas': acessoLoader,
  '/execucao_pit': perfilLoader('pit', 'consulta'),
  '/extra_pit': acessoLoader,
  '/aproveitamento': perfilLoader('efetivo', ['consulta', 'gerente']),
  '/capacitacao_ministrada': perfilLoader('pit', 'consulta'),
  '/capacitacao_recebida': perfilLoader('efetivo', 'consulta'),
  // Atividades de campo. `pit`, e nao `acessoLoader` como '/metas' e
  // '/extra_pit' ao lado: aqueles dois sao lidos por quem trabalha na mapoteca e
  // no orcamento, porque cadastrar NC ou pedido obriga a escolher a meta que
  // financia. Campo nao atravessa modulo nenhum.
  '/campo': perfilLoader('pit', 'consulta'),
};

const PERSONAS = [
  { nome: 'administrador', auth: { administrador: true } },
  { nome: 'gerente em tudo', auth: { perfis: { acervo: 3, mapoteca: 3, orcamento: 3, pit: 3, efetivo: 3 } } },
  { nome: 'operador em tudo', auth: { perfis: { acervo: 2, mapoteca: 2, orcamento: 2, pit: 2, efetivo: 2 } } },
  { nome: 'consulta em tudo', auth: { perfis: { acervo: 1, mapoteca: 1, orcamento: 1, pit: 1, efetivo: 1 } } },
];

/** So as rotas de PLATAFORMA: as de modulo ja tem `podeAbrirRota` cobrando. */
function rotasDePlataforma(sidebar) {
  const links = [...sidebar.querySelectorAll('a[href^="#/"]')]
    .map(a => a.getAttribute('href').slice(1))
    .filter(rota => !MODULOS.some(m => rota === `/${m.id}` || rota.startsWith(`/${m.id}/`)));
  return [...new Set(links)];
}

describe('sidebar: o menu de plataforma nao diverge da guarda da rota', () => {
  test('todo link de plataforma que a sidebar mostra passa na guarda, em toda persona', () => {
    for (const persona of PERSONAS) {
      localStorage.clear();
      logar(persona.auth);
      const { sidebar } = createSidebar({ modulo: null });

      const rotas = rotasDePlataforma(sidebar);
      // Cabeçalho de seção conta: ele e um LINK, e mandar a pessoa para uma home
      // que ela nao alcança e o mesmo defeito.
      expect(rotas.length, `${persona.nome}: nenhum link de plataforma na tela`)
        .toBeGreaterThan(0);

      for (const rota of rotas) {
        const guarda = GUARDA_DA_ROTA[rota];
        expect(
          typeof guarda,
          `${persona.nome}: a sidebar mostra ${rota}, que nao esta na tabela de guardas`
        ).toBe('function');
        expect(
          guarda(),
          `${persona.nome}: a sidebar mostra ${rota}, que o guarda de index.js recusaria`
        ).toBe(true);
      }
    }
  });

  // O outro lado: esconder tela permitida tambem e divergencia. A consulta e a
  // persona que mais sofreu com isso, porque a regua inteira desceu para ela.
  test('consulta em tudo alcança as telas de leitura da plataforma', () => {
    logar(PERSONAS[3].auth);
    const { sidebar } = createSidebar({ modulo: null });

    const rotas = rotasDePlataforma(sidebar);
    for (const rota of [
      '/metas', '/extra_pit', '/execucao_pit', '/capacitacao_ministrada',
      '/acessos', '/aproveitamento', '/capacitacao_recebida',
    ]) {
      expect(rotas, `a consulta deixou de ver ${rota}`).toContain(rota);
    }
    // E o que ela NAO alcança continua fora: a Gestão e do administrador, e o
    // RPCMTec e do gerente para cima.
    expect(rotas).not.toContain('/usuarios');
    expect(rotas).not.toContain('/rpcmtec');
    expect(rotas).not.toContain('/rastreabilidade');
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
// Antes disto, a seção do PIT continuava desenhada, e era a unica coisa na
// sidebar de quem nao tinha acesso a nada -- um sistema oferecido a quem
// levaria 403.
// ---------------------------------------------------------------------------
describe('sidebar: quem ainda nao tem acesso a nada', () => {
  test('nao ve seção nenhuma, nem a do PIT', () => {
    logar({ perfis: {} });
    const { sidebar } = createSidebar({ modulo: null });

    expect(modulosNaTela(sidebar)).toEqual([]);
    expect(ids(sidebar)).toEqual([]);
  });

  // Um perfil qualquer, em qualquer modulo, ja devolve a seção: o PIT do ano e
  // o plano da Divisao inteira, e nao pede perfil no modulo 'pit'.
  test('com qualquer perfil, a seção de Produção volta', () => {
    logar({ perfis: { mapoteca: 1 } });
    const { sidebar } = createSidebar({ modulo: null });

    expect(modulosNaTela(sidebar)).toContain('#/metas');
  });
});
