import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@services/producao-service.js', () => ({
  verificarAtividade: vi.fn(),
  getTiposProblema: vi.fn(),
  iniciarAtividade: vi.fn(),
  finalizarAtividade: vi.fn(),
  reportarProblema: vi.fn(),
  reportarFinalizacaoIncorreta: vi.fn(),
}));

// A MONTAGEM DO DIALOGO PODE ESTOURAR, e o caso "a trava tem saida" precisa
// encenar isso. O `openModal` real continua sendo o de sempre; a bandeira faz
// UMA chamada falhar, como faria um campo montado a partir de um catalogo
// malformado.
const modalCtl = vi.hoisted(() => ({ estourarUmaVez: false }));

vi.mock('@components/modal/modal-base.js', async () => {
  const real = await vi.importActual('@components/modal/modal-base.js');
  return {
    ...real,
    openModal: (...args) => {
      if (modalCtl.estourarUmaVez) {
        modalCtl.estourarUmaVez = false;
        throw new Error('campo do dialogo malformado');
      }
      return real.openModal(...args);
    },
  };
});

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
  showInfo: vi.fn(),
  showWarning: vi.fn(),
  showToast: vi.fn(),
}));

import { renderAtividade } from './index.js';
import * as servico from '@services/producao-service.js';
import * as toast from '@utils/toast.js';

/** O pacote de `/verifica`, na forma que `dadosProducao` monta no servidor. */
const pacote = (extra = {}) => ({
  usuario_uuid: 'uuid-1',
  login: 'silva',
  usuario_nome: 'Silva',
  atividade: {
    id: 4712,
    epsg: '31982',
    projeto: 'Mapeamento Sistemático',
    lote: 'Lote 2023 A',
    bloco: 'Bloco 1',
    subtipo_produto: 'Carta Topográfica',
    dificuldade: 3,
    tempo_estimado_minutos: 480,
    observacao_atividade: 'Conferir a toponímia da folha',
    observacao_unidade_trabalho: null,
    geom: 'SRID=31982;POLYGON((0 0,1 0,1 1,0 1,0 0))',
    unidade_trabalho_id: 900,
    lote_id: 3,
    linha_producao_id: 1,
    fase_id: 2,
    tipo_fase_id: 1,
    subfase_id: 5,
    etapa_id: 9,
    tipo_etapa_id: 1,
    nome: 'Edição Vetorial - Execução - 900',
    dado_producao: { configuracao_producao: null, tipo_dado_producao_id: 1 },
    camadas: [],
    insumos: [{ id: 1, nome: 'Ortoimagem', caminho: '/dados/orto.tif', epsg: 31982 }],
    requisitos: [{ descricao: 'Rodar a validação geométrica' }],
    linhagem: [],
    atalhos: [],
    ...extra,
  },
});

const textoDoModal = () => document.querySelector('.modal') && document.querySelector('.modal').textContent;

const botaoDoModal = (rotulo) =>
  Array.from(document.querySelectorAll('.modal__footer .btn'))
    .find(b => b.textContent.trim() === rotulo);

const acaoDaFicha = (container, rotulo) =>
  Array.from(container.querySelectorAll('.producao-atividade__acoes .btn'))
    .find(b => b.textContent.includes(rotulo));

beforeEach(() => {
  servico.verificarAtividade.mockResolvedValue(null);
  servico.getTiposProblema.mockResolvedValue([
    { tipo_problema_id: 1, tipo_problema: 'Insumo insuficiente' },
    { tipo_problema_id: 99, tipo_problema: 'Outros' },
  ]);
  servico.iniciarAtividade.mockResolvedValue({ id: 1 });
  servico.finalizarAtividade.mockResolvedValue(undefined);
  servico.reportarProblema.mockResolvedValue(undefined);
  servico.reportarFinalizacaoIncorreta.mockResolvedValue(undefined);
});

afterEach(() => {
  modalCtl.estourarUmaVez = false;
  document.querySelectorAll('.modal-overlay').forEach(no => no.remove());
});

