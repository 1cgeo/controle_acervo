import { describe, test, expect, vi, afterEach } from 'vitest';

vi.mock('chart.js', async () => await import('@components/charts/chart-stub.js'));

const DADOS = {
  total_pontos: 3490,
  total_missoes: 8,
  total_arquivos: 6980,
  total_gb: 76.72,
  por_tipo_arquivo: [
    { nome: 'Pacote do ponto', arquivos: '3490', mb: '75000' },
    { nome: 'Monografia', arquivos: '3490', mb: '5500' },
  ],
  por_mes: [{ mes: '2026-06', pontos: '120' }],
  por_missao: [{
    lote: 'Lote 1', pit: 'gov-rs-lote-1', projeto: 'GOV-RS SDP Nr 8155-BR',
    pontos: '668', aprovados: '600',
    primeiro_rastreio: '2018-03-20', ultimo_rastreio: '2018-05-17',
  }],
  ultimas_importacoes: [{
    lote: 'Lote 1', usuario: 'Cap Silva', pontos: '10', status: 'completed',
    completed_at: '2026-07-29T13:45:51.000Z', error_message: null,
  }],
};

vi.mock('@modules/acervo/services/ponto-controle-service.js', () => ({
  getDashboardPontoControle: vi.fn(() => Promise.resolve(DADOS)),
}));

import { renderPontoControleTab } from './ponto-controle-tab.js';
import * as servico from '@modules/acervo/services/ponto-controle-service.js';

describe('aba de ponto de controle do dashboard', () => {
  // Toda aba montada aqui e DESCARTADA no fim do caso. Os graficos dela assinam
  // a troca de tema na `window`, e uma aba que ninguem solta continua se
  // repintando dentro dos casos seguintes: o caso do final, que conta as
  // instancias do Chart.js, contava o lixo dos outros.
  const montadas = [];
  const montar = async (container) => {
    const controle = await renderPontoControleTab(container);
    montadas.push(controle);
    return controle;
  };

  afterEach(() => {
    montadas.splice(0).forEach(c => c.cleanup());
  });

  test('monta a aba inteira, com as DUAS tabelas no DOM', async () => {
    // Esta prova existe por causa de um defeito real: a aba passava o objeto
    // devolvido pelo createDataTable ao appendChild, em vez do `.element` dele.
    // O clique na aba morria com "parameter 1 is not of type 'Node'" e a aba
    // ficava pela metade, sem erro visivel na tela.
    const container = document.createElement('div');
    await montar(container);

    expect(container.querySelectorAll('table').length).toBe(2);
    expect(container.querySelectorAll('.data-table-wrapper').length).toBe(2);

    // O createDataTable aceita `title` e nao o desenha: quem titula e a aba.
    const titulos = Array.from(container.querySelectorAll('.chart-card__title'))
      .map(h => h.textContent);
    expect(titulos).toContain('Missões com ponto de controle');
    expect(titulos).toContain('Últimas importações');
  });

  test('os quatro cartões trazem o número que veio do servidor', async () => {
    const container = document.createElement('div');
    await montar(container);

    const texto = container.textContent;
    expect(texto).toContain('3.490');   // pontos
    expect(texto).toContain('6.980');   // arquivos
    expect(texto).toContain('76,72');   // GB
  });

  test('a linha da missão e a da importação chegam à tabela', async () => {
    const container = document.createElement('div');
    await montar(container);

    const linhas = Array.from(container.querySelectorAll('tbody tr'))
      .map(tr => Array.from(tr.children).map(td => td.textContent).join(' '));
    expect(linhas.some(l => l.includes('GOV-RS SDP Nr 8155-BR'))).toBe(true);
    expect(linhas.some(l => l.includes('600 de 668'))).toBe(true);
    expect(linhas.some(l => l.includes('Concluída'))).toBe(true);
  });

  // A aba inteira vem de UMA chamada: ou se sabe tudo, ou nao se sabe nada.
  // Antes, a falha deixava quatro cartoes com a palavra "Erro" ao lado de duas
  // tabelas dizendo "Nenhuma missao importada ainda" -- a frase de quem nunca
  // importou. Endpoint fora do ar lia-se como missao nenhuma no acervo.
  test('erro do servidor vira estado de erro, e nao tabela vazia', async () => {
    servico.getDashboardPontoControle.mockRejectedValueOnce(new Error('sem rede'));
    const container = document.createElement('div');
    await montar(container);

    expect(container.querySelector('.dashboard-erro')).not.toBeNull();
    // A mensagem do SERVIDOR: ela distingue "sem permissao" de "erro no banco".
    expect(container.querySelector('.dashboard-erro__detalhe').textContent).toBe('sem rede');
    // A frase do cadastro vazio NAO pode aparecer aqui.
    expect(container.textContent).not.toContain('Nenhuma missão importada ainda.');
    expect(container.querySelectorAll('.data-table__empty').length).toBe(0);
  });

  test('"Tentar de novo" devolve os paineis da aba', async () => {
    servico.getDashboardPontoControle.mockRejectedValueOnce(new Error('sem rede'));
    const container = document.createElement('div');
    await montar(container);

    container.querySelector('.dashboard-erro .btn').click();
    await new Promise(r => setTimeout(r, 0));

    expect(container.querySelector('.dashboard-erro')).toBeNull();
    expect(container.querySelectorAll('.data-table-wrapper').length).toBe(2);
  });

  // O auto-refresh de 60 s chama a mesma carga. Sem devolver os nos ao
  // container, a carga que desse certo pintaria elementos fora do DOM e a caixa
  // de erro ficaria na tela para sempre.
  test('a carga seguinte devolve os paineis sozinha, sem clique', async () => {
    servico.getDashboardPontoControle.mockRejectedValueOnce(new Error('sem rede'));
    const container = document.createElement('div');
    const controle = await montar(container);
    expect(container.querySelector('.dashboard-erro')).not.toBeNull();

    await controle.refresh();

    expect(container.querySelector('.dashboard-erro')).toBeNull();
    expect(container.querySelectorAll('table').length).toBeGreaterThan(0);
  });

  test('refresh recarrega sem remontar o DOM', async () => {
    const container = document.createElement('div');
    const controle = await montar(container);
    const antes = container.querySelectorAll('table').length;

    await controle.refresh();

    expect(container.querySelectorAll('table').length).toBe(antes);
    expect(servico.getDashboardPontoControle).toHaveBeenCalledTimes(2);
  });

  // C1-N02: a aba criava dois graficos e duas tabelas e o `cleanup` dela so
  // levantava uma bandeira. Depois que os graficos passaram a assinar a troca de
  // tema na `window`, o cartao de uma aba descartada continuava vivo e se
  // repintava a cada clique no botao de tema -- uma instancia nova de Chart.js
  // por visita anterior a esta aba.
  test('depois do cleanup, trocar o tema nao repinta a aba descartada', async () => {
    const { instanciasChart } = await import('@components/charts/chart-stub.js');
    const { toggleTheme } = await import('@utils/theme.js');

    // Sem o `montar`: esta aba e descartada aqui dentro, na hora, e nao no
    // `afterEach`.
    const container = document.createElement('div');
    const controle = await renderPontoControleTab(container);

    controle.cleanup();
    instanciasChart.length = 0;

    toggleTheme();

    expect(instanciasChart.length).toBe(0);
  });
});
