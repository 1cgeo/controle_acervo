import { el } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import {
  getGradePit,
  getAnosMetaPit,
  salvarExecucaoPit,
  codigoMetaPit,
} from '@services/plataforma-service.js';
import { isAdmin } from '@store/auth-store.js';

const MESES = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN',
  'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

// Os dois modos de trabalho do ano. Não são duas telas nem duas abas: a grade é
// a mesma e os dois números ficam sempre visíveis. O modo só decide qual deles o
// clique edita.
const PLANEJAR = 'quantidade_planejada';
const EXECUTAR = 'quantidade';

const numero = (v) => (v == null ? '·' : String(v));

/**
 * Execução do PIT (#/execucao_pit): a grade do ano.
 *
 * O QUE ELA SUBSTITUIU. Até 2026-08-02 a tela era ano MAIS mês, com uma lista de
 * 37 linhas e um campo por linha. Para saber se a meta 4.2 estava atrasada era
 * preciso trocar o mês sete vezes e somar de cabeça, e o mês vazio não se
 * distinguia do mês zerado. O trabalho é anual, então o mês virou coluna.
 *
 * DOIS NÚMEROS POR CÉLULA, e é isso que desfaz as duas abas da planilha. A
 * PLANEJ_PIT e a EXEC_PIT têm as MESMAS linhas, as mesmas doze colunas e a mesma
 * quantidade anual: a única diferença entre elas é qual dos dois a célula
 * guarda. Aqui o realizado fica em cima e o planejado embaixo, menor, e o
 * alternador "Planejar / Executar" só decide qual deles o clique edita. Nenhum
 * dos dois some da tela em nenhum dos modos.
 *
 * A COR COMPARA O PAR, e é o que responde "estou atrasado" sem ninguém somar:
 * verde alcançou o plano do mês, âmbar ficou no meio, vermelho tinha plano e não
 * teve nada. Mês sem plano fica neutro, porque não há o que comparar.
 *
 * `·` É VAZIO E `0` É ZERO. "Ninguém lançou" e "conferi e não houve" são coisas
 * diferentes, e é a mesma honestidade de três estados do mapa do efetivo.
 *
 * SÓ A FOLHA RECEBE LANÇAMENTO. A meta que se subdivide vira linha de grupo com
 * o subtotal dos itens; quem entrega é o item. O servidor recusa lançamento no
 * cabeçalho, e oferecê-lo aqui seria oferecer o 400.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderExecucaoPit(container, _ctx) {
  let disposed = false;
  const podeEscrever = isAdmin();

  const hoje = new Date();
  let anoSelecionado = hoje.getFullYear();
  let modo = EXECUTAR;
  let linhas = [];

  const anoFilter = createSelectField({
    label: 'Ano',
    options: [],
    placeholder: 'Ano',
    value: anoSelecionado,
    onChange: (valor) => {
      if (valor === null) return;
      anoSelecionado = Number(valor);
      load();
    },
  });

  const modoFilter = createSelectField({
    label: 'Editando',
    options: [
      { value: EXECUTAR, label: 'Executar (o que foi feito)' },
      { value: PLANEJAR, label: 'Planejar (o que se pretende)' },
    ],
    value: modo,
    placeholder: null,
    onChange: (valor) => {
      if (valor === null) return;
      modo = valor;
      desenhar();
    },
  });

  const grade = el('div', { className: 'grade-pit' });
  // O `<tr>` de cada linha de grupo, para o subtotal ser corrigido sem
  // refazer a grade.
  const gruposPorNumero = new Map();
  const resumo = el('p', { style: { margin: '0 0 8px' } });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Execução do PIT' }),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, podeEscrever ? [anoFilter.element, modoFilter.element] : [anoFilter.element]),
    resumo,
    grade,
    montarLegenda(),
  ]);
  container.appendChild(page);

  function montarLegenda() {
    const amostra = (classe, texto) => el('span', {}, [
      el('span', { className: `grade-pit__amostra grade-pit__celula--${classe}` }),
      texto,
    ]);
    // A cor é do ACUMULADO até aquele mês, e não do mês sozinho: é o que faz
    // trabalho adiantado deixar de aparecer como atraso no mês em que ele estava
    // planejado. Mês que ainda corre e mês futuro não recebem cor.
    return el('div', { className: 'grade-pit__legenda' }, [
      el('span', { textContent: 'Cor: posição ACUMULADA até o mês.' }),
      amostra('atingiu', 'em dia ou adiantado'),
      amostra('parcial', 'atrasado'),
      amostra('nada', 'nada entregue'),
      el('span', { textContent: '·  ninguém lançou   |   0  conferido, não houve' }),
    ]);
  }

  /**
   * O último mês que JÁ FECHOU no ano escolhido.
   *
   * Mês que ainda corre e mês futuro não recebem cor: pintar agosto de vermelho
   * no dia 2 de agosto diria que se atrasou o que ainda nem começou, e pintar
   * dezembro diria isso de um plano que só vence daqui a meio ano.
   */
  function mesLimite() {
    const anoCorrente = hoje.getFullYear();
    if (anoSelecionado < anoCorrente) return 12;
    if (anoSelecionado > anoCorrente) return 0;
    return hoje.getMonth();
  }

  /**
   * A cor de cada mês da linha, pela POSIÇÃO ACUMULADA no fim dele.
   *
   * COMPARAR O MÊS ISOLADO ESTAVA ERRADO, e o caso real que mostrou isso: a meta
   * 1.1 de 2026 planejou 4 em abril, 1 em maio, 1 em junho e 1 em julho, e
   * entregou 6 em maio, 2 em junho e 0 em julho. Julho ficava VERMELHO, embora o
   * que ele pedia já estivesse entregue desde maio -- o trabalho foi adiantado, e
   * a régua mensal não enxerga adiantamento nem recuperação de atraso.
   *
   * No acumulado, abril continua vermelho (no fim de abril não havia nada dos 4
   * prometidos), e maio em diante fica verde: 6 contra 5, 8 contra 6, 8 contra 7.
   * É a história certa, "atrasou em abril e recuperou em maio", e é a que o mês
   * isolado não conta.
   */
  function acumuladoDaLinha(linha) {
    const limite = mesLimite();
    const cores = [];
    let plan = 0;
    let real = 0;

    for (let mes = 1; mes <= 12; mes += 1) {
      plan += valorDoMes(linha, mes, PLANEJAR) || 0;
      real += valorDoMes(linha, mes, EXECUTAR) || 0;

      let classe = '';
      if (mes <= limite && plan > 0) {
        if (real >= plan) classe = ' grade-pit__celula--atingiu';
        else if (real > 0) classe = ' grade-pit__celula--parcial';
        else classe = ' grade-pit__celula--nada';
      }
      cores[mes] = { plan, real, classe };
    }
    return cores;
  }

  /**
   * Troca a célula por um campo, salva ao sair e volta ao texto.
   *
   * UM campo por vez, e não 444 na tela. A grade tem 37 linhas por 12 meses, e
   * montar um `<input>` em cada uma pesaria o DOM sem nenhum ganho: só se edita
   * uma célula de cada vez.
   */
  function editar(td, linha, mes) {
    if (!podeEscrever || !linha.folha) return;
    if (td.querySelector('input')) return;

    const atual = valorDoMes(linha, mes, modo);

    const input = el('input', {
      className: 'grade-pit__edicao',
      type: 'number',
      min: '0',
      step: '1',
      value: atual == null ? '' : String(atual),
      'aria-label': `${modo === PLANEJAR ? 'Planejado' : 'Realizado'} de ${MESES[mes - 1]} na meta ${codigoMetaPit(linha)}`,
    });

    td.innerHTML = '';
    td.appendChild(input);
    input.focus();
    input.select();

    let encerrado = false;

    const encerrar = async (salvar) => {
      if (encerrado) return;
      encerrado = true;

      // `gravar` redesenha a LINHA inteira quando o valor muda, porque a cor
      // acumulada dos meses seguintes depende dele. Aqui a célula só se refaz
      // se nada tiver sido salvo: Escape, valor igual ou erro.
      if (salvar) await gravar(linha, mes, input.value.trim(), atual);
      if (td.querySelector('input')) desenharCelula(td, linha, mes);
    };

    input.addEventListener('blur', () => encerrar(true));
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { e.preventDefault(); input.blur(); }
      if (e.key === 'Escape') { e.preventDefault(); encerrar(false); }
      // Tab sai pelo `blur`, que já salva; o navegador leva o foco à próxima
      // célula sozinho.
    });
  }

  function valorDoMes(linha, mes, campo) {
    const m = (linha.meses || []).find(x => Number(x.mes) === mes);
    if (!m) return null;
    return campo === PLANEJAR ? m.planejada : m.realizada;
  }

  async function gravar(linha, mes, bruto, anterior) {
    // Campo esvaziado APAGA o número daquele modo, e é deliberado: é o único
    // jeito de desfazer um lançamento errado sem uma segunda ação. O servidor
    // apaga a linha inteira quando os dois números e os dois campos ficam nulos.
    const valor = bruto === '' ? null : Number(bruto);

    if (bruto !== '' && (!Number.isInteger(valor) || valor < 0)) {
      showError('A quantidade tem de ser um número inteiro, zero ou mais');
      return;
    }
    if (valor === anterior) return;

    try {
      await salvarExecucaoPit({
        // `Number` porque o BIGSERIAL chega como STRING no JSON (o pg-promise
        // não arrisca perder precisão), e o Joi desta rota é `.strict()`: ele
        // recusa '18' com "meta_id must be a number" em vez de converter. A
        // validação estrita é deliberada aqui, então quem converte é o cliente.
        meta_id: Number(linha.meta_id),
        mes,
        // Só o campo do MODO vai no corpo. Omitir o outro é "não mexer nele", e
        // é o que permite lançar o realizado sem carregar o plano junto.
        [modo]: valor,
      });
      if (disposed) return;

      aplicarLocalmente(linha, mes, valor);
      redesenharLinha(linha);
      montarResumo();
      showSuccess(modo === PLANEJAR ? 'Planejamento salvo' : 'Execução lançada');
    } catch (err) {
      if (disposed) return;
      showError(err.message || 'Erro ao salvar');
    }
  }

  // A mesma conta que o servidor fez. Refazer a consulta redesenharia a grade
  // inteira e tiraria o foco de quem está percorrendo os meses com Tab.
  function aplicarLocalmente(linha, mes, valor) {
    if (!linha.meses) linha.meses = [];
    let m = linha.meses.find(x => Number(x.mes) === mes);
    if (!m) {
      m = { mes, planejada: null, realizada: null };
      linha.meses.push(m);
    }
    if (modo === PLANEJAR) m.planejada = valor;
    else m.realizada = valor;

    linha.planejado = linha.meses.reduce((t, x) => t + (x.planejada || 0), 0);
    linha.realizado = linha.meses.reduce((t, x) => t + (x.realizada || 0), 0);
    // O acumulado guardado envelheceu: mudar um mês muda a cor de todos os
    // seguintes, que é justamente o que a régua acumulada faz.
    linha.__acumulado = null;
  }

  function desenharCelula(td, linha, mes) {
    const planejada = valorDoMes(linha, mes, PLANEJAR);
    const realizada = valorDoMes(linha, mes, EXECUTAR);
    const atual = mes === hoje.getMonth() + 1 && anoSelecionado === hoje.getFullYear();

    // O acumulado é da LINHA inteira, então ele é calculado uma vez por
    // redesenho e guardado nela. Recalcular a cada célula seria doze passadas
    // sobre os mesmos doze meses.
    if (!linha.__acumulado) linha.__acumulado = acumuladoDaLinha(linha);
    const ate = linha.__acumulado[mes];

    td.className = `grade-pit__celula${ate.classe}`
      + (atual ? ' grade-pit__celula--mes-atual' : '');
    // O `title` mostra as DUAS contas: o mês, que é o que a célula escreve, e o
    // acumulado, que é o que a cor diz. Sem ele, uma célula verde com realizado
    // zero se leria como erro.
    td.title = `${MESES[mes - 1]}: planejado ${numero(planejada)}, realizado ${numero(realizada)}`
      + `
até ${MESES[mes - 1]}: planejado ${ate.plan}, realizado ${ate.real}`;
    td.innerHTML = '';
    td.append(
      el('span', { className: 'grade-pit__realizado', textContent: numero(realizada) }),
      el('span', { className: 'grade-pit__planejado', textContent: numero(planejada) })
    );
  }

  function linhaDaMeta(linha) {
    const tr = el('tr', {});
    // O `tr` fica na linha para o salvamento redesenhar SÓ ela. Sem isto, a
    // única saída seria refazer a grade, e refazer a grade destrói a célula
    // para onde o Tab acabou de levar o foco.
    linha.__tr = tr;
    tr.appendChild(el('td', { className: 'grade-pit__rotulo' }, [
      el('span', { className: 'grade-pit__codigo', textContent: codigoMetaPit(linha) }),
      linha.descricao || '',
    ]));

    for (let mes = 1; mes <= 12; mes += 1) {
      const td = el('td', {});
      desenharCelula(td, linha, mes);
      td.addEventListener('click', () => editar(td, linha, mes));
      tr.appendChild(td);
    }

    tr.append(...totaisDaLinha(linha));
    return tr;
  }

  function totaisDaLinha(linha) {
    return [
      el('td', { className: 'grade-pit__total', textContent: String(linha.realizado ?? 0) }),
      celulaPrevisto(linha),
      el('td', { className: 'grade-pit__total', textContent: percentual(linha) }),
    ];
  }

  /**
   * Redesenha UMA linha depois de salvar: os doze meses e as três colunas da
   * direita.
   *
   * OS DOZE, e não só o mês editado: a cor é do ACUMULADO, então mexer em maio
   * muda a cor de junho até dezembro. Redesenhar só a célula tocada deixaria a
   * linha contando duas histórias ao mesmo tempo.
   */
  function redesenharLinha(linha) {
    const tr = linha.__tr;
    if (!tr) return;

    const celulas = [...tr.children];
    for (let mes = 1; mes <= 12; mes += 1) {
      if (celulas[mes]) desenharCelula(celulas[mes], linha, mes);
    }
    // As três da direita são substituídas: elas não têm estado nem ouvinte.
    for (let i = 0; i < 3; i += 1) tr.removeChild(tr.lastChild);
    tr.append(...totaisDaLinha(linha));

    redesenharGrupo(linha.numero_meta);
  }

  function redesenharGrupo(numeroMeta) {
    const tr = gruposPorNumero.get(numeroMeta);
    if (!tr) return;
    const totais = subtotalDoGrupo(numeroMeta);
    const celulas = [...tr.children];
    celulas[celulas.length - 3].textContent = totais.realizado;
    celulas[celulas.length - 2].textContent = totais.previsto;
    celulas[celulas.length - 1].textContent = totais.percentual;
  }

  function subtotalDoGrupo(numeroMeta) {
    const doGrupo = linhas.filter(l => l.numero_meta === numeroMeta && l.folha);
    const realizado = doGrupo.reduce((t, l) => t + Number(l.realizado || 0), 0);
    const previsto = doGrupo.reduce((t, l) => t + Number(l.quantidade_prevista || 0), 0);
    return {
      realizado: String(realizado),
      previsto: previsto ? String(previsto) : '·',
      percentual: previsto
        ? `${((100 * realizado) / previsto).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
        : '·',
    };
  }

  /**
   * A quantidade do ANO, com a conferência contra a soma do planejado.
   *
   * Na planilha isso é a coluna "Total" ao lado da "Qnt", conferida com o olho.
   * Aqui a divergência fica vermelha e o `title` diz de quanto ela é: um plano
   * que não fecha com o compromisso do ano é erro de digitação em 100% dos
   * casos, e ele só aparece se alguém o procurar.
   */
  function celulaPrevisto(linha) {
    const previsto = linha.quantidade_prevista;
    const planejado = linha.planejado ?? 0;

    if (previsto == null) {
      return el('td', {
        className: 'grade-pit__total',
        textContent: '·',
        title: 'Sem quantidade prevista cadastrada. Ela se preenche na tela Metas do PIT.',
      });
    }

    const bate = planejado === previsto;
    return el('td', {
      className: `grade-pit__total${bate ? '' : ' grade-pit__divergente'}`,
      textContent: `${previsto}${linha.unidade ? ` ${linha.unidade}` : ''}`,
      title: bate
        ? `Planejado nos doze meses: ${planejado}`
        : `O plano soma ${planejado} e o ano promete ${previsto}. Faltam ${previsto - planejado}.`,
    });
  }

  function percentual(linha) {
    const previsto = Number(linha.quantidade_prevista);
    if (!previsto || previsto <= 0) return '·';
    const p = (100 * Number(linha.realizado || 0)) / previsto;
    return `${p.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;
  }

  function desenhar() {
    grade.innerHTML = '';
    gruposPorNumero.clear();

    if (!linhas.length) {
      grade.appendChild(el('p', {
        style: { padding: '24px', color: 'var(--text-secondary)' },
        textContent: 'Nenhuma meta cadastrada neste ano. Comece pela tela Metas do PIT.',
      }));
      resumo.textContent = '';
      return;
    }

    const cabecalho = el('tr', {}, [
      el('th', { className: 'grade-pit__rotulo', textContent: 'Meta' }),
      ...MESES.map(m => el('th', { textContent: m })),
      el('th', { textContent: 'Realiz.' }),
      el('th', { textContent: 'Ano' }),
      el('th', { textContent: '%' }),
    ]);

    const corpo = el('tbody', {});

    // As linhas vêm ordenadas por (numero_meta, item NULLS FIRST), então o
    // cabeçalho de cada meta chega antes dos itens dela.
    for (const linha of linhas) {
      if (!linha.folha) {
        const totais = subtotalDoGrupo(linha.numero_meta);
        const tr = el('tr', { className: 'grade-pit__grupo' }, [
          el('td', { className: 'grade-pit__rotulo' }, [
            el('span', { className: 'grade-pit__codigo', textContent: `Meta ${linha.numero_meta}` }),
            linha.descricao || '',
          ]),
          el('td', { colSpan: '12' }),
          el('td', { className: 'grade-pit__total', textContent: totais.realizado }),
          el('td', { className: 'grade-pit__total', textContent: totais.previsto }),
          el('td', { className: 'grade-pit__total', textContent: totais.percentual }),
        ]);
        gruposPorNumero.set(linha.numero_meta, tr);
        corpo.appendChild(tr);
        continue;
      }
      corpo.appendChild(linhaDaMeta(linha));
    }

    grade.appendChild(el('table', { className: 'grade-pit__tabela' }, [
      el('thead', {}, [cabecalho]),
      corpo,
    ]));

    montarResumo();
  }

  function montarResumo() {
    const folhas = linhas.filter(l => l.folha);
    const semPrevisto = folhas.filter(l => l.quantidade_prevista == null).length;
    const divergentes = folhas.filter(l => l.quantidade_prevista != null
      && (l.planejado ?? 0) !== l.quantidade_prevista).length;

    resumo.innerHTML = '';
    const partes = [`${folhas.length} meta(s) em ${anoSelecionado}.`];
    if (semPrevisto) partes.push(`${semPrevisto} sem quantidade do ano.`);
    if (divergentes) partes.push(`${divergentes} com o plano fora da quantidade do ano.`);
    resumo.textContent = partes.join(' ');
  }

  async function loadAnos() {
    let anos = [];
    try {
      anos = await getAnosMetaPit();
    } catch (err) {
      anos = [];
    }
    if (disposed) return;
    const corrente = new Date().getFullYear();
    const todos = [...new Set([corrente, ...(anos || []).map(Number)])].sort((a, b) => b - a);
    anoFilter.setOptions(todos.map(a => ({ value: a, label: String(a) })));
    anoFilter.setValue(anoSelecionado);
  }

  async function load() {
    try {
      const dados = await getGradePit(anoSelecionado);
      if (disposed) return;
      linhas = (dados || []).map(l => ({
        ...l,
        meses: (l.meses || []).map(m => ({ ...m, mes: Number(m.mes) })),
      }));
      desenhar();
    } catch (err) {
      if (disposed) return;
      linhas = [];
      grade.innerHTML = '';
      showError(err.message || 'Erro ao carregar a grade do PIT');
    }
  }

  await loadAnos();
  await load();

  return () => {
    disposed = true;
  };
}
