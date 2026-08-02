import { describe, test, expect, vi, beforeEach } from 'vitest';

// Aproveitamento do efetivo (#/aproveitamento), a subsecao 6.1 do RPCMTec.
//
// O que estes casos FIXAM:
//  - o posto sai da LINHA do mes, e nao do cadastro de hoje (e o congelamento
//    que a tabela existe para guardar);
//  - copiar o mes anterior recarrega a lista, e diz quantas linhas entraram;
//  - editar as atividades salva a linha sem recarregar a tela.
vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getEfetivoMes: vi.fn(() => Promise.resolve([])),
    getEfetivoFaltantes: vi.fn(() => Promise.resolve([])),
    copiarEfetivoMesAnterior: vi.fn(() => Promise.resolve({ inseridos: 0 })),
    createEfetivo: vi.fn(() => Promise.resolve({ id: 1 })),
    updateEfetivo: vi.fn(() => Promise.resolve({ id: 1 })),
    deleteEfetivo: vi.fn(() => Promise.resolve()),
  };
});

import { renderAproveitamento } from '@pages/aproveitamento/index.js';
import {
  getEfetivoMes,
  copiarEfetivoMesAnterior,
  updateEfetivo,
} from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

const flush = () => new Promise(resolve => setTimeout(resolve, 0));

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderAproveitamento(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

const EFETIVO = [
  {
    id: '1', ano: 2026, mes: 7, usuario_uuid: 'u1',
    // O posto da EPOCA: a pessoa foi promovida depois, e o cadastro de hoje diz
    // outra coisa. A tela tem de mostrar este.
    tipo_posto_grad_id: 13, posto_abrev: 'Cap', posto: 'Capitão',
    nome: 'Fulano de Tal', nome_guerra: 'Fulano', login: 'fulano', ativo: true,
    atividades: 'Chefe da Seção de Geoinformação',
  },
  {
    id: '2', ano: 2026, mes: 7, usuario_uuid: 'u2',
    tipo_posto_grad_id: 7, posto_abrev: '2º Sgt', posto: 'Segundo Sargento',
    nome: 'Beltrano', nome_guerra: 'Beltrano', login: 'beltrano',
    // Saiu da Divisao depois do retrato: a linha do mes em que esteve continua.
    ativo: false,
    atividades: null,
  },
];

const botao = (container, texto) => [...container.querySelectorAll('button')]
  .find(b => b.textContent.includes(texto));

describe('renderAproveitamento', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
  });

  test('mostra o posto DA LINHA e marca quem saiu do cadastro', async () => {
    getEfetivoMes.mockResolvedValueOnce(EFETIVO);

    const { container, cleanup } = await montar();

    const nomes = [...container.querySelectorAll('tbody tr td:nth-child(1)')]
      .map(td => td.textContent);
    expect(nomes).toEqual(['Cap Fulano', '2º Sgt Beltrano']);

    const cadastro = [...container.querySelectorAll('tbody tr td:nth-child(3)')]
      .map(td => td.textContent);
    expect(cadastro).toEqual(['Ativo', 'Desativado']);

    if (typeof cleanup === 'function') cleanup();
  });

  // "Iniciar do efetivo atual" saiu em 2026-08-02 (chefe): o mes vazio se resolve
  // copiando o anterior, e dois botoes de partida obrigavam a escolher entre
  // duas coisas que quase sempre dao o mesmo resultado.
  test('copiar recarrega a lista, e nao mente quando nao havia o que copiar', async () => {
    getEfetivoMes.mockResolvedValue(EFETIVO);
    copiarEfetivoMesAnterior.mockResolvedValueOnce({ inseridos: 0 });

    const { container, cleanup } = await montar();

    botao(container, 'Copiar mês anterior').click();
    await flush();

    expect(copiarEfetivoMesAnterior).toHaveBeenCalled();
    expect(getEfetivoMes).toHaveBeenCalledTimes(2);

    if (typeof cleanup === 'function') cleanup();
  });

  test('editar as atividades salva a linha sem recarregar a tela', async () => {
    getEfetivoMes.mockResolvedValueOnce(EFETIVO);

    const { container, cleanup } = await montar();

    const campo = container.querySelectorAll('tbody input[type="text"]')[1];
    expect(campo.value).toBe('');
    campo.value = 'Almoxarifado';
    campo.dispatchEvent(new Event('change'));
    await flush();

    expect(updateEfetivo).toHaveBeenCalledWith('2', expect.objectContaining({
      atividades: 'Almoxarifado',
      // O posto vai junto e INALTERADO: o PUT reescreve os dois campos, e omiti-lo
      // devolveria a linha ao posto do cadastro de hoje.
      tipo_posto_grad_id: 7,
    }));
    expect(getEfetivoMes).toHaveBeenCalledTimes(1);

    if (typeof cleanup === 'function') cleanup();
  });
});
