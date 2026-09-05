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
 * devolve, por (`lote_id`, `subfase_id`), uma lista de `[dia_inicial, 0 ou 1,
 * dia_seguinte_ao_final]`, montada inteira em SQL: `generate_series` dá a grade
 * de dias do ano corrente, uma junção marca os dias cobertos por alguma
 * atividade e a técnica de ilhas funde os dias iguais. Refazer essa costura aqui
 * só criaria um segundo lugar para ela divergir.
 *
 * A SÉRIE É O `subfase_id`, E NUNCA O NOME. `producao.subfase` é UNIQUE (nome,
 * fase_id): "Edição" existe na linha da Carta Topográfica E na do CDGV, e um
 * lote misto executa as duas. Até 2026-08-09 o servidor agrupava por nome e as
 * duas vinham numa barra só, com as faixas intercaladas -- o mesmo dia aparecia
 * duas vezes, uma com valor 1 e outra com 0. Agora vêm duas linhas, e é por isso
 * que a resposta traz `lote_id`, `subfase_id` e `linha_producao`: sem eles a
 * tela mostraria duas linhas de rótulo idêntico e o conserto pareceria defeito
 * novo.
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
 * OS DOIS FILTROS VIVEM NA URL, e não em variáveis desta função. Sair da tela
 * para conferir outra coisa e voltar devolvia o lote em "Todos" e a busca em
 * branco, e sem nada na barra de endereço também não havia como mandar o
 * recorte para outra pessoa. A escrita é por `history.replaceState`: trocar o
 * hash faria o roteador remontar a tela a cada tecla digitada. O que vale o
 * padrão não entra na query, então a tela pelada continua sendo
 * '#/producao/atividade_subfase'.
 *
 * @param {HTMLElement} container
 * @param {{params?:Object, query?:URLSearchParams}} [ctx]
 * @returns {Function} cleanup
 */
