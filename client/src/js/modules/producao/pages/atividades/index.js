import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDateTime, formatNumber } from '@utils/format.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createTabs } from '@components/tabs/tabs.js';
import { mostrarErro } from '@components/estado-erro.js';
import {
  getAtividadesEmExecucao, getUltimasAtividadesFinalizadas,
} from '@services/producao-service.js';
import './atividades.css';

/**
 * O `interval` do PostgreSQL em texto de gente.
 *
 * O pg-promise entrega `CURRENT_TIMESTAMP - a.data_inicio` como OBJETO, com só
 * as unidades que existem: `{ days: 1, hours: 3 }`. O que chega pelo JSON não
 * tem `toString` útil -- `String(objeto)` viraria "[object Object]" na célula,
 * que foi o que motivou esta função existir em vez de um `render` de uma linha.
 *
 * SEGUNDOS SÓ APARECEM QUANDO SÃO A ÚNICA UNIDADE. Numa atividade de três dias,
 * "3 d 4 h 12 min 7 s" não diz nada que "3 d 4 h 12 min" já não diga, e o campo
 * fica largo à toa numa tabela de dez colunas.
 *
 * @param {Object|string|null} duracao
 * @returns {string}
 */
export function duracaoTexto(duracao) {
  if (!duracao) return '-';
  // Texto cru (um `interval` já formatado, ou um ISO-8601) volta como veio: é
  // melhor mostrar o que o servidor disse do que apagá-lo por não reconhecer.
  if (typeof duracao === 'string') return duracao;
  if (typeof duracao !== 'object') return '-';

  const anos = Number(duracao.years) || 0;
  const meses = Number(duracao.months) || 0;
  const dias = (Number(duracao.days) || 0) + anos * 365 + meses * 30;
  const horas = Number(duracao.hours) || 0;
  const minutos = Number(duracao.minutes) || 0;
  const segundos = Math.floor(Number(duracao.seconds) || 0);

  const partes = [];
  if (dias) partes.push(`${dias} d`);
  if (horas) partes.push(`${horas} h`);
  if (minutos) partes.push(`${minutos} min`);
  if (!partes.length) return `${segundos} s`;
  return partes.join(' ');
}

/**
 * Quanto tempo a atividade LEVOU, do início ao fim, medido no cliente.
 *
 * O `duracao` do servidor NÃO SERVE para a lista de finalizadas, e a razão está
 * na consulta: as duas listas compartilham o mesmo SQL, e ele calcula
 * `CURRENT_TIMESTAMP - a.data_inicio`. Para a atividade aberta isso é exatamente
 * "há quanto tempo ela está rodando"; para a fechada, é "há quanto tempo ela
 * COMEÇOU", que numa tabela intitulada "Duração" mentiria: uma atividade de dez
 * minutos, iniciada há uma semana, apareceria com sete dias.
 *
 * @param {string} inicio
 * @param {string} fim
 * @returns {string}
 */
export function duracaoEntre(inicio, fim) {
  if (!inicio || !fim) return '-';
  const ms = new Date(fim).getTime() - new Date(inicio).getTime();
  if (!Number.isFinite(ms) || ms < 0) return '-';
  const totalMinutos = Math.floor(ms / 60000);
  return duracaoTexto({
    days: Math.floor(totalMinutos / 1440),
    hours: Math.floor((totalMinutos % 1440) / 60),
    minutes: totalMinutos % 60,
    seconds: Math.floor(ms / 1000) % 60,
  });
}

/** As colunas que as duas listas têm em comum, na ordem do SAP. */
const COLUNAS_COMUNS = [
  { key: 'projeto_nome', label: 'Projeto', sortable: true, className: 'data-table__cell--truncate' },
  { key: 'lote', label: 'Lote', sortable: true, className: 'data-table__cell--truncate' },
  { key: 'bloco', label: 'Bloco', sortable: true, render: (r) => r.bloco || '-' },
  { key: 'fase_nome', label: 'Fase', sortable: true },
  { key: 'subfase_nome', label: 'Subfase', sortable: true },
  { key: 'etapa_nome', label: 'Etapa', sortable: true },
  {
    key: 'unidade_trabalho_nome',
    label: 'Unidade de trabalho',
    sortable: true,
    className: 'data-table__cell--truncate',
    render: (r) => r.unidade_trabalho_nome || `#${r.unidade_trabalho_id}`,
  },
  { key: 'usuario', label: 'Usuário', sortable: true },
];

