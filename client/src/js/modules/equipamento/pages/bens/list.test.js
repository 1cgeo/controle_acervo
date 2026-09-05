import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { logarComo, CONSULTA, GERENTE } from '@/__tests__/helpers/sessao.js';

// A LISTA DE BENS, e a decisão que este arquivo tranca: O FILTRO É DO SERVIDOR.
//
// `situacao_id`, `secao_detentora_id`, `tipo_id` e `ativo` vão como QUERY em
// `GET /api/equipamento`. A situação, em particular, é DERIVADA no banco pela
// função `equipamento.situacao_em(dia)` e não é coluna de
// `equipamento.equipamento`: filtrar por ela no cliente exigiria trazer os 105
// bens e refazer a conta aqui, e é aí que as duas contas passam a divergir.
//
// A BUSCA DA TABELA é outra coisa e continua sendo do cliente: ela varre o que
// já está na tela (patrimônio, modelo), e é como se acha um bem pelo número
// colado nele.

const servico = vi.hoisted(() => ({
  getEquipamentos: vi.fn(),
  getDominio: vi.fn(),
  getTipos: vi.fn(),
  deleteEquipamento: vi.fn(() => Promise.resolve()),
  baixarRelatorioDmt: vi.fn(() => Promise.resolve()),
  createEquipamento: vi.fn(() => Promise.resolve({})),
  updateEquipamento: vi.fn(() => Promise.resolve({})),
}));
vi.mock('@modules/equipamento/services/equipamento-service.js', () => servico);

const toast = vi.hoisted(() => ({
  showSuccess: vi.fn(), showError: vi.fn(), showInfo: vi.fn(), showWarning: vi.fn(),
}));
vi.mock('@utils/toast.js', () => toast);

const confirmDialog = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock('@components/modal/confirm-dialog.js', () => ({ confirmDialog }));

import { renderBensList } from './list.js';

const DOMINIO = {
  classe_suprimento: [{ code: 6, nome: 'VI' }, { code: 9, nome: 'IX' }],
  secao_detentora: [{ code: 1, nome: 'Cia Lev' }, { code: 2, nome: 'Cia Prod' }],
  situacao: [
    { code: 1, nome: 'Disponível', precedencia: 10 },
    { code: 4, nome: 'Indisponível', precedencia: 40 },
    { code: 5, nome: 'Baixado', precedencia: 50 },
  ],
  situacao_transferencia: [{ code: 1, nome: 'Solicitada' }],
  tipo_transferencia: [{ code: 3, nome: 'Descarga' }],
};

const TIPOS = [
  { id: 1, nome: 'Estação Total', vida_util_meses: 120, ativo: true },
  { id: 6, nome: 'Impressora de Grande Formato (Plotter)', vida_util_meses: 120, ativo: true },
];

const BENS = [
  { id: 1, nr_patrimonio: '104820700014462', classe_id: 6, classe: 'VI',
    tipo_id: 1, tipo: 'Estação Total', modelo: 'TOPCON CTS-3007', nr_serie: null,
    data_entrada_carga: '2014-07-29', vida_util_meses: 120, vida_util_herdada: true,
    secao_detentora_id: 1, secao_detentora: 'Cia Lev', ativo: true,
    situacao_id: 1, situacao: 'Disponível', observacao: null },
  { id: 59, nr_patrimonio: '104821500016510', classe_id: 6, classe: 'VI',
    tipo_id: 6, tipo: 'Impressora de Grande Formato (Plotter)', modelo: 'HP DesignJet T1700',
    nr_serie: null, data_entrada_carga: '2019-11-05', vida_util_meses: 96,
    vida_util_herdada: false, secao_detentora_id: 1, secao_detentora: 'Cia Lev',
    ativo: true, situacao_id: 4, situacao: 'Indisponível', observacao: null },
];

