import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { openModal } from '@components/modal/modal-base.js';
import { chip } from '@components/status-chip.js';
import { formatDate, formatDateTime } from '@utils/format.js';
import { getHistorico } from '@services/rastreabilidade-service.js';
import './historico.css';

/**
 * Histórico de alterações de UM registro.
 *
 * O DEFEITO QUE ESTE COMPONENTE CORRIGE (2026-08-02). A seção "Histórico do
 * pedido" que existia em `pedidos/details.js` mostrava, na coluna "O que mudou",
 * um `campos_alterados.join(', ')`: ou seja, o NOME DA COLUNA DO BANCO. Quem lia
 * via
 *
 *     Cap Silva · Alterou · Pedido #312 · situacao_pedido_id, prazo
 *
 * e sabia que alguma coisa mudou, sem saber DE QUÊ PARA QUÊ. Três defeitos num
 * lugar só: `dados_antes` e `dados_depois` já chegavam na resposta e eram
 * jogados fora; `situacao_pedido_id` não é português; e, mesmo que os valores
 * aparecessem, seriam números. O próprio arquivo já tinha reconhecido esse
 * problema para a TABELA e o resolvido com um mapa de nomes, e nunca aplicou o
 * mesmo raciocínio aos CAMPOS.
 *
 * A CORREÇÃO. O servidor passou a mandar o diff PRONTO (`mudancas`, com rótulo
 * em português e os dois valores em texto), e este componente o mostra INLINE:
 * com uma ou duas mudanças, `Situação: Em produção → Concluído` cabe na própria
 * linha e resolve a pergunta sem nenhum clique.
 *
 * POR QUE O SERVIDOR TRADUZ, e não o cliente: são cerca de 60 tabelas auditadas
 * e 25 tabelas de domínio. Para traduzir `situacao_pedido_id: 3` o cliente
 * precisaria do catálogo em memória, e a tela de rastreabilidade mistura os três
 * módulos numa página só. O orçamento não guarda catálogo nenhum aqui, e o
 * `services/cache.js` nem tem API para ler o cache sem refazer a chamada.
 *
 * POR QUE MODAL, e não linha que se abre: o `createDataTable` não tem linha
 * expansível nem `onRowClick`, e acrescentar isso a um componente usado por
 * dezenas de telas não é proporcional ao ganho. Modal somente-leitura é padrão
 * estabelecido aqui (seis precedentes), e a pilha do `modal-base.js` resolve
 * Escape e Tab quando ele abre por cima de uma ficha que já é modal.
 */

// I, U e D são as letras que o banco grava. O verbo no passado diz o que a
// pessoa fez, que é o que se procura ao ler um histórico.
export const OPERACAO = {
  I: { texto: 'Adicionou', cor: 'success' },
  U: { texto: 'Alterou', cor: 'info' },
  D: { texto: 'Removeu', cor: 'error' },
};

/**
 * Por onde a mudança entrou, em português.
 *
 * Ela aparece no detalhe de cada evento, e vinha CRUA ('web', 'qgis'): quem lê o
 * histórico não decorou os valores da coluna. Mora aqui, e não na tela de
 * rastreabilidade, porque quem desenha o detalhe é este componente -- a tela
 * deixou de ter o filtro de origem em 2026-08-02, quando ele deu lugar a Sistema
 * e Subsistema.
 */
export const NOME_ORIGEM = {
  web: 'Interface web',
  qgis: 'Plugin do QGIS',
  cli: 'Linha de comando',
  gatilho: 'Efeito no banco',
  sistema: 'Sistema',
  migracao: 'Migração',
  desconhecido: 'Não registrada',
};

/**
 * Palavras de identificador de banco que perdem o acento no nome da coluna.
 *
 * A troca é por PALAVRA, e não por tabela: tabela nova reaproveita o que já
 * está aqui, e palavra que falta sai sem acento, nunca em branco. As entradas
 * saem das tabelas declaradas em server/src/auditoria/mapa/ (conferido em
 * 2026-08-04).
 */
const PALAVRA_ACENTUADA = {
  capacitacao: 'capacitação',
  configuracao: 'configuração',
  credito: 'crédito',
  edicao: 'edição',
  execucao: 'execução',
  impressao: 'impressão',
  licitacao: 'licitação',
  liquidacao: 'liquidação',
  manutencao: 'manutenção',
  midia: 'mídia',
  periodo: 'período',
  revisao: 'revisão',
  subsecao: 'subseção',
  usuario: 'usuário',
  versao: 'versão',
};

