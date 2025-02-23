/* fedora-wsl-manager is an open source Fedora WSL manager packed by electron
Copyright (C) 2024-2025  Yu Hongbo, CNOCTAVE

This program is free software: you can redistribute it and/or modify
it under the terms of the GNU Affero General Public License as
published by the Free Software Foundation, either version 3 of the
License, or (at your option) any later version.

This program is distributed in the hope that it will be useful,
but WITHOUT ANY WARRANTY; without even the implied warranty of
MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
GNU Affero General Public License for more details.

You should have received a copy of the GNU Affero General Public License
along with this program.  If not, see <https://www.gnu.org/licenses/>. */

const { app, BrowserWindow, ipcMain, dialog, clipboard, screen, nativeTheme } = require('electron');
const { exec } = require('child_process');
const https = require('https');
const path = require('path');
const fs = require('fs');
const os = require('os');
const axios = require('axios').default;
axios.interceptors.request.use(config => {
    config.headers['User-Agent'] = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/92.0.4515.131 Safari/537.36 Edg/92.0.902.62';
    config.timeout = 15000;
    return config;
}, (error) => {
    return Promise.reject(error);
});

const winston = require('winston');

const log = winston.createLogger({
    level: 'info',
    format: winston.format.json(),
    transports: [
        new winston.transports.Console(),
        new winston.transports.File({
            filename: 'log.txt',
            level: 'info',
            format: winston.format.simple(),
        }),
    ],
});

function showSuccess(title, message, detail) {
    dialog.showMessageBox({
        type: 'info',
        title: title,
        message: message,
        detail: detail,
        buttons: ['确定']
    }).then(({ response }) => {
        console.log(`用户点击了按钮: ${response}`);
    });
}

function showWarning(title, message, detail) {
    dialog.showMessageBox({
        type: 'warning',
        title: title,
        message: message,
        detail: detail,
        buttons: ['确定']
    }).then(({ response }) => {
        console.log(`用户点击了按钮: ${response}`);
    });
}

function showError(title, message, detail) {
    dialog.showMessageBox({
        type: 'error',
        title: title,
        message: message,
        detail: detail,
        buttons: ['确定']
    }).then(({ response }) => {
        console.log(`用户点击了按钮: ${response}`);
    });
}

function readJsonFileAsObject(filePath) {
    fs.readFile(filePath, 'utf8', (err, data) => {
        if (err) {
            showError('出错', '读取数据出错。建议在重启电脑后重试', stderr);
            return [];
        }

        try {
            return JSON.parse(data);
        } catch (parseErr) {
            showError('出错', '数据文件损坏。请重试', '文件内容：' + data);
            return [];
        }
    });
}

const formatDateToYYYYMMDD = (date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
};

let mainWindow;

function createWindow() {
    const win = new BrowserWindow({
        width: 800,
        height: 600,
        title: 'fedora-wsl-manager',
        icon: 'logo.png',
        minWidth: 400,
        minHeight: 200,
        resizable: true, // 允许用户调整窗口大小
        frame: false, // 移除默认的框架
        transparent: false, // 设置为透明
        backgroundColor: 'transparent', // 设置背景颜色为透明
        webPreferences: {
            nodeIntegration: true,
            contextIsolation: false,
            enableRemoteModule: true,
            backgroundColor: '#000000', // 设置网页背景颜色为黑色
        },
    });

    win.webContents.on('did-finish-load', () => {
        // 当网页加载完成后，设置网页的背景颜色
        win.webContents.send('change-bgcolor', 'black')
    })

    win.loadFile('index.html')

    const handle = ipcMain.on('message-from-renderer', (event, arg) => {
        if (arg.action === 'minimize') {
            win.minimize()
        } else if (arg.action === 'maximize') {
            console.log(win.isMaximized())
            if (win.isMaximized()) {
                win.restore()
            } else {
                win.maximize()
            }
        } else if (arg.action === 'close') {
            win.close()
        }
        event.reply('message-from-renderer', 'Response from main process')
    })

    win.on('closed', () => {
        mainWindow = null
        handle.removeAllListeners()
    })
};

app.whenReady().then(createWindow)

ipcMain.on('refresh-markdown', (event, msg) => {
    event.reply('message-updated', msg);
});

ipcMain.on('refresh-current-wsl-list-start', (event, msg) => {
    event.reply('refresh-current-wsl-list-start-complete', msg);
});

