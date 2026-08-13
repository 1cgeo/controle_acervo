import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// SELECAO MULTIPLA no dialogo de adicionar produto: marcar varias folhas e
// adicionar todas de uma vez, com um formulario so.
//
// Arquivo proprio: em dialog-produto.test.js mora o contrato de UM item, que
// continua valendo inteiro (o modo EDICAO nao tem selecao nenhuma).
//
// O caso que originou: "quero as 4 folhas 25k do 2951-2". Uma por uma, isso
// custava quatro passagens pelo dialogo inteiro.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});
vi.mock('@modules/mapoteca/services/acervo-service.js', async () => {
  const { mockAcervoService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockAcervoService();
});

import { openProdutoPedidoDialog } from '@modules/mapoteca/pages/pedidos/dialog-produto.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import * as acervo from '@modules/mapoteca/services/acervo-service.js';

// Os quatro quadrantes 25k do 50k 2951-2, como a busca do acervo os devolve.
const QUADRANTES = ['NE', 'NO', 'SE', 'SO'].map((q, i) => ({
  id: 100 + i,
  nome: `Folha ${q}`,
  mi: `2951-2-${q}`,
  inom: `SH-22-V-D-I-2-${q}`,
  escala: '1:25.000',
  tipo_produto: 'Carta Topográfica',
  num_versoes: 1,
}));

// O detalhe traz as VERSOES, e e delas que sai a escolha automatica: a mais
// recente COM ARQUIVO.
const detalheDe = (p, versoes) => ({
  id: p.id, nome: p.nome, mi: p.mi, inom: p.inom, escala: p.escala,
  versoes: versoes || [{
    uuid_versao: `uuid-${p.id}`,
    versao: '1',
    versao_data_edicao: '2023-01-01',
    arquivos: [{ id: 1 }],
  }],
});

const caixas = () => [...document.querySelectorAll('td input[type="checkbox"]')];
const botao = (texto) => [...document.querySelectorAll('button')]
  .find(b => b.textContent.includes(texto));

const buscar = async () => {
  botao('Buscar no catálogo').click();
  await flush();
};

const preencherDadosDoItem = () => {
  // Mídia e quantidade valem para TODOS os marcados.
  const selects = [...document.querySelectorAll('select')];
  const midia = selects.find(s => [...s.options].some(o => o.textContent.includes('Papel')));
  midia.value = '1';
  midia.dispatchEvent(new Event('change', { bubbles: true }));
  const qtd = [...document.querySelectorAll('input[type="number"]')][0];
  qtd.value = '3';
  qtd.dispatchEvent(new Event('input', { bubbles: true }));
};

beforeEach(() => {
  svc.getDominioTipoMidia.mockResolvedValue([{ code: 1, nome: 'Papel' }]);
  svc.getDominioFormaEntrega.mockResolvedValue([{ code: 1, nome: 'Correios' }]);
  acervo.getTiposProduto.mockResolvedValue([{ code: 1, nome: 'Carta Topográfica' }]);
  acervo.getTiposEscala.mockResolvedValue([{ code: 1, nome: '1:25.000' }]);
  acervo.buscarProdutos.mockResolvedValue({
    total: QUADRANTES.length, page: 1, limit: 5, dados: QUADRANTES,
  });
  acervo.getProdutoDetalhado.mockImplementation(async (id) =>
    detalheDe(QUADRANTES.find(p => p.id === id)));
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('adicionar varios produtos de uma vez', () => {
  test('sem onSubmitLote NAO ha caixa de selecao', async () => {
    await openProdutoPedidoDialog({ onSubmit: vi.fn() });
    await flush();
    await buscar();

    expect(caixas()).toHaveLength(0);
  });

  test('no modo EDICAO nao ha caixa, mesmo com onSubmitLote', async () => {
    await openProdutoPedidoDialog({
      item: { produto_id: 100, produto_nome: 'Folha NE', uuid_versao: 'uuid-100' },
      onSubmit: vi.fn(),
      onSubmitLote: vi.fn(),
    });
    await flush();

    expect(caixas()).toHaveLength(0);
  });

  test('marca os 4 quadrantes e entrega os 4 numa chamada so', async () => {
    const onSubmitLote = vi.fn();
    await openProdutoPedidoDialog({ onSubmit: vi.fn(), onSubmitLote });
    await flush();
    await buscar();

    expect(caixas()).toHaveLength(4);
    caixas().forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    preencherDadosDoItem();

    botao('Adicionar 4 itens').click();
    await flush();

    expect(onSubmitLote).toHaveBeenCalledTimes(1);
    const itens = onSubmitLote.mock.calls[0][0];
    expect(itens).toHaveLength(4);
    expect(itens.map(i => i.display.mi))
      .toEqual(['2951-2-NE', '2951-2-NO', '2951-2-SE', '2951-2-SO']);
    // A quantidade e a midia do formulario valem para todos.
    for (const i of itens) {
      expect(i.payload.quantidade).toBe(3);
      expect(i.payload.tipo_midia_id).toBe(1);
    }
  });

  test('o rotulo do botao conta os marcados', async () => {
    await openProdutoPedidoDialog({ onSubmit: vi.fn(), onSubmitLote: vi.fn() });
    await flush();
    await buscar();

    const cs = caixas();
    cs[0].checked = true; cs[0].dispatchEvent(new Event('change', { bubbles: true }));
    expect(botao('Adicionar 1 item')).toBeTruthy();

    cs[1].checked = true; cs[1].dispatchEvent(new Event('change', { bubbles: true }));
    expect(botao('Adicionar 2 itens')).toBeTruthy();

    cs[0].checked = false; cs[0].dispatchEvent(new Event('change', { bubbles: true }));
    expect(botao('Adicionar 1 item')).toBeTruthy();
  });

  // A REGRA DA VERSAO, que e a razao de a selecao multipla poder existir sem
  // perguntar nada: vale a mais recente COM ARQUIVO.
  test('escolhe a versao mais recente COM ARQUIVO, e nao a mais recente', async () => {
    acervo.getProdutoDetalhado.mockImplementation(async (id) => detalheDe(
      QUADRANTES.find(p => p.id === id),
      [
        { uuid_versao: 'antiga-com-arquivo', versao: '1', versao_data_edicao: '2019-01-01', arquivos: [{ id: 1 }] },
        { uuid_versao: 'nova-SEM-arquivo', versao: '2', versao_data_edicao: '2024-01-01', arquivos: [] },
      ]
    ));

    const onSubmitLote = vi.fn();
    await openProdutoPedidoDialog({ onSubmit: vi.fn(), onSubmitLote });
    await flush();
    await buscar();

    const c = caixas()[0];
    c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
    preencherDadosDoItem();
    botao('Adicionar 1 item').click();
    await flush();

    const itens = onSubmitLote.mock.calls[0][0];
    expect(itens[0].payload.uuid_versao).toBe('antiga-com-arquivo');
  });

  test('produto SEM versao com arquivo fica de fora, e a tela diz qual', async () => {
    acervo.getProdutoDetalhado.mockImplementation(async (id) => detalheDe(
      QUADRANTES.find(p => p.id === id),
      id === 100
        ? [{ uuid_versao: 'vazia', versao: '1', versao_data_edicao: '2020-01-01', arquivos: [] }]
        : undefined
    ));

    const onSubmitLote = vi.fn();
    await openProdutoPedidoDialog({ onSubmit: vi.fn(), onSubmitLote });
    await flush();
    await buscar();

    caixas().forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    preencherDadosDoItem();
    botao('Adicionar 4 itens').click();
    await flush();

    // Tres entram; o quarto e nomeado no aviso, e nao sumiu em silencio.
    const itens = onSubmitLote.mock.calls[0][0];
    expect(itens).toHaveLength(3);
    expect(itens.map(i => i.display.mi)).not.toContain('2951-2-NE');
    expect(document.body.textContent).toContain('2951-2-NE');
  });

  test('nenhum com arquivo NAO chama o onSubmitLote', async () => {
    acervo.getProdutoDetalhado.mockImplementation(async (id) => detalheDe(
      QUADRANTES.find(p => p.id === id),
      [{ uuid_versao: 'vazia', versao: '1', versao_data_edicao: '2020-01-01', arquivos: [] }]
    ));

    const onSubmitLote = vi.fn();
    await openProdutoPedidoDialog({ onSubmit: vi.fn(), onSubmitLote });
    await flush();
    await buscar();

    caixas().forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    preencherDadosDoItem();
    botao('Adicionar 4 itens').click();
    await flush();

    expect(onSubmitLote).not.toHaveBeenCalled();
  });

  test('sem quantidade NAO vai ao acervo buscar versao nenhuma', async () => {
    const onSubmitLote = vi.fn();
    await openProdutoPedidoDialog({ onSubmit: vi.fn(), onSubmitLote });
    await flush();
    await buscar();

    const c = caixas()[0];
    c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true }));
    // Sem preencher midia nem quantidade.
    botao('Adicionar 1 item').click();
    await flush();

    expect(onSubmitLote).not.toHaveBeenCalled();
    // A validacao do formulario vem ANTES das requisicoes: fazer a pessoa
    // esperar quatro idas ao servidor para so entao dizer "falta a quantidade"
    // e o desperdicio que esta ordem evita.
    expect(acervo.getProdutoDetalhado).not.toHaveBeenCalled();
  });

  test('falha do chamador NAO limpa a selecao, para poder tentar de novo', async () => {
    const onSubmitLote = vi.fn().mockRejectedValue(new Error('banco fora'));
    await openProdutoPedidoDialog({ onSubmit: vi.fn(), onSubmitLote });
    await flush();
    await buscar();

    caixas().forEach(c => { c.checked = true; c.dispatchEvent(new Event('change', { bubbles: true })); });
    preencherDadosDoItem();
    botao('Adicionar 4 itens').click();
    await flush();

    expect(botao('Adicionar 4 itens')).toBeTruthy();
  });
});
