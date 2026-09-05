import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A FICHA DA NOTA DE CREDITO, e o motivo de ela existir.
//
// Seis campos da NC (`ptres`, `fonte`, `cod_pi`, `doc_ro`, `finalidade_historico`
// e `observacao`) so apareciam no dialogo de EDICAO, que a lista esconde atras de
// `pode.operador`. Medido em 2026-08-08, a UNICA pessoa com perfil no modulo
// orcamento e de CONSULTA: na pratica esses campos eram invisiveis para quem usa
// o sistema.
//
// Por isso todo teste daqui monta a tela com perfil de CONSULTA. Um teste que
// logasse como gerente passaria sem provar nada: o gerente sempre pode abrir o
// dialogo de edicao, que e justamente o caminho que nao existia.

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotaCredito: vi.fn(),
  getNotasCredito: vi.fn(),
  getRecolhimentos: vi.fn(),
  getNotasEmpenho: vi.fn(),
  // O widget de anexo, que a ficha monta.
  getArquivos: vi.fn(() => Promise.resolve([])),
  uploadArquivo: vi.fn(() => Promise.resolve([])),
  downloadArquivo: vi.fn(() => Promise.resolve()),
  deleteArquivo: vi.fn(() => Promise.resolve()),
  // O dialogo de recolhimentos, importado pelo botao de gerenciar.
  deleteRecolhimento: vi.fn(() => Promise.resolve()),
  getNaturezaDespesa: vi.fn(() => Promise.resolve([])),
  getUg: vi.fn(() => Promise.resolve([])),
  createRecolhimento: vi.fn(() => Promise.resolve({})),
  updateRecolhimento: vi.fn(() => Promise.resolve({})),
  getRecolhimento: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: vi.fn(() => ({
    element: document.createElement('div'),
    recarregar: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
}));

import { renderNotaCreditoDetails } from '@modules/orcamento/pages/notas-credito/details.js';
import {
  getNotaCredito, getNotasCredito, getRecolhimentos, getNotasEmpenho,
} from '@modules/orcamento/services/orcamento-service.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';

// Os seis campos que a ficha existe para revelar, com o rotulo da tela e o valor
// que tem de sair nela.
const CAMPOS_INVISIVEIS = [
  ['PTRES', '232039'],
  ['Fonte', '1000000000'],
  // O PI sai com o codigo E o nome, como em toda tela do modulo.
  ['Plano interno (PI)', 'CTLEV - CT LEVANT'],
  ['Documento RO', '2026RO000123'],
  ['Finalidade / histórico', 'Aquisição de suprimentos de plotagem'],
  ['Observação', 'Crédito recebido fora do PDR'],
];

const NC = {
  id: 7,
  numero: '2026NC400134',
  ano: 2026,
  data_emissao: '2026-03-04',
  cod_nd: '339039',
  nd_nome: 'Serviços de terceiros - pessoa jurídica',
  ptres: '232039',
  fonte: '1000000000',
  cod_pi: 'CTLEV',
  pi_nome: 'CT LEVANT',
  ug_emitente: '160089',
  ug_nome: 'DSG',
  finalidade_historico: 'Aquisição de suprimentos de plotagem',
  valor_nc: '50000.00',
  valor_recolhido: '1500.00',
  doc_ro: '2026RO000123',
  prazo_empenho: '2026-11-30',
  classificacao_id: 2,
  classificacao_nome: 'Extra-PDR',
  pdr_item_id: null,
  nc_complementada_id: null,
  observacao: 'Crédito recebido fora do PDR',
  data_cadastramento: '2026-06-15T10:00:00Z',
  data_modificacao: null,
};

// A linha da MESMA NC na listagem do ano: e de la que saem o empenhado e o
// saldo, calculados pelo servidor.
const LINHA_DA_LISTA = {
  id: 7,
  numero: '2026NC400134',
  valor_nc: '50000.00',
  valor_recolhido: '1500.00',
  empenhado: '30000.00',
  saldo: '18500.00',
};

const RECOLHIMENTOS = [
  {
    id: 1,
    numero: '2026NC401536',
    ano: 2026,
    data_emissao: '2026-07-02',
    cod_nd: '339039',
    valor: '1500.00',
    qtd_anexos: 1,
  },
];

const EMPENHOS = [
  {
    id: 42,
    numero: '2026NE000191',
    ano: 2026,
    data_empenho: '2026-04-10',
    finalidade: 'Plotagem',
    valor_empenhado: '30000.00',
    valor_anulado: '0.00',
    total_liquidado: '12000.00',
    qtd_nc: 1,
  },
];

/**
 * O valor da linha de cartao cujo rotulo e exatamente este.
 *
 * O espaco de `formatCurrency` e NAO SEPARAVEL (U+00A0), porque quem formata e o
 * Intl do navegador. Comparar com o espaco comum do fonte falha por um caractere
 * invisivel, entao a leitura normaliza.
 */
function valorDaLinha(container, rotulo) {
  const linha = [...container.querySelectorAll('.detail-card__row')]
    .find(l => l.querySelector('.detail-card__label')?.textContent === rotulo);
  if (!linha) return null;
  return linha.querySelector('.detail-card__value').textContent.replace(/\s/g, ' ');
}

async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderNotaCreditoDetails(container, { params: { id: '7' } });
  await flush();
  return { container, cleanup };
}

