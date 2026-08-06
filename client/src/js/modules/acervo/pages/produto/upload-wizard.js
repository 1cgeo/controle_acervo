import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { createWizardStepper } from '@components/wizard-stepper.js';
import { createTextField, createSelectField } from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  getTiposArquivo,
  getSituacoesCarregamento,
  enviarVersaoComArquivos,
  enviarProdutoComArquivos,
  enviarArquivosEmVersao,
} from '@modules/acervo/services/acervo-service.js';

/**
 * Assistente de carregamento: a versão REGULAR, que nasce com o arquivo.
 *
 * POR QUE ELE EXISTE. Versão Regular é a única que não se cadastra sozinha: o
 * arquivo é o que a define, e o servidor não tem rota que crie uma sem ele. Sem
 * esta tela, o único caminho seria o plugin do QGIS, que copia os bytes por SMB
 * e exige QGIS instalado mais acesso ao compartilhamento.
 *
 * TRÊS MODOS, e o `modo` os separa:
 *
 *   'produto'  - produto novo, com a primeira versão e os arquivos dela;
 *   'versao'   - versão nova, com arquivos, em produto que já existe;
 *   'arquivos' - arquivos numa versão que já existe. É o que COMPLETA a versão
 *                Planejada, que nasce sem arquivo de propósito e o recebe nesta
 *                mesma versão quando a produção termina. O tipo dela não muda
 *                por ganhar arquivo: quem quiser mudar edita a versão.
 *
 * A tela é a MESMA nos três: o que muda é o que já está decidido quando ela
 * abre, e a rota que recebe. Três assistentes divergiriam na primeira regra
 * nova de arquivo.
 *
 * UMA REQUISIÇÃO. Metadados e bytes vão juntos. Não há sessão a abrir nem a fechar:
 * como os bytes vêm dentro da requisição, não existe janela entre reservar o
 * destino e gravar, e portanto não há o que uma sessão cobrisse. É o mesmo
 * raciocínio que `/catalogar/product` já registrou. Ou tudo entra no acervo, ou
 * nada entra, e o que falha não deixa linha pendurada em `upload_session` nem
 * `.parcial` esperando alguém rodar a limpeza. Não há cron: a sessão vence em
 * 24 h, e quem a fecha é o botão de manutenção.
 *
 * O custo, deliberado: a queda no meio custa o envio inteiro, e não só o arquivo
 * que falhou. Vale porque o teto do caminho web é de poucos GB e a mediana em
 * produção é de 6 a 11 MB; acima disso o caminho continua sendo o plugin.
 *
 * O NOME NO VOLUME NÃO SAI DAQUI. Ele é derivado dos metadados pelo servidor,
 * por `acervo.nome_arquivo_padrao` -- a mesma função que o invariante `7a` usa
 * para auditar, e "auditor e escritor são a mesma regra" já estava escrito em
 * `renomearPadrao`. Com o cliente nomeando, cada envio pela web cria uma linha
 * de DEFECT no `7a`.
 *
 * Também não saem daqui a extensão (vem do arquivo escolhido), o checksum nem o
 * tamanho (o servidor os mede enquanto grava). Mandá-los é 400.
 */

// dominio.tipo_arquivo. Tileserver e URL de servico, e nao byte: nao ha o que
// enviar por aqui.
const TIPO_ARQUIVO_TILESERVER = 9;
// dominio.tipo_arquivo: 1 = Arquivo principal, o caso da esmagadora maioria.
const TIPO_ARQUIVO_PRINCIPAL = 1;
// dominio.situacao_carregamento: 1 = Nao carregado. O arquivo entra no acervo, e
// publica-lo no BDGEx e outro ato, feito depois e por outra pessoa.
const SITUACAO_NAO_CARREGADO = 1;

/**
 * Plural de verdade, em vez de "1 arquivo(s)".
 *
 * Copia da funcao de mesmo nome em `busca/produto-dialog.js`, e nao um import:
 * aquele modulo importa ESTE, e a volta fecharia um ciclo. Sao tres linhas, e o
 * "(s)" existe para o programador nao pensar -- quem paga e quem le.
 *
 * @param {number} n
 * @param {string} singular
 * @param {string} plural_
 */
function plural(n, singular, plural_) {
  const total = Number(n) || 0;
  return `${total} ${total === 1 ? singular : plural_}`;
}

/** Nome sem extensão e extensão, a partir do arquivo escolhido. */
export function partesDoArquivo(nomeCompleto) {
  const ponto = String(nomeCompleto || '').lastIndexOf('.');
  const semExtensao = ponto > 0 ? nomeCompleto.slice(0, ponto) : (nomeCompleto || '');
  const extensao = ponto > 0 ? nomeCompleto.slice(ponto + 1).toLowerCase() : '';
  return { semExtensao, extensao };
}

