# Path: gui\download_produtos\download_produtos_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import (QDialog, QMessageBox, QFileDialog, QCheckBox, QLabel,
                                 QVBoxLayout, QHBoxLayout)
from qgis.PyQt.QtCore import QDir, QTimer
from qgis.core import QgsMapLayerType
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
        # Pasta escolhida e "o próximo prepare-download termina em download".
        # Ver o comentário de start_download.
        self._destino_escolhido = ''
        self._baixar_apos_preparar = False

        # Um disparo só depois da última caixa marcada. Ver agendar_resumo.
        self._resumo_timer = QTimer(self)
        self._resumo_timer.setSingleShot(True)
        self._resumo_timer.timeout.connect(self.update_file_summary)

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
                    checkbox.stateChanged.connect(self.agendar_resumo)
                    self.file_type_checkboxes[str(file_type["code"])] = checkbox
                    row_layout.addWidget(checkbox)

                    if i % 3 == 2 or i == len(file_types) - 1:
                        # Add stretch to fill remaining space in the row
                        row_layout.addStretch()
            else:
                self.sem_tipos_de_arquivo(layout)
        except Exception as e:
            self.sem_tipos_de_arquivo(layout, str(e))

    def sem_tipos_de_arquivo(self, layout, detalhe=''):
        """Diz que a lista de tipos não veio, em vez de inventar uma.

        NÃO existe lista de reserva escrita aqui. Os códigos de tipo de arquivo
        são domínio do servidor, e uma lista fixa no cliente faria a tela pedir
        o download de um código que pode ter mudado de significado.
        """
        aviso = QLabel(
            "Não foi possível carregar os tipos de arquivo do servidor.\n"
            "Feche esta janela, confira a conexão e abra de novo."
        )
        aviso.setWordWrap(True)
        layout.addWidget(aviso)
        self.downloadButton.setEnabled(False)
        QMessageBox.warning(
            self, "Tipos de arquivo indisponíveis",
            "A lista de tipos de arquivo não veio do servidor, e sem ela o download "
            "não sabe o que pedir."
            + (f"\n\nCausa: {detalhe}" if detalhe else "")
            + "\n\nConfira a conexão com o servidor e abra a janela de novo."
        )


    def load_selected_products(self):
        """Load selected products from the active layer."""
        # Get active layer
        active_layer = self.iface.activeLayer()
        
        if not active_layer or active_layer.type() != QgsMapLayerType.VectorLayer:
            QMessageBox.warning(
                self, "Selecione a camada",
                "Nenhuma camada de produtos está ativa.\n\n"
                "Carregue as camadas por 'Carregar Camadas de Produtos', clique na "
                "camada no painel de camadas para deixá-la ativa, selecione os produtos "
                "no mapa e abra esta janela de novo."
            )
            self.statusLabel.setText("Nenhuma camada de produtos ativa.")
            return

        # Get selected features
        selected_features = active_layer.selectedFeatures()

        if not selected_features:
            QMessageBox.warning(
                self, "Selecione os produtos",
                f"Nenhuma feição está selecionada na camada '{active_layer.name()}'.\n\n"
                "Selecione no mapa os produtos que quer baixar e abra esta janela de novo."
            )
            self.statusLabel.setText("Nenhum produto selecionado.")
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

        # Prepare pedido pelo botão Download: seguir direto para a cópia, com os
        # tokens que acabaram de ser reservados.
        if self._baixar_apos_preparar:
            self._baixar_apos_preparar = False
            if not file_infos:
                self._encerrar_estado_de_download()
                self.statusLabel.setText("Nenhum arquivo disponível para os produtos selecionados.")
                QMessageBox.warning(
                    self, "Nada para baixar",
                    "O servidor não reservou nenhum arquivo para os produtos e os "
                    "tipos escolhidos. Confira os tipos marcados e tente de novo."
                )
                return
            self.statusLabel.setText("Iniciando downloads...")
            self.download_manager.start_download(self.file_infos, self._destino_escolhido)
            return

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

    def agendar_resumo(self):
        """Adia o re-prepare até a pessoa parar de marcar caixas.

        Cada `prepare-download` RESERVA tokens de 24 horas no servidor e é uma
        chamada de rede na thread da interface. Marcar oito tipos de arquivo em
        seguida dispararia oito chamadas, e sete conjuntos de token que ninguém
        vai confirmar.
        """
        self._resumo_timer.start(500)

    def update_file_summary(self):
        """Refaz o resumo (contagem, tamanho) para os tipos marcados."""
        # Não re-preparar a lista durante um download em andamento: isso
        # substituiria file_infos/tokens no meio do processo
        if self.download_in_progress:
            return

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
            QFileDialog.Option.ShowDirsOnly
        )
        
        if directory:
            self.destinationLineEdit.setText(directory)
            # SÓ a interface. `update_file_summary` refaria o prepare-download, e
            # cada prepare RESERVA um lote de tokens de 24 horas no servidor:
            # trocar de pasta três vezes antes de baixar deixaria três lotes
            # pendentes que ninguém vai confirmar. A pasta não muda a lista de
            # arquivos, então aqui basta repintar os rótulos e o botão.
            self._refresh_file_summary_ui()
            
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
        self._destino_escolhido = destination_dir

        # Reset progress bars
        self.fileProgressBar.setValue(0)
        self.overallProgressBar.setValue(0)

        # O TOKEN SE GASTA NA PRIMEIRA RODADA. Cancelar depois de 3 de 10
        # arquivos e clicar em Download de novo reenviava os MESMOS
        # download_token, inclusive os três já confirmados: o servidor recusa o
        # que não está mais `pending` e a tela anunciava "N token(s) de download
        # expiraram" no fim de um download que copiou tudo. Cada rodada refaz o
        # prepare e ganha tokens novos, como o plugin da mapoteca já faz.
        selected_types = [int(type_id) for type_id, checkbox in self.file_type_checkboxes.items()
                          if checkbox.isChecked()]
        if self.products and selected_types:
            self._baixar_apos_preparar = True
            self.statusLabel.setText("Reservando os arquivos no servidor...")
            self.download_manager.prepare_download(self.products, selected_types)
            return

        # Sem lista de produtos (a janela foi alimentada arquivo a arquivo): usar
        # os tokens que já estão em mãos.
        self.statusLabel.setText("Iniciando downloads...")
        self.download_manager.start_download(self.file_infos, destination_dir)
        
    def cancel_download(self):
        """Cancel the download process."""
        reply = QMessageBox.question(
            self,
            "Confirmar Cancelamento",
            "Tem certeza que deseja cancelar os downloads em andamento?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        
        if reply == QMessageBox.StandardButton.Yes:
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
        
    def _encerrar_estado_de_download(self):
        """Devolve a janela ao estado de repouso, em qualquer desfecho."""
        self.download_in_progress = False
        self._baixar_apos_preparar = False
        self.downloadButton.setEnabled(True)
        self.cancelButton.setEnabled(False)
        self.closeButton.setEnabled(True)

    def handle_download_complete(self, results):
        """Handle completion of all downloads."""
        # Count successes and failures
        successes = sum(1 for r in results if r['success'])
        failures = len(results) - successes
        cancelado = self.download_manager.is_cancelled
        total = len(self.file_infos)

        # Update UI
        self._encerrar_estado_de_download()

        # Lista VAZIA é o cancelamento antes de o primeiro arquivo terminar.
        # Sem este caso, a tela anunciava "Todos os 0 arquivos foram baixados
        # com sucesso" para quem acabara de cancelar.
        if not results:
            self.statusLabel.setText("Download cancelado: nenhum arquivo foi baixado.")
            QMessageBox.information(
                self, "Download cancelado",
                "O download foi cancelado antes de qualquer arquivo terminar. "
                "Nenhum arquivo foi gravado na pasta de destino."
            )
            return

        # CANCELADO NO MEIO não é concluído. Sem este caso, cancelar depois de 3
        # de 10 arquivos abria a caixa "Download Concluído: todos os 3 arquivos
        # foram baixados com sucesso", e nada na tela dizia que 7 ficaram para
        # trás.
        if cancelado:
            self.statusLabel.setText(
                f"Download cancelado: {successes} de {total} arquivo(s) baixados."
            )
            texto = f"{successes} de {total} arquivo(s) baixados antes do cancelamento."
            if failures:
                texto += f"\n\n{failures} arquivo(s) falharam antes do cancelamento."
            texto += (
                "\n\nOs arquivos incompletos foram descartados da pasta de destino. "
                "Para pegar o que faltou, clique em Download de novo."
            )
            QMessageBox.information(self, "Download cancelado", texto)
            return

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
        self._encerrar_estado_de_download()
        
        self.statusLabel.setText(f"Erro: {error_message}")
        
        QMessageBox.critical(
            self,
            "Erro de Download",
            f"Ocorreu um erro durante o download: {error_message}"
        )
        
    def handle_close(self):
        """Handle close button click.

        Apenas dispara o fechamento. A confirmação e a parada segura das
        threads acontecem em closeEvent, que também cobre o X da janela.
        """
        self.close()

    def closeEvent(self, event):
        """Garante o encerramento seguro das threads antes de destruir o diálogo.

        O diálogo é criado com WA_DeleteOnClose: fechá-lo com threads de
        transferência ativas permitia que o GC destruísse um QThread em
        execução, derrubando o QGIS (crash nativo, sem traceback).
        """
        if self.download_in_progress:
            reply = QMessageBox.question(
                self,
                "Confirmar Fechamento",
                "Há downloads em andamento. Tem certeza que deseja fechar?",
                QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
                QMessageBox.StandardButton.No
            )

            if reply != QMessageBox.StandardButton.Yes:
                event.ignore()
                return

            self.download_in_progress = False

        # Cancela e aguarda as threads de transferência finalizarem (também
        # cobre threads que ainda estão encerrando após o último arquivo)
        self.download_manager.shutdown()
        super().closeEvent(event)