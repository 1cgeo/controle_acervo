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
import { renderPontoControle } from './pages/ponto_controle/index.js';
import { renderAdministracao } from './pages/administracao/index.js';
import { renderAuditoria } from './pages/auditoria/index.js';
import { registrarEditorGeometria } from './pages/produto/produto-dialog-form.js';
import { pedirGeometria } from '@components/mapa/editor-geometria.js';

// O editor de geometria e ligado ao formulario de produto AQUI, no arranque do
// modulo, e nao por import direto dentro do formulario.
//
// A razao e o peso do mapa: `editor-geometria.js` puxa `components/mapa/base.js`,
// que importa o CSS do MapLibre no topo. Um import direto do formulario ainda
// seria carregado sob demanda junto com ele, mas amarraria o formulario ao mapa
// para sempre -- e o formulario tem de continuar funcionando sem editor, pelo
// caminho "Buscar folha", que e o normal para carta sistematica. Registrando de
// fora, quem depende de quem fica explicito e testavel: o teste do formulario
// nao precisa de WebGL.
registrarEditorGeometria(pedirGeometria);

export default {
  id: 'acervo',
  icon: ICONS.layers,
  home: '/dashboard',

  menu: [
    { id: 'dashboard', label: 'Dashboard', icon: ICONS.dashboard, path: '/dashboard' },
    { id: 'busca', label: 'Busca', icon: ICONS.search, path: '/busca' },
    { id: 'ponto_controle', label: 'Ponto de controle', icon: ICONS.place, path: '/ponto_controle' },
    // Ultimo item, e nao um grupo colapsavel: e uma tela so. O sidebar a esconde
    // sozinho de quem nao passa no perfil da rota (podeAbrirRota).
    { id: 'administracao', label: 'Administração', icon: ICONS.settings, path: '/administracao' },
    { id: 'auditoria', label: 'Auditoria', icon: ICONS.assignment, path: '/auditoria' },
  ],

  rotas: [
    { path: '/dashboard', render: renderDashboard, perfil: 'consulta' },
    // Busca e LEITURA do acervo: consulta basta, igual ao resto do modulo.
    { path: '/busca', render: renderBusca, perfil: 'consulta' },
    // Ponto de controle e uma tela do ACERVO, ainda que o schema no banco seja
    // proprio (`ponto_controle.*`) e a rota da API seja '/ponto_controle'. Quem
    // consulta o acervo consulta os pontos. IMPORTAR exige gerente, e o guarda
    // disso e o backend: a tela e so de leitura, nao ha upload aqui.
    { path: '/ponto_controle', render: renderPontoControle, perfil: 'consulta' },
    // OPERADOR, e nao consulta: e o menor nivel que faz alguma coisa nesta tela.
    // O proprio GET de volume e operador no servidor, entao quem tem so consulta
    // abriria uma pagina que so sabe mostrar erro. Excluir, dentro dela, e
    // gerente, e quem barra e o verifyPerfil.
    { path: '/administracao', render: renderAdministracao, perfil: 'operador' },
    // GERENTE, que e exatamente o que a rota GET /api/acervo/auditoria cobra
    // (o administrador global passa por cima de qualquer modulo). Nao ha nivel a
    // escolher aqui: pedir menos abriria uma tela que so sabe mostrar 403, e a
    // saida da auditoria e o formato do acervo inteiro, que serve de mapa para
    // quem for escrever nele.
    { path: '/auditoria', render: renderAuditoria, perfil: 'gerente' },
  ],
};