function respostasBoas() {
  servico.getEquipamentos.mockResolvedValue(BENS);
  servico.getDominio.mockResolvedValue(DOMINIO);
  servico.getTipos.mockResolvedValue(TIPOS);
}

// O rótulo casa por IGUALDADE, e não por `includes`: "Situação de carga"
// CONTÉM "Situação", e com `includes` o `filtro(c, 'Situação')` só acharia o
// campo certo por ele estar declarado antes na barra de filtros. Trocar a ordem
// dos campos passaria a testar o filtro errado, sem erro visível.
function filtro(container, rotulo) {
  const campos = [...container.querySelectorAll('.page__filters .form-field')];
  const campo = campos.find(f => f.querySelector('.form-field__label')?.textContent.trim() === rotulo);
  return campo ? campo.querySelector('select') : null;
}

async function escolher(container, rotulo, valor) {
  const select = filtro(container, rotulo);
  expect(select, `não achei o filtro "${rotulo}"`).not.toBeNull();
  select.value = valor;
  select.dispatchEvent(new Event('change', { bubbles: true }));
  await flush();
  await flush();
}

const ultimaQuery = () => servico.getEquipamentos.mock.calls.at(-1)[0];
const linhas = (container) => [...container.querySelectorAll('.data-table tbody tr')];

async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderBensList(container, { params: {}, query: new URLSearchParams() });
  await flush();
  await flush();
  return { container, cleanup };
}

let atual = null;

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  localStorage.clear();
  logarComo({ equipamento: GERENTE });
  respostasBoas();
});

afterEach(() => {
  if (atual && typeof atual.cleanup === 'function') atual.cleanup();
  atual = null;
});

