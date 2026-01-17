/**
 * ============================================
 * APP LOADER UNIVERSAL - MONOREPO PROTEGIDO
 * ============================================
 * 
 * Protege TODAS as aplicações do monorepo
 * Erro em 1 app NÃO quebra as outras
 */

(function() {
    'use strict';

    console.log('🛡️ App Loader Universal iniciado');

    // Mapeamento de todas as apps
    const APP_SCRIPTS = {
        '/portal': ['/portal/script.js'],
        '/precos': ['/precos/script.js', '/precos/calendar.js'],
        '/cotacoes': ['/cotacoes/script.js', '/cotacoes/calendar.js'],
        '/ordem-compra': ['/ordem-compra/script.js', '/ordem-compra/calendar.js']
    };

    // Identifica app atual
    const currentPath = window.location.pathname;
    let appScripts = null;
    let appName = 'desconhecido';

    for (const [path, scripts] of Object.entries(APP_SCRIPTS)) {
        if (currentPath.startsWith(path) || (path === '/portal' && currentPath === '/')) {
            appScripts = scripts;
            appName = path.replace('/', '') || 'portal';
            break;
        }
    }

    if (!appScripts) {
        console.warn('⚠️ App não mapeado:', currentPath);
        return;
    }

    console.log(`📦 Carregando: ${appName}`);

    // Carrega script isolado
    function loadScript(src) {
        return new Promise((resolve, reject) => {
            const script = document.createElement('script');
            script.src = src;
            script.async = false;
            script.onload = () => {
                console.log(`✅ ${src}`);
                resolve();
            };
            script.onerror = () => {
                console.error(`❌ ${src}`);
                reject(new Error(`Falha: ${src}`));
            };
            document.head.appendChild(script);
        });
    }

    // Carrega todos os scripts da app
    async function loadAllScripts() {
        try {
            for (const script of appScripts) {
                await loadScript(script);
            }
            console.log(`✅ ${appName.toUpperCase()} OK`);
        } catch (error) {
            console.error(`❌ Erro em ${appName}:`, error);
            showErrorScreen(appName, error);
        }
    }

    // Tela de erro
    function showErrorScreen(app, error) {
        const splash = document.getElementById('splashScreen');
        if (splash) splash.remove();

        const errorDiv = document.createElement('div');
        errorDiv.style.cssText = 'position:fixed;top:0;left:0;right:0;bottom:0;background:rgba(0,0,0,0.9);display:flex;align-items:center;justify-content:center;z-index:999999';
        errorDiv.innerHTML = `
            <div style="background:#fff;padding:3rem;border-radius:16px;text-align:center;max-width:500px">
                <div style="font-size:4rem;margin-bottom:1rem">⚠️</div>
                <h2 style="color:#d32f2f;margin-bottom:1rem">Erro ao Carregar</h2>
                <p style="color:#666;margin-bottom:1rem">Módulo: <strong>${app.toUpperCase()}</strong></p>
                <p style="color:#999;font-size:0.9rem;margin-bottom:2rem;background:#f5f5f5;padding:1rem;border-radius:8px;font-family:monospace">${error.message}</p>
                <button onclick="location.reload()" style="background:#1976d2;color:#fff;border:none;padding:1rem 2rem;border-radius:8px;cursor:pointer;margin-right:0.5rem">🔄 Recarregar</button>
                <button onclick="location.href='/'" style="background:#666;color:#fff;border:none;padding:1rem 2rem;border-radius:8px;cursor:pointer">🏠 Portal</button>
                <p style="margin-top:2rem;color:#999;font-size:0.85rem">ℹ️ Os outros módulos continuam funcionando</p>
            </div>
        `;
        document.body.appendChild(errorDiv);
    }

    // Captura erros globais
    window.addEventListener('error', function(e) {
        console.error('❌ Erro:', e.message, e.filename, e.lineno);
        e.preventDefault();
        return true;
    }, true);

    window.addEventListener('unhandledrejection', function(e) {
        console.error('❌ Promise:', e.reason);
        e.preventDefault();
        return true;
    });

    // Inicia carregamento
    loadAllScripts();

    console.log('🛡️ Proteção ativa:', appName);

})();
