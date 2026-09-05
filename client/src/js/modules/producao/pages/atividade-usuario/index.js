import { el, clearChildren } from '@utils/dom.js';
import { chip } from '@components/status-chip.js';
import { estadoErro } from '@components/estado-erro.js';
import { createDataTable } from '@components/data-table/data-table.js';
import {
  getAtividadeUsuario,
  getResumoUsuario,
} from '@services/producao-service.js';
import './atividade-usuario.css';

const MESES = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun',
  'jul', 'ago', 'set', 'out', 'nov', 'dez'];

const DIA_MS = 24 * 60 * 60 * 1000;

/**
 * O dia de calendário, sem fuso.
 *
 * O servidor manda `'2026-03-05'`, e `new Date('2026-03-05')` é meia-noite em
 * UTC: em UTC-3 ele se imprime como 4 de março. Aqui a data não é um INSTANTE, e
 * sim uma casa da régua, então ela vira número por `Date.UTC` e nunca volta a
 * ser hora local. É a mesma armadilha que o `.raw()` do Joi fecha no servidor.
 *
 * @param {string} texto - 'AAAA-MM-DD'
 * @returns {number|null} milissegundos em UTC
 */
export function diaEmMs(texto) {
  if (typeof texto !== 'string') return null;
  const partes = /^(\d{4})-(\d{2})-(\d{2})/.exec(texto);
  if (!partes) return null;
  return Date.UTC(Number(partes[1]), Number(partes[2]) - 1, Number(partes[3]));
}

/**
 * As faixas OCUPADAS de uma linha, e o intervalo que a régua precisa cobrir.
 *
 * A resposta traz faixas `[dia_inicial, '0' ou '1', dia_seguinte_ao_final]`, e
 * não dias soltos: dias consecutivos com o mesmo valor entram numa faixa só. O
 * FIM É EXCLUSIVO -- o servidor manda `fim + 1` -- e tratá-lo como inclusivo
 * pintaria um dia a mais em cada faixa, o que numa linha de 200 faixas vira uma
 * conta visivelmente errada.
 *
 * As faixas de valor '0' são o descanso, e não entram: elas são o fundo da
 * barra.
 *
 * @param {Array<Array<string>>} data
 * @returns {{faixas:Array<{inicio:number, fim:number}>, min:number|null, max:number|null}}
 */
export function faixasOcupadas(data) {
  const faixas = [];
  let min = null;
  let max = null;

  for (const bruta of data || []) {
    if (!Array.isArray(bruta) || bruta.length < 3) continue;
    const inicio = diaEmMs(bruta[0]);
    const fim = diaEmMs(bruta[2]);
    if (inicio == null || fim == null) continue;

    if (min == null || inicio < min) min = inicio;
    if (max == null || fim > max) max = fim;

    // O valor chega como TEXTO ('0' ou '1'), porque ele vem de um
    // `ARRAY[...]::text[]` do Postgres. Comparar com o número 1 daria falso
    // sempre, e a tela ficaria em branco sem erro nenhum.
    if (String(bruta[1]) === '1') faixas.push({ inicio, fim });
  }

  return { faixas, min, max };
}

/** A cor do chip de situação de agora. */
function chipDoStatus(status) {
  if (status === 'Em Atividade') return chip(status, 'success');
  if (status === 'Atividade Pausada') return chip(status, 'warning');
  if (status === 'Ocioso') return chip(status, 'default');
  return chip(status || 'Sem informação', 'default');
}

/**
 * ATIVIDADES POR USUÁRIO (#/producao/atividade_usuario).
 *
 * DUAS PERGUNTAS DIFERENTES, e por isso duas seções e duas chamadas:
 *
 *   AGORA      quem está com atividade aberta neste instante, em que subfase, em
 *              que lote e em que bloco (`/resumo_usuario`);
 *   NO ANO     em que dias cada pessoa teve alguma atividade aberta
 *              (`/atividade_usuario`), como faixa e não como total.
 *
 * AS DUAS CARREGAM SEPARADAS, cada uma com o próprio `catch`. Num `Promise.all`
 * uma falha derrubaria a tela inteira e a mensagem que sobraria seria a dela:
 * quem só queria saber quem está trabalhando agora perderia isso porque a linha
 * do tempo de um ano não voltou.
 *
 * A LINHA DO TEMPO É DO ANO CORRENTE, e o recorte é do servidor, não desta tela:
 * a consulta gera os dias de 1º de janeiro até hoje. Não há filtro de ano aqui
 * porque não há rota que aceite um.
 *
 * A SÉRIE É O `usuario_uuid`, e o nome é só rótulo. Até 2026-08-09 o servidor
 * agrupava por `posto || nome de guerra`, e dois homônimos de mesmo posto viravam
 * UMA barra com as faixas dos dois intercaladas. Agora a resposta traz
 * `usuario_uuid` e eles vêm em duas linhas -- duas linhas de mesmo nome nesta
 * tela são duas pessoas, e não um desenho repetido.
 *
 * @param {HTMLElement} container
 * @returns {Function} cleanup
 */
