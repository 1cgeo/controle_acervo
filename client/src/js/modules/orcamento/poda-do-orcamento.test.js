import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { flush } from '@/__tests__/helpers/flush.js';

// A PODA DO ORCAMENTO, de 2026-08-08.
//
// Onze colunas morreram no servidor no mesmo dia, e tres viraram DERIVADAS. Uma
// referencia sobrevivente no client NAO quebra o build, nao quebra o teste da
// tela que a contem e nao aparece em nenhuma revisao: ela vira um campo que chega
// `undefined`, uma coluna que imprime '-' para sempre, ou uma chave a mais no
// corpo do POST, que o validador estrito do modulo recusa com 400 sem dizer qual
// tela mandou.
//
// Este arquivo le o FONTE, porque e a unica forma de cobrar uma ausencia. Ele
// falha no arquivo e na linha.
//
// Ele tem DUAS metades positivas, e elas sao o ponto:
//
//   1. `valor_estimado` (DFD), `valor_total` (item do DFD) e `gnd` (item do PDR)
//      continuam APARECENDO. Elas nao sumiram do sistema: sumiram do teclado. O
//      servidor as calcula e as devolve, e apaga-las da tela seria trocar um
//      campo redundante por um numero que ninguem ve.
//   2. `ano_referencia` do recebimento e `cod_catmat_catser` do item do DFD, ao
//      contrario, GANHARAM coluna. As duas eram gravaveis e invisiveis: o
//      formulario as pedia e nenhuma tabela as mostrava, e a primeira delas
//      decide em qual RPCMTec o material aparece.

const RAIZ = join(process.cwd(), 'src', 'js');

/** Todo .js de src/js, menos os proprios testes (que citam os nomes mortos). */
function fontes(dir = RAIZ, acc = []) {
  for (const nome of readdirSync(dir)) {
    const caminho = join(dir, nome);
    if (statSync(caminho).isDirectory()) {
      fontes(caminho, acc);
    } else if (nome.endsWith('.js') && !nome.endsWith('.test.js')) {
      acc.push(caminho);
    }
  }
  return acc;
}

// A busca ignora COMENTARIO: explicar por que uma coluna morreu exige escrever o
// nome dela, e proibir isso seria proibir a explicacao. O que se cobra e o
// CODIGO.
function linhasDeCodigo(texto) {
  return texto
    .split('\n')
    .map((linha, i) => ({ numero: i + 1, texto: linha }))
    // Comentario de linha inteira e o caso comum nesta base; o de bloco entra
    // por `*` no comeco da linha continuada.
    .filter(({ texto: t }) => {
      const limpa = t.trim();
      return limpa !== '' && !limpa.startsWith('//') && !limpa.startsWith('*') && !limpa.startsWith('/*');
    });
}

/** Onde a expressao aparece em CODIGO, como 'arquivo:linha'. */
function ocorrencias(regex) {
  const achados = [];
  for (const caminho of fontes()) {
    const conteudo = readFileSync(caminho, 'utf8');
    for (const { numero, texto } of linhasDeCodigo(conteudo)) {
      if (regex.test(texto)) {
        achados.push(`${relative(process.cwd(), caminho)}:${numero}  ${texto.trim()}`);
      }
    }
  }
  return achados;
}

function fonteDe(...partes) {
  return readFileSync(join(RAIZ, ...partes), 'utf8');
}

