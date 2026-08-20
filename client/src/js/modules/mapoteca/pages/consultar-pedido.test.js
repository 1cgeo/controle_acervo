import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Consulta PUBLICA de pedido pelo localizador (RN04). E rota de PLATAFORMA, sem
// sessao: quem pediu acompanha o pedido sem ter conta no SCA. A pagina mora no
// modulo mapoteca porque so ela usa o service da mapoteca.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderConsultarPedido } from '@modules/mapoteca/pages/consultar-pedido.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

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
    expect(container.textContent).toContain('1 carta · 10 exemplares');
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

  // Colapsavel vazio era um convite a clicar para nao achar nada. No pedido
  // recem-recebido e no de LAI (que nao usa folha MI), pedido sem item e o
  // normal, nao cadastro pela metade.
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

  // --- miniatura da folha, situacao do envio e forma PREVISTA ---------------

  test('mostra a miniatura da folha, apontando para a rota publica do localizador', async () => {
    svc.getPedidoPorLocalizador.mockResolvedValue({
      ...PEDIDO,
      produtos: [{ ...PEDIDO.produtos[0], versao_id: 412, tem_miniatura: true }],
    });
    const container = await montar('AB12-CD34-EF56');

    const img = container.querySelector('.consulta-item__thumb');
    expect(img).toBeTruthy();
    expect(img.getAttribute('src')).toContain('/mapoteca/pedido/localizador/AB12-CD34-EF56/miniatura/412');
    // a imagem entra ANTES do texto: ela e a coluna da esquerda
    expect(img.nextElementSibling.className).toBe('consulta-item__corpo');
  });

  // O contrario tem de valer: sem miniatura NAO se pede imagem nenhuma, senao
  // cada item sem imagem vira um 404 e um icone quebrado na tela.
  test('nao pede imagem quando o item nao tem miniatura', async () => {
    for (const extra of [{}, { versao_id: 412, tem_miniatura: false }, { tem_miniatura: true }]) {
      svc.getPedidoPorLocalizador.mockResolvedValue({
        ...PEDIDO,
        produtos: [{ ...PEDIDO.produtos[0], ...extra }],
      });
      const container = await montar('AB12-CD34-EF56');
      expect(container.querySelector('.consulta-item__thumb')).toBeNull();
    }
  });

  test('a situacao do envio aparece mesmo sem rastreio, e acompanha a situacao', async () => {
    const casos = [
      [2, 'Pedido Recebido', 'Não enviado'],
      [3, 'Em andamento', 'Não enviado'],
      [4, 'Remetido', 'Enviado'],
      [5, 'Concluído', 'Enviado e concluído'],
    ];
    for (const [id, nome, esperado] of casos) {
      svc.getPedidoPorLocalizador.mockResolvedValue({
        ...PEDIDO, situacao_pedido_id: id, situacao_pedido_nome: nome,
      });
      const container = await montar('AB12-CD34-EF56');
      expect(container.textContent).toContain('Situação do envio');
      expect(container.textContent).toContain(esperado);
    }
  });

  // Cancelado nao tem envio a informar, e dizer "Nao enviado" ali soa como
  // pendencia num pedido que ja morreu.
  test('pedido cancelado nao mostra situacao de envio', async () => {
    svc.getPedidoPorLocalizador.mockResolvedValue({
      ...PEDIDO, situacao_pedido_id: 6, situacao_pedido_nome: 'Cancelado',
      motivo_cancelamento: 'Duplicado',
    });
    const container = await montar('AB12-CD34-EF56');
    expect(container.textContent).not.toContain('Situação do envio');
  });

  test('a forma de entrega e PREVISTA antes de remeter, e fato depois', async () => {
    svc.getPedidoPorLocalizador.mockResolvedValue({
      ...PEDIDO, situacao_pedido_id: 3, forma_entrega_nome: 'Correios',
    });
    let container = await montar('AB12-CD34-EF56');
    expect(container.textContent).toContain('Forma de envio prevista');
    expect(container.textContent).not.toContain('Forma de entrega');

    svc.getPedidoPorLocalizador.mockResolvedValue({
      ...PEDIDO, situacao_pedido_id: 4, forma_entrega_nome: 'Correios',
    });
    container = await montar('AB12-CD34-EF56');
    expect(container.textContent).toContain('Forma de entrega');
    expect(container.textContent).not.toContain('Forma de envio prevista');
  });

  test('mostra o contato do 1o CGEO para duvidas, e so quando ha contato', async () => {
    svc.getPedidoPorLocalizador.mockResolvedValue({
      ...PEDIDO, contato_mapoteca: '1º Ten Ventura - RITEX 832-2020',
    });
    let container = await montar('AB12-CD34-EF56');
    expect(container.textContent).toContain('Dúvidas sobre este pedido');
    expect(container.textContent).toContain('1º Ten Ventura - RITEX 832-2020');

    // sem contato gravado a linha nao aparece: 47 pedidos abertos nascem sem ele
    svc.getPedidoPorLocalizador.mockResolvedValue({ ...PEDIDO });
    container = await montar('AB12-CD34-EF56');
    expect(container.textContent).not.toContain('Dúvidas sobre este pedido');
  });


  test('o resumo usa singular ou plural conforme a quantidade', async () => {
    const casos = [
      [[{ ...PEDIDO.produtos[0], quantidade: 1 }], '1 carta · 1 exemplar'],
      [[{ ...PEDIDO.produtos[0], quantidade: 2 }], '1 carta · 2 exemplares'],
      [[{ ...PEDIDO.produtos[0], quantidade: 3 },
        { ...PEDIDO.produtos[0], quantidade: 4 }], '2 cartas · 7 exemplares'],
    ];
    for (const [produtos, esperado] of casos) {
      svc.getPedidoPorLocalizador.mockResolvedValue({ ...PEDIDO, produtos });
      const container = await montar('AB12-CD34-EF56');
      expect(container.textContent).toContain(esperado);
      // o "(s)" do gerador nao pode voltar
      expect(container.textContent).not.toContain('carta(s)');
      expect(container.textContent).not.toContain('exemplar(es)');
    }
  });

  // Clicar para ampliar foi retirado a pedido do chefe: a 190px a folha ja se
  // le, e o clique era promessa a mais na tela.
  test('a miniatura nao abre nada ao clicar', async () => {
    const abrir = vi.spyOn(window, 'open').mockImplementation(() => null);
    svc.getPedidoPorLocalizador.mockResolvedValue({
      ...PEDIDO,
      produtos: [{ ...PEDIDO.produtos[0], versao_id: 412, tem_miniatura: true }],
    });
    const container = await montar('AB12-CD34-EF56');
    container.querySelector('.consulta-item__thumb').click();
    expect(abrir).not.toHaveBeenCalled();
    abrir.mockRestore();
  });

});
