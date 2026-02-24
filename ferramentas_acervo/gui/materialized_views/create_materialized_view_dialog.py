# Path: gui\materialized_views\create_materialized_view_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox
from qgis.core import Qgis

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'create_materialized_view_dialog.ui'))

class CreateMaterializedViewDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(CreateMaterializedViewDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        
        self.setup_ui()
        
    def setup_ui(self):
        self.setWindowTitle("Criar Visões Materializadas")
        
        # Connect buttons
        self.createButton.clicked.connect(self.create_views)
        self.cancelButton.clicked.connect(self.reject)
        
    def create_views(self):
        """Trigger the creation of all pre-defined materialized views via API."""
        reply = QMessageBox.question(
            self,
            'Confirmar Criação',
            'Tem certeza que deseja criar ou recriar todas as visões materializadas? Esta operação pode levar algum tempo e irá sobrescrever visões existentes.',
            QMessageBox.Yes | QMessageBox.No,
            QMessageBox.No
        )
        
        if reply != QMessageBox.Yes:
            return
            
        try:
            self.setEnabled(False)
            self.iface.messageBar().pushMessage(
                "Informação",
                "Criando visões materializadas. Por favor, aguarde...",
                level=Qgis.Info
            )
            
            response = self.api_client.post('acervo/create_materialized_views')
            
            if response:
                QMessageBox.information(
                    self,
                    "Sucesso",
                    "Visões materializadas criadas com sucesso."
                )
                self.accept()
            else:
                QMessageBox.warning(
                    self,
                    "Erro",
                    "Não foi possível criar as visões materializadas."
                )
        except Exception as e:
            QMessageBox.critical(
                self,
                "Erro",
                f"Erro ao criar visões materializadas: {str(e)}"
            )
        finally:
            self.setEnabled(True)