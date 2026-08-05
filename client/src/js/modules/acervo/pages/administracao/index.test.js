import { describe, test, expect, vi, beforeEach } from 'vitest';

// Cada aba vira um dublê que registra montagem e limpeza. O que esta tela faz é
// AGRUPAR e trocar; o conteúdo de cada aba tem teste próprio ao lado.
// `vi.hoisted` sobe junto dos `vi.mock`, entao a fabrica do dublê tem de morar
// dentro dele: declarada fora, ela ainda nao existiria quando o mock rodasse.
const h = vi.hoisted(() => {
  const montadas = { lista: [], limpas: [] };
  const dubleAba = (nome) => async (content) => {
    montadas.lista.push(nome);
    content.appendChild(document.createElement('div')).textContent = `conteudo:${nome}`;
    // `refresh` existe porque o componente de abas o chama; nenhum caso daqui
    // mede recarga, então ele não registra nada.
    return {
      cleanup: () => { montadas.limpas.push(nome); },
      refresh: () => {},
    };
  };
  return { montadas, dubleAba };
});

vi.mock('@modules/acervo/pages/administracao/volumes-tab.js', () => ({
  renderVolumesTab: h.dubleAba('armazenamento'),
}));
vi.mock('@modules/acervo/pages/administracao/volume-tipo-produto-tab.js', () => ({
  renderVolumeTipoProdutoTab: h.dubleAba('tipo_produto'),
}));
vi.mock('@modules/acervo/pages/administracao/projetos-tab.js', () => ({
  renderProjetosTab: h.dubleAba('projetos'),
}));
vi.mock('@modules/acervo/pages/administracao/lotes-tab.js', () => ({
  renderLotesTab: h.dubleAba('lotes'),
}));
vi.mock('@modules/acervo/pages/administracao/verificar-volume-tab.js', () => ({
  renderVerificarVolumeTab: h.dubleAba('verificar'),
}));
vi.mock('@modules/acervo/pages/administracao/arquivos-problema-tab.js', () => ({
  renderArquivosProblemaTab: h.dubleAba('problema'),
}));
vi.mock('@modules/acervo/pages/administracao/arquivos-excluidos-tab.js', () => ({
  renderArquivosExcluidosTab: h.dubleAba('excluidos'),
}));
vi.mock('@modules/acervo/pages/administracao/downloads-excluidos-tab.js', () => ({
  renderDownloadsExcluidosTab: h.dubleAba('downloads'),
}));
vi.mock('@modules/acervo/pages/administracao/manutencao-tab.js', () => ({
  renderManutencaoTab: h.dubleAba('manutencao'),
}));

const montadas = h.montadas;

import { renderAdministracao } from '@modules/acervo/pages/administracao/index.js';
import { logarComo, OPERADOR, GERENTE } from '@/__tests__/helpers/sessao.js';

const ctx = { params: {}, query: new URLSearchParams() };

const abaChamada = (container, rotulo) =>
  [...container.querySelectorAll('button[role="tab"]')].find(b => b.textContent === rotulo);