beforeEach(() => {
  // PERFIL DE CONSULTA (code 1 em dominio.tipo_perfil). E o unico perfil
  // concedido no modulo hoje, e o que nao alcancava campo nenhum.
  saveAuth({ token: 't', administrador: false, uuid: 'u-1', perfis: { orcamento: 1 } }, 'fulano');
  getNotaCredito.mockImplementation(() => Promise.resolve({ ...NC }));
  getNotasCredito.mockImplementation(() => Promise.resolve([{ ...LINHA_DA_LISTA }]));
  getRecolhimentos.mockImplementation(() => Promise.resolve([...RECOLHIMENTOS]));
  getNotasEmpenho.mockImplementation(() => Promise.resolve([...EMPENHOS]));
});

afterEach(() => {
  clearAuth();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('ficha da NC: o que o perfil de consulta passa a ver', () => {
  test.each(CAMPOS_INVISIVEIS)('mostra %s', async (rotulo, valor) => {
    const { container, cleanup } = await montar();

    expect(valorDaLinha(container, rotulo)).toBe(valor);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a ficha abre inteira para quem so consulta', async () => {
    const { container, cleanup } = await montar();

    expect(getNotaCredito).toHaveBeenCalledWith(7);
    expect(container.querySelector('.page__title').textContent)
      .toBe('Nota de crédito 2026NC400134');
    // Nenhum botao de escrita: gerenciar recolhimentos e de operador.
    expect(container.textContent).not.toContain('Gerenciar recolhimentos');

    if (typeof cleanup === 'function') cleanup();
  });

  // "VOLTAR" LEVA O ANO DA NC. A lista abre sempre no ano corrente, entao sair
  // da ficha de uma NC de 2025 devolvia a lista de 2026, onde ela nem aparece.
  test('"Voltar" leva o ano da NC, e não o ano corrente', async () => {
    getNotaCredito.mockImplementation(() => Promise.resolve({ ...NC, ano: 2025 }));
    const { container, cleanup } = await montar();

    location.hash = '/orcamento/notas_credito/7';
    [...container.querySelectorAll('.page__header .btn')]
      .find(b => b.textContent.includes('Voltar')).click();

    expect(location.hash).toBe('#/orcamento/notas_credito?ano=2025');

    if (typeof cleanup === 'function') cleanup();
  });

  // O SALDO E O EMPENHADO VEM DO SERVIDOR, pela listagem do ano: `GET
  // /notas_credito/:id` nao os traz, e refazer a conta na tela abriria a porta
  // para a ficha prometer credito que o servidor recusa.
  test('empenhado e saldo saem da listagem do ano, e nao de conta na tela', async () => {
    const { container, cleanup } = await montar();

    expect(getNotasCredito).toHaveBeenCalledWith({ ano: 2026 });
    expect(valorDaLinha(container, 'Empenhado')).toBe('R$ 30.000,00');
    expect(valorDaLinha(container, 'Saldo')).toBe('R$ 18.500,00');

    if (typeof cleanup === 'function') cleanup();
  });

  test('sem a listagem do ano as duas linhas somem, em vez de mentir', async () => {
    getNotasCredito.mockImplementation(() => Promise.reject(new Error('sem rede')));
    const { container, cleanup } = await montar();

    const linhaSaldo = [...container.querySelectorAll('.detail-card__row')]
      .find(l => l.querySelector('.detail-card__label')?.textContent === 'Saldo');
    expect(linhaSaldo.style.display).toBe('none');
    // O que a propria NC traz continua na tela.
    expect(valorDaLinha(container, 'Valor da NC')).toBe('R$ 50.000,00');

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('ficha da NC: o que se pendura nela', () => {
  test('lista os recolhimentos da NC', async () => {
    const { container, cleanup } = await montar();

    expect(getRecolhimentos).toHaveBeenCalledWith({ nota_credito_id: 7 });
    expect(container.textContent).toContain('2026NC401536');

    if (typeof cleanup === 'function') cleanup();
  });

  test('lista as NEs que empenham contra a NC', async () => {
    const { container, cleanup } = await montar();

    expect(getNotasEmpenho).toHaveBeenCalledWith({ nota_credito_id: 7 });
    expect(container.textContent).toContain('2026NE000191');

    if (typeof cleanup === 'function') cleanup();
  });

  // A NE de rateio traz o valor DELA INTEIRA, e nao a fatia desta NC. Sem a
  // marca, somar a coluna de cabeca daria um empenhado maior que o do cartao.
  test('a NE de rateio sai marcada', async () => {
    getNotasEmpenho.mockImplementation(() => Promise.resolve([
      { ...EMPENHOS[0], qtd_nc: 2 },
    ]));
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('2026NE000191 (rateio)');

    if (typeof cleanup === 'function') cleanup();
  });

  test('uma lista que falha nao derruba a ficha', async () => {
    getNotasEmpenho.mockImplementation(() => Promise.reject(new Error('sem rede')));
    const { container, cleanup } = await montar();

    expect(container.querySelector('.page__title').textContent)
      .toBe('Nota de crédito 2026NC400134');
    expect(container.textContent).toContain('Nenhum empenho lançado contra esta nota de crédito');

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('ficha da NC: quem pode lançar recolhimento', () => {
  test('o operador ganha o botao de gerenciar recolhimentos', async () => {
    saveAuth({ token: 't', administrador: false, uuid: 'u-2', perfis: { orcamento: 2 } }, 'beltrano');
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Gerenciar recolhimentos');

    if (typeof cleanup === 'function') cleanup();
  });
});
