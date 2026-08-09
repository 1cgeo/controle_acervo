import { el, clearChildren, svgIcon, ICONS } from '@utils/dom.js';
import { showSuccess, showError } from '@utils/toast.js';
import { confirmDialog } from '@components/modal/confirm-dialog.js';
import { openModal } from '@components/modal/modal-base.js';
import { createTextField, createDateField } from '@components/form-fields/form-fields.js';
import {
  listarTracksCampo, criarTrackCampo, excluirTrackCampo,
} from '@services/campo-service.js';
import './campo.css';

/**
 * Os trajetos de viatura de um campo, e a importação deles.
 *
 * UM COMPONENTE PARA OS DOIS LADOS, como a galeria: a FICHA o monta em leitura e
 * o formulário de EDIÇÃO o monta com importação e remoção.
 *
 * A MAIORIA DOS CAMPOS NÃO TEM TRAJETO -- 12 de 54 no acervo do SAP --, e a tela
 * precisa dizer isso em vez de sugerir que faltou importar.
 */

const dia = (valor) => (valor
  ? String(valor).slice(0, 10).split('-').reverse().join('/')
  : '-');

/**
 * Os pontos de um arquivo de trajeto.
 *
 * ACEITA GPX E GeoJSON, e os dois porque a origem varia: o GPS Garmin da
 * viatura exporta GPX, e quem já passou pelo QGIS tem GeoJSON. Converter fora
 * do sistema seria mais um passo manual entre o campo e o cadastro.
 *
 * O `time` DO GPX É O QUE ORDENA O TRAJETO, e é ele que vira `momento`. Sem ele
 * a linha ainda se desenha, mas a view `campo.track_linha` a costura pela ordem
 * de chegada, que é a ordem do arquivo -- aceitável, e não é o mesmo.
 *
 * @param {string} texto - o conteúdo do arquivo
 * @param {string} nome - o nome do arquivo, para escolher o formato
 * @returns {{pontos:Array}|{erro:string}}
 */
export function lerTrajeto(texto, nome = '') {
  const ehGpx = /\.gpx$/i.test(nome) || /<gpx[\s>]/i.test(texto);
  return ehGpx ? lerGpx(texto) : lerGeojsonDeLinha(texto);
}

function lerGpx(texto) {
  let doc;
  try {
    doc = new DOMParser().parseFromString(texto, 'application/xml');
  } catch {
    return { erro: 'Não foi possível ler o GPX.' };
  }
  // O `parsererror` é como o DOMParser reporta XML quebrado: ele NÃO lança.
  if (doc.querySelector('parsererror')) {
    return { erro: 'O GPX está malformado.' };
  }
  // `trkpt` é o ponto de trajeto; `rtept` e `wpt` são rota e ponto de interesse,
  // e não são o caminho percorrido.
  const nos = [...doc.getElementsByTagName('trkpt')];
  if (!nos.length) {
    return { erro: 'O GPX não tem nenhum ponto de trajeto (trkpt).' };
  }
  const pontos = [];
  for (const no of nos) {
    const lat = Number(no.getAttribute('lat'));
    const lon = Number(no.getAttribute('lon'));
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    const ele = no.getElementsByTagName('ele')[0];
    const time = no.getElementsByTagName('time')[0];
    pontos.push({
      longitude: lon,
      latitude: lat,
      elevacao: ele ? Number(ele.textContent) : null,
      momento: time ? time.textContent.trim() : null,
    });
  }
  return validarPontos(pontos);
}

function lerGeojsonDeLinha(texto) {
  let bruto;
  try {
    bruto = JSON.parse(texto);
  } catch {
    return { erro: 'O arquivo não é um GPX nem um JSON válido.' };
  }
  let geo = bruto;
  if (bruto && bruto.type === 'FeatureCollection') {
    const features = Array.isArray(bruto.features) ? bruto.features : [];
    if (features.length !== 1) {
      return {
        erro: `O arquivo tem ${features.length} feições, e o trajeto precisa de UMA.`,
      };
    }
    geo = features[0].geometry;
  } else if (bruto && bruto.type === 'Feature') {
    geo = bruto.geometry;
  }
  if (!geo || !Array.isArray(geo.coordinates)) {
    return { erro: 'O arquivo não tem geometria de linha.' };
  }

  let coords;
  if (geo.type === 'LineString') coords = geo.coordinates;
  else if (geo.type === 'MultiLineString') coords = geo.coordinates.flat();
  else return { erro: `A geometria é ${geo.type}, e o trajeto precisa de uma linha.` };

  return validarPontos(coords.map(c => ({
    longitude: c[0],
    latitude: c[1],
    // A terceira ordenada do GeoJSON é a altitude, quando existe.
    elevacao: Number.isFinite(c[2]) ? c[2] : null,
    momento: null,
  })));
}

