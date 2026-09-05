import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Tela de ATENDER PEDIDOS: a fila de trabalho da mapoteca. Ela junta as tres
// acoes de quem esta com o pedido na mao (baixar a carta, registrar o que
// imprimiu, tirar a etiqueta), e por isso mexe em dois services.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});
import { renderAtendimento } from '@modules/mapoteca/pages/atendimento/index.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, OPERADOR, GERENTE } from '@/__tests__/helpers/sessao.js';

const entrarComo = (nivel) => logarComo({ mapoteca: nivel });

// Tres pedidos DA FILA DE IMPRESSAO: um atrasado, um sem prazo e um
// recem-recebido.
//
// As tres situacoes sao 2 e 3, e nao ha aqui um 7 nem um 4. A fila de
// atendimento que a rota devolve e [2, 3, 8, 4] (SITUACOES_FILA_ATENDIMENTO de
// server/src/mapoteca/query_fragments.js), entao 'Aguardando producao' nunca
// chega nesta lista, e o 4 e o 8 pertencem a seccao de baixo. O 7 estava aqui
// como um "qualquer coisa que nao seja Remetido", e passava porque a tela
// partia a lista por `!estaRemetido`.
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
    situacao_pedido_id: 3, situacao_pedido_nome: 'Em andamento',
    data_pedido: '2026-07-01', prazo: null, dias_para_prazo: null,
    documento_solicitacao: 'DIEx 456', total_itens: 0, itens_impressos: 0,
    quantidade_pedida: 0, quantidade_impressa: 0,
  },
  {
    id: 57, localizador_pedido: 'QQ11-WW22-EE33', cliente_nome: '3º RCC',
    // O rotulo do code 2 mudou em 2026-08-08: 'DIEx/Oficio do pedido recebido'
    // virou 'Pedido Recebido'. O code NAO mudou.
    situacao_pedido_id: 2, situacao_pedido_nome: 'Pedido Recebido',
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
  // A sessao padrao e a do GERENTE: ele ve a tela inteira, inclusive os caminhos
  // para a lista de pedidos. O recorte do operador tem casos proprios.
  entrarComo(GERENTE);
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
    // Com a query: a tela de atendimento quer a fila que INCLUI o Remetido,
    // porque e ela quem mostra o que falta fechar.
    expect(svc.getPedidosEmAberto).toHaveBeenCalledWith(true);
    // O título NÃO repete o rótulo do menu ("Atender pedidos"): rótulo repetido
    // gasta a primeira linha da tela sem informar.
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
      { produto_pedido_id: 900, quantidade: 2, observacao: undefined, data_impressao: undefined },
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

// A SEÇÃO "IMPRESSOS: AGUARDANDO ENVIO OU CONCLUSÃO".
//
// O pedido Aguardando envio (situação 8) e o Remetido (4), do DDL em
// er/mapoteca.sql, chegam pela MESMA leitura da fila, com
// `?incluir_remetidos=true`. O servidor tem duas listas de situação em aberto: a
// de IMPRESSÃO (2 e 3), que o plugin do QGIS espera, e a de ATENDIMENTO
// (2, 3, 8 e 4), que esta tela pede.
//
// Despachar e marcar Concluído são as duas últimas ações de quem atende, e eram
// elas que apagavam o pedido desta tela sem nada lembrar que faltava fechá-lo.
describe('renderAtendimento: o que a fila de impressão deixou para trás', () => {
  // A contagem de itens vem em `total_itens`, que e como GET /pedido/em_aberto a
  // chama. As fixturas diziam `quantidade_produtos`, campo da LISTA de pedidos
  // que aquela rota nunca devolveu: a coluna "Produtos" saia em branco na
  // producao e o teste nao via nada.
  const REMETIDO = {
    id: 81, localizador_pedido: 'RR11-TT22-YY33', cliente_nome: '4º BE Cmb',
    situacao_pedido_id: 4, situacao_pedido_nome: 'Remetido',
    data_pedido: '2026-05-02', documento_solicitacao: 'DIEx 900',
    total_itens: 3,
  };
  const CONCLUIDO = {
    id: 82, localizador_pedido: 'AA11-BB22-CC33', cliente_nome: '9º BE Cmb',
    situacao_pedido_id: 5, situacao_pedido_nome: 'Concluído',
    data_pedido: '2026-05-03', documento_solicitacao: 'DIEx 901',
    total_itens: 1,
  };

  const AGUARDANDO_ENVIO = {
    id: 83, localizador_pedido: 'EE44-FF55-GG66', cliente_nome: '2º BCom',
    situacao_pedido_id: 8, situacao_pedido_nome: 'Aguardando envio',
    data_pedido: '2026-05-04', documento_solicitacao: 'DIEx 902',
    total_itens: 7,
  };

  const secaoFechamento = (container) => [...container.querySelectorAll('.dashboard-section')]
    .find(s => s.textContent.includes('Impressos: aguardando envio ou conclusão'));

  test('lista o remetido e ignora o que já foi concluído', async () => {
    svc.getPedidosEmAberto.mockResolvedValue([REMETIDO, CONCLUIDO]);
    const { container, cleanup } = await montar();

    const secao = secaoFechamento(container);
    expect(secao).toBeTruthy();
    expect(secao.textContent).toContain('4º BE Cmb');
    expect(secao.textContent).not.toContain('9º BE Cmb');
    // Diz quantos faltam fechar: sem o número a seção seria só mais uma lista.
    expect(secao.textContent).toContain('1 pedido(s) a fechar');
    // E diz por que ele não está na fila acima.
    expect(secao.textContent).toContain('sai da fila acima');

    if (typeof cleanup === 'function') cleanup();
  });

  // A COLUNA "Produtos" LE `total_itens`, o campo que a rota da fila devolve.
  // Ela lia `quantidade_produtos`, que e da lista de pedidos e nao chega aqui:
  // a celula saia com um traco em toda linha, e a coluna nao dizia nada.
  test('a coluna Produtos mostra a contagem de itens da fila', async () => {
    svc.getPedidosEmAberto.mockResolvedValue([AGUARDANDO_ENVIO]);
    const { container, cleanup } = await montar();

    const celulas = [...secaoFechamento(container).querySelectorAll('tbody td')]
      .map(td => td.textContent);
    expect(celulas).toContain('7');

    if (typeof cleanup === 'function') cleanup();
  });

  // UMA leitura alimenta as DUAS tabelas. Antes esta seção varria
  // GET /pedido?ano= no ano corrente e no anterior, porque não havia rota que
  // devolvesse Remetido: a janela de dois anos era arbitrária e escondia o
  // pedido mais antigo. Duas leituras também abriam a janela em que a fila e os
  // remetidos discordavam por virem de consultas diferentes.
  test('uma leitura só alimenta a fila e os remetidos', async () => {
    svc.getPedidosEmAberto.mockResolvedValue([REMETIDO]);
    const { cleanup } = await montar();

    expect(svc.getPedidosEmAberto).toHaveBeenCalledTimes(1);
    expect(svc.getPedidosEmAberto).toHaveBeenCalledWith(true);
    expect(svc.getPedidos).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  test('nada a fechar é dito com palavras, e não com tabela vazia', async () => {
    svc.getPedidosEmAberto.mockResolvedValue([CONCLUIDO]);
    const { container, cleanup } = await montar();

    expect(secaoFechamento(container).textContent)
      .toContain('Nenhum pedido esperando envio ou conclusão');

    if (typeof cleanup === 'function') cleanup();
  });

  // Erro de carga NÃO pode virar "nenhum pedido remetido": as duas frases pedem
  // ações opostas.
  test('erro na busca aparece como erro, e não como lista vazia', async () => {
    svc.getPedidosEmAberto.mockRejectedValue(new Error('Falha ao consultar os pedidos'));
    const { container, cleanup } = await montar();

    const secao = secaoFechamento(container);
    expect(secao.textContent).toContain('Falha ao consultar os pedidos');
    expect(secao.textContent).not.toContain('Nenhum pedido esperando envio ou conclusão');

    if (typeof cleanup === 'function') cleanup();
  });

  // DOIS links, e não um: a lista de pedidos filtra por UMA situação, e a seção
  // mostra duas. Um link só mandaria metade da seção para uma tela que não a
  // contém.
  test('os links levam à lista de pedidos, um por situação', async () => {
    svc.getPedidosEmAberto.mockResolvedValue([]);
    const { container, cleanup } = await montar();

    const secao = secaoFechamento(container);
    expect(secao.querySelector('a[href*="filtro=remetido"]').getAttribute('href'))
      .toBe('#/mapoteca/pedidos?filtro=remetido');
    expect(secao.querySelector('a[href*="filtro=aguardando_envio"]').getAttribute('href'))
      .toBe('#/mapoteca/pedidos?filtro=aguardando_envio');

    if (typeof cleanup === 'function') cleanup();
  });

  // O QUE ESTE TESTE IMPEDE DE VOLTAR. A tela partia a fila de atendimento por
  // `!estaRemetido`, e o Aguardando envio (8) entrou no domínio em 2026-08-24.
  // Com o teste negado, um pedido JÁ IMPRESSO voltaria para a mesa de quem
  // imprime, com a ação "Atender (imprimir e registrar)" ao lado.
  test('o pedido em Aguardando envio fica fora da fila de impressão', async () => {
    svc.getPedidosEmAberto.mockResolvedValue([AGUARDANDO_ENVIO, REMETIDO]);
    const { container, cleanup } = await montar();

    // A PROVA de que nenhum dos dois subiu para a fila de cima: ela se declara
    // limpa, e o contador dela conta zero. Procurar a ausência do nome no
    // container inteiro não provaria nada, porque o nome está na seção de baixo.
    expect(container.querySelector('.page__meta').textContent)
      .toBe('0 pedido(s) em aberto');
    expect(container.textContent).toContain('A fila está limpa.');

    const secao = secaoFechamento(container);
    expect(secao.textContent).toContain('2º BCom');
    expect(secao.textContent).toContain('Aguardando envio');
    // A situação aparece na linha: sem ela, "falta despachar" e "falta
    // concluir" seriam a mesma linha cinza.
    expect(secao.textContent).toContain('Remetido');
    expect(secao.textContent).toContain('2 pedido(s) a fechar');

    if (typeof cleanup === 'function') cleanup();
  });

  // Quem despacha precisa da etiqueta, e o pedido em Aguardando envio já saiu da
  // fila de cima, onde a etiqueta morava sozinha.
  test('a etiqueta de envio alcança o pedido que aguarda envio', async () => {
    svc.getPedidosEmAberto.mockResolvedValue([AGUARDANDO_ENVIO]);
    const { container, cleanup } = await montar();

    const botao = secaoFechamento(container)
      .querySelector('[title="Etiqueta de envio"]');
    expect(botao).toBeTruthy();

    if (typeof cleanup === 'function') cleanup();
  });
});

// O RECORTE DO OPERADOR.
//
// Esta tela e dele ('/atendimento' declara `perfis: ['operador','gerente']`), e
// '/pedidos' e '/pedidos/:id' declaram `perfis: ['consulta','gerente']`: o
// operador NAO abre nenhuma das duas, e o guarda de rota o manda para
// '#/unauthorized'. Todo caminho daqui para la era, para ele, um clique que
// sempre falhava.
describe('renderAtendimento: o operador nao ve caminho para tela que nao abre', () => {
  const REMETIDO = {
    id: 81, localizador_pedido: 'RR11-TT22-YY33', cliente_nome: '4º BE Cmb',
    situacao_pedido_id: 4, situacao_pedido_nome: 'Remetido',
    data_pedido: '2026-05-02', total_itens: 3,
  };

  test('sem "Abrir o pedido" e sem os links da lista de pedidos', async () => {
    entrarComo(OPERADOR);
    svc.getPedidosEmAberto.mockResolvedValue([...PEDIDOS, REMETIDO]);
    const { container, cleanup } = await montar();

    expect(container.querySelector('[title="Abrir o pedido"]')).toBeNull();
    expect(container.querySelector('a[href*="/mapoteca/pedidos"]')).toBeNull();
    // O que ele PODE fazer continua na tela.
    expect(container.querySelector('[title="Etiqueta de envio"]')).toBeTruthy();
    expect(acaoDaLinha(container, 'Atender')).toBeTruthy();
    // E a instrucao passa a dizer de quem e a marca de Remetido, em vez de
    // mandar o operador fazer o que so o gerente faz.
    expect(container.textContent).toContain('é do gerente, na lista de pedidos');

    if (typeof cleanup === 'function') cleanup();
  });

  test('no painel de atender, o operador nao ve "Abrir o pedido"', async () => {
    entrarComo(OPERADOR);
    const { container, cleanup } = await montar();

    acaoDaLinha(container, 'Atender').click();
    await flush();

    const rodape = [...document.querySelectorAll('.modal__footer button')]
      .map(b => b.textContent.trim());
    expect(rodape).not.toContain('Abrir o pedido');
    expect(rodape).toContain('Etiqueta de envio');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o gerente continua com os tres caminhos', async () => {
    entrarComo(GERENTE);
    svc.getPedidosEmAberto.mockResolvedValue([...PEDIDOS, REMETIDO]);
    const { container, cleanup } = await montar();

    expect(container.querySelector('[title="Abrir o pedido"]')).toBeTruthy();
    expect(container.querySelectorAll('a[href*="/mapoteca/pedidos"]')).toHaveLength(2);

    if (typeof cleanup === 'function') cleanup();
  });
});
