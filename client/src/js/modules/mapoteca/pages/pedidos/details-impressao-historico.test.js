import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// O que o detalhe do pedido ganhou em 2026-07-30: registrar impressao de dentro
// do pedido, o resumo de QUEM imprimiu quanto, e o historico do pedido (a rota
// de auditoria).
//
// Arquivo SEPARADO de details.test.js de proposito: aqui a sessao entra logada
// (saveAuth), e o perfil vale para o arquivo inteiro. Misturado com os testes
// que montam a tela deslogada, um mudaria o resultado do outro.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});
vi.mock('@modules/mapoteca/services/acervo-service.js', async () => {
  const { mockAcervoService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockAcervoService();
});

import { renderPedidoDetails } from '@modules/mapoteca/pages/pedidos/details.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { saveAuth, clearAuth } from '@store/auth-store.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const PEDIDO = {
  id: 55,
  cliente_id: 7,
  cliente_nome: '1º CGEO',
  localizador_pedido: 'AB12-CD34-EF56',
  situacao_pedido_id: 3,
  situacao_pedido_nome: 'Em andamento',
  data_pedido: '2026-06-10',
  produtos: [
    {
      id: 900, produto_nome: 'Porto Alegre', mi: '2987-2', escala: '1:25.000',
      tipo_midia_nome: 'Papel', quantidade: 50, quantidade_impressa: 50,
      quantidade_restante: 0, impressao_concluida: true, quantidade_fornecida: 50,
    },
  ],
  impressao: { concluida: true, itens_concluidos: 1, total_itens: 1 },
};

// Tres sessoes de duas pessoas: e o caso que o chefe pediu para enxergar (uma
// pessoa imprimiu 40 e outra imprimiu 10, em duas idas ao plotter).
const HISTORICO_ITEM = {
  produto_pedido_id: 900,
  quantidade: 50,
  quantidade_impressa: 50,
  quantidade_restante: 0,
  impressao_concluida: true,
  registros: [
    { id: 1, quantidade: 40, observacao: null, data_impressao: '2026-07-28T10:00:00Z', usuario_nome: 'Cap Fulano' },
    { id: 2, quantidade: 6, observacao: null, data_impressao: '2026-07-29T10:00:00Z', usuario_nome: 'Sd Beltrano' },
    { id: 3, quantidade: 4, observacao: 'reimpressão', data_impressao: '2026-07-29T14:00:00Z', usuario_nome: 'Sd Beltrano' },
  ],
};

const AUDITORIA = [
  {
    id: 3, pedido_id: 55, tabela: 'impressao_item', registro_id: 12, operacao: 'I',
    campos_alterados: ['quantidade', 'produto_pedido_id'],
    data_evento: '2026-07-29T14:00:00Z', usuario_nome: 'Sd Beltrano',
  },
  {
    id: 2, pedido_id: 55, tabela: 'produto_pedido', registro_id: 900, operacao: 'U',
    campos_alterados: ['quantidade_fornecida'],
    data_evento: '2026-07-28T09:00:00Z', usuario_nome: 'Cap Fulano',
  },
  {
    id: 1, pedido_id: 55, tabela: 'pedido', registro_id: 55, operacao: 'I',
    campos_alterados: ['cliente_id', 'data_pedido'],
    data_evento: '2026-06-10T08:00:00Z', usuario_nome: null, usuario_nome_guerra: null,
  },
];

const montar = async () => {
  const container = document.createElement('div');
  const cleanup = await renderPedidoDetails(container, {
    params: { id: '55' }, query: new URLSearchParams(),
  });
  await flush();
  await flush();
  return { container, cleanup };
};

const acaoDoItem = (container, titulo) => {
  const linha = container.querySelectorAll('tbody tr')[0];
  return [...linha.querySelectorAll('button')].find(b => (b.title || '').includes(titulo));
};

beforeEach(() => {
  // Gerente na mapoteca: e quem abre esta tela (ela nao esta nas rotas de
  // operador), e gerente satisfaz operador.
  saveAuth({ token: 't', administrador: false, uuid: 'u-1', perfis: { mapoteca: 3 } }, 'fulano');
  svc.getPedido.mockResolvedValue(PEDIDO);
  svc.getAnexosPedido.mockResolvedValue([]);
  svc.getAuditoriaPedido.mockResolvedValue(AUDITORIA);
  svc.getImpressaoItem.mockResolvedValue(HISTORICO_ITEM);
  svc.registrarImpressao.mockResolvedValue(null);
});

afterEach(() => {
  clearAuth();
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('detalhe do pedido: registrar impressao', () => {
  test('a acao aparece na linha do item e grava pelo id do item', async () => {
    const { container, cleanup } = await montar();

    acaoDoItem(container, 'Registrar impressão').click();
    await flush();

    const campo = [...document.querySelectorAll('input[type="number"]')].pop();
    campo.value = '3';
    campo.dispatchEvent(new Event('input'));

    [...document.querySelectorAll('button')]
      .filter(b => b.textContent.trim() === 'Registrar').pop().click();
    await flush();

    expect(svc.registrarImpressao).toHaveBeenCalledWith([
      { produto_pedido_id: 900, quantidade: 3, observacao: undefined },
    ]);

    if (typeof cleanup === 'function') cleanup();
  });

  // POST /mapoteca/impressao e operador. Quem so consulta nao lanca impressao, e
  // o botao some.
  test('quem so consulta nao ve a acao de registrar', async () => {
    saveAuth({ token: 't', administrador: false, uuid: 'u-2', perfis: { mapoteca: 1 } }, 'ciclano');
    const { container, cleanup } = await montar();

    expect(acaoDoItem(container, 'Registrar impressão')).toBeUndefined();
    // O historico continua, que e leitura.
    expect(acaoDoItem(container, 'Histórico de impressão')).toBeTruthy();

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('detalhe do pedido: quem imprimiu quanto', () => {
  test('soma as sessoes de cada pessoa antes da lista', async () => {
    const { container, cleanup } = await montar();

    acaoDoItem(container, 'Histórico de impressão').click();
    await flush();

    const texto = document.body.textContent;
    expect(texto).toContain('Quem imprimiu');
    // Uma sessao de 40 e duas de 5 e 5: a soma e o que o chefe le, e nao as
    // linhas soltas da tabela paginada.
    expect(texto).toContain('Cap Fulano 40 cópia(s) (1 sessão)');
    expect(texto).toContain('Sd Beltrano 10 cópia(s) (2 sessões)');
    expect(texto).toContain('Total 50 de 50');

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem mais imprimiu vem primeiro', async () => {
    const { container, cleanup } = await montar();

    acaoDoItem(container, 'Histórico de impressão').click();
    await flush();

    const texto = document.body.textContent;
    expect(texto.indexOf('Cap Fulano')).toBeLessThan(texto.indexOf('Sd Beltrano'));

    if (typeof cleanup === 'function') cleanup();
  });

  test('item sem sessao nenhuma nao mostra o bloco vazio', async () => {
    svc.getImpressaoItem.mockResolvedValue({
      ...HISTORICO_ITEM, quantidade_impressa: 0, quantidade_restante: 50,
      impressao_concluida: false, registros: [],
    });
    const { container, cleanup } = await montar();

    acaoDoItem(container, 'Histórico de impressão').click();
    await flush();

    expect(document.body.textContent).not.toContain('Quem imprimiu');
    expect(document.body.textContent).toContain('Nenhuma sessão de impressão registrada');

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('detalhe do pedido: historico do pedido', () => {
  test('le a rota de auditoria e traduz tabela e operacao', async () => {
    const { container, cleanup } = await montar();

    expect(svc.getAuditoriaPedido).toHaveBeenCalledWith(55);
    const texto = container.textContent;
    expect(texto).toContain('Histórico do pedido');
    expect(texto).toContain('Adicionou');
    expect(texto).toContain('Alterou');
    // Nome legivel da tabela, com o id da linha ao lado, e nao 'produto_pedido'
    // cru. O nome de COLUNA segue cru em "o que mudou": ele nomeia o campo, e
    // traduzi-lo exigiria um mapa que envelhece a cada coluna nova.
    expect(texto).toContain('Item#900');
    expect(texto).toContain('Impressão#12');
    expect(texto).toContain('Pedido#55');
    expect(texto).not.toContain('impressao_item');

    if (typeof cleanup === 'function') cleanup();
  });

  test('mostra quem mudou e quais campos mudaram', async () => {
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Sd Beltrano');
    expect(container.textContent).toContain('quantidade_fornecida');
    // Evento sem usuario e migracao, e nao erro: os eventos anteriores a
    // auditoria entraram sem dono.
    expect(container.textContent).toContain('migração');

    if (typeof cleanup === 'function') cleanup();
  });

  test('pedido sem evento diz que nao ha alteracao, sem tabela vazia muda', async () => {
    svc.getAuditoriaPedido.mockResolvedValue([]);
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Nenhuma alteração registrada neste pedido');

    if (typeof cleanup === 'function') cleanup();
  });

  test('erro no historico nao derruba o resto do detalhe', async () => {
    svc.getAuditoriaPedido.mockRejectedValueOnce(new Error('Falha ao ler a auditoria'));
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Falha ao ler a auditoria');
    expect(container.textContent).toContain('Produtos do pedido');

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('detalhe do pedido: fornecida x impressa', () => {
  // Medido na producao em 2026-07-30: nos 1.928 itens as duas nunca divergiram.
  // A marca e alarme de dado errado, e por isso nao aparece no caso normal.
  test('iguais, mostra so o numero, sem marca', async () => {
    const { container, cleanup } = await montar();

    expect(container.textContent).not.toContain('difere da impressa');

    if (typeof cleanup === 'function') cleanup();
  });

  test('diferentes, marca a divergencia com o numero impresso', async () => {
    svc.getPedido.mockResolvedValue({
      ...PEDIDO,
      produtos: [{ ...PEDIDO.produtos[0], quantidade_fornecida: 48 }],
    });
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('difere da impressa (50)');

    if (typeof cleanup === 'function') cleanup();
  });

  test('item sem quantidade fornecida nao vira alarme', async () => {
    svc.getPedido.mockResolvedValue({
      ...PEDIDO,
      produtos: [{ ...PEDIDO.produtos[0], quantidade_fornecida: null }],
    });
    const { container, cleanup } = await montar();

    expect(container.textContent).not.toContain('difere da impressa');

    if (typeof cleanup === 'function') cleanup();
  });
});
