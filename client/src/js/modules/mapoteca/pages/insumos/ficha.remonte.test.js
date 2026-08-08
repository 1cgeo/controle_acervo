import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O que esta tela NAO pode fazer: jogar a pagina fora a cada carga.
//
// O chefe mediu o defeito: "quando edita a UI reconstroi, que torna muito chato
// ficar editando pois a tela fica se movendo". A causa era o `load()` recriar
// tudo, inclusive as tabelas.
//
// Estes testes provam a IDENTIDADE do no (toBe), e nao o texto na tela. Repintar
// tudo tambem acerta o texto, e perde no caminho a ordenacao, a pagina atual e o
// foco do teclado. O gatilho de recarga usado aqui e a troca de ano no filtro do
// livro, que e tambem o que a ficha recarrega depois de cada lancamento.

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderInsumoFicha } from '@modules/mapoteca/pages/insumos/ficha.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, OPERADOR } from '@/__tests__/helpers/sessao.js';

// O filtro e desta tela e abre no ano ATUAL.
const ANO_ATUAL = new Date().getFullYear();
const ANO_ANTERIOR = ANO_ATUAL - 1;

/** O select de ANO: o primeiro da barra de controle do livro. */
const filtroAno = (container) => container.querySelector('.export-bar select');

/** Troca o ano. E o gatilho de recarga da ficha. */
async function trocarAno(container, ano) {
  const select = filtroAno(container);
  select.value = String(ano);
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
}

const MATERIAL = {
  id: 1,
  nome: 'Papel A0',
  descricao: 'Bobina de papel',
  ativo: true,
  estoque_minimo: 20,
  estoque: {
    total: 52,
    disponivel: 12,
    localizacoes: 2,
    registros: [
      {
        id: 11, localizacao_id: 1, localizacao_nome: 'Seção', quantidade: 12,
        data_atualizacao: '2026-06-01T10:00:00Z',
      },
      {
        id: 12, localizacao_id: 2, localizacao_nome: 'Almoxarifado', quantidade: 40,
        data_atualizacao: '2026-06-02T10:00:00Z',
      },
    ],
  },
  movimentos: { registros_recentes: [] },
  consumo: { total_consumido: 88, ultimo_consumo: '2026-06-05', total_registros: 3 },
};

const LIVRO = [
  {
    id: 21, tipo_movimento_id: 3, tipo_movimento_nome: 'Consumo',
    quantidade: 3, data_movimento: '2026-06-05',
    localizacao_origem_id: 1, localizacao_origem_nome: 'Seção',
    localizacao_destino_id: null, localizacao_destino_nome: null,
    motivo: null, usuario_criacao_nome: 'Sd Silva',
  },
];

/** A pagina precisa estar no documento: sem isso o foco do teclado nao existe. */
function novoContainer() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  return container;
}

/** A secao pelo titulo. Evita casar com a tabela do historico. */
function secao(container, titulo) {
  return [...container.querySelectorAll('.dashboard-section')]
    .find(s => {
      const h = s.querySelector('.dashboard-section__title');
      return h && h.textContent === titulo;
    });
}

const tabelaDe = (container, titulo) => secao(container, titulo).querySelector('.data-table-wrapper');

const cabecalho = (secaoEl, rotulo) =>
  [...secaoEl.querySelectorAll('th')].find(th => th.textContent.includes(rotulo));

async function montar() {
  const container = novoContainer();
  const cleanup = await renderInsumoFicha(container, {
    params: { id: '1' },
    query: new URLSearchParams(),
  });
  await flush();
  return { container, cleanup };
}

