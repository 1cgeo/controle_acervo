import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { chip } from '@components/status-chip.js';
import { showError, showSuccess } from '@utils/toast.js';
import { permissoes } from '@store/auth-store.js';
import { criarHistorico } from '@components/historico/historico.js';
import {
  getProdutoDetalhado,
  getMiniaturaVersao,
  baixarArquivoDoAcervo,
  getTiposRelacionamento,
  getRelacionamentos,
  criarRelacionamentos,
  atualizarRelacionamentos,
  excluirRelacionamentos,
  excluirProdutos,
  excluirVersoes,
} from '@modules/acervo/services/acervo-service.js';
import { openProdutoDialogForm } from '@modules/acervo/pages/produto/produto-dialog-form.js';
import { openVersaoDialog } from '@modules/acervo/pages/produto/versao-dialog.js';
import { abrirAssistenteUpload } from '@modules/acervo/pages/produto/upload-wizard.js';
import { abrirSeletorVersao } from '@modules/acervo/pages/produto/seletor-versao.js';

/**
 * Ficha do produto.
 *
 * O DESENHO, e o que ele corrige (chefe, 2026-07-31: "a UI e UX esta ruim").
 * A ficha anterior era uma pilha de linhas rotulo-valor, todas com o mesmo peso
 * visual, e sem CSS proprio: MI, INOM, escala, descricao e data de cadastro
 * saiam iguais, e cada versao repetia o mesmo bloco de metadado administrativo
 * ANTES dos arquivos, que e o que a pessoa veio buscar. Tres mudancas:
 *
 *   1. IMAGEM. Quem procura carta reconhece a folha OLHANDO. A miniatura entra
 *      ao lado de cada versao, e a mais recente abre com a imagem maior. Sem
 *      imagem (produto so vetorial), o espaco nao fica vazio: entra uma marca
 *      dizendo que aquela versao nao tem raster.
 *   2. HIERARQUIA. A identificacao vira uma faixa de fatos curtos (MI, INOM,
 *      escala, versoes), com o valor grande e o rotulo pequeno. Na versao, o
 *      que sobe sao os ARQUIVOS; o metadado administrativo (orgao, lote,
 *      projeto, datas) desce para uma linha unica separada por ponto.
 *   3. RELACIONAMENTOS. O servidor sempre mandou, e a tela jogava fora. Agora
 *      aparecem, com o nome do produto relacionado, e navegam para ele.
 */

const LARGURA_MODAL = '1040px';

/**
 * Plural de verdade, em vez de "1 versão(ões)".
 *
 * O "(s)" e "(ões)" existem para o programador nao pensar, e o preco quem paga
 * e quem le. Com a contagem em maos, escolher a palavra e uma linha.
 * @param {number} n
 * @param {string} singular
 * @param {string} plural
 */
export function plural(n, singular, plural_) {
  const total = Number(n) || 0;
  return `${formatNumber(total)} ${total === 1 ? singular : plural_}`;
}

// Tileserver e uma URL de servico, sem byte em volume nenhum; status diferente de
// 'Carregado' (1) significa que o carregamento ou a exclusao falhou, e o byte no
// volume pode estar pela metade. O servidor recusa os dois casos, e a tela
// desabilita o botao para nao prometer um download que vai dar erro.
const TIPO_ARQUIVO_TILESERVER = 9;
const STATUS_ARQUIVO_CARREGADO = 1;

function podeBaixar(a) {
  return Boolean(a.uuid_arquivo)
    && a.tipo_arquivo_id !== TIPO_ARQUIVO_TILESERVER
    && (a.tipo_status_id == null || a.tipo_status_id === STATUS_ARQUIVO_CARREGADO);
}

/** Nome fisico do arquivo, que e o que a pessoa encontra no disco. */
function nomeFisico(a) {
  return a.extensao ? `${a.nome_arquivo}.${a.extensao}` : a.nome_arquivo;
}

/**
 * Um fato da faixa de identificacao: valor grande em cima, rotulo pequeno
 * embaixo. E o inverso da linha rotulo-valor, e e o que faz MI e INOM saltarem
 * aos olhos: sao eles que identificam a folha, nao a palavra "MI".
 */
// dominio.tipo_versao. Espelha o que `versao-dialog.js` ja declara; o valor vive
// aqui com o nome que ele tem no banco.
const TIPO_VERSAO_HISTORICA = 2;
const TIPO_VERSAO_PLANEJADA = 3;

/**
 * O chip da versao sem arquivo, dizendo QUAL e o caso.
 *
 * `tipo_versao_id` sempre chegou na resposta e a tela nunca o usou.
 */
function chipSemArquivo(v) {
  const tipo = Number(v.tipo_versao_id);
  if (tipo === TIPO_VERSAO_PLANEJADA) return chip('Planejada, ainda sem arquivo', 'warning');
  if (tipo === TIPO_VERSAO_HISTORICA) return chip('Registro histórico, sem arquivo', 'default');
  return chip('Sem arquivo digital', 'default');
}

