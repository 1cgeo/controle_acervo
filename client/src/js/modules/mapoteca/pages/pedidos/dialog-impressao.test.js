import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// O dialogo de REGISTRAR IMPRESSAO, compartilhado pela fila de atendimento e
// pelo detalhe do pedido. Ele so escreve por uma rota (POST /mapoteca/impressao),
// entao o mock do service cobre tudo.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { openRegistrarImpressaoDialog } from '@modules/mapoteca/pages/pedidos/dialog-impressao.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

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
const botao = (rotulo) => [...document.querySelectorAll('button')]
  .filter(b => b.textContent.trim() === rotulo).pop();

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
      { produto_pedido_id: 900, quantidade: 6, observacao: undefined },
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
      { produto_pedido_id: 900, quantidade: 6, observacao: undefined },
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
      { produto_pedido_id: 900, quantidade: 6, observacao: 'plotter 2, papel novo' },
    ]);
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
