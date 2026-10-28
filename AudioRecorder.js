let mediaRecorder;
let recordedChunks = [];
let totalSeconds = 0;
let timeAdjustment = 0;  // 新增调整的秒数
let canvas;
let canvasContext;
let analyser;
let dataArray;
let bufferLength;
let activeMp3Encoder = null;
let mp3Data = [];
let copyPreference = 'plain'; // 默认复制选项
let activeAudioStream = null;
let activeAudioContext = null;
let waveformAnimationId = null;
let lastWaveformDraw = -Infinity;
let isFinalizingRecording = false;
let isStartingRecording = false;
let activeMp3Processor = null;
let activeRecoverySession = null;
const recordingClock = window.AudioRecorderControls.createRecordingClock({
    onTick(seconds) { totalSeconds = seconds; updateTimerDisplay(); }
});
const AUTO_DOWNLOAD_STORAGE_KEY = 'audioRecorderAutoDownload';
function isAutoDownloadEnabled() {
    return localStorage.getItem(AUTO_DOWNLOAD_STORAGE_KEY) !== 'false';
}

function initAutoDownloadToggle() {
    const toggle = document.getElementById('autoDownloadToggle');
    if (!toggle) return;
    toggle.checked = isAutoDownloadEnabled();
    toggle.addEventListener('change', () => {
        localStorage.setItem(AUTO_DOWNLOAD_STORAGE_KEY, toggle.checked ? 'true' : 'false');
    });
}

document.addEventListener('DOMContentLoaded', initAutoDownloadToggle);

// 保存用户选择并设置为默认选项
function setCopyPreference(preference) {
    copyPreference = preference;
    document.getElementById('popup1').style.display = 'none';
}

        // 获取日期选择器元素
        const startDateInput = document.getElementById('startDate');

        function getLocalDateFromInput(value) {
            const parts = String(value || '').split('-').map(Number);
            if (parts.length !== 3 || parts.some(Number.isNaN)) return null;
            const date = new Date(parts[0], parts[1] - 1, parts[2]);
            date.setHours(0, 0, 0, 0);
            return date;
        }

        function calculateRecordingNumber(startDateValue) {
            const startDate = getLocalDateFromInput(startDateValue);
            if (!startDate) return '';
            const currentDate = new Date();
            currentDate.setHours(0, 0, 0, 0);
            const diffDays = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24));
            return String(Math.min(100, Math.max(1, diffDays + 1)));
        }

        function syncNumberFromStartDate(startDateValue) {
            const number = calculateRecordingNumber(startDateValue);
            const numberInput = document.getElementById('customFilenamePart2');
            if (!number || !numberInput) return;
            numberInput.value = number;
            localStorage.setItem('customFilenamePart2', number);
        }

        // 页面加载时，检查是否有保存的日期并设置为默认值
        window.onload = function() {
            const savedDate = localStorage.getItem('startDate');
            if (savedDate) {
                // 如果有保存的日期，设置为日期选择器的默认值
                startDateInput.value = savedDate;
                syncNumberFromStartDate(savedDate);
                renderFilenameBuilder();
                console.log('Loaded saved start date:', savedDate);
            } else {
                // 如果没有保存的日期，使用电脑的本地时间设置日期选择器-暂时禁用这里的代码
                //const localDate = getLocalDate();
                //startDateInput.value = localDate;
                //localStorage.setItem('startDate', localDate);
                //console.log('Start date set to local date and saved:', localDate);
            }
        }

        // 监听日期选择器的变化事件
        startDateInput.addEventListener('change', function() {
            const selectedDate = startDateInput.value;
            if (selectedDate) {
                // 如果选择了日期，保存到 localStorage
                localStorage.setItem('startDate', selectedDate);
                syncNumberFromStartDate(selectedDate);
                renderFilenameBuilder();
                console.log('Start date saved:', selectedDate);
            } else {
                // 如果日期被清除，移除 localStorage 中的保存项
                localStorage.removeItem('startDate');
                renderFilenameBuilder();
                console.log('Start date cleared');
            }
        });




// 启动计时器
function startTimer() {
    recordingClock.start();
}

// 停止计时器
function stopTimer() {
    recordingClock.pause();
}

// 更新计时器显示（不影响 totalSeconds 计时）
function updateTimerDisplay() {
    const adjustedTime = totalSeconds;
    document.getElementById('timer').textContent = formatTime(adjustedTime);
}

// 格式化时间
function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

// 补齐两位数
function pad(value) {
    return String(value).padStart(2, '0');
}

// 监听输入框变化并更新 timeAdjustment 变量
document.getElementById('timeAdjust').addEventListener('input', (event) => {
    timeAdjustment = parseInt(event.target.value) || 0;  // 将调整后的秒数存储起来
    updateTimerDisplay();
});

// 监听鼠标滚轮事件，调整输入框的值
document.getElementById('timeAdjust').addEventListener('wheel', (event) => {
    // 阻止默认的滚动行为
    event.preventDefault();

    // 获取当前输入框的值
    let adjustment = parseInt(document.getElementById('timeAdjust').value) || 0;

    // 根据滚轮滚动方向增加或减少输入框的值
    if (event.deltaY < 0) {
        adjustment++;  // 向上滚动，增加输入框的值
    } else {
        adjustment--;  // 向下滚动，减少输入框的值
    }

    // 更新输入框的值
    document.getElementById('timeAdjust').value = adjustment;

    // 同步更新 timeAdjustment 并刷新显示的时间
    timeAdjustment = adjustment;
    updateTimerDisplay();
});

