import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { logarComo, CONSULTA, OPERADOR, GERENTE } from '@/__tests__/helpers/sessao.js';

// A ARMADILHA QUE MORDEU TRÊS VEZES EM 2026-08-08.
//
// Uma chamada que falha dentro de um `Promise.all` derruba a TELA INTEIRA, e a
// mensagem que sobra na tela é a DELA. `#/aproveitamento` morria dizendo
// "necessita ser um administrador" porque a quarta chamada era de outra guarda,
// e a lista de DFD morreria com um 404 de rota de domínio apagada.
//
// A ficha do bem faz CINCO chamadas: o bem e os quatro históricos. O bem vai no
// caminho principal, porque sem ele não há tela. Os quatro históricos carregam
// cada um POR SI, e a falha de um fica DENTRO da seção dele.
//
// Este arquivo prova isso com a chamada de MANUTENÇÃO respondendo 403: a ficha
// tem de continuar mostrando o bem e os outros três históricos, e o erro tem de
// ficar confinado à seção de manutenção.

const servico = vi.hoisted(() => ({
  getEquipamento: vi.fn(),
  getDominio: vi.fn(),
  getTipos: vi.fn(),
  getIndisponibilidades: vi.fn(),
  getAfastamentos: vi.fn(),
  getManutencoes: vi.fn(),
  getTransferencias: vi.fn(),
  deleteIndisponibilidade: vi.fn(() => Promise.resolve()),
  deleteAfastamento: vi.fn(() => Promise.resolve()),
  deleteManutencao: vi.fn(() => Promise.resolve()),
  deleteTransferencia: vi.fn(() => Promise.resolve()),
  createIndisponibilidade: vi.fn(() => Promise.resolve({})),
  updateIndisponibilidade: vi.fn(() => Promise.resolve({})),
  createAfastamento: vi.fn(() => Promise.resolve({})),
  updateAfastamento: vi.fn(() => Promise.resolve({})),
  createManutencao: vi.fn(() => Promise.resolve({})),
  updateManutencao: vi.fn(() => Promise.resolve({})),
  createTransferencia: vi.fn(() => Promise.resolve({})),
  updateTransferencia: vi.fn(() => Promise.resolve({})),
  createEquipamento: vi.fn(() => Promise.resolve({})),
  updateEquipamento: vi.fn(() => Promise.resolve({})),
  deleteEquipamento: vi.fn(() => Promise.resolve()),
  createTipo: vi.fn(() => Promise.resolve({})),
  updateTipo: vi.fn(() => Promise.resolve({})),
  deleteTipo: vi.fn(() => Promise.resolve()),
  getDashboard: vi.fn(() => Promise.resolve({})),
  baixarRelatorioDmt: vi.fn(() => Promise.resolve()),
}));

vi.mock('@modules/equipamento/services/equipamento-service.js', () => servico);

vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: vi.fn(() => ({
    element: document.createElement('div'),
    recarregar: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

// A confirmação de exclusão é um modal com Promise: sem substituí-la, o clique
// no lixeira fica pendurado esperando alguém apertar "Excluir".
const confirmDialog = vi.hoisted(() => vi.fn(() => Promise.resolve(true)));
vi.mock('@components/modal/confirm-dialog.js', () => ({ confirmDialog }));

const toast = vi.hoisted(() => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
}));
vi.mock('@utils/toast.js', () => toast);

import { renderBemDetails } from './details.js';

// ---------------------------------------------------------------------------
// Os dados: o plotter parado desde 11/05/2026, que é uma linha real da planilha.
// ---------------------------------------------------------------------------

const BEM = {
  id: 59,
  nr_patrimonio: '104821500016510',
  classe_id: 6, classe: 'VI',
  tipo_id: 6, tipo: 'Impressora de Grande Formato (Plotter)',
  modelo: 'HP DesignJet T1700',
  nr_serie: null,
  data_entrada_carga: '2019-11-05',
  vida_util_meses: 120, vida_util_herdada: true,
  secao_detentora_id: 1, secao_detentora: 'Cia Lev',
  ativo: true,
  situacao_id: 4, situacao: 'Indisponível',
  observacao: null,
};

const INDISPONIBILIDADES = [
  { id: 11, equipamento_id: 59, data_inicio: '2026-05-11', data_fim: null,
    motivo: 'Cabeçote danificado', previsao_retorno: '2026-12-31' },
];
const AFASTAMENTOS = [
  { id: 3, equipamento_id: 59, om: '3º BPE', motivo: 'Apoio a levantamento',
    data_inicio: '2026-04-09', previsao_termino: null, data_fim: null },
];
const TRANSFERENCIAS = [
  { id: 8, equipamento_id: 59, tipo_id: 3, tipo: 'Descarga',
    situacao_id: 1, situacao: 'Solicitada', om: null,
    documento_solicitacao: null, data_solicitacao: null, data_transferencia: null,
    transferido_siafi: false, apropriado_siafi: false, publicacao_autorizacao: null },
];
const MANUTENCOES = [
  { id: 1, equipamento_id: 59, indisponibilidade_id: 11, data_inicio: '2026-05-11',
    data_fim: null, descricao: null, valor: null, valor_orcado: '600.00',
    valor_pdr: '600.00', certame: 'Contrata+Brasil' },
];

/** A mensagem que o `verifyPerfil` do servidor devolve quando o perfil não dá. */
const ERRO_403 = new Error('Usuário necessita ser um administrador');

function respostasBoas() {
  servico.getEquipamento.mockResolvedValue(BEM);
  servico.getDominio.mockResolvedValue({
    classe_suprimento: [{ code: 6, nome: 'VI' }],
    secao_detentora: [{ code: 1, nome: 'Cia Lev' }],
    situacao: [{ code: 4, nome: 'Indisponível', precedencia: 40 }],
    situacao_transferencia: [{ code: 1, nome: 'Solicitada' }],
    tipo_transferencia: [{ code: 3, nome: 'Descarga' }],
  });
  servico.getTipos.mockResolvedValue([{ id: 6, nome: 'Plotter', vida_util_meses: 120, ativo: true }]);
  servico.getIndisponibilidades.mockResolvedValue(INDISPONIBILIDADES);
  servico.getAfastamentos.mockResolvedValue(AFASTAMENTOS);
  servico.getManutencoes.mockResolvedValue(MANUTENCOES);
  servico.getTransferencias.mockResolvedValue(TRANSFERENCIAS);
}

/** A seção de histórico pelo título que ela mostra. */
function secao(container, titulo) {
  return [...container.querySelectorAll('.dashboard-section')]
    .find(s => s.querySelector('.dashboard-section__title')?.textContent === titulo) || null;
}

const temErro = (no) => no !== null && no.querySelector('.dashboard-erro') !== null;
const mensagemDoErro = (no) => no.querySelector('.dashboard-erro__detalhe')?.textContent;

async function montar(id = '59') {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderBemDetails(container, { params: { id }, query: new URLSearchParams() });
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

// ---------------------------------------------------------------------------

describe('ficha do bem: a falha de um histórico NÃO derruba a tela', () => {
  test('com a manutenção em 403, o bem e os outros três históricos continuam na tela', async () => {
    servico.getManutencoes.mockRejectedValue(ERRO_403);

    atual = await montar();
    const { container } = atual;

    // 1. O BEM continua lá, com tudo o que a ficha promete sobre ele.
    expect(container.querySelector('.page__title').textContent)
      .toBe('Equipamento 104821500016510');
    expect(container.querySelector('.equip-ficha__situacao').textContent)
      .toBe('Indisponível');
    expect(container.textContent).toContain('HP DesignJet T1700');
    expect(container.textContent).toContain('Cia Lev');

    // 2. OS OUTROS TRÊS HISTÓRICOS carregaram e estão pintados. Onze
    //    indisponibilidades não podem sumir porque a manutenção caiu.
    expect(temErro(secao(container, 'Indisponibilidades'))).toBe(false);
    expect(secao(container, 'Indisponibilidades').textContent).toContain('Cabeçote danificado');

    expect(temErro(secao(container, 'Afastamentos'))).toBe(false);
    expect(secao(container, 'Afastamentos').textContent).toContain('3º BPE');

    expect(temErro(secao(container, 'Transferências e descargas'))).toBe(false);
    expect(secao(container, 'Transferências e descargas').textContent).toContain('Descarga');

    // 3. O ERRO FICA NA SEÇÃO DELE, com a mensagem do servidor por inteiro.
    const manutencao = secao(container, 'Manutenções');
    expect(temErro(manutencao)).toBe(true);
    expect(mensagemDoErro(manutencao)).toBe('Usuário necessita ser um administrador');
  });

  test('a mensagem do 403 não aparece em nenhum outro lugar da tela', async () => {
    // Era exatamente este o sintoma de 2026-08-08: a tela inteira reduzida a
    // "necessita ser um administrador", uma frase que não diz de qual das cinco
    // chamadas ela veio.
    servico.getManutencoes.mockRejectedValue(ERRO_403);

    atual = await montar();
    const { container } = atual;

    const avisos = [...container.querySelectorAll('.dashboard-erro')];
    expect(avisos).toHaveLength(1);
    expect(avisos[0].closest('.dashboard-section')).toBe(secao(container, 'Manutenções'));

    // E SEM TOAST: quatro seções fora do ar dariam quatro toasts empilhados, e
    // nenhum deles diria de qual seção é.
    expect(toast.showError).not.toHaveBeenCalled();
  });

  test('cada uma das quatro seções cai sozinha, e as outras três continuam', async () => {
    // Generalização do caso acima: a prova não pode valer só para a manutenção,
    // senão a seção seguinte que voltasse ao `Promise.all` passaria despercebida.
    const CENARIOS = [
      ['Indisponibilidades', servico.getIndisponibilidades],
      ['Manutenções', servico.getManutencoes],
      ['Afastamentos', servico.getAfastamentos],
      ['Transferências e descargas', servico.getTransferencias],
    ];

    for (const [titulo, chamada] of CENARIOS) {
      document.body.innerHTML = '';
      vi.clearAllMocks();
      respostasBoas();
      chamada.mockRejectedValue(new Error(`fora do ar: ${titulo}`));

      const { container, cleanup } = await montar();

      expect(container.querySelector('.page__title').textContent)
        .toBe('Equipamento 104821500016510');
      for (const [outro] of CENARIOS) {
        expect(
          temErro(secao(container, outro)),
          `com ${titulo} fora do ar, a seção ${outro} ficou ${outro === titulo ? 'boa' : 'quebrada'}`
        ).toBe(outro === titulo);
      }

      if (typeof cleanup === 'function') cleanup();
    }
  });

  test('"Tentar de novo" devolve AQUELA tabela, e não recarrega a ficha inteira', async () => {
    servico.getManutencoes.mockRejectedValueOnce(ERRO_403);

    atual = await montar();
    const { container } = atual;

    const chamadasDoBem = servico.getEquipamento.mock.calls.length;
    const chamadasVizinhas = servico.getIndisponibilidades.mock.calls.length;

    const manutencao = secao(container, 'Manutenções');
    [...manutencao.querySelectorAll('.dashboard-erro .btn')]
      .find(b => b.textContent.includes('Tentar de novo')).click();
    await flush();
    await flush();

    expect(temErro(secao(container, 'Manutenções'))).toBe(false);
    expect(secao(container, 'Manutenções').textContent).toContain('Contrata+Brasil');
    // A seção se conserta sozinha: nem o bem nem as irmãs foram perguntados de
    // novo, e é isso que separa "erro confinado" de "recarrega tudo".
    expect(servico.getEquipamento).toHaveBeenCalledTimes(chamadasDoBem);
    expect(servico.getIndisponibilidades).toHaveBeenCalledTimes(chamadasVizinhas);
  });

  test('as QUATRO fora do ar ainda deixam o bem legível', async () => {
    servico.getIndisponibilidades.mockRejectedValue(new Error('sem rede'));
    servico.getAfastamentos.mockRejectedValue(new Error('sem rede'));
    servico.getManutencoes.mockRejectedValue(ERRO_403);
    servico.getTransferencias.mockRejectedValue(new Error('404'));

    atual = await montar();
    const { container } = atual;

    expect(container.querySelector('.page__title').textContent)
      .toBe('Equipamento 104821500016510');
    expect(container.querySelectorAll('.dashboard-erro')).toHaveLength(4);
    // Nenhum toast, mesmo com quatro falhas: cada aviso está no lugar dele.
    expect(toast.showError).not.toHaveBeenCalled();
  });
});

describe('ficha do bem: os auxiliares dos diálogos também caem sozinhos', () => {
  test('domínios e tipos fora do ar não tiram a ficha nem os históricos da tela', async () => {
    // Falhar aqui deixa um combo vazio num diálogo que ainda nem abriu, e não
    // uma ficha vazia. Um toast neste ponto falaria de uma tela que não existe.
    servico.getDominio.mockRejectedValue(new Error('domínio fora do ar'));
    servico.getTipos.mockRejectedValue(new Error('tipos fora do ar'));

    atual = await montar();
    const { container } = atual;

    expect(container.querySelector('.page__title')).not.toBeNull();
    expect(container.querySelectorAll('.dashboard-erro')).toHaveLength(0);
    expect(secao(container, 'Indisponibilidades').textContent).toContain('Cabeçote danificado');
    expect(toast.showError).not.toHaveBeenCalled();
  });
});

describe('ficha do bem: o bem é o caminho principal', () => {
  test('sem o bem não há tela, e os quatro históricos nem são perguntados', async () => {
    servico.getEquipamento.mockRejectedValue(new Error('Equipamento não encontrado'));

    atual = await montar('9999');
    const { container } = atual;

    expect(container.textContent).toContain('Equipamento não encontrado');
    expect(container.querySelector('.page__title')).toBeNull();
    // Quatro requisições para pintar nós que ninguém vê seriam desperdício puro.
    expect(servico.getIndisponibilidades).not.toHaveBeenCalled();
    expect(servico.getAfastamentos).not.toHaveBeenCalled();
    expect(servico.getManutencoes).not.toHaveBeenCalled();
    expect(servico.getTransferencias).not.toHaveBeenCalled();
    // E o botão de voltar, porque a tela não tem mais nada.
    expect([...container.querySelectorAll('.btn')].some(b => b.textContent.includes('Voltar')))
      .toBe(true);
  });

  test('a ficha JÁ montada não se apaga quando uma recarga do bem falha', async () => {
    atual = await montar();
    const { container } = atual;

    // Excluir um lançamento recarrega o bem, porque a situação do cabeçalho é
    // DERIVADA: o degrau que aquela linha sustentava deixa de valer.
    servico.getEquipamento.mockRejectedValueOnce(new Error('sem rede'));

    const excluir = secao(container, 'Indisponibilidades')
      .querySelector('[title="Excluir indisponibilidade"]');
    expect(excluir).not.toBeNull();
    excluir.click();
    await flush();
    await flush();
    await flush();

    expect(servico.deleteIndisponibilidade).toHaveBeenCalledWith(11);
    // Quem perdeu a rede por um instante veria o trabalho sumir: o aviso sai no
    // toast e a tela segue mostrando o último estado bom.
    expect(container.querySelector('.page__title').textContent)
      .toBe('Equipamento 104821500016510');
    expect(container.querySelector('.equip-ficha__situacao').textContent)
      .toBe('Indisponível');
    expect(toast.showError).toHaveBeenCalledWith('sem rede');
  });
});

describe('ficha do bem: o que cada perfil vê', () => {
  test('a consulta lê os quatro históricos e não recebe botão de lançamento', async () => {
    localStorage.clear();
    logarComo({ equipamento: CONSULTA });

    atual = await montar();
    const { container } = atual;

    // As quatro seções aparecem, com o conteúdo: a ficha é a única visão
    // completa do bem, e escondê-la de quem consulta seria esconder tudo.
    for (const titulo of ['Indisponibilidades', 'Manutenções', 'Afastamentos',
      'Transferências e descargas']) {
      expect(secao(container, titulo), `sumiu a seção ${titulo}`).not.toBeNull();
    }
    const rotulos = [...container.querySelectorAll('.btn')].map(b => b.textContent);
    expect(rotulos.some(r => r.includes('Nova indisponibilidade'))).toBe(false);
    expect(rotulos.some(r => r.includes('Editar equipamento'))).toBe(false);
  });

  test('o operador lança nos três históricos, e a transferência é do gerente', async () => {
    localStorage.clear();
    logarComo({ equipamento: OPERADOR });

    atual = await montar();
    const rotulos = [...atual.container.querySelectorAll('.btn')].map(b => b.textContent);

    expect(rotulos.some(r => r.includes('Nova indisponibilidade'))).toBe(true);
    expect(rotulos.some(r => r.includes('Nova manutenção'))).toBe(true);
    expect(rotulos.some(r => r.includes('Novo afastamento'))).toBe(true);
    // A transferência move o bem para fora da carga: ela é a única das quatro
    // que é do gerente, e o bem em si também.
    expect(rotulos.some(r => r.includes('Nova transferência'))).toBe(false);
    expect(rotulos.some(r => r.includes('Editar equipamento'))).toBe(false);
  });
});
