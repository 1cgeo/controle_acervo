import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';

// A IMPORTACAO DO CSV do github_dashboard, na tela de edicao da subsecao 5.1.
//
// O QUE ESTES CASOS FIXAM:
//  - o botao aparece SO na 5.1. O formato lido e o do painel do GitHub, e um
//    botao nas 18 subsecoes digitadas ofereceria despejar tabela de commits na
//    9.3, que fala de recursos humanos;
//  - a tela manda o texto CRU. Quem le o CSV e o servidor, porque a regra que
//    decide o que se apaga vale tambem para o `producao_cli`;
//  - o 409 e RECUSA QUE SE CONFIRMA, e nao erro. Ele acontece quando a
//    importacao removeria um repositorio que ja tem Resumo escrito, e a segunda
//    chamada so sai depois de a pessoa ler a lista e confirmar;
//  - recusada a confirmacao, NADA e gravado.
//
// O `confirmDialog` entra mockado porque ele so devolve a decisao. Os casos que
// importam aqui sao o que a tela faz com essa decisao.

vi.mock('@services/rpcmtec-service.js', async () => {
  const real = await vi.importActual('@services/rpcmtec-service.js');
  return {
    ...real,
    gravarSubsecao: vi.fn(() => Promise.resolve({})),
    importarRepositorios51: vi.fn(),
  };
});

vi.mock('@utils/toast.js', () => ({
  showError: vi.fn(),
  showSuccess: vi.fn(),
  showWarning: vi.fn(),
  showInfo: vi.fn(),
}));

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

const { abrirEditorSubsecao } = await import('./subsecao-editor.js');
const {
  importarRepositorios51, gravarSubsecao,
} = await import('@services/rpcmtec-service.js');
const { showError, showSuccess, showWarning } = await import('@utils/toast.js');
const { confirmDialog } = await import('@components/modal/confirm-dialog.js');

const CABECALHOS_51 = [
  'Repositório', 'Número de commits no período', 'Efetivo', 'Resumo',
];

const CSV = [
  'Repositório,Número de commits,Efetivo',
  'controle_acervo,42,Cap Fulano;Maj Beltrano',
].join('\n');

/** O bloco da 5.1 como `/rpcmtec/:id/documento` o entrega. */
const subsecao51 = (linhas = []) => ({
  numero: '5.1',
  titulo: 'Repositórios trabalhados',
  cabecalhos: CABECALHOS_51,
  linhas,
});

const RESPOSTA_OK = {
  numero: '5.1',
  total: 1,
  novos: ['controle_acervo'],
  atualizados: [],
  removidos: [],
  resumos_preservados: 0,
  avisos: [],
};

const botaoPorTexto = (texto) =>
  Array.from(document.querySelectorAll('button')).find(
    (b) => b.textContent.trim() === texto,
  );

/**
 * Esvazia a fila de promessas pendentes.
 *
 * `setTimeout`, e nao um punhado de `await Promise.resolve()`: contar
 * microtarefas amarra o teste ao NUMERO de elos da cadeia, e um elo a mais
 * (a confirmacao, a segunda chamada) deixa a promessa viva depois do caso
 * terminar. Ela entao cai no caso SEGUINTE e chama o espiao dele. Custou um
 * vermelho fantasma nesta suite.
 */
const assentar = async () => {
  for (let i = 0; i < 3; i++) {
    await new Promise((r) => setTimeout(r, 0));
  }
};

/** Percorre o caminho de COLAR ate a chamada do servico. */
async function colar(texto = CSV) {
  botaoPorTexto('Colar o CSV').click();
  const area = document.querySelector('.modal-overlay:last-of-type textarea');
  area.value = texto;
  botaoPorTexto('Importar').click();
  await assentar();
}

const erroComStatus = (mensagem, status) => {
  const e = new Error(mensagem);
  e.status = status;
  return e;
};

