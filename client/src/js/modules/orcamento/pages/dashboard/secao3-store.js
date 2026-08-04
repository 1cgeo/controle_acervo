import { getExecucaoNd } from '@modules/orcamento/services/orcamento-service.js';
import { getAno } from '@modules/orcamento/store/year-store.js';

/**
 * Fonte unica da execucao por ND para as abas do dashboard do orcamento.
 *
 * Chamava-se "secao 3" porque a consulta era a tabela 3.1 do RPCMTec, servida
 * por /orcamento/relatorio/secao3. Em 2026-08-01 o RPCMTec saiu do modulo e
 * virou tela de plataforma, e esta consulta ficou como rota do PAINEL: sao
 * perguntas diferentes, para publicos diferentes. O nome do arquivo continua o
 * mesmo para nao espalhar a mudanca por seis arquivos de aba.
 *
 * As tres abas saem do MESMO payload (`getExecucaoNd`): os cards, o grafico por
 * ND e as duas tabelas sao recortes da mesma lista de linhas. Sem isto, trocar
 * de aba
 * refaria a consulta inteira para reexibir dado que ja estava na mao, e o
 * usuario pagaria um round-trip por clique de aba.
 *
 * O payload e { linhas, sem_data } desde 2026-08-04. Era a lista crua; o
 * `sem_data` entrou junto porque o registro sem data entra em TODOS os meses, e
 * so a contagem torna isso visivel (ver avisoSemData).
 *
 * A memoizacao e por (ano, mes) e guarda a PROMESSA, e nao o resultado: duas
 * abas montando ao mesmo tempo esperam a mesma requisicao em vez de disparar
 * duas. Trocar o mes ou o ano invalida, e ai a proxima leitura busca de novo.
 */
export function criarSecao3Store() {
  let mes = new Date().getMonth() + 1; // 1-12
  let chave = null;
  let promessa = null;

  /** @returns {number} mes de referencia (1 a 12) */
  function getMes() {
    return mes;
  }

  /** Troca o mes e invalida o que estava guardado. */
  function setMes(novo) {
    mes = novo;
    invalidar();
  }

  function invalidar() {
    chave = null;
    promessa = null;
  }

  /**
   * A secao 3 do ano de contexto, cumulativa ate o mes escolhido.
   * @returns {Promise<{linhas:Array<Object>, sem_data:Object}>}
   */
  function carregar() {
    const ano = getAno();
    const novaChave = `${ano}-${mes}`;
    if (novaChave !== chave) {
      chave = novaChave;
      // A promessa rejeitada NAO fica guardada: senao um erro de rede
      // congelaria o painel ate a proxima troca de mes.
      // Sem `cumulativo`: a rota do painel so responde a pergunta acumulada no
      // ano, que era a unica que esta tela ja fazia.
      promessa = getExecucaoNd({ ano, mes }).catch((err) => {
        invalidar();
        throw err;
      });
    }
    return promessa;
  }

  return { carregar, invalidar, getMes, setMes };
}

/**
 * As linhas por ND do payload.
 *
 * Aceita a lista crua tambem: o formato antigo da rota era um array, e o
 * fallback evita que uma versao velha do servidor esvazie o painel em silencio.
 *
 * @param {{linhas?:Array}|Array|null} payload
 * @returns {Array<Object>}
 */
export function getLinhas(payload) {
  if (Array.isArray(payload)) return payload;
  return (payload && Array.isArray(payload.linhas)) ? payload.linhas : [];
}

/** Rotulo de cada fluxo na frase do aviso. */
const FLUXO_SEM_DATA = {
  recebido: ['nota de crédito sem data de emissão', 'notas de crédito sem data de emissão'],
  empenhado: ['empenho sem data', 'empenhos sem data'],
  liquidado: ['liquidação sem data', 'liquidações sem data'],
};

/**
 * A frase que avisa quantos registros do ano nao tem data.
 *
 * O recorte do painel aceita `data IS NULL`, entao esses registros entram em
 * TODOS os meses. Sem o aviso, o painel de janeiro mostra o empenho de dezembro
 * e nada na tela diz isso. A regra do corte NAO muda: a decisao e do chefe, e o
 * aviso so devolve a ele a informacao para decidir.
 *
 * @param {{recebido?:number, empenhado?:number, liquidado?:number}|null} semData
 * @returns {string} vazio quando todo registro do ano tem data
 */
export function avisoSemData(semData) {
  if (!semData) return '';

  const partes = Object.keys(FLUXO_SEM_DATA)
    .map(fluxo => ({ fluxo, n: Number(semData[fluxo]) || 0 }))
    .filter(({ n }) => n > 0)
    .map(({ fluxo, n }) => `${n} ${FLUXO_SEM_DATA[fluxo][n === 1 ? 0 : 1]}`);

  if (partes.length === 0) return '';

  return `Atenção: ${partes.join(', ')}. Registro sem data entra em TODOS os meses do ano.`;
}

/** Localiza a linha TOTAL (ou agrega como fallback) da tabela 3.1. */
export function getTotalRow(rows) {
  const total = rows.find(r => String(r.cod_nd).toUpperCase() === 'TOTAL'
    || String(r.nd_nome).toUpperCase() === 'TOTAL');
  if (total) return total;

  const campos = ['previsto', 'recebido', 'recebido_pdr', 'recebido_extra',
    'recolhido', 'recolhido_pdr', 'recolhido_extra',
    'empenhado', 'empenhado_pdr', 'empenhado_extra',
    'liquidado', 'liquidado_pdr', 'liquidado_extra'];
  return rows.reduce((acc, r) => {
    for (const k of campos) acc[k] += Number(r[k] || 0);
    return acc;
  }, Object.fromEntries(campos.map(k => [k, 0])));
}

/** Linhas de ND, sem a linha TOTAL (que o grafico nao deve plotar). */
export function semTotal(rows) {
  return rows.filter(r => String(r.cod_nd).toUpperCase() !== 'TOTAL'
    && String(r.nd_nome).toUpperCase() !== 'TOTAL');
}
