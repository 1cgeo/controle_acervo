import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O formulário de versão espelha o gatilho `acervo.validate_version` ANTES de
// enviar. Estes testes guardam o espelho: sem ele a Carta Topográfica Militar
// passa o formulário inteiro e só quebra no fim, com 500 genérico.
vi.mock('@modules/acervo/services/acervo-service.js', () => ({
  getTiposVersao: vi.fn(),
  getSubtiposProduto: vi.fn(),
  getLotes: vi.fn(() => Promise.resolve([])),
  getProjetos: vi.fn(() => Promise.resolve([])),
  criarVersoesPlanejadas: vi.fn(() => Promise.resolve()),
  criarVersoesHistoricas: vi.fn(() => Promise.resolve()),
  criarProdutoComVersaoPlanejada: vi.fn(() => Promise.resolve()),
  criarProdutoComVersaoHistorica: vi.fn(() => Promise.resolve()),
  atualizarVersao: vi.fn(() => Promise.resolve()),
}));

// O PIT e de PLATAFORMA, e a versao so aponta para a meta. Duble aqui porque o
// que se prova e o CORPO enviado, e nao a rota do plano anual.
vi.mock('@services/plataforma-service.js', () => ({
  getMetasPit: vi.fn(() => Promise.resolve([
    { id: 9, ano: 2026, numero_meta: 3, item: 2, descricao: 'Carta Topografica 25k' },
    { id: 10, ano: 2025, numero_meta: 1, item: null, descricao: 'Ortoimagem' },
  ])),
  getExtraPit: vi.fn(() => Promise.resolve([
    { id: 4, ano: 2026, descricao: 'Apoio a Operacao Agata' },
  ])),
}));

// O assistente de carregamento entra por dublê: ele é OUTRA tela, e o que este
// arquivo prova é que a Regular sai daqui para lá com o corpo pronto, e não o
// que acontece depois.
vi.mock('@modules/acervo/pages/produto/upload-wizard.js', () => ({
  abrirAssistenteUpload: vi.fn(),
}));

import {
  openVersaoDialog,
  conferirVersaoContraTrigger,
  TIPO_VERSAO_REGULAR,
  TIPO_VERSAO_HISTORICA,
  TIPO_VERSAO_PLANEJADA,
} from '@modules/acervo/pages/produto/versao-dialog.js';
import * as svc from '@modules/acervo/services/acervo-service.js';
import * as assistente from '@modules/acervo/pages/produto/upload-wizard.js';

// 24 = Carta Topográfica Militar, o único subtipo com `define_produto` hoje.
const SUBTIPOS = [
  { code: 2, nome: 'Carta Topográfica', tipo_id: 2, define_produto: false },
  { code: 12, nome: 'Carta Topográfica ET-RDG', tipo_id: 2, define_produto: false },
  { code: 24, nome: 'Carta Topográfica Militar', tipo_id: 2, define_produto: true },
  // De OUTRO tipo de produto (5 = Modelo Digital de Superfície). Existe no
  // fixture para a filtragem por tipo ter o que esconder.
  { code: 5, nome: 'Modelo Digital de Superfície', tipo_id: 5, define_produto: false },
];

const TIPOS = [
  { code: 1, nome: 'Regular' },
  { code: 2, nome: 'Registro histórico' },
  { code: 3, nome: 'Planejada' },
];

const base = (over = {}) => ({
  rotulo: '1-DSG',
  tipoVersaoId: TIPO_VERSAO_PLANEJADA,
  subtipoVersaoId: 2,
  produtoSubtipoId: null,
  subtipos: SUBTIPOS,
  rotulosExistentes: [],
  dataCriacao: '2026-07-30',
  dataEdicao: '2026-07-30',
  ...over,
});

