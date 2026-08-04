import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { formatDate, formatDateTime } from '@utils/format.js';
import { chip } from '@components/status-chip.js';
import { showError, showSuccess } from '@utils/toast.js';
import {
  getPonto, baixarArquivoDoPonto,
} from '@modules/acervo/services/ponto-controle-service.js';
import { criarMapaDoPonto } from './ponto-mapa-mini.js';
import { criarHistorico } from '@components/historico/historico.js';

/**
 * Ficha do ponto de controle.
 *
 * O DESENHO, refeito em 2026-07-31 na mesma linguagem da ficha do acervo (pedido
 * do chefe). A ficha anterior era uma pilha de 56 linhas rotulo-valor, todas com
 * o mesmo peso: a latitude com oito casas decimais saia igual ao "Fuso", e os
 * arquivos ficavam no fim, depois de sete blocos. Tres mudancas:
 *
 *   1. LUGAR. Um ponto de controle E um lugar, e a ficha nao mostrava onde. Um
 *      mapinha abre junto do resumo. E o que a miniatura da carta e para o
 *      acervo: a resposta que o texto nao da.
 *   2. HIERARQUIA. O que identifica um ponto (coordenada, altitude, metodo,
 *      data) sobe para uma faixa de fatos com o valor grande. Os arquivos vem
 *      logo depois, porque sao o que a pessoa veio buscar. Os sete blocos de
 *      detalhe descem, que e onde se confere, nao onde se olha.
 *   3. COPIAR A COORDENADA. Um ponto de apoio existe para ser usado noutro
 *      programa. Antes era selecionar o texto na mao, com risco de perder casa
 *      decimal; agora e um botao.
 *
 * As classes `ficha-*` vem do acervo (`modules/acervo/acervo.css`), e nao sao
 * copiadas: as duas fichas moram no mesmo modulo e no mesmo CSS, entao a
 * linguagem visual e literalmente a mesma folha.
 */

// Cor do chip por situacao. Mesmos codigos e mesma leitura do mapa:
// 1 Nao medido, 2 Aguardando revisao, 3 APROVADO, 4 REPROVADO.
const VARIANTE_SITUACAO = { 1: 'warning', 2: 'info', 3: 'success', 4: 'error' };

/**
 * O codigo 9999 dos dominios do plugin significa "A SER PREENCHIDO", e nao um
 * valor. Ele e o NULO daquele modelo, e por isso a ficha o trata como campo
 * vazio: mostra-lo resolvido encheria a tela de linhas dizendo que nao se sabe.
 */
const NAO_PREENCHIDO = 9999;
const RE_NAO_PREENCHIDO = /^A SER PREENCHIDO$/i;

const vazio = valor =>
  valor === null || valor === undefined || valor === '' ||
  (typeof valor === 'string' && RE_NAO_PREENCHIDO.test(valor.trim()));

/**
 * Numero com casas decimais FIXAS, em pt-BR.
 *
 * NAO usa formatNumber(): ele chama `toLocaleString('pt-BR')` sem opcoes, e o
 * padrao do ECMA-402 e no maximo 3 casas. A latitude ia formatada com 8 casas e
 * saia com 3 na tela, sem erro nenhum. Numa ficha de ponto de controle a casa
 * decimal E o dado: -30,123° e -30,12345678° sao lugares a 400 m um do outro.
 */
function numero(valor, casas = 3, sufixo = '') {
  if (vazio(valor)) return null;
  const parsed = Number(valor);
  if (Number.isNaN(parsed)) return null;
  const texto = parsed.toLocaleString('pt-BR', {
    minimumFractionDigits: casas,
    maximumFractionDigits: casas,
  });
  return `${texto}${sufixo}`;
}

const simNao = valor => (valor === true ? 'Sim' : valor === false ? 'Não' : null);

/**
 * Valor de um campo de DOMINIO, ja resolvido pelo servidor.
 *
 * O servidor devolve o codigo em `<dominio>` e o nome em `<dominio>_nome`. A
 * ficha mostra o NOME, e nunca o codigo cru: era isso que fazia "9999" aparecer
 * na tela. Codigo 9999 vira campo vazio (ver NAO_PREENCHIDO).
 */
