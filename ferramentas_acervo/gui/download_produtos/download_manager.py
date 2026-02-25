# Path: gui\download_produtos\download_manager.py
import os
import hashlib
import logging
import time
from qgis.PyQt.QtCore import QObject, pyqtSignal, QThread, QTimer
from ...core.file_transfer import FileTransferThread

class DownloadManager(QObject):
    """
    Class to manage the download of products files, handling preparation,
    download and confirmation with the server.
    Downloads are processed sequentially to avoid overloading the network/server.
    Checksum failures trigger automatic retries with exponential backoff.
    """

    # Signals
    prepare_complete = pyqtSignal(list)
    download_progress = pyqtSignal(int, int)  # current, total
    file_progress = pyqtSignal(int, int, str)  # current_bytes, total_bytes, filename
    file_complete = pyqtSignal(str, bool)  # file_path, success
    download_complete = pyqtSignal(list)  # results
    download_error = pyqtSignal(str)  # error_message

    # Configuracao de retentativas para checksum
    MAX_CHECKSUM_RETRIES = 3
    CHECKSUM_RETRY_BASE_DELAY = 2  # segundos

    def __init__(self, api_client):
        super(DownloadManager, self).__init__()
        self.api_client = api_client
        self.current_transfer = None
        self.download_results = []
        self.is_cancelled = False
        self._pending_files = []
        self._destination_dir = ''
        self._total_files = 0
        self._completed_count = 0

    def prepare_download(self, product_ids, file_types):
        """Prepare download by sending product IDs and file type IDs to server."""
        try:
            response = self.api_client.post('acervo/prepare-download/produtos', {
                'produtos_ids': product_ids,
                'tipos_arquivo': file_types
            })

            if response and 'dados' in response:
                self.prepare_complete.emit(response['dados'])
            else:
                self.download_error.emit("Não foi possível preparar o download. Resposta inválida do servidor.")
        except Exception as e:
            self.download_error.emit(f"Erro ao preparar o download: {str(e)}")

    def start_download(self, file_infos, destination_dir):
        """Start downloading files sequentially to the specified destination directory."""
        self.is_cancelled = False
        self.download_results = []
        self._destination_dir = destination_dir
        self._total_files = len(file_infos)
        self._completed_count = 0

        # Create destination directory if it doesn't exist
        if not os.path.exists(destination_dir):
            os.makedirs(destination_dir)

        # Preparar fila de arquivos pendentes
        self._pending_files = []
        for file_info in file_infos:
            self._pending_files.append({
                'arquivo_id': file_info['arquivo_id'],
                'nome': file_info['nome'],
                'download_path': file_info['download_path'],
                'download_token': file_info['download_token'],
                'checksum': file_info['checksum'],
                'checksum_retries': 0
            })

        # Iniciar o primeiro download
        self._download_next_file()

    def _download_next_file(self):
        """Download the next file in the queue sequentially."""
        if self.is_cancelled or not self._pending_files:
            # Fila vazia ou cancelado: confirmar downloads
            self.confirm_downloads()
            return

        file_info = self._pending_files[0]

        file_path = file_info['download_path']
        nome_arquivo = file_info['nome']
        download_token = file_info['download_token']

        # Caminho de destino
        dest_file_path = os.path.join(self._destination_dir, os.path.basename(file_path))
        file_info['dest_file_path'] = dest_file_path

        # Emitir progresso geral
        self.download_progress.emit(self._completed_count, self._total_files)

        # Criar e iniciar thread de transferencia
        transfer_thread = FileTransferThread(file_path, dest_file_path, download_token)
        transfer_thread.progress_update.connect(
            lambda current, total, file=nome_arquivo: self.file_progress.emit(current, total, file)
        )
        transfer_thread.file_transferred.connect(self._handle_file_transfer_complete)

        self.current_transfer = {
            'thread': transfer_thread,
            'file_info': file_info
        }

        transfer_thread.start()

    def _handle_file_transfer_complete(self, success, file_path, identifier):
        """Handle completion of a file transfer with checksum retry logic."""
        if not self.current_transfer:
            return

        file_info = self.current_transfer['file_info']
        self.current_transfer = None

        if success:
            # Verificar checksum (pular verificacao para arquivos sem checksum, ex: tipo_arquivo_id=9)
            expected_checksum = file_info['checksum']

            if expected_checksum is not None:
                calculated_checksum = self.calculate_checksum(file_path)

                if calculated_checksum != expected_checksum:
                    # Checksum falhou - tentar novamente se dentro do limite de retentativas
                    file_info['checksum_retries'] += 1
                    retry_count = file_info['checksum_retries']

                    if retry_count < self.MAX_CHECKSUM_RETRIES:
                        delay = self.CHECKSUM_RETRY_BASE_DELAY * (2 ** (retry_count - 1))
                        logging.warning(
                            f"Checksum falhou para '{file_info['nome']}' "
                            f"(tentativa {retry_count}/{self.MAX_CHECKSUM_RETRIES}). "
                            f"Retentando em {delay}s..."
                        )
                        # Descartar o arquivo corrompido
                        try:
                            if os.path.exists(file_path):
                                os.remove(file_path)
                        except OSError:
                            pass

                        # Agendar retentativa com backoff (sem bloquear a GUI)
                        delay_ms = int(delay * 1000)
                        QTimer.singleShot(delay_ms, self._download_next_file)
                        return
                    else:
                        # Excedeu retentativas
                        success = False
                        error_message = (
                            f"Falha na verificação de integridade após "
                            f"{self.MAX_CHECKSUM_RETRIES} tentativas (checksum não corresponde)"
                        )
                        logging.error(
                            f"Checksum falhou definitivamente para '{file_info['nome']}' "
                            f"após {self.MAX_CHECKSUM_RETRIES} tentativas"
                        )
                        # Descartar arquivo corrompido
                        try:
                            if os.path.exists(file_path):
                                os.remove(file_path)
                        except OSError:
                            pass
                else:
                    error_message = None
            else:
                # Sem checksum esperado (ex: tileserver) - aceitar como sucesso
                error_message = None
        else:
            error_message = "Falha na transferência do arquivo"

        # Remover da fila de pendentes
        if file_info in self._pending_files:
            self._pending_files.remove(file_info)

        # Adicionar ao resultado
        result = {
            'download_token': file_info['download_token'],
            'success': success,
            'error_message': error_message,
            'file_path': file_path,
            'nome': file_info['nome']
        }
        self.download_results.append(result)
        self._completed_count += 1

        # Sinalizar conclusao do arquivo
        self.file_complete.emit(file_info['nome'], success)

        # Continuar com o proximo arquivo
        self._download_next_file()

    def confirm_downloads(self):
        """Confirm downloads with the server."""
        if not self.download_results:
            self.download_complete.emit([])
            return

        confirmations = [
            {
                'download_token': result['download_token'],
                'success': result['success'],
                'error_message': result['error_message']
            }
            for result in self.download_results
        ]

        try:
            response = self.api_client.post('acervo/confirm-download', {'confirmations': confirmations})

            if response:
                self.download_complete.emit(self.download_results)
            else:
                self.download_error.emit("Falha ao confirmar os downloads com o servidor.")
        except Exception as e:
            self.download_error.emit(f"Erro ao confirmar downloads: {str(e)}")

    def cancel_downloads(self):
        """Cancel all active downloads."""
        self.is_cancelled = True
        self._pending_files = []

        if self.current_transfer:
            thread = self.current_transfer['thread']
            if thread.isRunning():
                thread.cancel()
            self.current_transfer = None

        # Confirm any completed downloads
        if self.download_results:
            self.confirm_downloads()

    @staticmethod
    def calculate_checksum(file_path):
        """Calculate SHA-256 checksum of a file."""
        sha256_hash = hashlib.sha256()

        try:
            with open(file_path, "rb") as f:
                for byte_block in iter(lambda: f.read(4096), b""):
                    sha256_hash.update(byte_block)

            return sha256_hash.hexdigest()
        except Exception:
            return None

    @staticmethod
    def get_total_size_mb(file_infos):
        """Calculate total size of files based on file_info objects."""
        total_size = 0
        for file_info in file_infos:
            if 'tamanho_mb' in file_info and file_info['tamanho_mb'] is not None:
                total_size += float(file_info['tamanho_mb'])
            else:
                total_size += 10
        return total_size
