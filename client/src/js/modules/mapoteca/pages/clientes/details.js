import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { reconciliar } from '@utils/reconciliar.js';
import { chip, chipSituacaoPedido } from '@components/status-chip.js';
import { getCliente } from '@modules/mapoteca/services/mapoteca-service.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { permissoes } from '@store/auth-store.js';
import { openClienteDialog } from './dialog-cliente.js';
import { criarHistorico } from '@components/historico/historico.js';

function summaryCard([label, value]) {
  return el('div', { className: 'summary-card' }, [
    el('div', { className: 'summary-card__value', textContent: value }),
    el('div', { className: 'summary-card__label', textContent: label }),
  ]);
}

function infoRow([label, value]) {
  return el('div', { className: 'detail-card__row' }, [
    el('span', { className: 'detail-card__label', textContent: label }),
    el('span', { className: 'detail-card__value', textContent: value || '-' }),
  ]);
}

/** Repinta o VALOR de um cartão ou de uma linha já na tela, sem trocar o nó. */
function escreverValor(no, seletor, valor) {
  no.querySelector(seletor).textContent = valor;
}

/**
 * Cliente details page (#/clientes/:id): statistics cards, contact info,
 * recent orders (link to order details) and the edit dialog.
 *
 * A PÁGINA SE MONTA UMA VEZ, e a carga só repinta. Antes, cada
 * gravação no diálogo chamava `load()`, e `load()` esvaziava a página inteira e
 * montava tudo de novo. Custava três coisas: a tabela de pedidos voltava para a
 * página 1 (o estado dela mora no OBJETO da tabela, que era jogado fora), o foco
 * do teclado morria com o botão que o tinha, e a seção de HISTÓRICO saía do DOM
 * e nunca voltava, porque `renderCliente` só repunha os outros blocos.
 *
 * O desenho agora: os nós vivem enquanto a página vive, e `load()` escreve neles.
 * Lista se reconcilia por chave, texto se escreve no nó, e a tabela recebe
 * `update({ rows })`.
 *
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderClienteDetails(container, { params }) {
  const clienteId = Number(params.id);
  let disposed = false;
  // O cliente da ÚLTIMA carga. O botão Editar vive fora do `load()`, e sem esta
  // variável o closure dele congelaria o cliente da primeira carga: quem
  // renomeasse e editasse de novo reabriria o formulário com o nome velho.
  let clienteAtual = null;
  // Falso até a primeira carga dar certo. Separa a carga INICIAL (que ainda não
  // tem o que preservar, e mostra o "Carregando") da RECARGA (que não pode
  // mexer no layout).
  let montado = false;
  let historico = null;
  const cleanups = [];

  const root = el('div', { className: 'page' });
  container.appendChild(root);

  // ---------------------------------------------------------------------------
  // A pagina, montada UMA vez
  // ---------------------------------------------------------------------------
  const titulo = el('h1', { className: 'page__title' });
  const chipTipo = chip('-', 'info');

  const cabecalho = el('div', { className: 'page__header' }, [
    el('div', {}, [
      el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        onClick: () => { location.hash = '/mapoteca/clientes'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Clientes']),
      el('div', { className: 'flex gap-sm' }, [titulo, chipTipo]),
    ]),
    // PUT /cliente é gerente: sem isso o botão aparecia para quem só lê. A
    // permissão não muda enquanto a página vive, então ela se lê UMA vez.
    el('div', { className: 'page__actions' }, permissoes('mapoteca').gerente ? [
      el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => openClienteDialog({ cliente: clienteAtual, onSaved: aoSalvar }),
      }, [svgIcon(ICONS.edit, 16), 'Editar']),
    ] : []),
  ]);

  const cartoes = el('div', { className: 'summary-cards' });

  // Wrapper próprio para as linhas: o `reconciliar` manda no container inteiro,
  // e o título do cartão não pode entrar na lista que ele varre.
  const contatoLinhas = el('div');

  const pedidosTable = createDataTable({
    columns: [
      { key: 'id', label: 'ID', sortable: true },
      {
        key: 'data_pedido',
        label: 'Data',
        sortable: true,
        render: (row) => formatDate(row.data_pedido),
      },
      {
        key: 'situacao_pedido_nome',
        label: 'Situação',
        render: (row) => chipSituacaoPedido(row.situacao_pedido_id, row.situacao_pedido_nome),
      },
      { key: 'documento_solicitacao', label: 'Documento' },
      { key: 'prazo', label: 'Prazo', render: (row) => formatDate(row.prazo) },
      {
        key: 'quantidade_produtos',
        label: 'Produtos',
        render: (row) => formatNumber(row.quantidade_produtos),
      },
    ],
    rows: [],
    pageSize: 5,
    emptyMessage: 'Nenhum pedido para este cliente',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver pedido',
        onClick: (row) => { location.hash = `/mapoteca/pedidos/${row.id}`; },
      },
    ],
  });
  cleanups.push(() => pedidosTable._cleanup());

  // O título da seção é FIXO. O recorte ("5 de 29") vive no nó ao lado, e não
  // dentro do título: o título é a âncora que identifica a seção na tela e nos
  // testes, e ele muda de sentido se o número entra nele.
  const tituloPedidos = el('h2', {
    className: 'dashboard-section__title',
    textContent: 'Últimos pedidos',
  });

  // Diz QUANTOS pedidos a tabela mostra e quantos existem. O texto se escreve
  // em `pintarCliente`, porque o total vem do cliente.
  const metaPedidos = el('span', { className: 'dashboard-section__meta', textContent: '' });

  const conteudo = el('div', {}, [
    cabecalho,
    cartoes,
    el('div', { className: 'dashboard-grid dashboard-grid--2col' }, [
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Informações de contato' }),
        contatoLinhas,
      ]),
    ]),
    el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        tituloPedidos,
        metaPedidos,
      ]),
      pedidosTable.element,
    ]),
  ]);

  // O "Carregando" da primeira carga e o erro de carga moram aqui, fora do
  // `conteudo`: assim o erro não apaga a página, ele a esconde e a devolve.
  const aviso = el('div');

  conteudo.hidden = true;
  root.appendChild(aviso);
  root.appendChild(conteudo);

  function mostrarErro(mensagem) {
    clearChildren(aviso);
    aviso.hidden = false;
    aviso.appendChild(el('div', { className: 'data-table__empty', textContent: mensagem }));
    aviso.appendChild(el('button', {
      className: 'btn btn--secondary',
      type: 'button',
      onClick: () => { location.hash = '/mapoteca/clientes'; },
    }, [svgIcon(ICONS.arrowBack, 16), 'Voltar para clientes']));
    conteudo.hidden = true;
    pedidosTable.update({ loading: false });
  }

  async function load() {
    if (!montado) {
      clearChildren(aviso);
      aviso.hidden = false;
      aviso.appendChild(el('div', {
        className: 'data-table__empty',
        textContent: 'Carregando cliente...',
      }));
      conteudo.hidden = true;
    } else {
      // Recarga de uma ficha JÁ na tela: nada some. A tabela mantém as linhas e
      // só marca que está buscando, e o resto da página fica parado.
      pedidosTable.update({ loading: true });
    }

    let cliente;
    try {
      cliente = await getCliente(clienteId);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar o cliente');
      mostrarErro(err.message || 'Cliente não encontrado');
      return;
    }
    if (disposed) return;

    clienteAtual = cliente;
    clearChildren(aviso);
    aviso.hidden = true;
    conteudo.hidden = false;
    montado = true;
    pintarCliente(cliente);
  }

  /** Escreve o cliente nos nós que já estão na tela. Não cria bloco nenhum. */
  function pintarCliente(cliente) {
    const est = cliente.estatisticas || {};

    titulo.textContent = cliente.nome;
    chipTipo.textContent = cliente.tipo_cliente_nome || '-';

    // A chave é o RÓTULO: ele identifica o cartão, e a ordem nunca muda.
    reconciliar(cartoes, [
      ['Total de pedidos', formatNumber(est.total_pedidos)],
      ['Em andamento', formatNumber(est.pedidos_em_andamento)],
      ['Concluídos', formatNumber(est.pedidos_concluidos)],
      ['Total de produtos', formatNumber(est.total_produtos)],
      ['Primeiro pedido', formatDate(est.data_primeiro_pedido)],
      ['Último pedido', formatDate(est.data_ultimo_pedido)],
    ], {
      chave: ([label]) => label,
      criar: summaryCard,
      atualizar: (no, [, valor]) => escreverValor(no, '.summary-card__value', valor),
    });

    reconciliar(contatoLinhas, [
      ['Tipo de cliente', cliente.tipo_cliente_nome],
      // A sigla é o nome corrente da OM, e é por ela que a pessoa se apresenta
      // ao telefone. Fica logo abaixo do tipo, porque o tipo é a primeira linha
      // da ficha desde sempre, e trocar essa âncora quebra quem a observa.
      ['Sigla', cliente.sigla],
      // "Geral" e o que o distingue do contato de UM pedido, que mora em
      // mapoteca.pedido.ponto_contato e aparece no detalhe do pedido.
      ['Contato geral da OM', cliente.ponto_contato_principal],
      ['Endereço de entrega principal', cliente.endereco_entrega_principal],
    ], {
      chave: ([label]) => label,
      criar: infoRow,
      atualizar: (no, [, valor]) => escreverValor(no, '.detail-card__value', valor || '-'),
    });

    // A rota do cliente devolve no máximo 5 pedidos, e a tabela mostra o que
    // veio. Sem dizer o total, a ficha passava 5 por "tudo o que existe": o
    // cliente 65 tem 29 pedidos, e a tela mostrava 5 sem avisar nada. O nó de
    // apoio conta a verdade. Paginar aqui não resolveria, porque o resto não
    // veio. Some quando a tabela já mostra todos os pedidos.
    const pedidos = cliente.ultimos_pedidos || [];
    const totalPedidos = Number(est.total_pedidos) || 0;
    metaPedidos.textContent = totalPedidos > pedidos.length
      ? `(${formatNumber(pedidos.length)} de ${formatNumber(totalPedidos)})`
      : '';

    pedidosTable.update({ rows: pedidos, loading: false });
  }

  /**
   * O que acontece depois de uma gravação no diálogo.
   *
   * Recarrega a ficha e o HISTÓRICO. O histórico é recarregado porque a
   * gravação acabou de criar um evento nele: deixá-lo como estava mostraria uma
   * tela que nega a alteração que a pessoa acabou de fazer.
   */
  async function aoSalvar() {
    await load();
    if (historico) historico.recarregar();
  }

  await load();

  // Histórico de alterações. É o MESMO componente da ficha do pedido, e é por
  // isso que ele existe: a seção que o chefe gostou lá vale em toda ficha, e
  // copiá-la seria a segunda versão a divergir na primeira correção.
  //
  // Fica FORA do `load()` de propósito: o `load()` não esvazia o `root`, então a
  // seção continua na tela depois de salvar, em vez de sumir.
  historico = criarHistorico({
    modulo: 'mapoteca',
    entidade: 'cliente',
    id: clienteId,
    subtitulo: 'Quem alterou o cadastro deste cliente',
  });
  cleanups.push(() => historico.cleanup());
  root.appendChild(historico.element);

  return () => {
    disposed = true;
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch { /* ignore */ }
    }
  };
}