beforeEach(() => {
  vi.clearAllMocks();
  gravarSubsecao.mockReset();
  gravarSubsecao.mockResolvedValue({});
  // `mockReset`, e nao so `clearAllMocks`: este ultimo zera a CONTAGEM e deixa a
  // fila de `mockResolvedValueOnce` de pe. Um caso que enfileira duas respostas
  // e consome uma so entrega a sobra ao caso SEGUINTE, e ele passa a provar
  // outra coisa. Custou um vermelho fantasma na prova de fogo.
  importarRepositorios51.mockReset();
  confirmDialog.mockReset();
  confirmDialog.mockResolvedValue(true);
  importarRepositorios51.mockResolvedValue(RESPOSTA_OK);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a barra de importação aparece SÓ na 5.1', () => {
  test('a 5.1 oferece as duas entradas: arquivo e colar', () => {
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao51() });

    expect(botaoPorTexto('Escolher arquivo CSV')).toBeTruthy();
    expect(botaoPorTexto('Colar o CSV')).toBeTruthy();
    // O seletor de arquivo aceita CSV, e não fica visível.
    const seletor = document.querySelector('input[type="file"]');
    expect(seletor.getAttribute('accept')).toContain('.csv');
    expect(seletor.className).toContain('hidden');
  });

  test('a 5.2, que também é tabela, NÃO oferece', () => {
    // VARIÂNCIA: a 5.2 é a subseção vizinha, digitada e com quatro colunas.
    // Sem este caso, um botão posto em toda tabela passaria no caso acima.
    abrirEditorSubsecao({
      edicaoId: 7,
      subsecao: {
        numero: '5.2',
        titulo: 'Backup',
        cabecalhos: ['Dado ou sistema', 'Último backup completo',
          'Total em Gb de backup', 'Espaço disponível para backup em Gb'],
        linhas: [],
      },
    });

    expect(botaoPorTexto('Colar o CSV')).toBeUndefined();
    expect(document.querySelector('input[type="file"]')).toBeNull();
    // E o editor abriu de verdade: o botão de sempre está lá.
    expect(botaoPorTexto('Adicionar linha')).toBeTruthy();
  });

  test('a subseção de PROSA não oferece', () => {
    abrirEditorSubsecao({
      edicaoId: 7,
      subsecao: { numero: '9.1', titulo: 'Análise', texto: 'algo' },
    });

    expect(botaoPorTexto('Colar o CSV')).toBeUndefined();
    expect(document.querySelector('textarea')).toBeTruthy();
  });
});

describe('colar o CSV', () => {
  test('manda o texto CRU, sem interpretar nada, e sem confirmar remoção', () => {
    // A tela não conta vírgula nem procura cabeçalho: quem lê o CSV é o
    // servidor, porque a regra vale também para o `producao_cli`.
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao51() });

    return colar().then(() => {
      expect(importarRepositorios51).toHaveBeenCalledTimes(1);
      expect(importarRepositorios51).toHaveBeenCalledWith(7, CSV, false);
    });
  });

  test('texto vazio nem chega ao servidor', async () => {
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao51() });

    await colar('   \n  ');

    expect(importarRepositorios51).not.toHaveBeenCalled();
    expect(showError).toHaveBeenCalled();
  });

  test('no sucesso, relata o que mudou e recarrega a tela', async () => {
    const onSaved = vi.fn();
    importarRepositorios51.mockResolvedValue({
      ...RESPOSTA_OK, total: 3, novos: ['a'], resumos_preservados: 2,
      removidos: [{ repositorio: 'aholo', tinha_resumo: false }],
    });
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao51(), onSaved });

    await colar();

    const dito = showSuccess.mock.calls[0][0];
    expect(dito).toContain('3 repositório(s)');
    expect(dito).toContain('2 resumo(s) preservado(s)');
    expect(dito).toContain('1 removido(s)');
    expect(onSaved).toHaveBeenCalledTimes(1);
  });

  test('o aviso do servidor APARECE, e não morre no corpo da resposta', async () => {
    // O aviso diz o que o importador remendou (vírgula sobrando, efetivo
    // vazio). Um remendo que ninguém vê é um remendo aceito calado.
    importarRepositorios51.mockResolvedValue({
      ...RESPOSTA_OK,
      avisos: ['Linha 2: havia 1 vírgula(s) a mais'],
    });
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao51() });

    await colar();

    expect(showWarning).toHaveBeenCalledWith('Linha 2: havia 1 vírgula(s) a mais');
  });

  test('erro comum do servidor vira toast, e não pergunta nada', async () => {
    importarRepositorios51.mockRejectedValue(
      erroComStatus('O CSV tem só o cabeçalho', 400),
    );
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao51() });

    await colar();

    expect(showError).toHaveBeenCalledWith('O CSV tem só o cabeçalho');
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(importarRepositorios51).toHaveBeenCalledTimes(1);
  });
});

