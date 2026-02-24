# Path: gui\projetos\manage_projects_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QVBoxLayout, QTableWidget, QPushButton, QMessageBox, QTableWidgetItem
from qgis.PyQt.QtCore import Qt, QDate
from .edit_project_dialog import EditProjectDialog

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'manage_projects_dialog.ui'))

class ManageProjectsDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(ManageProjectsDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client

        self.setup_ui()
        self.load_projects()

    def setup_ui(self):
        self.setWindowTitle("Gerenciar Projetos")
        
        # Configurar a tabela de projetos
        self.projectsTable.setColumnCount(6)
        self.projectsTable.setHorizontalHeaderLabels(['Id', 'Nome', 'Descrição', 'Data Início', 'Data Fim', 'Status'])
        self.projectsTable.setSelectionBehavior(QTableWidget.SelectRows)
        self.projectsTable.setEditTriggers(QTableWidget.NoEditTriggers)

        # Conectar botões
        self.addButton.clicked.connect(self.add_project)
        self.editButton.clicked.connect(self.edit_project)
        self.deleteButton.clicked.connect(self.delete_project)

        self.searchLineEdit.textChanged.connect(self.filter_projects)

    def load_projects(self):
        response = self.api_client.get('projetos/projeto')
        if response is None:
            QMessageBox.warning(self, "Erro", "Não foi possível carregar os projetos.")
            return

        self.projects = response.get('dados', [])
        if not isinstance(self.projects, list):
            QMessageBox.warning(self, "Erro", "Formato de resposta inesperado.")
            return
        self.display_projects(self.projects)

    def display_projects(self, projects):
        self.projectsTable.setRowCount(len(projects))
        for row, project in enumerate(projects):
            if not isinstance(project, dict):
                continue
            self.projectsTable.setItem(row, 0, QTableWidgetItem(str(project.get('id', ''))))
            self.projectsTable.setItem(row, 1, QTableWidgetItem(project.get('nome', '')))
            self.projectsTable.setItem(row, 2, QTableWidgetItem(project.get('descricao', '')))
            
            # Formatando a data de início
            data_inicio = QDate.fromString(project.get('data_inicio', ''), Qt.ISODate)
            self.projectsTable.setItem(row, 3, QTableWidgetItem(data_inicio.toString('yyyy-MM-dd')))
            
            # Formatando a data de fim (se existir)
            data_fim = project.get('data_fim', '')
            if data_fim:
                data_fim = QDate.fromString(data_fim, Qt.ISODate).toString('yyyy-MM-dd')
            else:
                data_fim = 'Não definida'
            self.projectsTable.setItem(row, 4, QTableWidgetItem(data_fim))

            self.projectsTable.setItem(row, 5, QTableWidgetItem(str(project.get('status_execucao', ''))))
        self.projectsTable.resizeColumnsToContents()

    def filter_projects(self):
        search_text = self.searchLineEdit.text().lower()
        filtered_projects = [
            project for project in self.projects
            if search_text in project.get('nome', '').lower() or search_text in project.get('descricao', '').lower()
        ]
        self.display_projects(filtered_projects)

    def add_project(self):
        dialog = EditProjectDialog(self.api_client)
        if dialog.exec_():
            self.load_projects()

    def edit_project(self):
        selected_rows = self.projectsTable.selectionModel().selectedRows()
        if len(selected_rows) == 1:
            id = int(self.projectsTable.item(selected_rows[0].row(), 0).text())
            project_data = next((item for item in self.projects if str(item['id']) == str(id)), None)
            
            if project_data:
                dialog = EditProjectDialog(self.api_client, project_data)
                if dialog.exec_():
                    self.load_projects()
            else:
                QMessageBox.warning(self, "Erro", "Não foi possível encontrar os dados do projeto selecionado.")
        else:
            QMessageBox.warning(self, "Aviso", "Por favor, selecione um projeto para editar.")

    def delete_project(self):
        selected_rows = self.projectsTable.selectionModel().selectedRows()
        if len(selected_rows) == 1:
            project_id = int(self.projectsTable.item(selected_rows[0].row(), 0).text())
            reply = QMessageBox.question(self, 'Confirmar Exclusão',
                                         'Tem certeza que deseja excluir este projeto?',
                                         QMessageBox.Yes | QMessageBox.No, QMessageBox.No)
            if reply == QMessageBox.Yes:
                success = self.api_client.delete('projetos/projeto', {'projeto_ids': [project_id]})
                if success:
                    self.load_projects()
                    QMessageBox.information(self, "Sucesso", "Projeto excluído com sucesso.")
                else:
                    QMessageBox.warning(self, "Erro", "Não foi possível excluir o projeto.")
        else:
            QMessageBox.warning(self, "Aviso", "Por favor, selecione um projeto para excluir.")

    def showEvent(self, event):
        super().showEvent(event)
        self.load_projects()