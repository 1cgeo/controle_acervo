import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { showSuccess, showError } from '@utils/toast.js';
import { toIsoDate } from '@utils/format.js';
import { createDateField } from '@components/form-fields/form-fields.js';
import {
  getAlteracoesRevisao, removerDeclaracao, publicarRevisao,
} from '@services/plataforma-service.js';

/**
 * O QUE A REVISAO FAZ, meta a meta, com o valor anterior ao lado.
 *
 * E a tela de conferencia: o gerente le isto contra o DIEx antes de publicar.
 * Sem ela, publicar era um ato as cegas -- a unica forma de saber o que a
 * revisao mudava era comparar duas telas de metas a mao.
 *
 * A TABELA E ESPARSA, e e por isso que esta lista JA E o diff: `pit.meta_revisao`
 * so ganha linha quando algo muda, entao as linhas de uma revisao SAO as
 * alteracoes dela. Nao ha calculo aqui, so leitura.
 *
 * TRES OPERACOES, uma forma so:
 *
 *   ACRESCENTA  a meta nao existia em revisao nenhuma antes (`meta_nova`);
 *   ALTERA      existia, e a quantidade ou o prazo mudaram;
 *   CANCELA     a linha vem com `cancelada`.
 *
 * O valor anterior sai da revisao vigente ANTES desta. Para um rascunho, e a
 * que esta no ar hoje.
 */

const dia = (v) => (v ? String(v).slice(0, 10).split('-').reverse().join('/') : '-');

/** 'de 247 para 252', ou so o valor quando nao havia anterior. */
function comparar(anterior, atual, formatar = (x) => String(x ?? '-')) {
  if (anterior === null || anterior === undefined) return formatar(atual);
  if (String(anterior) === String(atual)) return formatar(atual);
  return el('span', {}, [
    el('span', { className: 'revisao-diff__antes', textContent: formatar(anterior) }),
    ' → ',
    el('strong', { textContent: formatar(atual) }),
  ]);
}

