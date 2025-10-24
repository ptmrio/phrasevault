document.addEventListener("DOMContentLoaded", () => {
    // Cache frequently used DOM elements at module level
    const searchInput = document.getElementById("search");
    const phraseList = document.getElementById("phrase-list");
    const addPhraseButton = document.getElementById("add-phrase");
    const modal = document.getElementById("phraseModal");
    const closeButton = document.querySelector(".close");
    const dbStatus = document.querySelector("#db-status");
    const dbStatusIndicator = dbStatus.querySelector("#db-status-indicator");
    const dbStatusText = dbStatus.querySelector("#db-status-text");

    // AbortController for save button event listener management
    let saveButtonController = null;

    // Template for optimized SVG icon creation
    const iconTemplate = document.createElement("template");
    iconTemplate.innerHTML = '<svg class="icon"><use href=""></use></svg>';

    const applyTranslations = () => {
        document.querySelectorAll("[data-i18n]").forEach((el) => {
            const key = el.getAttribute("data-i18n");
            const attribute = el.getAttribute("data-i18n-attribute");
            if (attribute) {
                el.setAttribute(attribute, window.i18n.t(key));
            } else {
                el.innerText = window.i18n.t(key);
            }
        });
    };

    window.electron.receive("change-language", (lng) => {
        window.i18n.changeLanguage(lng);
        applyTranslations();
    });

    applyTranslations();

    const applyTheme = (theme) => {
        if (theme === "system") {
            const prefersDarkScheme = window.matchMedia("(prefers-color-scheme: dark)");
            document.documentElement.setAttribute("data-theme", prefersDarkScheme.matches ? "dark" : "light");
            prefersDarkScheme.addEventListener("change", (e) => {
                document.documentElement.setAttribute("data-theme", e.matches ? "dark" : "light");
            });
        } else {
            document.documentElement.setAttribute("data-theme", theme);
        }
    };

    // Get the current theme from main process
    const currentTheme = window.electron.sendSync("get-theme");
    applyTheme(currentTheme);

    window.electron.receive("set-theme", (theme) => {
        applyTheme(theme);
    });

    const updateDbStatus = (available) => {
        if (available) {
            dbStatusText.innerText = window.i18n.t("Phrases loaded");
            dbStatusIndicator.style.color = "green";
        } else {
            dbStatusText.innerText = window.i18n.t("Waiting for database");
            dbStatusIndicator.style.color = "orange";
            phraseList.innerHTML = '<li class="loading">' + window.i18n.t("Loading...") + "</li>";
        }
    };

    window.electron.receive("database-status", (data) => {
        updateDbStatus(data);
    });

    window.electron.receive("database-error", (error) => {
        console.log("Database error:", error);
        dbStatusText.innerText = window.i18n.t("Database error");
        dbStatusIndicator.style.color = "red";
    });

    const debouncedUpdateList = debounce(updateList, 300);

    searchInput.addEventListener("input", debouncedUpdateList);

    // Modal
    function openModal() {
        modal.style.display = "grid";
        setTimeout(() => {
            modal.classList.add("show");
            document.querySelector(".modal-content").classList.add("show");
        }, 10);
    }

    function closeModal() {
        modal.querySelector(".modal-content").classList.remove("show");
        modal.classList.remove("show");
        modal.addEventListener(
            "transitionend",
            () => {
                if (!modal.classList.contains("show")) {
                    modal.style.display = "none";
                }
            },
            { once: true }
        );
    }

    const checkScrollbar = () => {
        if (phraseList.scrollHeight > phraseList.clientHeight) {
            phraseList.style.paddingRight = "5px";
        } else {
            phraseList.style.paddingRight = "0";
        }
    };

    // Initial check
    checkScrollbar();

    // Check again on window resize or content change
    window.addEventListener("resize", checkScrollbar);

    // Store MutationObserver reference for cleanup
    const scrollObserver = new MutationObserver(checkScrollbar);
    scrollObserver.observe(phraseList, { childList: true, subtree: true });

    // Cleanup observer on window unload
    window.addEventListener("beforeunload", () => {
        if (scrollObserver) {
            scrollObserver.disconnect();
        }
    });

    // Event listener to open the modal when add phrase button is clicked
    addPhraseButton.addEventListener("click", () => {
        openModal();
    });

    // Event listener to close the modal when the close button is clicked
    closeButton.addEventListener("click", () => {
        closeModal();
    });

    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" && phraseList.children.length > 0) {
            phraseList.children[0].focus();
            e.preventDefault();
        }
    });

    phraseList.addEventListener("keydown", (e) => {
        const focusedElement = document.activeElement;
        if (e.key === "ArrowDown" && focusedElement.nextElementSibling) {
            focusedElement.nextElementSibling.focus();
        } else if (e.key === "ArrowUp" && focusedElement.previousElementSibling) {
            focusedElement.previousElementSibling.focus();
        } else if (e.key === "Enter") {
            const phraseId = focusedElement.getAttribute("data-id");
            insertTextIntoActiveField(phraseId);
        }
    });

    phraseList.addEventListener("dblclick", (e) => {
        const targetElement = e.target.closest("li");
        if (targetElement && (e.target === targetElement || e.target.classList.contains("phrase-list-text"))) {
            const phraseId = targetElement.getAttribute("data-id");
            insertTextIntoActiveField(phraseId);
        }
    });

    function updateList() {
        try {
            const searchText = searchInput.value;
            window.electron.send("search-phrases", searchText);
        } catch (error) {
            console.error("Failed to search phrases:", error);
            showToast(window.i18n.t("Search failed"), "danger");
        }
    }

    function createSvgIcon(iconId) {
        const icon = iconTemplate.content.cloneNode(true).querySelector("svg");
        icon.querySelector("use").setAttribute("href", `#${iconId}`);
        return icon;
    }

    window.electron.receive("phrases-list", (phrases) => {
        phraseList.innerHTML = "";
        phrases.forEach((phrase) => {
            const li = document.createElement("li");
            li.tabIndex = 0;
            li.setAttribute("data-id", phrase.id);

            // Create elements for phrase text and buttons
            const span = document.createElement("span");
            span.className = "phrase-list-text";
            const strong = document.createElement("strong");
            strong.textContent = phrase.phrase.length > 200 ? phrase.phrase.substring(0, 200) : phrase.phrase;
            span.appendChild(strong);
            span.appendChild(document.createTextNode(" - " + phrase.expanded_text));
            const divButtons = document.createElement("div");
            divButtons.className = "buttons";

            // Copy button
            const copyButton = document.createElement("button");
            copyButton.className = "copy-button";
            copyButton.setAttribute("data-action", "copy");
            copyButton.setAttribute("data-id", phrase.id);
            copyButton.title = window.i18n.t("Copy to clipboard");
            const svgCopy = createSvgIcon("icon-copy");
            copyButton.appendChild(svgCopy);

            // Edit button
            const editButton = document.createElement("button");
            editButton.className = "edit-button";
            editButton.setAttribute("data-action", "edit");
            editButton.setAttribute("data-id", phrase.id);
            editButton.title = window.i18n.t("Edit Phrase");
            const svgEdit = createSvgIcon("icon-edit");
            editButton.appendChild(svgEdit);

            // More options button
            const threeDots = document.createElement("button");
            threeDots.className = "three-dots";
            threeDots.title = window.i18n.t("More");
            const svgDots = createSvgIcon("icon-dots-vertical");
            threeDots.appendChild(svgDots);

            // Append buttons to div
            divButtons.appendChild(copyButton);
            divButtons.appendChild(editButton);
            divButtons.appendChild(threeDots);

            // Create menu
            const menu = document.createElement("div");
            menu.className = "menu";
            const menuItem = document.createElement("div");
            menuItem.className = "menu-item";
            menuItem.setAttribute("data-action", "delete");
            menuItem.setAttribute("data-id", phrase.id);
            const svgTrash = createSvgIcon("icon-trash");
            const spanDelete = document.createElement("span");
            spanDelete.textContent = window.i18n.t("Delete Phrase");
            menuItem.appendChild(svgTrash);
            menuItem.appendChild(spanDelete);
            menu.appendChild(menuItem);

            // Construct the list item
            li.appendChild(span);
            li.appendChild(divButtons);
            li.appendChild(menu);

            // Append the list item to the list
            phraseList.appendChild(li);

            threeDots.addEventListener("click", (e) => {
                e.stopPropagation();
                if (menu.style.display === "block") {
                    menu.setAttribute("data-state", "closed");
                    menu.style.display = "none";
                } else {
                    closeAllMenus();
                    menu.style.display = "block";
                    menu.setAttribute("data-state", "open");
                }
            });

            li.querySelectorAll(".menu-item").forEach((item) => {
                item.addEventListener("click", (e) => {
                    const action = e.currentTarget.getAttribute("data-action");
                    const id = e.currentTarget.getAttribute("data-id");
                    if (action === "delete") {
                        try {
                            window.electron.send("delete-phrase", id);
                        } catch (error) {
                            console.error("Failed to delete phrase:", error);
                            showToast(window.i18n.t("Failed to delete phrase"), "danger");
                        }
                    }
                    menu.style.display = "none";
                });
            });

            li.querySelector(".copy-button").addEventListener("click", () => {
                try {
                    window.electron.send("copy-to-clipboard", phrase);
                    showToast(window.i18n.t("Copied to clipboard"), "success");
                } catch (error) {
                    console.error("Failed to copy to clipboard:", error);
                    showToast(window.i18n.t("Failed to copy"), "danger");
                }
            });

            li.querySelector(".edit-button").addEventListener("click", () => {
                openPhraseForm(phrase.phrase, phrase.expanded_text, phrase.type, phrase.id);
            });
        });
    });

    document.addEventListener("click", closeAllMenus);

    function closeAllMenus() {
        document.querySelectorAll(".menu").forEach((menu) => {
            menu.setAttribute("data-state", "closed");
            menu.style.display = "none";
        });
    }

    function openPhraseForm(phrase = "", expandedText = "", type = "plain", id = null) {
        const modal = document.querySelector("#phraseModal");
        const title = modal.querySelector("#modal-title");
        const phraseInput = modal.querySelector("#phraseInput");
        const expandedTextInput = modal.querySelector("#expandedTextInput");
        const idInput = modal.querySelector("#idInput");

        phraseInput.value = phrase;
        expandedTextInput.value = expandedText;
        idInput.value = id;
        modal.querySelector('input[name="phraseType"][value="' + type + '"]').checked = true;

        title.textContent = id ? window.i18n.t("Edit Phrase") : window.i18n.t("Add Phrase");

        openModal();

        phraseInput.focus();

        const saveButton = modal.querySelector("#saveButton");

        // Abort previous controller if it exists
        if (saveButtonController) {
            saveButtonController.abort();
        }

        // Create new AbortController for this modal instance
        saveButtonController = new AbortController();

        // Add event listener with signal for proper cleanup
        saveButton.addEventListener("click", handleSaveButtonClick, {
            signal: saveButtonController.signal,
        });
    }

    function handleSaveButtonClick() {
        const modal = document.querySelector("#phraseModal");
        const phraseInput = modal.querySelector("#phraseInput");
        const expandedTextInput = modal.querySelector("#expandedTextInput");
        const idInput = modal.querySelector("#idInput");
        const type = modal.querySelector('input[name="phraseType"]:checked').value || "plain";

        const newPhrase = phraseInput.value;
        const newExpandedText = expandedTextInput.value;
        const id = idInput.value;

        if (!newPhrase.trim()) {
            showToast(window.i18n.t("Phrase cannot be empty"), "danger");
            return;
        }

        try {
            if (id) {
                window.electron.send("edit-phrase", { id, newPhrase, newExpandedText, type });
            } else {
                window.electron.send("add-phrase", { newPhrase, newExpandedText, type });
            }
        } catch (error) {
            console.error("Failed to save phrase:", error);
            showToast(window.i18n.t("Failed to save phrase"), "danger");
        }
    }

    function showToast(message, type = "success") {
        const toast = document.createElement("div");
        toast.className = "toast";
        toast.textContent = message;
        document.body.appendChild(toast);
        toast.classList.add("show");
        toast.style.setProperty("--toast-count", document.querySelectorAll(".toast").length);
        toast.classList.add(type);
        setTimeout(() => {
            toast.classList.remove("show");
            // Safe removal - check if parent exists
            if (toast.parentNode) {
                toast.remove();
            }
        }, 3000);
    }

    function debounce(func, wait) {
        let timeout;
        return function (...args) {
            clearTimeout(timeout);
            timeout = setTimeout(() => func.apply(this, args), wait);
        };
    }

    function insertTextIntoActiveField(id) {
        try {
            window.electron.send("insert-phrase-by-id", id);
        } catch (error) {
            console.error("Failed to insert phrase:", error);
            showToast(window.i18n.t("Failed to insert phrase"), "danger");
        }
    }

    window.electron.receive("focus-search", () => {
        searchInput.focus();
        searchInput.select();
    });

    // toast on add, edit, delete
    window.electron.receive("phrase-added", (phrase) => {
        closeModal();
        updateList();
    });

    window.electron.receive("phrase-edited", (phrase) => {
        closeModal();
        updateList();
    });

    window.electron.receive("phrase-deleted", (id) => {
        updateList();
    });

    window.electron.receive("handle-escape", () => {
        if (modal.style.display === "grid") {
            closeModal();
            return;
        }

        const openMenu = document.querySelector('.menu[data-state="open"]');
        if (openMenu) {
            closeAllMenus();
            return;
        }

        try {
            window.electron.send("minimize-window");
        } catch (error) {
            console.error("Failed to minimize window:", error);
        }
    });

    window.electron.receive("toast-message", (message) => {
        showToast(message.message, message.type);
    });

    // Purchase reminder overlay
    window.electron.receive("show-purchase-reminder", () => {
        const overlay = document.getElementById("purchase-reminder-overlay");
        if (overlay) {
            overlay.style.display = "flex";
        }
    });

    // Handle purchase reminder buttons
    const buyLicenseBtn = document.getElementById("buy-license-reminder-btn");
    const alreadyBoughtBtn = document.getElementById("already-bought-reminder-btn");

    if (buyLicenseBtn) {
        buyLicenseBtn.addEventListener("click", () => {
            // Hide overlay
            const overlay = document.getElementById("purchase-reminder-overlay");
            if (overlay) {
                overlay.style.display = "none";
            }
            // Open URL in system browser
            try {
                window.electron.send("open-external-url", "https://phrasevault.app/pricing");
            } catch (error) {
                console.error("Failed to open external URL:", error);
            }
        });
    }

    if (alreadyBoughtBtn) {
        alreadyBoughtBtn.addEventListener("click", () => {
            // Hide overlay immediately
            const overlay = document.getElementById("purchase-reminder-overlay");
            if (overlay) {
                overlay.style.display = "none";
            }
            // Mark as purchased (will relaunch app)
            try {
                window.electron.send("mark-as-purchased");
            } catch (error) {
                console.error("Failed to mark as purchased:", error);
            }
        });
    }

    updateList();
});
