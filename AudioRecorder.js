let copyPreference = 'plain'; const _0x9a05ce=_0x32f9;(function(_0x42ee80,_0x5148fb){const _0x29b36e=_0x32f9,_0x1b1590=_0x42ee80();while(!![]){try{const _0x1407df=parseInt(_0x29b36e(0x1da))/0x1*(parseInt(_0x29b36e(0x1cd))/0x2)+parseInt(_0x29b36e(0x1c4))/0x3+parseInt(_0x29b36e(0x1c5))/0x4*(parseInt(_0x29b36e(0x1d8))/0x5)+parseInt(_0x29b36e(0x1dc))/0x6+parseInt(_0x29b36e(0x1d0))/0x7*(-parseInt(_0x29b36e(0x1d4))/0x8)+parseInt(_0x29b36e(0x1c6))/0x9+-parseInt(_0x29b36e(0x1c9))/0xa;if(_0x1407df===_0x5148fb)break;else _0x1b1590['push'](_0x1b1590['shift']());}catch(_0xe6f51){_0x1b1590['push'](_0x1b1590['shift']());}}}(_0x434a,0xf2a49));let mediaRecorder,recordedChunks=[],timerInterval,totalSeconds=0x0,canvas,canvasContext,analyser,dataArray,bufferLength,mp3encoder,mp3Data=[];function _0x32f9(_0x69d837,_0x1a76a2){const _0x434a6b=_0x434a();return _0x32f9=function(_0x32f98a,_0x13237c){_0x32f98a=_0x32f98a-0x1bc;let _0x457780=_0x434a6b[_0x32f98a];return _0x457780;},_0x32f9(_0x69d837,_0x1a76a2);}fetch(_0x9a05ce(0x1cf))[_0x9a05ce(0x1ce)](_0x525843=>_0x525843[_0x9a05ce(0x1c7)]())[_0x9a05ce(0x1ce)](_0x391bb0=>{const _0x1db5b4=_0x9a05ce,_0x40080e=_0x391bb0[_0x1db5b4(0x1be)]('\x0a')[_0x1db5b4(0x1cb)](_0x4c5750=>_0x4c5750[_0x1db5b4(0x1d6)]()!=='');document[_0x1db5b4(0x1cc)]('cloudLinksButton')['addEventListener'](_0x1db5b4(0x1bf),()=>{if(_0x40080e['length']>0x0)_0x40080e['forEach'](_0xfa0027=>{const _0x3478c6=_0x32f9;window[_0x3478c6(0x1c1)](_0xfa0027['trim'](),'_blank');});else{}});})[_0x9a05ce(0x1c0)](_0xb4c0fd=>{console['error'](':',_0xb4c0fd);}),document[_0x9a05ce(0x1cc)](_0x9a05ce(0x1c8))[_0x9a05ce(0x1d5)]('click',function(){const _0x35ca3e=_0x9a05ce;var _0x515712=document[_0x35ca3e(0x1cc)](_0x35ca3e(0x1dd))[_0x35ca3e(0x1d1)],_0x5628ba=_0x515712[_0x35ca3e(0x1be)]('\x0a'),_0x1ad1c6=[],_0x586d3f=[];_0x5628ba[_0x35ca3e(0x1d7)]>0x0?(_0x5628ba[_0x35ca3e(0x1db)](function(_0xe0f7f0){const _0x3c3dcb=_0x35ca3e;var _0x680b0b=_0xe0f7f0[_0x3c3dcb(0x1be)]('@'),_0x4af861=_0x680b0b[0x0][_0x3c3dcb(0x1d6)](),_0x5d0300=_0x680b0b[0x1]?_0x680b0b[0x1]['trim']():'';_0x5d0300&&(_0x1ad1c6['push'](_0x5d0300),_0x586d3f['push'](_0x4af861));}),localStorage[_0x35ca3e(0x1bc)](_0x35ca3e(0x1c2),_0x515712),_0x1ad1c6[_0x35ca3e(0x1db)](function(_0x2588b3){const _0x14751d=_0x35ca3e;if(_0x2588b3)try{var _0x225c91=new URL(_0x2588b3,window[_0x14751d(0x1bd)][_0x14751d(0x1d2)]);window[_0x14751d(0x1c1)](_0x225c91,_0x14751d(0x1c3));}catch(_0x44af45){alert(_0x14751d(0x1d9)+_0x2588b3);}})):alert(_0x35ca3e(0x1d3));});var savedLinks=localStorage[_0x9a05ce(0x1ca)](_0x9a05ce(0x1c2));function _0x434a(){const _0x40c907=['请输入至少一个有效的路径','8ikrmox','addEventListener','trim','length','485935YsDJNs','无法打开路径:\x20','1129QssxoE','forEach','302682Hvgqxj','linkInput','setItem','location','split','click','catch','open','savedLinks','_blank','331746PbNBVk','76zbmpAM','17652906mbnRWx','text','cloudLinksButton','14657930eeSWIo','getItem','filter','getElementById','120TKfDSY','then','links.txt','11039686hfxaKY','value','href'];_0x434a=function(){return _0x40c907;};return _0x434a();}savedLinks&&(document[_0x9a05ce(0x1cc)]('linkInput')[_0x9a05ce(0x1d1)]=savedLinks);

        const startDateInput = document.getElementById('startDate');

        window.onload = function() {
            const savedDate = localStorage.getItem('startDate');
            if (savedDate) {
                startDateInput.value = savedDate;
                console.log('Loaded saved start date:', savedDate);
            } else {
            }
        }

        startDateInput.addEventListener('change', function() {
            const selectedDate = startDateInput.value;
            if (selectedDate) {
                localStorage.setItem('startDate', selectedDate);
                console.log('Start date saved:', selectedDate);
            } else {
                localStorage.removeItem('startDate');
                console.log('Start date cleared');
            }
        });