/**
 * Uma das duas listas: a tabela, a contagem, o estado de erro e a recarga.
 *
 * As duas abas leem as MESMAS dez junções do servidor e diferem só nas colunas
 * de tempo. Uma fábrica, e não duas cópias: duas cópias divergiriam na primeira
 * coluna que alguém acrescentasse a uma delas -- que é, aliás, exatamente a
 * razão pela qual o SQL do servidor também é um só.
 *
 * @param {{colunas:Array, buscar:Function, vazio:string, contar:Function,
 *   ordem:Object}} opcoes
 */
function criarLista({ colunas, buscar, vazio, contar, ordem }) {
  let disposed = false;

  const resumo = el('p', { className: 'producao-atividades__resumo', textContent: '' });

  const tabela = createDataTable({
    columns: colunas,
    rows: [],
    searchable: true,
    pageSize: 25,
    defaultSort: ordem,
    emptyMessage: vazio,
    loading: true,
  });

  // O corpo vive num nó próprio para o estado de erro poder tomar o lugar dele e
  // devolvê-lo no "Tentar de novo" (ver `mostrarErro`).
  const corpo = el('div', {}, [resumo, tabela.element]);

  async function carregar() {
    tabela.update({ loading: true });
    let dados;
    try {
      dados = await buscar();
    } catch (err) {
      if (disposed) return;
      resumo.textContent = '';
      tabela.update({ rows: [], loading: false });
      mostrarErro(corpo, err, carregar);
      return;
    }
    if (disposed) return;
    const linhas = Array.isArray(dados) ? dados : [];
    resumo.textContent = contar(linhas.length);
    tabela.update({ rows: linhas, loading: false });
  }

  return {
    element: corpo,
    carregar,
    cleanup: () => {
      disposed = true;
      tabela._cleanup();
    },
  };
}

/**
 * ATIVIDADES (#/producao/atividades): o que está aberto agora e o que fechou por
 * último.
 *
 * DUAS ABAS, E NÃO DUAS TABELAS EMPILHADAS. O SAP punha as duas uma sob a outra,
 * e a segunda quase nunca cabia na tela junto da primeira. Aqui elas são abas
 * porque a pergunta é uma de cada vez ("quem está trabalhando?" ou "o que saiu
 * ontem?"), e porque a aba fechada não paga a viagem ao banco -- só a ativa
 * busca.
 *
 * CADA ABA CARREGA SOZINHA, com o próprio `catch` e o próprio "Tentar de novo".
 * As duas rotas são a mesma guarda (`consulta` em `producao`), mas a regra da
 * casa vale igual: uma falha não pode apagar a outra lista da tela.
 *
 * AS VINTE ÚLTIMAS SÃO O LIMITE DO SERVIDOR, e não um recorte do cliente. A tela
 * diz isso em voz alta, porque uma lista de 20 sem aviso se lê como "só houve
 * 20 finalizações".
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} [_ctx]
 * @returns {Promise<Function>} cleanup
 */
