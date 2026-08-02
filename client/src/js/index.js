import '@css/style.css';
import { initTheme } from '@utils/theme.js';
import { isAuthenticated } from '@store/auth-store.js';
import { sincronizarSessao, EVENTO_SESSAO_MUDOU } from '@services/api-client.js';
import Router, {
  adminLoader, authLoader, perfilLoader, rastreabilidadeLoader, rotaRaiz,
} from './router.js';
import { createMainLayout } from '@components/layout/main-layout.js';
import { modulosPortados } from '@modules/registry.js';
import { renderLogin } from '@pages/login.js';
import { renderUnauthorized } from '@pages/unauthorized.js';
import { renderNotFound } from '@pages/not-found.js';
import { renderUsuariosList } from '@pages/usuarios/list.js';
import { renderAcessos } from '@pages/acessos/index.js';
import { renderRastreabilidade } from '@pages/rastreabilidade/index.js';
import { renderPerfil } from '@pages/perfil/index.js';
import { renderMetasList } from '@pages/metas/list.js';
import { renderExecucaoPit } from '@pages/execucao-pit/index.js';
import { renderExtraPitList } from '@pages/extra-pit/list.js';
import { renderAproveitamento } from '@pages/aproveitamento/index.js';
import {
  renderCapacitacaoMinistrada,
  renderCapacitacaoRecebida,
} from '@pages/capacitacao/list.js';
import { renderRpcmtec } from '@pages/rpcmtec/index.js';
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

// Acessos: o historico de login (dgeo.login), que nasceu com a fusao da
// autenticacao em 2026-08-02. E a outra metade da area "Usuarios" da sidebar.
//
// `adminLoader` como a de cima, e pela mesma razao: quem entrou e quando nao e
// dado de modulo nenhum, e nao existe perfil de "acessos". O servidor cobra o
// mesmo, com verifyAdmin em todas as rotas de /api/acessos.
router.add('/acessos', withLayout(renderAcessos), { guard: adminLoader });

// Rastreabilidade: o que foi ALTERADO nos modulos, quando e por quem. E a outra
// pergunta de #/acessos, que registra quem ENTROU e nao o que a pessoa fez
// depois de entrar.
//
// `rastreabilidadeLoader`, e nao `adminLoader`: a tela e do administrador global
// (que ve os tres modulos e a plataforma) E do gerente de qualquer modulo (que
// ve o dele). O recorte de verdade vem do servidor, no verifyRastreabilidade,
// que le o perfil do BANCO a cada requisicao -- este guarda so evita abrir uma
// tela que responderia 403.
//
// NAO confundir com #/acervo/auditoria: aquela roda os invariantes do acervo,
// mede a coerencia entre tabelas HOJE e nao diz quem produziu a incoerencia.
router.add('/rastreabilidade', withLayout(renderRastreabilidade), {
  guard: rastreabilidadeLoader,
});

// Meu perfil: os proprios dados e a troca da PROPRIA senha. `authLoader`, e nao
// adminLoader: e a unica tela de plataforma que serve a todo mundo, e sem ela
// ninguem troca a senha de ninguem a nao ser o administrador (por reset). Ela
// nasceu em 2026-08-02, quando a autenticacao veio do Auth Server para o SCA.
router.add('/perfil', withLayout(renderPerfil), { guard: authLoader });

// Metas do PIT: o plano anual da Divisao, que os tres modulos consomem. Saiu do
// modulo orcamento em 2026-07-31 justamente porque quem so tem perfil na
// mapoteca nao conseguia nem ver a lista. Sem `adminLoader`: LER e de qualquer
// pessoa logada, e o backend cobra o administrador so na escrita.
router.add('/metas', withLayout(renderMetasList), { guard: authLoader });

// Execucao do PIT: o lancamento mensal que alimenta a subsecao 2.1 do RPCMTec.
// Absorvida do SAP em 2026-08-02. `authLoader` como as metas, e pela mesma
// razao: LER o andamento do plano anual interessa aos tres modulos, e o backend
// cobra o administrador so na escrita. A tela esconde o campo de quem nao pode.
router.add('/execucao_pit', withLayout(renderExecucaoPit), { guard: authLoader });

// Extra-PIT: a excecao AUTORIZADA ao plano anual (subsecao 3.3). Mesma guarda,
// pela mesma razao.
router.add('/extra_pit', withLayout(renderExtraPitList), { guard: authLoader });

// Aproveitamento do efetivo (6.1) e capacitacao (2.6 e 6.2). `adminLoader`, e
// nao authLoader: as duas sao ENTRADA do RPCMTec, moram sob /api/rpcmtec e sao
// verifyAdmin no servidor. Com authLoader a tela abriria para levar 403.
router.add('/aproveitamento', withLayout(renderAproveitamento), { guard: adminLoader });

// A capacitacao e DUAS telas, em dois lugares do menu (chefe, 2026-08-02). A
// MINISTRADA e servico que a Divisao presta, e fica em Producao; a RECEBIDA e
// gente nossa em curso, e fica em Efetivo. A tabela do banco continua UMA: o que
// muda entre as duas sao tres colunas.
router.add('/capacitacao_ministrada', withLayout(renderCapacitacaoMinistrada), { guard: adminLoader });
router.add('/capacitacao_recebida', withLayout(renderCapacitacaoRecebida), { guard: adminLoader });

// RPCMTec: o relatorio mensal da Divisao, inteiro, numa tela so. Rota de
// PLATAFORMA porque a mesma edicao fala de acervo, mapoteca e orcamento, e o
// chefe assina uma so; ela substituiu, em 2026-08-01, as duas telas que
// geravam metade do relatorio cada (#/mapoteca/rpcmtec e #/orcamento/relatorio).
//
// `adminLoader`, e nao `authLoader`: o relatorio traz valor de credito, de
// empenho e de liquidacao, e liberar por perfil de um modulo entregaria o
// orcamento a quem so cataloga carta. O backend cobra o mesmo com verifyAdmin.
router.add('/rpcmtec', withLayout(renderRpcmtec), { guard: adminLoader });

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
