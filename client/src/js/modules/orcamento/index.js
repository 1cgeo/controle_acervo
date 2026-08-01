// Manifesto do modulo ORCAMENTO (o antigo SCO), portado para a interface unica.
// O contrato do manifesto esta em modules/registry.js.
//
// As rotas abaixo viram '#/orcamento/<path>'. O guarda de cada uma sai de
// `perfil` (nivel minimo NO MODULO) ou de `admin: true` (administrador global).
// Escrever continua barrado no BACKEND por verifyPerfil(nivel, 'orcamento'):
// o guarda de client so evita a pessoa abrir uma tela que nao vai poder usar.
//
// O MENU NAO REPETE A RESTRICAO DA ROTA. A sidebar deriva a visibilidade de
// cada item da rota que ele aponta (registry.podeAbrirRota), entao 'Configuração'
// some para quem nao e administrador so por causa do `admin: true` da rota. Foi
// justamente esse par que ficou fora de sincronia: o item nao tinha a marca que
// a rota tinha, aparecia para todo mundo e o clique caia no 403.

import { ICONS } from '@utils/dom.js';

import { renderDashboard } from './pages/dashboard/index.js';
import { renderConfiguracao } from './pages/configuracao/index.js';
import { renderDfdList } from './pages/dfd/list.js';
import { renderPdrList } from './pages/pdr/list.js';
import { renderNotasCreditoList } from './pages/notas-credito/list.js';
import { renderNotasEmpenhoList } from './pages/notas-empenho/list.js';
import { renderNotaEmpenhoDetails } from './pages/notas-empenho/details.js';
import { renderLicitacoesList } from './pages/licitacoes/list.js';
import { renderRpnpList } from './pages/rpnp/list.js';

import { criarSeletorAno } from './components/seletor-ano.js';

export default {
  id: 'orcamento',
  icon: ICONS.dataUsage,
  home: '/dashboard',

  menu: [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '/dashboard' },
    { id: 'configuracao', label: 'Configuração', icon: ICONS.category, path: '/configuracao' },
    { id: 'dfd', label: 'DFD', icon: ICONS.description, path: '/dfd' },
    // O grupo "Orçamento" saiu em 2026-07-31 (chefe). Ele tinha dois filhos, e
    // um deles (Metas do PIT) deixou o módulo. Grupo colapsável com um item só
    // esconde a tela atrás de um clique e nomeia o módulo dentro do módulo.
    { id: 'pdr', label: 'PDR', icon: ICONS.dataUsage, path: '/pdr' },
    {
      id: 'execucao-group',
      label: 'Execução',
      icon: ICONS.localShipping,
      children: [
        { id: 'notas_credito', label: 'Notas de Crédito', icon: ICONS.description, path: '/notas_credito' },
        { id: 'notas_empenho', label: 'Empenhos', icon: ICONS.assignment, path: '/notas_empenho' },
        { id: 'licitacoes', label: 'Licitações', icon: ICONS.storage, path: '/licitacoes' },
        { id: 'rpnp', label: 'RPNP', icon: ICONS.schedule, path: '/rpnp' },
      ],
    },
    // SEM item de RPCMTec: ele virou tela de PLATAFORMA em 2026-08-01
    // (#/rpcmtec, na secao de plataforma da sidebar). Esta tela gerava so a
    // secao do PDR, que alguem colava a mao no arquivo da outra.
  ],

  rotas: [
    { path: '/dashboard', render: renderDashboard, perfil: 'consulta' },
    { path: '/configuracao', render: renderConfiguracao, admin: true },
    { path: '/dfd', render: renderDfdList, perfil: 'consulta' },
    { path: '/pdr', render: renderPdrList, perfil: 'consulta' },
    { path: '/notas_credito', render: renderNotasCreditoList, perfil: 'consulta' },
    { path: '/notas_empenho', render: renderNotasEmpenhoList, perfil: 'consulta' },
    { path: '/notas_empenho/:id', render: renderNotaEmpenhoDetails, perfil: 'consulta' },
    { path: '/licitacoes', render: renderLicitacoesList, perfil: 'consulta' },
    { path: '/rpnp', render: renderRpnpList, perfil: 'consulta' },
  ],

  // O ano de referencia e contexto de TODAS as telas do orcamento, entao o
  // seletor mora na navbar. Some quando a pessoa troca de modulo.
  navbarExtras: criarSeletorAno,
};
