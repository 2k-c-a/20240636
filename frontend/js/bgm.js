const bgm = document.getElementById('bgm');
const bgmToggle = document.getElementById('bgm-toggle');
const bgmTime = document.getElementById('bgm-time');

if (bgm && bgmToggle && bgmTime) {
    function formatTime(sec) {
        if (!isFinite(sec)) return '0:00';
        const m = Math.floor(sec / 60);
        const s = Math.floor(sec % 60);
        return m + ':' + (s < 10 ? '0' : '') + s;
    }

    function updateTime() {
        bgmTime.textContent = formatTime(bgm.currentTime) + ' / ' + formatTime(bgm.duration);
    }

    bgmToggle.addEventListener('click', async function () {
        if (bgm.paused) {
            try {
                await bgm.play();
                bgmToggle.title = '';
            } catch (error) {
                bgmToggle.title = '배경음악을 재생할 수 없습니다. 음원 파일을 확인해 주세요.';
                console.error('배경음악 재생 실패:', error);
            }
        } else {
            bgm.pause();
        }
    });

    bgm.addEventListener('play', function () {
        bgmToggle.textContent = '❚❚';
    });
    bgm.addEventListener('pause', function () {
        bgmToggle.textContent = '▶';
    });
    bgm.addEventListener('timeupdate', updateTime);
    bgm.addEventListener('loadedmetadata', updateTime);
    updateTime();
}
