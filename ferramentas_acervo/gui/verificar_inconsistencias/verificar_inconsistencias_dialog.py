# Path: gui\verificar_inconsistencias\verificar_inconsistencias_dialog.py
import os
from qgis.PyQt import uic
from qgis.PyQt.QtWidgets import QDialog, QTableWidgetItem, QFileDialog, QMessageBox
from qgis.PyQt.QtCore import Qt
import csv

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'verificar_inconsistencias_dialog.ui'))

class VerificarInconsistenciasDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(VerificarInconsistenciasDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client

        self.executarVerificacaoButton.clicked.connect(self.executar_verificacao)
        self.baixarCSVButton.clicked.connect(self.baixar_csv)
        self.baixarCSVButton.setEnabled(False)

    def executar_verificacao(self):
        try:
            response = self.api_client.post('gerencia/verificar_inconsistencias')
            if response and 'dados' in response:
                if isinstance(response['dados'], list) and len(response['dados']) > 0:
                    self.preencher_tabela(response['dados'])
                    self.baixarCSVButton.setEnabled(True)
                else:
                    QMessageBox.information(self, "Resultado", "Não foram encontradas inconsistências.")
                    self.resultadosTable.setRowCount(0)
                    self.baixarCSVButton.setEnabled(False)
            else:
                QMessageBox.warning(self, "Aviso", "A verificação foi concluída, mas não retornou dados.")
                self.resultadosTable.setRowCount(0)
                self.baixarCSVButton.setEnabled(False)
        except Exception as e:
            QMessageBox.critical(self, "Erro", f"Ocorreu um erro ao executar a verificação: {str(e)}")
            self.resultadosTable.setRowCount(0)
            self.baixarCSVButton.setEnabled(False)

    def preencher_tabela(self, dados):
        self.resultadosTable.setRowCount(0)
        for item in dados:
            row_position = self.resultadosTable.rowCount()
            self.resultadosTable.insertRow(row_position)
            self.resultadosTable.setItem(row_position, 0, QTableWidgetItem(str(item.get('id', ''))))
            self.resultadosTable.setItem(row_position, 1, QTableWidgetItem(str(item.get('nome', ''))))
            self.resultadosTable.setItem(row_position, 2, QTableWidgetItem(str(item.get('tipo', ''))))
            self.resultadosTable.setItem(row_position, 3, QTableWidgetItem(str(item.get('caminho', ''))))
            self.resultadosTable.setItem(row_position, 4, QTableWidgetItem(str(item.get('problema', ''))))

    def baixar_csv(self):
        if self.resultadosTable.rowCount() == 0:
            QMessageBox.warning(self, "Aviso", "Não há dados para exportar.")
            return

        filename, _ = QFileDialog.getSaveFileName(self, "Salvar arquivo CSV", "", "CSV files (*.csv)")
        if filename:
            try:
                with open(filename, 'w', newline='', encoding='utf-8') as file:
                    writer = csv.writer(file)
                    writer.writerow(["ID", "Nome", "Tipo", "Caminho", "Problema"])
                    for row in range(self.resultadosTable.rowCount()):
                        row_data = []
                        for column in range(self.resultadosTable.columnCount()):
                            item = self.resultadosTable.item(row, column)
                            if item is not None:
                                row_data.append(item.text())
                            else:
                                row_data.append("")
                        writer.writerow(row_data)
                QMessageBox.information(self, "Sucesso", f"Arquivo CSV salvo em {filename}")
            except Exception as e:
                QMessageBox.critical(self, "Erro", f"Ocorreu um erro ao salvar o arquivo CSV: {str(e)}")