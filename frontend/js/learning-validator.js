import { compileLearning, executeLearning, learningProgram } from './learning-programs.js';

export function sameLearning(a, b) {
    if (a === b) return true;
    if (typeof a !== 'object' || typeof b !== 'object' || a === null || b === null || Array.isArray(a) !== Array.isArray(b)) return false;
    const keys = Object.keys(a);
    return keys.length === Object.keys(b).length && keys.every(key => Object.hasOwn(b, key) && sameLearning(a[key], b[key]));
}

// 단계를 생략하거나 바꾸는 경우까지 거부하는 정규 실행 계약 검사.
// 프로그램 정의와 생성기는 공유하므로 별도 정답 알고리즘/실제 언어 실행 테스트도 반드시 함께 사용한다.
export function validateLearning(bundle, collector) {
    const program = learningProgram(bundle.algorithmId, bundle.input);
    const expected = executeLearning(program);
    if (bundle.steps.length !== expected.length) collector.add(`steps: 정규 실행 단계 수 ${expected.length}개와 다릅니다.`);
    for (let i = 0; i < Math.min(bundle.steps.length, expected.length); i++) {
        const step = bundle.steps[i], wanted = expected[i];
        for (const key of ['state', 'operation', 'eventId', 'message']) if (!sameLearning(step[key], wanted[key])) collector.add(`steps[${i}].${key}: 입력의 정규 실행 결과와 다릅니다.`);
    }
    for (const language of Object.keys(bundle.codes)) {
        const compiled = compileLearning(program, language);
        if (!sameLearning(bundle.codes[language].lines, compiled.lines)) collector.add(`codes.${language}.lines: 검증된 학습 프로그램과 다릅니다.`);
        for (let i = 0; i < bundle.steps.length; i++) if (!sameLearning(bundle.steps[i].lines[language], compiled.mapping[bundle.steps[i].eventId])) collector.add(`steps[${i}].lines.${language}: 학습 연산의 코드 줄과 다릅니다.`);
    }
}
