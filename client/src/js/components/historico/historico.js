import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { openModal } from '@components/modal/modal-base.js';
import { chip } from '@components/status-chip.js';
import { formatDateTime } from '@utils/format.js';
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

// Quantas mudanças cabem na linha antes de virar "e mais N". Duas é o que cabe
// sem a célula quebrar em telas estreitas, e cobre a maioria esmagadora das
// alterações reais (trocar a situação, trocar o prazo).
const MUDANCAS_INLINE = 2;

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
          textContent: `origem: ${evento.origem}${evento.rota ? ` · ${evento.rota}` : ''}`,
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

  async function carregar() {
    carregado = true;
    let eventos;
    try {
      eventos = await getHistorico(modulo, entidade, id);
    } catch (err) {
      if (disposed) return;
      clearChildren(corpo);
      corpo.className = 'data-table__empty';
      // O erro no histórico NÃO derruba o resto da ficha: o histórico é
      // acessório, a ficha é o trabalho. Regra herdada da tela do pedido.
      corpo.textContent = err.message || 'Erro ao carregar o histórico';
      return;
    }
    if (disposed) return;
    if (tabela) tabela._cleanup();

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
          key: 'mudancas',
          label: 'O que mudou',
          className: 'historico__col-mudou',
          render: (r) => celulaDoQueMudou(r, abrirDetalheDoEvento),
        },
      ],
      rows: eventos || [],
      pageSize: 10,
      // Sem `searchable`: a busca do data-table filtra as linhas que ele tem, e
      // o que interessa buscar aqui (o valor dentro do diff) não está em nenhuma
      // coluna crua.
      searchable: false,
      emptyMessage: 'Nenhuma alteração registrada',
      actions: [{
        icon: ICONS.visibility,
        title: 'Ver as diferenças',
        onClick: (r) => abrirDetalheDoEvento(r),
      }],
    });

    clearChildren(corpo);
    corpo.className = '';
    corpo.appendChild(tabela.element);
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