// 启动计时器时可以调用 startTimer()
// 停止计时器时可以调用 stopTimer()

function clearFrequencySpectrum() {
    const spectrumCanvas = canvas || document.getElementById('waveform');
    const context = canvasContext || spectrumCanvas?.getContext('2d');
    if (!spectrumCanvas || !context) return;
    context.clearRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
    context.fillStyle = 'rgb(250, 250, 250)';
    context.fillRect(0, 0, spectrumCanvas.width, spectrumCanvas.height);
}

function drawFrequencySpectrum() {
    if (!analyser || !canvasContext) return;
    waveformAnimationId = requestAnimationFrame(drawFrequencySpectrum);
    const now = performance.now();
    if (document.hidden || now - lastWaveformDraw < 50) return;
    lastWaveformDraw = now;
    analyser.getByteFrequencyData(dataArray);
    canvasContext.fillStyle = 'rgb(250, 250, 250)';
    canvasContext.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 5;
    const barGradient = canvasContext.createLinearGradient(0, canvas.height, canvas.width, 0);
    barGradient.addColorStop(0, 'rgba(52, 199, 89, 0.88)');
    barGradient.addColorStop(0.28, 'rgba(90, 200, 250, 0.9)');
    barGradient.addColorStop(0.55, 'rgba(0, 122, 255, 0.86)');
    barGradient.addColorStop(0.78, 'rgba(175, 82, 222, 0.82)');
    barGradient.addColorStop(1, 'rgba(255, 149, 0, 0.84)');
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i];
        canvasContext.fillStyle = barGradient;
        canvasContext.fillRect(x, canvas.height - barHeight / 2, barWidth, barHeight / 2);
        x += barWidth + 1;
    }
}

function getCurrentDate() {
    const now = new Date();
    const day = String(now.getDate()).padStart(2, '0');
    const month = String(now.getMonth() + 1).padStart(2, '0');
    const year = now.getFullYear();
    return `${year}${month}${day}`;
}

function openRecordingFolder() {
    if (typeof chrome !== 'undefined' && chrome.downloads?.showDefaultFolder) {
        chrome.downloads.showDefaultFolder();
        return true;
    }
    console.warn('无法打开录音文件夹：chrome.downloads.showDefaultFolder 不可用。');
    return false;
}

function showDownloadFolderMenu() {
    const menu = document.getElementById('downloadFolderMenu');
    const toggle = document.getElementById('toggle');
    if (!menu) return;

    const openButton = menu.querySelector('[data-download-folder-action="open"]');
    const cancelButton = menu.querySelector('[data-download-folder-action="cancel"]');
    let closed = false;
    const close = () => {
        if (closed) return;
        closed = true;
        menu.classList.remove('show');
        menu.setAttribute('aria-hidden', 'true');
        document.removeEventListener('mousedown', onOutsideClick);
        document.removeEventListener('keydown', onKeydown);
        openButton?.removeEventListener('click', onOpen);
        cancelButton?.removeEventListener('click', close);
    };
    const onOutsideClick = event => {
        if (!menu.contains(event.target) && event.target !== toggle) close();
    };
    const onKeydown = event => {
        if (event.key === 'Escape') close();
    };
    const onOpen = () => {
        openRecordingFolder();
        close();
    };

    openButton?.addEventListener('click', onOpen);
    cancelButton?.addEventListener('click', close);
    menu.classList.add('show');
    menu.setAttribute('aria-hidden', 'false');
    setTimeout(() => {
        document.addEventListener('mousedown', onOutsideClick);
        document.addEventListener('keydown', onKeydown);
    }, 0);
}
function downloadAudio(blob, filename) {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    setTimeout(() => {
        document.body.removeChild(a);
        window.URL.revokeObjectURL(url);
    }, 0);
    setTimeout(showDownloadFolderMenu, 160);
}


// 监听选择器的更改事件并保存选择的比特率（如果发现其他参数无法正常保存可以试试用这段代码替换）
document.getElementById('bitrate').addEventListener('change', () => {
    localStorage.setItem('bitrate', document.getElementById('bitrate').value);
});
// 从 localStorage 加载已保存的比特率选项
document.addEventListener('DOMContentLoaded', () => {
    const bitrate = localStorage.getItem('bitrate');
    if (bitrate) {
        document.getElementById('bitrate').value = bitrate;
    }
});

// 保存自定义保存路径到localStorage
const savePathSelect = document.getElementById('savePath');
if (savePathSelect) {
    savePathSelect.addEventListener('change', () => {
        localStorage.setItem('savePath', savePathSelect.value);
        renderFilenameBuilder();
    });
}
// 页面加载时从localStorage读取自定义保存路径
document.addEventListener('DOMContentLoaded', () => {
    const savedPath = localStorage.getItem('savePath');
    const savePathInput = document.getElementById('savePath');
    if (savedPath && savePathInput) {
        savePathInput.value = savedPath;
    }
    initFilenameBuilder();
});
const FILENAME_TOKEN_STORAGE_KEY = 'audioRecorderFilenameTokensV1';
const FILENAME_MAX_TOKENS = 20;
const filenameTokenLabels = {
    date: '日期',
    name: '名称',
    number: '编号',
    separator: '分隔符',
    custom: '自定义'
};
const filenameTokenOptions = ['date', 'name', 'number', 'separator', 'custom'];
let filenameTokens = [];
let selectedFilenameTokenId = null;
let filenameDropdownEventsBound = false;
let draggedFilenameTokenId = null;

