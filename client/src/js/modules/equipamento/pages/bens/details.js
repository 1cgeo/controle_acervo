import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { formatCurrency, formatDate, formatBoolean, toNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
import { criarHistorico } from '@components/historico/historico.js';
import { permissoes } from '@store/auth-store.js';
import {
  getEquipamento,
  getDominio,
  getTipos,
  getIndisponibilidades,
  deleteIndisponibilidade,
  getAfastamentos,
  deleteAfastamento,
  getManutencoes,
  deleteManutencao,
  getTransferencias,
  deleteTransferencia,
} from '@modules/equipamento/services/equipamento-service.js';
import { chipSituacao, chipSituacaoTransferencia, textoVidaUtil } from '@modules/equipamento/situacao.js';
import { abrirBemDialog } from './bem-dialog.js';
import { abrirIndisponibilidadeDialog } from './indisponibilidade-dialog.js';
import { abrirAfastamentoDialog } from './afastamento-dialog.js';
import { abrirManutencaoDialog } from './manutencao-dialog.js';
import { abrirTransferenciaDialog } from './transferencia-dialog.js';

/**
 * Linha rótulo/valor do cartão, com os dois nós guardados para repintura.
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

/**
 * Uma SEÇÃO DE HISTÓRICO da ficha, com carga e estado de erro PRÓPRIOS.
 *
 * ESTA É A PEÇA CENTRAL DA TELA, e a razão de ela existir tem data: em
 * 2026-08-08 três telas deste sistema morreram inteiras porque uma chamada de um
 * `Promise.all` falhou, e a mensagem que sobrou na tela era a dela.
 * #/aproveitamento dizia "necessita ser um administrador" porque a QUARTA
 * chamada era de outra guarda.
 *
 * Aqui a ficha faz cinco chamadas: o bem e os quatro históricos. O bem vai no
 * caminho principal, porque sem ele não há tela. Os quatro históricos carregam
 * cada um por si, e a falha de um fica DENTRO da seção dele, com o "Tentar de
 * novo" que devolve aquela tabela e só aquela. Uma transferência fora do ar não
 * pode esconder as onze indisponibilidades.
 *
 * @param {Object} opcoes
 * @param {string} opcoes.titulo
 * @param {Array<Object>} opcoes.colunas
 * @param {string} opcoes.vazio - mensagem de lista vazia
 * @param {Function} opcoes.buscar - async () => Array
 * @param {string|null} [opcoes.rotuloNovo] - null esconde o botão
 * @param {Function} [opcoes.aoNovo]
 * @param {Array<Object>} [opcoes.acoes] - ações de linha do data-table
 * @param {(linhas:Array)=>void} [opcoes.aoCarregar] - avisado a cada carga boa
 * @returns {{element:HTMLElement, recarregar:Function, cleanup:Function}}
 */
function criarSecaoHistorico({
  titulo,
  colunas,
  vazio,
  buscar,
  rotuloNovo = null,
  aoNovo = null,
  acoes = [],
  aoCarregar = null,
}) {
  let descartada = false;

  const tabela = createDataTable({
    columns: colunas,
    rows: [],
    loading: true,
    pageSize: 10,
    emptyMessage: vazio,
    actions: acoes,
  });

  // A tabela vive num nó próprio: o estado de erro toma o lugar dela e o
  // "Tentar de novo" a devolve, sem recriar a tabela nem tocar nas irmãs.
  const corpo = el('div', { className: 'equip-secao__corpo' }, [tabela.element]);

  const controles = el('div', { className: 'dashboard-section__controls' },
    rotuloNovo
      ? [el('button', {
        className: 'btn btn--primary btn--sm',
        type: 'button',
        onClick: () => aoNovo && aoNovo(),
      }, [svgIcon(ICONS.add, 14), rotuloNovo])]
      : []);

  const element = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: titulo }),
      controles,
    ]),
    corpo,
  ]);

  async function recarregar() {
    if (descartada) return;
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!corpo.contains(tabela.element)) corpo.replaceChildren(tabela.element);

    tabela.update({ loading: true });
    let linhas;
    try {
      linhas = await buscar();
    } catch (err) {
      if (descartada) return;
      tabela.update({ loading: false });
      // A FALHA FICA AQUI DENTRO. Sem toast: quatro seções fora do ar dariam
      // quatro toasts empilhados, e nenhum deles diria de qual seção é.
      corpo.replaceChildren(tabela.element);
      mostrarErro(corpo, err, recarregar);
      return;
    }
    if (descartada) return;

    const rows = linhas || [];
    tabela.update({ rows, loading: false });
    if (aoCarregar) aoCarregar(rows);
  }

  return {
    element,
    recarregar,
    cleanup: () => {
      descartada = true;
      tabela._cleanup();
    },
  };
}

