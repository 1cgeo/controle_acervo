import { el, clearChildren } from '@utils/dom.js';
import { createSelectField, createTextField } from '@components/form-fields/form-fields.js';
import { estadoErro } from '@components/estado-erro.js';
import { getAtividadeSubfase } from '@services/producao-service.js';
import './atividade-subfase.css';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const DIA_MS = 86400000;

/**
 * 'YYYY-MM-DD' como dia LOCAL, e nunca por `new Date(texto)`.
 *
 * `new Date('2026-01-01')` é lido como MEIA-NOITE EM UTC, que em UTC-3 é 31 de
 * dezembro às 21h. A barra inteira andaria um dia para trás, e o ano começaria
 * em dezembro do ano anterior. O servidor já monta as faixas no fuso do banco
 * justamente para não passar por isso (ver o comentário de `linhaDoTempo` em
 * `acompanhamento_producao_ctrl.js`); jogar fora esse cuidado na leitura seria
 * reintroduzir o defeito no último passo.
 */
export function diaLocal(texto) {
  if (!texto) return null;
  const partes = String(texto).slice(0, 10).split('-').map(Number);
  if (partes.length !== 3 || partes.some(n => !Number.isFinite(n))) return null;
  const [ano, mes, dia] = partes;
  const d = new Date(ano, mes - 1, dia);
  return Number.isNaN(d.getTime()) ? null : d;
}

const diaBR = (d) => (d ? d.toLocaleDateString('pt-BR') : '-');

/**
 * As faixas de uma série, já em datas e com o fim INCLUSIVO.
 *
 * O SERVIDOR MANDA O FIM EXCLUSIVO: cada faixa é `[dia_inicial, 0 ou 1,
 * dia_seguinte_ao_final]` (`(f.fim + 1)::text` no SQL). Para desenhar, o
 * exclusivo é o certo -- é ele que faz duas faixas coladas não deixarem um vão
 * de um dia. Para ESCREVER a data no rótulo, o exclusivo mentiria um dia a
 * mais, então o texto usa `fim - 1 dia`.
 */
export function faixasDe(item) {
  const saida = [];
  for (const faixa of item.data || []) {
    if (!Array.isArray(faixa) || faixa.length < 3) continue;
    const inicio = diaLocal(faixa[0]);
    const fimExclusivo = diaLocal(faixa[2]);
    if (!inicio || !fimExclusivo) continue;
    saida.push({
      inicio,
      fimExclusivo,
      // O valor chega como TEXTO ('0' ou '1'), porque o SQL faz `valor::text`.
      // O `Number` cobre os dois, para o dia em que a coluna deixar de ser
      // convertida.
      ativa: Number(faixa[1]) === 1,
    });
  }
  return saida;
}

const normalizar = (v) => String(v ?? '')
  .toLowerCase()
  .normalize('NFD')
  .replace(new RegExp('[\\u0300-\\u036f]', 'g'), '');

