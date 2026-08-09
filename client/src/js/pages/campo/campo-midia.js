import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  listarImagensCampo, enviarImagemCampo, excluirImagemCampo, urlDaImagemCampo,
} from '@services/campo-service.js';
import './campo.css';

/**
 * A galeria de fotos e vídeos de um campo, e a tela cheia dela.
 *
 * UM COMPONENTE PARA OS DOIS LADOS, e é o ponto: a FICHA o monta em leitura e o
 * formulário de EDIÇÃO o monta com envio e remoção. Duas cópias divergiriam na
 * primeira coluna nova, e a que fica na ficha é a que todo mundo vê.
 *
 * A DIVISÃO ENTRE OS DOIS É DE 2026-08-09, por decisão do chefe: abrir a ficha é
 * VER, e tudo o que muda o campo -- inclusive acrescentar e remover foto, vídeo e
 * trajeto -- mora em "Editar o campo". Antes disso a ficha tinha botão de enviar
 * e de remover, e a pessoa mudava o cadastro sem nunca ter dito que ia editar.
 */

const dia = (valor) => (valor
  ? String(valor).slice(0, 10).split('-').reverse().join('/')
  : '-');

const bytesLegiveis = (n) => {
  if (n == null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * Tela cheia com navegação entre os itens.
 *
 * O BLOB É BUSCADO SOB DEMANDA, um por vez, e o da tela cheia é OUTRO que o da
 * miniatura: a miniatura já foi revogada quando a galeria recarregou, e reusar
 * uma URL revogada mostra um quadrado quebrado sem erro nenhum.
 *
 * O VÍDEO NÃO TOCA SOZINHO ao navegar: som inesperado numa sala de trabalho é
 * pior que um clique a mais.
 *
 * @param {Object} opts
 * @param {Array<Object>} opts.itens - as imagens, na ordem da galeria
 * @param {number} opts.indice - por onde começar
 */
export function abrirTelaCheia({ itens, indice = 0 }) {
  let atual = indice;
  let urlAtual = null;

  const midia = el('div', { className: 'campo-luz__midia' });
  const legenda = el('div', { className: 'campo-luz__legenda' });
  const contador = el('span', { className: 'campo-luz__contador' });

  const soltarUrl = () => {
    if (urlAtual) URL.revokeObjectURL(urlAtual);
    urlAtual = null;
  };

  const desenhar = () => {
    const item = itens[atual];
    if (!item) return;
    soltarUrl();
    clearChildren(midia);
    midia.appendChild(el('span', {
      className: 'campo-luz__carregando', textContent: 'Carregando...',
    }));
    contador.textContent = `${atual + 1} de ${itens.length}`;
    clearChildren(legenda);
    legenda.append(
      el('strong', { textContent: item.descricao || (item.tipo === 'video' ? 'Vídeo' : 'Foto') }),
      el('small', { textContent: `${dia(item.data_imagem)} · ${bytesLegiveis(item.bytes)}` })
    );

    const pedido = atual;
    urlDaImagemCampo(item.id).then((url) => {
      // A pessoa pode ter navegado enquanto os bytes vinham: 37 MB de vídeo
      // levam tempo, e pintar a resposta atrasada trocaria o que está na tela.
      if (pedido !== atual) { URL.revokeObjectURL(url); return; }
      urlAtual = url;
      clearChildren(midia);
      midia.appendChild(item.tipo === 'video'
        ? el('video', { src: url, controls: true, preload: 'metadata' })
        : el('img', { src: url, alt: item.descricao || 'Foto de campo' }));
    }).catch((err) => {
      if (pedido !== atual) return;
      clearChildren(midia);
      midia.appendChild(el('span', {
        className: 'campo-luz__erro',
        textContent: err.message || 'Não foi possível carregar este arquivo.',
      }));
    });
  };

  const ir = (passo) => {
    // CIRCULAR: chegar ao fim e voltar ao começo é o que se espera de uma
    // galeria, e trava no fim faria a pessoa achar que o botão quebrou.
    atual = (atual + passo + itens.length) % itens.length;
    desenhar();
  };

  const fechar = () => {
    soltarUrl();
    document.removeEventListener('keydown', aoTeclar);
    fundo.remove();
  };

  function aoTeclar(evento) {
    if (evento.key === 'Escape') { evento.preventDefault(); fechar(); }
    else if (evento.key === 'ArrowRight') { evento.preventDefault(); ir(1); }
    else if (evento.key === 'ArrowLeft') { evento.preventDefault(); ir(-1); }
  }

  const anterior = el('button', {
    className: 'campo-luz__nav campo-luz__nav--antes',
    type: 'button',
    'aria-label': 'Anterior',
    onClick: (e) => { e.stopPropagation(); ir(-1); },
  }, [svgIcon(ICONS.chevronLeft, 32)]);

  const proximo = el('button', {
    className: 'campo-luz__nav campo-luz__nav--depois',
    type: 'button',
    'aria-label': 'Próximo',
    onClick: (e) => { e.stopPropagation(); ir(1); },
  }, [svgIcon(ICONS.chevronRight, 32)]);

  // COM UM ITEM SÓ as setas somem: botão que não faz nada convida a clicar.
  if (itens.length < 2) {
    anterior.classList.add('hidden');
    proximo.classList.add('hidden');
  }

  const fundo = el('div', {
    className: 'campo-luz',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Foto ou vídeo em tela cheia',
    // O clique NO FUNDO fecha; o clique na mídia não. Sem o `stopPropagation`
    // do quadro, arrastar o controle de volume do vídeo fecharia a tela.
    onClick: fechar,
  }, [
    el('div', { className: 'campo-luz__barra' }, [
      contador,
      el('button', {
        className: 'campo-luz__fechar',
        type: 'button',
        'aria-label': 'Fechar',
        onClick: (e) => { e.stopPropagation(); fechar(); },
      }, [svgIcon(ICONS.close, 24)]),
    ]),
    el('div', {
      className: 'campo-luz__quadro',
      onClick: (e) => e.stopPropagation(),
    }, [anterior, midia, proximo]),
    legenda,
  ]);

  document.addEventListener('keydown', aoTeclar);
  document.body.appendChild(fundo);
  desenhar();

  return { fechar };
}

/**
 * A galeria de um campo.
 *
 * @param {Object} opts
 * @param {number} opts.campoId
 * @param {boolean} [opts.podeEditar] - mostra enviar e remover
 * @param {Function} [opts.aoMudar] - houve escrita; quem chamou recarrega
 * @returns {{element:HTMLElement, recarregar:Function, cleanup:Function}}
 */
export function criarGaleriaCampo({ campoId, podeEditar = false, aoMudar = null }) {
  // Todo blob das MINIATURAS, para revogar ao desmontar. São até 37 MB por
  // vídeo: sem revogar, a memória do navegador cresce a cada abertura e só
  // volta ao recarregar a página.
  const blobs = [];
  let disposed = false;
  let itens = [];

  const grade = el('div', { className: 'campo-galeria' });
  const acoes = el('div', { className: 'campo-detalhe__acoes' });
  const element = el('div', {}, [acoes, grade]);

  if (podeEditar) {
    const entrada = el('input', {
      type: 'file',
      accept: 'image/*,video/*',
      multiple: true,
      className: 'hidden',
      onChange: async (e) => {
        const arquivos = [...(e.target.files || [])];
        if (!arquivos.length) return;
        try {
          // UM DE CADA VEZ, e não `Promise.all`: são até 37 MB por arquivo, e
          // três subidas simultâneas competem pela mesma conexão e pelo teto de
          // 60mb do body parser.
          for (const arquivo of arquivos) await subir(campoId, arquivo);
          showSuccess(arquivos.length > 1
            ? `${arquivos.length} arquivos enviados`
            : 'Arquivo enviado com sucesso');
          if (aoMudar) aoMudar();
          await recarregar();
        } catch (err) {
          showError(err.message || 'Erro ao enviar o arquivo');
        } finally {
          e.target.value = '';
        }
      },
    });
    acoes.append(entrada, el('button', {
      className: 'btn btn--secondary btn--sm',
      type: 'button',
      onClick: () => entrada.click(),
    }, [svgIcon(ICONS.add, 16), 'Enviar foto ou vídeo']));
  }

  /**
   * Lê o arquivo e o manda em base64.
   *
   * O TIPO SAI DO PRÓPRIO ARQUIVO (`file.type`), e não de um seletor: o
   * navegador já sabe, e perguntar convidaria a errar. Quando ele vem vazio
   * (o caso de 133 das 143 imagens do acervo do SAP), o `mime_type` vai NULO e
   * a rota serve com o tipo genérico -- inventar 'image/jpeg' seria um palpite.
   */
  const subir = (id, arquivo) => new Promise((resolve, reject) => {
    const leitor = new FileReader();
    leitor.onerror = () => reject(new Error(`Não foi possível ler ${arquivo.name}`));
    leitor.onload = () => {
      // `data:<mime>;base64,<dados>` -- só os dados vão no corpo.
      const base64 = String(leitor.result).split(',')[1];
      enviarImagemCampo(id, {
        descricao: arquivo.name,
        data_imagem: null,
        tipo: (arquivo.type || '').startsWith('video/') ? 'video' : 'foto',
        mime_type: arquivo.type || null,
        conteudo_base64: base64,
      }).then(resolve, reject);
    };
    leitor.readAsDataURL(arquivo);
  });

  const cartao = (imagem, indice) => {
    const midia = el('div', {
      className: 'campo-galeria__midia campo-galeria__midia--clicavel',
      role: 'button',
      tabindex: '0',
      title: 'Abrir em tela cheia',
      onClick: () => abrirTelaCheia({ itens, indice }),
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          abrirTelaCheia({ itens, indice });
        }
      },
    }, [el('span', { className: 'campo-galeria__carregando', textContent: 'carregando...' })]);

    urlDaImagemCampo(imagem.id).then((url) => {
      if (disposed) { URL.revokeObjectURL(url); return; }
      blobs.push(url);
      clearChildren(midia);
      midia.appendChild(imagem.tipo === 'video'
        // NA MINIATURA O VÍDEO NÃO TEM CONTROLES: ele é um cartaz para abrir a
        // tela cheia, e um play aqui competiria com o clique que abre.
        ? el('video', { src: url, preload: 'metadata', muted: true })
        : el('img', { src: url, alt: imagem.descricao || 'Foto de campo', loading: 'lazy' }));
      if (imagem.tipo === 'video') {
        midia.appendChild(el('span', { className: 'campo-galeria__marca-video' }, ['vídeo']));
      }
    }).catch((err) => {
      if (disposed) return;
      clearChildren(midia);
      midia.appendChild(el('span', {
        className: 'campo-detalhe__erro',
        textContent: err.message || 'Não foi possível carregar este arquivo.',
      }));
    });

    const item = el('figure', { className: 'campo-galeria__item' }, [
      midia,
      el('div', { className: 'campo-galeria__rodape' }, [
        el('span', { textContent: imagem.descricao || (imagem.tipo === 'video' ? 'Vídeo' : 'Foto') }),
        el('small', { textContent: `${dia(imagem.data_imagem)} · ${bytesLegiveis(imagem.bytes)}` }),
      ]),
    ]);

    if (podeEditar) {
      item.appendChild(el('button', {
        className: 'btn btn--text btn--sm campo-galeria__remover',
        type: 'button',
        onClick: async (e) => {
          e.stopPropagation();
          const ok = await confirmDialog({
            title: 'Remover arquivo',
            message: `Remover "${imagem.descricao || 'este arquivo'}"? Os bytes só existem aqui.`,
            confirmLabel: 'Remover',
            danger: true,
          });
          if (!ok) return;
          try {
            await excluirImagemCampo(imagem.id);
            showSuccess('Arquivo removido');
            if (aoMudar) aoMudar();
            await recarregar();
          } catch (err) {
            showError(err.message || 'Erro ao remover o arquivo');
          }
        },
      }, ['Remover']));
    }

    return item;
  };

  async function recarregar() {
    clearChildren(grade);
    grade.appendChild(el('p', {
      className: 'campo-detalhe__carregando', textContent: 'Carregando...',
    }));
    try {
      itens = await listarImagensCampo(campoId);
    } catch (err) {
      if (disposed) return;
      clearChildren(grade);
      grade.appendChild(el('p', {
        className: 'campo-detalhe__erro',
        textContent: err.message || 'Não foi possível carregar as imagens.',
      }));
      return;
    }
    if (disposed) return;
    clearChildren(grade);
    if (!itens.length) {
      grade.appendChild(el('p', {
        className: 'campo-detalhe__vazio',
        textContent: podeEditar
          ? 'Nenhuma foto ou vídeo. Use o botão acima para enviar.'
          : 'Nenhuma foto ou vídeo neste campo.',
      }));
      return;
    }
    itens.forEach((imagem, i) => grade.appendChild(cartao(imagem, i)));
  }

  function cleanup() {
    disposed = true;
    for (const url of blobs) URL.revokeObjectURL(url);
    blobs.length = 0;
  }

  return { element, recarregar, cleanup };
}