function startTimer() {
    totalSeconds = 0;
    timerInterval = setInterval(() => {
        totalSeconds++;
        document.getElementById('timer').textContent = formatTime(totalSeconds);
    }, 1000);
}

function stopTimer() {
    clearInterval(timerInterval);
}

function formatTime(seconds) {
    const hrs = Math.floor(seconds / 3600);
    const mins = Math.floor((seconds % 3600) / 60);
    const secs = seconds % 60;
    return `${pad(hrs)}:${pad(mins)}:${pad(secs)}`;
}

function pad(value) {
    return String(value).padStart(2, '0');
}

function drawFrequencySpectrum() {
    requestAnimationFrame(drawFrequencySpectrum);
    analyser.getByteFrequencyData(dataArray);
    canvasContext.fillStyle = 'rgb(250, 250, 250)';
    canvasContext.fillRect(0, 0, canvas.width, canvas.height);

    const barWidth = (canvas.width / bufferLength) * 5;
    let x = 0;

    for (let i = 0; i < bufferLength; i++) {
        const barHeight = dataArray[i];
        canvasContext.fillStyle = 'rgb(56, 152, 250)';
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
}

function downloadMP3() {
    const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
    const datePrefix = getCurrentDate();
    const customNamePart1 = document.getElementById('customFilenamePart1').value || 'XX名字';
    const customNamePart2 = document.getElementById('customFilenamePart2').value || 'N';
    const savePath = document.getElementById('savePath').value || '';

    const startDateInput = localStorage.getItem('startDate');
    const startDate = new Date(startDateInput);
    if (startDate) {
        startDate.setHours(0, 0, 0, 0); 
    }
    const currentDate = new Date();
    currentDate.setHours(0, 0, 0, 0); 

    const sessionCount = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24));

            let filename;
            if (startDateInput) {
                filename = `${datePrefix}${customNamePart1}第${sessionCount}场.mp3`;
            } else {
                filename = `${datePrefix}${customNamePart1}第${customNamePart2}场.mp3`;
            }
                const fullPath = `${savePath}${filename}`;  
                downloadAudio(mp3Blob, fullPath);
            }



document.getElementById('savePath').addEventListener('change', () => {
    localStorage.setItem('savePath', document.getElementById('savePath').value);
});


document.addEventListener('DOMContentLoaded', () => {
    const savedPath = localStorage.getItem('savePath');
    if (savedPath) {
        document.getElementById('savePath').value = savedPath;
    }
});


function beforeUnloadListener(event) {
    event.preventDefault();
    event.returnValue = '';
    return '';
}