function validarPontos(pontos) {
  if (pontos.length < 2) {
    return { erro: 'O trajeto precisa de ao menos dois pontos.' };
  }
  // O TETO ESPELHA O DO Joi (`campo_schema.track`), e a mensagem daqui evita
  // que a pessoa espere a subida de um arquivo que o servidor vai recusar.
  if (pontos.length > 50000) {
    return {
      erro: `O arquivo tem ${pontos.length} pontos, e o teto é 50.000. `
        + 'Provavelmente é o GPX de um mês inteiro, e não o de um dia.',
    };
  }
  const fora = pontos.find(p => !(p.longitude >= -180 && p.longitude <= 180
    && p.latitude >= -90 && p.latitude <= 90));
  if (fora) {
    return {
      erro: 'O trajeto tem coordenada inválida. O arquivo precisa estar em graus '
        + 'decimais (EPSG:4326), e não em metros.',
    };
  }
  return { pontos };
}

/** O diálogo de importação: o arquivo mais quem estava na viatura. */
function abrirImportacao({ campoId, aoImportar }) {
  let pontos = null;

  const resumo = el('span', { className: 'campo-form__area-resumo campo-form__area-resumo--vazia' }, [
    'Nenhum arquivo escolhido',
  ]);
  const erroArquivo = el('div', { className: 'form-field__error hidden' });

  const entrada = el('input', {
    type: 'file',
    accept: '.gpx,.geojson,.json',
    className: 'hidden',
    onChange: (evento) => {
      const arquivo = evento.target.files && evento.target.files[0];
      if (!arquivo) return;
      const leitor = new FileReader();
      leitor.onerror = () => {
        erroArquivo.textContent = 'Não foi possível ler o arquivo.';
        erroArquivo.classList.remove('hidden');
      };
      leitor.onload = () => {
        const resultado = lerTrajeto(String(leitor.result), arquivo.name);
        if (resultado.erro) {
          erroArquivo.textContent = resultado.erro;
          erroArquivo.classList.remove('hidden');
          return;
        }
        pontos = resultado.pontos;
        erroArquivo.classList.add('hidden');
        const comHora = pontos.filter(p => p.momento).length;
        resumo.classList.remove('campo-form__area-resumo--vazia');
        resumo.textContent = `${pontos.length} pontos`
          + (comHora ? `, ${comHora} com hora` : ', sem hora (a ordem é a do arquivo)');
      };
      leitor.readAsText(arquivo);
      evento.target.value = '';
    },
  });

  const chefeField = createTextField({ label: 'Chefe da viatura', required: true, maxLength: 255 });
  const motoristaField = createTextField({ label: 'Motorista', required: true, maxLength: 255 });
  const placaField = createTextField({ label: 'Placa da viatura', required: true, maxLength: 255 });
  const diaField = createDateField({ label: 'Dia', required: true });

  const content = el('div', { className: 'form-grid' }, [
    el('div', { className: 'form-grid__full' }, [
      el('label', { className: 'form-field__label', textContent: 'Arquivo do trajeto *' }),
      el('div', { className: 'campo-form__area' }, [
        entrada,
        el('button', {
          className: 'btn btn--secondary',
          type: 'button',
          onClick: () => entrada.click(),
        }, ['Escolher GPX ou GeoJSON']),
        resumo,
      ]),
      el('small', {
        className: 'form-field__help',
        textContent: 'GPX do GPS da viatura, ou GeoJSON com uma linha. '
          + 'Em graus decimais (EPSG:4326).',
      }),
      erroArquivo,
    ]),
    diaField.element,
    placaField.element,
    chefeField.element,
    motoristaField.element,
  ]);

  let salvando = false;

  openModal({
    title: 'Importar trajeto',
    content,
    width: '620px',
    actions: [
      { label: 'Cancelar', variant: 'text', onClick: ({ close }) => close() },
      {
        label: 'Importar',
        variant: 'primary',
        onClick: async ({ close, setOcupado }) => {
          if (salvando) return;
          chefeField.setError(null);
          motoristaField.setError(null);
          placaField.setError(null);
          diaField.setError(null);

          if (!pontos) {
            erroArquivo.textContent = 'Escolha o arquivo do trajeto.';
            erroArquivo.classList.remove('hidden');
            return;
          }
          if (!diaField.getValue()) return diaField.setError('Informe o dia');
          if (!placaField.getValue()) return placaField.setError('Informe a placa');
          if (!chefeField.getValue()) return chefeField.setError('Informe o chefe da viatura');
          if (!motoristaField.getValue()) return motoristaField.setError('Informe o motorista');

          salvando = true;
          setOcupado(true);
          try {
            await criarTrackCampo(campoId, {
              chefe_vtr: chefeField.getValue(),
              motorista: motoristaField.getValue(),
              placa_vtr: placaField.getValue(),
              dia: diaField.getValue(),
              pontos,
            });
            showSuccess(`Trajeto importado com ${pontos.length} pontos`);
            close();
            if (aoImportar) aoImportar();
          } catch (err) {
            showError(err.message || 'Erro ao importar o trajeto');
          } finally {
            salvando = false;
            setOcupado(false);
          }
        },
      },
    ],
  });
}