describe('conferirVersaoContraTrigger: formato do rótulo', () => {
  test('aceita os dois formatos que o gatilho aceita', () => {
    expect(conferirVersaoContraTrigger(base({ rotulo: '1-DSG' }))).toBeNull();
    expect(conferirVersaoContraTrigger(base({ rotulo: '12ª Edição' }))).toBeNull();
    expect(conferirVersaoContraTrigger(base({ rotulo: '3-CGEO' }))).toBeNull();
  });

  // O "ª" e a cedilha fazem parte da expressão do gatilho. "1a Edicao" é o erro
  // de digitação que passaria por qualquer conferência frouxa e quebraria no banco.
  test('recusa o rótulo quase certo, e aponta o campo do rótulo', () => {
    const falha = conferirVersaoContraTrigger(base({ rotulo: '1a Edicao' }));
    expect(falha).not.toBeNull();
    expect(falha.campo).toBe('versao');
    expect(falha.mensagem).toContain('Formato inválido');
  });

  test('recusa sigla com mais de cinco letras e sigla minúscula', () => {
    expect(conferirVersaoContraTrigger(base({ rotulo: '1-CARTOGRAFIA' })).campo).toBe('versao');
    expect(conferirVersaoContraTrigger(base({ rotulo: '1-dsg' })).campo).toBe('versao');
  });

  // O gatilho só valida o formato quando o rótulo MUDA (TG_OP = 'UPDATE' AND
  // NEW.versao IS NOT DISTINCT FROM OLD.versao). Há versão legada gravada antes
  // dele, e travar a edição dela aqui recusaria o que o servidor aceita.
  test('não cobra o formato de quem edita sem mexer no rótulo', () => {
    expect(conferirVersaoContraTrigger(base({
      rotulo: 'Edição especial 1975',
      rotuloMudou: false,
    }))).toBeNull();
  });
});

describe('conferirVersaoContraTrigger: sequência N-SIGLA', () => {
  test('a Regular com N maior que 1 exige a anterior no mesmo produto', () => {
    const falha = conferirVersaoContraTrigger(base({
      rotulo: '2-DSG',
      tipoVersaoId: TIPO_VERSAO_REGULAR,
      rotulosExistentes: ['1ª Edição'],
    }));
    expect(falha.campo).toBe('versao');
    expect(falha.mensagem).toContain('1-DSG');
  });

  test('com a anterior gravada, a Regular passa', () => {
    expect(conferirVersaoContraTrigger(base({
      rotulo: '2-DSG',
      tipoVersaoId: TIPO_VERSAO_REGULAR,
      rotulosExistentes: ['1-DSG'],
    }))).toBeNull();
  });

  test('a sequência é por SIGLA: 1-DSG não abre caminho para 2-CGEO', () => {
    const falha = conferirVersaoContraTrigger(base({
      rotulo: '2-CGEO',
      tipoVersaoId: TIPO_VERSAO_REGULAR,
      rotulosExistentes: ['1-DSG'],
    }));
    expect(falha.mensagem).toContain('1-CGEO');
  });

  // Planejada é promessa de produção: a folha ainda não existe, e não tem edição
  // anterior nenhuma. O gatilho retorna antes da checagem para todo tipo que não
  // é Regular, e o espelho tem de fazer o mesmo.
  test('a Planejada NÃO exige a edição anterior', () => {
    expect(conferirVersaoContraTrigger(base({
      rotulo: '3-DSG',
      tipoVersaoId: TIPO_VERSAO_PLANEJADA,
      rotulosExistentes: [],
    }))).toBeNull();
  });

  test('a versão 1 nunca exige anterior', () => {
    expect(conferirVersaoContraTrigger(base({
      rotulo: '1-DSG',
      tipoVersaoId: TIPO_VERSAO_REGULAR,
      rotulosExistentes: [],
    }))).toBeNull();
  });

  // "Xª Edição" é acervo legado e a carga é parcial por natureza: o gatilho não
  // pede a edição anterior nem para a Regular.
  test('"Xª Edição" não entra na conta da sequência', () => {
    expect(conferirVersaoContraTrigger(base({
      rotulo: '7ª Edição',
      tipoVersaoId: TIPO_VERSAO_REGULAR,
      rotulosExistentes: [],
    }))).toBeNull();
  });
});

