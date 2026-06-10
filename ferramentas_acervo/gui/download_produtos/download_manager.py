# Path: gui\download_produtos\download_manager.py
import os
import hashlib
import logging
import platform
import time
from qgis.PyQt.QtCore import QObject, pyqtSignal, QTimer
from ...core.file_transfer import FileTransferThread

# Managers cujo shutdown() expirou com threads ainda em execução são retidos
# aqui até as threads finalizarem. Sem isso, o GC do Python destruiria um
# QThread em execução (junto com o manager), o que aborta o QGIS inteiro
# ("QThread: Destroyed while thread is still running" — crash nativo).
_orphaned_managers = set()


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
        # True após shutdown(): callbacks atrasados (sinais enfileirados,
        # QTimer de retentativa) não devem mais confirmar com o servidor nem
        # emitir sinais — o diálogo dono provavelmente já foi destruído
        self._shutdown = False
        # Referências fortes a TODAS as threads de transferência até que cada
        # uma termine de fato (sinal finished). Se a única referência for
        # descartada com a thread ainda rodando, o GC destrói o QThread em
        # execução e o QGIS sofre crash nativo (sem traceback Python).
        self._active_threads = []

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
        # No Linux, obter as credenciais SMB AQUI (thread principal), antes de
        # iniciar as threads: diálogos não podem ser criados em threads de
        # trabalho (crash nativo do Qt)
        if platform.system() != 'Windows':
            if not FileTransferThread.ensure_smb_credentials():
                self.download_error.emit("Credenciais SMB não informadas. Download cancelado.")
                return

        self.is_cancelled = False
        self._shutdown = False
        self.download_results = []
        self._destination_dir = destination_dir
        self._total_files = len(file_infos)
        self._completed_count = 0

        # Create destination directory if it doesn't exist
        if not os.path.exists(destination_dir):
            try:
                os.makedirs(destination_dir, exist_ok=True)
            except OSError as e:
                self.download_error.emit(f"Não foi possível criar a pasta de destino: {e}")
                return

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
        if self._shutdown:
            return

        # Descartar entradas sem caminho de origem (ex: registro sem volume no
        # servidor) sem iniciar thread — laço (e não recursão) para não estourar
        # a pilha se houver muitas entradas inválidas
        while self._pending_files and not self._pending_files[0].get('download_path'):
            bad_info = self._pending_files.pop(0)
            self.download_results.append({
                'download_token': bad_info['download_token'],
                'success': False,
                'error_message': 'Caminho de origem do arquivo não informado pelo servidor',
                'file_path': '',
                'nome': bad_info['nome']
            })
            self._completed_count += 1
            self.file_complete.emit(bad_info['nome'], False)

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

        # Manter referência forte até a thread terminar de fato. O slot
        # _cleanup_finished_threads (método de QObject) é entregue de forma
        # enfileirada na thread principal, após o término real da thread.
        self._active_threads.append(transfer_thread)
        transfer_thread.finished.connect(self._cleanup_finished_threads)

        self.current_transfer = {
            'thread': transfer_thread,
            'file_info': file_info
        }

        transfer_thread.start()

    def _cleanup_finished_threads(self):
        """Libera as threads de transferência que já finalizaram.

        Executa na thread principal (conexão enfileirada do sinal finished).
        Só remove a referência depois que isFinished() é verdadeiro — destruir
        um QThread ainda em execução aborta o processo do QGIS.
        """
        for thread in list(self._active_threads):
            if thread.isFinished():
                self._active_threads.remove(thread)
                thread.deleteLater()
        if not self._active_threads:
            _orphaned_managers.discard(self)

    def _handle_file_transfer_complete(self, success, file_path, identifier):
        """Handle completion of a file transfer with checksum retry logic."""
        if self._shutdown or not self.current_transfer:
            return

        file_info = self.current_transfer['file_info']
        # Seguro descartar aqui: a thread continua referenciada em
        # _active_threads até o sinal finished (ver _cleanup_finished_threads)
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

            if not response:
                self.download_error.emit("Falha ao confirmar os downloads com o servidor.")
                return

            # Detectar tokens que o servidor recusou (ex: expirados/limpos pelo cron após 24h)
            results = response.get('dados') if isinstance(response, dict) else None
            expired = []
            if isinstance(results, list):
                for r in results:
                    if isinstance(r, dict) and r.get('status') == 'error':
                        expired.append(r.get('download_token'))

            if expired:
                self.download_error.emit(
                    f"{len(expired)} token(s) de download expiraram ou já foram processados pelo servidor. "
                    "Downloads com mais de 24h precisam ser reiniciados."
                )
                return

            self.download_complete.emit(self.download_results)
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
            # A referência da thread permanece em _active_threads até finished:
            # descartá-la aqui (como era feito) permitia que o GC destruísse o
            # QThread ainda em execução — crash nativo do QGIS
            self.current_transfer = None

        # Sempre concluir: cancelar antes do primeiro arquivo terminar deixava
        # a UI travada aguardando download_complete (confirm_downloads emite
        # download_complete([]) quando não há resultados)
        self.confirm_downloads()

    def has_active_threads(self):
        """Indica se ainda há threads de transferência vivas."""
        return any(thread.isRunning() for thread in self._active_threads)

    def shutdown(self, wait_ms=10000):
        """Cancela tudo e aguarda as threads de transferência terminarem.

        Deve ser chamado antes de destruir o diálogo dono deste manager (os
        diálogos são criados com WA_DeleteOnClose). Não emite sinais nem
        confirma com o servidor — apenas garante o encerramento seguro.

        Retorna True se todas as threads finalizaram dentro do tempo limite.
        Caso contrário o manager é retido em _orphaned_managers (impedindo o
        GC de destruir um QThread em execução) e liberado automaticamente
        quando a última thread finalizar.
        """
        self._shutdown = True
        self.is_cancelled = True
        self._pending_files = []
        self.current_transfer = None

        for thread in list(self._active_threads):
            thread.cancel()

        deadline = time.monotonic() + (wait_ms / 1000.0)
        for thread in list(self._active_threads):
            if thread.isRunning():
                remaining_ms = max(1, int((deadline - time.monotonic()) * 1000))
                thread.wait(remaining_ms)

        self._cleanup_finished_threads()

        if self._active_threads:
            logging.warning(
                "Threads de transferência ainda em execução após o shutdown; "
                "manager retido até a finalização para evitar crash do QGIS"
            )
            _orphaned_managers.add(self)
            return False
        return True

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
