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

// CSS: o modulo nao traz arquivo proprio. Toda classe que as telas da mapoteca
// usam ja existe no CSS de plataforma (layout, tables, forms, modal, wizard,
// chips, dashboard e extras, este ultimo com .rpcm-toolbar e .page__header--column).
import { ICONS } from '@utils/dom.js';

import { renderDashboard } from './pages/dashboard/index.js';
import { renderClientesList } from './pages/clientes/list.js';
import { renderClienteDetails } from './pages/clientes/details.js';
import { renderPedidosList } from './pages/pedidos/list.js';
import { renderPedidoWizard } from './pages/pedidos/wizard.js';
import { renderPedidoDetails } from './pages/pedidos/details.js';
import { renderMateriaisList } from './pages/materiais/list.js';
import { renderMaterialDetails } from './pages/materiais/details.js';
import { renderEstoqueList } from './pages/estoque/list.js';
import { renderConsumoList } from './pages/consumo/list.js';
import { renderPlottersList } from './pages/plotters/list.js';
import { renderPlotterDetails } from './pages/plotters/details.js';
import { renderRpcMtec } from './pages/rpcmtec/index.js';

export default {
  id: 'mapoteca',
  icon: ICONS.print,
  home: '/dashboard',

  menu: [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '/dashboard' },
    { id: 'clientes', label: 'Clientes', icon: ICONS.people, path: '/clientes' },
    { id: 'pedidos', label: 'Pedidos', icon: ICONS.assignment, path: '/pedidos' },
    {
      id: 'materiais-group',
      label: 'Materiais',
      icon: ICONS.layers,
      children: [
        { id: 'materiais', label: 'Tipos de Material', icon: ICONS.category, path: '/materiais' },
        { id: 'estoque', label: 'Estoque', icon: ICONS.storage, path: '/estoque' },
        { id: 'consumo', label: 'Consumo', icon: ICONS.dataUsage, path: '/consumo' },
      ],
    },
    { id: 'plotters', label: 'Plotters', icon: ICONS.print, path: '/plotters' },
    { id: 'rpcmtec', label: 'RPCMTec', icon: ICONS.print, path: '/rpcmtec' },
  ],

  // Rota estatica ANTES da rota com ':id' ('/pedidos/novo' antes de
  // '/pedidos/:id'), senao o wizard cai no detalhe do pedido 'novo'.
  rotas: [
    { path: '/dashboard', render: renderDashboard, perfil: 'consulta' },
    { path: '/clientes', render: renderClientesList, perfil: 'consulta' },
    { path: '/clientes/:id', render: renderClienteDetails, perfil: 'consulta' },
    { path: '/pedidos', render: renderPedidosList, perfil: 'consulta' },
    { path: '/pedidos/novo', render: renderPedidoWizard, perfil: 'consulta' },
    { path: '/pedidos/:id', render: renderPedidoDetails, perfil: 'consulta' },
    { path: '/materiais', render: renderMateriaisList, perfil: 'consulta' },
    { path: '/materiais/:id', render: renderMaterialDetails, perfil: 'consulta' },
    { path: '/estoque', render: renderEstoqueList, perfil: 'consulta' },
    { path: '/consumo', render: renderConsumoList, perfil: 'consulta' },
    { path: '/plotters', render: renderPlottersList, perfil: 'consulta' },
    { path: '/plotters/:id', render: renderPlotterDetails, perfil: 'consulta' },
    { path: '/rpcmtec', render: renderRpcMtec, perfil: 'consulta' },
  ],
};
