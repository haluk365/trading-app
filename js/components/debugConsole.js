/**
 * DEBUG CONSOLE UI MODÜLÜ
 * Debug console kullanıcı arayüzü yönetimi
 * Logger ve ErrorHandler modüllerine bağımlı
 */

window.DebugConsole = (function() {
    'use strict';

    let isInitialized = false;
    let isVisible = false;
    let elements = {};
    let currentFilters = {
        level: 'all',
        category: 'all',
        search: ''
    };
    let autoScroll = true;
    let maxDisplayedLogs = 500;

    /**
     * Debug Console'u başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.UI, 'DebugConsole zaten başlatılmış');
            return false;
        }

        try {
            // DOM elementlerini bul
            findElements();
            
            // Event listener'ları kur
            setupEventListeners();
            
            // Logger'dan log eventi dinle
            if (window.Logger) {
                Logger.addEventListener(onNewLog);
            }
            
            // Error handler'dan hata eventi dinle
            if (window.ErrorHandler) {
                ErrorHandler.on('all', onNewError);
            }

            // İlk log'ları yükle
            loadInitialLogs();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.UI, 'DebugConsole başarıyla başlatıldı');
            return true;

        } catch (error) {
            console.error('DebugConsole başlatma hatası:', error);
            if (window.ErrorHandler) {
                ErrorHandler.handleCustomError('UI Error', 'DebugConsole başlatılamadı', error, Logger.CATEGORIES.UI);
            }
            return false;
        }
    }

    /**
     * DOM elementlerini bul
     */
    function findElements() {
        elements = {
            console: document.getElementById('debugConsole'),
            logs: document.getElementById('debugLogs'),
            levelFilter: document.getElementById('logLevel'),
            categoryFilter: document.getElementById('logCategory'),
            searchFilter: document.getElementById('logSearch'),
            clearBtn: document.getElementById('clearLogs'),
            exportBtn: document.getElementById('exportLogs'),
            closeBtn: document.getElementById('closeDebug')
        };

        // Eksik element kontrolü
        Object.keys(elements).forEach(key => {
            if (!elements[key]) {
                throw new Error(`Debug console element bulunamadı: ${key}`);
            }
        });
    }

    /**
     * Event listener'ları kur
     */
    function setupEventListeners() {
        // Filtre değişiklikleri
        elements.levelFilter.addEventListener('change', onFilterChange);
        elements.categoryFilter.addEventListener('change', onFilterChange);
        elements.searchFilter.addEventListener('input', debounce(onFilterChange, 300));

        // Button'lar
        elements.clearBtn.addEventListener('click', onClearLogs);
        elements.exportBtn.addEventListener('click', onExportLogs);
        elements.closeBtn.addEventListener('click', hide);

        // Scroll auto-follow
        elements.logs.addEventListener('scroll', onScrollChange);

        // Keyboard shortcuts
        document.addEventListener('keydown', onKeyDown);

        Logger.debug(Logger.CATEGORIES.UI, 'DebugConsole event listeners kuruldu');
    }

    /**
     * Yeni log eventi
     */
    function onNewLog(logEntry) {
        if (!isInitialized) return;

        // Filter'ları kontrol et
        if (shouldDisplayLog(logEntry)) {
            addLogToDisplay(logEntry);
        }

        // Auto scroll
        if (autoScroll && isVisible) {
            scrollToBottom();
        }
    }

    /**
     * Yeni error eventi
     */
    function onNewError(errorType, errorInfo) {
        // Error'lar zaten Logger tarafından log edildiği için
        // burada sadece özel işlemler yapabiliriz
        if (errorType === 'javascript' && errorInfo.isCritical) {
            // Critical error'larda console'u otomatik aç
            if (!isVisible) {
                show();
            }
        }
    }

    /**
     * Filter değişimi
     */
    function onFilterChange() {
        currentFilters = {
            level: elements.levelFilter.value,
            category: elements.categoryFilter.value,
            search: elements.searchFilter.value.trim()
        };

        // Logger'daki filtreleri güncelle
        if (window.Logger) {
            Logger.setFilters(currentFilters);
        }

        // Display'i yenile
        refreshDisplay();

        Logger.debug(Logger.CATEGORIES.UI, 'Debug console filtreleri güncellendi', currentFilters);
    }

    /**
     * Logları temizle
     */
    function onClearLogs() {
        if (confirm('Tüm logları temizlemek istediğinize emin misiniz?')) {
            elements.logs.innerHTML = '';
            
            if (window.Logger) {
                Logger.clearLogs();
            }
            
            Logger.info(Logger.CATEGORIES.UI, 'Debug console temizlendi');
        }
    }

    /**
     * Logları export et
     */
    function onExportLogs() {
        if (!window.Logger) return;

        const menu = createExportMenu();
        showContextMenu(menu, elements.exportBtn);
    }

    /**
     * Export menüsü oluştur
     */
    function createExportMenu() {
        const menu = document.createElement('div');
        menu.className = 'export-menu';
        menu.innerHTML = `
            <div class="export-option" data-format="json">JSON olarak indir</div>
            <div class="export-option" data-format="csv">CSV olarak indir</div>
            <div class="export-option" data-format="text">TXT olarak indir</div>
            <div class="export-separator"></div>
            <div class="export-option" data-action="copy">Panoya kopyala</div>
        `;

        // Menu event listeners
        menu.addEventListener('click', function(e) {
            const option = e.target.closest('.export-option');
            if (!option) return;

            const format = option.dataset.format;
            const action = option.dataset.action;

            if (action === 'copy') {
                copyLogsToClipboard();
            } else if (format) {
                Logger.downloadLogs(format);
            }

            menu.remove();
        });

        return menu;
    }

    /**
     * Context menu göster
     */
    function showContextMenu(menu, triggerElement) {
        // Önceki menu'ları temizle
        const existingMenus = document.querySelectorAll('.export-menu');
        existingMenus.forEach(m => m.remove());

        // Position hesapla
        const rect = triggerElement.getBoundingClientRect();
        menu.style.position = 'fixed';
        menu.style.top = rect.bottom + 5 + 'px';
        menu.style.right = window.innerWidth - rect.right + 'px';
        menu.style.zIndex = '10000';

        document.body.appendChild(menu);

        // Dışarı tıklamada kapat
        setTimeout(() => {
            document.addEventListener('click', function closeMenu(e) {
                if (!menu.contains(e.target)) {
                    menu.remove();
                    document.removeEventListener('click', closeMenu);
                }
            });
        }, 100);
    }

    /**
     * Logları panoya kopyala
     */
    function copyLogsToClipboard() {
        if (!window.Logger) return;

        try {
            const logs = Logger.getLogs(currentFilters);
            const logText = logs.map(log => log.formattedMessage).join('\n');
            
            navigator.clipboard.writeText(logText).then(() => {
                Logger.success(Logger.CATEGORIES.UI, 'Loglar panoya kopyalandı');
            }).catch(() => {
                // Fallback
                const textarea = document.createElement('textarea');
                textarea.value = logText;
                document.body.appendChild(textarea);
                textarea.select();
                document.execCommand('copy');
                document.body.removeChild(textarea);
                Logger.success(Logger.CATEGORIES.UI, 'Loglar panoya kopyalandı (fallback)');
            });
        } catch (error) {
            Logger.error(Logger.CATEGORIES.UI, 'Loglar kopyalanamadı', error);
        }
    }

    /**
     * Scroll değişimi
     */
    function onScrollChange() {
        const { scrollTop, scrollHeight, clientHeight } = elements.logs;
        const isAtBottom = scrollTop + clientHeight >= scrollHeight - 10;
        
        autoScroll = isAtBottom;
    }

    /**
     * Keyboard shortcuts
     */
    function onKeyDown(e) {
        // Ctrl+~ veya F12 ile debug console toggle
        if ((e.ctrlKey && e.key === '`') || e.key === 'F12') {
            e.preventDefault();
            toggle();
        }
        
        // Debug console açıkken ESC ile kapat
        if (e.key === 'Escape' && isVisible) {
            hide();
        }
    }

    /**
     * Log görüntülenip görüntülenmeyeceğini kontrol et
     */
    function shouldDisplayLog(logEntry) {
        // Level filtresi
        if (currentFilters.level !== 'all' && logEntry.level !== currentFilters.level) {
            return false;
        }

        // Category filtresi
        if (currentFilters.category !== 'all' && logEntry.category !== currentFilters.category) {
            return false;
        }

        // Search filtresi
        if (currentFilters.search) {
            const searchTerm = currentFilters.search.toLowerCase();
            const searchable = `${logEntry.message} ${logEntry.category} ${logEntry.level}`.toLowerCase();
            if (!searchable.includes(searchTerm)) {
                return false;
            }
        }

        return true;
    }

    /**
     * Log'u display'e ekle
     */
    function addLogToDisplay(logEntry) {
        const logElement = createLogElement(logEntry);
        
        // En üste ekle (prepend)
        elements.logs.insertBefore(logElement, elements.logs.firstChild);

        // Maksimum log sayısını kontrol et
        const logCount = elements.logs.children.length;
        if (logCount > maxDisplayedLogs) {
            // En eskilerini sil
            for (let i = maxDisplayedLogs; i < logCount; i++) {
                elements.logs.removeChild(elements.logs.lastChild);
            }
        }
    }

    /**
     * Log element'i oluştur
     */
    function createLogElement(logEntry) {
        const div = document.createElement('div');
        div.className = `log-entry ${logEntry.level}`;
        div.dataset.logId = logEntry.id;
        
        const timeSpan = document.createElement('span');
        timeSpan.className = 'log-timestamp';
        timeSpan.textContent = logEntry.formattedTime;
        
        const categorySpan = document.createElement('span');
        categorySpan.className = 'log-category';
        categorySpan.textContent = logEntry.category.toUpperCase();
        
        const messageSpan = document.createElement('span');
        messageSpan.className = 'log-message';
        messageSpan.textContent = logEntry.message;
        
        div.appendChild(timeSpan);
        div.appendChild(categorySpan);
        div.appendChild(messageSpan);

        // Data varsa ekle
        if (logEntry.data) {
            const dataDiv = document.createElement('div');
            dataDiv.className = 'log-data';
            dataDiv.textContent = JSON.stringify(logEntry.data, null, 2);
            div.appendChild(dataDiv);
        }

        // Click to expand data
        if (logEntry.data) {
            div.addEventListener('click', function() {
                const dataDiv = div.querySelector('.log-data');
                dataDiv.style.display = dataDiv.style.display === 'none' ? 'block' : 'none';
            });
        }

        return div;
    }

    /**
     * Display'i yenile
     */
    function refreshDisplay() {
        if (!window.Logger) return;

        elements.logs.innerHTML = '';
        
        const logs = Logger.getLogs(currentFilters);
        const displayLogs = logs.slice(0, maxDisplayedLogs);
        
        displayLogs.forEach(logEntry => {
            addLogToDisplay(logEntry);
        });

        if (autoScroll) {
            scrollToBottom();
        }
    }

    /**
     * İlk log'ları yükle
     */
    function loadInitialLogs() {
        refreshDisplay();
        Logger.debug(Logger.CATEGORIES.UI, 'Debug console initial logs yüklendi');
    }

    /**
     * En alta scroll et
     */
    function scrollToBottom() {
        elements.logs.scrollTop = elements.logs.scrollHeight;
    }

    /**
     * Console'u göster
     */
    function show() {
        if (!isInitialized) {
            Logger.warning(Logger.CATEGORIES.UI, 'DebugConsole başlatılmamış');
            return;
        }

        elements.console.classList.remove('hidden');
        isVisible = true;
        
        // Focus search input
        elements.searchFilter.focus();
        
        // Refresh display
        refreshDisplay();
        
        Logger.debug(Logger.CATEGORIES.UI, 'Debug console gösterildi');
    }

    /**
     * Console'u gizle
     */
    function hide() {
        elements.console.classList.add('hidden');
        isVisible = false;
        Logger.debug(Logger.CATEGORIES.UI, 'Debug console gizlendi');
    }

    /**
     * Console'u toggle et
     */
    function toggle() {
        if (isVisible) {
            hide();
        } else {
            show();
        }
    }

    /**
     * Debounce utility
     */
    function debounce(func, wait) {
        let timeout;
        return function executedFunction(...args) {
            const later = () => {
                clearTimeout(timeout);
                func(...args);
            };
            clearTimeout(timeout);
            timeout = setTimeout(later, wait);
        };
    }

    // Public API
    return {
        init: init,
        show: show,
        hide: hide,
        toggle: toggle,
        
        // Utility
        isVisible: function() {
            return isVisible;
        },
        
        isInitialized: function() {
            return isInitialized;
        },
        
        // Settings
        setMaxDisplayedLogs: function(max) {
            maxDisplayedLogs = max;
            refreshDisplay();
        },
        
        setAutoScroll: function(enabled) {
            autoScroll = enabled;
        }
    };

})();

