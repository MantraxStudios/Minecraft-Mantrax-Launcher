const { ipcRenderer } = require('electron');
const path = require('path');
const fs = require('fs');
const https = require('https');
const http = require('http');
const { spawn } = require('child_process');
const os = require('os');
const { URL } = require('url');
const AdmZip = require('adm-zip');
const crypto = require('crypto');

// ============================================================================
// CONSTANTES Y CONFIGURACIÓN
// ============================================================================

const LAUNCHER_DIR = path.join(os.homedir(), '.mantrax-launcher');
const CONFIG_FILE = path.join(LAUNCHER_DIR, 'config.json');
const PROFILES_FILE = path.join(LAUNCHER_DIR, 'profiles.json');
const MS_AUTH_FILE = path.join(LAUNCHER_DIR, 'ms_auth.json');

// Client ID público de Xbox/Minecraft - Usa redirect URI específico para aplicaciones de escritorio
const MS_CLIENT_ID = '00000000402b5328';
const MS_REDIRECT_URI = 'https://login.live.com/oauth20_desktop.srf'; // Redirect URI para aplicaciones de escritorio
const MS_SCOPES = 'XboxLive.signin offline_access';

// ============================================================================
// VARIABLES GLOBALES
// ============================================================================

let isDownloading = false;
let versionsData = null;
let currentVersion = null;
let currentUsername = '';
let msAuthData = null;
let isPremiumAccount = false;
let autoScrollEnabled = true;

let config = { 
    username: '', 
    version: '', 
    ram: 4, 
    currentProfile: 'default', 
    isPremium: false 
};

let profiles = {
    default: {
        name: 'Default',
        version: '',
        ram: 4
    }
};

let currentProfile = 'default';

// ============================================================================
// ELEMENTOS DEL DOM
// ============================================================================

const elements = {
    loginScreen: document.getElementById('loginScreen'),
    mainScreen: document.getElementById('mainScreen'),
    offlineLoginForm: document.getElementById('offlineLoginForm'),
    microsoftLoginBtn: document.getElementById('microsoftLoginBtn'),
    msAuthLoading: document.getElementById('msAuthLoading'),
    usernameInput: document.getElementById('usernameInput'),
    displayUsername: document.getElementById('displayUsername'),
    accountType: document.getElementById('accountType'),
    userAvatar: document.getElementById('userAvatar'),
    userIcon: document.getElementById('userIcon'),
    launchBtn: document.getElementById('launchBtn'),
    launchIcon: document.getElementById('launchIcon'),
    launchText: document.getElementById('launchText'),
    versionSelect: document.getElementById('versionSelect'),
    ramSlider: document.getElementById('ramSlider'),
    ramValue: document.getElementById('ramValue'),
    logoutBtn: document.getElementById('logoutBtn'),
    downloadProgress: document.getElementById('downloadProgress'),
    progressBar: document.getElementById('progressBar'),
    downloadStatus: document.getElementById('downloadStatus'),
    downloadPercent: document.getElementById('downloadPercent'),
    downloadDetails: document.getElementById('downloadDetails'),
    consoleLog: document.getElementById('consoleLog'),
    consoleSidebar: document.getElementById('consoleSidebar'),
    toggleConsoleBtn: document.getElementById('toggleConsoleBtn'),
    closeConsoleBtn: document.getElementById('closeConsoleBtn'),
    clearConsoleBtn: document.getElementById('clearConsoleBtn'),
    mainContent: document.getElementById('mainContent'),
    serverStatusDot: document.getElementById('serverStatusDot'),
    serverStatusText: document.getElementById('serverStatusText'),
    pingText: document.getElementById('pingText'),
    onlinePlayers: document.getElementById('onlinePlayers'),
    minimizeBtn: document.getElementById('minimizeBtn'),
    maximizeBtn: document.getElementById('maximizeBtn'),
    closeBtn: document.getElementById('closeBtn'),
    openMinecraftFolder: document.getElementById('openMinecraftFolder'),
    manageProfilesBtn: document.getElementById('manageProfilesBtn'),
    profilesModal: document.getElementById('profilesModal'),
    closeProfilesModal: document.getElementById('closeProfilesModal'),
    profilesModalBg: document.getElementById('profilesModalBg'),
    createProfileBtn: document.getElementById('createProfileBtn'),
    profilesList: document.getElementById('profilesList'),
    createProfileModal: document.getElementById('createProfileModal'),
    createProfileModalBg: document.getElementById('createProfileModalBg'),
    createProfileForm: document.getElementById('createProfileForm'),
    profileNameInput: document.getElementById('profileNameInput'),
    profileVersionSelect: document.getElementById('profileVersionSelect'),
    profileRamSlider: document.getElementById('profileRamSlider'),
    profileRamValue: document.getElementById('profileRamValue'),
    cancelCreateProfile: document.getElementById('cancelCreateProfile'),
    currentProfileName: document.getElementById('currentProfileName'),
    profileVersion: document.getElementById('profileVersion'),
    switchProfileBtn: document.getElementById('switchProfileBtn'),
    downloadModsBtn: document.getElementById('downloadModsBtn'),
    settingsBtn: document.getElementById('settingsBtn')
};

// ============================================================================
// UTILIDADES - CONSOLA Y FORMATO
// ============================================================================

function logConsole(message, type = 'info') {
    const timestamp = new Date().toLocaleTimeString();
    const logEntry = document.createElement('div');
    logEntry.className = `console-entry ${type}`;
    
    let icon = '';
    switch(type) {
        case 'success': icon = '[OK]'; break;
        case 'error': icon = '[ERR]'; break;
        case 'warning': icon = '[WARN]'; break;
        default: icon = '[INFO]';
    }
    
    logEntry.textContent = `[${timestamp}] ${icon} ${message}`;
    elements.consoleLog.appendChild(logEntry);
    
    if (autoScrollEnabled) {
        requestAnimationFrame(() => {
            elements.consoleLog.scrollTop = elements.consoleLog.scrollHeight;
        });
    }
    
    console.log(`[${type.toUpperCase()}]`, message);
}

