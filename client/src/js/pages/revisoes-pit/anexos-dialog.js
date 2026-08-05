import { el, svgIcon, ICONS, clearChildren } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { showSuccess, showError, showWarning } from '@utils/toast.js';
import { isAdmin } from '@store/auth-store.js';
import {
  listarAnexosRevisao, enviarAnexoRevisao, excluirAnexoRevisao, baixarAnexoRevisao,
} from '@services/plataforma-service.js';

/**
 * O DOCUMENTO ASSINADO da revisão.
 *
 * É A FONTE PRIMÁRIA, e é dela que decorre todo o resto: o texto assinado é o
 * rei, e o que está no sistema é transcrição dele. Foi lendo os dois PDF
 * assinados de 2026 que se descobriu que o 247 da meta 4.2 era o R0, e não erro
 * de planilha, e que a 6.8 é 61 pelo R1, e não 73.
 *
 * A REVISÃO PUBLICADA CONTINUA ACEITANDO ANEXO. Anexar o PDF não muda nada do
 * que a revisão declara: ele é a prova contra a qual se confere a transcrição.
 *
 * Saiu da tela de revisões (que deixou de existir) para um módulo próprio, e é
 * chamado da tela do PIT do ano.
 *
 * @param {Object} opcoes
 * @param {{id:number, codigo:string, ano:number}} opcoes.revisao
 * @param {Function} [opcoes.onAlterado] - a lista por trás relê a contagem.
 */
export async function abrirAnexosRevisao({ revisao, onAlterado = null } = {}) {
  const pode = isAdmin();

  let anexos = [];
  try {
    anexos = await listarAnexosRevisao(revisao.id);
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
        textContent: 'Nenhum documento anexado. Ele é a fonte primária da revisão: '
          + 'o texto assinado é o rei, e o que está aqui é a transcrição dele. '
          + 'Sem o documento não há contra o que conferir a transcrição.',
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
              } catch (err) {
                showError(err.message || 'Erro ao excluir o anexo');
                return;
              }
              showSuccess('Anexo excluído');
              // A RELEITURA fica FORA do try da escrita: juntas, uma releitura
              // que falhasse pintaria "excluído" e "erro ao excluir" em
              // sequência, sobre uma escrita que já aconteceu.
              anexos = await listarAnexosRevisao(revisao.id);
              desenharLista();
              if (onAlterado) onAlterado();
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
        await enviarAnexoRevisao(revisao.id, dados);
        showSuccess('Documento anexado com sucesso');
        anexos = await listarAnexosRevisao(revisao.id);
        desenharLista();
        entrada.value = '';
        if (onAlterado) onAlterado();
      } catch (err) {
        showError(err.message || 'Erro ao anexar o documento');
      } finally {
        enviar.disabled = false;
      }
    },
  }, [svgIcon(ICONS.add, 16), 'Anexar']);

  return openModal({
    title: `Documento da revisão ${revisao.codigo} de ${revisao.ano}`,
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
