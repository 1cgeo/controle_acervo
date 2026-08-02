import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createWizardStepper } from '@components/wizard-stepper.js';
import { createTextField, createSelectField } from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  getTiposArquivo,
  getSituacoesCarregamento,
  prepararEnvioVersao,
  enviarBytesDoArquivo,
  confirmarEnvio,
  cancelarEnvio,
} from '@modules/acervo/services/acervo-service.js';

/**
 * Assistente de carregamento: a versão REGULAR, que nasce com o arquivo.
 *
 * POR QUE ELE EXISTE. Versão Regular é a única que não se cadastra sozinha: o
 * arquivo é o que a define, e o servidor não tem rota para criar uma sem ele
 * (`produto_ctrl.js:874-882`). Até 2026-08-01 o único caminho era o plugin do
 * QGIS, que copia os bytes para o volume por SMB -- e isso exige QGIS instalado
 * e acesso ao compartilhamento. Quem não tem os dois não catalogava nada.
 *
 * O CAMINHO DOS BYTES, e o que ele tem de diferente do plugin:
 *
 *   1. `prepare/version` reserva o destino e devolve um `temp_id` por arquivo.
 *   2. Um PUT POR ARQUIVO manda os bytes. Um por arquivo, e não um multipart com
 *      o lote todo, porque assim a queda no meio custa UM arquivo e a retomada é
 *      reenviar aquele, em vez de recomeçar os quatro.
 *   3. `confirm-upload` promove as linhas temporárias para o acervo.
 *
 * O CHECKSUM NÃO SAI DAQUI. Quem mede é o servidor, enquanto grava. O navegador
 * nem teria como: `crypto.subtle.digest` exige o arquivo inteiro na memória, e o
 * acervo tem arquivo de gigabytes. Mandá-lo é 400, de propósito -- descartado em
 * silêncio, esta tela acreditaria ter gravado o que mandou.
 *
 * A VERSÃO JÁ VEM PRONTA de `versao-dialog.js`, e não se digita de novo aqui. O
 * formulário de lá espelha o gatilho `acervo.validate_version` (formato do
 * rótulo, sequência, subtipo), e uma segunda cópia dessas regras divergiria da
 * primeira no dia em que uma das duas mudasse.
 */

/** Extensão e nome físico derivados do arquivo escolhido. */
function partesDoArquivo(nomeCompleto) {
  const ponto = nomeCompleto.lastIndexOf('.');
  const semExtensao = ponto > 0 ? nomeCompleto.slice(0, ponto) : nomeCompleto;
  const extensao = ponto > 0 ? nomeCompleto.slice(ponto + 1).toLowerCase() : '';
  return { semExtensao, extensao };
}

/**
 * Nome físico sugerido a partir do nome do arquivo escolhido.
 *
 * Tira acento e troca o que não é letra, número, hífen ou barra: o nome vira
 * caminho dentro do volume, e caractere de acentuação em nome de arquivo já
 * quebrou download em compartilhamento de rede. A barra sobrevive porque
 * subpasta é caso legítimo (`LOTE_1/IMAGENS/...`); a travessia quem recusa é o
 * servidor.
 */
function nomeFisicoSugerido(texto) {
  return texto
    .normalize('NFD').replace(/[̀-ͯ]/g, '')
    .replace(/[^A-Za-z0-9\-_/.]/g, '_')
    .replace(/_+/g, '_')
    .replace(/^_|_$/g, '');
}

function formatarBytes(bytes) {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
  return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
}

/**
 * Abre o assistente.
 *
 * @param {Object} opcoes
 * @param {number} opcoes.produtoId
 * @param {string} [opcoes.produtoNome]
 * @param {Object} opcoes.versao - o corpo da versão, já validado pelo versao-dialog
 * @param {Function} [opcoes.onConcluido] - chamado depois do confirm bem-sucedido
 */
