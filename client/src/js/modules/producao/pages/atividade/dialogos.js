import { el } from '@utils/dom.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createCheckboxField, createSelectField, createTextareaField,
} from '@components/form-fields/form-fields.js';
import { showError, showSuccess } from '@utils/toast.js';
import {
  finalizarAtividade, reportarProblema, reportarFinalizacaoIncorreta,
} from '@services/producao-service.js';

/**
 * As DUAS frases de alteração de fluxo, copiadas do enum do servidor.
 *
 * ELAS SÃO TEXTO, e não chave estrangeira: `producao.alteracao_fluxo.descricao`
 * guarda a frase como está escrita aqui, e o `Joi.valid(...)` de
 * `distribuicao_schema.js` recusa qualquer outra. Um acento a menos numa delas
 * vira 400 sem que nada no cliente pareça errado, e é por isso que elas moram
 * numa constante só, e não soltas dentro do formulário.
 */
export const ALTERACOES_DE_FLUXO = [
  'Necessita nova revisão',
  'Não é necessário uma nova revisão',
];

/**
 * `dominio.tipo_etapa`: as etapas em que quem trabalha é REVISOR.
 *
 * São elas que decidem se o formulário de finalização oferece "sem correção" e
 * "alteração de fluxo": as duas são decisões de quem revisa, e numa Execução
 * não há o que dispensar nem o que redirecionar. Os códigos vêm de
 * `server/src/utils/domain_constants.js` (2 Revisão, 4 Revisão/Correção, 5
 * Revisão final).
 */
export const ETAPAS_DE_REVISAO = [2, 4, 5];

/** Descrição mínima, a mesma régua do formulário do SAP. */
const MINIMO_DESCRICAO = 5;

/**
 * Finalizar a atividade em execução.
 *
 * O SAP NÃO PERGUNTAVA NADA AQUI: o diálogo dele era "Deseja finalizar a
 * atividade?" com Sim e Não, e mandava `sem_correcao: false` fixo. O Joi de
 * `/finaliza` aceita bem mais do que isso, e o que o plugin do QGIS coleta (as
 * observações, a dispensa da correção, a alteração de fluxo) não tinha por onde
 * entrar pela web. Aqui entra, e tudo é OPCIONAL: quem só quer fechar clica em
 * Finalizar sem tocar em campo nenhum, e o corpo sai com o `atividade_id` só.
 *
 * CAMPO VAZIO NÃO VAI NO CORPO. `Joi.string()` recusa string vazia, então
 * mandar `observacao_atividade: ''` transformaria uma finalização sem
 * observação num 400.
 *
 * @param {{atividade:Object, onFinalizado:Function}} opcoes
 */
