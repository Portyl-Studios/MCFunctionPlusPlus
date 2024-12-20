// Use CommonJS
const { contextBridge } = require('electron');
//import { contextBridge } from 'electron';

contextBridge.exposeInMainWorld('electron', {
  // Add APIs if needed
});