describe('o 409: a importação apagaria Resumo já escrito', () => {
  const RECUSA = erroComStatus(
    'Este CSV não traz 1 repositório(s) que já têm Resumo escrito na 5.1: aholo.',
    409,
  );

  test('confirmada, a SEGUNDA chamada leva confirmar_remocao', async () => {
    importarRepositorios51
      .mockRejectedValueOnce(RECUSA)
      .mockResolvedValueOnce(RESPOSTA_OK);
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao51() });

    await colar();

    expect(importarRepositorios51).toHaveBeenCalledTimes(2);
    expect(importarRepositorios51).toHaveBeenNthCalledWith(1, 7, CSV, false);
    expect(importarRepositorios51).toHaveBeenNthCalledWith(2, 7, CSV, true);
    // A pergunta mostra a lista do SERVIDOR, que nomeia os repositórios.
    expect(confirmDialog.mock.calls[0][0].message).toContain('aholo');
    expect(confirmDialog.mock.calls[0][0].danger).toBe(true);
  });

  test('RECUSADA, nada é gravado', async () => {
    // O caso que faz a confirmação valer. Sem ele, um `confirmDialog` ignorado
    // passaria no caso acima.
    importarRepositorios51.mockRejectedValueOnce(RECUSA);
    confirmDialog.mockResolvedValue(false);
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao51() });

    await colar();

    expect(importarRepositorios51).toHaveBeenCalledTimes(1);
    expect(showSuccess).not.toHaveBeenCalled();
  });
});

// ---------------------------------------------------------------------------
// O EDITOR DA PROSA (9.1 a 9.3), e o defeito que apagava o que já estava lá.
// ---------------------------------------------------------------------------

const subsecao91 = (texto) => ({
  numero: '9.1', titulo: 'Boas práticas', texto,
});

/** O bloco de uma tabela qualquer, com três colunas e o que vier de linha. */
const subsecaoTabela = (linhas = []) => ({
  numero: '8.1',
  titulo: 'Manutenção',
  cabecalhos: ['Equipamento', 'Situação', 'Providência'],
  linhas,
});

/** Um `paste` com `clipboardData`, que o jsdom não monta sozinho. */
function colarNaCelula(input, texto) {
  const evento = new Event('paste', { bubbles: true, cancelable: true });
  evento.clipboardData = { getData: () => texto };
  input.dispatchEvent(evento);
  return evento;
}

const celulas = () => Array.from(document.querySelectorAll('.rpcm-grade__input'));
const linhasNaTela = () => document.querySelectorAll('.rpcm-grade tbody tr');

describe('a prosa da seção 9 abre COM o texto já gravado', () => {
  test('o campo mostra o texto, e não abre em branco', () => {
    // O DEFEITO: `el()` gravava `value` como ATRIBUTO, e num `<textarea>` o
    // conteúdo é filho de texto. A caixa abria vazia por cima do texto escrito,
    // e salvar apagava a subseção do relatório que o chefe assina.
    abrirEditorSubsecao({
      edicaoId: 7,
      subsecao: subsecao91('A Divisão adotou revisão cruzada das cartas.'),
    });

    const area = document.querySelector('.form-field__textarea');
    expect(area.value).toBe('A Divisão adotou revisão cruzada das cartas.');
  });

  test('salvar sem tocar no campo devolve o MESMO texto ao servidor', () => {
    // A consequência do defeito, medida no que sai pela rede: enquanto o campo
    // abria vazio, este salvamento mandava `texto: null`.
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao91('Texto de junho') });

    botaoPorTexto('Salvar').click();

    expect(gravarSubsecao).toHaveBeenCalledWith(7, '9.1', {
      linhas: [], texto: 'Texto de junho', sem_ocorrencia: false,
    });
  });

  test('subseção de prosa ainda vazia continua abrindo vazia', () => {
    // VARIÂNCIA: sem este caso, um campo que sempre trouxesse texto passaria
    // nos dois casos acima.
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao91(null) });

    expect(document.querySelector('.form-field__textarea').value).toBe('');
  });
});