describe('renderAtividade sem atividade em execucao', () => {
  test('`null` e a resposta CERTA, e nao um erro na tela', async () => {
    // O servidor manda 200 com `dados` nulo para quem acabou de fechar a
    // anterior. Tratar isso como falha pediria "tentar de novo" a quem so
    // precisa de um botao de iniciar.
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container, { params: {}, query: new URLSearchParams() });

    expect(container.querySelector('.page__title').textContent).toBe('Minha atividade');
    expect(container.querySelector('.dashboard-erro')).toBeNull();
    expect(container.textContent).toContain('Você não tem atividade em execução');
    expect(container.querySelector('.producao-atividade__vazio .btn').textContent)
      .toContain('Iniciar próxima atividade');

    cleanup();
  });

  test('iniciar chama a rota e recarrega o pacote', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    servico.verificarAtividade.mockResolvedValue(pacote());
    container.querySelector('.producao-atividade__vazio .btn').click();
    await flush();
    await flush();

    expect(servico.iniciarAtividade).toHaveBeenCalled();
    expect(container.querySelector('.producao-atividade__nome').textContent)
      .toBe('Edição Vetorial - Execução - 900');

    cleanup();
  });

  test('os dois 400 de /inicia saem como AVISO, com a frase do servidor', async () => {
    // Um deles ("sem atividades disponiveis") o servidor manda com
    // `success: true`, contrato do SAP. Nenhum dos dois e tela quebrada.
    const erro = new Error('Sem atividades disponíveis para iniciar');
    erro.status = 400;
    servico.iniciarAtividade.mockRejectedValue(erro);

    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    container.querySelector('.producao-atividade__vazio .btn').click();
    await flush();
    await flush();

    expect(toast.showInfo).toHaveBeenCalledWith('Sem atividades disponíveis para iniciar');
    expect(toast.showError).not.toHaveBeenCalled();

    cleanup();
  });

  test('falha que NAO e 400 continua sendo erro', async () => {
    servico.iniciarAtividade.mockRejectedValue(new Error('Erro no banco'));

    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    container.querySelector('.producao-atividade__vazio .btn').click();
    await flush();
    await flush();

    expect(toast.showError).toHaveBeenCalledWith('Erro no banco');

    cleanup();
  });

  test('a falha de /verifica vira estado de erro com a mensagem do servidor', async () => {
    servico.verificarAtividade.mockRejectedValue(
      new Error('Usuário necessita do perfil operador no módulo producao')
    );

    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    const erro = container.querySelector('.dashboard-erro');
    expect(erro).not.toBeNull();
    expect(erro.textContent).toContain('perfil operador');

    cleanup();
  });
});

describe('renderAtividade com atividade em execucao', () => {
  beforeEach(() => {
    servico.verificarAtividade.mockResolvedValue(pacote());
  });

  test('a ficha mostra o pacote inteiro, e nao so o nome', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    const texto = container.textContent;
    expect(container.querySelector('.producao-atividade__nome').textContent)
      .toBe('Edição Vetorial - Execução - 900');
    expect(texto).toContain('Mapeamento Sistemático');
    expect(texto).toContain('Lote 2023 A');
    expect(texto).toContain('480 min');
    expect(texto).toContain('Conferir a toponímia da folha');
    expect(texto).toContain('Rodar a validação geométrica');
    expect(texto).toContain('Ortoimagem');

    // Secao sem conteudo nao entra na tela: a linhagem veio vazia.
    expect(texto).not.toContain('Linhagem desta área');
    // Nem a de metadado, que so viaja na fase de EDICAO.
    expect(texto).not.toContain('Metadado de edição');

    cleanup();
  });

  test('a falha do catalogo de problemas NAO apaga a atividade da tela', async () => {
    // A regra do Promise.all que mordeu em 2026-08-08: chamada de apoio carrega
    // sozinha, e a falha dela fica na secao dela.
    servico.getTiposProblema.mockRejectedValue(new Error('403'));

    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    expect(container.querySelector('.producao-atividade__nome')).not.toBeNull();

    acaoDaFicha(container, 'Reportar problema').click();
    await flush();
    expect(textoDoModal()).toContain('catálogo de tipos de problema não carregou');

    cleanup();
  });

  test('dado controlado avisa, mas NAO tranca os botoes', async () => {
    // O SAP sumia com as acoes; aqui nao. Reportar problema e justamente o que
    // se precisa quando o QGIS nao abre.
    servico.verificarAtividade.mockResolvedValue(pacote({
      dado_producao: { configuracao_producao: null, tipo_dado_producao_id: 2 },
    }));

    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    expect(container.querySelector('.producao-atividade__aviso').textContent)
      .toContain('controle de permissões');
    expect(acaoDaFicha(container, 'Reportar problema')).toBeDefined();
    expect(acaoDaFicha(container, 'Finalizar atividade')).toBeDefined();

    cleanup();
  });
});

