import { describe, test, expect, vi, beforeEach } from 'vitest';

// A EDICAO do RPCMTec (#/rpcmtec/:id).
//
// O que estes casos FIXAM:
//  - a tela NAO se remonta a cada gravacao. Quem fecha uma secao, escolhe um
//    arquivo ou rola a pagina nao perde o gesto quando algo e salvo. O `details`
//    nascia `open: true` a cada carga, e reabria tudo o que a pessoa fechou;
//  - a subsecao que nao mudou mantem o MESMO no, e so a que mudou se refaz;
//  - a subsecao CALCULADA que saiu vazia mostra o que a pessoa precisa FAZER. A
//    6.1 vazia quer dizer que falta cadastrar passagem de efetivo, e nao que nao
//    houve passagem nenhuma;
//  - o fechamento avisa das lacunas congeladas, pela chave `lacunas`;
//  - a tela NAO oferece trazer o conteudo do mes passado (poda de 2026-08-06).
//
// A PODA DA COPIA. Havia dois botoes que traziam o digitado da edicao anterior:
// um por subsecao e um geral, na barra. Os dois sairam, com o servico do cliente
// e a rota do servidor. O RPCMTec e o relatorio DAQUELE mes, e a linha que chega
// pronta nao e relida. Os casos de reconciliacao abaixo usavam o botao geral
// como gatilho de recarga, e hoje usam a caixa de conferencia.

vi.mock('@services/rpcmtec-service.js', async () => {
  const real = await vi.importActual('@services/rpcmtec-service.js');
  return {
    ...real,
    getDocumento: vi.fn(),
    listarAnexos: vi.fn(() => Promise.resolve([])),
    fecharEdicao: vi.fn(() => Promise.resolve({ id: 7, subsecoes: 34, lacunas: [] })),
    revisarSubsecao: vi.fn(() => Promise.resolve({ numero: '6.1', revisao: null })),
  };
});

vi.mock('@services/plataforma-service.js', async () => {
  const real = await vi.importActual('@services/plataforma-service.js');
  return { ...real, getUsuarios: vi.fn(() => Promise.resolve([])) };
});

vi.mock('@utils/toast.js', async () => {
  const real = await vi.importActual('@utils/toast.js');
  return {
    ...real,
    showError: vi.fn(),
    showSuccess: vi.fn(),
    showWarning: vi.fn(),
    showInfo: vi.fn(),
  };
});

vi.mock('@components/modal/confirm-dialog.js', () => ({
  confirmDialog: vi.fn(() => Promise.resolve(true)),
}));

import { saveAuth } from '@store/auth-store.js';
import { renderRpcmtecEdicao } from '@pages/rpcmtec/edicao.js';
import {
  getDocumento, fecharEdicao, revisarSubsecao,
} from '@services/rpcmtec-service.js';
import { showWarning } from '@utils/toast.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';

const flush = async () => {
  for (let i = 0; i < 4; i += 1) await new Promise(resolve => setTimeout(resolve, 0));
};

