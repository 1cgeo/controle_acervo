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

// Os conjuntos de tela da mapoteca. Sao LISTAS de perfil, e nao nivel minimo,
// porque o operador daqui nao e consulta com mais poder:
//
//  - EXECUCAO: as telas de quem trabalha o pedido. O operador as ve.
//  - LEITURA:  a gestao e o cadastro do modulo. O operador NAO ve.
//  - TODOS:    a tela que os tres perfis abrem, cada um pelo seu motivo.
//
// O gerente aparece em todas as listas: ele executa e gerencia. O administrador
// global passa em qualquer lista, sem precisar de linha de perfil.
const EXECUCAO = ['operador', 'gerente'];
const LEITURA = ['consulta', 'gerente'];
const TODOS = ['consulta', 'operador', 'gerente'];

export default {
  id: 'mapoteca',
  icon: ICONS.print,
  home: '/dashboard',

  // Ordem: Dashboard abre o modulo, Atender pedidos vem logo depois, e o trio de
  // material (catalogo, estoque, consumo) fica entre Pedidos e Plotters.
  //
  // MENU PLANO, SEM GRUPO COLAPSAVEL. O grupo "Materiais" saiu: ele cobrava um
  // clique a mais para chegar a uma tela que ja cabia na lista. Os tres itens
  // estao no lugar exato onde o grupo estava e na mesma ordem que tinham dentro
  // dele, entao quem ja sabia onde clicar continua sabendo, com um passo a menos.
  //
  // Nenhum item repete a restricao: o sidebar pergunta ao registry, que le
  // `perfis`/`perfil` da ROTA (podeAbrirRota). Repetir a mao foi o que fez o item
  // Configuracao do orcamento aparecer para todo mundo e cair no 403.
  //
  // O QUE ISSO FAZ COM O OPERADOR, que e quem usa Consumo todo dia: ele nao tem
  // leitura no modulo, entao Tipos de Material e Estoque somem para ele e
  // Consumo de material fica visivel, solto, sem cabecalho para abrir antes.
  menu: [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '/dashboard' },
    { id: 'atendimento', label: 'Atender pedidos', icon: ICONS.localShipping, path: '/atendimento' },
    { id: 'clientes', label: 'Clientes', icon: ICONS.people, path: '/clientes' },
    // NAO existe "pedido avulso", nem tela de produto avulso. O que existe e um
    // ITEM cujo produto nao vem do acervo, descrito no proprio item, na tela do
    // pedido. Um pedido pode misturar item de acervo e item avulso a vontade.
    //
    { id: 'pedidos', label: 'Pedidos', icon: ICONS.assignment, path: '/pedidos' },
    { id: 'materiais', label: 'Tipos de Material', icon: ICONS.category, path: '/materiais' },
    { id: 'estoque', label: 'Estoque', icon: ICONS.storage, path: '/estoque' },
    { id: 'consumo', label: 'Consumo de material', icon: ICONS.dataUsage, path: '/consumo' },
    { id: 'plotters', label: 'Plotters', icon: ICONS.print, path: '/plotters' },
    // SEM item de RPCMTec: ele e tela de PLATAFORMA (#/rpcmtec). O relatorio e
    // da Divisao inteira, e daqui sairia so metade dele.
  ],

  // Rota estatica ANTES da rota com ':id' ('/pedidos/novo' antes de
  // '/pedidos/:id'), senao o wizard cai no detalhe do pedido 'novo'.
  //
  // O perfil aqui e LISTA (`perfis`), e nao nivel minimo (`perfil`): na mapoteca o
  // OPERADOR nao e "consulta com mais poder", e um papel com telas proprias. Com
  // nivel minimo ele veria clientes, pedidos e o cadastro de material, porque
  // operador e um nivel acima de consulta. Cada tela que ele ve esta listada
  // uma a uma, de proposito.
  rotas: [
    // TODOS, e nao LEITURA: quem atende o pedido precisa ver a fila e o que esta
    // pendente. Deixar o operador fora do dashboard era esconder dele justamente
    // o painel do trabalho que e dele.
    { path: '/dashboard', render: renderDashboard, perfis: TODOS },
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
    // TODOS, e nao EXECUCAO: quem tem consulta entra para LER o consumo. Lancar
    // consumo continua sendo do operador, e quem barra a escrita e o
    // verifyPerfil('operador', 'mapoteca') do servidor, nao esta lista.
    { path: '/consumo', render: renderConsumoList, perfis: TODOS },
    { path: '/plotters', render: renderPlottersList, perfis: LEITURA },
    { path: '/plotters/:id', render: renderPlotterDetails, perfis: LEITURA },
  ],

  // SEM `navbarExtras`. Nao ha seletor de ano na navbar: um so para o modulo
  // inteiro, guardado no localStorage, faz olhar o mapa de um ano mudar calado a
  // lista de pedidos, e faz voltar semanas depois abrir num ano antigo sem
  // aviso. Cada tela monta o seu filtro
  // (@components/filtro-ano.js), sempre no ano atual.
};
