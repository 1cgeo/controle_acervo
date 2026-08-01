import { apiGet, apiDownload } from '@services/api-client.js';

/**
 * Servico do RPCMTec, o relatorio mensal da Divisao.
 *
 * Fica em `services/`, e nao em `modules/<algum>/services/`, porque a tela e de
 * PLATAFORMA: o relatorio cruza acervo, mapoteca e orcamento numa peca so. Ate
 * 2026-08-01 as chamadas viviam partidas entre `mapoteca-service` (a secao do
 * acervo) e `orcamento-service` (a do PDR), servindo duas telas que geravam dois
 * arquivos que alguem colava a mao.
 */

/**
 * As secoes do RPCMTec do mes, ja com as celulas em texto. Sao as MESMAS que vao
 * para o DOCX: a tela nao formata nada por conta propria, senao ela e o arquivo
 * divergem no arredondamento e quem confere ve diferenca onde nao ha.
 *
 * @param {{ano:number, mes:number}} params
 * @returns {Promise<{ano:number, mes:number, secoes:Array}>}
 */
export function getRpcmtec({ ano, mes }) {
  return apiGet(`/rpcmtec/gerar?ano=${ano}&mes=${mes}`);
}

/**
 * Baixa o DOCX do mes, no formato do RPCMTec da Divisao.
 *
 * @param {{ano:number, mes:number}} params
 * @returns {Promise<void>}
 */
export function downloadRpcmtecDocx({ ano, mes }) {
  const nome = `RPCMTec-${ano}-${String(mes).padStart(2, '0')}.docx`;
  return apiDownload(`/rpcmtec/gerar/docx?ano=${ano}&mes=${mes}`, nome);
}

/**
 * O Anuario Estatistico (Tabela 5.4.9) do mes, para a previa em tela.
 *
 * Chamada A PARTE da do RPCMTec, de proposito: e outro relatorio, com outra
 * rota, e uma falha nele nao pode apagar as tabelas do RPCMTec da tela.
 *
 * @param {{ano:number, mes:number}} params
 * @returns {Promise<Object>}
 */
export function getAnuario({ ano, mes }) {
  return apiGet(`/rpcmtec/anuario?ano=${ano}&mes=${mes}`);
}

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
 * Baixa a aba META4_DETALHADA do RTM, do ANO inteiro.
 *
 * Ela e o detalhamento da Meta 4 do PIT, e quem a cola no RTM cola o ano
 * corrente: o mes vai na query so porque a rota o exige, e e ignorado.
 *
 * O arquivo sai da planilha-semente da propria aba, entao ja abre com a largura
 * de coluna, o painel congelado e os estilos de sempre.
 *
 * @param {{ano:number, mes:number}} params
 * @returns {Promise<void>}
 */
export function downloadRtmOds({ ano, mes }) {
  return apiDownload(`/rpcmtec/rtm/ods?ano=${ano}&mes=${mes}`, `META4_DETALHADA_${ano}.ods`);
}