function dominio(p, chave) {
  if (p[chave] === NAO_PREENCHIDO) return null;
  const nome = p[`${chave}_nome`];
  if (!vazio(nome)) return nome;
  // Sem nome resolvido e com codigo presente, o codigo ficou orfao no dominio.
  // Dizer isso e melhor do que esconder: e defeito de dado, e alguem conserta.
  return vazio(p[chave]) ? null : `Código ${p[chave]} (fora do domínio)`;
}

/**
 * A primeira coordenada utilizavel da lista, ou NaN.
 *
 * NAO usa `??` com `Number()` direto: `Number(null)` e ZERO, e nao NaN. Um ponto
 * sem coordenada nenhuma viraria a posicao (0, 0), que fica no golfo da Guine, e
 * o mapa abriria ali com toda a confianca do mundo.
 */
const coordenada = (...candidatos) => {
  for (const c of candidatos) {
    if (vazio(c)) continue;
    const n = Number(c);
    if (Number.isFinite(n)) return n;
  }
  return NaN;
};

/** A latitude e a longitude que valem: as da GEOMETRIA. Ver o bloco Posição. */
const latDe = p => coordenada(p.geom_latitude, p.latitude);
const lonDe = p => coordenada(p.geom_longitude, p.longitude);

/**
 * Um fato do resumo: valor grande em cima, rotulo pequeno embaixo.
 * Mesmo componente da ficha do acervo (`ficha-fato`).
 */
function fato(rotulo, valor, mono = false) {
  if (vazio(valor)) return null;
  return el('div', { className: 'ficha-fato' }, [
    el('span', {
      className: `ficha-fato__valor${mono ? ' ficha-fato__valor--mono' : ''}`,
      textContent: String(valor),
    }),
    el('span', { className: 'ficha-fato__rotulo', textContent: rotulo }),
  ]);
}

function linha(rotulo, valor) {
  return el('div', { className: 'detail-card__row' }, [
    el('span', { className: 'detail-card__label', textContent: rotulo }),
    el('span', { className: 'detail-card__value', textContent: valor }),
  ]);
}

/**
 * Um bloco de campos.
 *
 * A ficha tem 56 campos, e a medicao preenche um subconjunto que muda por
 * METODO: um ponto de PPP nao tem os campos de RTK, e vice-versa. Por padrao o
 * vazio nao aparece, e um interruptor no topo revela tudo, para quem esta
 * conferindo o que FALTA preencher.
 */
function bloco(titulo, campos, mostrarVazios) {
  const visiveis = campos.filter(([, valor]) => mostrarVazios || !vazio(valor));
  if (visiveis.length === 0) return null;
  return el('section', { className: 'pc-ficha__bloco' }, [
    el('h3', { className: 'produto-ficha__secao', textContent: titulo }),
    el('div', { className: 'detail-card' },
      visiveis.map(([rotulo, valor]) => linha(rotulo, vazio(valor) ? '—' : valor))),
  ]);
}

/**
 * Botao que copia a coordenada para a area de transferencia.
 *
 * Copia o par CRU, com todas as casas decimais e ponto decimal, e nao o texto
 * formatado da tela: quem cola isto cola num programa, e virgula decimal ou
 * casa perdida viram erro de posicao de metros.
 */
function botaoCopiar(p) {
  const lat = latDe(p);
  const lon = lonDe(p);
  if (!Number.isFinite(lat) || !Number.isFinite(lon)) return null;

  const texto = `${lat}, ${lon}`;

  const botao = el('button', {
    className: 'btn btn--text btn--sm',
    type: 'button',
    title: `Copiar ${texto}`,
  }, [svgIcon(ICONS.contentCopy, 14), 'Copiar coordenada']);

  botao.addEventListener('click', async () => {
    try {
      await navigator.clipboard.writeText(texto);
      showSuccess('Coordenada copiada');
    } catch {
      showError('O navegador não permitiu copiar');
    }
  });

  return botao;
}