/**
 * O nome de uma tabela de origem, como a pessoa o lê.
 *
 * É DERIVAÇÃO, e não catálogo, porque catálogo não existe. O evento traz
 * `tabela` (o nome cru), `entidade` (o AGREGADO, que é o MESMO para as quatro
 * tabelas do pedido, e por isso não separa nada aqui) e `resumo` (que descreve
 * o REGISTRO, não a tabela). O mapa do servidor tem rótulo por CAMPO, nunca por
 * tabela. Ver server/src/auditoria/mapa/index.js.
 *
 * POR QUE NÃO UM MAPA DE TABELAS AQUI. São cerca de 60 tabelas auditadas nos
 * três módulos, e este componente serve mais de vinte telas. Mapa escrito à mão
 * apodrece na primeira tabela nova, e a chave que faltar devolve o nome cru
 * justamente na tela que esta regra existe para proteger.
 *
 * O SCHEMA SAI FORA. O filtro só lista as tabelas de UM agregado, e todas elas
 * são do mesmo módulo: o prefixo não distingue nada e é jargão de banco.
 *
 * O valor interno do filtro continua sendo o nome cru da tabela. O que não pode
 * é ele APARECER.
 *
 * @param {string} tabela - 'schema.tabela'
 * @returns {string} 'Impressão item'
 */
export function rotuloDaTabela(tabela) {
  const nome = String(tabela || '').split('.').pop();
  if (!nome) return '';
  const texto = nome.split('_').map((p) => PALAVRA_ACENTUADA[p] || p).join(' ');
  return texto.charAt(0).toUpperCase() + texto.slice(1);
}

// Quantas mudanças cabem na linha antes de virar "e mais N". Duas é o que cabe
// sem a célula quebrar em telas estreitas, e cobre a maioria esmagadora das
// alterações reais (trocar a situação, trocar o prazo).
const MUDANCAS_INLINE = 2;

/**
 * Quando o registro unificado de alterações passou a existir.
 *
 * Medido no banco de produção em 2026-08-04: o primeiro `auditoria.evento` é de
 * 2026-07-30. Antes dessa data não há rastro de coisa nenhuma, e o acervo é bem
 * mais velho que ela: 7.025 das 7.572 versões (92,8%) e 5.743 dos 6.309 produtos
 * (91,0%) foram cadastrados antes do corte.
 *
 * POR QUE ISSO VAI PARA A TELA. A frase "Nenhuma alteração registrada", sozinha,
 * se lê como "este registro nunca mudou", e ela aparece em mais de nove de cada
 * dez fichas do acervo. É a mesma confusão que o estado de erro do painel
 * corrige: "não houve" e "não sei" são respostas opostas, e o histórico vazio
 * estava dando a primeira quando a verdadeira é a segunda.
 */
const INICIO_DO_REGISTRO = '2026-07-30';

/**
 * Um valor do diff, pronto para a tela.
 *
 * Nulo vira a palavra "vazio", e NUNCA célula em branco: célula vazia se lê como
 * "esta coluna não se aplica", e "passou a ter observação" e "sempre foi vazio"
 * são fatos diferentes.
 */
function valor(texto) {
  if (texto === null || texto === undefined || texto === '') {
    return el('span', { className: 'historico__vazio', textContent: 'vazio' });
  }
  return el('span', { className: 'historico__valor', textContent: String(texto) });
}

/** `Situação: Em produção → Concluído`, numa linha. */
function linhaDeMudanca(m) {
  return el('div', { className: 'historico__mudanca' }, [
    el('span', { className: 'historico__rotulo', textContent: `${m.rotulo}: ` }),
    valor(m.antes_texto),
    // A seta é elemento próprio para poder ficar cinza e não ser lida como
    // parte de nenhum dos dois valores.
    el('span', { className: 'historico__seta', textContent: ' → ' }),
    valor(m.depois_texto),
  ]);
}

/**
 * A célula "O que mudou".
 *
 * Inserção e exclusão NÃO listam campo a campo: numa inserção todos os campos
 * "mudaram" e a lista teria vinte linhas sem informação. O que aparece é o
 * `resumo` da entidade, que o servidor monta.
 */
