import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A IMPRESSAO EM LOTE: o mesmo dialogo recebendo VARIOS itens do pedido.
//
// Arquivo proprio, e nao casos acrescentados a dialog-impressao.test.js: la
// mora o contrato do item UNICO, que continua valendo inteiro (a fila de
// atendimento so usa aquele). Misturar os dois faria a suite do caso simples
// falhar por causa do caso novo.
//
// O que se guarda aqui e o que o servidor NUNCA precisou mudar: POST
// /mapoteca/impressao sempre recebeu `registros: [...]` e grava numa transacao.
// Se alguem "otimizar" o dialogo para mandar uma chamada por item, estes testes
// reprovam -- e a razao e que meia gravacao nao pode existir.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { openRegistrarImpressaoDialog } from '@modules/mapoteca/pages/pedidos/dialog-impressao.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

// Tres itens como o DETALHE do pedido os entrega (rota /pedido/:id: o id do
// item se chama `id`). O terceiro esta CONCLUIDO, e e o caso da folha rasgada.
const ITENS = [
  {
    id: 900, produto_nome: 'Porto Alegre', mi: '2987-2',
    quantidade: 10, quantidade_impressa: 4, quantidade_restante: 6,
  },
  {
    id: 901, produto_nome: 'Canoas', mi: '2987-1',
    quantidade: 8, quantidade_impressa: 0, quantidade_restante: 8,
  },
  {
    id: 902, produto_nome: 'Gravataí', mi: '2987-3',
    quantidade: 5, quantidade_impressa: 5, quantidade_restante: 0,
  },
];

const campos = () => [...document.querySelectorAll('input[type="number"]')];
const campoData = () => [...document.querySelectorAll('input[type="date"]')].pop();
const textarea = () => [...document.querySelectorAll('textarea')].pop();
const botao = (rotulo) => [...document.querySelectorAll('button')]
  .filter(b => b.textContent.trim() === rotulo).pop();

const digitar = (input, valor) => {
  input.value = String(valor);
  input.dispatchEvent(new Event('input', { bubbles: true }));
};

