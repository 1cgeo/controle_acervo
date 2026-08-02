import { el, svgIcon, ICONS } from '@utils/dom.js';
import { isAdmin, nomeModulo, ehGerenteDeAlgumModulo } from '@store/auth-store.js';
import { getModulo, modulosAcessiveis, rotaInicial, podeAbrirRota } from '@modules/registry.js';

/**
 * Itens de PLATAFORMA, fora de qualquer modulo: valem nos tres.
 *
 * `admin: true` esconde o item de quem nao e administrador global. As Metas do
 * PIT NAO levam a marca: qualquer pessoa logada le o plano anual da Divisao, e o
 * backend cobra o administrador so na escrita. Elas moraram dentro do modulo
 * orcamento ate 2026-07-31, e era justamente isso que impedia quem so tem perfil
 * na mapoteca de ver a lista.
 */
const MENU_PLATAFORMA = [
  // "Metas do PIT" saiu daqui em 2026-08-02 e virou a primeira tela da seção
  // Produção: ela deixou de ser um cadastro solto quando ganhou a execução
  // mensal e o Extra-PIT ao lado.
  //
  // O RPCMTec LEVA a marca de administrador: ele cruza os tres modulos numa
  // peca so, com valor de credito e de empenho dentro. Esteve partido em dois
  // itens de modulo ate 2026-08-01, um na mapoteca e outro no orcamento.
  { id: 'rpcmtec', label: 'RPCMTec', icon: ICONS.print, path: '/rpcmtec', admin: true },
  // Rastreabilidade: o que foi alterado nos modulos, quando e por quem. NAO leva
  // `admin: true`, e nao e esquecimento: ela e do administrador global E do
  // gerente de qualquer modulo, que ve o recorte do modulo dele. Quem decide o
  // recorte e o servidor (verifyRastreabilidade), e o `visivel` daqui so evita
  // oferecer a tela a quem levaria 403.
  //
  // Fora do grupo "Usuarios" de proposito: aquele grupo e sobre PESSOAS, e este
  // item e sobre o que aconteceu com os DADOS. Ele tambem nao se confunde com
  // #/acervo/auditoria, que mede a coerencia do acervo hoje e nao diz quem
  // produziu a incoerencia.
  {
    id: 'rastreabilidade',
    label: 'Rastreabilidade',
    icon: ICONS.assignment,
    path: '/rastreabilidade',
    visivel: () => isAdmin() || ehGerenteDeAlgumModulo(),
  },
];

/**
 * EFETIVO como SEÇÃO DE SISTEMA, e não como grupo do menu de plataforma
 * (chefe, 2026-08-02).
 *
 * Chamava-se "Usuários" até 2026-08-02, e o nome mudou junto com o conteúdo: o
 * aproveitamento mensal entrou aqui, e ele não é sobre CONTA de sistema, é sobre
 * quem serve na Divisão e o que cada um faz. "Usuários" descreveria bem duas das
 * três telas e mal a terceira. A rota `#/usuarios` continua a mesma, porque
 * renomear URL quebra link guardado.
 *
 * Ele fica logo depois do orçamento, ACIMA do separador, e se desenha como os
 * três módulos: cabeçalho que é LINK para a home, com o chevron ao lado abrindo
 * a lista sem navegar. A razão é que administrar gente virou um sistema de
 * verdade quando a autenticação veio para dentro do SCA: tem dashboard, tem
 * cadastro, e tem quem entre nele para trabalhar um turno inteiro. Como grupo
 * colapsável no meio de "Metas do PIT" e "RPCMTec" ele se lia como um item de
 * configuração.
 *
 * O DASHBOARD VEM PRIMEIRO, e é o que o cabeçalho abre. É a mesma regra dos
 * módulos, e a mesma razão: quem clica no nome de um sistema quer a visão geral,
 * não a primeira tela em ordem alfabética. Ele se chamava "Acessos" e virou
 * "Dashboard" no menu; a rota continua `#/acessos`, porque `dgeo.login` é o que
 * ela lê e renomear a URL quebraria link guardado.
 *
 * Não é um módulo de verdade: não está em `dominio.modulo`, não tem perfil e não
 * entra no `registry.js`. Por isso o `id` daqui não pode ser 'usuarios' -- a
 * chave do item ativo sai do primeiro segmento da rota (`activeIdFromPath`), e
 * o FILHO '/usuarios' precisa dela.
 */