function formatBytes(bytes) {
    if (bytes === 0) return '0 B';
    const k = 1024;
    const sizes = ['B', 'KB', 'MB', 'GB'];
    const i = Math.floor(Math.log(bytes) / Math.log(k));
    return parseFloat((bytes / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function formatSpeed(bytesPerSecond) {
    if (bytesPerSecond === 0) return '0 B/s';
    const k = 1024;
    const sizes = ['B/s', 'KB/s', 'MB/s', 'GB/s'];
    const i = Math.floor(Math.log(bytesPerSecond) / Math.log(k));
    return parseFloat((bytesPerSecond / Math.pow(k, i)).toFixed(2)) + ' ' + sizes[i];
}

function updateProgress(percent, status, details, downloaded = 0, total = 0, speed = 0) {
    elements.progressBar.style.width = `${percent}%`;
    elements.downloadPercent.textContent = `${Math.round(percent)}%`;
    elements.downloadStatus.textContent = status;
    
    if (total > 0) {
        const speedText = speed > 0 ? ` - ${formatSpeed(speed)}` : '';
        elements.downloadDetails.textContent = `${formatBytes(downloaded)} / ${formatBytes(total)}${speedText}`;
    } else {
        elements.downloadDetails.textContent = details;
    }
}

function generateOfflineUUID(username) {
    const hash = crypto.createHash('md5').update('OfflinePlayer:' + username).digest();
    hash[6] = (hash[6] & 0x0f) | 0x30;
    hash[8] = (hash[8] & 0x3f) | 0x80;
    const hex = hash.toString('hex');
    return `${hex.substr(0, 8)}-${hex.substr(8, 4)}-${hex.substr(12, 4)}-${hex.substr(16, 4)}-${hex.substr(20, 12)}`;
}

function getJavaPath() {
    const javaHome = process.env.JAVA_HOME;
    if (javaHome) {
        return path.join(javaHome, 'bin', 'java');
    }
    return 'java';
}

// ============================================================================
// GESTIÓN DE CONFIGURACIÓN Y PERFILES
// ============================================================================

function loadConfig() {
    try {
        if (!fs.existsSync(LAUNCHER_DIR)) {
            fs.mkdirSync(LAUNCHER_DIR, { recursive: true });
            logConsole('Directorio del launcher creado', 'success');
        }
        
        if (fs.existsSync(CONFIG_FILE)) {
            const data = fs.readFileSync(CONFIG_FILE, 'utf8');
            config = JSON.parse(data);
            
            if (config.username) elements.usernameInput.value = config.username;
            if (config.currentProfile) currentProfile = config.currentProfile;
            
            logConsole('Configuración cargada', 'success');
        }
        
        loadProfiles();
        
        if (loadMSAuthData()) {
            isPremiumAccount = true;
            currentUsername = msAuthData.username;
            
            elements.displayUsername.textContent = msAuthData.username;
            elements.accountType.textContent = 'Premium';
            elements.accountType.className = 'account-type premium';
            
            elements.loginScreen.classList.add('hidden');
            elements.mainScreen.classList.add('show');
            loadVersions();
        }
        
    } catch (error) {
        logConsole('Error cargando configuración: ' + error.message, 'error');
    }
}

function saveConfig() {
    try {
        if (!fs.existsSync(LAUNCHER_DIR)) {
            fs.mkdirSync(LAUNCHER_DIR, { recursive: true });
        }
        
        config.username = currentUsername;
        config.currentProfile = currentProfile;
        config.isPremium = isPremiumAccount;
        
        profiles[currentProfile].version = currentVersion;
        profiles[currentProfile].ram = parseInt(elements.ramSlider.value);
        
        fs.writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2));
        saveProfiles();
    } catch (error) {
        logConsole('Error guardando configuración: ' + error.message, 'error');
    }
}

function loadProfiles() {
    try {
        if (fs.existsSync(PROFILES_FILE)) {
            const data = fs.readFileSync(PROFILES_FILE, 'utf8');
            profiles = JSON.parse(data);
            logConsole('Perfiles cargados', 'success');
        } else {
            saveProfiles();
        }
        
        loadCurrentProfile();
    } catch (error) {
        logConsole('Error cargando perfiles: ' + error.message, 'error');
        profiles = {
            default: {
                name: 'Default',
                version: '',
                ram: 4
            }
        };
        saveProfiles();
    }
}

function saveProfiles() {
    try {
        if (!fs.existsSync(LAUNCHER_DIR)) {
            fs.mkdirSync(LAUNCHER_DIR, { recursive: true });
        }
        fs.writeFileSync(PROFILES_FILE, JSON.stringify(profiles, null, 2));
        logConsole('Perfiles guardados', 'success');
    } catch (error) {
        logConsole('Error guardando perfiles: ' + error.message, 'error');
    }
}

function loadCurrentProfile() {
    if (!profiles[currentProfile]) {
        currentProfile = 'default';
        logConsole('Perfil no encontrado, cambiado a default', 'warning');
    }
    
    const profile = profiles[currentProfile];
    elements.currentProfileName.textContent = profile.name;
    elements.ramSlider.value = profile.ram;
    elements.ramValue.textContent = profile.ram;
    
    if (profile.version && versionsData) {
        const versionExists = versionsData.versions.find(v => v.id === profile.version);
        if (versionExists) {
            elements.versionSelect.value = profile.version;
            currentVersion = profile.version;
            elements.profileVersion.textContent = profile.version;
        } else {
            elements.profileVersion.textContent = '---';
        }
    } else {
        elements.profileVersion.textContent = '---';
    }
    
    updateLaunchButton();
}

// ============================================================================
// AUTENTICACIÓN MICROSOFT - AUTOMÁTICA
// ============================================================================

function saveMSAuthData() {
    try {
        if (!fs.existsSync(LAUNCHER_DIR)) {
            fs.mkdirSync(LAUNCHER_DIR, { recursive: true });
        }
        fs.writeFileSync(MS_AUTH_FILE, JSON.stringify(msAuthData, null, 2));
        logConsole('Datos de autenticación guardados', 'success');
    } catch (error) {
        logConsole('Error guardando autenticación: ' + error.message, 'error');
    }
}

function loadMSAuthData() {
    try {
        if (fs.existsSync(MS_AUTH_FILE)) {
            const data = fs.readFileSync(MS_AUTH_FILE, 'utf8');
            msAuthData = JSON.parse(data);
            
            // Verificar si el token ha expirado
            if (msAuthData.expiresAt && Date.now() > msAuthData.expiresAt) {
                logConsole('Token expirado, requiere reautenticación', 'warning');
                return false;
            }
            
            logConsole('Datos de autenticación cargados', 'success');
            return true;
        }
    } catch (error) {
        logConsole('Error cargando autenticación: ' + error.message, 'error');
    }
    return false;
}

function startLocalAuthServer() {
    return new Promise((resolve, reject) => {
        const server = http.createServer((req, res) => {
            const url = new URL(req.url, `http://localhost:28472`);
            
            if (url.pathname === '/auth') {
                const code = url.searchParams.get('code');
                const error = url.searchParams.get('error');
                
                if (error) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="utf-8">
                            <title>Error - Mantrax Launcher</title>
                            <style>
                                body { 
                                    background: #1a1a2e; 
                                    color: #fff; 
                                    font-family: Arial, sans-serif; 
                                    display: flex; 
                                    align-items: center; 
                                    justify-content: center; 
                                    height: 100vh; 
                                    margin: 0;
                                }
                                .container {
                                    text-align: center;
                                    background: #16213e;
                                    padding: 40px;
                                    border-radius: 16px;
                                    border: 2px solid #ef4444;
                                }
                                h1 { color: #ef4444; margin-bottom: 20px; }
                                p { color: #9ca3af; margin-bottom: 30px; }
                            </style>
                            <script>
                                setTimeout(() => window.close(), 3000);
                            </script>
                        </head>
                        <body>
                            <div class="container">
                                <h1>❌ Error de Autenticación</h1>
                                <p>Hubo un error al iniciar sesión con Microsoft.</p>
                                <p style="color: #ef4444; font-size: 14px;">Error: ${error}</p>
                            </div>
                        </body>
                        </html>
                    `);
                    
                    server.close();
                    reject(new Error(`Error de Microsoft: ${error}`));
                    return;
                }
                
                if (code) {
                    res.writeHead(200, { 'Content-Type': 'text/html; charset=utf-8' });
                    res.end(`
                        <!DOCTYPE html>
                        <html>
                        <head>
                            <meta charset="utf-8">
                            <title>Éxito - Mantrax Launcher</title>
                            <style>
                                body { 
                                    background: #1a1a2e; 
                                    color: #fff; 
                                    font-family: Arial, sans-serif; 
                                    display: flex; 
                                    align-items: center; 
                                    justify-content: center; 
                                    height: 100vh; 
                                    margin: 0;
                                }
                                .container {
                                    text-align: center;
                                    background: #16213e;
                                    padding: 40px;
                                    border-radius: 16px;
                                    border: 2px solid #10b981;
                                }
                                h1 { color: #10b981; margin-bottom: 20px; }
                                p { color: #9ca3af; margin-bottom: 30px; }
                                .spinner {
                                    border: 4px solid #374151;
                                    border-top: 4px solid #10b981;
                                    border-radius: 50%;
                                    width: 50px;
                                    height: 50px;
                                    animation: spin 1s linear infinite;
                                    margin: 20px auto;
                                }
                                @keyframes spin {
                                    0% { transform: rotate(0deg); }
                                    100% { transform: rotate(360deg); }
                                }
                            </style>
                            <script>
                                setTimeout(() => window.close(), 3000);
                            </script>
                        </head>
                        <body>
                            <div class="container">
                                <h1>✅ Autenticación Exitosa</h1>
                                <p>Iniciando sesión en Mantrax Launcher...</p>
                                <div class="spinner"></div>
                                <p style="font-size: 12px; color: #6b7280;">Esta ventana se cerrará automáticamente</p>
                            </div>
                        </body>
                        </html>
                    `);
                    
                    server.close();
                    resolve(code);
                    return;
                }
            }
            
            res.writeHead(404);
            res.end('Not Found');
        });
        
        server.listen(28472, () => {
            logConsole('Servidor de autenticación iniciado en http://localhost:28472', 'success');
            
            const authUrl = `https://login.live.com/oauth20_authorize.srf?client_id=${MS_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(MS_REDIRECT_URI)}&scope=${encodeURIComponent(MS_SCOPES)}&prompt=select_account`;
            
            const { shell } = require('electron');
            shell.openExternal(authUrl);
            
            logConsole('Navegador abierto para autenticación', 'success');
            logConsole('Esperando autorización...', 'warning');
        });
        
        server.on('error', (err) => {
            logConsole('Error en servidor de autenticación: ' + err.message, 'error');
            reject(err);
        });
        
        setTimeout(() => {
            server.close();
            reject(new Error('Timeout: No se recibió respuesta en 5 minutos'));
        }, 300000);
    });
}

async function getMicrosoftTokens(authCode) {
    const response = await fetch('https://login.live.com/oauth20_token.srf', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/x-www-form-urlencoded',
        },
        body: new URLSearchParams({
            client_id: MS_CLIENT_ID,
            code: authCode,
            grant_type: 'authorization_code',
            redirect_uri: MS_REDIRECT_URI,
            scope: MS_SCOPES
        })
    });
    
    if (!response.ok) {
        throw new Error('Error obteniendo tokens de Microsoft');
    }
    
    return await response.json();
}

async function authenticateWithXboxLive(msAccessToken) {
    const response = await fetch('https://user.auth.xboxlive.com/user/authenticate', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            Properties: {
                AuthMethod: 'RPS',
                SiteName: 'user.auth.xboxlive.com',
                RpsTicket: `d=${msAccessToken}`
            },
            RelyingParty: 'http://auth.xboxlive.com',
            TokenType: 'JWT'
        })
    });
    
    if (!response.ok) {
        throw new Error('Error autenticando con Xbox Live');
    }
    
    const data = await response.json();
    return data.Token;
}

async function getXSTSToken(xboxToken) {
    const response = await fetch('https://xsts.auth.xboxlive.com/xsts/authorize', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            Properties: {
                SandboxId: 'RETAIL',
                UserTokens: [xboxToken]
            },
            RelyingParty: 'rp://api.minecraftservices.com/',
            TokenType: 'JWT'
        })
    });
    
    if (!response.ok) {
        const error = await response.json();
        if (error.XErr === 2148916233) {
            throw new Error('Esta cuenta no tiene Minecraft. Debes comprarlo en minecraft.net');
        }
        throw new Error('Error obteniendo token XSTS');
    }
    
    const data = await response.json();
    return {
        token: data.Token,
        userHash: data.DisplayClaims.xui[0].uhs
    };
}

async function authenticateWithMinecraft(userHash, xstsToken) {
    const response = await fetch('https://api.minecraftservices.com/authentication/login_with_xbox', {
        method: 'POST',
        headers: {
            'Content-Type': 'application/json',
            'Accept': 'application/json'
        },
        body: JSON.stringify({
            identityToken: `XBL3.0 x=${userHash};${xstsToken}`
        })
    });
    
    if (!response.ok) {
        throw new Error('Error autenticando con Minecraft');
    }
    
    const data = await response.json();
    return data.access_token;
}

async function getMinecraftProfile(mcAccessToken) {
    const response = await fetch('https://api.minecraftservices.com/minecraft/profile', {
        headers: {
            'Authorization': `Bearer ${mcAccessToken}`
        }
    });
    
    if (!response.ok) {
        throw new Error('Error obteniendo perfil de Minecraft');
    }
    
    return await response.json();
}

