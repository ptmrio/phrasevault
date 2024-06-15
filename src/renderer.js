document.addEventListener('DOMContentLoaded', () => {
    const searchInput = document.getElementById('search');
    const phraseList = document.getElementById('phrase-list');
    const addPhraseButton = document.getElementById('add-phrase');
    const modal = document.getElementById('phraseModal');
    const closeButton = document.querySelector('.close');

    // Apply theme based on system preference
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
                    <button class="copy-button" data-action="copy" data-id="${phrase.id}" title="Copy"><svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="2"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-copy"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 7m0 2.667a2.667 2.667 0 0 1 2.667 -2.667h8.666a2.667 2.667 0 0 1 2.667 2.667v8.666a2.667 2.667 0 0 1 -2.667 2.667h-8.666a2.667 2.667 0 0 1 -2.667 -2.667z" /><path d="M4.012 16.737a2.005 2.005 0 0 1 -1.012 -1.737v-10c0 -1.1 .9 -2 2 -2h10c.75 0 1.158 .385 1.5 1" /></svg></button>
                    <button class="edit-button" data-action="edit" data-id="${phrase.id}" title="Edit"><svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="2"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-edit"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M7 7h-1a2 2 0 0 0 -2 2v9a2 2 0 0 0 2 2h9a2 2 0 0 0 2 -2v-1" /><path d="M20.385 6.585a2.1 2.1 0 0 0 -2.97 -2.97l-8.415 8.385v3h3l8.385 -8.415z" /><path d="M16 5l3 3" /></svg></button>
                    <button class="three-dots" title="More"><svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="2"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-dots-vertical"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M12 12m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M12 19m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /><path d="M12 5m-1 0a1 1 0 1 0 2 0a1 1 0 1 0 -2 0" /></svg></button>
                </div>
                <div class="menu">
                    <div class="menu-item" data-action="delete" data-id="${phrase.id}" style="background-color: red; color: white; display: flex; gap: 5px;">
                        <svg  xmlns="http://www.w3.org/2000/svg"  width="24"  height="24"  viewBox="0 0 24 24"  fill="none"  stroke="currentColor"  stroke-width="2"  stroke-linecap="round"  stroke-linejoin="round"  class="icon icon-tabler icons-tabler-outline icon-tabler-trash"><path stroke="none" d="M0 0h24v24H0z" fill="none"/><path d="M4 7l16 0" /><path d="M10 11l0 6" /><path d="M14 11l0 6" /><path d="M5 7l1 12a2 2 0 0 0 2 2h8a2 2 0 0 0 2 -2l1 -12" /><path d="M9 7v-3a1 1 0 0 1 1 -1h4a1 1 0 0 1 1 1v3" /></svg> <span>Delete</span>
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
                showToast('Copied to clipboard', 'success');
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
            showToast('Phrase cannot be empty', 'danger');
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
        window.electron.send('insert-text', phrase.expanded_text);
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
