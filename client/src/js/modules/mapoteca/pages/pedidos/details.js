import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
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
  getClientes,
  getDominioSituacaoPedido,
  getDominioCanalRecebimento,
  getDominioFormaEntrega,
  getAnexosPedido,
  uploadAnexoPedido,
  downloadAnexoPedido,
  deleteAnexoPedido,
  getAuditoriaPedido,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { formatDate, formatDateTime, formatNumber } from '@utils/format.js';
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

// Acima deste tamanho, o valor nao cabe na mesma linha do rotulo dentro de um
// card de meia largura, e passa a ser empilhado.
const LIMITE_VALOR_CURTO = 45;

/**
 * Linha "rotulo ... valor" de um card de detalhe.
 *
 * Valor CURTO fica na mesma linha do rotulo, alinhado a direita. Valor LONGO
 * (observacao, endereco) empilha: rotulo em cima e texto a esquerda, porque
 * alinhado a direita um paragrafo fica com a margem esquerda irregular e a
 * leitura trava a cada quebra.
 *
 * A decisao e AUTOMATICA, pelo tamanho do texto, e nao marcada campo a campo.
 * Marcar a mao errava nos dois sentidos: o campo vazio ficava empilhado gastando
 * duas linhas para mostrar um traco, e o campo nao marcado com texto longo
 * seguia espremido. Medido na tela em 2026-07-27.
 * @param {string} label
 * @param {string|Node} value
 */
