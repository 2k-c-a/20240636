// 시각화 페이지: 예제를 불러오고, 버튼·슬라이더·선택 상자 조작을 상태 전이로 바꾸고, 현재 상태를 화면에 그린다.
// 단계 이동과 자동 재생은 이미 읽어 둔 bundle의 스냅샷을 다시 읽는 것뿐이며 서버를 다시 부르지 않는다.
// 자동 재생의 timer는 playback.js가 하나만 걸고, 재생 중인지·속도는 재생 상태(player-state.js)가 가진다. 화면은 상태가 바뀔 때마다 timer를 상태에 맞춘다.
// 알고리즘마다 달라지는 화면(상태 그림, 범례, 제목)은 renderers/index.js의 목록에서 algorithmId로 찾아 쓰므로 이 파일은 알고리즘을 모른다.

import { LANGUAGE_LABELS, OPERATION_LABELS } from './trace-contract.js';
import { renderAlgorithmInfo } from './algorithm-info.js';
import { updateControls, updatePlayButton, updateScrubber } from './controls.js';
import { firstUsable, moveFocusOutOf } from './focus-guard.js';
import { updateLanguageSelect } from './language-select.js';
import { createPlayback, syncPlayback } from './playback.js';
import { ACTIONS, DEFAULT_SPEED, SPEEDS, createPlayerState, reducePlayer, resolveSelection, selectView, selectionAfterChange } from './player-state.js';
import { createRequestGate } from './request-gate.js';
import { renderCode } from './renderers/code.js';
import { getRenderer } from './renderers/index.js';
import { syncSelect } from './select-options.js';
import { TraceLoadError, loadBundle, loadCatalog } from './trace-loader.js';

const byId = (id) => document.getElementById(id);

function collectElements() {
    const names = [
        'viz-status', 'viz-status-text', 'viz-retry', 'viz-error-details', 'viz-notices', 'viz-body', 'viz-title',
        'viz-sr-progress', 'viz-operation-prefix', 'viz-operation', 'viz-message', 'code-root', 'code-notes', 'graph-root', 'legend-root',
        'btn-reset', 'btn-prev', 'btn-next', 'viz-progress', 'viz-phase', 'lang-select', 'algo-select', 'example-select',
        'viz-state-heading', 'viz-legend-title', 'viz-live', 'btn-play', 'viz-slider', 'speed-select', 'algorithm-info',
    ];
    const elements = {};
    for (const name of names) {
        elements[name] = byId(name);
        if (elements[name] === null) throw new Error(`#${name} 요소가 없습니다.`);
    }
    return elements;
}

/** 불러오기에 실패했을 때 사용자에게 이유를 한국어로 알려 준다. 학습 안내 문구와 선택 상자는 그대로 둔다. */
function showError(els, error) {
    console.error('예제를 불러오지 못했습니다:', error);
    els['viz-status'].hidden = false;
    els['viz-body'].hidden = true;
    els['viz-status-text'].textContent = error instanceof TraceLoadError ? error.message : '예기치 않은 문제가 생겨 예제를 표시할 수 없습니다.';
    els['viz-retry'].hidden = false;
    const details = error instanceof TraceLoadError ? error.details : [];
    els['viz-error-details'].hidden = details.length === 0;
    els['viz-error-details'].replaceChildren();
    if (details.length > 0) {
        const summary = document.createElement('summary');
        summary.textContent = '자세한 내용(개발자용)';
        const list = document.createElement('ul');
        for (const detail of details.slice(0, 10)) {
            const item = document.createElement('li');
            item.textContent = detail;
            list.appendChild(item);
        }
        els['viz-error-details'].append(summary, list);
    }
}

/** 주소 값이 잘못되어 기본값으로 열었다면 알려 준다. */
function showNotices(els, notices) {
    els['viz-notices'].replaceChildren(...notices.map((text) => {
        const paragraph = document.createElement('p');
        paragraph.setAttribute('class', 'notice');
        paragraph.textContent = text;
        return paragraph;
    }));
}

