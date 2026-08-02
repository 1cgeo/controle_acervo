import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { criarPaginacao } from '@components/paginacao/paginacao.js';
import { chip } from '@components/status-chip.js';
import { formatDateTime, formatNumber } from '@utils/format.js';
import { showError } from '@utils/toast.js';
import {
  OPERACAO,
  autor,
  celulaDoQueMudou,
  abrirDetalheDoEvento,
} from '@components/historico/historico.js';
import { getRastreabilidade, getFiltrosRastreabilidade } from '@services/rastreabilidade-service.js';
import './rastreabilidade.css';

/**
 * Tela de RASTREABILIDADE (#/rastreabilidade).
 *
 * A varredura: "o que mudou ontem", "o que a pessoa X fez", "o que foi apagado
 * esta semana". O histórico DE UM registro mora no registro (o componente
 * `components/historico/`, nas seis fichas); aqui é o corte transversal.
 *
 * O NOME NÃO É "AUDITORIA", e isso é deliberado: `#/acervo/auditoria` já existe
 * e quer dizer outra coisa (os invariantes do acervo, que medem a coerência
 * entre tabelas HOJE e não dizem quem produziu a incoerência). Duas telas com o
 * mesmo nome e perguntas diferentes seriam confundidas para sempre.
 *
 * TELA DE PLATAFORMA, ao lado de #/usuarios, #/acessos e #/rpcmtec: o rastro dos
 * três módulos vive numa tabela só, e "o que o usuário X fez" não é pergunta de
 * módulo nenhum.
 *
 * O RECORTE É DO SERVIDOR. Administrador global vê tudo e ganha o filtro de
 * módulo; gerente vê o módulo dele e o filtro nem aparece. Quem decide é o
 * `verifyRastreabilidade`, e a tela só desenha o que ele mandou (`escopo` vem na
 * resposta). Recorte de cliente seria sugestão: a rota devolveria os outros
 * módulos a quem soubesse chamá-la.
 *
 * PAGINAÇÃO DE SERVIDOR, pela decisão que a casa já tomou nas três listas de
 * diagnóstico do acervo: esta é a lápide do sistema inteiro e não cabe numa
 * resposta. O laço é o de `pages/administracao/lista-paginada.js` (inclusive o
 * token de requisição, que descarta resposta atrasada), copiado e não reusado
 * porque aquele helper não tem onde encaixar uma barra de filtros, e acrescentá-la
 * mudaria um componente que três telas já usam por causa de uma quarta.
 */

const NOME_MODULO = {
  acervo: 'Acervo',
  mapoteca: 'Mapoteca',
  orcamento: 'Orçamento',
  plataforma: 'Plataforma',
};

/**
 * A ficha de cada agregado, quando ela existe.
 *
 * Sem isto a coluna "Onde" dizia "pedido #58" e parava ali: quem quisesse ver o
 * pedido tinha de ir procurá-lo na mão, que é justamente o passo que a tela
 * deveria poupar. Entidade sem rota de detalhe (volume, material, plotter, e o
 * usuário, cuja ficha é um diálogo dentro da lista) fica em TEXTO, e não vira
 * link para lugar nenhum: link que não leva a nada é pior do que texto.
 */
const FICHA = {
  'mapoteca:pedido': (id) => `#/mapoteca/pedidos/${id}`,
  'orcamento:nota_empenho': (id) => `#/orcamento/notas_empenho/${id}`,
  'orcamento:dfd': (id) => `#/orcamento/dfd/${id}`,
};

const NOME_ORIGEM = {
  web: 'Interface web',
  qgis: 'Plugin do QGIS',
  cli: 'Linha de comando',
  gatilho: 'Efeito no banco',
  sistema: 'Sistema',
  migracao: 'Migração',
  desconhecido: 'Não registrada',
};