describe('a poda do DFD', () => {
  // `justificativa`, `data_prevista_conclusao` e `responsavel_cpf` estavam em 0
  // de 8 DFDs, e nenhum DFD jamais foi editado: nao e "preencheram e apagaram",
  // e nunca se preencheu. O CPF tinha um motivo a mais para sair: dado pessoal
  // num repositorio publico e num banco que nao precisa dele.
  test('nenhum fonte manda nem le justificativa', () => {
    expect(ocorrencias(/\bjustificativa\b/i)).toEqual([]);
  });

  test('nenhum fonte manda nem le a data prevista de conclusao', () => {
    expect(ocorrencias(/data_prevista_conclusao/)).toEqual([]);
  });

  test('nenhum fonte pede o CPF do responsavel', () => {
    expect(ocorrencias(/responsavel_cpf|cpfNoFormato/)).toEqual([]);
    expect(ocorrencias(/CPF do responsável/)).toEqual([]);
  });

  // `vinculo_plano_gestao` tinha UM valor distinto em 8 de 8 ('Plano de Gestão
  // do 1º CGEO'): uma constante disfarcada de coluna.
  test('nenhum fonte manda nem le o vinculo com o plano de gestao', () => {
    expect(ocorrencias(/vinculo_plano_gestao/)).toEqual([]);
  });

  // `grau_prioridade_id` estava preenchida em 1 de 8, com um unico valor, e
  // nenhum filtro, agrupamento ou relatorio a lia. Ela era a UNICA FK que
  // apontava para `dominio.grau_prioridade`, entao a tabela de dominio e a rota
  // que a servia sairam no mesmo commit: chamar `GET /dominio/grau_prioridade`
  // hoje e 404 dentro de um Promise.all, e derrubaria a lista de DFD inteira.
  test('nenhum fonte cita o grau de prioridade nem a rota do dominio', () => {
    expect(ocorrencias(/grau_?[Pp]rioridade/i)).toEqual([]);
  });

  // `data_modificacao` e `usuario_modificacao_uuid` sairam do DFD e do item do
  // PDR: nenhum dos dois jamais foi editado (0 de 8 e 0 de 36), e o item do DFD
  // e apagado e reinserido inteiro a cada salvamento, entao as colunas nao
  // podiam nem receber valor. Quem responde "o que mudou, quando e por quem" e o
  // painel de historico, que os dois dialogos ja montam.
  //
  // A BUSCA E POR ARQUIVO, e nao global: a ficha da NE e a da NC mostram
  // `data_modificacao` legitimamente, porque nas tabelas delas a coluna ficou.
  test('a ficha do DFD e a do item do PDR nao leem mais a data de modificacao', () => {
    for (const caminho of [
      ['modules', 'orcamento', 'pages', 'dfd', 'dfd-dialog.js'],
      ['modules', 'orcamento', 'pages', 'pdr', 'item-dialog.js'],
    ]) {
      const fonte = fonteDe(...caminho);
      for (const { texto } of linhasDeCodigo(fonte)) {
        expect(texto).not.toMatch(/data_modificacao|usuario_modificacao/);
      }
    }
  });
});

describe('a poda da nota de credito e da licitacao', () => {
  // `nota_credito.marcador`: texto livre de 8 caracteres, um unico valor
  // ('RECOLH') em 8 de 99 NCs, e DISCORDANDO do dado em 3 dos 11 casos de
  // recolhimento integral. A pergunta que ele tentava responder tem resposta
  // exata desde a 1.40.0.
  test('nenhum fonte manda nem le o marcador da NC', () => {
    expect(ocorrencias(/\bmarcador\b/)).toEqual([]);
  });

  // `licitacao.nup` e `licitacao.fornecedor`: nasceram em 2026-08-04 e sairam em
  // 2026-08-08, com 0 de 11 licitacoes preenchidas nas duas.
  test('nenhum fonte manda o NUP nem o fornecedor da licitacao', () => {
    expect(ocorrencias(/nupField|\bnup\s*:/)).toEqual([]);
    expect(ocorrencias(/fornecedorField/)).toEqual([]);
  });

  test('o numero do pregao FICOU, e continua identificando o processo', () => {
    // A metade positiva desta poda: das quatro colunas de 2026-08-04, duas
    // ficaram. `numero_pregao` e `data_homologacao` tem justificativa por coluna
    // na migracao que as criou, e e por elas que o chefe acha uma licitacao.
    const dialogo = fonteDe('modules', 'orcamento', 'pages', 'licitacoes', 'licitacao-dialog.js');
    expect(dialogo).toContain('numero_pregao');
    expect(dialogo).toContain('data_homologacao');
  });
});

