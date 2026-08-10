import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// ATIVIDADES POR USUÁRIO: o retrato de agora e a linha do tempo do ano.
//
// O que estes casos prendem:
//  - o FIM da faixa é EXCLUSIVO. O servidor manda `fim + 1`, e tratá-lo como
//    inclusivo pintaria um dia a mais por faixa -- numa linha de 200 faixas, uma
//    conta visivelmente errada;
//  - o valor da faixa chega como TEXTO ('0' ou '1'), porque vem de um
//    `ARRAY[...]::text[]` do Postgres. Comparar com o número 1 daria falso
//    sempre, e a barra ficaria vazia SEM ERRO NENHUM;
//  - o dia de calendário não vira instante. `new Date('2026-03-05')` é
//    meia-noite UTC, que em UTC-3 se imprime como 4 de março;
//  - as duas seções carregam SEPARADAS. Num `Promise.all` a falha de uma
//    apagaria a outra, e a mensagem que sobraria seria a da que falhou.

vi.mock('@services/producao-service.js', async () => {
  const real = await vi.importActual('@services/producao-service.js');
  return {
    ...real,
    getAtividadeUsuario: vi.fn(() => Promise.resolve([])),
    getResumoUsuario: vi.fn(() => Promise.resolve([])),
  };
});

import { renderAtividadeUsuario, faixasOcupadas, diaEmMs } from './index.js';
import { getAtividadeUsuario, getResumoUsuario } from '@services/producao-service.js';

const RESUMO = [
  {
    usuario_id: 1, usuario_uuid: 'u1', nome_usuario: 'Silva', nome_abrev: 'Cap',
    status_usuario: 'Em Atividade', nome_subfase: 'Extração', nome_lote: 'Lote 1',
    nome_bloco: 'Bloco A',
  },
  {
    usuario_id: 2, usuario_uuid: 'u2', nome_usuario: 'Souza', nome_abrev: '1º Ten',
    status_usuario: 'Ocioso', nome_subfase: 'N/A', nome_lote: 'N/A', nome_bloco: 'N/A',
  },
];

// Duas pessoas no mesmo ano. A régua vai do menor início ao maior fim de todas
// as faixas recebidas, e não de uma janela calculada nesta tela.
const LINHA_DO_TEMPO = [
  {
    usuario: 'Cap Silva',
    data: [
      ['2026-01-01', '0', '2026-03-01'],
      ['2026-03-01', '1', '2026-03-11'],
      ['2026-03-11', '0', '2026-08-09'],
    ],
  },
  {
    usuario: '1º Ten Souza',
    data: [
      ['2026-01-01', '1', '2026-01-11'],
      ['2026-01-11', '0', '2026-08-09'],
    ],
  },
];

async function montar() {
  const container = document.createElement('div');
  const cleanup = renderAtividadeUsuario(container);
  await flush();
  return { container, cleanup };
}

beforeEach(() => {
  getResumoUsuario.mockResolvedValue(RESUMO);
  getAtividadeUsuario.mockResolvedValue(LINHA_DO_TEMPO);
});

describe('diaEmMs: dia de calendário, e não instante', () => {
  test('lê AAAA-MM-DD em UTC, sem escorregar de fuso', () => {
    const ms = diaEmMs('2026-03-05');
    expect(new Date(ms).toISOString().slice(0, 10)).toBe('2026-03-05');
  });

  test('devolve null para o que não é dia', () => {
    expect(diaEmMs(null)).toBeNull();
    expect(diaEmMs('05/03/2026')).toBeNull();
  });
});

describe('faixasOcupadas: só o que está ocupado, com fim exclusivo', () => {
  test('guarda apenas as faixas de valor 1, e o fim não entra', () => {
    const { faixas } = faixasOcupadas([
      ['2026-01-01', '0', '2026-03-01'],
      ['2026-03-01', '1', '2026-03-11'],
    ]);
    expect(faixas).toHaveLength(1);
    // 1 a 10 de março: dez dias, e não onze. O 11 é o dia seguinte ao fim.
    const dias = (faixas[0].fim - faixas[0].inicio) / (24 * 60 * 60 * 1000);
    expect(dias).toBe(10);
  });

  // CONTROLE NEGATIVO do bug que não dá erro: o valor é texto.
  test('o valor 1 é reconhecido como TEXTO', () => {
    expect(faixasOcupadas([['2026-01-01', '1', '2026-01-02']]).faixas).toHaveLength(1);
    expect(faixasOcupadas([['2026-01-01', 1, '2026-01-02']]).faixas).toHaveLength(1);
  });

  test('o intervalo cobre TODAS as faixas, ocupadas ou não', () => {
    const { min, max } = faixasOcupadas([
      ['2026-01-01', '0', '2026-03-01'],
      ['2026-03-01', '1', '2026-03-11'],
    ]);
    expect(new Date(min).toISOString().slice(0, 10)).toBe('2026-01-01');
    expect(new Date(max).toISOString().slice(0, 10)).toBe('2026-03-11');
  });

  test('ignora faixa malformada em vez de estourar', () => {
    expect(faixasOcupadas([['2026-01-01', '1'], null, 'x']).faixas).toHaveLength(0);
  });
});

