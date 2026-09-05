import {
  describe, test, expect, vi, beforeEach,
} from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O ENVIO DE FOTO E VIDEO: o teto do arquivo e o estado de "subindo".
//
// O TETO ESPELHA O DO SERVIDOR (`campo_schema.MAX_BASE64`, 58.720.256
// caracteres de base64, ou 42 MiB de binario). Sem conferir aqui, quem escolhe
// um video de 45 MB espera o navegador montar 60 MB de base64 para receber um
// 413 do body parser -- cuja mensagem nao fala nem do arquivo nem do campo, e
// que chega DEPOIS da espera. E a mesma regra do teto de 50.000 pontos de
// `campo-trajetos.js`, e pela mesma razao.
//
// E NENHUM ARQUIVO VAI quando um deles ESTOURA O TETO: a trava roda ANTES do
// laco, sobre a lista inteira, entao subir tres e parar no quarto por tamanho
// nao acontece.
//
// A FALHA DO SERVIDOR NO MEIO DO LOTE e outra historia, e o ultimo caso a
// cobra: a subida e uma por vez, e a segunda que falha deixa a primeira
// GRAVADA. Se a tela nao se repinta, a pessoa escolhe as tres de novo e a
// primeira entra pela segunda vez -- `campo.imagem` nao tem chave por conteudo
// que a recuse. Por isso o `catch` diz QUAL arquivo falhou e quantos entraram,
// e o `finally` recarrega a galeria e avisa `aoMudar` sempre que algo subiu.

