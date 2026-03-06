const electron = require("electron");
console.log("type:", typeof electron);
console.log("ipcMain:", electron.ipcMain);
console.log("app:", electron.app);
if (electron.app) {
  electron.app.on('ready', () => {
    console.log("App ready!");
    electron.app.quit();
  });
}
