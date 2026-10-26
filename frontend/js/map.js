// 지도 페이지 스크립트(ES 모듈).
// 기본 위치는 장안대학교입니다. 검색어를 지도에 표시하고, 지도가 보이지 않을 때 쓰는 외부 지도 링크를 갱신합니다.

// 위치는 OpenStreetMap(way 468415951, amenity=university)에서 2026-10-14에 확인했습니다. 번지수는 확인하지 못해 적지 않습니다.
export const DEFAULT_PLACE = Object.freeze({
    name: '장안대학교',
    area: '경기도 화성시 봉담읍 삼천병마로 일대',
    lat: 37.2131224,
    lng: 126.9470192,
});

export const MAX_QUERY_LENGTH = 100;
const DEFAULT_ZOOM = 17;

/** 제어 문자를 공백으로 바꾸고 공백을 정리한 뒤 최대 길이(코드 포인트 기준)로 자릅니다. */
export function normalizeQuery(raw) {
    const cleaned = String(raw ?? '')
        .replace(/[\u0000-\u001f\u007f]/g, ' ')
        .replace(/\s+/g, ' ')
        .trim();
    return [...cleaned].slice(0, MAX_QUERY_LENGTH).join('');
}

/** 지도 iframe 주소. 검색어를 생략하면 기본 위치(장안대학교)입니다. */
export function buildEmbedUrl(query) {
    if (query) {
        return 'https://maps.google.com/maps?q=' + encodeURIComponent(query) + '&output=embed';
    }
    return 'https://maps.google.com/maps?q=' + encodeURIComponent(DEFAULT_PLACE.name) +
        '&ll=' + DEFAULT_PLACE.lat + ',' + DEFAULT_PLACE.lng + '&z=' + DEFAULT_ZOOM + '&output=embed';
}

/** 지도가 표시되지 않을 때 새 창에서 여는 외부 지도 주소. */
export function buildExternalUrls(query) {
    const q = encodeURIComponent(query || DEFAULT_PLACE.name);
    return {
        google: 'https://www.google.com/maps/search/?api=1&query=' + q,
        kakao: 'https://map.kakao.com/link/search/' + q,
        naver: 'https://map.naver.com/p/search/' + q,
    };
}

function initMapPage(doc, win) {
    const form = doc.getElementById('map-search');
    const input = doc.getElementById('map-search-input');
    const frame = doc.getElementById('map-frame');
    const status = doc.getElementById('map-status');
    const reset = doc.getElementById('map-reset');
    if (!form || !input || !frame) return;

    function setStatus(message) {
        if (status) status.textContent = message;
    }

    function updateLinks(query) {
        const urls = buildExternalUrls(query);
        doc.querySelectorAll('[data-map-provider]').forEach((link) => {
            const url = urls[link.dataset.mapProvider];
            if (url) link.href = url;
        });
    }

    function show(query) {
        frame.src = buildEmbedUrl(query);
        frame.title = (query || DEFAULT_PLACE.name) + ' 지도 (Google 지도)';
        updateLinks(query);
    }

    form.addEventListener('submit', (event) => {
        event.preventDefault();
        const query = normalizeQuery(input.value);
        if (!query) {
            setStatus('검색어를 입력해 주세요.');
            return;
        }
        show(query);
        setStatus('‘' + query + '’ 위치를 지도에 표시했습니다. 지도가 보이지 않으면 아래 외부 지도 링크를 이용하세요.');
    });

    if (reset) {
        reset.addEventListener('click', () => {
            input.value = '';
            show('');
            setStatus(DEFAULT_PLACE.name + ' 위치로 돌아왔습니다.');
        });
    }

    win.addEventListener('offline', () => {
        setStatus('인터넷에 연결되어 있지 않아 지도를 불러올 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
    });
    win.addEventListener('online', () => setStatus(''));
    if (win.navigator.onLine === false) {
        setStatus('인터넷에 연결되어 있지 않아 지도를 불러올 수 없습니다. 연결을 확인한 뒤 다시 시도해 주세요.');
    }
}

if (typeof document !== 'undefined') {
    initMapPage(document, window);
}
