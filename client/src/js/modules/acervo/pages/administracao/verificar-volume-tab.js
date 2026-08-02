import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { showSuccess, showError } from '@utils/toast.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { verificarInconsistencias } from '@modules/acervo/services/admin-service.js';

/** 'há 12 min 30 s': o tempo decorrido, que é o único acompanhamento possível. */
function decorrido(segundos) {
  const min = Math.floor(segundos / 60);
  const seg = segundos % 60;
  return min ? `${min} min ${String(seg).padStart(2, '0')} s` : `${seg} s`;
}

/**
 * Aba "Verificar arquivos no volume": a comparação entre o BANCO e o DISCO.
 *
 * É a outra pergunta da auditoria, e o nome de cada uma diz qual: os invariantes
 * de `#/acervo/auditoria` olham a coerência entre TABELAS e nenhum deles toca o
 * disco; esta relê cada arquivo do volume e confere o SHA-256 gravado.
 *
 * TRÊS COISAS QUE A TELA TEM DE DIZER, e que o nome "Verificar" esconde:
 *
 * 1. **Ela ESCREVE.** É a única das quatro abas de diagnóstico que muda dado, e
 *    muda nos DOIS sentidos: marca com erro o arquivo cujo checksum não bate ou
 *    que sumiu do volume, e LIMPA a marca do que voltou a bater. Rodá-la é o que
 *    alimenta a aba "Arquivos com problema".
 * 2. **Pode levar horas.** Ela lê o byte de todo o acervo para hashear. O
 *    controller já o diz, e é por isso que a leitura acontece fora de transação.
 * 3. **Não há progresso.** A rota só responde no fim, então não existe "40%" a
 *    mostrar. O que dá para mostrar honestamente é o TEMPO DECORRIDO, e é o que
 *    o contador faz: sem ele, uma tela parada por vinte minutos se lê como
 *    travada, e a pessoa aperta de novo ou fecha.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function}>}
 */
export async function renderVerificarVolumeTab(container) {
  let disposed = false;
  let relogio = null;

  const status = el('p', {
    className: 'manutencao__status',
    role: 'status',
    'aria-live': 'polite',
  });
  const saida = el('div', { className: 'manutencao__saida' });

  const verificarBtn = el('button', {
    className: 'btn btn--danger',
    type: 'button',
    onClick: () => verificar(),
  }, [svgIcon(ICONS.check, 16), 'Verificar agora']);

  function pararRelogio() {
    if (relogio) {
      clearInterval(relogio);
      relogio = null;
    }
  }

  async function verificar() {
    const ok = await confirmDialog({
      title: 'Verificar os arquivos no volume',
      message: 'O servidor vai reler TODOS os arquivos do acervo no volume e conferir o '
        + 'checksum de cada um. Em acervo grande isso leva horas.\n\n'
        + 'A verificação ESCREVE: marca com erro o que não bate e limpa a marca do que '
        + 'voltou a bater. Nenhum arquivo é apagado nem movido.\n\n'
        + 'Não há progresso para acompanhar: a resposta só chega no fim. Continuar?',
      confirmLabel: 'Verificar',
      danger: true,
    });
    if (!ok) return;

    verificarBtn.disabled = true;
    saida.replaceChildren();

    // O contador é o acompanhamento possível. Ele mede o tempo DESTA aba: sair
    // da tela não cancela nada no servidor, e é o que o texto abaixo avisa.
    const inicio = Date.now();
    const tick = () => {
      if (disposed) return;
      status.textContent = 'Verificando os arquivos no volume... '
        + `${decorrido(Math.round((Date.now() - inicio) / 1000))} decorrido(s). `
        + 'Sair desta tela não cancela a verificação, mas o resultado se perde.';
    };
    tick();
    relogio = setInterval(tick, 1000);

    try {
      const d = await verificarInconsistencias();
      if (disposed) return;
      pararRelogio();

      const arquivos = d.arquivos_atualizados || 0;
      const deletados = d.arquivos_deletados_atualizados || 0;
      const total = arquivos + deletados;

      status.textContent = `Verificação concluída em `
        + `${decorrido(Math.round((Date.now() - inicio) / 1000))}: `
        + `${formatNumber(arquivos)} arquivo(s) e ${formatNumber(deletados)} `
        + 'arquivo(s) excluído(s) apontados com problema.';

      saida.replaceChildren(el('p', {
        className: 'manutencao__legenda',
        textContent: total
          ? 'Os arquivos apontados estão na aba "Arquivos com problema", com o nome '
            + 'físico e o volume de cada um.'
          : 'Nada foi apontado: o checksum de todo arquivo do acervo bate com o byte no '
            + 'volume. A marca de erro de quem estava apontado antes foi limpa.',
      }));

      showSuccess('Verificação concluída.');
    } catch (err) {
      if (disposed) return;
      pararRelogio();
      status.textContent = `Falhou: ${err.message || 'erro desconhecido'}`;
      showError(err.message || 'A verificação falhou');
    } finally {
      if (!disposed) verificarBtn.disabled = false;
    }
  }

  container.appendChild(el('div', {}, [
    el('p', {
      className: 'page__subtitle',
      textContent: 'Compara o banco com o DISCO: relê cada arquivo no volume e confere o '
        + 'checksum gravado. É a outra pergunta da auditoria, que só olha a coerência '
        + 'entre tabelas e nunca toca o volume.',
    }),
    el('div', { className: 'manutencao' }, [
      el('section', { className: 'manutencao__cartao' }, [
        el('h3', {
          className: 'manutencao__titulo',
          textContent: 'Verificar arquivos no volume',
        }),
        el('p', {
          className: 'manutencao__desc',
          textContent: 'Relê o byte de todo o acervo para conferir o SHA-256 gravado e a '
            + 'existência do arquivo no volume.',
        }),
        el('ul', { className: 'manutencao__avisos' }, [
          el('li', {
            textContent: 'ESCREVE, e nos dois sentidos: marca com erro o que não bate ou '
              + 'sumiu, e limpa a marca do que voltou a bater. É o que alimenta a aba '
              + '"Arquivos com problema".',
          }),
          el('li', {
            textContent: 'Não apaga, não move e não renomeia arquivo nenhum: o que muda é '
              + 'o status no banco.',
          }),
          el('li', {
            textContent: 'Pode levar horas em acervo grande, e a resposta só chega no fim. '
              + 'O contador abaixo mostra o tempo decorrido, que é o único acompanhamento '
              + 'que a rota permite.',
          }),
          el('li', {
            textContent: 'Arquivo do tipo Tileserver fica de fora: ele é URL, e não byte '
              + 'no volume.',
          }),
        ]),
        el('div', { className: 'manutencao__acoes' }, [verificarBtn]),
        status,
        saida,
      ]),
    ]),
  ]));

  return {
    cleanup: () => {
      disposed = true;
      pararRelogio();
    },
  };
}
