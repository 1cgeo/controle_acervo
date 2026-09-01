import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// IMPRESSAO EM LOTE na FILA DE ATENDIMENTO: marcar varios itens do pedido e
// registrar a impressao de todos numa passagem.
//
// Arquivo proprio porque o que se guarda aqui e um recorte, e nao mais um
// comportamento da tela: em index.test.js mora o contrato de UM item, que
// continua valendo inteiro.
//
// O caso que originou: o detalhe do pedido ganhou a selecao em 2026-08-13 e
// esta tela nao, embora seja AQUI que a pessoa passa o turno. O maior pedido da
// mapoteca tem 132 itens, e um a um isso e uma abertura de dialogo por item.
//
// Nada abaixo da tela e novo: `openRegistrarImpressaoDialog` ja aceitava lista,
// e `POST /mapoteca/impressao` sempre recebeu `registros: [...]`. O que faltava
// era a selecao, e e ela que estes testes prendem.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderAtendimento } from '@modules/mapoteca/pages/atendimento/index.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const PEDIDO = {
  id: 55, localizador_pedido: 'AB12-CD34-EF56', cliente_nome: '18º BI Mtz',
  situacao_pedido_id: 3, situacao_pedido_nome: 'Em andamento',
  data_pedido: '2026-06-10', prazo: '2026-06-30', dias_para_prazo: -30,
  documento_solicitacao: 'DIEx 123', total_itens: 2, itens_impressos: 0,
  quantidade_pedida: 10, quantidade_impressa: 4,
};

const item = (id, restante) => ({
  produto_pedido_id: id,
  quantidade: restante + 1,
  quantidade_impressa: 1,
  quantidade_restante: restante,
  impressao_concluida: false,
  tipo_midia_nome: 'Sulfite 90g',
  produto_nome: `Folha ${id}`,
  mi: `2987-${id}`,
  escala: '1:25.000',
  versao: '1',
  uuid_arquivo: `uuid-${id}`,
  arquivo_nome_fisico: `ct_2987-${id}.pdf`,
  tamanho_mb: 10,
});

const impressaoCom = (itens) => ({
  pedido_id: 55,
  localizador_pedido: 'AB12-CD34-EF56',
  itens,
  impressao: {
    total_itens: itens.length,
    itens_concluidos: 0,
    concluida: false,
    itens_sem_arquivo: 0,
  },
});

const DOIS = impressaoCom([item(900, 2), item(901, 4)]);

const montar = async () => {
  const container = document.createElement('div');
  const cleanup = await renderAtendimento(container, { params: {}, query: new URLSearchParams() });
  await flush();
  // A fila tem um pedido so: a acao de atender e a da primeira linha.
  const atender = [...container.querySelectorAll('tbody tr')[0].querySelectorAll('button')]
    .find(b => (b.title || '').includes('Atender'));
  atender.click();
  await flush();
  return { container, cleanup };
};

// O painel do pedido e o modal; o dialogo de registrar abre um segundo por
// cima. Enquanto so o painel esta aberto, `.modal` e ele.
const painel = () => document.querySelector('.modal');

const botao = (raiz, rotulo) => [...raiz.querySelectorAll('button')]
  .find(b => b.textContent.trim().startsWith(rotulo));

const marcarLinha = (indice) => {
  const caixa = painel().querySelectorAll('tbody tr')[indice]
    .querySelector('input[type="checkbox"]');
  caixa.checked = true;
  caixa.dispatchEvent(new Event('change', { bubbles: true }));
};

