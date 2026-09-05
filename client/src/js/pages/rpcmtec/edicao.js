import { el, svgIcon, ICONS, clearChildren } from '@utils/dom.js';
import { reconciliar } from '@utils/reconciliar.js';
import { monthName, formatDateTime, formatDate } from '@utils/format.js';
import { showError, showSuccess, showWarning } from '@utils/toast.js';
import { openModal } from '@components/modal/modal-base.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { criarHistorico } from '@components/historico/historico.js';
import { estadoErro } from '@components/estado-erro.js';
import { isAdmin, temPerfil } from '@store/auth-store.js';
// `getUsuarios` é `verifyAdmin`, e desde 2026-08-08 o GERENTE também abre esta
// tela. A chamada fica, protegida pelo `catch` que já existia: a lista só
// alimenta o diálogo de metadados, que é do administrador. O gerente recebe
// lista vazia e nunca chega a abrir aquele diálogo.
import { getUsuarios } from '@services/plataforma-service.js';
import {
  getDocumento, downloadRpcmtecPdf, fecharEdicao, reabrirEdicao, conferirHoje,
  limparSubsecao, listarAnexos, enviarAnexo, excluirAnexo,
  downloadAnexo, downloadAnuarioOds, downloadRtmOds, revisarSubsecao,
} from '@services/rpcmtec-service.js';
import { abrirEditorSubsecao } from './subsecao-editor.js';
import { abrirDialogoEdicao } from './edicao-dialog.js';

/**
 * A EDICAO do RPCMTec (#/rpcmtec/:id): o documento inteiro, numa tela so.
 *
 * O QUE ELA MOSTRA e exatamente o que vai para o PDF. As celulas chegam do
 * servidor ja em texto, e esta tela nao formata nada por conta: com a tela
 * arredondando de um jeito e o arquivo de outro, quem confere ve diferenca onde
 * nao ha.
 *
 * A DIVISAO ENTRE CALCULADO E DIGITADO e visual e constante, e nao uma legenda
 * escondida. Cada subseccao carrega uma etiqueta:
 * a calculada diz de onde sai, e a digitada diz que e o gestor quem a preenche.
 * Sem isso, a tabela vazia de uma subsecao calculada e a de uma esquecida se
 * parecem, e so uma delas e problema.
 *
 * A TELA NAO SE REMONTA. Toda carga RECONCILIA: a secao, a
 * subsecao, o botao e o anexo se procuram pela chave, e so o que mudou se
 * refaz. Antes cada carga jogava fora a tela inteira, e havia carga a cada
 * gravacao. O custo aparecia em tres lugares: o `details` nascia aberto e
 * reabria toda secao que a pessoa tinha fechado, o arquivo escolhido no campo
 * sumia, e a rolagem saltava no meio da edicao.
 *
 * DOIS ESTADOS mudam a tela inteira:
 *
 *   ABERTA   o calculado sai do banco a cada abertura, o digitado se edita, e o
 *            PDF sai com a marca RASCUNHO;
 *   FECHADA  tudo vem congelado, nada se edita, e aparece o "conferir hoje" --
 *            que recalcula o calculado e mostra a diferenca contra o congelado.
 *
 * O "conferir hoje" e o contrapeso do congelamento: um pedido de marco
 * corrigido em agosto nao muda a edicao de marco, e esta certo, mas a
 * divergencia ficaria invisivel.
 *
 * DUAS LACUNAS DA SUBSECAO CALCULADA, e a diferenca e quem conserta:
 *
 *   semGerador  a estrutura a declara calculada e o gerador nao a produz. Quem
 *               conserta e quem programa o sistema;
 *   semLinhas   o gerador rodou e nao achou nada. Quem conserta e o gestor, e o
 *               conserto e cadastrar o dado na origem.
 *
 * Nenhuma das duas trava o fechamento: nao existe botao que preencha uma
 * subsecao calculada. As duas AVISAM, aqui e no fechamento.
 */

const ORIGEM = { CALCULADA: 1, DIGITADA: 2, FIXA: 3 };

/**
 * A pessoa edita ESTA subseção?
 *
 * Desde 2026-08-08 o gerente de qualquer módulo LÊ o relatório inteiro e edita
 * só as subseções do módulo dele. O administrador global edita todas, inclusive
 * as de módulo NENHUM (`modulo: null`), que são as que não têm cadastro em
 * módulo algum do SCA: finalidade, TI, equipamento técnico, divulgação e as
 * lições do chefe.
 *
 * O `modulo` vem do SERVIDOR, junto de cada subseção, e não de um mapa copiado
 * para cá. O mapa vive em `rpcmtec_estrutura.js`, que é a mesma fonte de que sai
 * a guarda `verify_modulo_subsecao.js`: copiá-lo faria a tela oferecer o botão
 * certo para o mapa errado no dia em que uma subseção mudasse de dono.
 *
 * ISTO É ERGONOMIA, e não segurança: quem barra é o servidor, que relê o perfil
 * do banco a cada requisição. Aqui só se evita oferecer um botão que responderia
 * 403 depois de a pessoa ter digitado a subseção inteira.
 *
 * @param {{modulo: string|null}} sub
 * @returns {boolean}
 */
const podeEditarSubsecao = (sub) => {
  if (isAdmin()) return true;
  if (!sub.modulo) return false;
  return temPerfil('gerente', sub.modulo);
};