function parseTextToObjects(text) {
    const lines = text.trim().split('\n');
    const result = [];

    for (let i = 1; i < lines.length; i++) {
        const line = lines[i].replace(/\*/g, '').replace(/\u0000/g, '').trim();
        if (line.length === 0) continue;

        // 去除每行前的空格和可能的星号，并按空格拆分数据
        const data = line.split(/\s+/);

        // 创建对象并添加到结果数组中
        const obj = {
            NAME: data[0],
            STATE: data[1],
            VERSION: data[2]
        };
        result.push(obj);
    }

    return result;
}

ipcMain.on('refresh-current-wsl-list-stop', (event, msg) => {
    let ret = { 'error': null, 'stdout': null, 'stderr': null, 'list_data': null };
    let list_data = [];
    let processed_list_data = [];
    const command = 'wsl --list --all -v';
    exec(command, (error, stdout, stderr) => {
        if (error) {
            showError('出错', '系统级错误。建议在重启电脑后重试', error);
            ret.error = error;
        }
        if (stderr) {
            showError('出错', 'WSL环境异常。建议在执行wsl --shutdown命令后重试', stderr);
            ret.stderr = stderr;
        }
        console.log(`命令的标准输出:\n${stdout}`);
        ret.stdout = stdout;
        list_data = parseTextToObjects(stdout);
        list_data.forEach(function (item) {
            processed_list_data.push(
                {
                    'NAME': item.NAME,
                    'STATE': item.STATE,
                    'VERSION': item.VERSION,
                    'launch_misc': 'wsl -d ' + item.NAME
                }
            )
        });
        event.reply('refresh-current-wsl-list-stop-complete', JSON.stringify(processed_list_data));
    });
});

ipcMain.on('del-wsl-start', (event, msg) => {
    event.reply('del-wsl-start-complete', msg);
});

ipcMain.on('del-wsl-stop', (event, msg) => {
    dialog.showMessageBox({
        type: 'warning',
        title: '此操作需要确认',
        message: '是否确定要删除WSL实例？',
        buttons: ['确定', '取消']
    }).then(({ response }) => {
        if (response === 0) {
            const command = 'wsl --unregister ' + msg;
            exec(command, (error, stdout, stderr) => {
                if (error) {
                    showError('出错', '系统级错误。建议在重启电脑后重试', error);
                }
                if (stderr) {
                    showError('出错', 'WSL环境异常。建议在执行wsl --shutdown命令后重试', stderr);
                }
                console.log(`命令的标准输出:\n${stdout}`);
                event.reply('refresh-current-wsl-list-start-complete', msg);
            });
        } else if (response === 1) {
            event.reply('refresh-current-wsl-list-start-complete', msg);
        }
    }).catch((error) => {
        console.error('显示对话框时发生错误:', error);
    });
});

ipcMain.on('send-desktop-quick-start', (event, msg) => {
    event.reply('send-desktop-quick-start-complete', msg);
});

ipcMain.on('send-desktop-quick-stop', (event, msg) => {
    const textToWrite = [
        '@echo off',
        'cd /d %USERPROFILE%\\Desktop',
        'wsl -d ' + msg
    ].join('\n');
    const filePath = path.join(os.homedir(), 'Desktop', msg + '.bat');
    try {
        fs.writeFileSync(filePath, textToWrite);
        showSuccess('成功', '桌面快捷方式创建成功', filePath);
    } catch (error) {
        showError('出错', '写入文件时出错。请检查桌面上是否已有文件' + msg + '.bat', error);
    }
    event.reply('send-desktop-quick-stop-complete', msg);
});

ipcMain.on('upgrade-wsl-start', (event, msg) => {
    event.reply('upgrade-wsl-start-complete', msg);
});

ipcMain.on('upgrade-wsl-stop', (event, msg) => {
    const command = 'wsl --set-version ' + msg + ' 2';
    exec(command, (error, stdout, stderr) => {
        if (error) {
            showError('出错', '系统级错误。建议在重启电脑后重试', error);
        }
        if (stderr) {
            showError('出错', 'WSL环境异常。建议在执行wsl --shutdown命令后重试', stderr);
        }
        console.log(`命令的标准输出:\n${stdout}`);
        event.reply('refresh-current-wsl-list-start-complete', msg);
    });
});

ipcMain.on('downgrade-wsl-start', (event, msg) => {
    event.reply('downgrade-wsl-start-complete', msg);
});

ipcMain.on('downgrade-wsl-stop', (event, msg) => {
    const command = 'wsl --set-version ' + msg + ' 1';
    exec(command, (error, stdout, stderr) => {
        if (error) {
            showError('出错', '系统级错误。建议在重启电脑后重试', error);
        }
        if (stderr) {
            showError('出错', 'WSL环境异常。建议在执行wsl --shutdown命令后重试', stderr);
        }
        console.log(`命令的标准输出:\n${stdout}`);
        event.reply('refresh-current-wsl-list-start-complete', msg);
    });
});