function fato(rotulo, valor, mono = false) {
  if (valor == null || valor === '') return null;
  return el('div', { className: 'ficha-fato' }, [
    el('span', {
      className: `ficha-fato__valor${mono ? ' ficha-fato__valor--mono' : ''}`,
      textContent: String(valor),
    }),
    el('span', { className: 'ficha-fato__rotulo', textContent: rotulo }),
  ]);
}

/**
 * Fatos administrativos da versao, numa linha so, separados por ponto.
 *
 * O separador entra DENTRO do item seguinte, e nao entre os dois. Sendo um
 * elemento proprio, ele quebrava linha sozinho e a linha terminava com um "·"
 * orfao, apontando para nada.
 */
function linhaMeta(partes) {
  const vivos = partes.filter(p => p && p.valor);
  if (!vivos.length) return null;

  return el('div', { className: 'ficha-meta' }, vivos.map((p, i) => (
    el('span', { className: 'ficha-meta__item' }, [
      i ? el('span', { className: 'ficha-meta__ponto', textContent: '· ' }) : null,
      el('span', { className: 'ficha-meta__rotulo', textContent: `${p.rotulo} ` }),
      el('span', { className: 'ficha-meta__valor', textContent: p.valor }),
    ].filter(Boolean))
  )));
}

/**
 * Botao de baixar UM arquivo do acervo.
 *
 * O servidor le o volume e faz stream, entao o navegador nunca ve caminho de
 * rede. O nome do arquivo baixado e o nome FISICO, derivado do cadastro: e o
 * mesmo nome que o plugin do QGIS recebe, e o que a pessoa espera no disco.
 * @param {Object} a - arquivo da ficha
 */
function botaoBaixar(a) {
  const nome = nomeFisico(a);

  const botao = el('button', {
    className: 'btn btn--text btn--sm ficha-arquivo__baixar',
    type: 'button',
    title: podeBaixar(a) ? `Baixar ${nome}` : 'Este arquivo não tem download',
  }, [svgIcon(ICONS.download, 14), 'Baixar']);

  if (!podeBaixar(a)) {
    botao.disabled = true;
    return botao;
  }

  botao.addEventListener('click', async () => {
    // A referencia vem do FECHAMENTO, e nao de `e.currentTarget`: depois do
    // primeiro await o evento terminou e `currentTarget` e null, entao o botao
    // ficaria travado para sempre depois de uma falha.
    botao.disabled = true;
    try {
      await baixarArquivoDoAcervo(a.uuid_arquivo, nome);
    } catch (erro) {
      showError(erro.message || 'Não foi possível baixar o arquivo');
    } finally {
      botao.disabled = false;
    }
  });

  return botao;
}

/**
 * Uma linha de arquivo.
 *
 * O NOME que aparece e o fisico, e nao o rotulo do cadastro, porque e o nome
 * fisico que sai no download e que a pessoa vai procurar depois. O rotulo do
 * cadastro (`nome`) vira o titulo, para quem quiser conferir.
 */
function linhaArquivo(a) {
  const tamanho = a.tamanho_mb != null
    ? `${formatNumber(Number(a.tamanho_mb).toFixed(1))} MB`
    : '';

  return el('li', { className: 'ficha-arquivo', title: a.nome || '' }, [
    svgIcon(ICONS.description, 16),
    el('span', { className: 'ficha-arquivo__nome', textContent: nomeFisico(a) || 'arquivo' }),
    a.tipo_arquivo
      ? el('span', { className: 'ficha-arquivo__tipo', textContent: a.tipo_arquivo })
      : null,
    el('span', { className: 'ficha-arquivo__tamanho', textContent: tamanho }),
    // O CHECKSUM, abreviado. Ele sempre veio na resposta e a tela o descartava.
    // E o que prova que o byte no volume e o byte catalogado, e e o primeiro
    // dado que se compara quando alguem desconfia do arquivo. Inteiro nao cabe
    // na linha; os 12 primeiros ja distinguem, e o `title` traz o completo para
    // copiar.
    a.checksum
      ? el('span', {
        className: 'ficha-arquivo__checksum',
        title: `SHA-256: ${a.checksum}`,
        textContent: String(a.checksum).slice(0, 12),
      })
      : null,
    botaoBaixar(a),
  ].filter(Boolean));
}

/**
 * Troca o TIPO de uma relacao ja gravada.
 *
 * A direcao (`versao_id_1`, `versao_id_2`) vem da LISTA do servidor, e nao da
 * ficha: a ficha resolve "a outra ponta" por um CASE e nao diz qual das duas e a
 * primeira. Chutar a ordem inverteria o sentido da relacao de Insumo em
 * silencio, e e por esse sentido que a deteccao de ciclo caminha. O PUT exige as
 * duas, entao le-las e a unica forma de trocar SO o tipo.
 */
async function trocarTipoRelacao(r, novoTipo, select, recarregar) {
  select.disabled = true;
  try {
    const todos = await getRelacionamentos();
    const linha = (todos || []).find(x => Number(x.id) === Number(r.id));
    if (!linha) {
      throw new Error('Esta relação não existe mais. Feche e abra a ficha de novo.');
    }
    await atualizarRelacionamentos([{
      id: Number(linha.id),
      versao_id_1: Number(linha.versao_id_1),
      versao_id_2: Number(linha.versao_id_2),
      tipo_relacionamento_id: Number(novoTipo),
    }]);
    showSuccess('Tipo da relação atualizado');
    await recarregar();
  } catch (erro) {
    showError(erro.message || 'Erro ao trocar o tipo da relação');
    // Volta ao valor gravado: deixar o `<select>` mostrando a escolha que NAO
    // foi gravada faria a tela mentir sobre o que esta no banco.
    select.value = String(r.tipo_relacionamento_id);
    select.disabled = false;
  }
}

