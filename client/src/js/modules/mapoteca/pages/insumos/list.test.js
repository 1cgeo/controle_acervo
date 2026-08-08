import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderInsumosList } from '@modules/mapoteca/pages/insumos/list.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, CONSULTA, OPERADOR } from '@/__tests__/helpers/sessao.js';

const MES_ATUAL = new Date().getMonth() + 1;
const ANO_ATUAL = new Date().getFullYear();

// PAPEL A0: 12 na Seção, 0 no Almoxarifado e 40 em 'Aquisição realizada'.
// O total das quatro localizacoes e 52, e o DISPONIVEL e 12, contra um minimo de
// 20. O servidor ja marca `abaixo_minimo: true` -- e a diferenca entre os dois
// numeros e o que este arquivo prova que a tela respeita.
const MATERIAIS = [
  {
    id: 1, nome: 'Papel A0', descricao: 'Bobina',
    estoque_total: '52', estoque_disponivel: '12', localizacoes_armazenadas: '2',
    estoque_minimo: '20', ativo: true, abaixo_minimo: true,
  },
  {
    id: 2, nome: 'Cartucho MK', descricao: null,
    estoque_total: '30', estoque_disponivel: '30', localizacoes_armazenadas: '1',
    estoque_minimo: '10', ativo: true, abaixo_minimo: false,
  },
];

const ESTOQUE = [
  { id: 11, tipo_material_id: 1, localizacao_id: 1, quantidade: '12' },
  { id: 12, tipo_material_id: 1, localizacao_id: 3, quantidade: '40' },
  { id: 13, tipo_material_id: 2, localizacao_id: 2, quantidade: '30' },
];

const CONSUMO_MENSAL = [
  { tipo_material_id: 1, mes: MES_ATUAL, quantidade: '7' },
  // Um mes que nao e o atual NAO pode entrar na coluna: e o consumo DO MES que a
  // 7.2 do RPCMTec imprime.
  { tipo_material_id: 1, mes: MES_ATUAL === 1 ? 12 : MES_ATUAL - 1, quantidade: '900' },
  { tipo_material_id: 2, mes: MES_ATUAL, quantidade: '0' },
];

/** Os textos das celulas de uma linha, pelo nome do insumo. */
function linhaDe(container, nome) {
  const tr = [...container.querySelectorAll('tbody tr')]
    .find(l => l.textContent.includes(nome));
  return tr ? [...tr.querySelectorAll('td')].map(td => td.textContent.trim()) : null;
}