async function authenticateWithMicrosoft() {
    try {
        logConsole('Iniciando autenticación con Microsoft...', 'info');
        elements.msAuthLoading.classList.add('show');
        
        // Limpiar input si existe
        const callbackInput = document.getElementById('callbackUrlInput');
        if (callbackInput) {
            callbackInput.value = '';
        }
        
        // Abrir navegador con URL de autenticación
        const authUrl = `https://login.live.com/oauth20_authorize.srf?client_id=${MS_CLIENT_ID}&response_type=code&redirect_uri=${encodeURIComponent(MS_REDIRECT_URI)}&scope=${encodeURIComponent(MS_SCOPES)}&prompt=select_account`;
        
        const { shell } = require('electron');
        shell.openExternal(authUrl);
        
        logConsole('Navegador abierto. Completa el login y copia la URL completa del callback.', 'info');
        
        // Esperar a que el usuario pegue la URL - esto se maneja en el HTML
        return;
        
    } catch (error) {
        logConsole('Error en autenticación: ' + error.message, 'error');
        elements.msAuthLoading.classList.remove('show');
        alert('Error al autenticar con Microsoft:\n\n' + error.message);
    }
}

async function processCallbackUrl() {
    try {
        const callbackUrl = document.getElementById('callbackUrlInput').value.trim();
        
        if (!callbackUrl) {
            alert('Por favor, pega la URL completa');
            return;
        }
        
        logConsole('Procesando URL de callback...', 'info');
        
        const url = new URL(callbackUrl);
        const code = url.searchParams.get('code');
        const error = url.searchParams.get('error');
        
        if (error) {
            throw new Error(`Error de Microsoft: ${error}`);
        }
        
        if (!code) {
            throw new Error('No se encontró el código de autorización en la URL. Asegúrate de copiar la URL completa.');
        }
        
        logConsole('Código de autorización extraído', 'success');
        
        elements.msAuthLoading.classList.remove('show');
        
        // Continuar con el proceso de autenticación
        await continueMicrosoftAuth(code);
        
    } catch (error) {
        alert('Error procesando la URL: ' + error.message + '\n\nAsegúrate de copiar la URL completa de la barra de direcciones del navegador.');
        logConsole('Error: ' + error.message, 'error');
    }
}

async function continueMicrosoftAuth(authCode) {
    try {
        logConsole('Obteniendo tokens de Microsoft...', 'info');
        const msTokens = await getMicrosoftTokens(authCode);
        
        logConsole('Autenticando con Xbox Live...', 'info');
        const xboxToken = await authenticateWithXboxLive(msTokens.access_token);
        
        logConsole('Obteniendo token XSTS...', 'info');
        const xstsData = await getXSTSToken(xboxToken);
        
        logConsole('Autenticando con Minecraft...', 'info');
        const mcToken = await authenticateWithMinecraft(xstsData.userHash, xstsData.token);
        
        logConsole('Obteniendo perfil de Minecraft...', 'info');
        const mcProfile = await getMinecraftProfile(mcToken);
        
        msAuthData = {
            accessToken: mcToken,
            refreshToken: null, // Device code flow no proporciona refresh_token
            username: mcProfile.name,
            uuid: mcProfile.id,
            expiresAt: Date.now() + (3600 * 1000), // 1 hora por defecto
            isPremium: true
        };
        
        logConsole('Autenticación exitosa!', 'success');
        logConsole(`Usuario: ${msAuthData.username}`, 'info');
        logConsole(`UUID: ${msAuthData.uuid}`, 'info');
        
        saveMSAuthData();
        
        currentUsername = msAuthData.username;
        isPremiumAccount = true;
        
        elements.displayUsername.textContent = msAuthData.username;
        elements.accountType.textContent = 'Premium';
        elements.accountType.className = 'account-type premium';
        
        elements.msAuthLoading.classList.remove('show');
        elements.loginScreen.classList.add('hidden');
        elements.mainScreen.classList.add('show');
        
        config.isPremium = true;
        config.username = msAuthData.username;
        saveConfig();
        
        loadVersions();
        
    } catch (error) {
        logConsole('Error en autenticación: ' + error.message, 'error');
        elements.msAuthLoading.classList.remove('show');
        alert('Error al autenticar con Microsoft:\n\n' + error.message);
    }
}

// ============================================================================
// GESTIÓN DE VERSIONES
// ============================================================================

function getInstalledVersions() {
    const minecraftDir = path.join(os.homedir(), '.minecraft');
    const versionsDir = path.join(minecraftDir, 'versions');
    
    if (!fs.existsSync(versionsDir)) {
        logConsole('Directorio de versiones no existe', 'warning');
        return [];
    }
    
    const installedVersions = [];
    
    try {
        const folders = fs.readdirSync(versionsDir, { withFileTypes: true });
        
        logConsole(`Escaneando ${folders.length} carpetas en versions/`, 'info');
        
        folders.forEach(folder => {
            if (!folder.isDirectory()) return;
            
            const versionPath = path.join(versionsDir, folder.name);
            
            let files;
            try {
                files = fs.readdirSync(versionPath);
            } catch (err) {
                logConsole(`❌ Error leyendo carpeta ${folder.name}: ${err.message}`, 'error');
                return;
            }
            
            const jarFiles = files.filter(f => f.endsWith('.jar'));
            const jsonFiles = files.filter(f => f.endsWith('.json'));
            
            if (jsonFiles.length === 0) {
                logConsole(`⚠️ ${folder.name}: No se encontró archivo .json`, 'warning');
                return;
            }
            
            const jsonFile = jsonFiles[0];
            const jsonPath = path.join(versionPath, jsonFile);
            
            try {
                const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
                
                const versionId = jsonData.id || folder.name;
                const versionType = jsonData.type || 'custom';
                const releaseTime = jsonData.releaseTime || jsonData.time || new Date().toISOString();
                
                const inheritsFrom = jsonData.inheritsFrom;
                const isModded = !!inheritsFrom;
                
                let jarFile = null;
                if (jarFiles.length > 0) {
                    jarFile = jarFiles[0];
                } else if (isModded) {
                    logConsole(`📦 ${folder.name}: Versión modded (hereda de ${inheritsFrom})`, 'info');
                } else {
                    logConsole(`⚠️ ${folder.name}: Falta JAR (no es versión modded)`, 'warning');
                    return;
                }
                
                installedVersions.push({
                    id: folder.name,
                    displayName: versionId,
                    type: versionType,
                    releaseTime: releaseTime,
                    isCustom: isModded || versionType === 'custom' || versionType === 'modified',
                    isModded: isModded,
                    inheritsFrom: inheritsFrom,
                    jarFile: jarFile,
                    jsonFile: jsonFile,
                    versionData: jsonData
                });
                
                logConsole(`✓ Versión cargada: ${folder.name}${isModded ? ' (MODDED)' : ''}`, 'success');
                
            } catch (err) {
                logConsole(`❌ Error leyendo JSON de ${folder.name}: ${err.message}`, 'error');
            }
        });
        
        installedVersions.sort((a, b) => {
            if (a.isCustom && !b.isCustom) return -1;
            if (!a.isCustom && b.isCustom) return 1;
            return new Date(b.releaseTime) - new Date(a.releaseTime);
        });
        
        logConsole(`✅ Total de versiones instaladas: ${installedVersions.length}`, 'success');
        
    } catch (error) {
        logConsole('❌ Error obteniendo versiones instaladas: ' + error.message, 'error');
    }
    
    return installedVersions;
}

