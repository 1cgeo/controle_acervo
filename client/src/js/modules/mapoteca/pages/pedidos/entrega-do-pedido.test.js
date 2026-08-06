import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { escolherNoCombo } from '@/__tests__/helpers/combo.js';

// A forma de entrega e a data de entrega são do PEDIDO, nunca do ITEM.
//
// Este arquivo prova o lado CLIENTE da regra nas quatro telas: o diálogo do
// item, o formulário do pedido, o detalhe e o wizard.
vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});
vi.mock('@services/plataforma-service.js', async () => {
  const { mockPlataformaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockPlataformaService();
});
vi.mock('@modules/mapoteca/services/acervo-service.js', async () => {
  const { mockAcervoService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockAcervoService();
});

import { openProdutoPedidoDialog } from '@modules/mapoteca/pages/pedidos/dialog-produto.js';
import { createPedidoFormFields } from '@modules/mapoteca/pages/pedidos/pedido-form.js';
import { renderPedidoDetails } from '@modules/mapoteca/pages/pedidos/details.js';
import { renderPedidoWizard } from '@modules/mapoteca/pages/pedidos/wizard.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import * as acervo from '@modules/mapoteca/services/acervo-service.js';

const FORMAS = [{ code: 1, nome: 'Correios' }, { code: 2, nome: 'Entrega em mãos' }];
const CLIENTES = [{ id: 1, nome: '1º CGEO', tipo_cliente_id: 1 }];
const SITUACOES = [{ code: 3, nome: 'Em andamento' }, { code: 5, nome: 'Concluído' }];

/** Campo do formulario pelo texto do rotulo (o rotulo carrega o `*` do obrigatorio). */
function campoPorRotulo(raiz, rotulo) {
  const label = [...raiz.querySelectorAll('.form-field__label')]
    .find(l => l.textContent.replace('*', '').trim() === rotulo);
  return label ? label.closest('.form-field') : null;
}

/**
 * Escolhe num campo pelo ROTULO dele, seja `<select>` ou combo buscavel.
 *
 * O Cliente virou combo em 2026-08-06 (a lista cresce a cada pedido de fora), e
 * os demais continuam `<select>`. O helper trata os dois para o caso nao ter de
 * saber qual e qual: o que ele testa e o pedido, e nao o widget.
 *
 * No combo o VALOR nao serve, porque ele nao expoe atributo de valor: passa-se o
 * texto que a pessoa digitaria, e o helper aceita os dois pelo tipo.
 */
function selecionar(raiz, rotulo, valor) {
  const campo = campoPorRotulo(raiz, rotulo);
  const select = campo.querySelector('select');
  if (select) {
    select.value = String(valor);
    select.dispatchEvent(new Event('change', { bubbles: true }));
    return select;
  }
  return escolherNoCombo(campo.querySelector('.combo'), valor);
}

beforeEach(() => {
  svc.getDominioTipoMidia.mockResolvedValue([{ code: 1, nome: 'Papel' }]);
  svc.getDominioFormaEntrega.mockResolvedValue(FORMAS);
  svc.getClientes.mockResolvedValue(CLIENTES);
  svc.getDominioSituacaoPedido.mockResolvedValue(SITUACOES);
  svc.getDominioCanalRecebimento.mockResolvedValue([{ code: 1, nome: 'Ouvidoria/LAI' }]);
  svc.getAnexosPedido.mockResolvedValue([]);
  acervo.getTiposProduto.mockResolvedValue([{ code: 1, nome: 'Carta Topográfica' }]);
  acervo.getTiposEscala.mockResolvedValue([{ code: 1, nome: '1:25.000' }]);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('dialogo do item', () => {
  test('nao oferece mais forma de entrega nem data de entrega', async () => {
    await openProdutoPedidoDialog({ onSubmit: vi.fn() });
    await flush();

    expect(campoPorRotulo(document.body, 'Forma de entrega')).toBeNull();
    expect(campoPorRotulo(document.body, 'Data de entrega')).toBeNull();
    // O que continua sendo do item nao pode ter saido junto.
    expect(campoPorRotulo(document.body, 'Quantidade fornecida')).not.toBeNull();
    expect(campoPorRotulo(document.body, 'Mídia fornecida')).not.toBeNull();
  });

  test('o payload do item nao carrega mais forma_entrega_id nem data_entrega', async () => {
    const onSubmit = vi.fn();
    await openProdutoPedidoDialog({ onSubmit });
    await flush();

    // O item avulso e o caminho curto: nao exige busca no catalogo do acervo.
    selecionar(document.body, 'Origem do produto', 'avulso');
    const nome = campoPorRotulo(document.body, 'O que vai ser impresso').querySelector('input');
    nome.value = 'Papel quadriculado';
    nome.dispatchEvent(new Event('input'));
    selecionar(document.body, 'Tipo de mídia', 1);

    [...document.querySelectorAll('button')].find(b => b.textContent === 'Adicionar').click();
    await flush();

    expect(onSubmit).toHaveBeenCalled();
    const { payload } = onSubmit.mock.calls[0][0];
    expect(Object.keys(payload)).not.toContain('forma_entrega_id');
    expect(Object.keys(payload)).not.toContain('data_entrega');
    expect(payload.quantidade).toBe(1);
  });
});

describe('formulario do pedido', () => {
  test('tem a forma de entrega do dominio e a devolve em getValues', () => {
    const form = createPedidoFormFields({
      clientes: CLIENTES, situacoes: SITUACOES, canais: [], formasEntrega: FORMAS,
    });
    const raiz = document.createElement('div');
    raiz.appendChild(form.adicionalElement);

    const campo = campoPorRotulo(raiz, 'Forma de entrega');
    expect(campo).not.toBeNull();
    expect([...campo.querySelectorAll('option')].map(o => o.textContent))
      .toContain('Entrega em mãos');

    selecionar(raiz, 'Forma de entrega', 2);
    expect(form.getValues().forma_entrega_id).toBe(2);
  });

  test('o pedido gravado ja abre com a forma dele selecionada', () => {
    const form = createPedidoFormFields({
      pedido: { forma_entrega_id: 1 },
      clientes: CLIENTES, situacoes: SITUACOES, canais: [], formasEntrega: FORMAS,
    });
    expect(form.getValues().forma_entrega_id).toBe(1);
  });
});

describe('detalhe do pedido', () => {
  const PEDIDO = {
    id: 55,
    cliente_id: 7,
    cliente_nome: '1º CGEO',
    localizador_pedido: 'AB12-CD34-EF56',
    situacao_pedido_id: 5,
    situacao_pedido_nome: 'Concluído',
    data_pedido: '2026-06-10',
    data_atendimento: '2026-06-20',
    forma_entrega_nome: 'Correios',
    palavras_chave: [],
    produtos: [{
      id: 900, produto_nome: 'Porto Alegre', mi: '2987-2', tipo_midia_nome: 'Papel',
      quantidade: 10, quantidade_impressa: 4, quantidade_restante: 6, impressao_concluida: false,
    }],
    impressao: { concluida: false, itens_concluidos: 0, total_itens: 1 },
  };

  async function montar() {
    svc.getPedido.mockResolvedValue(PEDIDO);
    const container = document.createElement('div');
    const cleanup = await renderPedidoDetails(container, {
      params: { id: '55' }, query: new URLSearchParams(),
    });
    await flush();
    return { container, cleanup };
  }

  test('a forma de entrega aparece no card Entrega, e nao na tabela de itens', async () => {
    const { container, cleanup } = await montar();

    const cardEntrega = [...container.querySelectorAll('.detail-card')]
      .find(c => c.querySelector('.detail-card__title')
        && c.querySelector('.detail-card__title').textContent === 'Entrega');
    expect(cardEntrega.textContent).toContain('Forma de entrega');
    expect(cardEntrega.textContent).toContain('Correios');

    const cabecalhos = [...container.querySelectorAll('th')].map(th => th.textContent);
    expect(cabecalhos).not.toContain('Entrega');
    expect(cabecalhos).not.toContain('Data de entrega');

    if (typeof cleanup === 'function') cleanup();
  });

  // A data do atendimento mora num lugar so. Repetida em dois cards, ela vira
  // duvida sobre serem duas datas diferentes.
  test('a data do atendimento fica no card Entrega, uma vez so', async () => {
    const { container, cleanup } = await montar();

    const rotulos = [...container.querySelectorAll('.detail-card__label')]
      .map(e => e.textContent.trim())
      .filter(t => t === 'Atendimento (envio/entrega)');
    expect(rotulos).toHaveLength(1);

    const cardEntrega = [...container.querySelectorAll('.detail-card')]
      .find(c => c.querySelector('.detail-card__title')
        && c.querySelector('.detail-card__title').textContent === 'Entrega');
    expect(cardEntrega.textContent).toContain('Atendimento (envio/entrega)');

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('wizard do novo pedido', () => {
  test('a revisao final mostra a forma de entrega escolhida', async () => {
    const container = document.createElement('div');
    const cleanup = await renderPedidoWizard(container, { params: {}, query: new URLSearchParams() });
    await flush();

    selecionar(container, 'Cliente', 'CGEO');
    selecionar(container, 'Situação', 3);
    selecionar(container, 'Forma de entrega', 1);

    const avancar = [...container.querySelectorAll('button')].find(b => b.textContent === 'Avançar');
    avancar.click(); await flush();
    avancar.click(); await flush();
    avancar.click(); await flush();

    const confirmacao = [...container.querySelectorAll('.wizard__content > div')]
      .find(p => !p.classList.contains('hidden'));
    expect(confirmacao.textContent).toContain('Forma de entrega');
    expect(confirmacao.textContent).toContain('Correios');
    expect(svc.createPedido).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });
});
