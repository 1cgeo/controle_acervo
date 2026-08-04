import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// Tela de ATENDER PEDIDOS: a fila de trabalho da mapoteca. Ela junta as tres
// acoes de quem esta com o pedido na mao (baixar a carta, registrar o que
// imprimiu, tirar a etiqueta), e por isso mexe em dois services.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});
import { renderAtendimento } from '@modules/mapoteca/pages/atendimento/index.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// Tres pedidos: um atrasado, um sem prazo e um remetido (que fica na fila porque
// ainda falta fechar).
const PEDIDOS = [
  {
    id: 55, localizador_pedido: 'AB12-CD34-EF56', cliente_nome: '18º BI Mtz',
    situacao_pedido_id: 3, situacao_pedido_nome: 'Em andamento',
    data_pedido: '2026-06-10', prazo: '2026-06-30', dias_para_prazo: -30,
    documento_solicitacao: 'DIEx 123', total_itens: 2, itens_impressos: 0,
    quantidade_pedida: 10, quantidade_impressa: 4,
    endereco_entrega: 'Rua A, 1 - 90000-000 Porto Alegre - RS',
  },
  {
    id: 56, localizador_pedido: 'ZZ99-YY88-XX77', cliente_nome: '6º RCB',
    situacao_pedido_id: 7, situacao_pedido_nome: 'Aguardando produção',
    data_pedido: '2026-07-01', prazo: null, dias_para_prazo: null,
    documento_solicitacao: 'DIEx 456', total_itens: 0, itens_impressos: 0,
    quantidade_pedida: 0, quantidade_impressa: 0,
  },
  {
    id: 57, localizador_pedido: 'QQ11-WW22-EE33', cliente_nome: '3º RCC',
    situacao_pedido_id: 4, situacao_pedido_nome: 'Remetido',
    data_pedido: '2026-07-20', prazo: '2026-08-30', dias_para_prazo: 31,
    documento_solicitacao: 'DIEx 789', total_itens: 1, itens_impressos: 1,
    quantidade_pedida: 5, quantidade_impressa: 5,
  },
];

const IMPRESSAO = {
  pedido_id: 55,
  localizador_pedido: 'AB12-CD34-EF56',
  itens: [
    {
      produto_pedido_id: 900, quantidade: 6, quantidade_impressa: 4, quantidade_restante: 2,
      impressao_concluida: false, tipo_midia_nome: 'Sulfite 90g',
      produto_nome: 'Porto Alegre', mi: '2987-2', escala: '1:25.000', versao: '1',
      uuid_arquivo: 'aaaaaaaa-1111-2222-3333-444444444444',
      arquivo_nome: 'Carta 2987-2', arquivo_nome_fisico: 'ct_2987-2_ed1.pdf', tamanho_mb: 12.3,
    },
    {
      produto_pedido_id: 901, quantidade: 4, quantidade_impressa: 0, quantidade_restante: 4,
      impressao_concluida: false, tipo_midia_nome: 'Sulfite 90g',
      produto_nome: 'Viamão', mi: '2987-4', escala: '1:25.000', versao: '2',
      // Sem PDF no acervo: a linha aparece, marcada.
      uuid_arquivo: null, arquivo_nome: null, arquivo_nome_fisico: null, tamanho_mb: null,
    },
  ],
  impressao: { total_itens: 2, itens_concluidos: 0, concluida: false, itens_sem_arquivo: 1 },
};