describe('as tres que viraram DERIVADAS: ninguem digita, e todo mundo ve', () => {
  // O corpo de nenhum POST/PUT leva as tres. Quem as calcula e o servidor, e
  // manda-las de volta seria 400 no validador estrito do modulo.
  test('nenhum corpo manda valor_total, valor_estimado nem gnd', () => {
    expect(ocorrencias(/\bvalor_total\s*:/)).toEqual([]);
    expect(ocorrencias(/\bvalor_estimado\s*:/)).toEqual([]);
    expect(ocorrencias(/\bgnd\s*:/)).toEqual([]);
  });

  test('o valor estimado continua na LISTA de DFD, marcado como calculado', () => {
    const lista = fonteDe('modules', 'orcamento', 'pages', 'dfd', 'list.js');
    expect(lista).toContain("key: 'valor_estimado'");
    expect(lista).toContain('Valor estimado (calc.)');
  });

  test('o valor estimado continua na FICHA do DFD, e nao se digita', () => {
    const dialogo = fonteDe('modules', 'orcamento', 'pages', 'dfd', 'dfd-dialog.js');
    expect(dialogo).toContain('valorEstimadoField.input.disabled = true');
  });

  test('o GND continua na lista do PDR, marcado como calculado', () => {
    const lista = fonteDe('modules', 'orcamento', 'pages', 'pdr', 'list.js');
    expect(lista).toContain("key: 'gnd'");
    expect(lista).toContain('GND (calc.)');
    // Os dois cartoes do resumo continuam somando por ele.
    expect(lista).toContain('Number(item.gnd) === 3');
  });

  test('o GND continua na ficha do item do PDR, desabilitado', () => {
    const dialogo = fonteDe('modules', 'orcamento', 'pages', 'pdr', 'item-dialog.js');
    expect(dialogo).toContain('gndField.input.disabled = true');
  });

  test('o valor total continua na tabela de itens do DFD', () => {
    const dialogo = fonteDe('modules', 'orcamento', 'pages', 'dfd', 'dfd-dialog.js');
    expect(dialogo).toContain('V. total (calc.)');
    expect(dialogo).toContain('totalDoItem');
  });
});

// -----------------------------------------------------------------------------
// A OUTRA METADE: os dois campos gravaveis e invisiveis que ganharam coluna
// -----------------------------------------------------------------------------

vi.mock('@modules/orcamento/services/orcamento-service.js', () => ({
  getNotaEmpenho: vi.fn(),
  getLiquidacoes: vi.fn(() => Promise.resolve([])),
  createLiquidacao: vi.fn(() => Promise.resolve({})),
  updateLiquidacao: vi.fn(() => Promise.resolve({})),
  deleteLiquidacao: vi.fn(() => Promise.resolve({})),
  getRecebimentos: vi.fn(),
  createRecebimento: vi.fn(() => Promise.resolve({})),
  updateRecebimento: vi.fn(() => Promise.resolve({})),
  deleteRecebimento: vi.fn(() => Promise.resolve({})),
  downloadArquivo: vi.fn(() => Promise.resolve()),
  getArquivos: vi.fn(() => Promise.resolve([])),
  uploadArquivo: vi.fn(() => Promise.resolve([])),
  deleteArquivo: vi.fn(() => Promise.resolve()),
  createDfd: vi.fn(() => Promise.resolve({ id: 1 })),
  updateDfd: vi.fn(() => Promise.resolve({})),
}));

vi.mock('@components/historico/historico.js', () => ({
  criarHistorico: vi.fn(() => ({
    element: document.createElement('div'),
    recarregar: vi.fn(),
    cleanup: vi.fn(),
  })),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
}));

const { renderNotaEmpenhoDetails } = await import('@modules/orcamento/pages/notas-empenho/details.js');
const { openDfdDialog } = await import('@modules/orcamento/pages/dfd/dfd-dialog.js');
const svc = await import('@modules/orcamento/services/orcamento-service.js');
const { saveAuth, clearAuth } = await import('@store/auth-store.js');

/** Os cabecalhos de uma tabela, na ordem. */
function cabecalhos(tabela) {
  return [...tabela.querySelectorAll('thead th')].map(th => th.textContent.trim());
}