/**
 * As extensões que aparecem mais de uma vez na lista.
 *
 * O nome físico é UM por versão -- `acervo.nome_arquivo_padrao` não recebe o
 * tipo de arquivo --, e quem separa os arquivos no volume é a extensão. Dois
 * PDFs na mesma versão receberiam o mesmo nome. O servidor recusa; a tela avisa
 * antes, para a pessoa não descobrir isso depois de subir os bytes.
 */
export function extensoesRepetidas(itens) {
  const vistas = new Set();
  const repetidas = new Set();
  for (const i of itens || []) {
    if (vistas.has(i.extensao)) repetidas.add(i.extensao);
    vistas.add(i.extensao);
  }
  return [...repetidas];
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
 * @param {'produto'|'versao'|'arquivos'} [opcoes.modo='versao']
 * @param {number} [opcoes.produtoId] - modo 'versao'
 * @param {Object} [opcoes.produto] - modo 'produto': o corpo do produto, já
 *   validado pelo formulário (com `geom` em EWKT)
 * @param {number} [opcoes.versaoId] - modo 'arquivos'
 * @param {string} [opcoes.produtoNome]
 * @param {Object} [opcoes.versao] - o corpo da versão, já validado pelo
 *   versao-dialog. Ausente no modo 'arquivos', onde ela já está gravada.
 * @param {string} [opcoes.rotuloVersao] - modo 'arquivos', só para a tela
 * @param {Function} [opcoes.onConcluido]
 */
export function abrirAssistenteUpload({
  modo = 'versao',
  produtoId,
  produto,
  versaoId,
  produtoNome,
  versao,
  rotuloVersao,
  onConcluido,
}) {
  // O rótulo que a tela mostra. No modo 'arquivos' a versão já existe, então ele
  // vem pronto; nos outros sai do corpo que o formulário montou.
  const rotulo = versao ? versao.versao : (rotuloVersao || '');
  // Cada item: { arquivo: File, nome, extensao, tipoArquivoId, situacaoId }.
  // NÃO há `nomeFisico`: quem nomeia é o servidor.
  let itens = [];
  let etapa = 0;
  let enviando = false;
  let envio = null;
  let progresso = 0;
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
      textContent: 'O servidor grava no volume, mede o checksum e nomeia o arquivo pelo '
        + 'padrão do acervo. Arquivo muito grande continua entrando pelo plugin do QGIS.',
    }),
  ]);

  function acrescentar(arquivos) {
    for (const arquivo of arquivos) {
      const { semExtensao, extensao } = partesDoArquivo(arquivo.name);
      itens.push({
        arquivo,
        // O rótulo humano, que aparece na ficha. Não é o nome no volume.
        nome: semExtensao,
        extensao,
        tipoArquivoId: TIPO_ARQUIVO_PRINCIPAL,
        situacaoId: SITUACAO_NAO_CARREGADO,
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
      helpText: 'Como o arquivo aparece na ficha. O nome no volume é outro, e quem o define '
        + 'é o servidor, pelo padrão do acervo.',
      onInput: (v) => { item.nome = v; },
    });

    const campoTipo = createSelectField({
      label: 'Tipo de arquivo',
      value: String(item.tipoArquivoId),
      options: tiposArquivo
        .filter(t => Number(t.code) !== TIPO_ARQUIVO_TILESERVER)
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
        el('span', {
          className: 'envio-item__extensao',
          textContent: item.extensao ? `.${item.extensao}` : 'sem extensão',
        }),
        el('span', {
          className: 'envio-item__tamanho',
          textContent: formatarBytes(item.arquivo.size),
        }),
        el('button', {
          className: 'btn btn--text btn--sm',
          type: 'button',
          title: 'Tirar este arquivo da lista',
          onClick: () => removerItem(item),
        }, ['Remover']),
      ]),
      el('div', { className: 'envio-item__campos' }, [
        campoNome.element, campoTipo.element, campoSituacao.element,
      ]),
    ]);
  }

  // ------------------------------------------------------------ envio

  async function enviar() {
    if (enviando) return;
    enviando = true;
    progresso = 0;
    pintar();

    try {
      // A ORDEM importa: o servidor casa o n-ésimo arquivo do multipart com a
      // n-ésima descrição. Por isso as duas listas saem do MESMO array.
      const descricoes = itens.map(i => ({
        nome: i.nome,
        tipo_arquivo_id: i.tipoArquivoId,
        situacao_carregamento_id: i.situacaoId,
      }));

      // Cada modo manda o mínimo que a sua rota precisa, e nada além: mandar
      // produto ou versão no modo 'arquivos' seria oferecer a esta rota a chance
      // de editar o que ela não é dona.
      const corpoPorModo = {
        produto: {
          dados: { produto, versao, arquivos: descricoes },
          enviar: enviarProdutoComArquivos,
        },
        versao: {
          dados: { produto_id: produtoId, versao, arquivos: descricoes },
          enviar: enviarVersaoComArquivos,
        },
        arquivos: {
          dados: { versao_id: versaoId, arquivos: descricoes },
          enviar: enviarArquivosEmVersao,
        },
      }[modo];

      envio = corpoPorModo.enviar(
        corpoPorModo.dados,
        itens.map(i => i.arquivo),
        (info) => {
          if (info.porcentagem !== null) progresso = info.porcentagem;
          if (!fechado) pintar();
        }
      );

      const resultado = await envio.promessa;
      if (fechado) return;

      const total = resultado.arquivos.length;
      const quantos = plural(total, 'arquivo', 'arquivos');
      showSuccess(modo === 'arquivos'
        ? `${quantos} ${total === 1 ? 'acrescentado' : 'acrescentados'} à versão `
          + `${rotulo}, no volume como "${resultado.nome_arquivo}"`
        : `Versão ${rotulo} criada com ${quantos}, no volume como `
          + `"${resultado.nome_arquivo}"`);
      if (onConcluido) onConcluido();
      modal.close();
    } catch (erro) {
      if (!fechado) showError(erro.message || 'Não foi possível concluir o envio');
    } finally {
      envio = null;
      enviando = false;
      if (!fechado) pintar();
    }
  }

  // ------------------------------------------------------------ desenho

  const rodape = el('div', { className: 'envio-assistente__rodape' });

  function pintar() {
    stepper.setActive(etapa);

    if (etapa === 0) {
      const repetidas = extensoesRepetidas(itens);
      corpo.replaceChildren(
        el('p', {
          className: 'envio-assistente__resumo',
          textContent: modo === 'arquivos'
            ? `Acrescentando arquivos à versão ${rotulo} de ${produtoNome || 'produto'}. `
              + 'Eles recebem o mesmo nome no volume que os que já estão lá, e o que '
              + 'os separa é a extensão.'
            : `Versão ${rotulo} de ${produtoNome || 'produto novo'}. `
              + 'Escolha os arquivos que a definem.',
        }),
        zona,
        entrada,
        ...itens.map(linhaDeArquivo),
        repetidas.length
          ? el('p', {
              className: 'envio-assistente__erro',
              textContent: `Dois arquivos com a extensão .${repetidas.join(', .')}. O nome no `
                + 'volume é um só por versão, e é a extensão que separa os arquivos: os dois '
                + 'receberiam o mesmo nome. Deixe um de cada formato, ou cadastre o outro '
                + 'noutra versão.',
            })
          : null,
      );
    } else {
      corpo.replaceChildren(
        el('p', {
          className: 'envio-assistente__resumo',
          textContent: 'Os dados da versão e os arquivos vão numa requisição só. O servidor '
            + 'grava cada byte no volume, mede o checksum e nomeia pelo padrão do acervo. '
            + 'Ou tudo entra, ou nada entra.',
        }),
        el('div', { className: 'envio-progresso' }, [
          el('div', { className: 'envio-progresso__topo' }, [
            el('span', {
              textContent: `${plural(itens.length, 'arquivo', 'arquivos')}, `
                + formatarBytes(itens.reduce((s, i) => s + i.arquivo.size, 0)),
            }),
            el('span', {
              className: 'envio-progresso__estado',
              textContent: enviando ? `${progresso}%` : 'pronto para enviar',
            }),
          ]),
          el('div', { className: 'envio-barra' }, [
            el('div', {
              className: 'envio-barra__preenchimento',
              style: { width: `${progresso}%` },
            }),
          ]),
        ]),
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
      // Sem extensão o servidor não sabe separar os arquivos no volume, e é ela
      // que distingue o principal do metadado sob o mesmo nome.
      avancar.disabled = itens.length === 0
        || itens.some(i => !i.extensao)
        || extensoesRepetidas(itens).length > 0;
      botoes.push(avancar);
    } else {
      const voltar = el('button', {
        className: 'btn btn--text',
        type: 'button',
        onClick: () => { etapa = 0; pintar(); },
      }, ['Voltar']);
      // Voltar durante o envio não: nada foi reservado no servidor, mas mexer na
      // lista com o corpo já subindo deixaria a tela mentindo sobre o que vai.
      voltar.disabled = enviando;

      const botaoEnviar = el('button', {
        className: 'btn btn--primary',
        type: 'button',
        onClick: () => enviar(),
      }, [enviando ? 'Enviando...' : 'Enviar']);
      botaoEnviar.disabled = enviando;

      botoes.push(voltar, botaoEnviar);
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
      // Fechar a tela não para o XHR: um envio de gigabytes seguiria correndo
      // invisível. Abortado, o servidor recebe o corpo truncado, falha e limpa
      // os `.parcial` dele mesmo -- não há sessão a cancelar.
      if (envio) envio.abortar();
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
