import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { createDataTable } from '@components/data-table/data-table.js';
import { createSelectField, createTextField } from '@components/form-fields/form-fields.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { createTabs } from '@components/tabs/tabs.js';
import { chip } from '@components/status-chip.js';
import { temPerfil } from '@store/auth-store.js';
import {
  getDominioCampo, listarCampos, getCamposGeojson, getCampo, excluirCampo,
} from '@services/campo-service.js';
import { getUsuarios } from '@services/plataforma-service.js';
import { criarMapaCampos } from './campo-mapa.js';
import { openCampoDialog } from './campo-dialog.js';
import { abrirDetalheCampo } from './campo-detalhe.js';
import './campo.css';

const dia = (valor) => (valor
  ? String(valor).slice(0, 10).split('-').reverse().join('/')
  : '-');

/** campo.situacao, para a cor do chip. */
const VARIANTE = { 1: 'info', 2: 'warning', 3: 'success', 4: 'error' };

const VAZIO = 'Nenhuma atividade de campo para estes filtros';

/**
 * ATIVIDADES DE CAMPO: uma página, duas visões.
 *
 * UMA PÁGINA, por decisão do chefe em 2026-08-08. No SAP eram DUAS telas: uma só
 * de mapa, com barra lateral, e outra só de gestão, com quatro abas. Quem queria
 * ver onde um campo tinha sido e quem foi nele trocava de tela e perdia o
 * recorte. Aqui a tabela e o mapa são abas da MESMA página, leem os MESMOS
 * filtros, e a ficha é a mesma nas duas.
 *
 * OS FILTROS SÃO ÚNICOS PARA AS DUAS VISÕES, e é o ponto: `/campo` e
 * `/campo/geojson` recebem a mesma query. Um filtro que valesse só numa faria a
 * tabela e o mapa discordarem sobre quantos campos existem, e ninguém saberia
 * qual acreditar.
 *
 * O MAPA SÓ CARREGA QUANDO A ABA ABRE. O MapLibre passa de meio megabyte, e a
 * maioria das visitas fica na tabela.
 *
 * A GUARDA DA TELA É `consulta` NO PIT, e o que ela decide é só a PORTA. O
 * que barra escrita é o `verifyPerfil` no servidor, que lê o perfil do BANCO a
 * cada requisição. Os `podeEscrever`/`podeApagar` abaixo são ERGONOMIA: eles
 * escondem botões que responderiam 403.
 */
