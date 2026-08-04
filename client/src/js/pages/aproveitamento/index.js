import { el, svgIcon, ICONS } from '@utils/dom.js';
import { showError } from '@utils/toast.js';
import { createSelectField } from '@components/form-fields/form-fields.js';
import {
  getMapaEfetivo,
  getPeriodosEfetivo,
  getImpedimentos,
  getUsuarios,
} from '@services/plataforma-service.js';
// SEM `openImpedimentoDialog` aqui: impedimento se cadastra a partir do MILITAR,
// na ficha que a linha do mapa abre (chefe, 2026-08-02). Um botao geral pediria
// a pessoa primeiro, que e a pergunta que a tela ja respondeu.
import { openPeriodoDialog, openMilitarDialog } from './militar-dialog.js';

// As 53 semanas do ano, contadas a partir de 1º de janeiro. O rótulo de mês é
// posto na PRIMEIRA semana de cada mês, e as demais ficam sem rótulo: doze
// marcas num eixo de 53 células já orientam, e 53 rótulos não caberiam.
const MESES_ABREV = ['JAN', 'FEV', 'MAR', 'ABR', 'MAI', 'JUN',
  'JUL', 'AGO', 'SET', 'OUT', 'NOV', 'DEZ'];

const SEMANAS = 53;

// A semana de um dia, pela MESMA régua do servidor: bloco de sete dias a partir
// do dia 1. As duas contas têm de dar igual, senão o rótulo de mês aponta para a
// coluna errada.
function semanaDoDia(ano, mes, dia) {
  const inicio = Date.UTC(ano, 0, 1);
  const alvo = Date.UTC(ano, mes, dia);
  return Math.floor((alvo - inicio) / 86400000 / 7) + 1;
}

// Cinco faixas, e não um gradiente: a diferença entre 71% e 73% não muda decisão
// nenhuma, e um gradiente convida a compará-las.
function faixa(disponibilidade) {
  if (disponibilidade == null) return 'fora';
  const v = Number(disponibilidade);
  if (v >= 99.5) return 'f100';
  if (v >= 75) return 'f75';
  if (v >= 50) return 'f50';
  if (v >= 25) return 'f25';
  return 'f0';
}

const pct = (valor) => `${Number(valor).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`;

// A data do servidor chega como 'AAAA-MM-DD'. O recorte de dez caracteres torna
// a comparacao de texto valida mesmo se vier com hora junto.
const iso = (valor) => (valor ? String(valor).slice(0, 10) : null);

const primeiroDiaDoAno = (ano) => `${ano}-01-01`;
const ultimoDiaDoAno = (ano) => `${ano}-12-31`;

// O MESMO recorte do servidor, em JavaScript: o registro entra no ano quando
// cruza qualquer dia dele. Datas ISO comparam como texto, entao a conta e a
// comparacao direta.
function cruzaOAno(registro, ano) {
  const inicio = iso(registro.data_inicio);
  const fim = iso(registro.data_fim);
  return inicio <= ultimoDiaDoAno(ano)
    && (!fim || fim >= primeiroDiaDoAno(ano));
}

/** Dois intervalos se cruzam quando cada um começa antes de o outro acabar. */
function intervalosSeCruzam(a, b) {
  const fimA = iso(a.data_fim) || '9999-12-31';
  const fimB = iso(b.data_fim) || '9999-12-31';
  return iso(a.data_inicio) <= fimB && iso(b.data_inicio) <= fimA;
}

const nomeCurto = (r) => `${r.posto_abrev || ''} ${r.nome_guerra || ''}`.trim();

