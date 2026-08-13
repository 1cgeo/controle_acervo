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
 * módulos vive numa tabela só, e "o que o usuário X fez" não é pergunta de
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
  equipamento: 'Equipamento',
  plataforma: 'Plataforma',
};

/**
 * Para onde cada agregado leva.
 *
 * Sem isto a coluna "Onde" dizia "pedido #58" e parava ali: quem quisesse ver o
 * pedido tinha de ir procurá-lo na mão, que é justamente o passo que a tela
 * deveria poupar. O mapa tem de cobrir os 23 agregados: o que falta sai como
 * texto morto, e o que aponta rota inexistente leva a 404.
 *
 * DOIS DESTINOS, e a diferença é dita ao usuário:
 *
 *   'ficha'  vai direto ao registro. Só existe onde há rota de detalhe.
 *   'lista'  vai à tela onde o registro mora, porque ali a ficha é um diálogo
 *            aberto de dentro da lista (usuário, material do orçamento, meta).
 *
 * A regra antiga continua valendo, e é o que impede o caso do DFD de voltar:
 * link que não leva a nada é pior do que texto. Por isso nenhuma entrada aqui
 * inventa rota -- todas foram conferidas contra `router.add` e contra o
 * `path:` de cada módulo.
 */
const DESTINO = {
  // --- ficha própria (rota com :id) -----------------------------------------
  'mapoteca:pedido': { tipo: 'ficha', href: (id) => `#/mapoteca/pedidos/${id}` },
  'mapoteca:cliente': { tipo: 'ficha', href: (id) => `#/mapoteca/clientes/${id}` },
  // A ficha do insumo, e nao a de "materiais": as tres telas de material viraram
  // uma em 2026-08-08, e a rota velha caia em /404.
  'mapoteca:material': { tipo: 'ficha', href: (id) => `#/mapoteca/insumos/${id}` },
  'orcamento:nota_empenho': { tipo: 'ficha', href: (id) => `#/orcamento/notas_empenho/${id}` },
  'plataforma:edicao': { tipo: 'ficha', href: (id) => `#/rpcmtec/${id}` },
  // O bem tem ficha própria, e ela reúne os quatro históricos dele.
  'equipamento:equipamento': { tipo: 'ficha', href: (id) => `#/equipamento/bens/${id}` },
  // O produto do acervo abre em DIÁLOGO, de dentro da busca, e por isso não tem
  // rota própria. A busca honra `?produto_id=` justamente para este link
  // existir: é o agregado com mais evento órfão.
  'acervo:produto': { tipo: 'ficha', href: (id) => `#/acervo/busca?produto_id=${id}` },

  // --- a tela onde o registro mora ------------------------------------------
  'acervo:projeto': { tipo: 'lista', href: () => '#/acervo/administracao' },
  'acervo:volume': { tipo: 'lista', href: () => '#/acervo/administracao' },
  'acervo:ponto': { tipo: 'lista', href: () => '#/acervo/ponto_controle' },
  // A "manutencao" e o refresh das views materializadas, um ato do sistema
  // sobre si mesmo: ela nao tem ficha, tem a aba de onde se dispara.
  'acervo:manutencao': { tipo: 'lista', href: () => '#/acervo/administracao' },
  'orcamento:dfd': { tipo: 'lista', href: () => '#/orcamento/dfd' },
  'orcamento:nota_credito': { tipo: 'lista', href: () => '#/orcamento/notas_credito' },
  'orcamento:licitacao': { tipo: 'lista', href: () => '#/orcamento/licitacoes' },
  'orcamento:rpnp': { tipo: 'lista', href: () => '#/orcamento/rpnp' },
  'orcamento:pdr': { tipo: 'lista', href: () => '#/orcamento/pdr' },
  // SEM 'orcamento:configuracao', desde 2026-08-06: a tabela foi podada, e com
  // ela o agregado. Ela nunca gerou um evento, entao nenhum rastro antigo perde
  // o destino.
  'orcamento:dominio': { tipo: 'lista', href: () => '#/orcamento/configuracao' },
  // O TIPO é cadastro, e a ficha dele é um diálogo aberto de dentro da lista.
  //
  // SÃO SÓ DUAS ENTRADAS PARA O MÓDULO INTEIRO, e não seis: a indisponibilidade,
  // o afastamento, a manutenção e a transferência não são agregados próprios em
  // `server/src/auditoria/mapa/equipamento.js` -- as quatro tabelas são
  // auditadas SOB `equipamento`, com o `entidade_id` do BEM. É o mesmo recorte
  // da ficha, e é por isso que o link acima leva direto a ela.
  'equipamento:tipo_equipamento': { tipo: 'lista', href: () => '#/equipamento/configuracao' },
  'plataforma:usuario': { tipo: 'lista', href: () => '#/usuarios' },
  // A INSTITUICAO E UMA LINHA SO, entao nao ha ficha a abrir: o destino e a
  // propria tela, que ja mostra aquela linha. O `id` e sempre 1, por CHECK.
  'plataforma:instituicao': { tipo: 'lista', href: () => '#/instituicao' },
  'plataforma:capacitacao': { tipo: 'lista', href: (id, evento) => telaDaCapacitacao(evento) },
  'plataforma:meta': { tipo: 'lista', href: () => '#/metas' },
  'plataforma:exercicio': { tipo: 'lista', href: () => '#/metas' },
  'plataforma:extra_pit': { tipo: 'lista', href: () => '#/extra_pit' },
  // UMA ENTRADA PARA SEIS TABELAS, e não seis: as categorias, os militares, as
  // versões, as fotos e os tracks não são agregados próprios em
  // `server/src/auditoria/mapa/plataforma.js` -- todas são auditadas SOB
  // `campo`, com o `entidade_id` do CAMPO. É o mesmo recorte da ficha, e é por
  // isso que o link leva direto a ela.
  //
  // FICHA, e não lista: a tela de campo abre o detalhe pelo id na rota, e é lá
  // que a foto e o trajeto do evento aparecem.
  'plataforma:campo': { tipo: 'ficha', href: (id) => `#/campo/${id}` },
};

