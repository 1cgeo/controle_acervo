import { describe, test, expect, vi, beforeEach } from 'vitest';

// Consulta PUBLICA de pedido pelo localizador (RN04). E rota de PLATAFORMA, sem
// sessao: quem pediu acompanha o pedido sem ter conta no SCA. A pagina mora no
// modulo mapoteca porque so ela usa o service da mapoteca.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderConsultarPedido } from '@modules/mapoteca/pages/consultar-pedido.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const PEDIDO = {
  situacao_pedido_id: 3,
  situacao_pedido_nome: 'Em andamento',
  cliente_nome: '1º CGEO',
  data_pedido: '2026-06-10',
  prazo: '2026-06-30',
  observacao: 'Entregar na S3',
  produtos: [
    {
      produto_nome: 'Porto Alegre', mi: '2987-2', inom: 'SH-22-Y-B-VI-2',
      escala: '1:25.000', versao: '1', quantidade: 10, tipo_midia_nome: 'Papel',
    },
  ],
};

async function montar(localizador) {
  const container = document.createElement('div');
  await renderConsultarPedido(container, { params: localizador ? { localizador } : {} });
  await flush();
  return container;
}

describe('renderConsultarPedido', () => {
  beforeEach(() => {
    svc.getPedidoPorLocalizador.mockResolvedValue(PEDIDO);
  });

  test('busca o pedido e mostra situacao, cliente e itens', async () => {
    const container = await montar('AB12-CD34-EF56');

    expect(svc.getPedidoPorLocalizador).toHaveBeenCalledWith('AB12-CD34-EF56');
    expect(container.textContent).toContain('Acompanhamento de Pedido');
    expect(container.textContent).toContain('1º CGEO');
    expect(container.textContent).toContain('Em andamento');
    expect(container.textContent).toContain('1 carta(s) · 10 exemplar(es)');
  });

  test('normaliza o localizador para maiuscula antes de consultar', async () => {
    await montar('ab12-cd34-ef56');
    expect(svc.getPedidoPorLocalizador).toHaveBeenCalledWith('AB12-CD34-EF56');
  });

  test('formato invalido nao chega a chamar o service', async () => {
    const container = await montar('12345');

    expect(svc.getPedidoPorLocalizador).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Localizador em formato inválido');
  });

  test('sem localizador abre so com o campo de busca', async () => {
    const container = await montar(null);

    expect(svc.getPedidoPorLocalizador).not.toHaveBeenCalled();
    expect(container.textContent).toContain('Informe o localizador do pedido');
    expect(container.querySelector('.consulta-card__form')).not.toBeNull();
  });

  test('o formulario navega para a rota de PLATAFORMA, sem prefixo de modulo', async () => {
    const container = await montar(null);

    const input = container.querySelector('input');
    input.value = 'zz99-yy88-xx77';
    container.querySelector('.consulta-card__form').dispatchEvent(
      new Event('submit', { cancelable: true })
    );

    expect(location.hash).toBe('#/consultar-pedido/ZZ99-YY88-XX77');
  });

  test('pedido inexistente mostra a mensagem do servidor', async () => {
    svc.getPedidoPorLocalizador.mockRejectedValueOnce(new Error('Pedido não encontrado'));
    const container = await montar('AB12-CD34-EF56');

    expect(container.textContent).toContain('Pedido não encontrado');
  });
});
