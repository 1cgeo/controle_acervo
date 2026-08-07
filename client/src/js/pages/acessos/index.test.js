import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';
import { logarComo } from '@/__tests__/helpers/sessao.js';

// A aba ACESSOS de #/acessos, a SEGUNDA da tela, atrás do efetivo: o histórico
// de login.
//
// O que estes casos guardam:
//   - o cartão conta PESSOA distinta, e não linha de `dgeo.login`; com JWT de
//     8 horas e dois clientes, a mesma pessoa contaria várias vezes por dia
//   - o cartão de conta habilitada se chama "conta", e não "usuário": ele mede
//     `dgeo.usuario.ativo`, que é permissão de entrar e não gente na Divisão
//   - não há cartão de "contas sem senha": ele marcava zero de 53 contas, e  path-ok
//     número que não pode mudar não é medida
//   - não há série de 12 meses nem gráfico "por onde se entra": os dois nascem
//     degenerados
//   - o recorte do período se escolhe na tela
//   - a linha de quem entrou hoje leva ao aproveitamento daquela pessoa
//   - falha de rota não se escreve com o texto do vazio legítimo
//   - a aba só existe para o ADMINISTRADOR GLOBAL: `/api/acessos` é verifyAdmin

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

// O jsdom nao tem canvas, entao o Chart.js de verdade nao roda em teste. O
// projeto ja resolve isso com o duble em @components/charts/chart-stub.js.
vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

import { renderAcessos } from '@pages/acessos/index.js';
import {
  getAcessosResumo,
  getAcessosLogados,
  getLoginsDia,
  getLoginsUsuarios,
} from '@services/plataforma-service.js';
import { showError } from '@utils/toast.js';

const RESUMO = {
  pessoas_hoje: 4,
  pessoas_30_dias: 9,
  contas_ativas: 7,
  contas_sem_senha: 3,
};

// UMA linha por pessoa, com os clientes dela ao lado. Uma linha por par
// pessoa + cliente faria quem abre a interface e o plugin no mesmo dia aparecer
// duas vezes numa tabela que responde "quem está no sistema".
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
  // A ABA ACESSOS SO EXISTE PARA O ADMINISTRADOR GLOBAL, e o setup global limpa
  // o localStorage entre testes: sem entrar como administrador, a tela monta so
  // a aba Efetivo e `abrirAcessos` nao acha o botao.
  logarComo({}, { administrador: true });
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
    ]);
    expect(valorDoCard('Pessoas que entraram hoje')).toBe('4');
    expect(valorDoCard('Pessoas que entraram em 30 dias')).toBe('9');
    expect(valorDoCard('Contas ativas')).toBe('7');

    cleanup();
  });

  // NUMERO QUE NAO PODE MUDAR NAO E MEDIDA. Em producao eram 0 de 53 contas, e
  // sempre: a criacao de usuario gera o hash, entao `senha` nula nao acontece
  // mais. O cartao ocupava um quarto da linha para dizer zero.
  //
  // A ROTA CONTINUA DEVOLVENDO `contas_sem_senha`, de proposito: a auditoria de
  // conta orfa e pergunta legitima, e quem a fizer nao precisa de migracao. O
  // que saiu foi o cartao, e este caso guarda a diferenca entre as duas coisas.
  test('nao desenha cartao de contas sem senha, mesmo com a rota devolvendo o numero', async () => {
    const cleanup = await abrirAcessos();

    expect(RESUMO.contas_sem_senha).toBe(3);
    expect(rotulosCards()).not.toContain('Contas sem senha');
    expect(container.textContent).not.toContain('sem senha');

    cleanup();
  });

  // Os dois nascem degenerados por construção: `dgeo.login` é recente, então a
  // maioria dos doze meses fica em zero; e "por onde se entra" é uma barra sobre
  // um domínio de DOIS valores, fixado no Joi do login.
  test('nao mostra a serie de 12 meses nem o grafico de clientes', async () => {
    const cleanup = await abrirAcessos();

    expect(container.textContent).not.toContain('Por onde se entra');
    expect(container.textContent).not.toContain('12 meses');

    cleanup();
  });

  // A DECISÃO ESTÁ NO SERVIÇO, e não só na tela.
  //
  // Aqui havia `expect(getLoginsMes).not.toHaveBeenCalled()`, que passava por
  // construção: a página nem importava a função. Um teste que não pode reprovar
  // não é teste. O servidor está removendo as duas rotas, então o que se prende
  // agora é o CONTRATO do serviço: os embrulhos não existem mais, e quem tentar
  // religar a pergunta descartada esbarra neste caso.
  //
  // `importActual` fura o mock deste arquivo de propósito: é o módulo de
  // verdade que precisa ser medido.
  test('o servico nao oferece mais os embrulhos das duas rotas descartadas', async () => {
    const serviceReal = await vi.importActual('@services/plataforma-service.js');

    expect(serviceReal.getLoginsMes).toBeUndefined();
    expect(serviceReal.getLoginsClientes).toBeUndefined();
    // CONTROLE POSITIVO: as duas que a tela USA continuam lá. Sem ele, um
    // caminho de importação errado deixaria tudo indefinido e o caso passaria
    // sem medir nada.
    expect(typeof serviceReal.getLoginsDia).toBe('function');
    expect(typeof serviceReal.getLoginsUsuarios).toBe('function');
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

    // '-' se confunde com "não há", e falha de rota não é ausência de dado.
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

// A TELA DESCEU PARA O GERENTE DO EFETIVO, e as duas abas tem donos diferentes:
// a aba Efetivo le `/efetivo/*` (gerente do modulo) e a aba Acessos le
// `/acessos/*` (verifyAdmin). Uma aba que so sabe responder 403 e pior que uma
// aba a menos.
describe('aba Acessos: so para o administrador global', () => {
  test('some para quem e gerente do efetivo e nao e administrador', async () => {
    logarComo({ efetivo: 3 });

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(abas().map(b => b.textContent)).toEqual(['Efetivo']);
    // E nao busca o historico de login: a aba nem existe para montar.
    expect(getAcessosResumo).not.toHaveBeenCalled();

    cleanup();
  });

  test('aparece para o administrador global', async () => {
    logarComo({}, { administrador: true });

    const cleanup = await renderAcessos(container, {});
    await flush();

    expect(abas().map(b => b.textContent)).toEqual(['Efetivo', 'Acessos']);

    cleanup();
  });
});
