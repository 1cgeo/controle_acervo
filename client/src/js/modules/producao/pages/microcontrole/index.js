import { el, clearChildren } from '@utils/dom.js';
import { estadoErro } from '@components/estado-erro.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createDateField, createSelectField } from '@components/form-fields/form-fields.js';
import {
  getResumoFeicao,
  getCoberturaTela,
  getAproveitamentoTela,
} from '@services/microcontrole-service.js';
import { getLotesComProducao } from '@services/producao-service.js';
import './microcontrole.css';

/**
 * O dia de hoje e o de N dias atrás, em 'AAAA-MM-DD'.
 *
 * `toISOString()` seria UTC, e em UTC-3 ele dá o dia ANTERIOR durante as três
 * primeiras horas do dia: quem abrisse a tela às 00h30 pediria um período que
 * termina ontem. Aqui a data é uma casa da régua, não um instante, e por isso
 * ela é montada dos componentes LOCAIS.
 */
function diaLocal(deslocamentoDias = 0) {
  const d = new Date();
  d.setDate(d.getDate() + deslocamentoDias);
  const mes = String(d.getMonth() + 1).padStart(2, '0');
  const dia = String(d.getDate()).padStart(2, '0');
  return `${d.getFullYear()}-${mes}-${dia}`;
}

/** Número com separador de milhar, e '0' onde vier nulo. */
const numero = (v) => Number(v || 0).toLocaleString('pt-BR');

/** Minutos com uma casa, para tempo de tela. */
const minutos = (v) => `${Number(v || 0).toLocaleString('pt-BR', {
  minimumFractionDigits: 1, maximumFractionDigits: 1,
})} min`;

/**
 * Quantas amostras de tela cada operador tem, contadas do GeoJSON.
 *
 * A CONTA É AQUI, e não numa rota: a cobertura já vem com uma feição por
 * amostra, e pedir ao servidor um segundo agregado do mesmo recorte seria uma
 * consulta a mais para chegar num número que a resposta já contém.
 *
 * @param {{features?:Array<{properties?:Object}>}} colecao
 * @returns {Array<{usuario_uuid:string, usuario:string, amostras:number}>}
 */
export function amostrasPorOperador(colecao) {
  const porUuid = new Map();

  for (const feicao of (colecao && colecao.features) || []) {
    const props = (feicao && feicao.properties) || {};
    const uuid = props.usuario_uuid || 'sem-uuid';
    const atual = porUuid.get(uuid);
    if (atual) {
      atual.amostras += 1;
    } else {
      porUuid.set(uuid, {
        usuario_uuid: props.usuario_uuid || null,
        usuario: props.usuario || 'Operador não identificado',
        amostras: 1,
      });
    }
  }

  return [...porUuid.values()].sort((a, b) => b.amostras - a.amostras);
}

