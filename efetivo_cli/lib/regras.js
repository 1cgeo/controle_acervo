'use strict'

// O que o joi.describe() NAO consegue contar.
//
// A forma de cada operacao (campos, tipos, obrigatorios, dependencias) e lida ao
// vivo do schema Joi e nunca e copiada. Mas a regra de negocio mora nos
// COMENTARIOS dos *_schema.js e dos *_ctrl.js, invisiveis para o describe(), e e
// justamente ela que evita o erro caro: nao saber que omitir `nome` no PUT vale
// "nao mexe" custa um cadastro apagado em producao, nao um 400.
//
// Este arquivo e a UNICA prosa curada do CLI. Regra aqui vale por ser curta e
// por explicar o PORQUE; qualquer coisa que o Joi ja diga (tipo, tamanho,
// obrigatoriedade, formato) NAO entra aqui, para nao criar uma segunda fonte de
// verdade.
//
// Ao mudar uma regra de negocio no server/, atualize a linha correspondente.

const GERAL = [
  'A autenticacao e do PROPRIO SCA: o hash da senha mora em dgeo.usuario.senha e',
  'nao ha servico externo. Este CLI e o cliente de agente dessa feature, como o',
  'acervo_cli e do modulo acervo.',
  '',
  'Identidade e PLATAFORMA, nao modulo: /api/usuarios e /api/acessos nao levam',
  'prefixo e sao guardados por verifyAdmin, nao por verifyPerfil. Nao existe',
  '"administrador de modulo": o administrador e global e passa em tudo. Quem nao',
  'e administrador so alcanca daqui o proprio cadastro (GET/PUT /usuarios/perfil',
  'e PUT /usuarios/perfil/senha).',
  '',
  'Nao ha catalogo de APLICACOES: a lista de clientes de auth e fechada e vive no',
  '.valid() de login/login_schema.js. Por isso nao ha comando de aplicacao neste',
  'CLI, e a coluna cliente de dgeo.login e VARCHAR.',
  '',
  'O que este CLI faz propaga para os TRES modulos de uma vez. Por isso toda',
  'operacao em LOTE resolve os uuid para NOME antes de pedir confirmacao: tres',
  'uuid nao dizem nada, e confirmar sem saber quem sao e o modo tipico de',
  'estragar acesso de gente de verdade.',
  '',
  'O EFETIVO entra aqui pelo mesmo motivo: quem esteve na Divisao tambem e dado',
  'de PESSOAL, guardado por verifyAdmin inclusive na leitura, e amarrado ao mesmo',
  'dgeo.usuario. Identidade responde "quem e, e o que pode"; efetivo responde',
  '"quem esteve, e quanto rendeu".'
]

