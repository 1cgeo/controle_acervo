import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O ANEXO DA REVISAO: o teto e o estado de envio.
//
// O TETO ESPELHA O DO SERVIDOR (`anexo_revisao_upload.MAX_BYTES`, 20 MB). Sem
// conferir aqui, quem escolhe por engano o ODS de 60 MB manda os 60 MB pela
// rede inteira para receber a recusa no fim, e entre o clique e a resposta a
// tela nao tem o que dizer.
//
// E O DIALOGO NAO SE FECHA COM A REQUISICAO EM VOO: `setOcupado` barra o
// Escape, o X e o fundo, porque a resposta (sucesso ou recusa) chegaria a uma
// tela que ja nao existe. Mesma regua de `campo-midia.js`.

vi.mock('@services/plataforma-service.js', () => ({
  listarAnexosRevisao: vi.fn(() => Promise.resolve([])),
  enviarAnexoRevisao: vi.fn(() => Promise.resolve({ id: 1 })),
  excluirAnexoRevisao: vi.fn(),
  baixarAnexoRevisao: vi.fn(),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showWarning: vi.fn(),
}));

import {
  abrirAnexosRevisao, MAX_BYTES_ANEXO,
} from '@pages/revisoes-pit/anexos-dialog.js';
import { enviarAnexoRevisao, listarAnexosRevisao } from '@services/plataforma-service.js';
import { showError } from '@utils/toast.js';
import { saveAuth } from '@store/auth-store.js';

const REVISAO = { id: 3, codigo: 'R1', ano: 2026 };

/** Um `File` de tamanho declarado, sem alocar os bytes. */
const arquivoDe = (nome, bytes) => {
  const f = new File(['x'], nome, { type: 'application/pdf' });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
};

const entradaDeArquivo = () => document.querySelector('input[type="file"]');
const botaoAnexar = () => [...document.querySelectorAll('.modal button')]
  .find(b => b.textContent.includes('Anexar') || b.textContent.includes('Enviando'));

function escolher(arquivo) {
  const entrada = entradaDeArquivo();
  Object.defineProperty(entrada, 'files', {
    configurable: true,
    value: Object.assign([arquivo], { item: (i) => [arquivo][i] }),
  });
}

beforeEach(() => {
  document.body.innerHTML = '';
  localStorage.clear();
  vi.clearAllMocks();
  listarAnexosRevisao.mockResolvedValue([]);
  enviarAnexoRevisao.mockResolvedValue({ id: 1 });
  saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('o teto do anexo da revisão', () => {
  test('o arquivo acima do teto NÃO vai pela rede, e a mensagem o nomeia', async () => {
    await abrirAnexosRevisao({ revisao: REVISAO });
    await flush();

    escolher(arquivoDe('pacote-inteiro.ods', MAX_BYTES_ANEXO + 1));
    botaoAnexar().click();
    await flush();

    expect(enviarAnexoRevisao).not.toHaveBeenCalled();
    const mensagem = showError.mock.calls.at(-1)[0];
    expect(mensagem).toContain('pacote-inteiro.ods');
    expect(mensagem).toContain('20.0 MB');
  });

  test('o arquivo NO teto passa, e o botão volta ao rótulo depois', async () => {
    await abrirAnexosRevisao({ revisao: REVISAO });
    await flush();

    escolher(arquivoDe('pit-2026-r1.pdf', MAX_BYTES_ANEXO));
    botaoAnexar().click();
    await flush();

    expect(enviarAnexoRevisao).toHaveBeenCalledTimes(1);
    expect(botaoAnexar().textContent).toContain('Anexar');
    expect(botaoAnexar().disabled).toBe(false);
  });

  // O DIALOGO SEGURA ENQUANTO SOBE, e o rotulo diz que o envio comecou.
  test('durante o envio o diálogo fica ocupado e o rótulo diz "Enviando..."', async () => {
    let liberar;
    enviarAnexoRevisao.mockImplementation(() => new Promise((r) => { liberar = r; }));

    await abrirAnexosRevisao({ revisao: REVISAO });
    await flush();

    escolher(arquivoDe('pit-2026-r1.pdf', 300000));
    botaoAnexar().click();
    await flush();

    expect(botaoAnexar().textContent).toContain('Enviando...');
    expect(document.querySelector('.modal').getAttribute('aria-busy')).toBe('true');
    // Escape com a requisição em voo NÃO fecha.
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
    expect(document.querySelector('.modal-overlay')).not.toBeNull();

    liberar({ id: 1 });
    await flush();

    expect(botaoAnexar().textContent).toContain('Anexar');
    expect(document.querySelector('.modal').getAttribute('aria-busy')).toBeNull();
  });

  // A RECUSA DO SERVIDOR TAMBEM DEVOLVE O BOTAO: sem o `finally`, o dialogo
  // ficava travado e a pessoa tinha de fechar e reabrir.
  test('a recusa do servidor devolve o botão e destrava o diálogo', async () => {
    enviarAnexoRevisao.mockRejectedValueOnce(new Error('Tipo de arquivo não permitido (.zip)'));

    await abrirAnexosRevisao({ revisao: REVISAO });
    await flush();

    escolher(arquivoDe('pacote.zip', 300000));
    botaoAnexar().click();
    await flush();

    expect(showError.mock.calls.at(-1)[0]).toContain('Tipo de arquivo não permitido');
    expect(botaoAnexar().disabled).toBe(false);
    expect(document.querySelector('.modal').getAttribute('aria-busy')).toBeNull();
  });
});
