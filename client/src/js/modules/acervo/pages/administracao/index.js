import { el } from '@utils/dom.js';
import { createTabs } from '@components/tabs/tabs.js';
import { isAdmin, temPerfil } from '@store/auth-store.js';
import { renderVolumesTab } from './volumes-tab.js';
import { renderVolumeTipoProdutoTab } from './volume-tipo-produto-tab.js';
import { renderProjetosTab } from './projetos-tab.js';
import { renderLotesTab } from './lotes-tab.js';
import { renderVerificarVolumeTab } from './verificar-volume-tab.js';
import { renderArquivosProblemaTab } from './arquivos-problema-tab.js';
import { renderArquivosExcluidosTab } from './arquivos-excluidos-tab.js';
import { renderDownloadsExcluidosTab } from './downloads-excluidos-tab.js';
import { renderManutencaoTab } from './manutencao-tab.js';

/**
 * Tela de ADMINISTRAÇÃO do acervo (#/acervo/administracao).
 *
 * O QUE ELA RESOLVE. Os cadastros estruturantes do acervo -- volume de
 * armazenamento, volume x tipo de produto, projeto e lote -- so existiam no
 * plugin do QGIS, e por isso exigiam QGIS instalado para uma tarefa que nao tem
 * nada de espacial. As rotas sempre estiveram no servidor ('/volumes',
 * '/projetos'); o que faltava era tela.
 *
 * UMA ROTA, e nao um item de menu por assunto. Sao
 * cadastros que se leem juntos: a associacao volume x tipo so faz sentido ao
 * lado da lista de volumes, e o lote nao existe sem o projeto. Quatro itens
 * soltos na sidebar dariam quatro telas de uma linha cada.
 *
 * ABAS EM DOIS NIVEIS pelo mesmo motivo: o nivel 1 separa os dois assuntos, e o
 * nivel 2 as duas metades de cada um. So a aba ativa existe no DOM (contrato do
 * `createTabs`), entao abrir a tela nao dispara as seis cargas de uma vez.
 *
 * PERFIL. A rota e `admin: true` (ver `modules/acervo/index.js`): so o
 * ADMINISTRADOR global abre esta tela, e ela e a unica excecao a regra de que o
 * gerente ve tudo da area dele. E por isso que as duas guardas internas deste
 * arquivo -- o `temPerfil('gerente', 'acervo')` do Diagnostico e o `isAdmin()`
 * da Manutencao -- nunca reprovam hoje: `temPerfil` devolve verdadeiro para
 * administrador, e ninguem alem dele chega aqui. Elas ficam porque descrevem o
 * que cada grupo exige DO SERVIDOR, que e quem barra de verdade
 * (`verifyPerfil`). Dentro das abas, editar e operador e excluir e GERENTE, e
 * cada aba esconde o botao que a pessoa nao poderia usar.
 *
 * @param {HTMLElement} container
 * @param {{params:Object, query:URLSearchParams}} _ctx
 * @returns {Promise<Function>} cleanup
 */
export async function renderAdministracao(container, _ctx) {
  // Cada grupo do nivel 1 monta um `createTabs` proprio, de nivel 2. O cleanup
  // e o refresh do grupo apenas repassam para ele: sem esse repasse, trocar de
  // grupo deixaria a tabela do grupo anterior viva, escutando eventos.
  function grupo(subAbas, ariaLabel) {
    return async (content) => {
      const sub = createTabs({ tabs: subAbas, className: 'sub-tabs', ariaLabel });
      content.appendChild(sub.element);
      await sub.ready;
      return {
        cleanup: () => sub._cleanup(),
        refresh: () => sub.refreshActive(),
      };
    };
  }

  // A aba de Manutenção só existe para o ADMINISTRADOR GLOBAL, porque as quatro
  // rotas dela são `verifyAdmin` e nenhuma é trabalho de módulo: duas mexem no
  // banco inteiro, uma renomeia arquivo no volume e uma relê byte. Para um
  // gerente, ela seria uma aba de quatro botões que só sabem responder 403.
  const abas = [
    {
      id: 'volumes',
      label: 'Volumes',
      render: grupo([
        { id: 'armazenamento', label: 'Armazenamento', render: renderVolumesTab },
        { id: 'tipo_produto', label: 'Tipo de produto', render: renderVolumeTipoProdutoTab },
      ], 'Abas de volumes'),
    },
    {
      id: 'projetos',
      label: 'Projetos e lotes',
      render: grupo([
        { id: 'projetos', label: 'Projetos', render: renderProjetosTab },
        { id: 'lotes', label: 'Lotes', render: renderLotesTab },
      ], 'Abas de projetos e lotes'),
    },
  ];

  // Diagnóstico é GERENTE nas quatro rotas, um nível acima do que a página pede.
  // Um operador veria um grupo cujas quatro sub-abas só sabem responder 403, e é
  // o mesmo raciocínio da Manutenção logo abaixo.
  if (temPerfil('gerente', 'acervo')) {
    abas.push({
      id: 'diagnostico',
      label: 'Diagnóstico',
      render: grupo([
        // "Verificar" vem primeiro porque é ela que ESCREVE o status que as
        // outras leem: sem rodá-la, a lista de arquivos com problema é a foto da
        // última vez que alguém rodou, e não do acervo de hoje.
        { id: 'verificar', label: 'Verificar volume', render: renderVerificarVolumeTab },
        { id: 'problema', label: 'Arquivos com problema', render: renderArquivosProblemaTab },
        { id: 'excluidos', label: 'Arquivos excluídos', render: renderArquivosExcluidosTab },
        { id: 'downloads', label: 'Downloads excluídos', render: renderDownloadsExcluidosTab },
      ], 'Abas de diagnóstico'),
    });
  }

  if (isAdmin()) {
    // Última, e sem sub-abas: é a única do conjunto que ESCREVE fora do cadastro,
    // e pô-la no caminho de quem veio conferir um volume seria convidá-la.
    abas.push({ id: 'manutencao', label: 'Manutenção', render: renderManutencaoTab });
  }

  const tabs = createTabs({
    tabs: abas,
    ariaLabel: 'Abas da administração do acervo',
  });

  const page = el('div', { className: 'page' }, [
    el('div', { className: 'page__header' }, [
      el('h1', { className: 'page__title', textContent: 'Administração' }),
    ]),
    tabs.element,
  ]);
  container.appendChild(page);

  await tabs.ready;

  return () => {
    tabs._cleanup();
  };
}