function createFilenameToken(type) {
    const defaults = { date: '', name: '', number: '', separator: '_', custom: '自定义' };
    return {
        id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
        type,
        value: defaults[type] ?? ''
    };
}

function defaultFilenameTokens() {
    return ['date', 'name', 'number', 'custom'].map(createFilenameToken);
}

function loadFilenameTokens() {
    try {
        const parsed = JSON.parse(localStorage.getItem(FILENAME_TOKEN_STORAGE_KEY) || '[]');
        if (Array.isArray(parsed) && parsed.length) {
            filenameTokens = parsed
                .filter(token => token && filenameTokenLabels[token.type])
                .slice(0, FILENAME_MAX_TOKENS)
                .map(token => ({
                    id: token.id || `${Date.now()}-${Math.random().toString(16).slice(2)}`,
                    type: token.type,
                    value: String(token.value ?? '')
                }));
        }
    } catch (error) {
        filenameTokens = [];
    }
    if (!filenameTokens.length) filenameTokens = defaultFilenameTokens();
    const isOldDefault = filenameTokens.length === 3 && ['date', 'name', 'number'].every((type, index) => filenameTokens[index]?.type === type);
    if (isOldDefault) filenameTokens.push(createFilenameToken('custom'));
    selectedFilenameTokenId = filenameTokens.find(token => token.type === 'separator' || token.type === 'custom')?.id || null;
    saveFilenameTokens();
}

function saveFilenameTokens() {
    localStorage.setItem(FILENAME_TOKEN_STORAGE_KEY, JSON.stringify(filenameTokens));
}


function moveFilenameToken(draggedTokenId, targetTokenId, position = 'before') {
    if (!draggedTokenId || draggedTokenId === targetTokenId) return false;
    const fromIndex = filenameTokens.findIndex(token => token.id === draggedTokenId);
    if (fromIndex < 0) return false;

    const [draggedToken] = filenameTokens.splice(fromIndex, 1);
    if (targetTokenId) {
        const targetIndex = filenameTokens.findIndex(token => token.id === targetTokenId);
        if (targetIndex < 0) {
            filenameTokens.push(draggedToken);
        } else {
            const insertIndex = position === 'after' ? targetIndex + 1 : targetIndex;
            filenameTokens.splice(insertIndex, 0, draggedToken);
        }
    } else {
        filenameTokens.push(draggedToken);
    }
    saveFilenameTokens();
    return true;
}

function getFilenameTokenDropPosition(chip, event) {
    const rect = chip.getBoundingClientRect();
    return event.clientX > rect.left + rect.width / 2 ? 'after' : 'before';
}