describe('conferirVersaoContraTrigger: identidade produto/subtipo', () => {
  test('recusa versão de subtipo diferente do produto, e aponta o subtipo', () => {
    const falha = conferirVersaoContraTrigger(base({
      subtipoVersaoId: 12,
      produtoSubtipoId: 2,
    }));
    expect(falha.campo).toBe('subtipo_produto_id');
    expect(falha.mensagem).toContain('Carta Topográfica ET-RDG');
    expect(falha.mensagem).toContain('Carta Topográfica');
  });

  // É o caso que custa caro: a Carta Militar num produto comum passa o
  // formulário inteiro e quebra no INSERT, depois do trabalho todo.
  test('o subtipo com define_produto exige produto próprio', () => {
    const falha = conferirVersaoContraTrigger(base({
      subtipoVersaoId: 24,
      produtoSubtipoId: null,
    }));
    expect(falha.campo).toBe('subtipo_produto_id');
    expect(falha.mensagem).toContain('PRODUTO PRÓPRIO');
  });

  test('a Carta Militar passa num produto do mesmo subtipo', () => {
    expect(conferirVersaoContraTrigger(base({
      subtipoVersaoId: 24,
      produtoSubtipoId: 24,
    }))).toBeNull();
  });

  // A coerência vem ANTES do formato no gatilho, e o espelho segue a mesma
  // ordem: a frase que a pessoa lê é a que o servidor diria primeiro.
  test('com subtipo errado E rótulo errado, quem fala é o subtipo', () => {
    const falha = conferirVersaoContraTrigger(base({
      rotulo: 'rotulo torto',
      subtipoVersaoId: 12,
      produtoSubtipoId: 2,
    }));
    expect(falha.campo).toBe('subtipo_produto_id');
  });

  // O subtipo continua sendo cobrado mesmo quando o rótulo não mudou: no
  // gatilho essa checagem está ANTES do early-return do UPDATE, de propósito
  // (ela vale inclusive quando só o produto_id muda).
  test('a coerência de subtipo vale mesmo sem mexer no rótulo', () => {
    const falha = conferirVersaoContraTrigger(base({
      subtipoVersaoId: 12,
      produtoSubtipoId: 2,
      rotuloMudou: false,
    }));
    expect(falha.campo).toBe('subtipo_produto_id');
  });
});

describe('conferirVersaoContraTrigger: datas', () => {
  test('recusa edição anterior à criação', () => {
    const falha = conferirVersaoContraTrigger(base({
      dataCriacao: '2026-07-30',
      dataEdicao: '2026-07-29',
    }));
    expect(falha.campo).toBe('data_edicao');
  });

  test('aceita edição no mesmo dia da criação', () => {
    expect(conferirVersaoContraTrigger(base({
      dataCriacao: '2026-07-30',
      dataEdicao: '2026-07-30',
    }))).toBeNull();
  });
});

// ---------------------------------------------------------------------------
// O formulário
// ---------------------------------------------------------------------------

const campoPorRotulo = (rotulo) => [...document.querySelectorAll('.form-field')]
  .find(c => (c.querySelector('.form-field__label')?.textContent || '').startsWith(rotulo));

const inputDe = (rotulo) => campoPorRotulo(rotulo).querySelector('input, select, textarea');

const erroDe = (rotulo) => {
  const erro = campoPorRotulo(rotulo).querySelector('.form-field__error');
  return erro.classList.contains('hidden') ? '' : erro.textContent;
};

const clicar = (rotulo) => {
  const botao = [...document.querySelectorAll('.modal__footer .btn')]
    .find(b => b.textContent === rotulo);
  botao.click();
};

const preencher = (rotulo, valor) => {
  const campo = inputDe(rotulo);
  campo.value = valor;
  campo.dispatchEvent(new Event('change'));
};

const PRODUTO = { id: 7, nome: 'Arapongas-NE', subtipo_produto_id: null };

beforeEach(() => {
  svc.getTiposVersao.mockResolvedValue(TIPOS);
  svc.getSubtiposProduto.mockResolvedValue(SUBTIPOS);
  svc.getLotes.mockResolvedValue([]);
  svc.getProjetos.mockResolvedValue([]);
});

afterEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
});

