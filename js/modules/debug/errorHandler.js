/**
 * ERROR HANDLER MODÜLÜ
 * Global hata yakalama ve yönetim sistemi
 * Logger modülüne bağımlı
 */

window.ErrorHandler = (function() {
    'use strict';

    let isInitialized = false;
    let errorHandlers = new Map();
    let errorStats = {
        totalErrors: 0,
        javascriptErrors: 0,
        promiseErrors: 0,
        apiErrors: 0,
        websocketErrors: 0,
        customErrors: 0
    };

    /**
     * Error Handler'ı başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.APP, 'ErrorHandler zaten başlatılmış');
            return false;
        }

        try {
            // Global JavaScript hatalarını yakala
            setupGlobalErrorHandler();
            
            // Promise rejection'larını yakala
            setupPromiseErrorHandler();
            
            // Resource loading hatalarını yakala
            setupResourceErrorHandler();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.APP, 'ErrorHandler başarıyla başlatıldı');
            return true;

        } catch (error) {
            console.error('ErrorHandler başlatma hatası:', error);
            return false;
        }
    }

    /**
     * Global JavaScript error handler
     */
    function setupGlobalErrorHandler() {
        window.addEventListener('error', function(event) {
            const error = event.error;
            const errorInfo = {
                message: event.message,
                filename: event.filename,
                lineno: event.lineno,
                colno: event.colno,
                stack: error ? error.stack : null,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                url: window.location.href
            };

            handleJavaScriptError(errorInfo);
        });

        Logger.debug(Logger.CATEGORIES.APP, 'Global JavaScript error handler kuruldu');
    }

    /**
     * Promise rejection handler
     */
    function setupPromiseErrorHandler() {
        window.addEventListener('unhandledrejection', function(event) {
            const reason = event.reason;
            const errorInfo = {
                reason: reason,
                message: reason && reason.message ? reason.message : 'Unhandled Promise Rejection',
                stack: reason && reason.stack ? reason.stack : null,
                timestamp: new Date().toISOString(),
                userAgent: navigator.userAgent,
                url: window.location.href
            };

            handlePromiseError(errorInfo);
            
            // Promise rejection'ı sessizce handle et
            event.preventDefault();
        });

        Logger.debug(Logger.CATEGORIES.APP, 'Promise rejection handler kuruldu');
    }

    /**
     * Resource loading error handler
     */
    function setupResourceErrorHandler() {
        window.addEventListener('error', function(event) {
            // Resource loading hatalarını yakala (script, css, img vs.)
            if (event.target !== window) {
                const errorInfo = {
                    type: 'Resource Loading Error',
                    tagName: event.target.tagName,
                    source: event.target.src || event.target.href,
                    message: `Failed to load ${event.target.tagName}: ${event.target.src || event.target.href}`,
                    timestamp: new Date().toISOString()
                };

                handleResourceError(errorInfo);
            }
        }, true); // useCapture = true

        Logger.debug(Logger.CATEGORIES.APP, 'Resource error handler kuruldu');
    }

    /**
     * JavaScript hatasını işle
     */
    function handleJavaScriptError(errorInfo) {
        errorStats.totalErrors++;
        errorStats.javascriptErrors++;

        // Critical hatalar için özel işlem
        const isCritical = checkIfCriticalError(errorInfo);
        
        Logger.error(Logger.CATEGORIES.APP, 
            `JavaScript Hatası: ${errorInfo.message}`, {
                file: errorInfo.filename,
                line: errorInfo.lineno,
                column: errorInfo.colno,
                stack: errorInfo.stack,
                isCritical: isCritical
            });

        // Critical hata ise user'ı bilgilendir
        if (isCritical) {
            showCriticalErrorAlert(errorInfo);
        }

        // Registered handler'ları çağır
        notifyErrorHandlers('javascript', errorInfo);
    }

    /**
     * Promise hatasını işle
     */
    function handlePromiseError(errorInfo) {
        errorStats.totalErrors++;
        errorStats.promiseErrors++;

        Logger.error(Logger.CATEGORIES.APP, 
            `Promise Hatası: ${errorInfo.message}`, {
                reason: errorInfo.reason,
                stack: errorInfo.stack
            });

        notifyErrorHandlers('promise', errorInfo);
    }

    /**
     * Resource hatasını işle
     */
    function handleResourceError(errorInfo) {
        Logger.warning(Logger.CATEGORIES.APP, 
            `Resource Yükleme Hatası: ${errorInfo.message}`, errorInfo);

        notifyErrorHandlers('resource', errorInfo);
    }

    /**
     * API hatasını işle
     */
    function handleAPIError(error, context = {}) {
        errorStats.totalErrors++;
        errorStats.apiErrors++;

        const errorInfo = {
            type: 'API Error',
            message: error.message || 'API hatası',
            status: error.status || 'Unknown',
            url: error.url || context.url || 'Unknown',
            method: error.method || context.method || 'Unknown',
            timestamp: new Date().toISOString(),
            context: context
        };

        Logger.error(Logger.CATEGORIES.API, 
            `API Hatası (${errorInfo.status}): ${errorInfo.message}`, errorInfo);

        notifyErrorHandlers('api', errorInfo);
        return errorInfo;
    }

    /**
     * WebSocket hatasını işle
     */
    function handleWebSocketError(error, context = {}) {
        errorStats.totalErrors++;
        errorStats.websocketErrors++;

        const errorInfo = {
            type: 'WebSocket Error',
            message: error.message || 'WebSocket hatası',
            code: error.code || 'Unknown',
            reason: error.reason || 'Unknown',
            timestamp: new Date().toISOString(),
            context: context
        };

        Logger.error(Logger.CATEGORIES.WEBSOCKET, 
            `WebSocket Hatası: ${errorInfo.message}`, errorInfo);

        notifyErrorHandlers('websocket', errorInfo);
        return errorInfo;
    }

    /**
     * Custom hataları işle
     */
    function handleCustomError(errorType, message, data = null, category = 'APP') {
        errorStats.totalErrors++;
        errorStats.customErrors++;

        const errorInfo = {
            type: errorType,
            message: message,
            data: data,
            timestamp: new Date().toISOString(),
            category: category
        };

        Logger.error(category, `${errorType}: ${message}`, data);

        notifyErrorHandlers('custom', errorInfo);
        return errorInfo;
    }

    /**
     * Critical hata kontrolü
     */
    function checkIfCriticalError(errorInfo) {
        const criticalPatterns = [
            /cannot read property/i,
            /is not defined/i,
            /is not a function/i,
            /script error/i,
            /network error/i,
            /cors/i
        ];

        return criticalPatterns.some(pattern => 
            pattern.test(errorInfo.message) || 
            (errorInfo.stack && pattern.test(errorInfo.stack))
        );
    }

    /**
     * Critical hata alert'i göster
     */
    function showCriticalErrorAlert(errorInfo) {
        // AlertSystem varsa kullan, yoksa basit alert
        if (window.AlertSystem) {
            AlertSystem.error(
                'Kritik Hata', 
                'Uygulamada kritik bir hata oluştu. Lütfen sayfayı yenileyin.',
                {
                    persistent: true,
                    buttons: [
                        {
                            text: 'Sayfayı Yenile',
                            action: () => window.location.reload()
                        },
                        {
                            text: 'Detayları Göster',
                            action: () => {
                                if (window.DebugConsole) {
                                    DebugConsole.show();
                                }
                            }
                        }
                    ]
                }
            );
        } else {
            const reload = confirm(
                'Kritik bir hata oluştu. Sayfayı yenilemek istiyor musunuz?\n\n' +
                `Hata: ${errorInfo.message}`
            );
            if (reload) {
                window.location.reload();
            }
        }
    }

    /**
     * Error handler'ları bilgilendir
     */
    function notifyErrorHandlers(errorType, errorInfo) {
        if (errorHandlers.has(errorType)) {
            const handlers = errorHandlers.get(errorType);
            handlers.forEach(handler => {
                try {
                    handler(errorInfo);
                } catch (error) {
                    console.error('Error handler çalışırken hata:', error);
                }
            });
        }

        // 'all' handler'larını da çağır
        if (errorHandlers.has('all')) {
            const allHandlers = errorHandlers.get('all');
            allHandlers.forEach(handler => {
                try {
                    handler(errorType, errorInfo);
                } catch (error) {
                    console.error('All error handler çalışırken hata:', error);
                }
            });
        }
    }

    /**
     * Try-Catch wrapper
     */
    function safeExecute(fn, context = 'Unknown', onError = null) {
        try {
            const result = fn();
            
            // Promise ise catch ekle
            if (result && typeof result.catch === 'function') {
                return result.catch(error => {
                    handleCustomError('Async Execution Error', 
                        `${context} - ${error.message}`, error);
                    
                    if (onError) {
                        onError(error);
                    }
                    
                    throw error;
                });
            }
            
            return result;
        } catch (error) {
            handleCustomError('Execution Error', 
                `${context} - ${error.message}`, error);
            
            if (onError) {
                onError(error);
            } else {
                throw error;
            }
        }
    }

    /**
     * Async function wrapper
     */
    function safeAsync(asyncFn, context = 'Unknown', onError = null) {
        return async function(...args) {
            try {
                return await asyncFn.apply(this, args);
            } catch (error) {
                handleCustomError('Async Function Error', 
                    `${context} - ${error.message}`, error);
                
                if (onError) {
                    onError(error);
                } else {
                    throw error;
                }
            }
        };
    }

    // Public API
    return {
        // Initialization
        init: init,
        
        // Error Handlers
        handleAPIError: handleAPIError,
        handleWebSocketError: handleWebSocketError,
        handleCustomError: handleCustomError,
        
        // Safe Execution
        safeExecute: safeExecute,
        safeAsync: safeAsync,
        
        // Error Handler Registration
        on: function(errorType, handler) {
            if (!errorHandlers.has(errorType)) {
                errorHandlers.set(errorType, []);
            }
            errorHandlers.get(errorType).push(handler);
            
            Logger.debug(Logger.CATEGORIES.APP, 
                `Error handler registered for: ${errorType}`);
        },
        
        off: function(errorType, handler) {
            if (errorHandlers.has(errorType)) {
                const handlers = errorHandlers.get(errorType);
                const index = handlers.indexOf(handler);
                if (index > -1) {
                    handlers.splice(index, 1);
                    Logger.debug(Logger.CATEGORIES.APP, 
                        `Error handler removed for: ${errorType}`);
                }
            }
        },
        
        // Statistics
        getStats: function() {
            return { ...errorStats };
        },
        
        resetStats: function() {
            errorStats = {
                totalErrors: 0,
                javascriptErrors: 0,
                promiseErrors: 0,
                apiErrors: 0,
                websocketErrors: 0,
                customErrors: 0
            };
            Logger.info(Logger.CATEGORIES.APP, 'Error istatistikleri sıfırlandı');
        },
        
        // Utility
        isInitialized: function() {
            return isInitialized;
        },
        
        // Test function (development only)
        test: function() {
            Logger.info(Logger.CATEGORIES.APP, 'ErrorHandler test başlatıldı');
            
            // JavaScript error test
            setTimeout(() => {
                try {
                    // Intentional error
                    nonExistentFunction();
                } catch (error) {
                    handleCustomError('Test Error', 'Bu bir test hatasıdır', error);
                }
            }, 1000);
            
            // Promise error test
            setTimeout(() => {
                Promise.reject(new Error('Test Promise Error'));
            }, 2000);
            
            Logger.info(Logger.CATEGORIES.APP, 'ErrorHandler testleri çalıştırıldı');
        }
    };

})();

// Auto-initialize if Logger is available
if (window.Logger) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            ErrorHandler.init();
        });
    } else {
        ErrorHandler.init();
    }
} else {
    console.warn('ErrorHandler: Logger modülü bulunamadı, başlatılamıyor');
}