/** dominio.tipo_capacitacao, lido em er/dominio.sql. */
const CAPACITACAO_MINISTRADA = 1;
const CAPACITACAO_RECEBIDA = 2;

/**
 * De qual das DUAS telas de capacitação este evento é.
 *
 * A tabela `rpcmtec.capacitacao` é UMA, e as telas são duas:
 * a ministrada no PIT, a recebida em Efetivo. O destino fixo mandava toda
 * capacitação recebida para a tela do PIT, onde ela não está.
 *
 * O tipo sai do PRÓPRIO evento (`dados_depois`, ou `dados_antes` na exclusão),
 * que carrega a linha inteira. O evento da LISTA DE MILITARES
 * (`rpcmtec.capacitacao_militar`) não a carrega: a linha dele é sintética, com
 * `capacitacao_id` e os nomes. Aí devolve null, e a coluna sai como TEXTO.
 * Chutar uma das duas telas mandaria metade das pessoas a uma lista onde o
 * registro não está, e quem não o achar conclui que ele foi apagado.
 *
 * @param {Object} evento
 * @returns {string|null} o href, ou null quando o tipo não veio
 */
function telaDaCapacitacao(evento) {
  const linha = (evento && (evento.dados_depois || evento.dados_antes)) || {};
  if (linha.tipo_id == null) return null;
  const tipo = Number(linha.tipo_id);
  if (tipo === CAPACITACAO_RECEBIDA) return '#/capacitacao_recebida';
  if (tipo === CAPACITACAO_MINISTRADA) return '#/capacitacao_ministrada';
  return null;
}

