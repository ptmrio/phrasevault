import sys
import threading
import pyautogui
import qtawesome as qta
from pynput import keyboard
from PyQt5.QtCore import Qt, QPoint
from PyQt5.QtGui import QFont, QPalette, QColor, QIcon
from PyQt5.QtWidgets import QSystemTrayIcon, QMenu, QAction, QApplication, QDialog, QLineEdit, QVBoxLayout, QListWidget, QListWidgetItem, QPushButton, QHBoxLayout, QMessageBox, QLabel, QWidget, QTextEdit, QDialogButtonBox, QGridLayout
from database import create_connection, create_table, db_search_entries, db_fetch_entry, db_insert_entry, db_update_entry, db_remove_entry, db_increment_usage_count


db_name = "phrases.sqlite"
table_name = "phrases"

conn = create_connection(db_name)
create_table(conn, table_name)


def on_activate():
    search_dialog.toggle_visibility()


def for_canonical(f):
    return lambda k: f(listener.canonical(k))


hotkey = keyboard.HotKey(
    keyboard.HotKey.parse('<ctrl>+l'),
    on_activate)


class CustomTitleBar(QWidget):
    def __init__(self, parent=None):
        super().__init__(parent)
        self.parent_window = parent

        self.layout = QHBoxLayout()
        self.layout.setContentsMargins(0, 0, 0, 0)

        # Window title
        self.title = QLabel("PhraseVault")
        self.title.setFont(QFont("Arial", 14, QFont.Bold))
        self.title.setStyleSheet("color: white;")
        self.layout.addWidget(self.title)

        self.layout.addStretch()

        # Close button
        self.close_button = QPushButton()
        self.close_button.setIcon(qta.icon('fa5s.times-circle', color='white'))
        self.close_button.setStyleSheet("""
            QPushButton {
                background-color: rgb(53, 53, 53);
                border: none;
                border-radius: 10px;
            }
            QPushButton:hover {
                color: rgb(210, 50, 50);
            }
            QPushButton:pressed {
                color: rgb(180, 30, 30);
            }
        """)
        self.close_button.setFixedSize(20, 20)
        self.close_button.clicked.connect(self.minimize_to_tray)
        self.layout.addWidget(self.close_button)

        self.setLayout(self.layout)

        self.start = QPoint(0, 0)
        self.pressing = False

    def mousePressEvent(self, event):
        self.start = event.globalPos()
        self.pressing = True

    def mouseMoveEvent(self, event):
        if self.pressing:
            self.end = event.globalPos()
            self.movement = self.end - self.start
            self.parent_window.move(self.parent_window.pos() + self.movement)
            self.start = self.end

    def mouseReleaseEvent(self, event):
        self.pressing = False

    def minimize_to_tray(self):
        self.parent_window.hide()