/**
 * Os DOIS arquivos do ponto, cada um com seu botao de baixar.
 *
 * Desde 2026-07-29 o acervo guarda dois por ponto (decisao do chefe): o PACOTE,
 * com tudo o que so se le junto, e a MONOGRAFIA, que e o documento que alguem
 * busca sozinho. Nao ha mais agrupamento por tipo porque nao ha mais nove tipos.
 *
 * A MONOGRAFIA vem primeiro, invertendo a ordem do banco: e ela que se abre para
 * conferir o ponto, e o pacote de 20 MB e o que se baixa quando ja se decidiu.
 *
 * O CAMINHO no volume nao aparece, e o servidor nem o envia: e infraestrutura,
 * nao informacao do ponto.
 */
const TIPO_DO_CODIGO = { 1: 'pacote', 2: 'monografia' };
const ORDEM_TIPO = { 2: 0, 1: 1 };

function blocoArquivos(p) {
  const arquivos = [...(p.arquivos || [])].sort(
    (a, b) => (ORDEM_TIPO[a.tipo_arquivo_id] ?? 9) - (ORDEM_TIPO[b.tipo_arquivo_id] ?? 9)
  );

  if (arquivos.length === 0) {
    return el('p', {
      className: 'produto-ficha__vazio',
      textContent: 'Nenhum arquivo registrado para este ponto.',
    });
  }

  return el('ul', { className: 'ficha-arquivos' }, arquivos.map(a => {
    const nome = a.extensao ? `${a.nome_arquivo}.${a.extensao}` : a.nome_arquivo;
    const tipo = TIPO_DO_CODIGO[a.tipo_arquivo_id];

    const botao = el('button', {
      className: 'btn btn--text btn--sm ficha-arquivo__baixar',
      type: 'button',
      title: tipo ? `Baixar ${nome}` : 'Este tipo de arquivo não tem download',
    }, [svgIcon(ICONS.download, 14), 'Baixar']);

    // Tipo que a tela nao conhece nao vira botao morto por acidente: ele fica
    // visivel como registro, desabilitado, sem prometer um download que a rota
    // nao atende.
    if (!tipo) {
      botao.disabled = true;
    } else {
      botao.addEventListener('click', async () => {
        // A referencia vem do FECHAMENTO, e nao de `e.currentTarget`: depois do
        // primeiro await o evento ja terminou e `currentTarget` e null, entao o
        // botao ficava travado para sempre depois de uma falha.
        botao.disabled = true;
        try {
          await baixarArquivoDoPonto(p.cod_ponto, tipo, nome);
        } catch (erro) {
          showError(erro.message || 'Não foi possível baixar o arquivo');
        } finally {
          botao.disabled = false;
        }
      });
    }

    return el('li', { className: 'ficha-arquivo' }, [
      svgIcon(ICONS.description, 16),
      el('span', { className: 'ficha-arquivo__nome', textContent: nome }),
      el('span', {
        className: 'ficha-arquivo__tipo',
        textContent: a.tipo_arquivo || `Tipo ${a.tipo_arquivo_id}`,
      }),
      el('span', {
        className: 'ficha-arquivo__tamanho',
        textContent: numero(a.tamanho_mb, 1, ' MB') || '',
      }),
      botao,
    ]);
  }));
}

/** Espaco reservado enquanto a ficha carrega, no formato do que vai chegar. */
function esqueleto() {
  return el('div', { className: 'ficha-esqueleto' }, [
    el('div', { className: 'ficha-esqueleto__bloco' }),
    el('div', { className: 'ficha-esqueleto__faixa' }),
    el('div', { className: 'ficha-esqueleto__faixa' }),
  ]);
}

/**
 * A ficha inteira.
 *
 * A ordem dos blocos de detalhe segue o CICLO do ponto, e nao a ordem das
 * colunas na tabela: identificacao, onde ele esta, como foi medido, com o que,
 * como foi processado, o marco no terreno. E a ordem em que alguem confere um
 * ponto de apoio. O que mudou em 2026-07-31 foi o que vem ANTES deles: o resumo,
 * o mapa e os arquivos.
 *
 * `lote_nome` e `projeto_nome` sao as ENTIDADES do acervo; `p.lote` e
 * `p.projeto` sao texto livre que o medidor digitou em campo, e por isso
 * aparecem com rotulo proprio, em vez de disputarem a mesma linha.
 *
 * O CPF do engenheiro responsavel EXISTE na tabela e NAO aparece aqui: ele entra
 * no acervo porque o BPC o exige na entrega, e nao para ser exibido a quem
 * consulta. Mesma razao de o usuario read-only nao receber GRANT no schema
 * (er/permissao_readonly.sql).
 *
 * @param {HTMLElement} barraVazios o interruptor dos campos vazios, criado uma
 *   vez pelo dialogo e reposicionado a cada pintura para o estado dele
 *   sobreviver a troca de ponto
 * @returns {{elemento: HTMLElement, destruir: Function}}
 */
