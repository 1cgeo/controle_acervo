// Manifesto do modulo MAPOTECA, portado do mapoteca_client para a interface unica.
// O contrato do manifesto esta em modules/registry.js.
//
// As rotas abaixo viram '#/mapoteca/<path>'. O guarda de cada uma sai de
// `perfil` (nivel minimo NO MODULO) ou de `admin: true` (administrador global).
// Escrever continua barrado no BACKEND por verifyPerfil(nivel, 'mapoteca'):
// o guarda de client so evita a pessoa abrir uma tela que nao vai poder usar.
//
// FORA DAQUI, de proposito:
//  - a consulta publica de pedido por localizador ('#/consultar-pedido'), que
//    nao tem sessao, e rota de PLATAFORMA em src/js/index.js;
//  - a tela de usuarios, que e unica da plataforma e cobre os tres modulos.

// CSS: quase tudo vem do CSS de plataforma (layout, tables, forms, modal,
// wizard, chips, dashboard e extras, este ultimo com .rpcm-toolbar e
// .page__header--column). A unica excecao e o mapa das entregas, que traz o
// proprio arquivo ao lado do componente (pages/dashboard/mapa-entregas.css),
// como fazem os componentes de plataforma que tem CSS colado.
import { ICONS } from '@utils/dom.js';

import { renderDashboard } from './pages/dashboard/index.js';
import { renderClientesList } from './pages/clientes/list.js';
import { renderClienteDetails } from './pages/clientes/details.js';
import { renderPedidosList } from './pages/pedidos/list.js';
import { renderAtendimento } from './pages/atendimento/index.js';
import { renderPedidoWizard } from './pages/pedidos/wizard.js';
import { renderPedidoDetails } from './pages/pedidos/details.js';
import { renderMateriaisList } from './pages/materiais/list.js';
import { renderMaterialDetails } from './pages/materiais/details.js';
import { renderEstoqueList } from './pages/estoque/list.js';
import { renderConsumoList } from './pages/consumo/list.js';
import { renderPlottersList } from './pages/plotters/list.js';
import { renderPlotterDetails } from './pages/plotters/details.js';

import { criarSeletorAno } from './components/seletor-ano.js';

// Os dois conjuntos de tela da mapoteca. Sao LISTAS de perfil, e nao nivel
// minimo, porque o operador daqui nao e consulta com mais poder:
//
//  - EXECUCAO: as duas telas de quem trabalha o pedido. O operador ve SO estas.
//  - LEITURA:  o resto do modulo, que e gestao e cadastro. O operador NAO ve.
//
// O gerente aparece nas duas listas: ele executa e gerencia. O administrador
// global passa em qualquer lista, sem precisar de linha de perfil.
const EXECUCAO = ['operador', 'gerente'];
const LEITURA = ['consulta', 'gerente'];

