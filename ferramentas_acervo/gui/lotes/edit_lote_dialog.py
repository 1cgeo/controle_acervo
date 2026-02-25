# Path: gui\lotes\edit_lote_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QMessageBox
from qgis.PyQt.QtCore import QDate, QDateTime, Qt

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'edit_lote_dialog.ui'))

class EditLoteDialog(QDialog, FORM_CLASS):
    def __init__(self, api_client, lote_data=None, parent=None):
        super(EditLoteDialog, self).__init__(parent)
        self.setupUi(self)
        self.api_client = api_client
        self.lote_data = lote_data
        self.status_types = {}

        self.setup_ui()
        if lote_data:
            self.load_lote()
        else:
            self.set_default_dates()

    def setup_ui(self):
        self.setWindowTitle("Editar Lote" if self.lote_data else "Adicionar Lote")
        
        self.load_status_types()

        # Configurar os QDateEdit
        self.startDateEdit.setCalendarPopup(True)
        self.endDateEdit.setCalendarPopup(True)
        self.endDateEdit.setDate(QDate.currentDate())
        self.endDateEdit.setMinimumDate(self.startDateEdit.date())

        # Conectar sinais
        self.startDateEdit.dateChanged.connect(self.update_end_date_minimum)
        self.buttonBox.accepted.connect(self.save_lote)
        self.buttonBox.rejected.connect(self.reject)

        # Carregar projetos para o combobox
        self.load_projects()

        self.endDateCheckBox.stateChanged.connect(self.toggle_end_date)

    def load_status_types(self):
        response = self.api_client.get('gerencia/dominio/tipo_status_execucao')
        if response and 'dados' in response:
            self.statusComboBox.clear()
            for item in response['dados']:
                self.statusComboBox.addItem(item['nome'], item['code'])
        else:
            QMessageBox.warning(self, "Erro", "Não foi possível carregar os tipos de status.")

    def load_projects(self):
        response = self.api_client.get('projetos/projeto')
        if response and 'dados' in response:
            projects = response['dados']
            self.projectComboBox.clear()
            for project in projects:
                self.projectComboBox.addItem(project['nome'], project['id'])

    def update_end_date_minimum(self, new_start_date):
        self.endDateEdit.setMinimumDate(new_start_date)

    def toggle_end_date(self, state):
        self.endDateEdit.setEnabled(not state)

    def load_lote(self):
        self.nameLineEdit.setText(self.lote_data['nome'])
        self.pitLineEdit.setText(self.lote_data['pit'])
        self.descriptionTextEdit.setPlainText(self.lote_data['descricao'])

        self.startDateEdit.setDate(QDateTime.fromString(self.lote_data['data_inicio'], Qt.ISODate).date())
        if self.lote_data['data_fim']:
            self.endDateEdit.setDate(QDateTime.fromString(self.lote_data['data_fim'], Qt.ISODate).date())
            self.endDateCheckBox.setChecked(False)
        else:
            self.endDateCheckBox.setChecked(True)
            self.endDateEdit.setEnabled(False)

        status_index = self.statusComboBox.findData(self.lote_data['status_execucao_id'])
        if status_index >= 0:
            self.statusComboBox.setCurrentIndex(status_index)
        index = self.projectComboBox.findData(self.lote_data['projeto_id'])
        if index != -1:
            self.projectComboBox.setCurrentIndex(index)

    def set_default_dates(self):
        today = QDate.currentDate()
        self.startDateEdit.setDate(today)
        self.endDateEdit.setDate(today)
        self.endDateCheckBox.setChecked(False)
        self.endDateEdit.setEnabled(True)

    def save_lote(self):
        if not self.validate_inputs():
            return

        apiData = {
            'nome': self.nameLineEdit.text(),
            'pit': self.pitLineEdit.text(),
            'descricao': self.descriptionTextEdit.toPlainText(),
            'data_inicio': self.startDateEdit.date().toString(Qt.ISODate),
            'data_fim': None if self.endDateCheckBox.isChecked() else self.endDateEdit.date().toString(Qt.ISODate),
            'status_execucao_id': self.statusComboBox.currentData(),
            'projeto_id': int(self.projectComboBox.currentData())
        }

        if self.lote_data:
            apiData['id'] = int(self.lote_data['id'])
            success = self.api_client.put('projetos/lote', apiData)
        else:
            success = self.api_client.post('projetos/lote', apiData)

        if success:
            QMessageBox.information(self, "Sucesso", "Lote salvo com sucesso.")
            self.accept()
        else:
            QMessageBox.warning(self, "Erro", "Não foi possível salvar o lote.")

    def validate_inputs(self):
        if not self.nameLineEdit.text():
            QMessageBox.warning(self, "Erro", "O nome do lote é obrigatório.")
            return False
        if not self.pitLineEdit.text():
            QMessageBox.warning(self, "Erro", "O PIT é obrigatório.")
            return False
        if self.projectComboBox.currentIndex() == -1:
            QMessageBox.warning(self, "Erro", "É necessário selecionar um projeto.")
            return False
        return True