ipcMain.on('refresh-avaliable-fedora-wsl-list-start', (event, msg) => {
    event.reply('refresh-avaliable-fedora-wsl-list-start-complete', msg);
});

ipcMain.on('refresh-avaliable-fedora-wsl-list-stop', (event, msg) => {
    const oneDayAgo = new Date(new Date().getTime() - 24 * 60 * 60 * 1000);
    const oneDayAgoStr = formatDateToYYYYMMDD(oneDayAgo);
    const fedoraWslUrl = `https://github.com/CNOCTAVE/fedora-wsl-manager-github-action-data-service/releases/download/${oneDayAgoStr}/docker_brew_fedora_list.json`;
    var data = '';
    https.get(fedoraWslUrl, function (res) {
        if (res.statusCode > 300 && res.statusCode < 400 && res.headers.location) {
            https.get(res.headers.location, function (res) {
                res.on('data', function (chunk) {
                    data += chunk;
                }).on('end', function () {
                    if (data === '') {
                        event.reply('refresh-avaliable-fedora-wsl-list-stop-complete', JSON.stringify([]));
                    } else {
                        event.reply('refresh-avaliable-fedora-wsl-list-stop-complete', data);
                    }
                }).on('error', function (err) {
                    showError('出错', '网络请求失败。建议检查您的网络', JSON.stringify(err));
                    event.reply('refresh-avaliable-fedora-wsl-list-stop-complete', JSON.stringify([]));
                }).on('timeout', function (err) {
                    showError('出错', '网络请求失败。建议检查您的网络', JSON.stringify(err));
                    event.reply('refresh-avaliable-fedora-wsl-list-stop-complete', JSON.stringify([]));
                });
            });
        } else {
            res.on('data', function (chunk) {
                data += chunk;
            }).on('end', function () {
                if (data === '') {
                    event.reply('refresh-avaliable-fedora-wsl-list-stop-complete', JSON.stringify([]));
                } else {
                    event.reply('refresh-avaliable-fedora-wsl-list-stop-complete', data);
                }
            }).on('error', function (err) {
                showError('出错', '网络请求失败。建议检查您的网络', JSON.stringify(err));
                event.reply('refresh-avaliable-fedora-wsl-list-stop-complete', JSON.stringify([]));
            }).on('timeout', function (err) {
                showError('出错', '网络请求失败。建议检查您的网络', JSON.stringify(err));
                event.reply('refresh-avaliable-fedora-wsl-list-stop-complete', JSON.stringify([]));
            });
        }
    });
});


ipcMain.on('copy-misc-to-clipboard-start', (event, msg) => {
    event.reply('copy-misc-to-clipboard-start-complete', msg);
});

ipcMain.on('copy-misc-to-clipboard-stop', (event, msg) => {
    clipboard.writeText(msg.v);
    setTimeout(() => {
        event.reply('copy-misc-to-clipboard-stop-complete', msg);
    }, 3000);
});

ipcMain.on('choose-wsl-installation-path-start', (event, msg) => {
    const paths = dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    paths.then(({ filePaths }) => {
        if (filePaths.length > 0) {
            event.reply('choose-wsl-installation-path-start-complete', filePaths[0]);
        }
    }).catch(err => {
        console.error('An error occurred:', err);
    });
});

ipcMain.on('choose-wsl-file-path-start', (event, msg) => {
    const files = dialog.showOpenDialogSync({
        properties: ['openFile'],
        filters: [
            { name: 'TAR Files', extensions: ['tar'] },
        ],
    });

    if (files && files.length > 0) {
        event.reply('choose-wsl-file-path-start-complete', files[0]);
    }
});