describe('openVersaoDialog: tipos oferecidos', () => {
  test('a criação oferece os TRES tipos', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    const opcoes = [...inputDe('Tipo de versão').options]
      .map(o => o.value)
      .filter(v => v !== '');

    expect(opcoes).toEqual([
      String(TIPO_VERSAO_REGULAR),
      String(TIPO_VERSAO_PLANEJADA),
      String(TIPO_VERSAO_HISTORICA),
    ]);
  });

  // Os tres nascem do MESMO formulario e so o caminho da gravacao muda, entao a
  // frase e o unico lugar em que a diferenca aparece antes do clique.
  test('cada tipo explica o que ele significa', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    preencher('Tipo de versão', String(TIPO_VERSAO_REGULAR));
    expect(document.body.textContent).toContain('nasce COM o arquivo');

    preencher('Tipo de versão', String(TIPO_VERSAO_PLANEJADA));
    expect(document.body.textContent).toContain('ainda vai ser produzida');

    preencher('Tipo de versão', String(TIPO_VERSAO_HISTORICA));
    expect(document.body.textContent).toContain('existe no mundo');
    // E diz o que a escolha custa no relatorio, que e o que a lista sozinha nao diz.
    expect(document.body.textContent).toContain('não a conta como produto entregue');
  });

  // Editar uma histórica que já existe continua funcionando: o PUT não
  // discrimina tipo. Sem a opção na lista, o campo abriria vazio e salvar
  // converteria a versão em silêncio.
  test('a edição de uma histórica mantém o tipo gravado na lista', async () => {
    await openVersaoDialog({
      produto: PRODUTO,
      versao: {
        versao_id: 91,
        versao: '1ª Edição',
        tipo_versao_id: TIPO_VERSAO_HISTORICA,
        subtipo_produto_id: 2,
        orgao_produtor: '1º CGEO',
        versao_data_criacao: '1975-01-01',
        versao_data_edicao: '1975-01-01',
      },
    });
    await flush();

    const select = inputDe('Tipo de versão');
    expect([...select.options].map(o => o.value)).toContain(String(TIPO_VERSAO_HISTORICA));
    expect(select.value).toBe(String(TIPO_VERSAO_HISTORICA));
  });
});

describe('openVersaoDialog: Regular vai para o carregamento, e nao grava aqui', () => {
  test('o botao muda de nome, porque "Salvar" mentiria', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    preencher('Tipo de versão', String(TIPO_VERSAO_PLANEJADA));
    expect(document.body.textContent).toContain('Salvar');

    // A Regular ainda nao entra no acervo neste clique: falta o arquivo. O
    // rotulo tem de dizer para onde o clique leva, senao a pessoa acredita ter
    // terminado e fecha o assistente que abre em seguida.
    preencher('Tipo de versão', String(TIPO_VERSAO_REGULAR));
    expect(document.body.textContent).toContain('Continuar para os arquivos');
  });

  test('a Regular valida abre o assistente e NAO chama rota de gravacao', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    preencher('Tipo de versão', String(TIPO_VERSAO_REGULAR));
    preencher('Rótulo da versão', '1-DSG');
    preencher('Subtipo de produto', '2');
    preencher('Órgão produtor', '1º CGEO');
    preencher('Data de criação', '2026-07-30');
    preencher('Data de edição', '2026-07-30');
    clicar('Continuar para os arquivos');
    await flush();

    // Nenhuma rota de versao e chamada: quem grava e o confirm-upload, depois
    // que os bytes subirem. Gravar aqui deixaria uma Regular orfa, sem arquivo,
    // que ninguem consegue completar pela interface.
    expect(svc.criarVersoesPlanejadas).not.toHaveBeenCalled();
    expect(svc.atualizarVersao).not.toHaveBeenCalled();
    expect(assistente.abrirAssistenteUpload).toHaveBeenCalledTimes(1);

    const argumento = assistente.abrirAssistenteUpload.mock.calls[0][0];
    expect(argumento.produtoId).toBe(Number(PRODUTO.id));
    expect(argumento.versao.versao).toBe('1-DSG');
    expect(argumento.versao.tipo_versao_id).toBe(TIPO_VERSAO_REGULAR);
    // O corpo vai PRONTO: o assistente nao repete o formulario, e portanto nao
    // repete o espelho do gatilho.
    expect(argumento.versao.orgao_produtor).toBe('1º CGEO');
    expect(argumento.versao.data_edicao).toBe('2026-07-30');
  });

  test('a Regular INVALIDA nao chega ao assistente', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    preencher('Tipo de versão', String(TIPO_VERSAO_REGULAR));
    preencher('Rótulo da versão', '3-DSG'); // sem a 2-DSG cadastrada
    preencher('Subtipo de produto', '2');
    preencher('Órgão produtor', '1º CGEO');
    preencher('Data de criação', '2026-07-30');
    preencher('Data de edição', '2026-07-30');
    clicar('Continuar para os arquivos');
    await flush();

    expect(assistente.abrirAssistenteUpload).not.toHaveBeenCalled();
    expect(erroDe('Rótulo da versão')).toContain('2-DSG');
  });
});

