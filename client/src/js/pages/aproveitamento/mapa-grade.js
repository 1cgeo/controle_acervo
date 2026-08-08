import { el } from '@utils/dom.js';

/**
 * A GRADE DO ANO do aproveitamento: uma linha por pessoa, 53 colunas de semana,
 * uma coluna "Ano" e as cinco faixas de cor.
 *
 * DOIS LUGARES A DESENHAM, e por isso ela saiu da tela: `#/aproveitamento`
 * desenha uma linha por militar da Divisão, e a seção "Meu aproveitamento" de
 * `#/perfil` desenha UMA linha, a da própria pessoa. As duas montagens são a
 * mesma tabela com números diferentes; copiadas, divergiriam no primeiro ajuste
 * de faixa, e a que ficasse para trás seria a de `#/perfil`, que é a menos
 * olhada.
 *
 * O QUE NÃO PODE SE PERDER, e é o coração da leitura: CÉLULA SEM COR é "não
 * estava na Divisão", e é diferente de célula VERMELHA, que é "estava e não
 * rendeu". Com as duas em cinza, a chegada em março se leria como quatro meses
 * de licença. É por isso que `faixa()` devolve `'fora'` para nulo antes de
 * qualquer comparação de número, e que a legenda nomeia as duas.
 *
 * A LEGENDA VIAJA JUNTO (`legendaDoMapa`). Quem vê a Divisão inteira compara as
 * linhas umas com as outras e adivinha a escala; quem vê a própria linha sozinha
 * não tem com o que comparar, e sem a legenda a cor não diz nada.
 *
 * O QUE FICA EM CADA TELA: o texto do resumo, o rodapé de divergências, o
 * seletor de militar e o que acontece ao clicar na linha. Aqui mora só o que as
 * duas desenham igual, mais as contas cuja divergência ninguém veria.
 */

// As 53 semanas do ano, contadas a partir de 1º de janeiro. O rótulo de mês é
// posto na PRIMEIRA semana de cada mês, e as demais ficam sem rótulo: doze
// marcas num eixo de 53 células já orientam, e 53 rótulos não caberiam.
const MESES_ABREV = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN',
  'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

export const SEMANAS = 53;

/**
 * A semana de um dia, pela MESMA régua do servidor: bloco de sete dias a partir
 * do dia 1. As duas contas têm de dar igual, senão o rótulo de mês aponta para a
 * coluna errada.
 */
export function semanaDoDia(ano, mes, dia) {
  const inicio = Date.UTC(ano, 0, 1);
  const alvo = Date.UTC(ano, mes, dia);
  return Math.floor((alvo - inicio) / 86400000 / 7) + 1;
}

/**
 * Cinco faixas, e não um gradiente: a diferença entre 71% e 73% não muda decisão
 * nenhuma, e um gradiente convida a compará-las.
 *
 * NULO É `'fora'`, e a conferência vem ANTES de qualquer número: "não estava na
 * Divisão" não é um aproveitamento baixo, é a ausência de medida.
 */
export function faixa(disponibilidade) {
  if (disponibilidade == null) return 'fora';
  const v = Number(disponibilidade);
  if (v >= 99.5) return 'f100';
  if (v >= 75) return 'f75';
  if (v >= 50) return 'f50';
  if (v >= 25) return 'f25';
  return 'f0';
}

