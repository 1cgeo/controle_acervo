import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { logarComo } from '@/__tests__/helpers/sessao.js';

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
//   - o MES CORRENTE e parcial, e a tela diz de quantos dias esta falando
//   - a media da Divisao e PONDERADA por dias na DGEO, com o nome escrito
//   - o custo do impedimento sai em DIAS-MILITAR, por causa
//   - o grafico so desenha quem esta abaixo de 100%, em ordem de grandeza
//   - falha de rota NAO se escreve com o mesmo texto do vazio legitimo
//   - a aba ativa se recarrega sozinha, como nos outros tres dashboards

vi.mock('@services/plataforma-service.js', () => ({
  getAcessosResumo: vi.fn(() => Promise.resolve({})),
  getAcessosLogados: vi.fn(() => Promise.resolve([])),
  getLoginsDia: vi.fn(() => Promise.resolve([])),
  getLoginsUsuarios: vi.fn(() => Promise.resolve([])),
  getEfetivoDoMes: vi.fn(() => Promise.resolve([])),
  getPeriodosEfetivo: vi.fn(() => Promise.resolve([])),
  getDivergenciasEfetivo: vi.fn(() => Promise.resolve([])),
  exportacoesEfetivo: vi.fn(() => []),
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

import { instanciasChart } from '@components/charts/chart-stub.js';

import { renderAcessos } from '@pages/acessos/index.js';
import {
  getAcessosResumo,
  getEfetivoDoMes,
  getPeriodosEfetivo,
  getDivergenciasEfetivo,
} from '@services/plataforma-service.js';

// O mes de referencia e o de HOJE, e os fixtures se montam em cima dele. Datas
// fixas no arquivo fariam o teste passar em agosto e falhar em setembro.
const HOJE = new Date();
const ANO = HOJE.getFullYear();
const MES = HOJE.getMonth() + 1;
const DIAS_DO_MES = new Date(ANO, MES, 0).getDate();
const dataDoMes = (dia) =>
  `${ANO}-${String(MES).padStart(2, '0')}-${String(dia).padStart(2, '0')}`;

// O MES DA FIXTURE ESTA FECHADO: `dias_decorridos` igual a `dias_do_mes`. O mes
// PARCIAL tem caso proprio, com fixture propria, porque e la que a tela tem de
// mudar de texto.
//
// Tres militares. A media SIMPLES seria (100 + 50 + 0) / 3 = 50,0%; a PONDERADA
// por dias na DGEO da 64,6%, e e ela que a tela escreve. Os dois numeros sao
// diferentes de proposito: com eles iguais, o caso nao reprovaria a volta da
// media simples.
//
//   disponiveis = 31x1,00 + 31x0,50 + 31x0,00 = 46,5 dias
//   presentes   = 31 + 31 + 10                = 72 dias
//   ponderada   = 46,5 / 72                   = 64,58...%  ->  '64,6%'
//
// Barreto e quem separa as duas contas: ele esteve 10 dias e rendeu zero, entao
// pesa 10 no denominador e nao 31.
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
    dias_decorridos: 31,
    dias_na_dgeo_decorridos: 31,
    // NUMERIC do PostgreSQL chega como STRING no JSON.
    aproveitamento: '100.0',
    aproveitamento_decorrido: '100.0',
    dias_perdidos: '0.00',
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
    dias_decorridos: 31,
    dias_na_dgeo_decorridos: 31,
    aproveitamento: '50.0',
    aproveitamento_decorrido: '50.0',
    dias_perdidos: '15.50',
    impedimentos: [
      {
        id: 7,
        descricao: 'Curso PCE-EECN',
        percentual: 50,
        data_inicio: dataDoMes(1),
        data_fim: null,
        dias_perdidos: '15.50',
      },
    ],
  },
  {
    usuario_uuid: 'uuid-barreto',
    nome: 'Barreto',
    nome_guerra: 'Barreto',
    login: 'sgt.barreto',
    ativo: false,
    posto_abrev: '2 Sgt',
    posto: 'Segundo Sargento',
    dias_do_mes: 31,
    dias_na_dgeo: 10,
    dias_decorridos: 31,
    dias_na_dgeo_decorridos: 10,
    aproveitamento: '0.0',
    aproveitamento_decorrido: '0.0',
    dias_perdidos: '10.00',
    impedimentos: [
      {
        id: 9,
        descricao: 'Licença maternidade',
        percentual: 100,
        data_inicio: dataDoMes(1),
        data_fim: null,
        dias_perdidos: '10.00',
      },
    ],
  },
];

const PERIODOS = [
  // Entrou neste ano.
  {
    id: 1,
    usuario_uuid: 'uuid-silva',
    nome_guerra: 'Silva',
    posto_abrev: '3 Sgt',
    data_inicio: dataDoMes(3),
    data_fim: null,
  },
  // Saiu neste ano.
  {
    id: 2,
    usuario_uuid: 'uuid-souza',
    nome_guerra: 'Souza',
    posto_abrev: 'Cap',
    data_inicio: `${ANO - 1}-01-10`,
    data_fim: dataDoMes(15),
  },
  // Passagem antiga e aberta: nao e entrada nem saida DESTE ano.
  {
    id: 3,
    usuario_uuid: 'uuid-raul',
    nome_guerra: 'Raul',
    posto_abrev: '1 Ten',
    data_inicio: `${ANO - 2}-03-01`,
    data_fim: null,
  },
];

// Quem RECORTA e o servidor, sob `/efetivo/divergencias`. Conta de servico:
// habilitada, e sem passagem nenhuma pela Divisao.
const DIVERGENCIAS = [
  { usuario_uuid: 'uuid-claude', nome_guerra: 'Claude', posto_abrev: 'Civ' },
];

let container;

beforeEach(() => {
  vi.clearAllMocks();
  // A casca monta a aba Acessos so para o administrador global, e um dos casos
  // aqui mede a ordem das duas abas.
  logarComo({}, { administrador: true });
  getEfetivoDoMes.mockResolvedValue(EFETIVO);
  getPeriodosEfetivo.mockResolvedValue(PERIODOS);
  getDivergenciasEfetivo.mockResolvedValue(DIVERGENCIAS);
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

  // A CONTAGEM E POR CARGA, e nao por chamada: cada carga pede o mes da tela E o
  // ANTERIOR, que e de onde sai o delta em pontos percentuais. Medir aqui pela
  // divergencia, que e uma por carga, deixa o caso imune a essa aritmetica.
  test('a aba ativa se recarrega sozinha', async () => {
    vi.useFakeTimers();
    try {
      const cleanup = await renderAcessos(container, {});
      await vi.advanceTimersByTimeAsync(0);

      expect(getDivergenciasEfetivo).toHaveBeenCalledTimes(1);
      expect(getEfetivoDoMes).toHaveBeenCalledTimes(2);

      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(getDivergenciasEfetivo).toHaveBeenCalledTimes(2);

      // O cleanup para o relogio: sem isso a tela fechada continuaria buscando.
      cleanup();
      await vi.advanceTimersByTimeAsync(60 * 1000);
      expect(getDivergenciasEfetivo).toHaveBeenCalledTimes(2);
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

  // A TELA AO LADO (#/aproveitamento) JA DIZIA QUE A SIMPLES E A ERRADA: ela da
  // o mesmo peso a quem ficou um dia e a quem ficou o mes, e era assim que uma
  // chegada no fim do mes derrubava o numero da Divisao. As duas telas do modulo
  // publicavam medias diferentes com o mesmo nome.
  test('a media da Divisao e PONDERADA por dias na DGEO, e nao a simples', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    // 46,5 dias disponiveis / 72 dias presentes. O NUMERIC chega como string, e
    // somar string concatenaria em vez de somar.
    expect(valorDoCard('Aproveitamento da Divisão, ponderado por dias na DGEO')).toBe('64,6%');

    cleanup();
  });

  // O QUE O PERCENTUAL MEDIO NAO RESPONDE: quanto o mes perdeu, e para que.
  // 15,5 dias do curso mais 10 da licenca.
  test('soma o custo do impedimento em dias-militar, e o abre por causa', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(valorDoCard('Dias-militar perdidos para impedimento')).toBe('25,5 dias');

    const corpo = container.textContent;
    expect(corpo).toContain('Dias-militar perdidos, por causa');
    expect(corpo).toContain('Curso PCE-EECN');
    expect(corpo).toContain('Licença maternidade');

    cleanup();
  });

  // MENSAL ERA ZERO QUASE SEMPRE: em 2026 houve entrada em 4 dos 12 meses e
  // saida em 2, e 23 das 27 passagens sao a carga de 1º de janeiro. Um cartao
  // que marca zero onze meses por ano mede o recorte, e nao o movimento.
  test('conta quem entrou e quem saiu no ANO, e nao no mes', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(getPeriodosEfetivo).toHaveBeenCalledWith(ANO);

    const corpo = container.textContent;
    expect(corpo).toContain('Entradas e saídas no ano');
    expect(corpo).toContain(`1 entrada e 1 saída em ${ANO}.`);
    // A pergunta mensal saiu de vez: ela era a que nascia zero.
    expect(rotulosCards()).not.toContain('Entradas no mês');
    expect(rotulosCards()).not.toContain('Saídas no mês');

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

    // QUEM RECORTA E O SERVIDOR, sob o modulo efetivo. Antes a tela cruzava
    // `GET /usuarios`, que e verifyAdmin e devolve o cadastro inteiro (login,
    // flag de administrador, perfil em cada modulo) para contar tres nomes: era
    // isso que trancava o dashboard do efetivo no administrador global.
    expect(getDivergenciasEfetivo).toHaveBeenCalledWith(ANO, MES);

    // A TABELA de divergencias, e nao a secao em volta: a aba inteira contem a
    // lista de militares do mes, onde "Barreto" aparece por direito.
    const tabela = Array.from(container.querySelectorAll('table'))
      .find(t => t.textContent.includes('O que não bate'));
    expect(tabela).toBeDefined();

    // Conta habilitada e sem passagem pela Divisao no mes: esta entra.
    expect(tabela.textContent).toContain('Claude');
    // Esteve na Divisao no mes com a conta desativada: esta NAO entra.
    expect(tabela.textContent).not.toContain('Barreto');

    expect(valorDoCard('Contas ativas sem passagem no mês')).toBe('1');

    cleanup();
  });

  // A TELA NAO PEDE MAIS O CADASTRO INTEIRO, e quem faz isso valer e o MOCK
  // deste arquivo: ele nao exporta `getUsuarios`, entao a pagina que voltar a
  // chama-la quebra em TODOS os casos daqui com "No getUsuarios export is
  // defined on the mock". Um `not.toHaveBeenCalled()` nao serviria: a funcao nem
  // existe para ser espionada.
  //
  // O caso guarda o outro lado, que e o que muda a permissao: `getUsuarios`
  // continua no servico, para a tela de Gestao, e o que saiu foi o USO dela
  // aqui. `importActual` fura o mock de proposito.
  test('a rota de divergencia mora no modulo efetivo, e nao no cadastro', async () => {
    const serviceReal = await vi.importActual('@services/plataforma-service.js');

    expect(typeof serviceReal.getUsuarios).toBe('function');
    expect(typeof serviceReal.getDivergenciasEfetivo).toBe('function');

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(getDivergenciasEfetivo).toHaveBeenCalledWith(ANO, MES);

    cleanup();
  });

  // A COLUNA 'Conta' MOSTRAVA 25 CELULAS IGUAIS em producao, e a propria tela
  // argumenta que `dgeo.usuario.ativo` e flag de LOGIN e nao efetivo: ela dizia
  // "Ativa" para todo mundo e ocupava uma coluna.
  //
  // O DENOMINADOR ENTROU no lugar: '10 de 31' e '31 de 31' separam "chegou dia
  // 22" de "esteve o mes e nao rendeu", que e a mesma razao pela qual o mapa
  // anual escreve "5 de 7 dias".
  test('a tabela troca a coluna de conta pelo denominador dos dias', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    const tabela = Array.from(container.querySelectorAll('table'))
      .find(t => t.textContent.includes('Dias na Divisão'));
    expect(tabela).toBeDefined();

    const cabecalhos = Array.from(tabela.querySelectorAll('th')).map(e => e.textContent.trim());
    expect(cabecalhos).not.toContain('Conta');
    expect(cabecalhos).toContain('Dias perdidos');
    expect(tabela.textContent).not.toContain('Desativada');

    // Barreto esteve 10 dos 31 dias decorridos.
    expect(tabela.textContent).toContain('10 de 31');
    expect(tabela.textContent).toContain('31 de 31');

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

    // `toHaveBeenCalledWith`, e nao `LastCalledWith`: a ULTIMA chamada da carga e
    // a do mes ANTERIOR (fevereiro), que alimenta o delta.
    expect(getEfetivoDoMes).toHaveBeenCalledWith(ANO, 3);
    expect(getEfetivoDoMes).toHaveBeenLastCalledWith(ANO, 2);
    expect(getDivergenciasEfetivo).toHaveBeenLastCalledWith(ANO, 3);

    cleanup();
  });

  // JANEIRO VIRA O ANO PARA TRAS. Sem isso o delta de janeiro pediria o mes 0,
  // que o Joi do servidor recusa (min 1), e a comparacao sumiria justamente no
  // mes em que o chefe fecha o ano.
  test('em janeiro, o mes anterior e dezembro do ano de tras', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    const seletorMes = container.querySelector('[aria-label="Selecionar mês"]');
    seletorMes.value = '1';
    seletorMes.dispatchEvent(new Event('change'));
    await flush();

    expect(getEfetivoDoMes).toHaveBeenLastCalledWith(ANO - 1, 12);

    cleanup();
  });

  test('o cartao diz o que mede, sem adjetivo', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(rotulosCards()).toEqual([
      'Militares na Divisão no mês',
      'Aproveitamento da Divisão, ponderado por dias na DGEO',
      'Dias-militar perdidos para impedimento',
      'Contas ativas sem passagem no mês',
    ]);

    cleanup();
  });
});

