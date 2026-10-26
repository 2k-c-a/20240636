// 재생기의 상태 전이와 "무엇을 보여 줄지" 결정하는 순수 로직. DOM과 fetch를 쓰지 않아 Node에서 그대로 테스트한다.
//
// 상태는 얼려서 돌려주는 불변 객체다. 화면은 이 상태와 (얼린) bundle로부터 매번 새로 그리며,
// "이전"은 마지막 값을 되돌리는 것이 아니라 stepIndex만 바꿔 bundle의 해당 스냅샷을 다시 읽는 것이다.

import { LANGUAGE_LABELS, LANGUAGE_ORDER } from './trace-contract.js';

export const ACTIONS = Object.freeze({
    NEXT: 'NEXT', PREVIOUS: 'PREVIOUS', RESET: 'RESET', SEEK: 'SEEK', SWITCH_LANGUAGE: 'SWITCH_LANGUAGE',
    PLAY: 'PLAY', PAUSE: 'PAUSE', SET_SPEED: 'SET_SPEED', TICK: 'TICK',
});

/** 고를 수 있는 재생 속도(배). 1배는 한 단계에 1초, 0.5배는 2초, 2배는 0.5초다. */
export const SPEEDS = Object.freeze([0.5, 1, 2]);
export const DEFAULT_SPEED = 1;
const BASE_INTERVAL_MS = 1000;

/** 속도(배)에 해당하는 단계 사이의 시간(밀리초). 0.5배 → 2000, 1배 → 1000, 2배 → 500. */
export const intervalFor = (speed) => BASE_INTERVAL_MS / speed;

/**
 * @typedef {Object} PlayerState
 * @property {string} algorithmId
 * @property {string} exampleId
 * @property {string} contentVersion  이 상태가 만들어진 bundle. 다른 bundle과 섞어 쓰지 못하게 확인한다.
 * @property {string} languageId
 * @property {ReadonlyArray<string>} languages  이 bundle이 코드를 가진 언어(고를 수 있는 언어). LANGUAGE_ORDER의 우선순위를 따른다
 * @property {number} stepIndex       0..lastStepIndex
 * @property {number} lastStepIndex
 * @property {boolean} playing       자동 재생 중인지. 마지막 단계에 닿으면 저절로 false가 된다
 * @property {number} speed          SPEEDS 중 하나(배)
 */

/**
 * 처음 상태(step 0, 실행 전)를 만든다.
 * @param {import('./trace-contract.js').TraceBundle} bundle  검증을 통과한 bundle
 * @param {string} languageId
 * @param {{speed?: number}} [options]  speed: 이어받을 재생 속도. 예제를 바꿔도 사용자가 고른 속도는 유지한다(목록에 없으면 기본값). 재생은 항상 멈춘 채로 시작한다
 * @returns {Readonly<PlayerState>}
 */
export function createPlayerState(bundle, languageId, { speed = DEFAULT_SPEED } = {}) {
    if (bundle === null || typeof bundle !== 'object' || !Array.isArray(bundle.steps) || bundle.steps.length === 0) {
        throw new TypeError('재생할 실행 기록(steps)이 없습니다.');
    }
    if (typeof languageId !== 'string' || !Object.hasOwn(bundle.codes, languageId)) {
        throw new RangeError(`이 예제는 ${LANGUAGE_LABELS[languageId] ?? String(languageId)} 코드를 제공하지 않습니다.`);
    }
    return Object.freeze({
        algorithmId: bundle.algorithmId,
        exampleId: bundle.exampleId,
        contentVersion: bundle.contentVersion,
        languageId,
        languages: Object.freeze(LANGUAGE_ORDER.filter((id) => Object.hasOwn(bundle.codes, id))),
        stepIndex: 0,
        lastStepIndex: bundle.steps.length - 1,
        playing: false,
        speed: SPEEDS.includes(speed) ? speed : DEFAULT_SPEED,
    });
}