class SearchDialog(QDialog):
    def __init__(self):
        super().__init__()

        self.setWindowFlags(Qt.WindowStaysOnTopHint |
                            Qt.FramelessWindowHint)  # Change window flags

        self.resize(500, 400)  # Resize the window

        self.layout = QVBoxLayout()

        # Custom title bar
        self.custom_title_bar = CustomTitleBar(self)
        self.layout.addWidget(self.custom_title_bar)

        self.search_input = QLineEdit()
        self.search_input.setPlaceholderText("Search...")
        self.layout.addWidget(self.search_input)

        # Add a QGridLayout
        self.grid_layout = QGridLayout()
        self.layout.addLayout(self.grid_layout)

        self.results_list = QListWidget()
        self.grid_layout.addWidget(self.results_list, 0, 0, 1, 2)

        self.FAB = QPushButton(
            qta.icon('fa5s.plus-circle', color='white', scale_factor=0.8), "Add Phrase")
        self.FAB.setObjectName("FAB")
        self.FAB.setFont(QFont("Arial", 10, QFont.Bold))
        self.FAB.setStyleSheet("""
            #FAB {
                background-color: #2a82da;
                color: white;
                border: none;
                border-radius: 8px;
                padding: 4px 8px;
                text-align: left;
            }
            #FAB:hover {
                background-color: #3a92e8;
            }
            #FAB:pressed {
                background-color: #1a72c8;
            }
        """)
        self.grid_layout.addWidget(self.FAB, 1, 1, Qt.AlignRight | Qt.AlignBottom)

        self.FAB.clicked.connect(self.add_entry)

        self.setLayout(self.layout)

        self.search_input.textChanged.connect(self.search)
        self.results_list.itemActivated.connect(self.paste_selected_entry)

        self.tray_icon = QSystemTrayIcon(QIcon("icon.png"))
        self.tray_icon.setToolTip("PhraseVault")
        self.tray_icon.activated.connect(self.restore_window)

        # Tray icon menu with Quit option
        self.tray_menu = QMenu()
        self.quit_action = QAction("Quit", self)
        self.quit_action.triggered.connect(QApplication.instance().quit)
        self.tray_menu.addAction(self.quit_action)
        self.tray_icon.setContextMenu(self.tray_menu)

        self.tray_icon.show()

        self.search()

    def paste_selected_entry(self, item):
        selected_id = item.data(Qt.UserRole)
        result = find_entry(selected_id)
        self.hide()

        pyautogui.write(result['expanded_text'])
        use_entry(selected_id)

    def search(self):
        search_text = self.search_input.text()
        results = db_search_entries(conn, table_name, search_text)

        self.results_list.clear()

        for result in results:
            truncated_expanded_text = ' '.join(result[2].splitlines())
            truncated_expanded_text = (truncated_expanded_text[:69] + '...') if len(
                truncated_expanded_text) > 30 else truncated_expanded_text
            item = QListWidgetItem(f"{result[1]}: {truncated_expanded_text}")
            item.setData(Qt.UserRole, result[0])  # Store the ID as custom data
            self.results_list.addItem(item)

    def create_context_menu(self, pos):
        index = self.results_list.indexAt(pos)
        if not index.isValid():
            return

        context_menu = QMenu()

        copy_action = QAction(qta.icon('fa5s.copy', color='white', scale_factor=0.8), "Copy to Clipboard", self)
        copy_action.triggered.connect(self.copy_to_clipboard)
        context_menu.addAction(copy_action)

        context_menu.addSeparator()

        edit_action = QAction(
            qta.icon('fa5s.edit', color='white', scale_factor=0.8), "Edit", self)
        edit_action.triggered.connect(self.edit_entry)
        context_menu.addAction(edit_action)

        delete_action = QAction(
            qta.icon('fa5s.trash-alt', color='white', scale_factor=0.8), "Delete", self)
        delete_action.triggered.connect(self.delete_entry)
        context_menu.addAction(delete_action)

        context_menu.exec_(self.results_list.viewport().mapToGlobal(pos))

    def restore_window(self, reason):
        if reason == QSystemTrayIcon.DoubleClick:
            self.show()
            self.activateWindow()
    
    def keyPressEvent(self, event):
        if event.key() == Qt.Key_Escape:
            self.hide()  # Minimize to system tray
        else:
            super().keyPressEvent(event)

    def add_entry(self):
        input_dialog = QDialog(self)
        input_dialog.setWindowTitle("Add Entry")

        layout = QVBoxLayout()

        phrase_label = QLabel("Phrase:")
        layout.addWidget(phrase_label)
        phrase_input = QLineEdit()
        layout.addWidget(phrase_input)

        expanded_text_label = QLabel("Expanded Text:")
        layout.addWidget(expanded_text_label)
        expanded_text_input = QTextEdit()
        layout.addWidget(expanded_text_input)

        buttons = QDialogButtonBox(
            QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
        layout.addWidget(buttons)
        input_dialog.setLayout(layout)

        def on_accept():
            phrase = phrase_input.text()
            expanded_text = expanded_text_input.toPlainText()
            if phrase and expanded_text:
                add_new_entry(phrase, expanded_text)
                self.search()
            input_dialog.accept()

        buttons.accepted.connect(on_accept)
        buttons.rejected.connect(input_dialog.reject)
        input_dialog.exec_()

    def edit_entry(self):
        selected_item = self.results_list.currentItem()
        if selected_item:
            entry_id = selected_item.data(Qt.UserRole)
            result = find_entry(entry_id)

            input_dialog = QDialog(self)
            input_dialog.setWindowTitle("Edit Entry")

            layout = QVBoxLayout()

            phrase_label = QLabel("Phrase:")
            layout.addWidget(phrase_label)
            phrase_input = QLineEdit(result['phrase'])
            layout.addWidget(phrase_input)

            expanded_text_label = QLabel("Expanded Text:")
            layout.addWidget(expanded_text_label)
            expanded_text_input = QTextEdit(result['expanded_text'])
            layout.addWidget(expanded_text_input)

            buttons = QDialogButtonBox(
                QDialogButtonBox.Ok | QDialogButtonBox.Cancel)
            layout.addWidget(buttons)
            input_dialog.setLayout(layout)

            def on_accept():
                new_phrase = phrase_input.text()
                new_expanded_text = expanded_text_input.toPlainText()
                if new_phrase and new_expanded_text:
                    update_entry(entry_id, new_phrase, new_expanded_text)
                    self.search()
                input_dialog.accept()

            buttons.accepted.connect(on_accept)
            buttons.rejected.connect(input_dialog.reject)
            input_dialog.exec_()

    def delete_entry(self):
        selected_item = self.results_list.currentItem()
        if selected_item:
            entry_id, _ = selected_item.text().split(': ', 1)
            entry_id = int(entry_id)
            result = find_entry(entry_id)
            messageBoxResult = QMessageBox.question(
                self, "Delete Entry", f"Are you sure you want to delete '{result['phrase']}'?", QMessageBox.Yes | QMessageBox.No)
            if messageBoxResult == QMessageBox.Yes:
                remove_entry(entry_id)
                self.search()

    def copy_to_clipboard(self):
        selected_phrase = self.results_list.selectedIndexes()[0]
        entry_id = self.results_list.model().data(selected_phrase, Qt.UserRole)

        # Get the expanded_text from the database using phrase_id
        result = find_entry(entry_id)
        expanded_text = result['expanded_text']

        QApplication.clipboard().setText(expanded_text)
        use_entry(entry_id)


    def toggle_visibility(self):
        if not self.isVisible():
            self.show()
            self.search_input.setFocus()  # Set focus to search input when shown
        else:
            self.hide()


def add_new_entry(phrase, expanded_text):
    db_insert_entry(conn, table_name, phrase, expanded_text)


def update_entry(entry_id, new_phrase, new_expanded_text):
    db_update_entry(conn, table_name, entry_id, new_phrase, new_expanded_text)


def remove_entry(entry_id):
    db_remove_entry(conn, table_name, entry_id)


def find_entry(entry_id):
    return db_fetch_entry(conn, table_name, entry_id)

def use_entry(entry_id):
    db_increment_usage_count(conn, table_name, entry_id)


def hotkey_listener():
    global listener
    with keyboard.Listener(
            on_press=for_canonical(hotkey.press),
            on_release=for_canonical(hotkey.release)) as listener:
        listener.join()


if __name__ == "__main__":
    app = QApplication(sys.argv)
    app.setWindowIcon(QIcon("icon.png"))

    # Dark mode styling
    app.setStyle("Fusion")

    dark_palette = QPalette()
    dark_palette.setColor(QPalette.Window, QColor(53, 53, 53))
    dark_palette.setColor(QPalette.WindowText, Qt.white)
    dark_palette.setColor(QPalette.Base, QColor(25, 25, 25))
    dark_palette.setColor(QPalette.AlternateBase, QColor(53, 53, 53))
    dark_palette.setColor(QPalette.ToolTipBase, Qt.white)
    dark_palette.setColor(QPalette.ToolTipText, Qt.white)
    dark_palette.setColor(QPalette.Text, Qt.white)
    dark_palette.setColor(QPalette.Button, QColor(53, 53, 53))
    dark_palette.setColor(QPalette.ButtonText, Qt.white)
    dark_palette.setColor(QPalette.BrightText, Qt.red)
    dark_palette.setColor(QPalette.Link, QColor(42, 130, 218))
    dark_palette.setColor(QPalette.Highlight, QColor(42, 130, 218))
    dark_palette.setColor(QPalette.HighlightedText, Qt.black)

    app.setPalette(dark_palette)
    app.setStyleSheet(
        "QToolTip { color: #ffffff; background-color: #2a82da; border: 1px solid white; }")

    search_dialog = SearchDialog()
    search_dialog.results_list.setContextMenuPolicy(Qt.CustomContextMenu)
    search_dialog.results_list.customContextMenuRequested.connect(
        search_dialog.create_context_menu)
    
    search_dialog.toggle_visibility()

    # Start the hotkey handling thread
    t = threading.Thread(target=hotkey_listener)
    t.daemon = True
    t.start()

    sys.exit(app.exec_())
