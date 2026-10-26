// 렌더러 테스트용 최소 DOM. 브라우저 없이 렌더러가 만든 구조를 검사한다.
// 렌더러가 써도 되는 API(createElement(NS), setAttribute, appendChild, append, replaceChildren, textContent)만 구현하고,
// innerHTML·outerHTML·insertAdjacentHTML을 쓰는 순간 예외를 던져서 HTML 문자열 주입 경로가 생기지 않게 한다.
// 이 파일은 테스트가 아니므로 node --test가 직접 실행하지 않는다.

class FakeText {
    constructor(data) {
        this.nodeType = 3;
        this.data = data;
    }

    get textContent() {
        return this.data;
    }
}

const FORBIDDEN = ['innerHTML', 'outerHTML'];

export class FakeElement {
    constructor(ownerDocument, localName, namespaceURI = null) {
        this.nodeType = 1;
        this.ownerDocument = ownerDocument;
        this.localName = localName;
        this.namespaceURI = namespaceURI;
        this.attributes = new Map();
        this.childNodes = [];
        this.parent = null;
        for (const name of FORBIDDEN) {
            Object.defineProperty(this, name, {
                get() { throw new Error(`${name} 읽기는 허용하지 않습니다`); },
                set() { throw new Error(`${name}에 값을 넣는 것은 허용하지 않습니다(HTML 주입 방지). textContent를 쓰세요`); },
            });
        }
    }

    insertAdjacentHTML() {
        throw new Error('insertAdjacentHTML은 허용하지 않습니다');
    }

    // 실제 브라우저의 규칙을 흉내 낸다: 비활성 요소에는 focus()가 조용히 실패하고,
    // 포커스를 가진 요소를 비활성으로 만들면 포커스가 body로 넘어간다(포커스 유실).
    get disabled() {
        return this._disabled === true;
    }

    set disabled(value) {
        this._disabled = Boolean(value);
        // 브라우저마다 포커스를 정리하는 시점이 다르다. 즉시 body로 넘기는 쪽(기본)과, 다음 렌더링 때 정리하는 쪽(lazyBlur)을 모두 흉내 낸다.
        const doc = this.ownerDocument;
        if (this._disabled && doc.activeElement === this && !doc.lazyBlur) doc.activeElement = doc.body;
    }

    // 숨긴(hidden) 요소와 그 안의 요소도 같은 규칙을 따른다: 화면에 없는 요소에는 focus()가 조용히 실패하고,
    // 포커스를 가진 요소(또는 그 안의 요소)를 숨기면 포커스가 body로 넘어간다. 이 규칙을 모르면 "숨기는 버튼이 포커스를 가지고 있는" 결함을 못 잡는다.
    get hidden() {
        return this._hidden === true;
    }

    set hidden(value) {
        this._hidden = Boolean(value);
        const doc = this.ownerDocument;
        if (this._hidden && !doc.lazyBlur && this.contains(doc.activeElement)) doc.activeElement = doc.body;
    }

    /** 이 요소 자신이나 조상 중에 숨긴 것이 있으면 true. */
    get isHiddenInTree() {
        for (let node = this; node !== null; node = node.parent) if (node.hidden) return true;
        return false;
    }

    /** other가 이 요소 자신이거나 그 안(자손)에 있으면 true. */
    contains(other) {
        for (let node = other; node !== null && node !== undefined; node = node.parent) if (node === this) return true;
        return false;
    }

    /**
     * 실제 브라우저처럼 button·input·select·textarea·summary나 tabindex가 있는 요소만 포커스를 받는다.
     * 엄격 모드(doc.strictFocus)에서만 적용한다. 기본은 모든 요소가 받는다(단순한 가짜 DOM 테스트가 요소마다 속성을 붙이지 않도록).
     */
    get isFocusable() {
        if (!this.ownerDocument.strictFocus) return true;
        return ['button', 'input', 'select', 'textarea', 'summary'].includes(this.localName) || this.hasAttribute('tabindex') || (this.localName === 'a' && this.hasAttribute('href'));
    }

