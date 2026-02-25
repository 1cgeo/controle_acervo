# Path: gui\situacao_geral\situacao_geral_dialog.py
import os
import tempfile
import zipfile
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QFileDialog
from qgis.PyQt.QtCore import Qt
from qgis.core import Qgis

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'situacao_geral_dialog.ui'))

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
            # Nota: servidor compara req.query.scaleXk === 'true' (string lowercase),
            # e requests serializa Python True como 'True' (maiusculo), entao enviamos
            # explicitamente como string lowercase.
            params = {
                'scale25k': str(self.scale25kCheckBox.isChecked()).lower(),
                'scale50k': str(self.scale50kCheckBox.isChecked()).lower(),
                'scale100k': str(self.scale100kCheckBox.isChecked()).lower(),
                'scale250k': str(self.scale250kCheckBox.isChecked()).lower()
            }

            self.progressBar.setValue(0)
            self.progressBar.setMaximum(100)
            self.statusLabel.setText("Baixando arquivos...")

            # Criar arquivo temporário para salvar o ZIP
            temp_file = tempfile.NamedTemporaryFile(delete=False, suffix='.zip')
            temp_file_path = temp_file.name
            temp_file.close()

            # Callback de progresso do download
            def on_download_progress(downloaded, total):
                percent = int((downloaded / total) * 90)  # 0-90% para download
                self.progressBar.setValue(percent)

            # Baixar o arquivo usando o api_client
            success = self.api_client.download_file(
                'acervo/situacao-geral',
                temp_file_path,
                params=params,
                progress_callback=on_download_progress
            )

            if not success:
                raise Exception("Falha no download do arquivo")

            self.progressBar.setValue(90)
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