export function renderAtividadeUsuario(container) {
  let disposed = false;

  const areaResumo = el('div', { className: 'atividade-usuario__resumo' });
  const areaLinha = el('div', { className: 'atividade-usuario__linha' });
  const contagem = el('p', { className: 'atividade-usuario__contagem' });

  const tabela = createDataTable({
    columns: [
      { key: 'nome_abrev', label: 'Posto', sortable: true },
      { key: 'nome_usuario', label: 'Nome de guerra', sortable: true },
      {
        key: 'status_usuario',
        label: 'Situação',
        sortable: true,
        render: (linha) => chipDoStatus(linha.status_usuario),
      },
      { key: 'nome_subfase', label: 'Subfase', sortable: true },
      { key: 'nome_lote', label: 'Lote', sortable: true },
      { key: 'nome_bloco', label: 'Bloco', sortable: true },
    ],
    rows: [],
    searchable: true,
    pageSize: 25,
    loading: true,
    rowKey: (linha) => `u:${linha.usuario_uuid}`,
    emptyMessage: 'Nenhum usuário ativo cadastrado.',
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Atividades por usuário' }),
    ]),
    el('p', { className: 'page__subtitle' }, [
      'Quem está com atividade aberta agora, e em que dias do ano cada pessoa ',
      'esteve com alguma. O dia conta a ATIVIDADE ABERTA, e não o tempo ',
      'trabalhado nela: uma atividade iniciada e não finalizada ocupa todos os ',
      'dias até hoje.',
    ]),

    el('section', { className: 'atividade-usuario__secao' }, [
      el('h2', { className: 'atividade-usuario__titulo', textContent: 'Agora' }),
      contagem,
      areaResumo,
    ]),

    el('section', { className: 'atividade-usuario__secao' }, [
      el('h2', { className: 'atividade-usuario__titulo', textContent: `Ao longo de ${new Date().getFullYear()}` }),
      el('p', { className: 'atividade-usuario__nota', textContent: 'Cada faixa é um período contínuo com atividade aberta. O trecho claro é dia sem nenhuma.' }),
      areaLinha,
    ]),
  ]);

  areaResumo.appendChild(tabela.element);
  container.appendChild(page);

  // --- Agora ---------------------------------------------------------------

  async function carregarResumo() {
    clearChildren(areaResumo);
    areaResumo.appendChild(tabela.element);
    tabela.update({ loading: true });
    try {
      const linhas = await getResumoUsuario();
      if (disposed) return;
      const lista = linhas || [];
      tabela.update({ rows: lista, loading: false });
      const emAtividade = lista.filter(l => l.status_usuario === 'Em Atividade').length;
      const pausadas = lista.filter(l => l.status_usuario === 'Atividade Pausada').length;
      contagem.textContent = `${lista.length} pessoa(s) ativa(s): `
        + `${emAtividade} em atividade, ${pausadas} com atividade pausada, `
        + `${lista.length - emAtividade - pausadas} sem atividade aberta.`;
    } catch (err) {
      if (disposed) return;
      // O ERRO FICA NA SEÇÃO DELE. A linha do tempo abaixo continua viva, e a
      // tabela some inteira: mostrar a lista vazia ao lado do aviso faria
      // "não consegui perguntar" se ler como "ninguém está trabalhando".
      contagem.textContent = '';
      clearChildren(areaResumo);
      areaResumo.appendChild(estadoErro(err, carregarResumo));
    }
  }

  // --- Ao longo do ano -----------------------------------------------------

  /** A régua de meses sobre a barra, para a faixa ter onde se apoiar. */
  function reguaDeMeses(inicio, fim) {
    const marcas = [];
    const total = fim - inicio;
    const primeiro = new Date(inicio);
    let ano = primeiro.getUTCFullYear();
    let mes = primeiro.getUTCMonth();

    while (true) {
      const ms = Date.UTC(ano, mes, 1);
      if (ms >= fim) break;
      if (ms >= inicio) {
        marcas.push(el('span', {
          className: 'linha-tempo__marca',
          style: { left: `${((ms - inicio) / total) * 100}%` },
          textContent: MESES[mes],
        }));
      }
      mes += 1;
      if (mes > 11) { mes = 0; ano += 1; }
    }
    return el('div', { className: 'linha-tempo__regua' }, marcas);
  }

  function barraDaPessoa(linha, inicio, fim) {
    const total = fim - inicio;
    const { faixas } = faixasOcupadas(linha.data);
    const dias = faixas.reduce((soma, f) => soma + (f.fim - f.inicio) / DIA_MS, 0);
    const diasTotais = Math.round(total / DIA_MS);

    // O MESMO texto do rótulo visível: `linha.usuario` pode vir nulo, e o
    // leitor de tela anunciava "null: 10 de 220 dias" ao lado de um nome que a
    // tela escrevia como "Sem nome".
    const nome = linha.usuario || 'Sem nome';

    const barra = el('div', {
      className: 'linha-tempo__barra',
      role: 'img',
      'aria-label': `${nome}: ${dias} de ${diasTotais} dias com atividade aberta`,
    }, faixas.map(f => el('span', {
      className: 'linha-tempo__faixa',
      style: {
        left: `${((f.inicio - inicio) / total) * 100}%`,
        width: `${Math.max(((f.fim - f.inicio) / total) * 100, 0.4)}%`,
      },
      title: `${new Date(f.inicio).toISOString().slice(0, 10)} a `
        + `${new Date(f.fim - DIA_MS).toISOString().slice(0, 10)}`,
    })));

    return el('div', { className: 'linha-tempo__pessoa' }, [
      el('span', { className: 'linha-tempo__nome', textContent: nome }),
      barra,
      el('span', {
        className: 'linha-tempo__dias',
        textContent: `${dias} d`,
        title: `${dias} de ${diasTotais} dias do período com alguma atividade aberta`,
      }),
    ]);
  }

  function desenharLinhaDoTempo(linhas) {
    clearChildren(areaLinha);

    if (!linhas.length) {
      areaLinha.appendChild(el('p', {
        className: 'atividade-usuario__vazio',
        textContent: 'Ninguém teve atividade iniciada neste ano. A linha do tempo nasce da primeira atividade lançada.',
      }));
      return;
    }

    // O INTERVALO SAI DOS PRÓPRIOS DADOS, e não de "1º de janeiro até hoje"
    // calculado aqui. O recorte é do servidor, e uma régua montada por conta
    // própria passaria a mentir no dia em que a consulta mudasse de janela.
    let inicio = null;
    let fim = null;
    for (const linha of linhas) {
      const { min, max } = faixasOcupadas(linha.data);
      if (min != null && (inicio == null || min < inicio)) inicio = min;
      if (max != null && (fim == null || max > fim)) fim = max;
    }

    if (inicio == null || fim == null || fim <= inicio) {
      areaLinha.appendChild(el('p', {
        className: 'atividade-usuario__vazio',
        textContent: 'Não há período a desenhar: as faixas recebidas não cobrem nenhum dia.',
      }));
      return;
    }

    areaLinha.appendChild(el('div', { className: 'linha-tempo' }, [
      reguaDeMeses(inicio, fim),
      ...linhas.map(linha => barraDaPessoa(linha, inicio, fim)),
    ]));
  }

  async function carregarLinhaDoTempo() {
    clearChildren(areaLinha);
    areaLinha.appendChild(el('p', {
      className: 'atividade-usuario__vazio',
      textContent: 'Carregando a linha do tempo...',
    }));
    try {
      const linhas = await getAtividadeUsuario();
      if (disposed) return;
      desenharLinhaDoTempo(linhas || []);
    } catch (err) {
      if (disposed) return;
      clearChildren(areaLinha);
      areaLinha.appendChild(estadoErro(err, carregarLinhaDoTempo));
    }
  }

  carregarResumo();
  carregarLinhaDoTempo();

  return () => {
    disposed = true;
    if (tabela._cleanup) tabela._cleanup();
  };
}
