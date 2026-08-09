import { el, svgIcon, ICONS } from '@utils/dom.js';
import { chip } from '@components/status-chip.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { mostrarErro } from '@components/estado-erro.js';
import { formatCurrency, formatDate, toNumber } from '@utils/format.js';
import { isAdmin } from '@store/auth-store.js';
import {
  getMetasPit, getAnosMetaPit, deleteMetaPit, codigoMetaPit,
  listarExercicios, listarRevisoes, getAlteracoesRevisao,
  removerDeclaracao, excluirRevisao, getDiagnosticoPit,
} from '@services/plataforma-service.js';
import { abrirDeclaracaoDialog } from '@pages/revisoes-pit/declaracao-dialog.js';
import { abrirDialogoRevisao } from '@pages/revisoes-pit/revisao-dialog.js';
import { abrirDialogoExercicio } from '@pages/revisoes-pit/exercicio-dialog.js';
import { abrirAnexosRevisao } from '@pages/revisoes-pit/anexos-dialog.js';
import { abrirPublicarRevisao } from '@pages/revisoes-pit/publicar-dialog.js';
import './pit.css';

/**
 * O PIT DO ANO (#/metas). Uma tela só, no lugar das duas que havia.
 *
 * O PRINCÍPIO, e dele decorre a tela inteira: o TEXTO ASSINADO É O REI, e o que
 * está no sistema é TRANSCRIÇÃO dele. Por isso nada se muda numa meta solta:
 * escolhe-se a REVISÃO que declara a mudança e edita-se dentro dela.
 *
 * POR QUE UMA TELA SÓ. Havia "Metas do PIT" e "Revisões do PIT" em itens
 * separados do menu, e a relação entre as duas era invisível: quem procurava o
 * botão de editar na primeira não descobria que ele tinha virado um ato da
 * segunda. O chefe disse, com estas palavras, que não entendia. Juntar as duas
 * é o conserto: em cima o exercício e as revisões, embaixo o consolidado, e o
 * ato sempre dentro da revisão escolhida.
 *
 * AS TRÊS CAMADAS, de cima para baixo, na ordem do fluxo:
 *
 *   EXERCÍCIO   o ano (`pit.pit`). Primeiro passo: sem ele o ano não
 *               aceita meta nem revisão. Em elaboração já aceita alteração, e é
 *               isso que permite montar o PIT de 2027 durante 2026.
 *   REVISÕES    R0, R1, e no máximo um rascunho (índice único no banco). A que
 *               estiver selecionada é a que a tela edita.
 *   METAS       o CONSOLIDADO, de `pit.meta_vigente`, com a coluna "Pelo"
 *               dizendo qual revisão declarou cada linha.
 *
 * O QUE SUMIU, por decisão do chefe: "Editar" solto, "Corrigir transcrição" como
 * botão próprio, "Corrigir cadastro" e "Excluir meta" avulso. Os quatro eram
 * portas diferentes para a mesma coisa, e nenhuma dizia qual documento
 * autorizava a mudança. Agora há um formulário só, dentro da revisão.
 *
 * APAGAR A META continua existindo, e só a partir da revisão que a CRIOU: ela
 * pode ter nascido errada, e o documento assinado talvez nem a tenha. Da segunda
 * declaração em diante o que cabe é CANCELAR.
 *
 * O ANO É ONDE SE COMEÇA, e não um filtro do que já aconteceu. Por isso
 * `permitirOutroAno` é VERDADEIRO aqui e a lista de anos sai dos EXERCÍCIOS,
 * unidos às metas: o exercício recém-aberto não tem meta nenhuma, e enquanto o
 * filtro saía só de `pit.meta` o ano novo era um beco sem saída.
 *
 * LER é de qualquer pessoa logada. ESCREVER é do administrador global, e o
 * servidor cobra: aqui só se esconde o que não adianta oferecer.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderPitAno(container, _ctx) {
  let disposed = false;
  const podeEscrever = isAdmin();

  let exercicio = null;
  let revisoes = [];
  let revisaoSel = null;
  /** As linhas que a revisão selecionada declara, por `meta_id`. */
  let declaradasPelaRevisao = new Map();

  const filtroAno = criarFiltroAno({
    carregarAnos: getAnosMetaPit,
    // VERDADEIRO, e é o conserto do beco sem saída: o PIT de 2027 se monta
    // durante 2026, e o ano dele só aparece na lista depois que o exercício
    // existe. Sem esta opção não haveria como chegar a um ano ainda não aberto.
    permitirOutroAno: true,
    onChange: () => { revisaoSel = null; carregar(); },
  });

  // SEM SUBTÍTULO EXPLICANDO O MODELO, desde 2026-08-06. A frase ensinava que o
  // PIT é o texto assinado pela DSG e que meta se edita dentro da revisão. Quem
  // usa esta tela já sabe, e a tela mostra o mesmo pela FORMA: a faixa de
  // revisões vem antes da grade, e os botões de meta só aparecem com uma revisão
  // escolhida. Texto que repete o que o layout já diz vira ruído que se aprende
  // a pular, e empurra a grade para baixo da dobra.

  const blocoExercicio = el('div', { className: 'pit-exercicio' });
  const faixaRevisoes = el('div', { className: 'pit-revisoes' });
  const detalheRevisao = el('div');
  const painelDiagnostico = el('div');

  const table = createDataTable({
    columns: [
      {
        // `codigo` NÃO vem do servidor: quem o monta é `prepararLinha`. A busca
        // e a ordenação do data-table leem `row[col.key]`, então uma coluna que
        // só existisse no `render` não ordenaria nem apareceria na busca.
        key: 'codigo',
        label: 'Meta',
        sortable: true,
        render: (row) => row.codigo || '-',
      },
      {
        key: 'descricao',
        label: 'Descrição',
        // O CANCELAMENTO APARECE AQUI. Cancelar é o único ato de situação que é
        // da DSG (o andamento e a conclusão a grade calcula), e a meta cancelada
        // continua na lista: apagá-la faria o R0 e o R1 parecerem iguais.
        render: (row) => (row.cancelada
          ? el('span', {}, [
            chip('Cancelada', 'error'),
            el('span', { className: 'meta-cancelada', textContent: ` ${row.descricao || '-'}` }),
          ])
          : (row.descricao || '-')),
      },
      // O que o PIT promete, e o que faz a subseção 2.1 do RPCMTec ser gerável.
      // Vazio na linha de cabeçalho da meta é o certo: quem promete são os itens
      // que ela agrupa.
      {
        key: 'quantidade_prevista',
        label: 'Previsto',
        sortable: true,
        render: (row) => (row.quantidade_prevista == null
          ? '-'
          : `${row.quantidade_prevista}${row.unidade ? ` ${row.unidade}` : ''}`),
      },
      {
        key: 'prazo',
        label: 'Prazo',
        sortable: true,
        render: (row) => (row.prazo ? formatDate(row.prazo) : '-'),
      },
      { key: 'demandante', label: 'Demandante', render: (row) => row.demandante || '-' },
      // DE QUE REVISÃO VEIO ESTA LINHA. É o que torna "consolidado" concreto: a
      // meta 4.2 diz 252 pelo R1, e a 1.1 continua com o que o R0 declarou.
      // Vazio significa que revisão PUBLICADA nenhuma a declarou: ou ela é nova
      // no rascunho, ou o ano ainda não publicou revisão alguma.
      {
        key: 'revisao',
        label: 'Pelo',
        sortable: true,
        render: (row) => row.revisao || '-',
      },
      // O QUE A REVISÃO ESCOLHIDA FAZ COM ESTA LINHA. A tabela `pit.meta_item_revisao`
      // é esparsa, então a meta que a revisão não toca simplesmente não tem linha
      // nela: aqui isso vira um '-', e a que ela toca ganha a etiqueta do ato.
      {
        key: 'nesta_revisao',
        label: 'Nesta revisão',
        render: (row) => {
          if (!row.nesta_revisao) return '-';
          const marca = row.nesta_revisao;
          return el('span', {
            className: `rpcm-etiqueta ${marca.classe}`,
            textContent: marca.texto,
          });
        },
      },
      // O que FINANCIA a promessa: a NC e o item do PDR apontam a meta. NUMERIC
      // chega como texto no JSON, então a ordenação passa por `sortValue`.
      {
        key: 'credito_nc',
        label: 'Crédito (NC)',
        sortable: true,
        sortValue: (row) => (semCreditoNemPdr(row) ? null : toNumber(row.credito_nc)),
        render: (row) => (semCreditoNemPdr(row) ? '-' : formatCurrency(row.credito_nc)),
      },
      {
        key: 'pdr_autorizado',
        label: 'PDR autorizado',
        sortable: true,
        // Nulo aqui é "não informado", e não zero: `valor_autorizado` é anulável.
        // O `sortValue` nulo manda a linha para o fim, em vez de misturá-la com
        // as metas de valor zero.
        sortValue: (row) => (row.pdr_autorizado == null ? null : toNumber(row.pdr_autorizado)),
        render: (row) => formatCurrency(row.pdr_autorizado),
      },
    ],
    rows: [],
    searchable: true,
    pageSize: 50,
    loading: true,
    emptyMessage: 'Nenhuma meta neste exercício. A primeira entra por "Meta nova", '
      + 'dentro de uma revisão.',
    // TODA AÇÃO PASSA PELA REVISÃO ESCOLHIDA, e é isso que a tela ensina: sem
    // revisão selecionada não há botão nenhum, e o aviso acima da tabela diz por
    // quê. `visible` lê o estado da tela a cada pintura.
    actions: podeEscrever ? [
      {
        icon: ICONS.edit,
        title: 'Alterar a meta nesta revisão',
        visible: () => Boolean(revisaoSel),
        onClick: (row) => alterarNaRevisao(row),
      },
      // TIRAR A META DO RASCUNHO é desfazer o acréscimo, e não cancelar: a
      // revisão deixa de tocar a meta, que volta a valer como a anterior a
      // declarou. Só no rascunho: na publicada esta linha é o que o relatório
      // daquele mês reportou.
      {
        icon: ICONS.swapHoriz,
        title: 'Tirar a meta desta revisão',
        visible: (row) => Boolean(revisaoSel) && Boolean(revisaoSel.rascunho)
          && Boolean(row.nesta_revisao),
        onClick: (row) => tirarDaRevisao(row),
      },
      // APAGAR SÓ NA REVISÃO QUE CRIOU. A meta pode ter nascido errada, e o
      // documento assinado talvez nem a tenha. Com mais de uma declaração o
      // servidor recusa, e o que cabe é CANCELAR.
      {
        icon: ICONS.delete,
        title: 'Apagar a meta (só na revisão que a criou)',
        variant: 'danger',
        visible: (row) => Boolean(revisaoSel)
          && Number(row.declaracoes || 0) <= 1
          && Number(row.revisao_criadora_id) === Number(revisaoSel.id),
        onClick: (row) => apagarMeta(row),
      },
    ] : [],
  });

  const novaMetaBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => {
      if (!revisaoSel) return;
      abrirDeclaracaoDialog({ revisao: revisaoSel, onSaved: recarregar });
    },
  }, [svgIcon(ICONS.add, 16), 'Meta nova']);

  const cabecalhoTabela = el('div', { className: 'pit-tabela__cabecalho' }, [
    el('h2', { className: 'pit-tabela__titulo', textContent: 'Metas do exercício' }),
    ...(podeEscrever
      ? [el('div', { className: 'pit-tabela__acoes' }, [novaMetaBtn])]
      : []),
  ]);

  // A tabela vive num nó próprio para o estado de ERRO poder tomar o lugar dela
  // e devolvê-lo depois, sem recriar a tabela. Ver `falhaNaCarga`.
  const areaTabela = el('div', {}, [table.element]);

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'PIT do ano' }),
    ]),
    el('div', { className: 'page__filters' }, [filtroAno.element]),
    blocoExercicio,
    faixaRevisoes,
    detalheRevisao,
    // O aviso fica ACIMA da tabela, e não numa coluna dela. Ele fala de um
    // buraco no CADASTRO, e não de uma propriedade da meta: quem abre o PIT
    // precisa ver que faltam folhas antes de ler os números que já estão lá.
    painelDiagnostico,
    cabecalhoTabela,
    areaTabela,
  ]);
  container.appendChild(page);

  // -------------------------------------------------------------------------
  // Pintura
  // -------------------------------------------------------------------------

  function desenharExercicio() {
    const ano = filtroAno.getAno();
    const acoes = podeEscrever
      ? [el('div', { className: 'pit-exercicio__acoes' }, [
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => abrirDialogoExercicio({
            exercicio, ano, onSaved: recarregar,
          }),
        }, [
          svgIcon(exercicio ? ICONS.edit : ICONS.add, 16),
          exercicio ? 'Editar exercício' : 'Abrir exercício',
        ]),
      ])]
      : [];

    if (!exercicio) {
      // SEM EXERCÍCIO o ano é um beco sem saída: `pit.meta` e `pit.revisao` têm
      // chave estrangeira para `pit.pit(ano)`. A frase diz o que fazer, em
      // vez de deixar a pessoa descobrir pelo 400.
      blocoExercicio.replaceChildren(
        el('h2', { className: 'pit-exercicio__titulo', textContent: `Exercício ${ano}` }),
        el('span', {
          className: 'pit-exercicio__resumo',
          textContent: 'Ainda não existe. Abra o exercício para poder cadastrar '
            + 'revisão e meta neste ano. O PIT do ano que vem se monta assim, '
            + 'em elaboração, antes de virar vigente.',
        }),
        ...acoes,
      );
      return;
    }

    blocoExercicio.replaceChildren(
      el('h2', { className: 'pit-exercicio__titulo', textContent: `Exercício ${exercicio.ano}` }),
      chip(exercicio.situacao || '-', situacaoVariante(exercicio.situacao_id)),
      el('span', {
        className: 'pit-exercicio__resumo',
        textContent: `${exercicio.metas} meta(s)  ·  ${exercicio.revisoes} revisão(ões)`
          + (exercicio.observacao ? `  ·  ${exercicio.observacao}` : ''),
      }),
      ...acoes,
    );
  }

  function desenharRevisoes() {
    const ano = filtroAno.getAno();

    const botoes = revisoes.map((r) => el('button', {
      className: 'pit-revisao'
        + (revisaoSel && Number(revisaoSel.id) === Number(r.id) ? ' pit-revisao--selecionada' : ''),
      type: 'button',
      'aria-pressed': revisaoSel && Number(revisaoSel.id) === Number(r.id) ? 'true' : 'false',
      onClick: () => selecionarRevisao(r),
    }, [
      el('span', { className: 'pit-revisao__codigo', textContent: r.codigo }),
      el('span', {
        className: 'pit-revisao__estado',
        textContent: r.rascunho
          ? 'Rascunho'
          : `Rege desde ${r.data_vigencia ? formatDate(r.data_vigencia) : '-'}`,
      }),
      el('span', {
        className: 'pit-revisao__altera',
        textContent: `${r.alteracoes} meta(s)  ·  ${r.anexos} anexo(s)`,
      }),
    ]));

    // NOVA REVISÃO só com exercício aberto: sem ele o servidor recusa com 400.
    // O botão fica desabilitado e o motivo aparece no title, em vez de a pessoa
    // descobrir pelo erro.
    if (podeEscrever) {
      const temRascunho = revisoes.some((r) => r.rascunho);
      const nova = el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => abrirDialogoRevisao({ ano, onSaved: recarregar }),
      }, [svgIcon(ICONS.add, 16), 'Nova revisão']);
      nova.disabled = !exercicio || temRascunho;
      if (!exercicio) {
        nova.title = 'Abra o exercício deste ano antes de criar uma revisão';
      } else if (temRascunho) {
        // UM RASCUNHO POR ANO, cobrado por índice parcial no banco: com dois
        // abertos, a alteração de uma meta cairia na revisão errada sem ninguém
        // perceber.
        nova.title = 'Já existe uma revisão em rascunho neste ano. Publique-a ou '
          + 'exclua-a antes de abrir outra.';
      }
      botoes.push(nova);
    }

    if (!revisoes.length && !podeEscrever) {
      faixaRevisoes.replaceChildren(el('p', {
        className: 'pit-sem-revisao',
        textContent: 'Nenhuma revisão neste exercício. O R0 é a primeira, e é o PIT original.',
      }));
      return;
    }

    faixaRevisoes.replaceChildren(...botoes);
  }

  function desenharDetalheRevisao() {
    if (!revisaoSel) {
      detalheRevisao.replaceChildren(el('p', {
        className: 'pit-sem-revisao',
        textContent: revisoes.length
          ? 'Escolha uma revisão acima. Acrescentar, alterar e cancelar meta são '
            + 'atos da DSG, e cada um acontece dentro da revisão que o declara. '
            + 'A tabela abaixo mostra o plano consolidado, depois de todas elas.'
          : 'Este exercício ainda não tem revisão. O R0 é a primeira, e é o PIT '
            + 'original: cadastre-o, anexe o documento assinado e transcreva as '
            + 'metas dentro dele.',
      }));
      return;
    }

    const r = revisaoSel;

    // A NOTA SÓ EXISTE NO RASCUNHO, desde 2026-08-06.
    //
    // A da revisão PUBLICADA saiu inteira. A primeira metade ("R2 publicada,
    // regendo desde tal dia") repetia o botão da revisão escolhida, logo acima,
    // que já traz o código e o "Rege desde". A segunda metade explicava o
    // modelo, e quem usa esta tela já o conhece.
    //
    // A DO RASCUNHO FICA, e não é o mesmo caso: ela avisa que NADA ali rege
    // ainda. Quem altera metas num rascunho e sai da tela pode concluir que já
    // mudou o plano, e a diferença entre rascunho e publicada é a única coisa
    // nesta tela que o layout não mostra sozinho.
    const nota = r.rascunho
      ? `RASCUNHO ${r.codigo}: nada aqui rege ainda. Altere, cancele e acrescente `
        + 'meta, confira contra o documento da DSG e publique. A coluna "Pelo" só '
        + 'passa a mostrar esta revisão depois de publicada.'
      : '';

    const acoes = [];
    acoes.push(el('button', {
      className: 'btn btn--secondary',
      type: 'button',
      onClick: () => abrirAnexosRevisao({ revisao: r, onAlterado: recarregar }),
    }, [svgIcon(ICONS.description, 16), 'Documento assinado']));

    if (podeEscrever) {
      acoes.push(el('button', {
        className: 'btn btn--secondary',
        type: 'button',
        onClick: () => abrirDialogoRevisao({ revisao: r, onSaved: recarregar }),
      }, [svgIcon(ICONS.edit, 16), 'Dados da revisão']));

      if (r.rascunho) {
        acoes.push(el('button', {
          className: 'btn btn--primary',
          type: 'button',
          onClick: () => abrirPublicarRevisao({
            revisao: r, alteracoes: r.alteracoes, onPublicado: recarregar,
          }),
        }, [svgIcon(ICONS.checkCircle, 16), 'Publicar']));

        acoes.push(el('button', {
          className: 'btn btn--danger-text',
          type: 'button',
          onClick: () => excluirRascunho(r),
        }, [svgIcon(ICONS.delete, 16), 'Excluir rascunho']));
      }
    }

    // O parágrafo só entra QUANDO HÁ TEXTO. Um `<p>` vazio na revisão publicada
    // ocuparia a mesma altura, e o espaço em branco entre a faixa e os botões
    // leria como carregamento que não terminou.
    detalheRevisao.replaceChildren(el('div', { className: 'pit-revisao-detalhe' }, [
      nota ? el('p', { className: 'pit-revisao-detalhe__texto', textContent: nota }) : null,
      el('div', { className: 'pit-revisao-detalhe__acoes' }, acoes),
    ]));
  }

  // -------------------------------------------------------------------------
  // Dados
  // -------------------------------------------------------------------------

  /**
   * Estado de ERRO no lugar da tabela.
   *
   * Zerar as linhas fazia a tabela escrever "Nenhuma meta neste exercício": a
   * falha da API lia-se como ano sem PIT, e as duas pedem ações opostas.
   *
   * A tabela volta ANTES do aviso porque `mostrarErro` guarda o que estava no
   * nó: uma segunda falha guardaria o próprio aviso, e "Tentar de novo" pararia
   * de devolver a tabela.
   */
  function falhaNaCarga(err) {
    areaTabela.replaceChildren(table.element);
    mostrarErro(areaTabela, err, carregar);
  }

  /** A linha do servidor, mais o `codigo` e o que a revisão escolhida faz nela. */
  function prepararLinha(meta) {
    const declarada = declaradasPelaRevisao.get(String(meta.id)) || null;
    return {
      ...meta,
      codigo: codigoMetaPit(meta),
      // A ETIQUETA DIZ QUAL DAS TRÊS OPERAÇÕES A LINHA É. Sem ela, uma meta
      // cancelada e uma alterada se parecem: as duas são apenas "uma linha".
      nesta_revisao: declarada
        ? (declarada.cancelada
          ? { texto: 'Cancela', classe: 'rpcm-etiqueta--pendente' }
          : (declarada.meta_nova
            ? { texto: 'Acrescenta', classe: 'rpcm-etiqueta--calculada' }
            : { texto: 'Altera', classe: 'rpcm-etiqueta--digitada' }))
        : null,
      declarada,
    };
  }

  /** Relê o que a revisão escolhida declara e repinta a tabela, sem recarregar tudo. */
  async function carregarAlteracoes(metas) {
    declaradasPelaRevisao = new Map();
    if (revisaoSel) {
      // A FALHA NÃO DERRUBA A TELA: sem esta lista o consolidado continua
      // legível, que é a leitura que mais importa aqui.
      try {
        const linhas = await getAlteracoesRevisao(revisaoSel.id);
        for (const l of linhas || []) declaradasPelaRevisao.set(String(l.meta_id), l);
      } catch (err) {
        showError(err.message || 'Erro ao ler o que a revisão altera');
      }
    }
    if (disposed) return;
    table.update({ rows: (metas || []).map(prepararLinha), loading: false });
  }

  /** As linhas que a tabela tem hoje, para repintar sem ir ao servidor de novo. */
  let metasDoAno = [];

  /** O que falta cadastrar em cada meta automática. Ver `desenharDiagnostico`. */
  let diagnostico = [];

  async function selecionarRevisao(r) {
    // Clicar de novo na mesma revisão a DESMARCA. É o caminho de volta para o
    // modo de leitura, e sem ele a tela nunca voltaria a dizer "escolha uma
    // revisão", que é a frase que ensina o modelo.
    revisaoSel = revisaoSel && Number(revisaoSel.id) === Number(r.id) ? null : r;
    desenharRevisoes();
    desenharDetalheRevisao();
    atualizarNovaMeta();
    await carregarAlteracoes(metasDoAno);
  }

  function atualizarNovaMeta() {
    novaMetaBtn.disabled = !revisaoSel;
    novaMetaBtn.title = revisaoSel
      ? `A meta nova entra na revisão ${revisaoSel.codigo}`
      : 'Escolha a revisão que acrescenta a meta';
  }

  // Onde se cadastra a entidade que cumpre cada origem. A rota é a MESMA que o
  // menu abre: o aviso leva à tela de sempre, e não a um formulário paralelo que
  // só o PIT conhece.
  const ONDE_CADASTRAR = {
    2: { rota: '#/capacitacao_ministrada', o_que: 'a capacitação' },
    3: { rota: '#/acervo', o_que: 'a versão do acervo' },
    4: { rota: '#/mapoteca/pedidos', o_que: 'o pedido da mapoteca' },
  };

  /**
   * O AVISO DO CADASTRO, e a razão dele é que o erro aqui é SILENCIOSO.
   *
   * Numa meta automática o número não se digita: ele é contado das versões, das
   * capacitações e dos pedidos ligados a ela. Esquecer de cadastrar não dá erro,
   * dá ZERO, e zero na grade é indistinguível de "o mês ainda não chegou". O
   * plano do ano é justamente onde ninguém procura defeito.
   *
   * DUAS FALTAS, e elas são diferentes:
   *   FALTA CADASTRAR   a soma do que existe não chega ao que o PIT promete.
   *   DATA DE OUTRO ANO a entidade está ligada a um item DESTE PIT e promete um
   *                     mês de outro. O planejado da grade filtra por ano e não
   *                     a vê: ela some da curva sem nada dizer.
   *
   * A DATA EM BRANCO NÃO ENTRA, e é o padrão do sistema: ela é preenchida
   * conforme os PITs chegam. Enquanto ela contava como pendência, toda meta
   * automática aparecia aqui, inclusive as três com o cadastro COMPLETO.
   *
   * O PAINEL SOME QUANDO NÃO HÁ NADA A DIZER. Aviso permanente vira moldura, e
   * moldura não se lê.
   */
  function desenharDiagnostico() {
    // A DATA EM BRANCO NAO E PENDENCIA, desde 2026-08-06. Ela e o padrao: a
    // `data_prevista` vai sendo preenchida conforme os PITs chegam, e quase nada
    // do acervo e do PIT (115 versoes de 7.572, e 16 pedidos de 165). Enquanto
    // ela entrava aqui, TODA meta automatica aparecia como pendencia, e o painel
    // acusava meta com o cadastro completo.
    //
    // `fora_do_ano` ENTRA, e e outra coisa: a entidade esta ligada a um item
    // deste PIT e promete um mes de OUTRO ano. O planejado da grade filtra por
    // ano e nao a ve, entao ela some da curva sem nada dizer.
    const problemas = (diagnostico || []).filter(
      (d) => Number(d.faltam) > 0 || Number(d.fora_do_ano) > 0
    );

    if (problemas.length === 0) {
      painelDiagnostico.replaceChildren();
      return;
    }

    const linhas = problemas.map((d) => {
      const destino = ONDE_CADASTRAR[Number(d.origem_id)];
      const partes = [];

      if (Number(d.faltam) > 0) {
        // O QUE JA ESTA CADASTRADO entra na frase. "faltam 2 de 327" sozinho
        // nao diz se ha 325 ou nenhum, e as duas situacoes pedem acoes opostas.
        partes.push(
          `faltam ${d.faltam} de ${d.quantidade_prevista} `
          + `(${d.cadastradas} ja cadastrado(s))`
        );
      }
      if (Number(d.fora_do_ano) > 0) {
        partes.push(
          `${d.fora_do_ano} com data prevista de OUTRO ano, fora do planejado deste PIT`
        );
      }

      return el('li', { className: 'pit-aviso__item' }, [
        el('strong', { textContent: `Meta ${codigoMetaPit(d)}` }),
        ` (${d.origem}): ${partes.join(', ')}. `,
        destino
          ? el('a', {
            className: 'pit-aviso__link',
            href: destino.rota,
            textContent: `Cadastrar ${destino.o_que}`,
          })
          : null,
      ].filter(Boolean));
    });

    painelDiagnostico.replaceChildren(el('div', { className: 'pit-aviso' }, [
      el('div', { className: 'pit-aviso__titulo' }, [
        svgIcon(ICONS.warning, 16),
        'O cadastro não cobre o que o PIT promete',
      ]),
      el('p', { className: 'pit-aviso__texto' }, [
        'Estas metas contam sozinhas, das entidades ligadas a elas. ',
        'O que não estiver cadastrado conta ZERO na execução, sem erro nenhum.',
      ]),
      el('ul', { className: 'pit-aviso__lista' }, linhas),
    ]));
  }

  async function carregar() {
    // Uma recarga com o aviso na tela devolve a tabela antes de pintar nela.
    if (!areaTabela.contains(table.element)) areaTabela.replaceChildren(table.element);

    const ano = filtroAno.getAno();
    table.update({ loading: true });

    let exercicios = [];
    let metas = [];
    try {
      [exercicios, revisoes, metas] = await Promise.all([
        listarExercicios(),
        listarRevisoes(ano),
        getMetasPit(ano),
      ]);
    } catch (err) {
      if (disposed) return;
      table.update({ loading: false });
      falhaNaCarga(err);
      showError(err.message || 'Erro ao carregar o PIT do ano');
      return;
    }
    if (disposed) return;

    exercicio = (exercicios || []).find((e) => Number(e.ano) === Number(ano)) || null;
    revisoes = revisoes || [];
    metasDoAno = metas || [];

    // A REVISÃO ESCOLHIDA SOBREVIVE À RECARGA, e é o que faz "salvar não
    // reconstruir a tela": quem acabou de alterar uma meta continua dentro da
    // mesma revisão. Some só quando ela deixou de existir (o rascunho excluído,
    // ou a troca de ano).
    revisaoSel = revisaoSel
      ? revisoes.find((r) => Number(r.id) === Number(revisaoSel.id)) || null
      : null;

    desenharExercicio();
    desenharRevisoes();
    desenharDetalheRevisao();
    atualizarNovaMeta();
    await carregarAlteracoes(metasDoAno);
    await carregarDiagnostico(ano);
  }

  /**
   * O diagnóstico do cadastro, em requisição PRÓPRIA e tolerante à falha.
   *
   * FORA do `Promise.all` da carga, de propósito. Esta tela LÊ para qualquer
   * pessoa logada, e a rota do diagnóstico é do gerente para cima (ela devolve o
   * planejado meta a meta, que é o dado da grade). Junto das outras três, o 403
   * de quem não é gerente derrubaria o PIT inteiro para todo mundo, e o aviso
   * vale menos que a tela.
   */
  async function carregarDiagnostico(ano) {
    try {
      const dados = await getDiagnosticoPit(ano);
      if (disposed) return;
      diagnostico = dados || [];
    } catch (err) {
      diagnostico = [];
    }
    desenharDiagnostico();
  }

  /** Relê tudo depois de uma gravação, mantendo a revisão escolhida. */
  async function recarregar() {
    await carregar();
  }

  // -------------------------------------------------------------------------
  // Atos
  // -------------------------------------------------------------------------

  function alterarNaRevisao(row) {
    if (!revisaoSel) return;
    const declarada = row.declarada;
    abrirDeclaracaoDialog({
      revisao: revisaoSel,
      meta: {
        metaId: row.id,
        codigo: row.codigo,
        numero_meta: row.numero_meta,
        item: row.item,
        unidade_id: row.unidade_id,
        // OS VALORES SÃO OS DA REVISÃO ESCOLHIDA quando ela já declara a meta, e
        // os do consolidado quando não. Sem isso, abrir uma meta dentro do R1
        // mostraria o que o R0 diz, e salvar reescreveria o R1 com o valor
        // velho.
        descricao: declarada ? declarada.descricao : row.descricao,
        quantidade_prevista: declarada ? declarada.quantidade_prevista : row.quantidade_prevista,
        prazo: declarada ? declarada.prazo : row.prazo,
        demandante: declarada ? declarada.demandante : row.demandante,
        cancelada: declarada ? declarada.cancelada : row.cancelada,
        jaNaRevisao: Boolean(declarada),
        // De que revisão vem o valor que o formulário mostra. Só existe para a
        // meta que esta revisão ainda não declara.
        revisaoAnterior: declarada ? null : (row.revisao || null),
      },
      onSaved: recarregar,
    });
  }

  async function tirarDaRevisao(row) {
    if (!revisaoSel) return;
    const ok = await confirmDialog({
      title: `Tirar a meta ${row.codigo} da revisão ${revisaoSel.codigo}`,
      message: 'A revisão deixa de alterar esta meta, e ela volta a valer como a '
        + 'revisão anterior a declarou. É diferente de CANCELAR a meta, que é uma '
        + 'alteração e continua aparecendo aqui.',
      confirmLabel: 'Tirar da revisão',
      danger: true,
    });
    if (!ok) return;

    try {
      await removerDeclaracao(revisaoSel.id, row.id);
    } catch (err) {
      showError(err.message || 'Erro ao tirar a meta da revisão');
      return;
    }

    showSuccess(`Meta ${row.codigo} tirada da revisão ${revisaoSel.codigo}`);
    // A RELEITURA fica FORA do try da escrita. Juntas, uma releitura que
    // falhasse pintava "tirada" e "erro ao tirar" em sequência, sobre uma tabela
    // que ainda mostrava a meta: duas mensagens contraditórias sobre uma escrita
    // que já aconteceu.
    await recarregar();
  }

  async function apagarMeta(row) {
    if (!revisaoSel) return;
    const ok = await confirmDialog({
      title: `Apagar a meta ${row.codigo}`,
      message: `A meta ${row.codigo} de ${row.ano} sai do PIT, e com ela a `
        + `declaração da revisão ${revisaoSel.codigo}, que é a única que a tem. `
        + 'Só se apaga a meta que nasceu errada: a que já entrou no plano se '
        + 'CANCELA, dentro de uma revisão. Esta ação não se desfaz.',
      confirmLabel: 'Apagar a meta',
      danger: true,
    });
    if (!ok) return;

    try {
      await deleteMetaPit(row.id, revisaoSel.id);
    } catch (err) {
      showError(err.message || 'Erro ao apagar a meta');
      return;
    }
    showSuccess(`Meta ${row.codigo} apagada`);
    await recarregar();
  }

  async function excluirRascunho(r) {
    const ok = await confirmDialog({
      title: `Excluir o rascunho ${r.codigo}`,
      message: `O rascunho e as ${r.alteracoes} alteração(ões) dele somem. `
        + 'As metas voltam a valer como a revisão anterior as declarou.',
      confirmLabel: 'Excluir',
      danger: true,
    });
    if (!ok) return;

    try {
      await excluirRevisao(r.id);
    } catch (err) {
      showError(err.message || 'Erro ao excluir o rascunho');
      return;
    }
    showSuccess('Rascunho excluído');
    revisaoSel = null;
    await recarregar();
  }

  await carregar();

  return () => {
    disposed = true;
    table._cleanup();
  };
}

