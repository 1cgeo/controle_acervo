# Path: gui\limpeza_downloads\cleanup_expired_downloads_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QPushButton
from qgis.core import Qgis

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'cleanup_expired_downloads_dialog.ui'))

class CleanupExpiredDownloadsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(CleanupExpiredDownloadsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        
        self.setup_ui()
        
    def setup_ui(self):
        self.setWindowTitle("Limpar Downloads Expirados")
        
        # Connect the cleanup button to the cleanup function
        self.cleanupButton.clicked.connect(self.cleanup_expired_downloads)
        
    def cleanup_expired_downloads(self):
        """Trigger the cleanup of expired downloads via API."""
        reply = QMessageBox.question(
            self,
            'Confirmar Limpeza',
            'Tem certeza que deseja limpar todos os downloads expirados?',
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No
        )
        
        if reply != QMessageBox.Yes:
            return
            
        try:
            response = self.api_client.post('acervo/cleanup-expired-downloads')
            
            if response:
                QMessageBox.information(
                    self,
                    "Sucesso",
                    "Limpeza de downloads expirados realizada com sucesso."
                )
                self.iface.messageBar().pushMessage(
                    "Sucesso",
                    "Downloads expirados foram limpos com sucesso.",
                    level=Qgis.Success
                )
                self.accept()
            else:
                QMessageBox.critical(
                    self,
                    "Erro",
                    "Não foi possível realizar a limpeza de downloads expirados."
                )
        except Exception as e:
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao limpar downloads expirados: {str(e)}"
            )