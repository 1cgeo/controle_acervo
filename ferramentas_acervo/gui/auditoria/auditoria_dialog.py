# Path: gui\auditoria\auditoria_dialog.py
"""Auditoria dos invariantes LÓGICOS do acervo.

Não confundir com "Verificar Arquivos no Volume", que é outra pergunta: aquela
compara o banco com o DISCO (arquivo registrado que sumiu do volume, tamanho
diferente). Esta roda os invariantes de COERÊNCIA (MI que não bate com o INOM,
nome físico divergente do padrão, versão sem arquivo, arquivo vivo com o nome de
um deletado), e nenhum deles olha o disco.

A severidade é do SERVIDOR: DEFECT é o que está errado, REVISAR é o que merece
olho humano, INFO é contagem. A tela não reclassifica nada.
"""
import os

from qgis.PyQt import uic
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtGui import QColor
from qgis.PyQt.QtWidgets import QDialog, QHeaderView, QTableWidgetItem, QTreeWidgetItem

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'auditoria_dialog.ui'))

# Vermelho para defeito, âmbar para revisar. INFO fica sem cor: pintar tudo faz
# a cor deixar de significar alguma coisa.
COR = {
    'DEFECT': QColor(255, 205, 205),
    'REVISAR': QColor(255, 235, 190),
}

ORDEM = {'DEFECT': 0, 'REVISAR': 1, 'INFO': 2}


class AuditoriaDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(AuditoriaDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.resultados = []

        self.setup_ui()
        self.rodar()

    def setup_ui(self):
        self.setWindowTitle("Auditoria do acervo")

        self.severidadeComboBox.addItem("Todas as severidades", None)
        for sev in ('DEFECT', 'REVISAR', 'INFO'):
            self.severidadeComboBox.addItem(sev, sev)

        self.invariantesTree.setColumnCount(4)
        self.invariantesTree.setHeaderLabels(['Código', 'Severidade', 'Ocorrências', 'Invariante'])
        self.invariantesTree.header().setSectionResizeMode(3, QHeaderView.ResizeMode.Stretch)

        self.amostraTable.setEditTriggers(self.amostraTable.EditTrigger.NoEditTriggers)

        self.rodarButton.clicked.connect(self.rodar)
        self.severidadeComboBox.currentIndexChanged.connect(self.mostrar)
        self.invariantesTree.itemSelectionChanged.connect(self.mostrar_amostra)
        self.fecharButton.clicked.connect(self.reject)

    # --- dados --------------------------------------------------------------

    def rodar(self):
        self.setCursor(Qt.CursorShape.WaitCursor)
        self.statusLabel.setText("Rodando os invariantes no servidor...")
        self.statusLabel.repaint()
        try:
            # A auditoria roda dezenas de consultas numa transação só; o timeout
            # padrão de 30s não cobre um acervo grande.
            resposta = self.api_client.get('acervo/auditoria', params={'amostra': 20}, timeout=600)
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)

        if not resposta or 'dados' not in resposta:
            self.statusLabel.setText("Não foi possível rodar a auditoria.")
            return

        self.resultados = resposta['dados']
        self.mostrar()

    def mostrar(self):
        escolhida = self.severidadeComboBox.currentData()
        visiveis = [r for r in self.resultados
                    if escolhida is None or r['severidade'] == escolhida]
        visiveis.sort(key=lambda r: (ORDEM.get(r['severidade'], 9),
                                     -(r.get('total') or 0), r['codigo']))

        self.invariantesTree.clear()
        for r in visiveis:
            total = r.get('total')
            if r.get('erro'):
                texto_total = "erro"
            elif total == 0:
                texto_total = "-"
            else:
                texto_total = f"{total}{'+' if r.get('truncada') else ''}"

            item = QTreeWidgetItem([r['codigo'], r['severidade'], texto_total, r['titulo']])
            item.setData(0, Qt.ItemDataRole.UserRole, r)

            # Só pinta quem TEM ocorrência. Um DEFECT com zero é boa notícia, e
            # pintá-lo de vermelho faria a tela parecer cheia de problema.
            if total and r['severidade'] in COR:
                for coluna in range(4):
                    item.setBackground(coluna, COR[r['severidade']])
            if r.get('erro'):
                item.setToolTip(3, r['erro'])

            self.invariantesTree.addTopLevelItem(item)

        self.invariantesTree.resizeColumnToContents(0)
        self.invariantesTree.resizeColumnToContents(1)
        self.invariantesTree.resizeColumnToContents(2)
        self.resumir(visiveis)

    def resumir(self, visiveis):
        com_ocorrencia = [r for r in visiveis if r.get('total')]
        defeitos = sum(r['total'] for r in com_ocorrencia if r['severidade'] == 'DEFECT')
        quebrados = [r['codigo'] for r in visiveis if r.get('erro')]

        partes = [f"{len(visiveis)} invariante(s) rodados",
                  f"{len(com_ocorrencia)} com ocorrência"]
        if defeitos:
            partes.append(f"{defeitos} ocorrência(s) de DEFECT")
        if quebrados:
            partes.append(f"invariante(s) com erro: {', '.join(quebrados)}")
        self.statusLabel.setText(". ".join(partes) + ".")

    def mostrar_amostra(self):
        selecionados = self.invariantesTree.selectedItems()
        self.amostraTable.clear()
        self.amostraTable.setRowCount(0)
        self.amostraTable.setColumnCount(0)

        if not selecionados:
            return

        r = selecionados[0].data(0, Qt.ItemDataRole.UserRole)
        if r.get('erro'):
            self.amostraLabel.setText(f"Este invariante falhou: {r['erro']}")
            return

        amostra = r.get('amostra') or []
        if not amostra:
            self.amostraLabel.setText(f"{r['codigo']}: nenhuma ocorrência.")
            return

        rotulo = f"{r['codigo']}: {r['titulo']}"
        if r.get('truncada'):
            # A amostra é limitada de propósito: quem precisa da lista toda vai
            # atrás dos ids, não de um despejo pela API.
            rotulo += f"  (mostrando {len(amostra)} de {r['total']})"
        self.amostraLabel.setText(rotulo)

        # As colunas saem do próprio resultado: cada invariante devolve o que
        # importa para ele, e uma tabela fixa esconderia justamente a coluna que
        # explica a ocorrência.
        colunas = list(amostra[0].keys())
        self.amostraTable.setColumnCount(len(colunas))
        self.amostraTable.setHorizontalHeaderLabels(colunas)
        self.amostraTable.setRowCount(len(amostra))

        for linha, ocorrencia in enumerate(amostra):
            for coluna, chave in enumerate(colunas):
                valor = ocorrencia.get(chave)
                self.amostraTable.setItem(
                    linha, coluna, QTableWidgetItem('' if valor is None else str(valor))
                )
        self.amostraTable.resizeColumnsToContents()
