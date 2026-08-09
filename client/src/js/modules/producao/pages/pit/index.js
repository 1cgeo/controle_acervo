import { el, clearChildren } from '@utils/dom.js';
import { criarFiltroAno } from '@components/filtro-ano.js';
import { estadoErro } from '@components/estado-erro.js';
import {
  getPitProducao,
  getPitSubfaseProducao,
} from '@services/producao-service.js';
import './pit-producao.css';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'];

/** `·` é vazio e `0` é zero: "não veio na grade" e "conferi e não houve". */
const CELULA_VAZIA = '·';

/**
 * Agrupa as linhas (uma por lote e mês) numa linha por LOTE, dentro do projeto.
 *
 * O SERVIDOR MANDA O PRODUTO CARTESIANO (lote x mês da grade), e a grade do ano
 * corrente para no mês atual: dezembro simplesmente não vem em agosto. Por isso
 * o mês ausente vira `null` e não zero -- pintar zero em novembro afirmaria que
 * se conferiu novembro e não houve entrega, num mês que ainda não chegou.
 *
 * @param {Array<Object>} linhas
 * @returns {Array<{projeto:string, lotes:Array<{lote:string, meta:number, meses:Array<number|null>, total:number}>}>}
 */
export function agruparPitPorProjeto(linhas) {
  const projetos = new Map();

  for (const linha of linhas || []) {
    const nomeProjeto = linha.projeto || 'Sem projeto';
    if (!projetos.has(nomeProjeto)) projetos.set(nomeProjeto, new Map());
    const lotes = projetos.get(nomeProjeto);

    const chave = String(linha.lote_id);
    if (!lotes.has(chave)) {
      lotes.set(chave, {
        lote_id: linha.lote_id,
        lote: linha.lote,
        meta: Number(linha.meta) || 0,
        meses: new Array(12).fill(null),
        total: 0,
      });
    }

    const alvo = lotes.get(chave);
    const mes = Number(linha.mes);
    if (mes >= 1 && mes <= 12) {
      const valor = Number(linha.finalizadas) || 0;
      alvo.meses[mes - 1] = valor;
      alvo.total += valor;
    }
  }

  return [...projetos.entries()].map(([projeto, lotes]) => ({
    projeto,
    lotes: [...lotes.values()],
  }));
}

/**
 * O mesmo agrupamento para o detalhe por subfase, que não tem meta nem projeto.
 *
 * A CHAVE É O PAR (lote, subfase), e não a subfase sozinha: o mesmo nome de
 * subfase existe em lotes diferentes, e juntá-los somaria trabalho de lotes que
 * não se falam.
 */
export function agruparPitPorSubfase(linhas) {
  const mapa = new Map();

  for (const linha of linhas || []) {
    const chave = `${linha.lote}\u0000${linha.subfase}`;
    if (!mapa.has(chave)) {
      mapa.set(chave, {
        lote: linha.lote,
        subfase: linha.subfase,
        meses: new Array(12).fill(null),
        total: 0,
      });
    }
    const alvo = mapa.get(chave);
    const mes = Number(linha.mes);
    if (mes >= 1 && mes <= 12) {
      const valor = Number(linha.quantidade) || 0;
      alvo.meses[mes - 1] = (alvo.meses[mes - 1] || 0) + valor;
      alvo.total += valor;
    }
  }

  return [...mapa.values()];
}

const numero = (v) => (v == null ? CELULA_VAZIA : String(v));

