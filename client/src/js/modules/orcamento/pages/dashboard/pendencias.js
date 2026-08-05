import { el, svgIcon, ICONS } from '@utils/dom.js';

/**
 * Anos cuja carga veio do RPCATec, e nao de documento individual.
 *
 * PONTO UNICO do numero magico, e o motivo por escrito. 2025 foi carregado a
 * partir do RPCATec, entao as datas nao existem em fonte nenhuma: 51 de 51 NCs,
 * 51 de 51 NEs e 37 de 37 liquidacoes ficaram sem data, e nenhuma acao humana
 * leva isso a zero. Cobrar zero num ano assim ensina o usuario a ignorar o
 * painel inteiro.
 *
 * Vale so para as pendencias de DATA. As demais (RPNP sem valor, NC sem meta)
 * continuam sendo pendencia de verdade em 2025, porque tem conserto.
 *
 * O alvo de ZERO vale para 2026 em diante.
 */
const ANOS_CARGA_HISTORICA = new Set([2025]);

const NOTA_CARGA_HISTORICA = 'exercício carregado do RPCATec, sem documento individual';

/**
 * As pendencias medidas, na ordem em que o chefe as listou.
 *
 * `deData` marca a pendencia que a carga historica explica. `rota` leva a lista
 * onde o conserto se faz; a liquidacao nao tem lista propria (ela vive na ficha
 * de uma NE), entao fica sem link.
 */
export const PENDENCIAS = [
  {
    chave: 'ne_sem_data',
    rotulo: 'Empenhos sem data de empenho',
    deData: true,
    rota: '#/orcamento/notas_empenho',
    destino: 'Empenhos',
  },
  {
    chave: 'liquidacao_sem_data',
    rotulo: 'Liquidações sem data',
    deData: true,
    rota: null,
  },
  {
    chave: 'nc_sem_data',
    rotulo: 'Notas de crédito sem data de emissão',
    deData: true,
    rota: '#/orcamento/notas_credito',
    destino: 'Notas de Crédito',
  },
  {
    chave: 'rpnp_sem_valor',
    rotulo: 'RPNP sem valor a liquidar',
    deData: false,
    rota: '#/orcamento/rpnp',
    destino: 'RPNP',
  },
  {
    chave: 'nc_sem_meta',
    rotulo: 'Notas de crédito sem meta do PIT',
    deData: false,
    rota: '#/orcamento/notas_credito',
    destino: 'Notas de Crédito',
  },
  {
    chave: 'nc_prazo_vencido',
    rotulo: 'Notas de crédito com prazo de empenho vencido e saldo aberto',
    deData: false,
    rota: '#/orcamento/notas_credito',
    destino: 'Notas de Crédito',
  },
];

/**
 * As linhas do bloco: so as pendencias que existem no ano.
 *
 * A pendencia zerada NAO vira linha. O bloco e uma lista de acoes a fazer, e
 * seis linhas com zero afogariam as duas que pedem trabalho. O ano sem
 * pendencia nenhuma devolve lista vazia, e o bloco diz que esta tudo em ordem
 * (ver criarBlocoPendencias).
 *
 * @param {Object<string, {n:number, total:number}>|null} pendencias
 * @param {number} ano
 * @returns {Array<{chave:string, rotulo:string, n:number, total:number,
 *   tom:'alerta'|'neutro', nota:string, rota:?string, destino:?string}>}
 */
export function montarPendencias(pendencias, ano) {
  if (!pendencias) return [];

  const cargaHistorica = ANOS_CARGA_HISTORICA.has(Number(ano));

  return PENDENCIAS
    .map((p) => {
      const medida = pendencias[p.chave] || {};
      const neutra = cargaHistorica && p.deData;
      return {
        chave: p.chave,
        rotulo: p.rotulo,
        n: Number(medida.n) || 0,
        total: Number(medida.total) || 0,
        tom: neutra ? 'neutro' : 'alerta',
        nota: neutra ? NOTA_CARGA_HISTORICA : '',
        rota: p.rota || null,
        destino: p.destino || null,
      };
    })
    .filter((p) => p.n > 0);
}

