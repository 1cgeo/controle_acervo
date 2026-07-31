import '@css/style.css';
import { initTheme } from '@utils/theme.js';
import { isAuthenticated } from '@store/auth-store.js';
import { sincronizarSessao, EVENTO_SESSAO_MUDOU } from '@services/api-client.js';
import Router, { adminLoader, authLoader, perfilLoader, rotaRaiz } from './router.js';
import { createMainLayout } from '@components/layout/main-layout.js';
import { modulosPortados } from '@modules/registry.js';
import { renderLogin } from '@pages/login.js';
import { renderUnauthorized } from '@pages/unauthorized.js';
import { renderNotFound } from '@pages/not-found.js';
import { renderUsuariosList } from '@pages/usuarios/list.js';
import { renderMetasList } from '@pages/metas/list.js';
import { renderConsultarPedido } from '@modules/mapoteca/pages/consultar-pedido.js';

// Inicializa o tema (claro/escuro via data-theme, persistido em sca-theme-mode)
initTheme();

const app = document.getElementById('app');

let mainLayout = null;

function getContentArea() {
  if (!mainLayout) {
    mainLayout = createMainLayout();
    app.innerHTML = '';
    app.appendChild(mainLayout.layout);
  }
  return mainLayout.contentArea;
}

function clearLayout() {
  if (mainLayout) {
    mainLayout.cleanup();
    mainLayout = null;
  }
  app.innerHTML = '';
}

function withLayout(renderFn) {
  return async (_container, ctx) => {
    const contentArea = getContentArea();
    contentArea.innerHTML = '';
    return await renderFn(contentArea, ctx);
  };
}

function standalone(renderFn) {
  return async (_container, ctx) => {
    clearLayout();
    return await renderFn(app, ctx);
  };
}

const router = new Router(app);

// ---------------------------------------------------------------------------
// Rotas de PLATAFORMA (sem prefixo de modulo)
// ---------------------------------------------------------------------------
router.add('/login', standalone(renderLogin), {
  guard: () => (isAuthenticated() ? rotaRaiz() : true),
});

// Tela unica de usuarios: uma coluna por modulo. Administrador global.
router.add('/usuarios', withLayout(renderUsuariosList), { guard: adminLoader });

// Metas do PIT: o plano anual da Divisao, que os tres modulos consomem. Saiu do
// modulo orcamento em 2026-07-31 justamente porque quem so tem perfil na
// mapoteca nao conseguia nem ver a lista. Sem `adminLoader`: LER e de qualquer
// pessoa logada, e o backend cobra o administrador so na escrita.
router.add('/metas', withLayout(renderMetasList), { guard: authLoader });

// Consulta PUBLICA de pedido da mapoteca pelo localizador (RN04). Sem sessao e
// sem guarda: quem pediu acompanha o pedido pelo codigo XXXX-XXXX-XXXX, sem
// conta no SCA. Por isso e rota de plataforma, nao de modulo. A pagina mora no
// modulo mapoteca porque so ela usa o service da mapoteca.
// Sem localizador a tela abre so com o campo de busca.
router.add('/consultar-pedido', standalone(renderConsultarPedido));
router.add('/consultar-pedido/:localizador', standalone(renderConsultarPedido));

// ---------------------------------------------------------------------------
// Rotas dos MODULOS, registradas a partir do manifesto de cada um.
// '/dfd' do modulo 'orcamento' vira '#/orcamento/dfd'. Um modulo esqueleto
// (rotas: []) nao registra nada, entao suas URLs caem no 404 ate ser portado.
// ---------------------------------------------------------------------------
for (const modulo of modulosPortados()) {
  for (const rota of modulo.rotas) {
    // `perfis` (lista) antes de `perfil` (minimo): e o mesmo campo, na mesma
    // ordem, que registry.podeAbrirRota le para decidir o MENU.
    const guard = rota.admin
      ? adminLoader
      : perfilLoader(modulo.id, rota.perfis || rota.perfil || 'consulta');
    router.add(`/${modulo.id}${rota.path}`, withLayout(rota.render), { guard });
  }
}

// ---------------------------------------------------------------------------
// Paginas de erro: com layout quando ha sessao, soltas quando nao ha.
// ---------------------------------------------------------------------------
function errorPage(renderFn) {
  return async (_container, ctx) => {
    if (isAuthenticated()) {
      const contentArea = getContentArea();
      contentArea.innerHTML = '';
      return await renderFn(contentArea, ctx);
    }
    clearLayout();
    return await renderFn(app, ctx);
  };
}

router.add('/unauthorized', errorPage(renderUnauthorized));
router.add('/404', errorPage(renderNotFound));

router.start();

// Perfil mudou no servidor enquanto a pessoa estava logada. A sidebar e os
// botoes sao montados uma vez, entao trocar o localStorage nao basta: recarrega
// para a tela inteira voltar a bater com o que o servidor aceita. Acontece so
// quando algo MUDOU de fato, e o proximo boot ja encontra tudo igual.
window.addEventListener(EVENTO_SESSAO_MUDOU, () => location.reload());

// Reconfere a foto do login. Roda DEPOIS do start para nao atrasar a primeira
// tela: no caso comum nada mudou e ninguem percebe.
sincronizarSessao();
