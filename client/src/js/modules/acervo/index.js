// Manifesto do modulo ACERVO, portado para a interface unica.
// O contrato do manifesto esta em modules/registry.js.
//
// As rotas abaixo viram '#/acervo/<path>'. O guarda de cada uma sai de `perfil`
// (nivel minimo NO MODULO). Escrever continua barrado no BACKEND por
// verifyPerfil(nivel, 'acervo'): o guarda de client so evita a pessoa abrir uma
// tela que nao vai poder usar.
//
// CAMINHOS DE API: as rotas do acervo NAO mudaram na fusao de 2026-07-27. So o
// orcamento ganhou prefixo. Ver server/src/routes.js.
//
// A tela de usuarios NAO mora aqui: e de PLATAFORMA ('#/usuarios'), unica para
// os tres modulos, e so o administrador global a ve.

import { ICONS } from '@utils/dom.js';
import './acervo.css';

import { renderDashboard } from './pages/dashboard/index.js';
import { renderBusca } from './pages/busca/index.js';

export default {
  id: 'acervo',
  icon: ICONS.layers,
  home: '/dashboard',

  menu: [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '/dashboard' },
    { id: 'busca', label: 'Busca', icon: ICONS.search, path: '/busca' },
  ],

  rotas: [
    { path: '/dashboard', render: renderDashboard, perfil: 'consulta' },
    // Busca e LEITURA do acervo: consulta basta, igual ao resto do modulo.
    { path: '/busca', render: renderBusca, perfil: 'consulta' },
  ],
};
