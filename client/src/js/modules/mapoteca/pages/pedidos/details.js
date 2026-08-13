import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { reconciliar } from '@utils/reconciliar.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { chip, chipSituacaoPedido } from '@components/status-chip.js';
import {
  getPedido,
  updatePedido,
  deletePedidos,
  createProdutoPedido,
  updateProdutoPedido,
  deleteProdutosPedido,
  getImpressaoItem,
  deleteImpressoes,
  corrigirDataImpressao,
  getClientes,
  getDominioSituacaoPedido,
  getDominioCanalRecebimento,
  getDominioFormaEntrega,
  getAnexosPedido,
  uploadAnexoPedido,
  downloadAnexoPedido,
  deleteAnexoPedido,
} from '@modules/mapoteca/services/mapoteca-service.js';
// O histórico NÃO é código desta tela: ele é o mesmo nas seis fichas que o
// mostram (ver o comentário do bloco do histórico, mais abaixo).
import { criarHistorico } from '@components/historico/historico.js';
import { createDateField, createTextField } from '@components/form-fields/form-fields.js';
import { formatBoolean, formatDate, formatDateTime, formatNumber, toIsoDate } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { permissoes } from '@store/auth-store.js';
import {
  createPedidoFormFields,
  aplicarModoPedido,
  modoDoTipoCliente,
  ROTULO_MODO,
} from './pedido-form.js';
import { openProdutoPedidoDialog } from './dialog-produto.js';
import { openEtiquetaEnvioDialog } from './etiqueta-envio.js';
import { openRegistrarImpressaoDialog } from './dialog-impressao.js';
import { getMetasPit } from '@services/plataforma-service.js';

// Acima deste tamanho, o valor nao cabe na mesma linha do rotulo dentro de um
// card de meia largura, e passa a ser empilhado.
const LIMITE_VALOR_CURTO = 45;

/**
 * Poe no container exatamente estes nos, nesta ordem, sem recriar nenhum.
 *
 * Serve ao bloco que APARECE ou SOME conforme o dado. As duas saidas obvias
 * falham: escondido por CSS o texto continua no `textContent` da pagina (a tela
 * diria "Observacao interna" num pedido que nao tem nenhuma), e recriado a cada
 * carga o no perde o estado e o foco.
 * @param {Element} container
 * @param {Array<Node>} nos
 */
function mostrar(container, nos) {
  reconciliar(container, nos, { chave: (no) => no, criar: (no) => no });
}

/**
 * Copia a cara de um chip recem-montado para o chip que JA esta na tela.
 *
 * O texto e a cor do chip mudam a cada carga (a situacao do pedido, o
 * localizador). Trocar o no era o simples, e cobrava o repinte de um pedaco do
 * cabecalho a cada gravacao. A fabrica (`chip`, `chipSituacaoPedido`) continua
 * sendo a dona da regra de cor: o que se copia e o resultado dela.
 * @param {HTMLElement} no - o chip vivo
 * @param {HTMLElement} novo - o chip que a fabrica acabou de montar
 */
function repintarChip(no, novo) {
  no.className = novo.className;
  no.textContent = novo.textContent;
}

/**
 * Linha "rotulo ... valor" de um card de detalhe, MONTADA UMA VEZ e repintada
 * depois. O `definir` escreve no no que ja existe.
 *
 * Valor CURTO fica na mesma linha do rotulo, alinhado a direita. Valor LONGO
 * (observacao, endereco) empilha: rotulo em cima e texto a esquerda, porque
 * alinhado a direita um paragrafo fica com a margem esquerda irregular e a
 * leitura trava a cada quebra.
 *
 * A decisao e AUTOMATICA, pelo tamanho do texto, e nao marcada campo a campo.
 * Marcar a mao errava nos dois sentidos: o campo vazio ficava empilhado gastando
 * duas linhas para mostrar um traco, e o campo nao marcado com texto longo
 * seguia espremido.
 *
 * `temValor()` diz se o ultimo `definir` recebeu alguma coisa. Quem monta card
 * usa isso para TIRAR do DOM a linha vazia (ver criarCard). O traco continua
 * valendo para quem mantem a linha na tela, como o modal do historico.
 * @param {string} label
 * @returns {{element:HTMLElement, definir:(value:string|Node)=>void, temValor:()=>boolean}}
 */
function criarInfoRow(label) {
  const valorEl = el('span', { className: 'detail-card__value' });
  const element = el('div', { className: 'detail-card__row' }, [
    el('span', { className: 'detail-card__label', textContent: label }),
    valorEl,
  ]);
  let comValor = false;

  function definir(value) {
    comValor = value instanceof Node || Boolean(value);
    const texto = value instanceof Node ? null : (value || '-');
    const longo = typeof texto === 'string' && texto.length > LIMITE_VALOR_CURTO;
    element.className = longo ? 'detail-card__row detail-card__row--longo' : 'detail-card__row';

    if (value instanceof Node) {
      // O MESMO no de sempre (o link do cliente, um chip) nao e tocado:
      // `replaceChildren` o tiraria da tela e o devolveria, levando o foco junto.
      if (valorEl.firstChild !== value) valorEl.replaceChildren(value);
    } else {
      valorEl.textContent = texto;
    }
  }

  return { element, definir, temValor: () => comValor };
}

/**
 * Linha "rotulo ... valor" de uso unico, para quem monta e joga fora (o modal).
 * @param {string} label
 * @param {string|Node} value
 */
function infoRow(label, value) {
  const linha = criarInfoRow(label);
  linha.definir(value);
  return linha.element;
}

// Domínio mapoteca.tipo_anexo_pedido (estável; espelha o seed do banco).
const TIPOS_ANEXO = [
  { code: 1, nome: 'Documento de solicitação (DIEx/Ofício)' },
  { code: 2, nome: 'Anexo do documento de solicitação' },
  { code: 3, nome: 'Comprovante de entrega/remessa' },
  { code: 4, nome: 'Outros' },
];

function formatBytes(bytes) {
  const n = Number(bytes);
  if (!Number.isFinite(n) || n <= 0) return '-';
  const units = ['B', 'KB', 'MB', 'GB'];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i += 1; }
  return `${v.toFixed(i === 0 ? 0 : 1)} ${units[i]}`;
}

// `formatDate` e `formatDateTime` escrevem um traco quando o valor e nulo, e o
// traco e a unica coisa que a linha de card nao pode receber: ele conta como
// valor e a linha deixa de sumir. Na celula de tabela o traco continua certo.
const dataOuNada = (valor) => (valor ? formatDate(valor) : '');
const dataHoraOuNada = (valor) => (valor ? formatDateTime(valor) : '');