const REGRAS = {
  usuario: [
    'EXCLUIR quase sempre falha, e esta certo. dgeo.usuario.uuid e referenciado',
    'por dezenas de tabelas dos tres modulos, e quem ja trabalhou no sistema nao',
    'se apaga: se DESATIVA (editar com ativo=false). Apagar reescreveria a autoria',
    'do que a pessoa cadastrou. A rota existe para o cadastro errado de cinco',
    'minutos atras. O servidor traduz a violacao de FK numa frase que diz o que',
    'fazer, e o CLI a mostra inteira, sem reembrulhar.',
    'RESETAR A SENHA faz a senha virar o LOGIN de cada pessoa. E a convencao',
    'herdada do Auth Server, mantida de proposito: uma senha que a pessoa nao',
    'escolheu e que qualquer um adivinha e o que obriga a troca no primeiro',
    'acesso. Avise cada pessoa; enquanto ela nao trocar, o acesso esta aberto.',
    'O reset vale para ADMINISTRADOR tambem, ao contrario do original: aqui o',
    'administrador e global e unico, e recusa-lo bloquearia justamente a conta sem',
    'outro caminho de recuperacao.',
    'No PUT de usuario, os campos de identidade (login, nome, nome_guerra,',
    'tipo_posto_grad_id) sao OPCIONAIS e omitir vale "nao mexe": quem preenche o',
    'valor atual e o preserveOmitted do controlador. Ja administrador e ativo sao',
    'OBRIGATORIOS, porque os botoes de alternar da tela chamam esta rota so com',
    'eles. Mandar so {"ativo": false} e 400, e nao "desativar sem mexer no resto".',
    'perfis e um MAPA modulo -> nivel, e a chave e o nome_abrev de dominio.modulo',
    '(acervo, mapoteca, orcamento). Nivel null REMOVE o acesso aquele modulo, e',
    'modulo omitido fica como esta. Criar a pessoa NAO libera modulo nenhum: sem',
    'linha em dgeo.usuario_perfil ela entra e nao ve nada.',
    'O servidor recusa a alteracao que deixaria o sistema sem NENHUM administrador',
    'ativo (no PUT simples, no PUT em lote e no DELETE). E lockout operacional: so',
    'se recupera com SQL direto no banco.',
    'senha_definida (na listagem) e um booleano derivado, nunca o hash. false',
    'significa "ainda nao tem senha local" e a pessoa nao consegue entrar: e o',
    'estado de quem foi importado do Auth Server e nao teve o hash copiado. O',
    'conserto e o reset de senha.',
    'A politica de senha esta em PARIDADE com o Auth Server (qualquer coisa nao',
    'vazia), de proposito. Se um dia subir, sobe no `senha` de usuario_schema.js e',
    'vale nas tres rotas de uma vez, inclusive aqui.'
  ],

  acessos: [
    'So leitura, e todas as rotas sao verifyAdmin.',
    'dgeo.login.usuario_id e ANULAVEL de proposito: apagar a pessoa nao apaga a',
    'passagem dela. Por isso o ranking por usuario tem uma linha "Usuário',
    'deletado", que soma TODAS as pessoas apagadas, e o painel de logados (que',
    'precisa de nome) nao as mostra.',
    'total e max sao janela e teto, com default e limite que vivem SO no Joi',
    '(o CLI os le de la). total vira o tamanho de um generate_series, ou seja, a',
    'quantidade de linhas que a consulta monta antes de agrupar: o teto existe',
    'para que ?total=999999999 nao seja um pedido de varredura.',
    'Dia sem login sai com zero, e nao sumido da serie: e o generate_series com',
    'LEFT JOIN. Um grafico de linha sobre serie esburacada ligaria terca a sexta',
    'como se quinta nao tivesse existido.',
    'Nao ha teto na quebra por cliente: a lista e fechada e tem duas entradas, e',
    'um teto ali so teria como efeito esconder um cliente novo no dia em que ele',
    'entrasse.'
  ],

  efetivo: [
    'O aproveitamento e INTERVALO, e nao lancamento por mes: gravam-se os fatos',
    '(a passagem pela DGEO e o impedimento, cada um com inicio e fim), e mes,',
    'semana e ano sao CONSULTA sobre eles. Por isso nao ha verbo de "lancar o',
    'mes": lancar o mes seria gravar a conta em vez do fato.',
    'PASSAGEM nao sobrepoe: a mesma pessoa nao tem dois periodos no mesmo dia, e',
    'quem cobra e um EXCLUDE no banco. IMPEDIMENTO sobrepoe, e os percentuais',
    'somam ate 100.',
    'data_fim nula e "sem previsao de saida", que e o caso comum de quem esta na',
    'Divisao agora, e nao um cadastro pela metade.',
    'O MILITAR nao entra no PUT, nem da passagem nem do impedimento: troca-lo',
    'reescreveria de quem e o periodo. Para corrigir a pessoa, exclua e cadastre',
    'de novo.',
    'descricao do impedimento e texto livre, e vale o que TIRA a pessoa do',
    'trabalho da Divisao (curso fora, licenca, missao), nunca o que ela faz aqui.',
    'percentual vai de 1 a 100: zero seria um impedimento que nao impede, e o',
    'registro dele so encheria a lista.',
    'Excluir e definitivo (nao ha tabela de deletados) e muda o numero de todo',
    'mes e semana que o periodo cobria, no mapa e na subsecao 6.1 do RPCMTec.'
  ],

  login: [
    'O token vale cerca de 1 hora e NAO carrega os perfis: quem decide o que a',
    'pessoa pode e o verifyPerfil, lendo o banco a cada requisicao. E o que faz',
    'desativar usuario ou rebaixar perfil valer na hora, sem esperar o token',
    'expirar.',
    'O `efetivo login` guarda o token em cache por servidor, em ~/.sca, e os CLIs',
    'irmaos (acervo, mapoteca, orcamento) reaproveitam a MESMA sessao.',
    'O login grava a passagem em dgeo.login DEPOIS de assinar o token e dentro da',
    'mesma transacao: login que termina em erro nao conta como acesso.',
    'Tres respostas diferentes que a frase generica juntaria numa so: conta',
    'inativa, senha errada e senha ainda nao cadastrada. A ultima e administrativa',
    'e nao se resolve tentando de novo.',
    'O servidor limita 200 requisicoes por minuto: lote grande precisa de ritmo.'
  ]
}

module.exports = { REGRAS, GERAL }
