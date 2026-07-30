import { describe, test, expect, vi, beforeEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderPedidosList } from '@modules/mapoteca/pages/pedidos/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, GERENTE, CONSULTA } from '@/__tests__/helpers/sessao.js';
import { setAno } from '@modules/mapoteca/store/year-store.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// Militar (tipo 1 a 3) e civil (4 a 9) no mesmo lote, senao o filtro nao tem o
// que separar e o teste passa sem provar nada.
const PEDIDOS = [
  {
    id: 55, data_pedido: '2026-06-10', cliente_nome: '1º CGEO',
    tipo_cliente_id: 1, tipo_cliente_nome: 'OM EB',
    documento_solicitacao: 'DIEx 123', situacao_pedido_id: 3,
    situacao_pedido_nome: 'Em andamento', prazo: '2026-06-30',
    quantidade_produtos: 8, itens_impressos: 3, localizador_pedido: 'AB12-CD34-EF56',
  },
  {
    id: 56, data_pedido: '2026-06-11', cliente_nome: 'Prefeitura de Santa Maria',
    tipo_cliente_id: 6, tipo_cliente_nome: 'Órgão Publico Municipal',
    documento_solicitacao: 'Ofício 9', situacao_pedido_id: 5,
    situacao_pedido_nome: 'Concluído', prazo: '2026-07-01',
    quantidade_produtos: 2, itens_impressos: 2, localizador_pedido: 'ZZ99-YY88-XX77',
  },
  {
    id: 57, data_pedido: '2026-06-12', cliente_nome: 'Base Aérea de Santa Maria',
    tipo_cliente_id: 2, tipo_cliente_nome: 'OM Aeronáutica',
    documento_solicitacao: 'DIEx 456', situacao_pedido_id: 3,
    situacao_pedido_nome: 'Em andamento', prazo: '2026-07-05',
    quantidade_produtos: 1, itens_impressos: 0, localizador_pedido: 'QQ11-WW22-EE33',
  },
];

// Um pedido em Aguardando producao (situacao 7) NAO entra no lote acima de
// proposito: ele mudaria a contagem dos testes de militar/civil, que ja provam
// outra coisa. O teste do filtro novo carrega o seu proprio lote.
const PEDIDO_AGUARDANDO = {
  id: 58, data_pedido: '2026-06-13', cliente_nome: 'Comando Militar do Sul',
  tipo_cliente_id: 1, tipo_cliente_nome: 'OM EB',
  documento_solicitacao: 'DIEx 789', situacao_pedido_id: 7,
  situacao_pedido_nome: 'Aguardando produção', prazo: '2026-09-30',
  quantidade_produtos: 33, itens_impressos: 0, localizador_pedido: 'AA10-BB20-CC30',
};

/** Texto das linhas visiveis da tabela (o filtro age no corpo, nao no cabecalho). */
const corpo = (container) => [...container.querySelectorAll('tbody tr')].map(tr => tr.textContent);

/** Clica no botao de filtro pelo rotulo. */
const clicarFiltro = (container, rotulo) => {
  const botao = [...container.querySelectorAll('.filtro-barra__grupo button')]
    .find(b => b.textContent === rotulo);
  if (!botao) throw new Error(`filtro "${rotulo}" nao existe na tela`);
  botao.click();
};

describe('renderPedidosList', () => {
  beforeEach(() => {
    // A tela esconde escrita por perfil: sem sessao nao ha botao para testar.
    logarComo({ mapoteca: GERENTE });
    svc.getPedidos.mockResolvedValue(PEDIDOS);
  });

  test('monta o titulo e carrega os pedidos', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getPedidos).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Pedidos');
    expect(container.textContent).toContain('AB12-CD34-EF56');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a coluna de impressao mostra impressos/total', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(container.textContent).toContain('3/8');

    if (typeof cleanup === 'function') cleanup();
  });

  // O id e chave interna: nao tem valor para quem opera, e some da lista.
  test('nao existe coluna de ID', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const cabecalhos = [...container.querySelectorAll('thead th')].map(th => th.textContent.trim());
    expect(cabecalhos).not.toContain('ID');
    expect(cabecalhos).toContain('Localizador');
    expect(cabecalhos).toContain('Tipo');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o filtro separa militar de civil, e Todos traz os tres de volta', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(corpo(container)).toHaveLength(3);

    clicarFiltro(container, 'Militar');
    let linhas = corpo(container);
    expect(linhas).toHaveLength(2);
    expect(linhas.join(' ')).toContain('1º CGEO');
    expect(linhas.join(' ')).toContain('Base Aérea');
    expect(linhas.join(' ')).not.toContain('Prefeitura');

    clicarFiltro(container, 'Civil');
    linhas = corpo(container);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('Prefeitura');

    clicarFiltro(container, 'Todos');
    expect(corpo(container)).toHaveLength(3);

    if (typeof cleanup === 'function') cleanup();
  });

  // O pedido em Aguardando producao saiu da fila de atendimento em 2026-07-30
  // (decisao do chefe): ele espera carta que ainda nao existe. Fora da fila,
  // esta lista e o unico lugar onde ele aparece, e sem filtro proprio ele vira
  // esquecimento quando a producao terminar.
  test('o filtro "Aguardando produção" isola a situação 7', async () => {
    svc.getPedidos.mockResolvedValue([...PEDIDOS, PEDIDO_AGUARDANDO]);
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(corpo(container)).toHaveLength(4);

    clicarFiltro(container, 'Aguardando produção');
    const linhas = corpo(container);
    expect(linhas).toHaveLength(1);
    expect(linhas[0]).toContain('Comando Militar do Sul');
    expect(linhas[0]).toContain('AA10-BB20-CC30');

    clicarFiltro(container, 'Todos');
    expect(corpo(container)).toHaveLength(4);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o contador diz quanto o filtro escondeu', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const meta = () => container.querySelector('.page__meta').textContent;
    expect(meta()).toContain('3 pedido(s)');

    clicarFiltro(container, 'Civil');
    // Com filtro, o total aparece junto: o numero na tela nunca se confunde
    // com o total de pedidos do sistema.
    expect(meta()).toContain('1 de 3');

    if (typeof cleanup === 'function') cleanup();
  });

  // A planilha do RTM sai desta tela, e nao da do RPCMTec (chefe, 2026-07-29).
  // Baixar e LEITURA, entao o botao vale para todo perfil, ao contrario de "Novo
  // pedido"; e o recorte e o ANO da lista, para o arquivo bater com a tela.
  test('a planilha do RTM baixa pelo ano da lista, e aparece sem perfil de gerente', async () => {
    logarComo({ mapoteca: CONSULTA });
    setAno(2026);
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    const botao = [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Planilha do RTM'));
    expect(botao).toBeTruthy();
    // Quem só consulta não vê "Novo pedido", e continua vendo a planilha.
    expect([...container.querySelectorAll('button')]
      .some(b => b.textContent.includes('Novo pedido'))).toBe(false);

    botao.click();
    await flush();
    expect(svc.downloadMeta4Ods).toHaveBeenCalledWith(2026);

    if (typeof cleanup === 'function') cleanup();
  });

  test('"Novo pedido" leva ao wizard COM o prefixo do modulo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidosList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    container.querySelector('.btn--primary').click();
    expect(location.hash).toBe('#/mapoteca/pedidos/novo');

    if (typeof cleanup === 'function') cleanup();
  });
});
