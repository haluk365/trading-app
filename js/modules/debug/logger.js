/**
 * DEBUG LOGGER MODÜLÜ
 * Tüm uygulama hatalarını ve debug bilgilerini yönetir
 * Bu modül ilk yüklenen modül olmalıdır
 */

window.Logger = (function() {
    'use strict';

    // Log seviyeleri
    const LOG_LEVELS = {
        ERROR: 'error',
        WARNING: 'warning', 
        INFO: 'info',
        DEBUG: 'debug',
        SUCCESS: 'success'
    };

    // Log kategorileri
    const LOG_CATEGORIES = {
        APP: 'app',
        API: 'api',
        WEBSOCKET: 'websocket',
        INDICATORS: 'indicators',
        TRADING: 'trading',
        UI: 'ui',
        STORAGE: 'storage'
    };

    // Log storage
    let logs = [];
    let maxLogs = 1000; // Maksimum log sayısı
    let logFilters = {
        level: 'all',
        category: 'all',
        search: ''
    };

    // Event listeners
    let logEventListeners = [];

    /**
     * Yeni log girişi oluştur
     */
    function createLogEntry(level, category, message, data = null) {
        const timestamp = new Date();
        const logEntry = {
            id: generateLogId(),
            timestamp: timestamp,
            level: level,
            category: category,
            message: message,
            data: data,
            formattedTime: formatTime(timestamp),
            formattedMessage: formatMessage(level, category, message, timestamp)
        };

        return logEntry;
    }

    /**
     * Log ID oluştur
     */
    function generateLogId() {
        return 'log_' + Date.now() + '_' + Math.random().toString(36).substr(2, 9);
    }

    /**
     * Zamanı formatla
     */
    function formatTime(timestamp) {
        const hours = timestamp.getHours().toString().padStart(2, '0');
        const minutes = timestamp.getMinutes().toString().padStart(2, '0');
        const seconds = timestamp.getSeconds().toString().padStart(2, '0');
        const milliseconds = timestamp.getMilliseconds().toString().padStart(3, '0');
        
        return `${hours}:${minutes}:${seconds}.${milliseconds}`;
    }

    /**
     * Log mesajını formatla
     */
    function formatMessage(level, category, message, timestamp) {
        const timeStr = formatTime(timestamp);
        const levelStr = level.toUpperCase().padEnd(7);
        const categoryStr = category.toUpperCase().padEnd(10);
        
        return `[${timeStr}] [${levelStr}] [${categoryStr}] ${message}`;
    }

    /**
     * Log'u kaydet
     */
    function addLog(level, category, message, data = null) {
        try {
            const logEntry = createLogEntry(level, category, message, data);
            
            // Log array'ine ekle
            logs.unshift(logEntry);
            
            // Maksimum log sayısını kontrol et
            if (logs.length > maxLogs) {
                logs = logs.slice(0, maxLogs);
            }

            // Console'a da yazdır
            writeToConsole(logEntry);

            // Storage'a kaydet (async)
            saveToStorage(logEntry);

            // Event listeners'ları bilgilendir
            notifyLogListeners(logEntry);

            return logEntry;

        } catch (error) {
            // Logger'da hata olursa console'a yazdır
            console.error('Logger Error:', error);
            console.error('Original Log:', { level, category, message, data });
        }
    }

    /**
     * Console'a yazdır
     */
    function writeToConsole(logEntry) {
        const { level, formattedMessage, data } = logEntry;
        
        try {
            switch (level) {
                case LOG_LEVELS.ERROR:
                    console.error(formattedMessage, data ? data : '');
                    break;
                case LOG_LEVELS.WARNING:
                    console.warn(formattedMessage, data ? data : '');
                    break;
                case LOG_LEVELS.SUCCESS:
                case LOG_LEVELS.INFO:
                    console.info(formattedMessage, data ? data : '');
                    break;
                case LOG_LEVELS.DEBUG:
                    console.debug(formattedMessage, data ? data : '');
                    break;
                default:
                    console.log(formattedMessage, data ? data : '');
            }
        } catch (error) {
            console.error('Console write error:', error);
        }
    }

    /**
     * Storage'a kaydet
     */
    function saveToStorage(logEntry) {
        try {
            // LocalStorage'a son 100 log'u kaydet
            let storedLogs = JSON.parse(localStorage.getItem('tradingAppLogs') || '[]');
            storedLogs.unshift({
                timestamp: logEntry.timestamp.toISOString(),
                level: logEntry.level,
                category: logEntry.category,
                message: logEntry.message,
                data: logEntry.data
            });
            
            // Son 100 log'u tut
            if (storedLogs.length > 100) {
                storedLogs = storedLogs.slice(0, 100);
            }
            
            localStorage.setItem('tradingAppLogs', JSON.stringify(storedLogs));
        } catch (error) {
            console.error('Storage save error:', error);
        }
    }

    /**
     * Event listeners'ları bilgilendir
     */
    function notifyLogListeners(logEntry) {
        logEventListeners.forEach(listener => {
            try {
                listener(logEntry);
            } catch (error) {
                console.error('Log listener error:', error);
            }
        });
    }

    /**
     * Log filtreleme
     */
    function filterLogs(logs, filters) {
        return logs.filter(log => {
            // Level filtresi
            if (filters.level !== 'all' && log.level !== filters.level) {
                return false;
            }

            // Category filtresi
            if (filters.category !== 'all' && log.category !== filters.category) {
                return false;
            }

            // Search filtresi
            if (filters.search && filters.search.trim()) {
                const searchTerm = filters.search.toLowerCase();
                const searchable = `${log.message} ${log.category} ${log.level}`.toLowerCase();
                if (!searchable.includes(searchTerm)) {
                    return false;
                }
            }

            return true;
        });
    }

    // Public API
    return {
        // Log Functions
        error: function(category, message, data = null) {
            return addLog(LOG_LEVELS.ERROR, category, message, data);
        },

        warning: function(category, message, data = null) {
            return addLog(LOG_LEVELS.WARNING, category, message, data);
        },

        info: function(category, message, data = null) {
            return addLog(LOG_LEVELS.INFO, category, message, data);
        },

        debug: function(category, message, data = null) {
            return addLog(LOG_LEVELS.DEBUG, category, message, data);
        },

        success: function(category, message, data = null) {
            return addLog(LOG_LEVELS.SUCCESS, category, message, data);
        },

        // Log Management
        getLogs: function(filters = null) {
            if (filters) {
                return filterLogs(logs, filters);
            }
            return logs.slice(); // Copy array
        },

        clearLogs: function() {
            logs = [];
            try {
                localStorage.removeItem('tradingAppLogs');
            } catch (error) {
                console.error('Clear logs error:', error);
            }
            Logger.info(LOG_CATEGORIES.APP, 'Loglar temizlendi');
        },

        setFilters: function(newFilters) {
            logFilters = { ...logFilters, ...newFilters };
            return logFilters;
        },

        getFilters: function() {
            return { ...logFilters };
        },

        // Event Management
        addEventListener: function(listener) {
            if (typeof listener === 'function') {
                logEventListeners.push(listener);
            }
        },

        removeEventListener: function(listener) {
            const index = logEventListeners.indexOf(listener);
            if (index > -1) {
                logEventListeners.splice(index, 1);
            }
        },

        // Export Functions
        exportLogs: function(format = 'json', filters = null) {
            try {
                const logsToExport = filters ? filterLogs(logs, filters) : logs;
                
                if (format === 'json') {
                    return JSON.stringify(logsToExport, null, 2);
                } else if (format === 'csv') {
                    return exportToCSV(logsToExport);
                } else if (format === 'text') {
                    return exportToText(logsToExport);
                }
                
                return JSON.stringify(logsToExport, null, 2);
            } catch (error) {
                Logger.error(LOG_CATEGORIES.APP, 'Log export hatası', error);
                return null;
            }
        },

        downloadLogs: function(format = 'json', filename = null) {
            try {
                const logData = Logger.exportLogs(format);
                if (!logData) return false;

                const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
                const defaultFilename = `trading-app-logs-${timestamp}.${format}`;
                const finalFilename = filename || defaultFilename;

                const blob = new Blob([logData], { 
                    type: format === 'json' ? 'application/json' : 'text/plain' 
                });
                
                const url = URL.createObjectURL(blob);
                const a = document.createElement('a');
                a.href = url;
                a.download = finalFilename;
                document.body.appendChild(a);
                a.click();
                document.body.removeChild(a);
                URL.revokeObjectURL(url);

                Logger.success(LOG_CATEGORIES.APP, `Loglar indirildi: ${finalFilename}`);
                return true;
            } catch (error) {
                Logger.error(LOG_CATEGORIES.APP, 'Log indirme hatası', error);
                return false;
            }
        },

        // Statistics
        getStats: function() {
            const stats = {
                total: logs.length,
                error: 0,
                warning: 0,
                info: 0,
                debug: 0,
                success: 0,
                categories: {}
            };

            logs.forEach(log => {
                stats[log.level]++;
                stats.categories[log.category] = (stats.categories[log.category] || 0) + 1;
            });

            return stats;
        },

        // Constants
        LEVELS: LOG_LEVELS,
        CATEGORIES: LOG_CATEGORIES,

        // Initialization
        init: function() {
            Logger.info(LOG_CATEGORIES.APP, 'Debug Logger başlatıldı');
            
            // Stored logs'u yükle
            try {
                const storedLogs = JSON.parse(localStorage.getItem('tradingAppLogs') || '[]');
                Logger.info(LOG_CATEGORIES.APP, `${storedLogs.length} adet önceki log yüklendi`);
            } catch (error) {
                Logger.warning(LOG_CATEGORIES.APP, 'Önceki loglar yüklenemedi', error);
            }

            return true;
        }
    };

    // Helper Functions
    function exportToCSV(logs) {
        const headers = ['Timestamp', 'Level', 'Category', 'Message', 'Data'];
        const csvContent = [
            headers.join(','),
            ...logs.map(log => [
                log.timestamp.toISOString(),
                log.level,
                log.category,
                `"${log.message.replace(/"/g, '""')}"`,
                log.data ? `"${JSON.stringify(log.data).replace(/"/g, '""')}"` : ''
            ].join(','))
        ].join('\n');
        
        return csvContent;
    }

    function exportToText(logs) {
        return logs.map(log => log.formattedMessage).join('\n');
    }

})();

// Logger'ı başlat
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', function() {
        Logger.init();
    });
} else {
    Logger.init();
}
