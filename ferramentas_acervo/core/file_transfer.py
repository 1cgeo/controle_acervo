# Path: core\file_transfer.py
import os
import platform
import subprocess
import time
import logging
from qgis.PyQt.QtCore import QThread, pyqtSignal
from qgis import utils
from .authSMB import AuthSMB

class FileTransferThread(QThread):
    progress_update = pyqtSignal(int, int)
    file_transferred = pyqtSignal(bool, str, str)

    def __init__(self, source_path, destination_path, identifier, credentials=None):
        QThread.__init__(self)
        self.source_path = source_path
        self.destination_path = destination_path
        self.identifier = identifier
        self.credentials = credentials  # (user, password, domain) para SMB
        # Configuração para tentativas
        self.max_retries = 3
        self.retry_delay = 2  # segundos iniciais
        self.cancelled = False

    def run(self):
        for attempt in range(1, self.max_retries + 1):
            try:
                if self.cancelled:
                    self.file_transferred.emit(False, self.destination_path, self.identifier)
                    return
                    
                if platform.system() == 'Windows':
                    success = self.transfer_file_windows()
                else:
                    success = self.transfer_file_linux()
                
                if success:
                    self.file_transferred.emit(True, self.destination_path, self.identifier)
                    return  # Transferência bem-sucedida, retornar
                else:
                    # Transferência falhou, mas sem exceção
                    logging.warning(f"Tentativa {attempt}/{self.max_retries} falhou ao transferir arquivo (retorno falso)")
                    # Emitir progresso para informar falha na tentativa
                    self.progress_update.emit(0, 100)

            except Exception as e:
                logging.error(f"Tentativa {attempt}/{self.max_retries} falhou ao transferir arquivo: {str(e)}")
                self.progress_update.emit(0, 100)
                
            # Se chegou aqui, houve falha. Verificar se deve tentar novamente
            if attempt < self.max_retries and not self.cancelled:
                logging.info(f"Aguardando {self.retry_delay}s antes de nova tentativa de transferência")
                time.sleep(self.retry_delay)
                self.retry_delay *= 2  # Backoff exponencial
            else:
                # Todas as tentativas falharam
                logging.error(f"Todas as tentativas de transferência falharam para {self.source_path}")
                self.file_transferred.emit(False, self.destination_path, self.identifier)

    def cancel(self):
        """Cancela a transferência"""
        self.cancelled = True
        
    def transfer_file_windows(self):
        source_path = self.source_path.replace("/", "\\")
        dest_path = self.destination_path.replace("/", "\\")

        # Certificar que o diretório de destino existe
        dest_dir = os.path.dirname(dest_path)
        if not os.path.exists(dest_dir):
            try:
                os.makedirs(dest_dir, exist_ok=True)
            except Exception as e:
                logging.error(f"Erro ao criar diretório de destino: {dest_dir}, {str(e)}")
                return False

        # Usar cópia Python com progresso para todos os tamanhos de arquivo
        try:
            return self._copy_file_with_progress(source_path, dest_path)
        except Exception as e:
            logging.error(f"Erro ao copiar arquivo: {str(e)}")
            return False

    def transfer_file_linux(self):
        """Transfere arquivo no Linux usando SMB"""
        # Se já temos credenciais, usar direto
        user, passwd, domain = None, None, None
        
        if self.credentials:
            user, passwd, domain = self.credentials
        else:
            # Solicitar credenciais apenas se necessário
            from qgis.PyQt.QtCore import QMetaObject, Qt, Q_ARG
            from qgis.PyQt.QtWidgets import QApplication
            
            # Executar o diálogo na thread principal
            result = [None, None, None]
            
            def show_dialog():
                nonlocal result
                auth_smb = AuthSMB(utils.iface.mainWindow())
                if auth_smb.exec_():
                    result[0] = auth_smb.user
                    result[1] = auth_smb.passwd
                    result[2] = auth_smb.domain
            
            # Invocar na thread principal
            QMetaObject.invokeMethod(QApplication.instance(), show_dialog, 
                                    Qt.BlockingQueuedConnection)
            
            user, passwd, domain = result
            
            if not user or not passwd or not domain:
                return False

        source_path = self.source_path.replace("\\", "/")
        script_path = os.path.join(os.path.dirname(__file__), 'getFileBySMB.py')
        command = [
            'python3',
            script_path,
            f"smb:{source_path}",
            self.destination_path,
            user,
            passwd,
            domain
        ]
        return self.run_system_command(command)

    def _copy_file_with_progress(self, source_path, dest_path):
        """Copia arquivo com atualização de progresso"""
        file_size = os.path.getsize(source_path)

        if file_size == 0:
            logging.warning(f"Arquivo de origem vazio (0 bytes): {source_path}")
            # Criar arquivo vazio no destino e emitir progresso completo
            with open(dest_path, 'wb'):
                pass
            self.progress_update.emit(1, 1)
            return True

        bytes_copied = 0

        with open(source_path, 'rb') as src:
            with open(dest_path, 'wb') as dst:
                buffer_size = 8192  # 8KB por vez
                buffer = src.read(buffer_size)

                while buffer and not self.cancelled:
                    dst.write(buffer)
                    bytes_copied += len(buffer)
                    # Emitir progresso
                    self.progress_update.emit(bytes_copied, file_size)
                    buffer = src.read(buffer_size)

        return not self.cancelled

    def run_system_command(self, command):
        try:
            if isinstance(command, list):
                result = subprocess.run(command, check=True, capture_output=True, text=True)
            else:
                result = subprocess.run(command, shell=True, check=True, capture_output=True, text=True)
            
            if result.returncode == 0:
                logging.info(f"Comando executado com sucesso: {command if isinstance(command, str) else ' '.join(command)}")
                # Emitir progresso 100% para indicar sucesso
                self.progress_update.emit(100, 100)
                return True
            else:
                logging.error(f"Comando falhou com código de retorno {result.returncode}: {result.stderr}")
                return False
                
        except subprocess.CalledProcessError as e:
            logging.error(f"Erro ao executar comando: {str(e)}, saída: {e.stderr}")
            return False
        except Exception as e:
            logging.error(f"Exceção ao executar comando: {str(e)}")
            return False