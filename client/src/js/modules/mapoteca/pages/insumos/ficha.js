import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatDateTime, formatNumber, monthName } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { chip, badgeAbaixoMinimo } from '@components/status-chip.js';
import { reconciliar } from '@utils/reconciliar.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import {
  getTipoMaterial, getMovimentosMaterial, getConsumoMensal, getAnosMapoteca,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { permissoes } from '@store/auth-store.js';
import { criarHistorico } from '@components/historico/historico.js';
import { TIPO_LOCALIZACAO, NOME_LOCALIZACAO } from '@modules/mapoteca/movimento-material.js';
import { openMaterialDialog } from './material-dialog.js';
import {
  openConsumoDialog,
  openEntradaDialog,
  openTransferenciaDialog,
  openContagemDialog,
} from './movimento-dialogs.js';

/**
 * Repinta um container cujos filhos tem PAPEL fixo (o cabecalho, um cartao).
 *
 * Cada item traz a chave do papel e a fabrica do no. Papel que sai da lista some
 * da tela, e o papel que fica mantem o MESMO no. E o que preserva o foco do
 * teclado e a rolagem numa parte da tela que muda de forma, e nao so de texto.
 *
 * A funcao esta repetida na ficha do plotter. Duas copias curtas, de proposito:
 * promover para `utils/` na terceira tela que precisar dela.
 *
 * @param {Element} container
 * @param {Array<{chave:string, criar:()=>Node}|null>} itens - nulo se omite
 */
function pintarPapeis(container, itens) {
  reconciliar(container, itens.filter(Boolean), {
    chave: (item) => item.chave,
    criar: (item) => item.criar(),
  });
}

/**
 * Monta ou repinta o cartao de resumo, sempre no MESMO no.
 * O selo entra e sai com o estoque, e some do DOM quando nao ha: um no vazio
 * somaria a margem de 6 px em todo cartao sem selo.
 * @param {HTMLElement} cartao
 * @param {{rotulo:string, valor:string, selo:boolean}} dado
 * @returns {HTMLElement} o mesmo cartao
 */
function pintarCartao(cartao, dado) {
  pintarPapeis(cartao, [
    { chave: 'valor', criar: () => el('div', { className: 'summary-card__value' }) },
    {
      chave: 'rotulo',
      criar: () => el('div', { className: 'summary-card__label', textContent: dado.rotulo }),
    },
    dado.selo
      ? {
        chave: 'selo',
        criar: () => el('div', { style: { marginTop: '6px' } }, [badgeAbaixoMinimo()]),
      }
      : null,
  ]);
  cartao.querySelector('.summary-card__value').textContent = dado.valor;
  return cartao;
}

function backButton() {
  return el('button', {
    className: 'btn btn--text',
    type: 'button',
    'aria-label': 'Voltar para insumos',
    onClick: () => { location.hash = '/mapoteca/insumos'; },
  }, [svgIcon(ICONS.arrowBack, 18), 'Voltar']);
}

/** 'AAAA-MM-DD' do primeiro e do ultimo dia de um mes (ou do ano inteiro). */
function intervalo(ano, mes) {
  if (!mes) return { inicio: `${ano}-01-01`, fim: `${ano}-12-31` };
  const dois = String(mes).padStart(2, '0');
  // Dia 0 do mes SEGUINTE e o ultimo dia deste. Evita a tabela de 28/29/30/31.
  const ultimo = new Date(ano, mes, 0).getDate();
  return { inicio: `${ano}-${dois}-01`, fim: `${ano}-${dois}-${String(ultimo).padStart(2, '0')}` };
}