export async function renderCampo(container, ctx) {
  let disposed = false;

  // A RÉGUA, pela frase do chefe em 2026-08-09: o OPERADOR cadastra e edita
  // campos -- e "editar" inclui acrescentar e remover foto, vídeo e trajeto, que
  // desde essa data moram dentro do formulário de edição. O VISUALIZADOR só vê:
  // a lista, o mapa, a ficha, as fotos, os vídeos e os trajetos. O GERENTE e o
  // ADMINISTRADOR fazem tudo, e o "tudo" a mais é APAGAR o campo.
  //
  // ISTO É ERGONOMIA, e não a guarda: quem barra escrita é o `verifyPerfil` no
  // servidor, que lê o perfil do BANCO a cada requisição. Estes dois só escondem
  // botão que responderia 403.
  const podeEscrever = temPerfil('operador', 'pit');
  // GERENTE para apagar, e não operador. O `ON DELETE CASCADE` leva as fotos,
  // os vídeos, os trajetos e os vínculos junto: apagar um campo de 2019 destrói
  // as únicas cópias daquelas fotos.
  const podeApagar = temPerfil('gerente', 'pit');

  // A ROTA MANDA. A rastreabilidade aponta uma ficha (#/campo/12), e a tela
  // chega com ela aberta.
  const idDaRota = ctx && ctx.params ? Number(ctx.params.id) : null;

  let filtros = { ano: null, situacao_id: null, categoria_id: null, busca: '' };
  let linhas = [];
  let erro = null;
  let dominio = { situacoes: [], categorias: [], anos: [] };
  let usuarios = [];
  let mapa = null;
  let abaAtiva = 'tabela';
  // Alguém já sabe para onde o mapa vai, e o re-enquadramento automático da
  // troca de campos deve ceder a vez. Ver `verTrajetoNoMapa`.
  let enquadramentoReservado = false;

  // --- Filtros --------------------------------------------------------------

  const anoFilter = createSelectField({
    label: 'Ano do PIT',
    options: [],
    placeholder: 'Todos os anos',
    value: null,
    onChange: (v) => { filtros.ano = v === null ? null : Number(v); carregar(); },
  });

  const situacaoFilter = createSelectField({
    label: 'Situação',
    options: [],
    placeholder: 'Todas',
    value: null,
    onChange: (v) => { filtros.situacao_id = v === null ? null : Number(v); carregar(); },
  });

  const categoriaFilter = createSelectField({
    label: 'Finalidade',
    options: [],
    placeholder: 'Todas',
    value: null,
    onChange: (v) => { filtros.categoria_id = v === null ? null : Number(v); carregar(); },
  });

  // A BUSCA VAI AO SERVIDOR, e não é o filtro do data-table: ela também recorta
  // o MAPA. Uma busca só de tabela deixaria o mapa mostrando campos que a lista
  // ao lado já tinha escondido.
  let debounce = null;
  const buscaFilter = createTextField({
    label: 'Buscar',
    placeholder: 'Nome ou descrição',
    onInput: (v) => {
      filtros.busca = v;
      if (debounce) clearTimeout(debounce);
      debounce = setTimeout(() => { if (!disposed) carregar(); }, 350);
    },
  });

  // --- Ações ----------------------------------------------------------------

  const abrirFormulario = (campo) => openCampoDialog({
    campo,
    situacoes: dominio.situacoes,
    categorias: dominio.categorias,
    anos: dominio.anos,
    usuarios,
    onSaved: carregar,
  });

  /**
   * Editar A PARTIR DA LINHA DA TABELA: busca a FICHA e só então abre.
   *
   * A linha da lista NÃO TEM A GEOMETRIA, e isso é deliberado no servidor
   * (`SELECT_LISTA` deixa `geom` de fora, e quem quer área pede a ficha ou o
   * `/geojson`). O formulário lê a área de `campo.geometria`: aberto com a
   * linha crua, ele dizia "Nenhuma área definida" num campo que TEM área, e o
   * Salvar então travava pedindo o GeoJSON de novo -- a tela ficava sem como
   * editar a situação de um campo já cadastrado. Pego em 2026-08-20, no campo
   * de Porto União. O caminho pela ficha nunca teve o defeito, porque lá o
   * objeto já vem de `GET /campo/:id`.
   */
  const editarPelaLinha = async (id) => {
    try {
      abrirFormulario(await getCampo(id));
    } catch (err) {
      showError(err.message || 'Não foi possível abrir o campo para edição');
    }
  };

  // A FICHA É SÓ LEITURA desde 2026-08-09, e o único botão dela que leva a
  // escrever é "Editar", que a fecha e abre o formulário. `podeEditar` decide
  // só se esse botão aparece.
  const abrirFicha = (id) => abrirDetalheCampo({
    id,
    podeEditar: podeEscrever,
    onEditar: abrirFormulario,
    onVerTrajetoNoMapa: verTrajetoNoMapa,
  });

  /**
   * O botão "Ver no mapa" da aba Trajetos da ficha.
   *
   * UM TRAJETO POR VEZ, e nunca o lote (chefe, 2026-08-13). O mapa desenha o
   * que a pessoa apontou; ver "todos" é a área do campo, que já está lá.
   *
   * TROCA DE ABA, DESENHA E ENQUADRA, nessa ordem, e cada passo depende do
   * anterior. `setActive('mapa')` é ASSÍNCRONO e o `render` dele constrói o mapa
   * na primeira vez e chama `desenharMapa()`, que ZERA os trajetos -- desenhar
   * antes de esperá-lo apagaria o que se acabou de pedir.
   *
   * O TRAJETO JÁ VEM CARREGADO, e não se pede de novo: a ficha o leu para
   * montar a lista, e a linha de um trajeto de viatura passa de 6.000 pontos.
   *
   * O ENQUADRAMENTO É DO TRAJETO, e não do campo. São coisas de tamanhos
   * diferentes: a linha de um dia cobre uma fração da área da reambulação, e
   * enquadrar o campo deixaria o trajeto como um risco no meio da tela.
   */
  async function verTrajetoNoMapa({ campoId, track }) {
    if (!track || !track.geometria) return;
    const desenhar = [track];

    // A RESERVA É FEITA ANTES DE A ABA MONTAR, e é ela que mata o pulo. O
    // `render` da aba chama `desenharMapa()`, que troca os campos e, por
    // padrão, re-enquadra TUDO: com a aba já aberta isso dava um zoom out no
    // mundo inteiro um instante antes do zoom in no trajeto. A bandeira diz ao
    // `desenharMapa` que o enquadramento já tem dono.
    enquadramentoReservado = true;
    try {
      await abas.setActive('mapa');
      if (disposed || !mapa) return;

      mapa.setTracks(desenhar);
      mapa.selecionar(Number(campoId));

      // TETO DE ZOOM MAIS BAIXO que o do campo: a linha é fina e comprida, e
      // colar nela esconde a área que ela percorreu.
      mapa.enquadrar(track.geometria, 13);
    } finally {
      // NO `finally`, e não depois do enquadramento: uma falha no meio deixaria
      // a bandeira levantada, e o próximo filtro nunca mais re-enquadraria.
      enquadramentoReservado = false;
    }
  }

  const apagar = async (linha) => {
    const ok = await confirmDialog({
      title: 'Remover campo',
      message: `Remover "${linha.nome}"? As ${linha.total_imagens} foto(s)/vídeo(s) e `
        + `${linha.total_tracks} trajeto(s) vão junto, e os bytes só existem aqui.`,
      confirmLabel: 'Remover',
      danger: true,
    });
    if (!ok) return;
    try {
      await excluirCampo(linha.id);
      showSuccess('Campo removido com sucesso');
      carregar();
    } catch (err) {
      showError(err.message || 'Erro ao remover o campo');
    }
  };

  const acoes = [
    { label: 'Ficha', icon: ICONS.visibility, title: 'Abrir a ficha', onClick: (r) => abrirFicha(r.id) },
  ];
  if (podeEscrever) {
    acoes.push({
      label: 'Editar',
      icon: ICONS.edit,
      title: 'Editar o campo',
      onClick: (r) => editarPelaLinha(r.id),
    });
  }
  if (podeApagar) {
    acoes.push({
      label: 'Remover', icon: ICONS.delete, title: 'Remover o campo',
      variant: 'danger', onClick: apagar,
    });
  }

  const novoBtn = podeEscrever
    ? el('button', {
      className: 'btn btn--primary',
      type: 'button',
      onClick: () => openCampoDialog({
        situacoes: dominio.situacoes,
        categorias: dominio.categorias,
        anos: dominio.anos,
        usuarios,
        onSaved: carregar,
      }),
    }, [svgIcon(ICONS.add, 16), 'Novo campo'])
    : null;

  // --- Tabela ---------------------------------------------------------------

  const tabela = createDataTable({
    columns: [
      { key: 'nome', label: 'Campo', sortable: true },
      { key: 'ano', label: 'Ano', sortable: true, className: 'text-center' },
      {
        key: 'situacao',
        label: 'Situação',
        sortable: true,
        render: (r) => chip(r.situacao, VARIANTE[r.situacao_id] || 'default'),
      },
      {
        key: 'periodo',
        label: 'Período',
        sortValue: (r) => r.data_inicio,
        render: (r) => `${dia(r.data_inicio)} a ${dia(r.data_fim)}`,
      },
      {
        key: 'finalidades_texto',
        label: 'Finalidade',
        // O data-table busca e ordena por `row[key]`. `categorias` é uma LISTA
        // DE OBJETOS, e `String(lista)` vira "[object Object]": buscar pela
        // finalidade não achava nada. O texto entra como campo próprio da linha.
        sortable: true,
      },
      { key: 'efetivo_texto', label: 'Efetivo' },
      {
        key: 'anexos',
        label: 'Anexos',
        className: 'text-center',
        sortValue: (r) => (r.total_imagens || 0) + (r.total_tracks || 0),
        render: (r) => `${r.total_imagens || 0} mídia · ${r.total_tracks || 0} trajeto`,
      },
    ],
    rows: [],
    searchable: false,
    pageSize: 25,
    actions: acoes,
    defaultSort: { key: 'periodo', dir: 'desc' },
    emptyMessage: VAZIO,
    loading: true,
  });

  // --- Layout ---------------------------------------------------------------

  const faixaErro = el('p', { className: 'campo-detalhe__erro hidden', role: 'alert' });

  const areaTabela = el('div', {}, [tabela.element]);
  const areaMapa = el('div', { className: 'campo-mapa__area' });

  const abas = createTabs({
    tabs: [
      {
        id: 'tabela',
        label: 'Tabela',
        render: (c) => {
          abaAtiva = 'tabela';
          c.appendChild(areaTabela);
        },
      },
      {
        id: 'mapa',
        label: 'Mapa',
        render: async (c) => {
          abaAtiva = 'mapa';
          c.appendChild(areaMapa);
          if (!mapa) {
            mapa = criarMapaCampos({
              onSelecionar: (id) => {
                // O CLIQUE NO CAMPO ABRE A FICHA, E SÓ. Ele NÃO desenha mais os
                // trajetos daquele campo, por decisão do chefe em 2026-08-13:
                // o mapa mostra UM trajeto por vez, e quem escolhe qual é o
                // botão "Ver no mapa" da aba Trajetos. Cascavel 2026 tem 17
                // trajetos, e o clique despejava os 17 de uma vez -- 30.338
                // pontos de linha sobrepostos, que não respondem "por onde a
                // viatura andou".
                abrirFicha(id);
              },
            });
            areaMapa.appendChild(mapa.element);
            await mapa.iniciar();
          }
          if (!disposed) {
            await desenharMapa();
            mapa.redimensionar();
          }
          return { cleanup: () => {} };
        },
      },
    ],
  });

  const root = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Atividades de campo' }),
      el('div', { className: 'page__actions' }, [novoBtn].filter(Boolean)),
    ]),
    el('div', { className: 'page__filters' }, [
      anoFilter.element, situacaoFilter.element, categoriaFilter.element, buscaFilter.element,
    ]),
    faixaErro,
    abas.element,
  ]);
  container.appendChild(root);

  // --- Carga ----------------------------------------------------------------

  /**
   * O DOMÍNIO E O CADASTRO, cada um com o próprio `catch`.
   *
   * `getUsuarios` é `verifyAdmin` no servidor: para quem não é administrador ela
   * responde 403, SEMPRE. Num `Promise.all` com o domínio ela derrubaria a tela
   * inteira com "necessita ser um administrador", que foi exatamente o que
   * matou `#/aproveitamento` em 2026-08-08. Aqui ela falha sozinha e o pior que
   * acontece é o seletor de militares do formulário nascer vazio.
   */
  async function carregarApoio() {
    try {
      dominio = await getDominioCampo();
      if (disposed) return;
      anoFilter.setOptions((dominio.anos || []).map(a => ({ value: a.ano, label: String(a.ano) })));
      situacaoFilter.setOptions((dominio.situacoes || []).map(s => ({ value: s.code, label: s.nome })));
      categoriaFilter.setOptions((dominio.categorias || []).map(c => ({ value: c.code, label: c.nome })));
    } catch {
      // Sem o domínio os filtros nascem vazios e o formulário não tem o que
      // oferecer, mas a LISTA continua carregando: ela não depende dele.
      dominio = { situacoes: [], categorias: [], anos: [] };
    }

    try {
      const lista = await getUsuarios();
      if (disposed) return;
      usuarios = (lista || [])
        .filter(u => u.ativo)
        .map(u => ({
          uuid: u.uuid,
          nome: u.nome,
          nome_guerra: u.nome_guerra,
          posto_abrev: u.tipo_posto_grad,
          tipo_posto_grad_id: u.tipo_posto_grad_id,
          ativo: true,
        }))
        .sort((a, b) => (b.tipo_posto_grad_id - a.tipo_posto_grad_id)
          || a.nome_guerra.localeCompare(b.nome_guerra));
    } catch {
      usuarios = [];
    }
  }

  /** A linha do servidor mais os textos que a tabela busca e ordena. */
  const paraLinha = (campo) => {
    const doCadastro = (campo.militares || [])
      .map(m => `${m.posto_abrev} ${m.nome_guerra}`.trim());
    const externos = (campo.militares_externos || '').trim();
    return {
      ...campo,
      finalidades_texto: (campo.categorias || []).map(c => c.nome).join(', '),
      efetivo_texto: [doCadastro.join(', '), externos].filter(Boolean).join(', ') || '-',
    };
  };

  async function carregar() {
    tabela.update({ loading: true });
    try {
      const dados = await listarCampos(filtros);
      if (disposed) return;
      linhas = (dados || []).map(paraLinha);
      erro = null;
      faixaErro.classList.add('hidden');
      tabela.update({ rows: linhas, loading: false });
    } catch (err) {
      if (disposed) return;
      erro = err;
      linhas = [];
      // A FAIXA É SEPARADA DA MENSAGEM DE LISTA VAZIA, e os dois estados são
      // distintos de verdade: lista vazia é uma AFIRMAÇÃO sobre o banco ("não
      // há campo com estes filtros"), e erro é a AUSÊNCIA de resposta. Trocar o
      // texto do vazio pelo do erro faria a falha de rede se ler como "não há
      // nada cadastrado".
      faixaErro.textContent = erro.message || 'Não foi possível carregar as atividades de campo.';
      faixaErro.classList.remove('hidden');
      tabela.update({ rows: [], loading: false });
    }
    // O MAPA SÓ SE REDESENHA SE A ABA DELE ESTIVER ABERTA: `getCamposGeojson` é
    // uma segunda ida ao banco, com a geometria junto, e pagá-la para uma aba
    // escondida seria desperdício em toda digitação da busca.
    if (abaAtiva === 'mapa' && mapa) await desenharMapa();
  }

  async function desenharMapa() {
    if (!mapa || disposed) return;
    try {
      const colecao = await getCamposGeojson(filtros);
      if (disposed) return;
      mapa.setCampos(colecao, { manterEnquadramento: enquadramentoReservado });
      // Trocar o recorte apaga o trajeto que estava desenhado: ele era do campo
      // selecionado, e o campo pode não estar mais na lista. Quem veio pelo
      // "Ver no mapa" desenha o dele LOGO DEPOIS, e por isso a limpeza aqui não
      // o atinge.
      mapa.setTracks([]);
    } catch (err) {
      // A falha do mapa NÃO derruba a tabela, que é a mesma informação sem o
      // desenho.
      showError(err.message || 'Não foi possível carregar o mapa');
    }
  }

  await carregarApoio();
  if (disposed) return () => {};
  await carregar();

  // A rastreabilidade aponta uma ficha; ela abre por cima da lista já carregada.
  if (idDaRota && Number.isInteger(idDaRota)) abrirFicha(idDaRota);

  return () => {
    disposed = true;
    if (debounce) clearTimeout(debounce);
    tabela._cleanup();
    abas._cleanup();
    if (mapa) mapa._cleanup();
  };
}