async function removerRelacao(r, recarregar) {
  const alvo = [r.produto_relacionado, r.versao_relacionada].filter(Boolean).join(', ')
    || `versão ${r.versao_relacionada_id}`;

  const ok = await confirmDialog({
    title: 'Remover relação',
    message: `Remover a relação "${r.tipo_relacionamento || 'Relação'}" com ${alvo}? `
      + 'O vínculo é apagado de vez: não há tabela de relações excluídas, e recriá-lo '
      + 'exige escolher as duas versões de novo.',
    confirmLabel: 'Remover',
    danger: true,
  });
  if (!ok) return;

  try {
    await excluirRelacionamentos([Number(r.id)]);
    showSuccess('Relação removida');
    await recarregar();
  } catch (erro) {
    showError(erro.message || 'Erro ao remover a relação');
  }
}

/**
 * Acrescenta uma relacao entre ESTA versao e outra, escolhida no seletor.
 *
 * A versao gravada em `versao_id_1` e a desta ficha, e a escolhida vai em
 * `versao_id_2`. E o que o rotulo do campo diz, para ninguem ter de deduzir o
 * sentido depois.
 *
 * O servidor recusa auto-relacionamento, par duplicado (409) e CICLO em relacao
 * de Insumo. Nada disso e refeito aqui: a deteccao de ciclo percorre o grafo
 * INTEIRO dentro da transacao, e uma copia no navegador so poderia responder
 * pelo pedaco que ela conhece, dizendo "pode" onde o servidor diz "nao".
 */
async function acrescentarRelacao(versaoId, tipoRelacionamentoId, recarregar) {
  const escolha = await abrirSeletorVersao({
    titulo: 'Relacionar a outra versão',
    versaoExcluida: versaoId,
  });
  if (!escolha) return;

  try {
    await criarRelacionamentos([{
      versao_id_1: Number(versaoId),
      versao_id_2: Number(escolha.versao_id),
      tipo_relacionamento_id: Number(tipoRelacionamentoId),
    }]);
    showSuccess(`Relação com ${escolha.produto_nome}, ${escolha.rotulo}, criada`);
    await recarregar();
  } catch (erro) {
    showError(erro.message || 'Erro ao criar a relação');
  }
}

/**
 * Relacionamentos da versao.
 *
 * O servidor sempre devolveu isto e a tela anterior descartava em silencio. Um
 * insumo ou um conjunto e informacao de proveniencia: e o que responde "de onde
 * veio esta carta". Cada item leva para a ficha do produto relacionado.
 *
 * Desde 2026-08-02 o bloco tambem ESCREVE, atras do perfil: acrescentar e trocar
 * o tipo sao operador, remover e gerente, espelhando as rotas. O perfil no
 * client e ergonomia (esconder o que vai dar 403); quem barra e o `verifyPerfil`.
 *
 * Quando nao ha relacao nenhuma o bloco so aparece para quem pode acrescentar:
 * para quem so consulta, um titulo "Relacionadas" seguido de nada seria uma
 * pergunta sem resposta.
 */
