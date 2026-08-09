import { el } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { openModal } from '@components/modal/modal-base.js';
import {
  createTextField, createSelectField, createDateField, createTextareaField,
} from '@components/form-fields/form-fields.js';
import { createSeletorMilitares } from '@components/form-fields/seletor-militares.js';
import { createTabs } from '@components/tabs/tabs.js';
import { criarCampo, atualizarCampo } from '@services/campo-service.js';
import { lerGeojson, resumirGeometria } from './campo-geojson.js';
import { criarGaleriaCampo } from './campo-midia.js';
import { criarTrajetosCampo } from './campo-trajetos.js';
import './campo.css';

/**
 * Cadastro e edição de uma atividade de campo.
 *
 * A ÁREA É OBRIGATÓRIA e entra por ARQUIVO GeoJSON: `campo.geom` é NOT NULL, e
 * desde 2026-08-09 não há desenho no mapa. A razão é o dado -- a área do campo
 * não nasce na tela, ela vem do plano de voo, do polígono da folha ou do KML da
 * operação, e redesenhar a mão o que já está desenhado é transcrever.
 * `lerGeojson` valida antes de o formulário guardar o polígono.
 *
 * O ANO É UM SELETOR DE EXERCÍCIO DO PIT, e não um número livre. `campo.ano`
 * referencia `pit.pit`, por decisão do chefe em 2026-08-08: o ano do campo
 * é o ano do plano de verdade, e não um número que só por acaso coincide. Ano
 * sem exercício cadastrado é RECUSADO pelo banco, e a mensagem do servidor
 * manda cadastrar o exercício em "PIT do ano".
 *
 * O EFETIVO SÃO DOIS CAMPOS, e a duplicidade é deliberada. O seletor liga a
 * `dgeo.usuario`; a caixa de texto ao lado guarda quem NÃO tem conta -- gente de
 * outra OM, motorista da guarnição e, sobretudo, quem já saiu. Dos 145 nomes
 * distintos dos 13 anos de campo do SAP, 59 casam com o cadastro de hoje e 86
 * não. Sem a caixa de texto, o efetivo dos campos antigos se perderia.
 *
 * @param {Object} options
 * @param {Object|null} [options.campo] - a ficha, quando é edição
 * @param {Array<Object>} options.situacoes
 * @param {Array<Object>} options.categorias
 * @param {Array<Object>} options.anos - os exercícios do PIT
 * AS FOTOS E OS TRAJETOS MORAM AQUI, em abas, e só na EDIÇÃO. Decisão do chefe
 * em 2026-08-09: a ficha é só leitura, e tudo o que muda o campo passa por
 * "Editar". Num campo NOVO as abas não existem, e não é limitação da tela --
 * `campo.imagem` e `campo.track` referenciam `campo_id`, então não há a que
 * pendurar o arquivo antes de o campo ter id. Quem cadastra salva primeiro e
 * reabre em Editar.
 *
 * AS ABAS GRAVAM NA HORA, e o botão "Salvar" NÃO as inclui: enviar uma foto é um
 * POST próprio, imediato, e não fica pendente esperando o formulário. Fechar
 * sem salvar NÃO desfaz uma foto enviada, e o texto da aba diz isso.
 *
 * @param {Array<Object>} [options.usuarios] - o cadastro, para o seletor
 * @param {Function} [options.onSaved]
 */