export function celulaDoQueMudou(evento, aoAbrir) {
  const mudancas = evento.mudancas || [];

  if (evento.operacao !== 'U' || !mudancas.length) {
    return el('span', { className: 'historico__resumo', textContent: evento.resumo || '-' });
  }

  const visiveis = mudancas.slice(0, MUDANCAS_INLINE).map(linhaDeMudanca);

  if (mudancas.length > MUDANCAS_INLINE) {
    const restantes = mudancas.length - MUDANCAS_INLINE;
    visiveis.push(el('button', {
      className: 'historico__mais',
      type: 'button',
      onClick: () => aoAbrir(evento),
      textContent: `e mais ${restantes} ${restantes === 1 ? 'campo' : 'campos'}`,
    }));
  }

  return el('div', { className: 'historico__mudancas' }, visiveis);
}

/** Quem fez. Posto e nome de guerra é como a pessoa é chamada aqui. */
export function autor(evento) {
  if (!evento.usuario_nome && !evento.usuario_nome_guerra) {
    // Usuário nulo é evento de migração ou do próprio sistema, não erro: os
    // eventos anteriores à rastreabilidade entraram sem dono.
    return evento.origem === 'sistema' ? 'sistema' : 'migração';
  }
  const nome = evento.usuario_nome_guerra || evento.usuario_nome;
  return evento.usuario_posto ? `${evento.usuario_posto} ${nome}` : nome;
}

/**
 * O texto que a busca da tabela varre, montado por evento.
 *
 * POR QUE ELE EXISTE (2026-08-04). A busca do data-table casa contra
 * `row[col.key]`, o valor CRU da coluna, e não contra o que o `render` desenhou.
 * Das quatro colunas daqui, uma é um array de objetos (vira "[object Object]"),
 * outra é a letra do banco ('U') e a terceira é a data em ISO. Ligar a busca sem
 * isto entregaria uma caixa que não acha "Situação", "Concluído" nem
 * "impressao_item".
 *
 * O que entra é o que se procura num histórico: o verbo, o resumo, a tabela de
 * origem (crua e como o filtro a mostra), quem fez, a data como a tela a mostra
 * e, de cada mudança, o rótulo, o nome da coluna e os dois valores.
 *
 * A tabela entra nas DUAS formas: quem digita "impressao_item" vem do banco e
 * quem digita "Impressão item" leu o filtro. Este texto não vai para a tela.
 */
export function textoDeBusca(evento) {
  const op = OPERACAO[evento.operacao];
  const partes = [
    op ? op.texto : evento.operacao,
    evento.resumo,
    evento.tabela,
    rotuloDaTabela(evento.tabela),
    autor(evento),
    formatDateTime(evento.data_evento),
  ];
  for (const m of evento.mudancas || []) {
    partes.push(m.rotulo, m.campo, m.antes_texto, m.depois_texto);
  }
  return partes.filter(Boolean).join(' ');
}

/**
 * O quadro de diferenças completo, em modal.
 *
 * Na EXCLUSÃO o estado anterior abre por padrão, porque ali ele é a informação
 * toda: é o evento que se procura na pressa.
 */
export function abrirDetalheDoEvento(evento) {
  const mudancas = evento.mudancas || [];

  const tabela = mudancas.length
    ? el('table', { className: 'historico-diff' }, [
      el('thead', {}, [
        el('tr', {}, [
          el('th', { textContent: 'Campo' }),
          el('th', { textContent: 'Antes' }),
          el('th', { textContent: 'Depois' }),
        ]),
      ]),
      el('tbody', {}, mudancas.map((m) => el('tr', {
        // Campo que o servidor não conhece aparece marcado, com o próprio nome
        // de coluna: coluna nova entra no histórico em vez de virar mudança
        // invisível, e a marca é o que faz alguém ir declará-la.
        className: m.declarado ? '' : 'historico-diff__linha--nao-declarado',
      }, [
        el('td', { className: 'historico-diff__campo' }, [
          el('span', { textContent: m.rotulo }),
          m.declarado ? null : el('span', {
            className: 'historico-diff__cru',
            textContent: ' (campo não catalogado)',
          }),
        ].filter(Boolean)),
        el('td', {}, [valor(m.antes_texto)]),
        el('td', {}, [valor(m.depois_texto)]),
      ]))),
    ])
    : el('p', {
      className: 'historico-diff__vazio',
      textContent: 'Este evento não registrou alteração de campo.',
    });

  // A linha inteira, para quem precisa. Fica recolhida: ela tem dezenas de
  // colunas iguais dos dois lados, e mostrá-las esconderia a que mudou.
  const linhaInteira = el('details', { className: 'historico-diff__bruto' }, [
    el('summary', { textContent: 'Ver a linha inteira' }),
    el('pre', {
      className: 'historico-diff__json',
      textContent: JSON.stringify(
        { antes: evento.dados_antes, depois: evento.dados_depois },
        null,
        2,
      ),
    }),
  ]);
  if (evento.operacao === 'D') linhaInteira.open = true;

  const op = OPERACAO[evento.operacao];

  openModal({
    title: `${op ? op.texto : evento.operacao} ${evento.resumo || ''}`.trim(),
    width: '760px',
    content: el('div', { className: 'historico-diff__corpo' }, [
      el('div', { className: 'historico-diff__meta' }, [
        el('span', { textContent: `${autor(evento)} · ${formatDateTime(evento.data_evento)}` }),
        // A origem e a rota respondem "por onde isto entrou", que é o que se
        // pergunta quando duas portas escrevem a mesma tabela.
        el('span', {
          className: 'historico-diff__origem',
          textContent: `Entrou por: ${NOME_ORIGEM[evento.origem] || evento.origem}`
            + `${evento.rota ? ` · ${evento.rota}` : ''}`,
        }),
      ]),
      evento.motivo
        ? el('p', { className: 'historico-diff__motivo', textContent: `Motivo: ${evento.motivo}` })
        : null,
      tabela,
      linhaInteira,
    ].filter(Boolean)),
    actions: [{ label: 'Fechar', variant: 'secondary', onClick: ({ close }) => close() }],
  });
}

