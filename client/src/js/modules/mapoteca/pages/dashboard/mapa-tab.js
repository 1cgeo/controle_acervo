import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import * as mapotecaService from '@modules/mapoteca/services/mapoteca-service.js';
import { getAno } from '@modules/mapoteca/store/year-store.js';
import { criarMapaEntregas } from './mapa-entregas.js';

/**
 * Aba "Mapa": onde a mapoteca entregou no ano.
 *
 * Os outros paineis somam por tipo, por midia e por operação, todos sem lugar
 * nenhum. Esta responde a pergunta que sobrava, e que so um mapa responde: a
 * cobertura da entrega. Sem filtro, é a mesma população do cartão "Produtos
 * entregues" do resumo anual, agregada por produto em vez de somada.
 *
 * Os filtros (tipo de produto, escala e cliente) sao aplicados no SERVIDOR. O
 * cliente nao existe na feição, que traz a CONTAGEM de OMs atendidas e nao a
 * lista; filtrar uns na tela e outros no servidor faria as tres contas seguirem
 * regras diferentes, e o numero do resumo pararia de fechar com o mapa.
 *
 * @param {HTMLElement} container
 * @returns {Promise<{cleanup:Function, refresh:Function}>}
 */
export async function renderMapaTab(container) {
  let disposed = false;
  let ano = getAno();
  const filtros = { tipo_produto_id: null, escala: null, cliente_id: null };
  // Assinatura da ultima consulta DESENHADA. É ela, e nao o ano, que decide
  // reenquadrar: filtrar por uma OM tem de levar o mapa ate o que aquela OM
  // recebeu, e o refresh de 60 s nao pode puxar o mapa de volta.
  let consultaDesenhada = null;
  // Ano para o qual as listas de opcao foram montadas. `null` na montagem, para
  // a primeira carga contar como troca de ano (nada selecionado ainda).
  let anoDosFiltros = null;
  // Sequencia das cargas, para descartar a resposta que chegar atrasada.
  let cargaAtual = 0;

  const mapa = criarMapaEntregas();

  const anoLabel = el('span', {
    className: 'dashboard-section__ano',
    textContent: String(ano),
  });

  const resumo = el('p', { className: 'mapa-entregas__resumo' });

  // ---------------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------------
  function criarFiltro(chave, rotulo, converter) {
    const select = el('select', {
      className: 'chart-card__select',
      'aria-label': rotulo,
      onChange: (e) => {
        const valor = e.target.value;
        filtros[chave] = valor === '' ? null : converter(valor);
        load();
      },
    });
    const campo = el('div', { className: 'mapa-entregas__filtro' }, [
      el('span', { className: 'mapa-entregas__filtro-rotulo', textContent: rotulo }),
      select,
    ]);
    return { select, campo };
  }

  const filtroTipo = criarFiltro('tipo_produto_id', 'Tipo', Number);
  const filtroEscala = criarFiltro('escala', 'Escala', String);
  const filtroCliente = criarFiltro('cliente_id', 'OM', Number);

  const limparBtn = el('button', {
    className: 'btn btn--text btn--sm hidden',
    type: 'button',
    onClick: () => {
      for (const chave of Object.keys(filtros)) filtros[chave] = null;
      filtroTipo.select.value = '';
      filtroEscala.select.value = '';
      filtroCliente.select.value = '';
      load();
    },
  }, ['Limpar filtros']);

  /**
   * Preenche um select com "Todos" mais as opcoes, e devolve o valor que ficou
   * selecionado.
   *
   * Quando o valor escolhido nao esta mais na lista, ha dois casos, e eles
   * pedem coisas opostas:
   *
   *  - `manterAusente` (cruzamento de filtros): a OM escolhida deixou de ter
   *    produtos naquela escala. Descartar seria desfazer em silencio o que a
   *    pessoa pediu, e ela veria o mapa mudar sem entender. A opcao fica, com
   *    "(0)", e o mapa vazio passa a ter explicacao na tela.
   *  - sem `manterAusente` (troca de ano): a OM simplesmente nao existe em 2025.
   *    Ai manter seria prender a tela num recorte impossivel.
   */
  function preencher(select, opcoes, valorAtual, { manterAusente }) {
    const atual = valorAtual === null || valorAtual === undefined ? '' : String(valorAtual);
    // O rotulo do que esta escolhido guardado ANTES de esvaziar: se a opcao
    // sumir da lista, e dele que sai o texto do "(0)".
    const rotuloAtual = select.selectedOptions[0]?.dataset.rotulo || atual;

    select.replaceChildren(el('option', { value: '', textContent: 'Todos' }));
    let presente = false;
    for (const o of opcoes) {
      if (String(o.value) === atual) presente = true;
      const option = el('option', {
        value: String(o.value),
        textContent: `${o.label} (${formatNumber(o.produtos)})`,
      });
      option.dataset.rotulo = o.label;
      select.appendChild(option);
    }

    if (!presente && atual && manterAusente) {
      const option = el('option', { value: atual, textContent: `${rotuloAtual} (0)` });
      option.dataset.rotulo = rotuloAtual;
      select.appendChild(option);
      presente = true;
    }

    select.value = presente ? atual : '';
    return presente ? valorAtual : null;
  }

  /**
   * @param {{manterAusente:boolean}} opcoes - ver `preencher`
   */
  async function carregarFiltros({ manterAusente }) {
    let opcoes;
    try {
      // Os filtros vao junto: o servidor devolve o quantitativo de cada opcao
      // ja cruzado pelos OUTROS filtros ativos (nunca pelo proprio).
      opcoes = await mapotecaService.getEntregasFiltros(ano, filtros);
    } catch {
      // A lista de opcoes que falha nao pode derrubar o mapa: ele ja tem o que
      // desenhar, e os filtros so ficam sem alternativa.
      return;
    }
    if (disposed) return;

    filtros.tipo_produto_id = preencher(
      filtroTipo.select,
      (opcoes.tipos_produto || []).map(t => ({ value: t.code, label: t.nome, produtos: t.produtos })),
      filtros.tipo_produto_id,
      { manterAusente }
    );
    filtros.escala = preencher(
      filtroEscala.select,
      (opcoes.escalas || []).map(e => ({ value: e.escala, label: e.escala, produtos: e.produtos })),
      filtros.escala,
      { manterAusente }
    );
    filtros.cliente_id = preencher(
      filtroCliente.select,
      (opcoes.clientes || []).map(c => ({ value: c.id, label: c.nome, produtos: c.produtos })),
      filtros.cliente_id,
      { manterAusente }
    );
  }

  const secao = el('div', { className: 'dashboard-section' }, [
    el('div', { className: 'dashboard-section__header' }, [
      el('h2', { className: 'dashboard-section__title', textContent: 'Cobertura das entregas' }),
      el('div', { className: 'dashboard-section__controls' }, [
        el('span', { textContent: 'Ano:' }),
        anoLabel,
      ]),
    ]),
    el('div', { className: 'mapa-entregas__filtros' }, [
      filtroTipo.campo, filtroEscala.campo, filtroCliente.campo, limparBtn,
    ]),
    resumo,
    mapa.element,
  ]);

  container.appendChild(secao);

  // ---------------------------------------------------------------------------
  // Carga
  // ---------------------------------------------------------------------------
  function assinatura() {
    return JSON.stringify([ano, filtros.tipo_produto_id, filtros.escala, filtros.cliente_id]);
  }

  function descrever({ dados, total_produtos: total, total_ano: totalAno, filtrado, sem_geometria: semGeometria }) {
    resumo.replaceChildren();
    if (!dados.length) {
      resumo.appendChild(el('span', {
        textContent: filtrado
          ? 'Nenhuma entrega com esta combinação de filtros.'
          : `Nenhuma entrega registrada em ${ano}.`,
      }));
      return;
    }

    // Com filtro, o numero sozinho nao diz nada: 318 exemplares e muito ou
    // pouco depende do ano ter 3.119. Sem filtro, repetir "de 3.119" seria ruido.
    const totalTexto = filtrado
      ? `${formatNumber(total)} de ${formatNumber(totalAno)} exemplares`
      : `${formatNumber(total)} exemplares entregues`;

    resumo.appendChild(el('span', {
      textContent: `${totalTexto} em ${formatNumber(dados.length)} `
        + `${dados.length > 1 ? 'produtos distintos' : 'produto'}.`,
    }));

    // Silenciar isto faria o mapa mostrar menos do que o cartao "Produtos
    // entregues" do resumo anual, sem explicar por que. Hoje o produto do
    // acervo sempre tem geometria, e esta linha nao aparece.
    if (semGeometria > 0) {
      resumo.appendChild(el('span', {
        className: 'mapa-entregas__resumo-aviso',
      }, [
        svgIcon(ICONS.warning, 14),
        el('span', {
          textContent: `${formatNumber(semGeometria)} exemplares ficaram fora do mapa `
            + 'por não terem geometria no acervo.',
        }),
      ]));
    }
  }

  async function load() {
    // Cada carga tem DUAS idas ao servidor (opções e feições). Mexer noutro
    // filtro no meio dispara outra, e sem o token a mais lenta chegaria por
    // último e repintaria a tela com o recorte antigo. Comparar a assinatura
    // não serviria aqui: `carregarFiltros` pode alterar `filtros` de propósito.
    const meuToken = ++cargaAtual;
    ano = getAno();
    anoLabel.textContent = String(ano);

    // As opções são relidas SEMPRE, porque o quantitativo de cada uma depende
    // dos outros filtros: escolher uma OM tem de mudar o número ao lado de cada
    // escala. A troca de ano é o único caso em que a escolha que sumiu da lista
    // é descartada; ver `preencher`.
    await carregarFiltros({ manterAusente: ano === anoDosFiltros });
    if (disposed || meuToken !== cargaAtual) return;
    anoDosFiltros = ano;

    const minhaConsulta = assinatura();
    limparBtn.classList.toggle(
      'hidden',
      !(filtros.tipo_produto_id || filtros.escala || filtros.cliente_id)
    );

    try {
      const geo = await mapotecaService.getEntregasGeo(ano, filtros);
      if (disposed || meuToken !== cargaAtual) return;
      descrever(geo);
      mapa.setEntregas(geo.dados, { reenquadrar: consultaDesenhada !== minhaConsulta });
      consultaDesenhada = minhaConsulta;
    } catch (err) {
      if (disposed || meuToken !== cargaAtual) return;
      resumo.replaceChildren(el('span', { textContent: 'Não foi possível carregar as entregas.' }));
      mapa.setEntregas([], { reenquadrar: false });
      showError(err.message || 'Erro ao carregar as entregas do ano');
    }
  }

  // O mapa sobe em paralelo com a busca: a biblioteca vem de um pedaco proprio
  // do pacote, e esperar um pelo outro dobraria a espera a toa.
  await Promise.all([mapa.iniciar(), load()]);

  return {
    cleanup: () => {
      disposed = true;
      mapa._cleanup();
    },
    refresh: load,
  };
}
