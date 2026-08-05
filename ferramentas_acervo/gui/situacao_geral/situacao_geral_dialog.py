# Path: gui\situacao_geral\situacao_geral_dialog.py
import os
import tempfile
import zipfile
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QFileDialog
from qgis.PyQt.QtCore import Qt

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
        escalas = {
            'scale25k': self.scale25kCheckBox,
            'scale50k': self.scale50kCheckBox,
            'scale100k': self.scale100kCheckBox,
            'scale250k': self.scale250kCheckBox,
        }
        if not any(caixa.isChecked() for caixa in escalas.values()):
            QMessageBox.warning(
                self, "Escolha a escala",
                "Marque pelo menos uma escala.\n\n"
                "Sem escala marcada o servidor devolve um pacote vazio."
            )
            return

        temp_file_path = None
        try:
            # Obter diretório de destino
            dest_dir = QFileDialog.getExistingDirectory(
                self,
                "Selecione a Pasta de Destino",
                "",
                QFileDialog.Option.ShowDirsOnly
            )

            if not dest_dir:
                return

            # Mostrar progresso
            self.progressBar.setVisible(True)
            self.progressBar.setValue(10)
            self.statusLabel.setText("Iniciando download...")
            self.downloadButton.setEnabled(False)
            self.setCursor(Qt.CursorShape.WaitCursor)

            # O Joi do servidor converte a query para boolean. Mande
            # 'true'/'false' em minúsculas: o requests serializa o True do
            # Python como 'True', que o Joi.boolean() não aceita.
            params = {chave: str(caixa.isChecked()).lower()
                      for chave, caixa in escalas.items()}

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
                # O api_client já mostrou a causa (rede, 401, 403, 500).
                self.statusLabel.setText("O download não foi concluído.")
                return

            self.progressBar.setValue(90)
            self.statusLabel.setText("Extraindo arquivos...")

            # Extrair os arquivos
            with zipfile.ZipFile(temp_file_path, 'r') as zip_ref:
                zip_ref.extractall(dest_dir)

            self.progressBar.setValue(100)
            self.statusLabel.setText("Download concluído com sucesso!")

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
            # Remover arquivo temporário também em caso de falha
            if temp_file_path and os.path.exists(temp_file_path):
                try:
                    os.unlink(temp_file_path)
                except OSError:
                    pass
            self.downloadButton.setEnabled(True)
            self.progressBar.setVisible(False)
            self.setCursor(Qt.CursorShape.ArrowCursor)
