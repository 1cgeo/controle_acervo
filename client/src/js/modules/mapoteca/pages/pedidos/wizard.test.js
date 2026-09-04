import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { combos, opcoesDoCombo, escolherNoCombo } from '@/__tests__/helpers/combo.js';

// Wizard de 4 passos do novo pedido. Os dois services sao mockados: NENHUMA
// chamada sai para o servidor, entao o teste nunca cria pedido de verdade.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});
vi.mock('@services/plataforma-service.js', async () => {
  const { mockPlataformaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockPlataformaService();
});
vi.mock('@modules/mapoteca/services/acervo-service.js', async () => {
  const { mockAcervoService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockAcervoService();
});

import { renderPedidoWizard } from '@modules/mapoteca/pages/pedidos/wizard.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import {
  guardarListaDePedidos, listaDePedidos, esquecerListaDePedidos,
} from '@modules/mapoteca/pages/pedidos/ultima-lista.js';

const CLIENTES = [
  { id: 1, nome: '1º CGEO', tipo_cliente_id: 1 },
  { id: 2, nome: 'Prefeitura de Porto Alegre', tipo_cliente_id: 5 },
];
const SITUACOES = [
  { code: 3, nome: 'Em andamento' },
  { code: 5, nome: 'Concluído' },
  { code: 6, nome: 'Cancelado' },
];
const CANAIS = [{ code: 1, nome: 'Ouvidoria/LAI' }];

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderPedidoWizard(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

/** Painel visivel do wizard (os outros ficam com .hidden). */
function painelAtivo(container) {
  const painels = [...container.querySelectorAll('.wizard__content > div')];
  return painels.find(p => !p.classList.contains('hidden'));
}

describe('renderPedidoWizard', () => {
  beforeEach(() => {
    svc.getClientes.mockResolvedValue(CLIENTES);
    svc.getDominioSituacaoPedido.mockResolvedValue(SITUACOES);
    svc.getDominioCanalRecebimento.mockResolvedValue(CANAIS);
  });

  test('carrega os lookups e abre no passo 1', async () => {
    const { container, cleanup } = await montar();

    expect(svc.getClientes).toHaveBeenCalled();
    expect(svc.getDominioSituacaoPedido).toHaveBeenCalled();
    expect(svc.getDominioCanalRecebimento).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Novo pedido');
    expect(painelAtivo(container).textContent).toContain('Dados básicos');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o stepper tem os 4 passos, na ordem', async () => {
    const { container, cleanup } = await montar();

    const rotulos = [...container.querySelectorAll('.wizard-stepper__label')].map(e => e.textContent);
    expect(rotulos).toEqual(['Básico', 'Adicional', 'Produtos', 'Confirmação']);

    if (typeof cleanup === 'function') cleanup();
  });

  test('Avançar sem cliente nao sai do passo 1 (validacao do basico)', async () => {
    const { container, cleanup } = await montar();

    const avancar = [...container.querySelectorAll('button')].find(b => b.textContent === 'Avançar');
    avancar.click();
    await flush();

    expect(painelAtivo(container).textContent).toContain('Dados básicos');
    expect(container.textContent).toContain('Campo obrigatório');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o modo Civil troca a lista de clientes e mostra a secao civil', async () => {
    const { container, cleanup } = await montar();

    const btnCivil = [...container.querySelectorAll('button')].find(b => b.textContent === 'Pedido de Civil');
    btnCivil.click();
    await flush();

    const nomes = opcoesDoCombo(combos(container)[0]);
    expect(nomes).toContain('Prefeitura de Porto Alegre');
    expect(nomes).not.toContain('1º CGEO');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o modo Militar so oferece cliente de OM', async () => {
    const { container, cleanup } = await montar();

    const nomes = opcoesDoCombo(combos(container)[0]);
    expect(nomes).toContain('1º CGEO');
    expect(nomes).not.toContain('Prefeitura de Porto Alegre');

    if (typeof cleanup === 'function') cleanup();
  });

  test('com o basico preenchido, Avançar caminha ate a confirmacao', async () => {
    const { container, cleanup } = await montar();

    // O CLIENTE virou combo buscavel: a lista cresce a cada pedido de fora.
    escolherNoCombo(combos(container)[0], 'CGEO');
    const selects = [...container.querySelectorAll('select')];
    selects[0].value = '3';                                  // situacao
    selects[0].dispatchEvent(new Event('change'));

    const avancar = [...container.querySelectorAll('button')].find(b => b.textContent === 'Avançar');
    avancar.click(); await flush();
    expect(painelAtivo(container).textContent).toContain('Dados adicionais');

    avancar.click(); await flush();
    expect(painelAtivo(container).textContent).toContain('Produtos do pedido');
    expect(painelAtivo(container).textContent).toContain('Nenhum produto adicionado ao pedido');

    avancar.click(); await flush();
    const confirmacao = painelAtivo(container);
    expect(confirmacao.textContent).toContain('Dados básicos');
    expect(confirmacao.textContent).toContain('1º CGEO');
    expect(confirmacao.textContent).toContain('Produtos (0)');

    // No ultimo passo Avançar some e Confirmar aparece.
    expect(avancar.classList.contains('hidden')).toBe(true);
    const confirmar = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Confirmar pedido'));
    expect(confirmar.classList.contains('hidden')).toBe(false);

    // Nada foi gravado: o wizard so escreve no clique do Confirmar.
    expect(svc.createPedido).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  // O caso acima prova que o botão APARECE. Este aperta: botão que ninguém
  // clica não diz se o wizard grava, e criar pedido é o que esta tela existe
  // para fazer.
  test('Confirmar grava o pedido e mostra o localizador na tela de sucesso', async () => {
    svc.createPedido.mockResolvedValue({ id: 99, localizador_pedido: 'AB12-CD34-EF56' });
    const { container, cleanup } = await montar();

    escolherNoCombo(combos(container)[0], 'CGEO');
    const selects = [...container.querySelectorAll('select')];
    selects[0].value = '3';
    selects[0].dispatchEvent(new Event('change'));

    const avancar = [...container.querySelectorAll('button')].find(b => b.textContent === 'Avançar');
    avancar.click(); await flush();
    avancar.click(); await flush();
    avancar.click(); await flush();

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Confirmar pedido')).click();
    await flush();

    expect(svc.createPedido).toHaveBeenCalledWith(
      expect.objectContaining({ cliente_id: 1, situacao_pedido_id: 3 }),
    );
    // Pedido sem item: nenhum POST de item sai junto.
    expect(svc.createProdutoPedido).not.toHaveBeenCalled();
    expect(container.textContent).toContain('AB12-CD34-EF56');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o voltar do cabecalho leva a lista COM o prefixo do modulo', async () => {
    const { container, cleanup } = await montar();

    container.querySelector('.btn--text').click();
    expect(location.hash).toBe('#/mapoteca/pedidos');

    if (typeof cleanup === 'function') cleanup();
  });
});

// OS DOIS CAMINHOS DE VOLTA DO WIZARD NAO SAO O MESMO CASO.
//
// Desistir devolve o recorte de onde a pessoa saiu, como o detalhe faz. GRAVAR
// esquece esse recorte, e nao e esquecimento: data, tipo de cliente e situacao
// do pedido novo sao escolhidos AQUI, entao o filtro, a palavra-chave, o ano e a
// pagina de antes quase nunca o contem. Voltar restaurado depois de criar
// mostraria uma lista SEM o pedido recem-criado, e quem olha conclui que a
// gravacao falhou. Tratar os dois botoes igual seria um defeito pior que a rota
// pelada que estava aqui ate 2026-09-04.
describe('wizard: a volta para a lista, antes e depois de gravar', () => {
  beforeEach(() => {
    svc.getClientes.mockResolvedValue(CLIENTES);
    svc.getDominioSituacaoPedido.mockResolvedValue(SITUACOES);
    svc.getDominioCanalRecebimento.mockResolvedValue(CANAIS);
    esquecerListaDePedidos();
    location.hash = '#/mapoteca/pedidos';
  });

  const RECORTE = '/mapoteca/pedidos?filtro=civil&pagina=3&por_pagina=50';

  test('DESISTIR devolve o recorte de onde a pessoa saiu', async () => {
    guardarListaDePedidos(RECORTE);
    const { container, cleanup } = await montar();

    container.querySelector('.btn--text').click();

    expect(location.hash).toBe(`#${RECORTE}`);

    if (typeof cleanup === 'function') cleanup();
  });

  test('GRAVAR esquece o recorte, e a volta cai na lista limpa', async () => {
    guardarListaDePedidos(RECORTE);
    svc.createPedido.mockResolvedValue({ id: 99, localizador_pedido: 'AB12-CD34-EF56' });
    const { container, cleanup } = await montar();

    escolherNoCombo(combos(container)[0], 'CGEO');
    const selects = [...container.querySelectorAll('select')];
    selects[0].value = '3';
    selects[0].dispatchEvent(new Event('change'));

    const avancar = [...container.querySelectorAll('button')].find(b => b.textContent === 'Avançar');
    avancar.click(); await flush();
    avancar.click(); await flush();
    avancar.click(); await flush();

    [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Confirmar pedido')).click();
    await flush();

    expect(svc.createPedido).toHaveBeenCalled();
    // O memo morreu na gravacao: o detalhe alcancado por "Ver pedido" volta pela
    // lista limpa tambem, e nao so este botao.
    expect(listaDePedidos()).toBe('/mapoteca/pedidos');

    [...container.querySelectorAll('button')]
      .find(b => b.textContent === 'Voltar para pedidos').click();

    expect(location.hash).toBe('#/mapoteca/pedidos');

    if (typeof cleanup === 'function') cleanup();
  });
});