export async function renderAtividades(container, _ctx) {
  let lista = null;

  // A MONTAGEM ESPERA A CARGA de propósito: `createTabs` faz `await
  // tab.render(...)`, então `abas.ready` só resolve com a tabela já pintada. Sem
  // o `await`, quem espera o `ready` (a página, um teste) veria a aba montada e
  // vazia, e teria de adivinhar quantos ciclos faltam.
  const montar = async (destino, config) => {
    lista = criarLista(config);
    destino.appendChild(lista.element);
    await lista.carregar();
    return {
      cleanup: lista.cleanup,
      // `refresh` recarrega no lugar, sem remontar o DOM: é o que o botão
      // "Atualizar" do cabeçalho dispara, e ele não deve perder a ordenação nem
      // a busca que a pessoa digitou.
      refresh: () => lista.carregar(),
    };
  };

  const abas = createTabs({
    tabs: [
      {
        id: 'execucao',
        label: 'Em execução',
        render: (destino) => montar(destino, {
          colunas: [
            ...COLUNAS_COMUNS,
            {
              key: 'data_inicio',
              label: 'Início',
              sortable: true,
              render: (r) => formatDateTime(r.data_inicio),
            },
            {
              key: 'duracao',
              label: 'Há',
              sortable: true,
              // ORDENAR PELO INÍCIO, e não pelo texto da duração: "3 d" viria
              // antes de "20 h" numa comparação de string. Mais antigo primeiro
              // é mais tempo aberto.
              sortValue: (r) => r.data_inicio,
              render: (r) => duracaoTexto(r.duracao),
            },
          ],
          buscar: getAtividadesEmExecucao,
          vazio: 'Não há atividade em execução no momento',
          contar: (n) => (n === 1
            ? '1 atividade em execução agora.'
            : `${formatNumber(n)} atividades em execução agora.`),
          // A LISTA JÁ VEM ORDENADA pelo início ascendente (a mais antiga em
          // cima, que é a que pede atenção). O `defaultSort` repete essa ordem
          // para que reordenar por outra coluna e voltar não perca o critério.
          ordem: { key: 'data_inicio', dir: 'asc' },
        }),
      },
      {
        id: 'finalizadas',
        label: 'Últimas finalizadas',
        render: (destino) => montar(destino, {
          colunas: [
            ...COLUNAS_COMUNS,
            {
              key: 'data_inicio',
              label: 'Início',
              sortable: true,
              render: (r) => formatDateTime(r.data_inicio),
            },
            {
              key: 'data_fim',
              label: 'Fim',
              sortable: true,
              render: (r) => formatDateTime(r.data_fim),
            },
            {
              key: 'duracao_real',
              label: 'Duração',
              sortable: true,
              sortValue: (r) => (r.data_inicio && r.data_fim
                ? new Date(r.data_fim).getTime() - new Date(r.data_inicio).getTime()
                : null),
              render: (r) => duracaoEntre(r.data_inicio, r.data_fim),
            },
          ],
          buscar: getUltimasAtividadesFinalizadas,
          vazio: 'Nenhuma atividade finalizada recentemente',
          // O ZERO TEM FRASE PRÓPRIA: "As 0 últimas atividades finalizadas, da
          // mais recente para a mais antiga" fala de uma ordem que não existe,
          // logo acima de uma tabela que já diz que não há nada. E ela NÃO
          // repete o estado vazio: o `vazio` da tabela, dois centímetros abaixo,
          // já escreve "Nenhuma atividade finalizada recentemente" com essas
          // palavras. O que só o resumo diz é a régua do limite.
          contar: (n) => {
            if (n === 0) return 'A lista traz as 20 últimas finalizadas, e o limite é do servidor.';
            return n === 1
              ? '1 atividade finalizada, da mais recente para a mais antiga.'
              : `As ${formatNumber(n)} últimas atividades finalizadas, da mais recente para a mais `
                + 'antiga. O limite de 20 é do servidor.';
          },
          ordem: { key: 'data_fim', dir: 'desc' },
        }),
      },
    ],
  });

  const botaoAtualizar = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => abas.refreshActive(),
  }, [svgIcon(ICONS.schedule, 16), 'Atualizar']);

  const page = el('div', { className: 'page producao-atividades' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Atividades' }),
      el('div', { className: 'page__actions' }, [botaoAtualizar]),
    ]),
    abas.element,
  ]);
  container.appendChild(page);

  await abas.ready;

  return () => {
    abas._cleanup();
  };
}
