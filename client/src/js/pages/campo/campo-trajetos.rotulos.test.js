import { describe, test, expect, vi, beforeEach, afterEach } from 'vitest';
import { flush } from '@/__tests__/helpers/flush.js';

// O QUE A TELA DE TRAJETOS DIZ, e o que ela prometia sem cumprir.
//
// (a) O SINGULAR. O track de um ponto so vinha com `pontos = 0` e caia na frase
//     de "sem linha (menos de 2 pontos)". Desde que `pontos` passou a contar o
//     que a tabela tem, ele vem com 1 e a lista escrevia "1 pontos".
//
// (b) O RESUMO DA IMPORTACAO. Ate 2026-09-05 a view `campo.track_linha`
//     filtrava `WHERE p.momento IS NOT NULL`, o track todo sem hora nao produzia
//     linha nenhuma, e a promessa "a ordem e a do arquivo" era falsa. A 3.14.0
//     (migracao `2026-09-05_o_trajeto_sem_hora_tambem_se_desenha.sql`) costura
//     por `momento NULLS LAST, id`, entao a promessa passou a ser verdadeira e
//     a tela volta a faze-la, com a palavra "mapa" para nao deixar duvida.

vi.mock('@services/campo-service.js', () => ({
  listarTracksCampo: vi.fn(() => Promise.resolve([])),
  criarTrackCampo: vi.fn(() => Promise.resolve({ id: 1 })),
  excluirTrackCampo: vi.fn(),
}));

vi.mock('@utils/toast.js', () => ({
  showSuccess: vi.fn(),
  showError: vi.fn(),
}));

import { criarTrajetosCampo } from '@pages/campo/campo-trajetos.js';
import { listarTracksCampo } from '@services/campo-service.js';

const TRACK = (extra = {}) => ({
  id: 1,
  placa_vtr: 'EB-1234',
  dia: '2026-07-28',
  chefe_vtr: 'Cap Fulano',
  motorista: 'Sd Beltrano',
  pontos: 6500,
  geometria: { type: 'LineString', coordinates: [[-53, -29], [-53.1, -29.1]] },
  ...extra,
});

async function montar() {
  const trajetos = criarTrajetosCampo({ campoId: 46, podeEditar: true });
  document.body.appendChild(trajetos.element);
  await trajetos.recarregar();
  await flush();
  return trajetos;
}

const itens = () => [...document.querySelectorAll('.campo-tracks__item')];

beforeEach(() => {
  document.body.innerHTML = '';
  vi.clearAllMocks();
  listarTracksCampo.mockResolvedValue([]);
});

afterEach(() => {
  document.body.innerHTML = '';
});

describe('a contagem de pontos na lista', () => {
  test('um ponto lê-se "1 ponto"', async () => {
    listarTracksCampo.mockResolvedValueOnce([
      TRACK({ pontos: 1, geometria: null }),
    ]);

    await montar();

    expect(itens()[0].textContent).toContain('1 ponto');
    expect(itens()[0].textContent).not.toContain('1 pontos');
  });

  // VARIANCIA: sem estes dois, trocar "pontos" por "ponto" em toda parte
  // passaria igual.
  test('dois ou mais continuam no plural, e zero continua sem linha', async () => {
    listarTracksCampo.mockResolvedValueOnce([
      TRACK({ id: 1, pontos: 6500 }),
      TRACK({ id: 2, pontos: 0, geometria: null }),
    ]);

    await montar();

    expect(itens()[0].textContent).toContain('6500 pontos');
    expect(itens()[1].textContent).toContain('sem linha (menos de 2 pontos)');
  });
});

describe('o resumo do arquivo escolhido para importar', () => {
  /** Escolhe o arquivo na entrada do diálogo, como o navegador faz. */
  async function escolher(texto, nome) {
    [...document.querySelectorAll('button')]
      .find(b => b.textContent.includes('Importar trajeto'))
      .click();
    await flush();

    const entrada = document.querySelector('.modal input[type="file"]');
    const arquivo = new File([texto], nome, { type: 'application/json' });
    Object.defineProperty(entrada, 'files', {
      configurable: true,
      value: Object.assign([arquivo], { item: (i) => [arquivo][i] }),
    });
    entrada.dispatchEvent(new Event('change'));
    for (let i = 0; i < 8; i += 1) await flush();
    return document.querySelector('.campo-form__area-resumo');
  }

  const semHora = JSON.stringify({
    type: 'LineString',
    coordinates: [[-53.1, -29.1], [-53.2, -29.2], [-53.3, -29.3]],
  });

  // COM HORA e GPX, e nao GeoJSON: o GeoJSON nao carrega momento nenhum
  // (`lerTrajeto` poe `momento: null` em todo ponto dele), e e exatamente por
  // isso que o aviso acima existe.
  const comHora = `<?xml version="1.0"?>
<gpx version="1.1" creator="Garmin">
  <trk><trkseg>
    <trkpt lat="-29.10" lon="-53.10"><time>2026-07-28T13:00:00Z</time></trkpt>
    <trkpt lat="-29.20" lon="-53.20"><time>2026-07-28T13:10:00Z</time></trkpt>
  </trkseg></trk>
</gpx>`;

  test('o arquivo SEM hora diz que a ordem no mapa é a do arquivo', async () => {
    await montar();

    const resumo = await escolher(semHora, 'trajeto.geojson');

    expect(resumo.textContent).toContain('3 pontos');
    expect(resumo.textContent).toContain('sem hora: a ordem no mapa é a do arquivo');
    // A frase de 2026-09-05 ("NÃO será desenhado") valia para a view antiga.
    expect(resumo.textContent).not.toMatch(/não será desenhado/i);
  });

  test('o arquivo COM hora não leva o aviso', async () => {
    await montar();

    const resumo = await escolher(comHora, 'dia1.gpx');

    expect(resumo.textContent).toContain('2 pontos');
    expect(resumo.textContent).toContain('2 com hora');
    expect(resumo.textContent).not.toContain('sem hora');
  });
});