describe('fechar sem salvar não descarta calado', () => {
  test('a prosa MEXIDA pergunta antes de fechar, e recusada não fecha', async () => {
    confirmDialog.mockResolvedValue(false);
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao91('Texto de junho') });

    document.querySelector('.form-field__textarea').value = 'Texto reescrito';
    botaoPorTexto('Cancelar').click();
    await assentar();

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(confirmDialog.mock.calls[0][0].title).toContain('sem salvar');
    // O diálogo continua de pé, com o que foi digitado.
    expect(document.querySelector('.form-field__textarea').value)
      .toBe('Texto reescrito');
  });

  test('confirmada, fecha e o texto vai embora', async () => {
    confirmDialog.mockResolvedValue(true);
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao91('Texto de junho') });

    document.querySelector('.form-field__textarea').value = 'Texto reescrito';
    botaoPorTexto('Cancelar').click();
    await assentar();

    expect(document.querySelector('.form-field__textarea')).toBeNull();
    expect(gravarSubsecao).not.toHaveBeenCalled();
  });

  test('a tela INTOCADA fecha direto, sem pergunta nenhuma', async () => {
    // VARIÂNCIA: uma guarda que perguntasse sempre passaria nos casos acima e
    // atrapalharia as 18 subseções do mês.
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecao91('Texto de junho') });

    botaoPorTexto('Cancelar').click();
    await assentar();

    expect(confirmDialog).not.toHaveBeenCalled();
    expect(document.querySelector('.form-field__textarea')).toBeNull();
  });

  test('a GRADE mexida também pergunta, e o Escape passa pela mesma guarda', async () => {
    confirmDialog.mockResolvedValue(false);
    abrirEditorSubsecao({
      edicaoId: 7, subsecao: subsecaoTabela([['Plotter', 'Parada', '']]),
    });

    celulas()[2].value = 'Chamado aberto';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape' }));
    await assentar();

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(linhasNaTela()).toHaveLength(1);
  });

  test('salvar e fechar NÃO pergunta, porque não há o que perder', async () => {
    abrirEditorSubsecao({
      edicaoId: 7, subsecao: subsecaoTabela([['Plotter', 'Parada', '']]),
    });

    celulas()[2].value = 'Chamado aberto';
    botaoPorTexto('Salvar').click();
    await assentar();

    expect(gravarSubsecao).toHaveBeenCalledTimes(1);
    expect(confirmDialog).not.toHaveBeenCalled();
    expect(document.querySelector('.rpcm-grade')).toBeNull();
  });
});

