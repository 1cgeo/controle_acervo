# Path: gui\catalogar_volume\catalogar_volume_dialog.py
"""Catalogar produto que JÁ ESTÁ no volume, sem transferir nem medir nada aqui.

QUANDO USAR ESTA TELA e não "Adicionar Produtos Completos em Lote": quando a
entrega já foi gravada no volume no layout do fornecedor (o caso do Convênio RS)
e o que falta é o REGISTRO, não a cópia.

O QUE MUDA NO CONTRATO, e as duas coisas vêm de não haver transferência:

  - `volume_armazenamento_id` é obrigatório e sai daqui, porque é onde o arquivo
    já está. No upload o volume é o primário do tipo de produto, já que lá quem
    escolhe o destino é o servidor.
  - `checksum` e `tamanho_mb` são RECUSADOS pelo servidor (400). Quem mede é ele,
    lendo o arquivo uma vez. Por isso esta tela NÃO calcula hash: fazê-lo aqui
    obrigaria a ler o arquivo inteiro duas vezes, uma no cliente e outra na
    conferência do servidor.

O `nome_arquivo` aqui é o caminho RELATIVO à raiz do volume, com barra normal e
subpasta inclusa (`LOTE_1/IMAGENS/Ortoimagem_MI 2965-1`), e não um nome solto.
"""
import os

from qgis.PyQt import uic
from qgis.PyQt.QtCore import Qt
from qgis.PyQt.QtWidgets import QDialog, QMessageBox

from ..camada_modelo import (Campo, CamadaModelo, preencher_combo_de_camadas,
                             relatar_feicoes_invalidas)
from ..campos_acervo import (CAMPOS_ARQUIVO, CAMPOS_PRODUTO, CAMPOS_VERSAO,
                             agrupar_produtos_versoes, conferir_identidade)

FORM_CLASS, _ = uic.loadUiType(os.path.join(
    os.path.dirname(__file__), 'catalogar_volume_dialog.ui'))

# Teto do schema (catalogarProduto): a requisição fica aberta enquanto o servidor
# lê os bytes, então o lote é limitado e quem tem mais chama de novo.
MAX_POR_CHAMADA = 200


def _renomear(campos, de_para):
    return [Campo(de_para.get(c.nome, c.nome), c.tipo, c.obrigatorio, c.ajuda) for c in campos]


# `path`, `checksum` e `tamanho_mb` NÃO existem aqui: não há arquivo local para
# apontar, e os dois últimos o servidor recusa. `nome_arquivo` muda de sentido e
# por isso muda de texto de ajuda.
CAMPOS_ARQUIVO_NO_VOLUME = [
    Campo('descricao_arquivo' if c.nome == 'descricao' else c.nome, c.tipo, c.obrigatorio,
          ('caminho do arquivo RELATIVO à raiz do volume, com barra normal e sem a '
           'extensão (ex.: LOTE_1/IMAGENS/Ortoimagem_MI 2965-1)')
          if c.nome == 'nome_arquivo' else c.ajuda)
    for c in CAMPOS_ARQUIVO if c.nome != 'path'
]

MODELO = CamadaModelo(
    "Modelo - Catalogar produtos já no volume",
    [Campo('produto_grupo_id', 'integer', True,
           'mesmo número nas linhas que são o MESMO produto'),
     Campo('versao_grupo_id', 'integer', True,
           'mesmo número nas linhas que são a MESMA versão daquele produto')]
    + _renomear(CAMPOS_PRODUTO, {'nome': 'produto_nome', 'descricao': 'descricao_produto'})
    + [Campo('uuid_versao', 'string', False, 'uuid da versão, se o BDGEx já publicou um')]
    + CAMPOS_VERSAO
    + CAMPOS_ARQUIVO_NO_VOLUME,
    com_geometria=True,
    observacao=("Uma linha por ARQUIVO. Nenhum byte é copiado: os arquivos já estão no volume "
                "escolhido acima, e é o SERVIDOR que lê cada um para medir o checksum e o "
                "tamanho. Não existe campo de checksum nem de caminho local, e mandá-los é erro.")
)


