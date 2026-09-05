import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import {
  listarImagensCampo, enviarImagemCampo, excluirImagemCampo, urlDaImagemCampo,
  atualizarImagemCampo,
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

/**
 * O maior arquivo que o servidor aceita, em bytes CRUS.
 *
 * ESPELHA `campo_schema.MAX_BASE64` (58.720.256 caracteres): base64 cresce o
 * binário em um terço, então o teto do arquivo é três quartos daquele número --
 * 42 MiB. O teto de lá existe porque ele TEM de caber no `express.json` de
 * 60mb; com o corpo maior que isso, o body parser responde 413 e o Joi nunca
 * roda, e a mensagem que sobra não fala nem de foto nem de campo.
 */
export const MAX_BYTES_ARQUIVO = 44040192;

const bytesLegiveis = (n) => {
  if (n == null) return '-';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} kB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
};

/**
 * A LINHA DE BAIXO DO CARTÃO: a data SÓ APARECE QUANDO EXISTE.
 *
 * Ela era sempre "data · tamanho", e `data_imagem` é nula em quase toda imagem
 * (133 das 143 do acervo do SAP, e todas as que a tela envia, porque o
 * formulário de envio nunca a pediu). O resultado era um traço solto ao lado do
 * tamanho, que se lia como defeito. Chefe, 2026-08-20: a data da foto não se
 * tem na prática. Onde ela existe -- as dez antigas -- continua aparecendo.
 */
const legendaDoItem = (imagem) => (imagem.data_imagem
  ? `${dia(imagem.data_imagem)} · ${bytesLegiveis(imagem.bytes)}`
  : bytesLegiveis(imagem.bytes));

