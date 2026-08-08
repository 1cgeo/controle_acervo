import { el, svgIcon, ICONS } from '@utils/dom.js';
import {
  isAdmin, nomeModulo, ehGerenteDeAlgumModulo, temPerfil, ehDeAlgumPerfil, temAlgumAcesso,
} from '@store/auth-store.js';
import { getModulo, modulosAcessiveis, rotaInicial, podeAbrirRota } from '@modules/registry.js';

/**
 * Itens de PLATAFORMA, fora de qualquer modulo: valem nos tres.
 *
 * As DUAS sao do administrador global E do gerente de qualquer modulo, e por
 * isso as duas levam `visivel`: nem `admin: true` nem a ausencia de marca
 * descrevem "administrador OU gerente", que e o que as rotas cobram
 * (`gerenteLoader`, em index.js). O piso das telas de plataforma que valem para
 * qualquer conta com acesso (o PIT do ano e o Extra-PIT) fica na seção PIT, e
 * nao aqui.
 */
const MENU_PLATAFORMA = [
  // SEM "Metas do PIT": ela e a primeira tela da seção PIT, ao lado da
  // execução mensal e do Extra-PIT.
  //
  // O RPCMTec PERDEU a marca de administrador, e passou a ser do administrador
  // global E do gerente de qualquer modulo, como a Rastreabilidade abaixo.
  //
  // Isto REVERTE o admin-only, que existia porque o relatorio cruza os tres
  // modulos numa peca so, com valor de credito, de empenho e de liquidacao
  // dentro, e liberar por perfil de um modulo entregaria o orcamento a quem so
  // cataloga carta. O chefe pediu o contrario: gerente responde pela area
  // inteira, e le o relatorio inteiro. A rota virou `gerenteLoader`, e a ESCRITA
  // continua recortada no servidor.
  {
    id: 'rpcmtec',
    label: 'RPCMTec',
    icon: ICONS.print,
    path: '/rpcmtec',
    visivel: () => isAdmin() || ehGerenteDeAlgumModulo(),
  },
  // Rastreabilidade: o que foi alterado nos modulos, quando e por quem. NAO leva
  // `admin: true`, e nao e esquecimento: ela e do administrador global E do
  // gerente de qualquer modulo, que ve o recorte do modulo dele. Quem decide o
  // recorte e o servidor (verifyRastreabilidade), e o `visivel` daqui so evita
  // oferecer a tela a quem levaria 403.
  //
  // Fora da seção "Efetivo" de proposito: aquela seção e sobre PESSOAS, e este
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
 * EFETIVO como SEÇÃO DE SISTEMA, e não como grupo do menu de plataforma.
 *
 * O nome não é "Usuários" porque o aproveitamento mensal mora aqui, e ele não é
 * sobre CONTA de sistema: é sobre quem serve na Divisão e o que cada um faz. As
 * rotas `#/usuarios` e `#/acessos` NÃO acompanham o rótulo, porque renomear URL
 * quebra link guardado.
 *
 * Ele fica logo depois do orçamento, ACIMA do separador, e se desenha como os
 * três módulos: cabeçalho que é LINK para a home, com o chevron ao lado abrindo
 * a lista sem navegar. Administrar gente é um sistema de verdade: tem dashboard,
 * tem cadastro, e tem quem entre nele para trabalhar um turno inteiro.
 *
 * O DASHBOARD VEM PRIMEIRO, e é o que o cabeçalho abre. É a mesma regra dos
 * módulos: quem clica no nome de um sistema quer a visão geral, não a primeira
 * tela em ordem alfabética.
 *
 * A SEÇÃO NÃO É UM MÓDULO DO REGISTRY: ela não tem manifesto, não tem prefixo de
 * rota e as telas dela são de plataforma. Mas EFETIVO virou módulo de PERMISSÃO
 * na 1.33.0 (`dominio.modulo` code 5), e é dele que sai a visibilidade dos dois
 * itens de baixo. Por isso o `id` daqui não pode ser 'usuarios' -- a chave do
 * item ativo sai do primeiro segmento da rota (`activeIdFromPath`), e o FILHO
 * '/usuarios' precisa dela.
 *
 * A SEÇÃO PERDEU o `admin: true`, e sobrou UM item com a marca: a Gestão, que é
 * conta de sistema. As outras três telas são do módulo Efetivo, e cada uma
 * declara o `visivel` que a rota dela cobra em `index.js` -- inclusive o
 * Aproveitamento, que é o único a NÃO usar mínimo hierárquico.
 *
 * A SEÇÃO DESCEU ATÉ A CONSULTA porque o dashboard virou tela de LEITURA: quem
 * tem consulta no módulo Efetivo já alcança '#/acessos', e esconder dele a
 * seção seria esconder a única tela que ele tem.
 */
const SISTEMA_EFETIVO = {
  id: 'efetivo-area',
  label: 'Efetivo',
  icon: ICONS.people,
  visivel: () => isAdmin() || temPerfil('consulta', 'efetivo'),
  // A home é uma STRING de novo, e não a função que desviava o operador para
  // '#/aproveitamento'. O desvio existia porque o cabeçalho é um LINK e o
  // dashboard era do gerente: mandar o operador para lá o jogava em
  // /unauthorized ao clicar no nome da seção que é dele. Com o dashboard aberto
  // à consulta, TODO MUNDO que enxerga a seção alcança a home dela, e o desvio
  // deixou de ter para onde desviar.
  home: '/acessos',
  // Sem prefixo: são rotas de PLATAFORMA, e não '/efetivo-area/...'.
  prefixo: '',
  chavePrefixo: '',
  menu: [
    // O DASHBOARD É DO EFETIVO, e não conta de sistema: ele abre na aba Efetivo,
    // e tudo o que ela lê sai de `/efetivo/*`. A aba Acessos, essa sim é do
    // administrador global, e ela mesma se esconde de quem não é
    // (`pages/acessos/index.js`).
    //
    // CONSULTA, e não mais gerente: a rota virou `perfilLoader('efetivo',
    // 'consulta')`, porque quem tem consulta no módulo LÊ as telas do módulo. O
    // que baixou foi a porta da tela, e não o que ela mostra.
    {
      id: 'acessos',
      label: 'Dashboard',
      icon: ICONS.dashboard,
      path: '/acessos',
      visivel: () => isAdmin() || temPerfil('consulta', 'efetivo'),
    },
    // A GESTÃO É CONTA DE SISTEMA: quem tem acesso a quê. Continua do
    // administrador global, e o servidor cobra o mesmo com verifyAdmin em
    // /api/usuarios.
    { id: 'usuarios', label: 'Gestão', icon: ICONS.people, path: '/usuarios', admin: true },
    // O retrato mensal do efetivo, que alimenta a subseção 6.1 do RPCMTec.
    // Fica aqui, e não junto do relatório, porque quem o preenche vem procurar
    // por PESSOA: é a mesma lista de gente da tela ao lado, num mês.
    //
    // LISTA DE PERFIS, e ela NÃO É HIERÁRQUICA: passam consulta e gerente, e o
    // OPERADOR fica de fora. Não é engano nem inversão: o operador ficou com o
    // PRÓPRIO aproveitamento, em '#/perfil', e não com o da Divisão inteira;
    // quem lança pelos outros é o gerente, e quem só lê é a consulta. Com um
    // mínimo hierárquico o operador veria esta tela por ser um nível ACIMA de
    // consulta, que é o contrário do que foi pedido. A rota cobra o MESMO
    // (`perfilLoader('efetivo', ['consulta', 'gerente'])`), então o menu não
    // oferece o que o guarda recusaria.
    {
      id: 'aproveitamento',
      label: 'Aproveitamento',
      icon: ICONS.assignment,
      path: '/aproveitamento',
      visivel: () => ehDeAlgumPerfil(['consulta', 'gerente'], 'efetivo'),
    },
    // A capacitação RECEBIDA é gente nossa em curso, então mora aqui. A
    // MINISTRADA é serviço que a Divisão presta, e mora na seção PIT. As duas
    // saem da mesma tabela, e em subseções diferentes do relatório; as rotas,
    // essas, são duas, porque a permissão é por tipo.
    //
    // CONSULTA, e não mais operador: abrir a lista é LER. O operador continua
    // sendo o único que LANÇA, e isso é recorte de botão e de rota de escrita,
    // não da porta da tela.
    {
      id: 'capacitacao_recebida',
      label: 'Capacitação recebida',
      icon: ICONS.description,
      path: '/capacitacao_recebida',
      visivel: () => temPerfil('consulta', 'efetivo'),
    },
  ],
};

/**
 * PIT: o plano anual da Divisão e o que acontece com ele.
 *
 * Reúne metas, execução mensal, Extra-PIT e capacitação, porque as quatro telas
 * se leem JUNTAS: a execução não faz sentido sem a meta, e o Extra-PIT é a
 * exceção a ela.
 *
 * A SEÇÃO NÃO leva `admin: true`, e não é esquecimento. As METAS e o EXTRA-PIT
 * são `acessoLoader`: quem tem acesso ao sistema LÊ o plano anual sem ter perfil
 * no módulo Produção, porque cadastrar NC, item de PDR ou pedido de impressão
 * obriga a escolher a meta que financia ou cumpre. As outras duas telas levam
 * `visivel` no ITEM, cada uma repetindo o que a rota cobra em `index.js` --
 * oferecer tela a quem levaria 403 é o desencontro que `podeAbrirRota` existe
 * para evitar do lado dos módulos.
 *
 * O `visivel` da SEÇÃO é `temAlgumAcesso`, e é o que tira o menu inteiro de quem
 * ainda não recebeu perfil nenhum: sem ele, a conta recém-criada entrava e via
 * a seção como se fosse dela, que é a única coisa que sobrava na tela.
 */
const SISTEMA_PRODUCAO = {
  id: 'producao-area',
  // SÓ O RÓTULO é "PIT". O `id`, a home '/metas' e o módulo de permissão
  // 'producao' NÃO acompanham, e não é descuido: 'producao' é `dominio.modulo`
  // code 4, continua se chamando Produção no banco, e é o nome que o servidor
  // cobra em `verifyPerfil(..., 'producao')`. O rótulo fala do CONTEÚDO das
  // telas, que é o PIT do ano; o módulo fala de QUEM pode escrever nelas.
  // "Corrigir" a simetria trocando o id quebra a chave do item ativo
  // (`activeIdFromPath`), trocando a home quebra link guardado, e trocando o
  // módulo quebra a autorização.
  label: 'PIT',
  icon: ICONS.layers,
  visivel: () => temAlgumAcesso(),
  home: '/metas',
  prefixo: '',
  chavePrefixo: '',
  menu: [
    // O PIT DO ANO: uma entrada so, no lugar de "Metas do PIT" e "Revisoes do
    // PIT". Os dois itens separados escondiam a relacao entre eles: quem
    // procurava o botao de editar nas metas nao descobria que ele tinha virado
    // um ato da revisao. A tela unica poe o exercicio, as revisoes e o
    // consolidado na mesma pagina.
    //
    // A ROTA continua '/metas', e nao um '#/pit' novo: e o endereco que a grade
    // de execucao e a rastreabilidade apontam, e renomear so por simetria
    // quebraria link guardado sem ganho nenhum.
    { id: 'metas', label: 'PIT do ano', icon: ICONS.category, path: '/metas' },
    // A execução do PIT é do MÓDULO PRODUÇÃO, e não de qualquer pessoa logada
    // como as metas ao lado. O recorte deixou de ser "administrador ou gerente
    // de qualquer módulo" e passou a ser consulta em Produção, que é quem
    // escreve a grade: a rota virou `perfilLoader('producao', 'consulta')`. Ler
    // a grade não move nada; escrever continua sendo do administrador, e quem
    // barra é o servidor.
    {
      id: 'execucao_pit',
      label: 'Execução do PIT',
      icon: ICONS.dataUsage,
      path: '/execucao_pit',
      visivel: () => temPerfil('consulta', 'producao'),
    },
    { id: 'extra_pit', label: 'Extra-PIT', icon: ICONS.warning, path: '/extra_pit' },
    // A capacitação MINISTRADA é serviço que a Divisão presta, e por isso mora
    // aqui. `visivel`, e não `admin: true`: ela é rota própria, guardada pelo
    // módulo Produção.
    //
    // CONSULTA, e não mais operador, como a recebida do lado do Efetivo: abrir
    // a lista é LER, e o operador continua sendo o único que LANÇA.
    {
      id: 'capacitacao_ministrada',
      label: 'Capacitação ministrada',
      icon: ICONS.description,
      path: '/capacitacao_ministrada',
      visivel: () => temPerfil('consulta', 'producao'),
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
  // Uma entrada por modulo, para abrir e fechar a seção.
  const moduleSections = [];

  function buildItem(item, prefixo, chavePrefixo) {
    const icon = el('span', { className: 'sidebar__item-icon' }, [svgIcon(item.icon, 24)]);
    const label = el('span', { className: 'sidebar__item-label', textContent: item.label });

    const chave = chavePrefixo ? `${chavePrefixo}:${item.id}` : item.id;

    const menuItem = el('a', {
      className: 'sidebar__item',
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

  /**
   * O MENU E PLANO: item que aparece, item que navega, sem nivel intermediario.
   *
   * Os dois unicos grupos colapsaveis que existiram ("Materiais" na mapoteca e
   * "Execução" no orcamento) foram achatados: dentro de uma seção que ja abre e
   * fecha, o grupo era um segundo clique para chegar a uma tela, e escondia
   * telas de quem nao sabia que elas existiam. Nenhum manifesto declara
   * `children`, e um teste da sidebar faz cumprir.
   */
  function buildMenu(itens, prefixo, chavePrefixo, destino) {
    for (const item of itens) {
      if (!itemVisivel(item, chavePrefixo)) continue;
      destino.appendChild(buildItem(item, prefixo, chavePrefixo));
    }
  }

  /**
   * Uma seção colapsavel de SISTEMA. O cabecalho e um LINK para a home, entao
   * clicar nele ja entra no sistema; o chevron ao lado abre e fecha a lista sem
   * navegar.
   *
   * Serve aos tres modulos E as seções PIT e Efetivo, que se desenham igual sem
   * ser modulo (ver SISTEMA_EFETIVO e SISTEMA_PRODUCAO). Por isso ela recebe o
   * rotulo e a home JA RESOLVIDOS: o modulo os tira do catalogo do servidor
   * (`nomeModulo`) e do manifesto (`rotaInicial`), e as duas seções os declaram,
   * porque nao estao em `dominio.modulo` nem no registry.
   *
   * A HOME É SEMPRE UMA STRING. Ela ja foi calculavel, porque o cabeçalho e um
   * LINK e a home do Efetivo era do gerente: mandar o operador para la o jogava
   * em /unauthorized. Com o dashboard do Efetivo aberto a consulta, quem enxerga
   * a seção alcança a home dela, nos dois casos. Nos modulos quem resolve isso e
   * `registry.rotaInicial`, lendo o manifesto, e ele tambem devolve string.
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
    const { home } = sistema;
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
      href: `#${home}`,
      title: sistema.label,
      onClick: () => setMobileOpen(false),
    }, [
      el('span', { className: 'sidebar__item-icon' }, [svgIcon(sistema.icon || ICONE_PADRAO_MODULO, 24)]),
      el('span', { className: 'sidebar__item-label', textContent: sistema.label }),
      chevron,
    ]);

    // As chaves dos filhos, para o `setActive` saber abrir a seção quando a rota
    // ativa mora dentro dela. Os modulos ja abriam pelo `setModulo`, que le o
    // modulo da rota; as seções PIT e Efetivo nao tem modulo nenhum, e sem isto
    // ficariam fechadas justamente quando a pessoa esta dentro delas.
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
    // PIT vem antes de Efetivo porque é a seção que fala do TRABALHO, e Efetivo
    // é quem o faz. A ordem também põe as telas mais usadas mais perto dos
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
    // rota; as seções PIT e Efetivo não têm módulo, então `setModulo` recebe
    // null e elas ficariam fechadas justamente quando a pessoa está dentro delas.
    for (const { section, header, chevron, childIds } of moduleSections) {
      if (!childIds || !childIds.includes(activeId)) continue;
      header.classList.add('sidebar__module-header--active');
      section.classList.add('sidebar__module--open');
      chevron.setAttribute('aria-expanded', 'true');
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