function corpo(p, mostrarVazios, barraVazios) {
  const marcas = el('div', { className: 'pc-ficha__cabecalho' }, [
    chip(p.tipo_situacao_nome || `Situação ${p.tipo_situacao}`,
      VARIANTE_SITUACAO[p.tipo_situacao] || 'default'),
    p.reserva ? chip('Reserva', 'secondary') : null,
    p.materializado ? chip('Materializado', 'info') : null,
    p.geometria_aproximada ? chip('Geometria aproximada', 'warning') : null,
  ].filter(Boolean));

  // O resumo: os fatos que identificam um ponto de apoio. Coordenada em fonte
  // monoespacada, que e como se le e se confere numero longo.
  const resumo = el('div', { className: 'ficha-identificacao' }, [
    fato('Latitude', numero(latDe(p), 8, '°'), true),
    fato('Longitude', numero(lonDe(p), 8, '°'), true),
    fato('Alt. ortométrica', numero(p.altitude_ortometrica, 3, ' m')),
    fato('Método', dominio(p, 'metodo_posicionamento')),
    fato('Rastreio', formatDate(p.data_rastreio)),
  ].filter(Boolean));

  const mapa = criarMapaDoPonto(latDe(p), lonDe(p));

  const topo = el('div', { className: 'pc-ficha__topo' }, [
    mapa.elemento,
    el('div', { className: 'pc-ficha__topo-dados' }, [
      marcas,
      resumo,
      botaoCopiar(p),
    ].filter(Boolean)),
  ]);

  const blocos = [
    ['Identificação', [
      ['Projeto', p.projeto_nome],
      ['Lote (missão)', p.lote_nome],
      ['PIT', p.pit],
      ['Tipo de referência', dominio(p, 'tipo_ref')],
      ['Classificação do ponto', dominio(p, 'classificacao_ponto')],
      ['Ponto de referência geodésico/topográfico', dominio(p, 'tipo_pto_ref_geod_topo')],
      ['Rede de referência', dominio(p, 'rede_referencia')],
      ['Órgão executante', p.orgao_executante],
      ['Reserva', simNao(p.reserva)],
      ['Projeto informado em campo', p.projeto],
      ['Lote informado em campo', p.lote],
    ]],

    ['Posição', [
      // A posicao vem da GEOMETRIA (`geom_*`, double precision), e nao das
      // colunas `latitude`/`longitude` do plugin, que sao REAL e perdem casa
      // decimal. As colunas ficam de reserva para o ponto antigo, sem geometria.
      ['Latitude', numero(latDe(p), 8, '°')],
      ['Longitude', numero(lonDe(p), 8, '°')],
      ['Norte', numero(p.norte, 3, ' m')],
      ['Leste', numero(p.leste, 3, ' m')],
      ['Fuso', p.fuso],
      ['Meridiano central', p.meridiano_central],
      ['Altitude ortométrica', numero(p.altitude_ortometrica, 3, ' m')],
      ['Altitude geométrica', numero(p.altitude_geometrica, 3, ' m')],
      ['Sistema geodésico', dominio(p, 'sistema_geodesico')],
      ['Outra referência planimétrica', p.outra_ref_plan],
      ['Referencial altimétrico', dominio(p, 'referencial_altim')],
      ['Outra referência altimétrica', p.outro_ref_alt],
      ['Referencial gravimétrico', dominio(p, 'referencial_grav')],
      ['Latitude planejada', numero(p.latitude_planejada, 8, '°')],
      ['Longitude planejada', numero(p.longitude_planejada, 8, '°')],
      ['Geometria aproximada', simNao(p.geometria_aproximada)],
    ]],

    ['Rastreio', [
      ['Data', formatDate(p.data_rastreio)],
      ['Início', formatDateTime(p.inicio_rastreio)],
      ['Fim', formatDateTime(p.fim_rastreio)],
      ['Medidor', p.medidor],
      ['Método de posicionamento', dominio(p, 'metodo_posicionamento')],
      ['Ponto base', p.ponto_base],
      ['Taxa de gravação', numero(p.taxa_gravacao, 0, ' s')],
      ['Máscara de elevação', numero(p.mascara_elevacao, 0, '°')],
    ]],

    ['Equipamento', [
      ['Modelo do GPS', p.modelo_gps],
      ['Nº de série do GPS', p.numero_serie_gps],
      ['Modelo da antena', p.modelo_antena],
      ['Nº de série da antena', p.numero_serie_antena],
      ['Altura da antena', numero(p.altura_antena, 3, ' m')],
      ['Tipo de medição da altura', dominio(p, 'tipo_medicao_altura')],
      ['Referência da medição da altura', dominio(p, 'referencia_medicao_altura')],
      ['Altura do objeto', numero(p.altura_objeto, 3, ' m')],
    ]],

    ['Processamento', [
      ['Data', formatDate(p.data_processamento)],
      ['Órbita', dominio(p, 'orbita')],
      ['Frequência processada', p.freq_processada],
      ['Modelo geoidal', p.modelo_geoidal],
      ['Precisão horizontal esperada', numero(p.precisao_horizontal_esperada, 3, ' m')],
      ['Precisão vertical esperada', numero(p.precisao_vertical_esperada, 3, ' m')],
      ['Engenheiro responsável', p.engenheiro_responsavel],
      ['CREA', p.crea_engenheiro_responsavel],
    ]],

    ['Marco no terreno', [
      ['Materializado', simNao(p.materializado)],
      ['Situação do marco', dominio(p, 'situacao_marco')],
      ['Tipo de marco limite', dominio(p, 'tipo_marco_limite')],
      ['Data da visita', formatDate(p.data_visita)],
      ['Valor da gravidade', numero(p.valor_gravidade, 3)],
    ]],

    ['Registro no acervo', [
      ['Cadastrado em', formatDateTime(p.data_cadastramento)],
      ['Última modificação', formatDateTime(p.data_modificacao)],
    ]],
  ];

  const elemento = el('div', { className: 'pc-ficha' }, [
    topo,

    // Os arquivos sobem para logo depois do resumo: sao o que a pessoa veio
    // buscar. Antes vinham no fim, depois de sete blocos de conferencia.
    el('section', { className: 'pc-ficha__bloco' }, [
      el('h3', { className: 'produto-ficha__secao', textContent: 'Arquivos' }),
      blocoArquivos(p),
    ]),

    !vazio(p.observacao)
      ? el('section', { className: 'pc-ficha__bloco' }, [
        el('h3', { className: 'produto-ficha__secao', textContent: 'Observação' }),
        el('p', { className: 'pc-ficha__observacao', textContent: p.observacao }),
      ])
      : null,

    // O interruptor fica logo ACIMA dos blocos que ele governa, e rola com
    // eles. Ele ficava grudado no topo da ficha inteira, e ao rolar passava por
    // cima do conteudo com o fundo cobrindo so parte da largura (chefe,
    // 2026-07-31: "fica voando quando da scroll down"). Grudar exigiria sangrar
    // o fundo ate as bordas da area rolavel; aqui nao precisa, porque ele nao
    // governa nem os arquivos nem o resumo, que agora vem antes.
    barraVazios,

    ...blocos.map(([titulo, campos]) => bloco(titulo, campos, mostrarVazios)),
  ].filter(Boolean));

  return { elemento, destruir: mapa.destruir };
}