describe('openVersaoDialog: o espelho do gatilho barra antes de enviar', () => {
  const preencherValido = () => {
    preencher('Rótulo da versão', '1-DSG');
    preencher('Tipo de versão', String(TIPO_VERSAO_PLANEJADA));
    preencher('Subtipo de produto', '2');
    preencher('Órgão produtor', '1º CGEO');
    preencher('Data de criação', '2026-07-30');
    preencher('Data de edição', '2026-07-30');
  };

  test('a versão planejada válida vai para a rota própria, em array', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    preencherValido();
    clicar('Salvar');
    await flush();

    expect(svc.criarVersoesPlanejadas).toHaveBeenCalledTimes(1);
    const [enviado] = svc.criarVersoesPlanejadas.mock.calls[0];
    expect(Array.isArray(enviado)).toBe(true);
    expect(enviado[0]).toMatchObject({
      produto_id: 7,
      versao: '1-DSG',
      subtipo_produto_id: 2,
      uuid_versao: null,
    });
    // O tipo NÃO viaja no corpo: quem o decide é a rota, e o schema descartaria
    // a chave em silêncio, deixando quem enviou achando que gravou.
    expect(enviado[0]).not.toHaveProperty('tipo_versao_id');
  });

  test('subtipo divergente do produto para o envio e marca o campo', async () => {
    await openVersaoDialog({ produto: { ...PRODUTO, subtipo_produto_id: 2 } });
    await flush();

    preencherValido();
    preencher('Subtipo de produto', '12');
    clicar('Salvar');
    await flush();

    expect(svc.criarVersoesPlanejadas).not.toHaveBeenCalled();
    expect(erroDe('Subtipo de produto')).toContain('têm que ser o mesmo');
  });

  test('Carta Militar em produto comum para o envio', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    preencherValido();
    preencher('Subtipo de produto', '24');
    clicar('Salvar');
    await flush();

    expect(svc.criarVersoesPlanejadas).not.toHaveBeenCalled();
    expect(erroDe('Subtipo de produto')).toContain('PRODUTO PRÓPRIO');
  });

  test('rótulo fora dos dois formatos para o envio', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    preencherValido();
    preencher('Rótulo da versão', '1a Edicao');
    clicar('Salvar');
    await flush();

    expect(svc.criarVersoesPlanejadas).not.toHaveBeenCalled();
    expect(erroDe('Rótulo da versão')).toContain('Formato inválido');
  });

  test('edição anterior à criação para o envio', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    preencherValido();
    preencher('Data de edição', '2026-07-01');
    clicar('Salvar');
    await flush();

    expect(svc.criarVersoesPlanejadas).not.toHaveBeenCalled();
    expect(erroDe('Data de edição')).toContain('anterior à data de criação');
  });

  // A sequência olha as versões que a ficha já carregou, e não uma consulta
  // nova: elas estão na mão de quem abriu a ficha.
  test('Regular N-SIGLA sem a anterior nem chega a ser tentada', async () => {
    await openVersaoDialog({
      produto: PRODUTO,
      versao: {
        versao_id: 90,
        versao: '1-DSG',
        tipo_versao_id: TIPO_VERSAO_REGULAR,
        subtipo_produto_id: 2,
        orgao_produtor: '1º CGEO',
        versao_data_criacao: '2026-07-30',
        versao_data_edicao: '2026-07-30',
      },
      versoesExistentes: [{ versao_id: 90, versao: '1-DSG' }],
    });
    await flush();

    // Renomear a própria 1-DSG para 3-DSG: a 2-DSG não existe.
    preencher('Rótulo da versão', '3-DSG');
    clicar('Salvar');
    await flush();

    expect(svc.atualizarVersao).not.toHaveBeenCalled();
    expect(erroDe('Rótulo da versão')).toContain('2-DSG');
  });
});