    focus() {
        if (this.disabled || this.isHiddenInTree || !this.isFocusable) return;
        this.ownerDocument.activeElement = this;
    }

    // ---- 이벤트(화면 전체를 시험할 때 쓴다) ----
    addEventListener(type, listener) {
        this._listeners ??= new Map();
        this._listeners.set(type, [...(this._listeners.get(type) ?? []), listener]);
    }

    /** 이벤트를 보낸다(브라우저가 보내는 것과 같은 모양의 최소 객체). */
    fire(type) {
        for (const listener of this._listeners?.get(type) ?? []) listener({ type, target: this });
    }

    /** 사용자가 누른다(마우스·터치·Enter·Space). 비활성 요소에서는 클릭 이벤트가 생기지 않는다. */
    click() {
        if (this.disabled) return;
        this.fire('click');
    }

    setAttribute(name, value) {
        this.attributes.set(name, String(value));
    }

    getAttribute(name) {
        return this.attributes.has(name) ? this.attributes.get(name) : null;
    }

    hasAttribute(name) {
        return this.attributes.has(name);
    }

    appendChild(node) {
        this.childNodes.push(node);
        if (node.nodeType === 1) node.parent = this;
        return node;
    }

    append(...nodes) {
        for (const node of nodes) this.appendChild(typeof node === 'string' ? new FakeText(node) : node);
    }

    replaceChildren(...nodes) {
        this.#detachChildren();
        this.append(...nodes);
    }

    #detachChildren() {
        for (const child of this.childNodes) if (child.nodeType === 1) child.parent = null;
        this.childNodes = [];
    }

    get children() {
        return this.childNodes.filter((node) => node.nodeType === 1);
    }

    get textContent() {
        return this.childNodes.map((node) => node.textContent).join('');
    }

    set textContent(value) {
        const text = String(value);
        this.#detachChildren();
        if (text !== '') this.childNodes = [new FakeText(text)];
    }
}

export class FakeDocument {
    constructor({ lazyBlur = false } = {}) {
        this.lazyBlur = lazyBlur;
        this.body = this.createElement('body');
        this.activeElement = this.body;
        this.hidden = false; // 탭이 숨겨졌는지(visibilitychange 때 읽는다)
    }

    addEventListener(type, listener) {
        this._listeners ??= new Map();
        this._listeners.set(type, [...(this._listeners.get(type) ?? []), listener]);
    }

    /** 문서에 이벤트를 보낸다(예: visibilitychange). */
    fire(type) {
        for (const listener of this._listeners?.get(type) ?? []) listener({ type, target: this });
    }

    /** lazyBlur 모드에서 "다음 렌더링"을 흉내 낸다: 비활성이 되거나 숨겨진 요소가 아직 포커스를 가지고 있으면 body로 넘긴다. */
    settle() {
        if (this.activeElement.disabled || this.activeElement.isHiddenInTree) this.activeElement = this.body;
    }

    createElement(name) {
        return new FakeElement(this, name.toLowerCase());
    }

    /** id로 찾을 수 있게 등록한다(화면 전체를 시험할 때 쓴다). */
    register(id, element) {
        this._byId ??= new Map();
        this._byId.set(id, element);
        return element;
    }

    getElementById(id) {
        return this._byId?.get(id) ?? null;
    }

    createElementNS(namespaceURI, name) {
        return new FakeElement(this, name, namespaceURI);
    }

    createTextNode(text) {
        return new FakeText(text);
    }
}

export function makeRoot(tag = 'div') {
    return new FakeDocument().createElement(tag);
}

// ---------- 검사용 도구 ----------

export function walk(node, visit) {
    if (node.nodeType !== 1) return;
    visit(node);
    for (const child of node.childNodes) walk(child, visit);
}

export function findAll(root, predicate) {
    const found = [];
    walk(root, (node) => { if (predicate(node)) found.push(node); });
    return found;
}

export const classesOf = (node) => (node.getAttribute('class') ?? '').split(/\s+/).filter(Boolean);
export const byClass = (root, className) => findAll(root, (node) => classesOf(node).includes(className));
export const byTag = (root, localName) => findAll(root, (node) => node.localName === localName);
