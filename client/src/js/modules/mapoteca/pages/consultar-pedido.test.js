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

  // O que o cliente chama de "data do envio" e a data_atendimento: o pedido
  // fecha no dia em que o material sai. Nao existe coluna data_envio.
  test('mostra a data de envio/entrega quando o pedido ja foi atendido', async () => {
    svc.getPedidoPorLocalizador.mockResolvedValue({
      ...PEDIDO,
      situacao_pedido_id: 5,
      situacao_pedido_nome: 'Concluído',
      data_atendimento: '2026-06-25',
      localizador_envio: 'QN048384596BR',
    });
    const container = await montar('AB12-CD34-EF56');

    expect(container.textContent).toContain('Data de envio/entrega');
    expect(container.textContent).toContain('25/06/2026');
    expect(container.textContent).toContain('QN048384596BR');
  });

  test('pedido ainda nao atendido nao mostra a linha de envio', async () => {
    const container = await montar('AB12-CD34-EF56');
    expect(container.textContent).not.toContain('Data de envio/entrega');
  });

  // Colapsavel vazio era um convite a clicar para nao achar nada. No
  // pre-cadastramento e no pedido de LAI (que nao usa folha MI), pedido sem item
  // e o normal, nao cadastro pela metade.
  test('pedido sem item nao mostra o bloco colapsavel', async () => {
    svc.getPedidoPorLocalizador.mockResolvedValue({ ...PEDIDO, produtos: [] });
    const container = await montar('AB12-CD34-EF56');

    expect(container.querySelector('.consulta-collapse')).toBeNull();
    expect(container.textContent).not.toContain('O que foi pedido');
    // O cartao com a situacao continua, que e o que a pessoa veio ver.
    expect(container.textContent).toContain('Em andamento');
  });

  test('pedido com item mostra o colapsavel com a contagem no titulo', async () => {
    const container = await montar('AB12-CD34-EF56');

    expect(container.querySelector('.consulta-collapse')).not.toBeNull();
    expect(container.textContent).toContain('O que foi pedido');
  });

  // Esta e uma rota PUBLICA: quem chega aqui pode nao ter conta, e quem chegou
  // por engano ficava sem caminho de volta a nao ser editando a URL.
  test('tem saida de volta para a tela de entrada, com ou sem localizador', async () => {
    for (const params of [{ localizador: 'AB12-CD34-EF56' }, {}]) {
      const container = document.createElement('div');
      await renderConsultarPedido(container, { params, query: new URLSearchParams() });
      await flush();

      const voltar = container.querySelector('.consulta-card__voltar');
      expect(voltar).toBeTruthy();
      expect(voltar.getAttribute('href')).toBe('#/login');
      expect(voltar.textContent).toContain('Voltar');
    }
  });

});