describe('lista de bens: os filtros vão como QUERY ao servidor', () => {
  test('a tela nasce em "Somente ativos", e isso já viaja na primeira carga', async () => {
    // "Todos" INCLUI o baixado, e a tela do dia a dia é a do que está em carga.
    atual = await montar();

    expect(servico.getEquipamentos).toHaveBeenCalledTimes(1);
    expect(ultimaQuery().ativo).toBe('true');
    expect(filtro(atual.container, 'Situação de carga').value).toBe('true');
  });

  test('escolher uma situação manda situacao_id ao servidor e REPERGUNTA', async () => {
    atual = await montar();
    const antes = servico.getEquipamentos.mock.calls.length;

    await escolher(atual.container, 'Situação', '4');

    expect(servico.getEquipamentos.mock.calls.length).toBe(antes + 1);
    expect(ultimaQuery().situacao_id).toBe(4);
  });

  test('os quatro filtros viajam juntos, e nenhum vazio vira parâmetro', async () => {
    atual = await montar();

    await escolher(atual.container, 'Situação', '4');
    await escolher(atual.container, 'Seção detentora', '2');
    await escolher(atual.container, 'Tipo', '6');
    await escolher(atual.container, 'Situação de carga', 'false');

    expect(ultimaQuery()).toEqual({
      situacao_id: 4,
      secao_detentora_id: 2,
      tipo_id: 6,
      ativo: 'false',
    });

    // Voltar um filtro para "Todas" tem de LIMPAR o parâmetro, e não mandar
    // vazio: `situacao_id=` na URL é um filtro que o servidor tentaria casar.
    await escolher(atual.container, 'Situação', '');
    expect(ultimaQuery().situacao_id).toBeUndefined();
  });

  test('a situação NÃO é refiltrada em memória: a tela mostra o que o servidor mandou', async () => {
    // Esta é a prova de que a conta é UMA. A situação é derivada no banco; se a
    // tela também a filtrasse, bastaria o cliente e o servidor discordarem em um
    // dia de calendário para a lista esconder um bem que existe.
    //
    // O servidor devolve, para `situacao_id=4`, uma linha marcada como
    // Disponível. Uma tela que refizesse a conta aqui a descartaria.
    atual = await montar();
    servico.getEquipamentos.mockResolvedValueOnce([
      { ...BENS[0], situacao_id: 1, situacao: 'Disponível' },
    ]);

    await escolher(atual.container, 'Situação', '4');

    expect(linhas(atual.container)).toHaveLength(1);
    expect(atual.container.textContent).toContain('104820700014462');
  });

  test('pedir "Baixado" tira a tela de "Somente ativos", que nunca teria um', async () => {
    // A situação `Baixado` é DERIVADA de `ativo = false`
    // (`equipamento.situacao_em`, precedência 50), e a tela nasce em "Somente
    // ativos": pedir Baixado ali devolve lista vazia SEMPRE, e a tabela escrevia
    // "Nenhum equipamento com esses filtros" como se fosse resposta sobre o
    // acervo. O filtro de carga acompanha, e o aviso diz que acompanhou.
    atual = await montar();
    expect(ultimaQuery().ativo).toBe('true');

    await escolher(atual.container, 'Situação', '5');

    expect(ultimaQuery()).toEqual({ situacao_id: 5, ativo: 'false' });
    expect(filtro(atual.container, 'Situação de carga').value).toBe('false');
    expect(toast.showInfo).toHaveBeenCalledTimes(1);
    expect(toast.showInfo.mock.calls[0][0]).toContain('Somente baixados');
  });

  test('sair de "Baixado" devolve o filtro de carga a "Somente ativos"', async () => {
    // A VOLTA, que é o defeito espelho: sem ela o `ativo = false` fica grudado e
    // `situacao_id=4 AND ativo=false` é o mesmo vazio garantido, num recorte que
    // a tela montou sozinha e desta vez SEM aviso nenhum.
    atual = await montar();

    await escolher(atual.container, 'Situação', '5');
    await escolher(atual.container, 'Situação', '4');

    expect(ultimaQuery()).toEqual({ situacao_id: 4, ativo: 'true' });
    expect(filtro(atual.container, 'Situação de carga').value).toBe('true');
  });

  test('a carga escolhida A MÃO não é desfeita ao trocar de situação', async () => {
    // Quem mexeu no filtro de carga foi a PESSOA: dali em diante a tela não o
    // desfaz, nem ao sair de "Baixado".
    atual = await montar();

    await escolher(atual.container, 'Situação de carga', 'false');
    await escolher(atual.container, 'Situação', '5');
    await escolher(atual.container, 'Situação', '4');

    expect(ultimaQuery().ativo).toBe('false');
    expect(toast.showInfo).not.toHaveBeenCalled();
  });

  test('as outras situações não mexem no filtro de carga', async () => {
    atual = await montar();

    await escolher(atual.container, 'Situação', '4');

    expect(ultimaQuery().ativo).toBe('true');
    expect(toast.showInfo).not.toHaveBeenCalled();
  });

  test('o filtro de situação e o de seção saem do domínio do servidor, pelo `code`', async () => {
    // Regressão gêmea da do orçamento: montar as opções com `id` num domínio que
    // devolve `code` faz cada opção valer "undefined", e o único filtro da tela
    // deixa de filtrar sem nenhum sintoma.
    atual = await montar();

    expect([...filtro(atual.container, 'Situação').options].map(o => o.value))
      .toEqual(['', '1', '4', '5']);
    expect([...filtro(atual.container, 'Seção detentora').options].map(o => o.value))
      .toEqual(['', '1', '2']);
    // O tipo é CADASTRO, com id SERIAL: ali o campo é `id` mesmo.
    expect([...filtro(atual.container, 'Tipo').options].map(o => o.value))
      .toEqual(['', '1', '6']);
  });
});