const rotulo = (imagem) => imagem.descricao
  || (imagem.tipo === 'video' ? 'Vídeo' : 'Foto');

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
      el('strong', { textContent: rotulo(item) }),
      el('small', { textContent: legendaDoItem(item) })
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
    window.removeEventListener('keydown', aoTeclar, true);
    window.removeEventListener('hashchange', fechar);
    fundo.remove();
  };

  /**
   * O TECLADO DA TELA CHEIA VEM ANTES DO MODAL DE BAIXO, e é por isso que o
   * ouvinte mora na CAPTURA da `window`.
   *
   * Esta tela cheia é aberta SEMPRE de dentro de um modal (a ficha do campo ou o
   * formulário de edição), e ela NÃO está na pilha de `modal-base.js` -- é um
   * `<div>` solto no `body`. O modal registra o Escape dele na captura do
   * `document` e chama `stopPropagation`, então o Escape morria lá: a tela cheia
   * continuava na frente e o que fechava era o formulário ATRÁS dela, com tudo o
   * que estivesse digitado. A captura da `window` roda ANTES da do `document`, e
   * o `stopPropagation` daqui é o que faz a camada de cima ganhar a tecla, que é
   * o que se espera de quem está por cima.
   */
  function aoTeclar(evento) {
    // A TELA CHEIA PODE TER MORRIDO SEM PASSAR POR `fechar`: o `<div>` mora no
    // `body`, e o Voltar do navegador troca a página sem tirá-lo de lá. Sem
    // esta saída o ouvinte órfão come a tecla de todas as telas seguintes, e na
    // CAPTURA da `window` ele ganha até do Escape do modal.
    if (!fundo.isConnected) { fechar(); return; }
    if (evento.key !== 'Escape' && evento.key !== 'ArrowRight' && evento.key !== 'ArrowLeft') {
      return;
    }
    evento.preventDefault();
    evento.stopPropagation();
    if (evento.key === 'Escape') fechar();
    else if (evento.key === 'ArrowRight') ir(1);
    else ir(-1);
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

  window.addEventListener('keydown', aoTeclar, true);
  // A NAVEGAÇÃO FECHA A TELA CHEIA. Ela cobre a tela inteira e não deixa nenhum
  // menu clicável, então o gesto natural para sair é o Voltar do navegador --
  // que troca a rota sem passar por `fechar` e deixaria o `<div>` por cima da
  // tela seguinte.
  window.addEventListener('hashchange', fechar);
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
  // A TELA CHEIA ABERTA, para fechá-la no `cleanup`. Ela mora no `body`, fora
  // desta árvore: sem esta referência, sair da página deixaria o
  // `<div class="campo-luz">` cobrindo a tela seguinte.
  let luz = null;

  const abrirLuz = (indice) => {
    if (luz) luz.fechar();
    luz = abrirTelaCheia({ itens, indice });
  };

  const grade = el('div', { className: 'campo-galeria' });
  const acoes = el('div', { className: 'campo-detalhe__acoes' });
  const element = el('div', {}, [acoes, grade]);

  if (podeEditar) {
    // O RÓTULO É UM `<span>` PRÓPRIO: ele troca por "Enviando..." durante a
    // subida, e escrever no `textContent` do botão inteiro levaria o ícone junto.
    const rotuloEnviar = el('span', { textContent: 'Enviar foto ou vídeo' });
    const botaoEnviar = el('button', {
      className: 'btn btn--secondary btn--sm',
      type: 'button',
      onClick: () => entrada.click(),
    }, [svgIcon(ICONS.add, 16), rotuloEnviar]);

    const entrada = el('input', {
      type: 'file',
      accept: 'image/*,video/*',
      multiple: true,
      className: 'hidden',
      onChange: async (e) => {
        const arquivos = [...(e.target.files || [])];
        if (!arquivos.length) return;

        // O TETO É CONFERIDO ANTES DE LER O ARQUIVO, e espelha o
        // `campo_schema.MAX_BASE64` do servidor. É a mesma regra do teto de
        // 50.000 pontos de `campo-trajetos.js`: sem ela, quem escolhe um vídeo
        // de 45 MB espera o navegador montar 60 MB de base64 para receber um
        // 413 do body parser, cuja mensagem não fala nem do arquivo nem do
        // campo. Nomear o arquivo aqui é o que diz QUAL deles reprovou.
        const grande = arquivos.find(a => a.size > MAX_BYTES_ARQUIVO);
        if (grande) {
          showError(`"${grande.name}" tem ${bytesLegiveis(grande.size)} e o teto é `
            + `${bytesLegiveis(MAX_BYTES_ARQUIVO)} por arquivo. Nenhum arquivo foi enviado.`);
          e.target.value = '';
          return;
        }

        // A TELA DIZ QUE ESTÁ SUBINDO. São até 37 MB por arquivo, e sem isto
        // nada mudava entre o clique e o aviso de sucesso: a pessoa clicava de
        // novo, e a segunda escolha subia junto com a primeira.
        botaoEnviar.disabled = true;
        rotuloEnviar.textContent = arquivos.length > 1
          ? `Enviando ${arquivos.length} arquivos...`
          : 'Enviando...';
        // QUANTOS JÁ ENTRARAM. É o que separa "nada subiu" de "metade subiu", e
        // o que diz QUAL arquivo reprovou: o que falhou é o de índice `enviados`.
        let enviados = 0;
        try {
          // UM DE CADA VEZ, e não `Promise.all`: são até 37 MB por arquivo, e
          // três subidas simultâneas competem pela mesma conexão e pelo teto de
          // 60mb do body parser.
          for (const arquivo of arquivos) {
            await subir(campoId, arquivo);
            enviados += 1;
          }
          showSuccess(arquivos.length > 1
            ? `${arquivos.length} arquivos enviados`
            : 'Arquivo enviado com sucesso');
        } catch (err) {
          // O QUE JÁ SUBIU TEM DE APARECER. A subida é uma por vez, então a
          // falha na segunda de três deixa a primeira GRAVADA. Sem repintar, a
          // pessoa escolhe as três de novo e a primeira entra pela segunda vez:
          // `campo.imagem` não tem chave por conteúdo que a recuse.
          const qual = arquivos[enviados] ? ` ao enviar "${arquivos[enviados].name}"` : '';
          showError(`${err.message || 'Erro'}${qual}. `
            + `${enviados} de ${arquivos.length} foram enviados.`);
        } finally {
          if (enviados) {
            if (aoMudar) aoMudar();
            await recarregar();
          }
          e.target.value = '';
          botaoEnviar.disabled = false;
          rotuloEnviar.textContent = 'Enviar foto ou vídeo';
        }
      },
    });
    acoes.append(entrada, botaoEnviar);
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
      onClick: () => abrirLuz(indice),
      onKeyDown: (e) => {
        if (e.key === 'Enter' || e.key === ' ') {
          e.preventDefault();
          abrirLuz(indice);
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

    const rodape = el('div', { className: 'campo-galeria__rodape' });
    const item = el('figure', { className: 'campo-galeria__item' }, [midia, rodape]);

    /**
     * O RODAPÉ TEM DOIS MODOS, e a descrição se edita ALI, no cartão.
     *
     * NÃO É UM MODAL: a galeria já vive dentro do modal de "Editar o campo", e
     * um segundo por cima esconderia qual dos dois está gravando -- é a mesma
     * razão pela qual a ficha FECHA antes de abrir o formulário.
     *
     * SÓ A DESCRIÇÃO. `campo.imagem` tem `descricao` e `data_imagem`, e a data
     * saiu da tela por decisão do chefe em 2026-08-20 (ver `legendaDoItem`). Ela
     * viaja no PUT mesmo assim, com o valor que já estava: o servidor grava
     * `data_imagem = dados.data_imagem || null`, então OMITIR apagaria a data
     * das dez imagens antigas que a têm.
     */
    const desenharRodape = (editando) => {
      clearChildren(rodape);
      if (!editando) {
        rodape.append(
          el('span', { className: 'campo-galeria__descricao', textContent: rotulo(imagem) }),
          el('small', { textContent: legendaDoItem(imagem) })
        );
        return;
      }

      // A CLASSE DO FORMULÁRIO, e não um estilo próprio: o foco, o tema escuro e
      // o estado desabilitado já vivem em `forms.css`, e uma cópia local deles
      // sairia do lugar na primeira troca de token.
      const entrada = el('input', {
        type: 'text',
        className: 'form-field__input campo-galeria__entrada',
        value: imagem.descricao || '',
        maxLength: 500,
        'aria-label': 'Descrição do arquivo',
        onKeyDown: (e) => {
          if (e.key === 'Enter') { e.preventDefault(); salvar(); }
          else if (e.key === 'Escape') { e.preventDefault(); desenharRodape(false); }
        },
      });

      // GRAVA NA HORA, como o resto das abas: o botão "Salvar" do formulário do
      // campo não inclui a galeria, e o texto da aba já diz isso.
      async function salvar() {
        const novo = entrada.value.trim();
        if (novo === (imagem.descricao || '')) { desenharRodape(false); return; }
        entrada.disabled = true;
        try {
          await atualizarImagemCampo(imagem.id, {
            descricao: novo || null,
            data_imagem: imagem.data_imagem
              ? String(imagem.data_imagem).slice(0, 10)
              : null,
          });
          // O OBJETO EM MEMÓRIA ACOMPANHA, e a grade NÃO se recarrega: rever a
          // lista buscaria de novo os bytes de toda a galeria (48 MB no campo de
          // Porto União) para trocar uma linha de texto. `itens` é o mesmo array
          // que a tela cheia lê, então mudá-lo aqui basta para os dois.
          imagem.descricao = novo || null;
          showSuccess('Descrição atualizada');
          desenharRodape(false);
        } catch (err) {
          entrada.disabled = false;
          showError(err.message || 'Erro ao salvar a descrição');
        }
      }

      rodape.append(
        entrada,
        el('div', { className: 'campo-galeria__edicao-acoes' }, [
          el('button', {
            className: 'btn btn--primary btn--sm',
            type: 'button',
            onClick: (e) => { e.stopPropagation(); salvar(); },
          }, ['Salvar']),
          el('button', {
            className: 'btn btn--text btn--sm',
            type: 'button',
            onClick: (e) => { e.stopPropagation(); desenharRodape(false); },
          }, ['Cancelar']),
        ])
      );
      entrada.focus();
      entrada.select();
    };

    desenharRodape(false);

    if (podeEditar) {
      item.appendChild(el('div', { className: 'campo-galeria__acoes' }, [
        el('button', {
          className: 'btn btn--text btn--sm',
          type: 'button',
          title: 'Editar a descrição',
          onClick: (e) => { e.stopPropagation(); desenharRodape(true); },
        }, [svgIcon(ICONS.edit, 14), 'Descrição']),
        el('button', {
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
        }, ['Remover']),
      ]));
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
    if (luz) { luz.fechar(); luz = null; }
    for (const url of blobs) URL.revokeObjectURL(url);
    blobs.length = 0;
  }

  return { element, recarregar, cleanup };
}
