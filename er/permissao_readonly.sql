-- Permissões do usuário somente leitura ($1) usado nas URIs de camada do QGIS.
-- Acesso mínimo: views materializadas e tabelas do acervo, domínios e estilos
-- de camada (public.layer_styles). Sem acesso a dgeo (logins) e mapoteca.
-- $2 é o usuário principal do serviço (DB_USER), dono das MVs criadas em runtime.

  GRANT USAGE ON SCHEMA public TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA public TO $1:name;

  GRANT USAGE ON SCHEMA dominio TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA dominio TO $1:name;

  GRANT USAGE ON SCHEMA acervo TO $1:name;
  GRANT SELECT ON ALL TABLES IN SCHEMA acervo TO $1:name;

  -- MVs criadas em runtime por acervo.criar_views_materializadas() (owner = $2)
  ALTER DEFAULT PRIVILEGES FOR ROLE $2:name IN SCHEMA acervo GRANT SELECT ON TABLES TO $1:name;
  ALTER DEFAULT PRIVILEGES FOR ROLE $2:name IN SCHEMA public GRANT SELECT ON TABLES TO $1:name;
