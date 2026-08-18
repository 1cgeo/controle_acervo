import {
  apiGet, apiPost, apiPut, apiDelete,
} from '@services/api-client.js';
import { getToken } from '@store/auth-store.js';
import { PREFIXO_API } from '@utils/base-path.js';

/**
 * Serviço de CAMPO: a atividade que a Divisão executa fora dela.
 *
 * Fica em `services/`, e não em `modules/<algum>/services/`, porque a tela é de
 * PLATAFORMA: ela mora na seção PIT, ao lado do plano do ano e da execução dele,
 * e `dominio.modulo` não tem linha para campo. A autorização cobra `pit`,
 * o módulo que já existia.
 */

// --- Domínio e listagem -----------------------------------------------------

/** Situações, categorias e os anos do PIT, numa ida só. */
export const getDominioCampo = () => apiGet('/campo/dominio');

const comFiltros = (base, filtros = {}) => {
  const params = new URLSearchParams();
  if (filtros.ano) params.set('ano', filtros.ano);
  if (filtros.situacao_id) params.set('situacao_id', filtros.situacao_id);
  if (filtros.categoria_id) params.set('categoria_id', filtros.categoria_id);
  if (filtros.busca) params.set('busca', filtros.busca);
  const query = params.toString();
  return query ? `${base}?${query}` : base;
};

export const listarCampos = (filtros) => apiGet(comFiltros('/campo', filtros));

/**
 * Os mesmos campos, em FeatureCollection.
 *
 * DUAS ROTAS PARA O MESMO RECORTE, e não uma que devolve tudo: a lista tabular
 * não desenha nada, e trazer um MULTIPOLYGON por linha para montar uma tabela de
 * nomes seria pagar geometria à toa. Os filtros são os mesmos nas duas de
 * propósito -- um filtro que valesse só numa faria a tabela e o mapa
 * discordarem sobre quantos campos existem.
 */
export const getCamposGeojson = (filtros) => apiGet(comFiltros('/campo/geojson', filtros));

export const getCampo = (id) => apiGet(`/campo/${id}`);

// --- Escrita do campo -------------------------------------------------------

export const criarCampo = (body) => apiPost('/campo', body);
export const atualizarCampo = (id, body) => apiPut(`/campo/${id}`, body);
export const excluirCampo = (id) => apiDelete(`/campo/${id}`);

// --- Imagem -----------------------------------------------------------------

export const listarImagensCampo = (id) => apiGet(`/campo/${id}/imagem`);
export const enviarImagemCampo = (id, body) => apiPost(`/campo/${id}/imagem`, body);
export const atualizarImagemCampo = (imagemId, body) => apiPut(`/campo/imagem/${imagemId}`, body);
export const excluirImagemCampo = (imagemId) => apiDelete(`/campo/imagem/${imagemId}`);

/**
 * Os BYTES de uma imagem, como URL de blob para `<img src>` ou `<video src>`.
 *
 * NÃO é `/api/campo/imagem/:id/arquivo` posto direto no `src`, e a razão é
 * dura: `<img>` e `<video>` NÃO mandam o cabeçalho `Authorization`, e o
 * `verifyPerfil` do SCA lê o token SÓ de `req.headers.authorization` -- não há
 * fallback por query como no SAP. A tag sozinha levaria 401 em toda imagem.
 *
 * Então quem busca é o `fetch`, com o cabeçalho, e o que vai para o `src` é um
 * blob local.
 *
 * NÃO passa pelo `apiGet` porque o corpo é binário e aquele espera o envelope
 * JSON do `sendJsonAndLog`; nem pelo `apiDownload`, que dispara um "salvar
 * como" -- aqui a foto tem de aparecer NA TELA.
 *
 * QUEM CHAMA TEM DE REVOGAR (`URL.revokeObjectURL`) ao trocar de campo ou sair
 * da tela. São até 37 MB por vídeo: sem revogar, a memória do navegador cresce
 * a cada ficha aberta e só volta ao recarregar a página.
 *
 * @param {number} imagemId
 * @returns {Promise<string>} URL de blob, viva até ser revogada
 */
export const urlDaImagemCampo = async (imagemId) => {
  const token = getToken();
  const resposta = await fetch(`${PREFIXO_API}/campo/imagem/${imagemId}/arquivo`, {
    headers: token ? { Authorization: `Bearer ${token}` } : {},
  });
  if (!resposta.ok) {
    throw new Error(`Não foi possível carregar o arquivo (HTTP ${resposta.status})`);
  }
  return URL.createObjectURL(await resposta.blob());
};

// --- Track ------------------------------------------------------------------

export const listarTracksCampo = (id) => apiGet(`/campo/${id}/track`);
export const criarTrackCampo = (id, body) => apiPost(`/campo/${id}/track`, body);
export const atualizarTrackCampo = (trackId, body) => apiPut(`/campo/track/${trackId}`, body);
export const excluirTrackCampo = (trackId) => apiDelete(`/campo/track/${trackId}`);