export function abrirFinalizarDialog({ atividade, onFinalizado }) {
  const ehRevisao = ETAPAS_DE_REVISAO.includes(Number(atividade.tipo_etapa_id));

  const semCorrecao = createCheckboxField({
    label: 'Não é necessária correção',
    helpText: 'Apaga a atividade de Correção que viria a seguir, se ela ainda não tiver começado. '
      + 'O apagamento fica registrado na trilha de auditoria.',
  });

  const alterarFluxo = createSelectField({
    label: 'Alteração de fluxo',
    placeholder: 'Sem alteração',
    options: ALTERACOES_DE_FLUXO.map((descricao) => ({ value: descricao, label: descricao })),
  });

  const observacaoAtividade = createTextareaField({
    label: 'Observação desta atividade',
    rows: 3,
    placeholder: 'O que quem ler esta atividade depois precisa saber',
  });

  const observacaoProxima = createTextareaField({
    label: 'Observação para a próxima atividade',
    rows: 3,
    placeholder: 'O recado para quem pegar a próxima etapa desta unidade de trabalho',
    // O SERVIDOR RECUSA A FINALIZAÇÃO INTEIRA quando não há próxima atividade, e
    // não apenas o recado. Dizer isso antes evita a pessoa perder o texto num
    // 400 que ela não tinha como prever.
    helpText: 'Só preencha se existir uma etapa seguinte nesta unidade de trabalho: '
      + 'sem ela o servidor recusa a finalização.',
  });

  const campos = [
    ehRevisao ? semCorrecao.element : null,
    ehRevisao ? alterarFluxo.element : null,
    observacaoAtividade.element,
    observacaoProxima.element,
  ].filter(Boolean);

  const conteudo = el('div', {}, [
    el('p', { className: 'modal__message', textContent: `Finalizar "${atividade.nome}"?` }),
    el('div', { className: 'form-grid' }, campos),
  ]);

  openModal({
    title: 'Finalizar atividade',
    width: '560px',
    content: conteudo,
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Finalizar',
        variant: 'primary',
        onClick: async ({ close, setOcupado }) => {
          const corpo = { atividade_id: atividade.id };
          if (ehRevisao) {
            if (semCorrecao.getValue()) corpo.sem_correcao = true;
            const fluxo = alterarFluxo.getValue();
            if (fluxo) corpo.alterar_fluxo = fluxo;
          }
          const obs = observacaoAtividade.getValue();
          if (obs) corpo.observacao_atividade = obs;
          const obsProxima = observacaoProxima.getValue();
          if (obsProxima) corpo.observacao_proxima_atividade = obsProxima;

          setOcupado(true);
          try {
            await finalizarAtividade(corpo);
            close();
            showSuccess('Atividade finalizada com sucesso');
            onFinalizado();
          } catch (err) {
            setOcupado(false);
            showError(err.message || 'Não foi possível finalizar a atividade');
          }
        },
      },
    ],
  });
}

/**
 * Apontar um problema na atividade em execução.
 *
 * A ÁREA DO PROBLEMA É A UNIDADE DE TRABALHO INTEIRA, e a limitação é
 * declarada na tela.
 *
 * `polygon_ewkt` é obrigatório no Joi, e no QGIS o operador DESENHA o recorte
 * exato onde o problema está. Esta tela não tem ferramenta de desenho, e
 * inventar uma (um mapa com edição de polígono) seria um recurso novo por conta
 * própria, num caminho que existe justamente para quando o QGIS não está à mão.
 * O que ela manda é o `geom` que `/verifica` devolveu -- `ST_AsEWKT` da unidade
 * de trabalho, já com o prefixo `SRID=` que o servidor exige.
 *
 * SEM `geom` NÃO HÁ ENVIO. O botão fica desabilitado e a tela diz por quê, em
 * vez de mandar um corpo que o Joi recusaria com uma mensagem sobre EWKT que
 * não significa nada para quem está apontando um problema.
 *
 * @param {{atividade:Object, tipos:Array, onReportado:Function}} opcoes
 */
