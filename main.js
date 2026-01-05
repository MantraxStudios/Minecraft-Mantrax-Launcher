const { app, BrowserWindow, ipcMain } = require('electron');
const net = require('net');
const path = require('path');

let mainWindow;

function createWindow() {
  mainWindow = new BrowserWindow({
    width: 1400,
    height: 900,
    minWidth: 1200,
    minHeight: 700,
    frame: false,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false,
      enableRemoteModule: true
    },
    backgroundColor: '#000000',
    show: false,
    icon: path.join(__dirname, 'assets/icon.png')
  });

  mainWindow.loadFile('index.html');

  mainWindow.once('ready-to-show', () => {
    mainWindow.show();
    checkServerStatus();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  setInterval(() => {
    if (mainWindow && !mainWindow.isDestroyed()) {
      checkServerStatus();
    }
  }, 30000);
}

function pingMinecraftServer(host, port = 25565, timeout = 5000) {
  return new Promise((resolve) => {
    const startTime = Date.now();
    const client = new net.Socket();
    
    const timeoutId = setTimeout(() => {
      client.destroy();
      resolve({ success: false, ping: -1 });
    }, timeout);

    client.connect(port, host, () => {
      const ping = Date.now() - startTime;
      clearTimeout(timeoutId);
      client.destroy();
      resolve({ success: true, ping });
    });

    client.on('error', (err) => {
      clearTimeout(timeoutId);
      client.destroy();
      console.error('Error al conectar al servidor:', err.message);
      resolve({ success: false, ping: -1 });
    });
  });
}

async function checkServerStatus() {
  try {
    const result = await pingMinecraftServer('mc.mantraxtools.store', 25565);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-ping', result);
    }
    
    return result;
  } catch (error) {
    console.error('Error al verificar servidor:', error);
    
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send('server-ping', { success: false, ping: -1 });
    }
    
    return { success: false, ping: -1 };
  }
}

ipcMain.on('check-server-now', async (event) => {
  const result = await checkServerStatus();
  event.reply('server-ping', result);
});

ipcMain.on('minimize-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.minimize();
  }
});

ipcMain.on('maximize-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    if (mainWindow.isMaximized()) {
      mainWindow.unmaximize();
    } else {
      mainWindow.maximize();
    }
  }
});

ipcMain.on('close-window', () => {
  if (mainWindow && !mainWindow.isDestroyed()) {
    mainWindow.close();
  }
});

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});

process.on('uncaughtException', (error) => {
  console.error('Error no capturado:', error);
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('Promesa rechazada no manejada:', reason);
});