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

  GRANT USAGE ON SCHEMA acervo TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA acervo TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA acervo TO $1:name;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA acervo TO $1:name;

  GRANT USAGE ON SCHEMA mapoteca TO $1:name;
  GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA mapoteca TO $1:name;
  GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA mapoteca TO $1:name;
  GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA mapoteca TO $1:name;