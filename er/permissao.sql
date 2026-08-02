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