/**
 * Nome de cada SUBSISTEMA, que no banco e a `entidade` do evento.
 *
 * A entidade e o AGREGADO dono: 'pedido' reune o pedido, os itens, as impressoes
 * e a etiqueta; 'produto' reune produto, versao, arquivo e relacionamento. E o
 * mesmo recorte da ficha que a pessoa abre, e por isso ele serve de filtro: quem
 * pergunta "o que mudou nos pedidos" nao quer saber em qual das quatro tabelas.
 *
 * Chave desconhecida cai no proprio nome, como no resto do sistema: agregado
 * novo aparece no combo enquanto ninguem o traduziu, em vez de sumir.
 *
 * AS CHAVES SAO AS DO SERVIDOR, uma a uma: o `entidade:` de cada entrada de
 * server/src/auditoria/mapa/*.js. Chave a mais
 * `index.test.js` guarda a igualdade. Chave a mais e entidade FANTASMA, que
 * oferece no combo um filtro que sempre volta vazio -- era o caso de
 * 'aproveitamento', removido: passagem pela DGEO e impedimento sao eventos do
 * agregado 'usuario'. Chave a menos deixa o nome cru do banco na tela -- era o
 * caso de 'exercicio' e 'manutencao'.
 */
export const NOME_ENTIDADE = {
  produto: 'Produtos, versões e arquivos',
  projeto: 'Projetos e lotes',
  volume: 'Volumes de armazenamento',
  ponto: 'Pontos de controle',
  pedido: 'Pedidos, itens e impressões',
  cliente: 'Clientes',
  material: 'Materiais, estoque e consumo',
  dfd: 'DFD',
  pdr: 'PDR',
  nota_credito: 'Notas de crédito',
  nota_empenho: 'Empenhos, liquidações e recebimentos',
  licitacao: 'Licitações',
  rpnp: 'RPNP',
  dominio: 'Tabelas de domínio',
  // O agregado do bem reúne CINCO tabelas: o equipamento, as indisponibilidades,
  // as manutenções, os afastamentos e as transferências. É o mesmo recorte da
  // ficha que a pessoa abre, e por isso ele serve de filtro: quem pergunta "o
  // que mudou nos equipamentos" não quer saber em qual das cinco tabelas.
  equipamento: 'Equipamentos, indisponibilidades e manutenções',
  tipo_equipamento: 'Tipos de equipamento',
  manutencao: 'Manutenção das visões do acervo',
  usuario: 'Usuários, perfis e passagens',
  meta: 'Metas do PIT e execução',
  exercicio: 'Exercícios e revisões do PIT',
  extra_pit: 'Extra-PIT',
  capacitacao: 'Capacitações',
  edicao: 'Edições do RPCMTec',
  // O agregado do campo reúne SEIS tabelas: o campo, as finalidades, os
  // militares, as versões atendidas, as fotos e os trajetos. Quem pergunta "o
  // que mudou nas atividades de campo" não quer saber em qual das seis.
  campo: 'Atividades de campo',
};


