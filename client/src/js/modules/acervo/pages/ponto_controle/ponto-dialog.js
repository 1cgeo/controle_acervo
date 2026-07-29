import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import { formatDate, formatDateTime } from '@utils/format.js';
import { chip } from '@components/status-chip.js';
import { showError } from '@utils/toast.js';
import { getPonto } from '@modules/acervo/services/ponto-controle-service.js';

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
    el('h3', { className: 'pc-ficha__bloco-titulo', textContent: titulo }),
    el('div', { className: 'detail-card' },
      visiveis.map(([rotulo, valor]) => linha(rotulo, vazio(valor) ? '—' : valor))),
  ]);
}

/**
 * Os arquivos do ponto, agrupados por tipo.
 *
 * O SCA registra o arquivo (nome, tipo, tamanho, checksum) e nao o guarda em
 * BYTEA: o RINEX e as fotos de um ponto passam de centenas de MB.
 *
 * O CAMINHO no volume NAO aparece, e o servidor nem o envia: e infraestrutura,
 * nao informacao do ponto, e quem consulta nao tem o que fazer com ele.
 */
function blocoArquivos(arquivos) {
  if (!arquivos || arquivos.length === 0) {
    return el('p', {
      className: 'pc-ficha__vazio',
      textContent: 'Nenhum arquivo registrado para este ponto.',
    });
  }

  const porTipo = new Map();
  for (const a of arquivos) {
    const chave = a.tipo_arquivo || `Tipo ${a.tipo_arquivo_id}`;
    if (!porTipo.has(chave)) porTipo.set(chave, []);
    porTipo.get(chave).push(a);
  }

  return el('div', { className: 'pc-ficha__arquivos' }, [...porTipo.entries()].map(([tipo, itens]) =>
    el('div', { className: 'pc-ficha__grupo' }, [
      el('div', { className: 'pc-ficha__grupo-titulo' }, [
        el('span', { textContent: tipo }),
        chip(String(itens.length), 'secondary'),
      ]),
      el('ul', { className: 'pc-ficha__lista' }, itens.map(a => el('li', {}, [
        svgIcon(ICONS.description, 14),
        el('span', {
          className: 'pc-ficha__arquivo-nome',
          textContent: a.extensao ? `${a.nome_arquivo}.${a.extensao}` : a.nome_arquivo,
        }),
        a.tamanho_mb != null
          ? el('span', {
            className: 'pc-ficha__arquivo-tamanho',
            textContent: numero(a.tamanho_mb, 1, ' MB') || '',
          })
          : null,
      ].filter(Boolean)))),
    ])
  ));
}

/**
 * A ficha inteira.
 *
 * A ordem dos blocos segue o CICLO do ponto, e nao a ordem das colunas na
 * tabela: identificacao, onde ele esta, como foi medido, com o que, como foi
 * processado, o marco no terreno, e por fim os arquivos. E a ordem em que
 * alguem confere um ponto de apoio.
 *
 * `lote_nome` e `projeto_nome` sao as ENTIDADES do acervo; `p.lote` e
 * `p.projeto` sao texto livre que o medidor digitou em campo, e por isso
 * aparecem com rotulo proprio, em vez de disputarem a mesma linha.
 *
 * O CPF do engenheiro responsavel EXISTE na tabela e NAO aparece aqui: ele entra
 * no acervo porque o BPC o exige na entrega, e nao para ser exibido a quem
 * consulta. Mesma razao de o usuario read-only nao receber GRANT no schema
 * (er/permissao_readonly.sql).
 */
function corpo(p, mostrarVazios) {
  const cabecalho = el('div', { className: 'pc-ficha__cabecalho' }, [
    chip(p.tipo_situacao_nome || `Situação ${p.tipo_situacao}`,
      VARIANTE_SITUACAO[p.tipo_situacao] || 'default'),
    p.reserva ? chip('Reserva', 'secondary') : null,
    p.materializado ? chip('Materializado', 'info') : null,
    p.geometria_aproximada ? chip('Geometria aproximada', 'warning') : null,
  ].filter(Boolean));

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
      ['Latitude', numero(p.geom_latitude ?? p.latitude, 8, '°')],
      ['Longitude', numero(p.geom_longitude ?? p.longitude, 8, '°')],
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

  return el('div', { className: 'pc-ficha' }, [
    cabecalho,
    ...blocos.map(([titulo, campos]) => bloco(titulo, campos, mostrarVazios)),

    !vazio(p.observacao)
      ? el('section', { className: 'pc-ficha__bloco' }, [
        el('h3', { className: 'pc-ficha__bloco-titulo', textContent: 'Observação' }),
        el('p', { className: 'pc-ficha__observacao', textContent: p.observacao }),
      ])
      : null,

    el('section', { className: 'pc-ficha__bloco' }, [
      el('h3', { className: 'pc-ficha__bloco-titulo', textContent: 'Arquivos' }),
      blocoArquivos(p.arquivos),
    ]),
  ].filter(Boolean));
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

  const corpoEl = el('div', {}, [
    el('p', { className: 'pc-ficha__carregando', textContent: 'Carregando…' }),
  ]);

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
  }, ['Próxima']);

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
  // dois botoes desativados e ruido.
  const raiz = el('div', {}, [
    lista.length > 1 ? navegacao : null,
    barraVazios,
    corpoEl,
  ].filter(Boolean));

  const modal = openModal({
    title: lista[atual],
    content: raiz,
    width: '760px',
    onClose: () => { fechado = true; },
    actions: [{ label: 'Fechar', variant: 'text', onClick: ({ close }) => close() }],
  });

  const tituloEl = modal.element.querySelector('.modal__title');

  function pintar() {
    const ponto = cache.get(lista[atual]);
    if (!ponto) return;
    corpoEl.replaceChildren(corpo(ponto, mostrarVazios));
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

    corpoEl.replaceChildren(
      el('p', { className: 'pc-ficha__carregando', textContent: 'Carregando…' })
    );
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
