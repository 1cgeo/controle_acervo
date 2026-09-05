# Path: core\getFileBySMB.py
import sys
import os
import logging

logging.basicConfig(level=logging.INFO, format='%(levelname)s: %(message)s')

def main():
    # A SENHA NÃO É ARGUMENTO, E ISSO É O PONTO: argumento de processo é legível
    # por qualquer usuário da máquina (`ps aux`, /proc/<pid>/cmdline). Ela chega
    # em SMB_PASSWD, que só o dono do processo e o root leem. A forma de SEIS
    # argumentos continua aceita para quem chama o script à mão.
    if len(sys.argv) == 6:
        smb_file_path, local_file_path, user, passwd, domain = sys.argv[1:6]
    elif len(sys.argv) == 5:
        smb_file_path, local_file_path, user, domain = sys.argv[1:5]
        passwd = os.environ.get('SMB_PASSWD', '')
    else:
        logging.error(
            "Uso: SMB_PASSWD=<senha> python3 getFileBySMB.py "
            "<smb_path> <local_path> <user> <domain>"
        )
        sys.exit(1)

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
        logging.error("Credenciais SMB incompletas (usuário, senha em SMB_PASSWD ou domínio vazios)")
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
        # O arquivo parcial tem de sair: sobrando na pasta, ele passa por PDF
        # baixado e vai truncado para a impressora.
        if os.path.exists(local_file_path):
            try:
                os.remove(local_file_path)
            except OSError as erro_remocao:
                logging.warning(f"Arquivo parcial não pôde ser apagado: {erro_remocao}")
        sys.exit(4)


if __name__ == "__main__":
    main()