describe('renderInsumoFicha, o que sobrevive a uma recarga', () => {
  beforeEach(() => {
    logarComo({ mapoteca: OPERADOR });
    svc.getTipoMaterial.mockResolvedValue(MATERIAL);
    svc.getMovimentosMaterial.mockResolvedValue(LIVRO);
    svc.getConsumoMensal.mockResolvedValue([]);
    svc.getAnosMapoteca.mockResolvedValue([ANO_ATUAL, ANO_ANTERIOR]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('a ficha abre no ano ATUAL e trocar o ano recarrega as tres buscas', async () => {
    const { container, cleanup } = await montar();

    expect(filtroAno(container).value).toBe(String(ANO_ATUAL));

    await trocarAno(container, ANO_ANTERIOR);

    expect(svc.getConsumoMensal).toHaveBeenLastCalledWith(ANO_ANTERIOR);
    expect(svc.getMovimentosMaterial).toHaveBeenLastCalledWith({
      tipo_material_id: 1,
      data_inicio: `${ANO_ANTERIOR}-01-01`,
      data_fim: `${ANO_ANTERIOR}-12-31`,
    });
    expect(svc.getTipoMaterial).toHaveBeenLastCalledWith(1);
    cleanup();
  });

  test('a raiz da pagina e a MESMA depois da recarga', async () => {
    const { container, cleanup } = await montar();
    const paginaAntes = container.querySelector('.page');

    await trocarAno(container, ANO_ANTERIOR);

    expect(container.querySelector('.page')).toBe(paginaAntes);
    cleanup();
  });

  test('as duas tabelas sao as MESMAS depois da recarga', async () => {
    const { container, cleanup } = await montar();
    const estoqueAntes = tabelaDe(container, 'Estoque por localização');
    const livroAntes = tabelaDe(container, 'Livro de movimentos');

    await trocarAno(container, ANO_ANTERIOR);

    expect(tabelaDe(container, 'Estoque por localização')).toBe(estoqueAntes);
    expect(tabelaDe(container, 'Livro de movimentos')).toBe(livroAntes);
    cleanup();
  });

  test('a ordenacao escolhida sobrevive a recarga', async () => {
    const { container, cleanup } = await montar();
    const estoque = secao(container, 'Estoque por localização');
    cabecalho(estoque, 'Quantidade').click();
    expect(cabecalho(estoque, 'Quantidade').getAttribute('aria-sort')).toBe('ascending');

    await trocarAno(container, ANO_ANTERIOR);

    const depois = secao(container, 'Estoque por localização');
    expect(cabecalho(depois, 'Quantidade').getAttribute('aria-sort')).toBe('ascending');
    cleanup();
  });

  test('o titulo e o MESMO no, com o texto novo', async () => {
    const { container, cleanup } = await montar();
    const tituloAntes = container.querySelector('.page__title');

    svc.getTipoMaterial.mockResolvedValue({ ...MATERIAL, nome: 'Papel A1' });
    await trocarAno(container, ANO_ANTERIOR);

    expect(container.querySelector('.page__title')).toBe(tituloAntes);
    expect(tituloAntes.textContent).toBe('Papel A1');
    cleanup();
  });

  test('o cartao de resumo e o MESMO no, com o valor novo', async () => {
    const { container, cleanup } = await montar();
    const cartaoAntes = container.querySelector('.summary-card');
    expect(cartaoAntes.querySelector('.summary-card__value').textContent).toBe('12');

    svc.getTipoMaterial.mockResolvedValue({
      ...MATERIAL,
      estoque: { ...MATERIAL.estoque, disponivel: 30 },
    });
    await trocarAno(container, ANO_ANTERIOR);

    expect(container.querySelector('.summary-card')).toBe(cartaoAntes);
    expect(cartaoAntes.querySelector('.summary-card__value').textContent).toBe('30');
    cleanup();
  });

  test('o foco no botao Consumir sobrevive a recarga', async () => {
    const { container, cleanup } = await montar();
    const consumir = [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Consumir'));
    consumir.focus();
    expect(document.activeElement).toBe(consumir);

    await trocarAno(container, ANO_ANTERIOR);

    expect(container.contains(consumir)).toBe(true);
    expect(document.activeElement).toBe(consumir);
    cleanup();
  });
});