describe('a tela', () => {
  test('mostra quem está em atividade agora, com a contagem', async () => {
    const { container, cleanup } = await montar();

    const contagem = container.querySelector('.atividade-usuario__contagem').textContent;
    expect(contagem).toMatch(/2 pessoa\(s\) ativa\(s\)/);
    expect(contagem).toMatch(/1 em atividade/);

    expect(container.textContent).toContain('Silva');
    expect(container.textContent).toContain('Extração');
    cleanup();
  });

  test('desenha uma barra por pessoa, com as faixas posicionadas em porcento', async () => {
    const { container, cleanup } = await montar();

    const pessoas = container.querySelectorAll('.linha-tempo__pessoa');
    expect(pessoas).toHaveLength(2);

    // A régua vai de 1º de janeiro a 9 de agosto (220 dias). A faixa de Souza
    // começa no primeiro dia, então ela encosta na borda esquerda.
    const faixasSouza = pessoas[1].querySelectorAll('.linha-tempo__faixa');
    expect(faixasSouza).toHaveLength(1);
    expect(faixasSouza[0].style.left).toBe('0%');

    // A de Silva começa depois: 59 dias de 220.
    const faixasSilva = pessoas[0].querySelectorAll('.linha-tempo__faixa');
    expect(parseFloat(faixasSilva[0].style.left)).toBeCloseTo((59 / 220) * 100, 1);
    cleanup();
  });

  test('conta os dias ocupados de cada pessoa', async () => {
    const { container, cleanup } = await montar();
    const dias = [...container.querySelectorAll('.linha-tempo__dias')].map(n => n.textContent);
    expect(dias).toEqual(['10 d', '10 d']);
    cleanup();
  });

  // A REGRA DA CASA, exercitada: a chamada que falha carrega SOZINHA.
  test('o resumo que falha não leva a linha do tempo junto', async () => {
    getResumoUsuario.mockRejectedValue(new Error('Usuário necessita do perfil consulta'));
    const { container, cleanup } = await montar();

    expect(container.querySelector('.dashboard-erro')).toBeTruthy();
    expect(container.textContent).toContain('Usuário necessita do perfil consulta');
    // E a outra seção continua desenhada.
    expect(container.querySelectorAll('.linha-tempo__pessoa')).toHaveLength(2);
    cleanup();
  });

  test('a linha do tempo que falha não leva o resumo junto', async () => {
    getAtividadeUsuario.mockRejectedValue(new Error('Falha no banco'));
    const { container, cleanup } = await montar();

    expect(container.querySelectorAll('.linha-tempo__pessoa')).toHaveLength(0);
    expect(container.querySelector('.dashboard-erro')).toBeTruthy();
    expect(container.querySelector('.atividade-usuario__contagem').textContent)
      .toMatch(/2 pessoa\(s\) ativa\(s\)/);
    cleanup();
  });

  // A SÉRIE É O `usuario_uuid`, de 2026-08-09. Antes disso o servidor agrupava
  // por `posto || nome de guerra`, e dois homônimos de mesmo posto viravam UMA
  // barra com as faixas dos dois intercaladas. Duas linhas de mesmo nome aqui
  // são duas pessoas, e a tela não pode fundi-las de novo.
  test('dois homônimos de mesmo posto são DUAS barras', async () => {
    getAtividadeUsuario.mockResolvedValue([
      {
        usuario_uuid: 'a1', usuario: 'Cap Silva',
        data: [['2026-01-01', '1', '2026-01-11'], ['2026-01-11', '0', '2026-02-01']],
      },
      {
        usuario_uuid: 'b2', usuario: 'Cap Silva',
        data: [['2026-01-01', '0', '2026-01-21'], ['2026-01-21', '1', '2026-02-01']],
      },
    ]);
    const { container, cleanup } = await montar();

    const pessoas = container.querySelectorAll('.linha-tempo__pessoa');
    expect(pessoas).toHaveLength(2);
    expect([...pessoas].map(p => p.querySelector('.linha-tempo__nome').textContent))
      .toEqual(['Cap Silva', 'Cap Silva']);
    // Cada uma com a própria faixa, e não as duas empilhadas numa barra só.
    expect([...pessoas].map(p => p.querySelectorAll('.linha-tempo__faixa').length))
      .toEqual([1, 1]);
    cleanup();
  });

  test('ano sem atividade nenhuma explica o vazio, e não fica em branco', async () => {
    getAtividadeUsuario.mockResolvedValue([]);
    const { container, cleanup } = await montar();
    expect(container.querySelector('.atividade-usuario__vazio').textContent)
      .toMatch(/Ninguém teve atividade iniciada/);
    cleanup();
  });
});
