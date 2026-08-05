import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A aba EFETIVO de #/acessos, e a casca de duas abas que a contem.
//
// POR QUE ELA EXISTE., a tela media login e nao
// gente: "quem mais entrou" trazia a conta de servico `claude` com 98 dos 102
// logins, e dois dos quatro graficos nasciam degenerados. O chefe nao pergunta
// quem entrou no sistema; ele pergunta quem esta na Divisao, quanto rendeu, quem
// chegou, quem saiu e quem esta impedido.
//
// A visao de MES do efetivo ja existia e nao tinha tela: `controller.resumoMensal`
// e a rota `/efetivo/mes` nasceram para a subsecao 6.1 do RPCMTec, e nenhuma
// pagina do client consumia `getEfetivoDoMes`. Esta aba e a leitora que faltava.
//
// O que estes testes guardam:
//   - a aba Efetivo ABRE a tela; Acessos e a segunda
//   - a rota (#/acessos) e o rotulo do menu ('Dashboard') nao mudam com isso
//   - o subtitulo que descrevia o schema de `dgeo.login` saiu
//   - falha de rota NAO se escreve com o mesmo texto do vazio legitimo
//   - a aba ativa se recarrega sozinha, como nos outros tres dashboards

vi.mock('@services/plataforma-service.js', () => ({
  getAcessosResumo: vi.fn(() => Promise.resolve({})),
  getAcessosLogados: vi.fn(() => Promise.resolve([])),
  getLoginsDia: vi.fn(() => Promise.resolve([])),
  getLoginsUsuarios: vi.fn(() => Promise.resolve([])),
  getEfetivoDoMes: vi.fn(() => Promise.resolve([])),
  getPeriodosEfetivo: vi.fn(() => Promise.resolve([])),
  getUsuarios: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@utils/toast.js', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
  showToast: vi.fn(),
}));

// O jsdom nao tem canvas, entao o Chart.js de verdade nao roda em teste.
vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

import { renderAcessos } from '@pages/acessos/index.js';
import {
  getAcessosResumo,
  getEfetivoDoMes,
  getPeriodosEfetivo,
  getUsuarios,
} from '@services/plataforma-service.js';

