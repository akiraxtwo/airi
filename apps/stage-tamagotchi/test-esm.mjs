import electron from 'electron';
const { app, ipcMain, BrowserWindow } = electron;
console.log("ipcMain:", ipcMain);
console.log("app:", app);
app.on('ready', () => {
  console.log("App ready!");
  app.quit();
});