const SISTEMA_EFETIVO = {
  id: 'efetivo-area',
  label: 'Efetivo',
  icon: ICONS.people,
  admin: true,
  home: '/acessos',
  // Sem prefixo: são rotas de PLATAFORMA, e não '/efetivo-area/...'.
  prefixo: '',
  chavePrefixo: '',
  menu: [
    { id: 'acessos', label: 'Dashboard', icon: ICONS.dashboard, path: '/acessos' },
    { id: 'usuarios', label: 'Gestão', icon: ICONS.people, path: '/usuarios' },
    // O retrato mensal do efetivo, que alimenta a subseção 6.1 do RPCMTec.
    // Fica aqui, e não junto do relatório, porque quem o preenche vem procurar
    // por PESSOA: é a mesma lista de gente da tela ao lado, num mês.
    {
      id: 'aproveitamento',
      label: 'Aproveitamento',
      icon: ICONS.assignment,
      path: '/aproveitamento',
    },
    // A capacitação RECEBIDA é gente nossa em curso, então mora aqui. A
    // MINISTRADA é serviço que a Divisão presta, e mora em Produção. As duas
    // saem da mesma tabela, e em subseções diferentes do relatório.
    {
      id: 'capacitacao_recebida',
      label: 'Capacitação recebida',
      icon: ICONS.description,
      path: '/capacitacao_recebida',
    },
  ],
};

/**
 * PRODUÇÃO: o plano anual da Divisão e o que acontece com ele (chefe,
 * 2026-08-02).
 *
 * Nasceu quando o SCA absorveu do SAP o que não depende da produção controlada
 * lá: a execução mensal das metas, o Extra-PIT e a capacitação. As "Metas do
 * PIT" vieram do menu de plataforma para cá, porque as quatro telas se leem
 * JUNTAS -- a execução não faz sentido sem a meta, e o Extra-PIT é a exceção
 * a ela.
 *
 * A SEÇÃO NÃO leva `admin: true`, e não é esquecimento. Metas e execução são
 * `authLoader`: qualquer pessoa logada LÊ o plano anual, e o servidor cobra o
 * administrador só na escrita. A capacitação leva a marca no ITEM, porque ela é
 * entrada do RPCMTec e o servidor a guarda com verifyAdmin -- oferecê-la a quem
 * levaria 403 é o desencontro que `podeAbrirRota` existe para evitar do lado
 * dos módulos.
 */
const SISTEMA_PRODUCAO = {
  id: 'producao-area',
  label: 'Produção',
  icon: ICONS.layers,
  home: '/metas',
  prefixo: '',
  chavePrefixo: '',
  menu: [
    { id: 'metas', label: 'Metas do PIT', icon: ICONS.category, path: '/metas' },
    // A execução do PIT é do GERENTE e do administrador (chefe, 2026-08-02), e
    // não de qualquer pessoa logada como as metas ao lado. Por isso ela leva
    // `visivel` em vez de `admin: true`: nenhuma das duas marcas descreve
    // "administrador OU gerente", que é a regra que o servidor cobra.
    {
      id: 'execucao_pit',
      label: 'Execução do PIT',
      icon: ICONS.dataUsage,
      path: '/execucao_pit',
      visivel: () => isAdmin() || ehGerenteDeAlgumModulo(),
    },
    { id: 'extra_pit', label: 'Extra-PIT', icon: ICONS.warning, path: '/extra_pit' },
    {
      id: 'capacitacao_ministrada',
      label: 'Capacitação ministrada',
      icon: ICONS.description,
      path: '/capacitacao_ministrada',
      admin: true,
    },
  ],
};

/** Icone de cada modulo, quando o manifesto nao declara um. */
const ICONE_PADRAO_MODULO = ICONS.layers;