/**
 * A meta que não recebeu crédito nenhum e não tem PDR autorizado.
 *
 * As duas colunas do dinheiro nasciam desencontradas. `pdr_autorizado` é a SOMA
 * de `orcamento.pdr_item.valor_autorizado`, que é anulável, e some da tela como
 * '-' quando item nenhum aponta a meta. `credito_nc` é a soma de
 * `orcamento.nota_credito.valor_nc`, que é NOT NULL, e o servidor a envolve em
 * COALESCE para zero. A meta sem nada escrevia '-' num lado e 'R$ 0,00' no
 * outro, e os dois querem dizer a mesma coisa: nada a declarar.
 *
 * A CONDIÇÃO TEM DUAS PARTES, e a segunda é o que impede a tela de mentir.
 * Crédito com valor e PDR nulo NÃO é resíduo: é o item do PDR que aponta a meta
 * e recebeu crédito sem ter `valor_autorizado` preenchido, coisa que acontece
 * enquanto o PDR do ano ainda está sendo transcrito. Apagá-lo atrás de '-'
 * sumiria com crédito real do relatório do chefe.
 *
 * A JUSTIFICATIVA MUDOU NA 1.31.0, e o caso velho já não existe. Antes esta
 * segunda parte defendia a NC Extra-PDR, que apontava meta sem passar pelo PDR.
 * Ela não chega mais a `credito_nc`: a meta da NC agora vem do item do PDR, e
 * Extra-PDR é justamente a NC sem item. A guarda continua valendo, pelo motivo
 * novo acima.
 *
 * O zero com PDR autorizado também continua 'R$ 0,00': ali o zero é notícia (a
 * meta foi autorizada e o crédito não chegou), e não ausência.
 *
 * @param {{credito_nc:(number|string|null), pdr_autorizado:(number|string|null)}} row
 * @returns {boolean}
 */
function semCreditoNemPdr(row) {
  return row.pdr_autorizado == null && toNumber(row.credito_nc) === 0;
}

/** Espelha `dominio.situacao_exercicio`: 1 Em elaboração, 2 Vigente, 3 Encerrado. */
function situacaoVariante(situacaoId) {
  if (Number(situacaoId) === 1) return 'warning';
  if (Number(situacaoId) === 3) return 'default';
  return 'success';
}
