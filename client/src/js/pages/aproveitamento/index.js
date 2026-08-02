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

const dia = (valor) => (valor
  ? String(valor).slice(0, 10).split('-').reverse().join('/')
  : null);

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
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Function} cleanup
 */
export async function renderAproveitamento(container, _ctx) {
  let disposed = false;
  let anoSelecionado = new Date().getFullYear();

  // Guardados para a ficha do militar: ela mostra as passagens e os impedimentos
  // daquela pessoa sem pedir de novo ao servidor.
  let periodos = [];
  let impedimentos = [];
  let usuarios = [];

  const anoFilter = createSelectField({
    label: 'Ano',
    options: anosOferecidos().map(a => ({ value: a, label: String(a) })),
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
  const resumoDivisao = el('p', { style: { margin: '0 0 8px' } });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Aproveitamento do efetivo' }),
      el('div', { className: 'page__actions' }, [novaPassagemBtn]),
    ]),
    el('div', {
      className: 'page__filters',
      style: { display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '16px' },
    }, [anoFilter.element]),
    resumoDivisao,
    mapa,
    legenda,
  ]);
  container.appendChild(page);

  function anosOferecidos() {
    const corrente = new Date().getFullYear();
    return [corrente + 1, corrente, corrente - 1, corrente - 2];
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
    const iso = (d) => d.toISOString().slice(0, 10);

    return impedimentos
      .filter(i => i.usuario_uuid === usuarioUuid
        && i.data_inicio <= iso(ultimoDia)
        && (!i.data_fim || i.data_fim >= iso(primeiroDia)))
      .map(i => `${i.descricao} (${i.percentual}%)`);
  }

  function montarMapa({ semanas, anual }) {
    mapa.innerHTML = '';

    if (!anual.length) {
      mapa.appendChild(el('p', {
        style: { padding: '24px', color: 'var(--text-secondary)' },
        textContent: 'Nenhum militar com passagem pela DGEO neste ano. Comece por "Nova passagem".',
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
      const nome = `${militar.posto_abrev} ${militar.nome_guerra}`.trim();

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

        const motivos = disponibilidade == null
          ? []
          : impedimentosDaSemana(militar.usuario_uuid, s);

        const explicacao = disponibilidade == null
          ? 'Fora da DGEO'
          : `${disponibilidade.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`
            + (motivos.length ? `\n${motivos.join('\n')}` : '');

        celulas.push(el('td', {
          className: `mapa-efetivo__celula mapa-efetivo__celula--${faixa(disponibilidade)}`,
          title: explicacao,
        }));
      }

      celulas.push(el('td', {
        className: 'mapa-efetivo__total',
        textContent: `${Number(militar.aproveitamento).toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
        title: `${militar.dias_na_dgeo} de ${militar.dias_do_ano} dias na DGEO`,
      }));

      return el('tr', {
        className: 'mapa-efetivo__linha',
        onClick: () => abrirFicha(militar),
      }, celulas);
    });

    mapa.appendChild(el('table', { className: 'mapa-efetivo__tabela' }, [
      el('thead', {}, [cabecalhoMeses()]),
      el('tbody', {}, linhas),
    ]));
  }

  function abrirFicha(militar) {
    openMilitarDialog({
      militar,
      periodos: periodos.filter(p => p.usuario_uuid === militar.usuario_uuid),
      impedimentos: impedimentos.filter(i => i.usuario_uuid === militar.usuario_uuid),
      onSaved: load,
    });
  }

  // O aproveitamento da DIVISÃO é a média dos individuais, e ela responde a
  // pergunta que o mapa não responde de relance: "como foi o ano".
  function montarResumo(anual) {
    if (!anual.length) {
      resumoDivisao.textContent = '';
      return;
    }
    const soma = anual.reduce((t, m) => t + Number(m.aproveitamento), 0);
    const media = soma / anual.length;
    resumoDivisao.innerHTML = '';
    resumoDivisao.append(
      `Aproveitamento médio da Divisão em ${anoSelecionado}: `,
      el('strong', {
        textContent: `${media.toLocaleString('pt-BR', { maximumFractionDigits: 1 })}%`,
      }),
      ` sobre ${anual.length} militar(es).`
    );
  }

  async function load() {
    try {
      const [mapaDados, listaPeriodos, listaImpedimentos, listaUsuarios] = await Promise.all([
        getMapaEfetivo(anoSelecionado),
        getPeriodosEfetivo(anoSelecionado),
        getImpedimentos(anoSelecionado),
        // A lista de quem PODE receber uma passagem é o cadastro inteiro, e não
        // quem já tem passagem: cadastrar a primeira de alguém é o caso comum.
        usuarios.length ? Promise.resolve(usuarios) : getUsuarios(),
      ]);
      if (disposed) return;

      periodos = listaPeriodos || [];
      impedimentos = listaImpedimentos || [];
      // `GET /usuarios` chama a abreviatura do posto de `tipo_posto_grad`, e o
      // resto desta tela a chama de `posto_abrev`. A tradução mora aqui, e não
      // nos dois diálogos: dois lugares lendo dois nomes da mesma coisa é onde a
      // lista de escolha nasceria sem posto.
      usuarios = (listaUsuarios || [])
        .filter(u => u.ativo)
        .map(u => ({
          uuid: u.uuid,
          nome_guerra: u.nome_guerra,
          posto_abrev: u.tipo_posto_grad,
          tipo_posto_grad_id: u.tipo_posto_grad_id,
        }))
        .sort((a, b) => (b.tipo_posto_grad_id - a.tipo_posto_grad_id)
          || a.nome_guerra.localeCompare(b.nome_guerra));

      montarResumo(mapaDados.anual || []);
      montarMapa({ semanas: mapaDados.semanas || [], anual: mapaDados.anual || [] });
    } catch (err) {
      if (disposed) return;
      mapa.innerHTML = '';
      showError(err.message || 'Erro ao carregar o aproveitamento do efetivo');
    }
  }

  await load();

  return () => {
    disposed = true;
  };
}
