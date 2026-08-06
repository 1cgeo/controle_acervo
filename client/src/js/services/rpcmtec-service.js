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

/**
 * Congela a edicao. RECUSA com subsecao digitada por preencher.
 *
 * AVISA, com 409, quando ha subsecao sem conferencia (nunca marcada, ou marcada
 * antes de o conteudo mudar). O aviso mora no SERVIDOR: posto so aqui, o CLI
 * fecharia calado e a marca viraria enfeite de uma tela so. Passe
 * `cienteRevisao` depois de a pessoa ler a lista e confirmar.
 */
export const fecharEdicao = (id, cienteRevisao = false) =>
  apiPost(`/rpcmtec/${id}/fechar`, { ciente_revisao: cienteRevisao });

/**
 * Marca ou desmarca uma subsecao como CONFERIDA.
 *
 * Vale para as tres origens, e nao so para a digitada: a calculada nasce
 * preenchida e continua precisando de olho humano, porque o numero pode estar
 * certo e o cadastro que o alimenta, errado.
 *
 * O servidor guarda junto uma impressao digital do conteudo conferido. Se ele
 * mudar depois, a marca volta como `desatualizada`.
 */
export const revisarSubsecao = (id, numero, revisado) =>
  apiPut(`/rpcmtec/${id}/subsecao/${numero}/revisao`, { revisado });

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

/**
 * Importa o CSV do github_dashboard para a subsecao 5.1.
 *
 * QUEM LE O CSV E O SERVIDOR, e nao esta funcao. Aqui so passa o texto: o
 * arquivo escolhido, lido como string, ou o que a pessoa colou. Ler o CSV decide
 * o que se APAGA (casar por repositorio e preservar o Resumo escrito a mao), e
 * essa regra posta no cliente nao valeria para o `producao_cli`.
 *
 * O RESUMO NAO VAI NO CORPO. Ele e a unica coluna da 5.1 escrita por pessoa, e
 * quem o preserva e o servidor, cruzando com o que ja esta gravado.
 *
 * `confirmarRemocao` e o "eu li a lista". Sem ele o servidor responde 409
 * quando a importacao removeria um repositorio que ja tem Resumo escrito.
 *
 * @param {number} id - a edicao mensal
 * @param {string} csv - o conteudo do arquivo, cru
 * @param {boolean} [confirmarRemocao]
 */
export const importarRepositorios51 = (id, csv, confirmarRemocao = false) =>
  apiPost(`/rpcmtec/${id}/subsecao/5.1/importar`, {
    csv,
    confirmar_remocao: confirmarRemocao,
  });

// ESTE SERVICO NAO TRAZ CONTEUDO DO MES PASSADO, desde 2026-08-06. Havia aqui
// uma chamada que copiava as subsecoes digitadas da edicao anterior. Ela saiu
// junto com a rota do servidor, que hoje responde 404.
//
// A RAZAO: o RPCMTec e o relatorio DAQUELE mes. A linha que chega pronta nao e
// relida, e o documento assinado passava a afirmar sobre agosto o que houve em
// julho. Cada subsecao se preenche pelo mes que ela reporta.

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
