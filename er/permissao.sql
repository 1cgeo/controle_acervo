  -- Atenção: as views materializadas (mv_produto_*) são criadas e atualizadas
  -- em tempo de execução por funções SECURITY INVOKER; isso exige que $1 seja
  -- o dono dos objetos do schema acervo (CREATE no schema e ownership das MVs
  -- para REFRESH ... CONCURRENTLY). O create_config.js garante isso executando
  -- todos os scripts er/ como o próprio DB_USER. Se a instalação for feita por
  -- outro role, conceda também: GRANT CREATE ON SCHEMA acervo TO $1
  -- e transfira a posse das MVs existentes.
  GRANT USAGE ON schema public TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO $1:name;

  GRANT USAGE ON schema dominio TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA dominio TO $1:name;

  GRANT USAGE ON SCHEMA dgeo TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA dgeo TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA dgeo TO $1:name;

  -- `auditoria` e o UNICO schema sem UPDATE e sem DELETE para o usuario da
  -- aplicacao, e isso e a garantia, nao um esquecimento: uma trilha que a
  -- propria aplicacao pode reescrever nao prova nada. O backend so INSERE
  -- (auditoria/auditoria_ctrl.js) e LE (a tela de historico e a de
  -- rastreabilidade); nenhum caminho de codigo altera ou apaga evento.
  --
  -- O preco e que o expurgo, se um dia for decidido, exige o dono do banco em
  -- vez de uma rota. Ver o rodape de er/auditoria.sql.
  GRANT USAGE ON SCHEMA auditoria TO $1:name;
  GRANT SELECT, INSERT ON ALL TABLES IN SCHEMA auditoria TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA auditoria TO $1:name;

  GRANT USAGE ON SCHEMA acervo TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA acervo TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA acervo TO $1:name;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA acervo TO $1:name;

  GRANT USAGE ON SCHEMA mapoteca TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mapoteca TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mapoteca TO $1:name;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mapoteca TO $1:name;

  GRANT USAGE ON SCHEMA orcamento TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA orcamento TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA orcamento TO $1:name;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA orcamento TO $1:name;

  -- `equipamento` guarda o material permanente da Divisao. O EXECUTE nao e
  -- formalidade: `equipamento.situacao_em(dia)` e quem responde a situacao de
  -- cada bem, que nao esta gravada em coluna nenhuma. Sem ele, a lista de bens e
  -- o painel sobem sem situacao e a subsecao 7.1 do RPCMTec nao sai.
  GRANT USAGE ON SCHEMA equipamento TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA equipamento TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA equipamento TO $1:name;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA equipamento TO $1:name;

  -- `campo` guarda a atividade que a Divisao executa fora dela. CRUD porque o
  -- campo se cadastra, se corrige e se apaga pela tela. Sem EXECUTE: a linha do
  -- trajeto e uma VIEW comum (`campo.track_linha`), e nao uma funcao.
  GRANT USAGE ON SCHEMA campo TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA campo TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA campo TO $1:name;

  -- `rpcmtec` guarda a edicao mensal do relatorio da Divisao. CRUD porque a
  -- edicao se cria, se assina e se corrige pela tela.
  GRANT USAGE ON SCHEMA rpcmtec TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA rpcmtec TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA rpcmtec TO $1:name;

  -- `pit` e dado de REFERENCIA, mas de escrita PELA TELA: o administrador
  -- cadastra as metas do ano no sistema, e nao por carga. Por isso CRUD, ao
  -- contrario de `limites`, que so muda por carga.
  GRANT USAGE ON SCHEMA pit TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA pit TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pit TO $1:name;

  -- `limites` e dado de REFERENCIA: so leitura, nem para o usuario da aplicacao.
  -- A malha do IBGE se troca por carga, e nao por UPDATE de tela.
  GRANT USAGE ON SCHEMA limites TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA limites TO $1:name;

  GRANT USAGE ON SCHEMA ponto_controle TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA ponto_controle TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA ponto_controle TO $1:name;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA ponto_controle TO $1:name;

  -- `producao` e o core que veio do SAP 2.3.5. CRUD porque tudo nele se cadastra
  -- pela tela ou pelo plugin, e EXECUTE porque os gatilhos que mantem
  -- `relacionamento_ut` e `relacionamento_versao` sao funcoes deste schema.
  GRANT USAGE ON SCHEMA producao TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA producao TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA producao TO $1:name;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA producao TO $1:name;

  -- `qgis` guarda a configuracao que o operador recebe no QGIS: estilo, menu,
  -- modelo, regra, tema, atalho e a versao minima de cada plugin. CRUD porque o
  -- SAP Gerente a escreve por rota.
  GRANT USAGE ON SCHEMA qgis TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA qgis TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA qgis TO $1:name;

  -- `microcontrole` guarda O QUE SE MONITORA (qual subfase de qual lote, e
  -- como), e nao a telemetria em si: essa vive num BANCO SEPARADO, cujos GRANTs
  -- estao em `er_microcontrole/permissao.sql` e sao outros. CRUD porque o perfil
  -- de monitoramento se cadastra, se corrige e se apaga pela tela, como todo o
  -- resto do perfil de configuracao do lote.
  --
  -- SEM EXECUTE: nao ha funcao neste schema. O cruzamento entre o perfil daqui e
  -- a amostra de la e feito em JavaScript, porque nao existe juncao entre
  -- bancos.
  GRANT USAGE ON SCHEMA microcontrole TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA microcontrole TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA microcontrole TO $1:name;

  -- `metadado` alimenta a ficha ET-PCDG e a geracao do XML.
  GRANT USAGE ON SCHEMA metadado TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA metadado TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA metadado TO $1:name;

  -- `acompanhamento` e o unico schema que precisa de CREATE, e nao e descuido:
  -- as funcoes dele EMITEM DDL em tempo de execucao, criando uma view
  -- materializada por par (lote do acervo, linha de producao) e outra por
  -- (lote, subfase). Sem o CREATE, abrir um
  -- lote falha na hora de gerar a view, e a falha aparece longe de onde nasceu.
  -- E a mesma excecao que o cabecalho deste arquivo descreve para `acervo`.
  GRANT USAGE, CREATE ON SCHEMA acompanhamento TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA acompanhamento TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA acompanhamento TO $1:name;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA acompanhamento TO $1:name;

  -- As funcoes de `acompanhamento` tambem ESCREVEM em `public.layer_styles`,
  -- para o QGIS saber pintar cada view que elas geram. O GRANT de `public` no
  -- topo deste arquivo e so SELECT, entao o INSERT e o DELETE vem aqui,
  -- nominalmente, em vez de abrir o schema `public` inteiro para escrita.
  GRANT INSERT, UPDATE, DELETE ON TABLE public.layer_styles TO $1:name;
  GRANT USAGE, SELECT ON SEQUENCE public.layer_styles_id_seq TO $1:name;