// O MES CORRENTE E PARCIAL, e ate aqui a tela nao dizia.
//
// A passagem em aberto (`data_fim` NULA) cobre o mes INTEIRO, inclusive o que
// nao aconteceu: em 07/08/2026 a conta do mes inteiro ja dava 31 de 31 dias a
// 100% para os 25 militares, e o cartao que abria a tela publicava projecao com
// cara de medida. O servidor passou a devolver os campos `_decorrido`, e a tela
// escreve de quantos dias esta falando.
describe('aba Efetivo: o mes corrente e parcial', () => {
  /** A mesma fixture, cortada em N dias decorridos. */
  const parcial = (decorridos) => EFETIVO.map(e => ({
    ...e,
    dias_decorridos: decorridos,
    dias_na_dgeo_decorridos: Math.min(Number(e.dias_na_dgeo_decorridos), decorridos),
    aproveitamento_decorrido: e.aproveitamento_decorrido,
    dias_perdidos: e.dias_perdidos,
  }));

  test('diz quantos dias do mes ja correram', async () => {
    getEfetivoDoMes.mockResolvedValue(parcial(7));

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(container.textContent).toContain(`Mês em curso: os números abaixo cobrem 7 de ${DIAS_DO_MES} dias.`);

    cleanup();
  });

  test('mes fechado nao ganha aviso de parcial', async () => {
    getEfetivoDoMes.mockResolvedValue(parcial(DIAS_DO_MES));

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(container.textContent).not.toContain('Mês em curso');

    cleanup();
  });

  // NAO DEU PARA MEDIR e MEDIU ZERO sao coisas diferentes. Um mes que ainda nao
  // comecou nao tem aproveitamento: escrever '0%' ali afirmaria que a Divisao
  // nao rendeu nada, que e a afirmacao oposta.
  test('mes que ainda nao comecou nao vira zero', async () => {
    getEfetivoDoMes.mockResolvedValue(EFETIVO.map(e => ({
      ...e,
      dias_decorridos: 0,
      dias_na_dgeo_decorridos: 0,
      aproveitamento_decorrido: null,
      dias_perdidos: '0.00',
    })));

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(valorDoCard('Aproveitamento da Divisão, ponderado por dias na DGEO')).toBe('Ainda não');
    expect(valorDoCard('Dias-militar perdidos para impedimento')).toBe('Ainda não');
    expect(container.textContent).toContain('ainda não começou');
    expect(container.textContent).not.toContain('Falha ao carregar');

    cleanup();
  });

  // O delta compara TAXA com taxa, e nunca volume com volume: 7 dias de agosto
  // contra 31 de julho em dias-militar nao compara nada.
  test('compara o aproveitamento com o mes anterior, em pontos percentuais', async () => {
    // O MES ANTERIOR TEM DE SER COERENTE: `aproveitamento_decorrido` x
    // `dias_decorridos` / 100 nunca passa de `dias_na_dgeo_decorridos`, porque o
    // dia fora da Divisao entra no denominador com disponibilidade NULA. Com
    // Barreto a 100% em 31 dias e presente em 10, a ponderada dava 129%, que e
    // impossivel -- e o caso reprovava por causa da fixture, e nao do codigo.
    const anterior = EFETIVO.map(e => ({
      ...e,
      dias_na_dgeo_decorridos: 31,
      aproveitamento_decorrido: '100.0',
      dias_perdidos: '0.00',
    }));
    getEfetivoDoMes
      .mockResolvedValueOnce(EFETIVO)
      .mockResolvedValueOnce(anterior);

    const cleanup = await renderAcessos(container, {});
    await flush();

    // 64,6% agora contra 100% no mes anterior.
    expect(container.textContent).toContain('ponto percentual contra');
    expect(container.textContent).toContain('-35,4');

    cleanup();
  });

  // A COMPARACAO E ACESSORIA: ela nao pode derrubar a tela nem virar toast de
  // erro, senao um mes sem historico se leria como falha da tela.
  test('sem o mes anterior, a tela fica de pe e sem erro', async () => {
    getEfetivoDoMes
      .mockResolvedValueOnce(EFETIVO)
      .mockRejectedValueOnce(new Error('deu ruim'));

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(valorDoCard('Aproveitamento da Divisão, ponderado por dias na DGEO')).toBe('64,6%');
    expect(container.textContent).not.toContain('ponto percentual contra');
    expect(container.textContent).not.toContain('Falha ao carregar');

    cleanup();
  });
});

