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
//  - a tela de usuarios, que e unica da plataforma e cobre todos os modulos.

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
import { renderInsumosList } from './pages/insumos/list.js';
import { renderInsumoFicha } from './pages/insumos/ficha.js';
import { renderPlottersList } from './pages/plotters/list.js';
import { renderPlotterDetails } from './pages/plotters/details.js';

// Os conjuntos de tela da mapoteca. Sao LISTAS de perfil, e nao nivel minimo,
// porque o operador daqui nao e consulta com mais poder:
//
//  - EXECUCAO: as telas de quem trabalha o pedido. O operador as ve.
//  - LEITURA:  a gestao do modulo. O operador NAO ve.
//  - TODOS:    a tela que os tres perfis abrem, cada um pelo seu motivo.
//
// A TELA DE INSUMOS SAIU DESSAS LISTAS em 2026-08-08, e passou a declarar
// `perfil: 'consulta'` (nivel MINIMO, hierarquico). A lista nao hierarquica
// ['consulta','gerente'] existia porque a tela era CADASTRO, e o operador nao a
// via; com a tela unica do livro, o operador e justamente quem mais a usa: e ele
// que da entrada, transfere e consome. A regua da casa passou a valer
// aqui inteira -- consulta LE, operador LANCA, gerente responde pela area.
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

  // Ordem: Dashboard abre o modulo, Atender pedidos vem logo depois, e Insumos
  // fica entre Pedidos e Plotters, onde o trio de material ficava.
  //
  // UM ITEM DE MATERIAL, E NAO TRES. "Tipos de Material", "Estoque" e "Consumo
  // de material" eram tres entradas de menu para a mesma pergunta -- "como esta
  // o papel?" -- e quem quisesse a resposta inteira atravessava as tres: o
  // cadastro numa, o saldo na outra, o gasto na terceira. Viraram a tela
  // Insumos, com o livro de movimentos dentro da ficha de cada material.
  //
  // MENU PLANO, SEM GRUPO COLAPSAVEL. O grupo "Materiais" ja tinha saido antes,
  // porque cobrava um clique a mais para chegar a uma tela que cabia na lista.
  //
  // Nenhum item repete a restricao: o sidebar pergunta ao registry, que le
  // `perfis`/`perfil` da ROTA (podeAbrirRota). Repetir a mao foi o que fez o item
  // Configuracao do orcamento aparecer para todo mundo e cair no 403.
  menu: [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '/dashboard' },
    { id: 'atendimento', label: 'Atender pedidos', icon: ICONS.localShipping, path: '/atendimento' },
    { id: 'clientes', label: 'Clientes', icon: ICONS.people, path: '/clientes' },
    // NAO existe "pedido avulso", nem tela de produto avulso. O que existe e um
    // ITEM cujo produto nao vem do acervo, descrito no proprio item, na tela do
    // pedido. Um pedido pode misturar item de acervo e item avulso a vontade.
    //
    { id: 'pedidos', label: 'Pedidos', icon: ICONS.assignment, path: '/pedidos' },
    { id: 'insumos', label: 'Insumos', icon: ICONS.category, path: '/insumos' },
    { id: 'plotters', label: 'Plotters', icon: ICONS.print, path: '/plotters' },
    // SEM item de RPCMTec: ele e tela de PLATAFORMA (#/rpcmtec). O relatorio e
    // da Divisao inteira, e daqui sairia so metade dele.
  ],

  // Rota estatica ANTES da rota com ':id' ('/pedidos/novo' antes de
  // '/pedidos/:id'), senao o wizard cai no detalhe do pedido 'novo'.
  //
  // O perfil aqui e quase sempre LISTA (`perfis`), e nao nivel minimo (`perfil`):
  // na mapoteca o OPERADOR nao e "consulta com mais poder", e um papel com telas
  // proprias. Com nivel minimo ele veria clientes e pedidos, porque operador e um
  // nivel acima de consulta. Cada tela que ele ve esta listada uma a uma, de
  // proposito. A EXCECAO e /insumos, onde os tres perfis se ordenam de verdade:
  // ver o comentario na rota.
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
    // NIVEL MINIMO, e nao lista: consulta LE, operador LANCA, gerente responde
    // pela area. E a unica tela do modulo em que os tres perfis se ordenam de
    // verdade, e por isso a unica que declara `perfil`. Quem barra a escrita e o
    // verifyPerfil('operador', 'mapoteca') do servidor, nunca este campo.
    { path: '/insumos', render: renderInsumosList, perfil: 'consulta' },
    { path: '/insumos/:id', render: renderInsumoFicha, perfil: 'consulta' },
    { path: '/plotters', render: renderPlottersList, perfis: LEITURA },
    { path: '/plotters/:id', render: renderPlotterDetails, perfis: LEITURA },
  ],

  // SEM `navbarExtras`. Nao ha seletor de ano na navbar: um so para o modulo
  // inteiro, guardado no localStorage, faz olhar o mapa de um ano mudar calado a
  // lista de pedidos, e faz voltar semanas depois abrir num ano antigo sem
  // aviso. Cada tela monta o seu filtro
  // (@components/filtro-ano.js), sempre no ano atual.
};