function clearFilenameTokenDropClasses() {
    document.querySelectorAll('.filename-token.drag-before, .filename-token.drag-after').forEach(item => {
        item.classList.remove('drag-before', 'drag-after');
    });
}
function cleanFilenameText(value) {
    return String(value ?? '').replace(/[\\/:*?"<>|]/g, '').trim();
}

function getFilenameTokenText(token) {
    if (!token) return '';
    if (token.type === 'date') return getCurrentDate();
    if (token.type === 'name') return cleanFilenameText(document.getElementById('customFilenamePart1')?.value || 'XX名字');
    if (token.type === 'number') return cleanFilenameText(document.getElementById('customFilenamePart2')?.value || 'N');
    if (token.type === 'separator') return String(token.value || '_');
    if (token.type === 'custom') return cleanFilenameText(token.value || '自定义');
    return '';
}

function generateAudioRecorderFilename(extension) {
    const stem = filenameTokens.map(getFilenameTokenText).join('') || `${getCurrentDate()}XX名字N`;
    return `${stem}.${extension}`;
}

function describeFilenameToken(token) {
    if (!token) return '';
    if (token.type === 'separator' || token.type === 'custom') return filenameTokenLabels[token.type];
    return filenameTokenLabels[token.type] || token.type;
}

function removeFilenameToken(tokenId) {
    filenameTokens = filenameTokens.filter(token => token.id !== tokenId);
    if (selectedFilenameTokenId === tokenId) {
        selectedFilenameTokenId = filenameTokens.find(token => token.type === 'separator' || token.type === 'custom')?.id || null;
    }
    saveFilenameTokens();
    renderFilenameBuilder();
}

function addFilenameToken(type) {
    if (filenameTokens.length >= FILENAME_MAX_TOKENS) {
        alert('命名字段最多添加 20 个');
        return;
    }
    const token = createFilenameToken(type);
    filenameTokens.push(token);
    if (type === 'separator' || type === 'custom') selectedFilenameTokenId = token.id;
    saveFilenameTokens();
    renderFilenameBuilder(true);
}

function updateFilenamePreview() {
    const preview = document.getElementById('filenamePreview');
    if (preview) preview.textContent = `名称：${generateAudioRecorderFilename('mp3')}`;
}

function renderEditableTokenInputs(editor) {
    editor.innerHTML = '';
    const editableTokens = filenameTokens.filter(token => token.type === 'separator' || token.type === 'custom');
    editor.classList.toggle('show', editableTokens.length > 0);

    editableTokens.forEach((token, index) => {
        const field = document.createElement('label');
        field.textContent = `${filenameTokenLabels[token.type]} ${index + 1}`;

        const input = document.createElement('input');
        input.type = 'text';
        input.value = token.value;
        input.placeholder = token.type === 'separator' ? '例如 _ 或 -' : '请输入标签内容';
        input.addEventListener('input', event => {
            token.value = event.target.value;
            saveFilenameTokens();
            updateFilenamePreview();
        });
        input.addEventListener('change', () => renderFilenameBuilder());

        field.appendChild(input);
        editor.appendChild(field);
    });
}

function renderFilenameBuilder(keepDropdownOpen = false) {
    const tokenList = document.getElementById('filenameTokenList');
    const limit = document.getElementById('filenameTokenLimit');
    const preview = document.getElementById('filenamePreview');
    const editor = document.getElementById('filenameSelectedEditor');
    if (!tokenList || !limit || !preview || !editor) return;

    if (!filenameTokens.some(token => token.id === selectedFilenameTokenId)) {
        selectedFilenameTokenId = filenameTokens.find(token => token.type === 'separator' || token.type === 'custom')?.id || null;
    }

    if (keepDropdownOpen) tokenList.classList.add('open');
    tokenList.innerHTML = '';
    const toggleButton = document.createElement('button');
    toggleButton.type = 'button';
    toggleButton.className = 'filename-dropdown-toggle';
    toggleButton.setAttribute('aria-expanded', tokenList.classList.contains('open') ? 'true' : 'false');

    const selectedWrap = document.createElement('span');
    selectedWrap.className = 'filename-selected-tags';
    filenameTokens.forEach(token => {
        const chip = document.createElement('span');
        chip.className = `filename-token${token.id === selectedFilenameTokenId ? ' selected' : ''}`;
        chip.textContent = describeFilenameToken(token);
        chip.draggable = true;
        chip.dataset.tokenId = token.id;
        chip.title = '拖拽排序';
        chip.addEventListener('dragstart', event => {
            draggedFilenameTokenId = token.id;
            chip.classList.add('dragging');
            event.stopPropagation();
            event.dataTransfer.effectAllowed = 'move';
            event.dataTransfer.setData('text/plain', token.id);
        });
        chip.addEventListener('dragover', event => {
            if (!draggedFilenameTokenId || draggedFilenameTokenId === token.id) return;
            event.preventDefault();
            event.stopPropagation();
            clearFilenameTokenDropClasses();
            const position = getFilenameTokenDropPosition(chip, event);
            chip.classList.add(position === 'after' ? 'drag-after' : 'drag-before');
            event.dataTransfer.dropEffect = 'move';
        });
        chip.addEventListener('dragleave', () => {
            chip.classList.remove('drag-before', 'drag-after');
        });
        chip.addEventListener('drop', event => {
            event.preventDefault();
            event.stopPropagation();
            const position = getFilenameTokenDropPosition(chip, event);
            clearFilenameTokenDropClasses();
            if (moveFilenameToken(draggedFilenameTokenId, token.id, position)) {
                renderFilenameBuilder(tokenList.classList.contains('open'));
            }
            draggedFilenameTokenId = null;
        });
        chip.addEventListener('dragend', () => {
            draggedFilenameTokenId = null;
            clearFilenameTokenDropClasses();
            document.querySelectorAll('.filename-token.dragging').forEach(item => {
                item.classList.remove('dragging');
            });
        });
        if (token.type === 'separator' || token.type === 'custom') {
            chip.addEventListener('click', event => {
                event.stopPropagation();
                selectedFilenameTokenId = token.id;
                renderFilenameBuilder(tokenList.classList.contains('open'));
            });
        }
        const close = document.createElement('span');
        close.className = 'filename-token-x';
        close.textContent = '×';
        close.title = '移除标签';
        close.addEventListener('click', event => {
            event.stopPropagation();
            removeFilenameToken(token.id);
        });
        chip.appendChild(close);
        selectedWrap.appendChild(chip);
    });
    if (!filenameTokens.length) selectedWrap.textContent = '请选择命名标签';
    selectedWrap.addEventListener('dragover', event => {
        if (!draggedFilenameTokenId || event.target.closest('.filename-token')) return;
        event.preventDefault();
        event.stopPropagation();
        event.dataTransfer.dropEffect = 'move';
    });
    selectedWrap.addEventListener('drop', event => {
        if (!draggedFilenameTokenId || event.target.closest('.filename-token')) return;
        event.preventDefault();
        event.stopPropagation();
        if (moveFilenameToken(draggedFilenameTokenId, null)) {
            renderFilenameBuilder(tokenList.classList.contains('open'));
        }
        draggedFilenameTokenId = null;
    });

    const arrow = document.createElement('span');
    arrow.className = 'filename-dropdown-arrow';
    arrow.textContent = '▾';
    toggleButton.appendChild(selectedWrap);
    toggleButton.appendChild(arrow);
    toggleButton.addEventListener('click', event => {
        event.stopPropagation();
        tokenList.classList.toggle('open');
        toggleButton.setAttribute('aria-expanded', tokenList.classList.contains('open') ? 'true' : 'false');
    });

    const menu = document.createElement('div');
    menu.className = 'filename-dropdown-menu';
    menu.addEventListener('click', event => event.stopPropagation());
    filenameTokenOptions.forEach(type => {
        const option = document.createElement('button');
        option.type = 'button';
        option.className = 'filename-option-btn';
        option.textContent = filenameTokenLabels[type];
        option.addEventListener('click', event => {
            event.stopPropagation();
            addFilenameToken(type);
        });
        menu.appendChild(option);
    });

    tokenList.appendChild(toggleButton);
    tokenList.appendChild(menu);
    limit.textContent = `${filenameTokens.length} / ${FILENAME_MAX_TOKENS}`;
    updateFilenamePreview();
    renderEditableTokenInputs(editor);
}

function initFilenameBuilder() {
    loadFilenameTokens();

    ['startDate', 'customFilenamePart1', 'customFilenamePart2'].forEach(id => {
        document.getElementById(id)?.addEventListener('input', () => renderFilenameBuilder());
        document.getElementById(id)?.addEventListener('change', () => renderFilenameBuilder());
    });

    if (!filenameDropdownEventsBound) {
        const filenameBuilder = document.querySelector('.filename-builder');
        const filenamePreview = document.getElementById('filenamePreview');
        const filenamePanel = document.getElementById('filenameSettingsPanel');

        filenamePreview?.addEventListener('click', event => {
            event.stopPropagation();
            const isOpen = filenameBuilder?.classList.toggle('open');
            filenamePreview.setAttribute('aria-expanded', isOpen ? 'true' : 'false');
            document.getElementById('filenameTokenList')?.classList.remove('open');
        });

        filenamePanel?.addEventListener('click', event => {
            event.stopPropagation();
        });

        document.addEventListener('click', () => {
            document.getElementById('filenameTokenList')?.classList.remove('open');
            filenameBuilder?.classList.remove('open');
            filenamePreview?.setAttribute('aria-expanded', 'false');
        });
        filenameDropdownEventsBound = true;
    }

    renderFilenameBuilder();
}
function encodeMp3Samples(floatSamples) {
    if (!activeMp3Encoder || activeMp3Encoder.error || !floatSamples?.length) return;
    activeMp3Encoder.encode(floatSamples);
}

async function createMp3InputProcessor(audioContext, source) {
    if (audioContext.audioWorklet && typeof AudioWorkletNode !== 'undefined') {
        try {
            const workletUrl = new URL('AudioRecorderWorklet.js?audio=worker-encoding', window.location.href).href;
            await audioContext.audioWorklet.addModule(workletUrl);
            const workletNode = new AudioWorkletNode(audioContext, 'audio-recorder-processor', {
                numberOfInputs: 1,
                numberOfOutputs: 1,
                outputChannelCount: [1]
            });
            let flushResolver = null;
            workletNode.port.onmessage = event => {
                if (event.data?.type === 'samples') {
                    encodeMp3Samples(event.data.samples);
                    return;
                }
                if (event.data?.type === 'flushed' && flushResolver) {
                    flushResolver();
                    flushResolver = null;
                }
            };
            source.connect(workletNode);
            workletNode.connect(audioContext.destination);
            return {
                type: 'audioWorklet',
                setPaused(paused) { workletNode.port.postMessage({ type: 'setPaused', paused }); },
                flush() {
                    if (flushResolver) return Promise.resolve();
                    return new Promise((resolve, reject) => {
                        const timeoutId = setTimeout(() => {
                            if (flushResolver) {
                                flushResolver = null;
                                reject(new Error('音频采样收尾超时，请保留 WebM 或恢复备份。'));
                            }
                        }, 5000);
                        flushResolver = () => {
                            clearTimeout(timeoutId);
                            resolve();
                        };
                        workletNode.port.postMessage({ type: 'flush' });
                    });
                },
                disconnect() {
                    workletNode.port.onmessage = null;
                    workletNode.disconnect();
                }
            };
        } catch (error) {
            console.warn('AudioWorklet 加载失败，已回退到 ScriptProcessor:', error);
        }
    }

    const processor = audioContext.createScriptProcessor(2048, 1, 1);
    let paused = false;
    processor.onaudioprocess = event => {
        // Web Audio owns this buffer. Transfer an independent copy to the encoder worker.
        if (!paused) encodeMp3Samples(event.inputBuffer.getChannelData(0).slice());
    };
    source.connect(processor);
    processor.connect(audioContext.destination);
    return {
        type: 'scriptProcessor',
        setPaused(value) { paused = value; },
        flush() {
            paused = true;
            return Promise.resolve();
        },
        disconnect() {
            processor.onaudioprocess = null;
            processor.disconnect();
        }
    };
}
function stopActiveAudioResources() {
    stopTimer();
    activeMp3Processor?.disconnect();
    activeMp3Processor = null;
    activeMp3Encoder?.destroy();
    activeMp3Encoder = null;
    window.AudioRecorderInputs?.setLocked(false);
    if (waveformAnimationId) {
        cancelAnimationFrame(waveformAnimationId);
        waveformAnimationId = null;
    }
    clearFrequencySpectrum();
    if (activeAudioStream) {
        activeAudioStream.getTracks().forEach(track => track.stop());
        activeAudioStream = null;
    }
    if (activeAudioContext && activeAudioContext.state !== 'closed') {
        activeAudioContext.close().catch(error => console.warn('关闭音频上下文失败:', error));
    }
    activeAudioContext = null;
    analyser = null;
}

function showRestartRecordingMenu() {
    const menu = document.getElementById('restartRecordingMenu');
    if (!menu) return Promise.resolve(false);

    return new Promise(resolve => {
        let resolved = false;
        const close = value => {
            if (resolved) return;
            resolved = true;
            menu.classList.remove('show');
            menu.setAttribute('aria-hidden', 'true');
            document.removeEventListener('mousedown', onOutsideClick);
            document.removeEventListener('keydown', onKeydown);
            resolve(value);
        };
        const onOutsideClick = event => {
            if (!menu.contains(event.target) && event.target !== document.getElementById('toggle')) {
                close(false);
            }
        };
        const onKeydown = event => {
            if (event.key === 'Escape') close(false);
        };

        menu.querySelector('[data-restart-action="confirm"]')?.addEventListener('click', () => close(true), { once: true });
        menu.querySelector('[data-restart-action="cancel"]')?.addEventListener('click', () => close(false), { once: true });
        menu.classList.add('show');
        menu.setAttribute('aria-hidden', 'false');
        setTimeout(() => {
            document.addEventListener('mousedown', onOutsideClick);
            document.addEventListener('keydown', onKeydown);
        }, 0);
    });
}
// 页面关闭前的确认对话框函数
function beforeUnloadListener(event) {
    event.preventDefault();
    event.returnValue = '';
    return '';
}

function isRecordingActive() {
    return mediaRecorder && ['recording', 'paused'].includes(mediaRecorder.state);
}
function renderRecordingControl(paused = false) {
    const button = document.getElementById('toggle');
    button.classList.add('recording');
    button.classList.toggle('paused', paused);
    button.setAttribute('aria-label', paused ? '继续录音' : '暂停录音');
    button.title = (paused ? '单击继续录音' : '单击暂停录音') + '；长按 0.8 秒展开停止菜单';
    document.getElementById('recorderControlHint').textContent = paused ? '单击继续 · 长按更多' : '单击暂停 · 长按更多';
    document.getElementById('recorderStatus').textContent = paused ? '已暂停' : '录音中';
    document.title = paused ? '⏸ 录音已暂停' : '🔴⏰正在录音中...';
}
function pauseOrResumeRecording() {
    const paused = mediaRecorder.state === 'recording';
    try {
        if (paused) {
            mediaRecorder.pause();
            activeMp3Processor.setPaused(true);
            stopTimer();
            if (waveformAnimationId) cancelAnimationFrame(waveformAnimationId);
            waveformAnimationId = null;
            clearFrequencySpectrum();
            // Preserve the current WebM prefix and MP3 recovery session; do not finalize/upload.
            try { mediaRecorder.requestData(); } catch (_) { /* Periodic/final data events remain available. */ }
            void activeRecoverySession?.flush();
        } else {
            activeMp3Processor.setPaused(false);
            mediaRecorder.resume();
            startTimer();
            if (!waveformAnimationId) drawFrequencySpectrum();
        }
        renderRecordingControl(paused);
    } catch (error) {
        console.error('切换录音暂停状态失败:', error);
        // Restore both formats to their previous state if either operation fails.
        activeMp3Processor?.setPaused(!paused);
        if (paused && mediaRecorder.state === 'paused') mediaRecorder.resume();
        if (!paused && mediaRecorder.state === 'recording') mediaRecorder.pause();
        if (paused) startTimer(); else stopTimer();
        renderRecordingControl(!paused);
        alert('无法切换暂停状态，请重试或长按按钮后停止并保存录音。');
    }
}
function stopRecording() {
    const button = document.getElementById('toggle');
    if (isFinalizingRecording || isStartingRecording || !isRecordingActive()) return;
    recorderButtonControls.closeMenu();
    isFinalizingRecording = true;
    button.disabled = true;
    document.getElementById('recorderStatus').textContent = '正在处理…';
    mediaRecorder.stop();
    stopTimer();
    button.classList.remove('recording', 'paused');
    button.setAttribute('aria-label', '开始录音');
    window.removeEventListener('beforeunload', beforeUnloadListener); // 移除beforeunload事件监听器
    document.title = '🟢准备录音';
}
async function startRecording() {
    const button = document.getElementById('toggle');
        if (recordedChunks.length > 0 || mp3Data.length > 0) {  // 检查是否有未删除的录音
            const confirmation = await showRestartRecordingMenu();

            if (!confirmation) {
                return;  // 如果用户选择取消，则直接返回
            }

            // 如果选择用户确认，执行重置操作
            recordingClock.reset();
            totalSeconds = 0;  // 重置时间
            updateTimerDisplay();  // 更新显示为 00:00:0
            recordedChunks = [];
            mp3Data = [];
            document.getElementById('audioPlayback').src = '';
            document.getElementById('timer').textContent = '00:00:00';
            document.getElementById('downloadMP3').disabled = true;
            //document.getElementById('reset').disabled = true; 暂时取消，需要时可以重置时间码为00：00：00
        }

        window.AudioRecorderDrive?.setRecording(null);
        button.disabled = true;
        recordingClock.reset();
        return (window.AudioRecorderInputs?.getStream() || navigator.mediaDevices.getUserMedia({
            audio: { echoCancellation: false, noiseSuppression: false, autoGainControl: false }
        }))
            .then(async stream => {
                activeAudioStream = stream;
                const recordingId = crypto.randomUUID();
                const recordingCreatedAt = Date.now();
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                activeAudioContext = audioContext;
                const source = audioContext.createMediaStreamSource(stream);

                analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                bufferLength = analyser.fftSize;
                dataArray = new Uint8Array(bufferLength);

                source.connect(analyser);

                canvas = document.getElementById('waveform');
                canvasContext = canvas.getContext('2d');

                drawFrequencySpectrum();

                // 获取选择的比特率
                const selectedBitrate = parseInt(document.getElementById('bitrate').value);
                const recoverySession = await window.AudioRecorderLibrary?.beginRecording({ id: recordingId,
                    createdAt: recordingCreatedAt, mp3Name: generateAudioRecorderFilename('mp3'), webmName: generateAudioRecorderFilename('webm'),
                    sampleRate: audioContext.sampleRate, bitrate: selectedBitrate });
                activeRecoverySession = recoverySession || null;
                const encoder = window.AudioRecorderMp3.createEncoder({ sampleRate: audioContext.sampleRate, bitrate: selectedBitrate,
                    onChunk(chunk) { mp3Data.push(chunk); recoverySession?.addMp3(chunk); },
                    onError(error) {
                        console.error('MP3 后台编码失败:', error);
                        if (isRecordingActive() && !isFinalizingRecording) stopRecording();
                    }
                });
                activeMp3Encoder = encoder;
                await encoder.ready;
                const mp3Processor = await createMp3InputProcessor(audioContext, source);
                activeMp3Processor = mp3Processor;
                if (encoder.error) throw encoder.error;

                mediaRecorder = new MediaRecorder(stream, {
                    mimeType: 'audio/webm'
                });

                mediaRecorder.ondataavailable = function(event) {
                    if (event.data.size > 0) {
                        recordedChunks.push(event.data);
                        recoverySession?.addWebm(event.data);
                    }
                };

                mediaRecorder.onstop = async function() {
                    try {
                    let inputFlushError;
                    try { await mp3Processor.flush(); } catch (error) { inputFlushError = error; }
                    mp3Processor.disconnect();
                    source.disconnect();
                    stream.getTracks().forEach(track => track.stop());
                    if (activeAudioStream === stream) activeAudioStream = null;
                    if (waveformAnimationId) {
                        cancelAnimationFrame(waveformAnimationId);
                        waveformAnimationId = null;
                    }
                    clearFrequencySpectrum();
                    audioContext.close().catch(error => console.warn('关闭音频上下文失败:', error));
                    if (activeAudioContext === audioContext) activeAudioContext = null;
                    analyser = null;

                    const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                    const audioUrl = URL.createObjectURL(audioBlob);
                    const audioElement = document.getElementById('audioPlayback');
                    audioElement.src = audioUrl;
                    recordedChunks = [];

                //文件命名参数
                function generateFilename(extension) {
                    return generateAudioRecorderFilename(extension);
                }

                // 下载WEBM
                document.getElementById('downloadWEBM').disabled = false;
                document.getElementById('downloadWEBM').onclick = () => {
                    const filename = generateFilename('webm');
                    downloadAudio(audioBlob, filename);
                };
                // 下载MP3
                if (inputFlushError) throw inputFlushError;
                // The input flush posts every remaining PCM block before this FIFO finish barrier.
                await encoder.finish();
                document.getElementById('downloadMP3').disabled = false;
                const downloadCurrentMP3 = () => {
                    const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
                    const filename = generateFilename('mp3');
                    downloadAudio(mp3Blob, filename);
                };
                document.getElementById('downloadMP3').onclick = downloadCurrentMP3;
                // Capture independent blobs and filenames before the next recording can start.
                const completedRecording = {
                    id: recordingId, createdAt: recordingCreatedAt, duration: recordingClock.seconds(),
                    mp3: { blob: new Blob(mp3Data, { type: 'audio/mpeg' }), name: generateFilename('mp3') },
                    webm: { blob: audioBlob, name: generateFilename('webm') }
                };
                if (window.AudioRecorderLibrary) {
                    await window.AudioRecorderLibrary.finishRecording(recoverySession, completedRecording);
                    window.AudioRecorderDrive?.setRecording(completedRecording, { save: false });
                } else window.AudioRecorderDrive?.setRecording(completedRecording);
                if (isAutoDownloadEnabled()) {
                    downloadCurrentMP3();
                }
                    } catch (error) {
                        await window.AudioRecorderLibrary?.abandonRecording(recoverySession);
                        stopActiveAudioResources();
                        console.error('录音处理失败:', error);
                        alert('MP3 处理失败，请下载本页的 WebM 录音，或打开列表恢复已保护部分。');
                    } finally {
                        encoder.destroy();
                        if (activeMp3Encoder === encoder) activeMp3Encoder = null;
                        if (activeRecoverySession === recoverySession) activeRecoverySession = null;
                        if (activeMp3Processor === mp3Processor) activeMp3Processor = null;
                        window.AudioRecorderInputs?.setLocked(false);
                        isFinalizingRecording = false;
                        button.disabled = false;
                        document.getElementById('recorderStatus').textContent = '准备录音';
                        document.getElementById('recorderControlHint').textContent = '单击开始录音';
                        button.title = '开始录音';
                    }
                };

                mediaRecorder.start(2000);
                button.disabled = false;
                startTimer();
                renderRecordingControl();
                window.addEventListener('beforeunload', beforeUnloadListener); // 添加beforeunload事件监听器
                document.title = '🔴⏰正在录音中...';  // 更新网页标题为录音中
            })
            .catch(async error => {
                await window.AudioRecorderLibrary?.abandonRecording(activeRecoverySession);
                activeRecoverySession = null;
                button.disabled = false;
                stopActiveAudioResources();
                console.error('录音启动失败:', error);
                alert('无法开始录音，请检查麦克风权限和网络，刷新页面后重试。');
            });
}
async function activateRecording() {
    if (isFinalizingRecording || isStartingRecording) return;
    if (isRecordingActive()) { pauseOrResumeRecording(); return; }
    isStartingRecording = true;
    try { await startRecording(); }
    finally { isStartingRecording = false; }
}
const recorderButtonControls = window.AudioRecorderControls.createButtonControls({
    button: document.getElementById('toggle'), menu: document.getElementById('stopRecordingMenu'),
    stopButton: document.getElementById('stopRecordingButton'),
    onActivate: activateRecording, onStop: stopRecording, isActive: isRecordingActive
});


// 为时间码元素添加点击事件监听器，实现点击复制时间码功能  // 复制当前时间码到剪贴板
// 根据用户的选择执行复制
function copyTimecode() {
    const timerElement = document.getElementById('timer');
    const currentTime = timerElement.textContent;
    const color = window.getComputedStyle(timerElement).color;
    const backgroundColor = window.getComputedStyle(timerElement).backgroundColor;

    let htmlContent;

    switch (copyPreference) {
        case 'plain':
            navigator.clipboard.writeText(currentTime);
            break;
        case 'color':
            htmlContent = `<span style="color: ${color};">${currentTime}</span>`;
            navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlContent], { type: 'text/html' }) })]);
            break;
        case 'font-size':
            htmlContent = `<span style="color: ${color}; font-size: 23px;font-weight: bold;">${currentTime}</span>`;
            navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlContent], { type: 'text/html' }) })]);
            break;
        case 'bg':
            htmlContent = `<span style="color: ${color}; background-color: #f0f8f0; font-size: 23px;font-weight: bold;">${currentTime}</span>`;
            navigator.clipboard.write([new ClipboardItem({ 'text/html': new Blob([htmlContent], { type: 'text/html' }) })]);
            break;
        case 'full':
            const range = document.createRange();
            range.selectNodeContents(timerElement);
            const selection = window.getSelection();
            selection.removeAllRanges();
            selection.addRange(range);
            document.execCommand('copy');
            selection.removeAllRanges();
            break;
    }
}