describe('o ano de referencia do recebimento ganhou coluna', () => {
  beforeEach(() => {
    saveAuth({ token: 't', administrador: false, uuid: 'u-1', perfis: { orcamento: 1 } }, 'fulano');
    svc.getNotaEmpenho.mockImplementation(() => Promise.resolve({
      id: 10, numero: '2026NE000123', ano: 2026, valor_empenhado: 1000,
    }));
  });

  afterEach(() => {
    clearAuth();
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  async function montarFichaDaNe(recebimentos) {
    svc.getRecebimentos.mockImplementation(() => Promise.resolve(recebimentos));
    const container = document.createElement('div');
    document.body.appendChild(container);
    const cleanup = await renderNotaEmpenhoDetails(container, { params: { id: '10' } });
    await flush();
    return { container, cleanup };
  }

  /** A tabela de recebimentos e a segunda `.dashboard-section` da ficha. */
  function tabelaDeRecebimentos(container) {
    return [...container.querySelectorAll('.dashboard-section')]
      .find(s => s.textContent.includes('Recebimentos de material'))
      .querySelector('table');
  }

  test('o ano lancado aparece na tabela', async () => {
    const { container, cleanup } = await montarFichaDaNe([
      { id: 1, material: 'Plotter A0', ano_referencia: 2025 },
    ]);

    const tabela = tabelaDeRecebimentos(container);
    expect(cabecalhos(tabela)).toContain('Ano de referência (4.6)');
    expect(tabela.querySelector('tbody').textContent).toContain('2025');

    if (typeof cleanup === 'function') cleanup();
  });

  // Em branco a 4.6 do RPCMTec usa o ano do EMPENHO (o COALESCE do relatorio).
  // Um traco esconderia o ano que de fato vale, e e o caso de 14 dos 15
  // recebimentos reais.
  test('em branco a celula mostra o ano do empenho, e nao um traco', async () => {
    const { container, cleanup } = await montarFichaDaNe([
      { id: 1, material: 'Plotter A0', ano_referencia: null },
    ]);

    const celula = [...tabelaDeRecebimentos(container).querySelectorAll('tbody td')]
      .find(td => td.querySelector('span[title]'));
    expect(celula.textContent).toBe('2026');
    expect(celula.querySelector('span').title).toContain('ano do empenho');

    if (typeof cleanup === 'function') cleanup();
  });
});

describe('o CATMAT/CATSER do item do DFD ganhou coluna', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    vi.clearAllMocks();
  });

  test('o codigo lancado aparece na tabela de itens do proprio dialogo', async () => {
    openDfdDialog({
      dfd: {
        id: 4,
        ano: 2026,
        numero: '103/2025',
        itens: [{
          tipo_item_id: 1,
          cod_catmat_catser: '150822',
          descricao: 'Papel sulfite',
          quantidade: 10,
          valor_unitario: 25,
          valor_total: 250,
        }],
      },
      dominios: { tipoItem: [{ code: 1, nome: 'Material' }] },
    });
    await flush();

    const tabela = document.querySelector('.dfd-itens-table');
    expect(cabecalhos(tabela)).toContain('CATMAT/CATSER');
    expect(tabela.querySelector('tbody').textContent).toContain('150822');
  });

  // O item RECEM-ADICIONADO ainda nao passou pelo servidor que calcula o total.
  // A tabela o mostra assim mesmo, pela mesma multiplicacao que o servidor fara.
  test('o item novo mostra o total calculado antes de salvar', async () => {
    openDfdDialog({
      dfd: {
        id: 4,
        ano: 2026,
        numero: '103/2025',
        itens: [{ tipo_item_id: 1, descricao: 'Tinta', quantidade: 4, valor_unitario: 12.5 }],
      },
      dominios: { tipoItem: [{ code: 1, nome: 'Material' }] },
    });
    await flush();

    // O espaco de `formatCurrency` e NAO SEPARAVEL (U+00A0): quem formata e o
    // Intl do navegador, e comparar com o espaco comum do fonte falharia por um
    // caractere invisivel.
    const corpo = document.querySelector('.dfd-itens-table tbody').textContent;
    expect(corpo.replace(/\s/g, ' ')).toContain('R$ 50,00');
  });
});
