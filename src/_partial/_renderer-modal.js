/**
 * Modal management module for PhraseVault renderer
 * Handles Settings Modal, Markdown Modal, Phrase Modal, and Toast Notifications
 */

(function () {
    // =============================================================================
    // DOM Elements (initialized after DOM ready)
    // =============================================================================

    let settingsModal, settingsClose, markdownModal, markdownClose, markdownTitle, markdownContent, markdownFooter, phraseModal, phraseModalClose;

    // =============================================================================
    // State
    // =============================================================================

    let statusIndicator = null;
    let settingsStatusIndicator = null;
    let settingsStatusText = null;
    let currentDbStatusText = "";
    let saveButtonController = null;
    let showToastFn = null;

    // =============================================================================
    // Shared Modal Utilities
    // =============================================================================

    function getVisibleModalCount() {
        return document.querySelectorAll('.modal[style*="display: grid"]').length;
    }

    function applyModalStackOffset(modalElement) {
        const visibleCount = getVisibleModalCount();
        const offset = visibleCount * 32;
        modalElement.style.setProperty("--stack-offset", offset + "px");
    }

    function showModal(modalElement) {
        applyModalStackOffset(modalElement);
        modalElement.style.display = "grid";
        setTimeout(() => {
            modalElement.classList.add("show");
            modalElement.querySelector(".modal-content").classList.add("show");
        }, 10);
    }

    function hideModal(modalElement, onComplete) {
        modalElement.querySelector(".modal-content").classList.remove("show");
        modalElement.classList.remove("show");
        modalElement.addEventListener(
            "transitionend",
            () => {
                if (!modalElement.classList.contains("show")) {
                    modalElement.style.display = "none";
                    if (onComplete) onComplete();
                }
            },
            { once: true }
        );
    }

    // =============================================================================
    // Toast Notifications
    // =============================================================================

    const TOAST_DURATION_DEFAULT = 2500;
    const TOAST_DURATION_UNDO = 8000;

    /**
     * Show a toast notification
     * @param {string} message - The message to display
     * @param {string} [type="success"] - Toast type: "success" or "danger"
     * @param {Object} [options] - Additional options
     * @param {Function} [options.onUndo] - Callback for undo action (shows undo button)
     * @param {number} [options.duration] - Custom duration in ms (default: 2500, or 8000 with undo)
     * @returns {{ dismiss: Function }} Object with dismiss method to programmatically close
     */
    function showToast(message, type = "success", options = {}) {
        // Handle legacy signature: showToast(message, type, undoCallback)
        if (typeof options === "function") {
            options = { onUndo: options };
        }

        const { onUndo, duration } = options;

        let container = document.querySelector(".toast-container");
        if (!container) {
            container = document.createElement("div");
            container.className = "toast-container";
            document.body.appendChild(container);
        }

        const toast = document.createElement("div");
        toast.className = "toast";
        toast.classList.add(type);

        const textSpan = document.createElement("span");
        textSpan.textContent = message;
        toast.appendChild(textSpan);

        let undoClicked = false;
        const dismissTimeout = duration ?? (onUndo ? TOAST_DURATION_UNDO : TOAST_DURATION_DEFAULT);

        // Add undo button if callback provided
        if (onUndo) {
            const undoBtn = document.createElement("button");
            undoBtn.className = "toast-undo";
            undoBtn.textContent = window.i18n.t("Undo");
            undoBtn.addEventListener("click", (e) => {
                e.stopPropagation();
                undoClicked = true;
                onUndo();
                dismissToast();
            });
            toast.appendChild(undoBtn);
        }

        container.appendChild(toast);

        requestAnimationFrame(() => {
            toast.classList.add("show");
        });

        function dismissToast() {
            toast.classList.remove("show");
            toast.classList.add("hiding");

            toast.addEventListener(
                "transitionend",
                () => {
                    if (toast.parentNode) {
                        toast.remove();
                    }
                    if (container.children.length === 0) {
                        container.remove();
                    }
                },
                { once: true }
            );
        }

        setTimeout(() => {
            if (!undoClicked) {
                dismissToast();
            }
        }, dismissTimeout);

        return { dismiss: dismissToast };
    }

    // =============================================================================
    // Settings Modal
    // =============================================================================

    function setCurrentDbStatusText(text) {
        currentDbStatusText = text;
    }

    function openSettingsModal() {
        showModal(settingsModal);

        // Sync status indicator
        if (settingsStatusText) {
            settingsStatusText.textContent = currentDbStatusText;
        }
        if (settingsStatusIndicator) {
            settingsStatusIndicator.style.color = statusIndicator ? statusIndicator.style.color : "var(--primary-400)";
        }

        // Request fresh settings data
        window.electron.send("get-settings");
        window.electron.send("get-recent-databases");
    }

    function closeSettingsModal() {
        hideModal(settingsModal);
    }

    function isSettingsModalOpen() {
        return settingsModal.style.display === "grid";
    }

    // =============================================================================
    // Markdown Modal
    // =============================================================================

    /**
     * Opens the markdown modal with content from a file or raw markdown text
     * @param {Object} options - Modal options
     * @param {string} options.title - Modal title
     * @param {string} [options.file] - Markdown filename to load (mutually exclusive with content)
     * @param {string} [options.content] - Raw markdown content to render (mutually exclusive with file)
     * @param {Array<{label: string, className: string, onClick: Function, closeModal: boolean}>} [options.buttons] - Action buttons
     */
    function openMarkdownModal(options) {
        const { title, file, content, buttons = [] } = options;

        markdownTitle.textContent = title;
        markdownContent.innerHTML = '<p class="loading">' + window.i18n.t("Loading...") + "</p>";

        // Set up footer with buttons if provided
        if (buttons.length > 0) {
            markdownFooter.innerHTML = "";
            buttons.forEach((btn) => {
                const button = document.createElement("button");
                button.className = btn.className || "btn btn-secondary";
                button.textContent = btn.label;
                button.addEventListener("click", () => {
                    if (btn.onClick) btn.onClick();
                    if (btn.closeModal !== false) closeMarkdownModal();
                });
                markdownFooter.appendChild(button);
            });
            markdownFooter.style.display = "flex";
        } else {
            markdownFooter.innerHTML = "";
            markdownFooter.style.display = "none";
        }

        showModal(markdownModal);

        // Load content from file or render raw markdown
        if (file) {
            window.electron.send("read-markdown-file", file);
        } else if (content) {
            window.electron.send("render-markdown", content);
        }
    }

    function closeMarkdownModal() {
        hideModal(markdownModal, () => {
            markdownContent.innerHTML = "";
            markdownFooter.innerHTML = "";
            markdownFooter.style.display = "none";
        });
    }

    function isMarkdownModalOpen() {
        return markdownModal.style.display === "grid";
    }

    // =============================================================================
    // Phrase Modal
    // =============================================================================

    function openPhraseModal() {
        showModal(phraseModal);
    }

    function closePhraseModal() {
        hideModal(phraseModal);
    }

    function isPhraseModalOpen() {
        return phraseModal.style.display === "grid";
    }

    function openPhraseForm(phrase = "", expandedText = "", type = "plain", id = null) {
        const title = phraseModal.querySelector("#modal-title");
        const phraseInput = phraseModal.querySelector("#phraseInput");
        const expandedTextInput = phraseModal.querySelector("#expandedTextInput");
        const idInput = phraseModal.querySelector("#idInput");

        phraseInput.value = phrase;
        expandedTextInput.value = expandedText;
        idInput.value = id || "";

        phraseModal.querySelector('input[name="phraseType"][value="' + type + '"]').checked = true;

        title.textContent = id ? window.i18n.t("Edit Phrase") : window.i18n.t("Add Phrase");

        openPhraseModal();
        // Delay focus to ensure modal animation has started and element is visible
        setTimeout(() => {
            phraseInput.focus();
        }, 50);

        const saveButton = phraseModal.querySelector("#saveButton");

        if (saveButtonController) {
            saveButtonController.abort();
        }

        saveButtonController = new AbortController();

        saveButton.addEventListener("click", () => handleSaveButtonClick(), {
            signal: saveButtonController.signal,
        });
    }

    function handleSaveButtonClick() {
        const phraseInput = phraseModal.querySelector("#phraseInput");
        const expandedTextInput = phraseModal.querySelector("#expandedTextInput");
        const idInput = phraseModal.querySelector("#idInput");
        const type = phraseModal.querySelector('input[name="phraseType"]:checked').value || "plain";

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

    // =============================================================================
    // Initialization
    // =============================================================================

    function init(elements) {
        // Cache DOM elements
        settingsModal = document.getElementById("settingsModal");
        settingsClose = settingsModal.querySelector(".settings-close");
        markdownModal = document.getElementById("markdownModal");
        markdownClose = markdownModal.querySelector(".markdown-close");
        markdownTitle = document.getElementById("markdown-modal-title");
        markdownContent = document.getElementById("markdown-content");
        markdownFooter = document.getElementById("markdown-modal-footer");
        phraseModal = document.getElementById("phraseModal");
        phraseModalClose = phraseModal.querySelector(".close");

        // Store references to external elements
        statusIndicator = elements.statusIndicator;
        settingsStatusIndicator = elements.settingsStatusIndicator;
        settingsStatusText = elements.settingsStatusText;

        // Attach close button listeners
        settingsClose.addEventListener("click", closeSettingsModal);
        markdownClose.addEventListener("click", closeMarkdownModal);
        phraseModalClose.addEventListener("click", closePhraseModal);

        // Handle markdown content received from main process
        window.electron.receive("markdown-content", (data) => {
            if (data.success) {
                markdownContent.innerHTML = data.html;
                // Handle links in markdown content to open externally
                markdownContent.querySelectorAll("a").forEach((link) => {
                    link.addEventListener("click", (e) => {
                        e.preventDefault();
                        const href = link.getAttribute("href");
                        if (href && (href.startsWith("http://") || href.startsWith("https://"))) {
                            window.electron.send("open-external-url", href);
                        }
                    });
                });
            } else {
                markdownContent.innerHTML = '<p class="error">' + (data.error || "Failed to load content") + "</p>";
            }
        });
    }

    // =============================================================================
    // Dynamic Prompt Modal
    // =============================================================================

    let dynamicModal, dynamicModalClose, dynamicModalTitle, dynamicModalForm, dynamicModalSubmit, dynamicModalCancel;
    let currentDynamicData = null;

    function initDynamicModal() {
        dynamicModal = document.getElementById("dynamicPromptModal");
        if (!dynamicModal) return; // Modal not in DOM yet

        dynamicModalClose = dynamicModal.querySelector(".dynamic-close");
        dynamicModalTitle = document.getElementById("dynamic-modal-title");
        dynamicModalForm = document.getElementById("dynamic-form");
        dynamicModalSubmit = document.getElementById("dynamic-submit");
        dynamicModalCancel = document.getElementById("dynamic-cancel");

        dynamicModalClose.addEventListener("click", cancelDynamicModal);
        dynamicModalCancel.addEventListener("click", cancelDynamicModal);
        dynamicModalSubmit.addEventListener("click", submitDynamicForm);

        // Handle Enter key to submit (except in textarea)
        dynamicModalForm.addEventListener("keydown", (e) => {
            if (e.key === "Enter" && e.target.tagName !== "TEXTAREA") {
                e.preventDefault();
                submitDynamicForm();
            }
        });

        // ESC to cancel
        dynamicModal.addEventListener("keydown", (e) => {
            if (e.key === "Escape") {
                e.preventDefault();
                cancelDynamicModal();
            }
        });

        // Listen for dynamic prompt requests from main process
        window.electron.removeAllListeners("show-dynamic-prompt");
        window.electron.receive("show-dynamic-prompt", (data) => {
            openDynamicModal(data);
        });
    }

    function openDynamicModal(data) {
        currentDynamicData = data;
        dynamicModalTitle.textContent = window.i18n.t("Fill in Details");
        dynamicModalForm.innerHTML = "";

        // Build form fields for each promptable placeholder
        data.placeholders.forEach((p, index) => {
            const fieldId = `dynamic-field-${index}`;
            const label = p.label || window.i18n.t(p.type === "textarea" ? "Text" : "Value");

            const wrapper = document.createElement("div");
            wrapper.className = "form-field";

            const labelEl = document.createElement("label");
            labelEl.htmlFor = fieldId;
            labelEl.textContent = label;
            wrapper.appendChild(labelEl);

            let input;

            if (p.type === "select") {
                input = document.createElement("select");
                input.className = "input";
                p.options.choices.forEach((choice) => {
                    const option = document.createElement("option");
                    option.value = choice.value;
                    option.textContent = choice.value;
                    if (choice.default) option.selected = true;
                    input.appendChild(option);
                });
            } else if (p.type === "textarea") {
                input = document.createElement("textarea");
                input.className = "input";
                input.rows = 3;
                input.value = p.options?.default || "";
            } else {
                input = document.createElement("input");
                input.type = "text";
                input.className = "input";
                input.value = p.options?.default || "";
            }

            input.id = fieldId;
            input.dataset.label = p.label || `__${p.type}_${index}`;
            wrapper.appendChild(input);

            dynamicModalForm.appendChild(wrapper);
        });

        showModal(dynamicModal);

        // Focus first input after modal animation
        setTimeout(() => {
            const firstInput = dynamicModalForm.querySelector("input, select, textarea");
            if (firstInput) firstInput.focus();
        }, 50);
    }

    function cancelDynamicModal() {
        hideModal(dynamicModal, () => {
            dynamicModalForm.innerHTML = "";
            currentDynamicData = null;
        });
    }

    function closeDynamicModal() {
        hideModal(dynamicModal, () => {
            dynamicModalForm.innerHTML = "";
            currentDynamicData = null;
        });
    }

    function submitDynamicForm() {
        if (!currentDynamicData) return;

        // Collect values from form
        const values = {};
        dynamicModalForm.querySelectorAll("input, select, textarea").forEach((el) => {
            if (el.dataset.label) {
                values[el.dataset.label] = el.value;
            }
        });

        // Send response to main process
        window.electron.send("dynamic-prompt-response", {
            phraseId: currentDynamicData.phraseId,
            phraseType: currentDynamicData.phraseType,
            text: currentDynamicData.text,
            values,
            clipboardContent: currentDynamicData.clipboardContent,
        });

        // Close modal without sending cancel
        closeDynamicModal();
    }

    function isDynamicModalOpen() {
        return dynamicModal && dynamicModal.style.display === "grid";
    }

    // =============================================================================
    // Module Exports
    // =============================================================================

    window.modals = {
        init,
        showToast,

        // Settings Modal
        setCurrentDbStatusText,
        openSettingsModal,
        closeSettingsModal,
        isSettingsModalOpen,

        // Markdown Modal
        openMarkdownModal,
        closeMarkdownModal,
        isMarkdownModalOpen,

        // Phrase Modal
        openPhraseForm,
        closePhraseModal,
        isPhraseModalOpen,

        // Dynamic Prompt Modal
        openDynamicModal,
        closeDynamicModal,
        cancelDynamicModal,
        isDynamicModalOpen,
    };

    // Initialize dynamic modal after DOM elements are set up
    document.addEventListener("DOMContentLoaded", initDynamicModal);
})();