describe('renderAdministracao', () => {
  beforeEach(() => {
    montadas.lista = [];
    montadas.limpas = [];
  });

  test('monta o titulo e os dois grupos de aba', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAdministracao(container, ctx);

    expect(container.querySelector('.page__title').textContent).toBe('Administração');
    expect(abaChamada(container, 'Volumes')).toBeDefined();
    expect(abaChamada(container, 'Projetos e lotes')).toBeDefined();

    cleanup();
  });

  // Só a aba ativa existe no DOM (contrato do createTabs). É o que impede a tela
  // de disparar as quatro cargas de uma vez ao abrir.
  test('abre so a primeira aba, e nao as quatro', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAdministracao(container, ctx);

    expect(montadas.lista).toEqual(['armazenamento']);
    expect(container.textContent).toContain('conteudo:armazenamento');
    expect(container.textContent).not.toContain('conteudo:projetos');

    cleanup();
  });

  test('a sub-aba de tipo de produto monta so quando escolhida', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAdministracao(container, ctx);

    abaChamada(container, 'Tipo de produto').click();
    await new Promise(r => setTimeout(r, 0));

    expect(montadas.lista).toEqual(['armazenamento', 'tipo_produto']);
    // A anterior foi limpa: sem isso a tabela de fora continuaria viva,
    // escutando evento e respondendo a carga que ja nao interessa.
    expect(montadas.limpas).toContain('armazenamento');

    cleanup();
  });

  // O cleanup do grupo de nivel 1 tem de ALCANÇAR a aba de nivel 2. Sem o
  // repasse, trocar de grupo deixaria a tabela do grupo anterior montada.
  test('trocar de grupo limpa a sub-aba que estava aberta', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAdministracao(container, ctx);

    abaChamada(container, 'Projetos e lotes').click();
    await new Promise(r => setTimeout(r, 0));

    expect(montadas.limpas).toContain('armazenamento');
    expect(montadas.lista).toEqual(['armazenamento', 'projetos']);

    cleanup();
  });

  // A aba de Manutenção é `verifyAdmin` nas quatro rotas, e nenhuma delas é
  // trabalho de módulo. Para um gerente ela seria uma aba de quatro botões que
  // só sabem responder 403.
  test('Manutenção nao aparece para quem nao e administrador global', async () => {
    logarComo({ acervo: GERENTE });
    const container = document.createElement('div');
    const cleanup = await renderAdministracao(container, ctx);

    expect(abaChamada(container, 'Manutenção')).toBeUndefined();
    expect(abaChamada(container, 'Volumes')).toBeDefined();

    cleanup();
  });

  // Diagnóstico é GERENTE nas quatro rotas, um nível acima do que a página pede
  // (operador). Sem o filtro, um operador veria um grupo cujas sub-abas só sabem
  // responder 403 -- o mesmo raciocínio da Manutenção.
  test('Diagnostico aparece para o gerente e nao para o operador', async () => {
    logarComo({ acervo: OPERADOR });
    const doOperador = document.createElement('div');
    const limparOperador = await renderAdministracao(doOperador, ctx);
    expect(abaChamada(doOperador, 'Diagnóstico')).toBeUndefined();
    expect(abaChamada(doOperador, 'Volumes')).toBeDefined();
    limparOperador();

    logarComo({ acervo: GERENTE });
    const doGerente = document.createElement('div');
    const limparGerente = await renderAdministracao(doGerente, ctx);
    expect(abaChamada(doGerente, 'Diagnóstico')).toBeDefined();
    limparGerente();
  });

  // "Verificar volume" e a PRIMEIRA sub-aba porque e ela que ESCREVE o status
  // que as outras tres leem: sem roda-la, a lista de arquivos com problema e a
  // foto da ultima vez que alguem rodou.
  test('a primeira sub-aba do Diagnostico e a que escreve o status', async () => {
    logarComo({ acervo: GERENTE });
    const container = document.createElement('div');
    const cleanup = await renderAdministracao(container, ctx);

    abaChamada(container, 'Diagnóstico').click();
    await new Promise(r => setTimeout(r, 0));

    expect(montadas.lista).toContain('verificar');
    expect(montadas.lista).not.toContain('problema');

    cleanup();
  });

  test('Manutenção aparece para o administrador global', async () => {
    logarComo({}, { administrador: true });
    const container = document.createElement('div');
    const cleanup = await renderAdministracao(container, ctx);

    expect(abaChamada(container, 'Manutenção')).toBeDefined();

    // E ela e a ULTIMA: e a unica do conjunto que escreve fora do cadastro, e
    // po-la no caminho de quem veio conferir um volume seria convida-la.
    const rotulos = [...container.querySelectorAll('.tabs__item')].map(b => b.textContent);
    expect(rotulos[rotulos.length - 1]).toBe('Manutenção');

    cleanup();
  });

  test('o cleanup da pagina desmonta a aba ativa', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAdministracao(container, ctx);

    cleanup();

    expect(montadas.limpas).toContain('armazenamento');
  });
});
