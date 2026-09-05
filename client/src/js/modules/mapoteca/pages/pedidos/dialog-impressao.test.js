import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O dialogo de REGISTRAR IMPRESSAO, compartilhado pela fila de atendimento e
// pelo detalhe do pedido. Ele so escreve por uma rota (POST /mapoteca/impressao),
// entao o mock do service cobre tudo.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { openRegistrarImpressaoDialog } from '@modules/mapoteca/pages/pedidos/dialog-impressao.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

// Item como a FILA o entrega (rota /pedido/:id/impressao): o id do item se chama
// produto_pedido_id.
const ITEM_DA_FILA = {
  produto_pedido_id: 900,
  produto_nome: 'Porto Alegre',
  mi: '2987-2',
  quantidade: 10,
  quantidade_impressa: 4,
  quantidade_restante: 6,
};

// Item como o DETALHE do pedido o entrega (rota /pedido/:id): o mesmo item, com
// o id chamado de `id`.
const ITEM_DO_DETALHE = {
  id: 900,
  produto_nome: 'Porto Alegre',
  mi: '2987-2',
  quantidade: 10,
  quantidade_impressa: 4,
  quantidade_restante: 6,
};

const campoQuantidade = () => [...document.querySelectorAll('input[type="number"]')].pop();
const campoData = () => [...document.querySelectorAll('input[type="date"]')].pop();
const botao = (rotulo) => [...document.querySelectorAll('button')]
  .filter(b => b.textContent.trim() === rotulo).pop();

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