export function openCampoDialog({
  campo = null, situacoes = [], categorias = [], anos = [], usuarios = [],
  onSaved = null,
} = {}) {
  const isEdit = Boolean(campo);

  // O polígono em voo. Nasce com o que já estava gravado (edição) ou nulo
  // (cadastro), e só muda quando alguém confirma o desenho.
  let area = campo?.geometria || null;

  const nomeField = createTextField({
    label: 'Nome do campo',
    required: true,
    maxLength: 255,
    value: campo?.nome ?? '',
    helpText: 'Como ele é chamado: "Reambulação (EBGeo) Santiago 2026"',
  });

  const anoField = createSelectField({
    label: 'Ano do PIT',
    required: true,
    options: anos.map(a => ({
      value: a.ano,
      label: a.situacao === 'Vigente' ? `${a.ano} (vigente)` : String(a.ano),
    })),
    value: campo?.ano ?? (anos.find(a => a.situacao === 'Vigente')?.ano ?? null),
    helpText: 'Só os exercícios cadastrados em "PIT do ano" aparecem aqui',
  });

  const situacaoField = createSelectField({
    label: 'Situação',
    required: true,
    options: situacoes.map(s => ({ value: s.code, label: s.nome })),
    value: campo?.situacao_id ?? 1,
  });

  const inicioField = createDateField({
    label: 'Início',
    required: true,
    value: campo?.data_inicio ? String(campo.data_inicio).slice(0, 10) : '',
  });

  const fimField = createDateField({
    label: 'Término',
    required: true,
    value: campo?.data_fim ? String(campo.data_fim).slice(0, 10) : '',
  });

  const placasField = createTextField({
    label: 'Placas de viatura',
    maxLength: 255,
    value: campo?.placas_vtr ?? '',
  });

  const descricaoField = createTextareaField({
    label: 'Descrição',
    value: campo?.descricao ?? '',
  });

  // AS FINALIDADES SÃO CAIXAS DE MARCAÇÃO, e não um seletor de uma só: a soma
  // das categorias dos 54 campos do SAP dá 90, então a maioria tem mais de uma.
  const marcadas = new Set((campo?.categorias || []).map(c => Number(c.id)));
  const caixasCategoria = categorias.map(c => {
    const input = el('input', {
      type: 'checkbox',
      id: `campo-cat-${c.code}`,
      checked: marcadas.has(Number(c.code)),
    });
    return {
      code: c.code,
      input,
      element: el('label', { className: 'campo-form__categoria', htmlFor: `campo-cat-${c.code}` }, [
        input, el('span', { textContent: c.nome }),
      ]),
    };
  });
  const erroCategoria = el('div', { className: 'form-field__error hidden' });
  const categoriasBloco = el('div', { className: 'form-field' }, [
    el('label', { className: 'form-field__label', textContent: 'Finalidade do campo *' }),
    el('div', { className: 'campo-form__categorias' }, caixasCategoria.map(c => c.element)),
    erroCategoria,
  ]);

  // QUEM JÁ ESTÁ MARCADO APARECE MESMO SEM ESTAR NO CADASTRO ATIVO. Quem foi a
  // campo em 2019 e saiu da Divisão não pode sumir da linha de 2019.
  const jaMarcados = (campo?.militares || []).map(m => m.usuario_uuid);
  const doCadastro = new Set(usuarios.map(u => u.uuid));
  const paraOSeletor = [
    ...usuarios,
    ...(campo?.militares || [])
      .filter(m => !doCadastro.has(m.usuario_uuid))
      .map(m => ({
        uuid: m.usuario_uuid,
        nome: m.nome_guerra,
        nome_guerra: m.nome_guerra,
        posto_abrev: m.posto_abrev,
        ativo: false,
      })),
  ];
  const militaresField = createSeletorMilitares({
    label: 'Militares da Divisão',
    usuarios: paraOSeletor,
    selecionados: jaMarcados,
    helpText: 'Quem tem conta no SCA. Os demais vão no campo abaixo.',
  });

  const externosField = createTextareaField({
    label: 'Outros militares',
    value: campo?.militares_externos ?? '',
    helpText: 'Quem não tem conta no SCA: outra OM, motorista da guarnição, '
      + 'quem já saiu. Separe por vírgula.',
  });

  // --- A área ---------------------------------------------------------------

  const resumoArea = el('span', { className: 'campo-form__area-resumo' });
  const erroArea = el('div', { className: 'form-field__error hidden' });

  const descreverArea = () => {
    if (!area) {
      resumoArea.textContent = 'Nenhuma área definida';
      resumoArea.classList.add('campo-form__area-resumo--vazia');
      return;
    }
    resumoArea.classList.remove('campo-form__area-resumo--vazia');
    resumoArea.textContent = resumirGeometria(area);
  };
  descreverArea();

  // O `<input type=file>` FICA ESCONDIDO e o botão o aciona: o controle nativo
  // não aceita rótulo em português nem estilo, e o botão ao lado do resumo é o
  // que faz a área parecer um campo do formulário como os outros.
  const entradaArquivo = el('input', {
    type: 'file',
    accept: '.geojson,.json,application/geo+json,application/json',
    className: 'hidden',
    onChange: (evento) => {
      const arquivo = evento.target.files && evento.target.files[0];
      if (!arquivo) return;
      const leitor = new FileReader();
      leitor.onerror = () => {
        erroArea.textContent = 'Não foi possível ler o arquivo.';
        erroArea.classList.remove('hidden');
      };
      leitor.onload = () => {
        const resultado = lerGeojson(String(leitor.result));
        // O ARQUIVO RUIM NÃO APAGA A ÁREA QUE JÁ ESTAVA: `campo.geom` é NOT
        // NULL, e trocar uma área válida por nada num engano de arquivo seria
        // perder o que já estava gravado.
        if (resultado.erro) {
          erroArea.textContent = resultado.erro;
          erroArea.classList.remove('hidden');
          return;
        }
        area = resultado.geometria;
        erroArea.classList.add('hidden');
        descreverArea();
        botaoArea.textContent = 'Trocar o arquivo';
      };
      leitor.readAsText(arquivo);
      // Zera o valor para o MESMO arquivo poder ser escolhido de novo depois de
      // uma recusa: sem isto o `change` não dispara na segunda vez.
      evento.target.value = '';
    },
  });

  const botaoArea = el('button', {
    className: 'btn btn--secondary',
    type: 'button',
    onClick: () => entradaArquivo.click(),
  }, [area ? 'Trocar o arquivo' : 'Importar GeoJSON']);

  const areaBloco = el('div', { className: 'form-field form-grid__full' }, [
    el('label', { className: 'form-field__label', textContent: 'Área do campo *' }),
    el('div', { className: 'campo-form__area' }, [entradaArquivo, botaoArea, resumoArea]),
    el('small', {
      className: 'form-field__help',
      textContent: 'Um polígono só, em graus decimais (EPSG:4326 ou 4674). '
        + 'Aceita FeatureCollection, Feature ou a geometria crua.',
    }),
    erroArea,
  ]);

  const formulario = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [nomeField.element]),
    anoField.element,
    situacaoField.element,
    inicioField.element,
    fimField.element,
    placasField.element,
    el('div', { className: 'form-grid__full' }, [descricaoField.element]),
    el('div', { className: 'form-grid__full' }, [categoriasBloco]),
    areaBloco,
    el('div', { className: 'form-grid__full' }, [militaresField.element]),
    el('div', { className: 'form-grid__full' }, [externosField.element]),
  ]);

  // `mudouAnexo` é o que faz a LISTA por trás recarregar ao fechar: as contagens
  // de foto e de trajeto da tabela vêm do servidor, e enviar uma foto sem
  // salvar o formulário não dispararia `onSaved` sozinho.
  let mudouAnexo = false;
  const marcarAnexo = () => { mudouAnexo = true; };

  const anexos = [];
  const content = isEdit
    ? createTabs({
      tabs: [
        { id: 'dados', label: 'Dados do campo', render: (c) => { c.appendChild(formulario); } },
        {
          id: 'imagens',
          label: 'Fotos e vídeos',
          render: (c) => {
            c.appendChild(el('p', {
              className: 'campo-detalhe__vazio',
              textContent: 'O que você enviar ou remover aqui grava na hora, '
                + 'independente do botão Salvar.',
            }));
            const galeria = criarGaleriaCampo({
              campoId: campo.id, podeEditar: true, aoMudar: marcarAnexo,
            });
            c.appendChild(galeria.element);
            galeria.recarregar();
            anexos.push(galeria);
            return { cleanup: () => galeria.cleanup() };
          },
        },
        {
          id: 'tracks',
          label: 'Trajetos',
          render: (c) => {
            c.appendChild(el('p', {
              className: 'campo-detalhe__vazio',
              textContent: 'O que você importar ou remover aqui grava na hora, '
                + 'independente do botão Salvar.',
            }));
            const trajetos = criarTrajetosCampo({
              campoId: campo.id, podeEditar: true, aoMudar: marcarAnexo,
            });
            c.appendChild(trajetos.element);
            trajetos.recarregar();
            anexos.push(trajetos);
            return { cleanup: () => trajetos.cleanup() };
          },
        },
      ],
    })
    : { element: formulario, _cleanup: () => {} };

  let saving = false;

  openModal({
    title: isEdit ? `Editar campo: ${campo.nome}` : 'Novo campo',
    content: content.element,
    width: '720px',
    onClose: () => {
      content._cleanup();
      for (const a of anexos) a.cleanup();
      // A lista por trás recarrega mesmo se a pessoa fechar sem salvar: as
      // fotos e os trajetos já gravaram, e as contagens da tabela mentiriam.
      if (mudouAnexo && onSaved) onSaved();
    },
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Salvar',
        variant: 'primary',
        onClick: async ({ close, setOcupado }) => {
          if (saving) return;

          nomeField.setError(null);
          anoField.setError(null);
          situacaoField.setError(null);
          inicioField.setError(null);
          fimField.setError(null);
          erroCategoria.classList.add('hidden');
          erroArea.classList.add('hidden');

          const nome = nomeField.getValue();
          const ano = anoField.getValue();
          const situacao = situacaoField.getValue();
          const inicio = inicioField.getValue();
          const fim = fimField.getValue();
          const escolhidas = caixasCategoria.filter(c => c.input.checked).map(c => c.code);

          if (!nome) return nomeField.setError('Informe o nome do campo');
          if (ano === null) {
            return anoField.setError(
              'Escolha o ano. Se ele não está na lista, cadastre o exercício em "PIT do ano"'
            );
          }
          if (situacao === null) return situacaoField.setError('Escolha a situação');
          if (!inicio) return inicioField.setError('Informe a data de início');
          if (!fim) return fimField.setError('Informe a data de término');
          // O banco tem o mesmo CHECK (`campo_fim_apos_inicio`). Cobrar aqui
          // evita o 500 cru, que cita o nome da restrição e não o campo.
          if (fim < inicio) {
            return fimField.setError('O término não pode ser antes do início');
          }
          if (!escolhidas.length) {
            erroCategoria.textContent = 'Marque ao menos uma finalidade';
            erroCategoria.classList.remove('hidden');
            return;
          }
          if (!area) {
            erroArea.textContent = 'Importe o GeoJSON da área do campo. Ela é obrigatória.';
            erroArea.classList.remove('hidden');
            return;
          }

          const payload = {
            nome,
            descricao: descricaoField.getValue() || null,
            ano: Number(ano),
            situacao_id: Number(situacao),
            data_inicio: inicio,
            data_fim: fim,
            placas_vtr: placasField.getValue() || null,
            militares_externos: externosField.getValue() || null,
            categorias: escolhidas.map(Number),
            militares: militaresField.getValue(),
            // AS VERSÕES NÃO SE EDITAM AQUI. O vínculo com `acervo.versao` é
            // opcional e raro (3 campos de 54 no acervo do SAP), e escolher uma
            // folha exige a busca do acervo inteira dentro deste formulário. Na
            // edição as já ligadas são PRESERVADAS mandando-as de volta; num
            // campo novo a lista nasce vazia.
            versoes: (campo?.versoes || []).map(v => Number(v.versao_id)),
            geometria: JSON.stringify(area),
          };

          saving = true;
          setOcupado(true);
          try {
            if (isEdit) {
              await atualizarCampo(campo.id, payload);
              showSuccess('Campo atualizado com sucesso');
            } else {
              await criarCampo(payload);
              showSuccess('Campo criado com sucesso');
            }
            close();
            if (onSaved) onSaved();
          } catch (err) {
            showError(err.message || 'Erro ao salvar o campo');
          } finally {
            saving = false;
            setOcupado(false);
          }
        },
      },
    ],
  });
}
