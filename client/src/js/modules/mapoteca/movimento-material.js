// O LIVRO DE MOVIMENTOS DO MATERIAL: os codigos de dominio que a tela escreve.
//
// POR QUE OS CODIGOS MORAM AQUI, e nao vem de uma rota de dominio como o tipo de
// cliente e a forma de entrega: `mapoteca.tipo_movimento_material` NAO tem
// `GET /mapoteca/dominio/...` no servidor. Sem este arquivo, cada dialogo
// escreveria `3` no lugar de CONSUMO na mao, que foi exatamente como a antiga
// categoria de material acabou digitada em dois lugares diferentes, com uma
// terceira copia no teste.
//
// A FONTE E `server/src/utils/domain_constants.js`. Mudar um codigo la sem mudar
// aqui nao quebra o boot nem o teste do servidor: quebra a tela, calada. Por isso
// os quatro tipos e as quatro localizacoes ficam juntos, num arquivo so.

// O CODE 4 NAO ESTA AQUI, e continua no banco. Ele foi a Contagem, extinta em
// 2026-08-08: a linha do dominio sobrevive so para a auditoria antiga se
// traduzir, e nenhuma tela a lanca. O servidor a recusa no Joi, entao um botao
// que a escrevesse so produziria 400.
/** mapoteca.tipo_movimento_material */
export const TIPO_MOVIMENTO = {
  ENTRADA: 1,
  TRANSFERENCIA: 2,
  CONSUMO: 3,
};

/** mapoteca.tipo_localizacao */
export const TIPO_LOCALIZACAO = {
  SECAO: 1,
  ALMOXARIFADO: 2,
  AQUISICAO_REALIZADA: 3,
  SALDO_NO_EMPENHO: 4,
};

// SEM `LOCALIZACOES_NA_CASA` e sem um mapa de nome de MOVIMENTO, e os dois por
// motivos parecidos: o SERVIDOR ja responde os dois.
//
// O disponivel (Seção + Almoxarifado) chega pronto em `estoque_disponivel` e em
// `abaixo_minimo`, e o nome do tipo de movimento chega em `tipo_movimento_nome`,
// da tabela de dominio. Repetir a conta ou a traducao aqui criaria uma segunda
// fonte para divergir da primeira, e ela divergiria calada.
//
// O que NAO chega pronto, e por isso mora aqui, e o CODIGO que a tela precisa
// para ESCREVER: a regra "consumo so sai da Seção" compara contra o 1.

/** Rotulo de cada localizacao, para os cartoes e os selects. */
export const NOME_LOCALIZACAO = {
  [TIPO_LOCALIZACAO.SECAO]: 'Seção',
  [TIPO_LOCALIZACAO.ALMOXARIFADO]: 'Almoxarifado',
  [TIPO_LOCALIZACAO.AQUISICAO_REALIZADA]: 'Aquisição realizada',
  [TIPO_LOCALIZACAO.SALDO_NO_EMPENHO]: 'Saldo no empenho',
};

/** Opcoes de localizacao para um `createSelectField`, na ordem do dominio. */
export function opcoesLocalizacao() {
  return Object.values(TIPO_LOCALIZACAO).map(code => ({
    value: code,
    label: NOME_LOCALIZACAO[code],
  }));
}

/**
 * O saldo de um material POR LOCALIZACAO, a partir das linhas de
 * `GET /mapoteca/estoque_material`.
 *
 * A lista de insumos precisa das colunas Secao e Almoxarifado, e
 * `GET /tipo_material` devolve so os DOIS TOTAIS (`estoque_total` e
 * `estoque_disponivel`), sem abrir por localizacao. Quem abre e a leitura do
 * estoque, que sobreviveu justamente porque e leitura.
 *
 * @param {Array<{tipo_material_id:number, localizacao_id:number, quantidade:number|string}>} linhas
 * @returns {Map<number, Map<number, number>>} material -> localizacao -> saldo
 */
export function saldoPorLocalizacao(linhas) {
  const mapa = new Map();
  for (const linha of linhas || []) {
    const material = Number(linha.tipo_material_id);
    const local = Number(linha.localizacao_id);
    if (!mapa.has(material)) mapa.set(material, new Map());
    const doMaterial = mapa.get(material);
    doMaterial.set(local, (doMaterial.get(local) || 0) + Number(linha.quantidade || 0));
  }
  return mapa;
}
