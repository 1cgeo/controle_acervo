import '@css/style.css';
import { initTheme } from '@utils/theme.js';
import { isAuthenticated } from '@store/auth-store.js';
import { sincronizarSessao, EVENTO_SESSAO_MUDOU } from '@services/api-client.js';
import Router, {
  adminLoader, authLoader, gerenteLoader, perfilLoader, rotaRaiz,
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
import { renderRevisoesPit } from '@pages/revisoes-pit/index.js';
import { renderRpcmtec } from '@pages/rpcmtec/index.js';
import { renderRpcmtecEdicao } from '@pages/rpcmtec/edicao.js';
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

// Acessos: o historico de login (`dgeo.login`), a outra metade da area
// "Usuarios" da sidebar.
//
// `adminLoader` como a de cima, e pela mesma razao: quem entrou e quando nao e
// dado de modulo nenhum, e nao existe perfil de "acessos". O servidor cobra o
// mesmo, com verifyAdmin em todas as rotas de /api/acessos.
router.add('/acessos', withLayout(renderAcessos), { guard: adminLoader });

// Rastreabilidade: o que foi ALTERADO nos modulos, quando e por quem. E a outra
// pergunta de #/acessos, que registra quem ENTROU e nao o que a pessoa fez
// depois de entrar.
//
// `gerenteLoader`, e nao `adminLoader`: a tela e do administrador global (que ve
// os tres modulos e a plataforma) E do gerente de qualquer modulo (que ve o
// dele). O recorte de verdade vem do servidor, no verifyRastreabilidade, que le
// o perfil do BANCO a cada requisicao -- este guarda so evita abrir uma tela que
// responderia 403.
//
// NAO confundir com #/acervo/auditoria: aquela roda os invariantes do acervo,
// mede a coerencia entre tabelas HOJE e nao diz quem produziu a incoerencia.
router.add('/rastreabilidade', withLayout(renderRastreabilidade), {
  guard: gerenteLoader,
});

// Meu perfil: os proprios dados e a troca da PROPRIA senha. `authLoader`, e nao
// `adminLoader`: e a unica tela de plataforma que serve a todo mundo, e sem ela
// so o administrador troca senha, por reset.
router.add('/perfil', withLayout(renderPerfil), { guard: authLoader });

// Metas do PIT: o plano anual da Divisao, que os tres modulos consomem. Nao e
// tela de modulo, senao quem so tem perfil na mapoteca nao veria a lista. Sem
// `adminLoader`: LER e de qualquer pessoa logada, e o backend cobra o
// administrador so na escrita.
router.add('/metas', withLayout(renderMetasList), { guard: authLoader });
// As REVISOES do PIT. `authLoader` como as metas ao lado: qualquer pessoa
// logada LE o plano anual e o que a DSG mudou nele, e o servidor cobra o
// administrador so na escrita.
router.add('/revisoes_pit', withLayout(renderRevisoesPit), { guard: authLoader });

// Execucao do PIT: a grade do ano, com o planejado e o realizado de cada mes.
//
// `gerenteLoader`, e nao `authLoader`: a leitura e do gerente de qualquer modulo
// e do administrador. O PIT e o compromisso do ano, e quem responde por ele e
// quem responde pelo modulo. O servidor cobra o mesmo, com `verifyGerente`,
// lendo o perfil do BANCO.
router.add('/execucao_pit', withLayout(renderExecucaoPit), { guard: gerenteLoader });

// Extra-PIT: a excecao AUTORIZADA ao plano anual (subsecao 3.3). Mesma guarda,
// pela mesma razao.
router.add('/extra_pit', withLayout(renderExtraPitList), { guard: authLoader });

// Aproveitamento do efetivo (6.1) e capacitacao (2.6 e 6.2). `adminLoader`, e
// nao authLoader: as duas sao ENTRADA do RPCMTec, moram sob /api/rpcmtec e sao
// verifyAdmin no servidor. Com authLoader a tela abriria para levar 403.
router.add('/aproveitamento', withLayout(renderAproveitamento), { guard: adminLoader });

// A capacitacao e DUAS telas, em dois lugares do menu. A
// MINISTRADA e servico que a Divisao presta, e fica em Producao; a RECEBIDA e
// gente nossa em curso, e fica em Efetivo. A tabela do banco continua UMA: o que
// muda entre as duas sao tres colunas.
router.add('/capacitacao_ministrada', withLayout(renderCapacitacaoMinistrada), { guard: adminLoader });
router.add('/capacitacao_recebida', withLayout(renderCapacitacaoRecebida), { guard: adminLoader });

// RPCMTec: o relatorio mensal da Divisao, inteiro, numa tela so. Rota de
// PLATAFORMA porque a mesma edicao fala de acervo, mapoteca e orcamento, e o
// chefe assina uma so.
//
// `adminLoader`, e nao `authLoader`: o relatorio traz valor de credito, de
// empenho e de liquidacao, e liberar por perfil de um modulo entregaria o
// orcamento a quem so cataloga carta. O backend cobra o mesmo com verifyAdmin.
router.add('/rpcmtec', withLayout(renderRpcmtec), { guard: adminLoader });
// A EDICAO de um mes. Rota propria, e nao estado dentro da lista, porque
// consultar o RPCMTec de um mes passado e a operacao mais comum da tela e
// precisa de endereco: quem manda "veja o de marco" manda um link.
router.add('/rpcmtec/:id', withLayout(renderRpcmtecEdicao), { guard: adminLoader });

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