/**
 * Ficha do BEM (#/equipamento/bens/:id): os dados do equipamento e os quatro
 * históricos, cada um com o formulário de lançamento.
 *
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Promise<Function>} cleanup
 */
export async function renderBemDetails(container, { params }) {
  const equipamentoId = Number(params.id);
  let disposed = false;
  let montado = false;
  const pode = permissoes('equipamento');

  // Domínios e tipos, para os diálogos. Carregam SEPARADO do bem, cada um com o
  // próprio `catch`: sem eles os diálogos abrem com combos vazios, o que é ruim,
  // mas a ficha inteira continua legível, que é o que importa.
  let dominio = {};
  let tipos = [];
  // As indisponibilidades do bem alimentam o combo do diálogo de manutenção. A
  // seção delas atualiza esta variável a cada carga boa.
  let indisponibilidades = [];
  // O bem corrente, lido pelos diálogos de edição.
  let bemAtual = null;

  const root = el('div', { className: 'page' });
  container.appendChild(root);

  const carregando = el('div', {
    className: 'data-table__empty',
    textContent: 'Carregando o equipamento...',
  });
  root.appendChild(carregando);

  // ---- Cabeçalho -----------------------------------------------------------
  const titulo = el('h1', { className: 'page__title' });
  const situacaoNo = el('span', { className: 'equip-ficha__situacao' });

  const botaoEditar = el('button', {
    className: 'btn btn--primary btn--sm',
    type: 'button',
    onClick: () => abrirBemDialog({
      bem: bemAtual,
      dominio,
      tipos,
      onSaved: carregarBem,
    }),
  }, [svgIcon(ICONS.edit, 14), 'Editar equipamento']);

  const cabecalho = el('div', { className: 'page__header' }, [
    el('div', {}, [
      el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        onClick: () => { location.hash = '/equipamento/bens'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar']),
      // O título e a situação na MESMA linha: a situação é a primeira coisa que
      // se pergunta ao abrir a ficha de um bem, e abaixo do título ela se lê
      // como legenda de outra coisa.
      el('div', { className: 'equip-ficha__titulo' }, [titulo, situacaoNo]),
    ]),
    el('div', { className: 'page__actions' }, pode.gerente ? [botaoEditar] : []),
  ]);

  // ---- Cartões -------------------------------------------------------------
  const linhaPatrimonio = criarLinha('Patrimônio');
  const linhaClasse = criarLinha('Classe de suprimento');
  const linhaTipo = criarLinha('Tipo');
  const linhaModelo = criarLinha('Modelo');
  const linhaSerie = criarLinha('Número de série');
  const linhaEntrada = criarLinha('Entrada em carga');
  const linhaVidaUtil = criarLinha('Vida útil');
  const linhaSecao = criarLinha('Seção detentora');
  const linhaAtivo = criarLinha('Em carga');
  const linhaObservacao = criarLinha('Observação');

  linhaObservacao.element.classList.add('detail-card__row--longo');
  linhaObservacao.valor.classList.add('equip-ficha__observacao');

  const cartoes = el('div', { className: 'detail-cards' }, [
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Identificação' }),
      linhaPatrimonio.element,
      linhaClasse.element,
      linhaTipo.element,
      linhaModelo.element,
      linhaSerie.element,
    ]),
    el('div', { className: 'detail-card' }, [
      el('div', { className: 'detail-card__title', textContent: 'Carga' }),
      linhaEntrada.element,
      linhaVidaUtil.element,
      linhaSecao.element,
      linhaAtivo.element,
      linhaObservacao.element,
    ]),
    // SEM um cartão "Registro" com "cadastrado em / por" e "alterado em / por".
    // As quatro colunas existem na tabela e são escritas, mas a rota do bem NÃO
    // as devolve, de propósito: neste sistema quem guarda "quem mexeu e quando"
    // é `auditoria.evento`, e a resposta a essa pergunta é o painel de histórico
    // no fim desta ficha. Um cartão com quatro traços prometeria um dado que a
    // resposta não traz.
  ]);

  // ---- Exclusões dos históricos -------------------------------------------
  /**
   * Confirmação de exclusão de um lançamento, com o registro NOMEADO.
   * @param {string} titulo
   * @param {string} descricao - como o registro se identifica na frase
   * @param {Function} apagar - async () => void
   * @param {Function} recarregar
   * @param {string} sucesso
   */
  async function excluirLancamento({ titulo: tituloDialogo, descricao, apagar, recarregar, sucesso }) {
    const ok = await confirmDialog({
      title: tituloDialogo,
      message: `${descricao} Esta ação não pode ser desfeita.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;
    try {
      await apagar();
      showSuccess(sucesso);
      await recarregar();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o lançamento');
    }
  }

  /** O período de um lançamento, como frase, para a confirmação. */
  function periodoEmTexto(registro) {
    const de = formatDate(registro.data_inicio);
    return registro.data_fim ? `de ${de} a ${formatDate(registro.data_fim)}` : `iniciada em ${de}`;
  }

  // ---- Seção: indisponibilidades ------------------------------------------
  const secaoIndisponibilidade = criarSecaoHistorico({
    titulo: 'Indisponibilidades',
    vazio: 'Nenhuma indisponibilidade registrada',
    rotuloNovo: pode.operador ? 'Nova indisponibilidade' : null,
    aoNovo: () => abrirIndisponibilidadeDialog({
      equipamentoId,
      onSaved: () => {
        secaoIndisponibilidade.recarregar();
        // A indisponibilidade muda a SITUAÇÃO derivada do bem, e o cabeçalho
        // mostra essa situação: sem esta recarga a ficha ficaria dizendo
        // "Disponível" logo depois de alguém lançar que o bem parou.
        carregarBem();
      },
    }),
    colunas: [
      { key: 'data_inicio', label: 'Início', sortable: true, render: (r) => formatDate(r.data_inicio) },
      {
        key: 'data_fim',
        label: 'Fim',
        sortable: true,
        // Sem data de fim NÃO é "-": é o bem ainda parado, que é o estado das
        // onze linhas que vieram da planilha. Um traço aqui leria-se como
        // "campo não preenchido", e o fato é outro.
        render: (r) => (r.data_fim
          ? formatDate(r.data_fim)
          : el('span', { className: 'chip chip--equip-indisponivel', textContent: 'Em aberto' })),
      },
      { key: 'previsao_retorno', label: 'Previsão de retorno', render: (r) => formatDate(r.previsao_retorno) },
      { key: 'motivo', label: 'Motivo', className: 'data-table__cell--truncate', render: (r) => r.motivo || '-' },
    ],
    acoes: pode.operador ? [
      {
        icon: ICONS.edit,
        title: 'Editar indisponibilidade',
        onClick: (r) => abrirIndisponibilidadeDialog({
          equipamentoId,
          registro: r,
          onSaved: () => { secaoIndisponibilidade.recarregar(); carregarBem(); },
        }),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir indisponibilidade',
        variant: 'danger',
        onClick: (r) => excluirLancamento({
          titulo: 'Excluir indisponibilidade',
          descricao: `Excluir a indisponibilidade ${periodoEmTexto(r)}?`,
          apagar: () => deleteIndisponibilidade(r.id),
          recarregar: async () => { await secaoIndisponibilidade.recarregar(); carregarBem(); },
          sucesso: 'Indisponibilidade excluída com sucesso',
        }),
      },
    ] : [],
    buscar: () => getIndisponibilidades({ equipamento_id: equipamentoId }),
    aoCarregar: (linhas) => { indisponibilidades = linhas; },
  });

  // ---- Seção: manutenções --------------------------------------------------
  const secaoManutencao = criarSecaoHistorico({
    titulo: 'Manutenções',
    vazio: 'Nenhuma manutenção registrada',
    rotuloNovo: pode.operador ? 'Nova manutenção' : null,
    aoNovo: () => abrirManutencaoDialog({
      equipamentoId,
      indisponibilidades,
      onSaved: () => { secaoManutencao.recarregar(); carregarBem(); },
    }),
    colunas: [
      { key: 'data_inicio', label: 'Início', sortable: true, render: (r) => formatDate(r.data_inicio) },
      {
        key: 'data_fim',
        label: 'Fim',
        sortable: true,
        render: (r) => (r.data_fim
          ? formatDate(r.data_fim)
          : el('span', { className: 'chip chip--warning', textContent: 'Em curso' })),
      },
      {
        key: 'valor',
        label: 'Valor pago',
        sortable: true,
        // NUMERIC(14,2) chega como TEXTO no JSON, e a ordem por string mente:
        // '900.00' passaria à frente de '1000.00'.
        sortValue: (r) => toNumber(r.valor),
        render: (r) => formatCurrency(r.valor),
      },
      {
        key: 'valor_orcado',
        label: 'Orçado',
        sortable: true,
        sortValue: (r) => toNumber(r.valor_orcado),
        render: (r) => formatCurrency(r.valor_orcado),
      },
      {
        key: 'valor_pdr',
        label: 'Previsto no PDR',
        sortable: true,
        sortValue: (r) => toNumber(r.valor_pdr),
        render: (r) => formatCurrency(r.valor_pdr),
      },
      { key: 'certame', label: 'Certame', render: (r) => r.certame || '-' },
      { key: 'descricao', label: 'Descrição', className: 'data-table__cell--truncate', render: (r) => r.descricao || '-' },
    ],
    acoes: pode.operador ? [
      {
        icon: ICONS.edit,
        title: 'Editar manutenção',
        onClick: (r) => abrirManutencaoDialog({
          equipamentoId,
          registro: r,
          indisponibilidades,
          onSaved: () => { secaoManutencao.recarregar(); carregarBem(); },
        }),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir manutenção',
        variant: 'danger',
        onClick: (r) => excluirLancamento({
          titulo: 'Excluir manutenção',
          descricao: `Excluir a manutenção ${periodoEmTexto(r)}?`,
          apagar: () => deleteManutencao(r.id),
          recarregar: async () => { await secaoManutencao.recarregar(); carregarBem(); },
          sucesso: 'Manutenção excluída com sucesso',
        }),
      },
    ] : [],
    buscar: () => getManutencoes({ equipamento_id: equipamentoId }),
  });

  // ---- Seção: afastamentos -------------------------------------------------
  const secaoAfastamento = criarSecaoHistorico({
    titulo: 'Afastamentos',
    vazio: 'Nenhum afastamento registrado',
    rotuloNovo: pode.operador ? 'Novo afastamento' : null,
    aoNovo: () => abrirAfastamentoDialog({
      equipamentoId,
      onSaved: () => { secaoAfastamento.recarregar(); carregarBem(); },
    }),
    colunas: [
      { key: 'om', label: 'OM', render: (r) => r.om || '-' },
      { key: 'data_inicio', label: 'Início', sortable: true, render: (r) => formatDate(r.data_inicio) },
      { key: 'previsao_termino', label: 'Previsão de término', render: (r) => formatDate(r.previsao_termino) },
      {
        key: 'data_fim',
        label: 'Retorno',
        sortable: true,
        render: (r) => (r.data_fim
          ? formatDate(r.data_fim)
          : el('span', { className: 'chip chip--info', textContent: 'Afastado' })),
      },
      { key: 'motivo', label: 'Motivo', className: 'data-table__cell--truncate', render: (r) => r.motivo || '-' },
    ],
    acoes: pode.operador ? [
      {
        icon: ICONS.edit,
        title: 'Editar afastamento',
        onClick: (r) => abrirAfastamentoDialog({
          equipamentoId,
          registro: r,
          onSaved: () => { secaoAfastamento.recarregar(); carregarBem(); },
        }),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir afastamento',
        variant: 'danger',
        onClick: (r) => excluirLancamento({
          titulo: 'Excluir afastamento',
          descricao: `Excluir o afastamento para ${r.om || 'outra OM'}, ${periodoEmTexto(r)}?`,
          apagar: () => deleteAfastamento(r.id),
          recarregar: async () => { await secaoAfastamento.recarregar(); carregarBem(); },
          sucesso: 'Afastamento excluído com sucesso',
        }),
      },
    ] : [],
    buscar: () => getAfastamentos({ equipamento_id: equipamentoId }),
  });

  // ---- Seção: transferências e descargas -----------------------------------
  // A ÚNICA das quatro que é do GERENTE: ela move o bem para fora da carga.
  const secaoTransferencia = criarSecaoHistorico({
    titulo: 'Transferências e descargas',
    vazio: 'Nenhuma transferência registrada',
    rotuloNovo: pode.gerente ? 'Nova transferência' : null,
    aoNovo: () => abrirTransferenciaDialog({
      equipamentoId,
      dominio,
      onSaved: () => secaoTransferencia.recarregar(),
    }),
    colunas: [
      { key: 'tipo', label: 'Tipo', render: (r) => r.tipo || '-' },
      {
        key: 'situacao',
        label: 'Situação',
        render: (r) => chipSituacaoTransferencia(r.situacao_id, r.situacao),
      },
      { key: 'om', label: 'OM', render: (r) => r.om || '-' },
      { key: 'documento_solicitacao', label: 'Documento', className: 'data-table__cell--truncate', render: (r) => r.documento_solicitacao || '-' },
      { key: 'data_solicitacao', label: 'Solicitada em', sortable: true, render: (r) => formatDate(r.data_solicitacao) },
      { key: 'data_transferencia', label: 'Transferida em', sortable: true, render: (r) => formatDate(r.data_transferencia) },
      { key: 'transferido_siafi', label: 'SIAFI: transferido', render: (r) => formatBoolean(r.transferido_siafi) },
      { key: 'apropriado_siafi', label: 'SIAFI: apropriado', render: (r) => formatBoolean(r.apropriado_siafi) },
      { key: 'publicacao_autorizacao', label: 'Publicação', className: 'data-table__cell--truncate', render: (r) => r.publicacao_autorizacao || '-' },
    ],
    acoes: pode.gerente ? [
      {
        icon: ICONS.edit,
        title: 'Editar transferência',
        onClick: (r) => abrirTransferenciaDialog({
          equipamentoId,
          registro: r,
          dominio,
          onSaved: () => secaoTransferencia.recarregar(),
        }),
      },
      {
        icon: ICONS.delete,
        title: 'Excluir transferência',
        variant: 'danger',
        onClick: (r) => excluirLancamento({
          titulo: 'Excluir transferência',
          descricao: `Excluir a ${r.tipo || 'transferência'}${r.om ? ` para ${r.om}` : ''}?`,
          apagar: () => deleteTransferencia(r.id),
          recarregar: () => secaoTransferencia.recarregar(),
          sucesso: 'Transferência excluída com sucesso',
        }),
      },
    ] : [],
    buscar: () => getTransferencias({ equipamento_id: equipamentoId }),
  });

  // ---- Repintura do bem ----------------------------------------------------
  function pintarBem(bem) {
    bemAtual = bem;

    titulo.textContent = bem.nr_patrimonio
      ? `Equipamento ${bem.nr_patrimonio}`
      : `Equipamento #${bem.id}`;
    situacaoNo.replaceChildren(chipSituacao(bem.situacao_id, bem.situacao));

    linhaPatrimonio.valor.replaceChildren(el('span', {
      className: 'equip-patrimonio',
      textContent: bem.nr_patrimonio || '-',
    }));
    linhaClasse.valor.textContent = bem.classe || (bem.classe_id != null ? `Classe ${bem.classe_id}` : '-');
    linhaTipo.valor.textContent = bem.tipo || '-';
    linhaModelo.valor.textContent = bem.modelo || '-';
    linhaSerie.valor.textContent = bem.nr_serie || '-';
    linhaEntrada.valor.textContent = formatDate(bem.data_entrada_carga);

    const vidaUtil = textoVidaUtil(bem.vida_util_meses, bem.vida_util_herdada);
    if (vidaUtil instanceof Node) linhaVidaUtil.valor.replaceChildren(vidaUtil);
    else linhaVidaUtil.valor.textContent = vidaUtil;

    linhaSecao.valor.textContent = bem.secao_detentora
      || (bem.secao_detentora_id != null ? `Seção ${bem.secao_detentora_id}` : '-');
    linhaAtivo.valor.textContent = formatBoolean(bem.ativo);
    linhaObservacao.valor.textContent = bem.observacao || '-';

    if (!montado) {
      root.replaceChildren(
        cabecalho,
        cartoes,
        secaoIndisponibilidade.element,
        secaoManutencao.element,
        secaoAfastamento.element,
        secaoTransferencia.element,
      );
      montado = true;
    }
  }

  /**
   * O BEM, no caminho principal: sem ele não há tela.
   *
   * A ficha já montada NÃO se apaga quando uma recarga falha. Quem perdeu a rede
   * por um instante veria o trabalho sumir; o aviso sai no toast e a tela segue
   * mostrando o último estado bom, que é o que a ficha do empenho já faz.
   */
  async function carregarBem() {
    let bem;
    try {
      bem = await getEquipamento(equipamentoId);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar o equipamento');
      if (montado) return;
      clearChildren(root);
      root.appendChild(el('div', {
        className: 'data-table__empty',
        textContent: err.message || 'Equipamento não encontrado',
      }));
      root.appendChild(el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => { location.hash = '/equipamento/bens'; },
      }, [svgIcon(ICONS.arrowBack, 16), 'Voltar']));
      return;
    }
    if (disposed || !bem) return;
    pintarBem(bem);
  }

  // Domínios e tipos: cada um com o próprio `catch`, e nenhum deles no caminho
  // do bem. Falhar aqui deixa um combo vazio num diálogo, e não uma ficha vazia.
  async function carregarDominios() {
    try {
      dominio = (await getDominio()) || {};
    } catch {
      // A falha se anuncia quando o diálogo abrir com o combo vazio. Um toast
      // aqui, na carga da ficha, falaria de uma tela que ainda não existe.
      dominio = {};
    }
  }

  async function carregarTipos() {
    try {
      tipos = (await getTipos()) || [];
    } catch {
      tipos = [];
    }
  }

  await carregarBem();
  if (disposed) return () => {};
  // O bem não carregou: a raiz mostra o erro e o botão de voltar, e as quatro
  // seções nem estão na tela. Buscar os históricos agora seria quatro
  // requisições para pintar nós que ninguém vê.
  if (!montado) {
    return () => {
      disposed = true;
      secaoIndisponibilidade.cleanup();
      secaoManutencao.cleanup();
      secaoAfastamento.cleanup();
      secaoTransferencia.cleanup();
    };
  }

  // Os quatro históricos e os dois auxiliares partem JUNTOS e caem SEPARADOS.
  // `Promise.allSettled`, e nunca `Promise.all`: cada um destes já trata o
  // próprio erro por dentro, e o `allSettled` está aqui só para a montagem
  // esperar todos antes de pendurar o histórico de alterações no fim.
  await Promise.allSettled([
    carregarDominios(),
    carregarTipos(),
    secaoIndisponibilidade.recarregar(),
    secaoManutencao.recarregar(),
    secaoAfastamento.recarregar(),
    secaoTransferencia.recarregar(),
  ]);
  if (disposed) return () => {};

  // Histórico de alterações do agregado `equipamento`, o mesmo componente das
  // outras fichas do sistema. Fica FORA de qualquer `load`: dentro dele seria
  // destruído e refeito a cada gravação, e o painel sairia da tela.
  //
  // O AGREGADO `equipamento` REÚNE AS CINCO TABELAS que esta ficha mostra: o
  // bem, as indisponibilidades, as manutenções, os afastamentos e as
  // transferências. É assim que `server/src/auditoria/mapa/equipamento.js` as
  // registra, todas com o `entidade_id` do BEM, e é o que faz este painel
  // responder "o que mudou neste equipamento" e não só "no cadastro dele".
  const historico = criarHistorico({
    modulo: 'equipamento',
    entidade: 'equipamento',
    id: equipamentoId,
    subtitulo: 'Alterações no bem, nas indisponibilidades, nas manutenções, nos afastamentos e nas transferências',
  });
  root.appendChild(historico.element);

  return () => {
    disposed = true;
    secaoIndisponibilidade.cleanup();
    secaoManutencao.cleanup();
    secaoAfastamento.cleanup();
    secaoTransferencia.cleanup();
    historico.cleanup();
  };
}
