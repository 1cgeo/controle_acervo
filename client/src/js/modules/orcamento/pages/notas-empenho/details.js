import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { reconciliar } from '@utils/reconciliar.js';
import { formatCurrency, formatDate, formatDateTime, toNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  createTextField,
  createNumberField,
  createDateField,
  createTextareaField,
} from '@components/form-fields/form-fields.js';
import {
  getNotaEmpenho,
  getLiquidacoes,
  createLiquidacao,
  updateLiquidacao,
  deleteLiquidacao,
  getRecebimentos,
  createRecebimento,
  updateRecebimento,
  deleteRecebimento,
  downloadArquivo,
} from '@modules/orcamento/services/orcamento-service.js';
import { permissoes } from '@store/auth-store.js';
import { criarHistorico } from '@components/historico/historico.js';

/**
 * Linha rotulo/valor do cartao, com os dois nos guardados para repintura.
 *
 * Devolve os nos em vez de so a linha porque a ficha se RECARREGA a cada
 * gravacao. Com os nos na mao, a recarga escreve o valor novo no mesmo no, e a
 * tela nao se move. O rotulo tambem muda em um caso: a nota de credito vira
 * "rateio" quando ha mais de uma.
 *
 * @param {string} rotulo
 * @returns {{element:HTMLElement, label:HTMLElement, valor:HTMLElement}}
 */
function criarLinha(rotulo) {
  const label = el('span', { className: 'detail-card__label', textContent: rotulo });
  const valor = el('span', { className: 'detail-card__value' });
  return {
    element: el('div', { className: 'detail-card__row' }, [label, valor]),
    label,
    valor,
  };
}

/** Uma parcela do rateio, como ela aparece na linha da nota de credito. */
function textoRateio(a) {
  return `${a.nota_credito_numero ?? `NC ${a.nota_credito_id}`}: ${formatCurrency(a.valor)}`;
}

/** O destino de uma NC: a ficha dela, e a lista so quando o id nao veio. */
function rotaDaNc(ncId) {
  return ncId != null
    ? `#/orcamento/notas_credito/${ncId}`
    : '#/orcamento/notas_credito';
}