async function loadVersions() {
    try {
        logConsole('Cargando versiones de Minecraft...', 'info');
        
        const installedVersions = getInstalledVersions();
        logConsole(`${installedVersions.length} versiones instaladas encontradas`, 'info');
        
        elements.versionSelect.innerHTML = '';
        elements.profileVersionSelect.innerHTML = '';
        
        if (installedVersions.length > 0) {
            const moddedVersions = installedVersions.filter(v => v.isModded);
            const customVersions = installedVersions.filter(v => v.isCustom && !v.isModded);
            const officialVersions = installedVersions.filter(v => !v.isCustom);
            
            if (moddedVersions.length > 0) {
                const moddedGroup1 = document.createElement('optgroup');
                moddedGroup1.label = '🔧 VERSIONES MODDED (Fabric/Forge)';
                
                const moddedGroup2 = document.createElement('optgroup');
                moddedGroup2.label = '🔧 VERSIONES MODDED (Fabric/Forge)';
                
                moddedVersions.forEach(version => {
                    const displayText = `${version.id} → ${version.inheritsFrom}`;
                    
                    const option1 = document.createElement('option');
                    option1.value = version.id;
                    option1.textContent = displayText;
                    option1.style.color = '#a78bfa';
                    option1.style.fontWeight = 'bold';
                    moddedGroup1.appendChild(option1);
                    
                    const option2 = document.createElement('option');
                    option2.value = version.id;
                    option2.textContent = displayText;
                    option2.style.color = '#a78bfa';
                    option2.style.fontWeight = 'bold';
                    moddedGroup2.appendChild(option2);
                });
                
                elements.versionSelect.appendChild(moddedGroup1);
                elements.profileVersionSelect.appendChild(moddedGroup2);
            }
            
            if (customVersions.length > 0) {
                const customGroup1 = document.createElement('optgroup');
                customGroup1.label = '⚡ VERSIONES CUSTOM';
                
                const customGroup2 = document.createElement('optgroup');
                customGroup2.label = '⚡ VERSIONES CUSTOM';
                
                customVersions.forEach(version => {
                    const displayText = version.displayName !== version.id ? 
                        `${version.id} (${version.displayName})` : version.id;
                    
                    const option1 = document.createElement('option');
                    option1.value = version.id;
                    option1.textContent = displayText;
                    option1.style.color = '#f59e0b';
                    option1.style.fontWeight = 'bold';
                    customGroup1.appendChild(option1);
                    
                    const option2 = document.createElement('option');
                    option2.value = version.id;
                    option2.textContent = displayText;
                    option2.style.color = '#f59e0b';
                    option2.style.fontWeight = 'bold';
                    customGroup2.appendChild(option2);
                });
                
                elements.versionSelect.appendChild(customGroup1);
                elements.profileVersionSelect.appendChild(customGroup2);
            }
            
            if (officialVersions.length > 0) {
                const installedGroup1 = document.createElement('optgroup');
                installedGroup1.label = '✓ INSTALADAS (VANILLA)';
                
                const installedGroup2 = document.createElement('optgroup');
                installedGroup2.label = '✓ INSTALADAS (VANILLA)';
                
                officialVersions.forEach(version => {
                    const option1 = document.createElement('option');
                    option1.value = version.id;
                    option1.textContent = version.displayName || version.id;
                    option1.style.color = '#10b981';
                    option1.style.fontWeight = 'bold';
                    installedGroup1.appendChild(option1);
                    
                    const option2 = document.createElement('option');
                    option2.value = version.id;
                    option2.textContent = version.displayName || version.id;
                    option2.style.color = '#10b981';
                    option2.style.fontWeight = 'bold';
                    installedGroup2.appendChild(option2);
                });
                
                elements.versionSelect.appendChild(installedGroup1);
                elements.profileVersionSelect.appendChild(installedGroup2);
            }
        }
        
        try {
            const response = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
            versionsData = await response.json();
            
            if (installedVersions.length > 0) {
                const separator1 = document.createElement('option');
                separator1.disabled = true;
                separator1.textContent = '──────────────────';
                elements.versionSelect.appendChild(separator1);
                
                const separator2 = document.createElement('option');
                separator2.disabled = true;
                separator2.textContent = '──────────────────';
                elements.profileVersionSelect.appendChild(separator2);
            }
            
            const availableGroup1 = document.createElement('optgroup');
            availableGroup1.label = '📥 DISPONIBLES PARA DESCARGAR';
            
            const availableGroup2 = document.createElement('optgroup');
            availableGroup2.label = '📥 DISPONIBLES PARA DESCARGAR';
            
            const releases = versionsData.versions.filter(v => v.type === 'release').slice(0, 30);
            
            releases.forEach(version => {
                const isInstalled = installedVersions.some(iv => iv.id === version.id || iv.displayName === version.id);
                
                if (!isInstalled) {
                    const option1 = document.createElement('option');
                    option1.value = version.id;
                    option1.textContent = version.id;
                    if (version.id === versionsData.latest.release) {
                        option1.textContent += ' (Latest)';
                    }
                    availableGroup1.appendChild(option1);
                    
                    const option2 = document.createElement('option');
                    option2.value = version.id;
                    option2.textContent = version.id;
                    if (version.id === versionsData.latest.release) {
                        option2.textContent += ' (Latest)';
                    }
                    availableGroup2.appendChild(option2);
                }
            });
            
            if (availableGroup1.children.length > 0) {
                elements.versionSelect.appendChild(availableGroup1);
                elements.profileVersionSelect.appendChild(availableGroup2);
            }
            
            logConsole(`${releases.length} versiones disponibles cargadas`, 'success');
        } catch (fetchError) {
            logConsole('⚠️ Error obteniendo versiones de Mojang: ' + fetchError.message, 'warning');
        }
        
        const profile = profiles[currentProfile];
        if (profile.version) {
            const versionExists = installedVersions.some(v => v.id === profile.version) || 
                                 (versionsData && versionsData.versions.some(v => v.id === profile.version));
            
            if (versionExists) {
                elements.versionSelect.value = profile.version;
                currentVersion = profile.version;
                elements.profileVersion.textContent = profile.version;
            } else {
                if (installedVersions.length > 0) {
                    currentVersion = installedVersions[0].id;
                } else if (versionsData) {
                    currentVersion = versionsData.latest.release;
                } else {
                    currentVersion = '';
                }
                if (currentVersion) {
                    elements.versionSelect.value = currentVersion;
                    elements.profileVersion.textContent = currentVersion;
                }
            }
        } else {
            if (installedVersions.length > 0) {
                currentVersion = installedVersions[0].id;
            } else if (versionsData) {
                currentVersion = versionsData.latest.release;
            } else {
                currentVersion = '';
            }
            if (currentVersion) {
                elements.versionSelect.value = currentVersion;
                elements.profileVersion.textContent = currentVersion;
            }
        }
        
        updateLaunchButton();
        
    } catch (error) {
        logConsole('❌ Error cargando versiones: ' + error.message, 'error');
    }
}

function isVersionInstalled(versionId) {
    if (!versionId) return false;
    
    const minecraftDir = path.join(os.homedir(), '.minecraft');
    const versionDir = path.join(minecraftDir, 'versions', versionId);
    
    if (!fs.existsSync(versionDir)) return false;
    
    try {
        const files = fs.readdirSync(versionDir);
        const hasJson = files.some(f => f.endsWith('.json'));
        return hasJson;
    } catch (err) {
        return false;
    }
}

function getVersionFiles(versionId) {
    const minecraftDir = path.join(os.homedir(), '.minecraft');
    const versionDir = path.join(minecraftDir, 'versions', versionId);
    
    if (!fs.existsSync(versionDir)) {
        return null;
    }
    
    try {
        const files = fs.readdirSync(versionDir);
        const jarFiles = files.filter(f => f.endsWith('.jar'));
        const jsonFiles = files.filter(f => f.endsWith('.json'));
        
        if (jsonFiles.length === 0) {
            return null;
        }
        
        const jsonFile = jsonFiles[0];
        const jsonPath = path.join(versionDir, jsonFile);
        
        const jsonData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
        const inheritsFrom = jsonData.inheritsFrom;
        
        let jarFile = null;
        let jarPath = null;
        
        if (jarFiles.length > 0) {
            jarFile = jarFiles[0];
            jarPath = path.join(versionDir, jarFile);
        } else if (inheritsFrom) {
            const inheritedVersionDir = path.join(minecraftDir, 'versions', inheritsFrom);
            const inheritedJarPath = path.join(inheritedVersionDir, `${inheritsFrom}.jar`);
            
            if (fs.existsSync(inheritedJarPath)) {
                jarFile = `${inheritsFrom}.jar`;
                jarPath = inheritedJarPath;
                logConsole(`Usando JAR heredado: ${jarFile}`, 'info');
            } else {
                logConsole(`⚠️ No se encontró JAR heredado: ${inheritsFrom}`, 'warning');
                return null;
            }
        } else {
            logConsole(`⚠️ No se encontró JAR y no hereda de ninguna versión`, 'warning');
            return null;
        }
        
        return {
            jarFile: jarFile,
            jsonFile: jsonFile,
            jarPath: jarPath,
            jsonPath: jsonPath,
            inheritsFrom: inheritsFrom,
            versionData: jsonData
        };
    } catch (err) {
        logConsole(`Error obteniendo archivos de ${versionId}: ${err.message}`, 'error');
        return null;
    }
}

function updateLaunchButton() {
    if (!currentVersion) {
        elements.launchText.textContent = 'SELECCIONA VERSION';
        elements.launchIcon.className = 'fas fa-exclamation-triangle';
        return;
    }
    
    const isInstalled = isVersionInstalled(currentVersion);
    
    if (!isInstalled) {
        elements.launchText.textContent = 'DESCARGAR Y JUGAR';
        elements.launchIcon.className = 'fas fa-download';
        return;
    }
    
    try {
        const minecraftDir = path.join(os.homedir(), '.minecraft');
        const versionDir = path.join(minecraftDir, 'versions', currentVersion);
        const files = fs.readdirSync(versionDir);
        const jsonFile = files.find(f => f.endsWith('.json'));
        
        if (jsonFile) {
            const versionData = JSON.parse(fs.readFileSync(path.join(versionDir, jsonFile), 'utf8'));
            
            if (versionData.inheritsFrom) {
                const baseInstalled = isVersionInstalled(versionData.inheritsFrom);
                
                if (!baseInstalled) {
                    elements.launchText.textContent = 'PREPARAR Y JUGAR';
                    elements.launchIcon.className = 'fas fa-download';
                    return;
                }
            }
        }
    } catch (err) {
        // Si hay error, asumir que está listo
    }
    
    elements.launchText.textContent = 'JUGAR AHORA';
    elements.launchIcon.className = 'fas fa-play';
}

// ============================================================================
// DESCARGA Y LANZAMIENTO
// ============================================================================