const CHIP_DO_TOM = {
  alerta: 'chip chip--warning',
  neutro: 'chip chip--default',
};

/** Uma linha do bloco: rotulo, contagem e o link para a lista, quando ha. */
function linha(p) {
  const esquerda = el('div', { style: { display: 'flex', flexDirection: 'column', gap: '2px' } }, [
    el('span', { textContent: p.rotulo }),
    p.nota
      ? el('span', {
        className: 'dashboard__escopo',
        textContent: p.nota,
        style: { margin: '0' },
      })
      : null,
  ].filter(Boolean));

  const direita = el('div', {
    style: { display: 'flex', alignItems: 'center', gap: '12px' },
  }, [
    el('span', {
      className: CHIP_DO_TOM[p.tom],
      textContent: p.total > 0 ? `${p.n} de ${p.total}` : String(p.n),
    }),
    // O link leva a TELA, e nao a um recorte dela: nenhuma lista do orcamento
    // aceita filtro por URL hoje. Prometer "ja filtrada" no rotulo seria mentir.
    p.rota
      ? el('a', {
        href: p.rota,
        textContent: `Abrir ${p.destino}`,
        style: { fontSize: 'var(--font-size-sm)', whiteSpace: 'nowrap' },
      })
      : null,
  ].filter(Boolean));

  return el('li', {
    style: {
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'space-between',
      gap: '16px',
      flexWrap: 'wrap',
      padding: '8px 0',
      borderBottom: '1px solid var(--border-color)',
    },
  }, [esquerda, direita]);
}

/**
 * Bloco de pendencias de dado do ano.
 *
 * Existia so um aviso de uma linha sobre registro sem data. O chefe quer os
 * defeitos de dado A VISTA, para chamar a acao: uma linha por
 * pendencia, com a contagem e o caminho do conserto.
 *
 * O bloco NAO some quando zera. Bloco que desaparece faz o usuario duvidar se
 * ele existiu, e "nao vi pendencia" e diferente de "nao ha pendencia".
 *
 * @returns {{element:HTMLElement, update:Function, esconder:Function}}
 */
export function criarBlocoPendencias() {
  const titulo = el('h2', {
    className: 'dashboard-cards-group__title',
    textContent: 'Pendências de dado',
    style: { margin: '0' },
  });

  const resumo = el('span', {
    className: 'dashboard-section__meta',
    style: { marginLeft: 'auto' },
  });

  const lista = el('ul', {
    className: 'pendencias__lista',
    style: { listStyle: 'none', margin: '0', padding: '0' },
  });

  const element = el('section', {
    className: 'pendencias',
    'aria-label': 'Pendências de dado',
    style: {
      border: '1px solid var(--border-color)',
      borderRadius: 'var(--radius-md, 8px)',
      padding: 'var(--space-md, 16px)',
      marginBottom: 'var(--space-md, 16px)',
    },
  }, [
    el('div', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '8px' },
    }, [titulo, resumo]),
    lista,
  ]);

  /** Estado "tudo em ordem": o bloco fica, e diz que nao ha o que consertar. */
  function emOrdem() {
    return el('li', {
      style: { display: 'flex', alignItems: 'center', gap: '8px', padding: '8px 0' },
    }, [
      svgIcon(ICONS.checkCircle, 18),
      el('span', { textContent: 'Nenhuma pendência de dado neste ano.' }),
    ]);
  }

  /**
   * @param {Object<string, {n:number, total:number}>|null} pendencias
   * @param {number} ano
   */
  function update(pendencias, ano) {
    element.classList.remove('hidden');
    const linhas = montarPendencias(pendencias, ano);
    resumo.textContent = linhas.length > 0
      ? `${linhas.length} de ${PENDENCIAS.length} medidas com pendência`
      : '';
    lista.replaceChildren(...(linhas.length > 0 ? linhas.map(linha) : [emOrdem()]));
  }

  /** A falha de carga ja tem dono: o estado de erro da aba ativa. */
  function esconder() {
    element.classList.add('hidden');
  }

  return { element, update, esconder };
}
