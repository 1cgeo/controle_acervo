import { el, svgIcon, ICONS } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField,
  createTextareaField,
  createNumberField,
  createSelectField,
} from '@components/form-fields/form-fields.js';
import { showSuccess, showError } from '@utils/toast.js';
import {
  getTiposProduto,
  getTiposEscala,
  getSubtiposProduto,
  getFolha,
  criarProdutos,
  atualizarProduto,
} from '@modules/acervo/services/acervo-service.js';
import { openVersaoDialog } from './versao-dialog.js';

/**
 * Criar e editar PRODUTO do acervo.
 *
 * O produto é a folha; a versão é a edição dela. Esta tela cadastra só a casca:
 * quem tem arquivo entra pelo assistente de carregamento, e quem tem versão
 * planejada ganha a versão pelo `versao-dialog.js`.
 *
 * Duas regras do banco vivem aqui, e as duas espelham CHECK de `acervo.produto`:
 *
 *   1. O denominador só existe na escala PERSONALIZADA (código 5), e é
 *      obrigatório nela. Fora dela a coluna tem que ser NULA, e por isso o campo
 *      não só se esconde: ele deixa de ir no corpo com valor.
 *   2. `subtipo_produto_id` é a IDENTIDADE do produto (24 = Carta Topográfica
 *      Militar). Um produto fixado num subtipo só aceita versão daquele subtipo,
 *      e o subtipo com `define_produto` exige produto próprio. Por isso o campo
 *      aparece com o aviso, e não escondido num "avançado".
 */

// dominio.tipo_escala. Espelha server/src/utils/domain_constants.js.
export const TIPO_ESCALA_PERSONALIZADA = 5;

/**
 * Editor de geometria, registrado por quem o constrói.
 *
 * TODO(integração): `client/src/js/components/mapa/editor-geometria.js` está
 * sendo feito em paralelo. Quando existir, ele chama `registrarEditorGeometria`
 * uma vez (no arranque do módulo do acervo) com uma função de contrato:
 *
 *     async ({ ewktAtual, tipoEscalaId }) => ({ ewkt, mi, inom, tipo_escala_id })
 *
 * Recebe a geometria atual (null quando ainda não há) e a escala escolhida, para
 * abrir o mapa já no lugar certo e com a grade da escala. Devolve a geometria em
 * EWKT mais o que o desenho deduziu do mapa índice; qualquer chave ausente na
 * resposta é "não mexa neste campo", e devolver null/undefined é a pessoa ter
 * desistido do desenho.
 *
 * Enquanto não houver editor, o botão fica desabilitado dizendo por quê, e o
 * caminho que já funciona é buscar a folha pelo MI/INOM.
 */
let editorGeometria = null;

/** @param {Function} fn - ver o contrato acima */
export function registrarEditorGeometria(fn) {
  editorGeometria = fn;
}

/**
 * Diálogo de criar/editar produto.
 *
 * @param {Object} opcoes
 * @param {Object|null} [opcoes.produto] - a ficha detalhada (edição). Ela já traz
 *   `geom` em EWKT, então editar não perde a geometria de quem não a tocou.
 * @param {Function} [opcoes.onSaved]
 */
