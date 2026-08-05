import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// Extra-PIT (#/extra_pit), a subsecao 3.3 do RPCMTec.
//
// O que estes casos FIXAM: a lista e do ANO (a autorizacao atravessa o ano e
// muda de situacao), a situacao chega TRADUZIDA do servidor, e escrever e do
// administrador global -- quem so tem perfil de modulo le e nao edita.
vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return {
    ...real,
    getExtraPit: vi.fn(() => Promise.resolve([])),
    getAnosExtraPit: vi.fn(() => Promise.resolve([2026])),
    deleteExtraPit: vi.fn(() => Promise.resolve()),
  };
});

import { renderExtraPitList } from '@pages/extra-pit/list.js';
import { getExtraPit } from '@services/plataforma-service.js';
import { saveAuth } from '@store/auth-store.js';

function logar({ administrador = false, perfis = {} } = {}) {
  saveAuth({ token: 't', administrador, uuid: 'u', perfis, modulos: [] }, 'x');
}

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderExtraPitList(container, { params: {}, query: new URLSearchParams() });
  await flush();
  return { container, cleanup };
}

const DEMANDAS = [
  {
    id: '1', ano: 2026, demandante: 'CMS', tipo_produto: 'Carta especial 1:10.000',
    quantidade: 4, situacao_id: 2, situacao: 'Em produção',
    documento_autorizacao: 'Of 123-S/1 CGEO', descricao: 'Apoio à operação',
    data_entrega: '2026-09-30',
    quantidade_materializada: 2,
  },
];

describe('renderExtraPitList', () => {
  beforeEach(() => {
    localStorage.clear();
    vi.clearAllMocks();
  });

  test('lista a demanda do ano com a situacao ja traduzida', async () => {
    logar({ administrador: true });
    getExtraPit.mockResolvedValueOnce(DEMANDAS);

    const { container, cleanup } = await montar();

    // O ano vai na consulta: a lista e do ANO, e nao do mes como as vizinhas
    // 3.1, 3.2 e 3.4 do relatorio.
    expect(getExtraPit).toHaveBeenCalledWith(new Date().getFullYear());

    const celulas = [...container.querySelectorAll('tbody tr td')].map(td => td.textContent);
    expect(celulas[0]).toBe('CMS');
    expect(celulas[2]).toBe('4');
    // O que JÁ MATERIALIZOU, ao lado do que a demanda promete. Vem calculado do
    // servidor (`quantidade_materializada`), e não gravado.
    expect(celulas[3]).toBe('2');
    // Traduzida no SERVIDOR, pelo mesmo JOIN que alimenta o RPCMTec e o CLI.
    expect(celulas[4]).toBe('Em produção');
    expect(celulas[5]).toBe('Of 123-S/1 CGEO');
    expect(celulas[6]).toBe('30/09/2026');

    if (typeof cleanup === 'function') cleanup();
  });

  test('quem nao e administrador le, e nao ganha botao de escrita', async () => {
    logar({ perfis: { mapoteca: 3 } });
    getExtraPit.mockResolvedValueOnce(DEMANDAS);

    const { container, cleanup } = await montar();

    expect(container.querySelectorAll('tbody tr').length).toBe(1);
    const botoes = [...container.querySelectorAll('button')].map(b => b.textContent);
    expect(botoes.some(t => t.includes('Nova demanda'))).toBe(false);

    if (typeof cleanup === 'function') cleanup();
  });

  // AS VERSÕES DO ACERVO ABREM PARA QUEM SÓ LÊ. A rota que lista as versões da
  // demanda é `verifyLogin`, e a pergunta "quais folhas cumpriram esta demanda"
  // é de quem monta o relatório. Quem esconde ligar e desligar é o diálogo.
  //
  // CONTROLE NEGATIVO no mesmo caso: editar e excluir continuam fora, senão a
  // ação teria sido solta para todo mundo junto.
  test('quem so le alcanca as versoes do acervo, e nao editar nem excluir', async () => {
    logar({ perfis: { mapoteca: 3 } });
    getExtraPit.mockResolvedValueOnce(DEMANDAS);

    const { container, cleanup } = await montar();

    expect(container.querySelector('[title="Versões do acervo"]')).not.toBeNull();
    expect(container.querySelector('[title="Editar"]')).toBeNull();
    expect(container.querySelector('[title="Excluir"]')).toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });

  test('o administrador recebe as tres acoes de linha', async () => {
    logar({ administrador: true });
    getExtraPit.mockResolvedValueOnce(DEMANDAS);

    const { container, cleanup } = await montar();

    expect(container.querySelector('[title="Versões do acervo"]')).not.toBeNull();
    expect(container.querySelector('[title="Editar"]')).not.toBeNull();
    expect(container.querySelector('[title="Excluir"]')).not.toBeNull();

    if (typeof cleanup === 'function') cleanup();
  });
});