export async function renderRpcmtecEdicao(container, ctx) {
  let disposed = false;
  const edicaoId = Number(ctx?.params?.id);
  let documento = null;
  let usuarios = [];

  const cabecalho = el('div', { className: 'page__header page__header--column' });
  const barra = el('div', { className: 'rpcm-acoes' });
  const avisos = el('div');
  // O aviso da carga que falhou. Fica no topo, e a carga boa seguinte o apaga.
  const areaErro = el('div');
  const corpo = el('div');
  const areaAnexos = el('div', { className: 'dashboard-section' });

  // -------------------------------------------------------------------------
  // O FILTRO DE CONFERÊNCIA
  // -------------------------------------------------------------------------

  /**
   * Esconder o que ja foi conferido, para sobrar na tela so o que pede olho.
   *
   * A escolha mora AQUI, no estado da pagina, e nao no documento: marcar uma
   * subsecao como conferida recarrega o documento, e um filtro guardado nele se
   * desmarcaria sozinho a cada clique.
   */
  let esconderConferidas = false;

  const caixaEsconder = el('input', {
    type: 'checkbox',
    className: 'rpcm-filtro__caixa',
    id: 'rpcm-esconder-conferidas',
    checked: false,
    onChange: () => {
      esconderConferidas = caixaEsconder.checked;
      if (documento) {
        desenharCorpo();
        desenharContagemEscondida();
      }
    },
  });

  const contagemEscondida = el('span', { className: 'rpcm-filtro__contagem' });

  const filtros = el('div', { className: 'rpcm-filtro' }, [
    caixaEsconder,
    el('label', {
      className: 'rpcm-filtro__rotulo',
      htmlFor: 'rpcm-esconder-conferidas',
      textContent: 'Esconder as subseções já conferidas',
      title: 'A que mudou DEPOIS da conferência continua na tela: é justamente '
        + 'a que passa batido.',
    }),
    contagemEscondida,
  ]);

  // O HISTORICO da edicao, RECOLHIDO. Fechar e reabrir sao os dois atos mais
  // consequentes desta tela -- um congela o documento que o chefe assina, o
  // outro o descongela --, e "quem reabriu a de julho" e pergunta que se faz
  // depois. O agregado `edicao` reune a edicao, as subsecoes digitadas e o
  // anexo assinado.
  //
  // SO PARA ADMINISTRADOR, e o desencontro custou a descoberta. A rota da tela e
  // `gerenteLoader` desde que ela deixou de ser admin-only, e o historico de
  // 'plataforma' continua `verifyAdmin`
  // (server/src/auditoria/auditoria_route.js). O painel era montado sem checar
  // `isAdmin()`: o gerente que nao e administrador o via e levava 403 ao abrir.
  // Ele nasce recolhido e so busca quando aberto, o que ADIAVA a falha em vez de
  // evita-la, e por isso ninguem tinha topado com ela. A meta e a capacitacao ja
  // escondiam o painel por esse mesmo descasamento.
  const areaHistorico = el('div', { className: 'dashboard-section' });

  const page = el('div', { className: 'page' }, [
    cabecalho, areaErro, barra, avisos, areaAnexos, filtros, corpo, areaHistorico,
  ]);
  container.appendChild(page);

  // -------------------------------------------------------------------------
  // Reconciliação
  // -------------------------------------------------------------------------

  /**
   * Reconcilia uma lista em que o nó só se refaz quando o ITEM muda.
   *
   * O `reconciliar` preserva o nó de mesma chave, mas quem decide repintá-lo é o
   * `atualizar`. Aqui a ASSINATURA decide: item igual ao do desenho anterior
   * mantém o nó intocado, e o navegador não repinta o que ninguém mexeu.
   */
  function reconciliarPorAssinatura(alvo, itens, { chave, assinatura, criar }) {
    const montar = (item, indice) => {
      const no = criar(item, indice);
      no.__assinatura = assinatura(item, indice);
      return no;
    };
    return reconciliar(alvo, itens, {
      chave,
      criar: montar,
      atualizar: (no, item, indice) => (
        no.__assinatura === assinatura(item, indice) ? undefined : montar(item, indice)
      ),
    });
  }

  // -------------------------------------------------------------------------
  // Desenho
  // -------------------------------------------------------------------------

  // Os nós do cabeçalho que mudam de texto. Eles nascem uma vez, e a carga
  // seguinte só escreve neles.
  let nosCabecalho = null;

  function desenharCabecalho() {
    const estado = !documento.fechada
      ? { texto: 'Aberta', classe: 'status-chip--warning' }
      : (documento.anexos > 0
        ? { texto: 'Assinada', classe: 'status-chip--success' }
        : { texto: 'Fechada', classe: 'status-chip--info' });

    const detalhes = [];
    if (documento.assinante_nome) {
      detalhes.push(`Assina: ${documento.assinante_posto || ''} ${documento.assinante_nome}`.trim());
    }
    if (documento.data_assinatura) {
      detalhes.push(`Assinada em ${formatDate(documento.data_assinatura)}`);
    }
    if (documento.data_fechamento) {
      detalhes.push(`Fechada em ${formatDateTime(documento.data_fechamento)}`);
    }

    if (!nosCabecalho) {
      const titulo = el('h1', { className: 'page__title' });
      const chipEstado = el('span', { className: 'status-chip' });
      const subtitulo = el('p', { className: 'page__subtitle' });

      cabecalho.append(
        el('a', {
          className: 'consulta-card__voltar',
          href: '#/rpcmtec',
          style: { marginBottom: '8px' },
        }, [svgIcon(ICONS.arrowBack, 14), 'Voltar para as edições']),
        el('div', { style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' } }, [
          titulo, chipEstado,
        ]),
        subtitulo,
      );
      nosCabecalho = { titulo, chipEstado, subtitulo };
    }

    nosCabecalho.titulo.textContent = `RPCMTec ${monthName(documento.mes)}/${documento.ano}`;
    nosCabecalho.chipEstado.className = `status-chip ${estado.classe}`;
    nosCabecalho.chipEstado.textContent = estado.texto;
    nosCabecalho.subtitulo.textContent = detalhes.join('  ·  ') || 'Assinante ainda não definido.';
  }

  function botao(rotulo, icone, aoClicar, { primario = false, titulo = null } = {}) {
    return el('button', {
      className: primario ? 'btn btn--primary' : 'btn',
      type: 'button',
      ...(titulo ? { title: titulo } : {}),
      onClick: aoClicar,
    }, [icone ? svgIcon(icone, 16) : null, rotulo].filter(Boolean));
  }

  /**
   * Os botões da barra, em ordem, cada um com a sua chave.
   *
   * Os manipuladores leem `documento` na hora do clique, e não na hora da
   * montagem: por isso o botão que continua na barra nunca precisa ser refeito.
   */
  function botoesDaBarra() {
    const itens = [{
      chave: 'pdf',
      rotulo: 'Baixar PDF',
      icone: ICONS.print,
      aoClicar: baixarPdf,
      primario: true,
      titulo: documento.fechada
        ? 'O documento congelado, pronto para assinar.'
        : 'A edição está aberta: o PDF sai com a marca RASCUNHO.',
    }];

    // A BARRA NÃO TEM BOTÃO DE TRAZER O MÊS PASSADO, desde 2026-08-06. Havia
    // aqui um botão que copiava as subseções digitadas da edição anterior, e a
    // rota que o servia saiu do servidor. O RPCMTec é o relatório DAQUELE mês:
    // a linha que chega pronta não é relida, e o documento assinado passava a
    // afirmar sobre agosto o que aconteceu em julho.
    // FECHAR, REABRIR e EDITAR METADADOS são do ADMINISTRADOR, e só dele. O
    // gerente lê o relatório inteiro e edita a subseção da área dele, mas
    // congelar é o ato que produz o documento que o chefe da Divisão assina, e
    // os metadados dizem QUEM assina. O servidor cobra `verifyAdmin` nas três; o
    // recorte daqui existe para não oferecer botão que responderia 403.
    //
    // "Conferir hoje" NÃO leva a marca: ela recalcula e mostra a diferença
    // contra o congelado, sem gravar nada, e é leitura como o resto da tela.
    const ehAdmin = isAdmin();

    if (!documento.fechada) {
      if (ehAdmin) {
        itens.push({
          chave: 'fechar', rotulo: 'Fechar e congelar', icone: ICONS.lock, aoClicar: fechar,
        });
      }
    } else {
      itens.push({
        chave: 'conferir',
        rotulo: 'Conferir hoje',
        icone: ICONS.swapHoriz,
        aoClicar: conferir,
        titulo: 'Recalcula as subseções calculadas e mostra a diferença contra o congelado.',
      });
      if (ehAdmin) {
        itens.push({
          chave: 'reabrir', rotulo: 'Reabrir', icone: ICONS.edit, aoClicar: reabrir,
        });
      }
    }

    if (ehAdmin) {
      itens.push({
        chave: 'metadados',
        rotulo: 'Editar metadados',
        icone: ICONS.settings,
        aoClicar: () => abrirDialogoEdicao({ edicao: documento, usuarios, onSaved: carregar }),
      });
    }

    itens.push({
      chave: 'espaco',
    }, {
      chave: 'anuario', rotulo: 'Anuário (ODS)', icone: ICONS.download, aoClicar: baixarAnuario,
    }, {
      chave: 'rtm',
      rotulo: `RTM até ${monthName(documento.mes)} (ODS)`,
      icone: ICONS.download,
      aoClicar: baixarRtm,
      titulo: 'Detalhamento da Meta 4 do PIT, acumulado de janeiro até o mês da edição.',
    });

    return itens;
  }

  const criarItemDaBarra = (item) => (item.chave === 'espaco'
    ? el('div', { style: { flex: '1' } })
    : botao(item.rotulo, item.icone, item.aoClicar,
      { primario: item.primario, titulo: item.titulo }));

  function desenharBarra() {
    reconciliar(barra, botoesDaBarra(), {
      chave: (item) => item.chave,
      criar: criarItemDaBarra,
      atualizar: (no, item) => {
        if (!item.rotulo) return undefined;
        // O título do PDF muda com o estado da edição, e é só texto: escrevê-lo
        // no botão que já existe evita trocar o nó em que o foco pode estar.
        if (item.titulo) no.title = item.titulo;
        else no.removeAttribute('title');
        // Só o rótulo do RTM muda, e ele carrega o mês da edição.
        return no.textContent === item.rotulo ? undefined : criarItemDaBarra(item);
      },
    });
  }

  /**
   * Os avisos do topo. São DOIS, e a diferença é quem conserta:
   *
   *   pendentes  o gestor preenche, e o fechamento RECUSA sem isso;
   *   lacunas    o dado falta na origem, e o fechamento só AVISA.
   */
  function avisosDaTela() {
    if (documento.fechada) return [];

    const itens = [];
    const pendentes = documento.pendentes || [];
    if (pendentes.length) itens.push({ chave: 'pendentes', numeros: pendentes });

    const lacunas = documento.lacunasCalculadas || [];
    if (lacunas.length) itens.push({ chave: 'lacunas', numeros: lacunas });

    return itens;
  }

  function criarAviso(item) {
    if (item.chave === 'pendentes') {
      return el('div', { className: 'rpcm-aviso' }, [
        svgIcon(ICONS.warning, 18),
        el('div', {}, [
          el('strong', {
            textContent: `${item.numeros.length} subseção(ões) por preencher: `,
          }),
          item.numeros.join(', '),
          el('div', {
            className: 'rpcm-aviso__nota',
            textContent: 'Preencha cada uma ou marque "sem ocorrência no mês". '
              + 'A edição não fecha com subseção nunca visitada, porque vazio por decisão '
              + 'e vazio por esquecimento sairiam iguais no documento.',
          }),
        ]),
      ]);
    }

    return el('div', { className: 'rpcm-aviso' }, [
      svgIcon(ICONS.warning, 18),
      el('div', {}, [
        el('strong', {
          textContent: `${item.numeros.length} subseção(ões) calculada(s) sem linha: `,
        }),
        item.numeros.join(', '),
        el('div', {
          className: 'rpcm-aviso__nota',
          textContent: 'Cadastre o dado de origem antes de fechar. '
            + 'A tabela vazia afirma "não houve" no documento assinado. '
            + 'A subseção marcada "Lacuna do gerador" depende de quem programa o sistema.',
        }),
      ]),
    ]);
  }

  function desenharAvisos() {
    reconciliarPorAssinatura(avisos, avisosDaTela(), {
      chave: (item) => item.chave,
      assinatura: (item) => item.numeros.join(','),
      criar: criarAviso,
    });
  }

  /**
   * A etiqueta que diz quem preenche a subseção.
   *
   * A ETIQUETA NÃO CITA TABELA DO BANCO. Ela dizia "Calculada: pit.meta_vigente
   * e pit.execucao", e quem lê o relatório não tem por que saber o nome das
   * tabelas: o que ele precisa saber é que aquilo sai sozinho. O nome da fonte
   * continua existindo na estrutura, para o `title` de quem passa o mouse e para
   * a mensagem de quando o cálculo não acha nada.
   */
  function etiqueta(sub) {
    if (sub.origem === ORIGEM.CALCULADA) {
      return el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--calculada',
        title: 'O sistema monta esta subseção sozinho, do que está cadastrado.',
        textContent: 'Calculada',
      });
    }
    if (sub.origem === ORIGEM.FIXA) {
      return el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--fixa',
        textContent: 'Texto fixo',
      });
    }
    return el('span', {
      className: 'rpcm-etiqueta rpcm-etiqueta--digitada',
      title: sub.fonte ? `Fonte: ${sub.fonte}` : 'Preenchida à mão nesta tela',
      textContent: sub.fonte ? `Você preenche (${sub.fonte})` : 'Você preenche',
    });
  }

  /** Tabela somente leitura, com as células como o servidor as mandou. */
  function tabelaLeitura(sub) {
    const linhas = sub.linhas || [];
    const corpoTabela = linhas.length
      ? linhas.map((celulas) => el('tr', {}, sub.cabecalhos.map(
        (_, i) => el('td', { textContent: celulas[i] ?? '' }),
      )))
      // A tabela vazia imprime o '-' de cada coluna, que é como o modelo
      // escreve "não houve". A tela mostra o mesmo que o PDF.
      : [el('tr', {}, sub.cabecalhos.map(() => el('td', { textContent: '-' })))];

    return el('div', { className: 'rpcm-grade__wrap' }, [
      el('table', { className: 'rpcm-grade rpcm-grade--leitura' }, [
        el('thead', {}, [
          el('tr', {}, sub.cabecalhos.map((rotulo) => el('th', { textContent: rotulo }))),
        ]),
        el('tbody', {}, corpoTabela),
      ]),
    ]);
  }

  /**
   * O CHECKBOX DE CONFERÊNCIA, e a linha que diz quem conferiu e quando.
   *
   * VALE PARA AS TRÊS ORIGENS, e é a diferença entre esta marca e a etiqueta
   * "Por preencher". Preencher é digitar o que falta; conferir é olhar o que
   * está lá e responder por ele. A subseção calculada nasce preenchida e é
   * justamente a que mais precisa do olho: o número pode estar certo e o
   * cadastro que o alimenta, errado.
   *
   * NUMA EDIÇÃO FECHADA ele vira só texto. A marca continua VISÍVEL, porque ela
   * conta quem conferiu antes de assinar, e deixa de ser clicável, porque
   * conferir depois do congelamento não muda documento nenhum.
   *
   * FORA DO SEU MÓDULO, IDEM. Conferir é do gerente DAQUELA subseção: o
   * servidor cobra `verifyGerente` MAIS `verifyModuloSubsecao()`
   * (`rpcmtec_route.js:664-667`), a mesma régua dos botões de edição logo
   * abaixo. Sem este recorte, o gerente de um módulo via caixa clicável nas 33
   * subseções, marcava a de outro, e a caixa desmarcava sozinha com um 403 --
   * exatamente o "oferecer um botão que responderia 403" que o comentário de
   * `podeEditarSubsecao` diz querer evitar. Ele continua LENDO quem conferiu,
   * que é o que a marca conta.
   */
  function conferencia(sub) {
    const r = sub.revisao;

    if (documento.fechada || !podeEditarSubsecao(sub)) {
      if (!r) return null;
      return el('div', { className: 'rpcm-revisao rpcm-revisao--lida' }, [
        svgIcon(ICONS.check),
        el('span', {
          textContent: `Conferida por ${r.por} em ${formatDateTime(r.em)}`,
        }),
      ]);
    }

    // `checked` e `htmlFor` são PROPRIEDADES, e não atributos. O `el` já as
    // trata assim (ver `PROPRIEDADES_NAO_ATRIBUTOS` em `utils/dom.js`); enquanto
    // ele caía em `setAttribute`, `checked: false` virava `checked="false"` e o
    // atributo PRESENTE marcava a caixa, então toda subseção nascia conferida.
    const caixa = el('input', {
      type: 'checkbox',
      className: 'rpcm-revisao__caixa',
      id: `revisao-${sub.numero}`,
      checked: Boolean(r),
    });

    caixa.addEventListener('change', async () => {
      const querMarcar = caixa.checked;
      // Trava enquanto o servidor responde: dois cliques rápidos mandariam duas
      // chamadas e a segunda desfaria a primeira sem ninguém entender.
      caixa.disabled = true;
      try {
        await revisarSubsecao(edicaoId, sub.numero, querMarcar);
        // RECARREGA em vez de mexer no DOM daqui. A marca traz quem e quando,
        // que só o servidor sabe, e a lista de pendências do cabeçalho muda
        // junto. A tela reconcilia, então isso não perde scroll nem seção
        // aberta.
        await carregar();
      } catch (e) {
        // Devolve a caixa ao estado real: deixá-la marcada depois de a gravação
        // falhar é a pior saída, porque a tela passaria a afirmar uma
        // conferência que o banco não tem.
        caixa.checked = !querMarcar;
        showError(e.message || 'Não foi possível gravar a conferência');
      } finally {
        caixa.disabled = false;
      }
    });

    const texto = r
      ? `Conferida por ${r.por} em ${formatDateTime(r.em)}`
      : 'Marque quando tiver conferido esta subseção';

    const rotulo = el('label', {
      className: 'rpcm-revisao__rotulo',
      htmlFor: `revisao-${sub.numero}`,
      textContent: texto,
    });

    const linha = [caixa, rotulo];

    // O AVISO QUE FAZ A MARCA VALER. Sem ele, "conferida" diria apenas que
    // alguém clicou um dia: a digitada muda quando alguém a edita, e a calculada
    // muda sozinha quando se cadastra uma versão, uma capacitação ou um pedido.
    if (r && r.desatualizada) {
      linha.push(el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--pendente',
        title: 'O conteúdo desta subseção mudou depois da conferência. '
          + 'Olhe de novo e marque outra vez.',
        textContent: 'mudou depois da conferência',
      }));
    }

    return el('div', {
      className: r && !r.desatualizada
        ? 'rpcm-revisao rpcm-revisao--feita'
        : 'rpcm-revisao',
    }, linha);
  }

  function desenharSubsecao(sub) {
    const acoes = [];

    if (sub.origem === ORIGEM.DIGITADA && !documento.fechada && podeEditarSubsecao(sub)) {
      acoes.push(botao(
        sub.preenchida ? 'Editar' : 'Preencher',
        ICONS.edit,
        () => abrirEditorSubsecao({ edicaoId, subsecao: sub, onSaved: carregar }),
      ));
      // A subseção também perdeu o botão de trazer o mês passado, em
      // 2026-08-06. Mesma razão do botão geral da barra: cada subseção se
      // preenche pelo mês que ela reporta.
      if (sub.preenchida) {
        acoes.push(botao('Limpar', ICONS.delete, () => limpar(sub)));
      }
    }

    const marcas = [etiqueta(sub)];
    if (sub.semOcorrencia) {
      marcas.push(el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--vazia',
        textContent: 'Sem ocorrência no mês',
      }));
    }
    if (sub.origem === ORIGEM.DIGITADA && !sub.preenchida && !documento.fechada) {
      marcas.push(el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--pendente',
        textContent: 'Por preencher',
      }));
    }
    if (sub.semGerador) {
      marcas.push(el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--pendente',
        title: 'A estrutura declara esta subseção como calculada, e o gerador não a produz.',
        textContent: 'Lacuna do gerador',
      }));
    }
    // O CÁLCULO RODOU E NÃO ACHOU NADA. A etiqueta diz o que a pessoa faz, e não
    // o que o sistema encontrou: uma 6.1 vazia quer dizer que falta cadastrar
    // passagem de efetivo, e não que ninguém passou pela Divisão no mês.
    //
    // ELA NOMEIA A COISA. Dizia "Falta cadastrar o dado de origem", que não diz
    // O QUE cadastrar nem ONDE: o chefe leu isso na 2.6 e não soube o que era,
    // justamente numa subseção que ele sabia ser automática. Agora cada subseção
    // declara a sua pendência em `pendencia`, na palavra que a Divisão usa
    // ("Nenhuma capacitação ministrada concluída no mês").
    if (sub.semLinhas) {
      marcas.push(el('span', {
        className: 'rpcm-etiqueta rpcm-etiqueta--pendente',
        title: 'O cálculo rodou e não achou nada. Se houve, cadastre na tela dessa '
          + 'atividade. Sem isso a tabela sai vazia, e o documento assinado afirma '
          + 'que não houve nada.',
        textContent: sub.pendencia || 'Nada cadastrado no mês',
      }));
    }

    let conteudo;
    if (sub.cabecalhos) {
      conteudo = tabelaLeitura(sub);
    } else {
      conteudo = el('p', {
        className: 'rpcm-prosa',
        textContent: sub.texto || '-',
      });
    }

    // A conferência fica ABAIXO do conteúdo, e não no cabeçalho junto das
    // etiquetas. Marcar é o gesto que se faz DEPOIS de ler a subseção, e o
    // caminho do olho é título, conteúdo, marca.
    const partes = [
      el('div', { className: 'rpcm-subsecao__cabecalho' }, [
        el('h3', {
          className: 'rpcm-subsecao__titulo',
          textContent: sub.titulo ? `${sub.numero}. ${sub.titulo}` : `${sub.numero}.`,
        }),
        el('div', { className: 'rpcm-subsecao__marcas' }, marcas),
        el('div', { style: { flex: '1' } }),
        el('div', { className: 'rpcm-subsecao__acoes' }, acoes),
      ]),
      conteudo,
    ];

    const marcaRevisao = conferencia(sub);
    if (marcaRevisao) partes.push(marcaRevisao);

    return el('div', {
      className: sub.revisao && !sub.revisao.desatualizada
        ? 'rpcm-subsecao rpcm-subsecao--conferida'
        : 'rpcm-subsecao',
    }, partes);
  }

  /**
   * A ASSINATURA da subseção: tudo o que a tela desenha a partir dela.
   *
   * O bloco chega novo do servidor a cada carga, então comparar por referência
   * marcaria tudo como mudado. O estado da edição entra porque ele decide se os
   * botões de edição aparecem.
   */
  const assinaturaDaSubsecao = (sub) => JSON.stringify([documento.fechada, sub]);

  function preencherSecao(bloco, secao) {
    reconciliarPorAssinatura(bloco.__conteudo, secao.subsecoes, {
      chave: (sub) => sub.numero,
      assinatura: assinaturaDaSubsecao,
      criar: desenharSubsecao,
    });
  }

  function criarSecao(secao) {
    // As subseções vivem num contêiner PRÓPRIO, e não soltas dentro do
    // `details`: o `reconciliar` remove todo filho que não está na lista, e o
    // `summary` sairia junto.
    const conteudo = el('div', { className: 'rpcm-secao__corpo' });

    // `details` aberto por padrão na CRIAÇÃO, e só nela: quem abre a edição quer
    // VER o relatório, e não caçar nove gavetas. Fechar é gesto de quem já se
    // orientou, e recriar o `details` a cada carga desfazia esse gesto.
    const bloco = el('details', { className: 'rpcm-secao', open: true }, [
      el('summary', { className: 'rpcm-secao__titulo', textContent: secao.titulo }),
      conteudo,
    ]);
    bloco.__conteudo = conteudo;

    preencherSecao(bloco, secao);
    return bloco;
  }

  /**
   * A subseção RESOLVIDA: conferida, e nada mudou desde a conferência.
   *
   * A que tem `desatualizada: true` NÃO é resolvida. Ela está marcada, e o
   * conteúdo mudou depois: é o caso que passa batido, e escondê-lo derrotaria o
   * propósito da caixa.
   */
  const conferidaResolvida = (sub) => Boolean(sub.revisao) && !sub.revisao.desatualizada;

  /** Quantas subseções a caixa esconde, marcada ou não. */
  function quantasResolvidas() {
    return (documento.secoes || [])
      .reduce((total, secao) => total + secao.subsecoes.filter(conferidaResolvida).length, 0);
  }

  /**
   * As seções como a tela as desenha, já sem o que a caixa esconde.
   *
   * A SEÇÃO QUE FICA SEM SUBSEÇÃO VISÍVEL SAI JUNTO. Sem isso restariam
   * cabeçalhos de gaveta vazia, e a tela ficaria pior do que antes de filtrar.
   */
  function secoesVisiveis() {
    const secoes = documento.secoes || [];
    if (!esconderConferidas) return secoes;
    return secoes
      .map((secao) => ({
        ...secao,
        subsecoes: secao.subsecoes.filter((sub) => !conferidaResolvida(sub)),
      }))
      .filter((secao) => secao.subsecoes.length > 0);
  }

  /**
   * O NÚMERO DO QUE SUMIU, ao lado da caixa.
   *
   * Tela que encolhe sem explicar parece tela que perdeu dado.
   */
  function desenharContagemEscondida() {
    if (!esconderConferidas) {
      contagemEscondida.textContent = '';
      return;
    }
    const quantas = quantasResolvidas();
    contagemEscondida.textContent = quantas
      ? `${quantas} conferida(s) escondida(s)`
      : 'Nenhuma subseção conferida ainda';
  }

  function desenharCorpo() {
    // A chave da seção é o TÍTULO: é o que o servidor manda, e ele não repete.
    // O número da subseção é a chave de dentro.
    reconciliar(corpo, secoesVisiveis(), {
      chave: (secao) => secao.titulo,
      criar: criarSecao,
      atualizar: (bloco, secao) => { preencherSecao(bloco, secao); },
    });
  }

  // Os nós fixos da área de anexo. O `<input type=file>` guarda o arquivo
  // escolhido, e refazê-lo apagava a escolha de quem clicou "Anexar assinado"
  // logo depois de qualquer outra gravação.
  const listaAnexos = el('div');

  const entradaAnexo = el('input', {
    type: 'file',
    accept: '.pdf,.p7s',
    className: 'form-field__input',
    style: { maxWidth: '360px' },
  });

  const botaoEnviarAnexo = el('button', {
    className: 'btn',
    type: 'button',
    onClick: async () => {
      const arquivo = entradaAnexo.files && entradaAnexo.files[0];
      if (!arquivo) {
        showWarning('Escolha o arquivo do RPCMTec assinado');
        return;
      }
      botaoEnviarAnexo.disabled = true;
      try {
        const dados = new FormData();
        dados.append('arquivo', arquivo);
        await enviarAnexo(edicaoId, dados);
        showSuccess('RPCMTec assinado anexado com sucesso');
        await carregar();
      } catch (err) {
        showError(err.message || 'Erro ao anexar o arquivo');
      } finally {
        botaoEnviarAnexo.disabled = false;
      }
    },
  }, [svgIcon(ICONS.add, 16), 'Anexar assinado']);

  let areaAnexosMontada = false;

  // O anexo é o PDF ASSINADO: BAIXAR é de quem lê o relatório, e ANEXAR e
  // EXCLUIR são do administrador, porque quem junta ou tira a assinatura do
  // documento é quem responde por ele. O servidor cobra o mesmo (`verifyAdmin`
  // no upload e no delete, gerente no download).
  const linhaDeAnexo = (anexo) => el('div', { className: 'rpcm-anexo' }, [
    svgIcon(ICONS.description, 16),
    el('span', { textContent: anexo.nome_original }),
    el('span', {
      className: 'rpcm-anexo__meta',
      // Sem `|| ''`: `formatDateTime` já devolve '-' para o vazio e para o
      // inválido, então o ramo nunca era alcançado.
      textContent: formatDateTime(anexo.data_cadastramento),
    }),
    el('button', {
      className: 'btn btn--icon',
      type: 'button',
      title: 'Baixar',
      onClick: () => downloadAnexo(anexo.id, anexo.nome_original)
        .catch((err) => showError(err.message || 'Erro ao baixar o anexo')),
    }, [svgIcon(ICONS.download, 16)]),
    ...(isAdmin()
      ? [el('button', {
        className: 'btn btn--icon btn--danger-text',
        type: 'button',
        title: 'Excluir',
        onClick: () => removerAnexo(anexo),
      }, [svgIcon(ICONS.delete, 16)])]
      : []),
  ]);

  const avisoSemAnexo = () => el('p', {
    className: 'rpcm-anexo__vazio',
    textContent: 'Nenhum arquivo assinado anexado. '
      + 'O assinado é a fonte primária da edição: o congelado tem de dizer o que ele diz.',
  });

  /**
   * A LEITURA que falhou, escrita como falha.
   *
   * O `catch` engolia o erro e caía na lista vazia, que afirma "nenhum arquivo
   * assinado anexado". Consulta que não respondeu virava afirmação sobre o
   * servidor, e o gestor reanexava por cima achando que o arquivo se perdeu.
   */
  const avisoErroAnexo = (mensagem) => el('p', {
    className: 'rpcm-anexo__vazio',
    role: 'alert',
    textContent: `${mensagem} A lista de anexos não foi lida, e isto não quer `
      + 'dizer que não há anexo.',
  });

  async function desenharAnexos() {
    let anexos = [];
    let erroAnexos = null;
    try {
      anexos = await listarAnexos(edicaoId);
    } catch (err) {
      anexos = [];
      erroAnexos = err.message || 'Erro ao carregar os anexos.';
    }
    if (disposed) return;

    if (!areaAnexosMontada) {
      areaAnexosMontada = true;
      areaAnexos.append(
        el('div', { className: 'dashboard-section__header' }, [
          el('h3', { className: 'dashboard-section__title', textContent: 'RPCMTec assinado' }),
        ]),
        listaAnexos,
        // Sem o par escolher-arquivo + enviar para quem não é administrador: a
        // lista continua, porque baixar o assinado é do gerente.
        ...(isAdmin()
          ? [el('div', { style: { display: 'flex', gap: '8px', alignItems: 'center', marginTop: '8px' } }, [
            entradaAnexo, botaoEnviarAnexo,
          ])]
          : []),
      );
    }

    // O "nenhum anexo" e o "não consegui ler" são itens de chave própria. Assim
    // o primeiro anexo troca só esse nó, em vez de refazer a área inteira.
    let itens;
    if (erroAnexos) {
      itens = [{ chave: 'erro', anexo: null, erro: erroAnexos }];
    } else if ((anexos || []).length) {
      itens = anexos.map((anexo) => ({ chave: `anexo-${anexo.id}`, anexo, erro: null }));
    } else {
      itens = [{ chave: 'vazio', anexo: null, erro: null }];
    }

    reconciliarPorAssinatura(listaAnexos, itens, {
      chave: (item) => item.chave,
      assinatura: (item) => {
        if (item.erro) return `erro|${item.erro}`;
        return item.anexo
          ? `${item.anexo.nome_original}|${item.anexo.data_cadastramento}`
          : 'vazio';
      },
      criar: (item) => {
        if (item.erro) return avisoErroAnexo(item.erro);
        return item.anexo ? linhaDeAnexo(item.anexo) : avisoSemAnexo();
      },
    });
  }

  // O painel do histórico nasce UMA vez. Ele guarda a página, a ordenação e o
  // estado recolhido, e recriá-lo a cada gravação jogava os três fora.
  let historico = null;

  function desenharHistorico() {
    // Ver o comentario de `areaHistorico`: painel que entrega 403 ao ser aberto
    // e pior que painel nenhum.
    if (!isAdmin()) return;
    if (!historico) {
      historico = criarHistorico({
        modulo: 'plataforma',
        entidade: 'edicao',
        id: edicaoId,
        titulo: 'Histórico da edição',
        subtitulo: 'Metadados, subseções digitadas, fechamento, reabertura e anexo assinado',
        recolhido: true,
      });
      areaHistorico.appendChild(historico.element);
      return;
    }

    // Recolhido e nunca aberto, o painel ainda não buscou nada: recarregá-lo
    // aqui pagaria uma consulta que ninguém pediu. Aberto, ele tem de trazer o
    // evento que acabou de sair (fechar, reabrir, anexar).
    if (historico.element.open) historico.recarregar();
  }

  // -------------------------------------------------------------------------
  // Ações
  // -------------------------------------------------------------------------

  async function baixarPdf() {
    try {
      await downloadRpcmtecPdf(edicaoId, documento.ano, documento.mes);
    } catch (err) {
      showError(err.message || 'Erro ao baixar o PDF');
    }
  }

  async function baixarAnuario() {
    try {
      await downloadAnuarioOds({ ano: documento.ano, mes: documento.mes });
    } catch (err) {
      showError(err.message || 'Erro ao baixar o Anuário');
    }
  }

  async function baixarRtm() {
    try {
      await downloadRtmOds({ ano: documento.ano, mes: documento.mes });
    } catch (err) {
      showError(err.message || 'Erro ao baixar o RTM');
    }
  }

  // NÃO HÁ AÇÃO DE TRAZER O MÊS PASSADO, desde 2026-08-06. Aqui morava a
  // função que chamava a rota de cópia, com a trava de duplo envio que os dois
  // botões exigiam. Os botões, a função e a rota saíram juntos. O RPCMTec é o
  // relatório DAQUELE mês, e cada subseção se preenche pelo mês que reporta.

  async function limpar(sub) {
    const ok = await confirmDialog({
      title: `Limpar ${sub.numero}`,
      message: 'A subseção volta a contar como NÃO preenchida, e o fechamento vai cobrá-la de novo. '
        + 'É diferente de marcar "sem ocorrência no mês".',
      confirmLabel: 'Limpar',
      danger: true,
    });
    if (!ok) return;

    try {
      await limparSubsecao(edicaoId, sub.numero);
      showSuccess(`${sub.numero} limpa`);
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao limpar a subseção');
    }
  }

  /**
   * O AVISO DA CONFERÊNCIA, montado a partir do que a tela já tem.
   *
   * Ele NÃO substitui o do servidor: quem recusa o fechamento sem confirmação é
   * a rota, e isso vale para o CLI também. Este texto só evita uma ida e volta
   * quando a pessoa já pode ver o que falta.
   */
  function faltaConferir() {
    const nunca = documento.porRevisar || [];
    const vencidas = documento.revisaoVencida || [];
    if (!nunca.length && !vencidas.length) return null;

    const partes = [];
    if (nunca.length) {
      partes.push(`${nunca.length} nunca conferida(s): ${nunca.join(', ')}`);
    }
    if (vencidas.length) {
      partes.push(
        `${vencidas.length} conferida(s) ANTES de mudar(em): ${vencidas.join(', ')}`,
      );
    }
    return partes.join('. ');
  }

  async function fechar() {
    const pendencia = faltaConferir();

    const ok = await confirmDialog({
      title: 'Fechar e congelar a edição',
      // 33, e o número vem de `rpcmtec_estrutura.js` (`BLOCOS.length`), que é a
      // definição única de que saem o gerador, esta tela, o PDF e o fechamento.
      // A confirmação dizia 34: quem contasse os blocos da tela antes de
      // congelar o documento que o chefe assina achava que faltava um.
      message: 'Os 33 blocos são gravados como estão AGORA, inclusive os calculados. '
        + 'A partir daí o documento não muda quando o banco mudar, que é o que torna '
        + 'a edição reproduzível. Reabrir depois é possível e fica no rastro.'
        // A pendência de conferência entra na MESMA confirmação, e não numa
        // segunda: duas caixas seguidas treinam quem lê a clicar sem ler.
        + (pendencia
          ? `\n\nAINDA FALTA CONFERIR. ${pendencia}. `
            + 'Fechar assim mesmo é decisão sua, e ela fica no rastro.'
          : ''),
      confirmLabel: pendencia ? 'Fechar sem conferir tudo' : 'Fechar e congelar',
    });
    if (!ok) return;

    try {
      // `true` porque a pessoa acabou de ler a lista e confirmar. Sem isso o
      // servidor responde 409, que é o que ele faz com quem não passou por aqui.
      const resposta = await fecharEdicao(edicaoId, true);
      showSuccess(`Edição fechada. ${resposta.subsecoes} blocos congelados.`);

      // AS LACUNAS NÃO PARAM O FECHAMENTO, e por isso o aviso vem depois dele.
      // Quem congela tem de saber que a 6.1 foi congelada vazia: o documento
      // assinado passa a afirmar isso, e só a reabertura desfaz.
      const lacunas = resposta.lacunas || [];
      if (lacunas.length) {
        showWarning(
          `Congelada com ${lacunas.length} subseção(ões) calculada(s) vazia(s): `
          + `${lacunas.join(', ')}. `
          + 'Cadastre o dado de origem e reabra a edição para corrigi-la. '
          + 'A tabela vazia afirma "não houve" no documento assinado.',
        );
      }

      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao fechar a edição');
    }
  }

  async function reabrir() {
    const ok = await confirmDialog({
      title: 'Reabrir a edição',
      message: 'O calculado volta a sair do banco e pode mudar. O que você digitou é preservado. '
        + 'Se o documento já foi assinado, o assinado deixa de corresponder ao que a tela mostra.',
      confirmLabel: 'Reabrir',
      danger: true,
    });
    if (!ok) return;

    try {
      await reabrirEdicao(edicaoId);
      showSuccess('Edição reaberta');
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao reabrir a edição');
    }
  }

  async function conferir() {
    let resultado;
    try {
      resultado = await conferirHoje(edicaoId);
    } catch (err) {
      showError(err.message || 'Erro ao conferir');
      return;
    }

    const divergentes = resultado.subsecoes.filter((s) => !s.igual);

    const conteudo = divergentes.length
      ? el('div', {}, divergentes.map((s) => el('div', { className: 'rpcm-conferencia' }, [
        el('h4', { textContent: `${s.numero}. ${s.titulo}` }),
        el('div', { className: 'rpcm-conferencia__par' }, [
          el('div', {}, [
            el('strong', { textContent: 'Congelado no fechamento' }),
            tabelaSimples(s.cabecalhos, s.congelado),
          ]),
          el('div', {}, [
            el('strong', { textContent: 'O banco diria hoje' }),
            tabelaSimples(s.cabecalhos, s.hoje),
          ]),
        ]),
      ])))
      : el('p', {
        textContent: `As ${resultado.subsecoes.length} subseções calculadas continuam iguais ao congelado. `
          + 'O que a edição afirma é o que o banco diz hoje.',
      });

    openModal({
      title: `Conferência do RPCMTec ${monthName(resultado.mes)}/${resultado.ano}`,
      content: conteudo,
      width: '1100px',
      actions: [{ label: 'Fechar', variant: 'primary', onClick: ({ close }) => close() }],
    });
  }

  function tabelaSimples(cabecalhos, linhas) {
    return el('div', { className: 'rpcm-grade__wrap' }, [
      el('table', { className: 'rpcm-grade rpcm-grade--leitura' }, [
        el('thead', {}, [
          el('tr', {}, (cabecalhos || []).map((c) => el('th', { textContent: c }))),
        ]),
        el('tbody', {}, (linhas || []).map((celulas) => el('tr', {},
          (cabecalhos || []).map((_, i) => el('td', { textContent: celulas[i] ?? '' }))))),
      ]),
    ]);
  }

  async function removerAnexo(anexo) {
    const ok = await confirmDialog({
      title: 'Excluir anexo',
      message: `Excluir "${anexo.nome_original}"? O documento assinado sai do sistema.`,
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;

    try {
      await excluirAnexo(anexo.id);
      showSuccess('Anexo excluído');
      await carregar();
    } catch (err) {
      showError(err.message || 'Erro ao excluir o anexo');
    }
  }

  // -------------------------------------------------------------------------

  async function carregar() {
    try {
      documento = await getDocumento(edicaoId);
      if (disposed) return;
      clearChildren(areaErro);
      desenharCabecalho();
      desenharBarra();
      desenharAvisos();
      desenharCorpo();
      desenharContagemEscondida();
      await desenharAnexos();
      desenharHistorico();
    } catch (err) {
      if (disposed) return;
      // O AVISO FICA NA TELA, e não só no toast.
      //
      // Falhando a PRIMEIRA carga, o cabeçalho, a barra e os anexos nunca foram
      // desenhados: a rota `#/rpcmtec/:id` ficava numa página inteiramente em
      // branco, e o toast some em seis segundos. A partir daí não havia nem o
      // que ler nem o que clicar.
      clearChildren(corpo);
      areaErro.replaceChildren(estadoErro(err, carregar));
      showError(err.message || 'Erro ao carregar a edição do RPCMTec');
    }
  }

  try {
    const lista = await getUsuarios();
    if (!disposed) {
      usuarios = (lista || [])
        .filter((u) => u.ativo)
        .sort((a, b) => b.tipo_posto_grad_id - a.tipo_posto_grad_id
          || a.nome_guerra.localeCompare(b.nome_guerra));
    }
  } catch {
    usuarios = [];
  }

  await carregar();

  return () => {
    disposed = true;
    if (historico) historico.cleanup();
  };
}