export const pct = (valor) =>
  `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

// A data do servidor chega como 'AAAA-MM-DD'. O recorte de dez caracteres torna
// a comparacao de texto valida mesmo se vier com hora junto.
export const iso = (valor) => (valor ? String(valor).slice(0, 10) : null);

const nomeCurto = (r) => `${r.posto_abrev || ''} ${r.nome_guerra || ''}`.trim();

/** As seis amostras, na ordem em que a escala desce. */
export function legendaDoMapa() {
  const amostra = (classe, texto) => el('span', {}, [
    el('span', { className: `mapa-efetivo__amostra mapa-efetivo__celula--${classe}` }),
    texto,
  ]);
  return el('div', { className: 'mapa-efetivo__legenda' }, [
    amostra('f100', '100%'),
    amostra('f75', '75% ou mais'),
    amostra('f50', '50% ou mais'),
    amostra('f25', '25% ou mais'),
    amostra('f0', 'abaixo de 25%'),
    // A ÚLTIMA É A QUE MAIS IMPORTA, e é a única que não fala de percentual:
    // "fora da DGEO" é a ausência de medida, e não a medida mais baixa.
    amostra('fora', 'fora da DGEO'),
  ]);
}

/** A linha de rótulo de mês, alinhada às semanas em que cada mês começa. */
function cabecalhoMeses(ano) {
  const celulas = [el('th', { className: 'mapa-efetivo__nome' })];
  const rotuloNaSemana = new Map();
  for (let m = 0; m < 12; m += 1) {
    rotuloNaSemana.set(semanaDoDia(ano, m, 1), MESES_ABREV[m]);
  }
  for (let s = 1; s <= SEMANAS; s += 1) {
    celulas.push(el('th', {
      className: 'mapa-efetivo__mes',
      textContent: rotuloNaSemana.get(s) || '',
      // O rótulo de mês ocupa a coluna de UMA semana, então ele fica estreito.
      // O `title` diz o mês inteiro para quem passar o ponteiro.
      title: rotuloNaSemana.get(s) || '',
    }));
  }
  celulas.push(el('th', { className: 'mapa-efetivo__total', textContent: 'Ano' }));
  return el('tr', {}, celulas);
}

/**
 * Os impedimentos que cruzam a semana, já escritos como a célula os mostra.
 *
 * A janela da semana é convertida em dias do calendário para casar com o
 * intervalo do impedimento sem refazer a conta do servidor no cliente.
 */
function impedimentosDaSemana(impedimentos, usuarioUuid, ano, semana) {
  const inicioAno = new Date(Date.UTC(ano, 0, 1));
  const primeiroDia = new Date(inicioAno.getTime() + (semana - 1) * 7 * 86400000);
  const ultimoDia = new Date(primeiroDia.getTime() + 6 * 86400000);
  const dataIso = (d) => d.toISOString().slice(0, 10);

  return impedimentos
    .filter(i => i.usuario_uuid === usuarioUuid
      && iso(i.data_inicio) <= dataIso(ultimoDia)
      && (!i.data_fim || iso(i.data_fim) >= dataIso(primeiroDia)))
    .map(i => `${i.descricao} (${i.percentual}%)`);
}

/**
 * A tabela do ano, ou a frase que explica por que não há tabela.
 *
 * @param {Object} opcoes
 * @param {number} opcoes.ano - O ano desenhado, que é a régua das 53 colunas.
 * @param {Array} opcoes.semanas - Uma linha por (pessoa, semana), do servidor.
 * @param {Array} opcoes.anual - Uma linha por pessoa, com o fechamento do ano.
 * @param {Array} [opcoes.impedimentos] - Para o `title` da célula explicar a cor.
 * @param {?Function} [opcoes.onLinhaClick] - Recebe o militar da linha clicada.
 * @param {?string} [opcoes.destaqueUuid] - A linha que a rota apontou.
 * @param {string} [opcoes.vazio] - O texto de quando `anual` vem vazio.
 * @returns {HTMLElement}
 */
export function montarMapaEfetivo({
  ano,
  semanas = [],
  anual = [],
  impedimentos = [],
  onLinhaClick = null,
  destaqueUuid = null,
  vazio = 'Nenhum militar com passagem pela DGEO neste ano.',
}) {
  if (!anual.length) {
    return el('p', {
      className: 'mapa-efetivo__vazio',
      style: { padding: '24px', color: 'var(--text-secondary)' },
      textContent: vazio,
    });
  }

  // O servidor devolve uma linha por (pessoa, semana). Indexar aqui evita um
  // laço aninhado de 30 x 53 buscas na lista.
  const porPessoa = new Map();
  for (const s of semanas) {
    if (!porPessoa.has(s.usuario_uuid)) porPessoa.set(s.usuario_uuid, new Map());
    porPessoa.get(s.usuario_uuid).set(Number(s.semana), s);
  }

  const linhas = anual.map(militar => {
    const doMilitar = porPessoa.get(militar.usuario_uuid) || new Map();
    const nome = nomeCurto(militar);

    const celulas = [
      el('td', {
        className: 'mapa-efetivo__nome',
        textContent: nome,
        title: militar.ativo ? nome : `${nome} (desativado no cadastro)`,
      }),
    ];

    for (let s = 1; s <= SEMANAS; s += 1) {
      const semana = doMilitar.get(s);
      const disponibilidade = semana && Number(semana.dias_na_dgeo) > 0
        ? Number(semana.disponibilidade)
        : null;

      // O DENOMINADOR DA SEMANA É A SEMANA INTEIRA, e é por isso que ele
      // precisa estar à vista: quem chega na quarta sai 71,4% com 5 de 7
      // dias, e fica da mesma cor de quem esteve a semana toda a 71%. Sem
      // "5 de 7 dias", a célula confunde "não estava" com "não rendeu".
      const explicacao = disponibilidade == null
        ? 'Fora da DGEO'
        : [
          pct(disponibilidade),
          `${semana.dias_na_dgeo} de ${semana.dias} dias na DGEO`,
          ...impedimentosDaSemana(impedimentos, militar.usuario_uuid, ano, s),
        ].join('\n');

      celulas.push(el('td', {
        className: `mapa-efetivo__celula mapa-efetivo__celula--${faixa(disponibilidade)}`,
        title: explicacao,
      }));
    }

    celulas.push(el('td', {
      className: 'mapa-efetivo__total',
      textContent: pct(militar.aproveitamento),
      title: `${militar.dias_na_dgeo} de ${militar.dias_do_ano} dias na DGEO`,
    }));

    const destacada = Boolean(destaqueUuid) && militar.usuario_uuid === destaqueUuid;

    // `--estatica` é a linha que NÃO abre nada. Sem ela a mão do ponteiro
    // prometeria, na própria página, uma ficha que já está logo abaixo.
    const tr = el('tr', {
      className: 'mapa-efetivo__linha'
        + (onLinhaClick ? '' : ' mapa-efetivo__linha--estatica')
        + (destacada ? ' mapa-efetivo__linha--destaque' : ''),
      onClick: onLinhaClick ? () => onLinhaClick(militar) : undefined,
    }, celulas);

    // O destaque vem do link, e o CSS da tela não o conhece. Estilo em linha
    // é o que faz o realce aparecer sem tocar na folha de estilo.
    if (destacada) tr.style.outline = '2px solid var(--color-primary)';

    return tr;
  });

  return el('table', { className: 'mapa-efetivo__tabela' }, [
    el('thead', {}, [cabecalhoMeses(ano)]),
    el('tbody', {}, linhas),
  ]);
}

/**
 * As duas médias do fechamento anual, e nunca uma só.
 *
 * A média SIMPLES dá o mesmo peso a quem ficou uma semana e a quem ficou o ano,
 * e é assim que um recém-chegado com 4% derruba o número da Divisão. A PONDERADA
 * responde a pergunta certa: dos dias que as pessoas estiveram aqui, quantos
 * renderam.
 *
 *   dias disponíveis = aproveitamento_i x dias_do_ano_i / 100  (o numerador do
 *                      servidor, que tem o ANO no denominador)
 *   ponderada        = SOMA(dias disponíveis) / SOMA(dias_na_dgeo) x 100
 *
 * NUMA PESSOA SÓ as duas continuam distintas, e é o que a tela `#/perfil`
 * mostra: a simples é o aproveitamento sobre o ano inteiro (17% para quem chegou
 * em novembro), e a ponderada é sobre os dias em que ela esteve aqui. Quem chegou
 * em novembro e rendeu tudo lê 17% e 100%, e as duas são verdade.
 *
 * A CONTA MORA AQUI e a FRASE mora em cada tela: "Divisão" e "você" pedem
 * palavras diferentes, mas um número diferente seria defeito.
 *
 * @param {Array} anual
 * @returns {{ponderada:number, simples:number, militares:number,
 *            diasNaDgeo:number, diasDisponiveis:number}}
 */