function blocoRelacionamentos(versao, ctx) {
  const { pode, irParaProduto, tiposRelacionamento, recarregar } = ctx;
  const relacionamentos = versao.relacionamentos || [];

  if (!relacionamentos.length && !pode.operador) return null;

  const nomeTipo = (code) => {
    const achado = (tiposRelacionamento || []).find(t => Number(t.code) === Number(code));
    return achado ? achado.nome : null;
  };

  const itens = relacionamentos.map((r) => {
    const alvo = [r.produto_relacionado, r.versao_relacionada].filter(Boolean).join(', ');

    // Com perfil de operador o tipo vira um `<select>`; sem ele continua sendo a
    // marca de leitura que sempre foi.
    const marca = pode.operador
      ? el('select', {
        className: 'ficha-relacionamentos__tipo',
        'aria-label': 'Tipo da relação',
        onChange: (e) => {
          e.stopPropagation();
          trocarTipoRelacao(r, e.target.value, e.target, recarregar);
        },
        onClick: (e) => e.stopPropagation(),
      }, (tiposRelacionamento || []).map(t => el('option', {
        value: String(t.code),
        textContent: t.nome,
        selected: Number(t.code) === Number(r.tipo_relacionamento_id) ? 'selected' : null,
      })))
      : chip(r.tipo_relacionamento || nomeTipo(r.tipo_relacionamento_id) || 'Relação', 'secondary');

    const rotuloAlvo = el('span', {
      className: 'ficha-relacionamentos__alvo',
      textContent: alvo || `versão ${r.versao_relacionada_id}`,
    });

    // So vira link quando ha para onde ir. Relacionamento apontando para
    // versao apagada continua aparecendo (a proveniencia existiu), mas como
    // texto: link que nao leva a lugar nenhum e pior que texto.
    const destino = r.produto_relacionado_id
      ? el('button', {
        className: 'ficha-relacionamentos__link',
        type: 'button',
        title: `Abrir a ficha de ${alvo}`,
        onClick: () => irParaProduto({
          id: Number(r.produto_relacionado_id),
          nome: r.produto_relacionado,
        }),
      }, [rotuloAlvo])
      : rotuloAlvo;

    return el('li', { className: 'ficha-relacionamentos__item' }, [
      marca,
      destino,
      pode.gerente
        ? el('button', {
          className: 'btn btn--text btn--sm ficha-relacionamentos__remover',
          type: 'button',
          title: 'Remover esta relação',
          onClick: () => removerRelacao(r, recarregar),
        }, [svgIcon(ICONS.delete, 14)])
        : null,
    ].filter(Boolean));
  });

  // O tipo da relacao NOVA se escolhe antes de escolher a versao, e fica no
  // proprio botao: assim o seletor abre uma vez so e nao volta perguntando.
  let tipoNovo = (tiposRelacionamento || []).length
    ? String(tiposRelacionamento[0].code)
    : '';

  const barra = pode.operador
    ? el('div', { className: 'ficha-relacionamentos__acoes' }, [
      el('select', {
        className: 'ficha-relacionamentos__tipo',
        'aria-label': 'Tipo da relação a criar',
        onChange: (e) => { tipoNovo = e.target.value; },
      }, (tiposRelacionamento || []).map(t => el('option', {
        value: String(t.code),
        textContent: t.nome,
      }))),
      el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        // Diz o SENTIDO do que vai ser gravado: a relação parte desta versão.
        title: 'Cria a relação partindo desta versão para a que for escolhida',
        onClick: () => {
          if (!tipoNovo) {
            showError('Não foi possível carregar os tipos de relação');
            return;
          }
          acrescentarRelacao(versao.versao_id, tipoNovo, recarregar);
        },
      }, [svgIcon(ICONS.add, 14), 'Relacionar a outra versão']),
    ])
    : null;

  return el('div', { className: 'ficha-relacionamentos' }, [
    el('span', { className: 'ficha-relacionamentos__titulo', textContent: 'Relacionadas' }),
    itens.length
      ? el('ul', { className: 'ficha-relacionamentos__lista' }, itens)
      : el('p', {
        className: 'ficha-relacionamentos__vazio',
        textContent: 'Esta versão não tem relação com nenhuma outra.',
      }),
    barra,
  ].filter(Boolean));
}

/**
 * Painel da miniatura.
 *
 * A imagem chega DEPOIS da ficha, por uma segunda requisicao. O painel ja nasce
 * com a proporcao certa (largura e altura vem na ficha detalhada), para o bloco
 * nao pular de tamanho quando a imagem chega. Sem miniatura, o painel diz por
 * que, em vez de sumir: espaco vazio pareceria carregamento travado.
 *
 * @param {Object} v versao
 * @param {boolean} destaque a versao mais recente abre com a imagem maior
 * @param {Function} registrarUrl recebe a URL de objeto, para liberar no fim
 */
function painelMiniatura(v, destaque, registrarUrl) {
  const classe = `ficha-miniatura${destaque ? ' ficha-miniatura--destaque' : ''}`;

  if (!v.tem_miniatura) {
    return el('div', { className: `${classe} ficha-miniatura--vazia` }, [
      svgIcon(ICONS.layers, 20),
      el('span', { textContent: 'Sem imagem' }),
    ]);
  }

  const painel = el('div', { className: classe });

  // Reserva a proporcao antes de a imagem chegar. Sem isto, a lista inteira de
  // versoes salta para baixo a cada imagem que carrega.
  if (v.miniatura_largura && v.miniatura_altura) {
    painel.style.aspectRatio = `${v.miniatura_largura} / ${v.miniatura_altura}`;
  }

  getMiniaturaVersao(v.versao_id)
    .then((url) => {
      if (!url) {
        painel.classList.add('ficha-miniatura--vazia');
        painel.replaceChildren(el('span', { textContent: 'Sem imagem' }));
        return;
      }

      registrarUrl(url);

      painel.replaceChildren(el('img', {
        className: 'ficha-miniatura__img',
        src: url,
        alt: `Miniatura da versão ${v.versao || ''}`,
        loading: 'lazy',
      }));
    })
    .catch(() => {
      // Falha de imagem nao merece um aviso vermelho na tela: a ficha inteira
      // continua util sem ela.
      painel.classList.add('ficha-miniatura--vazia');
      painel.replaceChildren(el('span', { textContent: 'Imagem indisponível' }));
    });

  return painel;
}

/**
 * Uma versao do produto.
 *
 * Versao SEM arquivo aparece marcada, e nao escondida: "registrado, sem arquivo
 * digital" e informacao, e e o caso da versao historica (chefe, 2026-07-25).
 * Esconder faria a ficha mentir sobre quantas versoes existem.
 */
