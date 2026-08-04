import { el, svgIcon, ICONS, clearChildren } from '@utils/dom.js';
import { formatDate } from '@utils/format.js';
import { showError, showSuccess, showWarning } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import { isAdmin } from '@store/auth-store.js';
import {
  listarExercicios, listarRevisoes, excluirRevisao,
  listarAnexosRevisao, enviarAnexoRevisao, excluirAnexoRevisao, baixarAnexoRevisao,
} from '@services/plataforma-service.js';
import { abrirDialogoRevisao } from './revisao-dialog.js';
import { abrirAlteracoesRevisao } from './alteracoes-dialog.js';

/**
 * REVISOES DO PIT (#/revisoes_pit).
 *
 * POR QUE ESTA TELA EXISTE. O modelo de revisao nasceu em 2026-08-04, para
 * responder "por que a 4.2 virou 252": a meta se separou entre IDENTIDADE (o
 * que o SCA decide) e DECLARACAO (o que a DSG declara em cada revisao), e
 * `pit.meta_revisao` e esparsa, entao as linhas de uma revisao SAO as
 * alteracoes dela.
 *
 * Ele ficou sem tela nenhuma ate 2026-08-04, e foi o unico agregado auditado
 * nessa situacao: a revisao existia, registrava evento, e so se lia pela
 * varredura geral de rastreabilidade, filtrando. Era a lacuna de CLASSE C do
 * sistema.
 *
 * RASCUNHO E PUBLICADA sao os dois estados, e a diferenca e uma coluna nula:
 * `data_vigencia`. Nada de enum. Rascunho nao rege; publicar e preencher a data,
 * e e um ATO com dialogo proprio (ver alteracoes-dialog.js).
 *
 * O QUE SE PODE E O QUE NAO SE PODE, e a razao de cada um:
 *
 *   rascunho    edita metadado, tira meta de dentro, publica, exclui
 *   publicada   edita metadado (transcricao: corrigir o nome de quem assinou)
 *               e anexa o documento. O que ela DECLARA nao se toca: e o que o
 *               relatorio daquele mes reporta, e reescrever isso reescreveria
 *               o passado.
 *
 * A LEITURA e de qualquer pessoa logada, como as metas ao lado. A escrita e do
 * administrador, e o servidor a cobra: os botoes seguem `isAdmin()` para nao
 * oferecer o que levaria 403.
 *
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderRevisoesPit(container) {
  let disposed = false;
  let ano = new Date().getFullYear();
  let exercicios = [];
  const pode = isAdmin();

  const anoField = createSelectField({
    label: 'Exercício',
    options: [],
    value: ano,
    onChange: (valor) => {
      ano = valor === null ? null : Number(valor);
      desenharExercicio();
      carregar();
    },
  });

  const novaBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => abrirDialogoRevisao({ ano, onSaved: carregar }),
  }, [svgIcon(ICONS.add, 16), 'Nova revisão']);

  const infoExercicio = el('p', { className: 'page__subtitle' });

  const tabela = createDataTable({
    columns: [
      { key: 'codigo', label: 'Revisão', sortable: true },
      {
        key: 'rascunho',
        label: 'Estado',
        sortable: true,
        render: (r) => el('span', {
          className: `status-chip ${r.rascunho ? 'status-chip--warning' : 'status-chip--success'}`,
          textContent: r.rascunho ? 'Rascunho' : 'Publicada',
        }),
      },
      {
        key: 'data_vigencia',
        label: 'Rege desde',
        sortable: true,
        render: (r) => (r.data_vigencia ? formatDate(r.data_vigencia) : '-'),
      },
      {
        key: 'data_documento',
        label: 'Documento',
        sortable: true,
        render: (r) => (r.data_documento ? formatDate(r.data_documento) : '-'),
      },
      { key: 'assinante', label: 'Assinante', render: (r) => r.assinante || '-' },
      {
        key: 'alteracoes',
        label: 'Altera',
        sortable: true,
        render: (r) => `${r.alteracoes} meta(s)`,
      },
      {
        key: 'anexos',
        label: 'Documento assinado',
        render: (r) => (r.anexos > 0 ? `${r.anexos} arquivo(s)` : '-'),
      },
    ],
    rows: [],
    pageSize: 25,
    loading: true,
    emptyMessage: 'Nenhuma revisão neste exercício. O R0 é a primeira, e é o PIT original.',
    actions: [
      {
        icon: ICONS.visibility,
        title: 'Ver o que ela altera',
        onClick: (r) => abrirAlteracoesRevisao({ revisao: r, onAlterado: carregar }),
      },
      {
        icon: ICONS.description,
        title: 'Documento assinado',
        onClick: (r) => abrirAnexos(r),
      },
      ...(pode
        ? [
          {
            icon: ICONS.edit,
            title: 'Editar',
            onClick: (r) => abrirDialogoRevisao({ revisao: r, onSaved: carregar }),
          },
          {
            icon: ICONS.delete,
            title: 'Excluir',
            variant: 'danger',
            onClick: (r) => excluir(r),
          },
        ]
        : []),
    ],
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header page__header--column' }, [
      el('h1', { className: 'page__title', textContent: 'Revisões do PIT' }),
      el('p', {
        className: 'page__subtitle',
        textContent: 'A DSG revisa o plano durante a execução. Cada revisão cancela, '
          + 'altera e acrescenta meta, e o relatório de um mês reporta a revisão que '
          + 'estava no ar naquele mês.',
      }),
      infoExercicio,
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', alignItems: 'flex-end', marginBottom: '16px' },
    }, [
      anoField.element,
      el('div', { style: { flex: '1' } }),
      ...(pode ? [novaBtn] : []),
    ]),
    tabela.element,
  ]);
  container.appendChild(page);

  function desenharExercicio() {
    const ex = exercicios.find((e) => Number(e.ano) === Number(ano));
    if (!ex) {
      infoExercicio.textContent = 'Este ano não tem exercício cadastrado.';
      return;
    }
    const partes = [`Exercício ${ex.ano}`, ex.situacao || ''];
    if (ex.observacao) partes.push(ex.observacao);
    infoExercicio.textContent = partes.filter(Boolean).join('  ·  ');
  }

  async function excluir(r) {
    if (!r.rascunho) {
      showError(
        'Revisão publicada não se exclui: ela é o que o relatório daquele mês '
        + 'reporta, e apagá-la reescreveria esse passado.',
      );
      return;
    }
    const ok = await confirmDialog({
      title: `Excluir o rascunho ${r.codigo}`,
      message: `O rascunho e as ${r.alteracoes} alteração(ões) dele somem. `
        + 'As metas voltam a valer como a revisão anterior as declarou.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;

    try {
      await excluirRevisao(r.id);
      showSuccess('Rascunho excluído');
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o rascunho');
    }
  }

  /**
   * O DOCUMENTO ASSINADO da revisao.
   *
   * E a fonte primaria: o que o sistema declara tem de dizer o que ele diz. Foi
   * lendo os dois PDF assinados de 2026 que se descobriu que o 247 da meta 4.2
   * era o R0, e nao erro de planilha, e que a 6.8 e 61 pelo R1, e nao 73.
   */
  async function abrirAnexos(r) {
    let anexos = [];
    try {
      anexos = await listarAnexosRevisao(r.id);
    } catch {
      anexos = [];
    }

    const lista = el('div');
    const entrada = el('input', {
      type: 'file',
      accept: '.pdf,.odt,.doc,.docx,.ods,.xls,.xlsx,.csv,.p7s',
      className: 'form-field__input',
      style: { maxWidth: '360px' },
    });

    function desenharLista() {
      clearChildren(lista);
      if (!anexos.length) {
        lista.appendChild(el('p', {
          className: 'rpcm-anexo__vazio',
          textContent: 'Nenhum documento anexado. É a fonte primária da revisão: '
            + 'o que o sistema declara tem de dizer o que ele diz.',
        }));
        return;
      }
      for (const a of anexos) {
        lista.appendChild(el('div', { className: 'rpcm-anexo' }, [
          svgIcon(ICONS.description, 16),
          el('span', { textContent: a.nome_original }),
          el('span', { className: 'rpcm-anexo__meta', textContent: a.tipo_anexo || '' }),
          el('button', {
            className: 'btn btn--icon',
            type: 'button',
            title: 'Baixar',
            onClick: () => baixarAnexoRevisao(a.id, a.nome_original)
              .catch((err) => showError(err.message || 'Erro ao baixar')),
          }, [svgIcon(ICONS.download, 16)]),
          ...(pode
            ? [el('button', {
              className: 'btn btn--icon btn--danger-text',
              type: 'button',
              title: 'Excluir',
              onClick: async () => {
                const ok = await confirmDialog({
                  title: 'Excluir anexo',
                  message: `Excluir "${a.nome_original}"?`,
                  confirmLabel: 'Excluir',
                  danger: true,
                });
                if (!ok) return;
                try {
                  await excluirAnexoRevisao(a.id);
                  anexos = await listarAnexosRevisao(r.id);
                  desenharLista();
                  await carregar();
                } catch (err) {
                  showError(err.message || 'Erro ao excluir o anexo');
                }
              },
            }, [svgIcon(ICONS.delete, 16)])]
            : []),
        ]));
      }
    }
    desenharLista();

    const enviar = el('button', {
      className: 'btn',
      type: 'button',
      onClick: async () => {
        const arquivo = entrada.files && entrada.files[0];
        if (!arquivo) {
          showWarning('Escolha o arquivo do documento assinado');
          return;
        }
        enviar.disabled = true;
        try {
          const dados = new FormData();
          dados.append('arquivo', arquivo);
          await enviarAnexoRevisao(r.id, dados);
          showSuccess('Documento anexado com sucesso');
          anexos = await listarAnexosRevisao(r.id);
          desenharLista();
          entrada.value = '';
          await carregar();
        } catch (err) {
          showError(err.message || 'Erro ao anexar o documento');
        } finally {
          enviar.disabled = false;
        }
      },
    }, [svgIcon(ICONS.add, 16), 'Anexar']);

    openModal({
      title: `Documento da revisão ${r.codigo} de ${r.ano}`,
      width: '640px',
      content: el('div', {}, [
        lista,
        ...(pode
          ? [el('div', {
            style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '12px' },
          }, [entrada, enviar])]
          : []),
      ]),
      actions: [{ label: 'Fechar', variant: 'text', onClick: ({ close }) => close() }],
    });
  }

  async function carregarExercicios() {
    try {
      exercicios = await listarExercicios();
    } catch {
      exercicios = [];
    }
    if (disposed) return;

    const corrente = new Date().getFullYear();
    const anos = [...new Set([corrente, ...exercicios.map((e) => Number(e.ano))])]
      .sort((a, b) => b - a);
    anoField.setOptions(anos.map((a) => ({ value: a, label: String(a) })));
    anoField.setValue(ano);
    desenharExercicio();
  }

  async function carregar() {
    tabela.update({ loading: true });
    try {
      const linhas = await listarRevisoes(ano);
      if (disposed) return;
      tabela.update({ rows: linhas || [], loading: false });
    } catch (err) {
      if (disposed) return;
      tabela.update({ rows: [], loading: false });
      showError(err.message || 'Erro ao carregar as revisões do PIT');
    }
  }

  await carregarExercicios();
  await carregar();

  return () => {
    disposed = true;
    tabela._cleanup();
  };
}