// O mes de referencia e o de HOJE, e os fixtures se montam em cima dele. Datas
// fixas no arquivo fariam o teste passar em agosto e falhar em setembro.
const HOJE = new Date();
const ANO = HOJE.getFullYear();
const MES = HOJE.getMonth() + 1;
const dataDoMes = (dia) =>
  `${ANO}-${String(MES).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

// Tres militares com passagem no mes. A media da Divisao e (100 + 50 + 0) / 3.
const EFETIVO = [
  {
    usuario_uuid: 'uuid-silva',
    nome: 'Silva da Silva',
    nome_guerra: 'Silva',
    login: 'sgt.silva',
    ativo: true,
    posto_abrev: '3 Sgt',
    posto: 'Terceiro Sargento',
    dias_do_mes: 31,
    dias_na_dgeo: 31,
    // NUMERIC do PostgreSQL chega como STRING no JSON.
    aproveitamento: '100.0',
    impedimentos: [],
  },
  {
    usuario_uuid: 'uuid-raul',
    nome: 'Raul Magno',
    nome_guerra: 'Raul',
    login: 'ten.raul',
    ativo: true,
    posto_abrev: '1 Ten',
    posto: 'Primeiro Tenente',
    dias_do_mes: 31,
    dias_na_dgeo: 31,
    aproveitamento: '50.0',
    impedimentos: [
      {
        id: 7,
        descricao: 'Curso PCE-EECN',
        percentual: 50,
        data_inicio: dataDoMes(1),
        data_fim: null,
      },
    ],
  },
  {
    // Esta e a divergencia: esteve na Divisao no mes e a conta esta desativada.
    usuario_uuid: 'uuid-barreto',
    nome: 'Barreto',
    nome_guerra: 'Barreto',
    login: 'sgt.barreto',
    ativo: false,
    posto_abrev: '2 Sgt',
    posto: 'Segundo Sargento',
    dias_do_mes: 31,
    dias_na_dgeo: 10,
    aproveitamento: '0.0',
    impedimentos: [],
  },
];

const PERIODOS = [
  // Entrou no mes.
  {
    id: 1,
    usuario_uuid: 'uuid-silva',
    nome_guerra: 'Silva',
    posto_abrev: '3 Sgt',
    data_inicio: dataDoMes(3),
    data_fim: null,
  },
  // Saiu no mes.
  {
    id: 2,
    usuario_uuid: 'uuid-souza',
    nome_guerra: 'Souza',
    posto_abrev: 'Cap',
    data_inicio: `${ANO - 1}-01-10`,
    data_fim: dataDoMes(15),
  },
  // Passagem antiga e aberta: nao e entrada nem saida deste mes.
  {
    id: 3,
    usuario_uuid: 'uuid-raul',
    nome_guerra: 'Raul',
    posto_abrev: '1 Ten',
    data_inicio: `${ANO - 2}-03-01`,
    data_fim: null,
  },
];

const USUARIOS = [
  { uuid: 'uuid-silva', login: 'sgt.silva', nome_guerra: 'Silva', tipo_posto_grad: '3 Sgt', ativo: true, senha_definida: true },
  { uuid: 'uuid-raul', login: 'ten.raul', nome_guerra: 'Raul', tipo_posto_grad: '1 Ten', ativo: true, senha_definida: true },
  { uuid: 'uuid-barreto', login: 'sgt.barreto', nome_guerra: 'Barreto', tipo_posto_grad: '2 Sgt', ativo: false, senha_definida: true },
  // Conta de servico: habilitada, e sem passagem nenhuma pela Divisao.
  { uuid: 'uuid-claude', login: 'claude', nome_guerra: 'Claude', tipo_posto_grad: 'Civ', ativo: true, senha_definida: true },
];

let container;

beforeEach(() => {
  vi.clearAllMocks();
  getEfetivoDoMes.mockResolvedValue(EFETIVO);
  getPeriodosEfetivo.mockResolvedValue(PERIODOS);
  getUsuarios.mockResolvedValue(USUARIOS);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

const abas = () => Array.from(container.querySelectorAll('.tabs > .tabs__item'));
const rotulosCards = () =>
  Array.from(container.querySelectorAll('.stats-card__title')).map(e => e.textContent.trim());
const valorDoCard = (rotulo) => {
  const titulo = Array.from(container.querySelectorAll('.stats-card__title'))
    .find(e => e.textContent.trim() === rotulo);
  if (!titulo) return null;
  return titulo.parentElement.querySelector('.stats-card__value').textContent.trim();
};

describe('a casca de duas abas', () => {
  test('abre na aba Efetivo, e Acessos e a segunda', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(abas().map(b => b.textContent)).toEqual(['Efetivo', 'Acessos']);
    expect(abas()[0].getAttribute('aria-selected')).toBe('true');

    // Abrir a tela le o EFETIVO. O historico de login so se busca ao trocar de
    // aba: so a aba ativa existe no DOM, como nos outros tres dashboards.
    expect(getEfetivoDoMes).toHaveBeenCalled();
    expect(getAcessosResumo).not.toHaveBeenCalled();

    cleanup();
  });

  test('usa o titulo de dashboard da casa, e nao o de pagina', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(container.querySelector('.dashboard')).not.toBeNull();
    expect(container.querySelector('.dashboard__title')).not.toBeNull();

    cleanup();
  });

  // O subtitulo descrevia o SCHEMA ("uma linha por entrada bem-sucedida"), que e
  // contrato de tabela e nao resposta a pergunta nenhuma. Nenhum dos outros tres
  // dashboards tem subtitulo.
  test('nao tem subtitulo descrevendo o schema', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(container.querySelector('.page__subtitle')).toBeNull();
    expect(container.textContent).not.toContain('Histórico de login do SCA');
    expect(container.textContent).not.toContain('entrada bem-sucedida');

    cleanup();
  });

  test('a aba ativa se recarrega sozinha', async () => {
    vi.useFakeTimers();
    try {
      const cleanup = await renderAcessos(container, {});
      await vi.advanceTimersByTimeAsync(0);

      expect(getEfetivoDoMes).toHaveBeenCalledTimes(1);

      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(getEfetivoDoMes).toHaveBeenCalledTimes(2);

      // O cleanup para o relogio: sem isso a tela fechada continuaria buscando.
      cleanup();
      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(getEfetivoDoMes).toHaveBeenCalledTimes(2);
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('aba Efetivo: o que o chefe pergunta', () => {
  test('pede o efetivo do MES corrente', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(getEfetivoDoMes).toHaveBeenCalledWith(ANO, MES);

    cleanup();
  });

  test('conta os militares na Divisao no mes', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(valorDoCard('Militares na Divisão no mês')).toBe('3');

    cleanup();
  });

  test('mostra o aproveitamento medio da Divisao no mes', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    // (100 + 50 + 0) / 3. O NUMERIC chega como string, e somar string
    // concatenaria em vez de somar.
    expect(valorDoCard('Aproveitamento médio no mês')).toBe('50%');

    cleanup();
  });

  test('conta quem entrou e quem saiu no mes', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(getPeriodosEfetivo).toHaveBeenCalledWith(ANO);
    expect(valorDoCard('Entradas no mês')).toBe('1');
    expect(valorDoCard('Saídas no mês')).toBe('1');

    cleanup();
  });

  // Impedimento e TEXTO LIVRE por decisao do chefe: nao ha catalogo
  // de tipo, e a tela nao inventa um. Ela lista o que esta escrito, e o curso
  // aparece pela propria descricao.
  test('lista quem esta impedido no mes, com o motivo escrito', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    const corpo = container.textContent;
    expect(corpo).toContain('Curso PCE-EECN');
    expect(corpo).toContain('Raul');

    cleanup();
  });

  // Os três números de "quantas pessoas" do módulo (contas ativas, pessoas
  // cadastradas, militares no mapa) não batem, e esta seção nomeia o desencontro.
  //
  // ESTAR NA DGEO COM A CONTA DESATIVADA NÃO É DIVERGÊNCIA: `dgeo.usuario.ativo`
  // é flag de LOGIN, e a maioria do efetivo não usa o SCA. Apontar isso listaria
  // quase a Divisão inteira.
  //
  // Sobra a divergência que aponta trabalho: quem PODE ENTRAR no sistema e não
  // consta na Divisão. Ou a passagem não foi lançada, ou a pessoa saiu e o
  // acesso ficou aberto.
  test('so aponta conta ativa sem passagem no mes', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(getUsuarios).toHaveBeenCalled();

    // A TABELA de divergencias, e nao a secao em volta: a aba inteira contem a
    // lista de militares do mes, onde "Barreto" aparece por direito.
    const tabela = Array.from(container.querySelectorAll('table'))
      .find(t => t.textContent.includes('O que não bate'));
    expect(tabela).toBeDefined();

    // Conta habilitada e sem passagem pela Divisao no mes: esta entra.
    expect(tabela.textContent).toContain('Claude');
    // Esteve na Divisao no mes com a conta desativada: esta NAO entra mais.
    expect(tabela.textContent).not.toContain('Barreto');

    expect(valorDoCard('Divergências entre cadastro e efetivo')).toBe('1');

    cleanup();
  });

  test('a linha do militar leva ao aproveitamento dele', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    const link = Array.from(container.querySelectorAll('a'))
      .find(a => a.getAttribute('href')?.includes('uuid-silva'));

    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('#/aproveitamento?usuario_uuid=uuid-silva');

    cleanup();
  });

  // FALHA E VAZIO SAO COISAS DIFERENTES. Ate aqui a rota fora do ar virava '-'
  // no cartao e 'Sem dados disponiveis' no grafico, texto identico ao zero
  // legitimo: o chefe lia "ninguem esta impedido" quando a verdade era "nao deu
  // para saber".
  test('falha de rota nao se escreve como zero legitimo', async () => {
    getEfetivoDoMes.mockRejectedValue(new Error('deu ruim'));

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(valorDoCard('Militares na Divisão no mês')).toBe('Erro');
    expect(container.textContent).toContain('Falha ao carregar');
    expect(container.textContent).not.toContain('Sem dados disponíveis');

    cleanup();
  });

  test('mes sem ninguem diz que esta vazio, e nao que falhou', async () => {
    getEfetivoDoMes.mockResolvedValue([]);

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(valorDoCard('Militares na Divisão no mês')).toBe('0');
    expect(container.textContent).not.toContain('Falha ao carregar');

    cleanup();
  });

  test('trocar o mes recarrega a aba', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    const seletorMes = container.querySelector('[aria-label="Selecionar mês"]');
    expect(seletorMes).not.toBeNull();

    seletorMes.value = '3';
    seletorMes.dispatchEvent(new Event('change'));
    await flush();

    expect(getEfetivoDoMes).toHaveBeenLastCalledWith(ANO, 3);

    cleanup();
  });

  test('o cartao diz o que mede, sem adjetivo', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(rotulosCards()).toEqual([
      'Militares na Divisão no mês',
      'Aproveitamento médio no mês',
      'Entradas no mês',
      'Saídas no mês',
      'Divergências entre cadastro e efetivo',
    ]);

    cleanup();
  });
});
