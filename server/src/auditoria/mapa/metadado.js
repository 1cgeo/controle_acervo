'use strict'

/**
 * Mapa de auditoria do schema METADADO, que atravessou do SAP 2.3.5 na 3.0.0.
 *
 * O contrato de uma entrada esta em `../index.js`.
 *
 * O MODULO E `producao`, E O ARQUIVO E OUTRO. Metadado nao e um modulo: nao ha
 * `dominio.modulo` para ele, nao ha perfil proprio a conceder, e quem preenche a
 * ficha ET-PCDG e quem responde pela producao -- as rotas moram em
 * `/api/metadados` e cobram `verifyPerfil(nivel, 'producao')`. O arquivo e
 * separado do `producao.js` pelo motivo que o `index.js` declara: sao 45 tabelas
 * somadas, e dois agentes mexendo em schemas diferentes colidiriam na mesma
 * linha. Modulo igual, arquivo proprio.
 *
 * ONZE TABELAS, E CINCO AGREGADOS. A regra e a da casa: o agregado e a FICHA QUE
 * A PESSOA ABRE. Ninguem abre "informacoes de edicao n.o 12"; abre A FOLHA e
 * olha o que vai sair impresso na moldura dela, ou abre O LOTE e olha o que vale
 * para tudo o que ele entrega. Dai:
 *
 *   produto                     <- as declaracoes de nivel VERSAO
 *   lote                        <- as mesmas, quando de nivel LOTE
 *   usuario_metadado            <- metadado.usuario
 *   organizacao_metadado        <- metadado.organizacao
 *   creditos_qpt                <- metadado.creditos_qpt
 *   classes_complementares_orto <- metadado.classes_complementares_orto
 *
 * O AGREGADO DE SEIS TABELAS NAO E FIXO, e essa e a marca deste schema. Cinco
 * delas (mais a palavra-chave, que so tem um nivel) declaram metadado em DOIS
 * NIVEIS, e o CHECK do banco garante que e um ou o outro, nunca os dois:
 * `lote_id` vale para tudo o que o lote entregar, e `versao_id` vale para UMA
 * edicao e sobrescreve o do lote. A entidade acompanha: preenchido o
 * `versao_id`, o evento cai na ficha do PRODUTO daquela versao -- ao lado dos
 * eventos de `acervo.versao`, que usam a mesma entidade e o mesmo agregado --, e
 * preenchido o `lote_id`, cai na ficha do LOTE, que e a mesma que `producao` e
 * `ponto_controle` ja usam. E a segunda forma de `entidade` como funcao no
 * sistema; a primeira e `orcamento.arquivo`, e a razao e a mesma.
 *
 * O AGREGADO DA VERSAO E ASSINCRONO porque o dono esta a um salto: a linha
 * guarda `versao_id`, e a ficha e a do produto. E o mesmo caminho de
 * `acervo.arquivo`.
 *
 * NAO HA ENTRADA PARA `tipo_palavra_chave`, `codigo_classificacao`,
 * `codigo_restricao`, `datum_vertical` NEM `especificacao`: as cinco sao dominio
 * de code FIXO, semeadas por `er/metadado.sql`, sem porta de escrita nenhuma.
 * Tabela sem escrita nao gera evento, e declara-la prometeria um historico que
 * nunca teria linha. A `organizacao` E declarada, e a diferenca e exatamente
 * essa: ela tem PUT, porque o contato de cada Centro muda.
 *
 * O `nome` DE `codigo_classificacao` E DE `codigo_restricao` NAO SE TRADUZ na
 * tela do historico, e por isso os campos que os apontam saem por `dominio`: o
 * valor gravado e 'ultraSecreto' e 'intellectualPropertyRights', em camelCase e
 * em ingles, porque e assim que ele sai LITERAL para dentro do XML. Traduzir na
 * ficha faria o leitor procurar no banco um valor que nao esta la.
 */

/**
 * O produto dono de uma versao. Nulo quando a versao sumiu (a linha do metadado
 * pode sobreviver a exclusao por um instante dentro da mesma transacao).
 */
const produtoDaVersao = async (t, versaoId) => {
  if (versaoId == null) return null
  const linha = await t.oneOrNone(
    'SELECT produto_id FROM acervo.versao WHERE id = $<versaoId>',
    { versaoId }
  )
  return linha ? linha.produto_id : null
}

// As cinco tabelas com XOR compartilham a mesma regra de dono, e escreve-la
// cinco vezes seria cinco chances de uma delas divergir.
const entidadePorNivel = linha => (linha && linha.versao_id != null ? 'produto' : 'lote')