function blocoVersao(v, maisRecente, registrarUrl, ctx) {
  const arquivos = v.arquivos || [];
  const { pode, ficha, recarregar } = ctx;

  // Editar e excluir a versao moram no cabecalho DELA, e nao na barra do
  // produto: a ficha mostra varias versoes, e um botao "Editar versão" no rodape
  // do modal nao diria qual.
  const acoes = el('div', { className: 'ficha-versao__acoes' }, [
    // Acrescentar arquivo mora AQUI, e nao na barra do produto, pela mesma razao
    // que editar: a ficha mostra varias versoes, e o arquivo entra numa delas.
    //
    // E o que COMPLETA a versao Planejada, que nasce sem arquivo de proposito e
    // o recebe nesta MESMA versao quando a producao termina. Sem este botao, a
    // folha planejada pela web nao tinha como ser completada pela web.
    pode.operador
      ? el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        title: arquivos.length
          ? 'Acrescentar outro arquivo a esta versão'
          : 'Enviar o arquivo desta versão',
        onClick: () => abrirAssistenteUpload({
          modo: 'arquivos',
          versaoId: Number(v.versao_id ?? v.id),
          rotuloVersao: v.versao,
          produtoNome: ficha().nome,
          onConcluido: recarregar,
        }),
      }, [svgIcon(ICONS.add, 14), arquivos.length ? 'Mais arquivos' : 'Enviar arquivo'])
      : null,
    pode.operador
      ? el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        title: 'Editar esta versão',
        onClick: () => openVersaoDialog({
          produto: ficha(),
          versao: v,
          versoesExistentes: (ficha().versoes || []),
          onSaved: recarregar,
        }),
      }, [svgIcon(ICONS.edit, 14), 'Editar'])
      : null,
    pode.gerente
      ? el('button', {
        className: 'btn btn--text btn--sm',
        type: 'button',
        title: 'Excluir esta versão',
        onClick: () => excluirVersaoDaFicha(v, recarregar),
      }, [svgIcon(ICONS.delete, 14), 'Excluir'])
      : null,
  ].filter(Boolean));

  const cabecalho = el('div', { className: 'ficha-versao__cabecalho' }, [
    el('h4', {
      className: 'ficha-versao__titulo',
      textContent: v.versao || v.nome_versao || 'Versão',
    }),
    // A busca lista PRODUTOS e mostra no cartao a ultima edicao. Quem abre a
    // ficha vem atras das anteriores, e precisa saber num relance qual das
    // linhas e aquela que o cartao anunciou. A ordem (mais nova primeiro) vem do
    // servidor; a marca e o que a torna legivel sem contar datas.
    maisRecente ? chip('Mais recente', 'success') : null,
    // Versao SEM arquivo tem dois significados opostos, e "Sem arquivo digital"
    // fundia os dois: PLANEJADA e promessa de producao (a folha ainda nao
    // existe), REGISTRO HISTORICO e folha que existe no mundo e o acervo nao
    // tem o arquivo. Quem procura carta decide coisas diferentes em cada caso.
    arquivos.length
      ? chip(plural(arquivos.length, 'arquivo', 'arquivos'), 'info')
      : chipSemArquivo(v),
    acoes.childNodes.length ? acoes : null,
  ].filter(Boolean));

  const meta = linhaMeta([
    { rotulo: 'Edição', valor: formatDate(v.versao_data_edicao) },
    { rotulo: 'Criação', valor: formatDate(v.versao_data_criacao) },
    { rotulo: 'Órgão', valor: v.orgao_produtor },
    { rotulo: 'Lote', valor: v.lote_nome },
    { rotulo: 'Projeto', valor: v.projeto_nome },
  ]);

  const palavras = (v.palavras_chave || []).length
    ? el('div', { className: 'ficha-palavras' }, v.palavras_chave.map(p => chip(p, 'secondary')))
    : null;

  const listaArquivos = arquivos.length
    ? el('ul', { className: 'ficha-arquivos' }, arquivos.map(linhaArquivo))
    : null;

  return el('div', {
    className: `ficha-versao${maisRecente ? ' ficha-versao--destaque' : ''}`,
  }, [
    painelMiniatura(v, maisRecente, registrarUrl),
    el('div', { className: 'ficha-versao__corpo' }, [
      cabecalho,
      meta,
      v.versao_descricao
        ? el('p', { className: 'ficha-versao__descricao', textContent: v.versao_descricao })
        : null,
      palavras,
      listaArquivos,
      blocoRelacionamentos(v, ctx),
    ].filter(Boolean)),
  ]);
}

/**
 * Exclui UMA versao a partir da ficha.
 *
 * O motivo e exigido pelo servidor e nao e enfeite: a versao e os arquivos dela
 * vao para as tabelas `*_deletado`, e sem motivo a exclusao vira um registro
 * sumido sem historia. Por isso ele e digitado, e nao escolhido numa lista de
 * frases prontas.
 */
async function excluirVersaoDaFicha(v, recarregar) {
  const ok = await confirmDialog({
    title: `Excluir a versão ${v.versao || ''}`.trim(),
    message: 'A versão e os arquivos dela saem do acervo. As linhas ficam nas tabelas de '
      + 'exclusão e os bytes seguem no volume, mas o acervo deixa de enxergá-los.',
    confirmLabel: 'Excluir',
    danger: true,
  });
  if (!ok) return;

  const motivo = await pedirMotivo(`Motivo da exclusão da versão ${v.versao || ''}`.trim());
  if (motivo === null) return;

  try {
    await excluirVersoes([Number(v.versao_id)], motivo);
    showSuccess('Versão excluída com sucesso');
    await recarregar();
  } catch (erro) {
    showError(erro.message || 'Erro ao excluir a versão');
  }
}

