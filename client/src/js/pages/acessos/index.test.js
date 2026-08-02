import { describe, test, expect, vi, beforeEach } from 'vitest';

// Tela de acessos (#/acessos): o historico de login, que nasceu em 2026-08-02
// com a autenticacao vindo para dentro do SCA. Ate ali o registro de quem
// entrava morava no banco do Auth Server.
//
// O que estes testes guardam, e que nao e obvio:
//   - a tela nao pede recorte de periodo; o default mora SO no Joi do servidor
//   - uma rota fora do ar nao derruba a tela inteira (allSettled)
//   - 'sca_web'/'sca_qgis' viram nome de gente, e nao codigo cru
//   - a serie chega em 'AAAA-MM-DD' e o eixo mostra dia e mes

vi.mock('@services/plataforma-service.js', () => ({
  getAcessosResumo: vi.fn(() => Promise.resolve({})),
  getAcessosLogados: vi.fn(() => Promise.resolve([])),
  getLoginsDia: vi.fn(() => Promise.resolve([])),
  getLoginsMes: vi.fn(() => Promise.resolve([])),
  getLoginsUsuarios: vi.fn(() => Promise.resolve([])),
  getLoginsClientes: vi.fn(() => Promise.resolve([])),
}));

vi.mock('@utils/toast.js', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
  showToast: vi.fn(),
}));

// O jsdom nao tem canvas, entao o Chart.js de verdade nao roda em teste. O
// projeto ja resolve isso com o dublê em @components/charts/chart-stub.js.
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

const RESUMO = { usuarios_ativos: 12, logins_hoje: 5, logins_30_dias: 148 };

const LOGADOS = [
  {
    id: 1,
    ultimo_login: '2026-08-02T13:20:00.000Z',
    cliente: 'sca_web',
    login: 'sgt.silva',
    nome_guerra: 'Silva',
    tipo_posto_grad: '3 Sgt',
  },
  {
    id: 2,
    ultimo_login: '2026-08-02T11:05:00.000Z',
    cliente: 'sca_qgis',
    login: 'cap.souza',
    nome_guerra: 'Souza',
    tipo_posto_grad: 'Cap',
  },
];

let container;

beforeEach(() => {
  vi.clearAllMocks();
  getAcessosResumo.mockResolvedValue(RESUMO);
  getAcessosLogados.mockResolvedValue(LOGADOS);
  getLoginsDia.mockResolvedValue([
    { data: '2026-08-01', logins: 3 },
    { data: '2026-08-02', logins: 5 },
  ]);
  getLoginsMes.mockResolvedValue([{ data: '2026-08-01', logins: 148 }]);
  getLoginsUsuarios.mockResolvedValue([{ usuario: '3 Sgt Silva (sgt.silva)', logins: 20 }]);
  getLoginsClientes.mockResolvedValue([
    { cliente: 'sca_web', logins: 100 },
    { cliente: 'sca_qgis', logins: 48 },
  ]);
  container = document.createElement('div');
  document.body.appendChild(container);
});

const textos = (seletor) =>
  Array.from(container.querySelectorAll(seletor)).map(e => e.textContent.trim());

describe('tela de acessos', () => {
  test('mostra os tres numeros do resumo', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    const valores = textos('.stats-card__value');
    expect(valores).toEqual(['12', '5', '148']);

    cleanup();
  });

  test('lista quem entrou hoje, com o cliente por extenso', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    const corpo = container.textContent;
    expect(corpo).toContain('3 Sgt Silva');
    expect(corpo).toContain('sgt.silva');
    // 'sca_web' e codigo de contrato, nao rotulo de tela.
    expect(corpo).toContain('Interface web');
    expect(corpo).toContain('Plugin do QGIS');
    expect(corpo).not.toContain('sca_web');

    cleanup();
  });

  // O default do recorte (14 dias, 12 meses, 30 dias) mora SO no Joi de
  // `acessos_schema.js`. Repeti-lo aqui criaria um segundo lugar declarando a
  // mesma coisa, e os dois divergiriam no primeiro ajuste.
  test('nao manda recorte de periodo: o default e do servidor', async () => {
    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(getLoginsDia).toHaveBeenCalledWith();
    expect(getLoginsMes).toHaveBeenCalledWith();
    expect(getLoginsUsuarios).toHaveBeenCalledWith();
    expect(getLoginsClientes).toHaveBeenCalledWith();

    cleanup();
  });

  // Sao seis rotas independentes. Com `Promise.all`, uma delas fora do ar
  // deixaria a tela inteira em branco -- inclusive as cinco que responderam.
  test('uma rota que falha nao derruba o resto da tela', async () => {
    getLoginsDia.mockRejectedValue(new Error('deu ruim'));

    const cleanup = await renderAcessos(container, {});
    await flush();

    // O resumo e a tabela continuam de pe.
    expect(textos('.stats-card__value')).toEqual(['12', '5', '148']);
    expect(container.textContent).toContain('sgt.silva');
    expect(showError).toHaveBeenCalledTimes(1);

    cleanup();
  });

  test('sem ninguem logado hoje, a tabela diz isso em vez de ficar vazia', async () => {
    getAcessosLogados.mockResolvedValue([]);

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(container.textContent).toContain('Ninguém entrou hoje');

    cleanup();
  });

  test('resumo indisponivel nao deixa os cards em esqueleto para sempre', async () => {
    getAcessosResumo.mockRejectedValue(new Error('deu ruim'));

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(textos('.stats-card__value')).toEqual(['-', '-', '-']);
    expect(container.querySelectorAll('.stats-card--loading')).toHaveLength(0);

    cleanup();
  });
});
