import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// A tela nao decide nada sobre o CONTEUDO da auditoria: os invariantes, a
// severidade de cada um e a amostra vem todos do servidor. O que ela decide, e
// o que estes testes protegem, e a LEITURA: a ordem, o que ganha cor, o que
// aparece quando o total e zero, e o que acontece quando um invariante quebra.
const servico = vi.hoisted(() => ({
  resposta: [], chamadas: [], falha: null, adiar: false, resolver: null,
}));

vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getAuditoria: (opcoes) => {
    servico.chamadas.push(opcoes);
    if (servico.falha) return Promise.reject(servico.falha);
    // `adiar` deixa a requisição EM VOO: é o único jeito de o teste sair da
    // página com a resposta ainda por chegar.
    if (servico.adiar) return new Promise((r) => { servico.resolver = r; });
    return Promise.resolve(servico.resposta);
  },
}));

const erros = vi.hoisted(() => []);
vi.mock('@utils/toast.js', () => ({
  showError: (m) => { erros.push(m); },
  showSuccess: () => {},
}));

const { renderAuditoria, esquecerUltimaAuditoria } = await import('./index.js');

const inv = (codigo, severidade, total, extra = {}) => ({
  codigo,
  severidade,
  titulo: `titulo de ${codigo}`,
  total,
  amostra: [],
  truncada: false,
  ...extra,
});

let container;

beforeEach(() => {
  container = document.createElement('div');
  document.body.replaceChildren(container);
  servico.resposta = [];
  servico.chamadas = [];
  servico.falha = null;
  servico.adiar = false;
  servico.resolver = null;
  erros.length = 0;
  // O ultimo resultado sobrevive a troca de tela de proposito, entao ele
  // sobreviveria de um teste para o outro se ninguem o descartasse.
  esquecerUltimaAuditoria();
});

/**
 * Abre a tela e APERTA o botao, que e como a auditoria roda: a montagem nao
 * mede nada (ver o comentario de `ultimaAuditoria` na pagina).
 */
const abrirERodar = async () => {
  const cleanup = await renderAuditoria(container);
  container.querySelector('.btn--primary').click();
  await flush();
  return cleanup;
};

/** Os codigos na ordem em que a tabela os pintou. */
const codigosNaTela = () =>
  [...container.querySelectorAll('tbody tr')]
    .map(tr => tr.querySelector('td')?.textContent?.trim())
    .filter(Boolean);

const linhaDe = (codigo) =>
  [...container.querySelectorAll('tbody tr')]
    .find(tr => tr.querySelector('td')?.textContent?.trim() === codigo);

