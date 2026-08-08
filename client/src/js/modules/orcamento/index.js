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

export default {
  id: 'orcamento',
  icon: ICONS.dataUsage,
  home: '/dashboard',

  menu: [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '/dashboard' },
    { id: 'dfd', label: 'DFD', icon: ICONS.description, path: '/dfd' },
    // SEM um grupo "Orçamento" aqui dentro: grupo colapsável com um item só
    // esconde a tela atrás de um clique e nomeia o módulo dentro do módulo.
    { id: 'pdr', label: 'PDR', icon: ICONS.dataUsage, path: '/pdr' },
    // MENU PLANO: o grupo colapsavel "Execução" saiu, e os quatro itens ficaram
    // no lugar exato onde ele estava, na mesma ordem que tinham dentro dele. O
    // cabecalho cobrava um clique a mais para chegar a uma tela que ja cabia na
    // lista, e nenhuma delas e rara: nota de credito, empenho, licitacao e RPNP
    // sao o dia a dia do modulo.
    { id: 'notas_credito', label: 'Notas de Crédito', icon: ICONS.description, path: '/notas_credito' },
    { id: 'notas_empenho', label: 'Empenhos', icon: ICONS.assignment, path: '/notas_empenho' },
    { id: 'licitacoes', label: 'Licitações', icon: ICONS.storage, path: '/licitacoes' },
    { id: 'rpnp', label: 'RPNP', icon: ICONS.schedule, path: '/rpnp' },
    // SEM item de RPCMTec: ele e tela de PLATAFORMA (#/rpcmtec). Daqui sairia
    // so a secao do PDR, e o relatorio e da Divisao inteira.
    //
    // CONFIGURACAO POR ULTIMO, e nao em segundo lugar. Ela e a tela que menos se
    // visita: mantem os dominios do modulo (natureza de despesa, plano interno,
    // unidade gestora), e so o administrador a abre. Em cima ela ocupava o lugar
    // do trabalho do dia, que e o DFD e o PDR.
    { id: 'configuracao', label: 'Configuração', icon: ICONS.category, path: '/configuracao' },
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

  // SEM `navbarExtras`. Nao ha seletor de ano na navbar: um so para o modulo
  // inteiro, guardado no localStorage, faz abrir o PDR de um ano mudar calado a
  // lista de notas de credito, e faz voltar semanas depois abrir num ano antigo
  // sem aviso.
  // Agora cada tela monta o seu filtro (@components/filtro-ano.js), sempre no
  // ano atual.
};
