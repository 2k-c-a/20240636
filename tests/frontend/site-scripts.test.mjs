// site.js와 map.js의 순수 함수, 그리고 map.html과 map.js 상수의 일치를 검사한다.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { findCurrentLinkIndex, markCurrentPage } from '../../frontend/js/site.js';
import {
    DEFAULT_PLACE, MAX_QUERY_LENGTH, buildEmbedUrl, buildExternalUrls, normalizeQuery,
} from '../../frontend/js/map.js';

const HTML_DIR = join(resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend'), 'html');
const MENU = ['index.html', 'info.html', 'idea.html', 'map.html', 'gallery.html', 'contact.html'];
const BASE = 'http://127.0.0.1:8000/web/html/';

// ---------- site.js ----------

test('현재 페이지에 해당하는 메뉴 링크의 인덱스를 찾는다', () => {
    MENU.forEach((page, i) => {
        assert.equal(findCurrentLinkIndex(MENU, BASE + page), i, page);
    });
});

test('쿼리와 해시는 무시하고 경로만 비교한다', () => {
    assert.equal(findCurrentLinkIndex(MENU, BASE + 'map.html?x=1#top'), 3);
});

test('메뉴에 없는 페이지에서는 아무 링크도 현재 페이지로 표시하지 않는다', () => {
    assert.equal(findCurrentLinkIndex(MENU, BASE + 'post.html?id=1'), -1);
    assert.equal(findCurrentLinkIndex([], BASE + 'map.html'), -1);
});

test('이해할 수 없는 href가 있어도 예외 없이 건너뛴다', () => {
    assert.equal(findCurrentLinkIndex(['http://', 'map.html'], BASE + 'map.html'), 1);
});

function fakeLink(href, current = false) {
    const attrs = new Map(current ? [['aria-current', 'page']] : []);
    return {
        getAttribute: (name) => (name === 'href' ? href : attrs.get(name) ?? null),
        setAttribute: (name, value) => attrs.set(name, value),
        removeAttribute: (name) => attrs.delete(name),
        current: () => attrs.get('aria-current'),
    };
}

test('markCurrentPage는 현재 링크에만 aria-current를 두고 이전 표시를 지운다', () => {
    const links = MENU.map((page) => fakeLink(page, page === 'index.html'));
    const doc = { querySelectorAll: (selector) => (selector === 'nav a[href]' ? links : []) };
    markCurrentPage(doc, BASE + 'gallery.html');
    assert.deepEqual(links.map((l) => l.current()), [undefined, undefined, undefined, undefined, 'page', undefined]);
});


// ---------- map.js ----------

test('장안대학교가 기본 위치이고 좌표가 한국 안에 있다', () => {
    assert.equal(DEFAULT_PLACE.name, '장안대학교');
    assert.ok(DEFAULT_PLACE.lat > 33 && DEFAULT_PLACE.lat < 39);
    assert.ok(DEFAULT_PLACE.lng > 124 && DEFAULT_PLACE.lng < 132);
    assert.ok(Object.isFrozen(DEFAULT_PLACE));
});

test('normalizeQuery: 공백 정리, 제어 문자 제거, 길이 제한(코드 포인트 기준)', () => {
    assert.equal(normalizeQuery('  서울   역 \n\t 근처 '), '서울 역 근처');
    assert.equal(normalizeQuery('a\u0000b\u007fc'), 'a b c');
    assert.equal(normalizeQuery(null), '');
    assert.equal(normalizeQuery(undefined), '');
    assert.equal(normalizeQuery('   '), '');
    const long = normalizeQuery('😀'.repeat(MAX_QUERY_LENGTH + 50));
    assert.equal([...long].length, MAX_QUERY_LENGTH);
    assert.ok(!/[\ud800-\udbff](?![\udc00-\udfff])/.test(long), '서로게이트 쌍이 잘리지 않아야 합니다');
});

test('buildEmbedUrl: Google 지도 https 주소만 만들고 검색어를 인코딩해 파라미터를 주입할 수 없다', () => {
    const hostile = '서울역&output=json#frag?q=evil';
    const url = new URL(buildEmbedUrl(hostile));
    assert.equal(url.protocol, 'https:');
    assert.equal(url.hostname, 'maps.google.com');
    assert.equal(url.searchParams.get('q'), hostile);
    assert.equal(url.searchParams.get('output'), 'embed');
    assert.equal(url.hash, '');
    assert.deepEqual([...url.searchParams.keys()].sort(), ['output', 'q']);
});

test('buildEmbedUrl: 검색어가 없으면 장안대학교 기본 위치를 가리킨다', () => {
    const url = new URL(buildEmbedUrl(''));
    assert.equal(url.searchParams.get('q'), DEFAULT_PLACE.name);
    assert.equal(url.searchParams.get('ll'), `${DEFAULT_PLACE.lat},${DEFAULT_PLACE.lng}`);
    assert.equal(url.searchParams.get('output'), 'embed');
});

test('buildExternalUrls: 허용된 지도 서비스의 https 주소이며 검색어가 한 조각으로 들어간다', () => {
    const allowedHosts = { google: 'www.google.com', kakao: 'map.kakao.com', naver: 'map.naver.com' };
    const query = '서울/역 a&b#c';
    const urls = buildExternalUrls(query);
    assert.deepEqual(Object.keys(urls).sort(), ['google', 'kakao', 'naver']);
    for (const [provider, host] of Object.entries(allowedHosts)) {
        const url = new URL(urls[provider]);
        assert.equal(url.protocol, 'https:', provider);
        assert.equal(url.hostname, host, provider);
        assert.equal(url.hash, '', provider);
    }
    assert.equal(new URL(urls.google).searchParams.get('query'), query);
    for (const provider of ['kakao', 'naver']) {
        const segments = new URL(urls[provider]).pathname.split('/');
        assert.equal(decodeURIComponent(segments.at(-1)), query, provider);
    }
});

test('buildExternalUrls: 검색어가 없으면 장안대학교를 가리킨다', () => {
    assert.equal(new URL(buildExternalUrls('').google).searchParams.get('query'), DEFAULT_PLACE.name);
});

// ---------- map.html과 map.js의 일치 ----------

function decodeAmp(value) {
    return value.replace(/&amp;/g, '&');
}

const mapHtml = readFileSync(join(HTML_DIR, 'map.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');

test('map.html의 기본 지도 주소가 map.js의 기본 위치와 같다', () => {
    const src = mapHtml.match(/<iframe[^>]*\ssrc="([^"]+)"/)?.[1];
    assert.ok(src, 'iframe src 없음');
    assert.equal(decodeAmp(src), buildEmbedUrl(''));
});

test('map.html에 기본 위치 텍스트와 외부 지도 링크 3종이 항상 있고 map.js의 주소와 같다', () => {
    assert.match(mapHtml, /id="place-info"[^>]*>\s*<strong>장안대학교<\/strong>/);
    const expected = buildExternalUrls('');
    for (const provider of ['google', 'kakao', 'naver']) {
        const tag = mapHtml.match(new RegExp(`<a[^>]*data-map-provider="${provider}"[^>]*>`))?.[0];
        assert.ok(tag, `${provider} 링크 없음`);
        assert.equal(decodeAmp(tag.match(/href="([^"]+)"/)[1]), expected[provider], provider);
        assert.match(tag, /target="_blank"/);
        assert.match(tag, /rel="noopener"/);
    }
});

test('map.html의 검색 입력창에 레이블과 길이 제한이 있고 상태 메시지 영역이 있다', () => {
    assert.match(mapHtml, /<label for="map-search-input"/);
    assert.match(mapHtml, new RegExp(`id="map-search-input"[^>]*maxlength="${MAX_QUERY_LENGTH}"`));
    assert.match(mapHtml, /id="map-status"[^>]*role="status"/);
});