// Auto-initialize if dependencies are available
if (window.Logger) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            DebugConsole.init();
        });
    } else {
        DebugConsole.init();
    }
} else {
    console.warn('DebugConsole: Logger modülü bulunamadı, başlatılamıyor');
}

// Export menu CSS (inject into head)
if (document.head) {
    const style = document.createElement('style');
    style.textContent = `
        .export-menu {
            background: var(--secondary-bg, #1a1f29);
            border: 1px solid var(--border-color, #2d3748);
            border-radius: var(--radius-md, 8px);
            box-shadow: var(--shadow-lg, 0 10px 15px rgba(0, 0, 0, 0.4));
            min-width: 150px;
            z-index: 10000;
        }
        
        .export-option {
            padding: 8px 12px;
            cursor: pointer;
            color: var(--primary-text, #ffffff);
            font-size: 0.875rem;
            transition: background-color 0.15s ease;
        }
        
        .export-option:hover {
            background-color: var(--accent-bg, #2d3748);
        }
        
        .export-separator {
            height: 1px;
            background-color: var(--border-color, #2d3748);
            margin: 4px 0;
        }
        
        .log-data {
            background: rgba(0, 0, 0, 0.3);
            padding: var(--spacing-sm, 0.5rem);
            margin-top: var(--spacing-xs, 0.25rem);
            border-radius: var(--radius-sm, 4px);
            font-family: 'Courier New', monospace;
            font-size: 0.6875rem;
            white-space: pre-wrap;
            display: none;
            border-left: 2px solid var(--info-color, #4299e1);
        }
    `;
    document.head.appendChild(style);
}