/**
 * Aproveitamento do efetivo (#/aproveitamento).
 *
 * O QUE ELA RESPONDE: quanto do efetivo esteve disponível para a finalidade da
 * Divisão, e por que o resto não esteve. Até 2026-08-02 a tela era um retrato
 * mensal com um texto livre de atividades, que não somava, não comparava entre
 * meses e não sabia dizer o que aconteceu no dia 06 de março.
 *
 * O MAPA É A TELA, e o cadastro é o que se abre a partir dele. A pergunta que se
 * faz aqui é visual ("quem está vermelho?"), e a resposta seguinte é sempre a
 * mesma pessoa: clicar na linha abre a ficha dela, com as passagens e os
 * impedimentos que explicam a cor.
 *
 * CÉLULA SEM COR é "não estava na Divisão", e é diferente de célula vermelha,
 * que é "estava e não rendeu". Com as duas em cinza, a chegada em março se leria
 * como quatro meses de licença.
 *
 * DUAS TABELAS RESPONDEM "ESTÁ NA DGEO", e elas discordam. `dgeo.usuario.ativo`
 * decide quem aparece no seletor de militar; `dgeo.efetivo_periodo` decide quem
 * entra no mapa. Em 2026-08-04 três militares desativados no cadastro contavam
 * como presentes em 2027, com passagem aberta. A tela AVISA da divergência no
 * rodapé e nunca a corrige: `data_fim` nula é desenho, e quem fecha passagem é o
 * chefe.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} ctx
 * @returns {Function} cleanup
 */