/**
 * Pedido details page (#/pedidos/:id): header with chips and edit/delete,
 * 4 info cards, cancellation reason, items table with add/edit/delete and
 * printing history, plus the order printing summary.
 *
 * A TELA MONTA UMA VEZ E SE REPINTA. Antes, cada gravacao passava
 * por `clearChildren(root)` e remontava tudo: as tres tabelas eram criadas
 * DENTRO do `load()`, e com elas iam embora a busca, a ordenacao, a pagina, a
 * selecao e o foco. O container colapsava e esticava a cada salvamento, e o
 * chefe descreveu o efeito assim: "a tela fica se movendo".
 *
 * O desenho de agora tem tres partes. Primeira: o esqueleto (cabecalho, cards,
 * secoes, tabelas) nasce ANTES do primeiro `load()` e nunca mais e refeito.
 * Segunda: o `load()` so escreve nos nos que ja existem, e troca as linhas das
 * tabelas por `update({ rows })`, que e onde o data-table preserva o estado de
 * quem esta lendo. Terceira: bloco que aparece so as vezes entra e sai do DOM
 * pelo `mostrar()`, porque escondido por CSS ele ainda contaria como texto da
 * pagina.
 *
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderPedidoDetails(container, { params }) {
  const pedidoId = Number(params.id);
  let disposed = false;
  const cleanups = [];
  // A ficha VIVA. Os botoes do cabecalho leem daqui, e nao de um `pedido`
  // capturado na montagem: eles sao montados uma vez so e precisam continuar
  // valendo depois de cada gravacao.
  let pedidoAtual = null;
  // Ja houve uma carga com sucesso. Separa a primeira pintura da RECARGA, que e
  // a que tem estado de leitura para preservar.
  let montado = false;

  // Quase toda escrita DESTA tela e gerente no servidor: editar e excluir o
  // pedido, os itens, os anexos e o EXCLUIR de um registro de impressao. Baixar
  // anexo, ver o historico de impressao e ver o historico do pedido sao
  // consulta, entao continuam para todo mundo.
  //
  // A excecao e REGISTRAR impressao, que POST /mapoteca/impressao trata como
  // operador: quem imprime lanca o que saiu do plotter, e nao desfaz nada.
  const pode = permissoes('mapoteca');

  const root = el('div', { className: 'page' });
  container.appendChild(root);

  function disposeCleanups() {
    while (cleanups.length) {
      const fn = cleanups.pop();
      try { fn(); } catch { /* ignore */ }
    }
  }

  // ---------------------------------------------------------------------------
  // Edit / delete pedido
  // ---------------------------------------------------------------------------
  async function editarPedido(pedido) {
    let clientes, situacoes, canais, formasEntrega, metas;
    try {
      // Metas do ano DO PEDIDO, e nao do ano corrente: editar um pedido de 2025
      // tem de oferecer o PIT de 2025, cuja numeracao nao e a de 2026.
      const anoPedido = new Date(`${pedido.data_pedido}T00:00:00`).getFullYear();
      [clientes, situacoes, canais, formasEntrega, metas] = await Promise.all([
        getClientes(), getDominioSituacaoPedido(), getDominioCanalRecebimento(),
        getDominioFormaEntrega(), getMetasPit(anoPedido),
      ]);
    } catch (err) {
      showError(err.message || 'Erro ao carregar os dados do formulário');
      return;
    }

    const form = createPedidoFormFields({ pedido, clientes, situacoes, canais, formasEntrega, metas });

    const civilSection = el('div', {}, [
      el('div', {
        className: 'detail-card__title',
        style: { marginTop: 'var(--space-md)' },
        textContent: 'Pedido de civil',
      }),
      form.civilElement,
    ]);

    // O modal do openModal aceita só texto no título, entao o chip do modo fica
    // na primeira linha do corpo. Sem ele, os 24 campos de uma vez nao diziam se
    // o pedido era civil ou militar.
    const chipModo = el('div', { style: { marginBottom: 'var(--space-md)' } });

    const content = el('div', {}, [
      chipModo,
      el('div', { className: 'detail-card__title', textContent: 'Dados básicos' }),
      form.basicoElement,
      el('div', {
        className: 'detail-card__title',
        style: { marginTop: 'var(--space-md)' },
        textContent: 'Dados adicionais',
      }),
      form.adicionalElement,
      civilSection,
    ]);

    // O modo sai do tipo do cliente SELECIONADO, não do que o pedido tinha ao
    // abrir: trocar o cliente pode virar um pedido militar em civil.
    function aplicarModo() {
      const clienteId = form.fields.cliente_id.getValue();
      const cliente = clientes.find(c => c.id === clienteId);
      const tipo = cliente ? cliente.tipo_cliente_id : pedido.tipo_cliente_id;
      const modo = modoDoTipoCliente(tipo);
      clearChildren(chipModo);
      chipModo.appendChild(chip(ROTULO_MODO[modo], modo === 'militar' ? 'info' : 'secondary'));
      aplicarModoPedido({ fields: form.fields, modo, civilElement: civilSection });
    }

    form.fields.cliente_id.input.addEventListener('change', aplicarModo);
    aplicarModo();

    let submitting = false;

    openModal({
      title: `Editar pedido #${pedido.id}`,
      content,
      width: '860px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Salvar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (submitting) return;
            const basicoOk = form.validateBasico();
            const adicionalOk = form.validateAdicional();
            if (!basicoOk || !adicionalOk) return;

            submitting = true;
            try {
              await updatePedido({ id: pedido.id, ...form.getValues() });
              showSuccess('Pedido atualizado com sucesso');
              close();
              load();
            } catch (err) {
              submitting = false;
              showError(err.message || 'Erro ao atualizar o pedido');
            }
          },
        },
      ],
    });
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
      location.hash = '/mapoteca/pedidos';
    } catch (err) {
      showError(err.message || 'Erro ao excluir o pedido');
    }
  }

  // ---------------------------------------------------------------------------
  // Items (produto_pedido)
  // ---------------------------------------------------------------------------
  // As metas do ano DO PEDIDO, e não do ano corrente, pela mesma razão da edição
  // do pedido: um pedido de 2025 tem de oferecer o PIT de 2025, cuja numeração
  // não é a de 2026.
  //
  // Falha na busca NÃO impede o cadastro do item: sem as metas o diálogo abre
  // com o combo vazio, e perder a exceção é muito melhor que não conseguir
  // cadastrar o item.
  async function metasDoPedido() {
    if (!pedidoAtual || !pedidoAtual.previsto_pit) return [];
    try {
      const ano = new Date(`${pedidoAtual.data_pedido}T00:00:00`).getFullYear();
      return await getMetasPit(ano);
    } catch {
      return [];
    }
  }

  async function adicionarItem() {
    const metasPit = await metasDoPedido();
    openProdutoPedidoDialog({
      pedido: pedidoAtual,
      metasPit,
      onSubmit: async ({ payload }) => {
        await createProdutoPedido({ ...payload, pedido_id: pedidoId });
        showSuccess('Item adicionado ao pedido');
        load();
      },
    });
  }

  async function editarItem(row) {
    const metasPit = await metasDoPedido();
    openProdutoPedidoDialog({
      item: row,
      pedido: pedidoAtual,
      metasPit,
      onSubmit: async ({ payload }) => {
        await updateProdutoPedido({ ...payload, id: row.id, pedido_id: pedidoId });
        showSuccess('Item atualizado com sucesso');
        load();
      },
    });
  }

  async function excluirItem(row) {
    const confirmado = await confirmDialog({
      title: 'Excluir item',
      message: `Excluir o item "${row.produto_nome || '-'}" do pedido? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;

    try {
      await deleteProdutosPedido([row.id]);
      showSuccess('Item excluído com sucesso');
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o item');
    }
  }

  /**
   * Quanto cada PESSOA imprimiu deste item, somando as sessoes dela.
   *
   * A impressao e livro-caixa: cada sessao e uma linha nova, e a mesma pessoa
   * aparece varias vezes na lista. Sem esta soma, ler "quem imprimiu quanto"
   * exige somar de cabeca uma tabela paginada de 5 em 5.
   *
   * Ordena por copias, da maior para a menor, e empata pelo nome, para a ordem
   * nao dancar entre duas aberturas do mesmo historico.
   * @param {Array<{usuario_nome?:string, quantidade:number}>} registros
   * @returns {Array<{nome:string, copias:number, sessoes:number}>}
   */
  function resumoPorPessoa(registros) {
    const porNome = new Map();
    for (const r of registros || []) {
      const nome = r.usuario_nome || r.usuario_nome_guerra || 'sem usuário';
      const atual = porNome.get(nome) || { nome, copias: 0, sessoes: 0 };
      atual.copias += Number(r.quantidade) || 0;
      atual.sessoes += 1;
      porNome.set(nome, atual);
    }
    return [...porNome.values()].sort(
      (a, b) => b.copias - a.copias || a.nome.localeCompare(b.nome));
  }

  function textoResumoPorPessoa(pessoas) {
    return pessoas
      .map(p => `${p.nome} ${formatNumber(p.copias)} cópia(s)`
        + ` (${p.sessoes} ${p.sessoes === 1 ? 'sessão' : 'sessões'})`)
      .join(', ');
  }

  /**
   * Histórico de impressão de UM item, em modal.
   *
   * O modal também monta uma vez e se repinta. Excluir uma sessão recalcula as
   * quantidades e antes disso jogava fora a tabela inteira: quem estava lendo a
   * terceira página do histórico de um item muito impresso voltava para a
   * primeira, a cada exclusão.
   */
  async function verHistoricoImpressao(row) {
    let historico;
    try {
      historico = await getImpressaoItem(row.id);
    } catch (err) {
      showError(err.message || 'Erro ao carregar o histórico de impressão');
      return;
    }

    let mutated = false;

    /**
     * Corrige a DATA de uma sessão de impressão já gravada.
     *
     * A INTERAÇÃO QUE FALTAVA. PUT /mapoteca/impressao/:id/data existe no
     * servidor e nenhuma tela a chamava. Sem ela, a sessão lançada no dia errado
     * só se conserta excluindo e lançando de novo, e a exclusão apaga quem
     * imprimiu e a observação junto.
     *
     * A QUANTIDADE não entra aqui: a impressão é livro-caixa, e o servidor só
     * aceita POST e DELETE dela. Este diálogo corrige QUANDO, e nada mais.
     *
     * O `motivo` é obrigatório no servidor (mínimo 3 caracteres) e vai para a
     * auditoria: mudar o mês de um gasto muda o número que o RPCMTec reporta.
     */
    function corrigirData(registro) {
      const hoje = toIsoDate(new Date()) || '';
      const dataField = createDateField({
        label: 'Data da impressão',
        value: toIsoDate(registro.data_impressao) || '',
        max: hoje,
        required: true,
      });
      const motivoField = createTextField({
        label: 'Motivo da correção',
        required: true,
        maxLength: 500,
        placeholder: 'Ex.: lançado na segunda, mas a impressão saiu na sexta',
        helpText: 'Fica no histórico do pedido, junto com quem corrigiu.',
      });

      let salvando = false;
      openModal({
        title: 'Corrigir a data da impressão',
        content: el('div', { className: 'form-grid' }, [
          dataField.element,
          el('div', { className: 'form-grid__full' }, [motivoField.element]),
          el('div', {
            className: 'form-grid__full form-field__help',
            textContent: `Sessão de ${formatNumber(registro.quantidade)} cópia(s),`
              + ` registrada por ${registro.usuario_nome || 'usuário desconhecido'}.`
              + ' A quantidade não muda aqui.',
          }),
        ]),
        width: '520px',
        actions: [
          { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
          {
            label: 'Salvar',
            variant: 'primary',
            onClick: async ({ close }) => {
              if (salvando) return;
              dataField.setError(null);
              motivoField.setError(null);

              const data = dataField.getValue();
              const motivo = motivoField.getValue();
              let valido = true;
              if (!data) {
                dataField.setError('Informe a data da impressão');
                valido = false;
              } else if (data > hoje) {
                dataField.setError('A data não pode ser futura');
                valido = false;
              }
              // O mesmo mínimo do servidor (Joi: min 3). Sem ele o 400 chegava
              // como toast, depois de a pessoa achar que tinha gravado.
              if (motivo.length < 3) {
                motivoField.setError('Escreva o motivo, com pelo menos 3 letras');
                valido = false;
              }
              if (!valido) return;

              salvando = true;
              try {
                await corrigirDataImpressao(registro.id, { data_impressao: data, motivo });
                showSuccess('Data da impressão corrigida');
                mutated = true;
                close();
                pintarHistorico(await getImpressaoItem(row.id));
              } catch (err) {
                // O formulário FICA ABERTO com o que a pessoa escreveu: fechar
                // no erro faria digitar o motivo de novo.
                salvando = false;
                showError(err.message || 'Erro ao corrigir a data da impressão');
              }
            },
          },
        ],
      });
    }

    async function excluirRegistro(registro) {
      const confirmado = await confirmDialog({
        title: 'Excluir registro de impressão',
        message: `Excluir o registro de ${formatNumber(registro.quantidade)} cópia(s) de ${formatDateTime(registro.data_impressao)}? As quantidades impressas do item serão recalculadas.`,
        confirmLabel: 'Excluir',
        danger: true,
      });
      if (!confirmado) return;

      try {
        await deleteImpressoes([registro.id]);
        showSuccess('Registro de impressão excluído com sucesso');
        mutated = true;
        pintarHistorico(await getImpressaoItem(row.id));
      } catch (err) {
        showError(err.message || 'Erro ao excluir o registro de impressão');
      }
    }

    const resumo = {
      pedida: criarInfoRow('Quantidade pedida'),
      impressa: criarInfoRow('Quantidade impressa'),
      restante: criarInfoRow('Restante'),
      situacao: criarInfoRow('Situação'),
    };
    const chipSituacaoItem = chip('', 'warning');
    resumo.situacao.definir(chipSituacaoItem);

    const cardResumo = el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
      el('div', { className: 'detail-card__title', textContent: 'Resumo' }),
      resumo.pedida.element,
      resumo.impressa.element,
      resumo.restante.element,
      resumo.situacao.element,
    ]);

    // Quem imprimiu quanto, ANTES da lista. E o que o chefe pediu para
    // enxergar: uma pessoa imprimiu 40 e outra imprimiu 10.
    const pessoasTexto = el('div', { className: 'detail-card__value' });
    const pessoasTotal = el('div', { className: 'detail-card__label' });
    const cardPessoas = el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
      el('div', { className: 'detail-card__title', textContent: 'Quem imprimiu' }),
      pessoasTexto,
      pessoasTotal,
    ]);
    // O bloco some no item sem sessao nenhuma, e some SAINDO do DOM.
    const blocoPessoas = el('div');

    const registrosTable = createDataTable({
      columns: [
        {
          key: 'data_impressao',
          label: 'Data',
          sortable: true,
          render: (registro) => formatDateTime(registro.data_impressao),
        },
        { key: 'usuario_nome', label: 'Usuário' },
        {
          key: 'quantidade',
          label: 'Cópias',
          sortable: true,
          render: (registro) => formatNumber(registro.quantidade),
        },
        { key: 'observacao', label: 'Observação' },
      ],
      rows: [],
      pageSize: 5,
      emptyMessage: 'Nenhuma sessão de impressão registrada',
      // DELETE /impressao e PUT /impressao/:id/data sao gerente, embora
      // REGISTRAR impressao seja operador: o operador lanca o que imprimiu e nao
      // desfaz nem remarca o historico.
      actions: pode.gerente ? [
        {
          icon: ICONS.schedule,
          title: 'Corrigir a data',
          onClick: (registro) => corrigirData(registro),
        },
        {
          icon: ICONS.delete,
          title: 'Excluir registro',
          variant: 'danger',
          onClick: (registro) => excluirRegistro(registro),
        },
      ] : [],
    });

    const content = el('div', {}, [cardResumo, blocoPessoas, registrosTable.element]);

    function pintarHistorico(dados) {
      resumo.pedida.definir(formatNumber(dados.quantidade));
      resumo.impressa.definir(formatNumber(dados.quantidade_impressa));
      resumo.restante.definir(formatNumber(dados.quantidade_restante));
      repintarChip(chipSituacaoItem, dados.impressao_concluida
        ? chip('Concluída', 'success')
        : chip('Pendente', 'warning'));

      const pessoas = resumoPorPessoa(dados.registros);
      if (pessoas.length) {
        pessoasTexto.textContent = textoResumoPorPessoa(pessoas);
        pessoasTotal.textContent = `Total ${formatNumber(dados.quantidade_impressa)}`
          + ` de ${formatNumber(dados.quantidade)}`;
      }
      mostrar(blocoPessoas, pessoas.length ? [cardPessoas] : []);

      registrosTable.update({ rows: dados.registros || [] });
    }

    pintarHistorico(historico);

    openModal({
      title: `Histórico de impressão — ${row.produto_nome || 'Item'}`,
      content,
      width: '720px',
      actions: [{ label: 'Fechar', variant: 'secondary', onClick: ({ close }) => close() }],
      onClose: () => {
        registrosTable._cleanup();
        if (mutated) load();
      },
    });
  }

  // ---------------------------------------------------------------------------
  // Anexos do pedido (documento de solicitação + arquivos, guardados no banco)
  // ---------------------------------------------------------------------------
  function adicionarAnexo(onDone) {
    const fileInput = el('input', { type: 'file', className: 'form-field__input' });
    const tipoSelect = el('select', { className: 'form-field__input' },
      TIPOS_ANEXO.map((t) => el('option', { value: String(t.code), textContent: t.nome })));
    tipoSelect.value = '1';
    const descInput = el('input', { type: 'text', className: 'form-field__input', maxLength: '1000' });

    const content = el('div', { className: 'form-grid' }, [
      el('div', { className: 'form-field' }, [
        el('label', { className: 'form-field__label', textContent: 'Arquivo' }),
        fileInput,
      ]),
      el('div', { className: 'form-field' }, [
        el('label', { className: 'form-field__label', textContent: 'Tipo do anexo' }),
        tipoSelect,
      ]),
      el('div', { className: 'form-field' }, [
        el('label', { className: 'form-field__label', textContent: 'Descrição (opcional)' }),
        descInput,
      ]),
    ]);

    let submitting = false;
    openModal({
      title: 'Anexar documento',
      content,
      width: '520px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Anexar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (submitting) return;
            const file = fileInput.files && fileInput.files[0];
            if (!file) { showError('Selecione um arquivo'); return; }
            submitting = true;
            try {
              await uploadAnexoPedido(pedidoId, file, {
                tipo_anexo_id: Number(tipoSelect.value),
                descricao: descInput.value.trim() || undefined,
              });
              showSuccess('Anexo cadastrado com sucesso');
              close();
              onDone();
            } catch (err) {
              submitting = false;
              showError(err.message || 'Erro ao anexar o arquivo');
            }
          },
        },
      ],
    });
  }

  async function excluirAnexo(anexo, onDone) {
    const confirmado = await confirmDialog({
      title: 'Excluir anexo',
      message: `Excluir o anexo "${anexo.nome_original}"? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!confirmado) return;
    try {
      await deleteAnexoPedido(anexo.id);
      showSuccess('Anexo excluído com sucesso');
      onDone();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o anexo');
    }
  }

  // ---------------------------------------------------------------------------
  // O esqueleto da tela. Monta UMA vez, antes da primeira carga.
  // ---------------------------------------------------------------------------

  // Aviso de carga e de erro. Fica fora do conteudo: no erro o conteudo sai do
  // DOM inteiro, e a mensagem tem de sobreviver a isso.
  const avisoTexto = el('div', { className: 'data-table__empty' });
  const avisoVoltar = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => { location.hash = '/mapoteca/pedidos'; },
  }, [svgIcon(ICONS.arrowBack, 16), 'Voltar para pedidos']);
  const avisoEl = el('div');

  function avisar(texto, comVoltar = false) {
    if (!texto) {
      mostrar(avisoEl, []);
      return;
    }
    avisoTexto.textContent = texto;
    mostrar(avisoEl, comVoltar ? [avisoTexto, avisoVoltar] : [avisoTexto]);
  }

  // --- Cabeçalho -------------------------------------------------------------
  const tituloEl = el('h1', { className: 'page__title' });
  const chipSituacao = chip('', 'default');
  const chipLocalizador = chip('', 'secondary');

  // PUT e DELETE /pedido sao gerente. A etiqueta NAO: ela nao escreve nada,
  // e quem embala o pacote e quem precisa imprimi-la.
  const headerEl = el('div', { className: 'page__header' }, [
    el('div', {}, [
      el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        onClick: () => { location.hash = '/mapoteca/pedidos'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Pedidos']),
      el('div', { className: 'flex gap-sm' }, [tituloEl, chipSituacao, chipLocalizador]),
    ]),
    el('div', { className: 'page__actions' }, [
      el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => openEtiquetaEnvioDialog(pedidoAtual),
      }, [svgIcon(ICONS.print, 16), 'Etiqueta de envio']),
      ...(pode.gerente ? [
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => editarPedido(pedidoAtual),
        }, [svgIcon(ICONS.edit, 16), 'Editar']),
        el('button', {
          className: 'btn btn--danger',
          type: 'button',
          onClick: () => excluirPedido(pedidoAtual),
        }, [svgIcon(ICONS.delete, 16), 'Excluir']),
      ] : []),
    ]),
  ]);

  // --- Cards de detalhe ------------------------------------------------------
  // As linhas vivem neste mapa e sao escritas por `pintarPedido`. A chave e
  // curta de proposito: o rotulo muda de texto sem que o codigo pare de compilar,
  // e uma chave errada aparece na hora.
  const L = {};
  const linha = (chave, rotulo) => {
    L[chave] = criarInfoRow(rotulo);
    return L[chave].element;
  };

  // O link do cliente nasce aqui e so troca de `href` e de texto. Recria-lo
  // apagaria o alvo do clique no meio de quem estava mirando nele.
  const clienteLink = el('a', {});

  /**
   * Card de detalhe cujas linhas ENTRAM E SAEM conforme o valor do campo.
   *
   * Com linhas fixas, a que nao tem valor escreve um traco. A maioria das
   * posicoes opcionais e vazia, e o traco nao informa nada: ele so empurra para
   * baixo o que informa. E o mesmo
   * defeito que a docstring de `criarInfoRow` ja registrava dentro da linha:
   * ele parava na fronteira do card.
   *
   * A linha SAI DO DOM, e nao se esconde por CSS, pelo motivo dos blocos
   * condicionais desta tela: escondida, ela continuaria no texto da pagina.
   *
   * Vazio nao quer dizer "sem informacao", e por isso a linha some e NADA se
   * escreve no lugar dela: texto de ausencia inventaria significado campo a
   * campo. O ENDERECO DE ENTREGA e a excecao, e ela e do lado de quem PINTA, e
   * nao daqui: ele nunca chega vazio a esta linha, porque o campo nulo tem
   * significado conhecido ("usa o do cadastro do cliente") e quem pinta cai no
   * endereco do cliente com a marca de onde ele veio.
   *
   * O card recebe linhas soltas e SUBSECOES (ver `subsecao`), na ordem em que
   * aparecem. Linha solta vem antes da primeira subsecao: depois dela, o olho
   * le a linha como sendo do titulo de cima.
   *
   * @param {string} titulo
   * @param {Array<Array<string>|{titulo:string, campos:Array<Array<string>>}>} itens
   *   - par [chave, rotulo] para linha solta, ou o retorno de `subsecao`
   * @returns {HTMLElement}
   */
  const cardsDeLinhas = [];
  function criarCard(titulo, itens) {
    const corpo = el('div');
    // Um grupo por subsecao, mais o grupo sem titulo das linhas soltas.
    const grupos = [{ tituloEl: null, chaves: [] }];
    for (const item of itens) {
      if (Array.isArray(item)) {
        const [chave, rotulo] = item;
        linha(chave, rotulo);
        grupos[grupos.length - 1].chaves.push(chave);
        continue;
      }
      const grupo = {
        tituloEl: el('div', {
          className: 'detail-card__title',
          style: { marginTop: 'var(--space-md)' },
          textContent: item.titulo,
        }),
        chaves: [],
      };
      for (const [chave, rotulo] of item.campos) { linha(chave, rotulo); grupo.chaves.push(chave); }
      grupos.push(grupo);
    }
    cardsDeLinhas.push({ corpo, grupos });
    return el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: titulo }),
      corpo,
    ]);
  }

  /**
   * Subsecao de um card: um titulo e as linhas embaixo dele.
   *
   * O TITULO E ESTRUTURA, e nao dado. Ele fica na tela mesmo com todas as
   * linhas vazias, pela mesma regra do titulo do card ("o card fica; a LINHA
   * vazia dele some"). E o titulo que diz de QUEM e o telefone logo abaixo, e
   * confundir o contato do pedido com o da OM faz alguem ligar para a pessoa
   * errada.
   *
   * O chefe pediu que a subsecao vazia sumisse com titulo e tudo,
   * para nao gastar linha a toa. NAO FOI FEITO, e a razao esta na regra que o
   * teste desta tela fixa: o pedido do teste nao tem contato nenhum, nem o
   * proprio nem o da OM, e ainda assim exige os dois titulos na tela
   * (details.test.js:142). As duas regras nao valem juntas. Fica a do teste,
   * que e a que protege o telefone certo; a decisao entre as duas e do chefe.
   * @param {string} titulo
   * @param {Array<Array<string>>} campos - pares [chave, rotulo], na ordem
   */
  const subsecao = (titulo, campos) => ({ titulo, campos });

  /** Poe na tela so as linhas com valor, sob os titulos fixos das subsecoes. */
  function mostrarLinhasComValor() {
    for (const card of cardsDeLinhas) {
      const nos = [];
      for (const grupo of card.grupos) {
        if (grupo.tituloEl) nos.push(grupo.tituloEl);
        for (const chave of grupo.chaves) {
          if (L[chave].temValor()) nos.push(L[chave].element);
        }
      }
      mostrar(card.corpo, nos);
    }
  }

  // Quatro cards, SEMPRE visiveis. Antes havia um card "Resumo" fixo mais um
  // bloco "Detalhes do pedido" colapsado, e os dois repetiam cliente, DIEx,
  // NUP, data e prazo. Cada dado aparece UMA vez, e nada fica escondido atras
  // de um clique. O card fica; a LINHA vazia dele some.
  const cardsEl = el('div', { className: 'detail-cards', style: { marginBottom: 'var(--space-md)' } }, [
    criarCard('Pedido', [
      ['dataPedido', 'Data do pedido'],
      ['prazo', 'Prazo'],
      ['itens', 'Itens'],
      // Quando o REGISTRO nasceu e quando mudou pela ultima vez. Nao e a data
      // do pedido acima, que e a data do DIEx: o pedido de marco cadastrado em
      // agosto so aparece com as duas datas lado a lado. O "alterado em" tambem
      // e o que mostra qual pedido em aberto esta parado.
      //
      // SO A DATA, sem o autor. A carga inicial gravou um unico login em quase
      // todos os pedidos, entao "quem" hoje e ruido, e nao dado. Nao e
      // esquecimento: `usuario_criacao_nome` e `usuario_atualizacao_nome`
      // chegam na resposta e ficam de fora de proposito. Quando os pedidos
      // cadastrados a mao forem a maioria, a linha do autor entra aqui.
      ['cadastro', 'Cadastrado no sistema'],
      ['atualizacao', 'Alterado no sistema'],
      ['observacao', 'Observação'],
    ]),
    criarCard('Cliente e contato', [
      ['clienteNome', 'Nome'],
      ['tipoCliente', 'Tipo'],
      ['enderecoEntrega', 'Endereço de entrega'],
      // DOIS contatos, de proposito, e cada um debaixo do proprio titulo. O do
      // pedido costuma vir no DIEx e vale so para ele; o da OM e o geral, usado
      // quando o pedido nao traz um. Com a linha vazia saindo do DOM, o TITULO
      // e quem separa os dois: o rotulo da linha sozinho nao daria conta.
      subsecao('Contato do pedido', [
        ['contatoPedido', 'Ponto de contato'],
      ]),
      subsecao('Contato geral da OM', [
        ['contatoOm', 'Ponto de contato geral'],
      ]),
    ]),
    criarCard('Documento', [
      ['documento', 'DIEx/Ofício'],
      ['nup', 'NUP'],
      ['palavrasChave', 'Palavras-chave'],
      ['demandante', 'Demandante'],
      // Sem a linha "OM responsável": `pedido.omds` saiu do banco em
      // 2026-08-08. Ela tinha 124 linhas preenchidas e UM valor distinto em
      // todas ('1º CGEO'), ou seja, a ficha gastava uma linha para repetir o
      // nome da própria unidade.
      ['previstoPit', 'Previsto no PIT'],
      ['metaPit', 'Meta do PIT'],
    ]),
    // A forma e a data de entrega deixaram de ser do ITEM e passaram a ser do
    // PEDIDO: o pedido inteiro sai numa remessa
    // so. Por isso as duas colunas sairam da tabela de itens e viram estas
    // duas linhas.
    //
    // A DATA fica AQUI e nao no card "Pedido", onde antes aparecia. O mesmo
    // dado em dois cards vira duvida sobre serem dados diferentes. Este card
    // responde "como e quando o material saiu"; o card "Pedido" ficou com as
    // datas da DEMANDA (pedido e prazo) e com as do registro. O rotulo nao
    // mudou, para o campo continuar sendo o mesmo aos olhos de quem usa a tela.
    //
    // "Atendimento" e a data que a consulta publica mostra ao cliente, com o
    // rotulo dele: o pedido fecha no dia em que o material sai.
    criarCard('Entrega', [
      ['formaEntrega', 'Forma de entrega'],
      ['atendimento', 'Atendimento (envio/entrega)'],
      ['localizadorEnvio', 'Localizador de envio'],
      ['observacaoEnvio', 'Observação de envio'],
      ['operacao', 'Operação'],
    ]),
  ]);
  L.clienteNome.definir(clienteLink);

  // --- Blocos que aparecem só às vezes ---------------------------------------
  // Os tres entram e saem conforme o pedido, e por isso vivem num container so,
  // reconciliado por chave: o que continua na tela mantem o no, o que saiu e
  // removido, e a ordem entre eles nao depende de quem apareceu primeiro.
  const blocosEl = el('div');

  const cardCivil = el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
    el('div', { className: 'detail-card__title', textContent: 'Pedido de civil' }),
    linha('canal', 'Canal'),
    linha('municipio', 'Município/Área'),
    linha('qtdImagens', 'Nº de imagens'),
  ]);

  // Observação interna. Fica FORA dos quatro cards, em bloco próprio e com o
  // aviso na frente, porque a diferença entre ela e as outras duas observações
  // não é de assunto, é de quem lê: a observação e a observação de envio saem na
  // consulta pública do cliente, esta não sai.
  const textoObsInterna = el('div', { className: 'detail-card__value' });
  const cardObsInterna = el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
    el('div', { className: 'detail-card__title flex gap-sm' }, [
      el('span', { textContent: 'Observação interna' }),
      chip('não aparece na consulta do cliente', 'secondary'),
    ]),
    textoObsInterna,
  ]);

  const textoCancelamento = el('div', { className: 'detail-card__value' });
  const cardCancelamento = el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
    el('div', { className: 'detail-card__title', textContent: 'Motivo do cancelamento' }),
    textoCancelamento,
  ]);

  // --- Produtos do pedido ----------------------------------------------------
  // --- Impressao em LOTE -----------------------------------------------------
  //
  // O caso que justifica: 43 dos 132 pedidos com item tem MAIS DE 20 itens, a
  // mediana e 10 e o maior tem 132 (medido na producao em 2026-08-13). Um a um,
  // preencher a impressao de um pedido desses e uma abertura de dialogo por
  // item.
  //
  // NAO E ROTA NOVA. `POST /mapoteca/impressao` sempre recebeu `registros: [...]`
  // e grava as N linhas numa transacao -- era o que o plugin QGIS ja usava, e a
  // web era o unico client que mandava um array de um.
  //
  // A SELECAO SOBREVIVE a paginacao, a busca e a ordenacao, porque o data-table
  // guarda CHAVES num Set e nao as linhas visiveis. E por isso que dava para
  // acumular entre paginas mesmo antes do `selecionarTodos`.
  const registrarSelecionados = () => {
    const selecionados = produtosTable.getSelected();
    if (!selecionados.length) return;
    openRegistrarImpressaoDialog(selecionados, () => {
      produtosTable.clearSelection();
      load();
    });
  };

  const registrarLoteBtn = el('button', {
    className: 'btn btn--primary btn--sm hidden',
    type: 'button',
    onClick: registrarSelecionados,
  }, [svgIcon(ICONS.print, 14), 'Registrar impressão']);

  // "Selecionar todos os N" existe porque a caixa do cabecalho marca a PAGINA,
  // e com pageSize 10 um pedido de 132 itens exigiria 14 viradas de pagina --
  // justamente o pedido que mais precisa do lote. Ele respeita a BUSCA: filtrar
  // por '25k' e mandar selecionar todos seleciona os 25k.
  const selecionarTodosBtn = el('button', {
    className: 'btn btn--text btn--sm hidden',
    type: 'button',
    onClick: () => produtosTable.selectAll(),
  }, ['Selecionar todos']);

  const produtosTable = createDataTable({
    columns: [
      {
        key: 'produto_nome',
        label: 'Produto',
        sortable: true,
        // O nome LEVA a ficha do produto no acervo. Quem le o pedido pergunta
        // "que carta e essa", e sem o link tem de sair da tela e buscar o nome a
        // mao. A rota #/acervo/busca?produto_id= e a mesma que a tela de
        // rastreabilidade usa para o agregado acervo:produto: a ficha do
        // produto abre em dialogo, de dentro da busca, e nao tem rota propria.
        //
        // Item AVULSO nao tem produto do acervo, e fica como texto: link que
        // nao leva a nada e pior do que texto.
        render: (row) => {
          const nome = row.produto_nome || '-';
          if (!row.produto_id) return nome;
          return el('a', {
            href: `#/acervo/busca?produto_id=${row.produto_id}`,
            textContent: nome,
            title: 'Abrir a ficha do produto no acervo',
          });
        },
      },
      { key: 'mi', label: 'MI', sortable: true },
      { key: 'inom', label: 'INOM' },
      { key: 'escala', label: 'Escala' },
      {
        key: 'data_edicao',
        label: 'Edição',
        sortable: true,
        render: (row) => {
          const data = row.data_edicao ? formatDate(row.data_edicao) : '-';
          return row.versao ? `${data} (${row.versao})` : data;
        },
      },
      {
        key: 'tipo_midia_nome',
        label: 'Mídia',
        // A META PRÓPRIA DO ITEM APARECE AQUI, junto da mídia, porque é a mídia
        // que a explica: a folha em tyvek dentro de um pedido de sulfite cumpre
        // outra meta. Sem mostrar, a exceção fica invisível na tela e só quem
        // abrisse o item saberia que aquelas folhas contam noutro lugar.
        //
        // Só o item que DECLAROU aparece marcado. O que herda a meta do pedido
        // fica limpo, senão a marca estaria em toda linha e não diria nada.
        render: (row) => (row.meta_pit_codigo
          ? el('span', {}, [
            el('span', { textContent: row.tipo_midia_nome || '-' }),
            chip(`PIT ${row.meta_pit_codigo}`, 'info'),
          ])
          : (row.tipo_midia_nome || '-')),
      },
      {
        key: 'quantidade',
        label: 'Qtd.',
        sortable: true,
        render: (row) => formatNumber(row.quantidade),
      },
      // SEM a coluna "Qtd. fornecida": `produto_pedido.quantidade_fornecida`
      // saiu do banco em 2026-08-08, medida IGUAL a `quantidade` em 1759 de
      // 1759 linhas preenchidas, sem uma divergencia em nove meses. A coluna
      // ao lado ("Impressão") e quem responde o que de fato saiu, e ela le
      // `mapoteca.impressao_item`, com data e autor de cada sessao.
      //
      // A GEMEA `tipo_midia_fornecida_id` FICOU, e continua chegando no item.
      // As duas tinham o mesmo sufixo e o mesmo formulario, e destinos opostos:
      // a midia mediu 25 divergencias REAIS (folha pedida em tyvek e atendida
      // em sulfite), e e o unico registro delas. Quem for podar a proxima coluna
      // "fornecida" mede antes; o sufixo nao e argumento.
      {
        key: 'impressao_concluida',
        label: 'Impressão',
        render: (row) => el('span', { className: 'flex gap-sm' }, [
          el('span', {
            textContent: `${row.quantidade_impressa}/${row.quantidade} (restante ${row.quantidade_restante})`,
          }),
          row.impressao_concluida ? chip('Concluída', 'success') : chip('Pendente', 'warning'),
        ]),
      },
    ],
    rows: [],
    // Carrega antes de existir dado: sem isto a tabela piscaria "Nenhum produto
    // neste pedido" no caminho entre montar e a primeira resposta.
    loading: true,
    searchable: true,
    pageSize: 10,
    emptyMessage: 'Nenhum produto neste pedido',
    // MESMO GATE do botao de registrar impressao da linha, e pelo mesmo motivo:
    // ele espelha o verifyPerfil('operador') da rota. Sem escrita a coluna de
    // selecao nao serviria para nada, entao quem so consulta nao a ve.
    selectable: pode.operador,
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
        icon: ICONS.schedule,
        title: 'Histórico de impressão',
        onClick: (row) => verHistoricoImpressao(row),
      },
      // OPERADOR, e nao gerente: POST /mapoteca/impressao e operador no
      // servidor, e o gate da tela le igual ao gate real. Na pratica quem
      // chega a esta tela e o gerente (ela nao esta nas rotas de operador),
      // mas quem so CONSULTA nao ve o botao, que e o ponto.
      //
      // Antes so a fila de atendimento registrava impressao, e quem abria o
      // pedido pelo detalhe trocava de tela para lancar o que acabou de sair.
      ...(pode.operador ? [
        {
          icon: ICONS.print,
          title: 'Registrar impressão',
          onClick: (row) => openRegistrarImpressaoDialog(row, () => load()),
        },
      ] : []),
      ...(pode.gerente ? [
        {
          icon: ICONS.edit,
          title: 'Editar item',
          onClick: (row) => editarItem(row),
        },
        {
          icon: ICONS.delete,
          title: 'Excluir item',
          variant: 'danger',
          onClick: (row) => excluirItem(row),
        },
      ] : []),
    ],
  });
  cleanups.push(() => produtosTable._cleanup());

  const chipImpressao = chip('', 'warning');
  const textoImpressao = el('span', { className: 'detail-card__label' });
  const resumoImpressao = el('div', { className: 'flex gap-sm' }, [chipImpressao, textoImpressao]);

  const produtosSection = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Produtos do pedido' }),
      // O resumo de impressao e leitura e fica para todos; POST
      // /produto_pedido e gerente.
      el('div', { className: 'dashboard-section__controls' }, [
        resumoImpressao,
        // Os dois de LOTE nascem escondidos: o "selecionar todos" aparece quando
        // ha mais itens do que cabe numa pagina, e o "registrar" quando ha
        // selecao. Ver o bloco "Impressao em LOTE" acima.
        selecionarTodosBtn,
        registrarLoteBtn,
        ...(pode.gerente ? [
          el('button', {
            className: 'btn btn--primary btn--sm',
            type: 'button',
            onClick: adicionarItem,
          }, [svgIcon(ICONS.add, 14), 'Adicionar item']),
        ] : []),
      ]),
    ]),
    produtosTable.element,
  ]);

  // --- Anexos do pedido ------------------------------------------------------
  const anexosTable = createDataTable({
    columns: [
      { key: 'nome_original', label: 'Arquivo', sortable: true },
      { key: 'tipo_anexo_nome', label: 'Tipo' },
      { key: 'descricao', label: 'Descrição', render: (r) => r.descricao || '-' },
      { key: 'tamanho_bytes', label: 'Tamanho', render: (r) => formatBytes(r.tamanho_bytes) },
      {
        key: 'data_cadastramento',
        label: 'Cadastrado em',
        sortable: true,
        render: (r) => formatDateTime(r.data_cadastramento),
      },
      { key: 'usuario_cadastramento_nome', label: 'Por', render: (r) => r.usuario_cadastramento_nome || '-' },
    ],
    rows: [],
    loading: true,
    pageSize: 5,
    emptyMessage: 'Nenhum anexo neste pedido',
    actions: [
      // Baixar anexo e consulta: quem le o pedido le os documentos dele.
      {
        icon: ICONS.download,
        title: 'Baixar',
        onClick: (r) => downloadAnexoPedido(r.id, r.nome_original)
          .catch((err) => showError(err.message || 'Erro ao baixar o anexo')),
      },
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir anexo',
        variant: 'danger',
        onClick: (r) => excluirAnexo(r, loadAnexos),
      }] : []),
    ],
  });
  cleanups.push(() => anexosTable._cleanup());

  const anexosMensagem = el('div', { className: 'data-table__empty' });
  const anexosBody = el('div');
  mostrar(anexosBody, [anexosTable.element]);

  const anexosSection = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Anexos do pedido' }),
      // POST /pedido/:id/anexos e gerente.
      el('div', { className: 'dashboard-section__controls' }, pode.gerente ? [
        el('button', {
          className: 'btn btn--primary btn--sm',
          type: 'button',
          onClick: () => adicionarAnexo(loadAnexos),
        }, [svgIcon(ICONS.add, 14), 'Anexar documento']),
      ] : []),
    ]),
    anexosBody,
  ]);

  async function loadAnexos() {
    anexosTable.update({ loading: true });
    let anexos;
    try {
      anexos = await getAnexosPedido(pedidoId);
    } catch (err) {
      if (disposed) return;
      // O erro TROCA a tabela pela mensagem: a lista da carga anterior embaixo
      // de um erro se le como a lista deste pedido.
      anexosMensagem.textContent = err.message || 'Erro ao carregar anexos';
      mostrar(anexosBody, [anexosMensagem]);
      return;
    }
    if (disposed) return;
    anexosTable.update({ rows: anexos || [], loading: false });
    mostrar(anexosBody, [anexosTable.element]);
  }

  // --- Histórico do pedido ---------------------------------------------------
  /**
   * A seção de histórico é o componente compartilhado `components/historico/`, e
   * não código daqui.
   *
   * O QUE NÃO SE FAZ AQUI: cinco colunas montadas à mão, sendo a última um
   * `campos_alterados.join(', ')`: a tela mostrava o NOME DA COLUNA DO BANCO
   * ("situacao_pedido_id, prazo") e mais nada. Quem lia sabia que algo mudou,
   * sem saber DE QUÊ PARA QUÊ, enquanto `dados_antes` e `dados_depois` chegavam
   * na resposta e eram jogados fora. Havia até um mapa `NOME_TABELA` aqui,
   * porque alguém já tinha percebido que nome de coluna não é português; o mesmo
   * raciocínio nunca chegou aos CAMPOS.
   *
   * O QUE MUDOU. O servidor manda o diff pronto (`mudancas`, com rótulo em
   * português e os dois valores em texto) e o componente o mostra na linha:
   * "Situação: Em produção → Concluído", sem clique. O `NOME_TABELA` morreu
   * junto: o `resumo` de cada evento vem do servidor, que conhece as ~60 tabelas
   * auditadas, e não de um mapa de quatro chaves que só valia para o pedido.
   *
   * Duas regras desta tela sobreviveram e agora valem para as seis fichas que
   * usam o componente: erro no histórico não derruba o resto da ficha, e pedido
   * apagado ainda mostra histórico (a rota não exige que o registro exista).
   *
   * A SEÇÃO NASCE UMA VEZ, e o `load()` chama `recarregar()`. Recriá-la a cada
   * carga era o que trocava a seção inteira depois de cada gravação.
   */
  const historico = criarHistorico({
    modulo: 'mapoteca',
    entidade: 'pedido',
    id: pedidoId,
    titulo: 'Histórico do pedido',
    subtitulo: 'Quem alterou o pedido, os itens, as impressões e a etiqueta',
  });
  cleanups.push(() => historico.cleanup());

  const conteudoEl = el('div', {}, [
    headerEl,
    cardsEl,
    blocosEl,
    produtosSection,
    anexosSection,
  ]);

  /**
   * O conteúdo entra e sai do `root` inteiro.
   *
   * Sem pedido (primeira carga, erro) ele SAI, e não fica escondido: os cards da
   * carga anterior continuariam contando como texto da página, e quem chega por
   * link de pedido apagado leria os dados de outro pedido embaixo do erro. Sair
   * do DOM não desmonta nada: as tabelas voltam com a busca e a página onde
   * estavam.
   */
  function montarRoot(comConteudo) {
    // O histórico é o último: é o que se consulta depois de olhar o dado, e não
    // o que se lê primeiro. Ele fica mesmo sem pedido, porque o rastro sobrevive
    // à exclusão (ver o comentário do bloco do histórico).
    mostrar(root, comConteudo
      ? [avisoEl, conteudoEl, historico.element]
      : [avisoEl, historico.element]);
  }

  // ---------------------------------------------------------------------------
  // Pintura
  // ---------------------------------------------------------------------------
  function pintarPedido(pedido) {
    tituloEl.textContent = `Pedido #${pedido.id}`;
    repintarChip(chipSituacao,
      chipSituacaoPedido(pedido.situacao_pedido_id, pedido.situacao_pedido_nome));
    repintarChip(chipLocalizador, chip(pedido.localizador_pedido || '-', 'secondary'));

    const nItens = (pedido.produtos || []).length;
    const nExemplares = (pedido.produtos || []).reduce(
      (soma, r) => soma + (Number(r.quantidade) || 0), 0);

    L.dataPedido.definir(formatDate(pedido.data_pedido));
    L.prazo.definir(dataOuNada(pedido.prazo));
    L.itens.definir(`${nItens} carta(s) · ${nExemplares} exemplar(es)`);
    L.cadastro.definir(dataHoraOuNada(pedido.data_criacao));
    L.atualizacao.definir(dataHoraOuNada(pedido.data_atualizacao));
    L.observacao.definir(pedido.observacao);

    clienteLink.href = `#/mapoteca/clientes/${pedido.cliente_id}`;
    clienteLink.textContent = pedido.cliente_nome || '-';
    L.tipoCliente.definir(pedido.tipo_cliente_nome);
    L.contatoPedido.definir(pedido.ponto_contato);
    L.contatoOm.definir(pedido.cliente_ponto_contato);
    // O ENDERECO EM BRANCO NAO E FALTA DE DADO, e por isso a linha nao some
    // como as outras vazias: `pedido.endereco_entrega` nulo quer dizer "usa o
    // do cadastro do cliente", e e exatamente isso que o servidor faz
    // (`COALESCE(p.endereco_entrega, c.endereco_entrega_principal)`) e o que a
    // etiqueta de envio imprime. A ficha mostra o endereco que VAI VALER e diz
    // de onde ele veio; sem a marca, os dois casos ficariam iguais na tela e
    // ninguem saberia se aquele endereco e deste pedido ou do cadastro.
    L.enderecoEntrega.definir(pedido.endereco_entrega
      || (pedido.cliente_endereco_entrega
        ? `${pedido.cliente_endereco_entrega} (do cadastro do cliente)`
        : null));

    L.documento.definir(pedido.documento_solicitacao);
    L.nup.definir(pedido.documento_solicitacao_nup);
    L.palavrasChave.definir((pedido.palavras_chave || []).join(', '));
    L.demandante.definir(pedido.demandante);
    L.previstoPit.definir(formatBoolean(pedido.previsto_pit));
    L.metaPit.definir(pedido.meta_pit_codigo);

    L.formaEntrega.definir(pedido.forma_entrega_nome);
    L.atendimento.definir(dataOuNada(pedido.data_atendimento));
    L.localizadorEnvio.definir(pedido.localizador_envio);
    L.observacaoEnvio.definir(pedido.observacao_envio);
    L.operacao.definir(pedido.operacao);

    // Depois de TODOS os `definir` dos quatro cards: e aqui que a linha vazia
    // sai da tela e a que ganhou valor volta.
    mostrarLinhasComValor();

    // Pedido de civil (visível quando houver dado civil)
    const temCivil = Boolean(pedido.canal_recebimento_nome || pedido.municipio
      || pedido.qtd_imagens != null);
    if (temCivil) {
      L.canal.definir(pedido.canal_recebimento_nome);
      L.municipio.definir(pedido.municipio);
      L.qtdImagens.definir(pedido.qtd_imagens != null ? String(pedido.qtd_imagens) : '-');
    }
    if (pedido.observacao_interna) textoObsInterna.textContent = pedido.observacao_interna;
    if (pedido.motivo_cancelamento) textoCancelamento.textContent = pedido.motivo_cancelamento;

    mostrar(blocosEl, [
      temCivil ? cardCivil : null,
      pedido.observacao_interna ? cardObsInterna : null,
      pedido.motivo_cancelamento ? cardCancelamento : null,
    ].filter(Boolean));

    const impressao = pedido.impressao || {};
    repintarChip(chipImpressao, impressao.concluida
      ? chip('Impressão concluída', 'success')
      : chip('Impressão pendente', 'warning'));
    textoImpressao.textContent =
      `${impressao.itens_concluidos ?? 0}/${impressao.total_itens ?? 0} itens impressos`;

    const produtos = pedido.produtos || [];
    produtosTable.update({ rows: produtos, loading: false });

    // "Selecionar todos os N" so paga o espaco quando ha mais itens do que cabe
    // numa pagina: com 10 ou menos, a caixa do cabecalho ja marca a tabela
    // inteira e um segundo botao seria ruido. O numero vai no rotulo porque
    // "todos" sem quantidade nao diz o tamanho do que se vai registrar.
    const cabeNumaPagina = produtos.length <= 10;
    selecionarTodosBtn.classList.toggle('hidden', !pode.operador || cabeNumaPagina);
    selecionarTodosBtn.textContent = `Selecionar todos (${produtos.length})`;
  }

  async function load() {
    // A ROLAGEM MORRE NO QUE AINDA SE REMONTA. O histórico troca a tabela dele
    // por dentro a cada `recarregar()`, o documento encolhe e o navegador prende
    // a rolagem no topo.
    const recarga = montado;
    const rolagem = typeof window !== 'undefined' ? (window.scrollY || 0) : 0;

    // Carga SILENCIOSA na recarga: a tela não volta ao esqueleto nem ao
    // "Carregando pedido...". As tabelas ficam na frente de quem gravou e só
    // avisam que estão carregando (ver o `render` do data-table).
    if (!recarga) avisar('Carregando pedido...');
    produtosTable.update({ loading: true });

    let pedido;
    try {
      pedido = await getPedido(pedidoId);
    } catch (err) {
      if (disposed) return;
      pedidoAtual = null;
      montado = false;
      produtosTable.update({ rows: [], loading: false });
      montarRoot(false);
      showError(err.message || 'Erro ao carregar o pedido');
      avisar(err.message || 'Pedido não encontrado', true);

      // O pedido some, o histórico NÃO. Registrar quem removeu é metade do que o
      // sistema registra, e sem isto essa metade fica gravada e inalcançável:
      // `auditoria.evento` não tem chave estrangeira nenhuma,
      // justamente para sobreviver à exclusão, e a rota do histórico não exige
      // que o registro exista. Quem chega aqui por link antigo vê quem apagou e
      // quando.
      if (recarga) historico.recarregar();
      return;
    }
    if (disposed) return;

    avisar('');
    pedidoAtual = pedido;
    pintarPedido(pedido);
    montarRoot(true);
    montado = true;

    loadAnexos();
    // Na primeira carga o próprio `criarHistorico` já buscou. Daí em diante o
    // rastro precisa da gravação que acabou de acontecer.
    if (recarga) historico.recarregar();

    // A restauração vem DEPOIS do desenho: antes dele o documento ainda está
    // curto, e o navegador cortaria a posição pedida.
    if (recarga && rolagem > 0 && typeof window !== 'undefined'
        && typeof window.scrollTo === 'function') {
      window.scrollTo(0, rolagem);
    }
  }

  montarRoot(false);
  await load();

  return () => {
    disposed = true;
    disposeCleanups();
  };
}
