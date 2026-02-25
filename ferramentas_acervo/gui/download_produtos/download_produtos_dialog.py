# Path: gui\download_produtos\download_produtos_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (QDialog, QMessageBox, QFileDialog, 
                                QCheckBox, QVBoxLayout, QHBoxLayout, QLabel)
from qgis.PyQt.QtCore import Qt, QDir
from qgis.core import QgsProject, QgsVectorLayer, QgsMapLayerType
from .download_manager import DownloadManager

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'download_produtos_dialog.ui'))

class DownloadProdutosDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        """Initialize the dialog."""
        super(DownloadProdutosDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        
        # Initialize the download manager
        self.download_manager = DownloadManager(api_client)
        
        # Initialize variables
        self.products = []
        self.file_infos = []
        self.file_type_checkboxes = {}
        self.download_in_progress = False
        
        # Setup UI
        self.setup_ui()
        
        # Connect signals
        self.setup_signals()
        
        # Load selected products
        self.load_selected_products()
        
    def setup_ui(self):
        """Setup the user interface."""
        self.setWindowTitle("Download de Produtos")
        
        # Initial state of UI elements
        self.progressGroupBox.setVisible(False)
        self.closeButton.setEnabled(True)
        self.cancelButton.setEnabled(False)
        self.downloadButton.setEnabled(False)
        
        # Setup file type checkboxes (to be populated dynamically)
        self.setup_file_types()
        
    def setup_signals(self):
        """Connect signals to slots."""
        # Button connections
        self.closeButton.clicked.connect(self.handle_close)
        self.cancelButton.clicked.connect(self.cancel_download)
        self.downloadButton.clicked.connect(self.start_download)
        self.browseButton.clicked.connect(self.browse_destination)
        
        # Download manager connections
        self.download_manager.prepare_complete.connect(self.handle_prepare_complete)
        self.download_manager.download_progress.connect(self.update_overall_progress)
        self.download_manager.file_progress.connect(self.update_file_progress)
        self.download_manager.file_complete.connect(self.handle_file_complete)
        self.download_manager.download_complete.connect(self.handle_download_complete)
        self.download_manager.download_error.connect(self.handle_download_error)
        
    def setup_file_types(self):
        """Setup file type checkboxes fetching from API."""
        # Clear existing layout
        layout = self.fileTypeGroupBox.layout()
        if layout is not None:
            while layout.count():
                item = layout.takeAt(0)
                if item.widget():
                    item.widget().deleteLater()
        else:
            layout = QVBoxLayout(self.fileTypeGroupBox)
        
        try:
            # Fetch file types from API
            response = self.api_client.get('gerencia/dominio/tipo_arquivo')
            if response and 'dados' in response:
                file_types = response['dados']
                
                # Create a layout with 3 columns
                row_layout = None
                for i, file_type in enumerate(file_types):
                    if i % 3 == 0:
                        row_layout = QHBoxLayout()
                        layout.addLayout(row_layout)
                    
                    checkbox = QCheckBox(file_type["nome"])
                    checkbox.setChecked(True)  # Default to checked
                    checkbox.stateChanged.connect(self.update_file_summary)
                    self.file_type_checkboxes[str(file_type["code"])] = checkbox
                    row_layout.addWidget(checkbox)
                    
                    if i % 3 == 2 or i == len(file_types) - 1:
                        # Add stretch to fill remaining space in the row
                        row_layout.addStretch()
            else:
                self.create_default_file_types(layout)
                QMessageBox.warning(self, "Aviso", "Não foi possível carregar os tipos de arquivo do servidor.")
        except Exception as e:
            self.create_default_file_types(layout)
            QMessageBox.warning(self, "Aviso", f"Erro ao carregar tipos de arquivo: {str(e)}")
            
    def create_default_file_types(self, layout):
        """Create default file types as fallback."""
        file_types = [
            {"code": "1", "nome": "Arquivo principal"},
            {"code": "2", "nome": "Formato alternativo"},
            {"code": "4", "nome": "Metadados"}
        ]
        
        row_layout = QHBoxLayout()
        layout.addLayout(row_layout)
        
        for file_type in file_types:
            checkbox = QCheckBox(file_type["nome"])
            checkbox.setChecked(True)
            checkbox.stateChanged.connect(self.update_file_summary)
            self.file_type_checkboxes[file_type["code"]] = checkbox
            row_layout.addWidget(checkbox)
        
        row_layout.addStretch()
    
    def load_selected_products(self):
        """Load selected products from the active layer."""
        # Get active layer
        active_layer = self.iface.activeLayer()
        
        if not active_layer or active_layer.type() != QgsMapLayerType.VectorLayer:
            QMessageBox.warning(
                self,
                "Aviso",
                "Selecione uma camada de produtos válida."
            )
            return
            
        # Get selected features
        selected_features = active_layer.selectedFeatures()
        
        if not selected_features:
            QMessageBox.warning(
                self,
                "Aviso",
                "Selecione pelo menos um produto para download."
            )
            return
            
        # Extract product IDs (assuming 'id' field exists)
        try:
            product_ids = [feature['id'] for feature in selected_features]
            self.products = product_ids
            
            # Update UI with product count
            self.selectedProductsLabel.setText(f"Produtos selecionados: {len(product_ids)}")
            
            # Prepare download (get file info from server)
            self.statusLabel.setText("Preparando download...")
            
            # Get selected file types
            selected_types = [int(type_id) for type_id, checkbox in self.file_type_checkboxes.items() 
                              if checkbox.isChecked()]
            
            self.download_manager.prepare_download(product_ids, selected_types)
            
        except Exception as e:
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao obter produtos: {str(e)}"
            )
            
    def handle_prepare_complete(self, file_infos):
        """Handle completion of download preparation."""
        self.file_infos = file_infos

        # Atualizar labels de resumo diretamente (sem chamar update_file_summary
        # para evitar loop infinito prepare→complete→summary→prepare)
        self._refresh_file_summary_ui()

        # Update status
        if file_infos:
            self.statusLabel.setText("Pronto para download. Selecione os tipos de arquivo desejados.")
        else:
            self.statusLabel.setText("Nenhum arquivo disponível para os produtos selecionados.")

    def _refresh_file_summary_ui(self):
        """Atualiza os labels de resumo e estado do botão de download sem re-preparar."""
        self.fileCountValueLabel.setText(str(len(self.file_infos)))

        total_size_mb = self.download_manager.get_total_size_mb(self.file_infos)
        if total_size_mb > 1024:
            size_text = f"{total_size_mb / 1024:.2f} GB"
        else:
            size_text = f"{total_size_mb:.2f} MB"
        self.totalSizeValueLabel.setText(size_text)

        has_destination = bool(self.destinationLineEdit.text())
        has_files = len(self.file_infos) > 0
        self.downloadButton.setEnabled(has_destination and has_files and not self.download_in_progress)

    def update_file_summary(self):
        """Update file count and size summary based on selected file types.
        Chamado quando checkboxes de tipo de arquivo mudam."""
        # Get selected file types
        selected_types = [int(type_id) for type_id, checkbox in self.file_type_checkboxes.items()
                          if checkbox.isChecked()]

        if not selected_types:
            self.fileCountValueLabel.setText("0")
            self.totalSizeValueLabel.setText("0 MB")
            self.downloadButton.setEnabled(False)
            return

        # Re-preparar download com os novos tipos selecionados
        if self.products:
            self.statusLabel.setText("Atualizando lista de arquivos...")
            self.download_manager.prepare_download(self.products, selected_types)
            return

        # Sem produtos carregados, apenas atualizar UI
        self._refresh_file_summary_ui()
        
    def browse_destination(self):
        """Open file dialog to select destination directory."""
        start_dir = QDir.homePath()
        
        # If there's already a destination, start from there
        current_dest = self.destinationLineEdit.text()
        if current_dest and os.path.isdir(current_dest):
            start_dir = current_dest
            
        # Open directory selection dialog
        directory = QFileDialog.getExistingDirectory(
            self,
            "Selecione a Pasta de Destino",
            start_dir,
            QFileDialog.ShowDirsOnly
        )
        
        if directory:
            self.destinationLineEdit.setText(directory)
            # Check if download button should be enabled
            self.update_file_summary()
            
    def start_download(self):
        """Start the download process."""
        if not self.file_infos:
            QMessageBox.warning(
                self,
                "Aviso",
                "Nenhum arquivo selecionado para download."
            )
            return
            
        # Get destination directory
        destination_dir = self.destinationLineEdit.text()
        
        if not destination_dir or not os.path.isdir(destination_dir):
            QMessageBox.warning(
                self,
                "Aviso",
                "Selecione uma pasta de destino válida."
            )
            return
            
        # Update UI for download in progress
        self.download_in_progress = True
        self.progressGroupBox.setVisible(True)
        self.downloadButton.setEnabled(False)
        self.cancelButton.setEnabled(True)
        self.closeButton.setEnabled(False)
        
        # Reset progress bars
        self.fileProgressBar.setValue(0)
        self.overallProgressBar.setValue(0)
        
        # Start download
        self.statusLabel.setText("Iniciando downloads...")
        self.download_manager.start_download(self.file_infos, destination_dir)
        
    def cancel_download(self):
        """Cancel the download process."""
        reply = QMessageBox.question(
            self,
            "Confirmar Cancelamento",
            "Tem certeza que deseja cancelar os downloads em andamento?",
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No
        )
        
        if reply == QMessageBox.Yes:
            self.statusLabel.setText("Cancelando downloads...")
            self.download_manager.cancel_downloads()
            
    def update_overall_progress(self, current, total):
        """Update the overall progress bar."""
        self.overallProgressBar.setMaximum(total)
        self.overallProgressBar.setValue(current)
        self.overallProgressLabel.setText(f"Progresso total: {current}/{total} arquivos")
        
    def update_file_progress(self, current_bytes, total_bytes, filename):
        """Update the current file progress bar."""
        if total_bytes > 0:
            percent = int((current_bytes / total_bytes) * 100)
            self.fileProgressBar.setValue(percent)
            
        self.currentFileLabel.setText(f"Baixando: {filename}")
        
    def handle_file_complete(self, file_name, success):
        """Handle completion of a file download."""
        status_text = f"Arquivo {file_name} baixado com " + ("sucesso" if success else "falha")
        self.statusLabel.setText(status_text)
        
    def handle_download_complete(self, results):
        """Handle completion of all downloads."""
        # Count successes and failures
        successes = sum(1 for r in results if r['success'])
        failures = len(results) - successes
        
        # Update UI
        self.download_in_progress = False
        self.downloadButton.setEnabled(True)
        self.cancelButton.setEnabled(False)
        self.closeButton.setEnabled(True)
        
        # Show completion message
        if failures == 0:
            self.statusLabel.setText(f"Download concluído: {successes} arquivos baixados com sucesso.")
            QMessageBox.information(
                self,
                "Download Concluído",
                f"Todos os {successes} arquivos foram baixados com sucesso."
            )
        else:
            self.statusLabel.setText(f"Download concluído: {successes} sucesso, {failures} falhas.")
            
            # Create detailed error message
            error_details = "Os seguintes arquivos não puderam ser baixados:\n\n"
            for result in results:
                if not result['success']:
                    error_details += f"- {result['nome']}: {result['error_message']}\n"
                    
            QMessageBox.warning(
                self,
                "Download Parcial",
                f"{successes} arquivo(s) baixado(s) com sucesso, {failures} falha(s).\n\n{error_details}"
            )
            
    def handle_download_error(self, error_message):
        """Handle download error."""
        self.download_in_progress = False
        self.downloadButton.setEnabled(True)
        self.cancelButton.setEnabled(False)
        self.closeButton.setEnabled(True)
        
        self.statusLabel.setText(f"Erro: {error_message}")
        
        QMessageBox.critical(
            self,
            "Erro de Download",
            f"Ocorreu um erro durante o download: {error_message}"
        )
        
    def handle_close(self):
        """Handle close button click."""
        if self.download_in_progress:
            reply = QMessageBox.question(
                self,
                "Confirmar Fechamento",
                "Há downloads em andamento. Tem certeza que deseja fechar?",
                QMessageBox.Yes | QMessageBox.No,
                QMessageBox.No
            )
            
            if reply == QMessageBox.Yes:
                self.download_manager.cancel_downloads()
                self.reject()
        else:
            self.accept()
            
    def showEvent(self, event):
        """Handle show event to load products when dialog is shown."""
        super().showEvent(event)
        
        # If no products are loaded, try to load them
        if not self.products:
            self.load_selected_products()