const agregadoPorNivel = async (t, linha) => {
  if (!linha) return null
  if (linha.versao_id != null) return produtoDaVersao(t, linha.versao_id)
  return linha.lote_id
}

// Os dois campos que dizem A QUEM a declaracao se aplica aparecem em cinco
// tabelas com o mesmo rotulo e o mesmo destino de link.
const CAMPOS_NIVEL = {
  versao_id: { rotulo: 'Versão', entidade: 'versao' },
  lote_id: { rotulo: 'Lote', entidade: 'lote' }
}

module.exports = {
  // --- Agregado proprio: os catalogos ---------------------------------------

  // OS CINCO CGEO, e a tabela existe porque o responsavel nem sempre e o
  // distribuidor: um produto levantado aqui pode ser distribuido por outro
  // Centro, e o XML exige os dois contatos completos. O `endereco` e POSTAL e o
  // `site` e publico -- e o contato institucional que a norma manda publicar
  // junto com o dado, e nao endereco de servidor.
  'metadado.organizacao': {
    modulo: 'producao',
    entidade: 'organizacao_metadado',
    agregado: (t, linha) => linha.code,
    resumo: linha => `Organização ${linha.sigla || linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      sigla: { rotulo: 'Sigla' },
      endereco: { rotulo: 'Endereço' },
      telefone: { rotulo: 'Telefone' },
      site: { rotulo: 'Site' }
    }
  },

  // A IDENTIDADE PUBLICA DE UMA PESSOA NO METADADO, e nao uma segunda conta.
  // `dgeo.usuario` responde quem entra no sistema; esta responde que nome, que
  // funcao e que OM saem impressos no XML para a mesma pessoa. FICHA PROPRIA
  // porque a linha nao pertence a produto nenhum: ela e apontada por
  // `informacoes_produto` e por `responsavel_fase_produto`, e mudar a funcao
  // muda o que aparece em todo metadado que a assinou.
  'metadado.usuario': {
    modulo: 'producao',
    entidade: 'usuario_metadado',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Assinatura de metadado: ${linha.nome}`,
    campos: {
      // A conta a que esta identidade pertence. SEM UNIQUE no banco, e e
      // deliberado: a mesma pessoa assina como duas funcoes diferentes em
      // produtos de anos diferentes, e o metadado antigo tem de continuar
      // dizendo o que dizia.
      usuario_uuid: { rotulo: 'Usuário', entidade: 'usuario' },
      // O nome COMPLETO da assinatura, e nao o nome de guerra da conta.
      nome: { rotulo: 'Nome' },
      funcao: { rotulo: 'Função' },
      organizacao_id: {
        rotulo: 'Organização',
        dominio: 'metadado.organizacao'
      }
    }
  },

  // O QUADRO DE CREDITOS DA MOLDURA, guardado como QPT (o arquivo de composicao
  // de impressao do QGIS). E CATALOGO reaproveitavel, e nao linha por produto.
  'metadado.creditos_qpt': {
    modulo: 'producao',
    entidade: 'creditos_qpt',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Créditos ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      // O LAYOUT INTEIRO, com posicao, fonte e quebra de linha. Fica no
      // historico como qualquer outro texto: e ele que muda quando o quadro
      // muda, e diffar o QPT e a unica forma de saber o que mexeu na moldura.
      qpt: { rotulo: 'Composição QPT' }
    }
  },

  // O CATALOGO de listas de classes vetoriais desenhadas sobre a ortoimagem.
  // Os nomes sao camadas da EDGV, e por isso sao texto: eles nao tem chave
  // estrangeira nenhuma para apontar neste banco.
  'metadado.classes_complementares_orto': {
    modulo: 'producao',
    entidade: 'classes_complementares_orto',
    agregado: (t, linha) => linha.id,
    resumo: linha => `Lista de classes complementares ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Nome' },
      classes: { rotulo: 'Classes', tipo: 'lista' }
    }
  },

  // --- Agregado por nivel: produto (versão) OU lote --------------------------

  // O BLOCO DE IDENTIFICACAO DO XML e a parte de cima da ficha ET-PCDG.
  'metadado.informacoes_produto': {
    modulo: 'producao',
    entidade: entidadePorNivel,
    agregado: agregadoPorNivel,
    resumo: linha =>
      linha.versao_id != null
        ? `Identificação de metadado da versão ${linha.versao_id}`
        : `Identificação de metadado do lote ${linha.lote_id}`,
    campos: {
      ...CAMPOS_NIVEL,
      resumo: { rotulo: 'Resumo' },
      proposito: { rotulo: 'Propósito' },
      creditos: { rotulo: 'Créditos' },
      informacoes_complementares: { rotulo: 'Informações complementares' },
      // AS TRES SAO A MESMA TABELA DE DOMINIO E TRES LINHAS DIFERENTES DA
      // FICHA. A norma as separa, e trocar uma pela outra muda o que o
      // consumidor do XML entende que pode fazer com o dado.
      limitacao_acesso_id: { rotulo: 'Limitação de acesso', dominio: 'metadado.codigo_restricao' },
      limitacao_uso_id: { rotulo: 'Limitação de uso', dominio: 'metadado.codigo_restricao' },
      restricao_uso_id: { rotulo: 'Restrição de uso', dominio: 'metadado.codigo_restricao' },
      grau_sigilo_id: { rotulo: 'Grau de sigilo', dominio: 'metadado.codigo_classificacao' },
      // Responsavel e distribuidor sao colunas distintas porque nem sempre sao
      // a mesma OM.
      organizacao_responsavel_id: { rotulo: 'Organização responsável', dominio: 'metadado.organizacao' },
      organizacao_distribuicao_id: { rotulo: 'Organização distribuidora', dominio: 'metadado.organizacao' },
      // O code 0 e 'Sem datum vertical', e e um VALOR: produto sem altimetria
      // declara a ausencia em vez de mentir um maregrafo.
      datum_vertical_id: { rotulo: 'Datum vertical', dominio: 'metadado.datum_vertical' },
      // A NORMA que o produto cumpre, e nao o formato do arquivo. Nao confundir
      // com `dominio.subtipo_produto`, que e a natureza do produto no acervo.
      especificacao_id: { rotulo: 'Especificação técnica', dominio: 'metadado.especificacao' },
      responsavel_produto_id: { rotulo: 'Responsável pelo produto', entidade: 'usuario_metadado' },
      // O texto que conta COMO o dado foi feito. Nao se calcula do fluxo de
      // producao: e redigido, e e o campo mais longo da ficha.
      declaracao_linhagem: { rotulo: 'Declaração de linhagem' },
      // Sem ele o XML nao e aceito na carga do BDGEx, que e o destino de todo
      // produto que sai daqui. E por isso NOT NULL.
      projeto_bdgex: { rotulo: 'Projeto no BDGEx' }
    }
  },

  // OS NUMEROS DA EDICAO: e daqui que sai quase toda a ficha ET-PCDG.
  'metadado.informacoes_edicao': {
    modulo: 'producao',
    entidade: entidadePorNivel,
    agregado: agregadoPorNivel,
    resumo: linha =>
      linha.versao_id != null
        ? `Informações de edição da versão ${linha.versao_id}`
        : `Informações de edição do lote ${linha.lote_id}`,
    campos: {
      ...CAMPOS_NIVEL,
      // TEXTO, e nao numero: o que se publica e a CLASSE ('A', 'B') junto do
      // padrao, e nao um erro medido.
      pec_planimetrico: { rotulo: 'PEC planimétrico' },
      pec_altimetrico: { rotulo: 'PEC altimétrico' },
      // FABDEM e FathomDEM sao nao comerciais e CONTAMINAM a licenca do
      // produto: mudar esta linha muda o selo impresso na moldura.
      origem_dados_altimetricos: { rotulo: 'Origem dos dados altimétricos' },
      territorio_internacional: { rotulo: 'Território internacional', tipo: 'booleano' },
      acesso_restrito: { rotulo: 'Acesso restrito', tipo: 'booleano' },
      carta_militar: { rotulo: 'Carta militar', tipo: 'booleano' },
      // TEXTO, e nao data: a ficha imprime as vezes um ano, as vezes um
      // intervalo ('2019-2021'), e nunca um dia de calendario.
      data_criacao: { rotulo: 'Data de criação (texto da ficha)' },
      creditos_id: { rotulo: 'Créditos', entidade: 'creditos_qpt' },
      epsg_mde: { rotulo: 'EPSG do MDE' },
      caminho_mde: { rotulo: 'Caminho do MDE' },
      dados_terceiro: { rotulo: 'Dados de terceiros', tipo: 'lista' },
      // A MATRIZ de fase por data que a moldura imprime, com numero de colunas
      // que varia com a linha de producao. E JSON porque nada nela e consultado
      // por SQL: ela e lida inteira de uma vez para desenhar o quadro.
      quadro_fases: { rotulo: 'Quadro de fases' },
      tipo_produto: { rotulo: 'Tipo de produto (rótulo do plugin)' },
      versao_produto: { rotulo: 'Versão do produto' },
      licenca_produto: { rotulo: 'Licença do produto' },
      observacoes: { rotulo: 'Observações', tipo: 'lista' },
      dpi: { rotulo: 'DPI', tipo: 'numero' }
    }
  },

  // QUEM RESPONDE POR CADA FASE, no XML. O XML nao pede um responsavel so: ele
  // pede o da aquisicao, o da restituicao, o da validacao. Uma linha por fase.
  'metadado.responsavel_fase_produto': {
    modulo: 'producao',
    entidade: entidadePorNivel,
    agregado: agregadoPorNivel,
    resumo: linha =>
      linha.versao_id != null
        ? `Responsável por fase da versão ${linha.versao_id}`
        : `Responsável por fase do lote ${linha.lote_id}`,
    campos: {
      ...CAMPOS_NIVEL,
      // APONTA `metadado.usuario`, e nao `dgeo.usuario`: e a identidade
      // PUBLICADA no XML, e nao a conta de sistema. Por isso continua INTEGER
      // onde o resto do SCA aponta gente por uuid.
      usuario_id: { rotulo: 'Assinatura de metadado', entidade: 'usuario_metadado' },
      fase_id: { rotulo: 'Fase', tipo: 'numero' }
    }
  },

  // OS SENSORES QUE PRODUZIRAM A IMAGEM. Mais de uma linha por produto e o caso
  // normal: um mosaico costura imagens de plataformas diferentes.
  'metadado.sensor_carta_ortoimagem': {
    modulo: 'producao',
    entidade: entidadePorNivel,
    agregado: agregadoPorNivel,
    resumo: linha => `Sensor ${linha.nome}`,
    campos: {
      ...CAMPOS_NIVEL,
      tipo: { rotulo: 'Tipo' },
      plataforma: { rotulo: 'Plataforma' },
      nome: { rotulo: 'Nome' },
      resolucao: { rotulo: 'Resolução' },
      bandas: { rotulo: 'Bandas' },
      nivel_produto: { rotulo: 'Nível do produto' }
    }
  },

  // AS IMAGENS QUE ENTRAM NA MOLDURA, com o estilo de cada uma. O estilo e
  // anulavel porque imagem em cor natural nao precisa de um.
  'metadado.imagens_carta_ortoimagem': {
    modulo: 'producao',
    entidade: entidadePorNivel,
    agregado: agregadoPorNivel,
    resumo: linha => `Imagem ${linha.caminho_imagem}`,
    campos: {
      ...CAMPOS_NIVEL,
      caminho_imagem: { rotulo: 'Caminho da imagem' },
      caminho_estilo: { rotulo: 'Caminho do estilo' },
      epsg: { rotulo: 'EPSG' }
    }
  },

  // QUAL LISTA DE CLASSES COMPLEMENTARES VALE PARA QUAL PRODUTO. "perfil" aqui
  // e heranca do SAP e nao tem relacao com `dominio.tipo_perfil`.
  'metadado.perfil_classes_complementares_orto': {
    modulo: 'producao',
    entidade: entidadePorNivel,
    agregado: agregadoPorNivel,
    resumo: linha =>
      linha.versao_id != null
        ? `Classes complementares da versão ${linha.versao_id}`
        : `Classes complementares do lote ${linha.lote_id}`,
    campos: {
      ...CAMPOS_NIVEL,
      classes_complementares_orto_id: {
        rotulo: 'Lista de classes', entidade: 'classes_complementares_orto'
      }
    }
  },

  // --- So nivel versao -------------------------------------------------------

  // A PALAVRA-CHAVE E EXCLUSIVAMENTE DE NIVEL VERSAO, e e a unica tabela do
  // schema sem o XOR: nao existe palavra-chave de lote. Toponimo e descricao sao
  // por FOLHA, e herdar do lote faria toda folha dele se descrever pelo mesmo
  // lugar. Por isso a entidade aqui e fixa, e o agregado nao tem ramo.
  'metadado.palavra_chave_produto': {
    modulo: 'producao',
    entidade: 'produto',
    agregado: (t, linha) => produtoDaVersao(t, linha.versao_id),
    resumo: linha => `Palavra-chave ${linha.nome}`,
    campos: {
      nome: { rotulo: 'Palavra-chave' },
      tipo_palavra_chave_id: {
        rotulo: 'Tipo', dominio: 'metadado.tipo_palavra_chave'
      },
      versao_id: { rotulo: 'Versão', entidade: 'versao' }
    }
  }
}