/**
 * 상태 전이. 새 상태를 돌려주며 인자로 받은 state와 action은 바꾸지 않는다.
 * 바뀐 것이 없으면(처음에서 이전, 마지막에서 다음 등) 같은 객체를 그대로 돌려준다.
 *
 * - NEXT / PREVIOUS: stepIndex를 1 늘리거나 줄이되 0..lastStepIndex 범위에 고정한다.
 * - RESET: step 0으로 돌아간다.
 * - SEEK {index}: 정수가 아니면 무시하고(같은 상태), 정수면 범위 안으로 고정한다.
 * - SWITCH_LANGUAGE {languageId}: 언어만 바꾸고 알고리즘·예제·단계(stepIndex)는 그대로 둔다. 모든 언어의 trace는 같은 step에서
 *   같은 논리 상태를 가지므로(계약 R5) 다시 계산할 것이 없다. 이 예제에 없는 언어는 무시한다(같은 상태).
 * - **사용자가 직접 한 조작(NEXT, PREVIOUS, RESET, SEEK, SWITCH_LANGUAGE)은 자동 재생을 멈춘다.** 재생 중에 손으로 단계를
 *   옮기거나 언어를 바꾸면 화면이 저절로 계속 움직이지 않는다. 바뀐 것이 없고 재생 중도 아니면 같은 객체를 돌려준다.
 * - PLAY: 재생을 시작한다. 마지막 단계에서 누르면 처음(step 0)부터 다시 재생한다. 이미 재생 중이면 같은 객체.
 * - PAUSE: 재생을 멈춘다(탭을 숨기거나 페이지를 떠날 때도 쓴다). 이미 멈춰 있으면 같은 객체.
 * - SET_SPEED {speed}: SPEEDS 중 하나로 바꾼다. 목록에 없거나 같은 값이면 무시한다. 재생 중인지는 바뀌지 않는다.
 * - TICK: 자동 재생이 한 단계 나아간다. **재생 중이 아니면 무시한다**(멈춘 뒤에 늦게 도착한 timer callback이 단계를 옮기지 못한다).
 *   마지막 단계에 닿으면 저절로 재생이 멈춘다.
 * 알 수 없는 action은 프로그램의 실수이므로 예외를 던진다.
 *
 * @param {Readonly<PlayerState>} state
 * @param {{type: string, index?: number}} action
 * @returns {Readonly<PlayerState>}
 */
export function reducePlayer(state, action) {
    const clamp = (value) => Math.min(Math.max(value, 0), state.lastStepIndex);
    let next;
    switch (action && action.type) {
        case ACTIONS.NEXT:
            next = clamp(state.stepIndex + 1);
            break;
        case ACTIONS.PREVIOUS:
            next = clamp(state.stepIndex - 1);
            break;
        case ACTIONS.RESET:
            next = 0;
            break;
        case ACTIONS.SEEK:
            if (!Number.isInteger(action.index)) return state; // 잘못된 값은 무시한다(재생 중이면 계속 재생한다)
            next = clamp(action.index);
            break;
        case ACTIONS.SWITCH_LANGUAGE:
            // 목록에서 찾으므로 '__proto__' 같은 이름이나 문자열이 아닌 값은 자연히 걸러진다.
            return state.languages.includes(action.languageId) && action.languageId !== state.languageId
                ? Object.freeze({ ...state, languageId: action.languageId, playing: false })
                : state;
        case ACTIONS.PLAY:
            if (state.playing) return state;
            return Object.freeze({ ...state, stepIndex: state.stepIndex >= state.lastStepIndex ? 0 : state.stepIndex, playing: true });
        case ACTIONS.PAUSE:
            return state.playing ? Object.freeze({ ...state, playing: false }) : state;
        case ACTIONS.SET_SPEED:
            return SPEEDS.includes(action.speed) && action.speed !== state.speed ? Object.freeze({ ...state, speed: action.speed }) : state;
        case ACTIONS.TICK: {
            if (!state.playing) return state;
            const advanced = clamp(state.stepIndex + 1);
            return Object.freeze({ ...state, stepIndex: advanced, playing: advanced < state.lastStepIndex });
        }
        default:
            throw new TypeError(`알 수 없는 action입니다: ${String(action && action.type)}`);
    }
    // 직접 한 이동 조작: 단계가 바뀌지 않았고 재생 중도 아니면 그대로, 아니면 새 단계에서 재생을 멈춘다.
    return next === state.stepIndex && !state.playing ? state : Object.freeze({ ...state, stepIndex: next, playing: false });
}