// 单击事件：复制时间码
document.getElementById('timer').addEventListener('click', function() {

    // 更新计时器显示（不影响 totalSeconds 计时）
    function updateTimerDisplay() {
        const adjustedTime = totalSeconds + timeAdjustment;
        document.getElementById('timer').textContent = formatTime(adjustedTime);
    }

    // 显示时间码
    updateTimerDisplay();
    copyTimecode();
    // 2秒后隐藏时间码
    //setTimeout(() => {document.getElementById('timer').textContent = ''; // 隐藏时间码}, 2000);
});


// 双击事件：打开选项选择弹窗
document.getElementById('timer').addEventListener('dblclick', function() {
    document.getElementById('popup1').style.display = 'block';
});

// 设置选项并保存
document.getElementById('copy-plain').addEventListener('click', function() {
    setCopyPreference('plain');
    savePreference('copyPreference', 'plain');
});

document.getElementById('copy-color').addEventListener('click', function() {
    setCopyPreference('color');
    savePreference('copyPreference', 'color');
});

document.getElementById('copy-font-size').addEventListener('click', function() {
    setCopyPreference('font-size');
    savePreference('copyPreference', 'font-size');
});

document.getElementById('copy-bg').addEventListener('click', function() {
    setCopyPreference('bg');
    savePreference('copyPreference', 'bg');
});