describe('subtipo da versao: so os do tipo do produto', () => {
  // Nada no banco impede gravar um subtipo de outro tipo: a coluna so referencia
  // `dominio.subtipo_produto`. Quem persegue isso hoje e o invariante `3h` do
  // servidor, DEPOIS do fato. Filtrar aqui fecha na origem.
  test('esconde o subtipo que nao pertence ao tipo do produto', async () => {
    await openVersaoDialog({
      produto: { id: 7, nome: 'Arapongas-NE', subtipo_produto_id: null, tipo_produto_id: 2 },
    });
    await flush();

    const rotulos = [...inputDe('Subtipo de produto').options].map(o => o.textContent);
    expect(rotulos).toContain('Carta Topográfica');
    expect(rotulos).toContain('Carta Topográfica Militar');
    expect(rotulos).not.toContain('Modelo Digital de Superfície');
  });

  test('o subtipo JA GRAVADO aparece mesmo sendo de outro tipo', async () => {
    // O `3h` e REVISAR, e nao DEFECT: ha combinacao legada tolerada. Esconder o
    // valor gravado deixaria o campo vazio, e salvar trocaria o subtipo calado.
    await openVersaoDialog({
      produto: { id: 7, nome: 'Arapongas-NE', subtipo_produto_id: null, tipo_produto_id: 2 },
      versao: {
        versao_id: 3,
        versao: '1ª Edição',
        tipo_versao_id: TIPO_VERSAO_PLANEJADA,
        subtipo_produto_id: 5,
        orgao_produtor: '1º CGEO',
        versao_data_criacao: '2020-01-01',
        versao_data_edicao: '2020-01-01',
      },
    });
    await flush();

    const select = inputDe('Subtipo de produto');
    expect([...select.options].map(o => o.textContent)).toContain('Modelo Digital de Superfície');
    expect(select.value).toBe('5');
  });

  test('produto sem tipo conhecido continua oferecendo todos', async () => {
    // A ficha nem sempre traz `tipo_produto_id`; sem ele, filtrar esconderia
    // tudo e o campo, que e NOT NULL, ficaria impossivel de preencher.
    await openVersaoDialog({ produto: { id: 7, nome: 'Sem tipo' } });
    await flush();

    const rotulos = [...inputDe('Subtipo de produto').options].map(o => o.textContent);
    expect(rotulos).toContain('Modelo Digital de Superfície');
  });
});

