document.addEventListener("DOMContentLoaded", () => {
    // Cache frequently used DOM elements at module level
    const searchInput = document.getElementById("search");
    const phraseList = document.getElementById("phrase-list");
    const addPhraseButton = document.getElementById("add-phrase");

    // Settings modal elements
    const settingsBtn = document.getElementById("settings-btn");
    const statusIndicator = document.getElementById("status-indicator");

    // Initialize modal module with required DOM elements
    window.modals.init({
        statusIndicator: document.getElementById("status-indicator"),
        settingsStatusIndicator: document.getElementById("settings-status-indicator"),
        settingsStatusText: document.getElementById("settings-status-text"),
    });

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

    // Truncate file path showing beginning and end with ellipsis in middle
    const truncatePath = (path, maxLength = 40) => {
        if (path.length <= maxLength) return path;

        const separator = path.includes("\\") ? "\\" : "/";
        const parts = path.split(separator);
        const filename = parts.pop();

        // Always show filename, truncate directory part
        const availableForDir = maxLength - filename.length - 5; // 5 for ".../" or "...\"

        if (availableForDir < 10) {
            // Not enough space, just show truncated filename
            return filename.length > maxLength ? filename.slice(0, maxLength - 3) + "..." : filename;
        }

        const dirPath = parts.join(separator);
        const startChars = Math.ceil(availableForDir * 0.4);
        const endChars = availableForDir - startChars;

        const truncatedDir = dirPath.slice(0, startChars) + "..." + dirPath.slice(-endChars);
        return truncatedDir + separator + filename;
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
        // Update settings modal radio if open
        const themeRadio = document.querySelector(`input[name="theme"][value="${theme}"]`);
        if (themeRadio) themeRadio.checked = true;
    });

    // =============================================================================
    // Status Indicator
    // =============================================================================

    const settingsStatusIndicator = document.getElementById("settings-status-indicator");
    const settingsStatusText = document.getElementById("settings-status-text");
    let currentDbStatus = false;

    const updateStatusIndicator = (available) => {
        currentDbStatus = available;
        const color = available ? "var(--color-success)" : "var(--primary-400)";

        if (statusIndicator) {
            statusIndicator.style.color = color;
        }
        if (settingsStatusIndicator) {
            settingsStatusIndicator.style.color = color;
        }

        const statusText = available ? window.i18n.t("Phrases loaded") : window.i18n.t("Loading...");
        window.modals.setCurrentDbStatusText(statusText);
        if (settingsStatusText) {
            settingsStatusText.textContent = statusText;
        }
    };

    window.electron.receive("database-status", (data) => {
        updateStatusIndicator(data);
        if (!data) {
            phraseList.innerHTML = '<li class="loading">' + window.i18n.t("Loading...") + "</li>";
        }
    });

    window.electron.receive("database-error", (error) => {
        console.log("Database error:", error);
        const color = "var(--color-danger)";
        if (statusIndicator) {
            statusIndicator.style.color = color;
        }
        if (settingsStatusIndicator) {
            settingsStatusIndicator.style.color = color;
        }
        const statusText = window.i18n.t("Database error");
        window.modals.setCurrentDbStatusText(statusText);
        if (settingsStatusText) {
            settingsStatusText.textContent = statusText;
        }
    });

    // =============================================================================
    // Settings Modal
    // =============================================================================

    settingsBtn.addEventListener("click", window.modals.openSettingsModal);

    // =============================================================================
    // NSIS to Squirrel Migration Prompt
    // =============================================================================

    let pendingUninstallString = null;

    window.electron.receive("show-nsis-uninstall-prompt", (data) => {
        pendingUninstallString = data.uninstallString;

        const content = `${window.i18n.t("nsis_message")}

${window.i18n.t("nsis_reason", { version: data.version })}

${window.i18n.t("nsis_note")}`;

        window.modals.openMarkdownModal({
            title: window.i18n.t("nsis_title"),
            content: content,
            buttons: [
                {
                    label: window.i18n.t("nsis_btn_skip"),
                    className: "btn btn-secondary",
                },
                {
                    label: window.i18n.t("nsis_btn_uninstall"),
                    className: "btn btn-primary",
                    onClick: () => {
                        window.electron.send("run-nsis-uninstall", pendingUninstallString);
                    },
                },
            ],
        });
    });

    window.electron.receive("nsis-uninstall-result", (data) => {
        if (data.success) {
            window.modals.showToast(window.i18n.t("nsis_success"), "success");
        } else {
            window.modals.showToast(window.i18n.t("nsis_error"), "error");
        }
    });

    // Settings: Theme
    document.querySelectorAll('input[name="theme"]').forEach((radio) => {
        radio.addEventListener("change", (e) => {
            window.electron.send("set-theme", e.target.value);
        });
    });

    // Settings: Language
    document.getElementById("language-select").addEventListener("change", (e) => {
        window.electron.send("set-language", e.target.value);
    });

    // Settings: Autostart
    document.getElementById("autostart-toggle").addEventListener("change", (e) => {
        window.electron.send("set-autostart", e.target.checked);
    });

    // Settings: Database actions
    document.getElementById("new-db-btn").addEventListener("click", () => {
        window.electron.send("new-database");
    });

    document.getElementById("open-db-btn").addEventListener("click", () => {
        window.electron.send("open-database");
    });

    document.getElementById("show-db-btn").addEventListener("click", () => {
        window.electron.send("show-database");
    });

    // Settings: Purchase
    document.getElementById("buy-license-btn").addEventListener("click", () => {
        window.electron.send("open-external-url", "https://phrasevault.app/pricing");
    });

    document.getElementById("already-bought-btn").addEventListener("click", () => {
        window.electron.send("confirm-purchase");
    });

    // Settings: Help links
    document.getElementById("link-docs").addEventListener("click", (e) => {
        e.preventDefault();
        window.electron.send("open-external-url", "https://phrasevault.app/help");
    });

    document.getElementById("link-issues").addEventListener("click", (e) => {
        e.preventDefault();
        window.electron.send("open-external-url", "https://github.com/ptmrio/phrasevault/issues");
    });

    document.getElementById("link-license").addEventListener("click", (e) => {
        e.preventDefault();
        window.modals.openMarkdownModal({ file: "license.md", title: window.i18n.t("View License Agreement") });
    });

    document.getElementById("link-thirdparty").addEventListener("click", (e) => {
        e.preventDefault();
        window.modals.openMarkdownModal({ file: "thirdparty.md", title: window.i18n.t("Third Party Licenses") });
    });

    // Check for Updates - version will be set after init-settings is received
    let appVersion = "";
    document.getElementById("check-updates-btn").addEventListener("click", () => {
        window.electron.send("open-external-url", `https://phrasevault.app/download?currentVersion=${appVersion}`);
    });

    // Receive initial settings
    window.electron.receive("init-settings", (settings) => {
        // Add platform class to body
        document.documentElement.dataset.platform = settings.platform;

        // Theme
        const themeRadio = document.querySelector(`input[name="theme"][value="${settings.theme}"]`);
        if (themeRadio) themeRadio.checked = true;

        // Language
        const langSelect = document.getElementById("language-select");
        if (langSelect) langSelect.value = settings.language;

        // Autostart (hide on non-Windows)
        const autostartSection = document.getElementById("autostart-section");
        if (settings.platform !== "win32") {
            autostartSection.style.display = "none";
        } else {
            autostartSection.style.display = "block";
            const autostartToggle = document.getElementById("autostart-toggle");
            if (autostartToggle) autostartToggle.checked = settings.autostart;
        }

        // Purchase status
        const purchaseSection = document.getElementById("purchase-section");
        const purchasedSection = document.getElementById("purchased-section");
        if (settings.purchased) {
            purchaseSection.style.display = "none";
            purchasedSection.style.display = "block";
        } else {
            purchaseSection.style.display = "block";
            purchasedSection.style.display = "none";
        }

        // Version
        appVersion = settings.version;
        document.getElementById("version-text").textContent = `Version ${settings.version}`;
    });

    // Receive recent databases
    window.electron.receive("recent-databases", (files) => {
        const container = document.getElementById("recent-databases");
        container.innerHTML = "";

        if (files && files.length > 0) {
            const label = document.createElement("span");
            label.className = "settings-recent-label";
            label.textContent = window.i18n.t("Recent Databases") + ":";
            container.appendChild(label);

            files.slice(0, 5).forEach((file) => {
                const btn = document.createElement("button");
                btn.className = "btn btn-ghost btn-sm settings-recent-item";
                btn.textContent = truncatePath(file, 55);
                btn.title = file;
                btn.addEventListener("click", () => {
                    window.electron.send("open-recent-database", file);
                });
                container.appendChild(btn);
            });
        }
    });

    // =============================================================================
    // Phrase List & Search
    // =============================================================================

    const debouncedUpdateList = debounce(updateList, 300);

    searchInput.addEventListener("input", debouncedUpdateList);

    // Search button click
    const searchButton = document.querySelector(".search-btn");
    if (searchButton) {
        searchButton.addEventListener("click", () => {
            updateList();
            searchInput.focus();
        });
    }

    const searchClear = document.querySelector(".search-clear");
    if (searchClear) {
        searchInput.addEventListener("input", () => {
            searchClear.classList.toggle("visible", searchInput.value.length > 0);
        });
        searchClear.addEventListener("click", () => {
            searchInput.value = "";
            searchClear.classList.remove("visible");
            updateList();
            searchInput.focus();
        });
    }

    // =============================================================================
    // Phrase Modal & List Management
    // =============================================================================

    const checkScrollbar = () => {
        if (phraseList.scrollHeight > phraseList.clientHeight) {
            phraseList.style.paddingRight = "5px";
        } else {
            phraseList.style.paddingRight = "0";
        }
    };

    checkScrollbar();
    window.addEventListener("resize", checkScrollbar);

    const scrollObserver = new MutationObserver(checkScrollbar);
    scrollObserver.observe(phraseList, { childList: true, subtree: true });

    window.addEventListener("beforeunload", () => {
        if (scrollObserver) {
            scrollObserver.disconnect();
        }
    });

    addPhraseButton.addEventListener("click", () => {
        window.modals.openPhraseForm("", "", "plain", null);
    });

    searchInput.addEventListener("keydown", (e) => {
        if (e.key === "ArrowDown" && phraseList.children.length > 0) {
            phraseList.children[0].focus();
            e.preventDefault();
        }
    });

    phraseList.addEventListener("keydown", (e) => {
        const focusedElement = document.activeElement;
        if (e.key === "ArrowDown") {
            if (focusedElement.nextElementSibling) {
                focusedElement.nextElementSibling.focus();
            } else {
                searchInput.focus();
            }
            e.preventDefault();
        } else if (e.key === "ArrowUp") {
            if (focusedElement.previousElementSibling) {
                focusedElement.previousElementSibling.focus();
            } else {
                searchInput.focus();
            }
            e.preventDefault();
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
            window.modals.showToast(window.i18n.t("Search failed"), "danger");
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

            li.appendChild(span);
            li.appendChild(divButtons);
            li.appendChild(menu);

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
                            window.modals.showToast(window.i18n.t("Failed to delete phrase"), "danger");
                        }
                    }
                    menu.style.display = "none";
                });
            });

            li.querySelector(".copy-button").addEventListener("click", (e) => {
                e.stopPropagation();
                try {
                    window.electron.send("copy-to-clipboard", phrase);
                    window.modals.showToast(window.i18n.t("Copied to clipboard"), "success");
                } catch (error) {
                    console.error("Failed to copy to clipboard:", error);
                    window.modals.showToast(window.i18n.t("Failed to copy"), "danger");
                }
            });

            li.querySelector(".edit-button").addEventListener("click", (e) => {
                e.stopPropagation();
                window.modals.openPhraseForm(phrase.phrase, phrase.expanded_text, phrase.type, phrase.id);
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

    // =============================================================================
    // Utilities
    // =============================================================================

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
            window.modals.showToast(window.i18n.t("Failed to insert phrase"), "danger");
        }
    }

    // =============================================================================
    // IPC Event Handlers
    // =============================================================================

    window.electron.receive("focus-search", () => {
        searchInput.focus();
        searchInput.select();
    });

    window.electron.receive("phrase-added", (phrase) => {
        window.modals.closePhraseModal();
        updateList();
    });

    window.electron.receive("phrase-edited", (phrase) => {
        window.modals.closePhraseModal();
        updateList();
    });

    window.electron.receive("phrase-deleted", (id) => {
        updateList();
    });

    window.electron.receive("handle-escape", () => {
        // Close markdown modal first if open
        if (window.modals.isMarkdownModalOpen()) {
            window.modals.closeMarkdownModal();
            return;
        }

        // Close settings modal if open
        if (window.modals.isSettingsModalOpen()) {
            window.modals.closeSettingsModal();
            return;
        }

        // Close phrase modal if open
        if (window.modals.isPhraseModalOpen()) {
            window.modals.closePhraseModal();
            return;
        }

        // Close any open menus
        const openMenu = document.querySelector('.menu[data-state="open"]');
        if (openMenu) {
            closeAllMenus();
            return;
        }

        // Minimize window
        try {
            window.electron.send("minimize-window");
        } catch (error) {
            console.error("Failed to minimize window:", error);
        }
    });

    window.electron.receive("toast-message", (message) => {
        window.modals.showToast(message.message, message.type);
    });

    // =============================================================================
    // Purchase Reminder
    // =============================================================================

    window.electron.receive("show-purchase-reminder", () => {
        const overlay = document.getElementById("purchase-reminder-overlay");
        if (overlay) {
            overlay.style.display = "flex";
        }
    });

    const buyLicenseBtn = document.getElementById("buy-license-reminder-btn");
    const remindLaterBtn = document.getElementById("remind-later-btn");

    if (buyLicenseBtn) {
        buyLicenseBtn.addEventListener("click", () => {
            const overlay = document.getElementById("purchase-reminder-overlay");
            if (overlay) {
                overlay.style.display = "none";
            }
            try {
                window.electron.send("open-external-url", "https://phrasevault.app/pricing");
            } catch (error) {
                console.error("Failed to open external URL:", error);
            }
        });
    }

    if (remindLaterBtn) {
        remindLaterBtn.addEventListener("click", () => {
            const overlay = document.getElementById("purchase-reminder-overlay");
            if (overlay) {
                overlay.style.display = "none";
            }
        });
    }

    // Initialize
    updateList();
});
