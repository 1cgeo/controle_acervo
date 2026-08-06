import { el, svgIcon, ICONS } from '@utils/dom.js';
import { monthName, formatDateTime, formatDate } from '@utils/format.js';
import { showError, showSuccess } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
import { getUsuarios } from '@services/plataforma-service.js';
import {
  listarEdicoes, getAnosEdicao, excluirEdicao,
} from '@services/rpcmtec-service.js';
import { abrirDialogoEdicao } from './edicao-dialog.js';

/**
 * RPCMTec (#/rpcmtec): a lista das edicoes mensais.
 *
 * ELA NAO E UM GERADOR. Gerando um DOCX para alguem colar num documento mestre
 * no Word, nada fica guardado e a unica copia do relatorio e o arquivo no disco
 * de quem o montou.
 *
 * Agora a unidade de trabalho e a EDICAO do mes: ela guarda o que o gestor
 * digita, congela tudo no fechamento e recebe o PDF assinado como anexo. Por
 * isso a tela abre numa LISTA -- consultar o RPCMTec de um mes passado e a
 * operacao mais comum, e ela nao existia.
 *
 * O ANO tem filtro PROPRIO, como toda tela. Nao ha seletor de ano por modulo.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderRpcmtec(container, _ctx) {
  let disposed = false;
  let usuarios = [];
  let ano = new Date().getFullYear();

  const anoField = createSelectField({
    label: 'Ano',
    options: [],
    placeholder: 'Todos os anos',
    value: ano,
    onChange: (valor) => {
      ano = valor === null ? null : Number(valor);
      carregar();
    },
  });

  const novaBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirDialogoEdicao({
      usuarios,
      onSaved: (criada) => {
        if (criada && criada.id) {
          location.hash = `/rpcmtec/${criada.id}`;
          return;
        }
        carregar();
      },
    }),
  }, [svgIcon(ICONS.add, 16), 'Nova edição']);

  // O ESTADO da edicao nao e uma coluna do banco: ele se le de duas colunas.
  // Sem `data_fechamento` esta aberta; com ela e fechada; com anexo, o assinado
  // ja voltou. Um enum diria a mesma coisa e poderia divergir das duas.
  const estadoDe = (linha) => {
    if (!linha.fechada) return { texto: 'Aberta', classe: 'status-chip--warning' };
    if (linha.anexos > 0) return { texto: 'Assinada', classe: 'status-chip--success' };
    return { texto: 'Fechada', classe: 'status-chip--info' };
  };

  const tabela = createDataTable({
    columns: [
      {
        key: 'mes',
        label: 'Edição',
        sortable: true,
        render: (linha) => `${monthName(linha.mes)}/${linha.ano}`,
      },
      {
        key: 'fechada',
        label: 'Estado',
        sortable: true,
        render: (linha) => {
          const estado = estadoDe(linha);
          return el('span', {
            className: `status-chip ${estado.classe}`,
            textContent: estado.texto,
          });
        },
      },
      {
        key: 'assinante_nome',
        label: 'Assinante',
        render: (linha) => (linha.assinante_nome
          ? `${linha.assinante_posto || ''} ${linha.assinante_nome}`.trim()
          : '-'),
      },
      {
        key: 'data_assinatura',
        label: 'Assinada em',
        sortable: true,
        // Sem `|| '-'`: `formatDate` já devolve '-' para o vazio e para o
        // inválido, então o ramo nunca era alcançado.
        render: (linha) => formatDate(linha.data_assinatura),
      },
      {
        key: 'data_fechamento',
        label: 'Fechada em',
        sortable: true,
        render: (linha) => formatDateTime(linha.data_fechamento),
      },
      {
        key: 'anexos',
        label: 'Assinado anexado',
        render: (linha) => (linha.anexos > 0 ? `${linha.anexos} arquivo(s)` : '-'),
      },
    ],
    rows: [],
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhuma edição do RPCMTec cadastrada',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Abrir',
        onClick: (linha) => { location.hash = `/rpcmtec/${linha.id}`; },
      },
      {
        icon: ICONS.delete,
        title: 'Excluir',
        variant: 'danger',
        onClick: (linha) => excluir(linha),
      },
    ],
  });

  // A tabela vive num nó próprio para o estado de ERRO poder tomar o lugar dela
  // e devolvê-lo depois, sem recriar a tabela. Ver `falhaNaCarga`.
  const areaTabela = el('div', {}, [tabela.element]);

  const page = el('div', { className: 'page' }, [
    // SEM SUBTÍTULO, desde 2026-08-06. Ele abria a sigla e resumia o ciclo
    // (calcula, preenche, congela). Quem chega a esta tela trabalha no relatório
    // todo mês e não precisa da definição; a lista de edições e os botões dizem
    // o resto.
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'RPCMTec' }),
    ]),
    el('div', { className: 'page__filters' }, [
      anoField.element,
      el('div', { className: 'page__filters-acoes' }, [
        novaBtn,
      ]),
    ]),
    areaTabela,
  ]);
  container.appendChild(page);

  /**
   * Estado de ERRO no lugar da tabela.
   *
   * Zerar as linhas fazia a tabela escrever "Nenhuma edição do RPCMTec
   * cadastrada": a falha da API lia-se como ano sem relatório, e quem lesse isso
   * criaria de novo a edição de um mês que já existe.
   *
   * A tabela volta ANTES do aviso porque `mostrarErro` guarda o que estava no
   * nó: uma segunda falha guardaria o próprio aviso, e "Tentar de novo" pararia
   * de devolver a tabela.
   */
  function falhaNaCarga(err) {
    areaTabela.replaceChildren(tabela.element);
    mostrarErro(areaTabela, err, carregar);
  }

  async function excluir(linha) {
    if (linha.fechada) {
      showError('Edição fechada não pode ser excluída. Reabra-a primeiro.');
      return;
    }
    const ok = await confirmDialog({
      title: 'Excluir edição',
      message: `Excluir o RPCMTec de ${monthName(linha.mes)}/${linha.ano}? `
        + 'O que foi digitado nela some junto.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;

    try {
      await excluirEdicao(linha.id);
      showSuccess('Edição excluída com sucesso');
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao excluir a edição');
    }
  }

  async function carregarAnos() {
    let anos = [];
    try {
      anos = await getAnosEdicao();
    } catch {
      anos = [];
    }
    if (disposed) return;

    const corrente = new Date().getFullYear();
    const lista = [...new Set([corrente, ...(anos || []).map(Number)])]
      .sort((a, b) => b - a);
    anoField.setOptions(lista.map((a) => ({ value: a, label: String(a) })));
    anoField.setValue(ano);
  }

  async function carregarUsuarios() {
    try {
      const lista = await getUsuarios();
      if (disposed) return;
      usuarios = (lista || [])
        .filter((u) => u.ativo)
        .sort((a, b) => b.tipo_posto_grad_id - a.tipo_posto_grad_id
          || a.nome_guerra.localeCompare(b.nome_guerra));
    } catch {
      usuarios = [];
    }
  }

  async function carregar() {
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!areaTabela.contains(tabela.element)) areaTabela.replaceChildren(tabela.element);

    tabela.update({ loading: true });
    try {
      const linhas = await listarEdicoes(ano);
      if (disposed) return;
      tabela.update({ rows: linhas || [], loading: false });
    } catch (err) {
      if (disposed) return;
      tabela.update({ loading: false });
      falhaNaCarga(err);
      showError(err.message || 'Erro ao carregar as edições do RPCMTec');
    }
  }

  await carregarUsuarios();
  await carregarAnos();
  await carregar();

  return () => {
    disposed = true;
    tabela._cleanup();
  };
}