const cabecalhos = (container) =>
  [...container.querySelectorAll('thead th')].map(th => th.textContent.trim());

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderInsumosList(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

describe('renderInsumosList', () => {
  beforeEach(() => {
    logarComo({ mapoteca: OPERADOR });
    svc.getTiposMaterial.mockResolvedValue(MATERIAIS);
    svc.getEstoqueMaterial.mockResolvedValue(ESTOQUE);
    svc.getConsumoMensal.mockResolvedValue(CONSUMO_MENSAL);
  });

  test('monta o titulo e busca as TRES leituras que a tela precisa', async () => {
    const { container, cleanup } = await montar();

    expect(container.querySelector('.page__title').textContent).toBe('Insumos');
    expect(svc.getTiposMaterial).toHaveBeenCalled();
    // So a leitura do ESTOQUE abre o saldo por localizacao, que e de onde saem as
    // colunas Seção e Almoxarifado.
    expect(svc.getEstoqueMaterial).toHaveBeenCalled();
    // O consumo do mes vem da MESMA fonte da 7.2 do RPCMTec.
    expect(svc.getConsumoMensal).toHaveBeenCalledWith(ANO_ATUAL);

    expect(container.textContent).toContain('Papel A0');
    expect(container.textContent).toContain('Cartucho MK');

    cleanup();
  });

  test('as colunas novas entram e as velhas saem', async () => {
    const { container, cleanup } = await montar();

    const colunas = cabecalhos(container);
    expect(colunas).toContain('Seção');
    expect(colunas).toContain('Almoxarifado');
    expect(colunas).toContain('Consumo no mês');
    // "Localizações" saiu: contar em quantas prateleiras o material aparece nao
    // responde nenhuma pergunta que a Seção faca.
    expect(colunas).not.toContain('Localizações');
    // "Meta anual" saiu com a coluna do banco.
    expect(colunas).not.toContain('Meta anual');

    cleanup();
  });

  test('Seção, Almoxarifado e Consumo no mês trazem os numeros certos', async () => {
    const { container, cleanup } = await montar();

    const papel = linhaDe(container, 'Papel A0');
    // Seção 12, Almoxarifado 0 (o material esta em 'Aquisição realizada'),
    // consumo do mes 7 -- e nao os 900 do mes anterior.
    expect(papel).toContain('12');
    expect(papel).toContain('7');
    expect(papel).not.toContain('900');

    const cartucho = linhaDe(container, 'Cartucho MK');
    expect(cartucho).toContain('30');

    cleanup();
  });

  test('o badge segue o DISPONIVEL, e nao o total das quatro localizacoes', async () => {
    const { container, cleanup } = await montar();

    const linhas = [...container.querySelectorAll('tbody tr')];
    const doPapel = linhas.find(l => l.textContent.includes('Papel A0'));
    const doCartucho = linhas.find(l => l.textContent.includes('Cartucho MK'));

    // O Papel A0 tem 52 no total, bem acima do minimo de 20. Ele leva o selo
    // porque o DISPONIVEL e 12: os outros 40 sao compra que ainda esta com o
    // fornecedor, e nao tapam buraco nenhum na prateleira.
    expect(doPapel.querySelector('.badge')).not.toBeNull();
    expect(doCartucho.querySelector('.badge')).toBeNull();

    cleanup();
  });

  test('nao ha selecao multipla nem excluir selecionados', async () => {
    const { container, cleanup } = await montar();

    // Excluir insumo em lote apagava, num clique, o cadastro que a 7.2 do mes
    // anterior casa por NOME.
    expect(container.querySelector('.data-table__checkbox')).toBeNull();
    expect(container.querySelector('.btn--danger')).toBeNull();
    expect(container.textContent).not.toContain('Excluir selecionados');

    cleanup();
  });

  // O OPERADOR ERA JUSTAMENTE QUEM A LISTA NAO HIERARQUICA EXCLUIA. Com a tela
  // unica ele e quem mais a usa: consome, transfere, da entrada e conta.
  test('o operador ve a tela e as cinco acoes, com Consumir na frente', async () => {
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Novo insumo');

    const primeiraLinha = container.querySelector('tbody tr');
    const acoes = [...primeiraLinha.querySelectorAll('.data-table__action-btn')]
      .map(b => b.getAttribute('title'));
    // A ficha primeiro (e o clique no nome), e logo em seguida Consumir: e o
    // lancamento de todo dia, e o unico que alimenta a 7.2 do RPCMTec.
    // CINCO, e nao seis: a Contagem saiu em 2026-08-08, e nao ha acao de
    // ajustar saldo. A lista inteira prova a ausencia.
    expect(acoes).toEqual([
      'Abrir a ficha', 'Consumir', 'Entrada', 'Transferir', 'Editar cadastro',
    ]);

    cleanup();
  });

  test('quem so consulta le a tela e nao ve nenhuma acao de escrita', async () => {
    logarComo({ mapoteca: CONSULTA });
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Papel A0');
    expect(container.textContent).not.toContain('Novo insumo');

    const acoes = [...container.querySelectorAll('tbody tr .data-table__action-btn')]
      .map(b => b.getAttribute('title'));
    expect(new Set(acoes)).toEqual(new Set(['Abrir a ficha']));

    cleanup();
  });

  test('o link do nome leva a ficha COM o prefixo do modulo', async () => {
    const { container, cleanup } = await montar();

    const link = [...container.querySelectorAll('a')].find(a => a.textContent === 'Papel A0');
    expect(link.getAttribute('href')).toBe('#/mapoteca/insumos/1');

    cleanup();
  });

  test('falha de carga troca a tabela pelo estado de erro', async () => {
    svc.getTiposMaterial.mockRejectedValueOnce(new Error('Erro de conexão'));
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Erro de conexão');
    expect(container.textContent).not.toContain('Nenhum insumo cadastrado');

    cleanup();
  });
});
