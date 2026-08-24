import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O dialogo que muda SO a situacao do pedido, aberto pelo chip da lista.
//
// O QUE ESTES CASOS GUARDAM: que ele nunca chama `updatePedido` (o PUT que
// reescreve a linha inteira e apagaria nove campos que a lista nao tem), e que
// o corpo leva SO o que a situacao escolhida exige, porque chave ausente
// preserva o valor gravado no servidor.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { openSituacaoPedidoDialog } from '@modules/mapoteca/pages/pedidos/dialog-situacao.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const SITUACOES = [
  { code: 2, nome: 'Pedido Recebido' },
  { code: 3, nome: 'Em andamento' },
  { code: 4, nome: 'Remetido' },
  { code: 5, nome: 'Concluído' },
  { code: 6, nome: 'Cancelado' },
  { code: 7, nome: 'Aguardando produção' },
  { code: 8, nome: 'Aguardando envio' },
];

// A linha como a LISTA a entrega: sem motivo_cancelamento, sem ponto_contato,
// sem observacao. E essa pobreza que justifica a rota propria.
const PEDIDO = {
  id: 192,
  localizador_pedido: 'AB12-CD34-EF56',
  cliente_nome: '14ª Bda Inf Mtz',
  data_pedido: '2026-06-10',
  situacao_pedido_id: 3,
  situacao_pedido_nome: 'Em andamento',
};

const select = () => document.querySelector('select');
const campoData = () => document.querySelector('input[type="date"]');
const campoMotivo = () => document.querySelector('textarea');
const botao = (rotulo) => [...document.querySelectorAll('button')]
  .filter(b => b.textContent.trim() === rotulo).pop();

const escolher = (code) => {
  const s = select();
  s.value = String(code);
  s.dispatchEvent(new Event('change'));
};

const visivel = (campo) => campo && campo.closest('.form-field').style.display !== 'none';

beforeEach(() => {
  svc.getDominioSituacaoPedido.mockResolvedValue(SITUACOES);
  svc.updateSituacaoPedido.mockResolvedValue(null);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('openSituacaoPedidoDialog', () => {
  test('abre na situacao atual do pedido, com os rotulos do servidor', async () => {
    await openSituacaoPedidoDialog(PEDIDO, () => {});
    await flush();

    expect(select().value).toBe('3');
    expect(document.body.textContent).toContain('Aguardando envio');
    expect(document.body.textContent).toContain('14ª Bda Inf Mtz');
  });

  test('so a situacao vai no corpo quando ela nao exige mais nada', async () => {
    const recarregar = vi.fn();
    await openSituacaoPedidoDialog(PEDIDO, recarregar);
    await flush();

    escolher(8);
    botao('Salvar').click();
    await flush();

    expect(svc.updateSituacaoPedido).toHaveBeenCalledWith(192, { situacao_pedido_id: 8 });
    // Chave ausente preserva: mandar data ou motivo aqui apagaria o registro de
    // um atendimento ou de um cancelamento anterior.
    expect(svc.updateSituacaoPedido.mock.calls[0][1]).not.toHaveProperty('data_atendimento');
    expect(svc.updateSituacaoPedido.mock.calls[0][1]).not.toHaveProperty('motivo_cancelamento');
    expect(recarregar).toHaveBeenCalled();
  });

  test('NUNCA chama updatePedido, que reescreveria a linha inteira', async () => {
    await openSituacaoPedidoDialog(PEDIDO, () => {});
    await flush();

    escolher(4);
    botao('Salvar').click();
    await flush();

    expect(svc.updatePedido).not.toHaveBeenCalled();
  });

  test('Concluido mostra a data de atendimento e a manda no corpo', async () => {
    await openSituacaoPedidoDialog(PEDIDO, () => {});
    await flush();

    expect(visivel(campoData())).toBe(false);
    escolher(5);
    expect(visivel(campoData())).toBe(true);

    campoData().value = '2026-06-20';
    botao('Salvar').click();
    await flush();

    expect(svc.updateSituacaoPedido).toHaveBeenCalledWith(192, {
      situacao_pedido_id: 5,
      data_atendimento: '2026-06-20',
    });
  });

  test('Concluido sem data nao sai daqui', async () => {
    await openSituacaoPedidoDialog(PEDIDO, () => {});
    await flush();

    escolher(5);
    campoData().value = '';
    botao('Salvar').click();
    await flush();

    expect(svc.updateSituacaoPedido).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Informe a data de atendimento');
  });

  test('data anterior a do pedido nao sai daqui', async () => {
    await openSituacaoPedidoDialog(PEDIDO, () => {});
    await flush();

    escolher(5);
    campoData().value = '2026-06-09';
    botao('Salvar').click();
    await flush();

    expect(svc.updateSituacaoPedido).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('anterior à data do pedido');
  });

  test('Cancelado exige o motivo e o manda no corpo', async () => {
    await openSituacaoPedidoDialog(PEDIDO, () => {});
    await flush();

    escolher(6);
    expect(visivel(campoMotivo())).toBe(true);

    botao('Salvar').click();
    await flush();
    expect(svc.updateSituacaoPedido).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Informe o motivo do cancelamento');

    campoMotivo().value = 'O exercicio foi cancelado';
    botao('Salvar').click();
    await flush();

    expect(svc.updateSituacaoPedido).toHaveBeenCalledWith(192, {
      situacao_pedido_id: 6,
      motivo_cancelamento: 'O exercicio foi cancelado',
    });
  });

  test('erro do servidor mantem o dialogo aberto e nao recarrega a lista', async () => {
    const recarregar = vi.fn();
    svc.updateSituacaoPedido.mockRejectedValue(new Error('Pedido não encontrado'));

    await openSituacaoPedidoDialog(PEDIDO, recarregar);
    await flush();

    escolher(4);
    botao('Salvar').click();
    await flush();

    expect(recarregar).not.toHaveBeenCalled();
    expect(select()).not.toBeNull();
  });

  test('sem o dominio o dialogo nem abre', async () => {
    svc.getDominioSituacaoPedido.mockRejectedValue(new Error('sem rede'));

    await openSituacaoPedidoDialog(PEDIDO, () => {});
    await flush();

    // Um select vazio diria que o pedido nao aceita situacao nenhuma.
    expect(select()).toBeNull();
  });
});
