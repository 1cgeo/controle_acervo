import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// O REMONTE da tela de ATENDER PEDIDOS, medido em 2026-08-04.
//
// É a tela onde alguém trabalha o turno inteiro, item após item. Cada registro
// de impressão chamava `carregar()` e `pintar()`, e as duas esvaziavam o
// container e montavam uma tabela NOVA. Quem tinha buscado um cliente na fila
// perdia a busca a cada item registrado, e voltava a procurar do zero.
//
// Estes testes provam a IDENTIDADE do nó (===), e não o texto na tela.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderAtendimento } from '@modules/mapoteca/pages/atendimento/index.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const FILA = [
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
      uuid_arquivo: null, arquivo_nome: null, arquivo_nome_fisico: null, tamanho_mb: null,
    },
  ],
  impressao: { total_itens: 2, itens_concluidos: 0, concluida: false, itens_sem_arquivo: 1 },
};

// Cópia PROFUNDA a cada chamada, como o servidor devolve. Devolver sempre o
// mesmo objeto faria a reconciliação casar por identidade de referência, e o
// teste aprovaria código que na tela real perde a linha a toda recarga. Os
// itens do painel não têm `id`: a chave estável deles é `produto_pedido_id`.
const copia = (valor) => JSON.parse(JSON.stringify(valor));