/**
 * FICHA DO INSUMO (#/mapoteca/insumos/:id): o LIVRO daquele material e as acoes.
 *
 * A pergunta que ela responde e "o que aconteceu com este material", e ela nao
 * se responde com um quarto dos movimentos: a tabela do livro traz os QUATRO
 * tipos (Entrada, Transferencia, Consumo e Contagem), filtraveis por mes. A
 * ficha antiga mostrava so "Consumo recente", e quem visse o saldo cair por uma
 * transferencia nao tinha onde ler isso.
 *
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderInsumoFicha(container, { params }) {
  const id = Number(params.id);
  const pode = permissoes('mapoteca');
  let disposed = false;
  let cleanups = [];

  // A ficha viva, lida no MOMENTO do clique. Os botoes de acao sobrevivem a
  // recarga, e um `material` capturado na montagem ficaria velho.
  let material = null;
  // O saldo por localizacao, na forma que os dialogos esperam. Refeito a cada
  // carga a partir de `material.estoque.registros`.
  let saldos = new Map();
  // Os nos da pagina, montados uma vez. Nulo antes da primeira carga, e nulo de
  // novo depois de um erro, que troca a ficha pela tela de erro.
  let tela = null;

  // O ANO E O MES filtram o LIVRO e o grafico de consumo, que sao as duas partes
  // historicas da ficha. O cadastro e o saldo nao tem ano: saldo e o de HOJE.
  //
  // Os dois nascem aqui, e nao no `montarTela`, porque a primeira carga LE o
  // filtro antes de a ficha existir. Sem "+ Outro ano": o filtro so recorta o
  // que ja aconteceu.
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnosMapoteca,
    permitirOutroAno: false,
    onChange: () => load(),
  });

  const filtroMes = createSelectField({
    label: 'Mês',
    placeholder: 'O ano inteiro',
    options: Array.from({ length: 12 }, (_, i) => ({ value: i + 1, label: monthName(i + 1) })),
    onChange: () => load(),
  });

  function dispose() {
    for (const fn of cleanups) {
      try { fn(); } catch { /* noop */ }
    }
    cleanups = [];
  }

  /** Recarrega a ficha depois de um lancamento. */
  const recarregar = () => load();

  /**
   * Monta a ficha UMA vez. Dai em diante o `load` so repinta.
   *
   * O DEFEITO QUE ISTO CORRIGE. O `createDataTable` rodava dentro do `load`, e
   * cada gravacao jogava fora o objeto da tabela. Iam junto a busca, a
   * ordenacao, a pagina atual, a selecao e o foco do teclado, porque esse estado
   * mora no OBJETO da tabela, e nao no DOM. O chefe mediu o efeito assim:
   * "quando edita a UI reconstroi, que torna muito chato ficar editando pois a
   * tela fica se movendo".
   */
  function montarTela() {
    const voltar = backButton();
    const titulo = el('h1', { className: 'page__title' });
    const areaTitulo = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
    });

    // AS ACOES, na ordem que o chefe pediu: Consumir na frente, porque e o
    // lancamento de todo dia e o unico que alimenta a 7.2 do RPCMTec.
    const botao = (rotulo, icone, variante, aoClicar) => el('button', {
      className: `btn btn--${variante}`,
      type: 'button',
      onClick: aoClicar,
    }, [svgIcon(icone, 16), rotulo]);

    const acoes = [
      botao('Consumir', ICONS.dataUsage, 'primary',
        () => openConsumoDialog({ material, saldos, onSaved: recarregar })),
      botao('Entrada', ICONS.download, 'secondary',
        () => openEntradaDialog({ material, onSaved: recarregar })),
      botao('Transferir', ICONS.swapHoriz, 'secondary',
        () => openTransferenciaDialog({ material, saldos, onSaved: recarregar })),
      botao('Contagem', ICONS.checkCircle, 'secondary',
        () => openContagemDialog({ material, saldos, onSaved: recarregar })),
      botao('Editar cadastro', ICONS.edit, 'text',
        () => openMaterialDialog({ material, onSaved: recarregar })),
    ];

    const cabecalho = el('div', { className: 'page__header' }, [
      areaTitulo,
      // Lancar e do OPERADOR no servidor. Quem so consulta le a ficha inteira.
      el('div', { className: 'page__actions' }, pode.operador ? acoes : []),
    ]);

    const descricao = el('p', {
      style: { color: 'var(--text-secondary)', marginBottom: 'var(--space-lg)' },
    });

    const resumo = el('div', { className: 'summary-cards' });

    // -------------------------------------------------------------------------
    // Estoque por localização
    // -------------------------------------------------------------------------
    // Nasce carregando: a lista chega com a resposta, e o estado vazio antes
    // dela diria "sem estoque" para um material que tem estoque.
    const estoqueTable = createDataTable({
      columns: [
        { key: 'localizacao_nome', label: 'Localização', sortable: true },
        {
          key: 'quantidade',
          label: 'Quantidade',
          sortable: true,
          render: (row) => formatNumber(row.quantidade),
        },
        {
          key: 'data_atualizacao',
          label: 'Atualizado em',
          render: (row) => formatDateTime(row.data_atualizacao || row.data_criacao),
        },
      ],
      rows: [],
      loading: true,
      pageSize: 10,
      emptyMessage: 'Sem estoque registrado para este insumo',
    });
    cleanups.push(() => estoqueTable._cleanup());

    // -------------------------------------------------------------------------
    // O LIVRO
    // -------------------------------------------------------------------------
    // As colunas de origem e destino SAO DUAS, e nao uma de "movimentação": e a
    // combinacao delas que diz o que aconteceu. Entrada tem so destino, consumo
    // tem so origem, e contagem tem exatamente um dos dois, conforme a
    // prateleira tenha sobrado ou faltado.
    const livroTable = createDataTable({
      columns: [
        {
          key: 'data_movimento',
          label: 'Data',
          sortable: true,
          render: (row) => formatDate(row.data_movimento),
        },
        { key: 'tipo_movimento_nome', label: 'Movimento', sortable: true },
        {
          key: 'quantidade',
          label: 'Quantidade',
          sortable: true,
          render: (row) => formatNumber(row.quantidade),
        },
        {
          key: 'localizacao_origem_nome',
          label: 'De',
          render: (row) => row.localizacao_origem_nome || '-',
        },
        {
          key: 'localizacao_destino_nome',
          label: 'Para',
          render: (row) => row.localizacao_destino_nome || '-',
        },
        { key: 'motivo', label: 'Motivo', render: (row) => row.motivo || '-' },
        {
          key: 'usuario_criacao_nome',
          label: 'Lançado por',
          render: (row) => row.usuario_criacao_nome || '-',
        },
      ],
      rows: [],
      loading: true,
      pageSize: 25,
      searchable: true,
      emptyMessage: 'Nenhum movimento neste período',
    });
    cleanups.push(() => livroTable._cleanup());

    // O filtro fica na barra de controle do livro, no molde da barra de
    // exportacao das outras telas. Ele vale para o livro E para o grafico logo
    // abaixo, que sao as duas partes da ficha que tem periodo.
    const barraFiltro = el('div', { className: 'export-bar' }, [
      filtroAno.element,
      filtroMes.element,
    ]);

    const secaoEstoque = el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Estoque por localização' }),
      ]),
      estoqueTable.element,
    ]);

    const secaoLivro = el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Livro de movimentos' }),
      ]),
      barraFiltro,
      livroTable.element,
    ]);

    // -------------------------------------------------------------------------
    // Consumo mensal do ano (bar chart)
    // -------------------------------------------------------------------------
    // O titulo carrega o ano, e o ano muda: por isso ele se escreve no `pintar`.
    const consumoChart = createBarChart({
      title: '',
      data: [],
      xKey: 'mes_nome',
      series: [{ dataKey: 'quantidade', label: 'Quantidade consumida' }],
    });
    cleanups.push(() => consumoChart._cleanup());

    // Histórico de alterações. É o MESMO componente da ficha do pedido, e é por
    // isso que ele existe: a seção que o chefe gostou lá vale em toda ficha.
    //
    // O agregado é `material`, e ele reúne o cadastro, o estoque e o livro: quem
    // pergunta "por que o saldo caiu" quer os três no mesmo lugar, e o efeito
    // que o gatilho do banco aplicou aparece aqui com origem "Efeito no banco".
    //
    // Ele busca sozinho ao nascer. Nas cargas seguintes quem o atualiza é o
    // `load`, por `recarregar()`.
    const historico = criarHistorico({
      modulo: 'mapoteca',
      entidade: 'material',
      id,
      subtitulo: 'Alterações no cadastro, no estoque e no livro deste insumo',
    });
    cleanups.push(() => historico.cleanup());

    return {
      pagina: el('div', { className: 'page' }),
      cabecalho,
      areaTitulo,
      voltar,
      titulo,
      descricao,
      resumo,
      secaoEstoque,
      secaoLivro,
      estoqueTable,
      livroTable,
      consumoChart,
      tituloGrafico: consumoChart.querySelector('.chart-card__title'),
      // Assinatura do que o grafico ja mostra. Ver o comentario no `pintar`.
      assinaturaGrafico: null,
      // Quantas linhas cada tabela mostra agora. Ver `marcarCarregando`.
      linhasEstoque: 0,
      linhasLivro: 0,
      historico,
    };
  }

  /**
   * Avisa a tabela de que uma recarga comecou.
   *
   * So a tabela que JA tem linhas e marcada. A tabela vazia trocaria a mensagem
   * de vazio por um esqueleto de dez linhas, e a tela pularia justamente no
   * caso em que nao ha nada a preservar.
   * @param {{update:Function}} tabela
   * @param {number} linhas
   */
  function marcarCarregando(tabela, linhas) {
    if (linhas > 0) tabela.update({ loading: true });
  }

  /** Escreve o dado novo nos nos que ja existem. */
  function pintar(movimentos, consumoMensal, ano) {
    const disponivel = Number(material.estoque?.disponivel || 0);
    // O ALERTA CONTA O DISPONIVEL (Seção + Almoxarifado), e nao o total das
    // quatro localizacoes: material comprado e ainda nao entregue nao tapa buraco
    // nenhum na prateleira.
    const abaixoMinimo = material.estoque_minimo !== null
      && disponivel < Number(material.estoque_minimo);

    tela.titulo.textContent = material.nome;

    // O cabecalho e uma lista curta de nos com papel fixo. Voltar e o titulo
    // mantem o no; so os selos entram e saem.
    pintarPapeis(tela.areaTitulo, [
      { chave: 'voltar', criar: () => tela.voltar },
      { chave: 'titulo', criar: () => tela.titulo },
      {
        // A chave carrega o ESTADO: o chip so se refaz quando ele muda.
        chave: `ativo:${material.ativo}`,
        criar: () => chip(
          material.ativo ? 'Ativo' : 'Inativo',
          material.ativo ? 'success' : 'default',
        ),
      },
      abaixoMinimo ? { chave: 'minimo', criar: () => badgeAbaixoMinimo() } : null,
    ]);

    const cartoes = [
      { rotulo: 'Disponível', valor: formatNumber(disponivel), selo: abaixoMinimo },
      {
        rotulo: NOME_LOCALIZACAO[TIPO_LOCALIZACAO.SECAO],
        valor: formatNumber(saldos.get(TIPO_LOCALIZACAO.SECAO) || 0),
        selo: false,
      },
      {
        rotulo: NOME_LOCALIZACAO[TIPO_LOCALIZACAO.ALMOXARIFADO],
        valor: formatNumber(saldos.get(TIPO_LOCALIZACAO.ALMOXARIFADO) || 0),
        selo: false,
      },
      { rotulo: 'Estoque mínimo', valor: formatNumber(material.estoque_minimo), selo: false },
      // O TOTAL fica ao lado do disponivel, e nao no lugar dele: quem olha a
      // ficha tambem quer saber o que vem vindo (comprado, ainda nao entregue).
      {
        rotulo: 'Total nas quatro localizações',
        valor: formatNumber(material.estoque?.total),
        selo: false,
      },
      {
        rotulo: 'Último consumo',
        valor: formatDate(material.consumo?.ultimo_consumo),
        selo: false,
      },
    ];
    // O rotulo e a identidade do cartao: o valor muda, o no fica.
    reconciliar(tela.resumo, cartoes, {
      chave: (dado) => dado.rotulo,
      criar: (dado) => pintarCartao(el('div', { className: 'summary-card' }), dado),
      atualizar: (no, dado) => pintarCartao(no, dado),
    });

    tela.descricao.textContent = material.descricao || '';

    const registrosEstoque = material.estoque?.registros || [];
    tela.estoqueTable.update(registrosEstoque);
    tela.livroTable.update(movimentos);
    tela.linhasEstoque = registrosEstoque.length;
    tela.linhasLivro = movimentos.length;

    const consumoDoMaterial = consumoMensal
      .filter(r => Number(r.tipo_material_id) === id)
      .sort((a, b) => Number(a.mes) - Number(b.mes))
      .map(r => ({ mes_nome: monthName(r.mes), quantidade: Number(r.quantidade) }));
    const dadosGrafico = consumoDoMaterial.some(r => r.quantidade > 0) ? consumoDoMaterial : [];

    // A chart.js destroi e refaz a tela do grafico a cada `update`. Gravar o
    // cadastro do insumo nao muda o consumo do ano, e repintar ali so pisca.
    // Por isso o repinte depende da assinatura do que o grafico ja mostra.
    const assinatura = `${ano}|${JSON.stringify(dadosGrafico)}`;
    if (assinatura !== tela.assinaturaGrafico) {
      tela.assinaturaGrafico = assinatura;
      tela.tituloGrafico.textContent = `Consumo mensal em ${ano}`;
      tela.consumoChart.update({ data: dadosGrafico });
    }

    // A descricao e opcional, e e o unico bloco que entra e sai da pagina.
    pintarPapeis(tela.pagina, [
      { chave: 'cabecalho', criar: () => tela.cabecalho },
      material.descricao ? { chave: 'descricao', criar: () => tela.descricao } : null,
      { chave: 'resumo', criar: () => tela.resumo },
      { chave: 'estoque', criar: () => tela.secaoEstoque },
      { chave: 'livro', criar: () => tela.secaoLivro },
      { chave: 'grafico', criar: () => tela.consumoChart },
      { chave: 'historico', criar: () => tela.historico.element },
    ]);
  }

  async function load() {
    // Recarga silenciosa: as tabelas ficam na tela com as linhas que ja tem, e
    // so avisam que estao carregando. Trocar por esqueleto encolhia a tela.
    if (tela) {
      marcarCarregando(tela.estoqueTable, tela.linhasEstoque);
      marcarCarregando(tela.livroTable, tela.linhasLivro);
    }

    const ano = filtroAno.getAno();
    const mes = filtroMes.getValue();
    const { inicio, fim } = intervalo(ano, mes);

    let carregado;
    let movimentos = [];
    let consumoMensal = [];
    try {
      [carregado, movimentos, consumoMensal] = await Promise.all([
        getTipoMaterial(id),
        // O LIVRO vem da rota filtravel, e nao do `registros_recentes` da ficha:
        // aquele traz so os dez ultimos, sem filtro de periodo nenhum.
        getMovimentosMaterial({
          tipo_material_id: id, data_inicio: inicio, data_fim: fim,
        }).catch(() => []),
        getConsumoMensal(ano).catch(() => []),
      ]);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar o insumo');
      // Sem dado nao ha ficha. A tela de erro toma o lugar dela, e a proxima
      // carga bem-sucedida monta a ficha de novo.
      dispose();
      tela = null;
      material = null;
      container.innerHTML = '';
      container.appendChild(el('div', { className: 'page' }, [
        el('div', { className: 'page__header' }, [backButton()]),
        el('p', { textContent: err.message || 'Erro ao carregar o insumo' }),
      ]));
      return;
    }
    if (disposed) return;

    material = carregado;
    saldos = new Map(
      (material.estoque?.registros || []).map(
        r => [Number(r.localizacao_id), Number(r.quantidade)]
      )
    );

    const primeira = !tela;
    if (primeira) {
      tela = montarTela();
      container.innerHTML = '';
      container.appendChild(tela.pagina);
    }

    pintar(movimentos, consumoMensal, ano);

    // Na primeira carga o historico ja busca sozinho.
    if (!primeira) tela.historico.recarregar();
  }

  await load();

  // Trocar o ano ou o mes so chama o `load` de novo: ele repinta a pagina que ja
  // esta no ar, sem remonta-la.

  return () => {
    disposed = true;
    dispose();
  };
}
