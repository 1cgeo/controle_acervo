import { el, clearChildren } from '@utils/dom.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import { estadoErro } from '@components/estado-erro.js';
import {
  getInfoLote,
  getInfoSubfaseLote,
  getLotesComProducao,
  getLotesEmExecucao,
  getSubfasesComProducao,
} from '@services/producao-service.js';
import './lote.css';

const inteiro = (v) => Number(v || 0);

/** Percentual com uma casa, no formato do país. '·' quando não há denominador. */
const percentual = (parte, total) => (total > 0
  ? `${((100 * parte) / total).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
  : '·');

/**
 * A barra de progresso de uma linha.
 *
 * DUAS FAIXAS, e não três: finalizado e o resto. A terceira faixa ("em
 * execução") pareceria progresso, e atividade começada não é atividade
 * entregue -- o que a barra responde é "quanto já saiu", e o começado ainda não
 * saiu. Os três números continuam escritos nas colunas ao lado.
 *
 * SEM COR DE ESTADO. A paleta de estado desta casa é a de `#/execucao_pit`
 * (verde alcançou o plano, âmbar ficou no meio, vermelho não teve nada), e ela
 * compara o ACUMULADO com o que foi PROMETIDO até ali. Aqui não existe promessa
 * nenhuma: 40% pode ser adiantado ou atrasado, e nada nesta resposta diz qual.
 * Pintar por faixa de percentual seria uma segunda convenção com a mesma
 * paleta, dizendo outra coisa.
 */
function barraDeProgresso(finalizadas, total) {
  const pct = total > 0 ? (100 * finalizadas) / total : 0;
  return el('div', {
    className: 'lote-acomp__barra',
    title: `${finalizadas} de ${total} (${percentual(finalizadas, total)})`,
  }, [
    el('span', {
      className: 'lote-acomp__barra-preenchida',
      style: { width: `${Math.min(100, Math.max(0, pct))}%` },
    }),
  ]);
}

/** Uma tabela simples, com o cabeçalho e as linhas já montadas. */
function tabela(colunas, linhas) {
  return el('table', { className: 'lote-acomp__tabela' }, [
    el('thead', {}, [
      el('tr', {}, colunas.map(c => el('th', {
        className: c.className || null,
        textContent: c.label,
        title: c.title || null,
      }))),
    ]),
    el('tbody', {}, linhas),
  ]);
}

/**
 * ACOMPANHAMENTO DO LOTE (#/producao/lote): como anda um lote, fase a fase, e
 * depois etapa a etapa dentro de uma subfase.
 *
 * DUAS PERGUNTAS, UMA TELA, e a segunda mora dentro da primeira. `/informacoes
 * /:lote` responde "por onde o lote está", em FASES; `/informacoes/:lote
 * /:subfase` responde "dentro desta subfase, em que etapa", em ETAPAS. A
 * segunda só faz sentido depois da primeira, então ela é uma seção abaixo, e
 * não outra tela.
 *
 * AS DUAS CONTAM COISAS DIFERENTES, e a tela diz qual. A de FASES conta VERSÕES
 * (quantas versões passaram por cada fase do lote); a de ETAPAS conta
 * ATIVIDADES. Os nomes das colunas do servidor são `atividades_*` nas duas, e
 * ler os dois quadros como a mesma unidade faria a soma de um não bater com a
 * do outro sem que nada acusasse. Ver os comentários de `getInfoLote` e
 * `getInfoSubfaseLote` em `acompanhamento_producao_ctrl.js`.
 *
 * TRÊS CHAMADAS, TRÊS GUARDAS, TRÊS `catch`. As três estão no MESMO piso desta
 * tela, `consulta` em `producao`:
 *
 *   `/acompanhamento/informacoes/:lote`     consulta em `producao`  -- é a tela
 *   `/acompanhamento/lotes`                 consulta em `producao`  -- só a lista
 *   `/acompanhamento/lotes/:lote/subfases`  consulta em `producao`  -- só o seletor
 *
 * Num `Promise.all` a falha de qualquer uma derrubaria as três, e a mensagem que
 * sobraria seria a dela: a queda do seletor de subfase apagaria o quadro de
 * fases, que é a resposta principal da tela, e a pessoa leria o erro do seletor
 * no lugar dele. Então cada uma carrega SOZINHA e a falha fica na seção dela.
 *
 * O LOTE E A SUBFASE VIVEM NA URL, e não em variáveis desta função. Achar o
 * lote, descer até a subfase, sair para conferir outra coisa e voltar devolvia
 * a tela pedindo "escolha um lote"; e sem nada na barra de endereço não havia
 * como mandar a alguém o acompanhamento de um lote, só a instrução de como
 * chegar nele. A escrita é por `history.replaceState`, e não pelo hash, que
 * faria o roteador remontar a tela. A tela pelada continua sendo
 * '#/producao/lote'.
 *
 * @param {HTMLElement} container
 * @param {{params?:Object, query?:URLSearchParams}} [ctx]
 * @returns {Function} cleanup
 */
export async function renderLoteAcompanhamento(container, ctx = {}) {
  let disposed = false;

  const consulta = (ctx && ctx.query) || new URLSearchParams();
  /** O parâmetro como id, ou nulo: `?lote=abc` não é um lote. */
  const idDaUrl = (nome) => {
    const valor = Number(consulta.get(nome));
    return Number.isInteger(valor) && valor > 0 ? valor : null;
  };

  let loteSelecionado = idDaUrl('lote');
  let subfaseSelecionada = loteSelecionado === null ? null : idDaUrl('subfase');

  function sincronizarUrl() {
    const params = new URLSearchParams();
    if (loteSelecionado !== null) params.set('lote', String(loteSelecionado));
    // A SUBFASE SÓ EXISTE DENTRO DE UM LOTE: sem o lote na URL, ela abriria uma
    // seção de etapas sobre um lote que ninguém escolheu.
    if (loteSelecionado !== null && subfaseSelecionada !== null) {
      params.set('subfase', String(subfaseSelecionada));
    }
    const texto = params.toString();
    history.replaceState(null, '', `#/producao/lote${texto ? `?${texto}` : ''}`);
  }

  const loteFilter = createSelectField({
    label: 'Lote',
    options: [],
    placeholder: 'Escolha um lote',
    value: null,
    onChange: (v) => {
      loteSelecionado = v === null || v === '' ? null : Number(v);
      subfaseSelecionada = null;
      subfaseFilter.setOptions([]);
      subfaseFilter.setValue(null);
      sincronizarUrl();
      carregarFases();
      carregarSubfases();
      desenharEtapas(null);
    },
  });

  const subfaseFilter = createSelectField({
    label: 'Subfase',
    options: [],
    placeholder: 'Escolha uma subfase',
    value: null,
    onChange: (v) => {
      subfaseSelecionada = v === null || v === '' ? null : Number(v);
      sincronizarUrl();
      carregarEtapas();
    },
  });

  const avisoLotes = el('p', { className: 'lote-acomp__nota hidden', role: 'status' });
  const areaFases = el('div', { className: 'lote-acomp__area' });
  const avisoSubfases = el('p', { className: 'lote-acomp__nota hidden', role: 'status' });
  const areaEtapas = el('div', { className: 'lote-acomp__area' });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Acompanhamento do lote' }),
    ]),
    el('div', { className: 'page__filters' }, [loteFilter.element]),
    avisoLotes,
    el('section', { className: 'lote-acomp__secao' }, [
      el('h2', { className: 'lote-acomp__titulo', textContent: 'Fases do lote' }),
      el('p', {
        className: 'lote-acomp__legenda',
        textContent: 'A contagem é por VERSÃO: quantas versões do lote passaram por cada fase.',
      }),
      areaFases,
    ]),
    el('section', { className: 'lote-acomp__secao' }, [
      el('h2', { className: 'lote-acomp__titulo', textContent: 'Etapas de uma subfase' }),
      el('p', {
        className: 'lote-acomp__legenda',
        textContent: 'A contagem é por ATIVIDADE, dentro da subfase escolhida.',
      }),
      el('div', { className: 'page__filters' }, [subfaseFilter.element]),
      avisoSubfases,
      areaEtapas,
    ]),
  ]);
  container.appendChild(page);

  const nota = (elemento, texto) => {
    elemento.textContent = texto || '';
    elemento.classList.toggle('hidden', !texto);
  };

  const pedirLote = (area, o_que) => {
    clearChildren(area);
    area.appendChild(el('p', {
      className: 'lote-acomp__vazio',
      textContent: `Escolha ${o_que} para ver o acompanhamento.`,
    }));
  };

  // --- A lista de lotes -----------------------------------------------------

  /**
   * A lista de lotes, com uma queda.
   *
   * A PRIMEIRA É `GET /acompanhamento/lotes`, o SELETOR, que é `consulta` em
   * `producao` -- o mesmo piso desta tela. Quem chega aqui passa por ela, então
   * uma falha dela NÃO é falta de perfil: é o servidor ou a rede. A queda é
   * `/acompanhamento/dashboard/execucao`, do mesmo piso, que devolve `lote_id` e
   * `lote` -- só que apenas dos lotes COM VERSÃO EM EXECUÇÃO. É uma lista menor,
   * e a tela DIZ que é menor: uma lista curta calada se leria como "o resto dos
   * lotes não existe".
   *
   * A MENSAGEM DO SERVIDOR VAI JUNTO, e não some no `catch`. Ela dizia que o
   * cadastro de lotes é do módulo acervo e que a pessoa não tem perfil nele --
   * herança de quando a primeira chamada era `/projetos/lote`. Como diagnóstico
   * de hoje aquilo é falso, e manda procurar um perfil que não é o que faltou.
   */
  /**
   * O lote que veio da URL, depois de a lista chegar.
   *
   * ELE SÓ VALE SE EXISTIR NA LISTA. Um `?lote=` de um recorte que acabou (ou de
   * um lote que a queda de `/dashboard/execucao` não traz) deixaria as duas
   * seções pedindo "escolha um lote" enquanto o seletor mostrasse um nome, ou
   * pior, mandaria uma consulta por um id que a pessoa não escolheu. Sobrando,
   * o seletor nasce marcado e as duas cargas saem sozinhas -- é o que faz o
   * link colado na barra de endereço abrir a tela pronta.
   */
  function escolherDaUrl(idsDisponiveis) {
    if (loteSelecionado === null) return;
    if (!idsDisponiveis.some(id => Number(id) === loteSelecionado)) {
      loteSelecionado = null;
      subfaseSelecionada = null;
      sincronizarUrl();
      return;
    }
    loteFilter.setValue(loteSelecionado);
    carregarFases();
    carregarSubfases();
  }

  async function carregarLotes() {
    let falhaDaLista = null;
    try {
      const lotes = await getLotesComProducao();
      if (disposed) return;
      loteFilter.setOptions((lotes || []).map(l => ({
        value: l.id,
        label: l.projeto ? `${l.nome} — ${l.projeto}` : l.nome,
      })));
      escolherDaUrl((lotes || []).map(l => l.id));
      nota(avisoLotes, '');
      return;
    } catch (err) {
      if (disposed) return;
      falhaDaLista = err;
    }

    try {
      const emExecucao = await getLotesEmExecucao();
      if (disposed) return;
      loteFilter.setOptions((emExecucao || []).map(l => ({
        value: l.lote_id,
        label: `${l.lote} (${l.em_execucao} em execução)`,
      })));
      escolherDaUrl((emExecucao || []).map(l => l.lote_id));
      nota(avisoLotes, 'A lista traz só os lotes com versão em execução, porque a lista '
        + `completa de lotes não respondeu${falhaDaLista && falhaDaLista.message
          ? `: ${falhaDaLista.message}` : '.'}`);
    } catch (err) {
      if (disposed) return;
      // SEM LISTA NENHUMA, o lote da URL não se confirma, e uma tela que
      // carregasse por ele estaria consultando um id que ninguém escolheu e que
      // o seletor não mostra.
      escolherDaUrl([]);
      nota(avisoLotes, err.message || 'Não foi possível carregar a lista de lotes.');
    }
  }

  // --- As fases do lote -----------------------------------------------------

  function desenharFases(fases) {
    clearChildren(areaFases);
    if (!fases.length) {
      areaFases.appendChild(el('p', {
        className: 'lote-acomp__vazio',
        textContent: 'Este lote ainda não tem versão em fase nenhuma.',
      }));
      return;
    }

    const linhas = fases.map((f) => {
      const finalizadas = inteiro(f.atividades_finalizadas);
      const emExecucao = inteiro(f.atividades_em_execucao);
      const restantes = inteiro(f.atividades_restantes);
      const total = finalizadas + emExecucao + restantes;
      return el('tr', {}, [
        el('td', { className: 'lote-acomp__rotulo' }, [
          el('span', { className: 'lote-acomp__ordem', textContent: String(f.fase_ordem ?? '') }),
          f.nome || '-',
        ]),
        el('td', { className: 'lote-acomp__progresso' }, [barraDeProgresso(finalizadas, total)]),
        el('td', { className: 'text-center', textContent: String(finalizadas) }),
        el('td', { className: 'text-center', textContent: String(emExecucao) }),
        el('td', { className: 'text-center', textContent: String(restantes) }),
        el('td', { className: 'text-center', textContent: percentual(finalizadas, total) }),
        el('td', { className: 'text-center', textContent: String(inteiro(f.atividades_finalizadas_semana)) }),
        el('td', { className: 'text-center', textContent: String(inteiro(f.atividades_finalizadas_semana_anterior)) }),
        el('td', { className: 'text-center', textContent: String(inteiro(f.atividades_finalizadas_mes)) }),
        el('td', { className: 'text-center', textContent: String(inteiro(f.atividades_finalizadas_mes_anterior)) }),
      ]);
    });

    areaFases.appendChild(tabela([
      { label: 'Fase' },
      { label: 'Andamento' },
      { label: 'Finalizadas', className: 'text-center' },
      { label: 'Em execução', className: 'text-center' },
      { label: 'Restantes', className: 'text-center' },
      { label: '%', className: 'text-center' },
      { label: 'Semana', className: 'text-center', title: 'Finalizadas na semana corrente' },
      { label: 'Sem. ant.', className: 'text-center', title: 'Finalizadas na semana anterior' },
      { label: 'Mês', className: 'text-center', title: 'Finalizadas no mês corrente' },
      { label: 'Mês ant.', className: 'text-center', title: 'Finalizadas no mês anterior' },
    ], linhas));
  }

  /**
   * O LOTE PEDIDO É FOTOGRAFADO ANTES DO `await` E CONFERIDO DEPOIS.
   *
   * Trocar o seletor duas vezes depressa dispara duas cargas, e a do primeiro
   * lote pode chegar depois: sem esta guarda ela pintaria a tabela DELA sob um
   * seletor que já marca o outro lote. Nada na tabela repete o nome do lote,
   * então não haveria como perceber. A resposta que não é mais a pedida é
   * descartada, inclusive no `catch` -- senão o erro de um lote apaga a tabela
   * boa do outro.
   */
  async function carregarFases() {
    if (!loteSelecionado) {
      pedirLote(areaFases, 'um lote');
      return;
    }
    const pedido = loteSelecionado;
    clearChildren(areaFases);
    areaFases.appendChild(el('p', { className: 'lote-acomp__vazio', textContent: 'Carregando…' }));
    try {
      const fases = await getInfoLote(pedido);
      if (disposed || pedido !== loteSelecionado) return;
      desenharFases(fases || []);
    } catch (err) {
      if (disposed || pedido !== loteSelecionado) return;
      clearChildren(areaFases);
      areaFases.appendChild(estadoErro(err, carregarFases));
    }
  }

  // --- As subfases do lote (a lista que alimenta o seletor) ----------------

  /**
   * O seletor de subfase, e o que ele faz quando a lista não vem.
   *
   * `GET /acompanhamento/lotes/:lote/subfases` é `consulta` em `producao`, o
   * mesmo piso desta tela: quem chega aqui passa por ela, então uma falha dela
   * NÃO é falta de perfil, é o servidor ou a rede. Ela é também a única que
   * publica o `subfase_id` junto com o nome -- as outras de acompanhamento
   * trazem só o NOME, que não serve para montar `/informacoes/:lote/:subfase`.
   * Quando ela cai, esta seção fica fechada e DIZ o motivo com as palavras do
   * servidor -- um seletor vazio e mudo se leria como lote sem subfase nenhuma,
   * que é outra afirmação.
   *
   * E a falha fica AQUI: a tabela de fases acima já carregou, e é a resposta
   * principal da tela.
   */
  async function carregarSubfases() {
    if (!loteSelecionado) {
      nota(avisoSubfases, '');
      return;
    }
    const pedido = loteSelecionado;
    try {
      const subfases = await getSubfasesComProducao(pedido);
      if (disposed || pedido !== loteSelecionado) return;
      const opcoes = (subfases || []).map(s => ({
        value: s.id,
        label: s.fase ? `${s.nome} — ${s.fase}` : s.nome,
      }));
      subfaseFilter.setOptions(opcoes);
      // A SUBFASE DA URL, pelo mesmo critério do lote: só vale a que existe
      // nesta lista, e ela abre a seção de etapas sozinha.
      if (subfaseSelecionada !== null) {
        if (opcoes.some(o => Number(o.value) === subfaseSelecionada)) {
          subfaseFilter.setValue(subfaseSelecionada);
          carregarEtapas();
        } else {
          subfaseSelecionada = null;
          sincronizarUrl();
        }
      }
      nota(avisoSubfases, opcoes.length
        ? ''
        : 'Este lote ainda não tem subfase com etapa cadastrada.');
    } catch (err) {
      if (disposed || pedido !== loteSelecionado) return;
      subfaseFilter.setOptions([]);
      nota(avisoSubfases, `${err.message || 'Não foi possível carregar as subfases do lote.'} `
        + 'O quadro de fases acima não depende dela.');
    }
  }

  // --- As etapas de uma subfase --------------------------------------------

  function desenharEtapas(etapas) {
    clearChildren(areaEtapas);
    if (etapas === null) {
      areaEtapas.appendChild(el('p', {
        className: 'lote-acomp__vazio',
        textContent: 'Escolha um lote e uma subfase para ver as etapas.',
      }));
      return;
    }
    if (!etapas.length) {
      areaEtapas.appendChild(el('p', {
        className: 'lote-acomp__vazio',
        textContent: 'Nenhuma atividade nesta subfase deste lote.',
      }));
      return;
    }

    const linhas = etapas.map((e) => {
      const finalizadas = inteiro(e.atividades_finalizadas);
      const emExecucao = inteiro(e.atividades_em_execucao);
      const pausadas = inteiro(e.atividades_pausadas);
      const restantes = inteiro(e.atividades_restantes);
      const total = finalizadas + emExecucao + pausadas + restantes;
      return el('tr', {}, [
        el('td', { className: 'lote-acomp__rotulo' }, [
          el('span', { className: 'lote-acomp__ordem', textContent: String(e.etapa_ordem ?? '') }),
          e.nome || '-',
        ]),
        el('td', { className: 'lote-acomp__progresso' }, [barraDeProgresso(finalizadas, total)]),
        el('td', { className: 'text-center', textContent: String(finalizadas) }),
        el('td', { className: 'text-center', textContent: String(emExecucao) }),
        el('td', { className: 'text-center', textContent: String(pausadas) }),
        el('td', { className: 'text-center', textContent: String(restantes) }),
        el('td', { className: 'text-center', textContent: percentual(finalizadas, total) }),
        el('td', { className: 'text-center', textContent: String(inteiro(e.atividades_finalizadas_hoje)) }),
        el('td', { className: 'text-center', textContent: String(inteiro(e.atividades_finalizadas_semana)) }),
        el('td', { className: 'text-center', textContent: String(inteiro(e.atividades_finalizadas_semana_anterior)) }),
      ]);
    });

    areaEtapas.appendChild(tabela([
      { label: 'Etapa' },
      { label: 'Andamento' },
      { label: 'Finalizadas', className: 'text-center' },
      { label: 'Em execução', className: 'text-center' },
      { label: 'Pausadas', className: 'text-center' },
      { label: 'Restantes', className: 'text-center' },
      { label: '%', className: 'text-center' },
      { label: 'Hoje', className: 'text-center', title: 'Finalizadas hoje' },
      { label: 'Semana', className: 'text-center', title: 'Finalizadas na semana corrente' },
      { label: 'Sem. ant.', className: 'text-center', title: 'Finalizadas na semana anterior' },
    ], linhas));
  }

  async function carregarEtapas() {
    if (!loteSelecionado || !subfaseSelecionada) {
      desenharEtapas(null);
      return;
    }
    const pedidoLote = loteSelecionado;
    const pedidaSubfase = subfaseSelecionada;
    clearChildren(areaEtapas);
    areaEtapas.appendChild(el('p', { className: 'lote-acomp__vazio', textContent: 'Carregando…' }));
    const mesmoPedido = () => pedidoLote === loteSelecionado
      && pedidaSubfase === subfaseSelecionada;
    try {
      // A ORDEM É (lote, subfase). Invertida, os dois filtros vão para a coluna
      // errada e a resposta vem VAZIA, sem erro: é o defeito que a origem tinha.
      const etapas = await getInfoSubfaseLote(pedidoLote, pedidaSubfase);
      if (disposed || !mesmoPedido()) return;
      desenharEtapas(etapas || []);
    } catch (err) {
      if (disposed || !mesmoPedido()) return;
      clearChildren(areaEtapas);
      areaEtapas.appendChild(estadoErro(err, carregarEtapas));
    }
  }

  pedirLote(areaFases, 'um lote');
  desenharEtapas(null);
  await carregarLotes();

  return () => {
    disposed = true;
  };
}