export async function openProdutoDialogForm({ produto = null, onSaved = null } = {}) {
  const edicao = Boolean(produto);

  // Os domínios não bloqueiam a tela: sem eles os `<select>` ficam vazios, o que
  // é visível, em vez de um diálogo que não abre.
  const [tipos, escalas, subtipos] = await Promise.all([
    getTiposProduto().catch(() => []),
    getTiposEscala().catch(() => []),
    getSubtiposProduto().catch(() => []),
  ]);

  // A geometria não é campo de formulário: ela vem do mapa índice ou do editor,
  // e o que a tela guarda é o EWKT resultante.
  let ewkt = produto?.geom || null;

  const nomeField = createTextField({
    label: 'Nome',
    required: true,
    value: produto?.nome || '',
    helpText: 'Nome da folha, como aparece na carta',
  });

  const miField = createTextField({
    label: 'MI',
    value: produto?.mi || '',
    placeholder: '2758-3-NE',
  });

  const inomField = createTextField({
    label: 'INOM',
    value: produto?.inom || '',
    placeholder: 'SF-22-Y-D-III-3-NE',
  });

  const denominadorField = createNumberField({
    label: 'Denominador da escala',
    min: 1,
    step: 1,
    value: produto?.denominador_escala_especial ?? undefined,
    helpText: 'Só na escala personalizada: 30000 para 1:30.000',
  });

  const escalaField = createSelectField({
    label: 'Escala',
    required: true,
    options: (escalas || []).map(e => ({ value: e.code, label: e.nome })),
    value: produto?.tipo_escala_id ?? '',
    onChange: () => pintarDenominador(),
  });

  const tipoField = createSelectField({
    label: 'Tipo de produto',
    required: true,
    options: (tipos || []).map(t => ({ value: t.code, label: t.nome })),
    value: produto?.tipo_produto_id ?? '',
    onChange: () => atualizarSubtipos(),
  });

  const subtipoField = createSelectField({
    label: 'Subtipo de produto',
    options: [],
    placeholder: 'Sem subtipo próprio',
    helpText: 'Fixar o subtipo faz dele a identidade do produto: só entram versões '
      + 'desse subtipo. A Carta Topográfica Militar exige isto.',
  });

  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: produto?.descricao || '',
  });

  /**
   * O denominador só existe na escala personalizada.
   *
   * Esconder E limpar: um denominador digitado antes de trocar a escala ficaria
   * invisível na tela e viajaria no corpo, e o CHECK do banco recusaria uma
   * coisa que a pessoa não vê mais.
   */
  function pintarDenominador() {
    const personalizada = Number(escalaField.getValue()) === TIPO_ESCALA_PERSONALIZADA;
    denominadorField.element.classList.toggle('hidden', !personalizada);
    if (!personalizada) denominadorField.setValue(null);
  }

  /**
   * Subtipos do tipo escolhido.
   *
   * Mesma regra da busca: subtipo que não pertence ao tipo é DESCARTADO, e não
   * mantido, porque ele deixou de fazer sentido. Aqui isso vale duas vezes, que
   * é escrita: gravar um par tipo/subtipo que não se cruza cria um produto que
   * nenhuma busca por tipo encontra.
   */
  function atualizarSubtipos() {
    const tipo = tipoField.getValue();
    const anterior = subtipoField.getValue();
    const visiveis = tipo
      ? (subtipos || []).filter(s => String(s.tipo_id) === String(tipo))
      : (subtipos || []);

    subtipoField.setOptions(visiveis.map(s => ({ value: s.code, label: s.nome })));
    if (anterior !== null && visiveis.some(s => Number(s.code) === Number(anterior))) {
      subtipoField.setValue(anterior);
    }
  }

  atualizarSubtipos();
  if (produto?.subtipo_produto_id != null) subtipoField.setValue(produto.subtipo_produto_id);
  pintarDenominador();

  // ---------------------------------------------------------------------------
  // Geometria
  // ---------------------------------------------------------------------------
  const geomEstado = el('span', { className: 'produto-form__geom-estado' });

  function pintarGeometria() {
    geomEstado.replaceChildren(
      svgIcon(ewkt ? ICONS.checkCircle : ICONS.warning, 16),
      el('span', {
        textContent: ewkt
          ? 'Geometria definida'
          : 'Sem geometria (obrigatória para criar o produto)',
      })
    );
    geomEstado.classList.toggle('produto-form__geom-estado--falta', !ewkt);
  }

  const btnEditor = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: async () => {
      if (!editorGeometria) return;
      try {
        const resultado = await editorGeometria({
          ewktAtual: ewkt,
          tipoEscalaId: escalaField.getValue(),
        });
        // Desistir do desenho não pode apagar a geometria que já existia.
        if (!resultado || !resultado.ewkt) return;
        ewkt = resultado.ewkt;
        if (resultado.mi !== undefined) miField.setValue(resultado.mi);
        if (resultado.inom !== undefined) inomField.setValue(resultado.inom);
        if (resultado.tipo_escala_id !== undefined) {
          escalaField.setValue(resultado.tipo_escala_id);
          pintarDenominador();
        }
        pintarGeometria();
      } catch (erro) {
        showError(erro.message || 'Não foi possível definir a geometria');
      }
    },
  }, [svgIcon(ICONS.layers, 16), 'Definir geometria']);

  if (!editorGeometria) {
    btnEditor.disabled = true;
    btnEditor.title = 'O editor de geometria ainda não está disponível nesta tela. '
      + 'Use "Buscar folha" para trazer o contorno do mapa índice.';
  }

  /**
   * Traz a folha do mapa índice pelo MI ou pelo INOM.
   *
   * É o caminho normal para carta sistemática: o contorno da folha é definido
   * pela DSG, e redesenhá-lo à mão só produziria um polígono parecido. O editor
   * fica para o que não está no mapa índice (ortoimagem de recorte próprio,
   * produto de projeto).
   */
  const btnFolha = el('button', {
    className: 'btn btn--secondary btn--sm',
    type: 'button',
    onClick: async (e) => {
      const botao = e.currentTarget;
      const mi = miField.getValue();
      const inom = inomField.getValue();
      if (!mi && !inom) {
        miField.setError('Informe o MI ou o INOM para buscar a folha');
        return;
      }
      miField.setError(null);

      botao.disabled = true;
      try {
        const folha = await getFolha({ mi, inom });
        if (!folha || !folha.geom) {
          showError('Folha não encontrada no mapa índice');
          return;
        }
        ewkt = folha.geom;
        // `sem_mi` marca a folha que não tem MI (fora da carta sistemática do
        // Brasil): sobrescrever com string vazia apagaria o que a pessoa digitou.
        if (folha.mi) miField.setValue(folha.mi);
        if (folha.inom) inomField.setValue(folha.inom);
        if (folha.tipo_escala_id) {
          escalaField.setValue(folha.tipo_escala_id);
          pintarDenominador();
        }
        pintarGeometria();
        showSuccess('Folha encontrada no mapa índice');
      } catch (erro) {
        showError(erro.message || 'Não foi possível buscar a folha');
      } finally {
        botao.disabled = false;
      }
    },
  }, [svgIcon(ICONS.search, 16), 'Buscar folha']);

  pintarGeometria();

  const blocoGeom = el('div', { className: 'produto-form__geom' }, [
    el('span', { className: 'produto-form__geom-titulo', textContent: 'Geometria' }),
    geomEstado,
    el('div', { className: 'produto-form__geom-acoes' }, [btnFolha, btnEditor]),
  ]);

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    miField.element,
    inomField.element,
    tipoField.element,
    subtipoField.element,
    escalaField.element,
    denominadorField.element,
    el('div', { className: 'form-grid__full' }, [blocoGeom]),
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
  ]);

  let salvando = false;

  /**
   * Valida o formulário e monta o corpo do produto, ou devolve null.
   *
   * Extraída porque DOIS botões precisam dela: "Salvar" grava o produto sozinho,
   * e "Salvar e criar versão" o entrega ao diálogo de versão sem gravar. Duas
   * cópias da validação divergiriam na primeira regra nova.
   */
  function validarEMontar() {
    [nomeField, escalaField, tipoField, denominadorField].forEach(c => c.setError(null));

    const nome = nomeField.getValue();
    const tipoEscalaId = escalaField.getValue();
    const tipoProdutoId = tipoField.getValue();
    const personalizada = Number(tipoEscalaId) === TIPO_ESCALA_PERSONALIZADA;
    const denominador = denominadorField.getValue();

    let valido = true;
    // O PUT do servidor exige nome não vazio. Aceitar um produto sem nome na
    // criação criaria justamente o registro que não se consegue salvar de novo
    // sem inventar um.
    if (!nome) {
      nomeField.setError('Informe o nome do produto');
      valido = false;
    }
    if (!tipoProdutoId) {
      tipoField.setError('Escolha o tipo de produto');
      valido = false;
    }
    if (!tipoEscalaId) {
      escalaField.setError('Escolha a escala');
      valido = false;
    }
    if (personalizada && !denominador) {
      denominadorField.setError('A escala personalizada exige o denominador');
      valido = false;
    }
    if (!valido) return null;

    if (!edicao && !ewkt) {
      showError('Defina a geometria do produto antes de salvar');
      return null;
    }

    return {
      nome,
      mi: miField.getValue() || null,
      inom: inomField.getValue() || null,
      tipo_escala_id: Number(tipoEscalaId),
      denominador_escala_especial: personalizada ? Number(denominador) : null,
      tipo_produto_id: Number(tipoProdutoId),
      subtipo_produto_id: subtipoField.getValue() === null
        ? null
        : Number(subtipoField.getValue()),
      descricao: descricaoField.getValue(),
    };
  }

  const acoes = [
    { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
  ];

  // Produto e versão num passo só.
  //
  // O produto NÃO é gravado aqui: o corpo segue PENDENTE para o diálogo de
  // versão, e quem grava os dois é a rota que os cria juntos
  // (`/produtos/produto_versao_*`, ou o assistente quando a versão é Regular e
  // traz arquivo). Gravar o produto antes deixaria uma casca sem versão sempre
  // que a pessoa desistisse no passo seguinte -- e ela desiste, porque o passo
  // seguinte é onde o gatilho de versão cobra o rótulo e o subtipo.
  //
  // Só na CRIAÇÃO: editando, o produto já existe e a versão se acrescenta pela
  // ficha, que é onde estão as outras.
  if (!edicao) {
    acoes.push({
      label: 'Salvar e criar versão',
      variant: 'secondary',
      onClick: ({ close }) => {
        const corpo = validarEMontar();
        if (!corpo) return;

        close();
        openVersaoDialog({
          // O produto ainda não tem id: quem o receber precisa saber disso.
          produtoPendente: { ...corpo, geom: ewkt },
          produto: { ...corpo, id: null },
          versoesExistentes: [],
          onSaved,
        });
      },
    });
  }

  acoes.push({
    label: 'Salvar',
    variant: 'primary',
    onClick: async ({ close }) => {
      if (salvando) return;

      const corpo = validarEMontar();
      if (!corpo) return;

      salvando = true;
      try {
        if (edicao) {
          // `geom` só viaja quando existe: no PUT sem geometria o servidor
          // preserva a que está gravada, e mandar null a apagaria.
          await atualizarProduto({
            id: Number(produto.id),
            ...corpo,
            ...(ewkt ? { geom: ewkt } : {}),
          });
          showSuccess('Produto atualizado com sucesso');
        } else {
          await criarProdutos([{ ...corpo, geom: ewkt }]);
          showSuccess('Produto criado com sucesso');
        }
        close();
        if (onSaved) onSaved();
      } catch (erro) {
        showError(erro.message || 'Erro ao salvar o produto');
      } finally {
        salvando = false;
      }
    },
  });

  openModal({
    title: edicao ? 'Editar produto' : 'Novo produto',
    content,
    width: '720px',
    actions: acoes,
  });
}