// O documento de uma edicao ABERTA, com as tres situacoes de subsecao calculada
// lado a lado: a que veio com linha, a que saiu VAZIA (6.1) e a que o gerador
// nem produz (6.3).
function doc({ pendentes = ['3.1'], preenchida31 = false, revisoes = {} } = {}) {
  const revisaoDe = (numero) => revisoes[numero] || null;
  const numeros = ['3.1', '6.1', '6.2', '6.3'];
  return {
    id: 7,
    ano: 2026,
    mes: 6,
    fechada: false,
    anexos: 0,
    assinante_nome: 'Diniz',
    assinante_posto: 'Maj',
    data_assinatura: null,
    data_fechamento: null,
    pendentes,
    lacunasCalculadas: ['6.1', '6.3'],
    // As duas listas da CONFERENCIA (1.36.0), montadas do mesmo fixture para
    // nao poderem discordar do que cada subsecao diz de si.
    porRevisar: numeros.filter(n => !revisaoDe(n)),
    revisaoVencida: numeros.filter(n => revisaoDe(n) && revisaoDe(n).desatualizada),
    secoes: [
      {
        titulo: '3. ATIVIDADES DA DIVISÃO',
        subsecoes: [{
          numero: '3.1',
          revisao: revisaoDe('3.1'),
          titulo: 'Atividades realizadas',
          // O MODULO vem do servidor desde 2026-08-08, e e o que diz quem edita
          // esta subsecao. A 3.1 e da mapoteca; a 6.x, do efetivo.
          modulo: 'mapoteca',
          origem: 2,
          fonte: null,
          cabecalhos: ['Atividade', 'Observação'],
          linhas: preenchida31 ? [['Curso', 'ok']] : [],
          texto: null,
          semOcorrencia: false,
          preenchida: preenchida31,
        }],
      },
      {
        titulo: '6. RECURSOS HUMANOS',
        subsecoes: [
          {
            numero: '6.1',
            revisao: revisaoDe('6.1'),
            titulo: 'Aproveitamento do efetivo',
            modulo: 'efetivo',
            origem: 1,
            fonte: 'dgeo.efetivo_periodo e dgeo.impedimento',
            pendencia: PENDENCIA_6_1,
            cabecalhos: ['Militar', 'Atividades', 'Aproveitamento'],
            linhas: [],
            semGerador: false,
            semLinhas: true,
            preenchida: true,
          },
          {
            numero: '6.2',
            revisao: revisaoDe('6.2'),
            titulo: 'Capacitação do efetivo',
            origem: 1,
            fonte: 'rpcmtec.capacitacao, tipo Recebida',
            pendencia: PENDENCIA_6_2,
            cabecalhos: ['Plano / Código', 'Capacitação'],
            linhas: [['PCEG', 'QSMS']],
            semGerador: false,
            semLinhas: false,
            preenchida: true,
          },
          {
            numero: '6.3',
            revisao: revisaoDe('6.3'),
            titulo: 'Subseção sem gerador',
            origem: 1,
            fonte: 'algum lugar',
            pendencia: PENDENCIA_6_3,
            cabecalhos: ['Coluna'],
            linhas: [],
            semGerador: true,
            semLinhas: false,
            preenchida: true,
          },
        ],
      },
    ],
  };
}

async function montar() {
  const container = document.createElement('div');
  document.body.appendChild(container);
  const cleanup = await renderRpcmtecEdicao(container, { params: { id: '7' } });
  await flush();
  return { container, cleanup };
}

const subsecao = (container, numero) => [...container.querySelectorAll('.rpcm-subsecao')]
  .find(no => no.querySelector('.rpcm-subsecao__titulo').textContent.startsWith(`${numero}.`));

const marcas = (no) => [...no.querySelectorAll('.rpcm-etiqueta')].map(e => e.textContent);

// A pendência que cada subseção declara, na palavra da Divisão. Vem do servidor
// em `pendencia`, e o fixture abaixo a reproduz.
const PENDENCIA_6_1 = 'Nenhum período de efetivo cadastrado';
const PENDENCIA_6_2 = 'Nenhuma capacitação recebida concluída no mês';
const PENDENCIA_6_3 = 'Nenhuma passagem de efetivo no mês';

const botaoPor = (container, rotulo) => [...container.querySelectorAll('button')]
  .find(b => b.textContent.trim() === rotulo);

