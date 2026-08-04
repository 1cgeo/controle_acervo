import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { chip, chipSituacaoPedido } from '@components/status-chip.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import {
  getPedidosEmAberto,
  getImpressaoDoPedido,
  baixarCartaDoPedido,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { openEtiquetaEnvioDialog } from '@modules/mapoteca/pages/pedidos/etiqueta-envio.js';
// O dialogo de registrar impressao mora em pedidos/ e serve as DUAS telas. Ele
// era daqui ate 2026-07-30, quando o detalhe do pedido passou a registrar
// impressao tambem: duas copias divergiriam no texto que evita o erro de somar.
import { openRegistrarImpressaoDialog } from '@modules/mapoteca/pages/pedidos/dialog-impressao.js';
import { openModal } from '@components/modal/modal-base.js';

/**
 * Repinta um chip JA na tela, sem trocar o nó.
 *
 * Recebe o chip NOVO em vez do par (texto, variante) para não repetir aqui o
 * formato da classe `chip--<variante>`: quem sabe montar um chip continua sendo
 * o `status-chip.js`, e este arquivo só copia o resultado para o nó que fica.
 */
function repintarChip(no, novo) {
  no.textContent = novo.textContent;
  no.className = novo.className;
}

/**
 * Atender pedidos (#/mapoteca/atendimento): a FILA de trabalho da mapoteca.
 *
 * É tela separada da lista de Pedidos de propósito, e as diferenças não são de
 * enfeite:
 *
 *  - só pedido EM ABERTO (nem concluído, nem cancelado), porque fila é o que
 *    falta fazer;
 *  - SEM o ano da navbar: o pedido de dezembro ainda não atendido é trabalho em
 *    janeiro, e fila que esconde o atrasado não serve de fila;
 *  - ordenada por PRAZO quando ele existe, e por IDADE (o mais antigo primeiro)
 *    para o pedido sem prazo, que é a maioria da fila;
 *  - perfil OPERADOR, então não aparece no menu de quem só consulta (o guarda sai
 *    do próprio manifesto, ver modules/registry.js).
 *
 * As três ações que a tela junta são as três que a pessoa faz com o pedido na
 * mão: baixar a carta para imprimir, registrar o que imprimiu e tirar a etiqueta
 * de envio. Antes elas moravam em lugares diferentes (a etiqueta no detalhe do
 * pedido, o registro de impressão só no plugin do QGIS, a carta em nenhum).
 *
 * AS TABELAS SE MONTAM UMA VEZ (2026-08-04). Aqui alguém trabalha o turno
 * inteiro, item após item, e era a tela que mais sofria com o remonte: cada
 * registro de impressão chamava `carregar()` e `pintar()`, e as duas jogavam
 * fora o objeto da tabela e montavam outro. Quem tinha buscado um cliente na
 * fila perdia a busca a cada item lançado, e voltava a procurar do zero. Agora
 * as duas tabelas vivem enquanto a tela vive e recebem `update({ rows })`: a
 * busca, a ordem, a página e o foco do teclado atravessam a gravação.
 *
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderAtendimento(container) {
  let disposed = false;
  let pedidos = [];
  // Falso até a primeira carga dar certo. Separa a carga INICIAL (que ainda não
  // tem o que preservar) da RECARGA (que não pode mexer no layout).
  let montado = false;
  const cleanups = [];

  const contador = el('span', { className: 'page__meta' });
  const corpo = el('div');

  const root = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('div', {}, [
        // O titulo NAO repete o rotulo do menu ("Atender pedidos"): quem chegou
        // aqui ja leu aquele rotulo, e a linha so devolvia a mesma palavra.
        el('h1', { className: 'page__title', textContent: 'Fila de atendimento' }),
        contador,
      ]),
      el('div', { className: 'page__actions' }, [
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => carregar(),
        }, [svgIcon(ICONS.dataUsage, 16), 'Atualizar']),
      ]),
    ]),
    corpo,
  ]);
  container.appendChild(root);

  // ---------------------------------------------------------------------------
  // Prazo: a coluna que ordena a fila
  // ---------------------------------------------------------------------------
  /**
   * O prazo dito em dias, e não só a data.
   *
   * `dias_para_prazo` vem calculado no BANCO (prazo - CURRENT_DATE), então a tela
   * não faz conta de data e não erra por fuso. Sem prazo não vira "0 dias": vira
   * "sem prazo", que é informação diferente.
   */
  function chipPrazo(p) {
    if (p.prazo == null) return chip('sem prazo', 'default');
    const dias = Number(p.dias_para_prazo);
    if (!Number.isFinite(dias)) return chip(formatDate(p.prazo), 'default');
    if (dias < 0) return chip(`atrasado ${Math.abs(dias)} dia(s)`, 'error');
    if (dias === 0) return chip('vence hoje', 'warning');
    if (dias <= 7) return chip(`${dias} dia(s)`, 'warning');
    return chip(`${dias} dia(s)`, 'info');
  }

  function textoProgresso(p) {
    const itens = Number(p.total_itens) || 0;
    if (itens === 0) return 'sem itens';
    return `${formatNumber(p.itens_impressos)}/${formatNumber(itens)} itens`
      + ` · ${formatNumber(p.quantidade_impressa)}/${formatNumber(p.quantidade_pedida)} cópias`;
  }

  // Downloads em andamento, por uuid do arquivo. O botão de ação da tabela não
  // chega até aqui (o onClick da data-table recebe só a linha), então o guarda
  // contra o clique repetido é este conjunto, e não o `disabled` do botão.
  const baixando = new Set();

  async function baixarCarta(pedidoId, item) {
    if (!item.uuid_arquivo) {
      showError('Este item não tem PDF no acervo para baixar');
      return;
    }
    if (baixando.has(item.uuid_arquivo)) return;
    baixando.add(item.uuid_arquivo);
    try {
      await baixarCartaDoPedido(pedidoId, item.uuid_arquivo, item.arquivo_nome_fisico);
    } catch (err) {
      showError(err.message || 'Não foi possível baixar a carta');
    } finally {
      baixando.delete(item.uuid_arquivo);
    }
  }

  // ---------------------------------------------------------------------------
  // Painel de atendimento de UM pedido
  // ---------------------------------------------------------------------------
  async function abrirAtendimento(pedido) {
    let dados;
    try {
      dados = await getImpressaoDoPedido(pedido.id);
    } catch (err) {
      showError(err.message || 'Erro ao carregar os itens do pedido');
      return;
    }
    if (disposed) return;

    // Os três nós do resumo vivem entre as pinturas. Registrar um item repinta
    // o TEXTO deles, e não troca a barra inteira: era ela que saltava a cada
    // item lançado.
    const chipSituacao = chip('', 'warning');
    const contagem = el('span', { className: 'detail-card__label' });
    const chipSemArquivo = chip('', 'error');

    const tabela = createDataTable({
      columns: [
        {
          key: 'produto_nome',
          label: 'Carta',
          render: (r) => el('div', {}, [
            el('div', { textContent: r.produto_nome || r.mi || '-' }),
            el('span', { className: 'detail-card__label', textContent: [r.mi, r.escala, r.versao ? `versão ${r.versao}` : null].filter(Boolean).join(' · ') }),
          ]),
        },
        { key: 'tipo_midia_nome', label: 'Mídia', render: (r) => r.tipo_midia_nome || '-' },
        {
          key: 'quantidade',
          label: 'Impressão',
          render: (r) => el('span', { className: 'flex gap-sm' }, [
            el('span', { textContent: `${formatNumber(r.quantidade_impressa)}/${formatNumber(r.quantidade)}` }),
            r.impressao_concluida
              ? chip('completa', 'success')
              : chip(`faltam ${formatNumber(r.quantidade_restante)}`, 'warning'),
          ]),
        },
        {
          key: 'uuid_arquivo',
          label: 'Carta digital',
          render: (r) => r.uuid_arquivo
            ? el('span', { className: 'detail-card__label', textContent: `${r.arquivo_nome_fisico} · ${formatNumber(Number(r.tamanho_mb).toFixed(1))} MB` })
            // Não esconde a linha: quem atende precisa saber que essa carta não
            // tem PDF para imprimir, e não descobrir isso na hora de plotar.
            : chip('sem PDF no acervo', 'error'),
        },
      ],
      rows: [],
      pageSize: 10,
      emptyMessage: 'Este pedido não tem itens cadastrados',
      // O item do pedido NÃO tem `id` nem `uuid`, e sem esta chave o data-table
      // cairia na referência do objeto. Cada carga traz objetos novos, e nenhuma
      // linha se reaproveitaria: a tabela sobreviveria, e o corpo dela não.
      rowKey: (r) => r.produto_pedido_id,
      actions: [
        {
          icon: ICONS.download,
          title: 'Baixar a carta para imprimir',
          onClick: (r) => baixarCarta(pedido.id, r),
        },
        {
          icon: ICONS.print,
          title: 'Registrar impressão',
          onClick: (r) => openRegistrarImpressaoDialog(r, async () => {
            const novo = await getImpressaoDoPedido(pedido.id);
            if (disposed) return;
            pintar(novo);
            carregar();
          }),
        },
      ],
    });

    // A observação do pedido entra AQUI, e não numa coluna da fila: ela é texto
    // livre, e a fila já usa cinco colunas. Medido na produção em 2026-08-04:
    // dos 25 pedidos em aberto, 14 têm observação e 22 têm observação interna.
    // Sem isto o operador abria o detalhe do pedido só para ler a instrução, e a
    // volta remontava a tela que este arquivo se esforça para preservar.
    //
    // A observação INTERNA aparece porque esta tela é de dentro (perfil
    // operador). Ela nunca sai na consulta pública do cliente.
    const notas = [
      ['Observação', pedido.observacao],
      ['Observação interna', pedido.observacao_interna],
    ]
      .filter(([, texto]) => texto)
      .map(([rotulo, texto]) => el('div', { style: { marginBottom: 'var(--space-xs)' } }, [
        el('span', { className: 'detail-card__label', textContent: `${rotulo}: ` }),
        el('span', { textContent: texto }),
      ]));

    const conteudo = el('div', {}, [
      notas.length
        ? el('div', { style: { marginBottom: 'var(--space-sm)' } }, notas)
        : null,
      el('div', { className: 'flex gap-sm', style: { marginBottom: 'var(--space-sm)' } }, [
        chipSituacao,
        contagem,
        chipSemArquivo,
      ]),
      tabela.element,
    ]);

    /** Escreve o payload nos nós que já estão no painel. Não monta bloco nenhum. */
    function pintar(payload) {
      const imp = payload.impressao || {};

      repintarChip(chipSituacao, imp.concluida
        ? chip('impressão concluída', 'success')
        : chip('impressão pendente', 'warning'));

      contagem.textContent = `${formatNumber(imp.itens_concluidos ?? 0)}`
        + `/${formatNumber(imp.total_itens ?? 0)} itens impressos`;

      // Sem item faltando PDF o chip não some do DOM, ele se esconde: tirá-lo e
      // repô-lo mexeria na largura da barra a cada lançamento.
      repintarChip(chipSemArquivo, chip(`${imp.itens_sem_arquivo} sem PDF`, 'error'));
      chipSemArquivo.hidden = !imp.itens_sem_arquivo;

      tabela.update({ rows: payload.itens || [] });
    }

    pintar(dados);

    openModal({
      title: `Atender pedido ${pedido.localizador_pedido || `#${pedido.id}`} — ${pedido.cliente_nome || ''}`,
      content: conteudo,
      width: '900px',
      actions: [
        {
          label: 'Etiqueta de envio',
          variant: 'secondary',
          onClick: () => openEtiquetaEnvioDialog(pedido),
        },
        {
          label: 'Abrir o pedido',
          variant: 'text',
          onClick: ({ close }) => {
            close();
            location.hash = `/mapoteca/pedidos/${pedido.id}`;
          },
        },
        { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
      ],
      onClose: () => tabela._cleanup(),
    });
  }

  // ---------------------------------------------------------------------------
  // A fila
  // ---------------------------------------------------------------------------
  const tabelaFila = createDataTable({
    columns: [
      {
        key: 'prazo',
        label: 'Prazo',
        sortable: true,
        render: (p) => el('div', {}, [
          chipPrazo(p),
          p.prazo ? el('div', { className: 'detail-card__label', textContent: formatDate(p.prazo) }) : null,
        ].filter(Boolean)),
      },
      {
        key: 'cliente_nome',
        label: 'Cliente',
        sortable: true,
        render: (p) => el('div', {}, [
          el('div', { textContent: p.cliente_nome || '-' }),
          el('span', { className: 'detail-card__label', textContent: p.documento_solicitacao || '-' }),
        ]),
      },
      {
        key: 'situacao_pedido_id',
        label: 'Situação',
        render: (p) => chipSituacaoPedido(p.situacao_pedido_id, p.situacao_pedido_nome),
      },
      {
        key: 'total_itens',
        label: 'Impressão',
        render: (p) => el('span', { className: 'detail-card__label', textContent: textoProgresso(p) }),
      },
      {
        key: 'localizador_pedido',
        label: 'Localizador',
        render: (p) => chip(p.localizador_pedido || '-', 'secondary'),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 15,
    emptyMessage: 'A fila está limpa.',
    actions: [
      {
        icon: ICONS.print,
        title: 'Atender (imprimir e registrar)',
        onClick: (p) => abrirAtendimento(p),
      },
      {
        icon: ICONS.localShipping,
        title: 'Etiqueta de envio',
        onClick: (p) => openEtiquetaEnvioDialog(p),
      },
      {
        icon: ICONS.description,
        title: 'Abrir o pedido',
        onClick: (p) => { location.hash = `/mapoteca/pedidos/${p.id}`; },
      },
    ],
  });
  cleanups.push(() => tabelaFila._cleanup());

  // O "Carregando" da primeira carga e o erro de carga moram aqui, fora da
  // tabela: assim o erro esconde a fila e a devolve depois, em vez de apagá-la.
  const aviso = el('div', { className: 'data-table__empty' });
  aviso.hidden = true;
  tabelaFila.element.hidden = true;
  corpo.appendChild(aviso);
  corpo.appendChild(tabelaFila.element);

  async function carregar() {
    if (!montado) {
      aviso.hidden = false;
      aviso.textContent = 'Carregando a fila...';
      tabelaFila.element.hidden = true;
    } else {
      // Recarga de uma fila JÁ na tela: as linhas ficam onde estão, e o
      // data-table só marca que está buscando. É o que faz o registro de
      // impressão não jogar fora a busca digitada.
      tabelaFila.update({ loading: true });
    }

    try {
      pedidos = await getPedidosEmAberto();
      if (disposed) return;
      const atrasados = pedidos.filter(p => Number(p.dias_para_prazo) < 0).length;
      contador.textContent = atrasados
        ? `${pedidos.length} pedido(s) em aberto, ${atrasados} com prazo vencido`
        : `${pedidos.length} pedido(s) em aberto`;
      montado = true;
      aviso.hidden = true;
      clearChildren(aviso);
      tabelaFila.element.hidden = false;
      tabelaFila.update({ rows: pedidos, loading: false });
    } catch (err) {
      if (disposed) return;
      pedidos = [];
      contador.textContent = '';
      tabelaFila.update({ rows: [], loading: false });
      // A fila SAI de vista no erro. Deixá-la ao lado da mensagem diria "a fila
      // está limpa", e fila limpa e erro de carga são fatos diferentes.
      tabelaFila.element.hidden = true;
      aviso.hidden = false;
      aviso.textContent = err.message || 'Erro ao carregar a fila';
      showError(err.message || 'Erro ao carregar a fila de atendimento');
    }
  }

  await carregar();

  return () => {
    disposed = true;
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch { /* ignore */ }
    }
  };
}
