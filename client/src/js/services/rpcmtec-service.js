import {
  apiGet, apiPost, apiPut, apiDelete, apiUpload, apiDownload,
} from '@services/api-client.js';

/**
 * Servico do RPCMTec, o relatorio mensal da Divisao.
 *
 * Fica em `services/`, e nao em `modules/<algum>/services/`, porque a tela e de
 * PLATAFORMA: o relatorio cruza acervo, mapoteca e orcamento numa peca so.
 *
 * A unidade de trabalho e a EDICAO do mes, e nao o par ano/mes solto. O sistema
 * emite o PDF final, e o assinado volta como anexo. Nao ha DOCX.
 */

// --- A edicao mensal --------------------------------------------------------

export const listarEdicoes = (ano) =>
  apiGet(`/rpcmtec${ano ? `?ano=${ano}` : ''}`);

export const getAnosEdicao = () => apiGet('/rpcmtec/anos');

export const criarEdicao = (body) => apiPost('/rpcmtec', body);

export const atualizarEdicao = (id, body) => apiPut(`/rpcmtec/${id}`, body);

export const excluirEdicao = (id) => apiDelete(`/rpcmtec/${id}`);

/**
 * O DOCUMENTO inteiro: os 34 blocos, com o calculado do banco (edicao aberta)
 * ou o congelado (edicao fechada).
 *
 * A tela NAO formata nada por conta: a celula chega em texto, e e a mesma que
 * vai para o PDF. Com a tela lendo numero cru e o arquivo formatando por conta,
 * as duas divergiam no arredondamento e quem conferia via diferenca onde nao
 * havia.
 */
export const getDocumento = (id) => apiGet(`/rpcmtec/${id}/documento`);

/** Congela a edicao. Recusa com subsecao digitada por preencher. */
export const fecharEdicao = (id) => apiPost(`/rpcmtec/${id}/fechar`);

/** Descongela. Preserva o digitado; o calculado volta a sair do banco. */
export const reabrirEdicao = (id) => apiPost(`/rpcmtec/${id}/reabrir`);

/** O que o banco diria HOJE, ao lado do congelado. So em edicao fechada. */
export const conferirHoje = (id) => apiGet(`/rpcmtec/${id}/conferir`);

/**
 * Baixa o PDF da edicao.
 *
 * Edicao aberta sai com a marca RASCUNHO em toda pagina: um PDF de edicao
 * aberta pode ser assinado, e ai o documento assinado afirma numeros que ainda
 * vao mudar.
 */
export function downloadRpcmtecPdf(id, ano, mes) {
  const nome = `RPCMTec-${ano}-${String(mes).padStart(2, '0')}.pdf`;
  return apiDownload(`/rpcmtec/${id}/pdf`, nome);
}

// --- Subsecoes digitadas ----------------------------------------------------

export const gravarSubsecao = (id, numero, body) =>
  apiPut(`/rpcmtec/${id}/subsecao/${numero}`, body);

/**
 * Apaga o conteudo digitado. A subsecao volta a NAO EXISTIR, que nao e o mesmo
 * que ficar vazia: o fechamento a cobra de novo.
 */
export const limparSubsecao = (id, numero) =>
  apiDelete(`/rpcmtec/${id}/subsecao/${numero}`);

/** Sem `numero`, copia todas as digitadas que o mes anterior tinha. */
export const copiarMesAnterior = (id, numero = null) =>
  apiPost(`/rpcmtec/${id}/copiar-mes-anterior`, numero ? { numero } : {});

// --- Anexo: o RPCMTec assinado ----------------------------------------------

export const listarAnexos = (id) => apiGet(`/rpcmtec/${id}/anexos`);

export const enviarAnexo = (id, formData) =>
  apiUpload(`/rpcmtec/${id}/anexos`, formData);

export const excluirAnexo = (anexoId) =>
  apiDelete(`/rpcmtec/anexo/${anexoId}`);

export const downloadAnexo = (anexoId, nome) =>
  apiDownload(`/rpcmtec/anexo/${anexoId}/download`, nome);

// --- Anuario e RTM ----------------------------------------------------------

/**
 * Baixa o .ods do Anuario. O arquivo sai da planilha-semente da DSG com os
 * valores trocados, entao ele JA e o arquivo que sobe, sem reformatacao.
 *
 * O nome vem do servidor (Content-Disposition); o daqui e so a queda para o
 * caso de o cabecalho nao chegar.
 *
 * @param {{ano:number, mes:number}} params
 * @returns {Promise<void>}
 */
export function downloadAnuarioOds({ ano, mes }) {
  const nome = `Anuario_Estatistico_1CGEO_${String(mes).padStart(2, '0')}_${ano}.ods`;
  return apiDownload(`/rpcmtec/anuario/ods?ano=${ano}&mes=${mes}`, nome);
}

/**
 * Baixa a aba META4_DETALHADA do RTM, ACUMULADA de janeiro ate o mes.
 *
 * Ela e o detalhamento da Meta 4 do PIT. O arquivo sai da planilha-semente da
 * propria aba, entao ja abre com a largura de coluna, o painel congelado e os
 * estilos de sempre.
 *
 * @param {{ano:number, mes:number}} params
 * @returns {Promise<void>}
 */
export function downloadRtmOds({ ano, mes }) {
  // O nome leva o mes porque o CONTEUDO depende dele: o RTM e acumulado ate o
  // mes escolhido. Dois arquivos do mesmo ano com o mesmo nome e conteudo
  // diferente e o jeito certo de mandar o errado para a DSG.
  const nome = `META4_DETALHADA_${ano}_ate_${String(mes).padStart(2, '0')}.ods`;
  return apiDownload(`/rpcmtec/rtm/ods?ano=${ano}&mes=${mes}`, nome);
}