export function abrirProblemaDialog({ atividade, tipos, onReportado }) {
  const semGeometria = !atividade.geom;
  const semTipos = !tipos || !tipos.length;

  const tipo = createSelectField({
    label: 'Tipo de problema',
    required: true,
    placeholder: 'Selecione o tipo de problema',
    options: (tipos || []).map((t) => ({
      value: t.tipo_problema_id,
      label: t.tipo_problema,
    })),
  });

  const descricao = createTextareaField({
    label: 'Descrição',
    required: true,
    rows: 4,
    placeholder: 'Descreva o problema em detalhes para quem for resolvê-lo',
  });

  const avisos = [];
  if (semTipos) {
    avisos.push(el('p', {
      className: 'producao-atividade__aviso',
      role: 'alert',
      textContent: 'O catálogo de tipos de problema não carregou. Atualize a tela e tente de novo.',
    }));
  }
  if (semGeometria) {
    avisos.push(el('p', {
      className: 'producao-atividade__aviso',
      role: 'alert',
      textContent: 'A geometria da unidade de trabalho não veio no pacote desta atividade, '
        + 'e sem ela o servidor não aceita o apontamento. Use o plugin no QGIS.',
    }));
  }

  const conteudo = el('div', {}, [
    ...avisos,
    el('div', { className: 'form-grid' }, [tipo.element, descricao.element]),
    el('p', {
      className: 'producao-atividade__nota',
      textContent: 'A área apontada é a unidade de trabalho inteira. Para marcar um recorte menor, '
        + 'use o plugin SAP Operador no QGIS.',
    }),
    el('p', {
      className: 'producao-atividade__nota',
      textContent: 'Ao enviar, esta atividade é interrompida, a unidade de trabalho sai da '
        + 'distribuição e uma atividade pausada nasce no seu nome para quando o problema for resolvido.',
    }),
  ]);

  openModal({
    title: 'Reportar problema',
    width: '560px',
    content: conteudo,
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Enviar',
        variant: 'danger',
        onClick: async ({ close, setOcupado }) => {
          if (semGeometria || semTipos) return;

          const tipoId = tipo.getValue();
          const texto = descricao.getValue();
          tipo.setError(tipoId === null ? 'Escolha o tipo de problema' : null);
          descricao.setError(texto.length < MINIMO_DESCRICAO
            ? `A descrição deve ter pelo menos ${MINIMO_DESCRICAO} caracteres`
            : null);
          if (tipoId === null || texto.length < MINIMO_DESCRICAO) return;

          setOcupado(true);
          try {
            await reportarProblema({
              atividade_id: atividade.id,
              tipo_problema_id: Number(tipoId),
              descricao: texto,
              polygon_ewkt: atividade.geom,
            });
            close();
            showSuccess('Problema reportado com sucesso');
            onReportado();
          } catch (err) {
            setOcupado(false);
            showError(err.message || 'Não foi possível reportar o problema');
          }
        },
      },
    ],
  });
}

/**
 * "Finalizei sem querer": aponta o problema na ÚLTIMA atividade que esta pessoa
 * fechou.
 *
 * NÃO PRECISA DE ATIVIDADE EM EXECUÇÃO, e por isso o botão dela fica no
 * cabeçalho da tela e não na ficha: quem finalizou por engano está, por
 * definição, sem atividade aberta. Quem escolhe QUAL atividade foi é o servidor,
 * e o cliente não manda id nenhum -- mandar um seria deixar a tela decidir uma
 * coisa que ela não tem como saber.
 *
 * @param {{onReportado:Function}} opcoes
 */
export function abrirFinalizacaoIncorretaDialog({ onReportado }) {
  const descricao = createTextareaField({
    label: 'Descrição',
    required: true,
    rows: 4,
    placeholder: 'O que aconteceu, e o que ainda falta fazer nesta unidade de trabalho',
  });

  const conteudo = el('div', {}, [
    el('div', { className: 'form-grid' }, [descricao.element]),
    el('p', {
      className: 'producao-atividade__nota',
      textContent: 'O apontamento vai para a última atividade que você finalizou, e é o servidor '
        + 'que descobre qual foi.',
    }),
    el('p', {
      className: 'producao-atividade__nota',
      textContent: 'A atividade NÃO volta a execução por aqui: quem decide o que fazer com ela é '
        + 'quem gerencia a produção.',
    }),
  ]);

  openModal({
    title: 'Reportar finalização incorreta',
    width: '560px',
    content: conteudo,
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Enviar',
        variant: 'danger',
        onClick: async ({ close, setOcupado }) => {
          const texto = descricao.getValue();
          descricao.setError(texto.length < MINIMO_DESCRICAO
            ? `A descrição deve ter pelo menos ${MINIMO_DESCRICAO} caracteres`
            : null);
          if (texto.length < MINIMO_DESCRICAO) return;

          setOcupado(true);
          try {
            await reportarFinalizacaoIncorreta(texto);
            close();
            showSuccess('Finalização incorreta reportada com sucesso');
            onReportado();
          } catch (err) {
            setOcupado(false);
            showError(err.message || 'Não foi possível reportar a finalização incorreta');
          }
        },
      },
    ],
  });
}
