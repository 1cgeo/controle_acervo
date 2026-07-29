import { el, svgIcon, ICONS } from '@utils/dom.js';
import { formatDate, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import { chip } from '@components/status-chip.js';
import {
  buscarPontos, buscarPosicoes, getFacetas, baixarPontosCsv,
} from '@modules/acervo/services/ponto-controle-service.js';
import { criarSelecao } from '@modules/acervo/pages/busca/selecao.js';
import { criarMapaPontos } from './mapa.js';
import { abrirPontoDialog } from './ponto-dialog.js';

/** Espera antes de disparar a consulta enquanto a pessoa ainda digita. */
const ESPERA_DIGITACAO = 350;
/** Espera depois de mover o mapa, quando a consulta segue a area visivel. */
const ESPERA_MAPA = 500;
const POR_PAGINA = 20;

// Chip por situacao, na mesma leitura de cor do mapa e da ficha. Os codigos sao
// os de ponto_controle.tipo_situacao: 1 Nao medido, 2 Aguardando revisao,
// 3 APROVADO, 4 REPROVADO. Trocar o 3 com o 4 pinta a lista mentindo.
const VARIANTE_SITUACAO = { 1: 'warning', 2: 'info', 3: 'success', 4: 'error' };

function debounce(fn, ms) {
  let id = null;
  const chamada = (...args) => {
    clearTimeout(id);
    id = setTimeout(() => fn(...args), ms);
  };
  chamada.cancelar = () => clearTimeout(id);
  return chamada;
}

/**
 * Preenche um <select> de faceta.
 *
 * So entra quem TEM ponto, e o numero vai entre parenteses. Um combo com os 86
 * lotes do acervo, dos quais dois tem ponto de controle, faz a pessoa procurar
 * agulha; e opcao sem numero nao diz se escolher vale a pena.
 *
 * A opcao ESCOLHIDA sobrevive mesmo com zero, marcada com "(0)": some-la
 * enquanto ela esta selecionada tiraria da tela o filtro que produziu o
 * resultado vazio, e a pessoa nao teria o que desfazer.
 */
function preencherFaceta(selectEl, itens, rotuloVazio, valorAtual = selectEl.value) {
  const atual = String(valorAtual || '');
  const visiveis = itens.filter(i => i.pontos > 0 || String(i.code) === atual);
  const total = itens.reduce((s, i) => s + i.pontos, 0);

  selectEl.replaceChildren(
    el('option', {
      value: '',
      textContent: total > 0 ? `${rotuloVazio} (${formatNumber(total)})` : rotuloVazio,
    }),
    ...visiveis.map(i => el('option', {
      value: String(i.code),
      textContent: `${i.nome} (${formatNumber(i.pontos)})`,
    }))
  );
  selectEl.value = visiveis.some(i => String(i.code) === atual) ? atual : '';
  selectEl.disabled = visiveis.length === 0;
}

/**
 * Ponto de controle (#/acervo/ponto_controle): mapa e lista lado a lado.
 *
 * Replica a BUSCA do acervo de propósito, gesto por gesto: os mesmos filtros com
 * quantitativo, a mesma seleção múltipla com barra e chips, o mesmo "só na área
 * do mapa", a mesma exportação, e o clique no cartão levando o mapa até o item.
 * Quem já usa o sistema não aprende nada novo aqui.
 *
 * Três diferenças, que vêm do dado e não do gosto:
 *
 * 1. **O item é um PONTO, não um polígono.** Onde a busca pinta cobertura, aqui
 *    a cor diz a SITUAÇÃO, que é o que decide se o dado serve ao ajuste. E
 *    "enquadrar" vira um voo com zoom fixo: ponto não tem extensão para caber.
 * 2. **Não há desenho de área.** O recorte é a área VISÍVEL do mapa, porque a
 *    pergunta de campo é "que pontos existem nesta região".
 * 3. **Não há botão de importar.** A missão entra pelo plugin, com o GeoPackage
 *    validado em campo. A tela é de CONSULTA, e um botão de upload aqui
 *    prometeria um caminho que não existe.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} ctx
 * @returns {Promise<Function>} cleanup
 */
export async function renderPontoControle(container, ctx) {
  let disposed = false;
  let pagina = 1;
  // Respostas voltam fora de ordem; so a mais recente pode pintar a tela.
  let requisicao = 0;
  let seguirMapa = false;

  const query = ctx && ctx.query ? ctx.query : new URLSearchParams();

  /** @type {Map<number, HTMLElement>} id -> cartao, para o realce cruzado. */
  const cartoesPorId = new Map();

  // ---------------------------------------------------------------------------
  // Filtros
  // ---------------------------------------------------------------------------
  const codigoInput = el('input', {
    className: 'busca-campo__input',
    type: 'search',
    placeholder: 'Buscar pelo código do ponto',
    'aria-label': 'Buscar pelo código do ponto',
    autocomplete: 'off',
    value: query.get('cod_ponto') || '',
    onInput: () => buscarComEspera(),
  });

  const campoBusca = el('div', { className: 'busca-campo' }, [
    el('span', { className: 'busca-campo__icone' }, [svgIcon(ICONS.search, 20)]),
    codigoInput,
  ]);

  const projetoSelect = el('select', {
    className: 'busca-filtros__select',
    'aria-label': 'Projeto',
    onChange: () => reiniciar(),
  });

  const loteSelect = el('select', {
    className: 'busca-filtros__select',
    'aria-label': 'Lote (missão)',
    onChange: () => reiniciar(),
  });

  const situacaoSelect = el('select', {
    className: 'busca-filtros__select',
    'aria-label': 'Situação do ponto',
    onChange: () => reiniciar(),
  });

  const areaCheck = el('input', {
    type: 'checkbox',
    id: 'pc-seguir-mapa',
    onChange: () => {
      seguirMapa = areaCheck.checked;
      reiniciar();
    },
  });

  const limparBtn = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    onClick: () => limparTudo(),
  }, [svgIcon(ICONS.close, 16), 'Limpar filtros']);

  async function exportarCsv(soSelecionados, botao) {
    const ids = soSelecionados ? [...selecao.ids()] : [];
    if (soSelecionados && !ids.length) return;

    botao.disabled = true;
    try {
      await baixarPontosCsv(
        { ...filtrosAtuais(), ids: ids.length ? ids.join(',') : null },
        soSelecionados ? 'pontos-selecionados.csv' : 'pontos-de-controle.csv'
      );
    } catch (err) {
      showError(err.message || 'Erro ao exportar o CSV');
    } finally {
      botao.disabled = false;
    }
  }

  const exportarTudoBtn = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    title: 'Baixa em CSV todos os pontos do resultado, e não apenas a página exibida',
    onClick: (e) => exportarCsv(false, e.currentTarget),
  }, [svgIcon(ICONS.download, 16), 'Exportar CSV']);

  // So aparece quando ha selecao: um botao permanentemente desativado e ruido.
  const exportarSelecaoBtn = el('button', {
    className: 'btn btn--secondary btn--sm hidden',
    type: 'button',
    onClick: (e) => exportarCsv(true, e.currentTarget),
  }, [svgIcon(ICONS.download, 16), 'Exportar selecionados']);

  const acoesTopo = el('div', { className: 'busca__acoes' }, [
    limparBtn, exportarSelecaoBtn, exportarTudoBtn,
  ]);

  const filtros = el('div', { className: 'busca-filtros' }, [
    projetoSelect,
    loteSelect,
    situacaoSelect,
    el('label', { className: 'busca-filtros__area' }, [
      areaCheck,
      el('span', { textContent: 'Só na área do mapa' }),
    ]),
    el('span', { className: 'busca-filtros__espaco' }),
    acoesTopo,
  ]);

  // ---------------------------------------------------------------------------
  // Selecao
  // ---------------------------------------------------------------------------
  const selecao = criarSelecao({
    rotulo: p => p.cod_ponto,
    substantivo: ['ponto selecionado', 'pontos selecionados'],
    onMudou: (ids) => {
      mapa.setSelecionados(ids);
      marcarCartoes();
      exportarSelecaoBtn.classList.toggle('hidden', ids.size === 0);
      exportarSelecaoBtn.replaceChildren(
        svgIcon(ICONS.download, 16),
        document.createTextNode(` Exportar ${ids.size} selecionado${ids.size > 1 ? 's' : ''}`)
      );
    },
    onVerFichas: (pontos) => abrirPontoDialog(pontos.map(p => p.cod_ponto), 0),
  });

  // ---------------------------------------------------------------------------
  // Resultado
  // ---------------------------------------------------------------------------
  const contador = el('p', {
    className: 'busca-resultados__contador',
    'aria-live': 'polite',
    textContent: 'Consultando...',
  });
  const lista = el('div', { className: 'pc-lista' });
  const paginacao = el('div', { className: 'busca-paginacao' });

  const mapa = criarMapaPontos({
    onAlternarSelecao: (id) => {
      const cartao = cartoesPorId.get(Number(id));
      if (cartao && cartao._dados) {
        selecao.alternar(cartao._dados);
        mapa.setSelecionados(selecao.ids());
      }
    },
    onApontar: (id) => apontarCartao(id),
    onMover: () => { if (seguirMapa) buscarPorMapa(); },
  });

  const painel = el('div', { className: 'pc-painel' }, [
    contador, selecao.element, lista, paginacao,
  ]);

  const raiz = el('div', { className: 'pc-pagina' }, [
    el('div', { className: 'pc-topo' }, [
      el('h1', { className: 'pc-titulo', textContent: 'Ponto de controle' }),
      campoBusca,
      filtros,
    ]),
    el('div', { className: 'pc-conteudo' }, [painel, mapa.elemento]),
  ]);

  container.replaceChildren(raiz);
  container.classList.add('main-content--altura-fixa');
  mapa.iniciar();

  // ---------------------------------------------------------------------------
  // Consulta
  // ---------------------------------------------------------------------------
  function filtrosAtuais() {
    return {
      cod_ponto: codigoInput.value.trim(),
      projeto_id: projetoSelect.value,
      lote_id: loteSelect.value,
      tipo_situacao: situacaoSelect.value,
      bbox: seguirMapa ? mapa.caixaVisivel() : '',
    };
  }

  /** O filtro vive na URL: toda consulta e um endereco que sobrevive ao F5. */
  function gravarNaUrl(atuais) {
    const params = new URLSearchParams();
    for (const [chave, valor] of Object.entries(atuais)) {
      if (valor) params.set(chave, valor);
    }
    if (pagina > 1) params.set('pagina', String(pagina));
    const consulta = params.toString();
    const destino = `/acervo/ponto_controle${consulta ? `?${consulta}` : ''}`;
    if (location.hash.slice(1) !== destino) {
      history.replaceState(null, '', `#${destino}`);
    }
  }

  async function consultar() {
    const meu = ++requisicao;
    const atuais = filtrosAtuais();
    gravarNaUrl(atuais);

    lista.setAttribute('aria-busy', 'true');
    try {
      // A LISTA pagina; o MAPA, nao. Sao duas chamadas, como na busca do
      // acervo: vinte pontos numa consulta de quinhentos afirmariam
      // visualmente que a missao tem vinte pontos ali.
      const [dados, posicoes, facetas] = await Promise.all([
        buscarPontos({ ...atuais, pagina, por_pagina: POR_PAGINA }),
        buscarPosicoes(atuais),
        getFacetas(atuais),
      ]);
      if (disposed || meu !== requisicao) return;
      pintarFacetas(facetas);
      pintar(dados, posicoes);
    } catch (erro) {
      if (disposed || meu !== requisicao) return;
      showError(erro.message || 'Não foi possível consultar os pontos de controle');
      contador.textContent = 'A consulta falhou.';
      lista.replaceChildren();
      paginacao.replaceChildren();
    } finally {
      lista.removeAttribute('aria-busy');
    }
  }

  const buscarComEspera = debounce(() => { pagina = 1; consultar(); }, ESPERA_DIGITACAO);
  const buscarPorMapa = debounce(() => { pagina = 1; consultar(); }, ESPERA_MAPA);

  function reiniciar() {
    pagina = 1;
    consultar();
  }

  function limparTudo() {
    codigoInput.value = '';
    projetoSelect.value = '';
    loteSelect.value = '';
    situacaoSelect.value = '';
    areaCheck.checked = false;
    seguirMapa = false;
    selecao.limpar();
    reiniciar();
  }

  // ---------------------------------------------------------------------------
  // Pintura
  // ---------------------------------------------------------------------------
  function pintarFacetas(facetas) {
    preencherFaceta(projetoSelect, facetas.projetos || [], 'Todos os projetos');
    // O lote ja chega estreitado pelo projeto escolhido: a faceta aplica os
    // OUTROS filtros, entao o servidor ja o fez. Nao ha o que filtrar aqui.
    preencherFaceta(
      loteSelect,
      (facetas.lotes || []).map(l => ({
        ...l, nome: l.pit ? `${l.nome} (${l.pit})` : l.nome,
      })),
      'Todos os lotes'
    );
    preencherFaceta(situacaoSelect, facetas.situacoes || [], 'Todas as situações');
  }

  function cartaoPonto(p) {
    // Clicar no cartao faz DUAS coisas de proposito: alterna a selecao e leva o
    // mapa ate o ponto. Sao a mesma intencao ("quero este"), e separa-las
    // obrigaria a pessoa a procurar o circulo no mapa depois de escolher.
    const escolher = () => {
      selecao.alternar(p);
      mapa.setSelecionados(selecao.ids());
      mapa.enquadrarPonto(p.id);
    };

    const cartao = el('article', {
      className: 'busca-cartao pc-cartao',
      tabIndex: 0,
      dataset: { id: String(p.id) },
      onClick: escolher,
      onKeyDown: (e) => {
        if (e.key !== 'Enter' && e.key !== ' ') return;
        e.preventDefault();
        escolher();
      },
      // Apontar na lista acende o ponto, e vice-versa: e o que liga os dois
      // lados sem exigir clique.
      onMouseEnter: () => mapa.setApontado(p.id),
      onMouseLeave: () => mapa.setApontado(null),
      onFocus: () => mapa.setApontado(p.id),
      onBlur: () => mapa.setApontado(null),
    }, [
      el('div', { className: 'busca-cartao__topo' }, [
        el('h2', { className: 'busca-cartao__nome', textContent: p.cod_ponto }),
        chip(p.tipo_situacao_nome || `Situação ${p.tipo_situacao}`,
          VARIANTE_SITUACAO[p.tipo_situacao] || 'default'),
      ]),
      el('p', { className: 'busca-cartao__id', textContent: p.projeto || '-' }),
      el('p', {
        className: 'busca-cartao__id',
        textContent: p.pit ? `${p.lote} · ${p.pit}` : (p.lote || '-'),
      }),
      el('div', { className: 'pc-cartao__meta' }, [
        el('span', { textContent: formatDate(p.data_rastreio) }),
        p.medidor ? el('span', { textContent: p.medidor }) : null,
        p.altitude_ortometrica != null
          ? el('span', {
            textContent: `${formatNumber(Number(p.altitude_ortometrica).toFixed(2))} m`,
          })
          : null,
      ].filter(Boolean)),
      el('div', { className: 'busca-cartao__rodape' }, [
        el('span', {
          textContent: `${p.total_arquivos} ${p.total_arquivos === 1 ? 'arquivo' : 'arquivos'}`
            + (p.total_mb ? ` · ${formatNumber(Number(p.total_mb).toFixed(1))} MB` : ''),
        }),
        el('button', {
          className: 'btn btn--text btn--sm busca-cartao__ficha',
          type: 'button',
          onClick: (e) => {
            // Sem isto o clique subiria para o cartao e alternaria a selecao.
            e.stopPropagation();
            abrirPontoDialog([p.cod_ponto], 0);
          },
        }, [svgIcon(ICONS.visibility, 16), 'Ficha']),
      ]),
    ]);

    cartao._dados = p;
    return cartao;
  }

  function marcarCartoes() {
    for (const [id, cartao] of cartoesPorId) {
      cartao.classList.toggle('busca-cartao--selecionado', selecao.tem(id));
    }
  }

  /** Realce vindo do MAPA: o mouse esta sobre o ponto, e o cartao acende. */
  function apontarCartao(id) {
    for (const [outroId, cartao] of cartoesPorId) {
      cartao.classList.toggle('busca-cartao--apontado', outroId === Number(id));
    }
  }

  function caixaDos(pontos) {
    const comPosicao = (pontos || []).filter(p => p.longitude != null && p.latitude != null);
    if (comPosicao.length === 0) return null;
    const lons = comPosicao.map(p => Number(p.longitude));
    const lats = comPosicao.map(p => Number(p.latitude));
    return [Math.min(...lons), Math.min(...lats), Math.max(...lons), Math.max(...lats)];
  }

  function pintar(dados, posicoes) {
    const pontos = dados.pontos || [];
    const total = dados.total || 0;

    contador.textContent = total === 0
      ? 'Nenhum ponto de controle encontrado.'
      : `${formatNumber(total)} ${total === 1 ? 'ponto' : 'pontos'}`;

    cartoesPorId.clear();
    if (pontos.length === 0) {
      lista.replaceChildren(el('div', { className: 'busca-lista__vazio' }, [
        el('p', { textContent: 'Nenhum ponto de controle com esses filtros.' }),
      ]));
    } else {
      const cartoes = pontos.map(p => {
        const c = cartaoPonto(p);
        cartoesPorId.set(Number(p.id), c);
        return c;
      });
      lista.replaceChildren(...cartoes);
    }
    marcarCartoes();

    // O mapa recebe o resultado INTEIRO, e nao a pagina.
    mapa.mostrar(posicoes.pontos || []);
    mapa.setSelecionados(selecao.ids());

    // Enquadrar so quando a consulta NAO segue o mapa: no modo "so na area do
    // mapa", mover a camera mudaria a area, que mudaria o resultado. O laco
    // nao fecharia.
    if (!seguirMapa) {
      const caixa = caixaDos(posicoes.pontos);
      if (caixa) mapa.enquadrar(caixa);
    }

    pintarPaginacao(total);
  }

  function pintarPaginacao(total) {
    const paginas = Math.ceil(total / POR_PAGINA);
    if (paginas <= 1) {
      paginacao.replaceChildren();
      return;
    }

    // `disabled` vai como PROPRIEDADE, e nunca como atributo no el(): o helper
    // faz setAttribute, e `disabled="false"` desabilita o botao do mesmo jeito.
    const anterior = el('button', {
      className: 'btn btn--secondary btn--sm',
      type: 'button',
      onClick: () => { pagina -= 1; consultar(); },
    }, [svgIcon(ICONS.arrowBack, 16), 'Anterior']);
    anterior.disabled = pagina <= 1;

    const proxima = el('button', {
      className: 'btn btn--secondary btn--sm',
      type: 'button',
      onClick: () => { pagina += 1; consultar(); },
    }, ['Próxima']);
    proxima.disabled = pagina >= paginas;

    paginacao.replaceChildren(
      anterior,
      el('span', {
        className: 'busca-paginacao__posicao',
        textContent: `Página ${pagina} de ${paginas}`,
      }),
      proxima
    );
  }

  // ---------------------------------------------------------------------------
  // Estado que veio no link
  // ---------------------------------------------------------------------------
  // Os selects nascem com o valor da URL para que a PRIMEIRA consulta ja o
  // aplique. As opcoes chegam depois, com as facetas, e o `preencherFaceta`
  // preserva o valor escolhido.
  for (const [campo, elemento] of [
    ['projeto_id', projetoSelect],
    ['lote_id', loteSelect],
    ['tipo_situacao', situacaoSelect],
  ]) {
    const valor = query.get(campo);
    if (!valor) continue;
    elemento.replaceChildren(el('option', { value: valor, textContent: valor }));
    elemento.value = valor;
  }
  if (query.get('bbox')) {
    seguirMapa = true;
    areaCheck.checked = true;
  }

  const paginaUrl = parseInt(query.get('pagina'), 10);
  if (Number.isFinite(paginaUrl) && paginaUrl > 1) pagina = paginaUrl;

  await consultar();

  return () => {
    disposed = true;
    container.classList.remove('main-content--altura-fixa');
    buscarComEspera.cancelar();
    buscarPorMapa.cancelar();
    mapa.destruir();
  };
}