export async function renderRastreabilidade(container, ctx) {
  let disposed = false;
  let requisicao = 0;
  let pagina = 1;
  let tabela = null;

  // A ROTA MANDA. Outra tela aponta para um recorte desta
  // (#/rastreabilidade?usuario_uuid=...&data_inicio=...), e a tela chega
  // filtrada nele. Sem isto, nenhuma ficha consegue mostrar "o histórico desta
  // pessoa", e o link teria de ser explicado em prosa ao usuário.
  const query = ctx && ctx.query ? ctx.query : new URLSearchParams();

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
    filtros.entidade = valorDe('entidade');
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
            const destino = DESTINO[`${r.modulo}:${r.entidade}`];
            // O evento inteiro vai para o `href`: um agregado com mais de uma
            // tela decide por ele qual delas serve (ver telaDaCapacitacao).
            // Nulo aqui quer dizer "não sei para onde", e a célula vira texto.
            const href = destino ? destino.href(r.entidade_id, r) : null;
            return el('div', {}, [
              el('span', {
                className: 'rastro-onde__modulo',
                textContent: NOME_MODULO[r.modulo] || r.modulo,
              }),
              href
                ? el('a', {
                  className: 'rastro-onde__registro',
                  href,
                  // O título diz para ONDE vai. Prometer "abrir a ficha" e
                  // cair numa lista faz o usuário achar que se perdeu.
                  title: destino.tipo === 'ficha'
                    ? 'Abrir a ficha'
                    : 'Abrir a tela onde este registro mora',
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
  // `.form-field` e `.form-field__select` sao as classes do SISTEMA. Antes daqui
  // saia `form-control`, uma classe que NAO EXISTE em folha nenhuma: os combos
  // desta tela ficavam com o estilo padrao do navegador, e por isso destoavam de
  // todos os outros combos do SCA. Era classe fantasma, usada so neste arquivo.
  function campo(rotulo, controle) {
    return el('div', { className: 'form-field' }, [
      el('span', { className: 'form-field__label', textContent: rotulo }),
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

  function selectDe(nome, rotulo, opcoes, aoMudar = null) {
    const select = el('select', { className: 'form-field__select', 'aria-label': rotulo }, [
      el('option', { value: '', textContent: 'Todos' }),
      ...opcoes.map((o) => el('option', { value: o.valor, textContent: o.texto })),
    ]);
    select.addEventListener('change', () => {
      // O gancho roda ANTES de buscar: e ele que repovoa o combo dependente, e
      // pode descartar um valor que deixou de existir no recorte novo.
      coletarFiltros();
      if (aoMudar) aoMudar();
      aoFiltrar();
    });
    campos[nome] = select;
    return campo(rotulo, select);
  }

  function inputDe(nome, rotulo, tipo = 'text', dica = '') {
    const attrs = { className: 'form-field__input', type: tipo, 'aria-label': rotulo };
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
      // de nao aparecer. As QUATRO chaves entram, e nao tres: quem le adiante
      // espera a mesma FORMA do sucesso, e chave a menos so nao quebra hoje
      // porque cada leitura carrega um `|| []` de sobra.
      opcoes = { modulos: [], origens: [], usuarios: [], entidades: [] };
      // E A FALHA AVISA. Calada, ela deixava os combos com "Todos" e mais nada:
      // quem quisesse filtrar por pessoa concluia que o filtro nao existe, em
      // vez de tentar de novo.
      showError(`${err.message || 'Erro ao carregar as opções de filtro'}. `
        + 'Os filtros ficaram vazios. Recarregue a página para tentar de novo.');
    }
    if (disposed) return null;

    // O SUBSISTEMA depende do SISTEMA: a lista de agregados de cada modulo vem do
    // servidor em `entidades` ([{modulo, entidade}]). Sem a dependencia, o combo
    // ofereceria "Notas de credito" a quem filtrou a mapoteca, e o cruzamento
    // devolveria vazio sem dizer por que.
    const entidadesPorModulo = new Map();
    for (const e of opcoes.entidades || []) {
      if (!entidadesPorModulo.has(e.modulo)) entidadesPorModulo.set(e.modulo, []);
      entidadesPorModulo.get(e.modulo).push(e.entidade);
    }

    function entidadesVisiveis() {
      const escolhido = filtros.modulo;
      const lista = escolhido
        ? (entidadesPorModulo.get(escolhido) || [])
        // Sem sistema escolhido, o combo traz TODOS os subsistemas, sem repetir:
        // o mesmo nome nao existe em dois modulos, entao nao ha o que desempatar.
        : [...new Set((opcoes.entidades || []).map(e => e.entidade))];
      return lista.sort().map(ent => ({ valor: ent, texto: NOME_ENTIDADE[ent] || ent }));
    }

    function repovoarSubsistema() {
      const select = campos.entidade;
      if (!select) return;
      const escolhido = select.value;
      select.innerHTML = '';
      select.appendChild(el('option', { value: '', textContent: 'Todos' }));
      let aindaExiste = false;
      for (const o of entidadesVisiveis()) {
        select.appendChild(el('option', { value: o.valor, textContent: o.texto }));
        if (o.valor === escolhido) aindaExiste = true;
      }
      // Trocar de sistema com um subsistema escolhido que nao existe la deixaria
      // o filtro cobrando um cruzamento impossivel, e a tela viria vazia sem
      // dizer por que. Aqui ele e descartado junto.
      select.value = aindaExiste ? escolhido : '';
    }

    // O periodo sao dois campos que se leem juntos: "de" nao quer dizer nada
    // sozinho, e separados na grade eles caiam em linhas diferentes.
    const periodo = el('div', { className: 'rastro-filtros__periodo' }, [
      inputDe('data_inicio', 'De', 'date'),
      inputDe('data_fim', 'Até', 'date'),
    ]);

    const barra = el('div', { className: 'page__filters rastro-filtros' }, [
      // SISTEMA e SUBSISTEMA respondem "o que foi alterado", que era a pergunta
      // sem controle na tela. Entraram no lugar do combo de
      // ORIGEM, que respondia "por qual porta a mudanca entrou": e uma pergunta
      // de quem depura o sistema, e nao de quem procura uma alteracao. A origem
      // continua no rastro e aparece no detalhe de cada evento.
      //
      // O sistema aparece SEMPRE, mesmo com uma opcao so: para o gerente de um
      // modulo, ele diz de que recorte a tela esta falando -- e esse recorte e do
      // servidor, nao dele.
      selectDe('modulo', 'Sistema', (opcoes.modulos || []).map((m) => ({
        valor: m, texto: NOME_MODULO[m] || m,
      })), () => repovoarSubsistema()),
      selectDe('entidade', 'Subsistema', entidadesVisiveis()),
      selectDe('usuario_uuid', 'Usuário', (opcoes.usuarios || []).map((u) => ({
        valor: u.usuario_uuid,
        texto: u.posto ? `${u.posto} ${u.nome_guerra}` : (u.nome_guerra || u.nome),
      }))),
      selectDe('operacao', 'Operação', [
        { valor: 'I', texto: 'Adicionou' },
        { valor: 'U', texto: 'Alterou' },
        { valor: 'D', texto: 'Removeu' },
      ]),
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

    /**
     * Põe no controle o valor que veio na URL.
     *
     * O valor entra no COMBO, e não só na variável de filtro: filtro que age
     * sem aparecer faz a lista parecer curta sem dizer por quê, e o botão
     * "Limpar" não teria como desfazê-lo.
     *
     * O combo vem do que EXISTE na tabela de eventos. Valor que não está lá
     * ganha uma opção própria, em vez de ser descartado: descartá-lo mostraria
     * o sistema inteiro a quem pediu uma pessoa, que é o pior dos dois erros.
     * Resultado vazio é a resposta certa para quem nunca gerou evento.
     *
     * @param {string} nome - o campo, que é também o nome do parâmetro
     * @returns {boolean} verdadeiro quando a rota trouxe valor aceito
     */
    function definirDaRota(nome) {
      const valor = query.get(nome);
      if (valor === null || valor === '') return false;
      const controle = campos[nome];
      if (!controle) return false;

      if (controle.tagName === 'SELECT') {
        const existe = [...controle.options].some((o) => o.value === valor);
        if (!existe) {
          controle.appendChild(el('option', {
            value: valor,
            textContent: nome === 'entidade' ? (NOME_ENTIDADE[valor] || valor) : valor,
          }));
        }
      }
      controle.value = valor;
      // Data inválida, que o campo `date` recusa em silêncio: o filtro seria
      // uma string que o servidor rejeita, e a tela abriria em erro.
      return controle.value === valor;
    }

    // O SISTEMA primeiro: é ele que decide quais subsistemas o combo oferece.
    if (definirDaRota('modulo')) {
      coletarFiltros();
      repovoarSubsistema();
    }
    ['entidade', 'usuario_uuid', 'operacao', 'data_inicio', 'data_fim', 'campo']
      .forEach(definirDaRota);

    return barra;
  }

  // --- Montagem -------------------------------------------------------------

  const cabecalho = el('div', { className: 'page__header' }, [
    el('h1', { className: 'page__title', textContent: 'Rastreabilidade' }),
  ]);

  // SEM SUBTÍTULO E SEM O BLOCO "O que esta tela não registra", desde
  // 2026-08-06. O subtítulo dizia o que a tabela mostra por si (módulo, data,
  // usuário), e o bloco recolhido explicava dois limites do registro.
  //
  // O QUE SE PERDEU, e vale saber: o rastro começa na data em que esta tela
  // entrou em produção, então resultado vazio para período anterior a ela não
  // prova que nada mudou. Quem precisar dessa ressalva a encontra no schema
  // (`er/auditoria.sql`) e na migração que criou o registro.

  root.appendChild(cabecalho);

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