/**
 * MICROCONTROLE (#/producao/microcontrole): a medição do trabalho no QGIS.
 *
 * O QUE ESTA TELA MOSTRA, e são duas perguntas diferentes:
 *
 *   FEIÇÃO  o que foi desenhado, apagado e alterado, por operador, por camada e
 *           por dia (`/microcontrole/feicao/resumo`);
 *   TELA    por onde o trabalho passou, em amostras de tempo de tela: quantas
 *           amostras cada operador tem (`/microcontrole/tela/cobertura`) e o
 *           aproveitamento diário de um deles (`/microcontrole/tela/aproveitamento`).
 *
 * A TELEMETRIA VIVE NUM BANCO SEPARADO, e ele é OPCIONAL. Uma instalação pode
 * nunca tê-lo configurado, e outra pode tê-lo fora do ar num dia: nos dois casos
 * o servidor responde 503 com uma frase que diz QUAL dos dois é. Esta tela
 * mostra essa frase dentro da seção que a recebeu, e nunca como falha da página.
 *
 * CADA SEÇÃO CARREGA SOZINHA, COM O PRÓPRIO `catch`, e isso não é estilo: num
 * `Promise.all` a falha de uma derruba a TELA INTEIRA e a mensagem que sobra é a
 * dela. O PISO É O MESMO NAS TRÊS, `consulta` no módulo `producao`; o que difere
 * é o BANCO. A lista de lotes vem do banco principal
 * (`GET /api/acompanhamento/lotes`) e responde sempre; as outras duas vêm da
 * telemetria, que pode responder 503 por conta própria. Então um 503 da
 * telemetria não pode esvaziar o filtro, e uma falha na lista de lotes não pode
 * apagar o resumo de feição que carregou bem.
 *
 * O SELETOR DE OPERADOR SE PREENCHE DO RESUMO DE FEIÇÃO, e não de uma rota de
 * pessoas: quem aparece ali é quem TEM medição no período filtrado, que é a
 * única lista para a qual o aproveitamento tem resposta. Uma lista de todos os
 * militares ofereceria dezenas de nomes que devolveriam série vazia.
 *
 * O PERÍODO PADRÃO É DE 30 DIAS, o mesmo que o servidor assume quando as datas
 * não vêm. Ele é escrito aqui em vez de deixado em branco para que a tela diga
 * qual recorte está mostrando, em vez de mostrar um número sem janela.
 *
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderMicrocontrole(container) {
  let disposed = false;

  // --- O filtro --------------------------------------------------------------

  const campoLote = createSelectField({
    label: 'Lote',
    options: [],
    placeholder: 'Todos os lotes',
    helpText: 'Filtra pelas atividades daquele lote. Sem lote, a medição é de toda a produção.',
  });

  const campoInicio = createDateField({ label: 'De', value: diaLocal(-30) });
  const campoFim = createDateField({ label: 'Até', value: diaLocal(0) });

  const botaoAplicar = el('button', {
    className: 'btn btn--primary',
    type: 'submit',
    textContent: 'Aplicar',
  });

  const filtro = el('form', { className: 'microcontrole__filtro' }, [
    campoLote.element,
    campoInicio.element,
    campoFim.element,
    el('div', { className: 'microcontrole__filtro-acao' }, [botaoAplicar]),
  ]);

  const filtroAtual = () => ({
    loteId: campoLote.getValue(),
    dataInicio: campoInicio.getValue(),
    dataFim: campoFim.getValue(),
  });

  /**
   * O FILTRO PEDIDO, EM TEXTO, para conferir depois do `await`.
   *
   * As duas consultas do microcontrole varrem períodos inteiros e não respondem
   * no mesmo tempo. Clicando "Aplicar" duas vezes com períodos diferentes, a
   * resposta do primeiro pode chegar depois: sem esta conferência ela pintaria
   * as tabelas DELA sob um filtro que já diz outro período, e o resumo ("N
   * operação(ões) ... no período filtrado") afirmaria o número de um mês sobre
   * as datas de outro. A resposta que não é mais a pedida é descartada.
   */
  const assinaturaDoFiltro = () => JSON.stringify(filtroAtual());

  // --- Feição ----------------------------------------------------------------

  const resumoFeicao = el('p', { className: 'microcontrole__nota' });
  const areaOperador = el('div');
  const areaCamada = el('div');
  const areaDia = el('div');

  const COLUNAS_OPERACAO = [
    { key: 'insercoes', label: 'Inseridas', sortable: true, render: (l) => numero(l.insercoes) },
    { key: 'delecoes', label: 'Apagadas', sortable: true, render: (l) => numero(l.delecoes) },
    {
      key: 'atualizacoes_atributo',
      label: 'Atributo alterado',
      sortable: true,
      render: (l) => numero(l.atualizacoes_atributo),
    },
    {
      key: 'atualizacoes_geometria',
      label: 'Geometria alterada',
      sortable: true,
      render: (l) => numero(l.atualizacoes_geometria),
    },
  ];

  const tabelaOperador = createDataTable({
    columns: [
      { key: 'usuario', label: 'Operador', sortable: true },
      ...COLUNAS_OPERACAO,
      { key: 'vertices', label: 'Vértices', sortable: true, render: (l) => numero(l.vertices) },
    ],
    rows: [],
    pageSize: 25,
    loading: true,
    rowKey: (l) => `op:${l.usuario_uuid}`,
    emptyMessage: 'Nenhuma feição medida no período.',
  });

  const tabelaCamada = createDataTable({
    columns: [
      { key: 'camada', label: 'Camada', sortable: true },
      ...COLUNAS_OPERACAO,
      { key: 'vertices', label: 'Vértices', sortable: true, render: (l) => numero(l.vertices) },
    ],
    rows: [],
    searchable: true,
    pageSize: 10,
    loading: true,
    rowKey: (l) => `cam:${l.camada}`,
    emptyMessage: 'Nenhuma feição medida no período.',
  });

  const tabelaDia = createDataTable({
    columns: [
      { key: 'dia', label: 'Dia', sortable: true },
      ...COLUNAS_OPERACAO,
    ],
    rows: [],
    pageSize: 10,
    loading: true,
    rowKey: (l) => `dia:${l.dia}`,
    emptyMessage: 'Nenhuma feição medida no período.',
  });

  // --- Tela ------------------------------------------------------------------

  const resumoTela = el('p', { className: 'microcontrole__nota' });
  const avisoTruncado = el('p', { className: 'microcontrole__aviso', role: 'note' });
  const areaCobertura = el('div');

  const tabelaCobertura = createDataTable({
    columns: [
      { key: 'usuario', label: 'Operador', sortable: true },
      { key: 'amostras', label: 'Amostras de tela', sortable: true, render: (l) => numero(l.amostras) },
    ],
    rows: [],
    pageSize: 10,
    loading: true,
    rowKey: (l) => `cob:${l.usuario_uuid}`,
    emptyMessage: 'Nenhuma amostra de tela no período.',
  });

  const areaAproveitamento = el('div');

  const tabelaAproveitamento = createDataTable({
    columns: [
      { key: 'dia', label: 'Dia', sortable: true },
      { key: 'tempo_total_min', label: 'Tempo total', sortable: true, render: (l) => minutos(l.tempo_total_min) },
      { key: 'tempo_ativo_min', label: 'Tempo ativo', sortable: true, render: (l) => minutos(l.tempo_ativo_min) },
      {
        key: 'aproveitamento_pct',
        label: 'Aproveitamento',
        sortable: true,
        render: (l) => `${Number(l.aproveitamento_pct || 0).toLocaleString('pt-BR', {
          minimumFractionDigits: 1, maximumFractionDigits: 1,
        })}%`,
      },
    ],
    rows: [],
    pageSize: 10,
    rowKey: (l) => `apr:${l.dia}`,
    emptyMessage: 'Escolha um operador para ver o aproveitamento dele.',
  });

  const campoOperador = createSelectField({
    label: 'Operador',
    options: [],
    placeholder: 'Escolha um operador',
    helpText: 'A lista traz quem teve medição no período filtrado.',
    onChange: () => carregarAproveitamento(),
  });

  // --- A página --------------------------------------------------------------

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Microcontrole' }),
    ]),

    el('p', { className: 'page__subtitle' }, [
      'A medição que o plugin do QGIS captura enquanto a pessoa trabalha: o que ',
      'ela desenhou (feição) e por onde ela andou na tela. Só entra aqui a ',
      'subfase do lote que o perfil de monitoramento mandar medir: sem esse ',
      'cadastro, o plugin não captura nada.',
    ]),

    filtro,

    el('section', { className: 'microcontrole__secao' }, [
      el('h2', { className: 'microcontrole__titulo', textContent: 'Feição' }),
      resumoFeicao,
      el('h3', { className: 'microcontrole__subtitulo', textContent: 'Por operador' }),
      areaOperador,
      el('h3', { className: 'microcontrole__subtitulo', textContent: 'Por camada' }),
      areaCamada,
      el('h3', { className: 'microcontrole__subtitulo', textContent: 'Por dia' }),
      areaDia,
    ]),

    el('section', { className: 'microcontrole__secao' }, [
      el('h2', { className: 'microcontrole__titulo', textContent: 'Tela' }),
      resumoTela,
      avisoTruncado,
      areaCobertura,
      el('h3', { className: 'microcontrole__subtitulo', textContent: 'Aproveitamento diário' }),
      el('p', { className: 'microcontrole__nota' }, [
        'O tempo ativo é o total do dia menos os intervalos maiores que três ',
        'minutos entre duas amostras. NÃO É PONTO: um dia inteiro em reunião ',
        'aparece como tempo total pequeno, e não como aproveitamento ruim.',
      ]),
      campoOperador.element,
      areaAproveitamento,
    ]),
  ]);

  areaOperador.appendChild(tabelaOperador.element);
  areaCamada.appendChild(tabelaCamada.element);
  areaDia.appendChild(tabelaDia.element);
  areaCobertura.appendChild(tabelaCobertura.element);
  areaAproveitamento.appendChild(tabelaAproveitamento.element);
  container.appendChild(page);

  // --- Os lotes, que carregam SOZINHOS ---------------------------------------
  //
  // ELES NÃO BLOQUEIAM NADA. Sem a lista, o filtro fica só com o período e a
  // medição continua saindo para toda a produção: uma falha aqui não pode
  // esvaziar as duas seções, que vêm de outro banco.
  //
  // A LISTA VEM DE `GET /api/acompanhamento/lotes` (`getLotesComProducao`), que é
  // o seletor: ela devolve `{ id, nome, projeto }` de todo lote COM produção
  // recortada, no piso `consulta` de `producao`. Ela NÃO é
  // `/acompanhamento/dashboard/execucao`: aquela é um AGREGADO, devolve
  // `lote_id` e `lote` (e não `id` e `nome`), e só traz o lote com versão em
  // execução hoje. Ler `l.id` de lá dava `undefined` em toda opção, e o filtro
  // saía sem `lote_id` sem erro nenhum: a tela recarregava mostrando a produção
  // inteira como se fosse a do lote escolhido.

  async function carregarLotes() {
    try {
      const lotes = await getLotesComProducao();
      if (disposed) return;
      campoLote.setOptions(
        (lotes || []).map((l) => ({
          value: l.id,
          label: l.projeto ? `${l.nome} (${l.projeto})` : (l.nome || `Lote ${l.id}`),
        })),
      );
    } catch {
      if (disposed) return;
      campoLote.setOptions([]);
      campoLote.setError('Não foi possível carregar os lotes. O filtro fica em "todos".');
    }
  }

  // --- Feição ----------------------------------------------------------------

  async function carregarFeicao() {
    clearChildren(areaOperador);
    areaOperador.appendChild(tabelaOperador.element);
    tabelaOperador.update({ loading: true });
    tabelaCamada.update({ loading: true });
    tabelaDia.update({ loading: true });
    resumoFeicao.textContent = '';

    const pedido = assinaturaDoFiltro();
    try {
      const dados = await getResumoFeicao(filtroAtual());
      if (disposed || pedido !== assinaturaDoFiltro()) return;

      const porOperador = (dados && dados.por_operador) || [];
      const porCamada = (dados && dados.por_camada) || [];
      const serieDiaria = (dados && dados.serie_diaria) || [];

      tabelaOperador.update({ rows: porOperador, loading: false });
      tabelaCamada.update({ rows: porCamada, loading: false });
      tabelaDia.update({ rows: serieDiaria, loading: false });

      const total = porCamada.reduce(
        (soma, c) => soma + Number(c.insercoes || 0) + Number(c.delecoes || 0)
          + Number(c.atualizacoes_atributo || 0) + Number(c.atualizacoes_geometria || 0),
        0,
      );
      resumoFeicao.textContent = `${numero(total)} operação(ões) de feição, `
        + `${porOperador.length} operador(es), ${porCamada.length} camada(s), `
        + `em ${serieDiaria.length} dia(s) com medição.`;

      // O SELETOR DE OPERADOR VEM DAQUI, e por isso ele é reconstruído a cada
      // carga: quem tinha medição no mês passado pode não ter nesta semana, e
      // um nome que sobrasse na lista devolveria série vazia sem dizer por quê.
      campoOperador.setOptions(
        porOperador.map((o) => ({ value: o.usuario_uuid, label: o.usuario })),
      );
      carregarAproveitamento();
    } catch (err) {
      if (disposed || pedido !== assinaturaDoFiltro()) return;
      // O ERRO FICA NA SEÇÃO DELE, e as três tabelas somem juntas: elas são
      // recortes da MESMA resposta. Mostrar tabela vazia ao lado do aviso faria
      // "não consegui perguntar" se ler como "ninguém desenhou nada".
      resumoFeicao.textContent = '';
      campoOperador.setOptions([]);
      clearChildren(areaOperador);
      areaOperador.appendChild(estadoErro(err, carregarFeicao));
      tabelaCamada.update({ rows: [], loading: false });
      tabelaDia.update({ rows: [], loading: false });
    }
  }

  // --- Tela: a cobertura -----------------------------------------------------

  async function carregarCobertura() {
    clearChildren(areaCobertura);
    areaCobertura.appendChild(tabelaCobertura.element);
    tabelaCobertura.update({ loading: true });
    resumoTela.textContent = '';
    avisoTruncado.textContent = '';

    const pedido = assinaturaDoFiltro();
    try {
      const colecao = await getCoberturaTela(filtroAtual());
      if (disposed || pedido !== assinaturaDoFiltro()) return;

      const linhas = amostrasPorOperador(colecao);
      const total = ((colecao && colecao.features) || []).length;

      tabelaCobertura.update({ rows: linhas, loading: false });
      resumoTela.textContent = `${numero(total)} amostra(s) de tela, de `
        + `${linhas.length} operador(es), no período filtrado.`;

      // O AVISO DE TRUNCAMENTO VAI PARA A TELA. Uma lista cortada em silêncio se
      // lê como "só trabalharam até aqui", que é uma afirmação que o servidor
      // não fez.
      avisoTruncado.textContent = (colecao && colecao.aviso) || '';
    } catch (err) {
      if (disposed || pedido !== assinaturaDoFiltro()) return;
      resumoTela.textContent = '';
      clearChildren(areaCobertura);
      areaCobertura.appendChild(estadoErro(err, carregarCobertura));
    }
  }

  // --- Tela: o aproveitamento ------------------------------------------------

  async function carregarAproveitamento() {
    const usuarioUuid = campoOperador.getValue();

    clearChildren(areaAproveitamento);
    areaAproveitamento.appendChild(tabelaAproveitamento.element);

    // SEM OPERADOR NÃO HÁ CHAMADA, e a rota exige o UUID: pedir sem ele levaria
    // 400 do Joi, que numa tela se lê como defeito. A mensagem vazia da tabela
    // já diz o que fazer.
    if (!usuarioUuid) {
      tabelaAproveitamento.update({ rows: [], loading: false });
      return;
    }

    tabelaAproveitamento.update({ loading: true });

    // O PEDIDO AQUI É O OPERADOR MAIS O PERÍODO: trocar o operador no seletor
    // dispara outra carga, e a do anterior chegando depois encheria a tabela com
    // o trabalho de outra pessoa sob o nome escolhido.
    const pedido = `${usuarioUuid}\u0000${assinaturaDoFiltro()}`;
    const mesmoPedido = () => pedido === `${campoOperador.getValue()}\u0000${assinaturaDoFiltro()}`;
    try {
      const { dataInicio, dataFim } = filtroAtual();
      const linhas = await getAproveitamentoTela({ usuarioUuid, dataInicio, dataFim });
      if (disposed || !mesmoPedido()) return;
      tabelaAproveitamento.update({ rows: linhas || [], loading: false });
    } catch (err) {
      if (disposed || !mesmoPedido()) return;
      clearChildren(areaAproveitamento);
      areaAproveitamento.appendChild(estadoErro(err, carregarAproveitamento));
    }
  }

  // --- O filtro dispara as duas seções ---------------------------------------

  /**
   * O PERÍODO INVERTIDO É RECUSADO AQUI, e o motivo é o silêncio do outro lado.
   *
   * O Joi do servidor valida cada data sozinha e não compara as duas: "de 08/09
   * até 08/08" é uma consulta VÁLIDA que não casa linha nenhuma. A tela
   * responderia "0 operação(ões) de feição, 0 operador(es), 0 camada(s)" e
   * "Nenhuma amostra de tela no período", que são as frases de quem não
   * trabalhou -- e o que houve foi um filtro digitado ao contrário. As duas
   * datas se comparam como TEXTO porque 'AAAA-MM-DD' já ordena assim, e virá-las
   * em `Date` traria de volta o fuso que o `diaLocal` acima existe para evitar.
   *
   * @returns {boolean}
   */
  function periodoValido() {
    const inicio = campoInicio.getValue();
    const fim = campoFim.getValue();
    const invertido = Boolean(inicio && fim && inicio > fim);
    campoFim.setError(invertido
      ? 'A data final é anterior à inicial: a medição sairia vazia.'
      : null);
    return !invertido;
  }

  function aplicar(evento) {
    if (evento) evento.preventDefault();
    // O que já está na tela FICA. Ele é o resultado do último período válido, e
    // apagá-lo junto com o aviso deixaria a pessoa sem o número que ela tinha.
    if (!periodoValido()) return;
    carregarFeicao();
    carregarCobertura();
  }

  filtro.addEventListener('submit', aplicar);

  // O ERRO DO PERÍODO SOME AO CORRIGIR A DATA, e não só no próximo "Aplicar".
  // `periodoValido()` só roda no `submit`, então "A data final é anterior à
  // inicial" ficava sob um par de datas que já estava certo, até a pessoa
  // clicar de novo -- e quem lê o erro ANTES de clicar conclui que corrigir não
  // adiantou. Limpar é seguro porque `campoFim` não carrega outro erro: o do
  // lote mora em `campoLote`.
  const limparErroDePeriodo = () => campoFim.setError(null);
  campoInicio.input.addEventListener('input', limparErroDePeriodo);
  campoFim.input.addEventListener('input', limparErroDePeriodo);

  carregarLotes();
  aplicar();

  return () => {
    disposed = true;
    filtro.removeEventListener('submit', aplicar);
    campoInicio.input.removeEventListener('input', limparErroDePeriodo);
    campoFim.input.removeEventListener('input', limparErroDePeriodo);
    if (tabelaOperador._cleanup) tabelaOperador._cleanup();
    if (tabelaCamada._cleanup) tabelaCamada._cleanup();
    if (tabelaDia._cleanup) tabelaDia._cleanup();
    if (tabelaCobertura._cleanup) tabelaCobertura._cleanup();
    if (tabelaAproveitamento._cleanup) tabelaAproveitamento._cleanup();
  };
}
