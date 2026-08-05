import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/acervo/services/admin-service.js', () => ({
  verificarInconsistencias: vi.fn(),
}));

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
}));

import { renderVerificarVolumeTab } from '@modules/acervo/pages/administracao/verificar-volume-tab.js';
import * as svc from '@modules/acervo/services/admin-service.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { showError } from '@utils/toast.js';

let container;

const montar = async () => {
  container = document.createElement('div');
  return renderVerificarVolumeTab(container);
};

const botao = () => [...container.querySelectorAll('button')]
  .find(b => b.textContent.includes('Verificar agora'));
const status = () => container.querySelector('.manutencao__status').textContent;

beforeEach(() => {
  vi.clearAllMocks();
  confirmDialog.mockResolvedValue(true);
});

afterEach(() => {
  vi.useRealTimers();
});

describe('aba Verificar volume', () => {
  test('nao verifica nada ao abrir', async () => {
    const aba = await montar();

    expect(svc.verificarInconsistencias).not.toHaveBeenCalled();
    aba.cleanup();
  });

  // A palavra "Verificar" esconde que a rota ESCREVE. Sem os avisos, ela se lê
  // como uma consulta, e é a única das quatro abas de diagnóstico que muda dado.
  test('avisa que escreve, que nao apaga e que pode levar horas', async () => {
    const aba = await montar();

    expect(container.textContent).toContain('ESCREVE');
    expect(container.textContent).toContain('Não apaga, não move e não renomeia');
    expect(container.textContent).toContain('horas');

    aba.cleanup();
  });

  test('pede confirmacao antes de rodar', async () => {
    confirmDialog.mockResolvedValue(false);
    const aba = await montar();

    botao().click();
    await flush();

    expect(confirmDialog).toHaveBeenCalled();
    expect(svc.verificarInconsistencias).not.toHaveBeenCalled();

    aba.cleanup();
  });

  // A rota so responde no fim: nao ha percentual a mostrar. O tempo decorrido e
  // o unico acompanhamento honesto, e sem ele uma tela parada por vinte minutos
  // se le como travada.
  test('conta o tempo decorrido enquanto espera', async () => {
    vi.useFakeTimers();
    let terminar;
    svc.verificarInconsistencias.mockReturnValue(new Promise(r => { terminar = r; }));

    const aba = await montar();
    botao().click();
    await Promise.resolve();
    await Promise.resolve();

    expect(status()).toContain('Verificando');
    expect(botao().disabled).toBe(true);

    vi.advanceTimersByTime(65000);
    expect(status()).toContain('1 min');

    terminar({ arquivos_atualizados: 0, arquivos_deletados_atualizados: 0 });
    vi.useRealTimers();
    await flush();

    aba.cleanup();
  });

  // Sair da tela nao cancela o trabalho no servidor, so o resultado se perde.
  // Quem nao souber disso aperta de novo e paga a releitura duas vezes.
  test('avisa que sair da tela nao cancela a verificacao', async () => {
    svc.verificarInconsistencias.mockReturnValue(new Promise(() => {}));
    const aba = await montar();

    botao().click();
    await flush();

    expect(status()).toContain('não cancela');

    aba.cleanup();
  });

  test('o resultado diz quantos foram apontados e para onde ir', async () => {
    svc.verificarInconsistencias.mockResolvedValue({
      arquivos_atualizados: 3, arquivos_deletados_atualizados: 1,
    });
    const aba = await montar();

    botao().click();
    await flush();

    expect(status()).toContain('3 arquivo(s)');
    expect(status()).toContain('1 arquivo(s) excluído(s)');
    expect(container.textContent).toContain('Arquivos com problema');
    expect(botao().disabled).toBe(false);

    aba.cleanup();
  });

  // Zero apontado é boa notícia, e a tela diz o que isso significa -- inclusive
  // que a marca de quem estava apontado antes foi LIMPA, que é o outro sentido
  // da escrita e o que ninguém espera de uma "verificação".
  test('zero apontado diz que a marca anterior foi limpa', async () => {
    svc.verificarInconsistencias.mockResolvedValue({
      arquivos_atualizados: 0, arquivos_deletados_atualizados: 0,
    });
    const aba = await montar();

    botao().click();
    await flush();

    expect(container.textContent).toContain('foi limpa');

    aba.cleanup();
  });

  test('a falha aparece no acompanhamento e devolve o botao', async () => {
    svc.verificarInconsistencias.mockRejectedValue(new Error('Volume indisponível'));
    const aba = await montar();

    botao().click();
    await flush();

    expect(status()).toContain('Volume indisponível');
    expect(showError).toHaveBeenCalledWith('Volume indisponível');
    expect(botao().disabled).toBe(false);

    aba.cleanup();
  });

  // O contador roda num setInterval: sem o clearInterval no cleanup, sair da
  // tela deixaria um timer batendo em elemento que nao esta mais no documento.
  test('o cleanup para o contador', async () => {
    vi.useFakeTimers();
    svc.verificarInconsistencias.mockReturnValue(new Promise(() => {}));
    const aba = await montar();

    botao().click();
    await Promise.resolve();
    await Promise.resolve();

    const antes = status();
    aba.cleanup();
    vi.advanceTimersByTime(5000);

    expect(status()).toBe(antes);
  });
});