async function start() {
    const els = collectElements();
    let retry = () => window.location.reload();
    els['viz-retry'].addEventListener('click', () => retry());

    let catalog;
    let current; // 마지막으로 요청한 선택(불러오는 중이거나 실패했어도 사용자가 고른 값을 가리킨다)
    try {
        catalog = await loadCatalog();
        current = resolveSelection(catalog, new URLSearchParams(window.location.search));
    } catch (error) {
        showError(els, error);
        return;
    }

    // 지금 화면에 그려진 예제. 불러오기가 끝나기 전까지는 비어 있다.
    let bundle = null;
    let renderer = null;
    let algorithm = null;
    let example = null;
    let state = null;

    const buttons = { next: els['btn-next'], prev: els['btn-prev'], reset: els['btn-reset'] };
    // 불러오는 동안 막는 조작 요소 전부(단계 버튼, 재생 버튼, 슬라이더, 속도 선택 상자)
    const controls = [...Object.values(buttons), els['btn-play'], els['viz-slider'], els['speed-select'], els['lang-select']];
    const gate = createRequestGate();
    // 자동 재생: advance는 재생 상태의 TICK 전이다. 재생 중이 아닐 때 늦게 도착한 callback은 전이가 무시한다.
    const playback = createPlayback({ advance: () => dispatch({ type: ACTIONS.TICK }), getState: () => state });
    let speedPreference = DEFAULT_SPEED; // 예제를 바꿔도 사용자가 고른 속도를 이어받는다

    const syncPickers = () => {
        const chosen = catalog.algorithms.find((item) => item.id === current.algorithmId);
        syncSelect(document, els['algo-select'], catalog.algorithms.map((item) => ({ value: item.id, label: item.title })), current.algorithmId);
        syncSelect(document, els['example-select'], chosen.examples.map((item) => ({ value: item.id, label: item.title })), current.exampleId);
    };

    /**
     * @param {{languageChanged?: boolean, announcement?: string}} [options]
     *   languageChanged: 언어를 바꾸거나 새 예제를 열어 다시 그릴 때는 코드 스크롤을 처음으로 돌린다.
     *   announcement: 스크린 리더가 단계 안내 앞에 읽을 문장(언어를 바꿨다, 재생이 끝났다 등)
     */
    const render = ({ languageChanged = false, announcement = '' } = {}) => {
        const view = selectView(bundle, state);
        const languageLabel = LANGUAGE_LABELS[view.languageId];
        els['viz-title'].textContent = `${algorithm.title} · ${languageLabel} · ${example.title}`;
        updateLanguageSelect(document, els['lang-select'], state);
        renderCode(els['code-root'], view.codeLines, view.activeLines, { label: `${languageLabel} 코드`, resetScroll: languageChanged });
        els['code-notes'].textContent = view.notes;
        renderer.render(els['graph-root'], bundle.input, view.step.state, { operation: view.step.operation });

        // step 0은 아직 실행한 연산이 없으므로 "방금 실행한 연산: 실행 전"이라고 쓰지 않는다.
        els['viz-operation-prefix'].textContent = view.step.operation === 'initial' ? '' : '방금 실행한 연산: ';
        els['viz-operation'].textContent = OPERATION_LABELS[bundle.algorithmId][view.step.operation];
        els['viz-message'].textContent = view.step.message;
        els['viz-sr-progress'].textContent = `${announcement}${view.progress.label}. `;
        els['viz-progress'].textContent = view.progress.label;
        els['viz-phase'].textContent = view.progress.phase;

        // 버튼 상태 갱신과 포커스 이동(포커스를 가진 버튼이 비활성이 되면 활성인 버튼으로 옮긴다).
        updateControls(document, buttons, state);
        updatePlayButton(els['btn-play'], state);
        updateScrubber(els['viz-slider'], state);
        syncSelect(document, els['speed-select'], SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}배` })), String(state.speed));
        // 자동 재생 중에는 단계마다 스크린 리더가 읽지 않게 알림 영역을 끈다(1초마다 읽으면 사용자가 아무것도 들을 수 없다).
        // 멈추면 다시 켜고, 멈춘 사유와 현재 단계를 한 번 알린다.
        els['viz-live'].setAttribute('aria-live', state.playing ? 'off' : 'polite');
    };

    /** 불러온 예제를 새 화면으로 연다. 언제나 step 0에서 시작한다. */
    const open = (loaded, loadedRenderer, selection) => {
        bundle = loaded;
        renderer = loadedRenderer;
        algorithm = catalog.algorithms.find((item) => item.id === bundle.algorithmId);
        example = algorithm.examples.find((item) => item.id === bundle.exampleId);
        state = createPlayerState(bundle, selection.languageId, { speed: speedPreference });
        els['viz-state-heading'].textContent = renderer.heading;
        els['viz-legend-title'].textContent = renderer.legendTitle;
        renderer.renderLegend(els['legend-root'], bundle.input);
        renderAlgorithmInfo(els['algorithm-info'], bundle);
        els['viz-body'].hidden = false;
        render({ languageChanged: true });
        syncPlayback(playback, state); // 새 예제는 멈춘 채로 시작한다
        // 선택 상자를 쓸 수 없어 포커스를 상태 영역에 두고 기다렸다면, 상태 영역을 숨기기 전에 바로 쓸 수 있는 조작 버튼으로 옮긴다.
        moveFocusOutOf(document, [els['viz-status']], firstUsable(buttons.next, buttons.prev, buttons.reset));
        els['viz-status'].hidden = true;
    };

    /**
     * 선택한 예제를 불러와 보여 준다. 새 요청을 시작하면 이전 요청은 중단되고, 중단 신호를 무시하고 늦게 도착한 이전 응답도 버린다.
     * 불러오는 동안에는 이전 화면을 숨기고 조작 버튼을 막는다(이전 예제를 조작하다가 갑자기 바뀌는 일이 없다).
     */
    const show = async (selection) => {
        current = selection;
        syncPickers();
        showNotices(els, selection.notices);
        const request = gate.begin();

        // 숨기거나 막을 요소(재시도 버튼, 오류 상세, 본문, 조작 버튼)가 포커스를 가지고 있으면 먼저 보이는 선택 상자로 옮긴다.
        // 숨긴 뒤에는 포커스가 body로 떨어져 키보드 사용자가 길을 잃는다. 선택 상자를 쓸 수 없는 목록이면 상태 영역(프로그램으로만 포커스를 받는다)에 둔다.
        const retryHadFocus = document.activeElement === els['viz-retry'];
        const home = firstUsable(els['example-select'], els['algo-select'], els['viz-status']);
        moveFocusOutOf(document, [els['viz-retry'], els['viz-error-details'], els['viz-body'], ...controls], home);

        // 이전 예제의 자동 재생은 여기서 끝난다. 상태를 비워서 이전 예제를 가리키는 timer·조작이 더는 아무것도 하지 못하게 한다.
        state = null;
        syncPlayback(playback, state);

        els['viz-body'].hidden = true;
        els['viz-status'].hidden = false;
        els['viz-status-text'].textContent = '예제를 불러오는 중입니다…';
        els['viz-retry'].hidden = true;
        els['viz-error-details'].hidden = true;
        for (const control of controls) control.disabled = true;

        try {
            const loaded = await loadBundle(selection.algorithmId, selection.exampleId, { catalog, signal: request.signal });
            if (!request.isCurrent()) return;
            const loadedRenderer = getRenderer(loaded.algorithmId);
            open(loaded, loadedRenderer, selection);
        } catch (error) {
            if (!request.isCurrent() || (error !== null && typeof error === 'object' && error.name === 'AbortError')) return;
            retry = () => show(current);
            // open()이 중간에 던졌다면 state·bundle과 다시 켜진 조작 요소가 남아 숨겨진 화면에 계속 그릴 수 있다. 모두 비우고 조작을 막는다.
            state = null;
            bundle = null;
            renderer = null;
            syncPlayback(playback, state);
            for (const control of controls) control.disabled = true;
            showError(els, error);
            // 재시도 버튼을 눌렀다가 다시 실패했고 그동안 사용자가 포커스를 옮기지 않았다면, 다시 누를 수 있게 재시도 버튼으로 돌려놓는다.
            if (retryHadFocus && document.activeElement === home) els['viz-retry'].focus();
        }
    };

    /** 상태가 바뀐 이유 가운데 스크린 리더에게 말해 줄 것(언어 전환, 재생이 멈춘 이유). 그 밖에는 빈 문자열이다. */
    const announcementFor = (previous, next, action) => {
        if (next.languageId !== previous.languageId) return `${LANGUAGE_LABELS[next.languageId]} 코드로 바꿨습니다. `;
        if (previous.playing && !next.playing) {
            if (action.type === ACTIONS.TICK) return '재생이 끝났습니다. ';
            if (action.type === ACTIONS.PAUSE) return '일시정지했습니다. ';
        }
        return '';
    };

    const dispatch = (action) => {
        if (state === null) return;
        const next = reducePlayer(state, action);
        if (next === state) return;
        const previous = state;
        state = next;
        speedPreference = state.speed;
        const languageChanged = state.languageId !== previous.languageId;
        if (languageChanged) current = Object.freeze({ ...current, languageId: state.languageId });
        render({ languageChanged, announcement: announcementFor(previous, state, action) });
        syncPlayback(playback, state); // 재생 중이면 timer를 하나 걸고, 멈췄으면 푼다
    };
    els['btn-reset'].addEventListener('click', () => dispatch({ type: ACTIONS.RESET }));
    els['btn-prev'].addEventListener('click', () => dispatch({ type: ACTIONS.PREVIOUS }));
    els['btn-next'].addEventListener('click', () => dispatch({ type: ACTIONS.NEXT }));
    els['btn-play'].addEventListener('click', () => {
        if (state !== null) dispatch({ type: state.playing ? ACTIONS.PAUSE : ACTIONS.PLAY });
    });
    // 슬라이더: 끌거나 키보드로 움직이는 동안 계속 `input`이 온다. 첫 이동에서 재생이 멈추고 코드·설명·상태가 같은 단계를 가리킨다.
    els['viz-slider'].addEventListener('input', () => {
        dispatch({ type: ACTIONS.SEEK, index: Number(els['viz-slider'].value) });
        if (state !== null) updateScrubber(els['viz-slider'], state); // 잘못된 값이 들어와 상태가 바뀌지 않았다면 슬라이더를 되돌린다
    });
    els['speed-select'].addEventListener('change', () => {
        dispatch({ type: ACTIONS.SET_SPEED, speed: Number(els['speed-select'].value) });
        if (state !== null) syncSelect(document, els['speed-select'], SPEEDS.map((speed) => ({ value: String(speed), label: `${speed}배` })), String(state.speed));
    });
    // 탭을 숨기면(다른 탭으로 이동, 화면 끔) 자동 재생을 멈춘다. 다시 보일 때 저절로 이어지지 않는다.
    document.addEventListener('visibilitychange', () => {
        if (document.hidden) dispatch({ type: ACTIONS.PAUSE });
    });
    // 페이지를 떠날 때 timer를 푼다. 뒤로 가기 캐시로 되돌아올 수 있는 경우(persisted)에는 재생기를 없애지 않는다.
    window.addEventListener('pagehide', (event) => {
        dispatch({ type: ACTIONS.PAUSE });
        playback.pause();
        if (!event.persisted) playback.destroy();
    });
    els['lang-select'].addEventListener('change', () => {
        dispatch({ type: ACTIONS.SWITCH_LANGUAGE, languageId: els['lang-select'].value });
        // 목록에 없는 값이 들어와 상태가 바뀌지 않았다면 선택 상자를 현재 언어로 되돌린다.
        if (state !== null) updateLanguageSelect(document, els['lang-select'], state);
    });

    const change = (what) => {
        const next = selectionAfterChange(catalog, current, what);
        if (next === current) syncPickers(); // 같은 선택이거나 목록에 없는 값이면 선택 상자만 되돌린다
        else show(next);
    };
    els['algo-select'].addEventListener('change', () => change({ algorithmId: els['algo-select'].value }));
    els['example-select'].addEventListener('change', () => change({ exampleId: els['example-select'].value }));

    await show(current);
}

if (typeof document !== 'undefined') {
    start().catch((error) => console.error('시각화 페이지를 시작하지 못했습니다:', error));
}