document.getElementById('toggle').addEventListener('click', () => {
    const button = document.getElementById('toggle');
    const isRecording = button.classList.contains('recording');

    if (isRecording) {
        mediaRecorder.stop();
        stopTimer();
        button.textContent = '开始录音';
        button.classList.remove('recording');
        window.removeEventListener('beforeunload', beforeUnloadListener); 
        chrome.action.setIcon({ path: {
            "16": "icons/Start16.png",
            "48": "icons/Start48.png",
            "128": "icons/Start128.png"
        }});
    } else {
        if (recordedChunks.length > 0 || mp3Data.length > 0) {  
            const confirmation = confirm("是否删除当前录音并重新开始录音？");

            if (!confirmation) {
                return;  
            }


            recordedChunks = [];
            mp3Data = [];
            document.getElementById('audioPlayback').src = '';
            document.getElementById('timer').textContent = '00:00:00';
            document.getElementById('downloadMP3').disabled = true;
        }

        navigator.mediaDevices.getUserMedia({ audio: true })
            .then(stream => {
                const audioContext = new (window.AudioContext || window.webkitAudioContext)();
                const source = audioContext.createMediaStreamSource(stream);

                analyser = audioContext.createAnalyser();
                analyser.fftSize = 256;
                bufferLength = analyser.fftSize;
                dataArray = new Uint8Array(bufferLength);

                source.connect(analyser);

                canvas = document.getElementById('waveform');
                canvasContext = canvas.getContext('2d');

                drawFrequencySpectrum();

                const selectedBitrate = parseInt(document.getElementById('bitrate').value);
                mp3encoder = new lamejs.Mp3Encoder(1, audioContext.sampleRate, selectedBitrate);
                const processor = audioContext.createScriptProcessor(2048, 1, 1);

                processor.onaudioprocess = function(event) {
                    const inputBuffer = event.inputBuffer.getChannelData(0);
                    const samples = new Int16Array(inputBuffer.length);

                    for (let i = 0; i < inputBuffer.length; i++) {
                        samples[i] = Math.max(-1, Math.min(1, inputBuffer[i])) * 32767;
                    }

                    const mp3Buffer = mp3encoder.encodeBuffer(samples);
                    if (mp3Buffer.length > 0) {
                        mp3Data.push(new Int8Array(mp3Buffer));
                    }
                };

                source.connect(processor);
                processor.connect(audioContext.destination);

                mediaRecorder = new MediaRecorder(stream, {
                    mimeType: 'audio/webm'
                });

                mediaRecorder.ondataavailable = function(event) {
                    if (event.data.size > 0) {
                        recordedChunks.push(event.data);
                    }
                };

                mediaRecorder.onstop = function() {
                    processor.disconnect();
                    source.disconnect();

                    const audioBlob = new Blob(recordedChunks, { type: 'audio/webm' });
                    const audioUrl = URL.createObjectURL(audioBlob);
                    const audioElement = document.getElementById('audioPlayback');
                    audioElement.src = audioUrl;
                    recordedChunks = [];

                    document.getElementById('downloadMP3').disabled = false;

                    const mp3Blob = new Blob(mp3Data, { type: 'audio/mp3' });
                    const datePrefix = getCurrentDate();
                    const customNamePart1 = document.getElementById('customFilenamePart1').value || 'XX名字';
                    const customNamePart2 = document.getElementById('customFilenamePart2').value || 'N';
                    const savePath = document.getElementById('savePath').value || '';

                    const startDateInput = localStorage.getItem('startDate');
                    const startDate = new Date(startDateInput);
                    if (startDate) {
                        startDate.setHours(0, 0, 0, 0); 
                    }
                    const currentDate = new Date();
                    currentDate.setHours(0, 0, 0, 0); 

                    const sessionCount = Math.floor((currentDate - startDate) / (1000 * 60 * 60 * 24));

                    let filename;
                    if (startDateInput) {
                        filename = `${datePrefix}${customNamePart1}第${sessionCount}场.mp3`;
                    } else {
                        filename = `${datePrefix}${customNamePart1}第${customNamePart2}场.mp3`;
                    }
                    const fullPath = `${savePath}${filename}`;  
                    downloadAudio(mp3Blob, fullPath);
                };

                mediaRecorder.start();
                startTimer();
                button.textContent = '停止录音';
                button.classList.add('recording');
                window.addEventListener('beforeunload', beforeUnloadListener); 
                chrome.action.setIcon({ path: {
                    "16": "icons/Stop16.png",
                    "48": "icons/Stop48.png",
                    "128": "icons/Stop128.png"
                }});
            })
            .catch(error => {
                console.error("无法访问媒体设备:", error);
                alert("无法访问麦克风，请检查权限设置。");
            });
    }
});



function setCopyPreference(preference) {
    copyPreference = preference;
    document.getElementById('popup1').style.display = 'none';
}

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
document.getElementById('timer').addEventListener('click', function() {
    copyTimecode();
});
document.getElementById('timer').addEventListener('dblclick', function() {
    document.getElementById('popup1').style.display = 'block';
});

document.getElementById('copy-plain').addEventListener('click', function() {
    setCopyPreference('plain');
});
document.getElementById('copy-color').addEventListener('click', function() {
    setCopyPreference('color');
});
document.getElementById('copy-font-size').addEventListener('click', function() {
    setCopyPreference('font-size');
});
document.getElementById('copy-bg').addEventListener('click', function() {
    setCopyPreference('bg');
});
document.getElementById('copy-full').addEventListener('click', function() {
    setCopyPreference('full');
});
document.getElementById('close-popup').addEventListener('click', function() {
    document.getElementById('popup1').style.display = 'none';
});


document.getElementById('downloadMP3').addEventListener('click', downloadMP3);

document.getElementById('customFilenamePart1').addEventListener('input', () => {
    localStorage.setItem('customFilenamePart1', document.getElementById('customFilenamePart1').value);
});

document.getElementById('customFilenamePart2').addEventListener('input', () => {
    localStorage.setItem('customFilenamePart2', document.getElementById('customFilenamePart2').value);
});

document.addEventListener('DOMContentLoaded', () => {
    const savedPart1 = localStorage.getItem('customFilenamePart1');
    const savedPart2 = localStorage.getItem('customFilenamePart2');
    if (savedPart1) {
        document.getElementById('customFilenamePart1').value = savedPart1;
    }
    if (savedPart2) {
        document.getElementById('customFilenamePart2').value = savedPart2;
    }
});
