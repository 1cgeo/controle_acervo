# Path: core\getFileBySMB.py
import sys
import os
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

def main():
    if len(sys.argv) != 6:
        logging.error(f"Uso: python3 getFileBySMB.py <smb_path> <local_path> <user> <password> <domain>")
        sys.exit(1)

    smb_file_path = sys.argv[1]
    local_file_path = sys.argv[2]
    user = sys.argv[3]
    passwd = sys.argv[4]
    domain = sys.argv[5]

    # Validar que o caminho SMB tem formato esperado
    if not smb_file_path.startswith("smb:"):
        logging.error(f"Caminho SMB inválido: deve iniciar com 'smb:'. Recebido: {smb_file_path[:20]}...")
        sys.exit(2)

    # Validar que o caminho local é absoluto
    if not os.path.isabs(local_file_path):
        logging.error(f"Caminho local deve ser absoluto: {local_file_path}")
        sys.exit(2)

    # Validar credenciais não vazias
    if not user or not passwd or not domain:
        logging.error("Credenciais SMB incompletas (user, password ou domain vazios)")
        sys.exit(2)

    try:
        import smbc
    except ImportError:
        logging.error("Biblioteca python-smbc não está instalada. Instale com: pip install pysmbc")
        sys.exit(3)

    try:
        def do_auth(server, share, workgroup, username, password):
            return (domain, user, passwd)

        # Criar diretório de destino se não existir
        dest_dir = os.path.dirname(local_file_path)
        if dest_dir and not os.path.exists(dest_dir):
            os.makedirs(dest_dir, exist_ok=True)

        ctx = smbc.Context()
        ctx.optionNoAutoAnonymousLogin = True
        ctx.functionAuthData = do_auth

        sfile = ctx.open(smb_file_path, os.O_RDONLY)
        with open(local_file_path, 'wb') as dfile:
            dfile.write(sfile.read())
        sfile.close()

        logging.info(f"Arquivo transferido com sucesso: {local_file_path}")

    except Exception as e:
        logging.error(f"Erro ao transferir arquivo via SMB: {e}")
        # Limpar arquivo parcial se existir
        if os.path.exists(local_file_path):
            try:
                os.remove(local_file_path)
            except OSError:
                pass
        sys.exit(4)


if __name__ == "__main__":
    main()