export async function abrirAlteracoesRevisao({ revisao, onAlterado = null } = {}) {
  let linhas = [];
  try {
    linhas = await getAlteracoesRevisao(revisao.id);
  } catch (err) {
    showError(err.message || 'Erro ao carregar as alterações');
    return;
  }

  const corpo = el('div');
  let modal = null;

  function desenhar() {
    corpo.replaceChildren(...(linhas.length
      ? [tabela()]
      : [el('p', {
        className: 'rpcm-grade__vazio',
        textContent: 'Esta revisão não altera meta nenhuma. '
          + 'Publicá-la só repetiria a anterior, e o servidor recusa.',
      })]));
  }

  function tabela() {
    return el('div', { className: 'rpcm-grade__wrap' }, [
      el('table', { className: 'rpcm-grade rpcm-grade--leitura' }, [
        el('thead', {}, [
          el('tr', {}, [
            el('th', { textContent: 'Meta' }),
            el('th', { textContent: 'Descrição' }),
            el('th', { textContent: 'Quantidade' }),
            el('th', { textContent: 'Prazo' }),
            el('th', { textContent: 'Demandante' }),
            el('th', { textContent: 'O que faz' }),
            revisao.rascunho ? el('th', { className: 'rpcm-grade__acao' }) : null,
          ].filter(Boolean)),
        ]),
        el('tbody', {}, linhas.map((l) => linhaDaMeta(l))),
      ]),
    ]);
  }

  function linhaDaMeta(l) {
    const codigo = l.item || String(l.numero_meta);

    // A etiqueta diz QUAL das três operações a linha é. Sem ela, uma meta
    // cancelada e uma alterada se parecem: as duas são apenas "uma linha".
    const marca = l.cancelada
      ? { texto: 'Cancela', classe: 'rpcm-etiqueta--pendente' }
      : (l.meta_nova
        ? { texto: 'Acrescenta', classe: 'rpcm-etiqueta--calculada' }
        : { texto: 'Altera', classe: 'rpcm-etiqueta--digitada' });

    const remover = revisao.rascunho
      ? el('td', { className: 'rpcm-grade__acao' }, [
        el('button', {
          className: 'btn btn--icon btn--danger-text',
          type: 'button',
          title: 'Tirar esta meta do rascunho',
          onClick: () => tirarDoRascunho(l, codigo),
        }, [svgIcon(ICONS.delete, 16)]),
      ])
      : null;

    return el('tr', {}, [
      el('td', { textContent: codigo }),
      el('td', { textContent: l.descricao || '-' }),
      el('td', {}, [comparar(l.quantidade_anterior, l.quantidade_prevista)]),
      el('td', {}, [comparar(l.prazo_anterior, l.prazo, dia)]),
      el('td', { textContent: l.demandante || '-' }),
      el('td', {}, [el('span', {
        className: `rpcm-etiqueta ${marca.classe}`,
        textContent: marca.texto,
      })]),
      remover,
    ].filter(Boolean));
  }

  async function tirarDoRascunho(l, codigo) {
    const ok = await confirmDialog({
      title: `Tirar a meta ${codigo} do rascunho`,
      message: 'A revisão deixa de alterar esta meta, e ela volta a valer como a '
        + 'revisão anterior a declarou. É diferente de CANCELAR a meta, que é uma '
        + 'alteração e continua aparecendo aqui.',
      confirmLabel: 'Tirar do rascunho',
      danger: true,
    });
    if (!ok) return;

    try {
      await removerDeclaracao(revisao.id, l.meta_id);
    } catch (err) {
      showError(err.message || 'Erro ao tirar a meta do rascunho');
      return;
    }

    showSuccess(`Meta ${codigo} tirada do rascunho`);
    if (onAlterado) onAlterado();

    // A RELEITURA fica FORA do try da escrita. Juntas, uma releitura que
    // falhasse pintava "Meta X tirada do rascunho" e "Erro ao tirar a meta do
    // rascunho" em sequência, sobre uma tabela que ainda mostrava a meta: duas
    // mensagens contraditórias sobre uma escrita que já aconteceu.
    try {
      linhas = await getAlteracoesRevisao(revisao.id);
      desenhar();
    } catch (err) {
      showError(`A meta saiu do rascunho, mas a lista não foi relida: ${
        err.message || 'erro ao reler as alterações'}. Reabra este diálogo.`);
    }
  }

  /**
   * PUBLICAR pede UMA data, e ela decide muita coisa: e a partir dela que a
   * revisao rege, e o relatorio de um mes anterior continua reportando a que
   * estava no ar naquele mes.
   *
   * Dialogo proprio, e nao um campo do formulario de metadados: publicar e um
   * ATO. Como campo, alguem publicaria sem perceber ao corrigir o assinante.
   */
  function publicar(fecharLista) {
    // `toIsoDate`, e NUNCA `new Date().toISOString()`: o ISO é em UTC, e em
    // UTC-3 toda hora a partir das 21:00 devolve o dia SEGUINTE. Aqui isso é o
    // dia em que a revisão do PIT passa a reger: publicar às 21h30 de 4 de
    // agosto propunha 5 de agosto, e o relatório do dia 4 continuaria reportando
    // a revisão anterior.
    const hoje = toIsoDate(new Date());
    const vigenciaField = createDateField({
      label: 'Rege a partir de',
      required: true,
      value: revisao.data_assinatura
        ? String(revisao.data_assinatura).slice(0, 10)
        : hoje,
      helpText: 'O relatório de um mês anterior a esta data continua reportando '
        + 'a revisão que estava no ar naquele mês.',
    });

    let publicando = false;

    openModal({
      title: `Publicar a revisão ${revisao.codigo} de ${revisao.ano}`,
      width: '520px',
      content: el('div', {}, [
        el('p', {
          className: 'rpcm-aviso__nota',
          style: { marginBottom: '12px' },
          textContent: `A revisão passa a reger, com ${linhas.length} alteração(ões). `
            + 'Depois disso o que ela declara não se altera mais: para corrigir, '
            + 'emite-se uma revisão nova.',
        }),
        vigenciaField.element,
      ]),
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Publicar',
          variant: 'primary',
          onClick: async ({ close }) => {
            if (publicando) return;
            vigenciaField.setError(null);
            const vigencia = vigenciaField.getValue();
            if (!vigencia) return vigenciaField.setError('Informe a data de vigência');

            publicando = true;
            try {
              const r = await publicarRevisao(revisao.id, { data_vigencia: vigencia });
              showSuccess(`Revisão publicada com ${r.alteracoes} alteração(ões)`);
              close();
              fecharLista();
              if (onAlterado) onAlterado();
            } catch (err) {
              showError(err.message || 'Erro ao publicar a revisão');
            } finally {
              publicando = false;
            }
          },
        },
      ],
    });
  }

  desenhar();

  const acoes = [{ label: 'Fechar', variant: 'text', onClick: ({ close }) => close() }];
  if (revisao.rascunho) {
    acoes.push({
      label: 'Publicar',
      variant: 'primary',
      onClick: ({ close }) => publicar(close),
    });
  }

  modal = openModal({
    title: `Revisão ${revisao.codigo} de ${revisao.ano}: o que ela altera`,
    content: el('div', {}, [
      el('p', {
        className: 'rpcm-aviso__nota',
        style: { marginBottom: '12px' },
        textContent: revisao.rascunho
          ? 'RASCUNHO: nada aqui rege ainda. Confira contra o DIEx e publique.'
          : `Publicada, regendo desde ${dia(revisao.data_vigencia)}. `
            + 'O que ela declara não se altera mais: para corrigir, emita uma revisão nova.',
      }),
      corpo,
    ]),
    width: '1040px',
    actions: acoes,
  });

  return modal;
}
