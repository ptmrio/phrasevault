import sys
import os
import sqlite3


def create_connection(db_name):
    if getattr(sys, 'frozen', False):
        application_path = os.path.dirname(sys.executable)
    elif __file__:
        application_path = os.path.dirname(__file__)
    db_path = os.path.join(application_path, db_name)
    conn = sqlite3.connect(db_path)
    return conn


def create_table(conn, table_name):
    cursor = conn.cursor()
    cursor.execute(
        f"""CREATE TABLE IF NOT EXISTS {table_name} (
            id INTEGER PRIMARY KEY, 
            phrase TEXT NOT NULL, 
            expanded_text TEXT NOT NULL, 
            usageCount INTEGER DEFAULT 0, 
            dateAdd TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 
            dateUpd TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP, 
            dateLastUsed TIMESTAMP)""")
    conn.commit()


def db_insert_entry(conn, table_name, phrase, expanded_text):
    cursor = conn.cursor()
    cursor.execute(
        f"""INSERT INTO {table_name} (
            phrase, expanded_text) VALUES (?, ?)""", (phrase, expanded_text))
    conn.commit()


def db_update_entry(conn, table_name, entry_id, new_phrase, new_expanded_text):
    cursor = conn.cursor()
    cursor.execute(f"""UPDATE {table_name} SET 
                        phrase = ?, 
                        expanded_text = ?, 
                        dateUpd = CURRENT_TIMESTAMP 
                      WHERE id = ?""",
                   (new_phrase, new_expanded_text, entry_id))
    conn.commit()


def db_remove_entry(conn, table_name, entry_id):
    cursor = conn.cursor()
    cursor.execute(f"DELETE FROM {table_name} WHERE id = ?", (entry_id,))
    conn.commit()


def db_search_entries(conn, table_name, search_text, limit=25):
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {table_name} WHERE phrase LIKE ? OR expanded_text LIKE ? ORDER BY usageCount DESC, dateAdd DESC LIMIT ?",
                   (f"%{search_text}%", f"%{search_text}%", limit))
    return cursor.fetchall()


def db_fetch_entry(conn, table_name, entry_id):
    cursor = conn.cursor()
    cursor.execute(f"SELECT * FROM {table_name} WHERE id = ?", (entry_id,))
    row = cursor.fetchone()
    if row:
        return {'id': row[0], 'phrase': row[1], 'expanded_text': row[2]}
    return None


def db_increment_usage_count(conn, table_name, entry_id):
    cursor = conn.cursor()
    cursor.execute(f"""UPDATE {table_name} SET 
                        usageCount = usageCount + 1, 
                        dateLastUsed = CURRENT_TIMESTAMP 
                      WHERE id = ?""", (entry_id,))
    conn.commit()


def db_search_entry_by_phrase(conn, table, phrase):
    cursor = conn.cursor()
    cursor.execute(
        f"SELECT * FROM {table} WHERE phrase = ?", (phrase,))
    row = cursor.fetchone()

    return row_to_entry(row) if row else None