describe('openVersaoDialog: a historica grava na rota dela', () => {
  const preencherHistorica = () => {
    preencher('Tipo de versão', String(TIPO_VERSAO_HISTORICA));
    preencher('Rótulo da versão', '1ª Edição');
    preencher('Subtipo de produto', '2');
    preencher('Órgão produtor', '1º CGEO');
    preencher('Data de criação', '1975-01-01');
    preencher('Data de edição', '1975-06-01');
  };

  test('vai para /versao_historica, e nao para a planejada', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();
    preencherHistorica();
    clicar('Salvar');
    await flush();

    expect(svc.criarVersoesHistoricas).toHaveBeenCalledTimes(1);
    expect(svc.criarVersoesPlanejadas).not.toHaveBeenCalled();

    // Corpo em ARRAY, e com o produto_id: e o contrato da rota.
    const [enviado] = svc.criarVersoesHistoricas.mock.calls[0][0];
    expect(enviado.produto_id).toBe(Number(PRODUTO.id));
    expect(enviado.versao).toBe('1ª Edição');
    expect(enviado.uuid_versao).toBeNull();
  });

  // A META DO PIT. Sem este campo, a unica forma de ligar uma versao ao plano
  // anual era o plugin do QGIS ou SQL na mao, e a grade do PIT conta por
  // `INNER JOIN pit.meta ON mm.id = v.meta_pit_id`: versao sem meta nao conta.
  // Versão pronta sem meta fica fora da conta do plano, e ninguém percebe.
  test('a meta do PIT escolhida vai no corpo', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();
    preencherHistorica();
    preencher('Meta do PIT', '9');
    clicar('Salvar');
    await flush();

    const [enviado] = svc.criarVersoesHistoricas.mock.calls[0][0];
    expect(enviado.meta_pit_id).toBe(9);
    expect(enviado.demanda_extra_id).toBeNull();
  });

  // O banco cobra a exclusividade (CHECK `versao_plano_ou_excecao`): a versao
  // cumpre uma meta prometida, ou materializa uma demanda que entrou fora do
  // plano. Marcar um limpa o outro AQUI, para o erro nao aparecer so no salvar.
  test('escolher Extra-PIT limpa a meta, e vice-versa', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();
    preencherHistorica();

    preencher('Meta do PIT', '9');
    preencher('Demanda Extra-PIT', '4');
    clicar('Salvar');
    await flush();

    const [enviado] = svc.criarVersoesHistoricas.mock.calls[0][0];
    expect(enviado.demanda_extra_id).toBe(4);
    expect(enviado.meta_pit_id).toBeNull();
  });

  // O rotulo traz o ANO, porque a grade so conta a versao quando o ano da meta
  // bate com o da data de edicao. Sem o ano a vista, escolher a meta do ano
  // errado nao conta e nao avisa.
  test('a lista de metas mostra o ano de cada uma', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    const rotulos = [...inputDe('Meta do PIT').options].map(o => o.textContent);
    expect(rotulos.some(r => r.includes('2026') && r.includes('Meta 3'))).toBe(true);
    expect(rotulos.some(r => r.includes('2025'))).toBe(true);
  });

  // As duas rotas FIXAM o tipo no servidor. Mandar `tipo_versao_id` no corpo
  // seria um campo que o servidor descarta, e descartado em silencio a tela
  // acreditaria ter gravado o que mandou.
  test('nao manda tipo_versao_id no corpo', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();
    preencherHistorica();
    clicar('Salvar');
    await flush();

    const [enviado] = svc.criarVersoesHistoricas.mock.calls[0][0];
    expect(enviado.tipo_versao_id).toBeUndefined();
  });

  test('o botao dela diz Salvar, porque ela grava mesmo', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    preencher('Tipo de versão', String(TIPO_VERSAO_HISTORICA));
    expect(document.body.textContent).toContain('Salvar');
    expect(document.body.textContent).not.toContain('Continuar para os arquivos');
  });

  // O espelho do gatilho nao cobra sequencia de historica: ela e carga parcial
  // por natureza, e a edicao anterior pode simplesmente nao existir no acervo.
  test('nao exige a versao anterior da serie', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    preencher('Tipo de versão', String(TIPO_VERSAO_HISTORICA));
    preencher('Rótulo da versão', '7-DSG');
    preencher('Subtipo de produto', '2');
    preencher('Órgão produtor', '1º CGEO');
    preencher('Data de criação', '1975-01-01');
    preencher('Data de edição', '1975-06-01');
    clicar('Salvar');
    await flush();

    expect(svc.criarVersoesHistoricas).toHaveBeenCalledTimes(1);
  });
});