/**
 * A lista de trajetos de um campo.
 *
 * @param {Object} opts
 * @param {number} opts.campoId
 * @param {boolean} [opts.podeEditar] - mostra importar e remover
 * @param {Function} [opts.aoMudar]
 * @returns {{element:HTMLElement, recarregar:Function}}
 */
export function criarTrajetosCampo({ campoId, podeEditar = false, aoMudar = null }) {
  let disposed = false;

  const lista = el('div', { className: 'campo-tracks' });
  const acoes = el('div', { className: 'campo-detalhe__acoes' });
  const element = el('div', {}, [acoes, lista]);

  if (podeEditar) {
    acoes.appendChild(el('button', {
      className: 'btn btn--secondary btn--sm',
      type: 'button',
      onClick: () => abrirImportacao({
        campoId,
        aoImportar: () => { if (aoMudar) aoMudar(); recarregar(); },
      }),
    }, [svgIcon(ICONS.add, 16), 'Importar trajeto']));
  }

  async function recarregar() {
    clearChildren(lista);
    lista.appendChild(el('p', {
      className: 'campo-detalhe__carregando', textContent: 'Carregando...',
    }));
    let tracks = [];
    try {
      tracks = await listarTracksCampo(campoId);
    } catch (err) {
      if (disposed) return;
      clearChildren(lista);
      lista.appendChild(el('p', {
        className: 'campo-detalhe__erro',
        textContent: err.message || 'Não foi possível carregar os trajetos.',
      }));
      return;
    }
    if (disposed) return;
    clearChildren(lista);
    if (!tracks.length) {
      lista.appendChild(el('p', {
        className: 'campo-detalhe__vazio',
        textContent: podeEditar
          ? 'Nenhum trajeto. A maioria dos campos não tem; use o botão acima se houver GPX.'
          : 'Nenhum trajeto importado. A maioria dos campos não tem.',
      }));
      return;
    }
    for (const t of tracks) {
      const linha = el('div', { className: 'campo-tracks__item' }, [
        el('div', {}, [
          el('strong', { textContent: `${t.placa_vtr} · ${dia(t.dia)}` }),
          el('br'),
          el('small', {
            textContent: `${t.chefe_vtr} / ${t.motorista} · `
              + (t.pontos ? `${t.pontos} pontos` : 'sem linha (menos de 2 pontos)'),
          }),
        ]),
      ]);
      if (podeEditar) {
        linha.appendChild(el('button', {
          className: 'btn btn--text btn--sm',
          type: 'button',
          onClick: async () => {
            const ok = await confirmDialog({
              title: 'Remover trajeto',
              message: `Remover o trajeto da ${t.placa_vtr} de ${dia(t.dia)}? Os pontos vão junto.`,
              confirmLabel: 'Remover',
              danger: true,
            });
            if (!ok) return;
            try {
              await excluirTrackCampo(t.id);
              showSuccess('Trajeto removido');
              if (aoMudar) aoMudar();
              await recarregar();
            } catch (err) {
              showError(err.message || 'Erro ao remover o trajeto');
            }
          },
        }, ['Remover']));
      }
      lista.appendChild(linha);
    }
  }

  return {
    element,
    recarregar,
    cleanup: () => { disposed = true; },
  };
}