const montar = async () => {
  const container = document.createElement('div');
  const cleanup = await renderAtendimento(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
};

const acaoDaLinha = (container, titulo, indiceLinha = 0) => {
  const linha = container.querySelectorAll('tbody tr')[indiceLinha];
  return [...linha.querySelectorAll('button')].find(b => (b.title || '').includes(titulo));
};

beforeEach(() => {
  svc.getPedidosEmAberto.mockResolvedValue(PEDIDOS);
  svc.getImpressaoDoPedido.mockResolvedValue(IMPRESSAO);
  svc.registrarImpressao.mockResolvedValue(null);
  svc.baixarCartaDoPedido.mockResolvedValue();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('renderAtendimento: a fila', () => {
  test('busca a fila SEM ano e lista os pedidos em aberto', async () => {
    const { container, cleanup } = await montar();

    // Sem argumento: a fila nao tem recorte de ano, ao contrario da lista de
    // pedidos. O pedido de dezembro ainda aberto e trabalho em janeiro.
    expect(svc.getPedidosEmAberto).toHaveBeenCalledWith();
    // O titulo NAO repete o rotulo do menu ("Atender pedidos"), decisao de
    // 2026-08-04: rotulo repetido gasta a primeira linha da tela sem informar.
    expect(container.querySelector('.page__title').textContent).toBe('Fila de atendimento');
    expect(container.textContent).toContain('18º BI Mtz');
    expect(container.textContent).toContain('6º RCB');
    expect(container.textContent).toContain('3º RCC');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o contador diz quantos estão com prazo vencido', async () => {
    const { container, cleanup } = await montar();

    expect(container.querySelector('.page__meta').textContent)
      .toBe('3 pedido(s) em aberto, 1 com prazo vencido');

    if (typeof cleanup === 'function') cleanup();
  });

  // O prazo vem em DIAS do banco (prazo - CURRENT_DATE), para a tela nao fazer
  // conta de data e nao errar por fuso.
  test('o prazo aparece em dias, com atraso e sem prazo distintos', async () => {
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('atrasado 30 dia(s)');
    expect(container.textContent).toContain('sem prazo');
    expect(container.textContent).toContain('31 dia(s)');

    if (typeof cleanup === 'function') cleanup();
  });

  test('mostra o progresso de impressão de cada pedido', async () => {
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('0/2 itens · 4/10 cópias');
    // Pedido sem item nao mostra "0/0": diz que nao tem item.
    expect(container.textContent).toContain('sem itens');

    if (typeof cleanup === 'function') cleanup();
  });

  test('fila vazia diz que está limpa, em vez de mostrar tabela vazia sem explicação', async () => {
    svc.getPedidosEmAberto.mockResolvedValue([]);
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('A fila está limpa');

    if (typeof cleanup === 'function') cleanup();
  });

  test('erro na carga mostra a mensagem do servidor sem derrubar a página', async () => {
    svc.getPedidosEmAberto.mockRejectedValueOnce(new Error('Usuário necessita do perfil operador'));
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('perfil operador');

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('renderAtendimento: atender um pedido', () => {
  test('abre o painel com os itens e o que falta imprimir', async () => {
    const { container, cleanup } = await montar();

    acaoDaLinha(container, 'Atender').click();
    await flush();

    expect(svc.getImpressaoDoPedido).toHaveBeenCalledWith(55);
    expect(document.body.textContent).toContain('Atender pedido AB12-CD34-EF56');
    expect(document.body.textContent).toContain('Porto Alegre');
    expect(document.body.textContent).toContain('faltam 2');
    // Item sem PDF nao desaparece: quem atende precisa saber antes de plotar.
    expect(document.body.textContent).toContain('sem PDF no acervo');
    expect(document.body.textContent).toContain('1 sem PDF');

    if (typeof cleanup === 'function') cleanup();
  });

  // Vai pela rota da MAPOTECA, e nao pela do acervo: quem atende tem operador na
  // mapoteca e pode nao ter perfil nenhum no acervo. Pela rota do acervo ele
  // levaria 403 no meio da tela feita para ele.
  test('baixa a carta pela rota do PEDIDO, com o nome físico', async () => {
    const { container, cleanup } = await montar();
    acaoDaLinha(container, 'Atender').click();
    await flush();

    const baixar = [...document.querySelectorAll('.modal button')]
      .find(b => (b.title || '').includes('Baixar a carta'));
    baixar.click();
    await flush();

    expect(svc.baixarCartaDoPedido).toHaveBeenCalledWith(
      55,
      'aaaaaaaa-1111-2222-3333-444444444444',
      'ct_2987-2_ed1.pdf'
    );

    if (typeof cleanup === 'function') cleanup();
  });

  test('registra a impressão com o que FALTA como padrão, e recarrega a fila', async () => {
    const { container, cleanup } = await montar();
    acaoDaLinha(container, 'Atender').click();
    await flush();

    const registrar = [...document.querySelectorAll('.modal button')]
      .find(b => (b.title || '').includes('Registrar impressão'));
    registrar.click();
    await flush();

    // O padrao e o restante (2): quem imprime o lote todo confirma sem digitar.
    const campoQtd = [...document.querySelectorAll('input[type="number"]')].pop();
    expect(campoQtd.value).toBe('2');

    const confirmar = [...document.querySelectorAll('button')]
      .filter(b => b.textContent.trim() === 'Registrar').pop();
    confirmar.click();
    await flush();

    expect(svc.registrarImpressao).toHaveBeenCalledWith([
      { produto_pedido_id: 900, quantidade: 2, observacao: undefined },
    ]);
    // Depois de registrar, a fila e o painel voltam a buscar: o numero na tela
    // tem de bater com o que a pessoa acabou de lancar.
    expect(svc.getPedidosEmAberto).toHaveBeenCalledTimes(2);
    expect(svc.getImpressaoDoPedido).toHaveBeenCalledTimes(2);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a etiqueta de envio abre direto da fila, sem passar pelo detalhe', async () => {
    const { container, cleanup } = await montar();

    acaoDaLinha(container, 'Etiqueta').click();
    await flush();

    expect(document.body.textContent).toContain('Etiqueta de envio');
    // O destinatário e o endereço vêm preenchidos da PRÓPRIA linha da fila (a
    // rota já os devolve), então abrir a etiqueta não faz segunda requisição.
    const valores = [...document.querySelectorAll('input, textarea')].map(c => c.value);
    expect(valores).toContain('18º BI Mtz');
    expect(valores.some(v => v.includes('Rua A, 1'))).toBe(true);
    expect(svc.getPedido).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });
});
