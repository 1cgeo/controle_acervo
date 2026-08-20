import {
  describe, test, expect, vi, beforeEach,
} from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// EDITAR A DESCRICAO NO PROPRIO CARTAO, e o traco solto ao lado do tamanho.
//
// Ate 2026-08-20 a galeria so ACRESCENTAVA e REMOVIA: `atualizarImagemCampo`
// existia no service, a rota `PUT /campo/imagem/:id` existia no servidor, e a
// tela nunca chamava nenhuma das duas. Quem enviava um arquivo ficava com o
// nome dele como descricao para sempre, e a unica saida era remover e enviar de
// novo -- 40 MB de video por uma linha de texto.
//
// O rodape tambem dizia "data · tamanho" sempre, e `data_imagem` e nula em
// quase toda imagem: sobrava um traco que se lia como defeito.

vi.mock('@services/campo-service.js', () => ({
  listarImagensCampo: vi.fn(),
  enviarImagemCampo: vi.fn(),
  excluirImagemCampo: vi.fn(),
  atualizarImagemCampo: vi.fn(() => Promise.resolve({ id: 1 })),
  // O jsdom nao tem `URL.createObjectURL`; o duble entrega uma URL qualquer.
  urlDaImagemCampo: vi.fn(() => Promise.resolve('blob:x')),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

import { criarGaleriaCampo } from '@/js/pages/campo/campo-midia.js';
import {
  listarImagensCampo, atualizarImagemCampo, urlDaImagemCampo,
} from '@services/campo-service.js';

const SEM_DATA = {
  id: 156,
  campo_id: 46,
  descricao: 'Vídeo do levantamento com receptor GNSS',
  data_imagem: null,
  tipo: 'video',
  mime_type: 'video/mp4',
  bytes: 42663914,
};

// UMA DAS DEZ ANTIGAS que TEM data: ela e a que prova que a data nao sumiu do
// rodape, so deixou de ser um traco quando nao existe.
const COM_DATA = {
  id: 12,
  campo_id: 46,
  descricao: 'Marco geodésico',
  data_imagem: '2019-04-15',
  tipo: 'foto',
  mime_type: 'image/jpeg',
  bytes: 375905,
};

const montar = async (podeEditar = true) => {
  const galeria = criarGaleriaCampo({ campoId: 46, podeEditar });
  document.body.appendChild(galeria.element);
  await galeria.recarregar();
  await flush();
  return galeria;
};

const botaoPorTexto = (texto) => [...document.body.querySelectorAll('button')]
  .find(b => b.textContent.includes(texto));

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  urlDaImagemCampo.mockResolvedValue('blob:x');
  atualizarImagemCampo.mockResolvedValue({ id: 156 });
  listarImagensCampo.mockResolvedValue([SEM_DATA]);
  // O objeto do teste e reusado entre casos; a edicao o modifica de proposito.
  SEM_DATA.descricao = 'Vídeo do levantamento com receptor GNSS';
});

describe('o rodape do cartao', () => {
  test('sem data, mostra SO o tamanho, e nenhum traco', async () => {
    await montar();
    const pe = document.querySelector('.campo-galeria__rodape small');
    expect(pe.textContent).toBe('40.7 MB');
    expect(pe.textContent).not.toContain('-');
  });

  test('com data, mostra a data e o tamanho', async () => {
    listarImagensCampo.mockResolvedValue([COM_DATA]);
    await montar();
    expect(document.querySelector('.campo-galeria__rodape small').textContent)
      .toBe('15/04/2019 · 367 kB');
  });
});

describe('editar a descricao no cartao', () => {
  test('grava pelo PUT e troca o texto sem recarregar a galeria', async () => {
    await montar();
    expect(listarImagensCampo).toHaveBeenCalledTimes(1);

    botaoPorTexto('Descrição').click();
    await flush();

    const entrada = document.querySelector('.campo-galeria__entrada');
    expect(entrada.value).toBe('Vídeo do levantamento com receptor GNSS');
    entrada.value = 'Levantamento GNSS no pátio da OM';
    botaoPorTexto('Salvar').click();
    await flush();

    expect(atualizarImagemCampo).toHaveBeenCalledWith(156, {
      descricao: 'Levantamento GNSS no pátio da OM',
      data_imagem: null,
    });
    expect(document.querySelector('.campo-galeria__descricao').textContent)
      .toBe('Levantamento GNSS no pátio da OM');
    // A GRADE NAO SE RECARREGA: seriam 40 MB de video buscados de novo para
    // trocar uma linha de texto.
    expect(listarImagensCampo).toHaveBeenCalledTimes(1);
    expect(urlDaImagemCampo).toHaveBeenCalledTimes(1);
  });

  // O servidor grava `data_imagem = dados.data_imagem || null`: quem OMITE a
  // data apaga a das dez imagens antigas que a tem.
  test('preserva a data de quem ja tem uma', async () => {
    listarImagensCampo.mockResolvedValue([COM_DATA]);
    await montar();

    botaoPorTexto('Descrição').click();
    await flush();
    document.querySelector('.campo-galeria__entrada').value = 'Marco geodésico da sede';
    botaoPorTexto('Salvar').click();
    await flush();

    expect(atualizarImagemCampo).toHaveBeenCalledWith(12, {
      descricao: 'Marco geodésico da sede',
      data_imagem: '2019-04-15',
    });
  });

  test('Cancelar volta ao texto anterior e nao chama o servidor', async () => {
    await montar();

    botaoPorTexto('Descrição').click();
    await flush();
    document.querySelector('.campo-galeria__entrada').value = 'outra coisa';
    botaoPorTexto('Cancelar').click();
    await flush();

    expect(atualizarImagemCampo).not.toHaveBeenCalled();
    expect(document.querySelector('.campo-galeria__descricao').textContent)
      .toBe('Vídeo do levantamento com receptor GNSS');
  });

  test('texto igual ao que ja estava nao vai ao servidor', async () => {
    await montar();

    botaoPorTexto('Descrição').click();
    await flush();
    botaoPorTexto('Salvar').click();
    await flush();

    expect(atualizarImagemCampo).not.toHaveBeenCalled();
  });

  // A FICHA E SO LEITURA desde 2026-08-09: tudo o que muda o campo mora em
  // "Editar o campo".
  test('a ficha (podeEditar falso) nao tem o botao', async () => {
    await montar(false);
    expect(botaoPorTexto('Descrição')).toBeUndefined();
    expect(botaoPorTexto('Remover')).toBeUndefined();
  });
});