// COM 25 MILITARES, 19 DELES A 100%, o grafico era uma parede de barras iguais
// dentro de 300px de altura, ordenada por HIERARQUIA e nao por grandeza. As 6
// barras que carregavam a informacao ficavam espalhadas no meio.
describe('aba Efetivo: o grafico so desenha quem tem o que dizer', () => {
  // O duble guarda a config recebida, entao da para conferir os rotulos sem
  // desenhar nada. A instancia 0 e o grafico de aproveitamento, que e o primeiro
  // a ser montado na aba.
  const rotulosDoGrafico = () =>
    (instanciasChart.length ? instanciasChart[0].data.labels : null);

  test('deixa de fora quem esta a 100%, e ordena por grandeza', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    const rotulos = rotulosDoGrafico();
    expect(rotulos).not.toBeNull();
    // Silva esta a 100% e nao entra. Raul (50%) e Barreto (0%) entram, em ordem
    // CRESCENTE: o Chart.js desenha o indice 0 no topo do eixo de categoria, e o
    // pior tem de ser a primeira linha que o olho encontra.
    expect(rotulos).toEqual(['2 Sgt Barreto', '1 Ten Raul']);

    cleanup();
  });

  test('ninguem abaixo de 100% e uma resposta, e nao falta de dado', async () => {
    getEfetivoDoMes.mockResolvedValue([{
      ...EFETIVO[0],
      impedimentos: [],
    }]);

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(container.textContent).toContain('Todos os militares do mês estão a 100%');
    expect(container.textContent).not.toContain('Sem dados disponíveis');
    expect(container.textContent).not.toContain('Falha ao carregar');

    cleanup();
  });
});
