'use strict'

// O que o joi.describe() NAO consegue contar.
//
// A forma de cada operacao (campos, tipos, obrigatorios, condicionais,
// dependencias) e lida ao vivo do schema Joi e nunca e copiada. Mas a regra de
// negocio mora nos COMENTARIOS dos *_schema.js, nos *_ctrl.js e nos triggers do
// banco, invisiveis para o describe(), e e justamente ela que evita o erro caro:
// nao saber que o PUT sobrescreve o objeto inteiro custa um campo apagado em
// producao, nao um 400.
//
// Este arquivo e a UNICA prosa curada do CLI. Regra aqui vale por ser curta e
// por explicar o PORQUE; qualquer coisa que o Joi ja diga (tipo, tamanho,
// obrigatoriedade, condicional, formato) NAO entra aqui, para nao criar uma
// segunda fonte de verdade.
//
// Ao mudar uma regra de negocio no server/, atualize a linha correspondente.

const GERAL = [
  'O SCA e um acervo de PRODUCAO: o que se escreve aqui e o registro do que a',
  'DGEO tem. Escrita direta no banco e proibida (bypassa trigger, invariante e',
  'a trilha data_modificacao/usuario_modificacao_uuid); quando falta operacao,',
  'estende-se o servidor com rota, nao se contorna pelo SQL.',
  '',
  'Acesso: publico (sem login) sao /api (health) e /api/integracao/*; as rotas de',
  'dominio em /api/gerencia/dominio/* tambem nao exigem login. Leitura de acervo',
  'exige perfil no modulo acervo: consulta le, operador cataloga, gerente exclui.',
  '',
  'Todo PUT do SCA e sobrescrita do OBJETO INTEIRO, nunca patch parcial: o',
  'controller monta um UPDATE com a lista fixa de colunas. Campo que voce nao',
  'mandar e (a) recusado pelo Joi, se for obrigatorio, ou (b) gravado com o',
  'DEFAULT do schema, se tiver um. O segundo caso e o perigoso, porque grava em',
  'silencio: e o que o verbo `acervo editar` existe para impedir.',
  '',
  'Exclusao e soft-delete: a linha vai para a tabela *_deletado (com motivo e',
  'usuario) e o acervo deixa de enxergar o registro, mas os bytes seguem no',
  'volume. Reverter nao e um endpoint: e trabalho manual no banco.'
]