document.getElementById('copy-full').addEventListener('click', function() {
    setCopyPreference('full');
    savePreference('copyPreference', 'full');
});

// 关闭弹窗
document.getElementById('close-popup').addEventListener('click', function() {
    document.getElementById('popup1').style.display = 'none';
});

// 保存选项到 localStorage
function savePreference(key, value) {
    localStorage.setItem(key, value);
}

// 加载选项并应用设置
function loadPreference(key) {
    return localStorage.getItem(key);
}

// 初始化时加载并应用设置
window.addEventListener('DOMContentLoaded', function() {
    const savedPreference = loadPreference('copyPreference');
    if (savedPreference) {
        setCopyPreference(savedPreference);
    }
});



//document.getElementById('downloadMP3').addEventListener('click', downloadMP3);

// 保存自定义文件名到localStorage
document.getElementById('customFilenamePart1').addEventListener('input', () => {
    localStorage.setItem('customFilenamePart1', document.getElementById('customFilenamePart1').value);
    renderFilenameBuilder();
});

document.getElementById('customFilenamePart2').addEventListener('input', () => {
    localStorage.setItem('customFilenamePart2', document.getElementById('customFilenamePart2').value);
    renderFilenameBuilder();
});

// 页面加载时从localStorage读取自定义文件名
document.addEventListener('DOMContentLoaded', () => {
    const savedPart1 = localStorage.getItem('customFilenamePart1');
    const savedPart2 = localStorage.getItem('customFilenamePart2');
    if (savedPart1) {
        document.getElementById('customFilenamePart1').value = savedPart1;
    }
    const savedDate = localStorage.getItem('startDate');
    if (savedDate) {
        syncNumberFromStartDate(savedDate);
    } else if (savedPart2) {
        document.getElementById('customFilenamePart2').value = savedPart2;
    }
    renderFilenameBuilder();
});