class CatalogarVolumeDialog(QDialog, FORM_CLASS):
    def __init__(self, iface, api_client, parent=None):
        super(CatalogarVolumeDialog, self).__init__(parent)
        self.setupUi(self)
        self.iface = iface
        self.api_client = api_client
        self.setup_ui()

    def setup_ui(self):
        self.setWindowTitle("Catalogar produtos já no volume")

        # Os botões são ligados ANTES de qualquer saída antecipada. Ligá-los no
        # fim deixava "Criar camada modelo" clicável e inerte sempre que não
        # houvesse volume de origem.
        self.catalogarButton.clicked.connect(self.catalogar)
        self.createModelLayerButton.clicked.connect(self.criar_camada_modelo)

        # SÓ volume com layout de origem. É a porta que impede esta rota de virar
        # atalho para pular a validação de transferência do acervo comum: o
        # servidor recusa qualquer outro, e oferecê-los aqui seria convidar ao 400.
        volumes = self.api_client.dominios.volumes_de_origem()
        self.volumeComboBox.clear()
        for volume in volumes:
            self.volumeComboBox.addItem(f"{volume['nome']} ({volume['volume']})", volume['id'])

        if not volumes:
            self.volumeComboBox.setEnabled(False)
            self.catalogarButton.setEnabled(False)
            self.createModelLayerButton.setEnabled(False)
            self.statusLabel.setText(
                "Nenhum volume marcado como 'layout de origem'. Marque a opção em "
                "Gerenciar Volumes antes de catalogar."
            )
            return

        if preencher_combo_de_camadas(self.layerComboBox, MODELO.com_geometria) == 0:
            self.layerComboBox.setEnabled(False)
            self.catalogarButton.setEnabled(False)
            self.statusLabel.setText(
                "Nenhuma camada compatível no projeto. Crie a camada modelo para começar."
            )

    def criar_camada_modelo(self):
        if MODELO.criar(self, self.layerComboBox, self.iface):
            self.catalogarButton.setEnabled(True)
            self.statusLabel.setText("Camada modelo criada. Preencha as feições e catalogue.")

    def catalogar(self):
        camada = self.layerComboBox.currentData()
        ok, motivo = MODELO.validar_camada(camada)
        if not ok:
            QMessageBox.critical(self, "Camada incompatível", motivo)
            return

        volume_id = self.volumeComboBox.currentData()
        if volume_id is None:
            QMessageBox.warning(self, "Volume", "Escolha o volume onde os arquivos já estão.")
            return

        produtos, invalidas, total = agrupar_produtos_versoes(
            camada, self.api_client.dominios, com_arquivos=True
        )
        if not relatar_feicoes_invalidas(self, invalidas, total):
            return
        if not produtos:
            QMessageBox.warning(self, "Nada a enviar", "A camada não tem nenhum produto válido.")
            return

        for produto in produtos:
            recado = conferir_identidade(
                produto['subtipo_produto_id'],
                [v['subtipo_produto_id'] for v in produto['versoes']],
                self.api_client.dominios
            )
            if recado:
                QMessageBox.critical(self, "Subtipo incompatível",
                                     f"Produto '{produto['nome']}':\n\n{recado}")
                return

        corpo = self.montar_corpo(produtos)
        self.enviar_em_lotes(volume_id, corpo)

    def montar_corpo(self, produtos):
        """Descarta o que a rota recusa e monta a forma aninhada que ela pede."""
        saida = []
        for produto in produtos:
            versoes = []
            for versao in produto['versoes']:
                arquivos = []
                for arquivo, _feature in versao['arquivos']:
                    # checksum e tamanho_mb são medidos pelo servidor. Mandá-los
                    # é 400, e de propósito: descartados em silêncio, o cliente
                    # acreditaria ter gravado o que mandou.
                    arquivos.append({k: v for k, v in arquivo.items()
                                     if k not in ('checksum', 'tamanho_mb', 'uuid_arquivo')})
                versoes.append({**{k: v for k, v in versao.items() if k != 'arquivos'},
                                'arquivos': arquivos})
            saida.append({
                'produto': {k: v for k, v in produto.items() if k != 'versoes'},
                'versoes': versoes,
            })
        return saida

    def enviar_em_lotes(self, volume_id, produtos):
        """Envia em fatias de MAX_POR_CHAMADA.

        Cada chamada é ATÔMICA e não há sessão: a retomada é a requisição
        seguinte. Por isso o laço para na primeira falha e diz até onde foi --
        seguir adiante deixaria um buraco no meio do lote.
        """
        enviados = 0
        arquivos = 0
        fatias = [produtos[i:i + MAX_POR_CHAMADA]
                  for i in range(0, len(produtos), MAX_POR_CHAMADA)]

        self.catalogarButton.setEnabled(False)
        self.setCursor(Qt.CursorShape.WaitCursor)
        try:
            for indice, fatia in enumerate(fatias, start=1):
                self.statusLabel.setText(
                    f"Catalogando lote {indice}/{len(fatias)} ({len(fatia)} produto(s))... "
                    "O servidor está lendo os arquivos para medir o checksum."
                )
                self.statusLabel.repaint()

                # Timeout largo: a leitura dos bytes acontece dentro desta
                # requisição, e um lote de ortoimagens leva minutos.
                resposta = self.api_client.post(
                    'arquivo/catalogar/product',
                    {'volume_armazenamento_id': volume_id, 'produtos': fatia},
                    timeout=3600
                )

                if not resposta or 'dados' not in resposta:
                    QMessageBox.critical(
                        self, "Catalogação interrompida",
                        f"O lote {indice} falhou. Os {enviados} produto(s) dos lotes "
                        "anteriores JÁ foram catalogados (cada lote é uma transação "
                        "própria).\n\nCorrija a causa e recomece a partir do lote que falhou."
                    )
                    return

                dados = resposta['dados']
                enviados += len(dados.get('produtos', []))
                arquivos += dados.get('total_arquivos', 0)
        finally:
            self.setCursor(Qt.CursorShape.ArrowCursor)
            self.catalogarButton.setEnabled(True)

        self.statusLabel.setText(f"{enviados} produto(s) e {arquivos} arquivo(s) catalogados.")
        QMessageBox.information(
            self, "Pronto",
            f"{enviados} produto(s) e {arquivos} arquivo(s) catalogados no volume.\n\n"
            "Nenhum byte foi copiado: o checksum e o tamanho foram medidos pelo servidor "
            "lendo os arquivos onde eles já estavam."
        )
