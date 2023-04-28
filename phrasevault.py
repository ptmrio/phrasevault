import os
import sys
import time
import tkinter as tk
import pyperclip
import queue
import threading
import pystray
from tkinter import ttk, messagebox
from tkinter.font import nametofont
from tkinter.scrolledtext import ScrolledText
from PIL import Image
from ttkthemes import ThemedTk
from database import *
from pynput import keyboard
from pynput.keyboard import Controller


os.chdir(os.path.dirname(os.path.abspath(__file__)))


db_name = "phrasevault.sqlite"
table_name = "phrases"
db_conn = create_connection(db_name)
create_table(db_conn, table_name)



def resource_path(relative_path):
    try:
        base_path = sys._MEIPASS
    except Exception:
        base_path = os.path.abspath(".")

    return os.path.join(base_path, relative_path)


def center_window(window):
    window.update_idletasks()
    width = window.winfo_width()
    height = window.winfo_height()
    screen_width = window.winfo_screenwidth()
    screen_height = window.winfo_screenheight()
    x = (screen_width // 2) - (width // 2)
    y = (screen_height // 2) - (height // 2)
    window.geometry(f"{width}x{height}+{x}+{y}")


# Main Interface
class PhraseVault(ThemedTk):
    def __init__(self):
        super().__init__()

        self.keyboard_controller = Controller()

        self.set_theme("arc")
        self.title("PhraseVault")
        self.geometry("500x300")
        self.resizable(False, False)
        self.protocol("WM_DELETE_WINDOW", self.minimize_to_tray)
        self.iconbitmap(resource_path("icon.ico"))
        self.bind("<Escape>", self.minimize_to_tray)

        center_window(self)

        self.open_add_edit_phrase_windows = []

        self.queue = queue.Queue()
        self.process_queue()

        self.search_var = tk.StringVar()
        self.search_var.trace_add("write", self.update_list)
        self.search_entry = ttk.Entry(self, textvariable=self.search_var)
        self.search_entry.grid(row=0, column=0, padx=5, pady=5, sticky="nsew")
        self.search_entry.bind('<Return>', self.on_search_enter_key)
        self.search_entry.bind(
            '<Down>', lambda event: self.listbox.focus_set())

        self.listbox = tk.Listbox(self)
        self.listbox.bind('<Double-Button-1>', self.write_expanded_text)
        self.listbox.bind('<Return>', self.write_expanded_text)
        self.listbox.bind('<Button-3>', self.select_on_right_click)

        self.listbox.grid(row=1, column=0, padx=5, pady=5, sticky="nsew")

        self.add_phrase_button = ttk.Button(
            self, text="+ Add Phrase", command=self.add_phrase)
        self.add_phrase_button.grid(
            row=2, column=0, padx=5, pady=5, sticky="nsew")

        self.columnconfigure(0, weight=1)
        self.rowconfigure(1, weight=1)

        self.context_menu = tk.Menu(self, tearoff=0)

        self.context_menu.add_command(label="Edit", command=self.edit_entry)
        self.context_menu.add_command(label="Copy", command=self.copy_entry)
        self.context_menu.add_command(
            label="Delete", command=self.delete_entry)

        self.update_list()

        self.search_entry.focus()

    def on_search_enter_key(self, event):
        if self.listbox.size() > 0:
            self.listbox.selection_clear(0, tk.END)
            self.listbox.selection_set(0)
            self.listbox.activate(0)
            self.write_expanded_text(event)

    def show_context_menu(self, event):
        self.context_menu.post(event.x_root, event.y_root)

    def select_on_right_click(self, event):
        self.listbox.selection_clear(0, tk.END)
        self.listbox.selection_set(self.listbox.nearest(event.y))
        self.show_context_menu(event)

    def edit_entry(self):
        selected_index = self.listbox.curselection()
        if selected_index:
            entry_id = db_search_entries(db_conn, table_name, self.search_var.get())[
                selected_index[0]][0]
            edit_phrase_window = AddEditPhraseWindow(self, entry_id)
            self.wait_window(edit_phrase_window)
            self.update_list()

    def copy_entry(self):
        selected_index = self.listbox.curselection()
        if selected_index:
            entry_id = db_search_entries(db_conn, table_name, self.search_var.get())[
                selected_index[0]][0]
            entry = db_fetch_entry(db_conn, table_name, entry_id)
            pyperclip.copy(entry['expanded_text'])

    def delete_entry(self):
        selected_index = self.listbox.curselection()
        if selected_index:
            entry_id = db_search_entries(db_conn, table_name, self.search_var.get())[
                selected_index[0]][0]
            db_remove_entry(db_conn, table_name, entry_id)
            self.update_list()

    def process_queue(self):
        while not self.queue.empty():
            action = self.queue.get()
            if action == 'deiconify':
                self.deiconify()
        self.after(100, self.process_queue)

    def update_list(self, *args):
        search_text = self.search_var.get()
        entries = db_search_entries(db_conn, table_name, search_text)
        self.listbox.delete(0, tk.END)
        for entry in entries:
            self.listbox.insert(tk.END, f"{entry[1]} - {entry[2]}")

        self.listbox.selection_clear(0, tk.END)
        self.listbox.selection_set(0)
        self.listbox.activate(0)

    def write_expanded_text(self, event):
        selected_index = self.listbox.curselection()
        if selected_index:
            entry_id = db_search_entries(db_conn, table_name, self.search_var.get())[
                selected_index[0]][0]
            entry = db_fetch_entry(db_conn, table_name, entry_id)
            db_increment_usage_count(db_conn, table_name, entry_id)
            self.update_list()
            self.minimize_to_tray()

            time.sleep(0.1)
            app.after(100, app.keyboard_controller.type,
                      entry['expanded_text'])

    def add_phrase(self):
        add_phrase_window = AddEditPhraseWindow(self)
        self.wait_window(add_phrase_window)
        self.update_list()

    def add_to_parent_list(self, child):
        self.open_add_edit_phrase_windows.append(child)

    def remove_from_parent_list(self, child):
        self.open_add_edit_phrase_windows.remove(child)

    def close_all_add_edit_phrase_windows(self):
        for window in self.open_add_edit_phrase_windows:
            window.destroy()
        self.open_add_edit_phrase_windows.clear()

    def minimize_to_tray(self, event=None):
        self.close_all_add_edit_phrase_windows()
        self.withdraw()


# Add/Edit Phrase window
class AddEditPhraseWindow(tk.Toplevel):
    def __init__(self, parent, entry_id=None):
        super().__init__(parent)

        self.parent = parent
        self.entry_id = entry_id

        self.title("Add Phrase" if not entry_id else "Edit Phrase")
        self.columnconfigure(1, weight=1)
        self.rowconfigure(0, weight=1)
        self.attributes("-topmost", True)

        self.geometry("480x300")
        self.resizable(False, False)
        self.iconbitmap(resource_path("icon.ico"))

        center_window(self)

        self.parent.add_to_parent_list(self)

        self.phrase_var = tk.StringVar()
        self.expanded_text_var = tk.StringVar()

        ttk.Label(self, text="Phrase:").grid(
            row=0, column=1, padx=5, pady=5, sticky="w")
        self.phrase_entry = ttk.Entry(self, textvariable=self.phrase_var)
        self.phrase_entry.grid(row=1, column=1, padx=5, pady=5, sticky="nsew")

        input_font = self.phrase_entry.cget("font")

        ttk.Label(self, text="Expanded Text:").grid(
            row=2, column=1, padx=5, pady=5, sticky="w")
        self.expanded_text_entry = ScrolledText(
            self, wrap=tk.WORD, height=10, width=20, font=input_font)
        self.expanded_text_entry.grid(
            row=3, column=1, padx=5, pady=5, sticky="nsew")

        self.save_button = ttk.Button(
            self, text="Save", command=self.save_phrase)
        self.save_button.grid(row=4, column=1, padx=5, pady=5, sticky="e")

        self.columnconfigure(1, weight=1)

        if self.entry_id:
            entry = db_fetch_entry(db_conn, table_name, self.entry_id)
            self.phrase_var.set(entry['phrase'])
            self.expanded_text_entry.insert(tk.END, entry['expanded_text'])

    def save_phrase(self):
        phrase = self.phrase_var.get()
        expanded_text = self.expanded_text_entry.get("1.0", tk.END).strip()

        if not phrase or not expanded_text:
            messagebox.showerror(
                "Error", "Both Phrase and Expanded Text fields are required.", parent=self)
            return

        if self.entry_id:
            db_update_entry(db_conn, table_name, self.entry_id,
                            phrase, expanded_text)
        else:
            db_insert_entry(db_conn, table_name, phrase, expanded_text)

        self.parent.remove_from_parent_list(self)
        self.destroy()


def toggle_main_window():
    if app.state() == 'withdrawn':
        app.queue.put('deiconify')
        center_window(app)
        app.attributes('-topmost', True)
        app.after(100, app.search_entry.focus_set)
    else:
        app.minimize_to_tray()


def on_quit(icon, action):
    icon.stop()
    app.after(0, app.destroy)


def run_tray_icon(app):
    app.tray_icon.run()


if __name__ == "__main__":
    app = PhraseVault()

    center_window(app)

    tray_image = Image.open(resource_path("tray_icon.png"))

    app.tray_icon = pystray.Icon("PhraseVault", tray_image, "PhraseVault", menu=pystray.Menu(
        pystray.MenuItem('Toggle (Ctrl + .)',
                         toggle_main_window, default=True),
        pystray.MenuItem('Quit', on_quit)))

    app.after(100, app.search_entry.focus_set)

    tray_icon_thread = threading.Thread(target=app.tray_icon.run)
    tray_icon_thread.start()

    with keyboard.GlobalHotKeys({'<ctrl>+.': toggle_main_window}) as hotkey_listener:
        app.mainloop()
