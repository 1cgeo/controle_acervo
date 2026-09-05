import { el, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { chip, chipSituacaoPedido } from '@components/status-chip.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import {
  getPedidosEmAberto,
  getImpressaoDoPedido,
  baixarCartaDoPedido,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { estaNaFilaDeImpressao, estaEmFechamento } from '@modules/mapoteca/situacao-pedido.js';
import { ehDeAlgumPerfil } from '@store/auth-store.js';
import { PERFIS_DA_LISTA_DE_PEDIDOS } from '@modules/mapoteca/index.js';
import { criarAvisoDeErro } from '@modules/mapoteca/pages/aviso-carga.js';
import { openEtiquetaEnvioDialog } from '@modules/mapoteca/pages/pedidos/etiqueta-envio.js';
// O dialogo de registrar impressao mora em pedidos/ e serve as DUAS telas. Ele
// serve tambem o detalhe do pedido: duas copias divergiriam no texto que evita
// o erro de somar.
import { openRegistrarImpressaoDialog } from '@modules/mapoteca/pages/pedidos/dialog-impressao.js';
import { openModal } from '@components/modal/modal-base.js';

// ESTA TELA É DO OPERADOR ('/atendimento' declara perfis ['operador','gerente']),
// e os caminhos daqui para a lista e para o detalhe do pedido (o botão "Abrir o
// pedido" das duas tabelas e do painel, mais os dois links da seção de baixo)
// levavam-no a '#/unauthorized' toda vez. Quem entra naquelas duas telas está em
// PERFIS_DA_LISTA_DE_PEDIDOS, no manifesto do módulo, porque o dashboard tem os
// mesmos caminhos e a decisão é uma só.

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
 * O registro de impressão aceita VÁRIOS itens de uma vez, com a mesma seleção
 * que o detalhe do pedido já tinha: um a um, o pedido grande custa uma abertura
 * de diálogo por folha.
 *
 * AS TABELAS SE MONTAM UMA VEZ. Aqui alguém trabalha o turno
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
  // Ver PERFIS_DA_LISTA_DE_PEDIDOS: o operador não abre '/pedidos' nem
  // '/pedidos/:id', e para ele os caminhos até lá não aparecem.
  const podeAbrirPedidos = ehDeAlgumPerfil(PERFIS_DA_LISTA_DE_PEDIDOS, 'mapoteca');

  /** A ação "Abrir o pedido" das tabelas, só para quem consegue abri-lo. */
  const acaoAbrirPedido = podeAbrirPedidos
    ? [{
      icon: ICONS.description,
      title: 'Abrir o pedido',
      onClick: (p) => { location.hash = `/mapoteca/pedidos/${p.id}`; },
    }]
    : [];

  const contador = el('span', { className: 'page__meta' });
  const corpo = el('div');
  const fechamento = el('div');

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
          onClick: () => recarregar(),
        }, [svgIcon(ICONS.dataUsage, 16), 'Atualizar']),
      ]),
    ]),
    corpo,
    fechamento,
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

    // -------------------------------------------------------------------------
    // Impressao em LOTE
    // -------------------------------------------------------------------------
    //
    // O MESMO recorte que o detalhe do pedido ganhou em 2026-08-13, e que esta
    // tela nao tinha. A medida que o justificou la (43 dos 132 pedidos com item
    // passam de 20 itens, mediana 10, maior 132) vale COM MAIS FORCA aqui: e
    // nesta tela que a pessoa passa o turno, item apos item.
    //
    // Nada de novo abaixo desta tela: `openRegistrarImpressaoDialog` ja aceita
    // uma LISTA (ela serve as duas telas), e `POST /mapoteca/impressao` sempre
    // recebeu `registros: [...]` numa transacao. O que faltava era a selecao.
    //
    // SEM GATE DE PERFIL, ao contrario do detalhe do pedido: a rota
    // '/atendimento' e de EXECUCAO (operador e gerente, ver modules/mapoteca/
    // index.js), entao quem so consulta nao chega aqui.
    /**
     * Relê o pedido depois de um registro de impressão, e repinta o painel.
     *
     * O `catch` NÃO é decoração: `openRegistrarImpressaoDialog` chama o `onDone`
     * sem `await` e sem `catch`, então uma falha aqui morria como rejeição não
     * tratada. A gravação já tinha dado certo, o diálogo já tinha fechado, e o
     * painel ficava com os números velhos sem uma palavra na tela.
     * @param {boolean} limparSelecao - verdadeiro depois de um registro em lote
     */
    async function reler(limparSelecao) {
      let novo;
      try {
        novo = await getImpressaoDoPedido(pedido.id);
      } catch (err) {
        if (disposed) return;
        showError(err.message || 'A impressão foi registrada, mas não foi possível'
          + ' atualizar a tela. Recarregue a fila.');
        return;
      }
      if (disposed) return;
      if (limparSelecao) tabela.clearSelection();
      pintar(novo);
      recarregar();
    }

    function registrarSelecionados() {
      const selecionados = tabela.getSelected();
      if (!selecionados.length) return;
      openRegistrarImpressaoDialog(selecionados, () => reler(true));
    }

    const registrarLoteBtn = el('button', {
      className: 'btn btn--primary btn--sm hidden',
      type: 'button',
      onClick: registrarSelecionados,
    }, [svgIcon(ICONS.print, 14), 'Registrar impressão']);

    // "Selecionar todos os N" existe porque a caixa do cabecalho marca a
    // PAGINA, e com pageSize 10 um pedido de 132 itens exigiria 14 viradas de
    // pagina -- justamente o pedido que mais precisa do lote.
    const selecionarTodosBtn = el('button', {
      className: 'btn btn--text btn--sm hidden',
      type: 'button',
      onClick: () => tabela.selectAll(),
    }, ['Selecionar todos']);

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
      // A SELECAO VIVE NA CHAVE ACIMA, e nao na linha visivel: o data-table
      // guarda `produto_pedido_id` num Set, entao ela atravessa a paginacao e a
      // repintura que o registro de impressao dispara.
      selectable: true,
      onSelectionChange: (selecionados) => {
        registrarLoteBtn.classList.toggle('hidden', selecionados.length === 0);
        registrarLoteBtn.textContent = '';
        registrarLoteBtn.appendChild(svgIcon(ICONS.print, 14));
        registrarLoteBtn.appendChild(
          document.createTextNode(`Registrar impressão (${selecionados.length})`)
        );
      },
      actions: [
        {
          icon: ICONS.download,
          title: 'Baixar a carta para imprimir',
          onClick: (r) => baixarCarta(pedido.id, r),
        },
        {
          icon: ICONS.print,
          title: 'Registrar impressão',
          onClick: (r) => openRegistrarImpressaoDialog(r, () => reler(false)),
        },
      ],
    });

    // A observação do pedido entra AQUI, e não numa coluna da fila: ela é texto
    // livre, e a fila já usa cinco colunas. A maioria dos pedidos em aberto tem
    // observação, e sem isto o operador abre o detalhe só para ler a instrução:
    // a volta remonta a tela que este arquivo se esforça para preservar.
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
        // Os dois de LOTE nascem escondidos, encostados na direita da mesma
        // barra do resumo: o "selecionar todos" aparece quando ha mais itens do
        // que cabe numa pagina, e o "registrar" quando ha selecao. Barra propria
        // para eles empurraria a tabela para baixo nos pedidos de um item.
        el('div', { className: 'flex gap-sm', style: { marginLeft: 'auto' } }, [
          selecionarTodosBtn,
          registrarLoteBtn,
        ]),
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

      const itens = payload.itens || [];
      tabela.update({ rows: itens });

      // "Selecionar todos os N" so paga o espaco quando ha mais itens do que
      // cabe numa pagina: com 10 ou menos, a caixa do cabecalho ja marca a
      // tabela inteira e um segundo botao seria ruido. O numero vai no rotulo
      // porque "todos" sem quantidade nao diz o tamanho do que se vai registrar.
      selecionarTodosBtn.classList.toggle('hidden', itens.length <= 10);
      selecionarTodosBtn.textContent = `Selecionar todos (${itens.length})`;
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
        ...(podeAbrirPedidos ? [{
          label: 'Abrir o pedido',
          variant: 'text',
          onClick: ({ close }) => {
            close();
            location.hash = `/mapoteca/pedidos/${pedido.id}`;
          },
        }] : []),
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
      ...acaoAbrirPedido,
    ],
  });
  cleanups.push(() => tabelaFila._cleanup());

  // O "Carregando" da primeira carga e o erro de carga moram fora da tabela:
  // assim o erro TIRA a fila da tela e a devolve depois, em vez de apagá-la.
  //
  // A fila sai do DOM, e não se esconde por CSS: escondida, "A fila está limpa"
  // continuaria no texto da página, embaixo de um erro.
  const avisoFila = criarAvisoDeErro(tabelaFila, carregar);
  avisoFila.carregando('Carregando a fila...');
  corpo.appendChild(avisoFila.element);

  // ---------------------------------------------------------------------------
  // Impressos: aguardando envio ou conclusão
  // ---------------------------------------------------------------------------
  /**
   * O BECO SEM SAÍDA QUE ESTA SEÇÃO FECHA.
   *
   * A fila mostra só Pedido Recebido e Em andamento (o
   * `SITUACOES_FILA_IMPRESSAO` de server/src/mapoteca/query_fragments.js;
   * a situação Pré cadastramento saiu do domínio em 2026-08-08). Marcar o
   * pedido como Remetido é a última ação de quem atende, e é ela que APAGA o
   * pedido desta tela. Dali em diante ele depende de alguém abrir a lista de
   * pedidos, achar o filtro "Remetido" e marcar Concluído. Nada nesta tela
   * lembrava disso, e o pedido remetido ficava aberto por tempo indefinido.
   *
   * DESDE 2026-08-24 A SEÇÃO COBRE DOIS ESTÁGIOS, e não um. O Aguardando envio
   * (8) entrou no domínio e cai aqui pelo mesmo motivo: ele saiu da fila de
   * impressão (o material está pronto) e ainda não fechou. A coluna Situação é
   * o que separa "falta despachar" de "falta concluir", e as duas ações são de
   * pessoas diferentes em dias diferentes.
   *
   * A seção não repete a fila: ela é o que a fila deixou para trás. Fica ABAIXO
   * dela, de propósito, porque o trabalho de imprimir vem primeiro.
   *
   * DE ONDE VEM O DADO. Da MESMA rota da fila, com `?incluir_remetidos=true`:
   * o servidor tem duas listas de situação em aberto, e essa query escolhe a de
   * atendimento, que inclui o Remetido. A tela filtra o que a fila acima já
   * mostra e fica só com o que sobrou.
   *
   * Antes isto varria GET /mapoteca/pedido?ano= no ano corrente e no anterior,
   * porque não havia rota que devolvesse remetido. A janela de dois anos era
   * arbitrária e escondia o pedido mais antigo; agora não há janela nenhuma.
   */
  const tabelaFechamento = createDataTable({
    columns: [
      {
        key: 'data_pedido',
        label: 'Data do pedido',
        sortable: true,
        render: (p) => formatDate(p.data_pedido),
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
      // `total_itens`, e NAO `quantidade_produtos`: quem alimenta as duas
      // tabelas desta tela e GET /pedido/em_aberto, e essa rota conta os itens
      // na coluna `total_itens` (a fila de cima ja a le, em `textoProgresso`).
      // `quantidade_produtos` e da lista de pedidos e do painel de pendentes, e
      // nao chega aqui: a coluna vinha em branco em toda linha, em silencio.
      {
        key: 'total_itens',
        label: 'Produtos',
        sortable: true,
        render: (p) => formatNumber(p.total_itens),
      },
      // A COLUNA QUE SEPARA OS DOIS ESTÁGIOS. Sem ela, "Aguardando envio" e
      // "Remetido" seriam a mesma linha cinza, e a próxima ação de cada um é
      // oposta: um espera despacho, o outro espera a marca de Concluído.
      {
        key: 'situacao_pedido_id',
        label: 'Situação',
        render: (p) => chipSituacaoPedido(p.situacao_pedido_id, p.situacao_pedido_nome),
      },
      {
        key: 'localizador_pedido',
        label: 'Localizador',
        render: (p) => chip(p.localizador_pedido || '-', 'secondary'),
      },
    ],
    rows: [],
    pageSize: 5,
    defaultSort: { key: 'data_pedido', dir: 'asc' },
    // Fila limpa aqui é o estado bom, e o texto diz isso: sem ele a seção
    // pareceria quebrada nos dias em que não há nada a fechar.
    emptyMessage: 'Nenhum pedido esperando envio ou conclusão.',
    actions: [
      // A ETIQUETA FICA AQUI TAMBÉM, e não só na fila de cima. Quem despacha um
      // pedido em Aguardando envio precisa dela, e ele já saiu da fila de
      // impressão. Ela não escreve nada, então não pede perfil de operador.
      {
        icon: ICONS.localShipping,
        title: 'Etiqueta de envio',
        onClick: (p) => openEtiquetaEnvioDialog(p),
      },
      ...acaoAbrirPedido,
    ],
  });
  cleanups.push(() => tabelaFechamento._cleanup());

  const contadorFechamento = el('span', { className: 'dashboard-section__meta', textContent: '' });
  // "Tentar de novo" refaz a leitura ÚNICA, que alimenta as duas tabelas. Um
  // recarregador só para esta seção repetiria a mesma requisição.
  const avisoFechamento = criarAvisoDeErro(tabelaFechamento, () => recarregar());

  fechamento.appendChild(el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', {
        className: 'dashboard-section__title',
        textContent: 'Impressos: aguardando envio ou conclusão',
      }),
      el('div', { className: 'dashboard-section__controls' }, [
        contadorFechamento,
        // DOIS LINKS, e não um: a lista de pedidos filtra por UMA situação, e
        // esta seção mostra duas. Um link só mandaria metade da seção para uma
        // tela que não a contém.
        //
        // Os dois somem para quem não abre '/pedidos' (o operador): ver
        // PERFIS_DA_LISTA_DE_PEDIDOS, no manifesto do módulo.
        ...(podeAbrirPedidos ? [
          el('a', {
            className: 'btn btn--text btn--sm',
            href: '#/mapoteca/pedidos?filtro=aguardando_envio',
            textContent: 'Ver os que aguardam envio',
          }),
          el('a', {
            className: 'btn btn--text btn--sm',
            href: '#/mapoteca/pedidos?filtro=remetido',
            textContent: 'Ver os remetidos',
          }),
        ] : []),
      ]),
    ]),
    el('p', {
      className: 'dashboard__escopo',
      // A frase muda com quem lê. Marcar Remetido e Concluído é
      // PUT /pedido/:id/situacao, que o servidor cobra de GERENTE, e a tela onde
      // isso se faz é a lista de pedidos. Mandar o operador marcar o que ele não
      // pode marcar, numa tela que ele não pode abrir, é instrução que só
      // produz tentativa frustrada.
      textContent: podeAbrirPedidos
        ? 'O pedido impresso sai da fila acima. Marque Remetido ao despachar,'
          + ' e Concluído para fechá-lo.'
        : 'O pedido impresso sai da fila acima. Marcar Remetido e Concluído é do'
          + ' gerente, na lista de pedidos.',
    }),
    avisoFechamento.element,
  ]));

  /**
   * UMA ida ao servidor alimenta as DUAS tabelas.
   *
   * `?incluir_remetidos=true` devolve a fila de atendimento inteira, e a de
   * impressão é um subconjunto dela. Buscar duas vezes traria o mesmo pedido
   * duas vezes pela rede, e abriria a janela em que a fila e os remetidos
   * discordam entre si por vir de leituras diferentes.
   *
   * Registrar impressão e marcar como Remetido mexem nas duas listas: o que sai
   * da fila entra aqui embaixo, e por isso as duas se repintam juntas.
   */
  async function recarregar() {
    await carregar();
  }

  async function carregar() {
    if (!montado) {
      avisoFila.carregando('Carregando a fila...');
    } else {
      // Recarga de uma fila JÁ na tela: as linhas ficam onde estão, e o
      // data-table só marca que está buscando. É o que faz o registro de
      // impressão não jogar fora a busca digitada.
      tabelaFila.update({ loading: true });
    }

    tabelaFechamento.update({ loading: true });

    try {
      const todos = await getPedidosEmAberto(true);
      if (disposed) return;

      // O que já saiu da impressão vai para a seção de baixo. O corte é por
      // SITUAÇÃO, e não por posição na resposta.
      //
      // O TESTE É POSITIVO (`estaNaFilaDeImpressao`), e não `!estaRemetido`.
      // Enquanto Remetido era a única situação da fila de atendimento fora da
      // impressão, os dois davam o mesmo resultado. Com o Aguardando envio (8),
      // o negativo mandaria para a mesa de quem IMPRIME um pedido já impresso.
      pedidos = todos.filter(estaNaFilaDeImpressao);
      // As DUAS listas sao positivas, e nao uma a negacao da outra: um
      // Concluido que aparecesse na resposta nao e trabalho pendente de
      // ninguem, e com a negacao ele entraria aqui como se fosse.
      const linhasFechamento = todos.filter(estaEmFechamento);

      tabelaFechamento.update({ rows: linhasFechamento, loading: false });
      contadorFechamento.textContent = linhasFechamento.length
        ? `${formatNumber(linhasFechamento.length)} pedido(s) a fechar`
        : '';
      avisoFechamento.ok();

      const atrasados = pedidos.filter(p => Number(p.dias_para_prazo) < 0).length;
      contador.textContent = atrasados
        ? `${pedidos.length} pedido(s) em aberto, ${atrasados} com prazo vencido`
        : `${pedidos.length} pedido(s) em aberto`;
      montado = true;
      tabelaFila.update({ rows: pedidos, loading: false });
      avisoFila.ok();
    } catch (err) {
      if (disposed) return;
      pedidos = [];
      contador.textContent = '';
      tabelaFila.update({ rows: [], loading: false });
      // A fila SAI da tela no erro. Deixá-la ao lado da mensagem diria "a fila
      // está limpa", e fila limpa e erro de carga são fatos diferentes.
      avisoFila.falhou(err.message || 'Erro ao carregar a fila');
      // As duas tabelas vieram da MESMA leitura, então as duas falham juntas.
      tabelaFechamento.update({ loading: false });
      contadorFechamento.textContent = '';
      avisoFechamento.falhou(err.message || 'Erro ao carregar os pedidos a fechar');
      showError(err.message || 'Erro ao carregar a fila de atendimento');
    }
  }

  await recarregar();

  return () => {
    disposed = true;
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch { /* ignore */ }
    }
  };
}