describe('finalizar', () => {
  beforeEach(() => {
    servico.verificarAtividade.mockResolvedValue(pacote());
  });

  test('sem campo preenchido, o corpo leva SO o atividade_id', async () => {
    // `Joi.string()` recusa string vazia: mandar `observacao_atividade: ''`
    // transformaria uma finalizacao sem observacao num 400.
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    acaoDaFicha(container, 'Finalizar atividade').click();
    await flush();
    botaoDoModal('Finalizar').click();
    await flush();

    expect(servico.finalizarAtividade).toHaveBeenCalledWith({ atividade_id: 4712 });
    expect(toast.showSuccess).toHaveBeenCalledWith('Atividade finalizada com sucesso');

    cleanup();
  });

  test('numa etapa de EXECUCAO nao ha "sem correcao" nem alteracao de fluxo', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    acaoDaFicha(container, 'Finalizar atividade').click();
    await flush();

    expect(textoDoModal()).not.toContain('Não é necessária correção');
    expect(document.querySelector('.modal select')).toBeNull();

    cleanup();
  });

  test('numa etapa de REVISAO as duas decisoes do revisor aparecem e viajam', async () => {
    servico.verificarAtividade.mockResolvedValue(pacote({ tipo_etapa_id: 2 }));

    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    acaoDaFicha(container, 'Finalizar atividade').click();
    await flush();

    expect(textoDoModal()).toContain('Não é necessária correção');
    document.querySelector('.modal .form-field__checkbox').checked = true;
    const select = document.querySelector('.modal select');
    // A FRASE E O VALOR: `alteracao_fluxo.descricao` guarda o texto, e o Joi
    // recusa qualquer outro.
    select.value = 'Necessita nova revisão';
    document.querySelector('.modal textarea').value = '  Faltou o topônimo  ';

    botaoDoModal('Finalizar').click();
    await flush();

    expect(servico.finalizarAtividade).toHaveBeenCalledWith({
      atividade_id: 4712,
      sem_correcao: true,
      alterar_fluxo: 'Necessita nova revisão',
      observacao_atividade: 'Faltou o topônimo',
    });

    cleanup();
  });

  test('a recusa do servidor fica no toast e o formulario continua aberto', async () => {
    servico.finalizarAtividade.mockRejectedValue(new Error('Não foi encontrada uma próxima atividade'));

    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    acaoDaFicha(container, 'Finalizar atividade').click();
    await flush();
    botaoDoModal('Finalizar').click();
    await flush();

    expect(toast.showError).toHaveBeenCalledWith('Não foi encontrada uma próxima atividade');
    expect(document.querySelector('.modal')).not.toBeNull();

    cleanup();
  });
});

describe('reportar problema', () => {
  beforeEach(() => {
    servico.verificarAtividade.mockResolvedValue(pacote());
  });

  test('o poligono e a unidade de trabalho inteira, com o SRID que o Joi cobra', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    acaoDaFicha(container, 'Reportar problema').click();
    await flush();

    expect(textoDoModal()).toContain('A área apontada é a unidade de trabalho inteira');

    document.querySelector('.modal select').value = '99';
    document.querySelector('.modal textarea').value = 'A ortoimagem não cobre o canto nordeste';
    botaoDoModal('Enviar').click();
    await flush();

    expect(servico.reportarProblema).toHaveBeenCalledWith({
      atividade_id: 4712,
      tipo_problema_id: 99,
      descricao: 'A ortoimagem não cobre o canto nordeste',
      polygon_ewkt: 'SRID=31982;POLYGON((0 0,1 0,1 1,0 1,0 0))',
    });

    cleanup();
  });

  test('recusa antes de sair: sem tipo e com descricao curta demais', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    acaoDaFicha(container, 'Reportar problema').click();
    await flush();

    document.querySelector('.modal textarea').value = 'oi';
    botaoDoModal('Enviar').click();
    await flush();

    expect(servico.reportarProblema).not.toHaveBeenCalled();
    const erros = Array.from(document.querySelectorAll('.modal .form-field__error'))
      .map(e => e.textContent).filter(Boolean);
    expect(erros).toContain('Escolha o tipo de problema');
    expect(erros).toContain('A descrição deve ter pelo menos 5 caracteres');

    cleanup();
  });

  // O BOTAO NEM E OFERECIDO, e nao apenas recusa por dentro. Um "Enviar" com a
  // cara de botao ativo que nao faz nada -- nem toast, nem erro de campo, nem
  // requisicao -- faz a pessoa clicar de novo e de novo; o unico sinal era o
  // paragrafo do topo, que pode ter rolado para fora da vista.
  test('sem geometria no pacote, o "Enviar" nao existe e a tela diz por que', async () => {
    servico.verificarAtividade.mockResolvedValue(pacote({ geom: null }));

    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    acaoDaFicha(container, 'Reportar problema').click();
    await flush();

    expect(textoDoModal()).toContain('A geometria da unidade de trabalho não veio');
    expect(botaoDoModal('Enviar')).toBeUndefined();
    // E "Cancelar" fica, senao o dialogo so se fecharia pelo X.
    expect(botaoDoModal('Cancelar')).toBeDefined();
    expect(servico.reportarProblema).not.toHaveBeenCalled();

    cleanup();
  });

  // O GEMEO PELO OUTRO LADO: a geometria veio, mas `/tipo_problema` caiu e o
  // seletor esta vazio. Ate aqui isso so aparecia no texto do aviso.
  test('sem o catalogo de tipos, o "Enviar" tambem nao existe', async () => {
    servico.verificarAtividade.mockResolvedValue(pacote());
    servico.getTiposProblema.mockRejectedValue(new Error('sem catálogo'));

    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    acaoDaFicha(container, 'Reportar problema').click();
    await flush();

    expect(textoDoModal()).toContain('O catálogo de tipos de problema não carregou');
    expect(botaoDoModal('Enviar')).toBeUndefined();
    expect(botaoDoModal('Cancelar')).toBeDefined();

    cleanup();
  });
});

