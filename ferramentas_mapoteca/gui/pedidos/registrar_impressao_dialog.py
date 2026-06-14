# Path: gui\pedidos\registrar_impressao_dialog.py
from qgis.PyQt.QtWidgets import (QDialog, QVBoxLayout, QHBoxLayout, QLabel,
                                 QTableWidget, QTableWidgetItem, QSpinBox,
                                 QPushButton, QHeaderView)
from qgis.PyQt.QtCore import Qt


class RegistrarImpressaoDialog(QDialog):
    """
    Diálogo para registrar quantas cópias de cada item foram impressas.
    Cada linha é um item do pedido com um campo de quantidade, inicializado
    com o restante a imprimir. Linhas com quantidade 0 são ignoradas.
    """

    def __init__(self, itens, parent=None):
        super().__init__(parent)
        self.setWindowTitle("Registrar impressão")
        self.resize(760, 420)
        self._itens = itens
        self._spinboxes = {}

        layout = QVBoxLayout(self)

        info = QLabel(
            "Informe quantas cópias de cada item foram impressas nesta sessão.\n"
            "O campo já vem preenchido com o restante a imprimir — ajuste se necessário."
        )
        layout.addWidget(info)

        self.table = QTableWidget(self)
        self.table.setColumnCount(6)
        self.table.setHorizontalHeaderLabels([
            "Produto", "MI", "Escala", "Pedida", "Restante", "Impressas agora"
        ])
        self.table.verticalHeader().setVisible(False)
        self.table.setSelectionBehavior(QTableWidget.SelectionBehavior.SelectRows)
        self.table.setEditTriggers(QTableWidget.EditTrigger.NoEditTriggers)
        self.table.horizontalHeader().setSectionResizeMode(0, QHeaderView.ResizeMode.Stretch)

        self.table.setRowCount(len(itens))
        for row, item in enumerate(itens):
            valores = [
                item.get('produto_nome') or '-',
                item.get('mi') or '-',
                item.get('escala') or '-',
                str(item.get('quantidade', 0)),
                str(item.get('quantidade_restante', 0))
            ]
            for col, valor in enumerate(valores):
                cell = QTableWidgetItem(valor)
                cell.setFlags(cell.flags() & ~Qt.ItemFlag.ItemIsEditable)
                self.table.setItem(row, col, cell)

            spin = QSpinBox(self.table)
            spin.setRange(0, 99999)
            spin.setValue(item.get('quantidade_restante', 0))
            spin.valueChanged.connect(self._update_total)
            self.table.setCellWidget(row, 5, spin)
            self._spinboxes[item['id']] = spin

        layout.addWidget(self.table)

        self.totalLabel = QLabel(self)
        self.totalLabel.setStyleSheet("font-weight: bold;")
        layout.addWidget(self.totalLabel)

        buttons = QHBoxLayout()
        buttons.addStretch()
        self.okButton = QPushButton("Registrar", self)
        self.okButton.setDefault(True)  # Enter confirma o registro
        self.cancelButton = QPushButton("Cancelar", self)
        buttons.addWidget(self.okButton)
        buttons.addWidget(self.cancelButton)
        layout.addLayout(buttons)

        self.okButton.clicked.connect(self.accept)
        self.cancelButton.clicked.connect(self.reject)

        self._update_total()

    def _update_total(self):
        """Atualiza o resumo do total a registrar conforme os campos mudam."""
        total = 0
        itens = 0
        for spin in self._spinboxes.values():
            if spin.value() > 0:
                total += spin.value()
                itens += 1
        self.totalLabel.setText(f"Total a registrar: {total} cópia(s) em {itens} item(ns).")

    def get_registros(self):
        """Retorna os registros de impressão (apenas itens com quantidade > 0)."""
        registros = []
        for produto_pedido_id, spin in self._spinboxes.items():
            if spin.value() > 0:
                registros.append({
                    'produto_pedido_id': produto_pedido_id,
                    'quantidade': spin.value()
                })
        return registros
