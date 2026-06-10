# Path: core\settings.py
from qgis.core import QgsSettings
from ..config import Config

class Settings:
    def __init__(self):
        self.qsettings = QgsSettings()
        self.qsettings.beginGroup(Config.NAME)

    def get(self, key, default=None):
        return self.qsettings.value(key, default)

    def set(self, key, value):
        self.qsettings.setValue(key, value)

    def remove(self, key):
        self.qsettings.remove(key)

    def sync(self):
        self.qsettings.sync()

    def __del__(self):
        self.qsettings.endGroup()