/**
 * Sidebar da interface unica.
 *
 * A sidebar lista TODOS os modulos que a pessoa acessa, cada um como uma seção
 * colapsavel, mais a seção de plataforma no fim. Ela e montada UMA vez e nunca
 * se desmonta: navegar para uma rota de plataforma (ex.: #/usuarios) abre a
 * tela sem apagar os modulos, que era o defeito do desenho anterior, onde
 * `setModulo(null)` limpava o menu inteiro.
 *
 * Trocar de modulo tambem se faz por aqui: cada cabecalho de modulo e um link
 * para a home daquele modulo. O seletor da navbar deixou de existir.
 *
 * @param {Object} options
 * @param {boolean} [options.collapsed]
 * @param {string|null} [options.modulo] - id do modulo ativo
 */
export function createSidebar({ collapsed = false, modulo = null } = {}) {
  let isCollapsed = collapsed;
  let isMobileOpen = false;

  const nav = el('nav', { className: 'sidebar__nav', 'aria-label': 'Menu principal' });

  const sidebar = el('aside', {
    className: `sidebar${isCollapsed ? ' sidebar--collapsed' : ''}`,
  }, [nav]);

  const overlay = el('div', {
    className: 'sidebar-overlay',
    onClick: () => setMobileOpen(false),
  });

  // Chave dos itens: `<modulo>:<item>` nos modulos e `<item>` na plataforma.
  // Sem o prefixo, o `dashboard` dos tres modulos colidiria num mapa so.
  const itemElements = {};
  // Grupos DENTRO de um modulo (ex.: "Materiais" na mapoteca).
  const groupElements = [];
  // Uma entrada por modulo, para abrir e fechar a seção.
  const moduleSections = [];

  function buildItem(item, prefixo, chavePrefixo, isSubitem = false) {
    const icon = el('span', { className: 'sidebar__item-icon' }, [svgIcon(item.icon, isSubitem ? 20 : 24)]);
    const label = el('span', { className: 'sidebar__item-label', textContent: item.label });

    const chave = chavePrefixo ? `${chavePrefixo}:${item.id}` : item.id;

    const menuItem = el('a', {
      className: `sidebar__item${isSubitem ? ' sidebar__subitem' : ''}`,
      href: `#${prefixo}${item.path}`,
      dataset: { id: chave },
      onClick: () => setMobileOpen(false),
    }, [icon, label]);

    itemElements[chave] = menuItem;
    return menuItem;
  }

  /**
   * O item aparece? Num modulo a resposta sai da ROTA que ele aponta, entao
   * restringir uma tela restringe o menu junto, sem ninguem lembrar de repetir
   * a regra aqui. `admin: true` no proprio item continua valendo para o que nao
   * tem rota de modulo, que hoje e so o menu de plataforma.
   * @param {Object} item
   * @param {string} moduloId - '' nos itens de plataforma
   * @returns {boolean}
   */
  function itemVisivel(item, moduloId) {
    if (item.admin && !isAdmin()) return false;
    // `visivel` e a terceira resposta, para o item de plataforma que nao e "de
    // todos" nem "so do administrador". Existe por causa da Rastreabilidade, que
    // e do administrador global E do gerente de qualquer modulo: com `admin:
    // true` o gerente nao veria o item e ainda assim abriria a tela pela URL,
    // que e exatamente o desencontro que `podeAbrirRota` existe para evitar do
    // lado dos modulos.
    if (typeof item.visivel === 'function' && !item.visivel()) return false;
    if (!moduloId || !item.path) return true;
    return podeAbrirRota(moduloId, item.path);
  }

  function buildMenu(itens, prefixo, chavePrefixo, destino) {
    for (const item of itens) {
      if (!itemVisivel(item, chavePrefixo)) continue;

      if (item.children) {
        const filhos = item.children.filter(c => itemVisivel(c, chavePrefixo));
        if (!filhos.length) continue;

        const childIds = filhos.map(c => (chavePrefixo ? `${chavePrefixo}:${c.id}` : c.id));
        const itemsContainer = el('div', { className: 'sidebar__group-items' },
          filhos.map(child => buildItem(child, prefixo, chavePrefixo, true))
        );

        const header = el('button', {
          className: 'sidebar__group-header',
          type: 'button',
          'aria-expanded': 'false',
          onClick: () => {
            const open = group.classList.toggle('sidebar__group--open');
            header.setAttribute('aria-expanded', String(open));
          },
        }, [
          el('span', { className: 'sidebar__item-icon' }, [svgIcon(item.icon, 24)]),
          el('span', { className: 'sidebar__item-label', textContent: item.label }),
          el('span', { className: 'sidebar__group-chevron' }, [svgIcon(ICONS.expandMore, 18)]),
        ]);

        const group = el('div', { className: 'sidebar__group' }, [header, itemsContainer]);
        groupElements.push({ group, header, childIds });
        destino.appendChild(group);
      } else {
        destino.appendChild(buildItem(item, prefixo, chavePrefixo));
      }
    }
  }

  /**
   * Uma seção colapsavel de SISTEMA. O cabecalho e um LINK para a home, entao
   * clicar nele ja entra no sistema; o chevron ao lado abre e fecha a lista sem
   * navegar.
   *
   * Serve aos tres modulos E a area de Usuarios, que se desenha igual sem ser
   * modulo (ver SISTEMA_EFETIVO e SISTEMA_PRODUCAO). Por isso ela recebe o rotulo e a home JA
   * RESOLVIDOS: o modulo os tira do catalogo do servidor (`nomeModulo`) e do
   * manifesto (`rotaInicial`), e a area de Usuarios os declara, porque nao esta
   * em `dominio.modulo` nem no registry.
   *
   * @param {Object} sistema
   * @param {string} sistema.id
   * @param {string} sistema.label
   * @param {string} sistema.home - rota completa, com o '/' inicial
   * @param {Array} sistema.menu
   * @param {string} sistema.prefixo - '' quando os caminhos ja sao completos
   * @param {string} sistema.chavePrefixo - '' quando a chave nao leva modulo
   */
  function buildSystemSection(sistema) {
    const itensContainer = el('div', { className: 'sidebar__module-items' });
    buildMenu(sistema.menu || [], sistema.prefixo, sistema.chavePrefixo, itensContainer);

    const chevron = el('button', {
      className: 'sidebar__module-chevron',
      type: 'button',
      'aria-label': `Abrir ou fechar ${sistema.label}`,
      onClick: (e) => {
        // Sem isto o clique subiria para o link e navegaria junto.
        e.preventDefault();
        e.stopPropagation();
        const open = section.classList.toggle('sidebar__module--open');
        chevron.setAttribute('aria-expanded', String(open));
      },
    }, [svgIcon(ICONS.expandMore, 18)]);

    const header = el('a', {
      className: 'sidebar__module-header',
      href: `#${sistema.home}`,
      title: sistema.label,
      onClick: () => setMobileOpen(false),
    }, [
      el('span', { className: 'sidebar__item-icon' }, [svgIcon(sistema.icon || ICONE_PADRAO_MODULO, 24)]),
      el('span', { className: 'sidebar__item-label', textContent: sistema.label }),
      chevron,
    ]);

    // As chaves dos filhos, para o `setActive` saber abrir a seção quando a rota
    // ativa mora dentro dela. Os modulos ja abriam pelo `setModulo`, que le o
    // modulo da rota; a area de Usuarios nao tem modulo nenhum, e sem isto
    // ficaria fechada justamente quando a pessoa esta dentro dela.
    const childIds = (sistema.menu || [])
      .filter(i => i.path)
      .map(i => (sistema.chavePrefixo ? `${sistema.chavePrefixo}:${i.id}` : i.id));

    const section = el('div', { className: 'sidebar__module' }, [header, itensContainer]);
    moduleSections.push({ id: sistema.id, section, header, chevron, childIds });
    nav.appendChild(section);
  }

  function build() {
    for (const mod of modulosAcessiveis()) {
      buildSystemSection({
        id: mod.id,
        label: nomeModulo(mod.id),
        icon: mod.icon,
        home: rotaInicial(mod),
        menu: mod.menu || [],
        prefixo: `/${mod.id}`,
        chavePrefixo: mod.id,
      });
    }

    // Logo DEPOIS dos módulos e ACIMA do separador: é a posição que diz "isto é
    // um sistema", e não um item de configuração no meio das telas soltas.
    //
    // Produção vem antes de Efetivo porque é a que fala do TRABALHO, e Efetivo é
    // quem o faz. A ordem também põe as telas mais usadas mais perto dos
    // módulos.
    if (itemVisivel(SISTEMA_PRODUCAO, '')) {
      buildSystemSection(SISTEMA_PRODUCAO);
    }
    if (itemVisivel(SISTEMA_EFETIVO, '')) {
      buildSystemSection(SISTEMA_EFETIVO);
    }

    const plataforma = MENU_PLATAFORMA.filter(i => itemVisivel(i, ''));
    if (plataforma.length) {
      if (nav.childElementCount) {
        nav.appendChild(el('div', { className: 'sidebar__separator' }));
      }
      buildMenu(plataforma, '', '', nav);
    }
  }

  /**
   * Abre a seção do modulo ativo e fecha as demais. Com `null` (rota de
   * plataforma) NADA e fechado: a pessoa continua vendo onde estava.
   * @param {string|null} moduloId
   */
  function setModulo(moduloId) {
    for (const { id, section, header, chevron } of moduleSections) {
      const ativo = id === moduloId;
      header.classList.toggle('sidebar__module-header--active', ativo);
      if (!moduloId) continue;
      section.classList.toggle('sidebar__module--open', ativo);
      chevron.setAttribute('aria-expanded', String(ativo));
    }
  }

  /** Marca o item ativo pela chave qualificada (ver activeIdFromPath). */
  function setActive(activeId) {
    for (const [chave, itemEl] of Object.entries(itemElements)) {
      itemEl.classList.toggle('sidebar__item--active', chave === activeId);
    }

    // Seção de sistema cuja rota ativa mora dentro dela: abre e marca o
    // cabeçalho. Os módulos já faziam isso pelo `setModulo`, que lê o módulo da
    // rota; a área de Usuários não tem módulo, então `setModulo` recebe null e
    // ela ficaria fechada justamente quando a pessoa está dentro dela.
    for (const { section, header, chevron, childIds } of moduleSections) {
      if (!childIds || !childIds.includes(activeId)) continue;
      header.classList.add('sidebar__module-header--active');
      section.classList.add('sidebar__module--open');
      chevron.setAttribute('aria-expanded', 'true');
    }
    for (const { group, header, childIds } of groupElements) {
      const hasActiveChild = childIds.includes(activeId);
      header.classList.toggle('sidebar__group-header--active', hasActiveChild);
      if (hasActiveChild && !group.classList.contains('sidebar__group--open')) {
        group.classList.add('sidebar__group--open');
        header.setAttribute('aria-expanded', 'true');
      }
    }
  }

  function toggle() {
    isCollapsed = !isCollapsed;
    sidebar.classList.toggle('sidebar--collapsed', isCollapsed);
    return isCollapsed;
  }

  function setMobileOpen(open) {
    isMobileOpen = open;
    sidebar.classList.toggle('sidebar--mobile-open', isMobileOpen);
    overlay.classList.toggle('sidebar-overlay--visible', isMobileOpen);
  }

  function isCurrentlyCollapsed() {
    return isCollapsed;
  }

  build();
  setModulo(modulo);

  return { sidebar, overlay, setModulo, setActive, toggle, setMobileOpen, isCurrentlyCollapsed };
}

/**
 * Resolve a chave do item da sidebar a partir de uma rota COMPLETA.
 * A chave carrega o modulo porque `dashboard` existe nos tres:
 *   '/orcamento/notas_empenho/3' -> 'orcamento:notas_empenho'
 *   '/acervo/dashboard'          -> 'acervo:dashboard'
 *   '/usuarios'                  -> 'usuarios'
 * @param {string} path
 * @returns {string|null}
 */
export function activeIdFromPath(path) {
  const partes = String(path || '').split('?')[0].split('/').filter(Boolean);
  if (!partes.length) return null;

  // Rota de modulo: o primeiro segmento e o modulo, o segundo e o item. Usa
  // getModulo, e nao modulosAcessiveis, para a funcao nao depender da sessao.
  if (getModulo(partes[0])) {
    return partes[1] ? `${partes[0]}:${partes[1]}` : null;
  }
  // Rota de plataforma (ex.: '/usuarios').
  return partes[0];
}