/**
 * ATIVIDADE POR SUBFASE (#/producao/atividade_subfase): em que dias cada
 * subfase de cada lote teve gente trabalhando.
 *
 * A RESPOSTA JÁ VEM EM FAIXAS, e a tela não as recalcula. `/atividade_subfase`
 * devolve, por (lote, subfase), uma lista de `[dia_inicial, 0 ou 1,
 * dia_seguinte_ao_final]`, montada inteira em SQL: `generate_series` dá a grade
 * de dias do ano corrente, um `EXISTS` marca cada dia e a técnica de ilhas funde
 * os dias iguais. Refazer essa costura aqui só criaria um segundo lugar para ela
 * divergir.
 *
 * SÓ A FAIXA ATIVA É PINTADA. A origem desenha as duas (verde ativo, rosa
 * inativo), e duas cores para "trabalhou / não trabalhou" gastam a paleta de
 * estado da casa numa distinção que a ausência de barra já faz. O trilho vazio é
 * o "não trabalhou", e sobra uma cor a menos para confundir com a de
 * `#/execucao_pit`, que quer dizer outra coisa (posição acumulada contra o
 * plano).
 *
 * UM QUADRO POR LOTE. As linhas de um lote se comparam entre si -- "a validação
 * parou quando a edição começou" -- e essa leitura some quando trinta subfases
 * de seis lotes ficam empilhadas numa lista só.
 *
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export async function renderAtividadeSubfase(container) {
  let disposed = false;

  let series = [];
  const filtros = { lote: null, busca: '' };
  let debounce = null;

  const loteFilter = createSelectField({
    label: 'Lote',
    options: [],
    placeholder: 'Todos',
    value: null,
    onChange: (v) => { filtros.lote = v; desenhar(); },
  });

  const buscaFilter = createTextField({
    label: 'Buscar subfase',
    placeholder: 'Nome da subfase',
    onInput: (v) => {
      filtros.busca = v;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { if (!disposed) desenhar(); }, 250);
    },
  });

  const legenda = el('div', { className: 'linha-tempo__legenda' }, [
    el('span', { className: 'linha-tempo__amostra' }),
    el('span', { textContent: 'dias com atividade aberta na subfase' }),
    el('span', {
      className: 'linha-tempo__legenda-nota',
      textContent: 'O período é o ano corrente, do dia 1º de janeiro até hoje.',
    }),
  ]);

  const area = el('div', {});

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Atividade por subfase' }),
    ]),
    el('div', { className: 'page__filters' }, [loteFilter.element, buscaFilter.element]),
    legenda,
    area,
  ]);
  container.appendChild(page);

  /** O domínio de tempo comum a TODOS os quadros. */
  function dominio(itens) {
    let min = null;
    let max = null;
    for (const item of itens) {
      for (const f of item.__faixas) {
        if (!min || f.inicio < min) min = f.inicio;
        if (!max || f.fimExclusivo > max) max = f.fimExclusivo;
      }
    }
    return { min, max };
  }

  /**
   * As marcas de mês, com a posição em porcentagem.
   *
   * O EIXO É O MESMO EM TODOS OS QUADROS, e é o que permite comparar dois lotes
   * de relance. Um eixo por quadro, cada um com o próprio começo, faria duas
   * barras do mesmo tamanho significarem períodos diferentes.
   */
  function marcasDeMes(min, max) {
    const marcas = [];
    const total = max - min;
    if (total <= 0) return marcas;
    const cursor = new Date(min.getFullYear(), min.getMonth(), 1);
    if (cursor < min) cursor.setMonth(cursor.getMonth() + 1);
    while (cursor <= max) {
      marcas.push({
        rotulo: `${MESES[cursor.getMonth()]}${cursor.getMonth() === 0 ? `/${cursor.getFullYear()}` : ''}`,
        posicao: (100 * (cursor - min)) / total,
      });
      cursor.setMonth(cursor.getMonth() + 1);
    }
    return marcas;
  }

  function trilho(item, min, max) {
    const total = max - min;
    const barras = item.__faixas
      .filter(f => f.ativa)
      .map((f) => {
        const esquerda = (100 * (f.inicio - min)) / total;
        const largura = (100 * (f.fimExclusivo - f.inicio)) / total;
        // O último dia INCLUSIVO é o que se escreve: o servidor manda o dia
        // SEGUINTE ao fim, e repeti-lo no rótulo diria um dia a mais.
        const ultimoDia = new Date(f.fimExclusivo.getTime() - DIA_MS);
        const dias = Math.max(1, Math.round((f.fimExclusivo - f.inicio) / DIA_MS));
        return el('span', {
          className: 'linha-tempo__barra',
          style: {
            left: `${Math.max(0, esquerda)}%`,
            // Faixa de um dia num ano inteiro dá menos de meio por cento, e
            // some. O mínimo em pixel é o que a mantém visível sem mentir sobre
            // a posição, que continua exata.
            width: `max(3px, ${Math.max(0, largura)}%)`,
          },
          title: `${item.subfase}: ${diaBR(f.inicio)} a ${diaBR(ultimoDia)} `
            + `(${dias} dia${dias === 1 ? '' : 's'})`,
        });
      });

    return el('div', { className: 'linha-tempo__linha' }, [
      el('div', {
        className: 'linha-tempo__rotulo',
        textContent: item.subfase || '-',
        title: item.subfase || '',
      }),
      el('div', { className: 'linha-tempo__trilho' }, barras),
    ]);
  }

  function quadroDoLote(lote, itens, min, max) {
    const marcas = marcasDeMes(min, max);
    return el('section', { className: 'linha-tempo__quadro' }, [
      el('h2', { className: 'linha-tempo__lote', textContent: lote }),
      el('div', { className: 'linha-tempo__eixo' }, [
        el('div', { className: 'linha-tempo__rotulo' }),
        el('div', { className: 'linha-tempo__trilho linha-tempo__trilho--eixo' },
          marcas.map(m => el('span', {
            className: 'linha-tempo__marca',
            style: { left: `${m.posicao}%` },
            textContent: m.rotulo,
          }))),
      ]),
      ...itens.map(i => trilho(i, min, max)),
    ]);
  }

  const passaNoFiltro = (item) => {
    if (filtros.lote && item.lote !== filtros.lote) return false;
    if (!filtros.busca) return true;
    return normalizar(item.subfase).includes(normalizar(filtros.busca));
  };

  function desenhar() {
    clearChildren(area);

    const visiveis = series.filter(passaNoFiltro).filter(i => i.__faixas.length);
    if (!visiveis.length) {
      area.appendChild(el('p', {
        className: 'linha-tempo__vazio',
        textContent: series.length
          ? 'Nenhuma subfase para estes filtros.'
          : 'Nenhuma atividade lançada no ano corrente.',
      }));
      return;
    }

    // O DOMÍNIO É O DO CONJUNTO VISÍVEL, e se refaz a cada filtro: filtrar um
    // lote que só trabalhou em março e manter o eixo de janeiro a dezembro
    // espremeria a informação num canto da tela.
    const { min, max } = dominio(visiveis);
    if (!min || !max || max <= min) {
      area.appendChild(el('p', {
        className: 'linha-tempo__vazio',
        textContent: 'As faixas de atividade não formam um período desenhável.',
      }));
      return;
    }

    // A ORDEM VEM DO SERVIDOR (lote, subfase), então o agrupamento é
    // sequencial: um `Map` por nome bastaria hoje e fundiria lotes homônimos no
    // dia em que dois projetos tivessem lotes de mesmo nome.
    let loteAtual = null;
    let acumulado = [];
    const despejar = () => {
      if (loteAtual !== null && acumulado.length) {
        area.appendChild(quadroDoLote(loteAtual, acumulado, min, max));
      }
    };
    for (const item of visiveis) {
      if (item.lote !== loteAtual) {
        despejar();
        loteAtual = item.lote;
        acumulado = [];
      }
      acumulado.push(item);
    }
    despejar();
  }

  async function carregar() {
    clearChildren(area);
    area.appendChild(el('p', { className: 'linha-tempo__vazio', textContent: 'Carregando…' }));
    try {
      const dados = await getAtividadeSubfase();
      if (disposed) return;
      series = (dados || []).map(item => ({ ...item, __faixas: faixasDe(item) }));
      loteFilter.setOptions([...new Set(series.map(s => s.lote).filter(Boolean))]
        .sort((a, b) => String(a).localeCompare(String(b), 'pt-BR'))
        .map(l => ({ value: l, label: l })));
      desenhar();
    } catch (err) {
      if (disposed) return;
      series = [];
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