describe('renderRpcmtecEdicao', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.clearAllMocks();
    // ADMINISTRADOR por padrao: os casos deste bloco retratam quem fecha, reabre
    // e edita metadados, e esses tres atos ficaram do administrador global em
    // 2026-08-08. O recorte do GERENTE tem bloco proprio no fim do arquivo.
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
    getDocumento.mockImplementation(() => Promise.resolve(doc()));
  });

  // -------------------------------------------------------------------------
  // A etiqueta da subsecao calculada vazia
  // -------------------------------------------------------------------------

  // A ETIQUETA NOMEIA A COISA. Ela dizia "Falta cadastrar o dado de origem", que
  // não diz O QUE cadastrar nem ONDE: o chefe leu isso na 2.6 e não soube o que
  // era, justamente numa subseção que ele sabia ser automática. Agora cada
  // subseção declara a sua pendência na palavra que a Divisão usa, e o servidor
  // a manda em `pendencia` (ver rpcmtec_estrutura.js).
  test('a subseção calculada VAZIA nomeia o que falta, na palavra da Divisão', async () => {
    const { container, cleanup } = await montar();

    const seis1 = subsecao(container, '6.1');
    expect(marcas(seis1)).toContain(PENDENCIA_6_1);

    // NOME de tabela do banco não aparece na tela: quem lê o relatório não tem
    // por que saber como o dado está guardado.
    const etiqueta = [...seis1.querySelectorAll('.rpcm-etiqueta')]
      .find(e => e.textContent === PENDENCIA_6_1);
    expect(etiqueta.title).not.toContain('dgeo.efetivo_periodo');
    expect(etiqueta.title).toMatch(/cadastre/i);

    cleanup();
  });

  // A etiqueta de ORIGEM também parou de citar tabela. Ela dizia
  // "Calculada: pit.meta_vigente e pit.execucao"; agora diz só "Calculada".
  test('a etiqueta de origem não cita tabela do banco', async () => {
    const { container, cleanup } = await montar();

    const todas = [...container.querySelectorAll('.rpcm-etiqueta--calculada')]
      .map(e => e.textContent);
    expect(todas.length).toBeGreaterThan(0);
    expect(todas.every(t => t === 'Calculada')).toBe(true);
    expect(todas.some(t => t.includes('.'))).toBe(false);

    cleanup();
  });

  test('a calculada com linha e a sem gerador não recebem a etiqueta nova', async () => {
    const { container, cleanup } = await montar();

    expect(marcas(subsecao(container, '6.2')))
      .not.toContain(PENDENCIA_6_2);

    // As duas lacunas são EXCLUSIVAS: sem gerador não há tabela vazia a
    // reportar, porque a causa já está dita e o conserto é outro.
    const seis3 = marcas(subsecao(container, '6.3'));
    expect(seis3).toContain('Lacuna do gerador');
    expect(seis3).not.toContain(PENDENCIA_6_3);

    cleanup();
  });

  test('o fechamento avisa das lacunas congeladas, com o conserto', async () => {
    fecharEdicao.mockResolvedValueOnce({ id: 7, subsecoes: 34, lacunas: ['6.1'] });

    const { container, cleanup } = await montar();

    botaoPor(container, 'Fechar e congelar').click();
    await flush();

    expect(showWarning).toHaveBeenCalled();
    const texto = showWarning.mock.calls[0][0];
    expect(texto).toContain('6.1');
    expect(texto).toContain('Cadastre o dado de origem');

    cleanup();
  });

  // -------------------------------------------------------------------------
  // A poda da copia do mes anterior (2026-08-06)
  // -------------------------------------------------------------------------

  // O CASO QUE REPROVA O ESTADO ANTERIOR. Ate 2026-08-06 esta tela montava dois
  // botoes de copia: "Copiar tudo do mes anterior" na barra e "Copiar do mes
  // anterior" em cada subsecao digitada. Hoje nenhum botao da tela oferece
  // trazer o mes passado.
  test('a tela não monta nenhum botão de copiar', async () => {
    const { container, cleanup } = await montar();

    const rotulos = [...container.querySelectorAll('button')]
      .map(b => b.textContent.trim());

    // VARIANCIA: a tela montou botoes de verdade, senao o filtro abaixo
    // passaria sobre uma lista vazia.
    expect(rotulos.length).toBeGreaterThan(3);
    expect(rotulos).toContain('Fechar e congelar');
    // A 3.1 e digitada e continua com o botao de preencher: o que saiu foi a
    // copia, e nao a edicao da subsecao.
    expect(rotulos).toContain('Preencher');

    expect(rotulos.filter(r => /copiar/i.test(r))).toEqual([]);

    cleanup();
  });

  // -------------------------------------------------------------------------
  // O remonte
  // -------------------------------------------------------------------------

  // O GATILHO DE RECARGA destes tres casos era o botao "Copiar tudo do mes
  // anterior", removido em 2026-08-06. Hoje e a caixa de conferencia da 6.1,
  // que tambem grava no servidor e recarrega a tela inteira.
  const gravar = (container) => subsecao(container, '6.1')
    .querySelector('.rpcm-revisao__caixa').click();

  test('a seção que a pessoa fechou continua fechada depois de uma gravação', async () => {
    const { container, cleanup } = await montar();

    const secoes = [...container.querySelectorAll('.rpcm-secao')];
    expect(secoes.length).toBe(2);
    secoes[1].open = false;

    gravar(container);
    await flush();

    expect(revisarSubsecao).toHaveBeenCalled();
    const depois = [...container.querySelectorAll('.rpcm-secao')];
    // O MESMO nó, e ainda fechado. Recriar o `details` com `open: true` reabria
    // tudo o que a pessoa tinha fechado.
    expect(depois[1]).toBe(secoes[1]);
    expect(depois[1].open).toBe(false);

    cleanup();
  });

  test('só a subseção que mudou se refaz', async () => {
    const { container, cleanup } = await montar();

    const antes31 = subsecao(container, '3.1');
    const antes62 = subsecao(container, '6.2');

    // A gravação preenche a 3.1 e não toca em nenhuma outra.
    getDocumento.mockImplementation(
      () => Promise.resolve(doc({ pendentes: [], preenchida31: true })),
    );
    gravar(container);
    await flush();

    expect(subsecao(container, '3.1')).not.toBe(antes31);
    expect(subsecao(container, '6.2')).toBe(antes62);

    cleanup();
  });

  test('o painel de histórico e o campo de arquivo sobrevivem à gravação', async () => {
    const { container, cleanup } = await montar();

    const historico = container.querySelector('.historico');
    const arquivo = container.querySelector('input[type="file"]');
    expect(historico).not.toBeNull();
    expect(arquivo).not.toBeNull();

    gravar(container);
    await flush();

    expect(container.querySelector('.historico')).toBe(historico);
    expect(container.querySelector('input[type="file"]')).toBe(arquivo);

    cleanup();
  });
  // -------------------------------------------------------------------------
  // A conferencia por subsecao
  // -------------------------------------------------------------------------

  // A CAIXA APARECE NAS TRES ORIGENS. E a diferenca entre esta marca e a
  // etiqueta "Por preencher": preencher e digitar o que falta, conferir e olhar
  // o que esta la e responder por ele. A calculada nasce preenchida e e
  // justamente a que mais precisa do olho, porque o numero pode estar certo e o
  // cadastro que o alimenta, errado.
  test('toda subsecao ganha a caixa de conferencia, calculada inclusive', async () => {
    const { container, cleanup } = await montar();

    for (const numero of ['3.1', '6.1', '6.2', '6.3']) {
      const caixa = subsecao(container, numero).querySelector('.rpcm-revisao__caixa');
      expect(caixa, `a ${numero} ficou sem caixa`).not.toBeNull();
      expect(caixa.checked).toBe(false);
    }

    cleanup();
  });

  test('a subsecao conferida mostra QUEM conferiu e QUANDO', async () => {
    getDocumento.mockImplementation(() => Promise.resolve(doc({
      revisoes: {
        '6.2': {
          por: 'Cap Fulano',
          em: '2026-08-06T14:32:00.000Z',
          desatualizada: false,
        },
      },
    })));

    const { container, cleanup } = await montar();

    const seis2 = subsecao(container, '6.2');
    expect(seis2.querySelector('.rpcm-revisao__caixa').checked).toBe(true);
    expect(seis2.textContent).toContain('Cap Fulano');
    // Marca sem nome nem hora responderia "alguem ja olhou", que nao serve para
    // quem precisa saber a quem perguntar.
    expect(seis2.querySelector('.rpcm-revisao__rotulo').textContent).toMatch(/06\/08\/2026/);

    // VARIANCIA: a nao conferida continua sem nada disso, senao o caso acima
    // passaria com a tela mostrando o mesmo texto em todo bloco.
    const seis1 = subsecao(container, '6.1');
    expect(seis1.querySelector('.rpcm-revisao__caixa').checked).toBe(false);
    expect(seis1.textContent).not.toContain('Cap Fulano');

    cleanup();
  });

  // O CASO QUE JUSTIFICA A IMPRESSAO DIGITAL. A marca continua la, com quem e
  // quando, e a tela avisa que o conteudo mudou depois dela.
  test('a marca que envelheceu avisa que o conteudo mudou depois', async () => {
    getDocumento.mockImplementation(() => Promise.resolve(doc({
      revisoes: {
        '6.2': {
          por: 'Cap Fulano',
          em: '2026-08-06T14:32:00.000Z',
          desatualizada: true,
        },
      },
    })));

    const { container, cleanup } = await montar();

    const seis2 = subsecao(container, '6.2');
    expect(seis2.querySelector('.rpcm-revisao__caixa').checked).toBe(true);
    expect(marcas(seis2)).toContain('mudou depois da conferência');
    // Ela NAO recebe a barra de conferida: o verde diria que aquilo esta
    // resolvido, e nao esta.
    expect(seis2.classList.contains('rpcm-subsecao--conferida')).toBe(false);

    cleanup();
  });

  test('marcar a caixa manda a subsecao e o valor para o servidor', async () => {
    const { container, cleanup } = await montar();

    subsecao(container, '6.1').querySelector('.rpcm-revisao__caixa').click();
    await flush();

    expect(revisarSubsecao).toHaveBeenCalledWith(7, '6.1', true);

    cleanup();
  });

  // A TELA NAO PODE AFIRMAR O QUE O BANCO NAO TEM. Falhando a gravacao, a caixa
  // volta ao estado real; deixa-la marcada seria a tela mentindo.
  test('gravacao que falha devolve a caixa ao estado anterior', async () => {
    revisarSubsecao.mockRejectedValueOnce(new Error('sem rede'));

    const { container, cleanup } = await montar();
    const caixa = subsecao(container, '6.1').querySelector('.rpcm-revisao__caixa');

    caixa.click();
    await flush();

    expect(caixa.checked).toBe(false);

    cleanup();
  });

  // O AVISO ENTRA NA MESMA CONFIRMACAO do fechamento, e nao numa segunda caixa:
  // duas seguidas treinam quem le a clicar sem ler.
  test('o fechamento avisa da conferencia que falta, e deixa fechar', async () => {
    const { container, cleanup } = await montar();

    botaoPor(container, 'Fechar e congelar').click();
    await flush();

    const pedido = confirmDialog.mock.calls.at(-1)[0];
    expect(pedido.message).toMatch(/AINDA FALTA CONFERIR/);
    expect(pedido.message).toContain('6.1');
    expect(fecharEdicao).toHaveBeenCalledWith(7, true);

    cleanup();
  });

  test('conferido tudo, o fechamento nao fala em conferencia', async () => {
    const feita = { por: 'Cap Fulano', em: '2026-08-06T14:32:00.000Z', desatualizada: false };
    getDocumento.mockImplementation(() => Promise.resolve(doc({
      revisoes: { '3.1': feita, '6.1': feita, '6.2': feita, '6.3': feita },
    })));

    const { container, cleanup } = await montar();

    botaoPor(container, 'Fechar e congelar').click();
    await flush();

    expect(confirmDialog.mock.calls.at(-1)[0].message).not.toMatch(/AINDA FALTA CONFERIR/);

    cleanup();
  });

  // -------------------------------------------------------------------------
  // A CAIXA QUE ESCONDE O QUE JA FOI CONFERIDO
  //
  // A edicao tem 34 blocos. Conferidos 30, a tela continuava com os 34 e achar
  // os quatro que faltam era rolar o documento inteiro. A caixa deixa na tela
  // so o que pede olho.
  //
  // O QUE ELA NAO ESCONDE e o que faz ela valer: a marca DESATUALIZADA (o
  // conteudo mudou depois da conferencia) e a subsecao nunca conferida.
  // -------------------------------------------------------------------------

  const FEITA = { por: 'Cap Fulano', em: '2026-08-06T14:32:00.000Z', desatualizada: false };
  const VENCIDA = { por: 'Cap Fulano', em: '2026-08-06T14:32:00.000Z', desatualizada: true };

  const caixaEsconder = (container) => container.querySelector('.rpcm-filtro__caixa');
  const numerosNaTela = (container) => [...container.querySelectorAll('.rpcm-subsecao__titulo')]
    .map(no => no.textContent.split('.')[0] + '.' + no.textContent.split('.')[1].trim());
  const secoesNaTela = (container) => [...container.querySelectorAll('.rpcm-secao__titulo')]
    .map(no => no.textContent);

  describe('esconder as subseções já conferidas', () => {
    test('a caixa nasce desmarcada, e a tela mostra tudo', async () => {
      getDocumento.mockImplementation(() => Promise.resolve(doc({
        revisoes: { '6.1': FEITA, '6.2': FEITA },
      })));

      const { container, cleanup } = await montar();

      expect(caixaEsconder(container).checked).toBe(false);
      expect(container.querySelectorAll('.rpcm-subsecao')).toHaveLength(4);
      // Desmarcada, a contagem não fala nada: não há nada escondido.
      expect(container.querySelector('.rpcm-filtro__contagem').textContent).toBe('');

      cleanup();
    });

    test('marcada, some a conferida e FICA a que mudou depois', async () => {
      // A VARIÂNCIA QUE IMPORTA: `6.1` está resolvida e `6.2` está marcada com o
      // conteúdo mudado depois. Esconder as duas derrotaria o propósito da
      // caixa, porque a segunda é justamente a que passa batido.
      getDocumento.mockImplementation(() => Promise.resolve(doc({
        revisoes: { '6.1': FEITA, '6.2': VENCIDA },
      })));

      const { container, cleanup } = await montar();
      caixaEsconder(container).click();
      await flush();

      const visiveis = numerosNaTela(container);
      expect(visiveis).not.toContain('6.1');
      expect(visiveis).toContain('6.2');
      // A nunca conferida também fica: ninguém olhou para ela ainda.
      expect(visiveis).toContain('3.1');
      expect(visiveis).toContain('6.3');

      cleanup();
    });

    test('a contagem diz quantas sumiram', async () => {
      getDocumento.mockImplementation(() => Promise.resolve(doc({
        revisoes: { '6.1': FEITA, '6.2': FEITA, '6.3': VENCIDA },
      })));

      const { container, cleanup } = await montar();
      caixaEsconder(container).click();
      await flush();

      // Duas resolvidas. A `6.3` está marcada e desatualizada, e não conta.
      expect(container.querySelector('.rpcm-filtro__contagem').textContent)
        .toBe('2 conferida(s) escondida(s)');

      cleanup();
    });

    test('a seção que fica sem subseção visível SOME', async () => {
      // Sem isto restaria o cabeçalho "3. ATIVIDADES DA DIVISÃO" com a gaveta
      // vazia, e a tela ficaria pior do que antes de filtrar.
      getDocumento.mockImplementation(() => Promise.resolve(doc({
        revisoes: { '3.1': FEITA },
      })));

      const { container, cleanup } = await montar();
      expect(secoesNaTela(container)).toHaveLength(2);

      caixaEsconder(container).click();
      await flush();

      const secoes = secoesNaTela(container);
      expect(secoes).toHaveLength(1);
      expect(secoes[0]).toContain('RECURSOS HUMANOS');

      cleanup();
    });

    test('desmarcar traz tudo de volta', async () => {
      getDocumento.mockImplementation(() => Promise.resolve(doc({
        revisoes: { '3.1': FEITA, '6.1': FEITA },
      })));

      const { container, cleanup } = await montar();
      const caixa = caixaEsconder(container);

      caixa.click();
      await flush();
      expect(container.querySelectorAll('.rpcm-subsecao')).toHaveLength(2);

      caixa.click();
      await flush();
      expect(container.querySelectorAll('.rpcm-subsecao')).toHaveLength(4);
      expect(container.querySelector('.rpcm-filtro__contagem').textContent).toBe('');

      cleanup();
    });

    test('a escolha SOBREVIVE à recarga que marcar uma subseção dispara', async () => {
      // Marcar "conferida" recarrega o documento. Com a caixa desmarcando
      // sozinha ali, o trabalho de esconder se desfazia a cada clique.
      getDocumento.mockImplementation(() => Promise.resolve(doc({
        revisoes: { '6.1': FEITA },
      })));

      const { container, cleanup } = await montar();
      const caixa = caixaEsconder(container);
      caixa.click();
      await flush();
      expect(container.querySelectorAll('.rpcm-subsecao')).toHaveLength(3);

      // A gravação da conferência da 6.2 recarrega a tela.
      getDocumento.mockImplementation(() => Promise.resolve(doc({
        revisoes: { '6.1': FEITA, '6.2': FEITA },
      })));
      subsecao(container, '6.2').querySelector('.rpcm-revisao__caixa').click();
      await flush();

      expect(revisarSubsecao).toHaveBeenCalledWith(7, '6.2', true);
      expect(caixaEsconder(container).checked).toBe(true);
      expect(numerosNaTela(container)).toEqual(['3.1', '6.3']);

      cleanup();
    });

    test('esconder RECONCILIA, e não destrói a seção que ficou na tela', async () => {
      // O desenho daquele arquivo. Refazer o corpo inteiro fecharia a gaveta que
      // a pessoa abriu e jogaria a rolagem para o topo.
      getDocumento.mockImplementation(() => Promise.resolve(doc({
        revisoes: { '3.1': FEITA },
      })));

      const { container, cleanup } = await montar();
      const antes = subsecao(container, '6.2');

      caixaEsconder(container).click();
      await flush();

      expect(subsecao(container, '6.2')).toBe(antes);

      cleanup();
    });

    test('na edição FECHADA a caixa esconde do mesmo jeito', async () => {
      const fechado = doc({ revisoes: { '6.1': FEITA, '6.2': FEITA } });
      fechado.fechada = true;
      fechado.data_fechamento = '2026-08-06T18:00:00.000Z';
      getDocumento.mockImplementation(() => Promise.resolve(fechado));

      const { container, cleanup } = await montar();
      // Fechada, a marca é só leitura: não há caixa por subseção.
      expect(container.querySelector('.rpcm-revisao__caixa')).toBeNull();

      caixaEsconder(container).click();
      await flush();

      expect(numerosNaTela(container)).toEqual(['3.1', '6.3']);

      cleanup();
    });
  });
});