const montar = async () => {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderAtendimento(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
};

const buscaDaFila = (container) => container.querySelector('.data-table-toolbar__search-input');
const linhasDaFila = (container) => [...container.querySelectorAll('tbody tr')];
const infoDaFila = (container) => {
  const info = container.querySelector('.pagination__info span');
  return info ? info.textContent : null;
};
const botaoAtualizar = (container) => container.querySelector('.page__actions button');

const acaoDaLinha = (container, titulo, indiceLinha = 0) => {
  const linha = linhasDaFila(container)[indiceLinha];
  return [...linha.querySelectorAll('button')].find(b => (b.title || '').includes(titulo));
};

const digitarBusca = (container, texto) => {
  const campo = buscaDaFila(container);
  campo.value = texto;
  campo.dispatchEvent(new Event('input'));
  return campo;
};

/** O painel de atendimento de UM pedido, entre os modais abertos. */
const painel = () => [...document.querySelectorAll('.modal')].find(m => {
  const titulo = m.querySelector('.modal__title');
  return titulo && titulo.textContent.startsWith('Atender pedido');
});

const linhasDoPainel = () => [...painel().querySelectorAll('tbody tr')];
const tabelaDoPainel = () => painel().querySelector('.data-table-wrapper');

/** Registra a impressão do primeiro item do painel, aceitando o padrão. */
const registrarPrimeiroItem = async () => {
  const registrar = [...painel().querySelectorAll('button')]
    .find(b => (b.title || '').includes('Registrar impressão'));
  registrar.click();
  await flush();

  const confirmar = [...document.querySelectorAll('button')]
    .filter(b => b.textContent.trim() === 'Registrar').pop();
  confirmar.click();
  await flush();
};

beforeEach(() => {
  svc.getPedidosEmAberto.mockImplementation(async () => copia(FILA));
  svc.getImpressaoDoPedido.mockImplementation(async () => copia(IMPRESSAO));
  svc.registrarImpressao.mockResolvedValue(null);
  svc.baixarCartaDoPedido.mockResolvedValue();
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('fila de atendimento: o que sobrevive a uma recarga', () => {
  test('a tabela da fila e o MESMO objeto depois de Atualizar', async () => {
    const { container, cleanup } = await montar();

    const tabela = container.querySelector('.data-table-wrapper');
    expect(tabela).toBeTruthy();

    botaoAtualizar(container).click();
    await flush();

    expect(container.querySelector('.data-table-wrapper')).toBe(tabela);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a linha do pedido mantem o mesmo <tr>', async () => {
    const { container, cleanup } = await montar();

    const linha = linhasDaFila(container)[0];

    botaoAtualizar(container).click();
    await flush();

    expect(linhasDaFila(container)[0]).toBe(linha);

    if (typeof cleanup === 'function') cleanup();
  });

  test('a busca digitada sobrevive ao Atualizar', async () => {
    const { container, cleanup } = await montar();

    const campo = digitarBusca(container, 'bi');
    expect(linhasDaFila(container).length).toBe(1);

    botaoAtualizar(container).click();
    await flush();

    expect(buscaDaFila(container)).toBe(campo);
    expect(campo.value).toBe('bi');
    // O VALOR do campo sem o filtro aplicado seria mentira na tela.
    expect(linhasDaFila(container).length).toBe(1);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o foco do teclado na busca sobrevive ao Atualizar', async () => {
    const { container, cleanup } = await montar();

    const campo = buscaDaFila(container);
    campo.focus();
    expect(document.activeElement).toBe(campo);

    botaoAtualizar(container).click();
    await flush();

    expect(document.activeElement).toBe(campo);

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem estava na página 2 da fila continua na página 2', async () => {
    const fila20 = Array.from({ length: 20 }, (_, i) => ({
      ...FILA[0], id: 100 + i, cliente_nome: `OM ${String(i + 1).padStart(2, '0')}`,
    }));
    svc.getPedidosEmAberto.mockImplementation(async () => copia(fila20));

    const { container, cleanup } = await montar();

    // Páginas de 10, e não de 15: o `pageSize: 15` da tela não está na lista de
    // tamanhos do data-table, e ele cai para 10. Comportamento antigo do
    // componente, e não objeto desta correção.
    container.querySelector('[aria-label="Próxima página"]').click();
    expect(infoDaFila(container)).toBe('11-20 de 20');

    botaoAtualizar(container).click();
    await flush();

    expect(infoDaFila(container)).toBe('11-20 de 20');

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('painel de atendimento: o turno inteiro, item após item', () => {
  test('registrar impressão nao recria a tabela de itens do painel', async () => {
    const { container, cleanup } = await montar();

    acaoDaLinha(container, 'Atender').click();
    await flush();

    const tabela = tabelaDoPainel();
    expect(tabela).toBeTruthy();

    await registrarPrimeiroItem();

    expect(tabelaDoPainel()).toBe(tabela);

    if (typeof cleanup === 'function') cleanup();
  });

  // Os itens do painel não têm `id` nem `uuid`: sem uma chave estável
  // declarada, cada carga traz objetos novos e nenhuma linha se reaproveita.
  test('a linha do item mantem o mesmo <tr> depois de registrar', async () => {
    const { container, cleanup } = await montar();

    acaoDaLinha(container, 'Atender').click();
    await flush();

    const linha = linhasDoPainel()[0];
    expect(linha).toBeTruthy();

    await registrarPrimeiroItem();

    expect(linhasDoPainel()[0]).toBe(linha);

    if (typeof cleanup === 'function') cleanup();
  });

  // O caso que o chefe descreveu: a pessoa procura o cliente na fila, atende, e
  // a busca que ela digitou desaparece a cada item registrado.
  test('a busca da fila sobrevive ao registro de impressão', async () => {
    const { container, cleanup } = await montar();

    const campo = digitarBusca(container, 'bi');
    expect(linhasDaFila(container).length).toBe(1);

    acaoDaLinha(container, 'Atender').click();
    await flush();
    expect(svc.getImpressaoDoPedido).toHaveBeenCalledWith(55);

    await registrarPrimeiroItem();

    expect(buscaDaFila(container)).toBe(campo);
    expect(campo.value).toBe('bi');
    expect(linhasDaFila(container).length).toBe(1);

    if (typeof cleanup === 'function') cleanup();
  });

  test('o resumo de impressão do painel muda de TEXTO sem trocar de nó', async () => {
    const { container, cleanup } = await montar();

    acaoDaLinha(container, 'Atender').click();
    await flush();

    const resumo = painel().querySelector('.detail-card__label');
    expect(resumo.textContent).toBe('0/2 itens impressos');

    svc.getImpressaoDoPedido.mockImplementation(async () => {
      const dados = copia(IMPRESSAO);
      dados.impressao.itens_concluidos = 1;
      return dados;
    });

    await registrarPrimeiroItem();

    expect(painel().querySelector('.detail-card__label')).toBe(resumo);
    expect(resumo.textContent).toBe('1/2 itens impressos');

    if (typeof cleanup === 'function') cleanup();
  });
});
