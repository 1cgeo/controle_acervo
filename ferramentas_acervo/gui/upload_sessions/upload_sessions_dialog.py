# Path: gui\upload_sessions\upload_sessions_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox, QTableWidgetItem, QHeaderView
from qgis.PyQt.QtCore import Qt, QDateTime
FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'upload_sessions_dialog.ui'))

class UploadSessionsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(UploadSessionsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.current_data = []

        self.setup_ui()
        self.load_upload_sessions()

    def setup_ui(self):
        self.setWindowTitle("Sessões de Upload")

        self.sessionsTable.setColumnCount(8)
        self.sessionsTable.setHorizontalHeaderLabels([
            'UUID', 'Tipo de Operação', 'Status', 'Erro',
            'Data de Criação', 'Expiração', 'Conclusão', 'Usuário'
        ])
        self.sessionsTable.setSelectionBehavior(self.sessionsTable.SelectRows)
        self.sessionsTable.setEditTriggers(self.sessionsTable.NoEditTriggers)

        header = self.sessionsTable.horizontalHeader()
        header.setSectionResizeMode(0, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(1, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(2, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(3, QHeaderView.Stretch)
        header.setSectionResizeMode(4, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(5, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(6, QHeaderView.ResizeToContents)
        header.setSectionResizeMode(7, QHeaderView.ResizeToContents)

        self.sessionsTable.itemSelectionChanged.connect(self.on_selection_changed)
        self.cancelSessionButton.clicked.connect(self.cancel_session)
        self.refreshButton.clicked.connect(self.refresh_data)
        self.closeButton.clicked.connect(self.reject)

    def load_upload_sessions(self):
        try:
            self.setCursor(Qt.WaitCursor)
            response = self.api_client.get('arquivo/upload-sessions')
            if response and 'dados' in response:
                self.current_data = response['dados']
                self.populate_sessions_table(self.current_data)
            else:
                QMessageBox.warning(self, "Aviso", "Não foi possível carregar as sessões de upload.")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao carregar sessões de upload: {str(e)}")
        finally:
            self.setCursor(Qt.ArrowCursor)

    def populate_sessions_table(self, sessions):
        self.sessionsTable.setRowCount(len(sessions))
        operation_type_map = {
            'add_files': 'Adicionar Arquivos',
            'add_version': 'Adicionar Versão',
            'add_product': 'Adicionar Produto'
        }
        status_map = {
            'pending': 'Pendente',
            'completed': 'Concluído',
            'failed': 'Falhou',
            'cancelled': 'Cancelado'
        }
        for row, session in enumerate(sessions):
            uuid_item = QTableWidgetItem(session.get('uuid_session', ''))
            uuid_item.setData(Qt.UserRole, session.get('status', ''))
            self.sessionsTable.setItem(row, 0, uuid_item)
            operation_type = session.get('operation_type', '')
            self.sessionsTable.setItem(row, 1, QTableWidgetItem(operation_type_map.get(operation_type, operation_type)))
            status = session.get('status', '')
            self.sessionsTable.setItem(row, 2, QTableWidgetItem(status_map.get(status, status)))
            self.sessionsTable.setItem(row, 3, QTableWidgetItem(session.get('error_message', '') or ''))
            for col, field in [(4, 'created_at'), (5, 'expiration_time'), (6, 'completed_at')]:
                date = session.get(field, '')
                if date:
                    date_dt = QDateTime.fromString(date, Qt.ISODate)
                    date_formatted = date_dt.toString('dd/MM/yyyy HH:mm:ss')
                else:
                    date_formatted = ""
                self.sessionsTable.setItem(row, col, QTableWidgetItem(date_formatted))
            self.sessionsTable.setItem(row, 7, QTableWidgetItem(session.get('usuario_nome', '')))
        self.cancelSessionButton.setEnabled(False)

    def on_selection_changed(self):
        selected_rows = self.sessionsTable.selectionModel().selectedRows()
        if selected_rows:
            row = selected_rows[0].row()
            status = self.sessionsTable.item(row, 0).data(Qt.UserRole)
            self.cancelSessionButton.setEnabled(status == 'pending')
        else:
            self.cancelSessionButton.setEnabled(False)

    def cancel_session(self):
        selected_rows = self.sessionsTable.selectionModel().selectedRows()
        if not selected_rows:
            return
        row = selected_rows[0].row()
        session_uuid = self.sessionsTable.item(row, 0).text()
        reply = QMessageBox.question(
            self, "Confirmar Cancelamento",
            f"Deseja cancelar a sessão de upload?\n\nUUID: {session_uuid}",
            QMessageBox.Yes | QMessageBox.No, QMessageBox.No
        )
        if reply != QMessageBox.Yes:
            return
        try:
            self.setCursor(Qt.WaitCursor)
            response = self.api_client.post('arquivo/cancel-upload', {'session_uuid': session_uuid})
            if response and response.get('success'):
                QMessageBox.information(self, "Sucesso", "Sessão de upload cancelada com sucesso.")
                self.load_upload_sessions()
            else:
                msg = response.get('message', 'Erro desconhecido') if response else 'Sem resposta do servidor'
                QMessageBox.warning(self, "Aviso", f"Não foi possível cancelar a sessão: {msg}")
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Erro ao cancelar sessão: {str(e)}")
        finally:
            self.setCursor(Qt.ArrowCursor)

    def refresh_data(self):
        self.load_upload_sessions()
