import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

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

import { renderPedidoDetails } from '@modules/mapoteca/pages/pedidos/details.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const CLIENTES = [
  { id: 7, nome: '1º CGEO', tipo_cliente_id: 1 },
  { id: 8, nome: 'Prefeitura de Porto Alegre', tipo_cliente_id: 5 },
];
const SITUACOES = [{ code: 3, nome: 'Em andamento' }, { code: 5, nome: 'Concluído' }];
const CANAIS = [{ code: 1, nome: 'Ouvidoria/LAI' }];

// Pedido militar. O omds preenchido reproduz a produção: os 33 pedidos civis
// também têm este campo gravado com "1º CGEO" (medido em 2026-07-30).
const PEDIDO_MILITAR = {
  id: 55,
  cliente_id: 7,
  cliente_nome: '1º CGEO',
  tipo_cliente_id: 1,
  tipo_cliente_nome: 'OM EB',
  localizador_pedido: 'AB12-CD34-EF56',
  situacao_pedido_id: 3,
  situacao_pedido_nome: 'Em andamento',
  data_pedido: '2026-06-10',
  demandante: 'CMS',
  omds: '1º CGEO',
  palavras_chave: [],
  produtos: [],
  impressao: { concluida: false, itens_concluidos: 0, total_itens: 0 },
};

const PEDIDO_CIVIL = {
  ...PEDIDO_MILITAR,
  id: 56,
  cliente_id: 8,
  cliente_nome: 'Prefeitura de Porto Alegre',
  tipo_cliente_id: 5,
  tipo_cliente_nome: 'Órgão público',
  demandante: null,
  canal_recebimento_id: 1,
  municipio: 'Viamão',
};

/** Monta o detalhe e abre o modal de edição. */
async function abrirEdicao(pedido) {
  svc.getPedido.mockResolvedValue(pedido);
  const container = document.createElement('div');
  const cleanup = await renderPedidoDetails(container, { params: { id: String(pedido.id) }, query: new URLSearchParams() });
  await flush();

  const botao = [...container.querySelectorAll('button')].find(b => b.textContent.includes('Editar'));
  botao.click();
  await flush();

  const modal = document.querySelector('.modal');
  return { container, modal, cleanup };
}

describe('modo do pedido na edição', () => {
  beforeEach(() => {
    // Editar o pedido é gerente. O ADMIN passa em todos os módulos.
    localStorage.setItem('@sca-User-Authorization', 'ADMIN');
    svc.getAnexosPedido.mockResolvedValue([]);
    svc.getClientes.mockResolvedValue(CLIENTES);
    svc.getDominioSituacaoPedido.mockResolvedValue(SITUACOES);
    svc.getDominioCanalRecebimento.mockResolvedValue(CANAIS);
  });

  afterEach(() => {
    localStorage.clear();
    document.querySelectorAll('.modal-overlay').forEach(o => o.remove());
  });

  test('o pedido militar abre com o chip "Pedido militar"', async () => {
    const { modal, cleanup } = await abrirEdicao(PEDIDO_MILITAR);

    expect(modal.querySelector('.chip').textContent).toBe('Pedido militar');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o pedido de civil abre com o chip "Pedido civil"', async () => {
    const { modal, cleanup } = await abrirEdicao(PEDIDO_CIVIL);

    expect(modal.querySelector('.chip').textContent).toBe('Pedido civil');

    if (typeof cleanup === 'function') cleanup();
  });

  test('a edição de pedido de civil esconde o campo militar vazio e mantém o preenchido', async () => {
    const { modal, cleanup } = await abrirEdicao(PEDIDO_CIVIL);

    const campos = [...modal.querySelectorAll('.form-field')];
    const campo = (rotulo) => campos.find(c => c.querySelector('label') && c.querySelector('label').textContent.startsWith(rotulo));

    // Demandante está vazio neste pedido de civil, então some.
    expect(campo('Demandante').classList.contains('hidden')).toBe(true);
    // OMDS tem "1º CGEO" gravado, então fica na tela para poder ser corrigido.
    expect(campo('OM responsável').classList.contains('hidden')).toBe(false);
    expect(campo('Canal de recebimento').classList.contains('hidden')).toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });

  test('trocar o cliente para civil troca o chip e reaplica o modo', async () => {
    const { modal, cleanup } = await abrirEdicao(PEDIDO_MILITAR);

    expect(modal.querySelector('.chip').textContent).toBe('Pedido militar');

    const selectCliente = modal.querySelector('select');
    selectCliente.value = '8';
    selectCliente.dispatchEvent(new Event('change'));
    await flush();

    expect(modal.querySelector('.chip').textContent).toBe('Pedido civil');

    if (typeof cleanup === 'function') cleanup();
  });

  test('abrir a edição não grava nada no servidor', async () => {
    const { cleanup } = await abrirEdicao(PEDIDO_CIVIL);

    expect(svc.updatePedido).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });
});
