import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderInsumosList } from '@modules/mapoteca/pages/insumos/list.js';
import {
  openConsumoDialog,
  openEntradaDialog,
  openTransferenciaDialog,
} from '@modules/mapoteca/pages/insumos/movimento-dialogs.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, CONSULTA, OPERADOR } from '@/__tests__/helpers/sessao.js';

// O RELOGIO E FIXO NO ARQUIVO INTEIRO, e nao dentro de um `describe`.
//
// Esta tela fala de MES: a coluna "Consumo no mês" so conta a linha cujo `mes`
// e o de hoje, e o `getConsumoMensal` leva o ano de hoje. Com o relogio de
// parede, a fixture do "mes anterior" vira dezembro do ano passado em janeiro,
// e o caso da virada do mes (o ultimo do arquivo) so poderia existir num dia
// escolhido. 31/08/2026 e a vespera de uma virada, que e justamente o dia em
// que a tela erra.
const RELOGIO = new Date('2026-08-31T09:00:00');
vi.useFakeTimers({ toFake: ['Date'] });
vi.setSystemTime(RELOGIO);

// SO o Date entra no `toFake`: o `flush()` deste repositorio e um `setTimeout`,
// e congelar o cronometro junto travaria a espera da tela em todo caso.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(RELOGIO);
});

afterEach(() => {
  vi.useRealTimers();
});

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

  // A COLUNA DO MES SEGUE O RELOGIO, e nao a hora da montagem.
  //
  // Esta e a tela do lancamento de todo dia, e fica aberta o turno inteiro. Com
  // o mes preso na montagem, atravessar a virada fazia todo `load()` recalcular
  // a coluna com o mes VELHO, embaixo de um rodape que promete "o mesmo numero
  // da tabela 7.2 do RPCMTec" -- que em setembro e outro. O consumo lancado
  // agora entrava no livro e nao aparecia na coluna.
  test('depois da virada do mes, a coluna passa a contar o mes NOVO', async () => {
    // O material 1 gastou 7 em agosto e 55 em setembro. O relogio do arquivo
    // esta em 31/08, entao a primeira carga tem de mostrar 7.
    svc.getConsumoMensal.mockResolvedValue([
      { tipo_material_id: 1, mes: 8, quantidade: '7' },
      { tipo_material_id: 1, mes: 9, quantidade: '55' },
    ]);
    // A primeira carga falha de proposito: o botao "Tentar de novo" do estado de
    // erro e o `load()` que a tela ja oferece, e assim o caso nao precisa
    // atravessar um dialogo para provocar a recarga.
    svc.getTiposMaterial.mockRejectedValueOnce(new Error('Erro de conexão'));
    const { container, cleanup } = await montar();

    vi.setSystemTime(new Date('2026-09-01T09:00:00'));

    const tentarDeNovo = [...container.querySelectorAll('button')]
      .find(b => b.textContent.includes('Tentar de novo'));
    tentarDeNovo.click();
    await flush();

    // O ano do relogio novo, e nao o da montagem.
    expect(svc.getConsumoMensal).toHaveBeenLastCalledWith(2026);
    const papel = linhaDe(container, 'Papel A0');
    expect(papel).toContain('55');
    expect(papel).not.toContain('7');

    cleanup();
  });
});

// A DATA DO MOVIMENTO NAO PODE SER FUTURA.
//
// O erro barato e o ano trocado num campo que nasce preenchido. A linha entra no
// livro, o gatilho de `estoque_material` desconta o saldo NA HORA (ele nao olha
// `data_movimento`), a coluna "Consumo no mês" desta tela continua zerada e a
// 7.2 do RPCMTec do mes nao conta nada: o saldo e o relatorio passam a discordar
// sem uma linha de erro. O dialogo de impressao, ao lado, ja travava data futura.
describe('os dialogos de movimento travam data futura', () => {
  const MATERIAL = { id: 1, nome: 'Papel A0' };
  const SALDOS = new Map([[1, 12], [2, 0]]);

  /** O campo de data do dialogo aberto, pelo rotulo. */
  const campoData = () => [...document.querySelectorAll('.modal .form-field')]
    .find(f => f.textContent.includes('Data'))
    .querySelector('input[type="date"]');

  afterEach(() => {
    document.querySelectorAll('.modal-overlay').forEach(n => n.remove());
  });

  test('o campo de data dos tres dialogos para em HOJE', async () => {
    const abrir = [openConsumoDialog, openEntradaDialog, openTransferenciaDialog];
    for (const abrirDialogo of abrir) {
      abrirDialogo({ material: MATERIAL, saldos: SALDOS });
      await flush();

      const input = campoData();
      // 31/08/2026 e o relogio do arquivo: sem o `max`, o seletor abria 2027.
      expect(input.getAttribute('max')).toBe('2026-08-31');
      expect(input.value).toBe('2026-08-31');

      document.querySelectorAll('.modal-overlay').forEach(n => n.remove());
    }
  });
});
