import { el, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createTextField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { chip, chipSituacaoPedido } from '@components/status-chip.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import {
  getPedidos, deletePedidos, getAnosMapoteca, getPalavrasChave,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { permissoes } from '@store/auth-store.js';
import { SITUACAO_PEDIDO } from '@modules/mapoteca/situacao-pedido.js';
import { openSituacaoPedidoDialog } from './dialog-situacao.js';
import { criarAvisoDeErro } from '../aviso-carga.js';

/**
 * Pedidos list page (#/pedidos): table with search, status chips, printing
 * progress, link to details, delete with confirmation and "Novo pedido".
 *
 * Criar e excluir pedido sao gerente no servidor, entao quem tem consulta ou
 * operador ve a lista e o detalhe, e nada mais.
 *
 * A tela aceita `?filtro=<id>` na URL, com um dos ids de FILTROS. E por ele que
 * a fila de atendimento manda quem clicou em "Ver na lista de pedidos" cair
 * direto no recorte certo, em vez de chegar em "Todos" e ter de achar o botao.
 * Valor desconhecido cai em "Todos", que e o que a tela ja mostrava.
 *
 * Aceita tambem `?palavra_chave=<etiqueta>`, que abre a tela ja com a busca do
 * servidor feita. E o que permite mandar a alguem o link de um recorte
 * ("os pedidos de excedente") em vez de instrucoes de como chegar nele.
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
// Militar e OM EB, OM Aeronautica e OM Marinha (tipo_cliente 1 a 3). Civil e o
// resto: orgao publico federal, estadual e municipal, pessoa juridica, pessoa
// fisica e LAI. O mesmo corte que o dashboard usa para "pedido militar".
const TIPOS_MILITARES = [1, 2, 3];

// As situacoes vem de @modules/mapoteca/situacao-pedido.js, que copia os codigos
// do DDL (er/mapoteca.sql). Antes elas eram tres numeros soltos aqui.
//
// Aguardando producao (7) fica fora da fila de atendimento: o pedido espera
// carta que ainda nao existe. Fora da fila, esses pedidos so aparecem AQUI. Sem
// um filtro proprio eles viram esquecimento quando a producao terminar, porque
// ninguem lembra de procurar linha a linha.
//
// Aguardando envio (8) esta DENTRO da fila de atendimento, e ganha filtro pelo
// motivo oposto: ele e o pedido pronto que espera despacho, e quem monta uma
// remessa quer a lista dos que saem hoje, sem garimpar entre os que ainda estao
// na impressao.
//
// Militar e Civil sao o corte do DASHBOARD, e nao o de quem atende. Sem estes
// dois filtros nao havia como chegar aos 25 pedidos em andamento nem ao unico
// pedido Remetido. O Remetido depende de alguem marca-lo Concluido justamente
// aqui, e uma linha em 17 paginas de 10 nao e encontrada por quem nao a procura.
const FILTROS = [
  { id: 'todos', label: 'Todos', casa: () => true },
  { id: 'militar', label: 'Militar', casa: (p) => TIPOS_MILITARES.includes(Number(p.tipo_cliente_id)) },
  { id: 'civil', label: 'Civil', casa: (p) => !TIPOS_MILITARES.includes(Number(p.tipo_cliente_id)) },
  {
    id: 'em_andamento',
    label: 'Em andamento',
    casa: (p) => Number(p.situacao_pedido_id) === SITUACAO_PEDIDO.EM_ANDAMENTO,
  },
  {
    id: 'remetido',
    label: 'Remetido',
    casa: (p) => Number(p.situacao_pedido_id) === SITUACAO_PEDIDO.REMETIDO,
  },
  {
    id: 'aguardando_producao',
    label: 'Aguardando produção',
    casa: (p) => Number(p.situacao_pedido_id) === SITUACAO_PEDIDO.AGUARDANDO_PRODUCAO,
  },
  {
    id: 'aguardando_envio',
    label: 'Aguardando envio',
    casa: (p) => Number(p.situacao_pedido_id) === SITUACAO_PEDIDO.AGUARDANDO_ENVIO,
  },
];

export async function renderPedidosList(container, ctx) {
  let disposed = false;
  let todosPedidos = [];
  const filtroPedido = ctx && ctx.query ? ctx.query.get('filtro') : null;
  let filtroAtual = FILTROS.some(f => f.id === filtroPedido) ? filtroPedido : 'todos';
  // O ano da ultima carga, para o contador dizer de que ano e a contagem.
  let ano = null;
  // A etiqueta da ultima carga. Nulo e "o ano inteiro"; e o VALOR JA BUSCADO, e
  // nao o que esta digitado no campo, para o contador nunca falar de uma busca
  // que ainda nao aconteceu.
  let palavraChave = ctx && ctx.query ? (ctx.query.get('palavra_chave') || null) : null;
  const pode = permissoes('mapoteca');

  // O ano e DESTA tela, comeca no ano atual e nao guarda nada. Sem "+ Outro
  // ano": aqui o ano so filtra o pedido que ja
  // existe, e um ano sem pedido nenhum seria uma lista em branco.
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnosMapoteca,
    permitirOutroAno: false,
    onChange: () => load(),
  });

  // A BUSCA POR ETIQUETA E DO SERVIDOR, e nao a busca da tabela ao lado.
  //
  // Sao duas coisas diferentes na mesma tela, e o rotulo tem de separa-las: a
  // caixa da tabela filtra por pedaco de texto o que JA esta na tela (o ano
  // inteiro), e esta aqui vai ao servidor e casa a ETIQUETA INTEIRA, com
  // maiuscula e minuscula contando.
  //
  // A exigencia nao e capricho, e o texto de ajuda diz isso com palavra de
  // gente: `mapoteca.pedido.palavras_chave` tem indice GIN, o operador que ele
  // atende e o `@>` (continencia), e um `ILIKE` ou um `lower()` abandonariam o
  // indice e leriam a tabela inteira. Sem o aviso, quem digitar 'extra' e nao
  // achar 'Extra-PIT' conclui que a busca esta quebrada.
  //
  // O CAMPO SUGERE AS ETIQUETAS QUE EXISTEM, e a sugestao e a resposta pratica a
  // exigencia acima: quem escolhe da lista nao tem grafia para errar. A lista
  // chega de `getPalavrasChave`, logo abaixo, e nao segura a tela.
  const buscaEtiqueta = createTextField({
    label: 'Palavra-chave',
    value: palavraChave || '',
    placeholder: 'Ex.: excedente',
    maxLength: 255,
    sugestoes: [],
    helpText: 'Busca no servidor pela etiqueta inteira, com maiúscula e minúscula contando: "exced" não acha "excedente". Escolha uma da lista. Enter busca, campo vazio traz o ano todo.',
  });
  buscaEtiqueta.element.classList.add('filtro-barra__busca');
  // SOZINHA e com `catch` proprio, fora da carga da lista: a sugestao e
  // conforto, e a tela de pedidos nao morre porque ela nao veio. Sem ela o campo
  // volta a ser o que era, um texto livre que casa a etiqueta inteira.
  getPalavrasChave()
    .then(lista => buscaEtiqueta.setSugestoes(lista.map(p => p.etiqueta)))
    .catch(() => {});
  // Enter BUSCA. Sem isto o campo pareceria filtrar enquanto se digita, como o
  // da tabela ao lado, e nunca buscaria nada.
  buscaEtiqueta.input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      buscar();
    }
  });

  /** Repete a carga com o que esta digitado no campo de etiqueta. */
  function buscar() {
    const digitado = buscaEtiqueta.getValue();
    palavraChave = digitado === '' ? null : digitado;
    load();
  }

  function aplicarFiltro() {
    const filtro = FILTROS.find(f => f.id === filtroAtual) || FILTROS[0];
    const linhas = todosPedidos.filter(filtro.casa);
    table.update({ rows: linhas, loading: false });
    // A etiqueta entra no contador porque ela recorta ANTES de a lista chegar:
    // sem dize-la, "3 pedido(s) em 2026" seria a contagem do ano, e nao a do
    // que a tela esta mostrando.
    const comEtiqueta = palavraChave ? ` com a palavra-chave "${palavraChave}"` : '';
    contador.textContent = filtroAtual === 'todos'
      ? `${linhas.length} pedido(s) em ${ano}${comEtiqueta}`
      : `${linhas.length} de ${todosPedidos.length} pedido(s) em ${ano}${comEtiqueta}`;
  }

  async function load() {
    ano = filtroAno.getAno();
    table.update({ loading: true });
    try {
      const pedidos = await getPedidos(ano, palavraChave);
      if (disposed) return;
      todosPedidos = pedidos;
      aplicarFiltro();
      aviso.ok();
    } catch (err) {
      if (disposed) return;
      todosPedidos = [];
      table.update({ loading: false });
      contador.textContent = '';
      // A tabela SAI de vista. Deixa-la diria "Nenhum pedido neste ano. Troque
      // o ano no filtro", que manda trocar o ano quando o problema foi a
      // resposta que nao veio.
      aviso.falhou(err.message || 'Erro ao carregar os pedidos');
      showError(err.message || 'Erro ao carregar os pedidos');
    }
  }

  async function excluirPedido(pedido) {
    const confirmado = await confirmDialog({
      title: 'Excluir pedido',
      message: `Excluir o pedido #${pedido.id} (${pedido.localizador_pedido}) e todos os seus itens? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;

    try {
      await deletePedidos([pedido.id]);
      showSuccess('Pedido excluído com sucesso');
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o pedido');
    }
  }

  const contador = el('span', { className: 'page__meta', textContent: '' });

  const botoesFiltro = FILTROS.map(f => el('button', {
    className: `btn btn--sm ${f.id === filtroAtual ? 'btn--primary' : 'btn--secondary'}`,
    type: 'button',
    textContent: f.label,
    onClick: () => {
      filtroAtual = f.id;
      for (const b of botoesFiltro) {
        const ativo = b.dataset.filtro === filtroAtual;
        b.classList.toggle('btn--primary', ativo);
        b.classList.toggle('btn--secondary', !ativo);
      }
      aplicarFiltro();
    },
  }));
  botoesFiltro.forEach((b, i) => { b.dataset.filtro = FILTROS[i].id; });

  const table = createDataTable({
    columns: [
      // Sem coluna de ID: e chave interna. O pedido se identifica pelo
      // localizador e pelo documento, e o id segue na URL do detalhe.
      {
        key: 'data_pedido',
        label: 'Data',
        sortable: true,
        render: (row) => formatDate(row.data_pedido),
      },
      { key: 'cliente_nome', label: 'Cliente', sortable: true },
      { key: 'tipo_cliente_nome', label: 'Tipo', sortable: true },
      { key: 'documento_solicitacao', label: 'Documento' },
      {
        key: 'palavras_chave',
        label: 'Palavras-chave',
        // A COLUNA EXISTE POR CAUSA DO FILTRO. Filtrar por algo que a tela nao
        // mostra deixa quem filtrou sem saber POR QUE aquela linha entrou, e
        // sem saber com que grafia a etiqueta foi gravada, que e justamente o
        // que a busca exige acertar.
        //
        // O CLIQUE NA ETIQUETA BUSCA POR ELA. E a unica forma de acertar a
        // grafia sem adivinhar: o texto vai para o campo exatamente como esta
        // gravado, e a busca sai de la.
        //
        // A COLUNA TEM LARGURA MAXIMA, e as etiquetas QUEBRAM em varias linhas.
        // Ate 2026-08-11 ela era um `.flex` sem `flex-wrap`, e quatro etiquetas
        // numa linha so empurravam Situacao, Prazo e Impressao para fora da tela:
        // uma coluna acessoria roubava o espaco das que dizem se o pedido esta
        // atrasado. A altura da linha e o preco, e e o preco certo: crescer para
        // baixo cabe, crescer para a direita nao.
        className: 'celula-etiquetas',
        render: (row) => {
          const etiquetas = row.palavras_chave || [];
          if (!etiquetas.length) return '-';
          return el('span', { className: 'etiquetas' }, etiquetas.map((etiqueta) => {
            const alvo = chip(etiqueta, 'secondary');
            alvo.title = `Buscar os pedidos com a palavra-chave "${etiqueta}"`;
            alvo.style.cursor = 'pointer';
            alvo.addEventListener('click', () => {
              buscaEtiqueta.setValue(etiqueta);
              buscar();
            });
            return alvo;
          }));
        },
      },
      {
        key: 'situacao_pedido_nome',
        label: 'Situação',
        // O CHIP MUDA A SITUACAO, sem abrir o pedido. E a mesma ideia do chip de
        // palavra-chave acima: a celula que MOSTRA o estado e o lugar natural
        // para troca-lo, e a lista era o unico caminho ate a situacao de um
        // pedido que ja saiu da fila de atendimento.
        //
        // O dialogo nao e enfeite: metade das mudancas registradas na auditoria
        // (13 de 26, entre 2026-07-30 e 2026-08-24) exige um segundo campo, que
        // e a data de atendimento do Concluido ou o motivo do Cancelado.
        //
        // SO PARA GERENTE, o mesmo piso que o servidor cobra em
        // PUT /pedido/:id/situacao. Quem tem consulta ou operador ve o chip
        // parado, como antes.
        render: (row) => {
          const alvo = chipSituacaoPedido(row.situacao_pedido_id, row.situacao_pedido_nome);
          if (!pode.gerente) return alvo;
          alvo.title = 'Mudar a situação deste pedido';
          alvo.style.cursor = 'pointer';
          // O chip e um <span>, entao o papel e o foco vao na mao: sem eles o
          // teclado nao alcanca a unica acao da celula.
          alvo.setAttribute('role', 'button');
          alvo.tabIndex = 0;
          const abrir = () => openSituacaoPedidoDialog(row, load);
          alvo.addEventListener('click', abrir);
          alvo.addEventListener('keydown', (e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              abrir();
            }
          });
          return alvo;
        },
      },
      { key: 'prazo', label: 'Prazo', sortable: true, render: (row) => formatDate(row.prazo) },
      {
        key: 'data_atualizacao',
        label: 'Alterado em',
        sortable: true,
        // QUANDO O REGISTRO mudou pela ultima vez, e nao a data do pedido, que
        // e a do DIEx. E o que mostra qual dos pedidos em aberto esta parado:
        // ordenar por esta coluna poe o esquecido na frente.
        //
        // Registro nunca alterado tem `data_atualizacao` nulo, e nele a ultima
        // alteracao E a criacao. Por isso a queda para `data_criacao`, que a
        // lista sempre traz.
        //
        // So a DATA, sem o autor: a migracao gravou um unico login em 164 de
        // 164 pedidos, entao `usuario_criacao_nome`
        // chega na resposta e fica de fora de proposito, e nao por esquecimento.
        render: (row) => formatDate(row.data_atualizacao || row.data_criacao),
        sortValue: (row) => row.data_atualizacao || row.data_criacao || null,
      },
      {
        key: 'quantidade_produtos',
        label: 'Qtd. produtos',
        sortable: true,
        render: (row) => formatNumber(row.quantidade_produtos),
      },
      {
        key: 'itens_impressos',
        label: 'Impressão',
        render: (row) => `${row.itens_impressos ?? 0}/${row.quantidade_produtos ?? 0}`,
      },
      {
        key: 'cep_etiqueta',
        label: 'CEP',
        // A COLUNA NASCE ESCONDIDA e aparece quando a busca casa por ela. A
        // razao de ela existir e a mesma da coluna de palavras-chave acima:
        // filtrar por algo que a tela nao mostra deixa quem filtrou sem saber
        // POR QUE aquela linha entrou. A diferenca e que o CEP nao serve a
        // leitura do dia a dia, e uma coluna a mais no meio das oito que ja
        // disputam a largura custaria mais do que paga.
        //
        // A busca a alcanca mesmo escondida: `colunasVisiveis()` decide o que se
        // PINTA, e a varredura da busca continua no conjunto inteiro.
        revelarNaBusca: true,
        // O CEP e texto livre no banco (`Joi.string().max(9)`, sem mascara), e o
        // dialogo da etiqueta so preenche com hifen quando extrai o CEP do
        // endereco. Quem digitar 90850240 grava assim, e cabe nos 9 caracteres.
        // Comparar so os digitos, dos dois lados, e o que faz 81150900 achar
        // 81150-900 e o contrario tambem.
        searchNormalize: (texto) => texto.replace(/\D/g, ''),
        // SEM `sortable`, de proposito: ordenar por uma coluna que some quando a
        // busca se apaga deixaria a lista ordenada por um criterio invisivel.
        render: (row) => row.cep_etiqueta || '-',
      },
      { key: 'localizador_pedido', label: 'Localizador' },
    ],
    rows: [],
    // A ordem que o servidor JA aplica (ORDER BY p.data_pedido DESC). Sem
    // declara-la, nenhum cabecalho mostrava a seta, o `aria-sort` ficava "none"
    // em todos, e o primeiro clique em "Data" saltava para o pedido mais ANTIGO,
    // obrigando a um segundo clique para voltar ao que a tela ja mostrava.
    defaultSort: { key: 'data_pedido', dir: 'desc' },
    searchable: true,
    loading: true,
    // Sem o ano no texto, de proposito: a mensagem e montada uma vez e o ano
    // muda no filtro. Quem diz de que ano e a lista e o contador ao lado dos
    // filtros, que se repinta a cada carga.
    emptyMessage: 'Nenhum pedido neste ano com estes filtros. Troque o ano ou apague a palavra-chave.',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver detalhes',
        onClick: (row) => { location.hash = `/mapoteca/pedidos/${row.id}`; },
      },
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (row) => excluirPedido(row),
      }] : []),
    ],
  });

  const aviso = criarAvisoDeErro(table, load);

  container.appendChild(el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Pedidos' }),
      el('div', { className: 'page__actions' }, [
        // A planilha do RTM NAO sai daqui: ela sai da tela do
        // RPCMTec, junto do Anuario, que e onde se monta o envio
        // mensal para a DSG -- e la ela passou a respeitar o MES escolhido, o
        // que aqui nao tinha como acontecer (esta tela so tem ano).
        ...(pode.gerente ? [
          el('button', {
            className: 'btn btn--primary',
            type: 'button',
            onClick: () => { location.hash = '/mapoteca/pedidos/novo'; },
          }, [svgIcon(ICONS.add, 16), 'Novo pedido']),
        ] : []),
      ]),
    ]),
    el('div', { className: 'filtro-barra' }, [
      // O ano vem PRIMEIRO e a etiqueta logo depois: os dois decidem o que o
      // SERVIDOR traz, e os botoes ao lado so recortam o que ja chegou. A ordem
      // na barra e a ordem em que o recorte acontece.
      filtroAno.element,
      buscaEtiqueta.element,
      el('button', {
        className: 'btn btn--sm btn--secondary',
        type: 'button',
        textContent: 'Buscar',
        onClick: buscar,
      }),
      el('div', { className: 'filtro-barra__grupo', role: 'group', 'aria-label': 'Filtrar os pedidos' }, botoesFiltro),
      contador,
    ]),
    aviso.element,
  ]));

  await load();

  return () => {
    disposed = true;
    table._cleanup();
  };
}