export async function renderAtividadeSubfase(container, ctx = {}) {
  let disposed = false;

  const consulta = (ctx && ctx.query) || new URLSearchParams();

  let series = [];
  const filtros = {
    lote: consulta.get('lote') || null,
    busca: consulta.get('busca') || '',
  };
  let debounce = null;

  function sincronizarUrl() {
    const params = new URLSearchParams();
    if (filtros.lote) params.set('lote', String(filtros.lote));
    if (filtros.busca) params.set('busca', filtros.busca);
    const texto = params.toString();
    history.replaceState(null, '', `#/producao/atividade_subfase${texto ? `?${texto}` : ''}`);
  }

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
    value: filtros.busca,
    onInput: (v) => {
      filtros.busca = v;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { if (!disposed) desenhar(); }, 250);
    },
  });

  const legenda = el('div', { className: 'tempo-subfase__legenda' }, [
    el('span', { className: 'tempo-subfase__amostra' }),
    el('span', { textContent: 'dias com atividade aberta na subfase' }),
    el('span', {
      className: 'tempo-subfase__legenda-nota',
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

  /**
   * O rótulo da linha, e a linha de produção só quando ela desempata.
   *
   * Duas subfases de mesmo nome no mesmo quadro são duas linhas de produção
   * diferentes, e sem a sigla a tela mostraria "Edição" duas vezes sem dizer
   * qual é qual. Escrevê-la SEMPRE repetiria a mesma sigla em todas as linhas de
   * um lote de linha única, que é o caso comum, e roubaria espaço do nome.
   */
  function rotuloDe(item, repetidos) {
    const nome = item.subfase || '-';
    if (!item.linha_producao || !repetidos.has(item.subfase)) return nome;
    return `${nome} (${item.linha_producao})`;
  }

  function trilho(item, min, max, repetidos) {
    const total = max - min;
    const rotulo = rotuloDe(item, repetidos);
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
          className: 'tempo-subfase__barra',
          style: {
            left: `${Math.max(0, esquerda)}%`,
            // Faixa de um dia num ano inteiro dá menos de meio por cento, e
            // some. O mínimo em pixel é o que a mantém visível sem mentir sobre
            // a posição, que continua exata.
            width: `max(3px, ${Math.max(0, largura)}%)`,
          },
          title: `${rotulo}: ${diaBR(f.inicio)} a ${diaBR(ultimoDia)} `
            + `(${dias} dia${dias === 1 ? '' : 's'})`,
        });
      });

    return el('div', { className: 'tempo-subfase__linha' }, [
      el('div', {
        className: 'tempo-subfase__rotulo',
        textContent: rotulo,
        title: rotulo,
      }),
      el('div', { className: 'tempo-subfase__trilho' }, barras),
    ]);
  }

  function quadroDoLote(lote, itens, min, max) {
    const marcas = marcasDeMes(min, max);
    const vistos = new Set();
    const repetidos = new Set();
    for (const i of itens) {
      if (vistos.has(i.subfase)) repetidos.add(i.subfase);
      vistos.add(i.subfase);
    }
    return el('section', { className: 'tempo-subfase__quadro' }, [
      el('h2', { className: 'tempo-subfase__lote', textContent: lote }),
      el('div', { className: 'tempo-subfase__eixo' }, [
        el('div', { className: 'tempo-subfase__rotulo' }),
        el('div', { className: 'tempo-subfase__trilho tempo-subfase__trilho--eixo' },
          marcas.map(m => el('span', {
            className: 'tempo-subfase__marca',
            style: { left: `${m.posicao}%` },
            textContent: m.rotulo,
          }))),
      ]),
      ...itens.map(i => trilho(i, min, max, repetidos)),
    ]);
  }

  // O FILTRO CASA `lote_id`, e não o nome: dois projetos podem ter lotes de
  // mesmo nome, e escolher um deles no seletor traria os dois. A comparação é
  // por texto dos dois lados porque `lote_id` é BIGINT no banco, e o driver o
  // entrega como string enquanto o valor do `<select>` já é string.
  const passaNoFiltro = (item) => {
    if (filtros.lote && String(item.lote_id) !== String(filtros.lote)) return false;
    if (!filtros.busca) return true;
    return normalizar(item.subfase).includes(normalizar(filtros.busca));
  };

  function desenhar() {
    sincronizarUrl();
    clearChildren(area);

    const visiveis = series.filter(passaNoFiltro).filter(i => i.__faixas.length);
    if (!visiveis.length) {
      area.appendChild(el('p', {
        className: 'tempo-subfase__vazio',
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
        className: 'tempo-subfase__vazio',
        textContent: 'As faixas de atividade não formam um período desenhável.',
      }));
      return;
    }

    // A ORDEM VEM DO SERVIDOR (lote, subfase, e a chave no desempate), então o
    // agrupamento é sequencial. A QUEBRA É PELO `lote_id`, e não pelo nome: o
    // nome fundiria dois lotes homônimos de projetos diferentes num quadro só,
    // que é a mesma fusão por rótulo que o servidor acabou de deixar de fazer.
    let loteAtual = null;
    let nomeAtual = null;
    let acumulado = [];
    const despejar = () => {
      if (acumulado.length) {
        area.appendChild(quadroDoLote(nomeAtual, acumulado, min, max));
      }
    };
    for (const item of visiveis) {
      if (String(item.lote_id) !== String(loteAtual)) {
        despejar();
        loteAtual = item.lote_id;
        nomeAtual = item.lote;
        acumulado = [];
      }
      acumulado.push(item);
    }
    despejar();
  }

  async function carregar() {
    clearChildren(area);
    area.appendChild(el('p', { className: 'tempo-subfase__vazio', textContent: 'Carregando…' }));
    try {
      const dados = await getAtividadeSubfase();
      if (disposed) return;
      series = (dados || []).map(item => ({ ...item, __faixas: faixasDe(item) }));
      // As opções saem de um `Map` por `lote_id`: dois lotes de mesmo nome viram
      // duas opções, e não uma que traria os dois.
      const lotes = new Map();
      for (const s of series) {
        if (s.lote_id != null) lotes.set(String(s.lote_id), s.lote);
      }
      // O LOTE DA URL QUE NÃO EXISTE NOS DADOS CAI FORA: um `?lote=` de um
      // recorte que acabou deixaria a tela vazia com o seletor dizendo "Todos".
      if (filtros.lote !== null && !lotes.has(String(filtros.lote))) filtros.lote = null;

      loteFilter.setOptions([...lotes.entries()]
        .sort((a, b) => String(a[1]).localeCompare(String(b[1]), 'pt-BR'))
        .map(([value, label]) => ({ value, label })));
      // DEPOIS do `setOptions`, que guarda a seleção que o `select` tinha -- e na
      // montagem ela é vazia, porque a opção do valor da URL ainda não existia.
      loteFilter.setValue(filtros.lote);
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
