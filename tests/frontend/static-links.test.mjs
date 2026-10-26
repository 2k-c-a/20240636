// 정적 HTML의 로컬 링크·자산 경로와 페이지 공통 구조를 검사한다. Node 내장 기능만 사용한다.
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const FRONTEND_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../../frontend');
const HTML_DIR = join(FRONTEND_DIR, 'html');

// 메뉴(주 메뉴 `nav`)가 가리키는 페이지. 마지막이 로그인 항목이다.
const MENU_PAGES = ['index.html', 'visualizer.html', 'board.html', 'info.html', 'map.html'];
// 메뉴에는 없고 회원 화면에서 링크로 이동하는 페이지.
const AUTH_ONLY_PAGES = ['login.html', 'signup.html', 'reset-password.html', 'auth-callback.html', 'profile.html', 'post.html', 'write.html'];
const GITHUB_URL = 'https://github.com/2k-c-a';

// ---------- 작은 HTML 도구 (이 프로젝트의 HTML 규칙을 전제로 한다) ----------

function stripComments(html) {
    return html.replace(/<!--[\s\S]*?-->/g, '');
}

function decodeEntities(value) {
    return value
        .replace(/&lt;/g, '<').replace(/&gt;/g, '>')
        .replace(/&quot;/g, '"').replace(/&#39;/g, "'")
        .replace(/&amp;/g, '&');
}

/** 주석을 제외한 시작 태그 목록. 속성값 안의 '>'는 허용한다. */
function parseTags(html) {
    const tags = [];
    for (const match of stripComments(html).matchAll(/<([a-zA-Z][\w-]*)((?:"[^"]*"|'[^']*'|[^'">])*)>/g)) {
        const attrs = {};
        for (const attr of match[2].matchAll(/([^\s"'<>/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/g)) {
            attrs[attr[1].toLowerCase()] = decodeEntities(attr[2] ?? attr[3] ?? attr[4] ?? '');
        }
        tags.push({ name: match[1].toLowerCase(), attrs });
    }
    return tags;
}

const REF_ATTRS = { a: ['href'], area: ['href'], link: ['href'], script: ['src'], img: ['src'], source: ['src'], audio: ['src'], video: ['src', 'poster'], iframe: ['src'], form: ['action'], input: ['src'] };

function collectRefs(html) {
    const refs = [];
    for (const tag of parseTags(html)) {
        for (const attr of REF_ATTRS[tag.name] ?? []) {
            if (tag.attrs[attr] !== undefined) refs.push({ tag: tag.name, attr, value: tag.attrs[attr] });
        }
        if (tag.attrs['data-hover-image'] !== undefined) {
            refs.push({ tag: tag.name, attr: 'data-hover-image', value: tag.attrs['data-hover-image'] });
        }
    }
    return refs;
}

/** http:, mailto:, tel:, data:, // 로 시작하거나 #만 있는 값은 로컬 파일이 아니다. */
function isLocalRef(value) {
    return value !== '' && !/^[a-zA-Z][a-zA-Z0-9+.-]*:/.test(value) && !value.startsWith('//') && !value.startsWith('#');
}

/** frontend 안에서 대소문자까지 정확히 일치하는 파일인지 확인한다(Windows에서 통과하고 Linux에서 깨지는 링크를 막는다). */
function isExistingFileExactCase(frontendDir, absPath) {
    const rel = relative(frontendDir, absPath);
    if (rel === '' || rel.startsWith('..') || isAbsolute(rel)) return false;
    let current = frontendDir;
    for (const segment of rel.split(sep)) {
        if (!readdirSync(current).includes(segment)) return false;
        current = join(current, segment);
    }
    return statSync(current).isFile();
}

/** HTML 하나의 로컬 참조 중 문제가 있는 것을 설명 문자열로 돌려준다. */
function findProblemRefs(html, htmlFile, frontendDir) {
    const problems = [];
    for (const ref of collectRefs(html).filter((r) => isLocalRef(r.value))) {
        const path = ref.value.split('#')[0].split('?')[0];
        let decoded;
        try {
            decoded = decodeURIComponent(path);
        } catch {
            problems.push(`${ref.tag}[${ref.attr}]="${ref.value}": 잘못된 퍼센트 인코딩`);
            continue;
        }
        let target;
        if (decoded.startsWith('/web/')) {
            target = join(frontendDir, decoded.slice('/web/'.length));
        } else if (decoded.startsWith('/')) {
            problems.push(`${ref.tag}[${ref.attr}]="${ref.value}": /web/ 밖을 가리키는 절대 경로`);
            continue;
        } else {
            target = resolve(dirname(htmlFile), decoded);
        }
        if (!isExistingFileExactCase(frontendDir, target)) {
            problems.push(`${ref.tag}[${ref.attr}]="${ref.value}": frontend 안에 같은 이름(대소문자 포함)의 파일이 없음`);
        }
    }
    return problems;
}

function blockOf(html, tagName) {
    const match = stripComments(html).match(new RegExp(`<${tagName}\\b[\\s\\S]*?</${tagName}>`));
    return match ? match[0].replace(/\s+/g, ' ').trim() : null;
}

const pageFiles = readdirSync(HTML_DIR).filter((f) => f.endsWith('.html')).sort();
const pages = Object.fromEntries(pageFiles.map((f) => [f, readFileSync(join(HTML_DIR, f), 'utf8')]));

// ---------- 검사기 자체 검증 ----------

const tmpRoots = [];
after(() => tmpRoots.forEach((dir) => rmSync(dir, { recursive: true, force: true })));

function makeFrontend(files) {
    const root = mkdtempSync(join(tmpdir(), 'static-links-'));
    tmpRoots.push(root);
    for (const [name, content] of Object.entries(files)) {
        mkdirSync(dirname(join(root, name)), { recursive: true });
        writeFileSync(join(root, name), content);
    }
    return root;
}

test('검사기: 존재하는 상대·절대 경로와 쿼리·해시는 통과한다', () => {
    const root = makeFrontend({ 'css/ok.css': '', 'html/a.html': '', 'img/pic.png': '' });
    const html = '<link href="../css/ok.css?v=1"><a href="a.html#top">a</a><img src="/web/img/pic.png" alt="">';
    assert.deepEqual(findProblemRefs(html, join(root, 'html/a.html'), root), []);
});

test('검사기: 존재하지 않는 파일은 자리표시자 이름이어도 정상 파일로 보지 않는다', () => {
    const root = makeFrontend({ 'html/a.html': '' });
    const html = '<video controls><source src="../video/파일명.mp4" type="video/mp4"></video>';
    const problems = findProblemRefs(html, join(root, 'html/a.html'), root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /source\[src\]="..\/video\/파일명\.mp4"/);
});

test('검사기: 주석 안의 링크와 자리표시자는 무시한다', () => {
    const root = makeFrontend({ 'html/a.html': '' });
    const html = '<!-- <source src="../video/파일명.mp4"> --><p>본문</p>';
    assert.deepEqual(findProblemRefs(html, join(root, 'html/a.html'), root), []);
});

test('검사기: 외부 주소, mailto, tel, 같은 페이지 해시는 로컬 파일로 보지 않는다', () => {
    const root = makeFrontend({ 'html/a.html': '' });
    const html = '<a href="https://example.com/x.html">x</a><a href="mailto:a@b.c">m</a><a href="tel:010">t</a><a href="#top">h</a><a href="//cdn.example/x.js">c</a>';
    assert.deepEqual(findProblemRefs(html, join(root, 'html/a.html'), root), []);
});

test('검사기: 대소문자가 다른 파일명은 실패로 본다', () => {
    const root = makeFrontend({ 'css/Style.css': '', 'html/a.html': '' });
    assert.equal(findProblemRefs('<link href="../css/style.css">', join(root, 'html/a.html'), root).length, 1);
});

test('검사기: frontend 밖을 가리키는 경로와 /web/ 밖 절대 경로는 실패로 본다', () => {
    const root = makeFrontend({ 'html/a.html': '' });
    writeFileSync(join(root, '..', 'outside-secret.txt'), 'x');
    tmpRoots.push(join(root, '..', 'outside-secret.txt'));
    const html = '<a href="../../outside-secret.txt">o</a><a href="/etc/passwd">p</a><a href="/api/health">h</a>';
    assert.equal(findProblemRefs(html, join(root, 'html/a.html'), root).length, 3);
});

test('검사기: 디렉터리를 가리키는 링크는 파일이 아니므로 실패로 본다', () => {
    const root = makeFrontend({ 'html/a.html': '', 'img/pic.png': '' });
    assert.equal(findProblemRefs('<a href="../img/">d</a>', join(root, 'html/a.html'), root).length, 1);
});

// ---------- 실제 페이지 ----------

test('검사 대상 페이지를 찾았다', () => {
    assert.deepEqual(pageFiles, [...MENU_PAGES, ...AUTH_ONLY_PAGES].sort());
});

test('모든 페이지의 로컬 링크·자산이 frontend 안의 실제 파일을 가리킨다', () => {
    const problems = pageFiles.flatMap((file) =>
        findProblemRefs(pages[file], join(HTML_DIR, file), FRONTEND_DIR).map((p) => `${file}: ${p}`));
    assert.deepEqual(problems, []);
});

test('모든 페이지의 헤더·메뉴·푸터 마크업이 같다', () => {
    for (const tagName of ['header', 'nav', 'footer']) {
        const blocks = new Set(pageFiles.map((file) => blockOf(pages[file], tagName)));
        assert.equal(blocks.size, 1, `<${tagName}> 마크업이 페이지마다 다릅니다`);
        assert.ok(!blocks.has(null), `<${tagName}>가 없는 페이지가 있습니다`);
    }
});

test('하위 메뉴는 학습·커뮤니티·사이트 안내로 연결된다', () => {
    const nav = parseTags(blockOf(pages['index.html'], 'nav'));
    const hrefs = nav.filter((t) => t.name === 'a').map((t) => t.attrs.href);
    assert.deepEqual(hrefs, ['index.html','visualizer.html','info.html#guide','board.html','write.html','info.html','map.html','visualizer.html']);
    for (const href of hrefs) assert.ok(pageFiles.includes(href.split('#')[0]), `${href} 페이지가 없습니다`);
});

test('모든 페이지가 기본 구조(언어, viewport, 제목, 파비콘, 스타일, 공통 스크립트)를 갖춘다', () => {
    for (const file of pageFiles) {
        const html = pages[file];
        const tags = parseTags(html);
        assert.equal(tags.find((t) => t.name === 'html')?.attrs.lang, 'ko', `${file}: lang`);
        assert.match(tags.find((t) => t.name === 'meta' && t.attrs.name === 'viewport')?.attrs.content ?? '', /width=device-width/, `${file}: viewport`);
        assert.match(stripComments(html).match(/<title>([\s\S]*?)<\/title>/)?.[1].trim() ?? '', /\S/, `${file}: title`);

        const icons = tags.filter((t) => t.name === 'link' && /icon/.test(t.attrs.rel ?? '')).map((t) => t.attrs.href);
        assert.deepEqual(icons, ['../img/favicon.svg', '../img/favicon-32.png', '../img/favicon-16.png', '../img/apple-touch-icon.png'], `${file}: 파비콘`);
        assert.ok(tags.some((t) => t.name === 'link' && t.attrs.rel === 'stylesheet' && t.attrs.href === '../css/style.css'), `${file}: style.css`);
        assert.ok(tags.some((t) => t.name === 'script' && t.attrs.type === 'module' && t.attrs.src === '../js/site.js'), `${file}: site.js`);
        assert.ok(tags.some((t) => t.name === 'main' && t.attrs.id === 'main'), `${file}: main#main`);
    }
});

test('외부 링크는 새 창에서 열 때 noopener를 가지고, 모든 페이지에 GitHub 프로필 링크가 있다', () => {
    for (const file of pageFiles) {
        const links = parseTags(pages[file]).filter((t) => t.name === 'a' && /^https?:/.test(t.attrs.href ?? ''));
        for (const link of links) {
            if (link.attrs.target === '_blank') {
                assert.match(link.attrs.rel ?? '', /\bnoopener\b/, `${file}: ${link.attrs.href}`);
            }
        }
        const github = links.filter((l) => l.attrs.href === GITHUB_URL);
        assert.ok(github.length >= 1, `${file}: GitHub 링크 없음`);
        assert.ok(github.every((l) => l.attrs.target === '_blank'), `${file}: GitHub 링크가 새 창이 아님`);
    }
});

test('이미지에 alt가 있고, id가 중복되지 않으며, 입력창에는 레이블이 연결되어 있다', () => {
    for (const file of pageFiles) {
        const tags = parseTags(pages[file]);
        for (const img of tags.filter((t) => t.name === 'img')) {
            assert.ok('alt' in img.attrs, `${file}: alt 없는 img ${img.attrs.src}`);
        }
        const ids = tags.map((t) => t.attrs.id).filter(Boolean);
        assert.equal(new Set(ids).size, ids.length, `${file}: id 중복`);

        const labelFor = new Set(tags.filter((t) => t.name === 'label').map((t) => t.attrs.for));
        for (const field of tags.filter((t) => ['input', 'textarea', 'select'].includes(t.name))) {
            if (['hidden', 'submit', 'button', 'reset'].includes(field.attrs.type)) continue;
            const labelled = (field.attrs.id && labelFor.has(field.attrs.id)) || field.attrs['aria-label'];
            assert.ok(labelled, `${file}: 레이블 없는 입력창 ${field.attrs.id ?? field.attrs.name}`);
        }
    }
});

test('소스가 없는 video/audio 요소를 두지 않는다(빈 플레이어 방지)', () => {
    for (const file of pageFiles) {
        const tags = parseTags(pages[file]);
        const emptyMedia = tags.filter((t) => ['video', 'audio'].includes(t.name) && !t.attrs.src).length;
        const sources = tags.filter((t) => t.name === 'source').length;
        assert.ok(emptyMedia <= sources, `${file}: <source>가 없는 미디어 요소가 있습니다`);
    }
});

test('실습용 양식은 전송되지 않도록 data-demo-form과 POST를 쓴다(회원 화면 양식은 제외, 아래에서 검사)', () => {
    for (const file of pageFiles) {
        const bodyAttrs = parseTags(pages[file]).find((t) => t.name === 'body')?.attrs ?? {};
        if ('data-auth-page' in bodyAttrs || 'data-board-page' in bodyAttrs) continue;
        for (const form of parseTags(pages[file]).filter((t) => t.name === 'form' && t.attrs.role !== 'search')) {
            assert.ok('data-demo-form' in form.attrs, `${file}: 전송 대상이 없는 양식에 data-demo-form이 없습니다`);
            assert.equal((form.attrs.method ?? 'get').toLowerCase(), 'post', `${file}: 입력 내용이 주소창에 실릴 수 있습니다`);
        }
    }
});

test('실습용 페이지·양식을 제거하고 로그인 영역을 헤더에 둔다', () => {
    for (const name of ['gallery.html','contact.html','idea.html']) assert.ok(!pageFiles.includes(name));
    for (const html of Object.values(pages)) { assert.match(blockOf(html,'header'), /data-auth-menu/); assert.doesNotMatch(blockOf(html,'nav'), /data-auth-menu/); }
    assert.match(pages['board.html'], /href="write.html"/);
    assert.doesNotMatch(pages['board.html'], /id="board-form"/);
    assert.match(pages['write.html'], /id="board-form"/);
});

test('시각화 페이지: 실행 기록 재생 안내, 조작 버튼, 상태 알림 영역, 전용 스타일·스크립트가 있다', () => {
    const html = pages['visualizer.html'];
    const tags = parseTags(html);
    const text = stripComments(html).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
    // DESIGN §1: 모든 시각화 페이지에 이 안내를 둔다(JavaScript 없이도 보이도록 정적 HTML에 있다).
    assert.ok(text.includes('준비된 예제의 실행 기록을 재생합니다. 입력한 코드를 실제로 실행하는 기능은 아닙니다.'));

    const byId = Object.fromEntries(tags.filter((t) => t.attrs.id).map((t) => [t.attrs.id, t]));
    for (const id of ['btn-reset', 'btn-prev', 'btn-next']) {
        assert.equal(byId[id]?.name, 'button', `${id}는 button이어야 합니다`);
        assert.equal(byId[id].attrs.type, 'button', `${id}: type="button"`);
        assert.ok('disabled' in byId[id].attrs, `${id}: 불러오기 전에는 비활성이어야 합니다`);
    }
    // 단계 설명은 스크린 리더에 알려지도록 live region 안에 있어야 한다.
    const live = tags.find((t) => t.attrs['aria-live'] === 'polite');
    assert.ok(live, 'aria-live="polite" 영역이 없습니다');
    assert.ok(stripComments(html).match(/aria-live="polite"[\s\S]*?id="viz-operation"[\s\S]*?id="viz-message"/), '연산과 설명이 live region 안에 있어야 합니다');
    assert.ok(tags.some((t) => t.name === 'link' && t.attrs.href === '../css/visualizer.css'));
    assert.ok(tags.some((t) => t.name === 'script' && t.attrs.type === 'module' && t.attrs.src === '../js/visualizer.js'));
    assert.ok(tags.some((t) => t.name === 'noscript'), 'JavaScript가 없을 때 안내가 필요합니다');
    // 렌더러가 채우는 자리
    for (const id of ['code-root', 'graph-root', 'legend-root', 'viz-notices', 'viz-body', 'viz-status']) assert.ok(byId[id], `#${id}`);
});

test('존재 확인용: 대표 자산이 실제로 있다', () => {
    for (const file of ['css/style.css', 'css/visualizer.css', 'js/visualizer.js', 'js/player-state.js', 'js/controls.js', 'js/language-select.js', 'js/select-options.js', 'js/focus-guard.js', 'js/playback.js', 'js/request-gate.js', 'js/renderers/code.js', 'js/renderers/graph.js', 'js/renderers/array.js', 'js/renderers/index.js', 'js/site.js', 'js/map.js', 'js/comments.js', 'js/compose.js', 'img/favicon.svg']) {
        assert.ok(existsSync(join(FRONTEND_DIR, file)), file);
    }
});