beforeEach(() => {
  svc.getPedidosEmAberto.mockResolvedValue([PEDIDO]);
  svc.getImpressaoDoPedido.mockResolvedValue(DOIS);
  svc.registrarImpressao.mockResolvedValue(null);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('fila de atendimento: registrar a impressão de vários itens', () => {
  test('o botão de lote nasce escondido e conta a seleção no próprio rótulo', async () => {
    const { cleanup } = await montar();

    // Sem selecao ele nao ocupa a barra: no pedido de um item ninguem seleciona
    // nada, e um botao morto ao lado do resumo so gasta a linha.
    expect(botao(painel(), 'Registrar impressão').classList.contains('hidden')).toBe(true);

    marcarLinha(0);
    await flush();

    const lote = botao(painel(), 'Registrar impressão');
    expect(lote.classList.contains('hidden')).toBe(false);
    // O NUMERO no rotulo: "Registrar impressão" sozinho nao diz quantos itens
    // vao no lancamento, e e esse numero que a pessoa confere antes de clicar.
    expect(lote.textContent).toContain('(1)');

    marcarLinha(1);
    await flush();
    expect(botao(painel(), 'Registrar impressão').textContent).toContain('(2)');

    if (typeof cleanup === 'function') cleanup();
  });

  test('os dois itens vão numa chamada só, com o restante de cada um', async () => {
    const { cleanup } = await montar();

    marcarLinha(0);
    marcarLinha(1);
    await flush();
    botao(painel(), 'Registrar impressão').click();
    await flush();

    const confirmar = [...document.querySelectorAll('button')]
      .filter(b => b.textContent.trim() === 'Registrar').pop();
    confirmar.click();
    await flush();

    // UMA chamada com os DOIS registros, e nao duas chamadas: o servidor grava
    // as N linhas numa transacao, e meia gravacao nao existe.
    expect(svc.registrarImpressao).toHaveBeenCalledTimes(1);
    expect(svc.registrarImpressao).toHaveBeenCalledWith([
      { produto_pedido_id: 900, quantidade: 2, observacao: undefined, data_impressao: undefined },
      { produto_pedido_id: 901, quantidade: 4, observacao: undefined, data_impressao: undefined },
    ]);

    if (typeof cleanup === 'function') cleanup();
  });

  test('depois de registrar, a seleção se limpa e as duas listas voltam a buscar', async () => {
    const { cleanup } = await montar();

    marcarLinha(0);
    await flush();
    botao(painel(), 'Registrar impressão').click();
    await flush();
    [...document.querySelectorAll('button')]
      .filter(b => b.textContent.trim() === 'Registrar').pop().click();
    await flush();

    // A SELECAO NAO SOBREVIVE AO LANCAMENTO. O data-table guarda a chave
    // `produto_pedido_id`, e ela continua existindo depois do registro: sem o
    // `clearSelection` o item ja lancado ficaria marcado, e o proximo clique no
    // botao o lancaria de novo.
    expect(botao(painel(), 'Registrar impressão').classList.contains('hidden')).toBe(true);
    // O painel e a fila se repintam: o numero na tela tem de bater com o que a
    // pessoa acabou de lancar.
    expect(svc.getImpressaoDoPedido).toHaveBeenCalledTimes(2);
    expect(svc.getPedidosEmAberto).toHaveBeenCalledTimes(2);

    if (typeof cleanup === 'function') cleanup();
  });

  test('"Selecionar todos" só aparece quando os itens não cabem numa página', async () => {
    const { cleanup } = await montar();

    // Dois itens cabem na pagina, e a caixa do cabecalho ja os marca: um
    // segundo botao ali seria ruido.
    expect(botao(painel(), 'Selecionar todos').classList.contains('hidden')).toBe(true);

    if (typeof cleanup === 'function') cleanup();
  });

  test('"Selecionar todos" marca os 12, e não os 10 da página', async () => {
    const doze = impressaoCom(
      Array.from({ length: 12 }, (_, i) => item(900 + i, 2))
    );
    svc.getImpressaoDoPedido.mockResolvedValue(doze);
    const { cleanup } = await montar();

    const todos = botao(painel(), 'Selecionar todos');
    expect(todos.classList.contains('hidden')).toBe(false);
    // A quantidade no rotulo: "todos" sozinho nao diz o tamanho do que se vai
    // registrar.
    expect(todos.textContent).toContain('(12)');

    todos.click();
    await flush();

    // A PROVA de que a selecao passou da pagina: a caixa do cabecalho marca 10,
    // e o que se espera aqui e 12.
    expect(botao(painel(), 'Registrar impressão').textContent).toContain('(12)');

    botao(painel(), 'Registrar impressão').click();
    await flush();
    [...document.querySelectorAll('button')]
      .filter(b => b.textContent.trim() === 'Registrar').pop().click();
    await flush();

    expect(svc.registrarImpressao.mock.calls[0][0]).toHaveLength(12);

    if (typeof cleanup === 'function') cleanup();
  });
});