/** 언어 선택 목록. 표시 이름과 현재 선택 여부를 함께 돌려준다. */
export function languageOptions(state) {
    return state.languages.map((id) => ({ id, label: LANGUAGE_LABELS[id] ?? id, selected: id === state.languageId }));
}

export const canGoPrevious = (state) => state.stepIndex > 0;
export const canGoNext = (state) => state.stepIndex < state.lastStepIndex;

/**
 * 진행 상황 표시용 값. 자동 재생 중이면 "자동 재생 중", 아니면 0단계는 "실행 전", 마지막 단계는 "실행 끝", 그 사이는 "실행 중"이다.
 * 색이나 아이콘이 아니라 글자로 알린다.
 */
export function describeProgress(state) {
    let phase = state.stepIndex === 0 ? '실행 전' : state.stepIndex === state.lastStepIndex ? '실행 끝' : '실행 중';
    if (state.playing) phase = `자동 재생 중 (${state.speed}배속)`;
    return { index: state.stepIndex, last: state.lastStepIndex, phase, label: `단계 ${state.stepIndex} / ${state.lastStepIndex}`, playing: state.playing };
}

/**
 * 현재 상태가 가리키는 step. bundle의 step 객체를 복사 없이 그대로 돌려준다(그래서 얼려 있다).
 * 상태가 다른 bundle에서 만들어졌거나 범위를 벗어나면 예외를 던진다(오래된 상태로 새 콘텐츠를 그리지 않는다).
 */
export function getCurrentStep(bundle, state) {
    if (state.contentVersion !== bundle.contentVersion || state.algorithmId !== bundle.algorithmId || state.exampleId !== bundle.exampleId) {
        throw new Error('재생 상태가 현재 예제와 맞지 않습니다.');
    }
    const step = bundle.steps[state.stepIndex];
    if (step === undefined) throw new RangeError(`단계 ${state.stepIndex}가 실행 기록에 없습니다.`);
    return step;
}

/** 화면 한 장을 그리는 데 필요한 값(현재 step, 선택한 언어의 코드와 강조할 줄)을 모은다. */
export function selectView(bundle, state) {
    const step = getCurrentStep(bundle, state);
    const code = bundle.codes[state.languageId];
    return {
        step,
        languageId: state.languageId,
        codeLines: code.lines,
        notes: code.notes,
        activeLines: step.lines[state.languageId],
        progress: describeProgress(state),
    };
}

// ---------- 주소(URL)로 선택한 알고리즘·언어·예제 ----------

const MAX_SHOWN_LENGTH = 24;

/** 주소에서 온 값을 안내 문구에 넣기 전에 정리한다(공백·제어 문자 정리, 길이 제한). 문구는 textContent로만 표시한다. */
function shown(value) {
    const cleaned = String(value).replace(/[\u0000-\u001f\u007f]/g, ' ').replace(/\s+/g, ' ').trim();
    const chars = [...cleaned];
    return chars.length > MAX_SHOWN_LENGTH ? `${chars.slice(0, MAX_SHOWN_LENGTH).join('')}…` : cleaned;
}

/**
 * 주소의 algorithm, example, language 값을 catalog에 있는 값으로만 결정한다. 없거나 잘못된 값은 기본값으로 바꾸고
 * 사용자에게 보여 줄 한국어 안내(notices)를 만든다. 주소의 값은 파일 경로로 쓰지 않는다.
 * 기본값은 BFS(없으면 catalog의 첫 알고리즘), 그 알고리즘의 첫 예제, Python(없으면 예제의 첫 언어)이다.
 *
 * @param {import('./trace-contract.js').Catalog} catalog  검증을 통과한 catalog
 * @param {{get?: Function}|Record<string, string>} [params]  URLSearchParams 또는 일반 객체
 */