export function resumoPonderado(anual = []) {
  const militares = anual.length;
  const diasNaDgeo = anual.reduce((t, m) => t + Number(m.dias_na_dgeo || 0), 0);
  const diasDisponiveis = anual.reduce(
    (t, m) => t + (Number(m.aproveitamento) * Number(m.dias_do_ano || 0)) / 100, 0
  );
  const simples = militares
    ? anual.reduce((t, m) => t + Number(m.aproveitamento), 0) / militares
    : 0;
  // Ninguém com dia na Divisão faz o denominador zerar. Sem a guarda o número
  // sairia NaN, que se lê como defeito da tela e não como base vazia.
  const ponderada = diasNaDgeo > 0 ? (diasDisponiveis / diasNaDgeo) * 100 : 0;

  return { ponderada, simples, militares, diasNaDgeo, diasDisponiveis };
}

/**
 * O ano à frente do corrente é PROJEÇÃO, e não medida.
 *
 * Impedimento sem data de término se estende por todo ano futuro, e o mapa de
 * 2027 desenha isso como se já tivesse acontecido. O aviso é o que separa a
 * conta que o sistema fez da coisa que o mundo decidiu, e vale igual nas duas
 * telas: o próprio ano futuro é projeção pela mesma razão.
 *
 * @param {number} ano
 * @param {number} [anoCorrente]
 * @returns {?HTMLElement} nulo quando não há nada a avisar
 */
export function avisoProjecao(ano, anoCorrente = new Date().getFullYear()) {
  if (ano <= anoCorrente) return null;

  return el('p', {
    className: 'efetivo-projecao',
    style: { margin: '0', color: 'var(--color-warning)' },
    textContent: `${ano} ainda não aconteceu. Este mapa é projeção`
      + ' dos impedimentos e das passagens em aberto, e não medida.',
  });
}

/**
 * Os anos que o seletor oferece: os que TÊM passagem, e não quatro fixos.
 *
 * Passagem aberta não tem ano de fim, então ela vale até o ano que vem: é o
 * horizonte da projeção, e oferecer mais seria oferecer adivinhação. O ano
 * corrente e o ano em tela entram sempre, senão uma base vazia deixaria o
 * seletor sem opção.
 *
 * @param {Array} periodos - As passagens, SEM recorte de ano.
 * @param {{anoCorrente:number, anoSelecionado:number}} janela
 * @returns {number[]} do mais recente para o mais antigo
 */
export function anosComPassagem(periodos = [], { anoCorrente, anoSelecionado }) {
  const anos = new Set([anoCorrente, anoSelecionado]);
  for (const p of periodos) {
    const inicio = Number(String(p.data_inicio).slice(0, 4));
    if (!Number.isFinite(inicio)) continue;
    const fim = p.data_fim
      ? Number(String(p.data_fim).slice(0, 4))
      : anoCorrente + 1;
    for (let a = inicio; a <= Math.max(inicio, fim); a += 1) anos.add(a);
  }
  return [...anos].sort((a, b) => b - a);
}