const hojeIso = () => {
  const d = new Date();
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

beforeEach(() => {
  svc.registrarImpressao.mockResolvedValue(null);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('registrar impressao em LOTE', () => {
  test('uma linha por item, cada uma proposta com o RESTANTE dela', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    const valores = campos().map(c => Number(c.value));
    // 6 e 8 sao os restantes; o terceiro esta concluido e nasce em 1, e nao em
    // zero: selecionar um item concluido so faz sentido para REIMPRIMIR, e
    // nascer em zero o deixaria de fora sem avisar.
    expect(valores).toEqual([6, 8, 1]);
  });

  test('manda UMA chamada so, com um registro por item', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    botao('Registrar').click();
    await flush();

    expect(svc.registrarImpressao).toHaveBeenCalledTimes(1);
    const registros = svc.registrarImpressao.mock.calls[0][0];
    expect(registros).toHaveLength(3);
    expect(registros.map(r => r.produto_pedido_id)).toEqual([900, 901, 902]);
    expect(registros.map(r => r.quantidade)).toEqual([6, 8, 1]);
  });

  test('linha em ZERO fica de fora, e as outras vao', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    digitar(campos()[1], 0);
    botao('Registrar').click();
    await flush();

    const registros = svc.registrarImpressao.mock.calls[0][0];
    expect(registros).toHaveLength(2);
    expect(registros.map(r => r.produto_pedido_id)).toEqual([900, 902]);
  });

  test('todas as linhas em zero NAO grava nada, e acusa', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    botao('Zerar tudo').click();
    botao('Registrar').click();
    await flush();

    expect(svc.registrarImpressao).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Informe a quantidade de ao menos um item');
  });

  test('a observacao e a data valem para TODOS os registros', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    textarea().value = 'Plotter 2';
    campoData().value = '2026-08-01';
    botao('Registrar').click();
    await flush();

    const registros = svc.registrarImpressao.mock.calls[0][0];
    expect(registros).toHaveLength(3);
    for (const r of registros) {
      expect(r.observacao).toBe('Plotter 2');
      expect(r.data_impressao).toBe('2026-08-01');
    }
  });

  test('data de HOJE nao vai no corpo, para o servidor gravar o instante', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    expect(campoData().value).toBe(hojeIso());
    botao('Registrar').click();
    await flush();

    const registros = svc.registrarImpressao.mock.calls[0][0];
    for (const r of registros) expect(r.data_impressao).toBeUndefined();
  });

  test('"Preencher com o restante" devolve a proposta de cada linha', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    digitar(campos()[0], 1);
    digitar(campos()[1], 2);
    botao('Preencher com o restante').click();

    expect(campos().map(c => Number(c.value))).toEqual([6, 8, 1]);
  });

  test('o total ao vivo conta copias E itens, e ignora os zerados', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    // 6 + 8 + 1
    expect(document.body.textContent).toContain('15 cópia(s)');
    expect(document.body.textContent).toContain('3 item(ns)');

    digitar(campos()[2], 0);
    expect(document.body.textContent).toContain('14 cópia(s)');
    expect(document.body.textContent).toContain('2 item(ns)');
  });

  test('data futura reprova, e nada e gravado', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    campoData().value = '2099-01-01';
    botao('Registrar').click();
    await flush();

    expect(svc.registrarImpressao).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('A data não pode ser futura');
  });

  test('o callback so roda depois da gravacao, e nao antes', async () => {
    const onDone = vi.fn();
    openRegistrarImpressaoDialog(ITENS, onDone);
    await flush();

    expect(onDone).not.toHaveBeenCalled();
    botao('Registrar').click();
    await flush();
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  test('falha do servidor NAO fecha o dialogo nem chama o callback', async () => {
    svc.registrarImpressao.mockRejectedValue(new Error('banco fora'));
    const onDone = vi.fn();
    openRegistrarImpressaoDialog(ITENS, onDone);
    await flush();

    botao('Registrar').click();
    await flush();

    expect(onDone).not.toHaveBeenCalled();
    expect(campos()).toHaveLength(3);
  });

  // --- A FORMA da lista -----------------------------------------------------
  //
  // A primeira versao empilhava um campo de largura inteira por item, com o
  // MESMO texto de ajuda repetido embaixo de cada um. Com 10 itens virou uma
  // parede, e o chefe reprovou a tela. Estes casos guardam a forma, e nao so o
  // comportamento: e a tabela que faz o dialogo caber.
  test('a lista de varios itens e uma TABELA, uma linha por item', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    const tabela = document.querySelector('table.data-table');
    expect(tabela).not.toBeNull();
    expect(tabela.querySelectorAll('tbody tr')).toHaveLength(3);
    expect([...tabela.querySelectorAll('thead th')].map(t => t.textContent))
      .toEqual(['Produto', 'MI', 'Pedidas', 'Impressas', 'Restante', 'Cópias agora']);
  });

  test('a linha mostra os numeros do item, sem repetir texto de ajuda', async () => {
    openRegistrarImpressaoDialog(ITENS, () => {});
    await flush();

    const primeira = [...document.querySelectorAll('table.data-table tbody tr')][0];
    const celulas = [...primeira.querySelectorAll('td')].map(td => td.textContent);
    expect(celulas.slice(0, 5)).toEqual(['Porto Alegre', '2987-2', '10', '4', '6']);

    // O texto que antes se repetia por item aparece ZERO vezes: ele virou
    // cabecalho de coluna.
    const corpo = document.body.textContent;
    expect(corpo).not.toContain('Zero deixa este item de fora');
    expect(corpo.match(/Pedidas \d+, já impressas/g)).toBeNull();
  });

  test('UM item numa lista se comporta como o dialogo de sempre', async () => {
    openRegistrarImpressaoDialog([ITENS[0]], () => {});
    await flush();

    // Sem os atalhos de lote, que so pagam o espaco com muitas linhas.
    expect(botao('Zerar tudo')).toBeUndefined();
    expect(campos()).toHaveLength(1);

    botao('Registrar').click();
    await flush();

    const registros = svc.registrarImpressao.mock.calls[0][0];
    expect(registros).toEqual([expect.objectContaining({ produto_pedido_id: 900, quantidade: 6 })]);
  });
});