describe('lista de bens: as cargas auxiliares caem sozinhas', () => {
  test('o domínio fora do ar deixa a LISTA de pé, com o aviso do que ficou vazio', async () => {
    // Juntos num `Promise.all`, a falha de um deixaria os DOIS combos vazios e a
    // lista inteira morreria com a mensagem de quem falhou. É a armadilha que
    // derrubou #/aproveitamento em 2026-08-08.
    servico.getDominio.mockRejectedValue(new Error('Usuário necessita ser um administrador'));

    atual = await montar();

    expect(linhas(atual.container)).toHaveLength(2);
    expect(atual.container.querySelector('.dashboard-erro')).toBeNull();
    // O tipo, que é outra chamada, continua populado.
    expect([...filtro(atual.container, 'Tipo').options].map(o => o.value))
      .toEqual(['', '1', '6']);
    expect(toast.showError).toHaveBeenCalledTimes(1);
    expect(toast.showError.mock.calls[0][0]).toContain('situação e seção');
  });

  test('os tipos fora do ar deixam a lista e os outros filtros de pé', async () => {
    servico.getTipos.mockRejectedValue(new Error('sem rede'));

    atual = await montar();

    expect(linhas(atual.container)).toHaveLength(2);
    expect([...filtro(atual.container, 'Situação').options].map(o => o.value))
      .toEqual(['', '1', '4', '5']);
    expect(toast.showError.mock.calls[0][0]).toContain('filtro de tipo');
  });

  test('o relatório DMT que falha não derruba a lista, que é o que se veio ver', async () => {
    servico.baixarRelatorioDmt.mockRejectedValueOnce(new Error('ODS não gerado'));

    atual = await montar();
    const botao = [...atual.container.querySelectorAll('.page__actions .btn')]
      .find(b => b.textContent.includes('Relatório DMT'));
    botao.click();
    await flush();
    await flush();

    expect(toast.showError).toHaveBeenCalledWith('ODS não gerado');
    expect(linhas(atual.container)).toHaveLength(2);
    // E o botão volta a funcionar: ele se desabilita durante a requisição.
    expect(botao.disabled).toBe(false);
  });

  test('a lista fora do ar mostra ERRO, e não "nenhum equipamento com esses filtros"', async () => {
    // As duas frases pedem ações opostas: uma pede tentar de novo, a outra pede
    // afrouxar o filtro.
    servico.getEquipamentos.mockRejectedValue(new Error('500'));

    atual = await montar();

    expect(atual.container.querySelector('.dashboard-erro')).not.toBeNull();
    expect(atual.container.textContent).not.toContain('Nenhum equipamento com esses filtros');
  });
});

describe('lista de bens: o que cada perfil vê', () => {
  test('a consulta lê a lista e baixa o relatório, sem botão de escrita', async () => {
    localStorage.clear();
    logarComo({ equipamento: CONSULTA });

    atual = await montar();
    const rotulos = [...atual.container.querySelectorAll('.btn')].map(b => b.textContent);

    expect(rotulos.some(r => r.includes('Relatório DMT'))).toBe(true);
    expect(rotulos.some(r => r.includes('Novo equipamento'))).toBe(false);
    // A ficha continua alcançável: é a única visão completa do bem.
    expect(atual.container.querySelector('[title="Abrir a ficha"]')).not.toBeNull();
    expect(atual.container.querySelector('[title="Excluir"]')).toBeNull();
  });

  test('o gerente cadastra e exclui, e a exclusão NOMEIA o bem', async () => {
    atual = await montar();

    expect([...atual.container.querySelectorAll('.btn')]
      .some(b => b.textContent.includes('Novo equipamento'))).toBe(true);

    atual.container.querySelector('[title="Excluir"]').click();
    await flush();

    // Numa lista de 105 linhas, "este equipamento" não distingue qual delas some.
    const mensagem = confirmDialog.mock.calls[0][0].message;
    expect(mensagem).toContain('104820700014462 - TOPCON CTS-3007');
    // E a confirmação diz que dar baixa é outra coisa, porque as duas ações são
    // vizinhas na mesma tabela.
    expect(mensagem).toContain('desmarque "Ativo"');
  });
});
