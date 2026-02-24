# Path: gui\situacao_geral\situacao_geral_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QFileDialog
from qgis.PyQt.QtCore import Qt, QUrl, QTemporaryFile
from qgis.core import Qgis
import urllib.request
import tempfile
import zipfile

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'download_situacao_geral_dialog.ui'))

class DownloadSituacaoGeralDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(DownloadSituacaoGeralDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        
        # Inicialização
        self.setup_ui()
        
    def setup_ui(self):
        self.setWindowTitle("Download da Situação Geral")
        
        # Esconder barra de progresso inicialmente
        self.progressBar.setVisible(False)
        
        # Conectar sinais
        self.downloadButton.clicked.connect(self.download_situacao)
        self.closeButton.clicked.connect(self.reject)
        
    def download_situacao(self):
        """Baixa os arquivos GeoJSON da situação geral."""
        try:
            # Obter diretório de destino
            dest_dir = QFileDialog.getExistingDirectory(
                self, 
                "Selecione a Pasta de Destino", 
                "", 
                QFileDialog.ShowDirsOnly
            )
            
            if not dest_dir:
                return
                
            # Mostrar progresso
            self.progressBar.setVisible(True)
            self.progressBar.setValue(10)
            self.statusLabel.setText("Iniciando download...")
            self.downloadButton.setEnabled(False)
            self.setCursor(Qt.WaitCursor)
            
            # Obter estados dos checkboxes
            scales = {
                'scale25k': self.scale25kCheckBox.isChecked(),
                'scale50k': self.scale50kCheckBox.isChecked(),
                'scale100k': self.scale100kCheckBox.isChecked(),
                'scale250k': self.scale250kCheckBox.isChecked()
            }
            
            # Construir URL com query params
            base_url = f"{self.api_client.base_url}/api/acervo/situacao-geral"
            query_params = []
            for scale, checked in scales.items():
                query_params.append(f"{scale}={str(checked).lower()}")
            
            url = f"{base_url}?{'&'.join(query_params)}"
            
            # Configurar cabeçalhos com token
            headers = {
                "Authorization": f"Bearer {self.api_client.token}"
            }
            
            self.progressBar.setValue(30)
            self.statusLabel.setText("Baixando arquivos...")
            
            # Criar requisição com cabeçalhos personalizados
            req = urllib.request.Request(url, headers=headers)
            
            # Criar arquivo temporário para salvar o ZIP
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
            temp_file_path = temp_file.name
            temp_file.close()
            
            # Baixar o arquivo
            with urllib.request.urlopen(req) as response:
                with open(temp_file_path, 'wb') as out_file:
                    out_file.write(response.read())
            
            self.progressBar.setValue(70)
            self.statusLabel.setText("Extraindo arquivos...")
            
            # Extrair os arquivos
            with zipfile.ZipFile(temp_file_path, 'r') as zip_ref:
                zip_ref.extractall(dest_dir)
            
            self.progressBar.setValue(100)
            self.statusLabel.setText("Download concluído com sucesso!")
            
            # Remover arquivo temporário
            os.unlink(temp_file_path)
                
            QMessageBox.information(
                self,
                "Sucesso",
                f"Arquivos extraídos com sucesso em:\n{dest_dir}"
            )
            
        except Exception as e:
            self.statusLabel.setText(f"Erro: {str(e)}")
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao baixar os arquivos: {str(e)}"
            )
        finally:
            self.downloadButton.setEnabled(True)
            self.setCursor(Qt.ArrowCursor)