describe('a grade: teclado, linha e colagem', () => {
  const teclar = (input, key) => input.dispatchEvent(
    new KeyboardEvent('keydown', { key, bubbles: true, cancelable: true }),
  );

  test('Enter desce uma linha na MESMA coluna', () => {
    abrirEditorSubsecao({
      edicaoId: 7,
      subsecao: subsecaoTabela([['a', 'b', 'c'], ['d', 'e', 'f']]),
    });

    const campos = celulas();
    campos[1].focus();
    teclar(campos[1], 'Enter');

    // Coluna 1 (Situação) da segunda linha.
    expect(document.activeElement).toBe(campos[4]);
  });

  test('Enter na ÚLTIMA linha cria a próxima e vai para o começo dela', () => {
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecaoTabela([['a', 'b', 'c']]) });

    teclar(celulas()[2], 'Enter');

    expect(linhasNaTela()).toHaveLength(2);
    expect(document.activeElement).toBe(celulas()[3]);
  });

  test('as setas andam entre as linhas, e param nas pontas', () => {
    abrirEditorSubsecao({
      edicaoId: 7,
      subsecao: subsecaoTabela([['a', 'b', 'c'], ['d', 'e', 'f']]),
    });

    const campos = celulas();
    campos[0].focus();
    teclar(campos[0], 'ArrowUp');
    expect(document.activeElement).toBe(campos[0]);

    teclar(campos[0], 'ArrowDown');
    expect(document.activeElement).toBe(campos[3]);

    teclar(campos[3], 'ArrowUp');
    expect(document.activeElement).toBe(campos[0]);
    // A seta NÃO cria linha: só o Enter no fim faz isso.
    expect(linhasNaTela()).toHaveLength(2);
  });

  test('remover linha PREENCHIDA pergunta, e recusada a linha fica', async () => {
    confirmDialog.mockResolvedValue(false);
    abrirEditorSubsecao({
      edicaoId: 7, subsecao: subsecaoTabela([['Plotter', 'Parada', 'Chamado']]),
    });

    document.querySelector('.rpcm-grade__acao .btn').click();
    await assentar();

    expect(confirmDialog.mock.calls[0][0].message).toContain('Plotter');
    expect(linhasNaTela()).toHaveLength(1);
  });

  test('remover linha VAZIA sai calado, e o foco não cai no vazio', async () => {
    // VARIÂNCIA: sem este caso, perguntar em toda remoção passaria no caso
    // acima e cobraria confirmação da linha que a pessoa acabou de criar.
    abrirEditorSubsecao({
      edicaoId: 7, subsecao: subsecaoTabela([['Plotter', 'Parada', 'x'], ['', '', '']]),
    });

    document.querySelectorAll('.rpcm-grade__acao .btn')[1].click();
    await assentar();

    expect(confirmDialog).not.toHaveBeenCalled();
    expect(linhasNaTela()).toHaveLength(1);
    // O foco foi para a linha vizinha, e não para o corpo da página.
    expect(document.activeElement).toBe(celulas()[0]);
  });

  test('colar da planilha preenche a matriz e CRIA as linhas que faltam', async () => {
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecaoTabela([['', '', '']]) });

    colarNaCelula(
      celulas()[0],
      'Plotter\tParada\tChamado\nScanner\tOK\t-\nGPS\tEm uso\t-',
    );
    await assentar();

    expect(linhasNaTela()).toHaveLength(3);
    expect(celulas().map((c) => c.value)).toEqual([
      'Plotter', 'Parada', 'Chamado',
      'Scanner', 'OK', '-',
      'GPS', 'Em uso', '-',
    ]);
    expect(showSuccess).toHaveBeenCalled();
  });

  test('colar avisa a coluna que a tabela não tem, e não a inventa', async () => {
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecaoTabela([['', '', '']]) });

    colarNaCelula(celulas()[0], 'Plotter\tParada\tChamado\tSobra');
    await assentar();

    expect(celulas()).toHaveLength(3);
    expect(showWarning.mock.calls[0][0]).toContain('1 coluna(s)');
  });

  test('colar POR CIMA de célula preenchida pergunta, e recusado nada muda', async () => {
    confirmDialog.mockResolvedValue(false);
    abrirEditorSubsecao({
      edicaoId: 7, subsecao: subsecaoTabela([['Plotter', 'Parada', 'Chamado']]),
    });

    colarNaCelula(celulas()[0], 'Scanner\tOK\t-');
    await assentar();

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(celulas().map((c) => c.value)).toEqual(['Plotter', 'Parada', 'Chamado']);
  });

  test('texto de uma célula só continua sendo colagem normal do navegador', async () => {
    // VARIÂNCIA: sem este caso, tratar TODO paste como planilha passaria nos
    // casos acima e quebraria colar um nome dentro de um campo.
    abrirEditorSubsecao({ edicaoId: 7, subsecao: subsecaoTabela([['', '', '']]) });

    const evento = colarNaCelula(celulas()[0], 'Plotter HP T2600');
    await assentar();

    expect(evento.defaultPrevented).toBe(false);
    expect(linhasNaTela()).toHaveLength(1);
  });
});

describe('o que está na tela sem salvar', () => {
  test('a grade intocada NÃO faz pergunta nenhuma', async () => {
    abrirEditorSubsecao({
      edicaoId: 7,
      subsecao: subsecao51([['controle_acervo', '10', 'Cap Fulano', 'já escrito']]),
    });

    await colar();

    expect(confirmDialog).not.toHaveBeenCalled();
    expect(importarRepositorios51).toHaveBeenCalledTimes(1);
  });

  test('a grade MEXIDA avisa antes, porque o servidor lê o que está GRAVADO', async () => {
    abrirEditorSubsecao({
      edicaoId: 7,
      subsecao: subsecao51([['controle_acervo', '10', 'Cap Fulano', '']]),
    });

    // O Resumo digitado agora, ainda não salvo, não existe para o servidor.
    const inputs = document.querySelectorAll('.rpcm-grade__input');
    inputs[3].value = 'resumo que ainda não foi salvo';

    await colar();

    expect(confirmDialog).toHaveBeenCalledTimes(1);
    expect(confirmDialog.mock.calls[0][0].title).toContain('por cima');
  });

  test('recusado o aviso, o CSV não sai da tela', async () => {
    confirmDialog.mockResolvedValue(false);
    abrirEditorSubsecao({
      edicaoId: 7,
      subsecao: subsecao51([['controle_acervo', '10', 'Cap Fulano', '']]),
    });
    document.querySelectorAll('.rpcm-grade__input')[3].value = 'não salvo';

    await colar();

    expect(importarRepositorios51).not.toHaveBeenCalled();
  });
});