function infoRow(label, value) {
  const texto = value instanceof Node ? null : (value || '-');
  const longo = typeof texto === 'string' && texto.length > LIMITE_VALOR_CURTO;

  return el('div', {
    className: longo ? 'detail-card__row detail-card__row--longo' : 'detail-card__row',
  }, [
    el('span', { className: 'detail-card__label', textContent: label }),
    value instanceof Node
      ? el('span', { className: 'detail-card__value' }, [value])
      : el('span', { className: 'detail-card__value', textContent: texto }),
  ]);
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

/**
 * Pedido details page (#/pedidos/:id): header with chips and edit/delete,
 * 4 info cards, cancellation reason, items table with add/edit/delete and
 * printing history, plus the order printing summary.
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderPedidoDetails(container, { params }) {
  const pedidoId = Number(params.id);
  let disposed = false;
  const cleanups = [];

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

  async function load() {
    disposeCleanups();
    clearChildren(root);
    root.appendChild(el('div', { className: 'data-table__empty', textContent: 'Carregando pedido...' }));

    let pedido;
    try {
      pedido = await getPedido(pedidoId);
    } catch (err) {
      if (disposed) return;
      clearChildren(root);
      showError(err.message || 'Erro ao carregar o pedido');
      root.appendChild(el('div', { className: 'data-table__empty', textContent: err.message || 'Pedido não encontrado' }));
      root.appendChild(el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => { location.hash = '/mapoteca/pedidos'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar para pedidos']));
      return;
    }
    if (disposed) return;

    clearChildren(root);
    renderPedido(pedido);
  }

  // ---------------------------------------------------------------------------
  // Edit / delete pedido
  // ---------------------------------------------------------------------------
  async function editarPedido(pedido) {
    let clientes, situacoes, canais, formasEntrega;
    try {
      [clientes, situacoes, canais, formasEntrega] = await Promise.all([
        getClientes(), getDominioSituacaoPedido(), getDominioCanalRecebimento(),
        getDominioFormaEntrega(),
      ]);
    } catch (err) {
      showError(err.message || 'Erro ao carregar os dados do formulário');
      return;
    }

    const form = createPedidoFormFields({ pedido, clientes, situacoes, canais, formasEntrega });

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
  function adicionarItem() {
    openProdutoPedidoDialog({
      onSubmit: async ({ payload }) => {
        await createProdutoPedido({ ...payload, pedido_id: pedidoId });
        showSuccess('Item adicionado ao pedido');
        load();
      },
    });
  }

  function editarItem(row) {
    openProdutoPedidoDialog({
      item: row,
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

  async function verHistoricoImpressao(row) {
    let historico;
    try {
      historico = await getImpressaoItem(row.id);
    } catch (err) {
      showError(err.message || 'Erro ao carregar o histórico de impressão');
      return;
    }

    const content = el('div');
    let registrosTable = null;
    let mutated = false;

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
        renderHistorico(await getImpressaoItem(row.id));
      } catch (err) {
        showError(err.message || 'Erro ao excluir o registro de impressão');
      }
    }

    function renderHistorico(dados) {
      if (registrosTable) registrosTable._cleanup();

      registrosTable = createDataTable({
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
        rows: dados.registros || [],
        pageSize: 5,
        emptyMessage: 'Nenhuma sessão de impressão registrada',
        // DELETE /impressao e gerente, embora REGISTRAR impressao seja operador:
        // o operador lanca o que imprimiu e nao desfaz o historico.
        actions: pode.gerente ? [
          {
            icon: ICONS.delete,
            title: 'Excluir registro',
            variant: 'danger',
            onClick: (registro) => excluirRegistro(registro),
          },
        ] : [],
      });

      clearChildren(content);
      content.appendChild(el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
        el('div', { className: 'detail-card__title', textContent: 'Resumo' }),
        infoRow('Quantidade pedida', formatNumber(dados.quantidade)),
        infoRow('Quantidade impressa', formatNumber(dados.quantidade_impressa)),
        infoRow('Restante', formatNumber(dados.quantidade_restante)),
        infoRow('Situação', dados.impressao_concluida
          ? chip('Concluída', 'success')
          : chip('Pendente', 'warning')),
      ]));

      // Quem imprimiu quanto, ANTES da lista. E o que o chefe pediu para
      // enxergar (2026-07-30): uma pessoa imprimiu 40 e outra imprimiu 10.
      const pessoas = resumoPorPessoa(dados.registros);
      if (pessoas.length) {
        content.appendChild(el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
          el('div', { className: 'detail-card__title', textContent: 'Quem imprimiu' }),
          el('div', { className: 'detail-card__value', textContent: textoResumoPorPessoa(pessoas) }),
          el('div', {
            className: 'detail-card__label',
            textContent: `Total ${formatNumber(dados.quantidade_impressa)}`
              + ` de ${formatNumber(dados.quantidade)}`,
          }),
        ]));
      }

      content.appendChild(registrosTable.element);
    }

    renderHistorico(historico);

    openModal({
      title: `Histórico de impressão — ${row.produto_nome || 'Item'}`,
      content,
      width: '720px',
      actions: [{ label: 'Fechar', variant: 'secondary', onClick: ({ close }) => close() }],
      onClose: () => {
        if (registrosTable) registrosTable._cleanup();
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

  function renderAnexosSection() {
    const body = el('div', { className: 'data-table__empty', textContent: 'Carregando anexos...' });
    let anexosTable = null;

    async function loadAnexos() {
      let anexos;
      try {
        anexos = await getAnexosPedido(pedidoId);
      } catch (err) {
        if (disposed) return;
        clearChildren(body);
        body.className = 'data-table__empty';
        body.textContent = err.message || 'Erro ao carregar anexos';
        return;
      }
      if (disposed) return;
      if (anexosTable) anexosTable._cleanup();

      anexosTable = createDataTable({
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
        rows: anexos || [],
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

      clearChildren(body);
      body.className = '';
      body.appendChild(anexosTable.element);
    }

    const section = el('div', { className: 'dashboard-section' }, [
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
      body,
    ]);

    root.appendChild(section);
    loadAnexos();
  }

  // ---------------------------------------------------------------------------
  // Histórico do pedido (auditoria)
  // ---------------------------------------------------------------------------

  // Nome da TABELA como quem usa a tela a chama. 'produto_pedido' e
  // 'impressao_item' sao nomes de coluna do banco, e ninguem da mapoteca fala
  // assim. Chave desconhecida cai no proprio nome, para uma tabela nova entrar
  // no historico sem sumir da tela enquanto este mapa nao a conhece.
  const NOME_TABELA = {
    pedido: 'Pedido',
    produto_pedido: 'Item',
    impressao_item: 'Impressão',
  };

  // I, U e D sao as letras que o banco grava. O verbo no passado diz o que a
  // pessoa fez, que e o que se procura ao ler um histórico.
  const NOME_OPERACAO = {
    I: { texto: 'Adicionou', cor: 'success' },
    U: { texto: 'Alterou', cor: 'info' },
    D: { texto: 'Removeu', cor: 'error' },
  };

  function renderHistoricoSection() {
    const body = el('div', { className: 'data-table__empty', textContent: 'Carregando o histórico...' });
    let historicoTable = null;

    async function loadHistorico() {
      let eventos;
      try {
        eventos = await getAuditoriaPedido(pedidoId);
      } catch (err) {
        if (disposed) return;
        clearChildren(body);
        body.className = 'data-table__empty';
        body.textContent = err.message || 'Erro ao carregar o histórico';
        return;
      }
      if (disposed) return;
      if (historicoTable) historicoTable._cleanup();

      historicoTable = createDataTable({
        columns: [
          {
            key: 'data_evento',
            label: 'Data',
            sortable: true,
            render: (r) => formatDateTime(r.data_evento),
          },
          {
            key: 'usuario_nome',
            label: 'Usuário',
            // Usuário nulo é evento de migração, não erro: os eventos anteriores
            // à auditoria entraram sem dono.
            render: (r) => r.usuario_nome || r.usuario_nome_guerra || 'migração',
          },
          {
            key: 'operacao',
            label: 'Operação',
            render: (r) => {
              const op = NOME_OPERACAO[r.operacao];
              return op ? chip(op.texto, op.cor) : (r.operacao || '-');
            },
          },
          {
            key: 'tabela',
            label: 'Onde',
            render: (r) => el('div', {}, [
              el('div', { textContent: NOME_TABELA[r.tabela] || r.tabela || '-' }),
              r.registro_id != null
                ? el('span', { className: 'detail-card__label', textContent: `#${r.registro_id}` })
                : null,
            ].filter(Boolean)),
          },
          {
            key: 'campos_alterados',
            label: 'O que mudou',
            render: (r) => (r.campos_alterados || []).length
              ? (r.campos_alterados || []).join(', ')
              : '-',
          },
        ],
        rows: eventos || [],
        pageSize: 10,
        emptyMessage: 'Nenhuma alteração registrada neste pedido',
      });
      cleanups.push(() => historicoTable._cleanup());

      clearChildren(body);
      body.className = '';
      body.appendChild(historicoTable.element);
    }

    const section = el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Histórico do pedido' }),
        // GET /pedido/:id/auditoria e perfil de CONSULTA: quem le o pedido le o
        // historico dele. Nao ha acao aqui, so leitura, e por isso nenhum botao.
        el('div', { className: 'dashboard-section__controls' }, [
          el('span', {
            className: 'detail-card__label',
            textContent: 'Quem alterou o pedido, os itens e as impressões',
          }),
        ]),
      ]),
      body,
    ]);

    root.appendChild(section);
    loadHistorico();
  }

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------
  function renderPedido(pedido) {
    // Header
    root.appendChild(el('div', { className: 'page__header' }, [
      el('div', {}, [
        el('button', {
          className: 'btn btn--text btn--sm',
          type: 'button',
          onClick: () => { location.hash = '/mapoteca/pedidos'; },
        }, [svgIcon(ICONS.arrowBack, 16), 'Pedidos']),
        el('div', { className: 'flex gap-sm' }, [
          el('h1', { className: 'page__title', textContent: `Pedido #${pedido.id}` }),
          chipSituacaoPedido(pedido.situacao_pedido_id, pedido.situacao_pedido_nome),
          chip(pedido.localizador_pedido || '-', 'secondary'),
        ]),
      ]),
      // PUT e DELETE /pedido sao gerente. A etiqueta NAO: ela nao escreve nada,
      // e quem embala o pacote e quem precisa imprimi-la.
      el('div', { className: 'page__actions' }, [
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => openEtiquetaEnvioDialog(pedido),
        }, [svgIcon(ICONS.print, 16), 'Etiqueta de envio']),
        ...(pode.gerente ? [
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => editarPedido(pedido),
        }, [svgIcon(ICONS.edit, 16), 'Editar']),
        el('button', {
          className: 'btn btn--danger',
          type: 'button',
          onClick: () => excluirPedido(pedido),
        }, [svgIcon(ICONS.delete, 16), 'Excluir']),
        ] : []),
      ]),
    ]));

    // Info cards
    const nItens = (pedido.produtos || []).length;
    const nExemplares = (pedido.produtos || []).reduce(
      (soma, r) => soma + (Number(r.quantidade) || 0), 0);

    // Quatro cards, SEMPRE visiveis. Antes havia um card "Resumo" fixo mais um
    // bloco "Detalhes do pedido" colapsado, e os dois repetiam cliente, DIEx,
    // NUP, data e prazo. Cada dado aparece UMA vez, e nada fica escondido atras
    // de um clique (chefe, 2026-07-27).
    const cards = [
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Pedido' }),
        infoRow('Data do pedido', formatDate(pedido.data_pedido)),
        infoRow('Prazo', formatDate(pedido.prazo)),
        infoRow('Itens', `${nItens} carta(s) · ${nExemplares} exemplar(es)`),
        infoRow('Observação', pedido.observacao),
      ]),
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Cliente e contato' }),
        infoRow('Nome', el('a', {
          href: `#/mapoteca/clientes/${pedido.cliente_id}`,
          textContent: pedido.cliente_nome || '-',
        })),
        infoRow('Tipo', pedido.tipo_cliente_nome),
        // DOIS contatos, de proposito. O do pedido costuma vir no DIEx e vale
        // so para ele; o da OM e o geral, usado quando o pedido nao traz um.
        infoRow('Contato do pedido', pedido.ponto_contato),
        infoRow('Contato geral da OM', pedido.cliente_ponto_contato),
        infoRow('Endereço de entrega', pedido.endereco_entrega),
      ]),
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Documento' }),
        infoRow('DIEx/Ofício', pedido.documento_solicitacao),
        infoRow('NUP', pedido.documento_solicitacao_nup),
        infoRow('Palavras-chave', (pedido.palavras_chave || []).length
          ? pedido.palavras_chave.join(', ')
          : '-'),
        infoRow('Demandante', pedido.demandante),
        infoRow('OM responsável', pedido.omds),
        infoRow('Previsto no PIT', pedido.previsto_pit ? 'Sim' : 'Não'),
        infoRow('Meta do PIT', pedido.meta_pit),
      ]),
      // A forma e a data de entrega deixaram de ser do ITEM e passaram a ser do
      // PEDIDO (decisao do chefe, 2026-07-30): o pedido inteiro sai numa remessa
      // so. Por isso as duas colunas sairam da tabela de itens e viram estas
      // duas linhas.
      //
      // A DATA fica AQUI e nao no card "Pedido", onde antes aparecia. O mesmo
      // dado em dois cards vira duvida sobre serem dados diferentes. Este card
      // responde "como e quando o material saiu"; o card "Pedido" ficou com as
      // datas da DEMANDA (pedido e prazo). O rotulo nao mudou, para o campo
      // continuar sendo o mesmo aos olhos de quem usa a tela.
      el('div', { className: 'detail-card' }, [
        el('div', { className: 'detail-card__title', textContent: 'Entrega' }),
        infoRow('Forma de entrega', pedido.forma_entrega_nome),
        // Esta e a data que a consulta publica mostra ao cliente, com o rotulo
        // dele ("envio/entrega"): o pedido fecha no dia em que o material sai.
        infoRow('Atendimento (envio/entrega)', formatDate(pedido.data_atendimento)),
        infoRow('Localizador de envio', pedido.localizador_envio),
        infoRow('Observação de envio', pedido.observacao_envio),
        infoRow('Operação', pedido.operacao),
      ]),
    ];
    root.appendChild(el('div', { className: 'detail-cards', style: { marginBottom: 'var(--space-md)' } }, cards));

    // Pedido de civil (visível quando houver dado civil)
    if (pedido.canal_recebimento_nome || pedido.municipio || pedido.qtd_imagens != null) {
      root.appendChild(el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
        el('div', { className: 'detail-card__title', textContent: 'Pedido de civil' }),
        infoRow('Canal', pedido.canal_recebimento_nome),
        infoRow('Município/Área', pedido.municipio),
        infoRow('Nº de imagens', pedido.qtd_imagens != null ? String(pedido.qtd_imagens) : '-'),
      ]));
    }

    // Observação interna (visível quando houver). Fica FORA dos quatro cards,
    // em bloco próprio e com o aviso na frente, porque a diferença entre ela e
    // as outras duas observações não é de assunto, é de quem lê: a observação e
    // a observação de envio saem na consulta pública do cliente, esta não sai.
    if (pedido.observacao_interna) {
      root.appendChild(el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
        el('div', { className: 'detail-card__title flex gap-sm' }, [
          el('span', { textContent: 'Observação interna' }),
          chip('não aparece na consulta do cliente', 'secondary'),
        ]),
        el('div', { className: 'detail-card__value', textContent: pedido.observacao_interna }),
      ]));
    }

    // Motivo do cancelamento (visível quando houver)
    if (pedido.motivo_cancelamento) {
      root.appendChild(el('div', { className: 'detail-card', style: { marginBottom: 'var(--space-md)' } }, [
        el('div', { className: 'detail-card__title', textContent: 'Motivo do cancelamento' }),
        el('div', { className: 'detail-card__value', textContent: pedido.motivo_cancelamento }),
      ]));
    }

    // Items table
    const produtosTable = createDataTable({
      columns: [
        {
          key: 'produto_nome',
          label: 'Produto',
          sortable: true,
          render: (row) => row.produto_nome || '-',
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
        { key: 'tipo_midia_nome', label: 'Mídia' },
        {
          key: 'quantidade',
          label: 'Qtd.',
          sortable: true,
          render: (row) => formatNumber(row.quantidade),
        },
        {
          key: 'quantidade_fornecida',
          label: 'Qtd. fornecida',
          // Fornecida e IMPRESSA sao coisas diferentes, e as duas ficam na
          // tabela por decisao do chefe (2026-07-30): a fornecida e o que foi
          // ENTREGUE, e faz par com tipo_midia_fornecida_id; a impressa e o que
          // saiu do plotter.
          //
          // Divergir entre as duas e ALARME de dado errado, nao caso comum:
          // medido na producao em 2026-07-30, os 1.928 itens do acervo nunca
          // divergiram. Por isso a marca so aparece quando ha diferenca.
          render: (row) => {
            if (row.quantidade_fornecida == null) return '-';
            const fornecida = Number(row.quantidade_fornecida);
            const impressa = Number(row.quantidade_impressa);
            const diverge = Number.isFinite(fornecida) && Number.isFinite(impressa)
              && fornecida !== impressa;
            return el('span', { className: 'flex gap-sm' }, [
              el('span', { textContent: formatNumber(row.quantidade_fornecida) }),
              diverge
                ? chip(`difere da impressa (${formatNumber(impressa)})`, 'warning')
                : null,
            ].filter(Boolean));
          },
        },
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
      rows: pedido.produtos || [],
      searchable: true,
      pageSize: 10,
      emptyMessage: 'Nenhum produto neste pedido',
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

    const impressao = pedido.impressao || {};
    const resumoImpressao = el('div', { className: 'flex gap-sm' }, [
      impressao.concluida
        ? chip('Impressão concluída', 'success')
        : chip('Impressão pendente', 'warning'),
      el('span', {
        className: 'detail-card__label',
        textContent: `${impressao.itens_concluidos ?? 0}/${impressao.total_itens ?? 0} itens impressos`,
      }),
    ]);

    root.appendChild(el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Produtos do pedido' }),
        // O resumo de impressao e leitura e fica para todos; POST
        // /produto_pedido e gerente.
        el('div', { className: 'dashboard-section__controls' }, [
          resumoImpressao,
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
    ]));

    // Anexos do pedido (documento de solicitação + arquivos)
    renderAnexosSection();

    // Histórico do pedido, no fim: é o que se consulta depois de olhar o dado,
    // e não o que se lê primeiro.
    renderHistoricoSection();
  }

  await load();

  return () => {
    disposed = true;
    disposeCleanups();
  };
}