async function downloadFileBetter(dest, url, progressCallback) {
    return new Promise((resolve, reject) => {
        const parsedUrl = new URL(url);
        const protocol = parsedUrl.protocol === 'https:' ? https : http;
        
        logConsole(`Iniciando descarga: ${url}`, 'info');
        
        const file = fs.createWriteStream(dest);
        let startTime = Date.now();
        let lastTime = startTime;
        let lastLoaded = 0;
        let timeoutId;
        
        const resetTimeout = () => {
            if (timeoutId) clearTimeout(timeoutId);
            timeoutId = setTimeout(() => {
                logConsole('Timeout: descarga demorada más de 60s', 'error');
                file.close();
                reject(new Error('Timeout: La descarga tardó demasiado'));
            }, 60000);
        };
        
        resetTimeout();
        
        const request = protocol.get(url, {
            headers: {
                'User-Agent': 'MantraxLauncher/1.0'
            },
            timeout: 30000
        }, (response) => {
            if (response.statusCode === 301 || response.statusCode === 302) {
                if (timeoutId) clearTimeout(timeoutId);
                file.close();
                fs.unlinkSync(dest);
                logConsole(`Redirigiendo a: ${response.headers.location}`, 'info');
                return downloadFileBetter(dest, response.headers.location, progressCallback)
                    .then(resolve)
                    .catch(reject);
            }
            
            if (response.statusCode !== 200) {
                if (timeoutId) clearTimeout(timeoutId);
                file.close();
                fs.unlinkSync(dest);
                reject(new Error(`Error HTTP: ${response.statusCode}`));
                return;
            }
            
            const total = parseInt(response.headers['content-length'], 10);
            let loaded = 0;
            
            logConsole(`Tamaño del archivo: ${formatBytes(total)}`, 'info');
            
            response.on('data', (chunk) => {
                resetTimeout();
                loaded += chunk.length;
                
                if (progressCallback && total) {
                    const currentTime = Date.now();
                    const timeDiff = (currentTime - lastTime) / 1000;
                    
                    if (timeDiff >= 0.5) {
                        const bytesDownloaded = loaded - lastLoaded;
                        const speed = bytesDownloaded / timeDiff;
                        
                        progressCallback({
                            percent: (loaded / total) * 100,
                            loaded: loaded,
                            total: total,
                            speed: speed
                        });
                        
                        lastTime = currentTime;
                        lastLoaded = loaded;
                    }
                }
            });
            
            response.pipe(file);
            
            file.on('finish', () => {
                if (timeoutId) clearTimeout(timeoutId);
                file.close();
                logConsole(`Descarga completada: ${path.basename(dest)}`, 'success');
                resolve();
            });
            
            file.on('error', (err) => {
                if (timeoutId) clearTimeout(timeoutId);
                fs.unlink(dest, () => {});
                logConsole(`Error escribiendo archivo: ${err.message}`, 'error');
                reject(err);
            });
        });
        
        request.on('error', (err) => {
            if (timeoutId) clearTimeout(timeoutId);
            fs.unlink(dest, () => {});
            logConsole(`Error en la petición: ${err.message}`, 'error');
            reject(err);
        });
        
        request.on('timeout', () => {
            if (timeoutId) clearTimeout(timeoutId);
            request.destroy();
            fs.unlink(dest, () => {});
            logConsole('Timeout: petición tardó más de 30s', 'error');
            reject(new Error('Timeout en la petición HTTP'));
        });
    });
}

function shouldDownloadLibrary(lib) {
    if (!lib.rules) return true;
    
    const osName = os.platform() === 'win32' ? 'windows' : 
                  os.platform() === 'darwin' ? 'osx' : 'linux';
    
    let allowed = false;
    
    for (const rule of lib.rules) {
        if (rule.action === 'allow') {
            if (!rule.os || rule.os.name === osName) {
                allowed = true;
            }
        } else if (rule.action === 'disallow') {
            if (!rule.os || rule.os.name === osName) {
                allowed = false;
            }
        }
    }
    
    return allowed;
}

async function extractNatives(librariesDir, nativesDir, versionData) {
    const osName = os.platform() === 'win32' ? 'windows' : 
                  os.platform() === 'darwin' ? 'osx' : 'linux';
    
    for (const lib of versionData.libraries) {
        if (lib.natives && lib.natives[osName] && lib.downloads?.classifiers) {
            const nativeKey = lib.natives[osName].replace('${arch}', os.arch() === 'x64' ? '64' : '32');
            const nativeArtifact = lib.downloads.classifiers[nativeKey];
            
            if (nativeArtifact) {
                const nativePath = path.join(librariesDir, nativeArtifact.path);
                
                if (fs.existsSync(nativePath)) {
                    try {
                        const zip = new AdmZip(nativePath);
                        zip.extractAllTo(nativesDir, true);
                        logConsole(`Native extraído: ${path.basename(nativePath)}`, 'success');
                    } catch (error) {
                        logConsole(`Error extrayendo native: ${error.message}`, 'error');
                    }
                }
            }
        }
    }
}

async function downloadAndProcessLibraries(versionData, baseVersionData = null) {
    const minecraftDir = path.join(os.homedir(), '.minecraft');
    const librariesDir = path.join(minecraftDir, 'libraries');
    
    if (!fs.existsSync(librariesDir)) {
        fs.mkdirSync(librariesDir, { recursive: true });
    }
    
    let allLibraries = [];
    
    if (baseVersionData && baseVersionData.libraries) {
        allLibraries = [...baseVersionData.libraries];
    }
    
    if (versionData.libraries) {
        allLibraries = [...allLibraries, ...versionData.libraries];
    }
    
    logConsole(`Total de librerías a procesar: ${allLibraries.length}`, 'info');
    
    const librariesToDownload = [];
    
    for (const lib of allLibraries) {
        if (!shouldDownloadLibrary(lib)) {
            logConsole(`Saltando librería (regla OS): ${lib.name}`, 'info');
            continue;
        }
        
        let libInfo = null;
        
        if (lib.downloads && lib.downloads.artifact) {
            libInfo = {
                name: lib.name,
                path: path.join(librariesDir, lib.downloads.artifact.path),
                url: lib.downloads.artifact.url,
                sha1: lib.downloads.artifact.sha1,
                size: lib.downloads.artifact.size
            };
        }
        else if (lib.name) {
            const nameParts = lib.name.split(':');
            if (nameParts.length >= 3) {
                const [group, artifact, version] = nameParts;
                const groupPath = group.replace(/\./g, '/');
                const fileName = `${artifact}-${version}.jar`;
                const relativePath = `${groupPath}/${artifact}/${version}/${fileName}`;
                
                let baseUrl = 'https://repo1.maven.org/maven2';
                
                if (lib.url) {
                    baseUrl = lib.url.endsWith('/') ? lib.url.slice(0, -1) : lib.url;
                }
                
                libInfo = {
                    name: lib.name,
                    path: path.join(librariesDir, relativePath),
                    url: `${baseUrl}/${relativePath}`,
                    sha1: lib.sha1,
                    size: lib.size
                };
            }
        }
        
        if (libInfo) {
            librariesToDownload.push(libInfo);
        }
    }
    
    logConsole(`Librerías a verificar/descargar: ${librariesToDownload.length}`, 'success');
    
    let downloadedCount = 0;
    let existingCount = 0;
    const totalLibs = librariesToDownload.length;
    
    for (let i = 0; i < librariesToDownload.length; i++) {
        const lib = librariesToDownload[i];
        
        const libDir = path.dirname(lib.path);
        if (!fs.existsSync(libDir)) {
            fs.mkdirSync(libDir, { recursive: true });
        }
        
        if (fs.existsSync(lib.path)) {
            existingCount++;
            logConsole(`✓ [${i+1}/${totalLibs}] Ya existe: ${lib.name}`, 'info');
            continue;
        }
        
        logConsole(`📥 [${i+1}/${totalLibs}] Descargando: ${lib.name}`, 'info');
        logConsole(`    URL: ${lib.url}`, 'info');
        
        try {
            await downloadFileBetter(lib.path, lib.url, (progress) => {
                const percent = ((i + progress.percent / 100) / totalLibs) * 100;
                updateProgress(
                    percent,
                    `Descargando librerías...`,
                    `[${i+1}/${totalLibs}] ${lib.name}`,
                    progress.loaded,
                    progress.total,
                    progress.speed
                );
            });
            
            downloadedCount++;
            logConsole(`✅ [${i+1}/${totalLibs}] Descargada: ${lib.name}`, 'success');
            
        } catch (err) {
            logConsole(`❌ [${i+1}/${totalLibs}] ERROR: ${lib.name} - ${err.message}`, 'error');
            
            if (lib.url.includes('maven.fabricmc.net')) {
                logConsole(`    Intentando URL alternativa...`, 'warning');
                try {
                    const altUrl = lib.url.replace('maven.fabricmc.net', 'repo1.maven.org/maven2');
                    await downloadFileBetter(lib.path, altUrl);
                    downloadedCount++;
                    logConsole(`✅ Descargada desde alternativa`, 'success');
                } catch (altErr) {
                    logConsole(`❌ También falló alternativa: ${altErr.message}`, 'error');
                }
            }
        }
    }
    
    logConsole(``, 'info');
    logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'success');
    logConsole(`RESUMEN DE LIBRERÍAS:`, 'success');
    logConsole(`  Total: ${totalLibs}`, 'info');
    logConsole(`  Ya existían: ${existingCount}`, 'info');
    logConsole(`  Descargadas: ${downloadedCount}`, 'success');
    logConsole(`  Fallos: ${totalLibs - existingCount - downloadedCount}`, existingCount + downloadedCount === totalLibs ? 'success' : 'error');
    logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'success');
    logConsole(``, 'info');
    
    const classpath = [];
    
    for (const lib of librariesToDownload) {
        if (fs.existsSync(lib.path)) {
            classpath.push(lib.path);
        } else {
            logConsole(`⚠️ FALTA en classpath: ${lib.name}`, 'error');
        }
    }
    
    logConsole(`Classpath construido con ${classpath.length} librerías`, 'success');
    
    return classpath;
}