export default {
  id: 'mapoteca',
  icon: ICONS.print,
  home: '/dashboard',

  // Ordem e agrupamento decididos pelo chefe em 2026-07-30: Dashboard abre o
  // modulo, Atender pedidos vem logo depois, e Consumo de material mora dentro
  // de Materiais, junto do catalogo e do estoque.
  //
  // Nenhum item repete a restricao: o sidebar pergunta ao registry, que le
  // `perfis`/`perfil` da ROTA (podeAbrirRota). Repetir a mao foi o que fez o item
  // Configuracao do orcamento aparecer para todo mundo e cair no 403.
  //
  // O QUE ISSO FAZ COM O OPERADOR, que e quem usa Consumo todo dia: ele nao tem
  // leitura no modulo, entao dos tres filhos de Materiais so Consumo aparece
  // para ele (o sidebar filtra filho a filho por podeAbrirRota, e esconde o
  // grupo inteiro quando nenhum sobra). Ele passa a ver "Materiais" com um item
  // dentro, em vez do item solto no topo. O grupo ABRE SOZINHO quando a rota
  // ativa e de um filho, entao estando em /consumo ele ja encontra o menu
  // aberto e marcado. Para gerente e administrador os tres filhos aparecem.
  menu: [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '/dashboard' },
    { id: 'atendimento', label: 'Atender pedidos', icon: ICONS.localShipping, path: '/atendimento' },
    { id: 'clientes', label: 'Clientes', icon: ICONS.people, path: '/clientes' },
    // NAO existe "pedido avulso", nem tela de produto avulso. O que existe e um
    // ITEM cujo produto nao vem do acervo, descrito no proprio item, na tela do
    // pedido. Um pedido pode misturar item de acervo e item avulso a vontade
    // (chefe, 2026-07-30).
    { id: 'pedidos', label: 'Pedidos', icon: ICONS.assignment, path: '/pedidos' },
    {
      id: 'materiais-group',
      label: 'Materiais',
      icon: ICONS.layers,
      children: [
        { id: 'materiais', label: 'Tipos de Material', icon: ICONS.category, path: '/materiais' },
        { id: 'estoque', label: 'Estoque', icon: ICONS.storage, path: '/estoque' },
        { id: 'consumo', label: 'Consumo de material', icon: ICONS.dataUsage, path: '/consumo' },
      ],
    },
    { id: 'plotters', label: 'Plotters', icon: ICONS.print, path: '/plotters' },
    // SEM item de RPCMTec: ele virou tela de PLATAFORMA em 2026-08-01
    // (#/rpcmtec, na secao de plataforma da sidebar). O relatorio e da
    // Divisao inteira, e esta tela gerava so a metade dele.
  ],

  // Rota estatica ANTES da rota com ':id' ('/pedidos/novo' antes de
  // '/pedidos/:id'), senao o wizard cai no detalhe do pedido 'novo'.
  //
  // O perfil aqui e LISTA (`perfis`), e nao nivel minimo (`perfil`): na mapoteca o
  // OPERADOR nao e "consulta com mais poder", e um papel com duas telas proprias
  // (chefe, 2026-07-30). Com nivel minimo ele veria dashboard, clientes, pedidos e
  // o resto, porque operador e um nivel acima de consulta.
  rotas: [
    { path: '/dashboard', render: renderDashboard, perfis: LEITURA },
    { path: '/clientes', render: renderClientesList, perfis: LEITURA },
    { path: '/clientes/:id', render: renderClienteDetails, perfis: LEITURA },
    { path: '/pedidos', render: renderPedidosList, perfis: LEITURA },
    { path: '/atendimento', render: renderAtendimento, perfis: EXECUCAO },
    // O wizard existe SO para criar, e POST /pedido e gerente. Com leitura aqui,
    // quem nao pode criar percorria as tres etapas e so descobria no botao de
    // confirmar, perdendo tudo o que digitou.
    { path: '/pedidos/novo', render: renderPedidoWizard, perfis: ['gerente'] },
    { path: '/pedidos/:id', render: renderPedidoDetails, perfis: LEITURA },
    { path: '/materiais', render: renderMateriaisList, perfis: LEITURA },
    { path: '/materiais/:id', render: renderMaterialDetails, perfis: LEITURA },
    { path: '/estoque', render: renderEstoqueList, perfis: LEITURA },
    { path: '/consumo', render: renderConsumoList, perfis: EXECUCAO },
    { path: '/plotters', render: renderPlottersList, perfis: LEITURA },
    { path: '/plotters/:id', render: renderPlotterDetails, perfis: LEITURA },
  ],

  // O ano de referencia e contexto das telas POR ANO da mapoteca (resumo anual,
  // mapa das entregas, consumo, RPCMTec), entao o seletor mora na navbar, como
  // no orcamento. Some quando a pessoa troca de modulo.
  //
  // O que ele NAO filtra, de proposito: a lista de pedidos e a de clientes, que
  // sao operacionais e tem filtro proprio. Esconder o pedido do ano passado de
  // quem esta atendendo o cliente seria perder trabalho, nao ganhar contexto.
  navbarExtras: criarSeletorAno,
};