vi.mock('@services/campo-service.js', () => ({
  listarImagensCampo: vi.fn(() => Promise.resolve([])),
  enviarImagemCampo: vi.fn(() => Promise.resolve({ id: 1 })),
  excluirImagemCampo: vi.fn(),
  atualizarImagemCampo: vi.fn(),
  urlDaImagemCampo: vi.fn(() => Promise.resolve('blob:x')),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

import { criarGaleriaCampo, MAX_BYTES_ARQUIVO } from '@pages/campo/campo-midia.js';
import { enviarImagemCampo, listarImagensCampo } from '@services/campo-service.js';
import { showError } from '@utils/toast.js';

/** Um `File` de tamanho declarado, sem alocar os bytes. */
const arquivoDe = (nome, bytes) => {
  const f = new File(['x'], nome, { type: 'video/mp4' });
  Object.defineProperty(f, 'size', { value: bytes });
  return f;
};

/**
 * Poe os arquivos na entrada, dispara o `change` e ESPERA O LOTE TERMINAR.
 *
 * Cada `subir` espera um evento do `FileReader`, que e MACROtarefa: com tres
 * arquivos sao tres rodadas, e um `flush` so basta por acaso quando a maquina
 * esta ociosa. Pior: o `FileReader` que ficou pendente ao fim de um caso dispara
 * DENTRO do caso seguinte, depois do `clearAllMocks`, e soma uma chamada que
 * ninguem pediu.
 *
 * O sinal de que acabou e o botao voltar a ficar habilitado -- o `finally` do
 * `onChange` o devolve nos dois desfechos. A recusa por TAMANHO nem chega a
 * desabilita-lo, entao ela sai do laco na primeira volta.
 */
async function escolher(entrada, arquivos) {
  Object.defineProperty(entrada, 'files', {
    configurable: true,
    value: Object.assign(arquivos, { item: (i) => arquivos[i] }),
  });
  entrada.dispatchEvent(new Event('change'));
  for (let i = 0; i < 60; i += 1) {
    await flush();
    const botao = botaoEnviar();
    if (!botao || !botao.disabled) return;
  }
}

const montar = async (aoMudar = null) => {
  const galeria = criarGaleriaCampo({ campoId: 46, podeEditar: true, aoMudar });
  document.body.appendChild(galeria.element);
  await galeria.recarregar();
  await flush();
  return galeria;
};

const entradaDeArquivo = () => document.querySelector('input[type="file"]');
const botaoEnviar = () => [...document.body.querySelectorAll('button')]
  .find(b => b.textContent.includes('Enviar') || b.textContent.includes('Enviando'));

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  listarImagensCampo.mockResolvedValue([]);
  enviarImagemCampo.mockResolvedValue({ id: 1 });
});

describe('o teto do arquivo', () => {
  test('o arquivo acima do teto é recusado ANTES de ser lido, e é nomeado', async () => {
    await montar();

    await escolher(entradaDeArquivo(), [arquivoDe('voo-drone.mp4', MAX_BYTES_ARQUIVO + 1)]);

    expect(enviarImagemCampo).not.toHaveBeenCalled();
    const mensagem = showError.mock.calls.at(-1)[0];
    expect(mensagem).toContain('voo-drone.mp4');
    expect(mensagem).toContain('42.0 MB');
  });

  test('um arquivo grande no meio do lote impede o lote INTEIRO', async () => {
    await montar();

    await escolher(entradaDeArquivo(), [
      arquivoDe('marco.jpg', 400000),
      arquivoDe('voo-drone.mp4', MAX_BYTES_ARQUIVO + 1),
    ]);

    // Nem o pequeno sobe: o campo não fica com metade do lote.
    expect(enviarImagemCampo).not.toHaveBeenCalled();
  });

  test('o arquivo NO teto passa, e o botão volta ao rótulo depois', async () => {
    await montar();

    // O `FileReader` do jsdom lê o `File` de verdade (um byte), e é o `size`
    // declarado que a trava enxerga: o caso mede a trava, e não a leitura.
    await escolher(entradaDeArquivo(), [arquivoDe('marco.jpg', MAX_BYTES_ARQUIVO)]);

    expect(enviarImagemCampo).toHaveBeenCalledTimes(1);
    expect(botaoEnviar().textContent).toContain('Enviar foto ou vídeo');
    expect(botaoEnviar().disabled).toBe(false);
  });
});

describe('a falha do servidor no meio do lote', () => {
  test('o que ja subiu e repintado, e a mensagem nomeia o arquivo que falhou', async () => {
    const aoMudar = vi.fn();
    await montar(aoMudar);
    listarImagensCampo.mockClear();
    enviarImagemCampo
      .mockResolvedValueOnce({ id: 1 })
      .mockRejectedValueOnce(new Error('Erro interno do servidor'));

    await escolher(entradaDeArquivo(), [
      arquivoDe('marco.jpg', 400000),
      arquivoDe('vista.jpg', 500000),
      arquivoDe('cerca.jpg', 600000),
    ]);

    // Parou na segunda: a terceira nem foi tentada.
    expect(enviarImagemCampo).toHaveBeenCalledTimes(2);

    // A PRIMEIRA JA ESTA NO BANCO, e tem de aparecer na tela.
    expect(listarImagensCampo).toHaveBeenCalledTimes(1);
    expect(aoMudar).toHaveBeenCalledTimes(1);

    const mensagem = showError.mock.calls.at(-1)[0];
    expect(mensagem).toContain('vista.jpg');
    expect(mensagem).toContain('1 de 3');

    // E o botao volta a servir para a proxima tentativa.
    expect(botaoEnviar().textContent).toContain('Enviar foto ou vídeo');
    expect(botaoEnviar().disabled).toBe(false);
  });

  test('a falha JA NA PRIMEIRA nao recarrega a galeria', async () => {
    const aoMudar = vi.fn();
    await montar(aoMudar);
    listarImagensCampo.mockClear();
    enviarImagemCampo.mockRejectedValue(new Error('Erro interno do servidor'));

    await escolher(entradaDeArquivo(), [arquivoDe('marco.jpg', 400000)]);

    expect(listarImagensCampo).not.toHaveBeenCalled();
    expect(aoMudar).not.toHaveBeenCalled();
    expect(showError.mock.calls.at(-1)[0]).toContain('0 de 1');
  });
});