async function downloadVersion(versionId) {
    try {
        logConsole(`Iniciando descarga de ${versionId}`, 'info');
        const versionInfo = versionsData.versions.find(v => v.id === versionId);
        if (!versionInfo) throw new Error('Versión no encontrada');

        elements.downloadProgress.classList.add('show');
        updateProgress(0, 'Iniciando descarga...', 'Preparando archivos...');
        
        const versionResponse = await fetch(versionInfo.url);
        const versionData = await versionResponse.json();
        
        const minecraftDir = path.join(os.homedir(), '.minecraft');
        const versionsDir = path.join(minecraftDir, 'versions', versionId);
        const librariesDir = path.join(minecraftDir, 'libraries');
        const nativesDir = path.join(versionsDir, 'natives');
        
        [versionsDir, librariesDir, nativesDir].forEach(dir => {
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
        });
        
        updateProgress(5, 'Guardando información...', 'Version manifest');
        const versionJsonPath = path.join(versionsDir, `${versionId}.json`);
        fs.writeFileSync(versionJsonPath, JSON.stringify(versionData, null, 2));
        logConsole('JSON de versión guardado', 'success');
        
        updateProgress(10, 'Descargando cliente...', 'Minecraft JAR');
        const clientJarPath = path.join(versionsDir, `${versionId}.jar`);
        if (!fs.existsSync(clientJarPath) && versionData.downloads?.client) {
            await downloadFileBetter(clientJarPath, versionData.downloads.client.url, (progress) => {
                const basePercent = 10;
                const range = 30;
                const finalPercent = basePercent + (progress.percent / 100 * range);
                updateProgress(
                    finalPercent, 
                    'Descargando cliente...', 
                    '', 
                    progress.loaded, 
                    progress.total, 
                    progress.speed
                );
            });
            logConsole('Cliente JAR descargado', 'success');
        }
        
        updateProgress(40, 'Descargando librerías...', 'Dependencias del juego');
        if (versionData.libraries) {
            const filteredLibs = versionData.libraries.filter(shouldDownloadLibrary);
            const totalLibs = filteredLibs.length;
            let downloadedLibs = 0;
            
            for (let i = 0; i < totalLibs; i++) {
                const lib = filteredLibs[i];
                
                if (lib.downloads?.artifact) {
                    const libPath = path.join(librariesDir, lib.downloads.artifact.path);
                    const libDir = path.dirname(libPath);
                    if (!fs.existsSync(libDir)) {
                        fs.mkdirSync(libDir, { recursive: true });
                    }
                    if (!fs.existsSync(libPath)) {
                        await downloadFileBetter(libPath, lib.downloads.artifact.url, (progress) => {
                            const basePercent = 40;
                            const range = 30;
                            const libProgress = (downloadedLibs / totalLibs) * range;
                            const currentLibProgress = (progress.percent / 100) * (range / totalLibs);
                            updateProgress(
                                basePercent + libProgress + currentLibProgress,
                                'Descargando librerías...',
                                '',
                                progress.loaded,
                                progress.total,
                                progress.speed
                            );
                        });
                    }
                }
                
                if (lib.downloads?.classifiers && lib.natives) {
                    const osName = os.platform() === 'win32' ? 'windows' : 
                                  os.platform() === 'darwin' ? 'osx' : 'linux';
                    
                    if (lib.natives[osName]) {
                        const nativeKey = lib.natives[osName].replace('${arch}', os.arch() === 'x64' ? '64' : '32');
                        const nativeArtifact = lib.downloads.classifiers[nativeKey];
                        
                        if (nativeArtifact) {
                            const nativePath = path.join(librariesDir, nativeArtifact.path);
                            const nativeDir = path.dirname(nativePath);
                            if (!fs.existsSync(nativeDir)) {
                                fs.mkdirSync(nativeDir, { recursive: true });
                            }
                            if (!fs.existsSync(nativePath)) {
                                await downloadFileBetter(nativePath, nativeArtifact.url);
                            }
                        }
                    }
                }
                
                downloadedLibs++;
                const progress = 40 + ((downloadedLibs / totalLibs) * 30);
                updateProgress(progress, 'Descargando librerías...', `${downloadedLibs}/${totalLibs}`);
            }
        }
        
        updateProgress(70, 'Extrayendo natives...', 'Archivos nativos');
        await extractNatives(librariesDir, nativesDir, versionData);
        
        updateProgress(80, 'Descargando assets...', 'Recursos del juego');
        if (versionData.assetIndex) {
            const assetsDir = path.join(minecraftDir, 'assets');
            const indexesDir = path.join(assetsDir, 'indexes');
            const objectsDir = path.join(assetsDir, 'objects');
            
            [indexesDir, objectsDir].forEach(dir => {
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
            });
            
            const indexPath = path.join(indexesDir, `${versionData.assetIndex.id}.json`);
            if (!fs.existsSync(indexPath)) {
                await downloadFileBetter(indexPath, versionData.assetIndex.url);
                logConsole('Índice de assets descargado', 'success');
            }
            
            const assetIndex = JSON.parse(fs.readFileSync(indexPath, 'utf8'));
            const assets = Object.values(assetIndex.objects);
            const totalAssets = assets.length;
            
            for (let i = 0; i < totalAssets; i++) {
                const asset = assets[i];
                const hash = asset.hash;
                const hashPrefix = hash.substring(0, 2);
                const assetPath = path.join(objectsDir, hashPrefix, hash);
                
                if (!fs.existsSync(assetPath)) {
                    const assetDir = path.dirname(assetPath);
                    if (!fs.existsSync(assetDir)) {
                        fs.mkdirSync(assetDir, { recursive: true });
                    }
                    
                    const assetUrl = `https://resources.download.minecraft.net/${hashPrefix}/${hash}`;
                    await downloadFileBetter(assetPath, assetUrl);
                }
                
                if (i % 50 === 0) {
                    const progress = 80 + ((i / totalAssets) * 15);
                    updateProgress(progress, 'Descargando assets...', `${i}/${totalAssets}`);
                }
            }
        }
        
        updateProgress(95, 'Verificando instalación...', 'Comprobando archivos');
        await new Promise(resolve => setTimeout(resolve, 500));
        
        updateProgress(100, 'Instalación completa', 'Listo para jugar');
        logConsole('Instalación completada exitosamente', 'success');
        
        setTimeout(() => {
            elements.downloadProgress.classList.remove('show');
            elements.progressBar.style.width = '0%';
            updateLaunchButton();
        }, 2000);
        
        return versionData;
        
    } catch (error) {
        logConsole('Error descargando versión: ' + error.message, 'error');
        updateProgress(0, 'Error en la descarga', error.message);
        setTimeout(() => elements.downloadProgress.classList.remove('show'), 3000);
        throw error;
    }
}

async function ensureModdedVersionDependencies(versionId) {
    const minecraftDir = path.join(os.homedir(), '.minecraft');
    const versionDir = path.join(minecraftDir, 'versions', versionId);
    const versionJsonPath = path.join(versionDir, fs.readdirSync(versionDir).find(f => f.endsWith('.json')));
    
    if (!fs.existsSync(versionJsonPath)) {
        throw new Error(`No se encontró el JSON de ${versionId}`);
    }
    
    const versionData = JSON.parse(fs.readFileSync(versionJsonPath, 'utf8'));
    
    if (versionData.inheritsFrom) {
        logConsole(`Esta versión hereda de: ${versionData.inheritsFrom}`, 'info');
        
        const baseVersionId = versionData.inheritsFrom;
        const baseVersionInstalled = isVersionInstalled(baseVersionId);
        
        if (!baseVersionInstalled) {
            logConsole(`Descargando versión base: ${baseVersionId}...`, 'warning');
            
            if (!versionsData) {
                const response = await fetch('https://launchermeta.mojang.com/mc/game/version_manifest.json');
                versionsData = await response.json();
            }
            
            const baseVersionInfo = versionsData.versions.find(v => v.id === baseVersionId);
            if (!baseVersionInfo) {
                throw new Error(`No se encontró la versión base ${baseVersionId} en Mojang`);
            }
            
            updateProgress(0, `Descargando ${baseVersionId}...`, 'Versión base requerida');
            await downloadVersion(baseVersionId);
            logConsole(`✓ Versión base ${baseVersionId} descargada`, 'success');
        } else {
            logConsole(`✓ Versión base ${baseVersionId} ya instalada`, 'success');
        }
    }
    
    if (versionData.libraries && versionData.libraries.length > 0) {
        logConsole(`Verificando ${versionData.libraries.length} librerías de ${versionId}...`, 'info');
        
        const librariesDir = path.join(minecraftDir, 'libraries');
        if (!fs.existsSync(librariesDir)) {
            fs.mkdirSync(librariesDir, { recursive: true });
        }
        
        let downloadedCount = 0;
        const totalLibs = versionData.libraries.length;
        
        for (let i = 0; i < versionData.libraries.length; i++) {
            const lib = versionData.libraries[i];
            
            let libPath, libUrl;
            
            if (lib.name) {
                const nameParts = lib.name.split(':');
                if (nameParts.length >= 3) {
                    const [group, artifact, version] = nameParts;
                    const groupPath = group.replace(/\./g, '/');
                    const fileName = `${artifact}-${version}.jar`;
                    const relativePath = `${groupPath}/${artifact}/${version}/${fileName}`;
                    
                    libPath = path.join(librariesDir, relativePath);
                    
                    if (lib.url) {
                        const baseUrl = lib.url.endsWith('/') ? lib.url.slice(0, -1) : lib.url;
                        libUrl = `${baseUrl}/${relativePath}`;
                    } else if (lib.downloads?.artifact) {
                        libUrl = lib.downloads.artifact.url;
                        libPath = path.join(librariesDir, lib.downloads.artifact.path);
                    } else {
                        libUrl = `https://repo1.maven.org/maven2/${relativePath}`;
                    }
                    
                    const libDir = path.dirname(libPath);
                    if (!fs.existsSync(libDir)) {
                        fs.mkdirSync(libDir, { recursive: true });
                    }
                    
                    if (!fs.existsSync(libPath)) {
                        logConsole(`Descargando: ${lib.name}`, 'info');
                        logConsole(`URL: ${libUrl}`, 'info');
                        
                        try {
                            await downloadFileBetter(libPath, libUrl, (progress) => {
                                const percent = 80 + (downloadedCount / totalLibs) * 15 + (progress.percent / totalLibs / 100) * 15;
                                updateProgress(
                                    percent,
                                    `Descargando librerías de ${versionId}...`,
                                    `${downloadedCount + 1}/${totalLibs} - ${lib.name}`,
                                    progress.loaded,
                                    progress.total,
                                    progress.speed
                                );
                            });
                            downloadedCount++;
                            logConsole(`✓ Descargada: ${lib.name}`, 'success');
                        } catch (err) {
                            logConsole(`❌ Error descargando ${lib.name}: ${err.message}`, 'error');
                        }
                    } else {
                        logConsole(`✓ Ya existe: ${lib.name}`, 'info');
                    }
                }
            }
        }
        
        logConsole(`✓ Librerías de ${versionId} verificadas (${downloadedCount} descargadas)`, 'success');
    }
    
    return versionData;
}