/**
 * Monta a seção de histórico de um registro.
 *
 * @param {Object} opcoes
 * @param {string} opcoes.modulo - acervo, mapoteca, orcamento ou plataforma
 * @param {string} opcoes.entidade - o agregado ('pedido', 'produto', 'usuario')
 * @param {string|number} opcoes.id
 * @param {string} [opcoes.titulo]
 * @param {string} [opcoes.subtitulo]
 * @param {boolean} [opcoes.recolhido] - só busca quando a pessoa abrir. Serve à
 *   ficha do produto, que é um modal já pesado de miniaturas e arquivos: sem
 *   isto, quem só quer baixar o PDF pagaria uma consulta a mais.
 * @returns {{element: HTMLElement, recarregar: Function, cleanup: Function}}
 */
export function criarHistorico({
  modulo,
  entidade,
  id,
  titulo = 'Histórico de alterações',
  subtitulo = 'O que mudou, quando e por quem',
  recolhido = false,
}) {
  let disposed = false;
  let tabela = null;
  let carregado = false;

  const corpo = el('div', {
    className: 'data-table__empty',
    textContent: recolhido ? '' : 'Carregando o histórico...',
  });

  // O aviso de falha mora FORA do corpo, e some quando a carga volta a dar
  // certo. Ele existe porque a recarga que falha não pode apagar o histórico
  // que a pessoa já está lendo (2026-08-04).
  const aviso = el('div', { className: 'data-table__empty', hidden: true });

  function mostrarAviso(texto) {
    aviso.textContent = texto;
    aviso.hidden = false;
  }

  /**
   * OS DOIS FILTROS (2026-08-04).
   *
   * O histórico de um agregado junta as tabelas dele. No pedido 68 são 235
   * eventos em 24 páginas, e os 2 eventos da própria tabela `mapoteca.pedido`
   * caem nas posições 78 e 156, ou seja, nas páginas 8 e 16. As 12 primeiras
   * linhas dizem todas "Alterou · Data da impressão". No módulo inteiro, evento
   * do próprio pedido é 6,7% do total. "Quem mudou a situação e quando" custava
   * dezenas de cliques.
   *
   * O FILTRO NÃO MOSTRA NOME DE TABELA. A tela traduz o diff para português
   * ("Situação: Em produção → Concluído") para quem lê não precisar saber o
   * schema, e um select com "mapoteca.impressao_item" desfazia isso. O rótulo
   * sai de rotuloDaTabela(); o nome cru fica no valor da opção.
   *
   * AS OPÇÕES VÊM DOS DADOS, nunca de uma lista fixa: este componente serve os
   * três módulos e mais de vinte telas, e lista escrita à mão apodrece na
   * primeira tabela nova.
   *
   * FILTRO COM UMA OPÇÃO SÓ NÃO APARECE. Ele não recorta nada e vira ruído na
   * ficha que tem uma tabela só (a maioria fora do pedido).
   *
   * A OPERAÇÃO DEPENDE DA TABELA, como Sistema e Subsistema na tela de
   * rastreabilidade. Sem a dependência, cruzar "mapoteca.pedido" com "Removeu"
   * daria lista vazia, e o vazio da tabela diz "o registro começou em 30/07",
   * que ali seria mentira.
   */
  let linhas = [];
  let filtroTabela = '';
  let filtroOperacao = '';

  function visiveis() {
    return linhas.filter((l) => (
      (!filtroTabela || l.tabela === filtroTabela)
      && (!filtroOperacao || l.operacao === filtroOperacao)
    ));
  }

  function criarSelect(rotulo, aoEscolher) {
    const select = el('select', {
      // Classe do select compacto do rodapé da tabela, que já é global em
      // tables.css: o filtro fica do tamanho de um controle de tabela.
      className: 'pagination__select',
      'aria-label': rotulo,
      onChange: (e) => {
        aoEscolher(e.target.value);
        sincronizarFiltros();
        if (tabela) tabela.update({ rows: visiveis() });
      },
    });
    // `hidden` vai como PROPRIEDADE: o el() faz setAttribute, e hidden="false"
    // esconde do mesmo jeito. É a armadilha que o repo já registrou.
    select.hidden = true;
    return select;
  }

  const selectTabela = criarSelect('Filtrar por tabela de origem', (v) => { filtroTabela = v; });
  const selectOperacao = criarSelect('Filtrar por operação', (v) => { filtroOperacao = v; });

  // A barra fica FORA do cartão da tabela, e por isso não usa a classe da
  // toolbar dela: solta, a toolbar deixaria uma borda inferior órfã acima do
  // cartão. Aqui ela é a mesma fileira de controles das seções do painel.
  const barra = el('div', {
    className: 'dashboard-section__controls historico__filtros',
    style: { marginBottom: 'var(--space-sm)' },
  }, [selectTabela, selectOperacao]);
  barra.hidden = true;

  /**
   * Repõe as opções de um select a partir dos dados, e devolve o valor que
   * sobreviveu. Escolha que sumiu do recorte é DESCARTADA: mantê-la deixaria o
   * filtro cobrando um cruzamento impossível, e a lista viria vazia sem dizer
   * por quê.
   */
  function preencherSelect(select, opcoes, textoTodos) {
    const escolhido = select.value;
    clearChildren(select);
    select.appendChild(el('option', { value: '', textContent: textoTodos }));
    for (const o of opcoes) {
      select.appendChild(el('option', { value: o.valor, textContent: o.texto }));
    }
    select.value = opcoes.some((o) => o.valor === escolhido) ? escolhido : '';
    select.hidden = opcoes.length < 2;
    return select.value;
  }

  /**
   * As tabelas presentes, em ordem alfabética pelo RÓTULO, que é o que a pessoa
   * lê. O valor da opção continua sendo o nome cru, porque é por ele que o
   * filtro casa; o nome cru nunca vai para a tela. Ver rotuloDaTabela().
   */
  function opcoesDeTabela() {
    return [...new Set(linhas.map((l) => l.tabela).filter(Boolean))]
      .map((t) => ({ valor: t, texto: rotuloDaTabela(t) }))
      .sort((a, b) => a.texto.localeCompare(b.texto, 'pt-BR'));
  }

  /**
   * As operações presentes no recorte da tabela escolhida.
   * A ordem é a do vocabulário do banco (I, U, D). Letra que o mapa não conhece
   * entra com o próprio nome, e não some: sumir esconderia eventos da contagem.
   */
  function opcoesDeOperacao() {
    const base = filtroTabela ? linhas.filter((l) => l.tabela === filtroTabela) : linhas;
    const presentes = [...new Set(base.map((l) => l.operacao).filter(Boolean))];
    const conhecidas = Object.keys(OPERACAO).filter((op) => presentes.includes(op));
    const outras = presentes.filter((op) => !OPERACAO[op]).sort();
    return [...conhecidas, ...outras].map((op) => ({
      valor: op,
      texto: OPERACAO[op] ? OPERACAO[op].texto : op,
    }));
  }

  function sincronizarFiltros() {
    filtroTabela = preencherSelect(selectTabela, opcoesDeTabela(), 'Todas as tabelas');
    // A operação se repovoa DEPOIS da tabela, porque ela depende do recorte.
    filtroOperacao = preencherSelect(selectOperacao, opcoesDeOperacao(), 'Todas as operações');
    barra.hidden = selectTabela.hidden && selectOperacao.hidden;
  }

  async function carregar() {
    carregado = true;
    let eventos;
    try {
      eventos = await getHistorico(modulo, entidade, id);
    } catch (err) {
      if (disposed) return;
      const texto = err.message || 'Erro ao carregar o histórico';
      // O erro no histórico NÃO derruba o resto da ficha: o histórico é
      // acessório, a ficha é o trabalho. Regra herdada da tela do pedido.
      if (tabela) {
        // Já há tabela na tela: o aviso entra ao lado dela. Trocar a tabela
        // pela mensagem faria a recarga que falha apagar o que já se sabia.
        mostrarAviso(texto);
        return;
      }
      clearChildren(corpo);
      corpo.className = 'data-table__empty';
      corpo.textContent = texto;
      return;
    }
    if (disposed) return;
    aviso.hidden = true;

    // O texto de busca entra numa CÓPIA da linha, e o evento original segue
    // inteiro para o modal de diferenças.
    linhas = (eventos || []).map((e) => ({ ...e, busca: textoDeBusca(e) }));
    sincronizarFiltros();

    // A TABELA SOBREVIVE À RECARGA (2026-08-04). Seis fichas chamam
    // `recarregar()` depois de gravar. Recriar a tabela jogava fora a
    // ordenação e a página em que a pessoa estava, e mudava a altura da seção
    // debaixo do cursor. O `update` do data-table preserva as duas, e reconcilia
    // as linhas pelo `id` do evento.
    if (tabela) {
      tabela.update({ rows: visiveis() });
      return;
    }

    tabela = createDataTable({
      columns: [
        {
          key: 'data_evento',
          label: 'Quando',
          sortable: true,
          className: 'historico__col-quando',
          render: (r) => formatDateTime(r.data_evento),
        },
        {
          key: 'usuario_nome',
          label: 'Quem',
          className: 'historico__col-quem',
          render: (r) => autor(r),
        },
        {
          key: 'operacao',
          label: 'O quê',
          className: 'historico__col-oque',
          render: (r) => {
            const op = OPERACAO[r.operacao];
            return op ? chip(op.texto, op.cor) : (r.operacao || '-');
          },
        },
        {
          // A CHAVE É O TEXTO DE BUSCA, e não 'mudancas' (2026-08-04). A busca
          // do data-table lê row[col.key], e o array de mudanças vira
          // "[object Object]". A célula continua saindo do render, que lê
          // r.mudancas direto, e a coluna não ordena: a chave só governa o que a
          // busca enxerga. Ver textoDeBusca().
          key: 'busca',
          label: 'O que mudou',
          className: 'historico__col-mudou',
          render: (r) => celulaDoQueMudou(r, abrirDetalheDoEvento),
        },
      ],
      rows: visiveis(),
      pageSize: 10,
      // BUSCA LIGADA (2026-08-04). Ela varre o texto montado por textoDeBusca,
      // que traz o diff, o campo alterado e a tabela. Sem esse texto a busca não
      // acharia nada: o data-table casa contra o valor cru da coluna, e o valor
      // que interessa aqui mora dentro do diff.
      searchable: true,
      emptyMessage: `Nenhuma alteração registrada. O registro de alterações `
        + `começou em ${formatDate(INICIO_DO_REGISTRO)}. O que mudou antes `
        + `dessa data não aparece aqui.`,
      actions: [{
        icon: ICONS.visibility,
        title: 'Ver as diferenças',
        onClick: (r) => abrirDetalheDoEvento(r),
      }],
    });

    clearChildren(corpo);
    corpo.className = '';
    corpo.appendChild(barra);
    corpo.appendChild(tabela.element);
    corpo.appendChild(aviso);
  }

  const cabecalho = el('div', { className: 'dashboard-section__header' }, [
    el('h2', { className: 'dashboard-section__title', textContent: titulo }),
    el('div', { className: 'dashboard-section__controls' }, [
      el('span', { className: 'detail-card__label', textContent: subtitulo }),
    ]),
  ]);

  let element;

  if (recolhido) {
    const detalhes = el('details', { className: 'historico historico--recolhido' }, [
      el('summary', { className: 'historico__summary' }, [
        svgIcon(ICONS.assignment, 16),
        el('span', { textContent: titulo }),
      ]),
      corpo,
    ]);
    // Busca só quando a pessoa abrir, e uma vez só.
    detalhes.addEventListener('toggle', () => {
      if (detalhes.open && !carregado) carregar();
    });
    element = detalhes;
  } else {
    element = el('div', { className: 'dashboard-section historico' }, [cabecalho, corpo]);
    carregar();
  }

  return {
    element,
    recarregar: () => carregar(),
    cleanup: () => {
      disposed = true;
      if (tabela) tabela._cleanup();
    },
  };
}
