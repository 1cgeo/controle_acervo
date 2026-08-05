import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatDateTime, formatNumber, monthName } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createBarChart } from '@components/charts/bar-chart.js';
import { chip, badgeAbaixoMinimo } from '@components/status-chip.js';
import { reconciliar } from '@utils/reconciliar.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import {
  getTipoMaterial, getConsumoMensal, getAnosMapoteca,
} from '@modules/mapoteca/services/mapoteca-service.js';
import { permissoes } from '@store/auth-store.js';
import { openMaterialDialog } from './material-dialog.js';
import { criarHistorico } from '@components/historico/historico.js';

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
    'aria-label': 'Voltar para tipos de material',
    onClick: () => { location.hash = '/mapoteca/materiais'; },
  }, [svgIcon(ICONS.arrowBack, 18), 'Voltar']);
}

/**
 * Tipo de material details page (#/materiais/:id).
 * @param {HTMLElement} container
 * @param {{params:{id:string}, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderMaterialDetails(container, { params }) {
  const id = Number(params.id);
  const pode = permissoes('mapoteca');
  let disposed = false;
  let cleanups = [];

  // A ficha viva, lida no MOMENTO do clique. O botao Editar agora sobrevive a
  // recarga, e um `material` capturado na montagem ficaria velho.
  let material = null;
  // Os nos da pagina, montados uma vez. Nulo antes da primeira carga, e nulo de
  // novo depois de um erro, que troca a ficha pela tela de erro.
  let tela = null;

  // ONDE O ANO ENTRA NESTA FICHA. A ficha e de UM material, e o cadastro, o
  // estoque e o consumo recente nao tem ano. So o grafico de consumo mensal
  // recorta por ano, entao o filtro mora colado nele, e nao no topo da pagina:
  // no topo ele pareceria filtrar a ficha inteira.
  //
  // Ele nasce aqui, e nao no `montarTela`, porque a primeira carga LE o ano
  // antes de a ficha existir. Sem "+ Outro ano": o ano so filtra o consumo que
  // ja aconteceu.
  const filtroAno = criarFiltroAno({
    carregarAnos: getAnosMapoteca,
    permitirOutroAno: false,
    onChange: () => load(),
  });

  function dispose() {
    for (const fn of cleanups) {
      try { fn(); } catch { /* noop */ }
    }
    cleanups = [];
  }

  /**
   * Monta a ficha UMA vez. Dai em diante o `load` so repinta.
   *
   * O DEFEITO QUE ISTO CORRIGE. O `createDataTable`
   * rodava dentro do `load`, e cada gravacao jogava fora o objeto da tabela.
   * Iam junto a busca, a ordenacao, a pagina atual, a selecao e o foco do
   * teclado, porque esse estado mora no OBJETO da tabela, e nao no DOM. O chefe
   * mediu o efeito assim: "quando edita a UI reconstroi, que torna muito chato
   * ficar editando pois a tela fica se movendo".
   */
  function montarTela() {
    const voltar = backButton();
    const titulo = el('h1', { className: 'page__title' });
    const areaTitulo = el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' },
    });

    const editar = el('button', {
      className: 'btn btn--primary',
      type: 'button',
      onClick: () => openMaterialDialog({ material, onSaved: load }),
    }, [svgIcon(ICONS.edit, 16), 'Editar']);

    const cabecalho = el('div', { className: 'page__header' }, [
      areaTitulo,
      // PUT /tipo_material e gerente.
      el('div', { className: 'page__actions' }, pode.gerente ? [editar] : []),
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
        {
          key: 'usuario_atualizacao_nome',
          label: 'Atualizado por',
          render: (row) => row.usuario_atualizacao_nome || row.usuario_criacao_nome || '-',
        },
      ],
      rows: [],
      loading: true,
      pageSize: 10,
      emptyMessage: 'Sem estoque registrado para este material',
    });
    cleanups.push(() => estoqueTable._cleanup());

    // -------------------------------------------------------------------------
    // Consumo recente
    // -------------------------------------------------------------------------
    const consumoTable = createDataTable({
      columns: [
        {
          key: 'data_consumo',
          label: 'Data do consumo',
          sortable: true,
          render: (row) => formatDate(row.data_consumo),
        },
        {
          key: 'quantidade',
          label: 'Quantidade',
          sortable: true,
          render: (row) => formatNumber(row.quantidade),
        },
        {
          key: 'usuario_criacao_nome',
          label: 'Registrado por',
          render: (row) => row.usuario_criacao_nome || '-',
        },
        {
          key: 'data_criacao',
          label: 'Registrado em',
          render: (row) => formatDateTime(row.data_criacao),
        },
      ],
      rows: [],
      loading: true,
      pageSize: 10,
      emptyMessage: 'Sem consumo registrado para este material',
    });
    cleanups.push(() => consumoTable._cleanup());

    const secaoEstoque = el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Estoque por localização' }),
      ]),
      estoqueTable.element,
    ]);

    const secaoConsumo = el('div', { className: 'dashboard-section' }, [
      el('div', { className: 'dashboard-section__header' }, [
        el('h2', { className: 'dashboard-section__title', textContent: 'Consumo recente' }),
      ]),
      consumoTable.element,
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

    // O filtro fica na mesma barra de controle do grafico, no molde da barra de
    // exportacao das outras telas.
    const blocoGrafico = el('div', {}, [
      el('div', { className: 'export-bar' }, [filtroAno.element]),
      consumoChart,
    ]);

    // Histórico de alterações. É o MESMO componente da ficha do pedido, e é por
    // isso que ele existe: a seção que o chefe gostou lá vale em toda ficha.
    //
    // O agregado é `material`, e ele reúne o tipo, o estoque e o consumo: quem
    // pergunta "por que o saldo caiu" quer os três no mesmo lugar, e o consumo
    // que o gatilho do banco descontou aparece aqui com origem "Efeito no banco".
    //
    // Ele busca sozinho ao nascer. Nas cargas seguintes quem o atualiza é o
    // `load`, por `recarregar()`.
    const historico = criarHistorico({
      modulo: 'mapoteca',
      entidade: 'material',
      id,
      subtitulo: 'Alterações no cadastro, no estoque e no consumo deste material',
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
      secaoConsumo,
      estoqueTable,
      consumoTable,
      consumoChart,
      blocoGrafico,
      tituloGrafico: consumoChart.querySelector('.chart-card__title'),
      // Assinatura do que o grafico ja mostra. Ver o comentario no `pintar`.
      assinaturaGrafico: null,
      // Quantas linhas cada tabela mostra agora. Ver `marcarCarregando`.
      linhasEstoque: 0,
      linhasConsumo: 0,
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
  function pintar(consumoMensal, ano) {
    const estoqueTotal = Number(material.estoque?.total || 0);
    const abaixoMinimo = material.estoque_minimo !== null
      && estoqueTotal < Number(material.estoque_minimo);

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
      { rotulo: 'Estoque total', valor: formatNumber(estoqueTotal), selo: abaixoMinimo },
      { rotulo: 'Estoque mínimo', valor: formatNumber(material.estoque_minimo), selo: false },
      { rotulo: 'Meta anual', valor: formatNumber(material.meta_anual), selo: false },
      {
        rotulo: 'Total consumido',
        valor: formatNumber(material.consumo?.total_consumido),
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
    const registrosConsumo = material.consumo?.registros_recentes || [];
    tela.estoqueTable.update(registrosEstoque);
    tela.consumoTable.update(registrosConsumo);
    tela.linhasEstoque = registrosEstoque.length;
    tela.linhasConsumo = registrosConsumo.length;

    const consumoDoMaterial = consumoMensal
      .filter(r => Number(r.tipo_material_id) === id)
      .sort((a, b) => Number(a.mes) - Number(b.mes))
      .map(r => ({ mes_nome: monthName(r.mes), quantidade: Number(r.quantidade) }));
    const dadosGrafico = consumoDoMaterial.some(r => r.quantidade > 0) ? consumoDoMaterial : [];

    // A chart.js destroi e refaz a tela do grafico a cada `update`. Gravar o
    // cadastro do material nao muda o consumo do ano, e repintar ali so pisca.
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
      { chave: 'consumo', criar: () => tela.secaoConsumo },
      { chave: 'grafico', criar: () => tela.blocoGrafico },
      { chave: 'historico', criar: () => tela.historico.element },
    ]);
  }

  async function load() {
    // Recarga silenciosa: as tabelas ficam na tela com as linhas que ja tem, e
    // so avisam que estao carregando. Trocar por esqueleto encolhia a tela.
    if (tela) {
      marcarCarregando(tela.estoqueTable, tela.linhasEstoque);
      marcarCarregando(tela.consumoTable, tela.linhasConsumo);
    }

    // So o grafico de consumo mensal usa o ano. O resto da ficha nao tem ano.
    const ano = filtroAno.getAno();
    let carregado;
    let consumoMensal = [];
    try {
      [carregado, consumoMensal] = await Promise.all([
        getTipoMaterial(id),
        getConsumoMensal(ano).catch(() => []),
      ]);
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao carregar o tipo de material');
      // Sem dado nao ha ficha. A tela de erro toma o lugar dela, e a proxima
      // carga bem-sucedida monta a ficha de novo.
      dispose();
      tela = null;
      material = null;
      container.innerHTML = '';
      container.appendChild(el('div', { className: 'page' }, [
        el('div', { className: 'page__header' }, [backButton()]),
        el('p', { textContent: err.message || 'Erro ao carregar o tipo de material' }),
      ]));
      return;
    }
    if (disposed) return;

    material = carregado;

    const primeira = !tela;
    if (primeira) {
      tela = montarTela();
      container.innerHTML = '';
      container.appendChild(tela.pagina);
    }

    pintar(consumoMensal, ano);

    // Na primeira carga o historico ja busca sozinho.
    if (!primeira) tela.historico.recarregar();
  }

  await load();

  // Trocar o ano so chama o `load` de novo: ele repinta a pagina que ja esta no
  // ar, sem remonta-la.

  return () => {
    disposed = true;
    dispose();
  };
}