export async function renderAproveitamento(container, ctx) {
  let disposed = false;
  const anoCorrente = new Date().getFullYear();
  let anoSelecionado = anoCorrente;

  // Guardados para a ficha do militar: ela mostra as passagens e os impedimentos
  // daquela pessoa sem pedir de novo ao servidor.
  let periodos = [];
  let impedimentos = [];
  let usuarios = [];
  // O cadastro CRU, com os desativados. O `usuarios` acima é a lista de escolha
  // e só tem os ativos; a conciliação precisa dos dois lados.
  let cadastro = [];
  // Todas as passagens, sem recorte de ano: é delas que sai a lista de anos.
  let todosPeriodos = [];

  const query = ctx && ctx.query ? ctx.query : new URLSearchParams();
  // Militar apontado pela rota (`?usuario_uuid=`). O destaque acompanha a troca
  // de ano; a ficha abre UMA vez, na primeira carga que o encontrar.
  const uuidDestacado = query.get('usuario_uuid') || null;
  let fichaDoLinkAberta = false;

  const anoFilter = createSelectField({
    label: 'Ano',
    options: [{ value: anoSelecionado, label: String(anoSelecionado) }],
    placeholder: 'Ano',
    value: anoSelecionado,
    onChange: (valor) => {
      if (valor === null) return;
      anoSelecionado = Number(valor);
      load();
    },
  });

  const novaPassagemBtn = el('button', {
    className: 'btn btn--primary',
    type: 'button',
    onClick: () => openPeriodoDialog({ usuarios, onSaved: load }),
  }, [svgIcon(ICONS.add, 16), 'Nova passagem']);

  const mapa = el('div', { className: 'mapa-efetivo' });
  const legenda = montarLegenda();
  const resumoDivisao = el('p', { className: 'efetivo-resumo', style: { margin: '0 0 8px' } });
  const avisoProjecao = el('div', { style: { margin: '0 0 12px' } });
  const rodape = el('div', { style: { marginTop: '16px' } });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Aproveitamento do efetivo' }),
      el('div', { className: 'page__actions' }, [novaPassagemBtn]),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [anoFilter.element]),
    avisoProjecao,
    resumoDivisao,
    mapa,
    legenda,
    rodape,
  ]);
  container.appendChild(page);

  /**
   * Os anos que o seletor oferece: os que TÊM passagem, e não quatro fixos.
   *
   * Passagem aberta não tem ano de fim, então ela vale até o ano que vem: é o
   * horizonte da projeção, e oferecer mais seria oferecer adivinhação. O ano
   * corrente entra sempre, senão uma base vazia deixaria o seletor sem opção.
   */
  function anosOferecidos() {
    const anos = new Set([anoCorrente, anoSelecionado]);
    for (const p of todosPeriodos) {
      const inicio = Number(String(p.data_inicio).slice(0, 4));
      if (!Number.isFinite(inicio)) continue;
      const fim = p.data_fim
        ? Number(String(p.data_fim).slice(0, 4))
        : anoCorrente + 1;
      for (let a = inicio; a <= Math.max(inicio, fim); a += 1) anos.add(a);
    }
    return [...anos].sort((a, b) => b - a);
  }

  function montarLegenda() {
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
      amostra('fora', 'fora da DGEO'),
    ]);
  }

  /** A linha de rótulo de mês, alinhada às semanas em que cada mês começa. */
  function cabecalhoMeses() {
    const celulas = [el('th', { className: 'mapa-efetivo__nome' })];
    const rotuloNaSemana = new Map();
    for (let m = 0; m < 12; m += 1) {
      rotuloNaSemana.set(semanaDoDia(anoSelecionado, m, 1), MESES_ABREV[m]);
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

  function impedimentosDaSemana(usuarioUuid, semana) {
    // A janela da semana em dias do ano, para casar com o intervalo do
    // impedimento sem refazer a conta do servidor no cliente.
    const inicioAno = new Date(Date.UTC(anoSelecionado, 0, 1));
    const primeiroDia = new Date(inicioAno.getTime() + (semana - 1) * 7 * 86400000);
    const ultimoDia = new Date(primeiroDia.getTime() + 6 * 86400000);
    const dataIso = (d) => d.toISOString().slice(0, 10);

    return impedimentos
      .filter(i => i.usuario_uuid === usuarioUuid
        && iso(i.data_inicio) <= dataIso(ultimoDia)
        && (!i.data_fim || iso(i.data_fim) >= dataIso(primeiroDia)))
      .map(i => `${i.descricao} (${i.percentual}%)`);
  }

  function montarMapa({ semanas, anual }) {
    mapa.innerHTML = '';

    if (!anual.length) {
      mapa.appendChild(el('p', {
        style: { padding: '24px', color: 'var(--text-secondary)' },
        textContent: 'Nenhum militar com passagem pela DGEO neste ano.',
      }));
      return;
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
            ...impedimentosDaSemana(militar.usuario_uuid, s),
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

      const destacada = Boolean(uuidDestacado) && militar.usuario_uuid === uuidDestacado;

      const tr = el('tr', {
        className: 'mapa-efetivo__linha'
          + (destacada ? ' mapa-efetivo__linha--destaque' : ''),
        onClick: () => abrirFicha(militar),
      }, celulas);

      // O destaque vem do link, e o CSS da tela não o conhece. Estilo em linha
      // é o que faz o realce aparecer sem tocar na folha de estilo.
      if (destacada) tr.style.outline = '2px solid var(--color-primary)';

      return tr;
    });

    mapa.appendChild(el('table', { className: 'mapa-efetivo__tabela' }, [
      el('thead', {}, [cabecalhoMeses()]),
      el('tbody', {}, linhas),
    ]));
  }

  const periodosDo = (uuid) => periodos.filter(p => p.usuario_uuid === uuid);
  const impedimentosDo = (uuid) => impedimentos.filter(i => i.usuario_uuid === uuid);

  function abrirFicha(militar) {
    openMilitarDialog({
      militar,
      ano: anoSelecionado,
      periodos: periodosDo(militar.usuario_uuid),
      impedimentos: impedimentosDo(militar.usuario_uuid),
      // Recarrega o mapa por baixo E devolve as listas novas: sem elas a ficha
      // aberta continuaria mostrando o que acabou de ser corrigido.
      onSaved: async () => {
        await load();
        return {
          periodos: periodosDo(militar.usuario_uuid),
          impedimentos: impedimentosDo(militar.usuario_uuid),
        };
      },
    });
  }

  /**
   * O aproveitamento da DIVISÃO, PONDERADO por dias na Divisão.
   *
   * A média simples de percentuais dá o mesmo peso a quem ficou uma semana e a
   * quem ficou o ano, e é assim que um recém-chegado com 4% derruba o número da
   * Divisão. A ponderada responde a pergunta certa: dos dias que as pessoas
   * estiveram aqui, quantos renderam.
   *
   *   dias disponíveis = aproveitamento_i x dias_do_ano_i / 100  (o numerador
   *                      do servidor, que tem o ano no denominador)
   *   ponderada        = SOMA(dias disponíveis) / SOMA(dias_na_dgeo) x 100
   *
   * AS DUAS FICAM À VISTA, com o nome de cada uma. Um número de média sem dizer
   * qual média é convida a comparar com o do ano passado, que era a outra.
   */
  function montarResumo(anual) {
    resumoDivisao.innerHTML = '';
    if (!anual.length) return;

    const diasNaDgeo = anual.reduce((t, m) => t + Number(m.dias_na_dgeo || 0), 0);
    const diasDisponiveis = anual.reduce(
      (t, m) => t + (Number(m.aproveitamento) * Number(m.dias_do_ano || 0)) / 100, 0
    );
    const simples = anual.reduce((t, m) => t + Number(m.aproveitamento), 0) / anual.length;
    // Ninguém com dia na Divisão faz o denominador zerar. Sem a guarda o número
    // sairia NaN, que se lê como defeito da tela e não como base vazia.
    const ponderada = diasNaDgeo > 0 ? (diasDisponiveis / diasNaDgeo) * 100 : 0;

    const quantos = anual.length === 1 ? '1 militar' : `${anual.length} militares`;

    resumoDivisao.append(
      `Aproveitamento da Divisão em ${anoSelecionado}, ponderado por dias na DGEO: `,
      el('strong', { textContent: pct(ponderada) }),
      `. Média simples dos percentuais: ${pct(simples)}. Sobre ${quantos}.`
    );
  }

  /**
   * O ano à frente do corrente é PROJEÇÃO, e não medida.
   *
   * Impedimento sem data de término se estende por todo ano futuro, e o mapa de
   * 2027 desenha isso como se já tivesse acontecido. O aviso é o que separa a
   * conta que o sistema fez da coisa que o mundo decidiu.
   */
  function montarAvisoProjecao() {
    avisoProjecao.innerHTML = '';
    if (anoSelecionado <= anoCorrente) return;

    avisoProjecao.appendChild(el('p', {
      className: 'efetivo-projecao',
      style: { margin: '0', color: 'var(--color-warning)' },
      textContent: `${anoSelecionado} ainda não aconteceu. Este mapa é projeção`
        + ' dos impedimentos e das passagens em aberto, e não medida.',
    }));
  }

  /**
   * O rodapé de DIVERGÊNCIA entre o cadastro e as passagens.
   *
   * Só avisa. Fechar passagem e desativar cadastro são atos do chefe, e a tela
   * que os fizesse sozinha apagaria a pergunta em vez de respondê-la.
   */
  function montarDivergencias() {
    rodape.innerHTML = '';

    // `periodos` já vem recortado pelo ano da tela.
    const doAno = periodos;

    // PASSAGEM ABERTA COM CADASTRO INATIVO NÃO É DIVERGÊNCIA (chefe,
    // 2026-08-04, ao acionar a tela com o dado real). `dgeo.usuario.ativo` é
    // flag de LOGIN, e a maioria do efetivo não usa o SCA: em agosto de 2026
    // eram 20 casos em 25 militares. O aviso listava quase a Divisão inteira e
    // escondia a linha que importava.
    //
    // Sobra a divergência que aponta trabalho de verdade: ativo no cadastro e
    // SEM passagem no ano. Quem chegou e não foi lançado fica fora do mapa, e o
    // número da Divisão cai por ausência. Ela também pega o inverso, que é risco
    // de acesso: quem saiu, teve a passagem encerrada e continua podendo entrar.
    const comPassagem = new Set(doAno.map(p => p.usuario_uuid));
    const ativoSemPassagem = cadastro
      .filter(u => u.ativo && !comPassagem.has(u.uuid))
      .map(u => `${u.tipo_posto_grad || ''} ${u.nome_guerra || ''}`.trim());

    if (!ativoSemPassagem.length) return;

    const bloco = (classe, titulo, nomes, oQueFazer) => el('p', {
      className: `efetivo-divergencia ${classe}`,
      style: { margin: '0 0 8px', color: 'var(--text-secondary)' },
    }, [
      el('strong', { textContent: `${titulo}: ` }),
      `${nomes.join(', ')}. ${oQueFazer}`,
    ]);

    const partes = [];
    if (ativoSemPassagem.length) {
      partes.push(bloco(
        'efetivo-divergencia--ativo-sem-passagem',
        `Acessa o SCA e sem passagem em ${anoSelecionado}`,
        ativoSemPassagem,
        'Estes ficam fora do mapa. Cadastre a passagem, ou desative o acesso de'
        + ' quem já saiu.'
      ));
    }

    rodape.appendChild(el('div', { className: 'efetivo-divergencias' }, [
      el('h2', {
        style: { fontSize: '0.9375rem', margin: '0 0 8px' },
        textContent: 'Divergências entre o cadastro e as passagens',
      }),
      ...partes,
      el('p', {
        style: { margin: '0', fontSize: '0.8125rem', color: 'var(--text-secondary)' },
        textContent: 'A tela apenas aponta. Quem corrige é o chefe.',
      }),
    ]));
  }

  /** Tudo o que fala do ano some antes de o ano novo chegar. */
  function limparTela() {
    mapa.innerHTML = '';
    resumoDivisao.innerHTML = '';
    avisoProjecao.innerHTML = '';
    rodape.innerHTML = '';
  }

  async function load() {
    // A ROLAGEM MORRE NO REMONTE. A tela reconstrói o mapa à mão, o documento
    // encolhe e o navegador prende a rolagem no topo: medido em 2026-08-04,
    // trocar o ano levava `window.scrollY` de 304 px para 0.
    const rolagem = typeof window !== 'undefined' ? (window.scrollY || 0) : 0;

    // CARREGANDO, e não o mapa velho. Sem isso o mapa do ano anterior fica na
    // tela durante a espera, com a cara de ser o do ano novo.
    limparTela();
    mapa.appendChild(el('p', {
      className: 'mapa-efetivo__carregando',
      style: { padding: '24px', color: 'var(--text-secondary)' },
      textContent: 'Carregando o mapa do ano.',
    }));

    try {
      const [mapaDados, listaPeriodos, listaImpedimentos, listaUsuarios] = await Promise.all([
        getMapaEfetivo(anoSelecionado),
        // SEM recorte de ano: a mesma resposta serve à ficha (filtrada aqui) e
        // à lista de anos do seletor. Duas chamadas trariam a mesma tabela.
        getPeriodosEfetivo(),
        getImpedimentos(anoSelecionado),
        // A lista de quem PODE receber uma passagem é o cadastro inteiro, e não
        // quem já tem passagem: cadastrar a primeira de alguém é o caso comum.
        cadastro.length ? Promise.resolve(cadastro) : getUsuarios(),
      ]);
      if (disposed) return;

      todosPeriodos = listaPeriodos || [];
      periodos = todosPeriodos.filter(p => cruzaOAno(p, anoSelecionado));
      impedimentos = listaImpedimentos || [];
      cadastro = listaUsuarios || [];
      // `GET /usuarios` chama a abreviatura do posto de `tipo_posto_grad`, e o
      // resto desta tela a chama de `posto_abrev`. A tradução mora aqui, e não
      // nos dois diálogos: dois lugares lendo dois nomes da mesma coisa é onde a
      // lista de escolha nasceria sem posto.
      usuarios = cadastro
        .filter(u => u.ativo)
        .map(u => ({
          uuid: u.uuid,
          nome_guerra: u.nome_guerra,
          posto_abrev: u.tipo_posto_grad,
          tipo_posto_grad_id: u.tipo_posto_grad_id,
        }))
        .sort((a, b) => (b.tipo_posto_grad_id - a.tipo_posto_grad_id)
          || a.nome_guerra.localeCompare(b.nome_guerra));

      anoFilter.setOptions(anosOferecidos().map(a => ({ value: a, label: String(a) })));
      anoFilter.setValue(anoSelecionado);

      montarAvisoProjecao();
      montarResumo(mapaDados.anual || []);
      montarMapa({ semanas: mapaDados.semanas || [], anual: mapaDados.anual || [] });
      montarDivergencias();

      // A restauração vem DEPOIS do desenho: antes dele o documento ainda está
      // curto, e o navegador cortaria a posição pedida.
      if (rolagem > 0 && typeof window.scrollTo === 'function') {
        window.scrollTo(0, rolagem);
      }

      abrirFichaDoLink(mapaDados.anual || []);
    } catch (err) {
      if (disposed) return;
      // NADA DO ANO VELHO SOBREVIVE AO ERRO. O resumo que ficava escrito dizia
      // um percentual e um número de militares de um ano que não é o da tela.
      limparTela();
      showError(err.message || 'Erro ao carregar o aproveitamento do efetivo');
    }
  }

  /** `?usuario_uuid=` na rota abre a ficha daquele militar, uma vez só. */
  function abrirFichaDoLink(anual) {
    if (!uuidDestacado || fichaDoLinkAberta) return;
    const alvo = anual.find(m => m.usuario_uuid === uuidDestacado);
    if (!alvo) return;
    fichaDoLinkAberta = true;
    abrirFicha(alvo);
  }

  await load();

  return () => {
    disposed = true;
  };
}