export function abrirAssistenteUpload({ produtoId, produtoNome, versao, onConcluido }) {
  // Cada item: { arquivo: File, nome, nomeFisico, extensao, tipoArquivoId,
  //              situacaoId, estado, progresso, erro, tempId }
  let itens = [];
  let etapa = 0;
  let enviando = false;
  let sessao = null;
  let envioCorrente = null;
  let fechado = false;

  const stepper = createWizardStepper({ steps: ['Arquivos', 'Envio'] });
  const corpo = el('div', { className: 'envio-assistente__corpo' });

  let tiposArquivo = [];
  let situacoes = [];

  // ------------------------------------------------------------ etapa 1

  const entrada = el('input', {
    type: 'file',
    multiple: true,
    className: 'hidden',
    onChange: (e) => {
      acrescentar(Array.from(e.target.files || []));
      e.target.value = '';
    },
  });

  const zona = el('div', {
    className: 'envio-zona',
    onClick: () => entrada.click(),
    onDragOver: (e) => { e.preventDefault(); zona.classList.add('envio-zona--sobre'); },
    onDragLeave: () => zona.classList.remove('envio-zona--sobre'),
    onDrop: (e) => {
      e.preventDefault();
      zona.classList.remove('envio-zona--sobre');
      acrescentar(Array.from(e.dataTransfer.files || []));
    },
  }, [
    svgIcon(ICONS.add, 28),
    el('p', { textContent: 'Arraste os arquivos aqui, ou clique para escolher' }),
    el('p', {
      className: 'envio-zona__nota',
      textContent: 'O servidor grava no volume e mede o checksum. Arquivo muito grande '
        + 'continua entrando pelo plugin do QGIS, que copia direto para o volume.',
    }),
  ]);

  function acrescentar(arquivos) {
    for (const arquivo of arquivos) {
      const { semExtensao, extensao } = partesDoArquivo(arquivo.name);
      itens.push({
        arquivo,
        nome: semExtensao,
        nomeFisico: nomeFisicoSugerido(semExtensao),
        extensao,
        // 1 = Arquivo principal, que é o caso da esmagadora maioria.
        tipoArquivoId: 1,
        // 1 = Não carregado: o arquivo entra no acervo, e publicá-lo no BDGEx é
        // outro ato, feito depois e por outra pessoa.
        situacaoId: 1,
        estado: 'pendente',
        progresso: 0,
        erro: null,
        tempId: null,
      });
    }
    pintar();
  }

  function removerItem(alvo) {
    itens = itens.filter(i => i !== alvo);
    pintar();
  }

  function linhaDeArquivo(item) {
    const campoNome = createTextField({
      label: 'Nome',
      value: item.nome,
      onInput: (v) => { item.nome = v; },
    });

    const campoFisico = createTextField({
      label: 'Nome físico',
      value: item.nomeFisico,
      helpText: `Vira ${item.nomeFisico || '?'}.${item.extensao} no volume`,
      onInput: (v) => { item.nomeFisico = v; },
    });

    const campoTipo = createSelectField({
      label: 'Tipo de arquivo',
      value: String(item.tipoArquivoId),
      options: tiposArquivo
        // Tileserver e URL, e nao byte: nao ha o que enviar por aqui.
        .filter(t => Number(t.code) !== 9)
        .map(t => ({ value: String(t.code), label: t.nome })),
      onChange: (v) => { item.tipoArquivoId = Number(v); },
    });

    const campoSituacao = createSelectField({
      label: 'Situação de carregamento',
      value: String(item.situacaoId),
      options: situacoes.map(s => ({ value: String(s.code), label: s.nome })),
      onChange: (v) => { item.situacaoId = Number(v); },
    });

    return el('div', { className: 'envio-item' }, [
      el('div', { className: 'envio-item__cabecalho' }, [
        el('span', { className: 'envio-item__arquivo', textContent: item.arquivo.name }),
        el('span', { className: 'envio-item__tamanho', textContent: formatarBytes(item.arquivo.size) }),
        el('button', {
          className: 'btn btn--text btn--sm',
          type: 'button',
          title: 'Tirar este arquivo da lista',
          onClick: () => removerItem(item),
        }, ['Remover']),
      ]),
      el('div', { className: 'envio-item__campos' }, [
        campoNome.element, campoFisico.element,
        campoTipo.element, campoSituacao.element,
      ]),
    ]);
  }

  // ------------------------------------------------------------ etapa 2

  function linhaDeProgresso(item) {
    const barra = el('div', {
      className: 'envio-barra__preenchimento',
      style: { width: `${item.progresso}%` },
    });

    const rotulo = {
      pendente: 'aguardando',
      enviando: `${item.progresso}%`,
      ok: 'gravado no volume',
      erro: item.erro || 'falhou',
    }[item.estado];

    const linha = el('div', { className: `envio-progresso envio-progresso--${item.estado}` }, [
      el('div', { className: 'envio-progresso__topo' }, [
        el('span', { textContent: `${item.nomeFisico}.${item.extensao}` }),
        el('span', { className: 'envio-progresso__estado', textContent: rotulo }),
      ]),
      el('div', { className: 'envio-barra' }, [barra]),
    ]);

    // Reenviar SO o que falhou: a sessao continua aberta e os outros arquivos
    // ja gravados nao voltam a subir.
    if (item.estado === 'erro' && !enviando) {
      linha.appendChild(el('button', {
        className: 'btn btn--secondary btn--sm',
        type: 'button',
        onClick: () => enviarUm(item).then(pintar),
      }, ['Reenviar este arquivo']));
    }

    return linha;
  }

  // ------------------------------------------------------------ envio

  async function enviarUm(item) {
    if (!item.tempId) {
      item.estado = 'erro';
      item.erro = 'sem destino reservado';
      return false;
    }

    item.estado = 'enviando';
    item.progresso = 0;
    item.erro = null;
    pintar();

    try {
      envioCorrente = enviarBytesDoArquivo(sessao, item.tempId, item.arquivo, (info) => {
        item.progresso = info.porcentagem === null ? item.progresso : info.porcentagem;
        pintar();
      });
      await envioCorrente.promessa;
      item.estado = 'ok';
      item.progresso = 100;
      return true;
    } catch (erro) {
      item.estado = 'erro';
      item.erro = erro.message || 'falha no envio';
      return false;
    } finally {
      envioCorrente = null;
      pintar();
    }
  }

  async function enviarTudo() {
    if (enviando) return;
    enviando = true;
    pintar();

    try {
      if (!sessao) {
        const preparo = await prepararEnvioVersao([{
          produto_id: produtoId,
          versao,
          arquivos: itens.map(i => ({
            nome: i.nome,
            nome_arquivo: i.nomeFisico,
            tipo_arquivo_id: i.tipoArquivoId,
            extensao: i.extensao,
            situacao_carregamento_id: i.situacaoId,
          })),
        }]);

        sessao = preparo.session_uuid;
        // O pareamento e por ORDEM porque o prepare devolve os arquivos na ordem
        // em que foram mandados, e e uma sessao so. O `nome_arquivo` confirma.
        preparo.arquivos.forEach((devolvido, i) => {
          if (itens[i]) itens[i].tempId = devolvido.temp_id;
        });
      }

      // Um de cada vez, e nao em paralelo: sao bytes indo para o MESMO volume,
      // e disputar a banda entre quatro envios so faz os quatro demorarem mais,
      // com quatro barras andando devagar em vez de uma andando rapido.
      for (const item of itens) {
        if (fechado) return;
        if (item.estado === 'ok') continue;
        await enviarUm(item);
      }

      if (itens.some(i => i.estado !== 'ok')) {
        showError('Alguns arquivos não subiram. Reenvie os que falharam e confirme depois.');
        return;
      }

      const resultado = await confirmarEnvio(sessao);
      if (resultado && resultado.status === 'failed') {
        showError(resultado.error_message || 'A validação do envio falhou');
        return;
      }

      showSuccess(`Versão ${versao.versao} criada com ${itens.length} arquivo(s)`);
      sessao = null;
      if (onConcluido) onConcluido();
      modal.close();
    } catch (erro) {
      showError(erro.message || 'Não foi possível concluir o envio');
    } finally {
      enviando = false;
      pintar();
    }
  }

  // ------------------------------------------------------------ desenho

  const rodape = el('div', { className: 'envio-assistente__rodape' });

  function pintar() {
    stepper.setActive(etapa);

    if (etapa === 0) {
      corpo.replaceChildren(
        el('p', { className: 'envio-assistente__resumo', textContent:
          `Versão ${versao.versao} de ${produtoNome || `produto ${produtoId}`}. `
          + 'Escolha os arquivos que a definem.' }),
        zona,
        entrada,
        ...itens.map(linhaDeArquivo),
      );
    } else {
      corpo.replaceChildren(
        el('p', { className: 'envio-assistente__resumo', textContent:
          'O servidor grava cada arquivo no volume e mede o checksum enquanto grava. '
          + 'A versão só entra no acervo depois que todos subirem.' }),
        ...itens.map(linhaDeProgresso),
      );
    }

    pintarRodape();
  }

  function pintarRodape() {
    const botoes = [];

    if (etapa === 0) {
      const avancar = el('button', {
        className: 'btn btn--primary',
        type: 'button',
        onClick: () => { etapa = 1; pintar(); },
      }, ['Continuar para o envio']);
      avancar.disabled = itens.length === 0
        || itens.some(i => !i.nomeFisico || !i.extensao);
      botoes.push(avancar);
    } else {
      const voltar = el('button', {
        className: 'btn btn--text',
        type: 'button',
        onClick: () => { etapa = 0; pintar(); },
      }, ['Voltar']);
      // Voltar depois de abrir a sessao mudaria a lista sob um destino ja
      // reservado, e o prepare nao seria refeito.
      voltar.disabled = enviando || Boolean(sessao);

      const enviar = el('button', {
        className: 'btn btn--primary',
        type: 'button',
        onClick: () => enviarTudo(),
      }, [enviando ? 'Enviando...' : 'Enviar os arquivos']);
      enviar.disabled = enviando;

      botoes.push(voltar, enviar);
    }

    rodape.replaceChildren(...botoes);
  }

  const conteudo = el('div', { className: 'envio-assistente' }, [
    stepper.element, corpo, rodape,
  ]);

  const modal = openModal({
    title: 'Carregamento de versão',
    content: conteudo,
    width: '820px',
    onClose: () => {
      fechado = true;
      // Parar a subida em curso: esconder a tela nao para o XHR, e um envio de
      // gigabytes seguiria correndo invisivel.
      if (envioCorrente) envioCorrente.abortar();
      // Sessao aberta sem confirmacao vira lixo no volume (os `.parcial`) e
      // linha pendurada em `upload_session`. O cancel apaga os dois. Falhar aqui
      // nao tem o que fazer: o cron de 24 h limpa o que sobrar.
      if (sessao) cancelarEnvio(sessao).catch(() => {});
    },
  });

  // Os domínios chegam depois; a tela abre antes para o clique não parecer morto.
  Promise.all([
    getTiposArquivo().catch(() => []),
    getSituacoesCarregamento().catch(() => []),
  ]).then(([tipos, sits]) => {
    if (fechado) return;
    tiposArquivo = tipos || [];
    situacoes = sits || [];
    pintar();
  });

  pintar();

  return modal;
}