/**
 * Ficha do ponto de controle, aberta pelo mapa, pela lista ou pela seleção.
 *
 * Recebe a LISTA de códigos e o índice, como a ficha de produto do acervo, para
 * quem selecionou vários poder navegar sem fechar e reabrir.
 *
 * @param {string[]|string} codigos
 * @param {number} [indice]
 */
export async function abrirPontoDialog(codigos, indice = 0) {
  const lista = Array.isArray(codigos) ? codigos : [codigos];
  if (lista.length === 0) return;

  let atual = indice;
  let fechado = false;
  let mostrarVazios = false;
  /** @type {Map<string, Object>} ponto já carregado: o vaivém não repete a chamada. */
  const cache = new Map();

  // O mapa em cena. Trocar de ponto ou fechar a ficha destrói o anterior: um
  // mapa do MapLibre segura contexto WebGL, e o navegador limita quantos
  // existem ao mesmo tempo. Sem destruir, percorrer uma seleção grande esgota.
  let mapaAtual = null;

  const descartarMapa = () => {
    if (mapaAtual) {
      mapaAtual();
      mapaAtual = null;
    }
  };

  const corpoEl = el('div', {}, [esqueleto()]);

  const posicao = el('span', { className: 'produto-ficha__posicao' });

  const btnAnterior = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => irPara(atual - 1),
  }, [svgIcon(ICONS.arrowBack, 16), 'Anterior']);

  const btnProxima = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: () => irPara(atual + 1),
  }, ['Próxima', svgIcon(ICONS.chevronRight, 16)]);

  const navegacao = el('div', { className: 'produto-ficha__nav' }, [
    btnAnterior, posicao, btnProxima,
  ]);

  const alternarVazios = el('input', {
    type: 'checkbox',
    id: 'pc-ficha-vazios',
    onChange: () => {
      mostrarVazios = alternarVazios.checked;
      pintar();
    },
  });

  const barraVazios = el('label', {
    className: 'pc-ficha__vazios-toggle',
    htmlFor: 'pc-ficha-vazios',
  }, [
    alternarVazios,
    el('span', { textContent: 'Mostrar campos não preenchidos' }),
  ]);

  // A navegacao so existe quando ha mais de um: com um ponto so, uma barra com
  // dois botoes desativados e ruido. O interruptor dos campos vazios NAO fica
  // aqui: ele entra dentro do corpo, junto dos blocos que governa.
  const raiz = el('div', { className: 'produto-ficha__raiz' }, [
    lista.length > 1 ? navegacao : null,
    corpoEl,
  ].filter(Boolean));

  const modal = openModal({
    title: lista[atual],
    content: raiz,
    width: '1040px',
    onClose: () => {
      fechado = true;
      descartarMapa();
    },
    actions: [{ label: 'Fechar', variant: 'text', onClick: ({ close }) => close() }],
  });

  const tituloEl = modal.element.querySelector('.modal__title');

  function pintar() {
    const ponto = cache.get(lista[atual]);
    if (!ponto) return;
    descartarMapa();
    const montado = corpo(ponto, mostrarVazios, barraVazios);
    mapaAtual = montado.destruir;
    // O HISTORICO do ponto, RECOLHIDO. Ele se remonta a cada navegacao porque a
    // ficha e trocada por dentro: um painel preso no fechamento mostraria o
    // historico do ponto anterior depois do primeiro "proxima".
    corpoEl.replaceChildren(
      montado.elemento,
      el('div', { className: 'produto-ficha__historico' }, [
        criarHistorico({
          modulo: 'acervo',
          entidade: 'ponto',
          id: ponto.id,
          titulo: 'Histórico do ponto',
          subtitulo: 'Alterações no cadastro e nos arquivos do ponto',
          recolhido: true,
        }).element,
      ])
    );
  }

  async function irPara(novo) {
    if (novo < 0 || novo >= lista.length) return;
    atual = novo;
    const codigo = lista[atual];

    if (tituloEl) tituloEl.textContent = codigo;
    posicao.textContent = `${atual + 1} de ${lista.length}`;
    btnAnterior.disabled = atual === 0;
    btnProxima.disabled = atual === lista.length - 1;

    if (cache.has(codigo)) {
      pintar();
      return;
    }

    descartarMapa();
    corpoEl.replaceChildren(esqueleto());
    try {
      const ponto = await getPonto(codigo);
      if (fechado) return;
      cache.set(codigo, ponto);
      // Outra navegacao pode ter acontecido enquanto esta carregava.
      if (lista[atual] !== codigo) return;
      pintar();
    } catch (erro) {
      if (fechado) return;
      showError(erro.message || 'Não foi possível carregar o ponto de controle');
      if (lista.length === 1) modal.close();
    }
  }

  await irPara(atual);
}
