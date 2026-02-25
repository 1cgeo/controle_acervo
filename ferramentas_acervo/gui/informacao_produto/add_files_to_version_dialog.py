# Path: gui\informacao_produto\add_files_to_version_dialog.py
import os
import hashlib
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (
    QDialog, QMessageBox, QVBoxLayout, QHBoxLayout, 
    QTableWidgetItem, QHeaderView, QFileDialog
)
from qgis.PyQt.QtCore import Qt
from ...core.file_transfer import FileTransferThread

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'add_files_to_version_dialog.ui'))

class AddFilesToVersionDialog(QDialog, FORM_CLASS):
    def __init__(self, api_client, versao_data, parent=None):
        """
        Inicializa o diálogo para adicionar arquivos a uma versão existente.
        
        Args:
            api_client: Cliente da API
            versao_data (dict): Dados da versão
            parent: Widget pai
        """
        super(AddFilesToVersionDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.versao_data = versao_data
        self.arquivos = []
        self.transfer_threads = []
        
        self.setup_ui()
        self.load_tipo_arquivo()
        
    def setup_ui(self):
        """Configura a interface de usuário."""
        self.setWindowTitle(f"Adicionar Arquivos à Versão: {self.versao_data['versao']} - {self.versao_data['nome_versao']}")
        self.resize(800, 600)
        
        # Esconder progresso inicialmente
        self.progressGroupBox.setVisible(False)
        
        # Configurar tabela de arquivos
        self.filesTable.setColumnCount(5)
        self.filesTable.setHorizontalHeaderLabels(['Nome', 'Arquivo', 'Tipo', 'Tamanho (MB)', 'Caminho'])
        self.filesTable.horizontalHeader().setSectionResizeMode(0, QHeaderView.Stretch)
        self.filesTable.horizontalHeader().setSectionResizeMode(1, QHeaderView.Stretch)
        self.filesTable.horizontalHeader().setSectionResizeMode(4, QHeaderView.Stretch)
        
        # Conectar botões
        self.addFileButton.clicked.connect(self.add_file)
        self.removeFileButton.clicked.connect(self.remove_file)
        self.uploadButton.clicked.connect(self.start_upload_process)
        self.cancelButton.clicked.connect(self.reject)
        
    def load_tipo_arquivo(self):
        """Carrega os tipos de arquivo do servidor."""
        try:
            response = self.api_client.get('gerencia/dominio/tipo_arquivo')
            if response and 'dados' in response:
                self.tipoArquivoComboBox.clear()
                for tipo in response['dados']:
                    self.tipoArquivoComboBox.addItem(tipo['nome'], tipo['code'])
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível carregar os tipos de arquivo.")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar tipos de arquivo: {str(e)}")
        
    def add_file(self):
        """Adiciona um novo arquivo à lista."""
        file_path, _ = QFileDialog.getOpenFileName(
            self, "Selecionar Arquivo", "", "Todos os Arquivos (*.*)"
        )
        
        if not file_path:
            return
        
        # Calcular o checksum do arquivo
        checksum = self.calculate_checksum(file_path)
        
        # Obter informações do arquivo
        filename = os.path.basename(file_path)
        nome_arquivo, extensao = os.path.splitext(filename)
        extensao = extensao[1:] if extensao.startswith('.') else extensao
        
        tipo_arquivo_id = self.tipoArquivoComboBox.currentData()
        tipo_arquivo_nome = self.tipoArquivoComboBox.currentText()
        
        file_info = {
            "nome": nome_arquivo,
            "nome_arquivo": nome_arquivo,
            "extensao": extensao,
            "tipo_arquivo_id": tipo_arquivo_id,
            "tipo_arquivo_nome": tipo_arquivo_nome,
            "tamanho_mb": os.path.getsize(file_path) / (1024 * 1024),
            "path": file_path,
            "checksum": checksum,
            "metadado": {},
            "situacao_carregamento_id": 1,  # Não carregado por padrão
            "descricao": self.descriptionTextEdit.toPlainText(),
            "crs_original": self.crsLineEdit.text()
        }
        
        # Adicionar à lista de arquivos
        self.arquivos.append(file_info)
        
        # Atualizar a tabela
        self.update_files_table()
        
    def remove_file(self):
        """Remove o arquivo selecionado da lista."""
        selected_rows = self.filesTable.selectionModel().selectedRows()
        if not selected_rows:
            QMessageBox.warning(self, "Aviso", "Selecione um arquivo para remover.")
            return
        
        # Remover arquivo da lista (em ordem reversa para evitar problemas com índices)
        indices_to_remove = sorted([index.row() for index in selected_rows], reverse=True)
        for index in indices_to_remove:
            if index < len(self.arquivos):
                del self.arquivos[index]
        
        # Atualizar a tabela
        self.update_files_table()
        
    def update_files_table(self):
        """Atualiza a tabela de arquivos."""
        self.filesTable.setRowCount(len(self.arquivos))
        
        for row, file_info in enumerate(self.arquivos):
            # Nome
            self.filesTable.setItem(row, 0, QTableWidgetItem(file_info['nome']))
            
            # Nome do arquivo com extensão
            file_name_ext = f"{file_info['nome_arquivo']}.{file_info['extensao']}"
            self.filesTable.setItem(row, 1, QTableWidgetItem(file_name_ext))
            
            # Tipo de arquivo
            self.filesTable.setItem(row, 2, QTableWidgetItem(file_info['tipo_arquivo_nome']))
            
            # Tamanho
            tamanho = f"{file_info['tamanho_mb']:.2f}"
            self.filesTable.setItem(row, 3, QTableWidgetItem(tamanho))
            
            # Caminho
            self.filesTable.setItem(row, 4, QTableWidgetItem(file_info['path']))
        
        # Habilitar/desabilitar botão de upload baseado em ter arquivos
        self.uploadButton.setEnabled(len(self.arquivos) > 0)
        
    def calculate_checksum(self, file_path):
        """Calcula o checksum SHA-256 de um arquivo."""
        sha256_hash = hashlib.sha256()
        try:
            with open(file_path, "rb") as f:
                for byte_block in iter(lambda: f.read(4096), b""):
                    sha256_hash.update(byte_block)
            return sha256_hash.hexdigest()
        except Exception as e:
            QMessageBox.warning(self, "Erro", f"Não foi possível calcular o checksum: {str(e)}")
            return ""
    
    def start_upload_process(self):
        """Inicia o processo de upload."""
        if not self.arquivos:
            QMessageBox.warning(self, "Aviso", "Adicione pelo menos um arquivo para upload.")
            return
        
        try:
            # Fase 1: Preparação
            self.statusLabel.setText("Preparando upload...")
            self.progressGroupBox.setVisible(True)
            self.progressBar.setValue(0)
            
            # Desabilitar interface durante upload
            self.uploadButton.setEnabled(False)
            self.addFileButton.setEnabled(False)
            self.removeFileButton.setEnabled(False)
            self.setCursor(Qt.WaitCursor)
            
            # Preparar dados para a API
            prepared_data = {
                "arquivos": []
            }

            for arquivo in self.arquivos:
                arquivo_data = {
                    "versao_id": self.versao_data['versao_id'],
                    "nome": arquivo['nome'],
                    "nome_arquivo": arquivo['nome_arquivo'],
                    "tipo_arquivo_id": arquivo['tipo_arquivo_id'],
                    "extensao": arquivo['extensao'],
                    "tamanho_mb": arquivo['tamanho_mb'],
                    "checksum": arquivo['checksum'],
                    "metadado": arquivo['metadado'],
                    "situacao_carregamento_id": arquivo['situacao_carregamento_id'],
                    "descricao": arquivo['descricao'],
                    "crs_original": arquivo['crs_original']
                }
                prepared_data["arquivos"].append(arquivo_data)
            
            # Enviar requisição de preparação
            response = self.api_client.post('arquivo/prepare-upload/files', prepared_data)
            
            if response and 'dados' in response:
                # Extrair dados de resposta
                session_uuid = response['dados']['session_uuid']
                arquivos_info = response['dados']['arquivos']
                
                # Configurar barra de progresso
                self.progressBar.setMaximum(len(arquivos_info))
                
                # Fase 2: Transferência
                self.statusLabel.setText(f"Iniciando transferência de {len(arquivos_info)} arquivos...")
                
                # Iniciar threads de transferência
                self.transfer_threads = []
                self.arquivos_transferidos = 0
                self.arquivos_com_falha = 0
                self.failed_transfers = []
                
                for arquivo_info in arquivos_info:
                    # Encontrar o arquivo local correspondente
                    arquivo_local = next(
                        (a for a in self.arquivos if a['nome'] == arquivo_info['nome']), 
                        None
                    )
                    
                    if arquivo_local:
                        thread = FileTransferThread(
                            arquivo_local['path'],
                            arquivo_info['destination_path'],
                            arquivo_info['checksum']
                        )
                        thread.progress_update.connect(self.update_file_progress)
                        thread.file_transferred.connect(self.file_transfer_complete)
                        self.transfer_threads.append(thread)
                        thread.start()
                
                # Armazenar UUID da sessão para confirmação após transferência
                self.current_session_uuid = session_uuid
            else:
                raise Exception("Resposta inválida do servidor")
                
        except Exception as e:
            self.statusLabel.setText(f"Erro: {str(e)}")
            self.progressGroupBox.setVisible(False)
            self.uploadButton.setEnabled(True)
            self.addFileButton.setEnabled(True)
            self.removeFileButton.setEnabled(True)
            self.setCursor(Qt.ArrowCursor)
            QMessageBox.critical(self, "Erro", f"Falha na preparação do upload: {str(e)}")
    
    def update_file_progress(self, current_bytes, total_bytes):
        """Atualiza o progresso de transferência de um arquivo."""
        # Este método pode ser usado para mostrar o progresso de um arquivo específico
        pass
    
    def file_transfer_complete(self, success, file_path, identifier):
        """Manipula conclusão da transferência de um arquivo."""
        self.arquivos_transferidos += 1
        if not success:
            self.arquivos_com_falha += 1
            for thread in self.transfer_threads:
                if thread.destination_path == file_path:
                    self.failed_transfers.append({
                        'source_path': thread.source_path,
                        'destination_path': thread.destination_path,
                        'identifier': thread.identifier
                    })
                    break
        self.progressBar.setValue(self.arquivos_transferidos)

        # Se todos os arquivos foram transferidos, verificar sucesso antes de confirmar
        if self.arquivos_transferidos == len(self.transfer_threads):
            if self.arquivos_com_falha > 0:
                reply = QMessageBox.question(
                    self, "Falha na Transferência",
                    f"{self.arquivos_com_falha} arquivo(s) falharam na transferência.\n"
                    "Deseja tentar novamente apenas os arquivos que falharam?",
                    QMessageBox.Yes | QMessageBox.No
                )
                if reply == QMessageBox.Yes:
                    self._retry_failed_transfers()
                else:
                    self.statusLabel.setText(f"Erro: {self.arquivos_com_falha} arquivo(s) falharam")
                    self.uploadButton.setEnabled(True)
                    self.addFileButton.setEnabled(True)
                    self.removeFileButton.setEnabled(True)
                    self.setCursor(Qt.ArrowCursor)
            else:
                self.confirm_upload()

    def _retry_failed_transfers(self):
        """Retenta apenas os arquivos que falharam na transferência."""
        failed = self.failed_transfers[:]
        self.failed_transfers = []
        self.transfer_threads = []
        self.arquivos_transferidos = 0
        self.arquivos_com_falha = 0

        self.progressBar.setMaximum(len(failed))
        self.progressBar.setValue(0)
        self.statusLabel.setText(f"Retentando {len(failed)} arquivo(s)...")

        for info in failed:
            thread = FileTransferThread(
                info['source_path'],
                info['destination_path'],
                info['identifier']
            )
            thread.progress_update.connect(self.update_file_progress)
            thread.file_transferred.connect(self.file_transfer_complete)
            self.transfer_threads.append(thread)
            thread.start()
    
    def confirm_upload(self):
        """Confirma o upload após transferência dos arquivos."""
        try:
            self.statusLabel.setText("Confirmando upload...")
            
            # Enviar confirmação
            response = self.api_client.post('arquivo/confirm-upload', {'session_uuid': self.current_session_uuid})
            
            if response and response.get('success'):
                self.statusLabel.setText("Upload concluído com sucesso!")
                self.setCursor(Qt.ArrowCursor)
                QMessageBox.information(self, "Sucesso", "Arquivos carregados com sucesso!")
                self.accept()
            else:
                error_message = "Falha na confirmação do upload"
                if response and 'message' in response:
                    error_message = response['message']
                raise Exception(error_message)
                
        except Exception as e:
            self.statusLabel.setText(f"Erro na confirmação: {str(e)}")
            self.uploadButton.setEnabled(True)
            self.addFileButton.setEnabled(True)
            self.removeFileButton.setEnabled(True)
            self.setCursor(Qt.ArrowCursor)
            QMessageBox.critical(self, "Erro", f"Falha na confirmação do upload: {str(e)}")