const REGRAS = {
  acervo: [
    'So leitura. O prepare-download NAO transfere byte: ele devolve um token e o',
    'caminho, e a transferencia acontece fora da API (o consumidor le do volume).',
    'Por isso existe o confirm-download, que fecha o ciclo dizendo se deu certo.',
    'camadas_produto devolve, junto, a credencial de leitura do banco, porque o',
    'plugin QGIS a consome para abrir as views materializadas. Trate a saida como',
    'segredo.',
    'A busca casa o termo por ILIKE em nome, mi e inom ao mesmo tempo, e devolve',
    'paginado ({total, page, limit, dados}).',
    'O GET de versao devolve o nome da versao na coluna nome_versao, enquanto o PUT',
    'de versao espera nome. Read-modify-write ingenuo quebra nesse alias.',
    'O GET de produto NAO devolve subtipo_produto_id, que o PUT de produto grava com',
    'default null: montar o PUT so com o que o GET devolveu APAGA o subtipo.'
  ],

  produtos: [
    'A identidade de um produto e (mi/inom, tipo_escala, tipo_produto) mais o',
    'subtipo quando ele define produto (a Carta Topografica Militar e um produto',
    'distinto da civil da mesma folha). Detector de duplicata que ignora o subtipo',
    'acende falso-positivo em todo par civil/militar.',
    'A versao e unica por (produto, rotulo): repetir o rotulo volta 409. O trigger',
    'acervo.validate_version ainda cobra a sequencia do rotulo dentro da familia.',
    'Versao de tipo Registro Historico existe para registrar edicao que a DGEO',
    'conhece mas nao guarda o arquivo: ela nasce e permanece SEM arquivo.',
    'O que prova que duas cartas sao edicoes diferentes e a data_edicao, nunca o',
    'rotulo impresso na folha: o rotulo e etiqueta, e renumerar-versoes existe',
    'justamente para acerta-lo depois. Antes de renumerar, compare o checksum: se o',
    'arquivo ja esta no acervo, nao ha edicao nova, e renumerar cria uma fantasma.',
    'mover-arquivos reamarra arquivo a outra versao sem novo upload. Serve a dois',
    'casos: separar um registro que bundla duas edicoes, e consertar arquivo',
    'carregado no produto errado (ai com permitir_entre_produtos).',
    'O relacionamento entre versoes e o que liga a Carta Topografica ao CDGV dela.',
    'Ele e por VERSAO, nao por produto: reapontar pelo rotulo em vez de pela data',
    'pareia a carta com o vetor da edicao errada.'
  ],

  arquivo: [
    'Upload e em duas fases e o CLI nao faz a do meio: prepare-upload devolve o',
    'destino e abre uma sessao, ALGUEM copia os bytes para o volume, e o',
    'confirm-upload revalida o checksum e efetiva. Preparar sem copiar deixa sessao',
    'pendente: feche com cancelar-upload.',
    'Depois do confirm-upload, releia o produto para descobrir o id da versao',
    'criada, em vez de deduzi-lo da resposta.',
    'catalogar e o caminho do produto que JA ESTA no volume (entrega de convenio,',
    'grande demais para duplicar): uma chamada so, sem sessao e sem copia, e a',
    'resposta ja traz os ids criados. So vale em volume com layout_origem, e o',
    'servidor le o arquivo uma vez para medir checksum e tamanho. Nao e atalho',
    'para pular o confirm-upload: onde houve transferencia, quem valida e ele.',
    'A unicidade e (checksum, versao_id) e (nome_arquivo, extensao, versao_id): o',
    'mesmo byte nao entra duas vezes na mesma versao, e o mesmo nome tampouco.',
    'preparar-substituicao troca o conteudo do slot (versao, nome, extensao) sem',
    'criar versao nova: use quando o arquivo estava errado, nao quando ha edicao',
    'nova.',
    'Arquivo de Tileserver nao tem byte: e URL. Por isso extensao, tamanho e',
    'checksum ficam nulos nele.',
    'A situacao de carregamento fala do BDGEx, nao do volume: "nao carregado" e o',
    'estado normal de um arquivo recem-cadastrado e presente no acervo.'
  ],

  projetos: [
    'A cadeia e projeto -> lote -> versao. O lote carrega o PIT, e e por ele que a',
    'producao do ano se liga ao acervo: versao sem lote perde essa rastreabilidade.'
  ],

  volumes: [
    'O volume diz ONDE o byte mora, e o mapa volume x tipo de produto e o que a',
    'carga consulta para escolher o destino. A coluna volume e caminho de rede:',
    'nunca a grave em arquivo versionado, wiki ou memoria (cite a chave do .env).'
  ],

  gerencia: [
    'verificar-inconsistencias e o portao de fim de carga: roda os cruzamentos que',
    'nenhum CHECK do banco pega (arquivo sem byte no volume, versao historica com',
    'arquivo, orfaos). Rode depois de toda carga ou correcao em lote.',
    'As listagens de deletados sao a trilha do soft-delete, e o unico lugar onde se',
    've o motivo_exclusao informado na hora de excluir.'
  ],

  usuarios: [
    'Os usuarios sao IMPORTADOS do servico de autenticacao pelo uuid. O SCA nao',
    'guarda senha: a verificacao e sempre delegada.'
  ],

  integracao: [
    'Sao as unicas rotas de leitura SEM login, feitas para o vault do chefe. Nao',
    'gastam credencial nem token.',
    'A situacao geral e por FOLHA (celula de MI), mesclando Carta Topografica e',
    'Carta Ortoimagem da mesma folha, que no SCA sao produtos distintos. Os anos',
    'vem de data_edicao, ou seja, de quando a carta foi finalizada.',
    'Produtos finalizados filtra por data_edicao (finalizacao), NAO por data de',
    'cadastro no SCA: um lote antigo carregado hoje nao vira producao do mes.'
  ],

  rpcmtec: [
    'Gera o RPCMTec INTEIRO (acervo, mapoteca e orcamento) num lugar so, no',
    'envelope JSON ou em DOCX binario, na numeracao e no formato do documento',
    'da Divisao. --anuario baixa o Anuario Estatistico (.ods) do mesmo mes, que',
    'sobe para a DSG no mesmo envio e sai da planilha-semente da propria DSG.',
    'Admin-only: cruza os tres modulos e traz valor de credito e de empenho.'
  ],

  dashboard: [
    'Agregados prontos, so leitura. O CLI registra apenas o subconjunto que',
    'responde pergunta de chefe; o resto das rotas de dashboard e encanamento de',
    'grafico do client web.'
  ],

  login: [
    'O token vale cerca de 1 hora. O `acervo login` guarda em cache por servidor,',
    'para que um lote longo nao reautentique a cada chamada.',
    'O servidor limita 200 requisicoes por minuto: lote grande precisa de ritmo.'
  ]
}

module.exports = { REGRAS, GERAL }
