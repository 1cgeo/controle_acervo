# Path: gui\pedidos\impressao_manager.py
import os
import hashlib
import logging
from qgis.PyQt.QtCore import QObject, pyqtSignal, QTimer
from ...core.file_transfer import FileTransferThread

class ImpressaoManager(QObject):
    """
    Gerencia o download dos PDFs das cartas de um pedido para impressão.
    Os downloads são sequenciais, com verificação de checksum e retentativas,
    e confirmados com o servidor ao final (mesmo fluxo do plugin do acervo).
    Ao concluir, grava um manifesto CSV com os quantitativos de impressão
    de cada arquivo.
    """

    # Sinais
    prepare_complete = pyqtSignal(dict)  # resposta de download_impressao
    download_progress = pyqtSignal(int, int)  # atual, total
    file_progress = pyqtSignal(int, int, str)  # bytes_atuais, bytes_totais, nome
    file_complete = pyqtSignal(str, bool)  # nome, sucesso
    download_complete = pyqtSignal(list, str)  # resultados, caminho_manifesto
    download_error = pyqtSignal(str)  # mensagem

    MAX_CHECKSUM_RETRIES = 3
    CHECKSUM_RETRY_BASE_DELAY = 2  # segundos

    MANIFESTO_NOME = 'quantitativos_impressao.csv'

    def __init__(self, api_client):
        super(ImpressaoManager, self).__init__()
        self.api_client = api_client
        self.current_transfer = None
        self.download_results = []
        self.is_cancelled = False
        self._pending_files = []
        self._destination_dir = ''
        self._total_files = 0
        self._completed_count = 0
        self._file_infos = []
        # Mantém referência a cada FileTransferThread até o sinal finished.
        # Sem isso, zerar current_transfer deixaria a única referência Python
        # cair e o GC destruiria a QThread ainda em execução -> crash nativo.
        self._active_threads = []
        self._shutdown = False

    def prepare_download(self, pedido_id):
        """Prepara o download dos PDFs do pedido no servidor (gera tokens)."""
        try:
            response = self.api_client.post(f'mapoteca/pedido/{pedido_id}/download_impressao')

            if response and 'dados' in response:
                self.prepare_complete.emit(response['dados'])
            else:
                self.download_error.emit("Não foi possível preparar o download. Resposta inválida do servidor.")
        except Exception as e:
            self.download_error.emit(f"Erro ao preparar o download: {str(e)}")

    def start_download(self, file_infos, destination_dir):
        """Inicia o download sequencial dos arquivos para a pasta de destino."""
        # No Linux, obter credenciais SMB na thread principal ANTES de iniciar
        # as threads (criar diálogo dentro do worker derruba o QGIS)
        if not FileTransferThread.ensure_smb_credentials():
            self.download_error.emit("Credenciais de rede (SMB) não informadas.")
            return

        self.is_cancelled = False
        self._shutdown = False
        self.download_results = []
        self._destination_dir = destination_dir
        self._total_files = len(file_infos)
        self._completed_count = 0
        self._file_infos = file_infos

        if not os.path.exists(destination_dir):
            os.makedirs(destination_dir)

        # Montar fila, evitando colisão de nomes de destino
        used_names = set()
        self._pending_files = []
        for file_info in file_infos:
            base_name = os.path.basename(file_info['download_path'])
            dest_name = base_name
            suffix = 2
            while dest_name in used_names:
                root, ext = os.path.splitext(base_name)
                dest_name = f"{root}_{suffix}{ext}"
                suffix += 1
            used_names.add(dest_name)

            self._pending_files.append({
                'arquivo_id': file_info['arquivo_id'],
                'nome': file_info['nome'],
                'download_path': file_info['download_path'],
                'download_token': file_info['download_token'],
                'checksum': file_info['checksum'],
                'dest_name': dest_name,
                'checksum_retries': 0
            })

        self._download_next_file()

    def _download_next_file(self):
        """Baixa o próximo arquivo da fila."""
        if self.is_cancelled or not self._pending_files:
            self.confirm_downloads()
            return

        file_info = self._pending_files[0]

        dest_file_path = os.path.join(self._destination_dir, file_info['dest_name'])
        file_info['dest_file_path'] = dest_file_path

        self.download_progress.emit(self._completed_count, self._total_files)

        transfer_thread = FileTransferThread(
            file_info['download_path'], dest_file_path, file_info['download_token']
        )
        transfer_thread.progress_update.connect(
            lambda current, total, file=file_info['nome']: self.file_progress.emit(current, total, file)
        )
        transfer_thread.file_transferred.connect(self._handle_file_transfer_complete)
        # Mantém a thread referenciada até finished, removendo-a só quando o
        # C++ realmente terminou (evita destruir QThread em execução)
        transfer_thread.finished.connect(self._cleanup_finished_threads)
        self._active_threads.append(transfer_thread)

        self.current_transfer = {
            'thread': transfer_thread,
            'file_info': file_info
        }

        transfer_thread.start()

    def _cleanup_finished_threads(self):
        """Remove (e agenda deleção de) as threads que já terminaram de fato."""
        ainda_ativas = []
        for thread in self._active_threads:
            if thread.isFinished():
                thread.deleteLater()
            else:
                ainda_ativas.append(thread)
        self._active_threads = ainda_ativas

    def _handle_file_transfer_complete(self, success, file_path, identifier, error_msg=None):
        """Trata a conclusão de uma transferência, com retentativa de checksum."""
        # Após shutdown/cancelamento não processar (a UI pode estar fechando).
        # A thread continua referenciada em _active_threads até finished.
        if self._shutdown or not self.current_transfer:
            return

        file_info = self.current_transfer['file_info']
        self.current_transfer = None

        error_message = None
        if success:
            expected_checksum = file_info['checksum']

            if expected_checksum is not None:
                calculated_checksum = self.calculate_checksum(file_path)

                if calculated_checksum != expected_checksum:
                    file_info['checksum_retries'] += 1
                    retry_count = file_info['checksum_retries']

                    if retry_count < self.MAX_CHECKSUM_RETRIES and not self.is_cancelled:
                        delay = self.CHECKSUM_RETRY_BASE_DELAY * (2 ** (retry_count - 1))
                        logging.warning(
                            f"Checksum falhou para '{file_info['nome']}' "
                            f"(tentativa {retry_count}/{self.MAX_CHECKSUM_RETRIES}). "
                            f"Retentando em {delay}s..."
                        )
                        try:
                            if os.path.exists(file_path):
                                os.remove(file_path)
                        except OSError:
                            pass

                        # Guarda no callback: se a janela fechar durante o delay,
                        # _shutdown bloqueia o reagendamento
                        QTimer.singleShot(
                            int(delay * 1000),
                            lambda: None if self._shutdown else self._download_next_file()
                        )
                        return
                    else:
                        success = False
                        error_message = (
                            f"Falha na verificação de integridade após "
                            f"{self.MAX_CHECKSUM_RETRIES} tentativas (checksum não corresponde)"
                        )
                        try:
                            if os.path.exists(file_path):
                                os.remove(file_path)
                        except OSError:
                            pass
        else:
            error_message = error_msg or "Falha na transferência do arquivo"

        if file_info in self._pending_files:
            self._pending_files.remove(file_info)

        self.download_results.append({
            'download_token': file_info['download_token'],
            'success': success,
            'error_message': error_message,
            'file_path': file_path,
            'dest_name': file_info['dest_name'],
            'nome': file_info['nome']
        })
        self._completed_count += 1

        self.file_complete.emit(file_info['nome'], success)

        self._download_next_file()

    def confirm_downloads(self):
        """Confirma os downloads com o servidor e grava o manifesto."""
        # Em shutdown (janela fechando) não confirmar nem emitir para a UI
        if self._shutdown:
            return

        if not self.download_results:
            self.download_complete.emit([], '')
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

            manifesto_path = self._write_manifesto()
            self.download_complete.emit(self.download_results, manifesto_path)
        except Exception as e:
            self.download_error.emit(f"Erro ao confirmar downloads: {str(e)}")

    def _write_manifesto(self):
        """Grava o CSV de quantitativos de impressão na pasta de destino.

        Uma linha por arquivo baixado, com o que falta imprimir de cada um.
        Separador ';' e BOM UTF-8 para abrir direto no Excel pt-BR.
        """
        if not self._destination_dir:
            return ''

        sucesso_por_token = {
            r['download_token']: r for r in self.download_results if r['success']
        }

        manifesto_path = os.path.join(self._destination_dir, self.MANIFESTO_NOME)
        try:
            with open(manifesto_path, 'w', encoding='utf-8-sig', newline='') as f:
                f.write('Arquivo;Produto;MI;Escala;Mídia;Qtd pedida;Já impresso;Restante a imprimir\r\n')
                for info in self._file_infos:
                    result = sucesso_por_token.get(info['download_token'])
                    if not result:
                        continue
                    campos = [
                        result['dest_name'],
                        info.get('produto_nome') or '',
                        info.get('mi') or '',
                        info.get('escala') or '',
                        info.get('tipo_midia_nome') or '',
                        str(info.get('quantidade', '')),
                        str(info.get('quantidade_impressa', '')),
                        str(info.get('quantidade_restante', ''))
                    ]
                    escaped = [
                        f'"{c.replace(chr(34), chr(34) * 2)}"' if any(ch in c for ch in ';"\n\r') else c
                        for c in campos
                    ]
                    f.write(';'.join(escaped) + '\r\n')
            return manifesto_path
        except Exception as e:
            logging.error(f"Erro ao gravar manifesto de impressão: {str(e)}")
            return ''

    def cancel_downloads(self):
        """Cancela os downloads em andamento (mantém a UI viva)."""
        self.is_cancelled = True
        self._pending_files = []

        # Sinaliza cancelamento a TODAS as threads ativas (não só a atual);
        # a referência é mantida em _active_threads até finished
        for thread in self._active_threads:
            if thread.isRunning():
                thread.cancel()
        self.current_transfer = None

        # Sempre concluir: cancelar antes do primeiro arquivo terminar deixava
        # a UI travada aguardando download_complete (confirm_downloads emite
        # download_complete([], '') quando não há resultados)
        self.confirm_downloads()

    def shutdown(self, wait_ms=10000):
        """Encerramento seguro ao fechar a janela: cancela e ESPERA as threads.

        Garante que nenhuma QThread continue viva sem referência após o
        ImpressaoManager/diálogo serem destruídos (causa de crash nativo).
        """
        self._shutdown = True
        self.is_cancelled = True
        self._pending_files = []

        for thread in self._active_threads:
            if thread.isRunning():
                thread.cancel()
        for thread in self._active_threads:
            if thread.isRunning():
                thread.wait(wait_ms)

        self._cleanup_finished_threads()
        self.current_transfer = None

    def has_active_threads(self):
        """True se ainda há threads de transferência em execução."""
        return any(t.isRunning() for t in self._active_threads)

    @staticmethod
    def calculate_checksum(file_path):
        """Calcula o checksum SHA-256 de um arquivo."""
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
        """Soma o tamanho estimado dos arquivos em MB."""
        total_size = 0
        for file_info in file_infos:
            if file_info.get('tamanho_mb') is not None:
                total_size += float(file_info['tamanho_mb'])
            else:
                total_size += 10
        return total_size