export function resolveSelection(catalog, params = new URLSearchParams()) {
    if (!catalog || !Array.isArray(catalog.algorithms) || catalog.algorithms.length === 0) {
        throw new Error('보여 줄 예제가 등록되어 있지 않습니다.');
    }
    const read = (name) => {
        const value = typeof params.get === 'function' ? params.get(name) : params[name];
        return typeof value === 'string' && value !== '' ? value : null;
    };
    const notices = [];

    const wantedAlgorithm = read('algorithm');
    let algorithm = wantedAlgorithm === null ? undefined : catalog.algorithms.find((item) => item.id === wantedAlgorithm);
    const algorithmFellBack = wantedAlgorithm !== null && algorithm === undefined;
    if (algorithm === undefined) algorithm = catalog.algorithms.find((item) => item.id === 'bfs') ?? catalog.algorithms[0];
    if (algorithmFellBack) {
        // 제목이 어떤 글자로 끝나는지(받침 유무) 알 수 없으므로 조사는 "을(를)"로 쓴다.
        notices.push(`주소에 지정한 알고리즘 “${shown(wantedAlgorithm)}”은(는) 사용할 수 없어 기본 알고리즘 “${algorithm.title}”을(를) 보여 줍니다.`);
    }

    // 알고리즘이 기본값으로 바뀌었다면 주소의 예제·언어는 다른 알고리즘 기준이므로 따로 안내하지 않고 기본값을 쓴다.
    const wantedExample = algorithmFellBack ? null : read('example');
    let example = wantedExample === null ? undefined : algorithm.examples.find((item) => item.id === wantedExample);
    if (wantedExample !== null && example === undefined) {
        notices.push(`주소에 지정한 예제 “${shown(wantedExample)}”은(는) 사용할 수 없어 기본 예제 “${algorithm.examples[0].title}”을(를) 보여 줍니다.`);
    }
    if (example === undefined) example = algorithm.examples[0];

    const wantedLanguage = algorithmFellBack ? null : read('language');
    let languageId = wantedLanguage !== null && example.languages.includes(wantedLanguage) ? wantedLanguage : undefined;
    const defaultLanguage = example.languages.includes('python') ? 'python' : example.languages[0];
    if (wantedLanguage !== null && languageId === undefined) {
        notices.push(`주소에 지정한 언어 “${shown(wantedLanguage)}”은(는) 이 예제에서 사용할 수 없어 기본 언어 “${LANGUAGE_LABELS[defaultLanguage]}”을(를) 보여 줍니다.`);
    }
    languageId ??= defaultLanguage;

    return Object.freeze({ algorithmId: algorithm.id, exampleId: example.id, languageId, notices: Object.freeze(notices) });
}

/**
 * 화면의 선택 상자에서 알고리즘이나 예제를 바꿨을 때의 새 선택. 새 선택은 언제나 step 0에서 시작한다(상태를 만드는 쪽의 규칙).
 *
 * - 알고리즘을 바꾸면 그 알고리즘의 첫 예제를 고른다. 예제만 바꾸면 알고리즘은 그대로다.
 * - 언어는 새 예제가 그 언어의 코드를 가지고 있으면 그대로 두고, 없으면 기본 언어(Python, 없으면 첫 언어)로 바꾼다.
 * - catalog에 없는 값(선택 상자를 조작한 경우 등)이거나 지금과 같은 선택이면 current를 그대로 돌려준다(같은 객체).
 *
 * @param {import('./trace-contract.js').Catalog} catalog
 * @param {{algorithmId: string, exampleId: string, languageId: string}} current  지금(또는 불러오는 중인) 선택
 * @param {{algorithmId?: string, exampleId?: string}} change
 */
export function selectionAfterChange(catalog, current, change) {
    const wantedAlgorithm = typeof change.algorithmId === 'string' ? change.algorithmId : current.algorithmId;
    const algorithm = catalog.algorithms.find((item) => item.id === wantedAlgorithm);
    if (algorithm === undefined) return current;

    const algorithmChanged = algorithm.id !== current.algorithmId;
    let example;
    if (typeof change.exampleId === 'string') example = algorithm.examples.find((item) => item.id === change.exampleId);
    else if (algorithmChanged) example = algorithm.examples[0];
    else example = algorithm.examples.find((item) => item.id === current.exampleId);
    if (example === undefined || (!algorithmChanged && example.id === current.exampleId)) return current;

    const languageId = example.languages.includes(current.languageId) ? current.languageId : (example.languages.includes('python') ? 'python' : example.languages[0]);
    return Object.freeze({ algorithmId: algorithm.id, exampleId: example.id, languageId, notices: Object.freeze([]) });
}