describe('pagina de auditoria do acervo', () => {
  test('o botao roda a auditoria e pede amostra', async () => {
    servico.resposta = [inv('2c', 'DEFECT', 0)];

    await abrirERodar();

    expect(servico.chamadas).toHaveLength(1);
    // O tamanho da amostra é o de `AMOSTRA` na página (index.js:31). Um
    // "maior que zero" passaria com a amostra reduzida a uma linha.
    expect(servico.chamadas[0].amostra).toBe(50);
  });

  // ABRIR A TELA NAO MEDE NADA. Sao dezenas de consultas, e o 7a deriva o nome
  // padrao de cada arquivo do acervo: rodando na montagem, um clique errado na
  // sidebar custava uma auditoria inteira, e voltar de outra tela custava outra.
  test('nao roda nada ao abrir, e convida a rodar', async () => {
    servico.resposta = [inv('2c', 'DEFECT', 0)];

    await renderAuditoria(container);
    await flush();

    expect(servico.chamadas).toHaveLength(0);
    expect(container.textContent).toContain('Aperte "Rodar auditoria"');
    expect(codigosNaTela()).toEqual([]);
  });

  // Guardar o resultado NAO e cachear a resposta: o numero volta DATADO. O modo
  // de falhar caro desta tela e mostrar a contagem de antes da correcao para
  // quem acabou de corrigir, e um numero com a hora ao lado nao faz isso.
  test('reabrir a tela repinta o ultimo resultado sem medir de novo, dizendo quando', async () => {
    servico.resposta = [inv('7a', 'DEFECT', 40)];

    const cleanup = await abrirERodar();
    expect(servico.chamadas).toHaveLength(1);
    cleanup();

    const outro = document.createElement('div');
    document.body.replaceChildren(outro);
    container = outro;
    await renderAuditoria(container);
    await flush();

    expect(servico.chamadas).toHaveLength(1);
    expect(codigosNaTela()).toEqual(['7a']);
    expect(container.textContent).toMatch(/Medido às \d{2}:\d{2}/);
  });

  test('o botao mede de novo, e nao serve o resultado guardado', async () => {
    servico.resposta = [inv('7a', 'DEFECT', 40)];
    await abrirERodar();

    servico.resposta = [inv('7a', 'DEFECT', 0)];
    container.querySelector('.btn--primary').click();
    await flush();

    expect(servico.chamadas).toHaveLength(2);
    expect(linhaDe('7a').textContent).toContain('—');
  });

  // O combo esta ligado desde a montagem, e antes da primeira medicao a lista e
  // vazia: trocar a severidade ali nao pode virar "0 com ocorrência", que diria
  // uma contagem sobre nada.
  test('mexer na severidade antes de medir mantem o convite', async () => {
    await renderAuditoria(container);

    const select = container.querySelector('select');
    select.value = 'DEFECT';
    select.dispatchEvent(new Event('change'));

    expect(container.textContent).toContain('Aperte "Rodar auditoria"');
    expect(container.textContent).not.toContain('com ocorrência');
  });

  // DEFECT primeiro porque e o unico que exige acao, e dentro da severidade o
  // maior numero primeiro. E a mesma ordem do CLI e do dialogo do plugin: sao a
  // mesma pergunta, e ordenar diferente faria a mesma auditoria parecer outra.
  test('ordena DEFECT, depois REVISAR, depois INFO, e por total decrescente', async () => {
    servico.resposta = [
      inv('6b', 'INFO', 900),
      inv('5i', 'REVISAR', 2),
      inv('2c', 'DEFECT', 1),
      inv('7a', 'DEFECT', 40),
      inv('3h', 'REVISAR', 30),
    ];

    await abrirERodar();

    expect(codigosNaTela()).toEqual(['7a', '2c', '3h', '5i', '6b']);
  });

  // Um DEFECT com zero e BOA NOTICIA. Pinta-lo faria a tela parecer cheia de
  // problema justamente no dia em que o acervo esta limpo, e cor que aparece
  // sempre deixa de significar alguma coisa.
  test('so pinta a linha que TEM ocorrencia', async () => {
    servico.resposta = [inv('7a', 'DEFECT', 3), inv('2c', 'DEFECT', 0)];

    await abrirERodar();

    expect(linhaDe('7a').className).toContain('auditoria__linha--defect');
    expect(linhaDe('2c').className).not.toContain('auditoria__linha--defect');
  });

  test('mostra travessao no lugar do zero', async () => {
    servico.resposta = [inv('2c', 'DEFECT', 0)];

    await abrirERodar();

    expect(linhaDe('2c').textContent).toContain('—');
  });

  // O invariante que quebrou no servidor NAO pode se parecer com zero: zero quer
  // dizer "olhei e nao achei nada", e ele quer dizer "ninguem olhou". Some-lo ou
  // mostra-lo como zero faria a auditoria parecer completa sem ser.
  test('um invariante que quebrou aparece como erro, nunca como zero', async () => {
    servico.resposta = [
      inv('2c', 'DEFECT', 0),
      inv('7a', 'DEFECT', null, { erro: 'column p.mi does not exist' }),
    ];

    await abrirERodar();

    const linha = linhaDe('7a');
    expect(linha.textContent).toContain('erro');
    expect(linha.className).toContain('auditoria__linha--erro');
    expect(container.textContent).toContain('invariante(s) com erro: 7a');
  });

  test('o resumo conta as ocorrencias de DEFECT, e nao os invariantes', async () => {
    servico.resposta = [
      inv('7a', 'DEFECT', 40),
      inv('2c', 'DEFECT', 2),
      inv('5i', 'REVISAR', 500),
    ];

    await abrirERodar();

    expect(container.textContent).toContain('42 ocorrência(s) de DEFECT');
  });

  // O filtro e do CLIENTE de proposito: a auditoria sao dezenas de consultas
  // numa transacao so, e refazer tudo para esconder linha cobraria uma auditoria
  // inteira por clique no combo.
  test('filtrar por severidade nao roda a auditoria de novo', async () => {
    servico.resposta = [inv('7a', 'DEFECT', 40), inv('5i', 'REVISAR', 2)];

    await abrirERodar();
    expect(servico.chamadas).toHaveLength(1);

    const select = container.querySelector('select');
    select.value = 'REVISAR';
    select.dispatchEvent(new Event('change'));

    expect(codigosNaTela()).toEqual(['5i']);
    expect(servico.chamadas).toHaveLength(1);
  });

  // As colunas saem do PROPRIO resultado. Uma tabela de colunas fixas esconderia
  // justamente a coluna que explica a ocorrencia -- o `esperado` do 7a, o
  // `falta` do 4h, as duas datas do 3i.
  test('a amostra usa as colunas que o invariante devolveu', async () => {
    servico.resposta = [inv('7a', 'DEFECT', 1, {
      amostra: [{ id: 12, nome_arquivo: 'carta_ensaio', esperado: 'CT_s12_2757-1-NE_1dsg' }],
    })];

    await abrirERodar();
    container.querySelector('.data-table__action-btn').click();

    const detalhe = container.querySelector('.auditoria__detalhe');
    const cabecalhos = [...detalhe.querySelectorAll('th')].map(th => th.textContent);
    expect(cabecalhos).toEqual(['id', 'nome_arquivo', 'esperado']);
    expect(detalhe.textContent).toContain('CT_s12_2757-1-NE_1dsg');
  });

  // Anunciar "1 de 1.284" e o que impede alguem de corrigir a amostra e achar
  // que acabou.
  test('diz quantas de quantas quando a amostra foi truncada', async () => {
    servico.resposta = [inv('7a', 'DEFECT', 1284, {
      truncada: true,
      amostra: [{ id: 1 }],
    })];

    await abrirERodar();
    container.querySelector('.data-table__action-btn').click();

    expect(container.querySelector('.auditoria__detalhe').textContent)
      .toContain('mostrando 1 de 1.284');
  });

  test('a falha da requisicao vira aviso, e nao tela em branco', async () => {
    servico.falha = new Error('Acesso negado');

    await abrirERodar();

    expect(erros).toContain('Acesso negado');
    expect(container.textContent).toContain('Não foi possível rodar a auditoria');
  });

  // A SEGUNDA rodada que falha nao pode apagar a primeira.
  //
  // Zerar a lista custava duas coisas. A tabela passava a dizer "Nenhum
  // invariante nesta severidade", que nesta tela se le como acervo limpo --
  // o oposto do que aconteceu. E o resumo, repintado no primeiro toque no
  // filtro de severidade, afirmava "Medido às HH:MM. 0 invariante(s) rodados",
  // com a hora da medicao que deu certo e as contagens da que falhou.
  test('falha depois de uma medicao que deu certo mantem na tela o resultado datado', async () => {
    servico.resposta = [inv('2c', 'DEFECT', 3), inv('7a', 'REVISAR', 0)];
    await abrirERodar();
    expect(codigosNaTela()).toEqual(['2c', '7a']);

    servico.falha = new Error('sem rede');
    container.querySelector('.btn--primary').click();
    await flush();

    expect(codigosNaTela()).toEqual(['2c', '7a']);
    expect(container.textContent).toContain('Não foi possível rodar a auditoria agora');
    expect(container.textContent).toContain('Na tela, a medição das');

    // E o filtro de severidade continua falando da medicao que existe, em vez
    // de anunciar zero invariante rodado.
    const select = container.querySelector('.auditoria__select');
    select.value = 'DEFECT';
    select.dispatchEvent(new Event('change'));
    await flush();

    expect(codigosNaTela()).toEqual(['2c']);
    expect(container.querySelector('.auditoria__resumo').textContent)
      .toContain('1 invariante(s) rodados');
  });

  test('o cleanup nao deixa a resposta atrasada pintar a tela', async () => {
    servico.adiar = true;
    const cleanup = await renderAuditoria(container);
    container.querySelector('.btn--primary').click();
    await flush();

    // A página sai com a auditoria ainda rodando no servidor.
    cleanup();

    servico.resolver([inv('2c', 'DEFECT', 3)]);
    await flush();

    // O guard de descarte segurou a resposta: a tabela continua vazia e o
    // resumo não anuncia resultado nenhum.
    expect(codigosNaTela()).toEqual([]);
    expect(container.textContent).not.toContain('titulo de 2c');
    expect(container.textContent).toContain('Rodando os invariantes no servidor');
  });
});