async function launchMinecraft() {
    try {
        const accountMode = isPremiumAccount ? 'Premium' : 'Offline';
        logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');
        logConsole(`PREPARANDO LANZAMIENTO`, 'info');
        logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');
        logConsole(`Modo: ${accountMode}`, 'info');
        logConsole(`Versión: ${currentVersion}`, 'info');

        const minecraftDir = path.join(os.homedir(), '.minecraft');
        const versionDir = path.join(minecraftDir, 'versions', currentVersion);
        const nativesDir = path.join(versionDir, 'natives');
        
        const versionFiles = getVersionFiles(currentVersion);
        if (!versionFiles) {
            throw new Error(`No se encontraron archivos válidos para ${currentVersion}`);
        }
        
        logConsole(`JAR: ${versionFiles.jarFile}`, 'info');
        logConsole(`JSON: ${versionFiles.jsonFile}`, 'info');
        
        const jarPath = versionFiles.jarPath;
        let versionJsonData = versionFiles.versionData;
        
        let baseVersionData = null;
        if (versionJsonData.inheritsFrom) {
            logConsole(`Hereda de: ${versionJsonData.inheritsFrom}`, 'info');
            const baseVersionPath = path.join(minecraftDir, 'versions', versionJsonData.inheritsFrom, `${versionJsonData.inheritsFrom}.json`);
            
            if (fs.existsSync(baseVersionPath)) {
                baseVersionData = JSON.parse(fs.readFileSync(baseVersionPath, 'utf8'));
                logConsole(`JSON base cargado`, 'success');
            } else {
                throw new Error(`No se encontró la versión base: ${versionJsonData.inheritsFrom}`);
            }
        }
        
        logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');
        
        const classpath = await downloadAndProcessLibraries(versionJsonData, baseVersionData);
        
        classpath.push(jarPath);
        
        logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');
        logConsole(`CONFIGURACIÓN DE LANZAMIENTO`, 'info');
        logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');
        
        const ram = elements.ramSlider.value;
        let username, uuid, accessToken;
        
        if (isPremiumAccount && msAuthData) {
            username = msAuthData.username;
            uuid = msAuthData.uuid;
            accessToken = msAuthData.accessToken;
            logConsole('Cuenta: Premium (Microsoft)', 'success');
        } else {
            username = currentUsername;
            uuid = generateOfflineUUID(currentUsername);
            accessToken = 'null';
            logConsole('Cuenta: Offline', 'warning');
        }

        logConsole(`Usuario: ${username}`, 'info');
        logConsole(`UUID: ${uuid}`, 'info');
        logConsole(`RAM: ${ram}GB`, 'info');

        const mainClass = versionJsonData.mainClass || (baseVersionData && baseVersionData.mainClass);
        if (!mainClass) {
            throw new Error('No se encontró mainClass');
        }
        logConsole(`MainClass: ${mainClass}`, 'info');

        const assetIndexId = versionJsonData.assetIndex?.id || 
                            (baseVersionData && baseVersionData.assetIndex?.id) || 
                            versionJsonData.assets || 
                            'legacy';
        logConsole(`Assets: ${assetIndexId}`, 'info');
        
        const gameVersion = versionJsonData.id || currentVersion;
        
        logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');
        logConsole(`INICIANDO JAVA`, 'info');
        logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'info');

        const classpathSeparator = os.platform() === 'win32' ? ';' : ':';
        const classpathString = classpath.join(classpathSeparator);
        
        logConsole(`Elementos en classpath: ${classpath.length}`, 'success');

        let javaArgs = [
            `-Xmx${ram}G`,
            `-Xms${ram}G`,
            `-Djava.library.path=${nativesDir}`,
            '-Dfml.ignoreInvalidMinecraftCertificates=true',
            '-Dfml.ignorePatchDiscrepancies=true',
            '-cp',
            classpathString,
            mainClass,
            '--username', username,
            '--version', gameVersion,
            '--gameDir', minecraftDir,
            '--assetsDir', path.join(minecraftDir, 'assets'),
            '--assetIndex', assetIndexId,
            '--uuid', uuid,
            '--accessToken', accessToken,
            '--userType', isPremiumAccount ? 'msa' : 'legacy',
            '--versionType', versionJsonData.type || 'release'
        ];

        const javaPath = getJavaPath();
        logConsole(`Java: ${javaPath}`, 'info');
        logConsole(``, 'info');
        logConsole(`🚀 LANZANDO MINECRAFT...`, 'success');
        logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, 'success');

        const minecraft = spawn(javaPath, javaArgs, {
            cwd: minecraftDir,
            stdio: 'pipe'
        });

        minecraft.stdout.on('data', data => {
            const lines = data.toString().trim().split('\n');
            lines.forEach(line => logConsole(line, 'info'));
        });

        minecraft.stderr.on('data', data => {
            const lines = data.toString().trim().split('\n');
            lines.forEach(line => {
                if (!line.includes('Unsupported class file') && 
                    !line.includes('WARNING:')) {
                    logConsole(line, 'warning');
                }
            });
        });

        minecraft.on('close', code => {
            logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, code === 0 ? 'success' : 'error');
            if (code === 0) {
                logConsole(`✅ Minecraft cerrado correctamente`, 'success');
            } else {
                logConsole(`❌ Minecraft cerrado con código ${code}`, 'error');
            }
            logConsole(`━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━`, code === 0 ? 'success' : 'error');
        });

        minecraft.unref();

    } catch (error) {
        logConsole('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'error');
        logConsole('❌ ERROR CRÍTICO AL LANZAR', 'error');
        logConsole('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'error');
        logConsole(error.message, 'error');
        throw error;
    }
}

// ============================================================================
// EVENT LISTENERS
// ============================================================================

elements.consoleLog.addEventListener('scroll', () => {
    const isScrolledToBottom = elements.consoleLog.scrollHeight - elements.consoleLog.clientHeight <= elements.consoleLog.scrollTop + 1;
    autoScrollEnabled = isScrolledToBottom;
});

elements.microsoftLoginBtn.addEventListener('click', () => {
    authenticateWithMicrosoft();
});

elements.offlineLoginForm.addEventListener('submit', (e) => {
    e.preventDefault();
    const username = elements.usernameInput.value.trim();
    if (username.length >= 3) {
        currentUsername = username;
        isPremiumAccount = false;
        
        elements.displayUsername.textContent = username;
        elements.accountType.textContent = 'Offline';
        elements.accountType.className = 'account-type';
        
        elements.loginScreen.classList.add('hidden');
        elements.mainScreen.classList.add('show');
        
        loadVersions();
        saveConfig();
        
        logConsole('Sesión iniciada en modo offline', 'warning');
        logConsole(`Usuario: ${username}`, 'info');
    } else {
        alert('El nombre de usuario debe tener al menos 3 caracteres');
    }
});

elements.logoutBtn.addEventListener('click', () => {
    if (confirm('¿Deseas cerrar sesión?')) {
        elements.mainScreen.classList.remove('show');
        elements.loginScreen.classList.remove('hidden');
        elements.usernameInput.value = '';
        currentUsername = '';
        isPremiumAccount = false;
        msAuthData = null;
        
        if (fs.existsSync(MS_AUTH_FILE)) {
            fs.unlinkSync(MS_AUTH_FILE);
        }
        
        logConsole('Sesión cerrada', 'info');
    }
});

elements.toggleConsoleBtn.addEventListener('click', () => {
    const isHidden = !elements.consoleSidebar.classList.contains('show');
    if (isHidden) {
        elements.consoleSidebar.classList.add('show');
        elements.mainContent.style.marginRight = '0';
    } else {
        elements.consoleSidebar.classList.remove('show');
    }
});

elements.closeConsoleBtn.addEventListener('click', () => {
    elements.consoleSidebar.classList.remove('show');
});

elements.clearConsoleBtn.addEventListener('click', () => {
    elements.consoleLog.innerHTML = '<div class="console-entry success">[SYSTEM] Consola limpiada</div>';
    logConsole('Consola limpiada manualmente', 'info');
});

elements.versionSelect.addEventListener('change', (e) => {
    currentVersion = e.target.value;
    elements.profileVersion.textContent = currentVersion;
    updateLaunchButton();
    saveConfig();
});

elements.ramSlider.addEventListener('input', (e) => {
    elements.ramValue.textContent = e.target.value;
    saveConfig();
});

elements.launchBtn.addEventListener('click', async () => {
    if (isDownloading) return;

    isDownloading = true;
    elements.launchBtn.classList.add('disabled');
    elements.launchIcon.className = 'fas fa-spinner fa-spin';
    elements.launchText.textContent = 'PREPARANDO...';

    try {
        elements.consoleLog.innerHTML = '<div class="console-entry success">[SYSTEM] Iniciando nuevo lanzamiento...</div>';
        
        if (!isVersionInstalled(currentVersion)) {
            await downloadVersion(currentVersion);
        } else {
            const minecraftDir = path.join(os.homedir(), '.minecraft');
            const versionDir = path.join(minecraftDir, 'versions', currentVersion);
            const files = fs.readdirSync(versionDir);
            const jsonFile = files.find(f => f.endsWith('.json'));
            
            if (!jsonFile) {
                throw new Error(`No se encontró JSON para ${currentVersion}`);
            }
            
            const jsonPath = path.join(versionDir, jsonFile);
            const versionData = JSON.parse(fs.readFileSync(jsonPath, 'utf8'));
            
            if (versionData.inheritsFrom && !isVersionInstalled(versionData.inheritsFrom)) {
                logConsole(`Se requiere versión base: ${versionData.inheritsFrom}`, 'warning');
                elements.downloadProgress.classList.add('show');
                
                await ensureModdedVersionDependencies(currentVersion);
                
                elements.downloadProgress.classList.remove('show');
            }
        }
        
        elements.launchText.textContent = 'INICIANDO...';
        
        await launchMinecraft();
        
        await new Promise(resolve => setTimeout(resolve, 2000));
        
    } catch (error) {
        logConsole('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'error');
        logConsole('❌ ERROR: ' + error.message, 'error');
        logConsole('━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━', 'error');
        alert('Error al iniciar Minecraft:\n\n' + error.message + '\n\nRevisa la consola para más detalles.');
    } finally {
        isDownloading = false;
        elements.launchBtn.classList.remove('disabled');
        updateLaunchButton();
    }
});

ipcRenderer.on('server-ping', (event, result) => {
    if (result.success) {
        elements.serverStatusDot.className = 'status-dot-small online';
        elements.serverStatusText.style.color = '#4caf50';
        elements.serverStatusText.textContent = 'En Línea';
        elements.pingText.style.color = '#4caf50';
        elements.pingText.textContent = result.ping + 'ms';
        elements.onlinePlayers.textContent = Math.floor(Math.random() * 500) + 100;
    } else {
        elements.serverStatusDot.className = 'status-dot-small';
        elements.serverStatusText.style.color = '#888888';
        elements.serverStatusText.textContent = 'Offline';
        elements.pingText.style.color = '#888888';
        elements.pingText.textContent = 'N/A';
        elements.onlinePlayers.textContent = '0';
    }
});

elements.minimizeBtn.addEventListener('click', () => ipcRenderer.send('minimize-window'));
elements.maximizeBtn.addEventListener('click', () => ipcRenderer.send('maximize-window'));
elements.closeBtn.addEventListener('click', () => ipcRenderer.send('close-window'));

elements.openMinecraftFolder.addEventListener('click', () => {
    const minecraftDir = path.join(os.homedir(), '.minecraft');
    const { shell } = require('electron');
    
    if (fs.existsSync(minecraftDir)) {
        shell.openPath(minecraftDir);
        logConsole('Carpeta .minecraft abierta', 'success');
    } else {
        alert('La carpeta .minecraft aún no existe. Descarga una versión primero.');
    }
});

elements.manageProfilesBtn.addEventListener('click', () => {
    elements.profilesModal.classList.add('show');
    renderProfilesList();
});

elements.switchProfileBtn.addEventListener('click', () => {
    elements.profilesModal.classList.add('show');
    renderProfilesList();
});

elements.closeProfilesModal.addEventListener('click', () => {
    elements.profilesModal.classList.remove('show');
});

elements.profilesModalBg.addEventListener('click', () => {
    elements.profilesModal.classList.remove('show');
});

elements.createProfileBtn.addEventListener('click', () => {
    elements.createProfileModal.classList.add('show');
    if (versionsData) {
        elements.profileVersionSelect.value = versionsData.latest.release;
    }
    elements.profileRamSlider.value = 4;
    elements.profileRamValue.textContent = 4;
});

elements.cancelCreateProfile.addEventListener('click', () => {
    elements.createProfileModal.classList.remove('show');
    elements.createProfileForm.reset();
});

elements.createProfileModalBg.addEventListener('click', () => {
    elements.createProfileModal.classList.remove('show');
    elements.createProfileForm.reset();
});

elements.profileRamSlider.addEventListener('input', (e) => {
    elements.profileRamValue.textContent = e.target.value;
});

elements.createProfileForm.addEventListener('submit', (e) => {
    e.preventDefault();
    
    const profileName = elements.profileNameInput.value.trim();
    const profileId = profileName.toLowerCase().replace(/\s+/g, '_');
    
    if (profiles[profileId]) {
        alert('Ya existe un perfil con ese nombre');
        return;
    }
    
    profiles[profileId] = {
        name: profileName,
        version: elements.profileVersionSelect.value,
        ram: parseInt(elements.profileRamSlider.value)
    };
    
    saveProfiles();
    logConsole(`Perfil creado: ${profileName}`, 'success');
    
    elements.createProfileModal.classList.remove('show');
    elements.createProfileForm.reset();
    renderProfilesList();
});

function renderProfilesList() {
    elements.profilesList.innerHTML = '';
    
    Object.keys(profiles).forEach(profileId => {
        const profile = profiles[profileId];
        const isActive = profileId === currentProfile;
        
        const profileCard = document.createElement('div');
        profileCard.className = `profile-card ${isActive ? 'active' : ''}`;
        
        profileCard.innerHTML = `
            <div class="profile-info">
                <div class="profile-icon">
                    <i class="fas fa-user-circle"></i>
                </div>
                <div class="profile-details">
                    <div class="name">
                        ${profile.name}
                        ${isActive ? '<span class="profile-badge">Activo</span>' : ''}
                    </div>
                    <div class="version">Versión: ${profile.version || 'No configurado'}</div>
                </div>
            </div>
            <div class="profile-actions">
                ${!isActive ? `<button onclick="switchToProfile('${profileId}')" class="profile-btn">
                    Usar
                </button>` : ''}
                ${profileId !== 'default' ? `<button onclick="deleteProfile('${profileId}')" class="profile-btn delete">
                    <i class="fas fa-trash"></i>
                </button>` : ''}
            </div>
        `;
        
        elements.profilesList.appendChild(profileCard);
    });
}

window.switchToProfile = function(profileId) {
    currentProfile = profileId;
    config.currentProfile = profileId;
    loadCurrentProfile();
    saveConfig();
    elements.profilesModal.classList.remove('show');
    logConsole(`Cambiado a perfil: ${profiles[profileId].name}`, 'success');
};

window.deleteProfile = function(profileId) {
    if (profileId === 'default') {
        alert('No puedes eliminar el perfil por defecto');
        return;
    }
    
    if (confirm(`¿Seguro que deseas eliminar el perfil "${profiles[profileId].name}"?`)) {
        delete profiles[profileId];
        
        if (currentProfile === profileId) {
            currentProfile = 'default';
            config.currentProfile = 'default';
            loadCurrentProfile();
        }
        
        saveProfiles();
        saveConfig();
        renderProfilesList();
        logConsole(`Perfil eliminado: ${profileId}`, 'success');
    }
};

elements.downloadModsBtn.addEventListener('click', async () => {
    const response = await fetch('https://mantraxtools.store/fetch_mods.php');
    const data = await response.json();

    const minecraftDir = path.join(os.homedir(), '.minecraft');
    const modsDir = path.join(minecraftDir, 'mods');
    const versionsDir = path.join(minecraftDir, 'versions');

    if (!fs.existsSync(modsDir)) {
        fs.mkdirSync(modsDir, { recursive: true });
    }
    if (!fs.existsSync(versionsDir)) {
        fs.mkdirSync(versionsDir, { recursive: true });
    }

    elements.downloadProgress.classList.add('show');

    const totalMods = data.mods.length;
    let downloadedMods = 0;
    let totalDownloaded = 0;
    const modsSize = data.mods_peso_total_bytes || 0;

    for (const mod of data.mods) {
        const modFilePath = path.join(modsDir, mod.nombre);

        await downloadFileBetter(modFilePath, mod.url, (progress) => {
            const currentTotal = totalDownloaded + progress.loaded;
            const percent = (currentTotal / modsSize) * 80;

            updateProgress(
                Math.min(percent, 80),
                `Descargando mod ${downloadedMods + 1}/${totalMods}`,
                mod.nombre,
                currentTotal,
                modsSize,
                progress.speed
            );
        });

        totalDownloaded += mod.tamaño_bytes;
        downloadedMods++;
    }

    if (data.fabric && data.fabric.length > 0) {
        const fabricInfo = data.fabric[0];
        const fabricZipPath = path.join(versionsDir, fabricInfo.nombre);

        await downloadFileBetter(fabricZipPath, fabricInfo.url, (progress) => {
            const percent = 80 + (progress.percent * 0.15);
            updateProgress(
                percent,
                'Descargando Fabric...',
                fabricInfo.nombre,
                progress.loaded,
                progress.total,
                progress.speed
            );
        });

        updateProgress(95, 'Extrayendo Fabric...', '');

        const zip = new AdmZip(fabricZipPath);
        zip.extractAllTo(versionsDir, true);

        fs.unlinkSync(fabricZipPath);
    }

    updateProgress(100, 'Completado', '');

    setTimeout(() => {
        elements.downloadProgress.classList.remove('show');
        elements.progressBar.style.width = '0%';
    }, 2000);
});

elements.settingsBtn.addEventListener('click', () => {
    logConsole('Abriendo configuración...', 'info');
    alert('Configuración avanzada\n\nPróximamente disponible:\n- Configuración de Java\n- Argumentos JVM personalizados\n- Gestión de caché\n- Opciones de rendimiento');
});

// ============================================================================
// INICIALIZACIÓN
// ============================================================================

// Event listeners para autenticación manual
document.addEventListener('DOMContentLoaded', () => {
    const processBtn = document.getElementById('processCallbackBtn');
    const cancelBtn = document.getElementById('cancelAuthBtn');
    const callbackInput = document.getElementById('callbackUrlInput');
    
    if (processBtn) {
        processBtn.addEventListener('click', processCallbackUrl);
    }
    
    if (cancelBtn) {
        cancelBtn.addEventListener('click', () => {
            elements.msAuthLoading.classList.remove('show');
        });
    }
    
    if (callbackInput) {
        callbackInput.addEventListener('keypress', (e) => {
            if (e.key === 'Enter') {
                processCallbackUrl();
            }
        });
    }
});

loadConfig();
logConsole('Mantrax Launcher inicializado correctamente', 'success')