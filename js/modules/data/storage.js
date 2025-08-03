/**
 * DATA STORAGE MODÜLÜ
 * LocalStorage, SessionStorage ve IndexedDB yönetimi
 * Cache sistemi ve veri kalıcılığı
 */

window.Storage = (function() {
    'use strict';

    let isInitialized = false;
    let cache = new Map();
    let dbConnection = null;
    
    const DB_NAME = 'TradingAppDB';
    const DB_VERSION = 1;
    const STORES = {
        KLINE_DATA: 'klineData',
        SIGNALS: 'signals',
        TRADES: 'trades',
        SETTINGS: 'settings',
        PERFORMANCE: 'performance'
    };

    /**
     * Storage sistemini başlat
     */
    function init() {
        if (isInitialized) {
            Logger.warning(Logger.CATEGORIES.STORAGE, 'Storage zaten başlatılmış');
            return Promise.resolve(true);
        }

        return ErrorHandler.safeAsync(async function() {
            // IndexedDB'yi başlat
            await initIndexedDB();
            
            // Cache temizliğini başlat
            startCacheCleanup();
            
            // Storage event listener'ları kur
            setupStorageListeners();

            isInitialized = true;
            Logger.success(Logger.CATEGORIES.STORAGE, 'Storage sistemi başlatıldı');
            return true;
            
        }, 'Storage Initialization')();
    }

    /**
     * IndexedDB'yi başlat
     */
    function initIndexedDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(DB_NAME, DB_VERSION);
            
            request.onerror = function() {
                Logger.error(Logger.CATEGORIES.STORAGE, 'IndexedDB açma hatası', request.error);
                reject(request.error);
            };
            
            request.onsuccess = function() {
                dbConnection = request.result;
                Logger.info(Logger.CATEGORIES.STORAGE, 'IndexedDB bağlantısı kuruldu');
                resolve();
            };
            
            request.onupgradeneeded = function(event) {
                const db = event.target.result;
                
                // Kline data store
                if (!db.objectStoreNames.contains(STORES.KLINE_DATA)) {
                    const klineStore = db.createObjectStore(STORES.KLINE_DATA, { 
                        keyPath: 'id' 
                    });
                    klineStore.createIndex('symbol', 'symbol', { unique: false });
                    klineStore.createIndex('timeframe', 'timeframe', { unique: false });
                    klineStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
                // Signals store
                if (!db.objectStoreNames.contains(STORES.SIGNALS)) {
                    const signalsStore = db.createObjectStore(STORES.SIGNALS, { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    signalsStore.createIndex('symbol', 'symbol', { unique: false });
                    signalsStore.createIndex('timestamp', 'timestamp', { unique: false });
                    signalsStore.createIndex('type', 'type', { unique: false });
                }
                
                // Trades store
                if (!db.objectStoreNames.contains(STORES.TRADES)) {
                    const tradesStore = db.createObjectStore(STORES.TRADES, { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    tradesStore.createIndex('symbol', 'symbol', { unique: false });
                    tradesStore.createIndex('status', 'status', { unique: false });
                    tradesStore.createIndex('timestamp', 'timestamp', { unique: false });
                }
                
                // Settings store
                if (!db.objectStoreNames.contains(STORES.SETTINGS)) {
                    db.createObjectStore(STORES.SETTINGS, { keyPath: 'key' });
                }
                
                // Performance store
                if (!db.objectStoreNames.contains(STORES.PERFORMANCE)) {
                    const perfStore = db.createObjectStore(STORES.PERFORMANCE, { 
                        keyPath: 'id', 
                        autoIncrement: true 
                    });
                    perfStore.createIndex('timestamp', 'timestamp', { unique: false });
                    perfStore.createIndex('type', 'type', { unique: false });
                }
                
                Logger.info(Logger.CATEGORIES.STORAGE, 'IndexedDB schema oluşturuldu');
            };
        });
    }

    /**
     * Cache temizliğini başlat
     */
    function startCacheCleanup() {
        setInterval(() => {
            const now = Date.now();
            const maxAge = Config.get('DATA.cache.ttl', 60000);
            
            for (const [key, value] of cache.entries()) {
                if (now - value.timestamp > maxAge) {
                    cache.delete(key);
                }
            }
            
            Logger.debug(Logger.CATEGORIES.STORAGE, `Cache temizlendi, ${cache.size} item kaldı`);
        }, 60000); // Her dakika temizle
    }

    /**
     * Storage event listener'ları kur
     */
    function setupStorageListeners() {
        // LocalStorage değişikliklerini dinle
        window.addEventListener('storage', function(e) {
            if (e.key && e.key.startsWith(Config.get('DATA.storage.prefix', 'tradingApp_'))) {
                Logger.debug(Logger.CATEGORIES.STORAGE, 'Storage değişikliği tespit edildi', {
                    key: e.key,
                    oldValue: e.oldValue,
                    newValue: e.newValue
                });
            }
        });
    }

    /**
     * LOCALSTORAGE FONKSIYONLARI
     */
    const LocalStorage = {
        
        /**
         * LocalStorage'a veri kaydet
         */
        set: function(key, value, compress = false) {
            try {
                const prefixedKey = Config.get('DATA.storage.prefix', 'tradingApp_') + key;
                const data = {
                    value: value,
                    timestamp: Date.now(),
                    version: Config.get('DATA.storage.version', '1.0'),
                    compressed: compress
                };
                
                let serialized = JSON.stringify(data);
                
                // Compression (basit implementation)
                if (compress && serialized.length > 1000) {
                    // Gerçek uygulamada LZ kompresyon kullanılabilir
                    Logger.debug(Logger.CATEGORIES.STORAGE, `Compressing data: ${serialized.length} bytes`);
                }
                
                localStorage.setItem(prefixedKey, serialized);
                Logger.debug(Logger.CATEGORIES.STORAGE, `LocalStorage'a kaydedildi: ${key}`);
                return true;
                
            } catch (error) {
                Logger.error(Logger.CATEGORIES.STORAGE, 'LocalStorage kaydetme hatası', error);
                
                // Storage quota exceeded ise temizlik yap
                if (error.name === 'QuotaExceededError') {
                    this.cleanup();
                    return this.set(key, value, compress); // Retry
                }
                
                return false;
            }
        },
        
        /**
         * LocalStorage'dan veri al
         */
        get: function(key, defaultValue = null) {
            try {
                const prefixedKey = Config.get('DATA.storage.prefix', 'tradingApp_') + key;
                const stored = localStorage.getItem(prefixedKey);
                
                if (!stored) {
                    return defaultValue;
                }
                
                const data = JSON.parse(stored);
                
                // Version kontrolü
                const currentVersion = Config.get('DATA.storage.version', '1.0');
                if (data.version !== currentVersion) {
                    Logger.warning(Logger.CATEGORIES.STORAGE, `Version mismatch: ${key}`);
                    this.remove(key);
                    return defaultValue;
                }
                
                // TTL kontrolü
                const maxAge = Config.get('DATA.cache.ttl', 86400000); // 24 hours
                if (Date.now() - data.timestamp > maxAge) {
                    Logger.debug(Logger.CATEGORIES.STORAGE, `Expired data removed: ${key}`);
                    this.remove(key);
                    return defaultValue;
                }
                
                return data.value;
                
            } catch (error) {
                Logger.error(Logger.CATEGORIES.STORAGE, 'LocalStorage okuma hatası', error);
                return defaultValue;
            }
        },
        
        /**
         * LocalStorage'dan veri sil
         */
        remove: function(key) {
            try {
                const prefixedKey = Config.get('DATA.storage.prefix', 'tradingApp_') + key;
                localStorage.removeItem(prefixedKey);
                Logger.debug(Logger.CATEGORIES.STORAGE, `LocalStorage'dan silindi: ${key}`);
                return true;
            } catch (error) {
                Logger.error(Logger.CATEGORIES.STORAGE, 'LocalStorage silme hatası', error);
                return false;
            }
        },
        
        /**
         * Tüm uygulama verilerini temizle
         */
        clear: function() {
            try {
                const prefix = Config.get('DATA.storage.prefix', 'tradingApp_');
                const keys = Object.keys(localStorage).filter(key => key.startsWith(prefix));
                
                keys.forEach(key => localStorage.removeItem(key));
                Logger.info(Logger.CATEGORIES.STORAGE, `${keys.length} LocalStorage item temizlendi`);
                return true;
            } catch (error) {
                Logger.error(Logger.CATEGORIES.STORAGE, 'LocalStorage temizleme hatası', error);
                return false;
            }
        },
        
        /**
         * Eski verileri temizle
         */
        cleanup: function() {
            try {
                const prefix = Config.get('DATA.storage.prefix', 'tradingApp_');
                const maxAge = Config.get('DATA.cache.ttl', 86400000);
                const now = Date.now();
                let cleanedCount = 0;
                
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith(prefix)) {
                        try {
                            const data = JSON.parse(localStorage.getItem(key));
                            if (data.timestamp && (now - data.timestamp > maxAge)) {
                                localStorage.removeItem(key);
                                cleanedCount++;
                            }
                        } catch (error) {
                            // Geçersiz JSON ise sil
                            localStorage.removeItem(key);
                            cleanedCount++;
                        }
                    }
                });
                
                Logger.info(Logger.CATEGORIES.STORAGE, `LocalStorage cleanup: ${cleanedCount} item silindi`);
                return cleanedCount;
            } catch (error) {
                Logger.error(Logger.CATEGORIES.STORAGE, 'LocalStorage cleanup hatası', error);
                return 0;
            }
        },
        
        /**
         * Storage boyutunu hesapla
         */
        getSize: function() {
            try {
                const prefix = Config.get('DATA.storage.prefix', 'tradingApp_');
                let totalSize = 0;
                
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith(prefix)) {
                        totalSize += localStorage.getItem(key).length;
                    }
                });
                
                return {
                    bytes: totalSize,
                    kb: Math.round(totalSize / 1024),
                    mb: Math.round(totalSize / (1024 * 1024))
                };
            } catch (error) {
                Logger.error(Logger.CATEGORIES.STORAGE, 'Storage boyut hesaplama hatası', error);
                return { bytes: 0, kb: 0, mb: 0 };
            }
        }
    };

    /**
     * CACHE FONKSIYONLARI
     */
    const Cache = {
        
        /**
         * Cache'e veri kaydet
         */
        set: function(key, value, ttl = null) {
            const item = {
                value: value,
                timestamp: Date.now(),
                ttl: ttl || Config.get('DATA.cache.ttl', 60000)
            };
            
            cache.set(key, item);
            
            // Max size kontrolü
            const maxSize = Config.get('DATA.cache.maxSize', 1000);
            if (cache.size > maxSize) {
                // En eski item'ı sil
                const oldestKey = cache.keys().next().value;
                cache.delete(oldestKey);
            }
            
            Logger.debug(Logger.CATEGORIES.STORAGE, `Cache'e kaydedildi: ${key}`);
        },
        
        /**
         * Cache'den veri al
         */
        get: function(key, defaultValue = null) {
            const item = cache.get(key);
            
            if (!item) {
                return defaultValue;
            }
            
            // TTL kontrolü
            if (Date.now() - item.timestamp > item.ttl) {
                cache.delete(key);
                Logger.debug(Logger.CATEGORIES.STORAGE, `Expired cache removed: ${key}`);
                return defaultValue;
            }
            
            return item.value;
        },
        
        /**
         * Cache'den veri sil
         */
        remove: function(key) {
            const deleted = cache.delete(key);
            if (deleted) {
                Logger.debug(Logger.CATEGORIES.STORAGE, `Cache'den silindi: ${key}`);
            }
            return deleted;
        },
        
        /**
         * Cache'i temizle
         */
        clear: function() {
            const size = cache.size;
            cache.clear();
            Logger.info(Logger.CATEGORIES.STORAGE, `Cache temizlendi: ${size} item`);
        },
        
        /**
         * Cache istatistikleri
         */
        getStats: function() {
            let totalSize = 0;
            let expiredCount = 0;
            const now = Date.now();
            
            for (const [key, item] of cache.entries()) {
                totalSize += JSON.stringify(item.value).length;
                if (now - item.timestamp > item.ttl) {
                    expiredCount++;
                }
            }
            
            return {
                totalItems: cache.size,
                totalSize: totalSize,
                expiredItems: expiredCount,
                hitRate: 0 // Implement hit rate tracking if needed
            };
        }
    };

    /**
     * INDEXEDDB FONKSIYONLARI
     */
    const IndexedDB = {
        
        /**
         * IndexedDB'ye veri kaydet
         */
        set: function(storeName, data) {
            return new Promise((resolve, reject) => {
                if (!dbConnection) {
                    reject(new Error('IndexedDB bağlantısı yok'));
                    return;
                }
                
                const transaction = dbConnection.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.put(data);
                
                request.onsuccess = function() {
                    Logger.debug(Logger.CATEGORIES.STORAGE, `IndexedDB'ye kaydedildi: ${storeName}`);
                    resolve(request.result);
                };
                
                request.onerror = function() {
                    Logger.error(Logger.CATEGORIES.STORAGE, 'IndexedDB kaydetme hatası', request.error);
                    reject(request.error);
                };
            });
        },
        
        /**
         * IndexedDB'den veri al
         */
        get: function(storeName, key) {
            return new Promise((resolve, reject) => {
                if (!dbConnection) {
                    reject(new Error('IndexedDB bağlantısı yok'));
                    return;
                }
                
                const transaction = dbConnection.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const request = store.get(key);
                
                request.onsuccess = function() {
                    resolve(request.result);
                };
                
                request.onerror = function() {
                    Logger.error(Logger.CATEGORIES.STORAGE, 'IndexedDB okuma hatası', request.error);
                    reject(request.error);
                };
            });
        },
        
        /**
         * IndexedDB'den tüm verileri al
         */
        getAll: function(storeName, index = null, query = null) {
            return new Promise((resolve, reject) => {
                if (!dbConnection) {
                    reject(new Error('IndexedDB bağlantısı yok'));
                    return;
                }
                
                const transaction = dbConnection.transaction([storeName], 'readonly');
                const store = transaction.objectStore(storeName);
                const source = index ? store.index(index) : store;
                const request = query ? source.getAll(query) : source.getAll();
                
                request.onsuccess = function() {
                    resolve(request.result);
                };
                
                request.onerror = function() {
                    Logger.error(Logger.CATEGORIES.STORAGE, 'IndexedDB getAll hatası', request.error);
                    reject(request.error);
                };
            });
        },
        
        /**
         * IndexedDB'den veri sil
         */
        delete: function(storeName, key) {
            return new Promise((resolve, reject) => {
                if (!dbConnection) {
                    reject(new Error('IndexedDB bağlantısı yok'));
                    return;
                }
                
                const transaction = dbConnection.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.delete(key);
                
                request.onsuccess = function() {
                    Logger.debug(Logger.CATEGORIES.STORAGE, `IndexedDB'den silindi: ${storeName}/${key}`);
                    resolve();
                };
                
                request.onerror = function() {
                    Logger.error(Logger.CATEGORIES.STORAGE, 'IndexedDB silme hatası', request.error);
                    reject(request.error);
                };
            });
        },
        
        /**
         * Store'u temizle
         */
        clear: function(storeName) {
            return new Promise((resolve, reject) => {
                if (!dbConnection) {
                    reject(new Error('IndexedDB bağlantısı yok'));
                    return;
                }
                
                const transaction = dbConnection.transaction([storeName], 'readwrite');
                const store = transaction.objectStore(storeName);
                const request = store.clear();
                
                request.onsuccess = function() {
                    Logger.info(Logger.CATEGORIES.STORAGE, `IndexedDB store temizlendi: ${storeName}`);
                    resolve();
                };
                
                request.onerror = function() {
                    Logger.error(Logger.CATEGORIES.STORAGE, 'IndexedDB clear hatası', request.error);
                    reject(request.error);
                };
            });
        }
    };

    // Public API
    return {
        // Initialization
        init: init,
        isInitialized: function() { return isInitialized; },
        
        // Storage modules
        local: LocalStorage,
        cache: Cache,
        db: IndexedDB,
        
        // Store constants
        STORES: STORES,
        
        // Utility functions
        generateKey: function(prefix, ...parts) {
            return `${prefix}_${parts.join('_')}`;
        },
        
        // Bulk operations
        backup: function() {
            return ErrorHandler.safeAsync(async function() {
                const backup = {
                    timestamp: Date.now(),
                    localStorage: {},
                    indexedDB: {}
                };
                
                // LocalStorage backup
                const prefix = Config.get('DATA.storage.prefix', 'tradingApp_');
                Object.keys(localStorage).forEach(key => {
                    if (key.startsWith(prefix)) {
                        backup.localStorage[key] = localStorage.getItem(key);
                    }
                });
                
                // IndexedDB backup
                for (const storeName of Object.values(STORES)) {
                    try {
                        backup.indexedDB[storeName] = await IndexedDB.getAll(storeName);
                    } catch (error) {
                        Logger.warning(Logger.CATEGORIES.STORAGE, `Backup hatası: ${storeName}`, error);
                    }
                }
                
                Logger.success(Logger.CATEGORIES.STORAGE, 'Storage backup oluşturuldu');
                return backup;
                
            }, 'Storage Backup')();
        },
        
        restore: function(backupData) {
            return ErrorHandler.safeAsync(async function() {
                if (!backupData || typeof backupData !== 'object') {
                    throw new Error('Geçersiz backup verisi');
                }
                
                // LocalStorage restore
                if (backupData.localStorage) {
                    Object.entries(backupData.localStorage).forEach(([key, value]) => {
                        localStorage.setItem(key, value);
                    });
                }
                
                // IndexedDB restore
                if (backupData.indexedDB) {
                    for (const [storeName, data] of Object.entries(backupData.indexedDB)) {
                        if (Array.isArray(data)) {
                            await IndexedDB.clear(storeName);
                            for (const item of data) {
                                await IndexedDB.set(storeName, item);
                            }
                        }
                    }
                }
                
                Logger.success(Logger.CATEGORIES.STORAGE, 'Storage restore tamamlandı');
                return true;
                
            }, 'Storage Restore')();
        },
        
        // Storage info
        getInfo: function() {
            const info = {
                localStorage: LocalStorage.getSize(),
                cache: Cache.getStats(),
                indexedDB: {
                    connected: !!dbConnection,
                    stores: Object.values(STORES)
                }
            };
            
            return info;
        }
    };

})();

// Auto-initialize
if (window.Config && window.Logger && window.ErrorHandler) {
    if (document.readyState === 'loading') {
        document.addEventListener('DOMContentLoaded', function() {
            Storage.init().catch(error => {
                Logger.error(Logger.CATEGORIES.STORAGE, 'Storage auto-init hatası', error);
            });
        });
    } else {
        Storage.init().catch(error => {
            Logger.error(Logger.CATEGORIES.STORAGE, 'Storage auto-init hatası', error);
        });
    }
} else {
    console.warn('Storage: Gerekli modüller bulunamadı');
}
