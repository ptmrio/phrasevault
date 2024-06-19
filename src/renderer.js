document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search');
    const phraseList = document.getElementById('phrase-list');
    const addPhraseButton = document.getElementById('add-phrase');
    const modal = document.getElementById('phraseModal');
    const closeButton = document.querySelector('.close');

    const applyTranslations = () => {
        document.querySelectorAll('[data-i18n]').forEach(el => {
            const key = el.getAttribute('data-i18n');
            const attribute = el.getAttribute('data-i18n-attribute');
            if (attribute) {
                el.setAttribute(attribute, window.i18n.t(key));
            } else {
                el.innerText = window.i18n.t(key);
            }
        });
    };

    window.electron.receive('change-language', (lng) => {
        window.i18n.changeLanguage(lng);
        applyTranslations();
    });

    applyTranslations();

    const applyTheme = (theme) => {
        if (theme === 'system') {
            const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
            document.documentElement.setAttribute('data-theme', prefersDarkScheme.matches ? 'dark' : 'light');
            prefersDarkScheme.addEventListener('change', (e) => {
                document.documentElement.setAttribute('data-theme', e.matches ? 'dark' : 'light');
            });
        } else {
            document.documentElement.setAttribute('data-theme', theme);
        }
    };

    // Get the current theme from main process
    const currentTheme = window.electron.sendSync('get-theme');
    applyTheme(currentTheme);

    window.electron.receive('set-theme', (theme) => {
        applyTheme(theme);
    });

    const updateDbStatus = (available) => {
        const status = document.querySelector('#db-status');
        const statusIndicator = status.querySelector('#db-status-indicator');
        const statusText = status.querySelector('#db-status-text');
        if (available) {
            statusText.innerText = window.i18n.t('Phrases loaded');
            statusIndicator.style.color = 'green';
        } else {
            statusText.innerText = window.i18n.t('Waiting for database');
            statusIndicator.style.color = 'orange';
            phraseList.innerHTML = '<li class="loading">' + window.i18n.t('Loading...') + '</li>';
        }
    };

    window.electron.receive('database-status', (data) => {
        updateDbStatus(data);
    });

    window.electron.receive('database-error', (error) => {
        console.log('Database error:', error);
        const status = document.querySelector('#db-status');
        const statusIndicator = status.querySelector('#db-status-indicator');
        const statusText = status.querySelector('#db-status-text');
        statusText.innerText = window.i18n.t('Database error');
        statusIndicator.style.color = 'red';
    });

    const debouncedUpdateList = debounce(updateList, 300);

    searchInput.addEventListener('input', debouncedUpdateList);
    addPhraseButton.addEventListener('click', () => openPhraseForm());

    // Modal
    function openModal() {
        modal.style.display = 'grid';
        setTimeout(() => {
            modal.classList.add('show');
            document.querySelector('.modal-content').classList.add('show');
        }, 10);
    }

    function closeModal() {
        document.querySelector('.modal-content').classList.remove('show');
        modal.classList.remove('show');
        modal.addEventListener('transitionend', () => {
            if (!modal.classList.contains('show')) {
                modal.style.display = 'none';
            }
        }, { once: true });
    }

    const checkScrollbar = () => {
        if (phraseList.scrollHeight > phraseList.clientHeight) {
            phraseList.style.paddingRight = '5px'; // Adjust the margin value as needed
        } else {
            phraseList.style.paddingRight = '0';
        }
    };

    // Initial check
    checkScrollbar();

    // Check again on window resize or content change
    window.addEventListener('resize', checkScrollbar);
    new MutationObserver(checkScrollbar).observe(phraseList, { childList: true, subtree: true });

    // Event listener to open the modal when add phrase button is clicked
    addPhraseButton.addEventListener('click', () => {
        openModal();
    });

    // Event listener to close the modal when the close button is clicked
    closeButton.addEventListener('click', () => {
        closeModal();
    });

    window.addEventListener('click', (e) => {
        if (e.target === modal) {
            modal.style.display = 'none';
        }
    });

    searchInput.addEventListener('keydown', (e) => {
        if (e.key === 'ArrowDown' && phraseList.children.length > 0) {
            phraseList.children[0].focus();
            e.preventDefault();
        }
    });

    phraseList.addEventListener('keydown', (e) => {
        const focusedElement = document.activeElement;
        if (e.key === 'ArrowDown' && focusedElement.nextElementSibling) {
            focusedElement.nextElementSibling.focus();
        } else if (e.key === 'ArrowUp' && focusedElement.previousElementSibling) {
            focusedElement.previousElementSibling.focus();
        } else if (e.key === 'Enter') {
            const phraseId = focusedElement.getAttribute('data-id');
            insertTextIntoActiveField(phraseId);
        }
    });

    function updateList() {
        const searchText = searchInput.value.toLowerCase();
        window.electron.send('search-phrases', searchText);
    }

    window.electron.receive('phrases-list', (phrases) => {
        phraseList.innerHTML = '';
        phrases.forEach(phrase => {
            const li = document.createElement('li');
            li.tabIndex = 0;
            li.setAttribute('data-id', phrase.id);
            li.innerHTML = `
                <span class="phrase-list-text"><strong>${phrase.phrase}</strong> - ${phrase.expanded_text}</span>
                <div class="buttons">
                    <button class="copy-button" data-action="copy" data-id="${phrase.id}" title="${window.i18n.t('Copy to clipboard')}"><svg class="icon"><use href="#icon-copy"></use></svg></button>
                    <button class="edit-button" data-action="edit" data-id="${phrase.id}" title="${window.i18n.t('Edit Phrase')}"><svg class="icon"><use href="#icon-edit"></use></svg></button>
                    <button class="three-dots" title="${window.i18n.t('More')}"><svg class="icon"><use href="#icon-dots-vertical"></use></svg></button>
                </div>
                <div class="menu">
                    <div class="menu-item" data-action="delete" data-id="${phrase.id}" style="background-color: red; color: white; display: flex; gap: 5px;">
                        <svg class="icon"><use href="#icon-trash"></use></svg> <span>${window.i18n.t('Delete Phrase')}</span>
                    </div>
                </div>
            `;

            const menu = li.querySelector('.menu');
            const threeDots = li.querySelector('.three-dots');

            threeDots.addEventListener('click', (e) => {
                e.stopPropagation();
                if (menu.style.display === 'block') {
                    menu.style.display = 'none';
                } else {
                    closeAllMenus();
                    menu.style.display = 'block';
                }
            });

            li.querySelectorAll('.menu-item').forEach(item => {
                item.addEventListener('click', (e) => {
                    const action = e.currentTarget.getAttribute('data-action');
                    const id = e.currentTarget.getAttribute('data-id');
                    if (action === 'delete') {
                        window.electron.send('delete-phrase', id);
                    }
                    menu.style.display = 'none';
                });
            });

            li.querySelector('.copy-button').addEventListener('click', () => {
                window.electron.send('copy-to-clipboard', phrase.expanded_text);
                window.electron.send('increment-usage', phrase.id);
                showToast(window.i18n.t('Copied to clipboard'), 'success');
            });

            li.querySelector('.edit-button').addEventListener('click', () => {
                openPhraseForm(phrase.phrase, phrase.expanded_text, phrase.id);
            });

            phraseList.appendChild(li);
        });
    });

    document.addEventListener('click', closeAllMenus);

    function closeAllMenus() {
        document.querySelectorAll('.menu').forEach(menu => {
            menu.style.display = 'none';
        });
    }

    function openPhraseForm(phrase = '', expandedText = '', id = null) {
        const modal = document.querySelector('#phraseModal');
        const title = modal.querySelector('#modal-title')
        const phraseInput = modal.querySelector('#phraseInput');
        const expandedTextInput = modal.querySelector('#expandedTextInput');
        const idInput = modal.querySelector('#idInput');

        phraseInput.value = phrase;
        expandedTextInput.value = expandedText;
        idInput.value = id;

        title.textContent = id ? 'Edit Phrase' : 'Add Phrase';

        openModal();

        phraseInput.focus();

        const saveButton = modal.querySelector('#saveButton');
        // Remove existing event listener if any
        saveButton.removeEventListener('click', handleSaveButtonClick);
        // Add event listener for the save button
        saveButton.addEventListener('click', handleSaveButtonClick);
    }

    function handleSaveButtonClick() {
        const phraseInput = document.querySelector('#phraseInput');
        const expandedTextInput = document.querySelector('#expandedTextInput');
        const idInput = document.querySelector('#idInput');

        const newPhrase = phraseInput.value;
        const newExpandedText = expandedTextInput.value;
        const id = idInput.value;

        if (!newPhrase.trim()) {
            showToast(window.i18n.t('Phrase cannot be empty'), 'danger');
            return;
        }

        if (id) {
            window.electron.send('edit-phrase', { id, newPhrase, newExpandedText });
        } else {
            window.electron.send('add-phrase', { newPhrase, newExpandedText });
        }
    }

    function showToast(message, type = 'success') {
        const toast = document.createElement('div');
        toast.className = 'toast';
        toast.textContent = message;
        document.body.appendChild(toast);
        toast.classList.add('show');
        toast.classList.add(type);
        setTimeout(() => {
            toast.classList.remove('show');
            document.body.removeChild(toast);
        }, 3000);
    }

    function debounce(func, wait) {
        let timeout;
        return function(...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function insertTextIntoActiveField(id) {
        window.electron.send('get-phrase-by-id', id);
    }

    window.electron.receive('phrase-to-insert', (phrase) => {
        console.log('Inserting text:', phrase.expanded_text);
        window.electron.send('insert-text', phrase.expanded_text);
        window.electron.send('increment-usage', phrase.id);
    });

    window.electron.receive('focus-search', () => {
        searchInput.focus();
        searchInput.select();
    });

    // toast on add, edit, delete
    window.electron.receive('phrase-added', (phrase) => {
        closeModal();
        updateList();
    });

    window.electron.receive('phrase-edited', (phrase) => {
        closeModal();
        updateList();
    });

    window.electron.receive('phrase-deleted', (id) => {
        updateList();
    });

    window.electron.receive('toast-message', (message) => {
        showToast(message.message, message.type);
    });

    updateList();
});
