# Path: gui\materialized_views\refresh_materialized_views_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox
from qgis.core import Qgis

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'refresh_materialized_views_dialog.ui'))

class RefreshMaterializedViewsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(RefreshMaterializedViewsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        
        self.setup_ui()
        
    def setup_ui(self):
        self.setWindowTitle("Atualizar Visões Materializadas")
        
        # Connect buttons
        self.refreshButton.clicked.connect(self.refresh_views)
        self.cancelButton.clicked.connect(self.reject)
        
    def refresh_views(self):
        """Trigger the refresh of all materialized views via API."""
        reply = QMessageBox.question(
            self,
            'Confirmar Atualização',
            'Tem certeza que deseja atualizar todas as visões materializadas? Esta operação pode levar algum tempo.',
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No
        )
        
        if reply != QMessageBox.Yes:
            return
            
        try:
            self.setEnabled(False)
            self.iface.messageBar().pushMessage(
                "Informação",
                "Atualizando visões materializadas. Por favor, aguarde...",
                level=Qgis.Info
            )
            
            response = self.api_client.post('acervo/refresh_materialized_views')
            
            if response:
                QMessageBox.information(
                    self,
                    "Sucesso",
                    "Visões materializadas atualizadas com sucesso."
                )
                self.accept()
            else:
                QMessageBox.warning(
                    self,
                    "Erro",
                    "Não foi possível atualizar as visões materializadas."
                )
        except Exception as e:
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao atualizar visões materializadas: {str(e)}"
            )
        finally:
            self.setEnabled(True)