function percentual(total, meta) {
  if (!meta || meta <= 0) return CELULA_VAZIA;
  return `${((100 * total) / meta).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
}

/**
 * O PIT DA PRODUÇÃO (#/producao/pit).
 *
 * DE ONDE VEM O NÚMERO DESTA TELA, e por que ele não se soma ao da outra.
 *
 * Existem duas telas de PIT neste sistema, e elas respondem à MESMA pergunta por
 * fontes DIFERENTES, de propósito:
 *
 *   #/producao/pit (esta)  conta a PRODUÇÃO. A meta do lote é quantas versões do
 *                          acervo apontam para uma meta do PIT daquele ano, e o
 *                          realizado é a versão cujas unidades de trabalho foram
 *                          TODAS finalizadas. Ninguém digita nada aqui: o número
 *                          se move quando a produção anda.
 *   #/execucao_pit         conta o que foi LANÇADO à mão na grade das metas, mês
 *                          a mês, por quem responde pela meta.
 *
 * ELAS PODEM DISCORDAR, E DISCORDAR NÃO É DEFEITO: uma entrega que ainda não foi
 * lançada aparece aqui e não lá, e uma meta que não passa pela produção
 * cartográfica (capacitação, campo) aparece lá e nunca aqui. SOMAR AS DUAS CONTA
 * O MESMO TRABALHO DUAS VEZES.
 *
 * E O RPCMTEC NÃO MUDA. Por decisão do chefe de 2026-08-09, a subseção de
 * produção do relatório continua DIGITADA, e o cálculo do PIT continua sendo o
 * de `#/execucao_pit`. Esta tela é leitura de acompanhamento, e não fonte de
 * documento assinado.
 *
 * SEM SELETOR DE ANO VINDO DO SERVIDOR: não há rota que liste os anos com
 * produção, então o filtro começa no ano corrente e aceita outro ano à mão.
 *
 * AS DUAS SEÇÕES CARREGAM SEPARADAS, cada uma com o próprio `catch`. As duas
 * rotas são do mesmo módulo e do mesmo piso, mas num `Promise.all` a falha de
 * uma apagaria a outra da tela, e o detalhe por subfase é o mais pesado dos
 * dois.
 *
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderPitProducao(container) {
  let disposed = false;

  const areaLote = el('div', { className: 'pit-producao__area' });
  const areaSubfase = el('div', { className: 'pit-producao__area' });

  const filtroAno = criarFiltroAno({
    permitirOutroAno: true,
    onChange: () => {
      carregarPorLote();
      carregarPorSubfase();
    },
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'PIT da produção' }),
    ]),

    // A FRASE DA PROCEDÊNCIA FICA NA TELA, e não só no comentário do arquivo:
    // quem abre as duas telas de PIT no mesmo dia precisa ler, ali, por que os
    // dois números não batem e por que não se somam.
    el('p', { className: 'pit-producao__procedencia' }, [
      el('strong', { textContent: 'De onde vem este número: ' }),
      'da PRODUÇÃO. A meta é a quantidade de versões do lote apontadas para uma ',
      'meta do PIT do ano, e o realizado é a versão cujas unidades de trabalho ',
      'foram todas finalizadas. A tela ',
      el('a', { href: '#/execucao_pit', textContent: 'Execução do PIT' }),
      ' responde à mesma pergunta a partir do que foi LANÇADO à mão. São contas ',
      'de fontes diferentes, por desenho: não se somam.',
    ]),

    el('div', { className: 'page__filters' }, [filtroAno.element]),

    el('section', { className: 'pit-producao__secao' }, [
      el('h2', { className: 'pit-producao__titulo', textContent: 'Por lote' }),
      el('p', { className: 'pit-producao__nota' }, [
        `${CELULA_VAZIA} é mês que não veio na grade do ano (no ano corrente ela `,
        'para no mês atual), e 0 é mês que a produção fechou sem entrega.',
      ]),
      areaLote,
    ]),

    el('section', { className: 'pit-producao__secao' }, [
      el('h2', { className: 'pit-producao__titulo', textContent: 'Por subfase' }),
      el('p', { className: 'pit-producao__nota', textContent: 'A mesma entrega, aberta pela subfase em que ela fechou. Não há meta por subfase: a meta é do lote.' }),
      areaSubfase,
    ]),
  ]);

  container.appendChild(page);

  // --- Desenho --------------------------------------------------------------

  const cabecalho = (primeiras, ultimas) => el('thead', {}, [
    el('tr', {}, [
      ...primeiras.map(t => el('th', { className: 'pit-producao__rotulo', textContent: t })),
      ...MESES.map(m => el('th', { textContent: m })),
      ...ultimas.map(t => el('th', { textContent: t })),
    ]),
  ]);

  function tabelaDoProjeto(grupo) {
    const corpo = el('tbody', {}, grupo.lotes.map(lote => el('tr', {}, [
      el('td', { className: 'pit-producao__rotulo', textContent: lote.lote || '' }),
      el('td', { className: 'pit-producao__total', textContent: String(lote.meta) }),
      ...lote.meses.map((valor, i) => el('td', {
        className: valor == null ? 'pit-producao__celula pit-producao__celula--fora' : 'pit-producao__celula',
        textContent: numero(valor),
        title: `${MESES[i]}: ${valor == null ? 'mês fora da grade do ano' : `${valor} entrega(s)`}`,
      })),
      el('td', { className: 'pit-producao__total', textContent: String(lote.total) }),
      el('td', {
        className: 'pit-producao__total',
        textContent: percentual(lote.total, lote.meta),
        title: `${lote.total} de ${lote.meta}`,
      }),
    ])));

    return el('div', { className: 'pit-producao__projeto' }, [
      el('h3', { className: 'pit-producao__projeto-nome', textContent: grupo.projeto }),
      el('div', { className: 'pit-producao__rolagem' }, [
        el('table', { className: 'pit-producao__tabela' }, [
          cabecalho(['Lote', 'Meta'], ['Total', '%']),
          corpo,
        ]),
      ]),
    ]);
  }

  function tabelaDeSubfases(linhas) {
    const corpo = el('tbody', {}, linhas.map(linha => el('tr', {}, [
      el('td', { className: 'pit-producao__rotulo', textContent: linha.lote || '' }),
      el('td', { className: 'pit-producao__rotulo', textContent: linha.subfase || '' }),
      ...linha.meses.map((valor, i) => el('td', {
        className: valor == null ? 'pit-producao__celula pit-producao__celula--fora' : 'pit-producao__celula',
        textContent: numero(valor),
        title: `${MESES[i]}: ${valor == null ? 'nenhuma entrega' : `${valor} entrega(s)`}`,
      })),
      el('td', { className: 'pit-producao__total', textContent: String(linha.total) }),
    ])));

    return el('div', { className: 'pit-producao__rolagem' }, [
      el('table', { className: 'pit-producao__tabela' }, [
        cabecalho(['Lote', 'Subfase'], ['Total']),
        corpo,
      ]),
    ]);
  }

  const vazio = (texto) => el('p', { className: 'pit-producao__vazio', textContent: texto });

  // --- Cargas ---------------------------------------------------------------

  async function carregarPorLote() {
    const ano = filtroAno.getAno();
    clearChildren(areaLote);
    areaLote.appendChild(vazio('Carregando...'));
    try {
      const linhas = await getPitProducao(ano);
      if (disposed) return;
      const grupos = agruparPitPorProjeto(linhas);
      clearChildren(areaLote);
      if (!grupos.length) {
        areaLote.appendChild(vazio(
          `Nenhum lote com meta do PIT em ${ano}. A meta do lote nasce da versão `
          + 'do acervo apontada para uma meta do PIT daquele ano.'
        ));
        return;
      }
      for (const grupo of grupos) areaLote.appendChild(tabelaDoProjeto(grupo));
    } catch (err) {
      if (disposed) return;
      clearChildren(areaLote);
      areaLote.appendChild(estadoErro(err, carregarPorLote));
    }
  }

  async function carregarPorSubfase() {
    const ano = filtroAno.getAno();
    clearChildren(areaSubfase);
    areaSubfase.appendChild(vazio('Carregando...'));
    try {
      const linhas = await getPitSubfaseProducao(ano);
      if (disposed) return;
      const agrupadas = agruparPitPorSubfase(linhas);
      clearChildren(areaSubfase);
      if (!agrupadas.length) {
        areaSubfase.appendChild(vazio(
          `Nenhuma subfase fechou entrega em ${ano}.`
        ));
        return;
      }
      areaSubfase.appendChild(tabelaDeSubfases(agrupadas));
    } catch (err) {
      if (disposed) return;
      clearChildren(areaSubfase);
      areaSubfase.appendChild(estadoErro(err, carregarPorSubfase));
    }
  }

  carregarPorLote();
  carregarPorSubfase();

  return () => {
    disposed = true;
  };
}