describe('um dialogo por vez', () => {
  // O `openModal` EMPILHA de proposito (no acervo a ficha abre modal sobre
  // modal), e nesta tela isso vira armadilha: dois cliques no mesmo botao abrem
  // dois dialogos identicos, um sobre o outro. No "Finalizei sem querer" os DOIS
  // envios dao certo -- o servidor so procura a ultima atividade finalizada e
  // nao recusa um segundo apontamento sobre ela --, e ficam duas linhas em
  // `producao.problema_atividade` dizendo a mesma coisa.
  test('dois cliques no mesmo botao abrem UM dialogo, e gravam UMA vez', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    const botao = Array.from(container.querySelectorAll('.page__actions .btn'))
      .find(b => b.textContent.includes('Finalizei sem querer'));
    botao.click();
    botao.click();
    await flush();

    expect(document.querySelectorAll('.modal-overlay')).toHaveLength(1);

    document.querySelector('.modal textarea').value = 'Fechei antes de rodar a validação';
    botaoDoModal('Enviar').click();
    await flush();

    expect(servico.reportarFinalizacaoIncorreta).toHaveBeenCalledTimes(1);
    // E o dialogo nao ficou trancado: fechado o primeiro, o botao volta a abrir.
    expect(document.querySelectorAll('.modal-overlay')).toHaveLength(0);
    botao.click();
    await flush();
    expect(document.querySelectorAll('.modal-overlay')).toHaveLength(1);

    cleanup();
  });

  // A TRAVA E UMA SO PARA OS TRES BOTOES, e ela so se solta pelo `onClose` do
  // modal. Se `abrir` estoura ANTES de o modal existir, a bandeira ficaria presa
  // em `true` e a tela inteira pararia de abrir dialogo, em silencio, ate a
  // pessoa recarregar a pagina -- numa tela cuja unica razao de existir e fechar
  // atividade quando o QGIS nao esta a mao.
  test('a montagem que estoura nao deixa a trava presa', async () => {
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    const botao = Array.from(container.querySelectorAll('.page__actions .btn'))
      .find(b => b.textContent.includes('Finalizei sem querer'));

    // O erro SOBE, e e o que se quer: o que nao pode e trancar a porta com ele.
    // Aqui ele e marcado como tratado para nao virar "unhandled error" do jsdom.
    modalCtl.estourarUmaVez = true;
    window.addEventListener('error', e => e.preventDefault(), { once: true });
    botao.click();
    await flush();
    expect(document.querySelectorAll('.modal-overlay')).toHaveLength(0);

    // O SEGUNDO CLIQUE AINDA ABRE.
    botao.click();
    await flush();
    expect(document.querySelectorAll('.modal-overlay')).toHaveLength(1);

    cleanup();
  });

  test('cancelar destranca o botao', async () => {
    servico.verificarAtividade.mockResolvedValue(pacote());
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    acaoDaFicha(container, 'Finalizar atividade').click();
    await flush();
    botaoDoModal('Cancelar').click();
    await flush();

    acaoDaFicha(container, 'Finalizar atividade').click();
    await flush();
    expect(document.querySelectorAll('.modal-overlay')).toHaveLength(1);

    cleanup();
  });
});

describe('finalizacao incorreta', () => {
  test('o botao existe MESMO sem atividade aberta, e nao manda id nenhum', async () => {
    // Quem finalizou por engano esta, por definicao, sem atividade em execucao.
    // Quem descobre QUAL atividade foi e o servidor.
    const container = document.createElement('div');
    const cleanup = await renderAtividade(container);

    const botao = Array.from(container.querySelectorAll('.page__actions .btn'))
      .find(b => b.textContent.includes('Finalizei sem querer'));
    expect(botao).toBeDefined();

    botao.click();
    await flush();
    document.querySelector('.modal textarea').value = 'Fechei antes de rodar a validação';
    botaoDoModal('Enviar').click();
    await flush();

    expect(servico.reportarFinalizacaoIncorreta)
      .toHaveBeenCalledWith('Fechei antes de rodar a validação');

    cleanup();
  });
});