// ---------------------------------------------------------------------------
// O RECORTE DO GERENTE (2026-08-08).
//
// O RPCMTec deixou de ser só do administrador: quem é gerente de QUALQUER módulo
// LÊ o relatório inteiro, e edita só as subseções do módulo dele. Fechar,
// reabrir e editar metadados continuam do administrador, porque congelar é o ato
// que produz o documento que o chefe da Divisão assina, e os metadados dizem
// QUEM assina.
//
// Quem barra de verdade é o servidor (`verifyGerente` mais
// `verify_modulo_subsecao.js`, lendo o perfil do BANCO a cada requisição). O que
// se prova aqui é a ERGONOMIA: não oferecer um botão que responderia 403 depois
// de a pessoa ter digitado a subseção inteira.
// ---------------------------------------------------------------------------
describe('RPCMTec: o gerente lê tudo e edita só o módulo dele', () => {
  const logarGerenteDe = (modulo) => {
    localStorage.clear();
    saveAuth(
      { token: 't', administrador: false, uuid: 'u', perfis: { [modulo]: 3 }, modulos: [] },
      'x'
    );
  };

  beforeEach(() => {
    document.body.innerHTML = '';
    localStorage.clear();
    vi.clearAllMocks();
    getDocumento.mockImplementation(() => Promise.resolve(doc()));
  });

  test('o gerente da mapoteca preenche a 3.1 e NÃO preenche a 6.1', async () => {
    logarGerenteDe('mapoteca');
    const { container, cleanup } = await montar();

    const acoesDe = (numero) => [...subsecao(container, numero).querySelectorAll('button')]
      .map(b => b.textContent.trim());

    expect(acoesDe('3.1')).toContain('Preencher');
    expect(acoesDe('6.1')).not.toContain('Preencher');
    expect(acoesDe('6.1')).not.toContain('Editar');

    if (typeof cleanup === 'function') cleanup();
  });

  // O outro lado, para o caso acima não passar por acaso: trocando o módulo do
  // gerente, troca a subseção que ele alcança.
  test('o gerente do efetivo alcança a 6.1, e não a 3.1', async () => {
    logarGerenteDe('efetivo');
    const { container, cleanup } = await montar();

    const acoesDe = (numero) => [...subsecao(container, numero).querySelectorAll('button')]
      .map(b => b.textContent.trim());

    expect(acoesDe('3.1')).not.toContain('Preencher');
    // A 6.1 é CALCULADA, então ela não tem botão de preencher nem para quem a
    // alcança: o que se prova é que a 3.1 sumiu por MÓDULO, e não por origem.
    expect(acoesDe('3.1')).not.toContain('Editar');

    if (typeof cleanup === 'function') cleanup();
  });

  test('o gerente não fecha, não reabre e não edita metadados', async () => {
    logarGerenteDe('mapoteca');
    const { container, cleanup } = await montar();

    expect(botaoPor(container, 'Fechar e congelar')).toBeUndefined();
    expect(botaoPor(container, 'Editar metadados')).toBeUndefined();

    if (typeof cleanup === 'function') cleanup();
  });

  // A LEITURA CONTINUA INTEIRA: o gerente vê as quatro subseções e as duas
  // saídas em ODS. Sem este caso, esconder tudo passaria nos dois de cima.
  test('o gerente continua vendo o relatório inteiro e as saídas', async () => {
    logarGerenteDe('mapoteca');
    const { container, cleanup } = await montar();

    for (const numero of ['3.1', '6.1', '6.2', '6.3']) {
      expect(subsecao(container, numero)).toBeTruthy();
    }
    expect(botaoPor(container, 'Anuário (ODS)')).toBeTruthy();

    if (typeof cleanup === 'function') cleanup();
  });

  test('o administrador continua com os três atos de assinatura', async () => {
    saveAuth({ token: 't', administrador: true, uuid: 'u', perfis: {}, modulos: [] }, 'x');
    const { container, cleanup } = await montar();

    expect(botaoPor(container, 'Fechar e congelar')).toBeTruthy();
    expect(botaoPor(container, 'Editar metadados')).toBeTruthy();

    if (typeof cleanup === 'function') cleanup();
  });
});
