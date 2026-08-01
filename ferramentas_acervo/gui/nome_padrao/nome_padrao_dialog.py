# Path: gui\nome_padrao\nome_padrao_dialog.py
"""Reconciliar o nome FÍSICO dos arquivos com o padrão derivado dos metadados.

O nome do arquivo no volume é DERIVADO: sai de `acervo.nome_arquivo_padrao`, a
partir do tipo, do subtipo, do MI/INOM, da escala e do rótulo da versão. Derivado
envelhece -- renumerar uma edição ou corrigir um subtipo muda o nome esperado e
não toca no arquivo --, e é por isso que o invariante 7a existe.

O plugin era uma das FONTES da divergência: ele mandava como `nome_arquivo` o
nome do arquivo que a pessoa escolheu no disco. Toda carga feita por aqui nascia
divergente, e a diferença só aparecia no dia em que alguém fosse baixar.

Esta tela é o outro lado: chama `POST /api/arquivo/renomear-padrao`, que deriva o
nome do MESMO jeito que o auditor. Ela começa em simulação, e o laço é dela
porque a rota trabalha por lotes de propósito: uma passada inteira numa
requisição só seguraria a conexão por dezenas de minutos.
"""
import os

from qgis.PyQt import uic
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import (QDialog, QHeaderView, QMessageBox, QTableWidgetItem)

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'nome_padrao_dialog.ui'))


class NomePadraoDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(NomePadraoDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.divergentes_total = None

        self.setup_ui()
        self.simular()

    def setup_ui(self):
        self.setWindowTitle("Padronizar nome físico dos arquivos")

        self.amostraTable.setColumnCount(3)
        self.amostraTable.setHorizontalHeaderLabels(['Id', 'Nome atual', 'Nome padrão'])
        self.amostraTable.horizontalHeader().setSectionResizeMode(
            1, QHeaderView.ResizeMode.Stretch)
        self.amostraTable.horizontalHeader().setSectionResizeMode(
            2, QHeaderView.ResizeMode.Stretch)
        self.amostraTable.setEditTriggers(self.amostraTable.EditTrigger.NoEditTriggers)

        self.loteSpinBox.setRange(1, 5000)
        self.loteSpinBox.setValue(500)

        self.simularButton.clicked.connect(self.simular)
        self.aplicarButton.clicked.connect(self.aplicar)
        self.fecharButton.clicked.connect(self.reject)

        self.aplicarButton.setEnabled(False)

    # --- chamadas -----------------------------------------------------------

    def _chamar(self, dry_run):
        motivo = self.motivoLineEdit.text().strip()
        # O `motivo` é exigido pelo schema (mínimo de 5 caracteres) e vai para o
        # registro: renome sem motivo é um nome trocado sem história.
        if len(motivo) < 5:
            QMessageBox.warning(
                self, "Motivo obrigatório",
                "Descreva em pelo menos 5 caracteres por que o renome está sendo feito.\n\n"
                "O motivo fica registrado junto da alteração."
            )
            return None

        return self.api_client.post('arquivo/renomear-padrao', {
            'limite': self.loteSpinBox.value(),
            'dry_run': dry_run,
            'motivo': motivo,
        }, timeout=600)

    def simular(self):
        self.setCursor(Qt.CursorShape.WaitCursor)
        try:
            resposta = self._chamar(dry_run=True)
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if not resposta or 'dados' not in resposta:
            return

        dados = resposta['dados']
        self.divergentes_total = dados.get('divergentes_total', 0)
        self.mostrar_amostra(dados.get('amostra') or [])

        if self.divergentes_total == 0:
            self.statusLabel.setText(
                "Nenhum arquivo divergente: todo nome físico já bate com o padrão."
            )
            self.aplicarButton.setEnabled(False)
            return

        self.statusLabel.setText(
            f"{self.divergentes_total} arquivo(s) com nome divergente. "
            f"Esta chamada trataria {dados.get('nesta_chamada', 0)}, "
            f"restando {dados.get('restantes', 0)}."
        )
        self.aplicarButton.setEnabled(True)

    def mostrar_amostra(self, amostra):
        self.amostraTable.setRowCount(len(amostra))
        for linha, item in enumerate(amostra):
            self.amostraTable.setItem(linha, 0, QTableWidgetItem(str(item.get('id', ''))))
            self.amostraTable.setItem(linha, 1, QTableWidgetItem(item.get('de', '')))
            self.amostraTable.setItem(linha, 2, QTableWidgetItem(item.get('para', '')))
        self.amostraTable.resizeColumnsToContents()

    def aplicar(self):
        resposta = QMessageBox.question(
            self, "Confirmar renome",
            f"O arquivo será renomeado NO VOLUME e no banco, em lotes de "
            f"{self.loteSpinBox.value()}, até acabar.\n\n"
            f"São {self.divergentes_total} arquivo(s) divergentes.\n\n"
            "O servidor recusa a operação se houver sessão de upload aberta, e reverte "
            "cada renome que falhar. Continuar?",
            QMessageBox.StandardButton.Yes | QMessageBox.StandardButton.No,
            QMessageBox.StandardButton.No
        )
        if resposta != QMessageBox.StandardButton.Yes:
            return

        self.aplicarButton.setEnabled(False)
        self.simularButton.setEnabled(False)
        self.setCursor(Qt.CursorShape.WaitCursor)
        try:
            self._laco()
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)
            self.simularButton.setEnabled(True)

    def _laco(self):
        """Chama até `restantes` zerar.

        Para na primeira resposta que traga falha ou que não avance. Insistir num
        lote que não anda seria repetir o mesmo erro até o teto de 5.000.
        """
        total_renomeado = 0
        total_falhas = 0

        while True:
            resposta = self._chamar(dry_run=False)
            if not resposta or 'dados' not in resposta:
                # 409 (sessão de upload aberta) e 400 (metadado sem nome
                # computável) já foram mostrados pelo api_client, com a
                # mensagem do servidor, que explica o que fazer.
                break

            dados = resposta['dados']
            total_renomeado += dados.get('renomeados', 0)
            total_falhas += dados.get('falhas', 0)
            restantes = dados.get('restantes', 0)

            self.statusLabel.setText(
                f"{total_renomeado} renomeado(s), {total_falhas} falha(s), "
                f"{restantes} restante(s)..."
            )
            self.statusLabel.repaint()

            if dados.get('falhas'):
                self.mostrar_falhas(dados)
                break
            if restantes == 0 or dados.get('nesta_chamada', 0) == 0:
                break

        QMessageBox.information(
            self, "Renome concluído",
            f"{total_renomeado} arquivo(s) renomeado(s).\n"
            f"{total_falhas} falha(s)."
        )
        self.simular()

    def mostrar_falhas(self, dados):
        detalhe = dados.get('detalhe') or []
        linhas = [f"  {d.get('de')} -> {d.get('para')}: {d.get('erro')}" for d in detalhe[:15]]
        extra = f"\n\n{dados['interrompido']}" if dados.get('interrompido') else ""
        QMessageBox.warning(
            self, "Falhas no renome",
            f"{dados.get('falhas')} arquivo(s) não foram renomeados. O banco e o disco "
            f"foram revertidos para cada um deles.\n\n" + "\n".join(linhas) + extra
        )
