import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O que esta tela NAO pode fazer: jogar a pagina fora a cada carga.
//
// O chefe mediu o defeito: "quando edita a UI reconstroi, que
// torna muito chato ficar editando pois a tela fica se movendo". A causa era o
// `load()` recriar tudo, inclusive as duas tabelas.
//
// Estes testes provam a IDENTIDADE do no (toBe), e nao o texto na tela. Repintar
// tudo tambem acerta o texto, e perde no caminho a ordenacao, a pagina atual e o
// foco do teclado. O gatilho de recarga usado aqui e a troca de ano no filtro do
// grafico de consumo, o unico bloco da ficha que tem ano.

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderMaterialDetails } from '@modules/mapoteca/pages/materiais/details.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, GERENTE } from '@/__tests__/helpers/sessao.js';

// O filtro e desta tela e abre no ano ATUAL.
const ANO_ATUAL = new Date().getFullYear();
const ANO_ANTERIOR = ANO_ATUAL - 1;

/** O select do filtro de ano, na barra de controle do grafico de consumo. */
const filtroAno = (container) => container.querySelector('.export-bar select');

/** Troca o ano do grafico. E o gatilho de recarga da ficha. */
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
  meta_anual: 100,
  estoque: {
    total: 12,
    registros: [
      { id: 11, localizacao_nome: 'Seção', quantidade: 12, data_atualizacao: '2026-06-01T10:00:00Z' },
      { id: 12, localizacao_nome: 'Almoxarifado', quantidade: 40, data_atualizacao: '2026-06-02T10:00:00Z' },
    ],
  },
  consumo: {
    total_consumido: 88,
    ultimo_consumo: '2026-06-05',
    registros_recentes: [{ id: 21, data_consumo: '2026-06-05', quantidade: 3 }],
  },
};

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
  const cleanup = await renderMaterialDetails(container, {
    params: { id: '1' },
    query: new URLSearchParams(),
  });
  await flush();
  return { container, cleanup };
}

describe('renderMaterialDetails, o que sobrevive a uma recarga', () => {
  beforeEach(() => {
    logarComo({ mapoteca: GERENTE });
    svc.getTipoMaterial.mockResolvedValue(MATERIAL);
    svc.getConsumoMensal.mockResolvedValue([]);
    svc.getAnosMapoteca.mockResolvedValue([ANO_ATUAL, ANO_ANTERIOR]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  // O ano nao vem mais da navbar: e desta tela, e recorta SO o grafico de
  // consumo mensal. O cadastro, o estoque e o consumo recente nao tem ano.
  test('o grafico abre no ano ATUAL e trocar o ano recarrega', async () => {
    const { container, cleanup } = await montar();

    expect(filtroAno(container).value).toBe(String(ANO_ATUAL));
    expect(svc.getConsumoMensal).toHaveBeenLastCalledWith(ANO_ATUAL);

    await trocarAno(container, ANO_ANTERIOR);

    expect(svc.getConsumoMensal).toHaveBeenLastCalledWith(ANO_ANTERIOR);
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
    const consumoAntes = tabelaDe(container, 'Consumo recente');

    await trocarAno(container, ANO_ANTERIOR);

    expect(tabelaDe(container, 'Estoque por localização')).toBe(estoqueAntes);
    expect(tabelaDe(container, 'Consumo recente')).toBe(consumoAntes);
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
      estoque: { ...MATERIAL.estoque, total: 30 },
    });
    await trocarAno(container, ANO_ANTERIOR);

    expect(container.querySelector('.summary-card')).toBe(cartaoAntes);
    expect(cartaoAntes.querySelector('.summary-card__value').textContent).toBe('30');
    cleanup();
  });

  test('o foco no botao Editar sobrevive a recarga', async () => {
    const { container, cleanup } = await montar();
    const editar = [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Editar'));
    editar.focus();
    expect(document.activeElement).toBe(editar);

    await trocarAno(container, ANO_ANTERIOR);

    expect(container.contains(editar)).toBe(true);
    expect(document.activeElement).toBe(editar);
    cleanup();
  });
});