/**
 * Pede o motivo da exclusao, DEPOIS da confirmacao.
 *
 * Sao dois passos porque sao duas coisas: o `confirmDialog` e a decisao (e e o
 * caminho de toda acao destrutiva desta interface), e isto aqui e o dado que o
 * servidor exige para gravar a lapide. Pedir o motivo antes de confirmar faria
 * quem fosse desistir escrever a justificativa a toa.
 *
 * O botao so fecha com o campo preenchido: o servidor recusa motivo vazio, e
 * descobrir isso depois seria refazer os dois passos.
 *
 * @param {string} titulo
 * @returns {Promise<string|null>} null quando desiste
 */
function pedirMotivo(titulo) {
  return new Promise((resolve) => {
    let valor = null;

    const campo = el('textarea', {
      className: 'form-field__textarea',
      rows: '3',
      placeholder: 'Por que este registro está sendo excluído?',
      'aria-label': 'Motivo da exclusão',
    });

    const erro = el('div', { className: 'form-field__error hidden' });

    const conteudo = el('div', { className: 'form-field' }, [
      el('label', { className: 'form-field__label', textContent: 'Motivo da exclusão' }),
      campo,
      erro,
    ]);

    openModal({
      title: titulo,
      content: conteudo,
      width: '520px',
      onClose: () => resolve(valor),
      actions: [
        { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
        {
          label: 'Excluir',
          variant: 'danger',
          onClick: ({ close }) => {
            const texto = campo.value.trim();
            if (!texto) {
              erro.textContent = 'Informe o motivo da exclusão';
              erro.classList.remove('hidden');
              return;
            }
            valor = texto;
            close();
          },
        },
      ],
    });
  });
}

/** Espaco reservado enquanto a ficha carrega, no formato do que vai chegar. */
function esqueleto() {
  return el('div', { className: 'ficha-esqueleto' }, [
    el('div', { className: 'ficha-esqueleto__faixa' }),
    el('div', { className: 'ficha-esqueleto__bloco' }),
    el('div', { className: 'ficha-esqueleto__bloco' }),
  ]);
}

/**
 * Ficha do produto: identificacao e todas as versoes.
 *
 * Recebe uma LISTA, e nao um produto, porque a busca permite selecionar varios.
 * Abrir uma janela por produto selecionado seria uma pilha de modais; aqui e um
 * modal so, com "anterior" e "proxima" percorrendo a selecao, e um contador
 * dizendo onde a pessoa esta.
 *
 * Abre com o esqueleto e busca depois: a ficha vem de um endpoint que traz
 * versoes, arquivos e relacionamentos, e prender o clique ate a resposta daria a
 * sensacao de que o botao nao funcionou.
 *
 * @param {Array<{id:number, nome:string}>|Object} produtos - a selecao, ou um so
 * @param {number} [indiceInicial]
 * @param {{onAlterado?:Function}} [opcoes] - `onAlterado` roda depois de toda
 *   gravacao feita daqui de dentro. Quem chama (a busca) recarrega a lista com
 *   ela: sem isso, excluir um produto o deixaria no resultado ate a proxima
 *   busca, e o cartao anunciaria uma ficha que nao existe mais.
 */
export function abrirProdutoDialog(produtos, indiceInicial = 0, { onAlterado = null } = {}) {
  const lista = Array.isArray(produtos) ? produtos : [produtos];
  if (!lista.length) return null;

  const pode = permissoes('acervo');

  let indice = Math.min(Math.max(indiceInicial, 0), lista.length - 1);
  // Fichas ja buscadas: voltar para a anterior nao refaz a requisicao.
  const cache = new Map();
  // Respostas fora de ordem nao podem pintar a ficha do produto errado.
  let requisicao = 0;
  let fechado = false;
  // Ficha do produto na tela. Os dialogos de escrita precisam dela inteira (o
  // subtipo do produto e as versoes ja gravadas), e nao do resumo que veio da
  // busca.
  let fichaAtual = null;
  // Tipos de relacionamento, carregados uma vez e reusados por toda versao.
  let tiposRelacionamento = [];

  // URLs de objeto das miniaturas ja desenhadas. Sem soltar, percorrer uma
  // selecao grande deixaria uma imagem por produto presa na memoria da aba.
  let urlsMiniatura = [];

  const soltarMiniaturas = () => {
    // A guarda existe porque a API de blob URL nao esta em todo ambiente que
    // roda este modulo (o jsdom dos testes nao a tem). Onde ela falta, nao ha
    // blob criado para vazar, entao pular o revoke e correto, e nao remendo.
    if (typeof URL.revokeObjectURL === 'function') {
      urlsMiniatura.forEach(URL.revokeObjectURL);
    }
    urlsMiniatura = [];
  };

  const registrarUrl = (url) => urlsMiniatura.push(url);

  const corpo = el('div', { className: 'produto-ficha' });
  const posicao = el('span', { className: 'produto-ficha__posicao' });

  const btnAnterior = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => irPara(indice - 1),
  }, [svgIcon(ICONS.arrowBack, 16), 'Anterior']);

  const btnProxima = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => irPara(indice + 1),
  }, ['Próxima', svgIcon(ICONS.chevronRight, 16)]);

  const navegacao = el('div', { className: 'produto-ficha__nav' }, [
    btnAnterior, posicao, btnProxima,
  ]);

  // A navegacao so existe quando ha mais de um: com um produto so, uma barra
  // com dois botoes desativados e ruido.
  const raiz = el('div', { className: 'produto-ficha__raiz' }, [
    lista.length > 1 ? navegacao : null,
    corpo,
  ].filter(Boolean));

  function tituloDe(p) {
    return (p && p.nome) || `Produto ${p && p.id}`;
  }

  /**
   * Recarrega a ficha do zero depois de uma gravacao.
   *
   * Descarta o cache do produto na tela, e nao o cache inteiro: as outras fichas
   * da selecao nao mudaram, e joga-las fora faria "Anterior" custar rede a cada
   * salvamento. Avisa quem abriu a ficha na mesma passada, para a lista da busca
   * acompanhar.
   */
  async function recarregar() {
    const produto = lista[indice];
    cache.delete(produto.id);
    if (onAlterado) onAlterado();
    if (fechado) return;
    corpo.replaceChildren(esqueleto());
    const meuToken = ++requisicao;
    await carregar(produto, meuToken);
  }

  // Excluir e GERENTE, editar e nova versao sao OPERADOR: e o que as rotas
  // cobram. O perfil aqui e ergonomia (nao oferecer o que vai voltar 403); quem
  // barra de verdade e o `verifyPerfil` no servidor.
  const acoes = [
    { label: 'Fechar', variant: 'text', onClick: ({ close }) => close() },
  ];

  if (pode.gerente) {
    acoes.push({
      label: 'Excluir',
      variant: 'danger',
      onClick: ({ close }) => excluirProdutoDaFicha(close),
    });
  }

  if (pode.operador) {
    acoes.push({
      label: 'Nova versão',
      variant: 'secondary',
      onClick: () => {
        if (!fichaAtual) return;
        openVersaoDialog({
          produto: fichaAtual,
          versoesExistentes: fichaAtual.versoes || [],
          onSaved: recarregar,
        });
      },
    });
    acoes.push({
      label: 'Editar',
      variant: 'primary',
      onClick: () => {
        if (!fichaAtual) return;
        openProdutoDialogForm({ produto: fichaAtual, onSaved: recarregar });
      },
    });
  }

  const modal = openModal({
    title: tituloDe(lista[indice]),
    content: raiz,
    width: LARGURA_MODAL,
    onClose: () => {
      fechado = true;
      soltarMiniaturas();
    },
    actions: acoes,
  });

  const tituloEl = modal.element.querySelector('.modal__title');

  /**
   * Exclui o produto da ficha, com as versoes e os arquivos dele.
   *
   * Fecha a ficha depois: ela passaria a mostrar um produto que nao existe mais,
   * e "Anterior"/"Próxima" continuariam oferecendo a navegacao para ele.
   */
  async function excluirProdutoDaFicha(fecharModal) {
    const produto = lista[indice];
    const ok = await confirmDialog({
      title: `Excluir ${tituloDe(produto)}`,
      message: 'O produto sai do acervo com TODAS as versões e arquivos dele. As linhas '
        + 'ficam nas tabelas de exclusão e os bytes seguem no volume, mas o acervo deixa '
        + 'de enxergá-los.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;

    const motivo = await pedirMotivo(`Motivo da exclusão de ${tituloDe(produto)}`);
    if (motivo === null) return;

    try {
      await excluirProdutos([Number(produto.id)], motivo);
      showSuccess('Produto excluído com sucesso');
      if (onAlterado) onAlterado();
      fecharModal();
    } catch (erro) {
      showError(erro.message || 'Erro ao excluir o produto');
    }
  }

  /**
   * Abre a ficha de OUTRO produto, vindo de um relacionamento.
   *
   * Empurra o produto no fim da selecao em vez de trocar a ficha no lugar: sem
   * isso, seguir um insumo perderia a selecao que a pessoa montou na busca, e
   * "Anterior" nao teria como voltar.
   */
  function irParaProduto(produto) {
    const jaEsta = lista.findIndex(p => Number(p.id) === Number(produto.id));
    if (jaEsta >= 0) {
      irPara(jaEsta);
      return;
    }
    lista.push(produto);
    if (lista.length === 2) raiz.prepend(navegacao);
    irPara(lista.length - 1);
  }

  function pintarFicha(d) {
    const versoes = d.versoes || [];

    const escala = d.denominador_escala_especial
      ? `1:${formatNumber(d.denominador_escala_especial)}`
      : d.escala;

    const identificacao = el('div', { className: 'ficha-identificacao' }, [
      fato('MI', d.mi, true),
      fato('INOM', d.inom, true),
      fato('Escala', escala),
      fato('Versões', formatNumber(versoes.length)),
      fato('Cadastrado', formatDate(d.data_cadastramento)),
      // O NOME de quem mexeu, e nao so a data. O servidor ja resolve os dois
      // uuid em nome (`u1.nome`, `u2.nome` na consulta da ficha) e a tela
      // descartava os dois: "quem cadastrou isto" era pergunta sem resposta na
      // interface, e so o SQL respondia.
      fato('Cadastrou', d.usuario_cadastramento),
      // So aparece quando houve alteracao: produto nunca editado nao ganha um
      // campo vazio para a pessoa interpretar.
      d.data_modificacao
        ? fato('Alterado', `${formatDate(d.data_modificacao)}${d.usuario_modificacao ? ` por ${d.usuario_modificacao}` : ''}`)
        : null,
    ].filter(Boolean));

    corpo.replaceChildren(...[
      identificacao,
      d.descricao
        ? el('p', { className: 'ficha-descricao', textContent: d.descricao })
        : null,
      el('h3', {
        className: 'produto-ficha__secao',
        textContent: versoes.length > 1
          ? `${plural(versoes.length, 'versão', 'versões')}, da mais recente para a mais antiga`
          : plural(versoes.length, 'versão', 'versões'),
      }),
      ...(versoes.length
        ? versoes.map((v, i) => blocoVersao(
          v,
          versoes.length > 1 && i === 0,
          registrarUrl,
          {
            pode,
            irParaProduto,
            tiposRelacionamento,
            recarregar,
            // Função, e não o objeto: a ficha é trocada a cada recarga, e uma
            // referência presa no fechamento entregaria a versão velha ao
            // diálogo de edição depois do primeiro salvamento.
            ficha: () => fichaAtual,
          }
        ))
        : [el('p', {
          className: 'produto-ficha__vazio',
          textContent: 'Este produto ainda não tem versão cadastrada.',
        })]),
      // HISTÓRICO do produto, RECOLHIDO (2026-08-04).
      //
      // Ele faltava, e era o maior buraco de entrega do sistema: medido em
      // produção, o agregado 'produto' tinha 388 eventos em 170 fichas, e
      // nenhum deles se alcançava de dentro da ficha. Registrar o evento não
      // é entregar o histórico.
      //
      // O agregado reúne QUATRO tabelas -- produto, versão, arquivo e
      // relacionamento --, e é por isso que ele responde "quem trocou o
      // arquivo desta folha" sem que a pessoa precise saber em qual delas o
      // dado mora.
      //
      // RECOLHIDO porque a ficha já é longa (identificação, descrição e uma
      // seção por versão): aberto, ele cobraria uma consulta de quem veio ver
      // qual é a última edição.
      el('div', { className: 'produto-ficha__historico' }, [
        criarHistorico({
          modulo: 'acervo',
          entidade: 'produto',
          id: d.id,
          titulo: 'Histórico do produto',
          subtitulo: 'Alterações no produto, nas versões, nos arquivos e nos relacionamentos',
          recolhido: true,
        }).element,
      ]),
    ].filter(Boolean));
  }

  function carregar(produto, meuToken) {
    return getProdutoDetalhado(produto.id)
      .then((d) => {
        cache.set(produto.id, d);
        if (fechado || meuToken !== requisicao) return;
        fichaAtual = d;
        pintarFicha(d);
      })
      .catch((err) => {
        if (fechado || meuToken !== requisicao) return;
        corpo.replaceChildren(el('p', {
          className: 'produto-ficha__vazio',
          textContent: err.message || 'Erro ao carregar a ficha do produto',
        }));
        showError(err.message || 'Erro ao carregar a ficha do produto');
      });
  }

  function pintar() {
    const produto = lista[indice];
    if (tituloEl) tituloEl.textContent = tituloDe(produto);
    posicao.textContent = `${indice + 1} de ${lista.length}`;
    btnAnterior.disabled = indice === 0;
    btnProxima.disabled = indice === lista.length - 1;

    const meuToken = ++requisicao;

    // Trocar de produto descarta as imagens do anterior. O cache da FICHA
    // continua valendo (o JSON), e a imagem volta do cache HTTP do navegador,
    // entao a viagem de volta nao custa rede.
    soltarMiniaturas();

    if (cache.has(produto.id)) {
      fichaAtual = cache.get(produto.id);
      pintarFicha(fichaAtual);
      return;
    }

    corpo.replaceChildren(esqueleto());
    carregar(produto, meuToken);
  }

  function irPara(novo) {
    if (novo < 0 || novo >= lista.length) return;
    indice = novo;
    corpo.scrollTop = 0;
    pintar();
  }

  // Os tipos de relacao so servem a quem escreve, e por isso so sao pedidos para
  // quem pode. Chegam depois da primeira pintura: a ficha nao espera por eles, e
  // a repintura acontece na primeira gravacao ou troca de produto.
  if (pode.operador) {
    getTiposRelacionamento()
      .then((tipos) => {
        if (fechado) return;
        tiposRelacionamento = tipos || [];
        if (fichaAtual) pintarFicha(fichaAtual);
      })
      .catch(() => {
        // Sem os tipos, o bloco de relacao aparece so para leitura. O resto da
        // ficha nao tem por que sofrer com isso.
      });
  }

  pintar();

  return modal;
}