describe('openRegistrarImpressaoDialog', () => {
  test('o padrao e o que FALTA imprimir', async () => {
    openRegistrarImpressaoDialog(ITEM_DA_FILA, () => {});
    await flush();

    expect(campoQuantidade().value).toBe('6');
  });

  // O erro que este texto evita nao aparece como erro em tela nenhuma: quem
  // entender que o campo e o TOTAL lanca 10 e o item passa a ter 14 impressas.
  test('deixa claro que o numero SOMA e nunca substitui', async () => {
    openRegistrarImpressaoDialog(ITEM_DA_FILA, () => {});
    await flush();

    const texto = document.body.textContent;
    expect(texto).toContain('Cópias que saíram AGORA');
    expect(texto).toContain('SOMA');
    expect(texto).toContain('nunca substitui');
    // E diz o resultado da conta, com o numero: 4 ja impressas mais 6 = 10.
    expect(texto).toContain('passa a ter 10 impressa(s)');
  });

  test('o total previsto acompanha o que a pessoa digita', async () => {
    openRegistrarImpressaoDialog(ITEM_DA_FILA, () => {});
    await flush();

    const campo = campoQuantidade();
    campo.value = '2';
    campo.dispatchEvent(new Event('input'));

    expect(document.body.textContent).toContain('passa a ter 6 impressa(s)');
  });

  test('registra pelo produto_pedido_id quando o item vem da fila', async () => {
    const onDone = vi.fn();
    openRegistrarImpressaoDialog(ITEM_DA_FILA, onDone);
    await flush();

    botao('Registrar').click();
    await flush();

    expect(svc.registrarImpressao).toHaveBeenCalledWith([
      { produto_pedido_id: 900, quantidade: 6, observacao: undefined, data_impressao: undefined },
    ]);
    expect(onDone).toHaveBeenCalled();
  });

  // O MESMO item, com o id no outro campo. Sem a normalizacao, esta chamada
  // sairia com produto_pedido_id undefined e o servidor recusaria o corpo.
  test('registra pelo id quando o item vem do detalhe do pedido', async () => {
    openRegistrarImpressaoDialog(ITEM_DO_DETALHE, () => {});
    await flush();

    botao('Registrar').click();
    await flush();

    expect(svc.registrarImpressao).toHaveBeenCalledWith([
      { produto_pedido_id: 900, quantidade: 6, observacao: undefined, data_impressao: undefined },
    ]);
  });

  test('manda a observacao quando a pessoa escreve uma', async () => {
    openRegistrarImpressaoDialog(ITEM_DA_FILA, () => {});
    await flush();

    const textarea = [...document.querySelectorAll('textarea')].pop();
    textarea.value = 'plotter 2, papel novo';

    botao('Registrar').click();
    await flush();

    expect(svc.registrarImpressao).toHaveBeenCalledWith([
      { produto_pedido_id: 900, quantidade: 6, observacao: 'plotter 2, papel novo', data_impressao: undefined },
    ]);
  });

  // A DATA DA IMPRESSAO. O servidor sempre aceitou `data_impressao` em POST
  // /mapoteca/impressao, e a tela nunca a oferecia: quem lancava na segunda o
  // que imprimiu na sexta contava o papel no mes errado do RPCMTec.
  test('o campo de data nasce em hoje e trava data futura', async () => {
    openRegistrarImpressaoDialog(ITEM_DA_FILA, () => {});
    await flush();

    expect(campoData().value).toBe(hojeIso());
    expect(campoData().max).toBe(hojeIso());
  });

  test('a data de HOJE nao vai no corpo', async () => {
    // Sem o campo, o servidor grava o INSTANTE. Mandar a data de hoje jogaria
    // toda impressao do dia para a meia-noite, e duas do mesmo dia perderiam a
    // ordem entre si.
    openRegistrarImpressaoDialog(ITEM_DA_FILA, () => {});
    await flush();

    botao('Registrar').click();
    await flush();

    const [[registros]] = svc.registrarImpressao.mock.calls;
    expect(registros[0].data_impressao).toBeUndefined();
  });

  test('a data de outro dia vai no corpo', async () => {
    openRegistrarImpressaoDialog(ITEM_DA_FILA, () => {});
    await flush();

    campoData().value = '2026-07-31';
    botao('Registrar').click();
    await flush();

    expect(svc.registrarImpressao).toHaveBeenCalledWith([
      {
        produto_pedido_id: 900,
        quantidade: 6,
        observacao: undefined,
        // MEIO-DIA local, e nao o dia pelado: a coluna e TIMESTAMP, e o dia
        // pelado virava 30/07 as 21:00 em UTC-3 (ver o comentario no dialogo).
        data_impressao: '2026-07-31T12:00:00',
      },
    ]);
  });

  test('data em branco barra o envio', async () => {
    openRegistrarImpressaoDialog(ITEM_DA_FILA, () => {});
    await flush();

    campoData().value = '';
    botao('Registrar').click();
    await flush();

    expect(svc.registrarImpressao).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Informe a data da impressão');
  });

  // Item ja concluido: o restante e 0, e 0 copia nao e sessao de impressao.
  test('item sem restante nasce com 1, e nao com 0', async () => {
    openRegistrarImpressaoDialog({
      ...ITEM_DA_FILA, quantidade_impressa: 10, quantidade_restante: 0,
    }, () => {});
    await flush();

    expect(campoQuantidade().value).toBe('1');
  });

  test('quantidade vazia nao escreve nada no servidor', async () => {
    openRegistrarImpressaoDialog(ITEM_DA_FILA, () => {});
    await flush();

    const campo = campoQuantidade();
    campo.value = '';
    campo.dispatchEvent(new Event('input'));

    botao('Registrar').click();
    await flush();

    expect(svc.registrarImpressao).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Informe quantas cópias saíram');
  });

  // Livro-caixa: o erro do servidor nao pode fechar o dialogo, ou a pessoa nao
  // sabe se a sessao entrou e lanca de novo, dobrando a contagem.
  test('erro do servidor aparece e o dialogo continua aberto', async () => {
    svc.registrarImpressao.mockRejectedValueOnce(new Error('Item de pedido não encontrado'));
    const onDone = vi.fn();
    openRegistrarImpressaoDialog(ITEM_DA_FILA, onDone);
    await flush();

    botao('Registrar').click();
    await flush();

    expect(onDone).not.toHaveBeenCalled();
    expect(document.querySelector('.modal')).toBeTruthy();
  });
});