export async function renderRastreabilidade(container, _ctx) {
  let disposed = false;
  let requisicao = 0;
  let pagina = 1;
  let tabela = null;

  const root = el('div', { className: 'page' });
  container.appendChild(root);

  // --- Estado dos filtros ---------------------------------------------------
  const filtros = {};

  const campos = {};

  function valorDe(nome) {
    const v = campos[nome] && campos[nome].value;
    return v === '' || v === undefined ? null : v;
  }

  function coletarFiltros() {
    filtros.modulo = valorDe('modulo');
    filtros.usuario_uuid = valorDe('usuario_uuid');
    filtros.operacao = valorDe('operacao');
    filtros.origem = valorDe('origem');
    filtros.campo = valorDe('campo');
    filtros.data_inicio = valorDe('data_inicio');
    filtros.data_fim = valorDe('data_fim');
  }

  // --- Tabela e paginação ---------------------------------------------------

  const corpo = el('div', { className: 'data-table__empty', textContent: 'Carregando...' });

  // Quantos eventos o recorte encontrou. Fica DENTRO da barra de filtros:
  // solta dela, a contagem se le sem que se saiba a que filtro ela se refere.
  const contagemEl = el('span', { className: 'rastro-filtros__contagem' });

  const paginacao = criarPaginacao({
    onMudar: (novaPagina, tamanho) => {
      pagina = novaPagina;
      carregar(tamanho);
    },
  });

  function montarTabela(eventos) {
    if (tabela) tabela._cleanup();

    tabela = createDataTable({
      columns: [
        {
          key: 'data_evento',
          label: 'Quando',
          className: 'rastro-col-quando',
          render: (r) => formatDateTime(r.data_evento),
        },
        {
          key: 'usuario_nome',
          label: 'Quem',
          className: 'rastro-col-quem',
          render: (r) => autor(r),
        },
        {
          key: 'modulo',
          label: 'Onde',
          className: 'rastro-col-onde',
          render: (r) => {
            const rotulo = `${r.entidade} #${r.entidade_id}`;
            const href = FICHA[`${r.modulo}:${r.entidade}`];
            return el('div', {}, [
              el('span', {
                className: 'rastro-onde__modulo',
                textContent: NOME_MODULO[r.modulo] || r.modulo,
              }),
              href
                ? el('a', {
                  className: 'rastro-onde__registro',
                  href: href(r.entidade_id),
                  title: 'Abrir a ficha',
                }, [rotulo])
                : el('span', { className: 'rastro-onde__registro', textContent: rotulo }),
            ]);
          },
        },
        {
          key: 'operacao',
          label: 'O quê',
          className: 'rastro-col-oque',
          render: (r) => {
            const op = OPERACAO[r.operacao];
            return op ? chip(op.texto, op.cor) : (r.operacao || '-');
          },
        },
        {
          key: 'mudancas',
          label: 'O que mudou',
          className: 'rastro-col-mudou',
          render: (r) => celulaDoQueMudou(r, abrirDetalheDoEvento),
        },
      ],
      rows: eventos,
      // O servidor já paginou: `paginated: true` faria o data-table paginar de
      // novo em cima das 20 linhas que ele recebeu.
      paginated: false,
      // Sem busca: ela filtraria só as linhas desta página, e diria "nenhum
      // resultado" para um evento que existe na página 7.
      searchable: false,
      emptyMessage: 'Nenhuma alteração registrada com esses filtros',
      actions: [{
        icon: ICONS.visibility,
        title: 'Ver as diferenças',
        onClick: (r) => abrirDetalheDoEvento(r),
      }],
    });

    clearChildren(corpo);
    corpo.className = '';
    corpo.appendChild(tabela.element);
  }

  async function carregar(tamanho = paginacao.tamanho()) {
    requisicao += 1;
    const meu = requisicao;

    if (tabela) tabela.update({ loading: true });

    let resposta;
    try {
      resposta = await getRastreabilidade({ ...filtros, page: pagina, limit: tamanho });
    } catch (err) {
      // Resposta atrasada de um filtro antigo não pode sobrescrever a tela: sem
      // este descarte, trocar de filtro depressa faz a antiga chegar depois da
      // nova. Vale também para o caminho de erro.
      if (disposed || meu !== requisicao) return;
      clearChildren(corpo);
      corpo.className = 'data-table__empty';
      corpo.textContent = err.message || 'Erro ao carregar a rastreabilidade';
      paginacao.atualizar(null);
      showError(err.message || 'Erro ao carregar a rastreabilidade');
      return;
    }
    if (disposed || meu !== requisicao) return;

    montarTabela(resposta.dados || []);
    paginacao.atualizar(resposta.pagination);

    const total = (resposta.pagination && resposta.pagination.totalItems) || 0;
    contagemEl.textContent = total === 1
      ? '1 alteração'
      : `${formatNumber(total)} alterações`;
  }

  // --- Barra de filtros -----------------------------------------------------

  // Rotulo ACIMA do campo, sempre. Ao lado ele rouba a largura do controle e
  // some quando a tela estreita, e foi o que deixou a barra com "De" grudado no
  // seletor de data e "Campo alterado" escrito duas vezes (rotulo mais
  // placeholder).
  function campo(rotulo, controle) {
    return el('div', { className: 'rastro-filtros__campo' }, [
      el('span', { className: 'rastro-filtros__rotulo', textContent: rotulo }),
      controle,
    ]);
  }

  function aoFiltrar() {
    coletarFiltros();
    // Trocar filtro volta para a primeira pagina: a pagina 7 do filtro anterior
    // nao quer dizer nada no novo.
    pagina = 1;
    carregar();
  }

  function selectDe(nome, rotulo, opcoes) {
    const select = el('select', { className: 'form-control', 'aria-label': rotulo }, [
      el('option', { value: '', textContent: 'Todos' }),
      ...opcoes.map((o) => el('option', { value: o.valor, textContent: o.texto })),
    ]);
    select.addEventListener('change', aoFiltrar);
    campos[nome] = select;
    return campo(rotulo, select);
  }

  function inputDe(nome, rotulo, tipo = 'text', dica = '') {
    const attrs = { className: 'form-control', type: tipo, 'aria-label': rotulo };
    if (dica) attrs.placeholder = dica;
    const input = el('input', attrs);
    // `change`, e nao `input`: com `input` cada tecla de "valor_empenhado"
    // dispararia uma consulta paginada sobre a tabela inteira.
    input.addEventListener('change', aoFiltrar);
    campos[nome] = input;
    return campo(rotulo, input);
  }

  async function montarBarra() {
    let opcoes;
    try {
      opcoes = await getFiltrosRastreabilidade();
    } catch (err) {
      // Sem as opcoes a tela ainda serve: a lista aparece sem os combos, em vez
      // de nao aparecer.
      opcoes = { modulos: [], origens: [], usuarios: [] };
    }
    if (disposed) return null;

    const podeEscolherModulo = (opcoes.modulos || []).length > 1;

    // O periodo sao dois campos que se leem juntos: "de" nao quer dizer nada
    // sozinho, e separados na grade eles caiam em linhas diferentes.
    const periodo = el('div', { className: 'rastro-filtros__periodo' }, [
      inputDe('data_inicio', 'De', 'date'),
      inputDe('data_fim', 'Até', 'date'),
    ]);

    const barra = el('div', { className: 'rastro-filtros' }, [
      // O combo de modulo so existe para quem tem mais de um: para o gerente de
      // um modulo so, ele seria um controle com uma opcao.
      podeEscolherModulo
        ? selectDe('modulo', 'Módulo', opcoes.modulos.map((m) => ({
          valor: m, texto: NOME_MODULO[m] || m,
        })))
        : null,
      selectDe('usuario_uuid', 'Usuário', (opcoes.usuarios || []).map((u) => ({
        valor: u.usuario_uuid,
        texto: u.posto ? `${u.posto} ${u.nome_guerra}` : (u.nome_guerra || u.nome),
      }))),
      selectDe('operacao', 'Operação', [
        { valor: 'I', texto: 'Adicionou' },
        { valor: 'U', texto: 'Alterou' },
        { valor: 'D', texto: 'Removeu' },
      ]),
      selectDe('origem', 'Origem', (opcoes.origens || []).map((o) => ({
        valor: o, texto: NOME_ORIGEM[o] || o,
      }))),
      periodo,
      // Busca pelo NOME DA COLUNA, e nao por texto livre dentro do JSON: o
      // servidor casa contra o array indexavel `campos_alterados`, e texto livre
      // seria varredura de JSONB sobre a tabela inteira. A dica no campo diz
      // isso sem precisar de uma frase de ajuda ao lado.
      inputDe('campo', 'Campo alterado', 'text', 'ex.: valor_empenhado'),
      el('div', { className: 'rastro-filtros__acoes' }, [
        el('button', {
          className: 'btn btn--secondary btn--sm',
          type: 'button',
          onClick: () => {
            Object.values(campos).forEach((c) => { c.value = ''; });
            aoFiltrar();
          },
        }, [svgIcon(ICONS.close, 14), 'Limpar']),
        contagemEl,
      ]),
    ].filter(Boolean));

    return barra;
  }

  // --- Montagem -------------------------------------------------------------

  // O subtítulo fica FORA do `page__header`, que é um flex de uma linha: dentro
  // dele a frase ia para a direita do título e ficava órfã no canto da tela. É o
  // arranjo que `#/acessos` já usa.
  const cabecalho = el('div', { className: 'page__header' }, [
    el('h1', { className: 'page__title', textContent: 'Rastreabilidade' }),
  ]);
  const subtitulo = el('p', {
    className: 'page__subtitle',
    textContent: 'O que foi alterado nos módulos, quando e por quem.',
  });

  // As duas frases que a tela diz sobre si mesma. Elas PRECISAM existir: sem
  // elas, a ausencia de registro se le como "ninguem mexeu", e nao como "o
  // sistema nao estava olhando". Mas como dois paragrafos permanentes no topo
  // elas competiam com o titulo e empurravam a tabela para baixo da dobra, entao
  // ficam recolhidas: quem ja sabe nao paga por elas toda vez, e quem estranhou
  // um resultado vazio tem a resposta a um clique.
  const avisos = el('details', { className: 'rastro-aviso' }, [
    el('summary', {}, [
      svgIcon(ICONS.info, 16),
      el('span', { textContent: 'O que esta tela não registra' }),
    ]),
    el('p', {
      textContent: 'Ela registra alterações a partir da entrada desta tela em produção. '
        + 'Alteração anterior a ela não foi gravada, e a ausência aqui não quer dizer que nada mudou.',
    }),
    el('p', {
      textContent: 'Não registra consultas nem downloads. Quem entrou no sistema está no '
        + 'dashboard de usuários; quem baixou arquivo está no histórico de download do acervo.',
    }),
  ]);

  root.appendChild(cabecalho);
  root.appendChild(subtitulo);
  root.appendChild(avisos);

  const barra = await montarBarra();
  if (disposed) return () => {};
  if (barra) root.appendChild(barra);

  root.appendChild(corpo);
  root.appendChild(paginacao.element);

  coletarFiltros();
  carregar();

  return () => {
    disposed = true;
    requisicao += 1;
    if (tabela) tabela._cleanup();
  };
}