ipcMain.on('install-start', (event, installOptions) => {
    let installOptionsObject = JSON.parse(installOptions);
    if (installOptionsObject.option === 'manualInstall') {
        if (installOptionsObject.wslName === '') {
            showError('出错', '必须输入WSL实例名称', '必须输入WSL实例名称');
            return null;
        }
        if (installOptionsObject.installationPath === '') {
            showError('出错', '必须选择WSL实例安装文件夹', '必须选择WSL实例安装文件夹');
            return null;
        }
        if (installOptionsObject.filePath === '') {
            showError('出错', '必须选择WSL镜像文件', '必须选择WSL镜像文件');
            return null;
        }
    }
    const command = 'wsl --import ' +
        installOptionsObject.wslName +
        ' ' +
        installOptionsObject.installationPath +
        ' ' +
        installOptionsObject.filePath;
    exec(command, (error, stdout, stderr) => {
        if (error) {
            showError('出错', '系统级错误。建议在重启电脑后重试', error);
            return null;
        }
        if (stderr) {
            showError('出错', 'WSL环境异常。建议在执行wsl --shutdown命令后重试', stderr);
            return null;
        }
        if (installOptionsObject.option === 'manualInstall') {
            showSuccess('成功', 'WSL实例（' + installOptionsObject.wslName + '）手动安装成功', stdout);
            event.reply('manual-install-complete', '');
        }
        if (installOptionsObject.option === 'onlineInstallWsl') {
            showSuccess('成功', 'WSL实例（' + installOptionsObject.wslName + '）在线安装成功', stdout);
        }
    });
});

ipcMain.on('choose-wsl-download-path-start', (event, msg) => {
    const paths = dialog.showOpenDialog({
        properties: ['openDirectory']
    });
    paths.then(({ filePaths }) => {
        if (filePaths.length > 0) {
            event.reply('choose-wsl-download-path-start-complete', filePaths[0]);
        }
    }).catch(err => {
        console.error('An error occurred:', err);
    });
});

ipcMain.on('download-wsl-start', (event, installOptions) => {
    let installOptionsObject = JSON.parse(installOptions);
    if (installOptionsObject.option === 'downloadWsl') {
        if (installOptionsObject.fileName === '') {
            showError('出错', 'WSL实例名称无效', '建议在检查网络连接后再试');
            return null;
        }
        if (installOptionsObject.downloadPath === '') {
            showError('出错', '必须选择WSL镜像下载文件夹', '必须选择WSL镜像下载文件夹');
            return null;
        }
    }
    if (installOptionsObject.option === 'onlineInstallWsl') {
        if (installOptionsObject.fileName === '') {
            showError('出错', 'WSL实例名称无效', '建议在检查网络连接后再试');
            return null;
        }
        if (installOptionsObject.downloadPath === '') {
            showError('出错', '必须选择WSL镜像下载文件夹', '必须选择WSL镜像下载文件夹');
            return null;
        }
        if (installOptionsObject.wslName === '') {
            showError('出错', '必须输入WSL实例名称', '必须输入WSL实例名称');
            return null;
        }
        if (installOptionsObject.installationPath === '') {
            showError('出错', '必须选择WSL实例安装文件夹', '必须选择WSL实例安装文件夹');
            return null;
        }
    }
    const docker_brew_fedora = installOptionsObject.docker_brew_fedora;
    const fileAbsolutePath = path.join(installOptionsObject.downloadPath, installOptionsObject.fileName);
    https.get(docker_brew_fedora, function (res) {
        if (res.statusCode > 300 && res.statusCode < 400 && res.headers.location) {
            https.get(res.headers.location, function (res) {
                res.setEncoding('binary');
                let data = '';
                res.on('data', function (chunk) {
                    data += chunk;
                }).on('end', function () {
                    fs.writeFileSync(fileAbsolutePath, data, 'binary');
                    if (installOptionsObject.option === 'downloadWsl') {
                        showSuccess('成功', 'WSL镜像下载完成', '文件保存位置：' + fileAbsolutePath);
                    }
                    if (installOptionsObject.option === 'onlineInstallWsl') {
                        installOptionsObject.filePath = fileAbsolutePath;
                        event.reply('online-install-wsl-start-complete', JSON.stringify(installOptionsObject));
                    }
                }).on('error', function (err) {
                    showError('出错', '网络请求失败。建议检查您的网络', JSON.stringify(err));
                }).on('timeout', function (err) {
                    showError('出错', '网络请求失败。建议检查您的网络', JSON.stringify(err));
                });
            });
        } else {
            res.setEncoding('binary');
            let data = '';
            res.on('data', function (chunk) {
                data += chunk;
            }).on('end', function () {
                fs.writeFileSync(fileAbsolutePath, data, 'binary');
                if (installOptionsObject.option === 'downloadWsl') {
                    showSuccess('成功', 'WSL镜像下载完成', '文件保存位置：' + fileAbsolutePath);
                }
                if (installOptionsObject.option === 'onlineInstallWsl') {
                    event.reply('online-install-wsl-start-complete', JSON.stringify(installOptionsObject));
                }
            }).on('error', function (err) {
                showError('出错', '网络请求失败。建议检查您的网络', JSON.stringify(err));
            }).on('timeout', function (err) {
                showError('出错', '网络请求失败。建议检查您的网络', JSON.stringify(err));
            });
        }
    });
});
