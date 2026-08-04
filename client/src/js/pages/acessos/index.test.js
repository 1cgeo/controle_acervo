import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// A aba ACESSOS de #/acessos: o historico de login, enxugado.
//
// A tela nasceu em 2026-08-02, com a fusao da autenticacao: ate ali o registro
// de quem entrava no SCA morava no banco do Auth Server, e o painel que o lia
// era de la. Em 2026-08-04 ela deixou de ser a tela inteira e virou a SEGUNDA
// aba, atras do efetivo.
//
// O QUE MUDOU, e o que estes testes guardam:
//   - o cartao conta PESSOA distinta, e nao linha de `dgeo.login`; com JWT de
//     8 horas e dois clientes, a mesma pessoa contava varias vezes por dia
//   - o cartao de conta habilitada se chama "conta", e nao "usuario": ele mede
//     `dgeo.usuario.ativo`, que e permissao de entrar e nao gente na Divisao
//   - a tela mostra quem NAO consegue entrar (`senha` nula)
//   - a serie de 12 meses e o grafico "por onde se entra" sairam: os dois
//     nasciam degenerados (dez meses em zero, e uma barra sobre dois valores)
//   - o recorte do periodo agora e escolhido na tela
//   - a linha de quem entrou hoje leva ao aproveitamento daquela pessoa
//   - falha de rota nao se escreve com o texto do vazio legitimo

