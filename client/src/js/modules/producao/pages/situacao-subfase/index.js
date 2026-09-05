import { el, clearChildren } from '@utils/dom.js';
import { createTextField } from '@components/form-fields/form-fields.js';
import { estadoErro } from '@components/estado-erro.js';
import { getSituacaoSubfase } from '@services/producao-service.js';
import './situacao-subfase.css';

const inteiro = (v) => Number(v || 0);

const percentual = (parte, total) => (total > 0
  ? `${((100 * parte) / total).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
  : '·');

const normalizar = (v) => String(v ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');

/**
 * As linhas agrupadas por BLOCO, na ordem em que o servidor as mandou.
 *
 * A CHAVE É `bloco_id`, E NUNCA O NOME. Bloco é de lote, e dois lotes podem ter
 * blocos de mesmo nome: agrupar por nome fundiria dois blocos diferentes num
 * quadro só, somando trabalho de projetos distintos sem que nada acusasse. É a
 * mesma armadilha que a origem tratou, e o `bloco_id` vem na resposta
 * exatamente para isso.
 *
 * A ORDEM É A DA RESPOSTA (`b.prioridade, s.ordem`), e ela é informação: o
 * primeiro bloco é o que a Divisão priorizou. Reordenar por nome jogaria fora a
 * única coisa que a consulta ordena.
 *
 * @param {Array<Object>} linhas
 * @returns {Array<{bloco_id:*, bloco:string, subfases:Array<Object>}>}
 */
export function agruparPorBloco(linhas) {
  const grupos = new Map();
  for (const linha of linhas || []) {
    const chave = linha.bloco_id;
    if (!grupos.has(chave)) {
      grupos.set(chave, { bloco_id: chave, bloco: linha.bloco, subfases: [] });
    }
    grupos.get(chave).subfases.push(linha);
  }
  return [...grupos.values()];
}

/**
 * SITUAÇÃO DA SUBFASE (#/producao/situacao_subfase): quanto cada bloco já
 * fechou em cada subfase, e quanto falta.
 *
 * O RECORTE É DO SERVIDOR, e é o projeto que NÃO encerrou. A tela não filtra
 * projeto nenhum, e não é esquecimento: a consulta já corta por
 * `status_execucao_id NOT IN (encerrado)`, e repetir o corte aqui criaria um
 * segundo lugar para ele divergir do domínio.
 *
 * UMA BARRA POR SUBFASE, EM PROPORÇÃO. É o que a origem faz (barra empilhada em
 * 100%), e é a leitura certa: os blocos têm tamanhos muito diferentes, e a
 * contagem absoluta lado a lado só diz qual bloco é maior. Os números absolutos
 * ficam escritos ao lado da barra, porque "90% de 10" e "90% de 400" pedem
 * decisões diferentes.
 *
 * DUAS FAIXAS E NENHUMA COR DE ESTADO. A parte finalizada usa a cor primária, e
 * o resto é o trilho neutro. A paleta de estado desta casa é a de
 * `#/execucao_pit` -- verde alcançou o plano, âmbar ficou no meio, vermelho não
 * teve nada -- e ela compara o ACUMULADO com o que foi PROMETIDO até o mês.
 * Aqui não há prazo nem promessa: uma subfase em 30% pode estar adiantada, e
 * pintá-la de vermelho afirmaria um atraso que ninguém mediu. Reusar aquelas
 * cores com outro sentido seria a terceira convenção de cor no mesmo sistema.
 *
 * A BUSCA VIVE NA URL, e não numa variável desta função. Sair da tela para
 * conferir outra coisa e voltar apagava o texto digitado, e sem nada na barra de
 * endereço também não havia como mandar o recorte para outra pessoa. A escrita é
 * por `history.replaceState`: trocar o hash faria o roteador remontar a tela a
 * cada tecla. Busca vazia não entra na query, então a tela pelada continua sendo
 * '#/producao/situacao_subfase'.
 *
 * @param {HTMLElement} container
 * @param {{params?:Object, query?:URLSearchParams}} [ctx]
 * @returns {Function} cleanup
 */
export async function renderSituacaoSubfase(container, ctx = {}) {
  let disposed = false;

  const consulta = (ctx && ctx.query) || new URLSearchParams();

  let linhas = [];
  let busca = consulta.get('busca') || '';
  let debounce = null;

  function sincronizarUrl() {
    const params = new URLSearchParams();
    if (busca) params.set('busca', busca);
    const texto = params.toString();
    history.replaceState(null, '', `#/producao/situacao_subfase${texto ? `?${texto}` : ''}`);
  }

  const buscaFilter = createTextField({
    label: 'Buscar',
    placeholder: 'Bloco ou subfase',
    value: busca,
    onInput: (v) => {
      busca = v;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { if (!disposed) desenhar(); }, 250);
    },
  });

  const resumo = el('p', { className: 'situacao-sub__resumo' });
  const legenda = el('div', { className: 'situacao-sub__legenda' }, [
    el('span', { className: 'situacao-sub__amostra situacao-sub__amostra--feita' }),
    el('span', { textContent: 'finalizadas' }),
    el('span', { className: 'situacao-sub__amostra' }),
    el('span', { textContent: 'não finalizadas' }),
    el('span', {
      className: 'situacao-sub__legenda-nota',
      textContent: 'Só os projetos que ainda não encerraram.',
    }),
  ]);
  const area = el('div', {});

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Situação da subfase' }),
    ]),
    el('div', { className: 'page__filters' }, [buscaFilter.element]),
    resumo,
    legenda,
    area,
  ]);
  container.appendChild(page);

  function linhaDaSubfase(s) {
    const feitas = inteiro(s.finalizadas);
    const faltam = inteiro(s.nao_finalizadas);
    const total = feitas + faltam;
    const pct = total > 0 ? (100 * feitas) / total : 0;

    return el('div', { className: 'situacao-sub__linha' }, [
      el('div', {
        className: 'situacao-sub__rotulo',
        textContent: s.subfase || '-',
        title: s.subfase || '',
      }),
      el('div', {
        className: 'situacao-sub__barra',
        title: `${feitas} finalizada(s) e ${faltam} não finalizada(s) de ${total}`,
      }, [
        el('span', {
          className: 'situacao-sub__barra-feita',
          style: { width: `${Math.min(100, Math.max(0, pct))}%` },
        }),
      ]),
      el('div', { className: 'situacao-sub__numeros' }, [
        el('span', { className: 'situacao-sub__pct', textContent: percentual(feitas, total) }),
        el('span', {
          className: 'situacao-sub__contagem',
          textContent: `${feitas} de ${total}`,
        }),
      ]),
    ]);
  }

  function quadroDoBloco(grupo) {
    const feitas = grupo.subfases.reduce((t, s) => t + inteiro(s.finalizadas), 0);
    const faltam = grupo.subfases.reduce((t, s) => t + inteiro(s.nao_finalizadas), 0);
    const total = feitas + faltam;

    return el('section', { className: 'situacao-sub__quadro' }, [
      el('header', { className: 'situacao-sub__cabecalho' }, [
        el('h2', { className: 'situacao-sub__bloco', textContent: grupo.bloco || '-' }),
        el('span', {
          className: 'situacao-sub__total',
          textContent: `${feitas} de ${total} atividade(s) `
            + `(${percentual(feitas, total)}) em ${grupo.subfases.length} subfase(s)`,
        }),
      ]),
      ...grupo.subfases.map(linhaDaSubfase),
    ]);
  }

  function desenhar() {
    sincronizarUrl();
    clearChildren(area);

    const alvo = normalizar(busca);
    const visiveis = alvo
      ? linhas.filter(l => normalizar(l.bloco).includes(alvo)
        || normalizar(l.subfase).includes(alvo))
      : linhas;

    if (!linhas.length) {
      resumo.textContent = '';
      area.appendChild(el('p', {
        className: 'situacao-sub__vazio',
        textContent: 'Nenhuma atividade em bloco de projeto em andamento.',
      }));
      return;
    }

    const grupos = agruparPorBloco(visiveis);
    const feitas = visiveis.reduce((t, s) => t + inteiro(s.finalizadas), 0);
    const faltam = visiveis.reduce((t, s) => t + inteiro(s.nao_finalizadas), 0);
    resumo.textContent = `${grupos.length} bloco(s), ${visiveis.length} subfase(s), `
      + `${feitas} de ${feitas + faltam} atividade(s) finalizada(s).`;

    if (!grupos.length) {
      area.appendChild(el('p', {
        className: 'situacao-sub__vazio',
        textContent: 'Nenhum bloco ou subfase com este texto.',
      }));
      return;
    }
    for (const grupo of grupos) area.appendChild(quadroDoBloco(grupo));
  }

  async function carregar() {
    clearChildren(area);
    area.appendChild(el('p', { className: 'situacao-sub__vazio', textContent: 'Carregando…' }));
    try {
      const dados = await getSituacaoSubfase();
      if (disposed) return;
      linhas = dados || [];
      desenhar();
    } catch (err) {
      if (disposed) return;
      linhas = [];
      resumo.textContent = '';
      clearChildren(area);
      area.appendChild(estadoErro(err, carregar));
    }
  }

  await carregar();

  return () => {
    disposed = true;
    if (debounce) clearTimeout(debounce);
  };
}
