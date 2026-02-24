# Path: gui\download_produtos\download_manager.py
import os
import hashlib
from qgis.PyQt.QtCore import QObject, pyqtSignal, QThread
from ...core.file_transfer import FileTransferThread

class DownloadManager(QObject):
    """
    Class to manage the download of products files, handling preparation,
    download and confirmation with the server.
    """
    
    # Signals
    prepare_complete = pyqtSignal(list)
    download_progress = pyqtSignal(int, int)  # current, total
    file_progress = pyqtSignal(int, int, str)  # current_bytes, total_bytes, filename
    file_complete = pyqtSignal(str, bool)  # file_path, success
    download_complete = pyqtSignal(list)  # results
    download_error = pyqtSignal(str)  # error_message
    
    def __init__(self, api_client):
        super(DownloadManager, self).__init__()
        self.api_client = api_client
        self.active_transfers = []
        self.download_results = []
        self.is_cancelled = False
        
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
        """Start downloading files to the specified destination directory."""
        self.is_cancelled = False
        self.download_results = []
        
        # Create destination directory if it doesn't exist
        if not os.path.exists(destination_dir):
            os.makedirs(destination_dir)
            
        total_files = len(file_infos)
        
        for index, file_info in enumerate(file_infos):
            if self.is_cancelled:
                break
                
            file_path = file_info['download_path']
            arquivo_id = file_info['arquivo_id']
            nome_arquivo = file_info['nome']
            download_token = file_info['download_token']
            checksum = file_info['checksum']
            
            # Create destination file path
            dest_file_path = os.path.join(destination_dir, os.path.basename(file_path))
            
            # Update progress
            self.download_progress.emit(index, total_files)
            
            # Create and start file transfer thread
            transfer_thread = FileTransferThread(file_path, dest_file_path, download_token)
            transfer_thread.progress_update.connect(lambda current, total, file=nome_arquivo: 
                                                  self.file_progress.emit(current, total, file))
            transfer_thread.file_transferred.connect(self.handle_file_transfer_complete)
            
            self.active_transfers.append({
                'thread': transfer_thread,
                'file_info': {
                    'arquivo_id': arquivo_id,
                    'nome': nome_arquivo,
                    'path': dest_file_path,
                    'download_token': download_token,
                    'checksum': checksum
                }
            })
            
            transfer_thread.start()
            
    def handle_file_transfer_complete(self, success, file_path, identifier):
        """Handle completion of a file transfer."""
        # Find the transfer info
        transfer_info = next((t for t in self.active_transfers 
                             if t['file_info']['download_token'] == identifier), None)
        
        if not transfer_info:
            return
            
        # Check if transfer was successful
        if success:
            # Verify checksum
            calculated_checksum = self.calculate_checksum(file_path)
            expected_checksum = transfer_info['file_info']['checksum']
            
            if calculated_checksum != expected_checksum:
                success = False
                error_message = "Falha na verificação de integridade (checksum não corresponde)"
            else:
                error_message = None
        else:
            error_message = "Falha na transferência do arquivo"
            
        # Add to results
        result = {
            'download_token': identifier,
            'success': success,
            'error_message': error_message,
            'file_path': file_path,
            'nome': transfer_info['file_info']['nome']
        }
        
        self.download_results.append(result)
        
        # Signal completion
        self.file_complete.emit(transfer_info['file_info']['nome'], success)
        
        # Remove from active transfers
        transfer_thread = transfer_info['thread']
        self.active_transfers.remove(transfer_info)
        
        # Check if all downloads are complete
        if not self.active_transfers:
            self.confirm_downloads()
    
    def confirm_downloads(self):
        """Confirm downloads with the server."""
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
        
        for transfer_info in self.active_transfers:
            thread = transfer_info['thread']
            if thread.isRunning():
                thread.terminate()
                
        self.active_transfers = []
        
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
            # Usar o tamanho real do arquivo se disponível nos metadados
            if 'tamanho_mb' in file_info and file_info['tamanho_mb'] is not None:
                total_size += float(file_info['tamanho_mb'])
            else:
                # Fallback para estimativa conservadora
                total_size += 10  # 10MB como estimativa base
        return total_size