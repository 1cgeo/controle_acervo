import { describe, test, expect } from 'vitest';
import { createStatsCard } from './stats-card.js';
import { formatCurrency } from '@utils/format.js';

// O CARTAO MOSTRAVA DINHEIRO CORTADO, e a causa nao era largura de gosto.
//
// `Intl` do BRL separa `R$` do numero com ESPACO INSECAVEL (U+00A0). Isso faz
// de `R$ 660.520,50` um token unico, que nao quebra em lugar nenhum: ou cabe,
// ou transborda. Com o piso do grid em 200px ele transbordava, e a tela
// mostrava `R$ 660.520,5`, que parece um valor valido e nao e.
//
// O conserto tem duas metades, e estes casos guardam as duas: o piso do grid
// passou a caber o pior caso real (CSS), e o valor inteiro fica no `title`,
// para a reticencia do caso patologico nunca esconder o numero.

describe('stats-card: o valor de dinheiro nao se perde', () => {
  // A PREMISSA do conserto. Se um dia o Intl passar a usar espaco comum, o
  // valor volta a quebrar sozinho e este caso avisa que o motivo mudou.
  test('o real formatado traz espaco INSECAVEL, e por isso nao quebra', () => {
    const v = formatCurrency(660520.5);
    expect(v).toBe('R$ 660.520,50');
    expect(v.includes(' ')).toBe(true);
    expect(v.includes(' ')).toBe(false);
  });

  test('o title carrega o valor inteiro, e nao o que coube na tela', () => {
    const card = createStatsCard({
      title: 'Recebido',
      value: formatCurrency(660520.5),
      icon: '',
    });
    const valor = card.querySelector('.stats-card__value');
    expect(valor.title).toBe('R$ 660.520,50');
    expect(valor.title).toBe(valor.textContent);
  });

  test('atualizar o cartao atualiza o title junto', () => {
    const card = createStatsCard({ title: 'Recebido', value: formatCurrency(1), icon: '' });
    const valor = card.querySelector('.stats-card__value');

    card.update({ value: formatCurrency(1234567.89) });

    expect(valor.textContent).toBe('R$ 1.234.567,89');
    // Sem esta linha o `title` ficaria preso no valor da PRIMEIRA pintura, e a
    // dica de tela passaria a mentir a cada recarga do painel.
    expect(valor.title).toBe(valor.textContent);
  });

  test('o sufixo entra no title, como entra no texto', () => {
    const card = createStatsCard({ title: '% recebido', value: '73,2', icon: '', suffix: '%' });
    const valor = card.querySelector('.stats-card__value');
    expect(valor.textContent).toBe('73,2 %');
    expect(valor.title).toBe('73,2 %');
  });

  test('em carregamento o title esvazia, para nao sobrar dica do valor velho', () => {
    const card = createStatsCard({ title: 'Recebido', value: formatCurrency(99), icon: '' });
    const valor = card.querySelector('.stats-card__value');

    card.update({ loading: true });

    expect(valor.textContent).toBe('');
    expect(valor.title).toBe('');
  });
});