describe('openVersaoDialog: produto e versao num passo so', () => {
  // O produto vem PENDENTE do formulario dele: nao foi gravado, para nao deixar
  // uma casca sem versao quando alguem desiste aqui -- e desiste, porque e aqui
  // que o gatilho cobra o rotulo e o subtipo.
  const PENDENTE = {
    nome: 'Folha Nova',
    mi: '2757-1-NE',
    inom: 'SF-22-Y-D-II-1-NE',
    tipo_escala_id: 1,
    denominador_escala_especial: null,
    tipo_produto_id: 2,
    subtipo_produto_id: null,
    descricao: '',
    geom: 'SRID=4674;POLYGON((-51 -23, -50 -23, -50 -22, -51 -22, -51 -23))',
  };

  const abrirPendente = async () => {
    await openVersaoDialog({
      produto: { ...PENDENTE, id: null },
      produtoPendente: PENDENTE,
      versoesExistentes: [],
    });
    await flush();
  };

  const preencher_ = (tipo) => {
    preencher('Tipo de versão', String(tipo));
    preencher('Rótulo da versão', '1-DSG');
    preencher('Subtipo de produto', '2');
    preencher('Órgão produtor', '1º CGEO');
    preencher('Data de criação', '2026-07-01');
    preencher('Data de edição', '2026-08-01');
  };

  test('planejada vai para a rota que cria os DOIS juntos', async () => {
    await abrirPendente();
    preencher_(TIPO_VERSAO_PLANEJADA);
    clicar('Salvar');
    await flush();

    expect(svc.criarProdutoComVersaoPlanejada).toHaveBeenCalledTimes(1);
    // A rota de versao avulsa NAO e chamada: ela exigiria um produto_id que
    // ainda nao existe.
    expect(svc.criarVersoesPlanejadas).not.toHaveBeenCalled();

    const [enviado] = svc.criarProdutoComVersaoPlanejada.mock.calls[0][0];
    // O corpo e o produto COM as versoes dentro, e nao os dois lado a lado.
    expect(enviado.mi).toBe('2757-1-NE');
    expect(enviado.geom).toContain('POLYGON');
    expect(enviado.versoes).toHaveLength(1);
    expect(enviado.versoes[0].versao).toBe('1-DSG');
    // Sem `produto_id`: ele nao existe.
    expect(enviado.versoes[0].produto_id).toBeUndefined();
  });

  test('historica tambem cria os dois juntos, na rota dela', async () => {
    await abrirPendente();
    preencher_(TIPO_VERSAO_HISTORICA);
    preencher('Rótulo da versão', '1ª Edição');
    clicar('Salvar');
    await flush();

    expect(svc.criarProdutoComVersaoHistorica).toHaveBeenCalledTimes(1);
    expect(svc.criarProdutoComVersaoPlanejada).not.toHaveBeenCalled();
  });

  test('regular leva o produto pendente ao assistente, no modo produto', async () => {
    await abrirPendente();
    preencher_(TIPO_VERSAO_REGULAR);
    clicar('Continuar para os arquivos');
    await flush();

    expect(assistente.abrirAssistenteUpload).toHaveBeenCalledTimes(1);
    const arg = assistente.abrirAssistenteUpload.mock.calls[0][0];
    expect(arg.modo).toBe('produto');
    expect(arg.produto.mi).toBe('2757-1-NE');
    // Nada e gravado aqui: quem grava e a rota do assistente, numa transacao so.
    expect(svc.criarProdutoComVersaoPlanejada).not.toHaveBeenCalled();
    expect(svc.criarVersoesPlanejadas).not.toHaveBeenCalled();
  });

  test('sem produto pendente, a regular segue no modo versao', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();
    preencher_(TIPO_VERSAO_REGULAR);
    clicar('Continuar para os arquivos');
    await flush();

    const arg = assistente.abrirAssistenteUpload.mock.calls[0][0];
    expect(arg.modo).toBe('versao');
    expect(arg.produtoId).toBe(Number(PRODUTO.id));
    expect(arg.produto).toBeUndefined();
  });
});

// AS DUAS DATAS PRECISAM DIZER O QUE SAO.
//
// `data_criacao` e `data_edicao` chegavam ao operador sem uma palavra, e
// confundi-las e o erro classico do acervo. A de EDICAO e a que o
// `pit_execucao_ctrl` usa para decidir o mes e o ano da producao: trocar uma
// pela outra move a carta de mes na grade do PIT, sem erro nenhum na tela.
// Seis outros campos deste mesmo formulario ja tinham helpText.
describe('ajuda nas datas', () => {
  const ajudaDe = (rotulo) =>
    campoPorRotulo(rotulo)?.querySelector('.form-field__help')?.textContent || '';

  test('a data de criacao diz que e a data do DADO', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    const ajuda = ajudaDe('Data de criação');
    expect(ajuda).not.toBe('');
    expect(ajuda).toContain('DADO');
  });

  // Esta e a que importa: e a consequencia, e nao a definicao, que impede a
  // troca. Quem le "decide o mes e o ano que contam no PIT" para para pensar.
  test('a data de edicao diz que ela decide o mes do PIT', async () => {
    await openVersaoDialog({ produto: PRODUTO });
    await flush();

    const ajuda = ajudaDe('Data de edição');
    expect(ajuda).not.toBe('');
    expect(ajuda).toContain('PIT');
  });
});
