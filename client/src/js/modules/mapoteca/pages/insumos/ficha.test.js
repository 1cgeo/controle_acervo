import { describe, test, expect, vi, beforeEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

vi.mock('@modules/mapoteca/services/mapoteca-service.js', async () => {
  const { mockMapotecaService } = await import('@modules/mapoteca/services/service-mocks.js');
  return mockMapotecaService();
});

import { renderInsumoFicha } from '@modules/mapoteca/pages/insumos/ficha.js';
import * as svc from '@modules/mapoteca/services/mapoteca-service.js';
import { logarComo, CONSULTA, OPERADOR } from '@/__tests__/helpers/sessao.js';

const ANO_ATUAL = new Date().getFullYear();

// 12 na Seção e 40 em 'Aquisição realizada': total 52, DISPONIVEL 12, minimo 20.
const MATERIAL = {
  id: 1,
  nome: 'Papel A0',
  descricao: 'Bobina de papel',
  ativo: true,
  estoque_minimo: 20,
  estoque: {
    total: 52,
    disponivel: 12,
    localizacoes: 2,
    registros: [
      {
        id: 11, localizacao_id: 1, localizacao_nome: 'Seção', quantidade: 12,
        data_atualizacao: '2026-06-01T10:00:00Z',
      },
      {
        id: 12, localizacao_id: 3, localizacao_nome: 'Aquisição realizada', quantidade: 40,
        data_atualizacao: '2026-06-02T10:00:00Z',
      },
    ],
  },
  movimentos: { registros_recentes: [] },
  consumo: { total_consumido: 88, ultimo_consumo: '2026-06-05', total_registros: 3 },
};

// O LIVRO traz os TRES tipos. A ficha antiga mostrava so "Consumo recente", e
// quem visse o saldo cair por uma transferencia nao tinha onde ler isso.
//
// SAO TRES TIPOS, e nao ha um quarto. A Contagem (code 4) foi extinta em
// 2026-08-08 e a linha dela saiu do dominio na 1.48.0, depois de medido que nao
// havia um movimento desse tipo em banco nenhum. O NOME de cada tipo chega
// resolvido do servidor (`tipo_movimento_nome`), e a tela nao o traduz.
const LIVRO = [
  {
    id: 32, tipo_movimento_id: 2, tipo_movimento_nome: 'Transferência',
    quantidade: 10, data_movimento: '2026-08-05',
    localizacao_origem_id: 2, localizacao_origem_nome: 'Almoxarifado',
    localizacao_destino_id: 1, localizacao_destino_nome: 'Seção',
    motivo: null, usuario_criacao_nome: 'Sd Silva',
  },
  {
    id: 21, tipo_movimento_id: 3, tipo_movimento_nome: 'Consumo',
    quantidade: 3, data_movimento: '2026-08-03',
    localizacao_origem_id: 1, localizacao_origem_nome: 'Seção',
    localizacao_destino_id: null, localizacao_destino_nome: null,
    motivo: null, usuario_criacao_nome: 'Sd Silva',
  },
  {
    id: 11, tipo_movimento_id: 1, tipo_movimento_nome: 'Entrada',
    quantidade: 50, data_movimento: '2026-08-01',
    localizacao_origem_id: null, localizacao_origem_nome: null,
    localizacao_destino_id: 2, localizacao_destino_nome: 'Almoxarifado',
    motivo: 'NF 1234', usuario_criacao_nome: 'Sd Silva',
  },
];

/** A secao pelo titulo. Evita casar com a tabela do historico. */
function secao(container, titulo) {
  return [...container.querySelectorAll('.dashboard-section')]
    .find(s => {
      const h = s.querySelector('.dashboard-section__title');
      return h && h.textContent === titulo;
    });
}

async function montar() {
  const container = document.createElement('div');
  const cleanup = await renderInsumoFicha(container, {
    params: { id: '1' }, query: new URLSearchParams(),
  });
  await flush();
  return { container, cleanup };
}

describe('renderInsumoFicha', () => {
  beforeEach(() => {
    logarComo({ mapoteca: OPERADOR });
    svc.getTipoMaterial.mockResolvedValue(MATERIAL);
    svc.getMovimentosMaterial.mockResolvedValue(LIVRO);
    svc.getConsumoMensal.mockResolvedValue([]);
    svc.getAnosMapoteca.mockResolvedValue([ANO_ATUAL]);
  });

  test('busca o insumo do :id e monta cartoes, estoque e o livro', async () => {
    const { container, cleanup } = await montar();

    expect(svc.getTipoMaterial).toHaveBeenCalledWith(1);
    expect(container.querySelector('.page__title').textContent).toBe('Papel A0');
    expect(container.textContent).toContain('Disponível');
    expect(container.textContent).toContain('Estoque por localização');
    expect(container.textContent).toContain('Livro de movimentos');

    cleanup();
  });

  test('o livro mostra os TRES tipos de movimento, e nao so o consumo', async () => {
    const { container, cleanup } = await montar();

    const livro = secao(container, 'Livro de movimentos');
    const texto = livro.textContent;
    // Os tres nomes vem do dominio, junto com cada linha: a tela nao guarda uma
    // segunda copia da traducao para divergir da primeira.
    for (const tipo of ['Entrada', 'Transferência', 'Consumo']) {
      expect(texto).toContain(tipo);
    }
    // As colunas De e Para juntas sao o que diz o que aconteceu: entrada tem so
    // destino, consumo tem so origem.
    expect(texto).toContain('Almoxarifado');
    expect(texto).toContain('NF 1234');

    cleanup();
  });

  test('o livro busca pelo INTERVALO do filtro, e o ano inteiro e o padrao', async () => {
    const { cleanup } = await montar();

    expect(svc.getMovimentosMaterial).toHaveBeenLastCalledWith({
      tipo_material_id: 1,
      data_inicio: `${ANO_ATUAL}-01-01`,
      data_fim: `${ANO_ATUAL}-12-31`,
    });

    cleanup();
  });

  test('escolher o mes refaz a busca com o primeiro e o ultimo dia dele', async () => {
    const { container, cleanup } = await montar();

    // O segundo select da barra de controle do livro e o mes; o primeiro e o ano.
    const selects = [...container.querySelectorAll('.export-bar select')];
    selects[1].value = '2';
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    // Fevereiro termina no dia 28 ou 29, e o dia 0 do mes seguinte resolve isso
    // sem tabela de calendario.
    const ultimo = new Date(ANO_ATUAL, 2, 0).getDate();
    expect(svc.getMovimentosMaterial).toHaveBeenLastCalledWith({
      tipo_material_id: 1,
      data_inicio: `${ANO_ATUAL}-02-01`,
      data_fim: `${ANO_ATUAL}-02-${ultimo}`,
    });

    cleanup();
  });

  // A RESPOSTA ATRASADA NAO PINTA.
  //
  // O ano e o mes ficam lado a lado na mesma barra, e escolher os dois seguidos
  // e o gesto normal: sao duas cargas em voo. A do ANO INTEIRO le doze meses e e
  // a mais pesada, entao ela chegava DEPOIS e repintava por cima -- o livro
  // mostrava o ano inteiro com o mes escolhido no seletor.
  test('a carga que outra ja substituiu nao repinta o livro', async () => {
    // Dois anos no seletor: sem o segundo, trocar o ano nao troca nada e nao ha
    // segunda carga para chegar atrasada.
    svc.getAnosMapoteca.mockResolvedValue([ANO_ATUAL, ANO_ATUAL - 1]);
    const { container, cleanup } = await montar();

    const doMes = [{ ...LIVRO[1], id: 99, motivo: 'SO DO MES' }];
    let liberarAnoInteiro;
    // A primeira chamada depois da montagem (o ano) fica PRESA; a segunda (o
    // mes) responde na hora. Assim a lenta chega por ultimo, que e o caso.
    svc.getMovimentosMaterial
      .mockImplementationOnce(() => new Promise((resolve) => { liberarAnoInteiro = resolve; }))
      .mockImplementationOnce(() => Promise.resolve(doMes));

    const selects = [...container.querySelectorAll('.export-bar select')];
    // Troca o ano (carga presa) e, em seguida, o mes (carga rapida).
    selects[0].value = String(ANO_ATUAL - 1);
    selects[0].dispatchEvent(new Event('change', { bubbles: true }));
    selects[1].value = '2';
    selects[1].dispatchEvent(new Event('change', { bubbles: true }));
    await flush();

    expect(secao(container, 'Livro de movimentos').textContent).toContain('SO DO MES');

    liberarAnoInteiro(LIVRO);
    await flush();

    // O ano inteiro chegou depois e NAO tomou a tela: o filtro continua em
    // Fevereiro, e o livro continua sendo o dele.
    expect(secao(container, 'Livro de movimentos').textContent).toContain('SO DO MES');
    expect(secao(container, 'Livro de movimentos').textContent).not.toContain('NF 1234');

    cleanup();
  });

  test('o selo de minimo compara o DISPONIVEL, e nao o total das quatro', async () => {
    const { container, cleanup } = await montar();

    // 52 no total, bem acima do minimo de 20; 12 disponiveis, abaixo dele.
    expect(container.querySelector('.badge')).not.toBeNull();
    expect(container.textContent).toContain('Total nas quatro localizações');

    cleanup();
  });

  // QUATRO, e nao cinco: a Contagem saiu em 2026-08-08. Nao ha acao de ajustar
  // saldo, e a lista prova a ausencia -- um botao que a ressuscitasse cairia
  // aqui antes de chegar ao 400 do servidor.
  test('o operador ve as quatro acoes, com Consumir na frente', async () => {
    const { container, cleanup } = await montar();

    const acoes = [...container.querySelectorAll('.page__actions .btn')]
      .map(b => b.textContent.trim());
    expect(acoes).toEqual([
      'Consumir', 'Entrada', 'Transferir', 'Editar cadastro',
    ]);

    cleanup();
  });

  test('quem so consulta le a ficha inteira e nao ve acao nenhuma', async () => {
    logarComo({ mapoteca: CONSULTA });
    const { container, cleanup } = await montar();

    expect(container.textContent).toContain('Livro de movimentos');
    expect(container.querySelectorAll('.page__actions .btn')).toHaveLength(0);

    cleanup();
  });

  // LIVRO QUE NAO CARREGOU NAO E LIVRO VAZIO.
  //
  // O `.catch(() => [])` das duas leituras acessorias fazia a secao pintar a
  // mensagem de vazio da tabela -- "Nenhum movimento neste período" -- quando o
  // que houve foi 500. Quem pergunta "por que o saldo caiu" lia que ninguem
  // lancou nada, e concluia que o saldo e que esta errado. As duas frases pedem
  // acoes opostas, e so uma delas traz o "Tentar de novo".
  test('falha do livro NAO se escreve com o texto do periodo vazio', async () => {
    svc.getMovimentosMaterial.mockRejectedValue(new Error('banco fora'));
    const { container, cleanup } = await montar();

    const doLivro = secao(container, 'Livro de movimentos');
    expect(doLivro.textContent).not.toContain('Nenhum movimento neste período');
    expect(doLivro.textContent).toContain('banco fora');
    expect(doLivro.textContent).toContain('Tentar de novo');

    // O resto da ficha continua de pe: o cadastro carregou, e a falha e da
    // secao dela.
    expect(container.querySelector('.page__title').textContent).toBe('Papel A0');
    expect(container.textContent).toContain('Estoque por localização');

    cleanup();
  });

  test('o livro volta ao lugar quando o "Tentar de novo" da certo', async () => {
    svc.getMovimentosMaterial.mockRejectedValueOnce(new Error('banco fora'));
    const { container, cleanup } = await montar();

    const botao = [...secao(container, 'Livro de movimentos').querySelectorAll('button')]
      .find(b => b.textContent.includes('Tentar de novo'));
    botao.click();
    await flush();

    const doLivro = secao(container, 'Livro de movimentos');
    expect(doLivro.textContent).not.toContain('Tentar de novo');
    expect(doLivro.textContent).toContain('Transferência');

    cleanup();
  });

  // O grafico vazio le-se como "nao houve consumo", que e o oposto do que
  // aconteceu. E a mesma regra da aba Materiais do dashboard.
  test('falha do consumo do ano vira erro NO GRAFICO, e nao grafico vazio', async () => {
    svc.getConsumoMensal.mockRejectedValue(new Error('pit fora'));
    const { container, cleanup } = await montar();

    const grafico = container.querySelector('.chart-card');
    expect(grafico.textContent).toContain('pit fora');
    expect(grafico.textContent).toContain('Tentar de novo');
    // O livro carregou, e nao herda a falha do grafico.
    expect(secao(container, 'Livro de movimentos').textContent).toContain('Transferência');

    cleanup();
  });

  test('erro na carga mostra a mensagem e o botao de voltar', async () => {
    svc.getTipoMaterial.mockRejectedValueOnce(new Error('Tipo de material não encontrado'));
    const container = document.createElement('div');
    const cleanup = await renderInsumoFicha(container, {
      params: { id: '99' }, query: new URLSearchParams(),
    });
    await flush();

    expect(container.textContent).toContain('Tipo de material não encontrado');
    expect(container.textContent).toContain('Voltar');

    if (typeof cleanup === 'function') cleanup();
  });
});
