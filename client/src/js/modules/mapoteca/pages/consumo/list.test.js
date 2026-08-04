import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderConsumoList } from '@modules/mapoteca/pages/consumo/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, GERENTE } from '@/__tests__/helpers/sessao.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

// A tela tem o proprio filtro de ano e abre no ano ATUAL (chefe, 2026-08-04).
// Nao ha mais ano global do modulo nem nada guardado no localStorage.
const ANO_ATUAL = new Date().getFullYear();
const ANO_ANTERIOR = ANO_ATUAL - 1;

/** O select do filtro de ano, que mora no cabecalho da secao do grafico. */
const filtroAno = (container) => container.querySelector('.dashboard-section__controls select');

const CONSUMO = [
  {
    id: 5, tipo_material_id: 1, tipo_material_nome: 'Papel A0', quantidade: '3',
    data_consumo: '2026-06-05', usuario_criacao_nome: 'Diniz',
    data_criacao: '2026-06-05T09:00:00Z',
  },
];

describe('renderConsumoList', () => {
  beforeEach(() => {
    // A tela esconde escrita por perfil: sem sessao nao ha botao para testar.
    logarComo({ mapoteca: GERENTE });
    svc.getConsumoMaterial.mockResolvedValue(CONSUMO);
    svc.getConsumoMensal.mockResolvedValue([]);
    svc.getTiposMaterial.mockResolvedValue([{ id: 1, nome: 'Papel A0' }]);
    svc.getAnosMapoteca.mockResolvedValue([ANO_ATUAL, ANO_ANTERIOR]);
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  test('monta o titulo, os filtros e a lista', async () => {
    const container = document.createElement('div');
    const cleanup = await renderConsumoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(svc.getConsumoMaterial).toHaveBeenCalled();
    expect(svc.getConsumoMensal).toHaveBeenCalled();
    expect(container.querySelector('.page__title').textContent).toBe('Consumo de Material');
    expect(container.textContent).toContain('Data de início');
    expect(container.textContent).toContain('Papel A0');

    if (typeof cleanup === 'function') cleanup();
  });

  // O filtro e desta tela e abre sempre no ano ATUAL. Antes o ano vinha do
  // seletor da navbar, e a escolha sobrevivia a sessao: voltar semanas depois
  // abria num ano antigo sem nada avisar.
  test('a tendencia anual abre no ano ATUAL e recarrega ao trocar de ano', async () => {
    const container = document.createElement('div');
    const cleanup = await renderConsumoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    expect(filtroAno(container).value).toBe(String(ANO_ATUAL));
    expect(svc.getConsumoMensal).toHaveBeenLastCalledWith(ANO_ATUAL);

    filtroAno(container).value = String(ANO_ANTERIOR);
    filtroAno(container).dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(svc.getConsumoMensal).toHaveBeenLastCalledWith(ANO_ANTERIOR);
    expect(filtroAno(container).value).toBe(String(ANO_ANTERIOR));

    if (typeof cleanup === 'function') cleanup();
  });

  // O ano recorta SO o grafico. A tabela tem os filtros dela, por data, e
  // trocar o ano nao pode refazer a busca da lista.
  test('trocar o ano nao mexe na lista, que filtra por data', async () => {
    const container = document.createElement('div');
    const cleanup = await renderConsumoList(container, { params: {}, query: new URLSearchParams() });
    await flush();
    svc.getConsumoMaterial.mockClear();

    filtroAno(container).value = String(ANO_ANTERIOR);
    filtroAno(container).dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(svc.getConsumoMaterial).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  test('o filtro de data entra na chamada do service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderConsumoList(container, { params: {}, query: new URLSearchParams() });
    await flush();
    svc.getConsumoMaterial.mockClear();

    const dataInicio = container.querySelector('input[type="date"]');
    dataInicio.value = '2026-01-01';
    dataInicio.dispatchEvent(new Event('input'));

    [...container.querySelectorAll('button')].find(b => b.textContent.includes('Filtrar')).click();
    await flush();

    expect(svc.getConsumoMaterial).toHaveBeenCalledWith(
      expect.objectContaining({ data_inicio: '2026-01-01' })
    );

    if (typeof cleanup === 'function') cleanup();
  });

  test('o dialogo de registro avisa que o consumo sai do estoque da Seção', async () => {
    const container = document.createElement('div');
    const cleanup = await renderConsumoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    [...container.querySelectorAll('button')].find(b => b.textContent.includes('Registrar consumo')).click();
    await flush();

    expect(document.body.textContent).toContain('sempre debitado do estoque da Seção');
    expect(svc.createConsumoMaterial).not.toHaveBeenCalled();

    if (typeof cleanup === 'function') cleanup();
  });

  test('registrar sem material mostra o erro e nao chama o service', async () => {
    const container = document.createElement('div');
    const cleanup = await renderConsumoList(container, { params: {}, query: new URLSearchParams() });
    await flush();

    [...container.querySelectorAll('button')].find(b => b.textContent.includes('Registrar consumo')).click();
    await flush();

    const confirmar = [...document.querySelectorAll('.modal button')].find(b => b.textContent === 'Registrar');
    confirmar.click();
    await flush();

    expect(svc.createConsumoMaterial).not.toHaveBeenCalled();
    expect(document.body.textContent).toContain('Selecione o tipo de material');

    if (typeof cleanup === 'function') cleanup();
  });
});
