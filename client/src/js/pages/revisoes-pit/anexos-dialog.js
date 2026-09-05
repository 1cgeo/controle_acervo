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
/**
 * O maior anexo que o servidor aceita, em bytes.
 *
 * ESPELHA `anexo_revisao_upload.MAX_BYTES`. Conferir aqui é o que evita mandar
 * 60 MB pela rede para receber a recusa no fim: entre o clique e a resposta a
 * tela não tem o que dizer, e a espera é toda ela inútil. Mesma régua do teto
 * de `campo-midia.js`.
 */
export const MAX_BYTES_ANEXO = 20 * 1024 * 1024;

const megas = (n) => `${(n / (1024 * 1024)).toFixed(1)} MB`;

export async function abrirAnexosRevisao({ revisao, onAlterado = null } = {}) {
  const pode = isAdmin();

  let anexos = [];
  // A LEITURA QUE FALHOU SE ESCREVE COMO FALHA, e não como lista vazia.
  //
  // O `catch` engolia o erro e caía no texto de "nenhum documento anexado", que
  // afirma sobre o banco o que era uma consulta sem resposta. É o mesmo defeito
  // que a lista de anexos do RPCMTec já corrigiu (`avisoErroAnexo`, em
  // `pages/rpcmtec/edicao.js`), e aqui doía mais: o texto do vazio diz que sem o
  // documento não há contra o que conferir a transcrição, e quem lesse isso
  // reanexaria o PDF assinado por cima achando que ele se perdeu.
  let erroLeitura = null;
  try {
    anexos = await listarAnexosRevisao(revisao.id);
  } catch (err) {
    anexos = [];
    erroLeitura = err.message || 'Erro ao carregar os documentos da revisão.';
  }

  const lista = el('div');
  const entrada = el('input', {
    type: 'file',
    accept: '.pdf,.odt,.doc,.docx,.ods,.xls,.xlsx,.csv,.p7s',
    className: 'form-field__input',
    style: { maxWidth: '360px' },
  });

  /**
   * Relê a lista e repinta, SEM deixar a falha da leitura passar por falha da
   * ESCRITA que acabou de dar certo.
   *
   * A releitura ficava solta depois do `showSuccess`: no envio, dentro do mesmo
   * `try`, ela pintava "Documento anexado com sucesso" e "Erro ao anexar o
   * documento" em sequência sobre um anexo que JÁ SUBIU; na exclusão, fora de
   * qualquer `try`, ela virava rejeição não tratada e a lista ficava velha, sem
   * uma palavra.
   */
  async function reler() {
    try {
      anexos = await listarAnexosRevisao(revisao.id);
      erroLeitura = null;
    } catch (err) {
      anexos = [];
      erroLeitura = err.message || 'Erro ao recarregar os documentos da revisão.';
    }
    desenharLista();
  }

  function desenharLista() {
    clearChildren(lista);
    if (erroLeitura) {
      lista.appendChild(el('p', {
        className: 'rpcm-anexo__vazio',
        role: 'alert',
        textContent: `${erroLeitura} A lista de documentos não foi lida, e isto `
          + 'não quer dizer que não há documento anexado.',
      }));
      return;
    }
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
              await reler();
              if (onAlterado) onAlterado();
            },
          }, [svgIcon(ICONS.delete, 16)])]
          : []),
      ]));
    }
  }
  desenharLista();

  // O RÓTULO É UM `<span>` PRÓPRIO: ele troca por "Enviando..." durante a
  // subida, e escrever no `textContent` do botão levaria o ícone junto.
  const rotuloEnviar = el('span', { textContent: 'Anexar' });

  // O modal, para segurá-lo enquanto a requisição está em voo. Ele se atribui
  // logo abaixo, e o `onClick` só corre depois disso.
  let modal = null;

  const enviar = el('button', {
    className: 'btn',
    type: 'button',
    onClick: async () => {
      const arquivo = entrada.files && entrada.files[0];
      if (!arquivo) {
        showWarning('Escolha o arquivo do documento assinado');
        return;
      }
      // O TETO É CONFERIDO ANTES DE MONTAR O `FormData`, e espelha o do
      // servidor. Sem ele a pessoa manda o ODS de 60 MB pela rede inteira para
      // receber a recusa no fim, e nomear o arquivo aqui é o que diz QUAL
      // reprovou quando ela escolheu o errado.
      if (arquivo.size > MAX_BYTES_ANEXO) {
        showError(`"${arquivo.name}" tem ${megas(arquivo.size)} e o teto é `
          + `${megas(MAX_BYTES_ANEXO)}. Nada foi enviado.`);
        return;
      }
      // A TELA DIZ QUE ESTÁ SUBINDO, e o diálogo não se fecha no meio: um
      // Escape com a requisição em voo levava a resposta (sucesso ou recusa) a
      // uma tela que já não existia.
      enviar.disabled = true;
      rotuloEnviar.textContent = 'Enviando...';
      if (modal) modal.setOcupado(true);
      try {
        const dados = new FormData();
        dados.append('arquivo', arquivo);
        await enviarAnexoRevisao(revisao.id, dados);
      } catch (err) {
        showError(err.message || 'Erro ao anexar o documento');
        return;
      } finally {
        if (modal) modal.setOcupado(false);
        rotuloEnviar.textContent = 'Anexar';
        enviar.disabled = false;
      }
      showSuccess('Documento anexado com sucesso');
      entrada.value = '';
      // FORA do `try` da escrita, pela mesma razão da exclusão logo acima.
      await reler();
      if (onAlterado) onAlterado();
    },
  }, [svgIcon(ICONS.add, 16), rotuloEnviar]);

  modal = openModal({
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

  return modal;
}