vi.mock('@services/plataforma-service.js', () => ({
  getAcessosResumo: vi.fn(() => Promise.resolve({})),
  getAcessosLogados: vi.fn(() => Promise.resolve([])),
  getLoginsDia: vi.fn(() => Promise.resolve([])),
  getLoginsMes: vi.fn(() => Promise.resolve([])),
  getLoginsUsuarios: vi.fn(() => Promise.resolve([])),
  getLoginsClientes: vi.fn(() => Promise.resolve([])),
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

// O jsdom nao tem canvas, entao o Chart.js de verdade nao roda em teste. O
// projeto ja resolve isso com o duble em @components/charts/chart-stub.js.
vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

import { renderAcessos } from '@pages/acessos/index.js';
import {
  getAcessosResumo,
  getAcessosLogados,
  getLoginsDia,
  getLoginsMes,
  getLoginsUsuarios,
  getLoginsClientes,
} from '@services/plataforma-service.js';
import { showError } from '@utils/toast.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

const RESUMO = {
  pessoas_hoje: 4,
  pessoas_30_dias: 9,
  contas_ativas: 7,
  contas_sem_senha: 3,
};

// UMA linha por pessoa, com os clientes dela ao lado. Ate 2026-08-04 era uma
// linha por par pessoa + cliente, e quem abria a interface e o plugin no mesmo
// dia aparecia duas vezes numa tabela que responde "quem esta no sistema".
const LOGADOS = [
  {
    uuid: 'uuid-silva',
    login: 'sgt.silva',
    nome_guerra: 'Silva',
    tipo_posto_grad: '3 Sgt',
    ultimo_login: '2026-08-04T13:20:00.000Z',
    logins: 3,
    clientes: ['sca_web', 'sca_qgis'],
  },
  {
    uuid: 'uuid-souza',
    login: 'cap.souza',
    nome_guerra: 'Souza',
    tipo_posto_grad: 'Cap',
    ultimo_login: '2026-08-04T11:05:00.000Z',
    logins: 1,
    clientes: ['sca_qgis'],
  },
];

let container;

beforeEach(() => {
  vi.clearAllMocks();
  getAcessosResumo.mockResolvedValue(RESUMO);
  getAcessosLogados.mockResolvedValue(LOGADOS);
  getLoginsDia.mockResolvedValue([
    { data: '2026-08-03', logins: 3 },
    { data: '2026-08-04', logins: 5 },
  ]);
  getLoginsUsuarios.mockResolvedValue([
    { usuario: '3 Sgt Silva (sgt.silva)', logins: 20 },
  ]);
  container = document.createElement('div');
  document.body.appendChild(container);
});

afterEach(() => {
  container.remove();
});

const abas = () => Array.from(container.querySelectorAll('.tabs > .tabs__item'));

/** Abre a aba Acessos, que nao e a que a tela abre. */
async function abrirAcessos() {
  const cleanup = await renderAcessos(container, {});
  await flush();
  abas().find(b => b.textContent === 'Acessos').click();
  await flush();
  return cleanup;
}

const rotulosCards = () =>
  Array.from(container.querySelectorAll('.stats-card__title')).map(e => e.textContent.trim());

const valorDoCard = (rotulo) => {
  const titulo = Array.from(container.querySelectorAll('.stats-card__title'))
    .find(e => e.textContent.trim() === rotulo);
  if (!titulo) return null;
  return titulo.parentElement.querySelector('.stats-card__value').textContent.trim();
};

describe('aba Acessos: o cartao diz o que mede', () => {
  test('conta pessoas distintas, e nomeia a conta como conta', async () => {
    const cleanup = await abrirAcessos();

    expect(rotulosCards()).toEqual([
      'Pessoas que entraram hoje',
      'Pessoas que entraram em 30 dias',
      'Contas ativas',
      'Contas sem senha',
    ]);
    expect(valorDoCard('Pessoas que entraram hoje')).toBe('4');
    expect(valorDoCard('Pessoas que entraram em 30 dias')).toBe('9');
    expect(valorDoCard('Contas ativas')).toBe('7');
    // `dgeo.usuario.senha` nula e quem NAO consegue entrar.
    expect(valorDoCard('Contas sem senha')).toBe('3');

    cleanup();
  });

  // Os dois nasciam degenerados por construcao: `dgeo.login` comecou em
  // 2026-08-02, entao dez dos doze meses eram zero; e "por onde se entra" e uma
  // barra sobre um dominio de DOIS valores, fixado no Joi do login.
  test('nao pede a serie de 12 meses nem o grafico de clientes', async () => {
    const cleanup = await abrirAcessos();

    expect(getLoginsMes).not.toHaveBeenCalled();
    expect(getLoginsClientes).not.toHaveBeenCalled();
    expect(container.textContent).not.toContain('Por onde se entra');
    expect(container.textContent).not.toContain('12 meses');

    cleanup();
  });
});

describe('aba Acessos: o recorte do periodo', () => {
  test('manda o recorte que a tela escolheu', async () => {
    const cleanup = await abrirAcessos();

    expect(getLoginsDia).toHaveBeenCalledWith(30);
    expect(getLoginsUsuarios).toHaveBeenCalledWith(30, expect.any(Number));

    cleanup();
  });

  test('trocar o periodo rebusca as duas series', async () => {
    const cleanup = await abrirAcessos();

    const seletor = container.querySelector('[aria-label="Selecionar período"]');
    expect(seletor).not.toBeNull();

    seletor.value = '90';
    seletor.dispatchEvent(new Event('change'));
    await flush();

    expect(getLoginsDia).toHaveBeenLastCalledWith(90);
    expect(getLoginsUsuarios).toHaveBeenLastCalledWith(90, expect.any(Number));

    cleanup();
  });
});

describe('aba Acessos: quem entrou hoje', () => {
  test('uma linha por pessoa, com o cliente por extenso', async () => {
    const cleanup = await abrirAcessos();

    const corpo = container.textContent;
    expect(corpo).toContain('3 Sgt Silva');
    expect(corpo).toContain('sgt.silva');
    // 'sca_web' e codigo de contrato, nao rotulo de tela.
    expect(corpo).toContain('Interface web');
    expect(corpo).toContain('Plugin do QGIS');
    expect(corpo).not.toContain('sca_web');

    cleanup();
  });

  // Sem o uuid a linha nao vira link, e era esse o motivo de a consulta antiga
  // devolver um ROW_NUMBER sintetico no lugar da identidade da pessoa.
  test('a linha leva ao aproveitamento da pessoa', async () => {
    const cleanup = await abrirAcessos();

    const link = Array.from(container.querySelectorAll('a'))
      .find(a => a.getAttribute('href')?.includes('uuid-silva'));

    expect(link).toBeDefined();
    expect(link.getAttribute('href')).toBe('#/aproveitamento?usuario_uuid=uuid-silva');

    cleanup();
  });

  test('sem ninguem logado hoje, a tabela diz isso em vez de ficar vazia', async () => {
    getAcessosLogados.mockResolvedValue([]);

    const cleanup = await abrirAcessos();

    expect(container.textContent).toContain('Ninguém entrou hoje');
    expect(container.textContent).not.toContain('Falha ao carregar');

    cleanup();
  });
});

describe('aba Acessos: falha nao e vazio', () => {
  // Sao rotas independentes. Com `Promise.all`, uma delas fora do ar deixaria a
  // aba inteira em branco, inclusive as que responderam.
  test('uma rota que falha nao derruba o resto da aba', async () => {
    getLoginsDia.mockRejectedValue(new Error('deu ruim'));

    const cleanup = await abrirAcessos();

    expect(valorDoCard('Pessoas que entraram hoje')).toBe('4');
    expect(container.textContent).toContain('sgt.silva');
    expect(showError).toHaveBeenCalledTimes(1);

    cleanup();
  });

  test('o resumo fora do ar escreve Erro, e nao um traco', async () => {
    getAcessosResumo.mockRejectedValue(new Error('deu ruim'));

    const cleanup = await abrirAcessos();

    // '-' se confunde com "nao ha", e ate 2026-08-04 era o que a tela escrevia.
    expect(valorDoCard('Pessoas que entraram hoje')).toBe('Erro');
    expect(container.querySelectorAll('.stats-card--loading')).toHaveLength(0);

    cleanup();
  });

  test('a serie fora do ar nao se escreve como serie vazia', async () => {
    getLoginsDia.mockRejectedValue(new Error('deu ruim'));

    const cleanup = await abrirAcessos();

    expect(container.textContent).toContain('Falha ao carregar');

    cleanup();
  });
});