/**
 * Pagina de detalhes de uma Nota de Empenho (#/notas_empenho/:id).
 * Cabecalho com os dados da NE e duas secoes com data-table:
 * liquidacoes e recebimentos de material, cada uma com criar/editar/excluir.
 *
 * A TELA SE MONTA UMA VEZ. Ate aqui, `renderNota` limpava a raiz e
 * criava as duas data-table dentro do `load()`. Como toda gravacao chama
 * `load()`, editar uma liquidacao trocava todos os nos da tela: a ordenacao
 * escolhida voltava ao padrao, o foco do teclado caia no body e o painel de
 * historico saia da tela, porque ele era pendurado DEPOIS do primeiro load e o
 * `clearChildren(root)` seguinte o levava junto.
 *
 * Agora o esqueleto (cabecalho, cartoes e as duas secoes) nasce uma vez, e o
 * `load()` so repinta: escreve no no do valor e chama `table.update({ rows })`.
 *
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderNotaEmpenhoDetails(container, { params }) {
  const notaEmpenhoId = Number(params.id);
  let disposed = false;
  // O ano da NE carregada. Ver `rotaDaLista`.
  let anoDaNota = null;
  // Verdadeiro depois que o esqueleto entra na tela. Separa a PRIMEIRA carga
  // (que ainda nao tem o que preservar) das recargas de gravacao.
  let montado = false;
  // Liquidacao e recebimento seguem o corte do modulo: lancar e editar sao
  // operador, excluir e gerente. Quem so consulta ve as duas tabelas cheias.
  const pode = permissoes('orcamento');

  const root = el('div', { className: 'page' });
  container.appendChild(root);

  function cleanupTables() {
    liquidacoesTable._cleanup();
    recebimentosTable._cleanup();
  }

  // ---------------------------------------------------------------------------
  // Liquidacoes
  // ---------------------------------------------------------------------------
  function novaLiquidacao() {
    abrirLiquidacaoDialog({});
  }

  function editarLiquidacao(row) {
    abrirLiquidacaoDialog({ liquidacao: row });
  }

  function abrirLiquidacaoDialog({ liquidacao = null }) {
    const isEdit = Boolean(liquidacao);

    const valorField = createNumberField({
      label: 'Valor liquidado',
      required: true,
      min: 0,
      step: 0.01,
      value: liquidacao?.valor_liquidado ?? undefined,
    });
    const dataField = createDateField({
      label: 'Data',
      value: liquidacao?.data ?? '',
    });
    const documentoField = createTextField({
      label: 'Documento (NS)',
      // 20: o limite da coluna (orcamento.liquidacao.documento_ns VARCHAR(20)).
      // A tela aceitava 30 e o banco recusava na gravação.
      maxLength: 20,
      placeholder: 'Ex.: 2025NS000045',
      value: liquidacao?.documento_ns ?? '',
    });

    const content = el('div', { className: 'form-grid' }, [
      valorField.element,
      dataField.element,
      el('div', { className: 'form-grid__full' }, [documentoField.element]),
    ]);

    let saving = false;

    openModal({
      title: isEdit ? 'Editar liquidação' : 'Nova liquidação',
      content,
      width: '560px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Salvar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (saving) return;

            valorField.setError(null);
            const valor = valorField.getValue();
            if (valor === null || valor <= 0) {
              valorField.setError('Informe um valor maior que zero');
              return;
            }

            // nota_empenho_id vai no corpo TAMBEM na edicao: o models.atualizar
            // do Joi o exige (liquidacao_schema.js:22,33), e sem ele o PUT
            // voltava 400 sempre. O criar ja o mandava.
            const body = {
              nota_empenho_id: notaEmpenhoId,
              valor_liquidado: valor,
              data: dataField.getValue(),
              documento_ns: documentoField.getValue() || null,
            };

            saving = true;
            try {
              if (isEdit) {
                await updateLiquidacao(liquidacao.id, body);
                showSuccess('Liquidação atualizada com sucesso');
              } else {
                await createLiquidacao({ nota_empenho_id: notaEmpenhoId, ...body });
                showSuccess('Liquidação registrada com sucesso');
              }
              close();
              load();
            } catch (err) {
              showError(err.message || 'Erro ao salvar liquidação');
            } finally {
              saving = false;
            }
          },
        },
      ],
    });
  }

  async function excluirLiquidacao(row) {
    const ok = await confirmDialog({
      title: 'Excluir liquidação',
      message: `Excluir a liquidação de ${formatCurrency(row.valor_liquidado)}? Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteLiquidacao(row.id);
      showSuccess('Liquidação excluída com sucesso');
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir liquidação');
    }
  }

  // ---------------------------------------------------------------------------
  // Recebimentos de material
  // ---------------------------------------------------------------------------
  function novoRecebimento() {
    abrirRecebimentoDialog({});
  }

  function editarRecebimento(row) {
    abrirRecebimentoDialog({ recebimento: row });
  }

  function abrirRecebimentoDialog({ recebimento = null }) {
    const isEdit = Boolean(recebimento);

    const materialField = createTextareaField({
      label: 'Material',
      required: true,
      value: recebimento?.material ?? '',
    });
    const prazoField = createTextField({
      label: 'Prazo de entrega',
      // 60: o limite da coluna
      // (orcamento.recebimento_material.prazo_entrega VARCHAR(60)).
      maxLength: 60,
      value: recebimento?.prazo_entrega ?? '',
    });
    const situacaoField = createTextareaField({
      label: 'Situação',
      value: recebimento?.situacao ?? '',
    });
    // O DIA em que o material chegou. A coluna nasceu em 2026-08-11 e ficou
    // INERTE por falta deste campo: toda linha nova nascia com o dia NULO, e a
    // regra do relatorio ("nulo continua aparecendo",
    // `rm.data_recebimento IS NULL OR <= cutoff`) fazia a edicao de JANEIRO
    // listar material recebido em julho, que e exatamente o que a migracao
    // existia para consertar. O ANO DE REFERENCIA e outra coisa: ele diz em qual
    // RPCMTec o item aparece; este aqui diz em qual EDICAO do ano.
    const dataRecebField = createDateField({
      label: 'Data do recebimento',
      value: recebimento?.data_recebimento ?? '',
      helpText: 'Dia em que o material chegou. A 4.6 do RPCMTec recorta por ele: em branco, o item continua aparecendo em todas as edições do ano.',
    });
    const anoRefField = createNumberField({
      label: 'Ano de referência (4.6)',
      step: 1,
      value: recebimento?.ano_referencia ?? undefined,
      helpText: 'Ano em que o material foi recebido, ou seja, em que RPCMTec (4.6) deve constar. Em branco usa o ano do empenho. Use para itens de RPNP (empenho de ano anterior) recebidos neste ano.',
    });

    const content = el('div', { className: 'form-grid' }, [
      el('div', { className: 'form-grid__full' }, [materialField.element]),
      prazoField.element,
      dataRecebField.element,
      anoRefField.element,
      el('div', { className: 'form-grid__full' }, [situacaoField.element]),
    ]);

    let saving = false;

    openModal({
      title: isEdit ? 'Editar recebimento' : 'Novo recebimento',
      content,
      width: '560px',
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Salvar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (saving) return;

            materialField.setError(null);
            const material = materialField.getValue();
            if (!material) {
              materialField.setError('Informe o material');
              return;
            }

            // Mesmo motivo da liquidacao: recebimento_schema.js:19,33 exige o
            // dono no models.atualizar, e o PUT sem ele voltava 400 sempre.
            const body = {
              nota_empenho_id: notaEmpenhoId,
              material,
              prazo_entrega: prazoField.getValue() || null,
              situacao: situacaoField.getValue() || null,
              ano_referencia: anoRefField.getValue(),
              // `createDateField` devolve 'YYYY-MM-DD' ou string vazia, e o Joi
              // e `Joi.date().iso().raw().allow(null)`: a vazia vira null.
              data_recebimento: dataRecebField.getValue() || null,
            };

            saving = true;
            try {
              if (isEdit) {
                await updateRecebimento(recebimento.id, body);
                showSuccess('Recebimento atualizado com sucesso');
              } else {
                await createRecebimento({ nota_empenho_id: notaEmpenhoId, ...body });
                showSuccess('Recebimento registrado com sucesso');
              }
              close();
              load();
            } catch (err) {
              showError(err.message || 'Erro ao salvar recebimento');
            } finally {
              saving = false;
            }
          },
        },
      ],
    });
  }

  async function excluirRecebimento(row) {
    const ok = await confirmDialog({
      title: 'Excluir recebimento',
      message: 'Excluir este recebimento de material? Esta ação não pode ser desfeita.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await deleteRecebimento(row.id);
      showSuccess('Recebimento excluído com sucesso');
      load();
    } catch (err) {
      showError(err.message || 'Erro ao excluir recebimento');
    }
  }

  // ---------------------------------------------------------------------------
  // Esqueleto: montado UMA vez, e so repintado dali em diante
  // ---------------------------------------------------------------------------
  const carregando = el('div', {
    className: 'data-table__empty',
    textContent: 'Carregando nota de empenho...',
  });
  root.appendChild(carregando);

  const titulo = el('h1', { className: 'page__title' });

  // "VOLTAR" LEVA O ANO DA NE. A lista abre sempre no ano corrente, entao sair
  // da ficha de uma NE de 2025 devolvia a lista de 2026, onde ela nem aparece.
  // O ano so existe depois que a NE carrega, e por isso a rota se monta no
  // CLIQUE, e nao na montagem do cabecalho.
  const rotaDaLista = () => (anoDaNota != null
    ? `/orcamento/notas_empenho?ano=${anoDaNota}`
    : '/orcamento/notas_empenho');

  const cabecalho = el('div', { className: 'page__header' }, [
    el('div', {}, [
      el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        onClick: () => { location.hash = rotaDaLista(); },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar']),
      titulo,
    ]),
  ]);

  const linhaNumero = criarLinha('Número');
  const linhaAno = criarLinha('Ano');
  // A `finalidade`, a data do empenho, o PI e o GND já vinham na resposta da API
  // e não eram pintados em lugar nenhum. A finalidade é o único texto que diz
  // para que serve o empenho, é editável no diálogo, e sumia da tela ao salvar.
  const linhaDataEmpenho = criarLinha('Data do empenho');
  const linhaFinalidade = criarLinha('Finalidade');
  const linhaNc = criarLinha('Nota de crédito');
  const linhaAnexoNc = criarLinha('Anexo da NC');
  const linhaNd = criarLinha('ND (herdada da NC)');
  const linhaGnd = criarLinha('GND');
  const linhaPi = criarLinha('PI (herdado da NC)');
  const linhaEmpenhado = criarLinha('Empenhado');
  const linhaAnulado = criarLinha('Anulado');
  const linhaLiquidado = criarLinha('Liquidado');
  const linhaSaldo = criarLinha('Saldo a liquidar');
  // O número da DECISÃO: quanto ainda resta do crédito daquela NC. Os outros
  // três valores do cartão são todos da própria NE, e nenhum responde "posso
  // emitir uma NE nova contra esta NC?".
  const linhaSaldoNc = criarLinha('Saldo da NC');
  const linhaCadastro = criarLinha('Cadastrado em');
  const linhaCadastroPor = criarLinha('Cadastrado por');
  const linhaAlteracao = criarLinha('Alterado em');
  const linhaAlteracaoPor = criarLinha('Alterado por');

  // O rateio por NC e uma LISTA dentro da linha. Ela vive num no proprio, para
  // a recarga reconciliar as parcelas em vez de refazer o bloco inteiro.
  const rateioLista = el('div');

  // Os dois nós abaixo nascem UMA vez e só têm o texto reescrito a cada recarga,
  // como o resto da ficha. Recriá-los a cada gravação tiraria o foco de quem
  // estivesse sobre eles.
  // O LINK LEVA A FICHA DAQUELA NC, e nao a lista. A lista abre SEMPRE no ano
  // corrente (o filtro de ano de cada tela nasce em `new Date().getFullYear()`),
  // entao a NE de um exercicio anterior mandava quem clicasse para uma lista onde
  // a NC nem aparece. O destino so cai na lista quando o id nao veio na resposta.
  const linkNc = el('a', { href: '#/orcamento/notas_credito' });
  const botaoAnexoNc = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
  });
  const rotuloAnexoNc = el('span');
  botaoAnexoNc.append(svgIcon(ICONS.download, 14), rotuloAnexoNc);
  // O anexo corrente da NC, escrito por `pintarAnexoNc` e lido pelo clique.
  let arquivoNc = null;
  botaoAnexoNc.addEventListener('click', () => {
    if (!arquivoNc) return;
    downloadArquivo(arquivoNc.id, arquivoNc.nome)
      .catch((e) => showError(e.message || 'Erro ao baixar o anexo'));
  });

  const cartoes = el('div', { className: 'detail-cards' }, [
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Dados da NE' }),
      linhaNumero.element,
      linhaAno.element,
      linhaDataEmpenho.element,
      linhaFinalidade.element,
      linhaNc.element,
      linhaAnexoNc.element,
      linhaNd.element,
      linhaGnd.element,
      linhaPi.element,
    ]),
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Valores' }),
      linhaEmpenhado.element,
      linhaAnulado.element,
      linhaLiquidado.element,
      linhaSaldo.element,
      linhaSaldoNc.element,
    ]),
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Registro' }),
      linhaCadastro.element,
      linhaCadastroPor.element,
      linhaAlteracao.element,
      linhaAlteracaoPor.element,
    ]),
  ]);

  // ---- Secao: Liquidacoes ----
  // A tabela nasce vazia e FORA do load: criada de novo a cada gravacao, ela
  // levava junto a busca, a ordenacao, a pagina atual e a selecao. O
  // `update({ rows })` preserva os quatro.
  const liquidacoesTable = createDataTable({
    columns: [
      {
        key: 'valor_liquidado',
        label: 'Valor liquidado',
        sortable: true,
        // NUMERIC(15,2) chega como TEXTO no JSON (er/orcamento.sql:208), e a
        // ordem por string mente: '900.00' passa a frente de '1000.00'.
        sortValue: (row) => toNumber(row.valor_liquidado),
        render: (row) => formatCurrency(row.valor_liquidado),
      },
      {
        key: 'data',
        label: 'Data',
        sortable: true,
        render: (row) => formatDate(row.data),
      },
      {
        key: 'documento_ns',
        label: 'Documento (NS)',
        render: (row) => row.documento_ns || '-',
      },
      // Quando e por quem: as quatro colunas de auditoria existem na tabela
      // desde sempre, e a rota que a ficha consome não as selecionava. É o mesmo
      // par que a ficha do pedido da mapoteca mostra, no mesmo componente.
      {
        key: 'data_cadastramento',
        label: 'Cadastrado em',
        sortable: true,
        render: (row) => formatDateTime(row.data_cadastramento),
      },
      {
        key: 'usuario_cadastramento_nome',
        label: 'Por',
        render: (row) => row.usuario_cadastramento_nome || '-',
      },
    ],
    rows: [],
    pageSize: 10,
    emptyMessage: 'Nenhuma liquidação registrada',
    actions: [
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar liquidação',
        onClick: (row) => editarLiquidacao(row),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir liquidação',
        variant: 'danger',
        onClick: (row) => excluirLiquidacao(row),
      }] : []),
    ],
  });

  const secaoLiquidacoes = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Liquidações' }),
      el('div', { className: 'dashboard-section__controls' }, pode.operador ? [
        el('button', {
          className: 'btn btn--primary btn--sm',
          type: 'button',
          onClick: novaLiquidacao,
        }, [svgIcon(ICONS.add, 14), 'Nova liquidação']),
      ] : []),
    ]),
    liquidacoesTable.element,
  ]);

  // ---- Secao: Recebimentos de material ----
  // O ano da NE, lido pela coluna "Ano de referência" para dizer qual ano VALE
  // quando o campo está em branco. Ele muda a cada recarga, e por isso mora numa
  // variável em vez de ser fechado dentro do `render` da coluna.
  let anoDaNe = null;
  const recebimentosTable = createDataTable({
    columns: [
      {
        key: 'material',
        label: 'Material',
        render: (row) => row.material || '-',
      },
      {
        key: 'prazo_entrega',
        label: 'Prazo de entrega',
        render: (row) => row.prazo_entrega || '-',
      },
      {
        key: 'situacao',
        label: 'Situação',
        render: (row) => row.situacao || '-',
      },
      {
        // O DIA do recebimento, que recorta a 4.6 do RPCMTec pelo MÊS da edição.
        // Em branco a célula diz o que isso significa, e não '-': o item sem dia
        // continua aparecendo em TODAS as edições do ano.
        key: 'data_recebimento',
        label: 'Data do recebimento',
        sortable: true,
        sortValue: (row) => row.data_recebimento || null,
        render: (row) => (row.data_recebimento
          ? formatDate(row.data_recebimento)
          : el('span', {
            style: { color: 'var(--text-secondary)' },
            textContent: '-',
            title: 'Sem dia: o item aparece em todas as edições do ano',
          })),
      },
      {
        // O CAMPO ERA GRAVÁVEL E INVISÍVEL: o diálogo o oferece desde sempre e
        // nenhuma coluna o mostrava, então quem lançava não via o que lançou.
        //
        // Ele DECIDE em qual RPCMTec o item aparece: a subseção 4.6 filtra por
        // COALESCE(ano_referencia, ano da NE). É por ele que um material
        // empenhado em 2025 e recebido em 2026 sai no relatório de 2026.
        //
        // Em branco a célula mostra o ano do EMPENHO, esmaecido: '-' esconderia
        // justamente o ano que vale, e é o caso de 14 dos 15 recebimentos reais.
        key: 'ano_referencia',
        label: 'Ano de referência (4.6)',
        sortable: true,
        sortValue: (row) => (row.ano_referencia != null
          ? Number(row.ano_referencia)
          : (anoDaNe != null ? Number(anoDaNe) : null)),
        render: (row) => {
          if (row.ano_referencia != null) return String(row.ano_referencia);
          if (anoDaNe == null) return '-';
          return el('span', {
            style: { color: 'var(--text-secondary)' },
            textContent: String(anoDaNe),
            title: 'Em branco no lançamento: vale o ano do empenho',
          });
        },
      },
      {
        key: 'data_cadastramento',
        label: 'Cadastrado em',
        sortable: true,
        render: (row) => formatDateTime(row.data_cadastramento),
      },
      {
        key: 'usuario_cadastramento_nome',
        label: 'Por',
        render: (row) => row.usuario_cadastramento_nome || '-',
      },
    ],
    rows: [],
    pageSize: 10,
    emptyMessage: 'Nenhum recebimento de material registrado',
    actions: [
      ...(pode.operador ? [{
        icon: ICONS.edit,
        title: 'Editar recebimento',
        onClick: (row) => editarRecebimento(row),
      }] : []),
      ...(pode.gerente ? [{
        icon: ICONS.delete,
        title: 'Excluir recebimento',
        variant: 'danger',
        onClick: (row) => excluirRecebimento(row),
      }] : []),
    ],
  });

  const secaoRecebimentos = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Recebimentos de material' }),
      el('div', { className: 'dashboard-section__controls' }, pode.operador ? [
        el('button', {
          className: 'btn btn--primary btn--sm',
          type: 'button',
          onClick: novoRecebimento,
        }, [svgIcon(ICONS.add, 14), 'Novo recebimento']),
      ] : []),
    ]),
    recebimentosTable.element,
  ]);

  // ---------------------------------------------------------------------------
  // Repintura
  // ---------------------------------------------------------------------------
  /**
   * Escreve a linha da nota de crédito: rateio com várias, ou o número só.
   *
   * UMA NC é o caso de 81 das 81 NEs reais. Nele a lista de rateio repetia um
   * valor que o cartão já mostra dois centímetros abaixo, em "Empenhado". Com
   * uma NC ou nenhuma a linha volta a ser texto simples, e agora um LINK: a
   * lista de NCs era um beco sem saída, escrita como texto morto.
   */
  function pintarNotaCredito(nota) {
    const rateio = nota.notas_credito || [];
    linhaNc.label.textContent = rateio.length > 1
      ? 'Notas de crédito (rateio)'
      : 'Nota de crédito';

    if (rateio.length <= 1) {
      const numero = rateio.length
        ? (rateio[0].nota_credito_numero ?? `NC ${rateio[0].nota_credito_id}`)
        : nota.nota_credito_numero;
      const ncId = rateio.length
        ? rateio[0].nota_credito_id
        : nota.nota_credito_id;
      // Trocar o filho da linha solta o nó da lista, que volta sozinho se a NE
      // ganhar rateio depois.
      if (numero) {
        linkNc.textContent = numero;
        linkNc.href = rotaDaNc(ncId);
        if (linkNc.parentNode !== linhaNc.valor) linhaNc.valor.replaceChildren(linkNc);
      } else {
        linhaNc.valor.textContent = '-';
      }
      return;
    }

    if (rateioLista.parentNode !== linhaNc.valor) {
      linhaNc.valor.replaceChildren(rateioLista);
    }
    reconciliar(rateioLista, rateio, {
      chave: (a, i) => a.nota_credito_id ?? i,
      // Cada parcela LEVA A FICHA da NC dela, pelo mesmo motivo do caso de uma
      // NC só: a lista abre no ano corrente, e a NC da NE antiga não está lá.
      criar: (a) => el('a', {
        href: rotaDaNc(a.nota_credito_id),
        textContent: textoRateio(a),
        style: { display: 'block' },
      }),
      atualizar: (no, a) => {
        no.textContent = textoRateio(a);
        no.href = rotaDaNc(a.nota_credito_id);
      },
    });
  }

  /**
   * O anexo da NC, como botão de download. A linha some quando a NC não tem
   * anexo: uma linha "Anexo da NC: -" só ocupa espaço.
   *
   * O arquivo é o documento que criou o crédito, e a ficha da NE é onde se
   * decide gastar contra ele. `arquivoNc` guarda o id corrente, e o clique o
   * lê: assim o mesmo botão serve depois de uma recarga que trocou o anexo.
   */
  function pintarAnexoNc(nota) {
    arquivoNc = nota.nc_arquivo_id
      ? { id: nota.nc_arquivo_id, nome: nota.nc_arquivo_nome || 'Anexo da NC' }
      : null;
    if (!arquivoNc) {
      linhaAnexoNc.element.style.display = 'none';
      return;
    }
    linhaAnexoNc.element.style.display = '';
    rotuloAnexoNc.textContent = arquivoNc.nome;
    botaoAnexoNc.title = `Baixar ${arquivoNc.nome}`;
    if (botaoAnexoNc.parentNode !== linhaAnexoNc.valor) {
      linhaAnexoNc.valor.replaceChildren(botaoAnexoNc);
    }
  }

  /**
   * O saldo da NC representativa, com as parcelas à vista.
   *
   * É o MESMO teto que o servidor cobra ao gravar: valor da NC, menos o crédito
   * devolvido, menos tudo o que já se empenhou contra ela. O `nc_saldo` vem
   * PRONTO do servidor, e as parcelas aparecem ao lado só para explicá-lo.
   * Refazer a conta aqui abriria a porta para a tela prometer crédito que o
   * servidor recusa.
   *
   * O `nc_valor_recolhido` DESCONTA, e a régua do servidor já o descontou. Desde
   * a 1.40.0 ele é a soma dos documentos de recolhimento da NC, e não mais uma
   * coluna digitada; o nome do campo na resposta não mudou.
   */
  function pintarSaldoNc(nota) {
    if (nota.nc_saldo === null || nota.nc_saldo === undefined) {
      linhaSaldoNc.element.style.display = 'none';
      return;
    }
    linhaSaldoNc.element.style.display = '';
    const recolhido = Number(nota.nc_valor_recolhido || 0);
    const partes = [
      `NC ${formatCurrency(nota.nc_valor_nc)}`,
      `empenhado ${formatCurrency(nota.nc_empenhado)}`,
    ];
    if (recolhido > 0) partes.push(`recolhido ${formatCurrency(recolhido)}`);
    linhaSaldoNc.valor.textContent =
      `${formatCurrency(nota.nc_saldo)} (${partes.join('; ')})`;
  }

  function pintarNota(nota) {
    titulo.textContent = `Nota de empenho ${nota.numero || `#${nota.id}`}`;
    // O ano da NE, que o "Voltar" leva a lista.
    anoDaNota = nota.ano ?? null;

    // Antes de repintar as tabelas: a coluna "Ano de referência" o lê para
    // mostrar o ano que vale quando o recebimento não informa o próprio.
    anoDaNe = nota.ano ?? null;

    linhaNumero.valor.textContent = nota.numero || '-';
    linhaAno.valor.textContent = nota.ano != null ? String(nota.ano) : '-';
    linhaDataEmpenho.valor.textContent = formatDate(nota.data_empenho);
    linhaFinalidade.valor.textContent = nota.finalidade || '-';
    pintarNotaCredito(nota);
    pintarAnexoNc(nota);
    linhaNd.valor.textContent = nota.cod_nd
      ? (nota.nd_nome ? `${nota.cod_nd} - ${nota.nd_nome}` : nota.cod_nd)
      : '-';
    // O GND mora em dominio.natureza_despesa e é 3 (custeio) ou 4 (capital). O
    // diálogo promete o GND ao usuário desde sempre, e ele não existia em tela
    // nenhuma.
    linhaGnd.valor.textContent = nota.gnd != null
      ? `${nota.gnd} - ${Number(nota.gnd) === 4 ? 'capital' : 'custeio'}`
      : '-';
    linhaPi.valor.textContent = nota.cod_pi
      ? (nota.pi_nome ? `${nota.cod_pi} - ${nota.pi_nome}` : nota.cod_pi)
      : '-';
    linhaEmpenhado.valor.textContent = formatCurrency(nota.valor_empenhado);
    linhaAnulado.valor.textContent = formatCurrency(nota.valor_anulado);
    linhaLiquidado.valor.textContent = formatCurrency(nota.total_liquidado);
    linhaSaldo.valor.textContent = formatCurrency(nota.saldo_a_liquidar);
    pintarSaldoNc(nota);

    linhaCadastro.valor.textContent = formatDateTime(nota.data_cadastramento);
    linhaCadastroPor.valor.textContent = nota.usuario_cadastramento_nome || '-';
    linhaAlteracao.valor.textContent = formatDateTime(nota.data_modificacao);
    linhaAlteracaoPor.valor.textContent = nota.usuario_modificacao_nome || '-';

    if (!montado) {
      // Troca a mensagem de carga pelo esqueleto, uma vez so. O historico e
      // pendurado DEPOIS disto, e por isso nunca mais e removido.
      root.replaceChildren(cabecalho, cartoes, secaoLiquidacoes, secaoRecebimentos);
      montado = true;
    }

    liquidacoesTable.update({ rows: nota.liquidacoes || [], loading: false });
    recebimentosTable.update({ rows: nota.recebimentos || [], loading: false });
  }

  async function load() {
    if (montado) {
      // Recarga silenciosa: a tabela que ja tem linhas fica na tela e so avisa
      // que esta carregando, por classe. Ver `render` do data-table.
      liquidacoesTable.update({ loading: true });
      recebimentosTable.update({ loading: true });
    }

    let nota;
    let liquidacoes = [];
    let recebimentos = [];
    try {
      [nota, liquidacoes, recebimentos] = await Promise.all([
        getNotaEmpenho(notaEmpenhoId),
        getLiquidacoes(notaEmpenhoId),
        getRecebimentos(notaEmpenhoId),
      ]);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar a nota de empenho');
      if (montado) {
        // A ficha ja esta na tela. Trocar tudo por uma mensagem de erro apagaria
        // o trabalho de quem so perdeu a rede por um instante: o aviso ja saiu
        // no toast, e a tela segue mostrando o ultimo estado bom.
        liquidacoesTable.update({ loading: false });
        recebimentosTable.update({ loading: false });
        return;
      }
      clearChildren(root);
      root.appendChild(el('div', { className: 'data-table__empty', textContent: err.message || 'Nota de empenho não encontrada' }));
      root.appendChild(el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => { location.hash = '/orcamento/notas_empenho'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar']));
      return;
    }
    if (disposed) return;

    // As liquidacoes e recebimentos podem vir embutidos na NE ou em endpoints
    // proprios; usamos os endpoints proprios como fonte das sub-tabelas.
    nota.liquidacoes = liquidacoes || nota.liquidacoes || [];
    nota.recebimentos = recebimentos || nota.recebimentos || [];

    pintarNota(nota);
  }

  await load();

  // Histórico de alterações. É o MESMO componente da ficha do pedido.
  //
  // O agregado `nota_empenho` reúne QUATRO tabelas: a NE, o rateio por NC, as
  // liquidações e os recebimentos de material. São as quatro coisas que esta
  // ficha mostra, e é o módulo em que "qual era o valor antes" é a pergunta mais
  // provável do sistema inteiro.
  //
  // Fora do `load` de propósito: dentro dele o histórico seria destruído e
  // refeito a cada edição. Estar fora não bastava enquanto o `load` limpava a
  // raiz: o painel era pendurado depois do primeiro load, e a primeira gravação
  // o arrancava da tela. Hoje a raiz só se limpa na falha da PRIMEIRA carga,
  // quando o histórico ainda nem existe.
  //
  // SÓ QUANDO A FICHA MONTOU. Falhando a primeira carga, a raiz fica com "Nota de
  // empenho não encontrada" e o botão de voltar, e o painel era pendurado ali
  // assim mesmo: uma consulta de rastreabilidade por um registro que não abriu, e
  // um título de "Histórico" embaixo de uma tela que não mostra nada.
  const historico = montado
    ? criarHistorico({
      modulo: 'orcamento',
      entidade: 'nota_empenho',
      id: notaEmpenhoId,
      subtitulo: 'Alterações na NE, no rateio por NC, nas liquidações e nos recebimentos',
    })
    : null;
  if (historico) root.appendChild(historico.element);

  return () => {
    disposed = true;
    cleanupTables();
    if (historico) historico.cleanup();
  };
}
