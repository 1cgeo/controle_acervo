import { describe, test, expect } from 'vitest';

vi.mock('@services/plataforma-service.js', async () => {
  const { mockPlataformaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockPlataformaService();
});

import {
  createPedidoFormFields,
  aplicarModoPedido,
  modoDoTipoCliente,
  filtrarClientesPorModo,
  ROTULO_MODO,
} from '@modules/mapoteca/pages/pedidos/pedido-form.js';

const CLIENTES = [
  { id: 1, nome: '1º CGEO', tipo_cliente_id: 1 },
  { id: 2, nome: 'Base Aérea de Canoas', tipo_cliente_id: 2 },
  { id: 3, nome: 'Prefeitura de Porto Alegre', tipo_cliente_id: 5 },
];
const SITUACOES = [{ code: 3, nome: 'Em andamento' }, { code: 5, nome: 'Concluído' }];
const CANAIS = [{ code: 1, nome: 'Ouvidoria/LAI' }];
// A meta do PIT virou lista: sem opção cadastrada, o select
// nasce vazio e o teste do campo PREENCHIDO não teria o que selecionar.
const METAS = [
  { id: 8, ano: 2026, numero_meta: 4, item: '4.1', descricao: 'Impressão em sulfite' },
  { id: 9, ano: 2026, numero_meta: 4, item: '4.2', descricao: 'Impressão em Tyvek' },
];

/** Monta o formulário e a seção de civil, como as duas telas fazem. */
function montar(pedido = null) {
  const form = createPedidoFormFields({
    pedido, clientes: CLIENTES, situacoes: SITUACOES, canais: CANAIS, metas: METAS,
  });
  const civilElement = document.createElement('div');
  civilElement.appendChild(form.civilElement);
  return { form, civilElement };
}

const escondido = (field) => field.element.classList.contains('hidden');

describe('modoDoTipoCliente', () => {
  test('1, 2 e 3 são militares; o resto é civil', () => {
    expect(modoDoTipoCliente(1)).toBe('militar');
    expect(modoDoTipoCliente(2)).toBe('militar');
    expect(modoDoTipoCliente(3)).toBe('militar');
    expect(modoDoTipoCliente(5)).toBe('civil');
    expect(modoDoTipoCliente(9)).toBe('civil');
    expect(modoDoTipoCliente(null)).toBe('civil');
  });

  test('o rótulo do chip nomeia o tipo do pedido', () => {
    expect(ROTULO_MODO.militar).toBe('Pedido militar');
    expect(ROTULO_MODO.civil).toBe('Pedido civil');
  });
});

describe('filtrarClientesPorModo', () => {
  test('o modo militar só oferece OM', () => {
    expect(filtrarClientesPorModo(CLIENTES, 'militar').map(c => c.id)).toEqual([1, 2]);
  });

  test('o modo civil só oferece o não militar', () => {
    expect(filtrarClientesPorModo(CLIENTES, 'civil').map(c => c.id)).toEqual([3]);
  });
});

describe('aplicarModoPedido', () => {
  test('o modo civil esconde o campo militar VAZIO', () => {
    const { form, civilElement } = montar();

    aplicarModoPedido({ fields: form.fields, modo: 'civil', civilElement });

    expect(escondido(form.fields.demandante)).toBe(true);
    expect(escondido(form.fields.omds)).toBe(true);
    expect(escondido(form.fields.operacao)).toBe(true);
    expect(escondido(form.fields.previsto_pit)).toBe(true);
    expect(escondido(form.fields.meta_pit_id)).toBe(true);
    expect(civilElement.classList.contains('hidden')).toBe(false);
  });

  // A regra que protege o dado gravado.: os 33
  // pedidos civis têm omds com o valor constante "1º CGEO".
  test('o modo civil NÃO esconde o campo militar PREENCHIDO', () => {
    const { form, civilElement } = montar({
      demandante: 'CMS',
      omds: '1º CGEO',
      previsto_pit: true,
      meta_pit_id: 8,
    });

    aplicarModoPedido({ fields: form.fields, modo: 'civil', civilElement });

    expect(escondido(form.fields.demandante)).toBe(false);
    expect(escondido(form.fields.omds)).toBe(false);
    expect(escondido(form.fields.previsto_pit)).toBe(false);
    expect(escondido(form.fields.meta_pit_id)).toBe(false);
    // O campo militar que ficou vazio continua escondido.
    expect(escondido(form.fields.operacao)).toBe(true);
  });

  test('o modo militar esconde a seção de civil vazia', () => {
    const { form, civilElement } = montar();

    aplicarModoPedido({ fields: form.fields, modo: 'militar', civilElement });

    expect(civilElement.classList.contains('hidden')).toBe(true);
    expect(escondido(form.fields.canal_recebimento_id)).toBe(true);
    expect(escondido(form.fields.municipio)).toBe(true);
    expect(escondido(form.fields.qtd_imagens)).toBe(true);
    expect(escondido(form.fields.demandante)).toBe(false);
  });

  test('o modo militar mantém a seção de civil quando um campo dela tem valor', () => {
    const { form, civilElement } = montar({ municipio: 'Viamão' });

    aplicarModoPedido({ fields: form.fields, modo: 'militar', civilElement });

    expect(civilElement.classList.contains('hidden')).toBe(false);
    expect(escondido(form.fields.municipio)).toBe(false);
    // Os vizinhos vazios da seção somem, e só o preenchido fica.
    expect(escondido(form.fields.canal_recebimento_id)).toBe(true);
    expect(escondido(form.fields.qtd_imagens)).toBe(true);
  });

  test('trocar o modo não apaga valor nenhum de getValues', () => {
    const { form, civilElement } = montar({
      cliente_id: 1,
      situacao_pedido_id: 3,
      data_pedido: '2026-06-10',
      documento_solicitacao: 'DIEx 123',
      ponto_contato: 'Cap Silva',
      demandante: 'CMS',
      omds: '1º CGEO',
      operacao: 'Operação Fronteira',
      previsto_pit: true,
      meta_pit_id: 8,
      palavras_chave: ['adestramento'],
      observacao: 'entregar em mãos',
      canal_recebimento_id: 1,
      municipio: 'Viamão',
      qtd_imagens: 12,
    });

    const antes = form.getValues();
    aplicarModoPedido({ fields: form.fields, modo: 'civil', civilElement });
    aplicarModoPedido({ fields: form.fields, modo: 'militar', civilElement });
    aplicarModoPedido({ fields: form.fields, modo: 'civil', civilElement });

    expect(form.getValues()).toEqual(antes);
    expect(antes.demandante).toBe('CMS');
    expect(antes.municipio).toBe('Viamão');
    expect(antes.qtd_imagens).toBe(12);
  });

  test('o campo escondido continua no payload do pedido vazio', () => {
    const { form, civilElement } = montar();

    aplicarModoPedido({ fields: form.fields, modo: 'civil', civilElement });
    const valores = form.getValues();

    expect(Object.keys(valores)).toContain('demandante');
    expect(Object.keys(valores)).toContain('omds');
    expect(valores.previsto_pit).toBe(false);
  });
});
